// Journal is the accounting source. No cost floor, token guess or missing-as-zero conversion.
const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
export function usageOf(outcome) {
  const u=outcome.usage??{};
  return {cost:valid(u.cost)?u.cost:null,inputTokens:valid(u.input_tokens)?u.input_tokens:null,outputTokens:valid(u.output_tokens)?u.output_tokens:null,rawUsage:outcome.usage??null};
}
export function summarizeUsage(events) {
  const starts=events.filter(e=>e.kind==='attempt-start'), ends=events.filter(e=>e.kind==='attempt-result');
  const ended=new Set(ends.map(e=>e.attemptId));
  const unresolved=starts.filter(e=>!ended.has(e.attemptId));
  const byModel={};
  for (const e of ends) {
    const row=byModel[e.model]??={requests:0,failed:0,retries:0,providerReportedUsd:0,costReported:0,costMissing:0,inputTokens:0,outputTokens:0,inputMissing:0,outputMissing:0,servedModels:[],providers:[]};
    const u=usageOf(e.result);row.requests++;row.failed+=!e.result.ok;row.retries+=e.attempt>1;
    if (u.cost!==null){row.providerReportedUsd+=u.cost;row.costReported++;}else row.costMissing++;
    for (const [field,missing] of [['inputTokens','inputMissing'],['outputTokens','outputMissing']]) if (u[field]!==null) row[field]+=u[field];else row[missing]++;
    if(e.result.servedModel&&!row.servedModels.includes(e.result.servedModel))row.servedModels.push(e.result.servedModel);
    if(e.result.provider&&!row.providers.includes(e.result.provider))row.providers.push(e.result.provider);
  }
  return {priceCapUsd:null,dispatchAttempts:starts.length,completedAttempts:ends.length,unresolvedAttempts:unresolved.map(e=>e.attemptId),reportedUsd:ends.reduce((s,e)=>s+(usageOf(e.result).cost??0),0),costMissing:ends.filter(e=>usageOf(e.result).cost===null).length,accountingComplete:!unresolved.length&&ends.every(e=>usageOf(e.result).cost!==null),basis:'Provider-reported cost only; an explicit zero is valid. Missing cost remains unknown. All phases, errors and retries included.',byModel};
}
export function projectFullCost(events,manifest,dataset,splits=['core','challenge']) {
  const sampleEntries=manifest.entries, ends=events.filter(e=>e.kind==='attempt-result'), bySlot=new Map();
  for (const e of ends) (bySlot.get(e.slot)??bySlot.set(e.slot,[]).get(e.slot)).push(e);
  const rows=[],groups=new Map();
  for(const e of sampleEntries) if(splits.includes(e.split)) {
    const k=[e.model,e.setting,e.track,e.variant,e.split,e.capability].join('|');
    (groups.get(k)??groups.set(k,[]).get(k)).push(e);
  }
  for(const [group,es] of groups) {
    const first=es[0],target=dataset.projectionPopulation.splitCapability[first.split][first.capability][first.track==='B2'?'entityCases':'cases'];
    const attempts=es.flatMap(e=>bySlot.get(e.slot)??[]), missing=attempts.filter(e=>usageOf(e.result).cost===null).length;
    const covered=es.every(e=>e.requests.every(r=>attempts.some(a=>a.requestId===r.requestId&&a.terminal)));
    const reported=attempts.reduce((s,e)=>s+(usageOf(e.result).cost??0),0);
    const complete=covered&&!missing&&attempts.length>0;
    rows.push({group,sampleDecisions:es.length,targetDecisions:target,observedAttempts:attempts.length,costMissing:missing,covered,reportedUsd:reported,projectedUsd:complete?reported/es.length*target:null});
  }
  const absent=[], configurations=new Map(sampleEntries.map(e=>[[e.model,e.setting,e.track,e.variant].join('|'),e]));
  for(const e of configurations.values())for(const split of splits)for(const [cap,pop] of Object.entries(dataset.projectionPopulation.splitCapability[split])) {
    const target=e.track==='B2'?pop.entityCases:pop.cases;
    if(target>0&&!rows.some(r=>r.group===[e.model,e.setting,e.track,e.variant,split,cap].join('|')))absent.push({model:e.model,setting:e.setting,split,capability:cap,track:e.track,targetDecisions:target});
  }
  return {splits,rows,unsampledStrata:absent,projectedUsd:rows.length&&rows.every(r=>r.projectedUsd!==null)&&!absent.length?rows.reduce((s,r)=>s+r.projectedUsd,0):null,knownProjectionSubtotalUsd:rows.reduce((s,r)=>s+(r.projectedUsd??0),0),allPhaseUsage:summarizeUsage(events),note:'Forecast after actual usage, weighted by split/capability/track. Retries included. Smoke spend is included in allPhaseUsage, not multiplied as test workload. No forecast for unsampled strata or unreported costs. Routing/prices/retry rates can change; accuracy is not extrapolated.'};
}
