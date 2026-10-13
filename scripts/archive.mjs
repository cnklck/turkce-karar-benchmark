import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
export const root=fileURLToPath(new URL('..',import.meta.url));
export const bytes=rel=>rel.endsWith('.gz')?gunzipSync(readFileSync(join(root,rel))):readFileSync(join(root,rel));
export const read=rel=>JSON.parse(bytes(rel));
export const lines=rel=>bytes(rel).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
export function archive(){
  const dataset=read('data/sample.json');
  const cases=new Map(dataset.families.flatMap(f=>f.cases.map(c=>[c.id,{f,c}])));
  return {dataset,cases,manifest:read('results/hosted/manifest.json.gz'),records:lines('results/hosted/records.jsonl.gz'),analysis:read('results/hosted/analysis.json')};
}
