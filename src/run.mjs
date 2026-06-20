// src/run.mjs —— sylux 运行器:跑指定剧本并在终端渲染。
// 用法:
//   node src/run.mjs "任务" --playbook red-blue --a codex --b claude --max 6
//   node src/run.mjs "任务" --config configs/redblue-codex-lead.json
//   playbook ∈ red-blue | lead-worker | pair | divide-parallel
//   --config 给基线,命令行 flag(--playbook/--a/--b/--max)覆盖之。
import { runEngine } from './engine.mjs'
import { PLAYBOOKS } from './playbooks.mjs'
import { setFixtureDir } from './adapters.mjs'
import { DEFAULT_CONFIG, loadConfig, applyOverrides } from './config.mjs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++ }
  else pos.push(argv[i])
}
const task = pos.join(' ') || '用 TypeScript 写一个判断字符串是否回文的函数,O(n) 且处理 Unicode。'

// 配置:--config 给基线(否则用内置默认),命令行 flag 覆盖。
let cfg
try {
  const base = flags.config ? loadConfig(flags.config) : DEFAULT_CONFIG
  cfg = applyOverrides(base, flags)
} catch (e) {
  console.error(e.message); process.exit(1)
}

const pbName = cfg.playbook
const a = cfg.roles.a
const b = cfg.roles.b
const maxRounds = cfg.stop.maxRounds

// 把两 agent(注册表名)映射成各剧本的角色名
const ASSIGN = {
  'red-blue': { author: a, critic: b },
  'lead-worker': { lead: a, worker: b },
  'pair': { navigator: a, driver: b },
  'divide-parallel': { lead: a, a, b },
}
const factory = PLAYBOOKS[pbName]
if (!factory) { console.error(`未知剧本:${pbName}。可用:${Object.keys(PLAYBOOKS).join(' / ')}`); process.exit(1) }
const playbook = factory(ASSIGN[pbName])

const C = { author: '\x1b[36m', critic: '\x1b[31m', lead: '\x1b[33m', worker: '\x1b[32m', navigator: '\x1b[35m', driver: '\x1b[36m', dim: '\x1b[2m', rst: '\x1b[0m', bold: '\x1b[1m' }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const jsonlPath = join(process.cwd(), 'runs', `${pbName}-${stamp}.jsonl`)
setFixtureDir(join(process.cwd(), 'runs', `fixtures-${stamp}`))

console.log(`${C.bold}═══ sylux · ${pbName} ═══${C.rst}`)
console.log(`${C.dim}任务:${C.rst} ${task}`)
console.log(`${C.dim}a=${a}  b=${b}  maxRounds=${maxRounds}${flags.config ? '  config=' + flags.config : ''}${C.rst}`)
console.log(`${C.dim}日志:${jsonlPath}${C.rst}\n`)

function render(m) {
  const col = C[m.role] || C.rst
  const u = m.usage ? `${C.dim} [in=${m.usage.input_tokens ?? '?'} out=${m.usage.output_tokens ?? '?'}]${C.rst}` : ''
  const s = m.status?.code ? ` ${C.bold}[${m.status.code}]${C.rst}` : ''
  console.log(`${col}${C.bold}● 第${m.round}轮 ${m.from} (${m.role}/${m.kind})${C.rst}${s}${u}`)
  console.log(m.body.split('\n').map((l) => '   ' + l).join('\n'))
  if (m.evidence?.length) console.log(`${C.dim}   证据: ${m.evidence.join(' | ')}${C.rst}`)
  console.log('')
}

// 可选 Web 观战面板:--panel [端口]。启动后打印带 token 的本机 URL。
let panel = null
if (flags.panel !== undefined) {
  const { startPanel } = await import('./server.mjs')
  const port = parseInt(flags.panel || '7878', 10) || 7878
  panel = await startPanel({ task, playbook: pbName, port })
  console.log(`${C.bold}观战面板:${C.rst} ${panel.url}`)
  console.log(`${C.dim}(只绑 127.0.0.1,token 一次性,关掉进程即失效)${C.rst}\n`)
  // 给观战者留出打开浏览器的时间
  await new Promise((r) => setTimeout(r, 2500))
}

const t0 = Date.now()
const onMessage = (m) => { render(m); if (panel) panel.broadcast(m) }
const { board, stopReason } = await runEngine({ task, playbook, jsonlPath, maxRounds, agents: cfg.agents, convergence: cfg.stop.convergence, onMessage })
const rounds = board.messages.filter((m) => m.from !== 'orchestrator').length
const sec = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`${C.bold}═══ 结束 ═══${C.rst}`)
console.log(`停因:${stopReason}  轮数:${rounds}  累计 token≈${board.totalUsage()}  耗时:${sec}s`)
console.log(`完整记录:${jsonlPath}`)
if (panel) {
  panel.end({ stopReason, rounds, totalUsage: board.totalUsage(), sec })
  console.log(`${C.dim}面板仍在线(${panel.url}),Ctrl+C 关闭。${C.rst}`)
}

