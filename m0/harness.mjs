// m0/harness.mjs —— M0 可行性闸探针的公共底座
// 提供:两端 CLI 真 exe 路径、spawn+stdin 捕获、标准结果结构、fixture 落盘、汇总与写回。
// 设计依据 PROBED-FACTS.md:直调真 exe + prompt 走 stdin;Node 直接捕获 stdout(不用 shell 重定向)。
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(fileURLToPath(import.meta.url))
export const RESULTS_DIR = join(ROOT, 'probe-results')
export const FIXTURES_DIR = join(ROOT, 'fixtures')
export const PROBED_FACTS = join(ROOT, '..', 'docs', 'PROBED-FACTS.md')

// 两端真实可执行文件(PROBED-FACTS A 节 / claude.ps1 实测)
export const CODEX_EXE =
  'G:\\npm-global\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
export const CLAUDE_EXE =
  'G:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'

for (const d of [RESULTS_DIR, FIXTURES_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })

// spawn 真 exe,prompt 走 stdin,捕获 stdout/stderr/耗时。windowsHide 防弹窗。
export function spawnCapture(exe, args, stdin = null, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let out = '', err = '', done = false
    const child = spawn(exe, args, { windowsHide: true })
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill('SIGKILL') } catch {} ; resolve({ code: null, out, err, ms: Date.now() - t0, timedOut: true }) }
    }, timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out, err: err + '\n[spawn error] ' + e.message, ms: Date.now() - t0, spawnError: true }) } })
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - t0 }) } })
    if (stdin != null) child.stdin.write(stdin)
    child.stdin.end()
  })
}

// 解析 JSONL 事件流(codex --json)
export function parseEvents(stdout) {
  const ev = []
  for (const line of String(stdout).split(/\r?\n/)) {
    const s = line.trim(); if (!s) continue
    try { ev.push(JSON.parse(s)) } catch {}
  }
  return ev
}

// 落盘原始证据(stdout/stderr/jsonl/任意文本),返回相对 evidencePath
export function saveFixture(probeId, name, content) {
  const fname = `${probeId}__${name}`
  const full = join(FIXTURES_DIR, fname)
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  return join('fixtures', fname).replace(/\\/g, '/')
}

// 标准探针结果结构:status ∈ pass|fail|inconclusive
export function makeResult(id, { title, severity, status, summary, evidencePath = [], metrics = {}, nextAction = '' }) {
  return { id, title, severity, status, summary, evidencePath: [].concat(evidencePath), metrics, nextAction, ts: new Date().toISOString() }
}

export function writeResult(res) {
  writeFileSync(join(RESULTS_DIR, `${res.id}.json`), JSON.stringify(res, null, 2))
  return res
}

export function readAllResults() {
  if (!existsSync(RESULTS_DIR)) return []
  return readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) } catch { return null } })
    .filter(Boolean)
}
