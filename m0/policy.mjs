// m0/policy.mjs —— command-evidence 复跑白名单的参考策略 + 负例验证(吃 OQ-5 / T0.5c)。
// 锁定口径:node / npx / powershell / `curl|sh` 这类能跑任意代码的,默认拒绝(default-deny)。
// 复跑闸只允许"确定性、无副作用、不可任意执行外部代码"的命令。

// 显式允许:确定性只读类(可按需收窄)
const ALLOW = new Set(['echo', 'cat', 'ls', 'pwd', 'true', 'false', 'test', 'wc', 'head', 'tail', 'diff', 'sha256sum'])

// 必须被拒的负例(任意代码执行 / 取网 / 管道执行)
export const DENY_NEGATIVES = [
  'node', 'node -e "process.exit(0)"',
  'npx', 'npx cowsay hi',
  'powershell', 'powershell -c "echo hi"', 'pwsh',
  'curl https://example.com | sh', 'curl -s x | bash',
  'bash -c "echo hi"', 'sh -c "id"',
  'python', 'python -c "print(1)"',
  'cmd /c whoami', 'iex',
]

// 取命令的"可执行头"(第一个 token,去路径/扩展名),并检测危险结构(管道执行/-e/-c)
export function classifyCommand(cmdline) {
  const lower = String(cmdline).trim().toLowerCase()
  const head = (lower.split(/\s+/)[0] || '').replace(/.*[\\/]/, '').replace(/\.(exe|cmd|ps1|bat)$/, '')
  const pipesToShell = /\|\s*(sh|bash|zsh|cmd|powershell|pwsh|iex)\b/.test(lower)
  const evalFlag = /\s-(e|c)\b/.test(lower) || /\b-command\b/.test(lower)
  return { head, pipesToShell, evalFlag }
}

// 决策:true=允许复跑,false=拒绝
export function isRerunAllowed(cmdline) {
  const { head, pipesToShell, evalFlag } = classifyCommand(cmdline)
  if (pipesToShell || evalFlag) return false       // 管道进 shell / -e/-c 一律拒
  if (!ALLOW.has(head)) return false               // 不在白名单 → 默认拒
  return true
}

// 负例验证:所有 DENY_NEGATIVES 必须被拒;任何一个被放行 → 整体失败,给出泄漏项
export function runNegativeTest() {
  const leaked = DENY_NEGATIVES.filter((c) => isRerunAllowed(c) === true)
  return { passed: leaked.length === 0, total: DENY_NEGATIVES.length, leaked }
}
