// src/blackboard.mjs —— M1 黑板与消息契约(对齐 docs/skeleton/src/shared 的精神,运行期最小集)
// 权威类型以 docs/drafts/02 + skeleton 为准;此处是 M1 可跑子集,字段名保持一致。
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// kind: proposal | critique | patch | question | done | status_changed
// role: author | critic | lead | worker
// from: agent id（如 'codex' / 'claude' / 'orchestrator'）
export function makeMessage({ round, from, role, kind, body, evidence = [], files = [], usage = null, status = null, fixturePath = null }) {
  return { round, from, role, kind, body, evidence, files, usage, status, fixturePath, ts: new Date().toISOString() }
}

// critic 的 evidence 校验:必须非空（M1 最小核验;强核验/锚点差集留 M3）
export function validateMessage(m) {
  if (m.role === 'critic' && m.kind === 'critique') {
    if (!Array.isArray(m.evidence) || m.evidence.length === 0) {
      return { ok: false, reason: 'critic 消息 evidence 为空,打回（不准空夸）' }
    }
  }
  return { ok: true }
}

export class Blackboard {
  constructor(jsonlPath) {
    this.jsonlPath = jsonlPath
    this.messages = []
    if (jsonlPath) mkdirSync(dirname(jsonlPath), { recursive: true })
  }
  append(msg) {
    const v = validateMessage(msg)
    if (!v.ok) throw new Error('黑板校验失败: ' + v.reason)
    this.messages.push(msg)
    if (this.jsonlPath) appendFileSync(this.jsonlPath, JSON.stringify(msg) + '\n')
    return msg
  }
  lastOf(from) { return [...this.messages].reverse().find((m) => m.from === from) || null }
  lastKind() { return this.messages.length ? this.messages[this.messages.length - 1].kind : null }
  byRound(r) { return this.messages.filter((m) => m.round === r) }
  totalUsage() {
    return this.messages.reduce((a, m) => a + (m.usage?.input_tokens || 0) + (m.usage?.output_tokens || 0), 0)
  }
}
