// src/health.mjs —— 两端中转健康探针(最小调用,看回 OK 还是落哪个 code)
// 用法:node src/health.mjs
import { codexAsk, claudeAsk, setFixtureDir } from './adapters.mjs'
import { join } from 'node:path'

setFixtureDir(join(process.cwd(), 'runs', 'health-fx'))
const PRE = '只回一个词,不要任何解释。'

async function ping(name, fn) {
  const t0 = Date.now()
  const r = await fn({ prompt: '回复:ok', systemPreamble: PRE })
  const sec = ((Date.now() - t0) / 1000).toFixed(0)
  if (r?.ok) console.log(`  ✅ ${name}: OK "${(r.text || '').trim().slice(0, 20)}" (${sec}s)`)
  else console.log(`  ❌ ${name}: [${r?.code || '?'}] ${(r?.error || '').slice(0, 80)} (${sec}s)`)
  return { name, ok: !!r?.ok, code: r?.code || (r?.ok ? 'OK' : '?'), sec }
}

console.log('═══ sylux 双端健康探针 ═══')
const codex = await ping('codex', codexAsk)
const claude = await ping('claude', claudeAsk)
console.log(`\n结论:codex=${codex.ok ? '可用' : codex.code} | claude=${claude.ok ? '可用' : claude.code}`)
process.exit(codex.ok && claude.ok ? 0 : 1)
