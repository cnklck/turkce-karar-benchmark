import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync}from'node:fs';
import {join}from'node:path';
import {tmpdir}from'node:os';
import {spawnSync}from'node:child_process';
import {fileURLToPath}from'node:url';
import {loadBundle}from'../harness/freeze.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('hazırlama komutu yeni klasörde bağlı ve ücret göndermeyen küçük bir deney oluşturur',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'turkce-karar-cli-')),folder=join(tmp,'deney');
 try{
  const r=spawnSync(process.execPath,['scripts/new-run.mjs','--models','~typesafe/jev-latest','--split','core','--families','2','--out',folder],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const output=JSON.parse(r.stdout);assert.equal(output.networkCalls,0);
  const b=loadBundle(join(folder,'frozen'));assert.equal(b.dataset.families.length,2);assert.equal(b.manifest.expectedDecisions,6);assert.equal(b.manifest.expectedRequests,6);
  assert.equal(JSON.parse(readFileSync(join(folder,'authorization.json'))).inference,false);
  const refusal=spawnSync(process.execPath,['scripts/execute.mjs','--run',folder],{cwd:root,encoding:'utf8'});
  assert.notEqual(refusal.status,0);assert.match(refusal.stderr,/--execute/);assert.equal(existsSync(join(folder,'run')),false);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
test('model desteklemediği soru biçimine sessizce geçirilmez',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'turkce-karar-capability-')),folder=join(tmp,'deney');
 try{const r=spawnSync(process.execPath,['scripts/new-run.mjs','--models','respan/span-01','--tracks','B1','--families','2','--out',folder],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/desteklemiyor/);assert.equal(existsSync(folder),false);}finally{rmSync(tmp,{recursive:true,force:true});}
});
