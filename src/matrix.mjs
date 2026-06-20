// src/matrix.mjs —— 双端合跑矩阵:两个方向 × 多任务,各保留 jsonl+fixture,汇总结果表。
// 用法:node src/matrix.mjs [--max 3]
import { runRedBlue } from './engine.mjs'
import { setFixtureDir, quickHealth } from './adapters.mjs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const flags = {}
const a = process.argv.slice(2)
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { flags[a[i].slice(2)] = a[i + 1]; i++ }
const maxRounds = parseInt(flags.max || '3', 10)

const directions = [
  { author: 'claude', critic: 'codex' },
  { author: 'codex', critic: 'claude' },
]
const tasks = [
  '用 TypeScript 写一个 clamp(x,min,max) 函数,处理 NaN 和 min>max。',
  '写一个 SQL 查询:取每个部门工资最高的员工(并列都要)。给标准 SQL。',
  '解释为什么浮点 0.1+0.2 !== 0.3,并给一个安全比较两个浮点是否相等的函数。',
]

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const baseDir = join(process.cwd(), 'runs', `matrix-${stamp}`)
mkdirSync(baseDir, { recursive: true })

const rows = []
let combo = 0
// 预检:每端只探一次,死端的组合直接跳过(别浪费另一端的调用)
const ends = [...new Set(directions.flatMap((d) => [d.author, d.critic]))]
const health = {}
console.log('预检两端健康...')
for (const e of ends) { health[e] = await quickHealth(e); console.log(`  ${e}: ${health[e].ok ? 'OK' : health[e].code} (${health[e].sec}s)`) }

for (const dir of directions) {
  for (let ti = 0; ti < tasks.length; ti++) {
    combo++
    const deadEnd = [dir.author, dir.critic].find((e) => !health[e].ok)
    if (deadEnd) {
      const code = health[deadEnd].code
      rows.push({ combo, dir: `${dir.author}→${dir.critic}`, task: ti + 1, rounds: 0, stopReason: 'SKIPPED_' + code, failCode: code, tokIn: 0, tokOut: 0, sec: 0, jsonl: '' })
      console.log(`\n[${combo}/6] ${dir.author}→${dir.critic} 任务${ti + 1} → 跳过(${deadEnd} 不可用:${code})`)
      continue
    }
    const tag = `${dir.author}_to_${dir.critic}__t${ti + 1}`
    const jsonlPath = join(baseDir, `${tag}.jsonl`)
    setFixtureDir(join(baseDir, `fx-${tag}`))
    process.stdout.write(`\n[${combo}/6] ${dir.author}→${dir.critic}  任务${ti + 1} ...`)
    const t0 = Date.now()
    let stopReason = 'ERROR', msgs = []
    try {
      const r = await runRedBlue({ task: tasks[ti], assignment: dir, jsonlPath, maxRounds, onMessage: () => process.stdout.write('.') })
      stopReason = r.stopReason; msgs = r.board.messages
    } catch (e) { stopReason = 'THROW:' + String(e).slice(0, 60) }
    const real = msgs.filter((m) => m.from !== 'orchestrator')
    const tokIn = msgs.reduce((s, m) => s + (m.usage?.input_tokens || 0), 0)
    const tokOut = msgs.reduce((s, m) => s + (m.usage?.output_tokens || 0), 0)
    const failCode = msgs.find((m) => m.kind === 'status_changed')?.status?.code || ''
    rows.push({ combo, dir: `${dir.author}→${dir.critic}`, task: ti + 1, rounds: real.length, stopReason, failCode, tokIn, tokOut, sec: ((Date.now() - t0) / 1000).toFixed(0), jsonl: tag + '.jsonl' })
    process.stdout.write(` [${stopReason}] ${real.length}轮 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`)
  }
}

console.log('\n\n═══ 双端合跑矩阵汇总 ═══')
console.log('方向\t\t任务\t轮数\t停因\t\tin\tout\t秒')
for (const r of rows) console.log(`${r.dir}\t${r.task}\t${r.rounds}\t${r.stopReason}\t${r.tokIn}\t${r.tokOut}\t${r.sec}`)
const okCombos = rows.filter((r) => ['CONVERGED', 'CONVERGENCE_STALL', 'MAX_ROUNDS'].includes(r.stopReason)).length
console.log(`\n成功跑完(收敛/停滞/封顶):${okCombos}/6;失败的都有明确 code:${[...new Set(rows.filter((r) => r.failCode).map((r) => r.failCode))].join(',') || '无失败'}`)
console.log(`产物目录:${baseDir}`)
import { writeFileSync } from 'node:fs'
writeFileSync(join(baseDir, 'summary.json'), JSON.stringify(rows, null, 2))
