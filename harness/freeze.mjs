import {readFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,canonical,json,save} from './io.mjs';
import {buildManifest,validateManifest} from './manifest.mjs';
import {buildPreflight} from './preflight.mjs';
export const IMPLEMENTATION_FILES=['harness/io.mjs','harness/inputs.mjs','harness/manifest.mjs','harness/live-transport.mjs','harness/usage.mjs','harness/run.mjs','harness/freeze.mjs','harness/paired.mjs','harness/preflight.mjs','scoring/score.mjs'];
export function implementation(root) {const files=Object.fromEntries(IMPLEMENTATION_FILES.map(f=>[f,hash(readFileSync(join(root,f)))]));return {files,hash:hash(canonical(files))};}
export function freeze(root) {
  const out=join(root,'frozen');if(existsSync(out))throw new Error('Frozen bundle exists; verify it, do not overwrite it');
  const dataset=json(join(root,'data/sample.json')),plan=json(join(root,'plan.json')),impl=implementation(root),datasetHash=hash(readFileSync(join(root,'data/sample.json')));
  const manifest=buildManifest(dataset,plan,{datasetHash,implementationHash:impl.hash});validateManifest(manifest,dataset,datasetHash);
  mkdirSync(out);
  for(const [src,dst] of [['data/sample.json','sample.json'],['plan.json','plan.json'],['model-registry.json','model-registry.json'],['data/changes.json','changes.json']])copyFileSync(join(root,src),join(out,dst));
  save(join(out,'manifest.json'),manifest);
  save(join(out,'preflight.json'),buildPreflight(manifest,plan,dataset));
  const files=Object.fromEntries(['sample.json','plan.json','model-registry.json','changes.json','manifest.json','preflight.json'].map(f=>[f,hash(readFileSync(join(out,f)))]));
  save(join(out,'FREEZE.json'),{schema:1,createdAt:new Date().toISOString(),experimentId:manifest.id,datasetHash,implementationHash:impl.hash,files,implementationFiles:impl.files,approval:{inference:false},priceCapUsd:null});
  return {id:manifest.id,decisions:manifest.expectedDecisions,requests:manifest.expectedRequests};
}
export function loadBundle(folder) {
  const receipt=json(join(folder,'FREEZE.json')),root=resolve(folder,'..');
  for(const [f,sha] of Object.entries(receipt.files))if(hash(readFileSync(join(folder,f)))!==sha)throw new Error(`Frozen file changed: ${f}`);
  const impl=implementation(root);if(impl.hash!==receipt.implementationHash||canonical(impl.files)!==canonical(receipt.implementationFiles))throw new Error('Frozen implementation changed');
  const dataset=json(join(folder,'sample.json')),manifest=json(join(folder,'manifest.json')),plan=json(join(folder,'plan.json'));
  validateManifest(manifest,dataset,hash(readFileSync(join(folder,'sample.json'))));
  if(receipt.experimentId!==manifest.id||manifest.implementationHash!==impl.hash||manifest.planHash!==hash(canonical(plan)))throw new Error('Frozen binding mismatch');
  return {dataset,manifest,plan,receipt};
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  console.log(JSON.stringify(process.argv.includes('--verify')?{verified:true,experimentId:loadBundle(join(root,'frozen')).manifest.id}:freeze(root)));
}
