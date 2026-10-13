import {readFileSync} from 'node:fs';
export const ENDPOINT='https://openrouter.ai/api/alpha/decisions';
export function loadApiKey(envFile) {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (!envFile) throw new Error('No API credential configured');
  const match=readFileSync(envFile,'utf8').match(/^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.+)\s*$/m);
  if (!match) throw new Error('No API credential configured');
  return match[1].trim().replace(/^(['"])(.*)\1$/,'$2');
}
// No spending guard. Every response keeps usage and served identity, including HTTP errors.
export function createLiveTransport({apiKey,timeoutMs=90000,modelTimeouts={},fetchImpl=fetch}) {
  return {name:'openrouter-decisions', async send(body) {
    const t0=performance.now();let status=0,raw=null,responseText=null,error=null,retryAfterMs=null;
    try {
      const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','X-Title':'turkce-karar-v07-full'},body:JSON.stringify(body),signal:AbortSignal.timeout(modelTimeouts[body.model]?.timeoutMs??timeoutMs)});
      status=response.status;
      const ra=response.headers?.get('retry-after');
      if (ra) {const seconds=Number(ra);retryAfterMs=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(ra)-Date.now());}
      const txt=await response.text();try {raw=JSON.parse(txt);} catch {responseText=txt.slice(0,2000);}
      if (!response.ok) error=raw?.error?.message??`HTTP ${status}`;
    } catch(e) {error=['TimeoutError','AbortError'].includes(e?.name)?'timeout':String(e?.message??e);}
    const ok=status>=200&&status<300&&!!raw?.answers&&typeof raw.answers==='object'&&!Array.isArray(raw.answers);
    const outcome={ok,status,latencyMs:Math.round(performance.now()-t0),answers:ok?raw.answers:null,usage:raw?.usage??null,servedModel:raw?.model??null,provider:raw?.provider??null,generationId:raw?.id??null,error:ok?null:error??'no_answers',retryAfterMs,raw,responseText};
    // A provider error body can echo request data. Strip the known credential before journaling.
    return apiKey?JSON.parse(JSON.stringify(outcome).split(apiKey).join('[redacted]')):outcome;
  }};
}
