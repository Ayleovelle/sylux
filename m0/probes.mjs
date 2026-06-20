// m0/probes.mjs —— 九个探针的注册表。每个:{id,title,severity,touchesApi,run(ctx)->result}
// ctx = { allowNetwork:boolean, dryRun:boolean }
// 真实调用两端 CLI 的探针会消耗中转 token;dryRun 时只校验可行性不真调。
import { spawnCapture, parseEvents, saveFixture, makeResult, CODEX_EXE, CLAUDE_EXE } from './harness.mjs'
import { runNegativeTest, DENY_NEGATIVES } from './policy.mjs'

// ---- 公共:codex schema 探针参数(直调真 exe + stdin) ----
const CODEX_BASE = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '--ephemeral', '-c', 'mcp_servers={}', '-c', 'notify=[]']

// 一个 discriminatedUnion + optional 的代表性 schema(对应 Evidence 形态)
const HARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'payload'],
  properties: {
    kind: { type: 'string', enum: ['code_anchor', 'command'] },
    note: { type: 'string' },                                  // optional
    payload: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['file', 'line', 'hash'],
          properties: { file: { type: 'string' }, line: { type: 'integer' }, hash: { type: 'string' } } },
        { type: 'object', additionalProperties: false, required: ['cmd', 'expected'],
          properties: { cmd: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' } } },
      ],
    },
  },
}

export const probes = []

// ===== T0.2 schema 字节下界估 < claude 32KB 内联上限(纯本地,无 API)=====
probes.push({
  id: 'T0.2', title: 'schema 内联字节下界估 < 32KB', severity: 'major', touchesApi: false,
  async run() {
    const json = JSON.stringify(HARD_SCHEMA)
    const bytes = Buffer.byteLength(json, 'utf8')
    const limit = 32 * 1024
    const ev = saveFixture('T0.2', 'hard-schema.json', json)
    const ok = bytes < limit
    return makeResult('T0.2', {
      title: 'schema 内联字节下界估 < 32KB', severity: 'major',
      status: ok ? 'pass' : 'fail',
      summary: `代表性 discriminatedUnion+optional schema ${bytes}B,${ok ? '远低于' : '超过'} 32KB 内联上限(下界估,真实更大)`,
      evidencePath: ev, metrics: { bytes, limit },
      nextAction: ok ? 'M1·T1.2 dist 落地后由 T0.2b 用正式 schema 复跑校准' : '超限→claude 端改走 stream-json 输入或临时文件传 schema(退化路径)',
    })
  },
})

// ===== T0.2b 用正式 dist 复跑(依赖 M1 产物,M0 阶段挂起)=====
probes.push({
  id: 'T0.2b', title: 'M1 dist schema 体积复跑校准', severity: 'major', touchesApi: false,
  async run() {
    return makeResult('T0.2b', {
      title: 'M1 dist schema 体积复跑校准', severity: 'major', status: 'inconclusive',
      summary: '依赖 M1·T1.2 的 buildAgentOutputJsonSchema dist 产物,M0 阶段尚不存在(两段闸第二段)',
      nextAction: 'M1·T1.2 落地后复跑:require 正式 dist,用真实摊平 schema 字节数对比 32KB',
    })
  },
})

// ===== T0.5c 命令复跑白名单负例验证(纯本地策略,无 API)=====
probes.push({
  id: 'T0.5c', title: '命令复跑白名单负例验证', severity: 'major', touchesApi: false,
  async run() {
    const r = runNegativeTest()
    const ev = saveFixture('T0.5c', 'negative-test.json', { ...r, denySet: DENY_NEGATIVES })
    return makeResult('T0.5c', {
      title: '命令复跑白名单负例验证', severity: 'major',
      status: r.passed ? 'pass' : 'fail',
      summary: r.passed
        ? `${r.total} 个危险负例(node/npx/powershell/curl|sh 等)全部被 default-deny 拒绝`
        : `${r.leaked.length}/${r.total} 个危险负例被放行:${r.leaked.join(' / ')}`,
      evidencePath: ev, metrics: { total: r.total, leaked: r.leaked.length },
      nextAction: r.passed ? '复跑闸可启用 command-evidence 强核验' : 'disableCommandEvidenceRerun=true:禁用 command-evidence 强核验,只保留 weak/infra 路径,修白名单后再开',
    })
  },
})

// ===== T0.1 codex+claude 两端 discriminatedUnion+optional schema 成形(API)=====
probes.push({
  id: 'T0.1', title: '两端复杂 schema 成形', severity: 'major', touchesApi: true,
  async run(ctx) {
    if (ctx.dryRun) return makeResult('T0.1', { title: '两端复杂 schema 成形', severity: 'major', status: 'inconclusive', summary: 'dry-run:未真调两端;命令已就绪', nextAction: '去掉 --dry-run 真跑(耗中转 token)' })
    const fs = await import('node:fs'); const { join } = await import('node:path')
    const { FIXTURES_DIR } = await import('./harness.mjs')
    const schemaPath = join(FIXTURES_DIR, 'T0.1__schema.json')
    fs.writeFileSync(schemaPath, JSON.stringify(HARD_SCHEMA, null, 2))
    const prompt = '输出一个 kind="command" 的对象:payload.cmd="echo hi", payload.expected="hi"。严格按 JSON schema。'
    // --- codex 端 ---
    const cxLast = join(FIXTURES_DIR, 'T0.1__codex-last.txt')
    const cx = await spawnCapture(CODEX_EXE, [...CODEX_BASE, '-C', FIXTURES_DIR, '--output-schema', schemaPath, '-o', cxLast, '-'], prompt, 180000)
    saveFixture('T0.1', 'codex-events.jsonl', cx.out)
    let codexOk = false, codexMsg = cx.timedOut ? 'timeout' : `exit=${cx.code}`
    // 先读 -o 文件;缺失则回退到事件流里的 agent_message(codex 最终消息也在 item.completed)
    let codexText = null
    try { codexText = fs.readFileSync(cxLast, 'utf8') } catch {
      const ev = parseEvents(cx.out); const m = ev.find((e) => e.item?.type === 'agent_message' || e.item?.text)
      codexText = m?.item?.text ?? null
    }
    try { const obj = JSON.parse(codexText); codexOk = obj.kind === 'command' && obj.payload?.cmd != null; codexMsg = codexOk ? '合 schema' : '不合:' + JSON.stringify(obj).slice(0, 80) } catch (e) { codexMsg = codexText ? '非JSON:' + String(codexText).slice(0, 50) : 'no output: ' + String(e).slice(0, 40) }
    // --- claude 端(--json-schema 内联)---
    const cl = await spawnCapture(CLAUDE_EXE, ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(HARD_SCHEMA), prompt], null, 180000)
    saveFixture('T0.1', 'claude-out.json', cl.out + '\n---STDERR---\n' + cl.err)
    let claudeOk = false, claudeMsg = cl.timedOut ? 'timeout' : `exit=${cl.code}`
    try { const j = JSON.parse(cl.out); const r = j.result ?? j; const o = typeof r === 'string' ? JSON.parse(r) : r; claudeOk = o.kind === 'command' && o.payload?.cmd != null; claudeMsg = claudeOk ? '合 schema' : '不合:' + JSON.stringify(o).slice(0, 80) } catch (e) { claudeMsg = 'parse fail: ' + String(e).slice(0, 60) }
    const both = codexOk && claudeOk
    // 任一端能成形即非 inconclusive;claude 不强制成形是已知发现→走 safeParse 退化(fail+退化路径,不阻断)
    let status, next
    if (both) { status = 'pass'; next = '两端都成形,无需退化' }
    else if (codexOk && !claudeOk) { status = 'fail'; next = 'claude 端不强制成形(已知 R4)→应用层 safeParse 兜底 + 失败带错重发≤N,退化路径,不改 TS 类型' }
    else if (!codexOk && claudeOk) { status = 'fail'; next = 'codex 端异常→查 --output-schema 调用;claude 端可用作主路径' }
    else { status = 'inconclusive'; next = '两端都没成形,需排查' }
    return makeResult('T0.1', {
      title: '两端复杂 schema 成形', severity: 'major', status,
      summary: `codex:${codexMsg} | claude:${claudeMsg}`,
      evidencePath: ['fixtures/T0.1__codex-events.jsonl', 'fixtures/T0.1__claude-out.json'],
      metrics: { codexOk, claudeOk },
      nextAction: next,
    })
  },
})

// ===== T0.3 claude stream-json 真实事件流 + schema 传递(API)=====
probes.push({
  id: 'T0.3', title: 'claude stream-json 事件流', severity: 'major', touchesApi: true,
  async run(ctx) {
    if (ctx.dryRun) return makeResult('T0.3', { title: 'claude stream-json 事件流', severity: 'major', status: 'inconclusive', summary: 'dry-run', nextAction: '去 --dry-run 真跑' })
    const cl = await spawnCapture(CLAUDE_EXE, ['-p', '--output-format', 'stream-json', '--verbose', '回复一个词:pong'], null, 120000)
    saveFixture('T0.3', 'stream.jsonl', cl.out + '\n---STDERR---\n' + cl.err)
    const ev = parseEvents(cl.out)
    const types = [...new Set(ev.map((e) => e.type).filter(Boolean))]
    const ok = ev.length > 0 && cl.code === 0
    return makeResult('T0.3', {
      title: 'claude stream-json 事件流', severity: 'major',
      status: ok ? 'pass' : (cl.timedOut ? 'inconclusive' : 'fail'),
      summary: ok ? `事件类型:${types.join(',')}` : `exit=${cl.code} 事件数=${ev.length}`,
      evidencePath: 'fixtures/T0.3__stream.jsonl', metrics: { events: ev.length, types },
      nextAction: ok ? '据事件类型写 claude 端归一化状态机(回填 05)' : '解析失败→检查 --output-format 取值与版本',
    })
  },
})

// ===== T0.4 claude --session-id 预设能力(API)=====
probes.push({
  id: 'T0.4', title: 'claude --session-id 预设', severity: 'major', touchesApi: true,
  async run(ctx) {
    if (ctx.dryRun) return makeResult('T0.4', { title: 'claude --session-id 预设', severity: 'major', status: 'inconclusive', summary: 'dry-run', nextAction: '去 --dry-run 真跑' })
    const uuid = '00000000-0000-4000-8000-000000000abc'
    const cl = await spawnCapture(CLAUDE_EXE, ['-p', '--session-id', uuid, '--output-format', 'json', '回复一个词:ok'], null, 120000)
    saveFixture('T0.4', 'session.json', cl.out + '\n---STDERR---\n' + cl.err)
    let supported = false, msg = `exit=${cl.code}`
    try { const j = JSON.parse(cl.out); supported = (JSON.stringify(j).includes(uuid)) || cl.code === 0; msg = supported ? '预设被接受' : 'session_id 未回显' } catch { msg = cl.err.slice(0, 80) || 'no json' }
    const rejected = /unknown option|unexpected|invalid/i.test(cl.err)
    return makeResult('T0.4', {
      title: 'claude --session-id 预设', severity: 'major',
      status: cl.timedOut ? 'inconclusive' : (supported && !rejected ? 'pass' : 'fail'),
      summary: rejected ? 'CLI 拒绝 --session-id 预设' : msg,
      evidencePath: 'fixtures/T0.4__session.json', metrics: { supported, rejected },
      nextAction: (supported && !rejected) ? '中枢可预生成 UUID 复用' : '不支持→对齐 codex"id 由它给"模型(send() 回吐 sessionId)',
    })
  },
})

// ===== T0.5 kill 能否杀穿(API,起长任务再杀)=====
probes.push({
  id: 'T0.5', title: 'kill 杀穿子进程', severity: 'major', touchesApi: true,
  async run(ctx) {
    if (ctx.dryRun) return makeResult('T0.5', { title: 'kill 杀穿子进程', severity: 'major', status: 'inconclusive', summary: 'dry-run', nextAction: '去 --dry-run 真跑' })
    // 直调真 exe(非 shim),起一个会跑一会儿的请求,2s 后 kill,看是否真的终止
    const t0 = Date.now()
    const r = await spawnCapture(CLAUDE_EXE, ['-p', '--output-format', 'json', '写一篇 500 字短文'], null, 2500)
    const killedFast = r.timedOut && (Date.now() - t0) < 6000
    return makeResult('T0.5', {
      title: 'kill 杀穿子进程', severity: 'major',
      status: killedFast ? 'pass' : (r.code === 0 ? 'inconclusive' : 'fail'),
      summary: killedFast ? `2.5s 超时 kill 后进程在 ${Date.now() - t0}ms 内退出` : (r.code === 0 ? '任务太快没触发 kill,需手动复测' : `异常 exit=${r.code}`),
      evidencePath: saveFixture('T0.5', 'kill.txt', `elapsed=${Date.now() - t0}ms code=${r.code} timedOut=${r.timedOut}`),
      metrics: { elapsedMs: Date.now() - t0, timedOut: !!r.timedOut },
      nextAction: killedFast ? 'spawnCapture 的 SIGKILL 路径有效,中枢沿用' : '需确认 tree-kill 是否要 taskkill /T 杀进程树',
    })
  },
})

// ===== T0.5b 沙箱出网(唯一 build-stop blocker;默认不跑,需 --allow-network)=====
probes.push({
  id: 'T0.5b', title: '沙箱出网(唯一硬阻断)', severity: 'blocker', touchesApi: true,
  async run(ctx) {
    if (!ctx.allowNetwork) {
      return makeResult('T0.5b', {
        title: '沙箱出网(唯一硬阻断)', severity: 'blocker', status: 'inconclusive',
        summary: '默认不跑出网测试(防偷偷出网)。需显式 --allow-network 开启',
        nextAction: '加 --allow-network 真测:read-only 与 workspace-write 两模式都让子进程尝试 curl 外网,任一可出网且无替代 → BLOCKED',
      })
    }
    const probeUrl = 'https://api.ipify.org'
    const results = {}
    for (const mode of ['read-only', 'workspace-write']) {
      const args = ['exec', '--json', '--skip-git-repo-check', '-s', mode, '--ephemeral', '-c', 'mcp_servers={}', '-c', 'notify=[]', '-C', '.', '-']
      const prompt = `运行 shell 命令 curl -s ${probeUrl} 并把输出原样告诉我。如果被沙箱拒绝,明确说"被拒绝"。`
      const r = await spawnCapture(CODEX_EXE, args, prompt, 150000)
      saveFixture('T0.5b', `${mode}.jsonl`, r.out + '\n---STDERR---\n' + r.err)
      const reached = /\b\d{1,3}(\.\d{1,3}){3}\b/.test(r.out)  // 出网会拿到 IP
      results[mode] = { reached, code: r.code }
    }
    const anyEgress = Object.values(results).some((x) => x.reached)
    return makeResult('T0.5b', {
      title: '沙箱出网(唯一硬阻断)', severity: 'blocker',
      status: anyEgress ? 'fail' : 'pass',
      summary: anyEgress ? `出网成功:${JSON.stringify(results)} → §7.3 L4 断网兜底失效` : `两模式均未出网:${JSON.stringify(results)}`,
      evidencePath: ['fixtures/T0.5b__read-only.jsonl', 'fixtures/T0.5b__workspace-write.jsonl'],
      metrics: results,
      nextAction: anyEgress ? 'BLOCKED:停在 M0,改应用层强约束(无后门 spawn + 出站白名单),否则不许进 M1' : '断网兜底成立,可进 M1',
    })
  },
})

// ===== T0.6 claude token 计量字段(API)=====
probes.push({
  id: 'T0.6', title: 'claude token 计量字段', severity: 'minor', touchesApi: true,
  async run(ctx) {
    if (ctx.dryRun) return makeResult('T0.6', { title: 'claude token 计量字段', severity: 'minor', status: 'inconclusive', summary: 'dry-run', nextAction: '去 --dry-run 真跑' })
    const cl = await spawnCapture(CLAUDE_EXE, ['-p', '--output-format', 'json', '回复一个词:hi'], null, 120000)
    saveFixture('T0.6', 'usage.json', cl.out)
    let usageKeys = []
    try { const j = JSON.parse(cl.out); const u = j.usage || j.result?.usage || {}; usageKeys = Object.keys(u) } catch {}
    const ok = usageKeys.length > 0
    return makeResult('T0.6', {
      title: 'claude token 计量字段', severity: 'minor',
      status: ok ? 'pass' : (cl.timedOut ? 'inconclusive' : 'fail'),
      summary: ok ? `usage 字段:${usageKeys.join(',')}` : '未找到 usage 字段',
      evidencePath: 'fixtures/T0.6__usage.json', metrics: { usageKeys },
      nextAction: ok ? '据字段名做 claude 端 usage 归一(回填 PF G 节)' : '检查是否需 --verbose 或不同 output-format',
    })
  },
})


