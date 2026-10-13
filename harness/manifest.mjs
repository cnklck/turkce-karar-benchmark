import {hash,canonical} from './io.mjs';
import {buildRequests,expectedQuestions} from './inputs.mjs';
export const SLOT_FIELDS=['model','setting','track','caseId','variant','split'];
export const slotKey=e=>SLOT_FIELDS.map(k=>e[k]).join('|');
export function buildManifest(dataset,plan,{datasetHash,implementationHash}) {
  if (!datasetHash || !implementationHash) throw new Error('Full dataset and implementation hashes required');
  if (plan.priceCapUsd!==null) throw new Error('This experiment must have no monetary cap');
  if (plan.models.length!==new Set(plan.models.map(m=>m.id)).size) throw new Error('Duplicate model IDs');
  const entries=[];
  for (const m of plan.models) for (const setting of m.settings) for (const track of m.tracks) {
    if (!['common','native'].includes(setting) || !['A','B1','B2'].includes(track)) throw new Error('Invalid setting/track');
    if (setting==='native' && track!=='A') continue;
    for (const f of dataset.families) {
      if (!plan.splits.includes(f.split) || track==='B2'&&!f.entity) continue;
      for (const c of f.cases) for (const variant of plan.variants) {
        const e={model:m.id,setting,track,caseId:c.id,variant,split:f.split,family:f.id,capability:f.capability,stateFormat:m.stateFormat??'object',questions:expectedQuestions(track,setting)};
        e.requests=buildRequests(e,f,c,dataset).map(r=>({...r,bodyHash:hash(canonical(r.body))}));
        e.slot=slotKey(e); entries.push(e);
      }
    }
  }
  const contents={schema:1,datasetHash,implementationHash,planHash:hash(canonical(plan)),entries};
  const id=hash(canonical(contents));
  for (const e of entries) for (const r of e.requests) r.requestId=hash(`${id}|${e.slot}|${r.question}|${r.bodyHash}`);
  return {id,...contents,expectedDecisions:entries.length,expectedRequests:entries.reduce((s,e)=>s+e.requests.length,0)};
}
export function validateManifest(manifest,dataset,datasetHash) {
  if (manifest.datasetHash!==datasetHash) throw new Error('Manifest dataset hash mismatch');
  const rebuilt=manifest.entries.map(e=>({...e,requests:e.requests.map(({requestId,...r})=>r)}));
  const contents={schema:manifest.schema,datasetHash:manifest.datasetHash,implementationHash:manifest.implementationHash,planHash:manifest.planHash,entries:rebuilt};
  if (hash(canonical(contents))!==manifest.id) throw new Error('Manifest identity mismatch');
  const refs=new Map(dataset.families.flatMap(f=>f.cases.map(c=>[c.id,{f,c}])));
  const slots=new Set();
  for (const e of manifest.entries) {
    const ref=refs.get(e.caseId);
    if (!ref || ref.f.split!==e.split || e.slot!==slotKey(e) || slots.has(e.slot)) throw new Error('Invalid manifest slot');
    slots.add(e.slot);
    const expected=buildRequests(e,ref.f,ref.c,dataset);
    if (canonical(e.questions)!==canonical(expectedQuestions(e.track,e.setting)) || expected.length!==e.requests.length) throw new Error('Manifest component mismatch');
    e.requests.forEach((r,i)=>{
      if (r.bodyHash!==hash(canonical(r.body)) || canonical(r.body)!==canonical(expected[i].body) || r.question!==expected[i].question || r.requestId!==hash(`${manifest.id}|${e.slot}|${r.question}|${r.bodyHash}`)) throw new Error('Manifest request mismatch');
    });
  }
  if (manifest.expectedDecisions!==slots.size || manifest.expectedRequests!==manifest.entries.reduce((s,e)=>s+e.requests.length,0)) throw new Error('Manifest counts mismatch');
  return true;
}
