import {mkdirSync,existsSync,readFileSync,openSync,closeSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {append,json,jsonl,save,hash,canonical} from './io.mjs';
import {validateManifest} from './manifest.mjs';
import {usageOf,summarizeUsage} from './usage.mjs';
import {loadBundle} from './freeze.mjs';
import {createLiveTransport,loadApiKey} from './live-transport.mjs';
import {loadPreflightReceipt} from './preflight.mjs';

export const retryable=r=>!(/refused to answer/i.test(r.error??''))&&(r.status===0||r.status===429||r.status>=500);
function semaphore(limit) {
  let active=0;const queue=[];
  return async fn=>{if(active>=limit)await new Promise(resolve=>queue.push(resolve));else active++;
    try{return await fn();}finally{const next=queue.shift();if(next)next();else active--;}};
}
export function indexJournal(events) {
  const byRequest=new Map(),bySlot=new Map();
  for(const ev of events) if(ev.kind==='attempt-result') {
    (byRequest.get(ev.requestId)??byRequest.set(ev.requestId,[]).get(ev.requestId)).push(ev);
    (bySlot.get(ev.slot)??bySlot.set(ev.slot,[]).get(ev.slot)).push(ev);
  }
  return {byRequest,bySlot};
}
export function readJournal(path,manifest) {
  const events=jsonl(path),requests=new Map(manifest.entries.flatMap(e=>e.requests.map(r=>[r.requestId,{e,r}]))),starts=new Map(),ends=new Map(),attempts=new Map();
  for(const ev of events) {
    if(ev.experimentId!==manifest.id||!requests.has(ev.requestId))throw new Error('Journal experiment/request mismatch');
    const {e,r}=requests.get(ev.requestId);
    if(ev.slot!==e.slot||ev.bodyHash!==r.bodyHash||ev.model!==e.model||ev.question!==r.question||ev.attemptId!==hash(`${manifest.id}|${r.requestId}|${ev.attempt}`)||!Number.isInteger(ev.attempt)||ev.attempt<1)throw new Error('Journal context mismatch');
    if(ev.kind==='attempt-start') {if(starts.has(ev.attemptId))throw new Error('Duplicate dispatch journal entry');starts.set(ev.attemptId,ev);}
    else if(ev.kind==='attempt-result') {
      if(!starts.has(ev.attemptId)||ends.has(ev.attemptId))throw new Error('Result lacks a unique preceding dispatch');
      ends.set(ev.attemptId,ev);(attempts.get(ev.requestId)??attempts.set(ev.requestId,[]).get(ev.requestId)).push(ev.attempt);
    } else throw new Error('Unknown journal event');
  }
  const unresolved=[...starts.keys()].filter(k=>!ends.has(k));
  if(unresolved.length)throw new Error(`Ambiguous in-flight dispatches (${unresolved.length}); reconcile with provider records before resuming. No automatic rebilling.`);
  for(const ns of attempts.values())if(ns.sort((a,b)=>a-b).some((n,i)=>n!==i+1))throw new Error('Nonconsecutive journal attempts');
  return events;
}
export function deriveRecord(entry,index,experimentId) {
  const results=index.bySlot.get(entry.slot)??[];if(!results.length)return null;
  const answers={};for(const r of entry.requests) {const success=(index.byRequest.get(r.requestId)??[]).find(e=>e.result.ok);if(success)Object.assign(answers,success.result.answers);}
  const failed=entry.requests.filter(r=>!(index.byRequest.get(r.requestId)??[]).some(e=>e.result.ok));
  return {experimentId,model:entry.model,setting:entry.setting,track:entry.track,caseId:entry.caseId,variant:entry.variant,split:entry.split,dispatchedAt:Math.min(...results.map(e=>e.dispatchAt)),completedAt:Math.max(...results.map(e=>e.completedAt)),answers:Object.keys(answers).length?answers:null,error:failed.length?'request_components_failed':null,requests:results.map(e=>({requestId:e.requestId,bodyHash:e.bodyHash,question:e.question,attempt:e.attempt,ok:e.result.ok,status:e.result.status,latencyMs:e.result.latencyMs,...usageOf(e.result),servedModel:e.result.servedModel,provider:e.result.provider,generationId:e.result.generationId,error:e.result.error}))};
}
export async function runPlan({manifest,dataset,outDir,transport,requestConcurrency=8,maxAttempts=3,seed='turkce-karar',priorPhaseEvents=[],modelPolicies={},checkpointMs=30000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if(!Number.isInteger(requestConcurrency)||requestConcurrency<1||!Number.isInteger(maxAttempts)||maxAttempts<1)throw new Error('Invalid operational configuration');
  validateManifest(manifest,dataset,manifest.datasetHash);
  mkdirSync(outDir,{recursive:true});const lock=join(outDir,'RUN.lock');
  let lockFd;try {lockFd=openSync(lock,'wx');writeFileSync(lockFd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),experimentId:manifest.id}));}
  catch{throw new Error('Run directory is locked; verify no other process is dispatching before removing a stale lock');}
  const manifestPath=join(outDir,'manifest.json'),journalPath=join(outDir,'attempts.jsonl');let timer;
  try {
    if(existsSync(manifestPath)) {if(canonical(json(manifestPath))!==canonical(manifest))throw new Error('Run manifest differs from frozen experiment');}
    else if(existsSync(journalPath)&&readFileSync(journalPath,'utf8').trim())throw new Error('Existing journal lacks its manifest');
    else save(manifestPath,manifest);
    const events=readJournal(journalPath,manifest),index=indexJournal(events),inflight=semaphore(requestConcurrency),served=new Map();let stopReason=null,active=0,completedSinceResume=0;
    const launchedAt=Date.now(),groups=new Map();
    for(const e of manifest.entries)(groups.get(e.model)??groups.set(e.model,[]).get(e.model)).push(e);
    const stats=new Map([...groups.keys()].map(model=>[model,{nextStart:0,cooldownUntil:0,rateLimited:0,active:0}]));
    for(const ev of [...priorPhaseEvents,...events])if(ev.kind==='attempt-result'&&ev.result.servedModel) {const set=served.get(ev.model)??new Set();set.add(ev.result.servedModel);served.set(ev.model,set);}
    if([...served.values()].some(set=>set.size>1))throw new Error('Served model identity changed in this experiment; quarantine before resuming');
    const terminalRequest=r=>{const es=index.byRequest.get(r.requestId)??[];return es.some(e=>e.result.ok)||es.length>=maxAttempts||(es.length>0&&!retryable(es.at(-1).result));};
    function snapshot(final=false) {
      const models={};let completeSlots=0,terminalRequests=0,successfulRequests=0;
      for(const [model,es] of groups) {
        const rs=es.flatMap(e=>e.requests),terminal=rs.filter(terminalRequest).length,success=rs.filter(r=>(index.byRequest.get(r.requestId)??[]).some(e=>e.result.ok)).length;
        const complete=es.filter(e=>e.requests.every(terminalRequest)).length;terminalRequests+=terminal;successfulRequests+=success;completeSlots+=complete;
        models[model]={expectedRequests:rs.length,terminalRequests:terminal,successfulRequests:success,failedRequests:terminal-success,completeSlots:complete,expectedSlots:es.length,active:stats.get(model).active,rateLimited:stats.get(model).rateLimited};
      }
      const usage=summarizeUsage([...priorPhaseEvents,...events]);save(join(outDir,'usage.json'),usage);
      save(join(outDir,'run-status.json'),{experimentId:manifest.id,transport:transport.name,status:final?(stopReason?'stopped':'complete'):'running',stopReason,completeSlots,expectedDecisions:manifest.expectedDecisions,terminalRequests,expectedRequests:manifest.expectedRequests,successfulRequests,activeRequests:active,elapsedSinceResumeMs:Date.now()-launchedAt,completedSinceResume,priceCapUsd:null,updatedAt:new Date().toISOString(),models});
      if(final) {const records=manifest.entries.map(e=>deriveRecord(e,index,manifest.id)).filter(Boolean);writeFileSync(join(outDir,'records.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+(records.length?'\n':''));return {records,events,stopReason,usage};}
    }
    // The fsynced journal remains canonical; status files are replaceable projections.
    timer=setInterval(()=>{try{snapshot();}catch(e){stopReason=`Checkpoint failed: ${e.message}`;}},checkpointMs);timer.unref();snapshot();
    async function request(entry,r) {
      const prior=index.byRequest.get(r.requestId)??[];if(terminalRequest(r))return;
      const state=stats.get(entry.model),policy=modelPolicies[entry.model]??{};
      for(let attempt=prior.length+1;attempt<=maxAttempts;attempt++) {
        if(stopReason)return;
        const now=Date.now(),ready=Math.max(now,state.nextStart,state.cooldownUntil);state.nextStart=ready+(policy.minIntervalMs??0);
        if(ready>now)await sleep(ready-now);
        let result;
        await inflight(async()=>{
          if(stopReason)return;
          if(state.cooldownUntil>Date.now())await sleep(state.cooldownUntil-Date.now());if(stopReason)return;
          active++;state.active++;
          const attemptId=hash(`${manifest.id}|${r.requestId}|${attempt}`),context={experimentId:manifest.id,attemptId,requestId:r.requestId,bodyHash:r.bodyHash,slot:entry.slot,model:entry.model,question:r.question,attempt,phase:'full'};
          const dispatchAt=Date.now(),start={kind:'attempt-start',...context,dispatchAt};append(journalPath,start);events.push(start);
          try{result=await transport.send(r.body,context);}catch(e){result={ok:false,status:0,answers:null,error:String(e?.message??e),usage:null,servedModel:null,provider:null,generationId:null};}
          if(!result||typeof result.ok!=='boolean')result={ok:false,status:0,error:'invalid_transport_result',usage:null};
          const end={kind:'attempt-result',...context,dispatchAt,completedAt:Date.now(),terminal:result.ok||!retryable(result)||attempt===maxAttempts,result};append(journalPath,end);events.push(end);
          (index.byRequest.get(r.requestId)??index.byRequest.set(r.requestId,[]).get(r.requestId)).push(end);(index.bySlot.get(entry.slot)??index.bySlot.set(entry.slot,[]).get(entry.slot)).push(end);
          active--;state.active--;completedSinceResume++;
          if(result.status===429) {state.rateLimited++;state.cooldownUntil=Date.now()+Math.max(1000,Number.isFinite(result.retryAfterMs)?result.retryAfterMs:5000);}
          if(result.servedModel) {const set=served.get(entry.model)??new Set();set.add(result.servedModel);served.set(entry.model,set);if(set.size>1)stopReason=`Served identity changed for ${entry.model}`;}
        });
        if(!result||result.ok||!retryable(result)||attempt===maxAttempts||stopReason)break;
        await sleep(Math.max(500*2**(attempt-1),Number.isFinite(result.retryAfterMs)?result.retryAfterMs:0));
      }
    }
    // Model queues prevent one slow provider from occupying every worker.
    await Promise.all([...groups].map(async([model,entries])=>{
      const scheduled=entries.map(e=>({e,key:hash(`${seed}|${e.slot}`)})).sort((a,b)=>a.key.localeCompare(b.key)).flatMap(({e})=>e.requests.map(r=>({e,r})));
      let next=0;const limit=Math.min(modelPolicies[model]?.concurrency??requestConcurrency,scheduled.length);if(!Number.isInteger(limit)||limit<1)throw new Error('Invalid per-model concurrency');
      await Promise.all(Array.from({length:limit},async()=>{while(next<scheduled.length&&!stopReason){const {e,r}=scheduled[next++];await request(e,r);}}));
    }));
    clearInterval(timer);return snapshot(true);
  } finally {clearInterval(timer);closeSync(lockFd);unlinkSync(lock);}
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const arg=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:null;};
  if(!process.argv.includes('--execute')||!arg('--authorization')||!arg('--out'))throw new Error('Inference is paused. Execution requires --execute --authorization <approval.json> --out <run-directory>.');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url))),{dataset,manifest,plan}=loadBundle(join(root,'frozen')),approval=json(arg('--authorization'));
  if(approval.experimentId!==manifest.id||approval.inference!==true||approval.priceCapUsd!==null)throw new Error('Authorization does not match this exact uncapped full experiment');
  if(!arg('--preflight-receipt'))throw new Error('A recorded live preflight is required before benchmark dispatch');
  const preflight=loadPreflightReceipt(arg('--preflight-receipt'),json(join(root,'frozen/preflight.json')));
  if(plan.models.some(m=>!preflight.verifiedModels.includes(m.id)))throw new Error('Some planned formats failed preflight; freeze a revised compatible plan before dispatch');
  const transport=createLiveTransport({apiKey:loadApiKey(arg('--env-file')),timeoutMs:plan.timeoutMs,modelTimeouts:plan.modelPolicies});
  const result=await runPlan({manifest,dataset,outDir:resolve(arg('--out')),transport,requestConcurrency:plan.requestConcurrency,maxAttempts:plan.maxAttempts,seed:plan.seed,priorPhaseEvents:preflight.events,modelPolicies:plan.modelPolicies,checkpointMs:plan.checkpointMs});
  console.log(JSON.stringify({experimentId:manifest.id,records:result.records.length,stopReason:result.stopReason,usage:result.usage}));
}
