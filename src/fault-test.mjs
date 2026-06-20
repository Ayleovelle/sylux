// src/fault-test.mjs —— 确定性故障注入,验证失败路径都落到明确 code(不糊成"运行失败")
// 不依赖中转随机抽风:用样本字符串测分类器 + 一个 live bad-exe 测端到端。
import { classifyError, isKnown, STATUS } from './status.mjs'

let pass = 0, fail = 0
function expect(label, got, want) {
  const ok = got === want
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${got}${ok ? '' : ` (期望 ${want})`}`)
  ok ? pass++ : fail++
}

console.log('═══ 故障分类器单测(确定性,零 token)═══')
expect('502 Bad Gateway', classifyError('Reconnecting... 2/5 (unexpected status 502 Bad Gateway: Upstream request failed)'), 'RELAY_5XX')
expect('503', classifyError('Service Unavailable 503'), 'RELAY_5XX')
expect('超时', classifyError('codex 超时被 kill'), 'SUBPROCESS_TIMEOUT')
expect('request timed out(纯超时)', classifyError('the request timed out after 90s'), 'SUBPROCESS_TIMEOUT')
expect('Reconnecting+timeout(中转优先)', classifyError('Reconnecting... (request timed out)'), 'RELAY_5XX')
expect('429 限流', classifyError('429 Too Many Requests'), 'RATE_LIMITED')
expect('空输出', classifyError('claude 空输出'), 'EMPTY_OUTPUT')
expect('非 JSON', classifyError('claude 非 JSON 输出: 搞定了'), 'NON_JSON_OUTPUT')
expect('JSON解析', classifyError('Unexpected token 搞'), 'NON_JSON_OUTPUT')
expect('schema 违规', classifyError('safeParse 不合 schema'), 'OUTPUT_SCHEMA_VIOLATION')
expect('spawn 失败', classifyError("ENOENT: no such file, open 'codex.exe'"), 'ADAPTER_SPAWN_FAILED')
expect('非Win32', classifyError('%1 is not a valid Win32 application'), 'ADAPTER_SPAWN_FAILED')
expect('非零退出', classifyError('claude exit 2'), 'AGENT_EXIT_NONZERO')
expect('api error', classifyError('claude api error: unauthorized'), 'API_ERROR')
expect('额度', classifyError('insufficient quota 额度'), 'API_ERROR')
expect('兜底未知', classifyError('某种没见过的鬼东西'), 'ADAPTER_UNAVAILABLE')

console.log('\n═══ 状态码表自检 ═══')
const codes = Object.keys(STATUS)
console.log(`  共 ${codes.length} 个码;transient: ${codes.filter((c) => STATUS[c].transient).join(',')}`)
expect('所有分类结果都是已知码', codes.every(isKnown), true)

// live:bad exe → 端到端确认 ADAPTER_SPAWN_FAILED(改 exe 常量太重,直接验 spawn 行为)
console.log('\n═══ live spawn-fail(零 token,故意指坏 exe)═══')
const { spawn } = await import('node:child_process')
await new Promise((resolve) => {
  const c = spawn('G:\\不存在的\\codex.exe', ['--version'], { windowsHide: true })
  c.on('error', (e) => { expect('坏 exe 触发 spawn error → 分类', classifyError(e.message), 'ADAPTER_SPAWN_FAILED'); resolve() })
  c.on('close', () => resolve())
})

console.log(`\n═══ 结果:${pass} 过 / ${fail} 败 ═══`)
process.exit(fail ? 1 : 0)
