// src/status.mjs —— sylux 统一状态码分类(失败必须落到明确 code,不许糊成"运行失败")
// 对齐 docs 错误码精神;每个码带:transient(是否可重试)、severity、一句话语义。
export const STATUS = {
  OK: { transient: false, severity: 'info', desc: '正常完成' },

  // —— 中转/网络类(transient,退避重试)——
  RELAY_5XX: { transient: true, severity: 'warn', desc: '中转 5xx/Bad Gateway/Reconnecting(上游抽风)' },
  SUBPROCESS_TIMEOUT: { transient: true, severity: 'warn', desc: '子进程超时被 kill(中转慢或卡死)' },
  EMPTY_OUTPUT: { transient: true, severity: 'warn', desc: '空输出(多为瞬时打嗝)' },
  RATE_LIMITED: { transient: true, severity: 'warn', desc: '429 限流' },

  // —— 输出/契约类(部分可重试)——
  NON_JSON_OUTPUT: { transient: true, severity: 'warn', desc: '期望 JSON 却拿到非 JSON(可能瞬时,也可能人格污染)' },
  OUTPUT_SCHEMA_VIOLATION: { transient: true, severity: 'warn', desc: 'safeParse 不过 schema(claude --json-schema 不强制已坐实,带错重发)' },

  // —— 硬失败(不重试)——
  ADAPTER_SPAWN_FAILED: { transient: false, severity: 'error', desc: 'exe 不存在/spawn 失败(一端不可用)' },
  AGENT_EXIT_NONZERO: { transient: false, severity: 'error', desc: '子进程非零退出(参数错/CLI 内部错)' },
  API_ERROR: { transient: false, severity: 'error', desc: '上游 API 明确报错(鉴权/额度/模型不可用)' },
  ADAPTER_UNAVAILABLE: { transient: false, severity: 'error', desc: '该端被显式禁用或重试耗尽仍不可用' },

  // —— 编排类 ——
  CONVERGED: { transient: false, severity: 'info', desc: 'critic 判 done,收敛停' },
  CONVERGENCE_STALL: { transient: false, severity: 'info', desc: '连续 N 轮无新强指纹(原地打转),停滞收口' },
  MAX_ROUNDS: { transient: false, severity: 'info', desc: '达最大轮数停' },
}

export function isKnown(code) { return Object.prototype.hasOwnProperty.call(STATUS, code) }
export function isTransientCode(code) { return !!STATUS[code]?.transient }

// 把原始错误文本归类到状态码(集中一处,避免散落的正则)
export function classifyError(text) {
  const s = String(text || '')
  if (/\b429\b|Too Many|rate.?limit/i.test(s)) return 'RATE_LIMITED'
  if (/50[0-9]\b|Bad Gateway|Reconnecting|Service Unavailable|Upstream/i.test(s)) return 'RELAY_5XX'
  if (/timed? ?out|timeout|ETIMEDOUT|超时/i.test(s)) return 'SUBPROCESS_TIMEOUT'
  if (/空输出|empty output/i.test(s)) return 'EMPTY_OUTPUT'
  if (/非 JSON|non.?json|Unexpected token/i.test(s)) return 'NON_JSON_OUTPUT'
  if (/schema|safeParse|不合 schema/i.test(s)) return 'OUTPUT_SCHEMA_VIOLATION'
  if (/spawn|ENOENT|not a valid Win32|exe 不存在/i.test(s)) return 'ADAPTER_SPAWN_FAILED'
  if (/exit [1-9]|non.?zero|exit code/i.test(s)) return 'AGENT_EXIT_NONZERO'
  if (/api error|is_error|unauthorized|forbidden|invalid api key|额度|quota/i.test(s)) return 'API_ERROR'
  return 'ADAPTER_UNAVAILABLE'
}
