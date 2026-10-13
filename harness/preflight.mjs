// Future live format checks. These are outside benchmark scoring and still part of usage accounting.
import {mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,canonical,append,json,jsonl,save} from './io.mjs';
import {buildState,stateAsText} from './inputs.mjs';
import {validateBinary,validateOptions} from '../scoring/score.mjs';
import {summarizeUsage} from './usage.mjs';
import {loadBundle} from './freeze.mjs';
import {loadApiKey,createLiveTransport} from './live-transport.mjs';
export function buildPreflight(manifest,plan,dataset) {
  const f={taskType:'T2',rule:null},state=buildState(f,{message:'Siparişi iptal ettim. Paketi annem teslim aldı; babam, kardeşim ve ben teslim almadık.'}),requests=[];
  const p={type:'noul',instructions:'Bu mesaj, müşterinin siparişi iptal ettiğini ortaya koyuyor mu?',criteria:dataset.trackA.criteria};
  const n={...p,instructions:'Bu mesaj, müşterinin siparişi iptal etmediğini ortaya koyuyor mu?'};
  const main={type:'choice',instructions:'Müşteri siparişi iptal etti mi?',criteria:dataset.mainOptions.T2};
  const entity={type:'choice',instructions:'Paketi kim teslim aldı?',criteria:{ANNE:'Müşterinin annesi',BABA:'Müşterinin babası',KARDES:'Müşterinin kardeşi',ANLASILMIYOR:'Mesajdan anlaşılmıyor'}};
  for(const model of plan.models)for(const kind of ['noul',...(model.tracks.includes('B1')?['choice3']:[]),...(model.tracks.includes('B2')?['choice4']:[]),...(model.settings.includes('native')?['multi-noul']:[])]) {
    const questions=kind==='noul'?{P:p}:kind==='multi-noul'?{P:p,notP:n}:kind==='choice3'?{main}:{entity};
    const body={model:model.id,state:model.stateFormat==='text'?stateAsText(state):state,questions};
    const bodyHash=hash(canonical(body)),requestId=hash(`${manifest.id}|preflight|${model.id}|${kind}|${bodyHash}`);
    requests.push({model:model.id,kind,body,bodyHash,requestId});
  }
  const contents={experimentId:manifest.id,requests};return {id:hash(canonical(contents)),...contents};
}
function compatible(result,r) {
  if(!result.ok)return false;
  return Object.entries(r.body.questions).every(([label,q])=>q.type==='noul'?validateBinary(result.answers?.[label]?.noul).ok:validateOptions(result.answers?.[label],Object.keys(q.criteria)).ok);
}
export function verifyPreflight(preflight,events) {
  const started=new Set(),finished=new Set();
  for(const e of events) {
    const r=preflight.requests.find(r=>r.requestId===e.requestId);
    if(!r||e.phase!=='preflight'||e.experimentId!==preflight.experimentId||e.bodyHash!==r.bodyHash||e.model!==r.model||e.attemptId!==hash(`${preflight.id}|${r.requestId}|${e.attempt}`)||!Number.isInteger(e.attempt)||e.attempt<1)throw new Error('Preflight journal mismatch');
    if(e.kind==='attempt-start'){if(started.has(e.attemptId))throw new Error('Duplicate preflight start');started.add(e.attemptId);}
    else if(e.kind==='attempt-result'){if(!started.has(e.attemptId)||finished.has(e.attemptId))throw new Error('Invalid preflight result');finished.add(e.attemptId);}
    else throw new Error('Unknown preflight journal event');
  }
  if([...started].some(id=>!finished.has(id)))throw new Error('Ambiguous preflight dispatch; reconcile before resuming');
  const rows=preflight.requests.map(r=>{const es=events.filter(e=>e.kind==='attempt-result'&&e.requestId===r.requestId);const served=[...new Set(es.map(e=>e.result.servedModel).filter(Boolean))];return {model:r.model,kind:r.kind,attempts:es.length,passed:es.some(e=>compatible(e.result,r))&&served.length<=1,servedModels:served};});
  const verifiedModels=[...new Set(rows.map(r=>r.model))].filter(m=>rows.filter(r=>r.model===m).every(r=>r.passed)&&new Set(rows.filter(r=>r.model===m).flatMap(r=>r.servedModels)).size<=1);
  return {experimentId:preflight.experimentId,preflightId:preflight.id,rows,verifiedModels,usage:summarizeUsage(events)};
}
export async function runPreflight({preflight,outDir,transport,maxAttempts=3,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  mkdirSync(outDir,{recursive:true});const lock=join(outDir,'PREFLIGHT.lock');
  let fd;try{fd=openSync(lock,'wx');}catch{throw new Error('Preflight directory is locked');}
  try {const path=join(outDir,'preflight-attempts.jsonl'),events=jsonl(path);verifyPreflight(preflight,events);
  for(const r of preflight.requests) {
    const prior=events.filter(e=>e.kind==='attempt-result'&&e.requestId===r.requestId);
    if(prior.some(e=>compatible(e.result,r))||prior.length>=maxAttempts||prior.length&&!retryable(prior.at(-1).result))continue;
    for(let attempt=prior.length+1;attempt<=maxAttempts;attempt++) {
      const context={experimentId:preflight.experimentId,requestId:r.requestId,bodyHash:r.bodyHash,model:r.model,slot:`preflight|${r.model}|${r.kind}`,question:r.kind,attempt,phase:'preflight',attemptId:hash(`${preflight.id}|${r.requestId}|${attempt}`)},dispatchAt=Date.now();
      const start={kind:'attempt-start',...context,dispatchAt};append(path,start);events.push(start);
      let result;try{result=await transport.send(r.body,context);}catch(e){result={ok:false,status:0,error:String(e?.message??e),usage:null};}
      const end={kind:'attempt-result',...context,dispatchAt,completedAt:Date.now(),result};append(path,end);events.push(end);
      if(compatible(result,r)||!retryable(result)||attempt===maxAttempts)break;
      await sleep(Math.min(30000,Math.max(500*2**(attempt-1),Number.isFinite(result.retryAfterMs)?result.retryAfterMs:0)));
    }
  }
  const receipt=verifyPreflight(preflight,events);save(join(outDir,'preflight-receipt.json'),{...receipt,journalHash:hash(canonical(events))});return {receipt,events};
  }finally{closeSync(fd);unlinkSync(lock);}
}
const retryable=r=>r.status===0||r.status===429||r.status>=500;
export function loadPreflightReceipt(path,preflight) {
  const receipt=json(path),events=jsonl(join(resolve(path,'..'),'preflight-attempts.jsonl')),checked=verifyPreflight(preflight,events);
  if(receipt.journalHash!==hash(canonical(events))||canonical({...receipt,journalHash:undefined})!==canonical(checked))throw new Error('Preflight receipt/journal differs');
  return {...checked,events};
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const arg=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:null;};
  if(!process.argv.includes('--execute')||!arg('--authorization')||!arg('--out'))throw new Error('Inference is paused. Preflight also requires explicit authorization.');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url))),bundle=loadBundle(join(root,'frozen')),approval=json(arg('--authorization'));
  if(approval.experimentId!==bundle.manifest.id||approval.inference!==true||approval.priceCapUsd!==null)throw new Error('Authorization does not match this uncapped experiment');
  const preflight=json(join(root,'frozen/preflight.json'));
  const result=await runPreflight({preflight,outDir:arg('--out'),transport:createLiveTransport({apiKey:loadApiKey(arg('--env-file')),timeoutMs:bundle.plan.timeoutMs}),maxAttempts:bundle.plan.maxAttempts});
  console.log(JSON.stringify(result.receipt));
}
