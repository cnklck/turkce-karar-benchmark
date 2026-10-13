import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,canonical,json,jsonl,append,save} from '../harness/io.mjs';
import {buildManifest,validateManifest} from '../harness/manifest.mjs';
import {buildState,stateAsText} from '../harness/inputs.mjs';
import {runPlan} from '../harness/run.mjs';
import {createLiveTransport} from '../harness/live-transport.mjs';
import {summarizeUsage,projectFullCost} from '../harness/usage.mjs';
import {freeze,loadBundle,IMPLEMENTATION_FILES} from '../harness/freeze.mjs';
import {scoreAll,evaluate,requestCost,loadFamilies,validateOptions,validateBinary} from '../scoring/score.mjs';
import {pairedCompare} from '../harness/paired.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),bank=json(join(root,'data/sample.json')),plan=json(join(root,'plan.json'));
const tiny={...bank,families:bank.families.filter(f=>['C001','X018'].includes(f.id))};
const smallPlan={...plan,models:[{id:'fixture/model',settings:['common','native'],tracks:['A','B1']}],splits:['core','challenge']};
function manifest(ds=tiny,p=smallPlan) {return buildManifest(ds,p,{datasetHash:hash(canonical(ds)),implementationHash:'fixture-code-hash'});}
const refs=ds=>new Map(ds.families.flatMap(f=>f.cases.map(c=>[c.id,{f,c}])));
function goodRecord(e,m,ds=tiny) {
  const c=refs(ds).get(e.caseId).c,q=e.track==='A'?{P:{noul:c.gold.trackA.P?0.95:0.05},notP:{noul:c.gold.trackA.notP?0.95:0.05}}:{main:{choice:c.key,probabilities:Object.fromEntries(ds.keys.map(k=>[k,k===c.key?0.9:0.05]))}};
  return {...e,experimentId:m.id,dispatchedAt:100,completedAt:110,answers:q,error:null,requests:e.requests.map(r=>({requestId:r.requestId,bodyHash:r.bodyHash,question:r.question,attempt:1,ok:true,cost:0.001,inputTokens:400,outputTokens:0}))};
}
const temp=()=>mkdtempSync(join(tmpdir(),'turkce-karar-offline-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const goodTransport={name:'offline-fixture',async send(body){return {ok:true,status:200,answers:Object.fromEntries(Object.entries(body.questions).map(([k,q])=>[k,q.type==='noul'?{noul:0.1}:{choice:'HAYIR',probabilities:{EVET:0.05,HAYIR:0.9,ANLASILMIYOR:0.05}}])),usage:{cost:0.0001,input_tokens:300,output_tokens:0},servedModel:'fixture/version-1',provider:'offline'}}};

test('full bank contains 800 intact sets, balanced capabilities and supported evidence spans',()=>{
  assert.equal(bank.families.length,800);assert.equal(bank.families.flatMap(f=>f.cases).length,2400);
  assert.equal(bank.counts.all.entityCases,369);assert.equal(Object.values(bank.counts.all.classes).reduce((a,b)=>a+b,0),2400);
  for(const cap of Object.keys(bank.capabilities))assert.equal(bank.families.filter(f=>f.capability===cap).length,80);
  for(const f of bank.families){assert.deepEqual(f.cases.map(c=>c.role),['base','contrast','preserve']);assert.notEqual(f.cases[0].key,f.cases[1].key);assert.equal(f.cases[0].key,f.cases[2].key);
    for(const c of f.cases){assert.equal(c.gold.main,c.key);assert.equal(c.gold.trackA.P,c.key==='EVET');assert.equal(c.gold.trackA.notP,c.key==='HAYIR');assert.equal(c.rule,f.rule);assert.equal(c.review.humanValidated,false);for(const span of c.evidence)assert.ok(c.message.includes(span),`${c.id} evidence span missing`);}
  }
});
test('visible policy and deterministic serialization contain no gold or annotation fields',()=>{
  for(const f of bank.families)for(const c of f.cases){const state=buildState(f,c);assert.ok(state.kanit_ilkesi&&state.gorev_ilkesi);assert.ok(!('gold' in state));assert.ok(!('id' in state));assert.ok(!('facts' in state));for(const value of Object.values(state))assert.ok(stateAsText(state).includes(value));}
  assert.ok(bank.families.find(f=>f.id==='C039').rule.includes('başka hesap hareketi yoktur'));
  for(const id of ['C074-B','X181-B','X443-B'])assert.ok(refs(bank).get(id).c.message.endsWith('vermedi.')||refs(bank).get(id).c.message.endsWith('kısaltmadı.')||refs(bank).get(id).c.message.endsWith('istemedi.'));
});
test('full planned workload is 64059 decisions / 95259 requests, no choice track for Span',()=>{
  const m=manifest(bank,plan);assert.equal(m.expectedDecisions,64059);assert.equal(m.expectedRequests,95259);assert.equal(plan.priceCapUsd,null);
  assert.ok(m.entries.filter(e=>e.model.startsWith('respan/')).every(e=>e.track==='A'&&e.stateFormat==='text'));
  assert.ok(validateManifest(m,bank,m.datasetHash));
});
test('identity binds labels, plan, input implementation and request bodies',()=>{
  const m=manifest(),changed=structuredClone(tiny);changed.families[0].cases[0].key='ANLASILMIYOR';assert.notEqual(m.id,manifest(changed).id);
  const p={...smallPlan,requestConcurrency:2};assert.notEqual(m.id,manifest(tiny,p).id);
  const bad=structuredClone(m);bad.entries[0].requests[0].body.state.mesaj+=' injected';assert.throws(()=>validateManifest(bad,tiny,m.datasetHash),/identity|mismatch/);
  assert.throws(()=>validateManifest(m,tiny,'wrong'),/dataset hash/);
});
test('frozen bundle rejects modified data or implementation',()=>{
  const dir=temp();try{mkdirSync(join(dir,'data'));save(join(dir,'data/sample.json'),tiny);cpSync(join(root,'data/changes.json'),join(dir,'data/changes.json'));cpSync(join(root,'plan.json'),join(dir,'plan.json'));cpSync(join(root,'model-registry.json'),join(dir,'model-registry.json'));
    for(const f of IMPLEMENTATION_FILES){mkdirSync(join(dir,f,'..'),{recursive:true});cpSync(join(root,f),join(dir,f));}
    freeze(dir);assert.ok(loadBundle(join(dir,'frozen')).manifest.id);
    writeFileSync(join(dir,'harness/inputs.mjs'),'changed');assert.throws(()=>loadBundle(join(dir,'frozen')),/implementation/);
    cpSync(join(root,'harness/inputs.mjs'),join(dir,'harness/inputs.mjs'));writeFileSync(join(dir,'frozen/sample.json'),'{}');assert.throws(()=>loadBundle(join(dir,'frozen')),/Frozen file changed/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('scoring keeps splits separate and refuses wrong bank identity',()=>{
  const m=manifest(),rows=m.entries.map(e=>goodRecord(e,m));const out=scoreAll(rows,refs(tiny),m,{datasetHash:m.datasetHash});
  assert.equal(out.integrity.status,'complete');assert.ok(Object.keys(out.summary).some(k=>k.endsWith('|core')));assert.ok(Object.keys(out.summary).some(k=>k.endsWith('|challenge')));
  assert.ok(Object.values(out.summary).every(s=>s.accuracyEndToEnd===1));assert.throws(()=>scoreAll(rows,refs(tiny),m,{datasetHash:'wrong'}),/dataset hash/);
  assert.throws(()=>loadFamilies(),/Explicit frozen/);
});
test('untransmitted component cannot be correct; partial transport failure is an API failure',()=>{
  const m=manifest(),e=m.entries.find(e=>e.track==='A'&&e.setting==='common'),ref=refs(tiny).get(e.caseId);
  const r=goodRecord(e,m);r.requests.pop();let d=evaluate(r,ref,e);assert.equal(d.failure,'integrity');assert.equal(d.correct,false);
  r.requests=goodRecord(e,m).requests;r.requests[1].ok=false;r.answers.notP=undefined;d=evaluate(r,ref,e);assert.equal(d.failure,'api');assert.equal(d.correct,false);
});
test('spoofed experiment/request identity and duplicates cannot improve a score',()=>{
  const m=manifest(),rows=m.entries.map(e=>goodRecord(e,m));rows[0].experimentId='wrong';rows[1].requests[0].bodyHash='wrong';let s=scoreAll(rows,refs(tiny),m,{datasetHash:m.datasetHash});assert.equal(s.integrity.malformedRecords.length,2);assert.equal(s.integrity.missingSlots.length,2);
  const e=m.entries[0],bad=goodRecord(e,m);bad.answers={P:{noul:1},notP:{noul:1}};bad.dispatchedAt=0;s=scoreAll([bad,...m.entries.map(e=>goodRecord(e,m))],refs(tiny),m,{datasetHash:m.datasetHash});assert.equal(s.integrity.extraDuplicateRecords,1);assert.equal(s.decisions[0].correct,false);
});
test('probability validator checks finite values, range, sums and explicit hard choice',()=>{
  assert.equal(validateBinary(NaN).ok,false);assert.equal(validateBinary(1.1).ok,false);assert.equal(validateBinary(0.5).ok,true);
  assert.equal(validateOptions({probabilities:{E:0.7,H:0.7}},['E','H']).ok,false);
  assert.equal(validateOptions({choice:'H',probabilities:{E:0.9,H:0.1}},['E','H']).anomaly,true);
});
test('zero cost is valid; missing and invalid costs remain unavailable',()=>{
  assert.equal(requestCost({cost:0},'m').source,'provider');assert.equal(requestCost({cost:null,ok:false},'m').source,'unavailable');assert.equal(requestCost({inputTokens:3,outputTokens:0},'m',{m:{inputPerToken:-1,outputPerToken:0}}).source,'unavailable');
  const u=summarizeUsage([{kind:'attempt-start',attemptId:'a'}, {kind:'attempt-result',attemptId:'a',model:'m',attempt:1,result:{ok:false,usage:{cost:0,input_tokens:9,output_tokens:0}}}]);assert.equal(u.byModel.m.inputTokens,9);assert.equal(u.byModel.m.failed,1);assert.equal(u.accountingComplete,true);
  assert.equal(summarizeUsage([{kind:'attempt-start',attemptId:'a'}]).accountingComplete,false);
});
test('failed live transport preserves usage, identity and Retry-After without real network',async()=>{
  const transport=createLiveTransport({apiKey:'offline-fixture',fetchImpl:async()=>new Response(JSON.stringify({model:'served-v1',provider:'fixture',id:'gen-1',usage:{cost:0.0003,input_tokens:100,output_tokens:0},error:{message:'busy'}}),{status:429,headers:{'retry-after':'2'}})});
  const r=await transport.send({model:'fixture/model'});assert.equal(r.ok,false);assert.equal(r.usage.cost,0.0003);assert.equal(r.servedModel,'served-v1');assert.equal(r.retryAfterMs,2000);
});
test('journal covers retries; manifest is saved before dispatch; resume does not resend',async()=>{
  const dir=temp(),m=manifest();let calls=0,waits=0;try{
    const transport={name:'offline-resume',async send(body,ctx){calls++;assert.ok(existsSync(join(dir,'manifest.json')));assert.ok(jsonl(join(dir,'attempts.jsonl')).some(e=>e.kind==='attempt-start'&&e.attemptId===ctx.attemptId));if(ctx.attempt===1)return {ok:false,status:429,error:'fixture',usage:{cost:0.00001,input_tokens:10,output_tokens:0},servedModel:'fixture/version-1'};return goodTransport.send(body,ctx);}};
    const a=await runPlan({manifest:m,dataset:tiny,outDir:dir,transport,requestConcurrency:2,sleep:async()=>{waits++;}});assert.equal(a.usage.dispatchAttempts,m.expectedRequests*2);assert.ok(waits>=m.expectedRequests);assert.equal(a.usage.byModel['fixture/model'].failed,m.expectedRequests);
    const before=calls,journal=readFileSync(join(dir,'attempts.jsonl'),'utf8');await runPlan({manifest:m,dataset:tiny,outDir:dir,transport,sleep:async()=>{}});assert.equal(calls,before);assert.equal(readFileSync(join(dir,'attempts.jsonl'),'utf8'),journal);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('outstanding dispatch refuses automatic rebilling',async()=>{
  const dir=temp(),m=manifest(),e=m.entries[0],r=e.requests[0];let calls=0;try{save(join(dir,'manifest.json'),m);append(join(dir,'attempts.jsonl'),{kind:'attempt-start',experimentId:m.id,attemptId:hash(`${m.id}|${r.requestId}|1`),requestId:r.requestId,bodyHash:r.bodyHash,slot:e.slot,model:e.model,question:r.question,attempt:1,dispatchAt:1});
    await assert.rejects(runPlan({manifest:m,dataset:tiny,outDir:dir,transport:{async send(){calls++;}}}),/Ambiguous in-flight/);assert.equal(calls,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('concurrency is measured in requests; final failed retry adds no backoff',async()=>{
  const dir=temp(),m=manifest({...tiny,families:[tiny.families[0]]},{...smallPlan,models:[{id:'fixture/model',settings:['common'],tracks:['A']}]}),max=2;let active=0,peak=0,waits=0,calls=0;try{
    const transport={name:'offline-concurrency',async send(){active++;peak=Math.max(peak,active);calls++;await sleep(2);active--;return {ok:false,status:503,usage:{cost:0,input_tokens:0,output_tokens:0}};}};
    await runPlan({manifest:m,dataset:{...tiny,families:[tiny.families[0]]},outDir:dir,transport,requestConcurrency:max,maxAttempts:3,sleep:async()=>{waits++;}});assert.equal(peak,max);assert.equal(calls,m.expectedRequests*3);assert.equal(waits,m.expectedRequests*2);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('served identity drift stops further dispatch and is retained for quarantine',async()=>{
  const dir=temp(),m=manifest();let calls=0;try{const transport={name:'offline-drift',async send(body){calls++;return {...await goodTransport.send(body),servedModel:calls===1?'v1':'v2'};}};
    const result=await runPlan({manifest:m,dataset:tiny,outDir:dir,transport,requestConcurrency:1});assert.ok(result.stopReason.includes('identity'));assert.ok(calls<m.expectedRequests);assert.deepEqual(result.usage.byModel['fixture/model'].servedModels,['v1','v2']);
    await assert.rejects(runPlan({manifest:m,dataset:tiny,outDir:dir,transport}),/quarantine/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('paired comparison requires explicit split; cost forecast refuses unmeasured data',()=>{
  assert.throws(()=>pairedCompare([],{a:'a',b:'b',track:'B1'}),/explicit Core or Challenge/);
  const p=projectFullCost([],manifest(tiny,plan),tiny);assert.equal(p.projectedUsd,null);assert.ok(p.rows.every(r=>r.projectedUsd===null));
});
test('default CLI is a no-network refusal while execution is paused',()=>{
  const result=spawnSync(process.execPath,[join(root,'harness/run.mjs')],{encoding:'utf8'});assert.notEqual(result.status,0);assert.ok(result.stderr.includes('Inference is paused'));
});

test('preflight is frozen, separately scored for format and included in combined usage',async()=>{
  const {buildPreflight,runPreflight,loadPreflightReceipt}=await import('../harness/preflight.mjs');
  const m=manifest(tiny,plan),pf=buildPreflight(m,plan,tiny);assert.equal(pf.requests.length,36);
  const dir=temp();let calls=0;try{
    const transport={name:'offline-preflight',async send(body){calls++;return {ok:true,status:200,answers:Object.fromEntries(Object.entries(body.questions).map(([label,q])=>[label,q.type==='noul'?{noul:0.1}:{choice:Object.keys(q.criteria)[0],probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,1/Object.keys(q.criteria).length]))}])),usage:{cost:0.001,input_tokens:40,output_tokens:0},servedModel:`${body.model}-fixture`};}};
    const first=await runPreflight({preflight:pf,outDir:dir,transport});assert.equal(first.receipt.verifiedModels.length,13);assert.equal(first.receipt.usage.completedAttempts,36);
    await runPreflight({preflight:pf,outDir:dir,transport});assert.equal(calls,36);assert.equal(loadPreflightReceipt(join(dir,'preflight-receipt.json'),pf).verifiedModels.length,13);
    const result=await runPlan({manifest:manifest(),dataset:tiny,outDir:join(dir,'sample'),transport:goodTransport,priorPhaseEvents:first.events});assert.equal(result.usage.completedAttempts,36+manifest().expectedRequests);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing usage or preflight shape cannot silently pass compatibility or forecast',async()=>{
  const {buildPreflight,runPreflight}=await import('../harness/preflight.mjs');
  const m=manifest(),pf=buildPreflight(m,smallPlan,tiny),dir=temp();try{
    const result=await runPreflight({preflight:pf,outDir:dir,transport:{name:'offline-bad-format',async send(){return {ok:true,status:200,answers:{P:{noul:0.9}},usage:null};}}});
    assert.equal(result.receipt.verifiedModels.length,0);assert.equal(result.receipt.usage.accountingComplete,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('a provider error cannot leak the configured credential into the journal result',async()=>{
  const transport=createLiveTransport({apiKey:'secret-fixture-key',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'echo secret-fixture-key'}}),{status:400})});
  assert.ok(!JSON.stringify(await transport.send({model:'fixture'})).includes('secret-fixture-key'));
});
