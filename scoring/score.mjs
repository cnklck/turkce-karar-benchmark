// Tarihsel çalışmanın puanlayıcısı. Yöntem: docs/YONTEM.md. Pure functions + a small CLI:
//   node score.mjs <outputs.jsonl> --manifest <manifest.json> [--prices <prices.json>] [--json out.json] [--allow-incomplete]
//
// Changes from v0.3 (both were verified gaps):
//  1. An expected run manifest is required. Denominators come from the manifest. Missing slots are scored as
//     failures, duplicates are counted once (earliest dispatch kept), and unknown case ids, unexpected slots and
//     malformed records are surfaced in `integrity`. None of them can silently change a denominator.
//  2. Cost is never assumed to be zero. A missing or invalid provider cost is "unavailable". Provider-reported
//     costs and price-table estimates are kept apart, and accounting coverage is reported.
import { readFileSync, writeFileSync } from 'node:fs'
import { slotKey, SLOT_FIELDS } from '../harness/manifest.mjs'
import { hash } from '../harness/io.mjs'
import { loadBundle } from '../harness/freeze.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

export const TAU = 0.5            // Track A: yes iff p >= TAU (tie -> yes)
export const EPS = 1e-6           // log-loss clipping only
export const FLOAT_TOL = 1e-9     // range noise tolerated (clamped + logged)
export const ROUND_TOL_PER_OPTION = 0.005 // sum tolerance = 0.005 * K
export const CONFIDENT = 0.9

export function loadFamilies(path) {
  if (!path) throw new Error('Explicit frozen dataset path required')
  const bytes = readFileSync(path)
  const fam = JSON.parse(bytes.toString('utf8'))
  const cases = new Map()
  for (const f of fam.families) for (const c of f.cases) cases.set(c.id, { f, c })
  return { fam, cases, datasetHash: hash(bytes) }
}

// ---------------- probability validation (unchanged from v0.3) ----------------
export function validateBinary(x) {
  if (x === undefined || x === null) return { ok: false, failure: 'format', issue: 'missing_component' }
  if (typeof x !== 'number' || !Number.isFinite(x)) return { ok: false, failure: 'probability', issue: 'not_finite_number', raw: x }
  if (x < -FLOAT_TOL) return { ok: false, failure: 'probability', issue: 'negative', raw: x }
  if (x > 1 + FLOAT_TOL) return { ok: false, failure: 'probability', issue: 'above_one', raw: x }
  const p = Math.min(1, Math.max(0, x))
  return { ok: true, p, adjusted: p !== x, raw: x }
}

export function validateOptions(ans, optionKeys) {
  if (!ans || typeof ans !== 'object') return { ok: false, failure: 'format', issue: 'missing_answer' }
  const probs = ans.probabilities
  if (!probs || typeof probs !== 'object') return { ok: false, failure: 'probability', issue: 'missing_probabilities' }
  for (const k of Object.keys(probs)) if (!optionKeys.includes(k)) return { ok: false, failure: 'probability', issue: `unknown_option:${k}` }
  const raw = {}
  for (const k of optionKeys) {
    const v = probs[k]
    if (v === undefined) return { ok: false, failure: 'probability', issue: `missing_option:${k}` }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, failure: 'probability', issue: `not_finite:${k}` }
    if (v < -FLOAT_TOL) return { ok: false, failure: 'probability', issue: `negative:${k}` }
    if (v > 1 + FLOAT_TOL) return { ok: false, failure: 'probability', issue: `above_one:${k}` }
    raw[k] = Math.min(1, Math.max(0, v))
  }
  const S = optionKeys.reduce((s, k) => s + raw[k], 0)
  const tol = ROUND_TOL_PER_OPTION * optionKeys.length
  if (Math.abs(S - 1) > tol) return { ok: false, failure: 'probability', issue: `sum_out_of_range:${S.toFixed(4)}` }
  if (S <= 0) return { ok: false, failure: 'probability', issue: 'zero_sum' }
  const p = Object.fromEntries(optionKeys.map((k) => [k, raw[k] / S]))
  const max = Math.max(...optionKeys.map((k) => p[k]))
  const argmax = optionKeys.filter((k) => p[k] === max)
  let hard, anomaly = false
  if (ans.choice !== undefined && ans.choice !== null) {
    if (!optionKeys.includes(ans.choice)) return { ok: false, failure: 'format', issue: `invalid_choice:${ans.choice}` }
    hard = ans.choice
    anomaly = !(argmax.length === 1 && argmax[0] === hard)
  } else {
    if (argmax.length !== 1) return { ok: false, failure: 'format', issue: 'ambiguous_hard_decision' }
    hard = argmax[0]
  }
  return { ok: true, p, hard, anomaly, normalized: Math.abs(S - 1) > 1e-12, sumRaw: S }
}

// ---------------- cost accounting (fix 2) ----------------
/**
 * One request's cost. Provider-reported cost (`cost`, from usage.cost) is used when it is a finite number >= 0;
 * an explicit 0 is a valid provider-reported zero. Otherwise the provider cost is unavailable, with a reason.
 * A price-table estimate is computed only when the provider cost is unavailable and token counts exist; it is
 * reported separately and never mixed into the provider-reported total.
 */
export function requestCost(r, model, prices) {
  const v = r.cost
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { source: 'provider', usd: v }
  const reason = v === undefined || v === null ? (r.ok === false ? 'failed_request_no_usage' : 'missing') : 'invalid'
  const price = prices?.[model]
  const tin = r.inputTokens, tout = r.outputTokens
  if (price && Number.isFinite(price.inputPerToken) && price.inputPerToken >= 0 && Number.isFinite(price.outputPerToken) && price.outputPerToken >= 0 && Number.isFinite(tin) && tin >= 0 && Number.isFinite(tout) && tout >= 0) {
    return { source: 'estimate', usd: tin * price.inputPerToken + tout * price.outputPerToken, reason, priceSource: price.source ?? null }
  }
  return { source: 'unavailable', usd: null, reason, raw: v === undefined ? undefined : v }
}

const emptyCost = () => ({ requests: 0, provider: { n: 0, usd: 0 }, estimate: { n: 0, usd: 0, providerReasons: {} }, unavailable: { n: 0, byReason: {}, raw: [] } })
function addCost(acc, rc) {
  acc.requests++
  if (rc.source === 'provider') { acc.provider.n++; acc.provider.usd += rc.usd }
  else if (rc.source === 'estimate') { acc.estimate.n++; acc.estimate.usd += rc.usd; acc.estimate.providerReasons[rc.reason] = (acc.estimate.providerReasons[rc.reason] ?? 0) + 1 }
  else { acc.unavailable.n++; acc.unavailable.byReason[rc.reason] = (acc.unavailable.byReason[rc.reason] ?? 0) + 1; if (rc.reason === 'invalid') acc.unavailable.raw.push(rc.raw) }
  return acc
}
function mergeCost(a, b) {
  a.requests += b.requests; a.provider.n += b.provider.n; a.provider.usd += b.provider.usd; a.estimate.n += b.estimate.n; a.estimate.usd += b.estimate.usd
  for (const [k, v] of Object.entries(b.estimate.providerReasons)) a.estimate.providerReasons[k] = (a.estimate.providerReasons[k] ?? 0) + v
  a.unavailable.n += b.unavailable.n; for (const [k, v] of Object.entries(b.unavailable.byReason)) a.unavailable.byReason[k] = (a.unavailable.byReason[k] ?? 0) + v
  a.unavailable.raw.push(...b.unavailable.raw)
  return a
}
export function recordCost(rec, prices) {
  const acc = emptyCost()
  for (const r of Array.isArray(rec.requests) ? rec.requests : []) addCost(acc, requestCost(r, rec.model, prices))
  return acc
}

// ---------------- per-decision evaluation ----------------
const clip = (p) => Math.min(1 - EPS, Math.max(EPS, p))
const binMetrics = (p, y) => ({ brier: (p - (y ? 1 : 0)) ** 2, logloss: -(y ? Math.log(clip(p)) : Math.log(1 - clip(p))), zeroOnGold: (y && p === 0) || (!y && p === 1) })

export function evaluate(rec, ref, entry, prices) {
  const { f, c } = ref
  const base = { model: entry.model, setting: entry.setting, track: entry.track, variant: entry.variant, split: entry.split, caseId: c.id, family: f.id, taskType: f.taskType, capability: f.capability, difficulty: c.difficultyProposed, role: c.role, of: c.of ?? null }
  const reqs = Array.isArray(rec.requests) ? rec.requests : []
  const ops = {
    hasRecord: true,
    latencyMs: Number.isFinite(rec.completedAt - rec.dispatchedAt) ? rec.completedAt - rec.dispatchedAt : null,
    cost: recordCost(rec, prices),
    requests: reqs.length, retries: reqs.filter((r) => (r.attempt ?? 1) > 1).length,
  }
  // Question coverage: every expected question label must have been sent at least once. A question that was sent
  // and failed is an API failure of the decision (scored); one that was never sent is a harness gap (integrity).
  const sentLabels = new Set(reqs.map((r) => r.question))
  const missingQuestions = entry.questions.filter((q) => !sentLabels.has(q))
  const apiFailed = entry.questions.some(q => sentLabels.has(q) && !reqs.some(r => r.question === q && r.ok)) || (rec.error && !rec.answers)
  if (entry.track === 'A') {
    const gold = c.key, yP = gold === 'EVET', yN = gold === 'HAYIR'
    const out = { ...base, gold, ops, missingQuestions, components: {} }
    if (missingQuestions.length) return { ...out, failure: 'integrity', issue: 'untransmitted_question', correct: false }
    if (apiFailed) return { ...out, failure: 'api', issue: rec.error ?? 'all_requests_failed', correct: false }
    const vP = validateBinary(rec.answers?.P?.noul), vN = validateBinary(rec.answers?.notP?.noul)
    if (vP.ok) out.components.P = { p: vP.p, y: yP, adjusted: vP.adjusted, yes: vP.p >= TAU, ...binMetrics(vP.p, yP) }
    if (vN.ok) out.components.notP = { p: vN.p, y: yN, adjusted: vN.adjusted, yes: vN.p >= TAU, ...binMetrics(vN.p, yN) }
    for (const comp of Object.values(out.components)) comp.confidentlyWrong = comp.yes !== comp.y && Math.max(comp.p, 1 - comp.p) >= CONFIDENT
    const bad = [vP, vN].find((v) => !v.ok)
    if (bad) return { ...out, failure: bad.failure, issue: bad.issue, correct: false }
    const yesP = vP.p >= TAU, yesN = vN.p >= TAU
    const status = yesP && !yesN ? 'EVET' : !yesP && yesN ? 'HAYIR' : !yesP && !yesN ? 'ANLASILMIYOR' : 'INCOHERENT'
    const routing = Math.min(Math.max(vP.p, 1 - vP.p), Math.max(vN.p, 1 - vN.p))
    const bothConfident = Math.max(vP.p, 1 - vP.p) >= CONFIDENT && Math.max(vN.p, 1 - vN.p) >= CONFIDENT
    const correct = status === gold
    return { ...out, predicted: status, correct, incoherent: status === 'INCOHERENT', routing,
      confidentlyWrong: !correct && bothConfident,
      unsupportedInference: gold === 'ANLASILMIYOR' && (status === 'EVET' || status === 'HAYIR'),
      confidentUnsupported: gold === 'ANLASILMIYOR' && (status === 'EVET' || status === 'HAYIR') && bothConfident,
      missedEvidence: gold !== 'ANLASILMIYOR' && status === 'ANLASILMIYOR' }
  }
  const isEntity = entry.track === 'B2'
  const optionKeys = isEntity ? Object.keys(f.entity.options) : ['EVET', 'HAYIR', 'ANLASILMIYOR']
  const gold = isEntity ? c.entityKey : c.key
  const out = { ...base, gold, ops, missingQuestions }
  if (missingQuestions.length) return { ...out, failure: 'integrity', issue: 'untransmitted_question', correct: false }
  if (apiFailed) return { ...out, failure: 'api', issue: rec.error ?? 'all_requests_failed', correct: false }
  const v = validateOptions(isEntity ? rec.answers?.entity : rec.answers?.main, optionKeys)
  if (!v.ok) return { ...out, failure: v.failure, issue: v.issue, correct: false }
  const pg = v.p[gold]
  const correct = v.hard === gold
  return { ...out, predicted: v.hard, correct, anomaly: v.anomaly, normalized: v.normalized, routing: v.p[v.hard],
    brier: optionKeys.reduce((s, k) => s + (v.p[k] - (k === gold ? 1 : 0)) ** 2, 0), logloss: -Math.log(Math.max(pg, EPS)), zeroOnGold: pg === 0,
    confidentlyWrong: !correct && v.p[v.hard] >= CONFIDENT,
    unsupportedInference: gold === 'ANLASILMIYOR' && v.hard !== 'ANLASILMIYOR',
    confidentUnsupported: gold === 'ANLASILMIYOR' && v.hard !== 'ANLASILMIYOR' && v.p[v.hard] >= CONFIDENT,
    missedEvidence: gold !== 'ANLASILMIYOR' && v.hard === 'ANLASILMIYOR' }
}

/** A manifest slot with no record: a failure, counted wrong, with no cost information. */
function missingDecision(entry, ref) {
  const { f, c } = ref
  return { model: entry.model, setting: entry.setting, track: entry.track, variant: entry.variant, split: entry.split, caseId: c.id, family: f.id, taskType: f.taskType, capability: f.capability, difficulty: c.difficultyProposed, role: c.role, of: c.of ?? null,
    gold: entry.track === 'B2' ? c.entityKey : c.key, failure: 'missing', issue: 'no_record_for_manifest_slot', correct: false, missingQuestions: entry.questions,
    ops: { hasRecord: false, latencyMs: null, cost: emptyCost(), requests: 0, retries: 0 } }
}

// ---------------- aggregation ----------------
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] }

function pairRate(ds, role) {
  const byId = new Map(ds.map((d) => [d.caseId, d]))
  const pairs = ds.filter((d) => d.role === role).map((d) => [byId.get(d.of), d]).filter(([a]) => a)
  return { n: pairs.length, rate: pairs.length ? pairs.filter(([a, b]) => a.correct && b.correct).length / pairs.length : null, samePredictionRate: role === 'preserve' && pairs.length ? pairs.filter(([a,b]) => !a.failure && !b.failure && a.predicted === b.predicted).length / pairs.length : null }
}

function familyBootstrap(ds, reps = 2000, seed = 7) {
  const fams = [...new Set(ds.map((d) => d.family))]
  if (fams.length < 2) return null
  const by = new Map(fams.map((f) => [f, ds.filter((d) => d.family === f)]))
  let h = seed; const rnd = () => ((h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296)
  const accs = []
  for (let r = 0; r < reps; r++) {
    let ok = 0, n = 0
    for (let i = 0; i < fams.length; i++) { const g = by.get(fams[Math.floor(rnd() * fams.length)]); ok += g.filter((d) => d.correct).length; n += g.length }
    accs.push(ok / n)
  }
  accs.sort((a, b) => a - b)
  return { lo: accs[Math.floor(0.025 * reps)], hi: accs[Math.floor(0.975 * reps)], families: fams.length }
}

function costSummary(ds, expected, completed) {
  const acc = ds.reduce((a, d) => mergeCost(a, d.ops.cost), emptyCost())
  const decisionsWithoutRecord = ds.filter((d) => !d.ops.hasRecord).length
  const known = acc.provider.usd + acc.estimate.usd
  const complete = acc.unavailable.n === 0 && decisionsWithoutRecord === 0 && ds.every(d => !(d.missingQuestions?.length))
  const providerComplete = complete && acc.estimate.n === 0
  return {
    requests: acc.requests,
    providerReported: { requests: acc.provider.n, usd: acc.provider.usd },
    priceEstimate: { requests: acc.estimate.n, usd: acc.estimate.usd, whyProviderCostWasUnavailable: acc.estimate.providerReasons },
    unavailable: { requests: acc.unavailable.n, byReason: acc.unavailable.byReason, invalidRawValues: acc.unavailable.raw },
    coverage: {
      providerShareOfRequests: acc.requests ? acc.provider.n / acc.requests : null,
      accountedShareOfRequests: acc.requests ? (acc.provider.n + acc.estimate.n) / acc.requests : null,
      decisionsWithRecord: expected - decisionsWithoutRecord, decisionsExpected: expected,
    },
    complete, providerOnly: providerComplete,
    knownUsd: known,
    // Per-1k figures are given only when every request is accounted for and no slot is missing; otherwise null,
    // with a separately labelled lower bound.
    per1kAttempted: complete ? (known / expected) * 1000 : null,
    per1kCompleted: complete && completed ? (known / completed) * 1000 : null,
    per1kAttemptedLowerBound: complete ? null : (known / (expected || 1)) * 1000,
    // Labelled scenario, never the default: if the only gaps are failed requests that returned no usage, show the
    // figure under the UNVERIFIED assumption that failed requests are not billed.
    per1kAttemptedIfFailedRequestsUnbilled: !complete && decisionsWithoutRecord === 0 && acc.unavailable.n > 0 && acc.unavailable.n === (acc.unavailable.byReason.failed_request_no_usage ?? 0)
      ? { usd: (known / expected) * 1000, assumption: 'failed requests without usage are not billed (unverified)' } : null,
    basis: providerComplete ? 'provider-reported only' : complete ? 'provider-reported + price estimates (see priceEstimate)' : 'incomplete: lower bound only',
  }
}

export function aggregate(ds, extra = {}) {
  const expected = ds.length
  const done = ds.filter((d) => !d.failure)
  const failures = {}
  for (const d of ds.filter((x) => x.failure)) failures[d.failure] = (failures[d.failure] ?? 0) + 1
  const byType = {}
  for (const t of ['T1', 'T2']) {
    const sub = ds.filter((d) => d.taskType === t)
    if (!sub.length) continue
    const goldDist = {}, perClass = {}
    for (const d of sub) { goldDist[d.gold] = (goldDist[d.gold] ?? 0) + 1; (perClass[d.gold] ??= []).push(d.correct ? 1 : 0) }
    byType[t] = { attempted: sub.length, accuracy: mean(sub.map((d) => (d.correct ? 1 : 0))), goldDistribution: goldDist, perClassAccuracy: Object.fromEntries(Object.entries(perClass).map(([k, v]) => [k, mean(v)])) }
  }
  const groupAcc = (key) => { const o = {}; for (const d of ds) (o[d[key]] ??= []).push(d.correct ? 1 : 0); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { n: v.length, accuracy: mean(v) }])) }
  const confusion = {}
  for (const d of ds) { const p = d.failure ? `FAIL:${d.failure}` : d.predicted; (confusion[d.gold] ??= {})[p] = (confusion[d.gold]?.[p] ?? 0) + 1 }
  const prob = {}
  if (ds[0]?.track === 'A') {
    for (const k of ['P', 'notP']) {
      const comps = ds.map((d) => d.components?.[k]).filter(Boolean)
      prob[k] = { n: comps.length, brier: mean(comps.map((x) => x.brier)), logloss: mean(comps.map((x) => x.logloss)), zeroOnGold: comps.filter((x) => x.zeroOnGold).length, clampedAdjustments: comps.filter((x) => x.adjusted).length, confidentlyWrong: comps.filter((x) => x.confidentlyWrong).length }
    }
  } else {
    prob.options = { n: done.length, brier: mean(done.map((d) => d.brier)), logloss: mean(done.map((d) => d.logloss)), zeroOnGold: done.filter((d) => d.zeroOnGold).length, normalized: done.filter((d) => d.normalized).length, choiceAnomalies: done.filter((d) => d.anomaly).length }
  }
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
  const riskCoverage = thresholds.map((t) => { const cov = done.filter((d) => d.routing >= t); return { t, coverage: cov.length / (expected || 1), error: cov.length ? cov.filter((d) => !d.correct).length / cov.length : null } })
  const lat = ds.map((d) => d.ops.latencyMs).filter((x) => x !== null)
  return {
    expected, attempted: expected, withRecord: ds.filter((d) => d.ops.hasRecord).length, completed: done.length, failures,
    accuracyEndToEnd: mean(ds.map((d) => (d.correct ? 1 : 0))), accuracyCompleted: mean(done.map((d) => (d.correct ? 1 : 0))),
    familyBootstrap95: familyBootstrap(ds),
    byTaskType: byType, byCapability: groupAcc('capability'), byDifficultyProposed: groupAcc('difficulty'),
    confusion,
    incoherent: ds.filter((d) => d.incoherent).length,
    unsupportedInference: ds.filter((d) => d.unsupportedInference).length, confidentUnsupportedInference: ds.filter((d) => d.confidentUnsupported).length,
    missedEvidence: ds.filter((d) => d.missedEvidence).length, confidentlyWrong: ds.filter((d) => d.confidentlyWrong).length,
    contrast: pairRate(ds, 'contrast'), preserve: pairRate(ds, 'preserve'),
    probability: prob, riskCoverage,
    ops: {
      latencyP50: pct(lat, 0.5), latencyP95: pct(lat, 0.95), latencyMissing: ds.length - lat.length,
      requestsPerDecision: mean(ds.filter((d) => d.ops.hasRecord).map((d) => d.ops.requests)), retries: ds.reduce((s, d) => s + d.ops.retries, 0),
      cost: costSummary(ds, expected, done.length),
      duplicateSpend: extra.duplicateSpend ?? null,
    },
  }
}

// ---------------- manifest-checked scoring (fix 1) ----------------
/**
 * records: raw output records. cases: Map from loadFamilies(). manifest: from harness/manifest.mjs (required).
 * opts.prices: optional { model: { inputPerToken, outputPerToken, source } } for price-based estimates.
 */
export function scoreAll(records, cases, manifest, opts = {}) {
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error('scoreAll: an expected run manifest is required (see harness/manifest.mjs)')
  if (opts.datasetHash !== manifest.datasetHash) throw new Error('Scoring dataset hash differs from manifest')
  const prices = opts.prices ?? null
  const integrity = { manifestId: manifest.id ?? null, expectedSlots: manifest.entries.length, recordsReceived: records.length,
    matchedSlots: 0, missingSlots: [], duplicateSlots: [], extraDuplicateRecords: 0, unknownCaseIds: {}, unexpectedSlots: [], malformedRecords: [], manifestErrors: [], incompleteQuestions: [] }
  const entryByKey = new Map()
  for (const e of manifest.entries) {
    if (cases.has(e.caseId) && cases.get(e.caseId).f.split !== e.split) integrity.manifestErrors.push(`manifest split differs for ${e.caseId}`)
    if (!cases.has(e.caseId)) integrity.manifestErrors.push(`manifest names unknown case ${e.caseId}`)
    if (entryByKey.has(slotKey(e))) integrity.manifestErrors.push(`manifest duplicates slot ${slotKey(e)}`)
    entryByKey.set(slotKey(e), e)
  }
  const buckets = new Map()
  records.forEach((r, i) => {
    const missing = SLOT_FIELDS.filter((k) => typeof r?.[k] !== 'string' || !r[k])
    if (missing.length) { integrity.malformedRecords.push({ index: i, missingFields: missing }); return }
    if (!cases.has(r.caseId)) { integrity.unknownCaseIds[r.caseId] = (integrity.unknownCaseIds[r.caseId] ?? 0) + 1; return }
    const k = slotKey(r)
    if (r.experimentId !== manifest.id) { integrity.malformedRecords.push({index:i, issue:'experiment_identity_mismatch'}); return }
    if (!entryByKey.has(k)) { integrity.unexpectedSlots.push({ index: i, slot: k }); return }
    const e = entryByKey.get(k)
    if ((r.requests ?? []).some(req => !e.requests.some(er => er.requestId === req.requestId && er.bodyHash === req.bodyHash && er.question === req.question))) { integrity.malformedRecords.push({index:i, issue:'request_identity_mismatch'}); return }
    ;(buckets.get(k) ?? buckets.set(k, []).get(k)).push({ r, i })
  })
  const decisions = [], dupSpend = new Map()
  for (const [k, e] of entryByKey) {
    const ref = cases.get(e.caseId)
    if (!ref) continue
    const b = buckets.get(k) ?? []
    if (!b.length) { integrity.missingSlots.push(k); decisions.push(missingDecision(e, ref)); continue }
    integrity.matchedSlots++
    // Duplicates: keep the earliest dispatch (then file order) so a re-run cannot replace a worse answer.
    b.sort((x, y) => (x.r.dispatchedAt ?? Infinity) - (y.r.dispatchedAt ?? Infinity) || x.i - y.i)
    const d = evaluate(b[0].r, ref, e, prices)
    if (d.missingQuestions.length) integrity.incompleteQuestions.push({ slot: k, missing: d.missingQuestions })
    if (b.length > 1) {
      const others = b.slice(1).map(({ r }) => evaluate(r, ref, e, prices))
      integrity.duplicateSlots.push({ slot: k, records: b.length, keptIndex: b[0].i, droppedIndices: b.slice(1).map((x) => x.i), predictionsAgree: others.every((o) => o.predicted === d.predicted && o.failure === d.failure) })
      integrity.extraDuplicateRecords += b.length - 1
      const g = `${e.model}|${e.setting}|${e.track}|${e.variant}|${e.split}`
      const acc = dupSpend.get(g) ?? { records: 0, cost: emptyCost() }
      for (const o of others) { acc.records++; mergeCost(acc.cost, o.ops.cost) }
      dupSpend.set(g, acc)
    }
    decisions.push(d)
  }
  const unknownCount = Object.values(integrity.unknownCaseIds).reduce((a, b) => a + b, 0)
  integrity.status = integrity.missingSlots.length || integrity.duplicateSlots.length || unknownCount || integrity.unexpectedSlots.length || integrity.malformedRecords.length || integrity.manifestErrors.length || integrity.incompleteQuestions.length ? 'incomplete' : 'complete'
  integrity.summary = { expected: integrity.expectedSlots, matched: integrity.matchedSlots, missing: integrity.missingSlots.length, duplicateSlots: integrity.duplicateSlots.length, extraDuplicateRecords: integrity.extraDuplicateRecords, unknownCaseIdRecords: unknownCount, unexpected: integrity.unexpectedSlots.length, malformed: integrity.malformedRecords.length, incompleteQuestions: integrity.incompleteQuestions.length }
  const groups = {}
  for (const d of decisions) (groups[`${d.model}|${d.setting}|${d.track}|${d.variant}|${d.split}`] ??= []).push(d)
  const summary = Object.fromEntries(Object.entries(groups).map(([g, ds]) => {
    const dup = dupSpend.get(g)
    return [g, aggregate(ds, { duplicateSpend: dup ? { records: dup.records, providerReportedUsd: dup.cost.provider.usd, priceEstimateUsd: dup.cost.estimate.usd, unavailableRequests: dup.cost.unavailable.n } : null })]
  }))
  return { integrity, decisions, summary }
}

// ---------------- CLI ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
  const file = process.argv[2], mpath = arg('--manifest')
  if (!file || !mpath) { console.error('usage: node score.mjs <outputs.jsonl> --manifest <manifest.json> [--prices prices.json] [--json out.json] [--allow-incomplete]'); process.exit(2) }
  const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'))
  const prices = arg('--prices') ? JSON.parse(readFileSync(arg('--prices'), 'utf8')) : null
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const bundle = loadBundle(join(root, 'frozen'))
  if (manifest.id !== bundle.manifest.id) throw new Error('CLI manifest is not this frozen sample')
  const refs = loadFamilies(join(root, 'frozen/sample.json'))
  const res = scoreAll(records, refs.cases, manifest, { prices, datasetHash: refs.datasetHash })
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ integrity: res.integrity, summary: res.summary }, null, 2))
  console.log(`integrity: ${res.integrity.status} ${JSON.stringify(res.integrity.summary)}`)
  for (const [k, s] of Object.entries(res.summary)) console.log(k, `acc(e2e)=${s.accuracyEndToEnd?.toFixed(3)} completed=${s.completed}/${s.expected} failures=${JSON.stringify(s.failures)} cost=${s.ops.cost.basis}`)
  if (res.integrity.status !== 'complete' && !process.argv.includes('--allow-incomplete')) process.exit(3)
}
