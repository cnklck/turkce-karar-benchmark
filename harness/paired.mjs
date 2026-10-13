// turkce-karar v0.4 paired model comparisons over identical slots within one explicit Core or Challenge split.
// Two models are compared on identical manifest slots. The unit of resampling is the scenario family: a family's
// three cases (base, contrast, preserve) are correlated, so they are resampled together.
//
//   node paired.mjs <outputs.jsonl> --manifest <manifest.json> --track B1 [--setting common] [--variant base] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { loadFamilies, scoreAll } from '../scoring/score.mjs'
import { loadBundle } from './freeze.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Two-sided exact binomial (sign) test, p = 0.5. */
export function signTest(nPlus, nMinus) {
  const n = nPlus + nMinus
  if (!n) return 1
  const k = Math.min(nPlus, nMinus)
  let lp = 0, tail = 0
  for (let i = 0; i <= n; i++) { if (i > 0) lp += Math.log((n - i + 1) / i); if (i <= k) tail += Math.exp(lp - n * Math.LN2) }
  return Math.min(1, 2 * tail)
}

/** Holm step-down adjustment for a list of p-values (same order returned). */
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0])
  const out = new Array(ps.length); let run = 0
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (ps.length - r) * p)); out[i] = run })
  return out
}

function bootstrapMean(values, reps, seed) {
  let h = seed >>> 0; const rnd = () => ((h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296)
  const n = values.length, ms = []
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rnd() * n)]; ms.push(s / n) }
  ms.sort((a, b) => a - b)
  return { lo: ms[Math.floor(0.025 * reps)], hi: ms[Math.floor(0.975 * reps)] }
}

/**
 * decisions: scored decisions from scoreAll (manifest-checked, so missing slots are already failures).
 * Returns family-level paired statistics for model a minus model b.
 */
export function pairedCompare(decisions, { a, b, setting = 'common', track, variant = 'base', split, reps = 5000, seed = 11 }) {
  if (!['core','challenge'].includes(split)) throw new Error('Paired comparison requires an explicit Core or Challenge split')
  const pick = (m) => decisions.filter((d) => d.model === m && d.setting === setting && d.track === track && d.variant === variant && d.split === split)
  const da = pick(a), db = pick(b)
  const ka = new Set(da.map((d) => d.caseId)), kb = new Set(db.map((d) => d.caseId))
  if (!da.length || ka.size !== kb.size || [...ka].some((k) => !kb.has(k))) throw new Error(`pairedCompare: ${a} and ${b} do not cover the same slots for ${setting}/${track}/${variant}`)
  const byFam = (ds) => { const m = new Map(); for (const d of ds) (m.get(d.family) ?? m.set(d.family, []).get(d.family)).push(d); return m }
  const fa = byFam(da), fb = byFam(db)
  const fams = [...fa.keys()].sort()
  const rows = fams.map((fid) => {
    const xa = fa.get(fid), xb = fb.get(fid)
    const sa = mean(xa.map((d) => (d.correct ? 1 : 0))), sb = mean(xb.map((d) => (d.correct ? 1 : 0)))
    return { family: fid, taskType: xa[0].taskType, capability: xa[0].capability, a: sa, b: sb, diff: sa - sb, aAll: xa.every((d) => d.correct), bAll: xb.every((d) => d.correct) }
  })
  const diffs = rows.map((r) => r.diff)
  const nPlus = diffs.filter((x) => x > 0).length, nMinus = diffs.filter((x) => x < 0).length
  const byCase = new Map(db.map((d) => [d.caseId, d]))
  let aOnly = 0, bOnly = 0
  for (const d of da) { const o = byCase.get(d.caseId); if (d.correct && !o.correct) aOnly++; else if (!d.correct && o.correct) bOnly++ }
  const pair = (ds, role) => { const id = new Map(ds.map((d) => [d.caseId, d])); const ps = ds.filter((d) => d.role === role).map((d) => [id.get(d.of), d]).filter(([x]) => x); return mean(ps.map(([x, y]) => (x.correct && y.correct ? 1 : 0))) }
  const sub = (key) => {
    const out = {}
    for (const v of [...new Set(rows.map((r) => r[key]))].sort()) {
      const ds = rows.filter((r) => r[key] === v).map((r) => r.diff)
      out[v] = { families: ds.length, meanDiff: mean(ds), ci95: ds.length >= 5 ? bootstrapMean(ds, 2000, seed + 1) : null }
    }
    return out
  }
  return {
    a, b, setting, track, variant, split, families: fams.length, cases: da.length,
    accuracy: { a: mean(da.map((d) => (d.correct ? 1 : 0))), b: mean(db.map((d) => (d.correct ? 1 : 0))) },
    meanFamilyDiff: mean(diffs), ci95: bootstrapMean(diffs, reps, seed),
    familiesFavouring: { a: nPlus, b: nMinus, tie: diffs.length - nPlus - nMinus }, signTestP: signTest(nPlus, nMinus),
    discordantCases: { aOnly, bOnly },
    wholeFamilyCorrect: { a: mean(rows.map((r) => (r.aAll ? 1 : 0))), b: mean(rows.map((r) => (r.bAll ? 1 : 0))) },
    contrastPairBothCorrect: { a: pair(da, 'contrast'), b: pair(db, 'contrast') },
    preservePairBothCorrect: { a: pair(da, 'preserve'), b: pair(db, 'preserve') },
    byTaskType: sub('taskType'), byCapability: sub('capability'),
    note: 'Full synthetic bank with provisional AI keys and no human baseline. Families are resampled together. Core and Challenge are reported separately; paired confidence intervals and multiple-comparison correction qualify differences.',
  }
}

/** All model pairs for one setting/track/variant, with Holm-adjusted sign-test p-values. */
export function pairwiseMatrix(decisions, models, opts) {
  const res = []
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) res.push(pairedCompare(decisions, { ...opts, a: models[i], b: models[j] }))
  const adj = holm(res.map((r) => r.signTestP))
  res.forEach((r, i) => { r.signTestPHolm = adj[i] })
  return res
}

// ---------------- CLI ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
  const file = process.argv[2], mpath = arg('--manifest'), track = arg('--track')
  if (!file || !mpath || !track) { console.error('usage: node paired.mjs <outputs.jsonl> --manifest <manifest.json> --track A|B1|B2 [--setting common] [--variant base] [--json out.json]'); process.exit(2) }
  const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'))
  const root = resolve(fileURLToPath(new URL('..', import.meta.url))), bundle = loadBundle(join(root,'frozen'))
  if (manifest.id !== bundle.manifest.id) throw new Error('Manifest is not this frozen sample')
  const refs = loadFamilies(join(root,'frozen/sample.json'))
  const { integrity, decisions } = scoreAll(records, refs.cases, manifest, {datasetHash:refs.datasetHash})
  const split = arg('--split')
  if (!['core','challenge'].includes(split)) throw new Error('--split core|challenge required')
  const setting = arg('--setting') ?? 'common', variant = arg('--variant') ?? 'base'
  const models = [...new Set(manifest.entries.filter((e) => e.setting === setting && e.track === track && e.variant === variant && e.split === split).map((e) => e.model))]
  const res = pairwiseMatrix(decisions, models, { setting, track, variant, split })
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ integrity: integrity.summary, comparisons: res }, null, 2))
  console.log(`integrity: ${integrity.status}`)
  for (const r of res) console.log(`${r.a} vs ${r.b}: diff ${r.meanFamilyDiff.toFixed(3)} [${r.ci95.lo.toFixed(3)}, ${r.ci95.hi.toFixed(3)}], families +${r.familiesFavouring.a}/-${r.familiesFavouring.b}, sign p ${r.signTestP.toFixed(4)} (Holm ${r.signTestPHolm.toFixed(4)})`)
}
