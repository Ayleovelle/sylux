// m0/gate.mjs —— 把探针结果套进 §22.4 闸门决策矩阵,产最终放行/阻断裁决。
// 裁决口径(Aylovelle 2026-06-20 锁定):
//  - T0.5b(沙箱出网)= 唯一 build-stop 硬阻断;fail 且无替代 → 停在 M0。
//  - T0.5c(命令复跑负例)= 硬要求级 major;fail → disableCommandEvidenceRerun=true,只保留 weak/infra 路径,不卡主干。
//  - 其余 major fail 但有退化路径 → 有条件通过。
//  - 任一核心探针 inconclusive(没跑/没定论)→ 阻断,不许跳过。
import { readAllResults } from './harness.mjs'

const CORE = ['T0.1', 'T0.2', 'T0.3', 'T0.4', 'T0.5', 'T0.5b', 'T0.6']

export function computeGate() {
  const results = readAllResults()
  const by = Object.fromEntries(results.map((r) => [r.id, r]))
  const recommendations = []
  const reasons = []
  let verdict = 'PASS' // PASS | CONDITIONAL | BLOCKED

  // 1. T0.5b 唯一硬阻断
  const b = by['T0.5b']
  if (!b || b.status === 'inconclusive') { verdict = 'BLOCKED'; reasons.push('T0.5b 无结论:出网假设未裁决,不许跳过') }
  else if (b.status === 'fail') { verdict = 'BLOCKED'; reasons.push('T0.5b fail:沙箱可出网且无应用层禁 spawn/出站白名单替代 → 停在 M0') }

  // 2. 核心探针 inconclusive 一律阻断
  for (const id of CORE) {
    const r = by[id]
    if (!r) { if (verdict !== 'BLOCKED') verdict = 'BLOCKED'; reasons.push(`${id} 缺结果:未跑`) }
    else if (r.status === 'inconclusive') { if (verdict !== 'BLOCKED') verdict = 'BLOCKED'; reasons.push(`${id} inconclusive:${r.summary || '没定论'}`) }
  }

  // 3. T0.5c 特例:fail → 关复跑特性,不阻断主干
  const c = by['T0.5c']
  if (c && c.status === 'fail') {
    recommendations.push('disableCommandEvidenceRerun=true(T0.5c 负例未通过:禁用 command-evidence 强核验,只保留 weak/infra 路径,修好再开)')
  }

  // 4. 其余 major fail 且非 T0.5b/T0.5c → 若有 nextAction(退化路径)记 CONDITIONAL,否则 BLOCKED
  for (const r of results) {
    if (['T0.5b', 'T0.5c'].includes(r.id)) continue
    if (r.status === 'fail') {
      if (r.nextAction && /退化|降级|fallback|degrad|stream-json|对齐/i.test(r.nextAction)) {
        if (verdict === 'PASS') verdict = 'CONDITIONAL'
        recommendations.push(`${r.id} fail→走退化路径:${r.nextAction}`)
      } else {
        verdict = 'BLOCKED'; reasons.push(`${r.id} fail 且无明确退化路径:${r.summary || ''}`)
      }
    }
  }

  return { verdict, reasons, recommendations, counts: tally(results), results }
}

function tally(results) {
  const t = { pass: 0, fail: 0, inconclusive: 0, total: results.length }
  for (const r of results) t[r.status] = (t[r.status] || 0) + 1
  return t
}
