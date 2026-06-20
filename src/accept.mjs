// src/accept.mjs —— 完全体验收闸:一键跑全部确定性测试 + 配置加载校验。
//   跑:node src/accept.mjs  (零 CLI、零 token 花费,纯本地逻辑)
//   真 CLI 双端验收另跑:node src/matrix.mjs --allow-network
import { spawnSync } from 'node:child_process'
import { loadConfig } from './config.mjs'
import { PLAYBOOKS } from './playbooks.mjs'
import { CONVERGENCE_PROFILE } from './converge.mjs'
import { STATUS } from './status.mjs'

const NODE = process.execPath
let groups = 0, fails = 0
function suite(name, file) {
  const r = spawnSync(NODE, [file], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(/(\d+)\s*过\s*\/\s*(\d+)\s*[败失]/)
  const ok = r.status === 0 && m && m[2] === '0'
  groups++; if (!ok) fails++
  console.log(`${ok ? '✓' : '✗'} ${name}: ${m ? m[1] + ' 过 / ' + m[2] + ' 败' : '退出码 ' + r.status}`)
}

console.log('━━━ sylux 完全体验收 ━━━\n[A] 确定性测试套件')
suite('状态码故障注入 (fault-test)', 'src/fault-test.mjs')
suite('收敛检测 (converge-test)', 'src/converge-test.mjs')
suite('观战面板协议 (server-test)', 'src/server-test.mjs')

console.log('\n[B] 静态完整性')
function check(name, cond) { groups++; if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}`) }
check('四范式工厂齐全', ['red-blue', 'lead-worker', 'pair', 'divide-parallel'].every((k) => typeof PLAYBOOKS[k] === 'function'))
check('每范式都有收敛 profile', Object.keys(PLAYBOOKS).every((k) => CONVERGENCE_PROFILE[k]))
check('状态码含 CONVERGED/CONVERGENCE_STALL/MAX_ROUNDS', ['CONVERGED', 'CONVERGENCE_STALL', 'MAX_ROUNDS'].every((c) => STATUS[c]))
try { loadConfig('configs/redblue-codex-author.json'); loadConfig('configs/leadworker-claude-lead.json'); check('两个示例配置加载', true) }
catch { check('两个示例配置加载', false) }
// 安全红线:配置带 key 必须被拒
import('./config.mjs').then(({ normalizeConfig }) => {
  let rejected = false
  try { normalizeConfig({ agents: { c: { kind: 'codex', provider: { api_key: 'x' } } } }) } catch { rejected = true }
  check('配置带 key 被拒(安全红线)', rejected)

  console.log(`\n━━━ 验收结果:${groups - fails}/${groups} 通过 ━━━`)
  console.log(fails ? '✗ 有失败项' : '✓ 完全体确定性验收全过(真 CLI 双端验收:node src/matrix.mjs --allow-network)')
  process.exit(fails ? 1 : 0)
})
