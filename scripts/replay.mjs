import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {archive,root} from './archive.mjs';
import {scoreAll} from '../scoring/score.mjs';
const {cases,manifest,records,analysis}=archive();
const scored=scoreAll(records,cases,manifest,{datasetHash:manifest.datasetHash});
assert.equal(scored.integrity.status,'complete');
for(const [key,s]of Object.entries(scored.summary)){
  const original=analysis.summary[key];assert.ok(original,key);
  for(const field of ['expected','completed','accuracyEndToEnd','accuracyCompleted','incoherent','unsupportedInference'])assert.deepEqual(s[field],original[field],`${key}: ${field}`);
  assert.deepEqual(s.familyBootstrap95,original.familyBootstrap95,`${key}: güven aralığı`);
  assert.deepEqual(s.confusion,original.confusion,`${key}: hata tablosu`);
}
mkdirSync(join(root,'out'),{recursive:true});
writeFileSync(join(root,'out/replayed-summary.json'),JSON.stringify({integrity:scored.integrity,summary:scored.summary},null,2)+'\n');
console.log(JSON.stringify({status:'passed',decisions:records.length,groups:Object.keys(scored.summary).length,confidenceIntervals:'same as recorded run',output:'out/replayed-summary.json',networkCalls:0},null,2));
