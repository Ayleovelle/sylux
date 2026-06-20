// src/adapters.mjs —— 两端 clean-room 适配器(M1)
// 焊死 M0 发现(PROBED-FACTS H.1):worker 必须干净房间,去全局人格污染。
//   codex: --ignore-user-config 绕开 avatar/AGENTS.md;直调真 exe + prompt 走 stdin(事实 A)。
//   claude: --append-system-prompt 强制 worker 角色压人格;直调真 exe。
//   两端: safeParse 兜底;5xx 当 transient 重试(H.2)。
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyError, isTransientCode } from './status.mjs'

// worker 干净工作区:codex 会从 -C 目录向上走树找 AGENTS.md/项目文档定位"仓库结构",
//   纯生成任务不该看见 G:\sylux 全仓(实测 input 飙到 13-17 万 token)。
//   放在仓库外的系统临时目录,向上走也走不到 G:\sylux——文件层面的 clean-room。
const SCRATCH_DIR = join(tmpdir(), 'sylux-scratch')
mkdirSync(SCRATCH_DIR, { recursive: true })

export const CODEX_EXE =
  'G:\\npm-global\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
export const CLAUDE_EXE =
  'G:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'

// fixture 落盘目录(每次进程调用的原始 stdout/stderr 存档,供回放/审计)
let FIXTURE_DIR = join(process.cwd(), 'runs', 'fixtures')
export function setFixtureDir(d) { FIXTURE_DIR = d; mkdirSync(d, { recursive: true }) }
let fxSeq = 0
function saveRaw(tag, { out, err, code, ms }) {
  try {
    mkdirSync(FIXTURE_DIR, { recursive: true })
    const name = `${String(++fxSeq).padStart(3, '0')}-${tag}.txt`
    const p = join(FIXTURE_DIR, name)
    writeFileSync(p, `# code=${code} ms=${ms}\n# ==== STDOUT ====\n${out || ''}\n# ==== STDERR ====\n${err || ''}`)
    return join('fixtures', name).replace(/\\/g, '/')
  } catch { return null }
}

function killTree(pid) {
  // SIGKILL 只杀父;codex/claude 经 .exe 还会派子进程,用 taskkill /T 杀整棵树清残留
  try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }) } catch {}
}

// doneMarker:出现该子串(如 codex 的 "turn.completed")即认为答案到手,提前结算,
//   不傻等进程 close(实测 codex.exe 在 turn.completed 后还逗留 ~40s 做退出清理)。
function spawnCapture(exe, args, stdin, timeoutMs = 75000, doneMarker = null) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let out = '', err = '', done = false
    const child = spawn(exe, args, { windowsHide: true })
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r) }
    const timer = setTimeout(() => { try { killTree(child.pid); child.kill('SIGKILL') } catch {} ; finish({ code: null, out, err, ms: Date.now() - t0, timedOut: true }) }, timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      out += d
      // 答案已到 → 提前结算 + 杀掉逗留进程,省掉 ~40s 退出尾巴
      if (doneMarker && !done && out.includes(doneMarker)) { try { killTree(child.pid); child.kill('SIGKILL') } catch {} ; finish({ code: 0, out, err, ms: Date.now() - t0, earlyDone: true }) }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => finish({ code: -1, out, err: err + ' [spawn] ' + e.message, ms: Date.now() - t0 }))
    child.on('close', (code) => finish({ code, out, err, ms: Date.now() - t0 }))
    if (stdin != null) child.stdin.write(stdin)
    child.stdin.end()
  })
}

// 通用重试:按状态码 transient 决定退避重试。失败结果一律带 code。
// fastFailCodes:这些码即便 transient 也只重试一次就放弃(中转整段宕机时别干等 5 分钟)。
async function withRetry(fn, attempts = 3, fastFail = new Set()) {
  let last
  for (let a = 1; a <= attempts; a++) {
    const r = await fn()
    if (r.ok) return r
    r.code = r.code || classifyError(r.error)
    last = r
    const cap = fastFail.has(r.code) ? 2 : attempts
    if (a < cap && isTransientCode(r.code)) { await new Promise((x) => setTimeout(x, [4000, 12000, 30000][a - 1] || 30000)); continue }
    return r
  }
  return last
}

function parseEvents(out) {
  const ev = []
  for (const l of String(out).split(/\r?\n/)) { const s = l.trim(); if (!s) continue; try { ev.push(JSON.parse(s)) } catch {} }
  return ev
}

// ── codex clean-room 适配器 ──
// 返回 { ok, text, threadId, usage, code, error, fixturePath }
// clean-room 正解(PROBED-FACTS H.1):--ignore-user-config 甩掉 skills/AGENTS.md/人格包袱,
//   再用 -c 显式注入 provider(否则丢 base_url 拨默认端点超时)。auth.json 在
//   --ignore-user-config 下仍走 CODEX_HOME,key 不受影响。worker 降 reasoning_effort 省时。
const CODEX_PROVIDER_DEFAULT = {
  model: 'gpt-5.5',
  reasoning_effort: 'medium',
  name: 'your-relay',
  base_url: 'https://your-relay.example.com',
  wire_api: 'responses',
  requires_openai_auth: true,
}
// 把 provider 配置编成 codex 的 -c 注入数组。key 绝不进此处(走 CODEX_HOME/auth.json)。
function buildCodexProvider(p = {}) {
  const c = { ...CODEX_PROVIDER_DEFAULT, ...p }
  return [
    '-c', 'model_provider=custom',
    '-c', 'model=' + c.model,
    '-c', 'model_reasoning_effort=' + c.reasoning_effort,
    '-c', 'model_providers.custom.name=' + c.name,
    '-c', 'model_providers.custom.base_url=' + c.base_url,
    '-c', 'model_providers.custom.wire_api=' + c.wire_api,
    '-c', 'model_providers.custom.requires_openai_auth=' + c.requires_openai_auth,
    '-c', 'mcp_servers={}', '-c', 'notify=[]',
  ]
}
export async function codexAsk({ prompt, systemPreamble = '', provider = null, timeoutMs = 120000 }) {
  const full = systemPreamble ? systemPreamble + '\n\n---\n\n' + prompt : prompt
  const PROV = buildCodexProvider(provider)
  return withRetry(async () => {
    const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', ...PROV, '-C', SCRATCH_DIR, '-']
    const r = await spawnCapture(CODEX_EXE, args, full, timeoutMs, '"type":"turn.completed"')  // 答案到手即结算,省退出尾巴
    const fixturePath = saveRaw('codex', r)
    const ev = parseEvents(r.out)
    const errEv = ev.find((e) => e.type === 'error')
    if (errEv) return { ok: false, code: classifyError(errEv.message), error: errEv.message, fixturePath }
    if (r.timedOut) return { ok: false, code: 'SUBPROCESS_TIMEOUT', error: 'codex 超时被 kill', fixturePath }
    if (r.code !== 0 && r.code !== null) return { ok: false, code: 'AGENT_EXIT_NONZERO', error: 'codex exit ' + r.code + ' ' + r.err.slice(0, 200), fixturePath }
    const msg = ev.find((e) => e.item?.type === 'agent_message' || e.item?.text)
    const usage = ev.find((e) => e.type === 'turn.completed')?.usage ?? null
    const text = msg?.item?.text ?? null
    if (!text) return { ok: false, code: 'EMPTY_OUTPUT', error: 'codex 无消息输出(空输出)', fixturePath }
    return { ok: true, code: 'OK', text, usage, fixturePath }
  }, 3, new Set(['RELAY_5XX', 'SUBPROCESS_TIMEOUT']))
}

// ── claude clean-room 适配器 ──
// 用 --append-system-prompt 压人格;--output-format json 取 result。
export async function claudeAsk({ prompt, systemPreamble = '', provider = null, timeoutMs = 75000 }) {
  return withRetry(async () => {
    const args = ['-p', '--output-format', 'json']
    if (provider?.model) { args.push('--model', provider.model) }
    if (systemPreamble) { args.push('--append-system-prompt', systemPreamble) }
    args.push('--session-id', cryptoUuid())
    args.push(prompt)
    const r = await spawnCapture(CLAUDE_EXE, args, null, timeoutMs)
    const fixturePath = saveRaw('claude', r)
    if (r.timedOut) return { ok: false, code: 'SUBPROCESS_TIMEOUT', error: 'claude 超时被 kill', fixturePath }
    if (r.code !== 0 && r.code !== null) return { ok: false, code: 'AGENT_EXIT_NONZERO', error: 'claude exit ' + r.code + ' ' + r.err.slice(0, 200), fixturePath }
    if (!r.out || !r.out.trim()) return { ok: false, code: 'EMPTY_OUTPUT', error: 'claude 空输出', fixturePath }
    let j
    try { j = JSON.parse(r.out) } catch (e) { return { ok: false, code: 'NON_JSON_OUTPUT', error: 'claude 非 JSON 输出: ' + r.out.slice(0, 120), fixturePath } }
    if (j.is_error || j.api_error_status) return { ok: false, code: 'API_ERROR', error: 'claude api error: ' + (j.api_error_status || j.subtype), fixturePath }
    const text = typeof j.result === 'string' ? j.result : JSON.stringify(j.result)
    const usage = j.usage ? { input_tokens: j.usage.input_tokens, output_tokens: j.usage.output_tokens } : null
    return { ok: true, code: 'OK', text, usage, fixturePath }
  }, 3)
}

function cryptoUuid() {
  // Node 22 全局 crypto
  return globalThis.crypto?.randomUUID?.() ?? ('00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12))
}

// 可复用的轻量健康检查:最小调用,返回 { ok, code, sec }。预检/health 共用。
const ASK_MAP = { codex: codexAsk, claude: claudeAsk }
export async function quickHealth(agent) {
  const fn = ASK_MAP[agent]
  if (!fn) return { ok: false, code: 'ADAPTER_UNAVAILABLE', sec: 0 }
  const t0 = Date.now()
  const r = await fn({ prompt: '回复:ok', systemPreamble: '只回一个词,不要解释。' })
  return { ok: !!r?.ok, code: r?.code || (r?.ok ? 'OK' : 'ADAPTER_UNAVAILABLE'), sec: ((Date.now() - t0) / 1000).toFixed(0) }
}

