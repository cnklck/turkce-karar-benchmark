import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync,existsSync} from 'node:fs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value && typeof value==='object' ? Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,JSON.parse(canonical(value[k]))])) : value);
export const json = path => JSON.parse(readFileSync(path,'utf8'));
export const jsonl = path => existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).map((line,index)=>{try{return JSON.parse(line)}catch{throw new Error(`Invalid journal line ${index+1}: ${path}; reconcile the file before resuming`)}}):[];
export const save = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n');
export function append(path,value) {
  const fd=openSync(path,'a');try {writeSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);} finally {closeSync(fd);}
}
