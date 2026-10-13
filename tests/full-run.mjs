import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {json,canonical,hash} from '../harness/io.mjs';
import {buildManifest} from '../harness/manifest.mjs';
import {runPlan,retryable,indexJournal,deriveRecord} from '../harness/run.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bank=json(join(root,'data/sample.json'));
const small={...bank,families:[bank.families.find(f=>f.id==='D001')]};
const make=(models)=>buildManifest(small,{priceCapUsd:null,splits:['dev'],variants:['base'],models:models.map(id=>({id,settings:['common'],tracks:['A']}))},{datasetHash:hash(canonical(small)),implementationHash:'fixture'});
const good=()=>({ok:true,status:200,answers:{P:{noul:0.1},notP:{noul:0.9}},usage:{cost:0,input_tokens:10,output_tokens:0},servedModel:'fixture-v1'});
test('model queues obey both provider and global concurrency, with durable periodic progress',async()=>{
  const out=mkdtempSync(join(tmpdir(),'turkce-karar-queues-'));const m=make(['slow','fast']);let total=0,peak=0;const active={slow:0,fast:0},modelPeak={slow:0,fast:0};let sawRunning=false;
  try {
    const transport={name:'fixture',async send(body){total++;active[body.model]++;peak=Math.max(peak,total);modelPeak[body.model]=Math.max(modelPeak[body.model],active[body.model]);await new Promise(r=>setTimeout(r,body.model==='slow'?15:3));sawRunning ||= json(join(out,'run-status.json')).status==='running';total--;active[body.model]--;return good();}};
    const result=await runPlan({manifest:m,dataset:small,outDir:out,transport,requestConcurrency:3,modelPolicies:{slow:{concurrency:1},fast:{concurrency:2}},checkpointMs:5});
    assert.ok(sawRunning);assert.equal(peak,3);assert.equal(modelPeak.slow,1);assert.equal(modelPeak.fast,2);assert.equal(result.records.length,m.expectedDecisions);assert.equal(json(join(out,'run-status.json')).terminalRequests,m.expectedRequests);
    const idx=indexJournal(result.events);assert.equal(deriveRecord(m.entries[0],idx,m.id).requests.length,2);
    const before=readFileSync(join(out,'attempts.jsonl'),'utf8');let resent=0;
    await runPlan({manifest:m,dataset:small,outDir:out,transport:{async send(){resent++;return good();}}});assert.equal(resent,0);assert.equal(readFileSync(join(out,'attempts.jsonl'),'utf8'),before);
  }finally{rmSync(out,{recursive:true,force:true});}
});
test('explicit provider refusals terminate without repeated paid attempts',async()=>{
  assert.equal(retryable({status:502,error:'OpenAI refused to answer question notP'}),false);
  assert.equal(retryable({status:502,error:'upstream temporary failure'}),true);
  const out=mkdtempSync(join(tmpdir(),'turkce-karar-refusal-'));let calls=0;const m=make(['fixture']);
  try{const result=await runPlan({manifest:m,dataset:small,outDir:out,transport:{name:'fixture',async send(){calls++;return {ok:false,status:502,error:'OpenAI refused to answer question notP',usage:null};}},sleep:async()=>{}});assert.equal(calls,m.expectedRequests);assert.ok(result.records.every(r=>r.error));}
  finally{rmSync(out,{recursive:true,force:true});}
});
test('all pre-run findings are resolved in traceable edits and 91 request mappings are applied',()=>{
  const changes=json(join(root,'data/changes.json')),resolutions=json(join(root,'audit/bank/resolutions.json'));
  assert.equal(changes.keysChanged,0);assert.equal(changes.familyIds.length,138);assert.equal(resolutions.length,43);
  assert.equal(changes.changes.filter(c=>c.field==='question'&&c.reason.startsWith('T1 wording')).length,91);
  const fs=new Map(bank.families.map(f=>[f.id,f]));
  for(const id of ['C037','X062','X070','X090'])assert.ok(fs.get(id).rule.includes('yüzde 10'));
  assert.ok(fs.get('D022').rule.includes('aynı takvim haftasındadır'));
  assert.ok(fs.get('X470').rule.includes('hakları birleştirilebilir'));
  assert.ok(fs.get('X489').question.includes('kargo görevlisi'));
  for(const f of bank.families)for(const c of f.cases)for(const t of c.factTrace){assert.deepEqual(t.value,c.facts[t.slot]);assert.ok(t.evidence.every(s=>s.startsWith('@')||c.message.includes(s)));}
});
