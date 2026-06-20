// src/config.mjs —— sylux 配置层。零依赖 JSON,Node 原生解析。
// 让 agents(provider/model/base_url/effort/timeout)、playbook、roles、stop 全可配。
// 安全红线:配置里绝不允许出现 key/token/secret —— 凭证只走 CODEX_HOME/auth.json 与环境变量。
//   解析时主动扫描并拒绝,防止用户把 key 写进可能被提交/截图的 config 文件。
import { readFileSync } from 'node:fs'

// 默认配置:不给 --config 时的内置行为,等价于旧 run.mjs 的硬编码。
export const DEFAULT_CONFIG = {
  agents: {
    codex: { kind: 'codex', timeoutMs: 120000 },
    claude: { kind: 'claude', timeoutMs: 75000 },
  },
  playbook: 'red-blue',
  roles: { a: 'codex', b: 'claude' },
  stop: { maxRounds: 6, convergence: true },
}

const VALID_KINDS = new Set(['codex', 'claude'])
const VALID_PLAYBOOKS = new Set(['red-blue', 'lead-worker', 'pair', 'divide-parallel'])
// provider 里允许出现的字段(白名单),其余一律拒绝,顺带挡住 key 类字段。
const PROVIDER_ALLOWED = new Set(['model', 'reasoning_effort', 'name', 'base_url', 'wire_api', 'requires_openai_auth'])
// 任何 key 出现这些子串即判为凭证,拒绝。
const SECRET_HINT = /key|token|secret|password|passwd|credential|auth.*=|bearer|api[_-]?key/i

function fail(msg) { throw new Error('[config] ' + msg) }

// 深扫对象,若任何键名疑似凭证则拒绝(value 不看,只看键名 + 明显的 sk- 形态值)。
function assertNoSecrets(obj, path = 'config') {
  if (obj == null || typeof obj !== 'object') {
    if (typeof obj === 'string' && /^sk-[A-Za-z0-9_-]{16,}/.test(obj)) {
      fail(`${path} 的值疑似 API key(sk-...)。凭证禁止写进配置,只能放 auth.json / 环境变量。`)
    }
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_HINT.test(k)) fail(`字段 ${path}.${k} 疑似凭证。凭证禁止写进配置,只能放 CODEX_HOME/auth.json 或环境变量。`)
    assertNoSecrets(v, `${path}.${k}`)
  }
}

function validateProvider(p, name) {
  if (p == null) return undefined
  if (typeof p !== 'object' || Array.isArray(p)) fail(`agents.${name}.provider 必须是对象`)
  for (const k of Object.keys(p)) {
    if (!PROVIDER_ALLOWED.has(k)) fail(`agents.${name}.provider.${k} 不是允许的字段(允许:${[...PROVIDER_ALLOWED].join(', ')})。注意 key 不在此列——凭证走 auth.json。`)
  }
  return p
}

// 把原始对象规整成完整 config,缺省用 DEFAULT_CONFIG 补齐,并做强校验。
export function normalizeConfig(raw) {
  assertNoSecrets(raw)
  const cfg = { ...DEFAULT_CONFIG, ...raw }

  // agents
  const agents = raw.agents || DEFAULT_CONFIG.agents
  if (typeof agents !== 'object' || Array.isArray(agents)) fail('agents 必须是对象(name -> spec)')
  const normAgents = {}
  for (const [name, spec] of Object.entries(agents)) {
    if (typeof spec !== 'object') fail(`agents.${name} 必须是对象`)
    const kind = spec.kind || name
    if (!VALID_KINDS.has(kind)) fail(`agents.${name}.kind=${kind} 无效(只支持 ${[...VALID_KINDS].join('/')})`)
    const provider = validateProvider(spec.provider, name)
    const timeoutMs = spec.timeoutMs != null ? Number(spec.timeoutMs) : (kind === 'codex' ? 120000 : 75000)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail(`agents.${name}.timeoutMs 必须是正数`)
    normAgents[name] = { kind, provider, timeoutMs }
  }
  cfg.agents = normAgents

  // playbook
  cfg.playbook = raw.playbook || DEFAULT_CONFIG.playbook
  if (!VALID_PLAYBOOKS.has(cfg.playbook)) fail(`playbook=${cfg.playbook} 无效(${[...VALID_PLAYBOOKS].join(' / ')})`)

  // roles:a/b 指向 agents 注册表里的名字
  cfg.roles = { ...DEFAULT_CONFIG.roles, ...(raw.roles || {}) }
  for (const slot of ['a', 'b']) {
    if (!normAgents[cfg.roles[slot]]) fail(`roles.${slot}=${cfg.roles[slot]} 未在 agents 注册`)
  }

  // stop
  cfg.stop = { ...DEFAULT_CONFIG.stop, ...(raw.stop || {}) }
  cfg.stop.maxRounds = Number(cfg.stop.maxRounds)
  if (!Number.isInteger(cfg.stop.maxRounds) || cfg.stop.maxRounds < 1) fail('stop.maxRounds 必须是 >=1 的整数')
  cfg.stop.convergence = cfg.stop.convergence !== false

  return cfg
}

// 从文件加载并规整。文件不存在/非 JSON 都给清楚报错。
export function loadConfig(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) { fail(`读不到配置文件 ${path}: ${e.message}`) }
  let raw
  try { raw = JSON.parse(text) } catch (e) { fail(`配置文件不是合法 JSON: ${e.message}`) }
  return normalizeConfig(raw)
}

// CLI flag 覆盖 config(命令行优先级最高):--playbook/--a/--b/--max
export function applyOverrides(cfg, flags) {
  const out = JSON.parse(JSON.stringify(cfg))
  if (flags.playbook) { if (!VALID_PLAYBOOKS.has(flags.playbook)) fail(`--playbook ${flags.playbook} 无效`); out.playbook = flags.playbook }
  for (const [slot, key] of [['a', 'a'], ['b', 'b']]) {
    const v = flags[key]
    if (v) {
      if (!out.agents[v]) {
        if (!VALID_KINDS.has(v)) fail(`--${slot}=${v} 既不是已注册 agent 也不是合法 kind`)
        out.agents[v] = { kind: v, provider: undefined, timeoutMs: v === 'codex' ? 120000 : 75000 }
      }
      out.roles[slot] = v
    }
  }
  if (flags.max) { const m = parseInt(flags.max, 10); if (m >= 1) out.stop.maxRounds = m }
  return out
}
