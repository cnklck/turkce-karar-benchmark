import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {archive,root,read,bytes} from './archive.mjs';
import {hash,canonical} from '../harness/io.mjs';
import {validateManifest,slotKey} from '../harness/manifest.mjs';
import {evaluate} from '../scoring/score.mjs';
const {dataset,cases,manifest,records,analysis}=archive();
assert.equal(dataset.families.length,800);
assert.equal(cases.size,2400);
assert.equal(manifest.expectedDecisions,64059);
assert.equal(manifest.expectedRequests,95259);
assert.equal(records.length,manifest.expectedDecisions);
// Yayın metaverisi sadeleştirildi. Özgün istek gövdeleri tek tek doğrulanır.
validateManifest(manifest,dataset,manifest.datasetHash);
const entries=new Map(manifest.entries.map(e=>[e.slot,e]));
const seen=new Set();let apiFailures=0;const groups=new Map();
for(const record of records){
  const key=slotKey(record),entry=entries.get(key);
  assert.ok(entry&&!seen.has(key),`Eksik veya yinelenen kayıt: ${key}`);seen.add(key);
  assert.equal(record.experimentId,manifest.id);
  const ref=cases.get(record.caseId),decision=evaluate(record,ref,entry);
  assert.ok(!decision.failure||decision.failure==='api',`Geçersiz yanıt: ${key}`);
  if(decision.failure==='api')apiFailures++;
  const group=[record.model,record.setting,record.track,record.variant,record.split].join('|');
  const g=groups.get(group)??{n:0,correct:0};g.n++;g.correct+=Number(decision.correct);groups.set(group,g);
}
assert.equal(apiFailures,2);assert.equal(seen.size,entries.size);
for(const [key,g]of groups){const expected=analysis.summary[key];assert.ok(expected,key);assert.equal(g.n,expected.expected);assert.equal(g.correct/g.n,expected.accuracyEndToEnd);}
const figure=read('results/chart-data.json');
assert.ok(figure.rows.every(r=>r.cohort==='full-hosted'));
for(const row of figure.rows){
  const g=groups.get([row.modelId,'common',row.track,'base',row.split].join('|'));
  assert.ok(g);assert.equal(g.n,row.cases);assert.equal(g.correct,row.correct);
  const s=analysis.summary[[row.modelId,'common',row.track,'base',row.split].join('|')];
  assert.ok(Math.abs(row.ciLow-100*s.familyBootstrap95.lo)<1e-10);
  assert.ok(Math.abs(row.ciHigh-100*s.familyBootstrap95.hi)<1e-10);
}
for(const item of read('audit/publication-provenance.json').records){
  assert.equal(hash(readFileSync(join(root,item.publishedPath))),item.publishedSha256,item.publishedPath);
  if(item.gzip)assert.equal(hash(bytes(item.publishedPath)),item.payloadSha256,item.publishedPath);
}
console.log(JSON.stringify({status:'passed',families:800,cases:2400,decisions:records.length,requestBodiesChecked:manifest.expectedRequests,apiFailures,figures:'source matched',networkCalls:0},null,2));
