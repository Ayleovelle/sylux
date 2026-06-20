// src/replay-check.mjs —— 回放地基验收:确认 runs/*.jsonl 足以支撑 M2 面板投影。
// M2 面板需要从每条记录投出:round / agent(from) / role / kind / usage / status(code) / error / body。
// 用法:node src/replay-check.mjs <jsonl路径>
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) { console.error('用法: node src/replay-check.mjs <runs/xxx.jsonl>'); process.exit(1) }

const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim())
const msgs = lines.map((l, i) => { try { return JSON.parse(l) } catch (e) { return { __badLine: i + 1, __raw: l.slice(0, 80) } } })

const bad = msgs.filter((m) => m.__badLine)
if (bad.length) { console.error(`❌ ${bad.length} 行非法 JSON(jsonl 损坏,回放地基不成立):`, bad.map((b) => b.__badLine)); process.exit(1) }

// M2 面板投影:逐条能否投出所需字段
let issues = 0
const projected = msgs.map((m, i) => {
  const proj = {
    round: m.round, agent: m.from, role: m.role, kind: m.kind,
    usage: m.usage ? { in: m.usage.input_tokens ?? null, out: m.usage.output_tokens ?? null } : null,
    statusCode: m.status?.code ?? (m.kind === 'status_changed' ? '(缺code)' : null),
    error: m.kind === 'status_changed' ? m.body : null,
    bodyLen: (m.body || '').length,
    fixturePath: m.fixturePath ?? null,
  }
  // 关键字段必须存在
  for (const k of ['round', 'agent', 'role', 'kind']) if (proj[k] == null) { console.error(`  ⚠ 第${i + 1}条缺 ${k}`); issues++ }
  if (m.kind === 'status_changed' && !m.status?.code) { console.error(`  ⚠ 第${i + 1}条 status_changed 无 code(失败被糊成"运行失败")`); issues++ }
  return proj
})

// 投影出 M2 面板会用到的时间线视图
console.log('═══ M2 面板投影预览(每条 → 气泡/状态行)═══')
for (const p of projected) {
  const u = p.usage ? ` in=${p.usage.in} out=${p.usage.out}` : ''
  const s = p.statusCode ? ` [${p.statusCode}]` : ''
  console.log(`  R${p.round} ${p.agent}/${p.role}/${p.kind}${s}${u} body=${p.bodyLen}字 ${p.fixturePath ? '📎' : ''}`)
}

// 可投影出的聚合(面板侧栏会用)
const totIn = projected.reduce((s, p) => s + (p.usage?.in || 0), 0)
const totOut = projected.reduce((s, p) => s + (p.usage?.out || 0), 0)
const codes = [...new Set(projected.map((p) => p.statusCode).filter(Boolean))]
console.log(`\n聚合:消息${msgs.length} 累计token in=${totIn} out=${totOut} 状态码=${codes.join(',') || '无'}`)
console.log(issues === 0
  ? '\n✅ 回放地基成立:所有字段可投影,失败均带 code。M2 面板可据此 jsonl 直接渲染,无需改数据层。'
  : `\n❌ ${issues} 处投影缺口,需在写盘侧补字段再上 M2。`)
process.exit(issues ? 1 : 0)
