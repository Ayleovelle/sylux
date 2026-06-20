// m0/run.mjs —— M0 探针 CLI。
// 用法:
//   node run.mjs <probeId>         跑单个探针(如 node run.mjs T0.1)
//   node run.mjs all               按序跑全部(T0.5b 无 --allow-network 时自报 inconclusive)
//   node run.mjs gate              只重算闸门裁决(读已有 probe-results)
// 选项:
//   --allow-network                显式开启 T0.5b 真出网测试(否则不偷偷跑)
//   --dry-run                      触网探针只校验可行性、不真调中转(省 token)
//   --write-back                   把汇总+裁决追加写回 PROBED-FACTS.md(T0.7)
import { writeResult, readAllResults, PROBED_FACTS } from './harness.mjs'
import { probes } from './probes.mjs'
import { computeGate } from './gate.mjs'
import { appendFileSync } from 'node:fs'

const RUN_ORDER = ['T0.2', 'T0.2b', 'T0.5c', 'T0.1', 'T0.3', 'T0.4', 'T0.5', 'T0.5b', 'T0.6']
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const positional = argv.filter((a) => !a.startsWith('--'))
const target = positional[0] || 'all'
const ctx = { allowNetwork: flags.has('--allow-network'), dryRun: flags.has('--dry-run') }
const byId = Object.fromEntries(probes.map((p) => [p.id, p]))

async function runOne(p) {
  process.stdout.write(`\n▶ ${p.id} ${p.title}${p.touchesApi ? ' (API)' : ''} ...\n`)
  let res
  try { res = await p.run(ctx) } catch (e) { res = { id: p.id, title: p.title, severity: p.severity, status: 'inconclusive', summary: 'run 抛错:' + String(e).slice(0, 120), evidencePath: [], metrics: {}, nextAction: '修探针实现后重跑', ts: new Date().toISOString() } }
  writeResult(res)
  const mark = { pass: '✅', fail: '❌', inconclusive: '⚪' }[res.status] || '?'
  console.log(`  ${mark} ${res.status} — ${res.summary}`)
  if (res.nextAction) console.log(`     ↳ ${res.nextAction}`)
  return res
}

function printGate() {
  const g = computeGate()
  const tag = { PASS: '✅ 通过', CONDITIONAL: '🟡 有条件通过', BLOCKED: '⛔ 阻断' }[g.verdict]
  console.log(`\n════════ 闸门裁决:${tag} ════════`)
  console.log(`计数:pass=${g.counts.pass} fail=${g.counts.fail} inconclusive=${g.counts.inconclusive} / ${g.counts.total}`)
  if (g.reasons.length) { console.log('原因:'); g.reasons.forEach((r) => console.log('  - ' + r)) }
  if (g.recommendations.length) { console.log('建议:'); g.recommendations.forEach((r) => console.log('  ★ ' + r)) }
  return g
}

if (target === 'gate') {
  const g = printGate()
  if (flags.has('--write-back')) writeBack(g)
} else if (target === 'all') {
  for (const id of RUN_ORDER) if (byId[id]) await runOne(byId[id])
  const g = printGate()
  if (flags.has('--write-back')) writeBack(g)
} else if (byId[target]) {
  await runOne(byId[target])
  printGate()
} else {
  console.error(`未知探针:${target}。可用:${RUN_ORDER.join(' ')} | all | gate`)
  process.exit(1)
}

function writeBack(g) {
  const results = readAllResults()
  const lines = ['', '', '## M0 探针回填(' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ')', '',
    `闸门裁决:**${g.verdict}**  (pass=${g.counts.pass} fail=${g.counts.fail} inconclusive=${g.counts.inconclusive})`, '',
    '| 探针 | 结论 | 摘要 | 证据 | nextAction |', '|---|---|---|---|---|']
  for (const r of results.sort((a, b) => a.id.localeCompare(b.id)))
    lines.push(`| ${r.id} | ${r.status} | ${(r.summary || '').replace(/\|/g, '/').slice(0, 90)} | ${[].concat(r.evidencePath).join(' ')} | ${(r.nextAction || '').replace(/\|/g, '/').slice(0, 90)} |`)
  if (g.recommendations.length) { lines.push('', '裁决建议:'); g.recommendations.forEach((x) => lines.push('- ' + x)) }
  appendFileSync(PROBED_FACTS, lines.join('\n'))
  console.log(`\n📝 已写回 ${PROBED_FACTS}`)
}
