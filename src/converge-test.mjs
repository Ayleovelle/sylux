// src/converge-test.mjs —— 收敛检测确定性自测(零 CLI,纯逻辑)。
//   跑:node src/converge-test.mjs
import { fingerprint, roundFingerprints, makeConvergenceDetector, CONVERGENCE_PROFILE } from './converge.mjs'

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name) } }

console.log('— 指纹归一 —')
ok('同内容不同空白/大小写 → 同指纹', fingerprint('证据: Foo  Bar') === fingerprint('证据：foo bar'))
ok('空证据 → null', fingerprint('') === null && fingerprint('证据:   ') === null)
ok('占位证据不算强指纹', fingerprint('(critic 未显式标注证据)') === null)
ok('过短证据 → null', fingerprint('ab') === null)
ok('正常证据 → s: 前缀', (fingerprint('证据:死变量未使用') || '').startsWith('s:'))

console.log('— roundFingerprints —')
ok('从 evidence 数组抽全部强指纹', roundFingerprints({ evidence: ['证据:aaa漏洞', '证据:bbb反例'] }).size === 2)
ok('混入占位只抽强的', roundFingerprints({ evidence: ['证据:真实漏洞xx', '(critic 未显式标注证据)'] }).size === 1)

console.log('— 测试1:辩论型 stall(连续 N 轮无新指纹即停)—')
{
  const d = makeConvergenceDetector({ stallWindow: 2 })
  const r1 = d.feed({ evidence: ['证据:第一个漏洞aaa'] })           // 新 → 清零
  const r2 = d.feed({ evidence: ['证据:第二个漏洞bbb'] })           // 新 → 清零
  const r3 = d.feed({ evidence: ['证据:第一个漏洞aaa'] })           // 重复 → stalled=1
  const r4 = d.feed({ evidence: ['证据:第二个漏洞bbb'] })           // 重复 → stalled=2 → stall
  ok('第1轮有新指纹不 stall', r1.newCount === 1 && !r1.stall)
  ok('第2轮有新指纹不 stall', r2.newCount === 1 && !r2.stall)
  ok('第3轮重复指纹 stalled=1 未到窗口', r3.newCount === 0 && r3.stalledRounds === 1 && !r3.stall)
  ok('第4轮再重复 stalled=2 触发 stall', r4.newCount === 0 && r4.stalledRounds === 2 && r4.stall)
  ok('seen 全集去重正确(只 2 个)', d.seenCount === 2)
}

console.log('— 测试1b:持续出新指纹永不 stall —')
{
  const d = makeConvergenceDetector({ stallWindow: 2 })
  let everStall = false
  for (let i = 0; i < 6; i++) { const r = d.feed({ evidence: ['证据:漏洞编号' + i] }); everStall = everStall || r.stall }
  ok('每轮都有新指纹 → 从不 stall', !everStall && d.seenCount === 6)
}

console.log('— 测试2:状态机型 eligible 冻结(派活/执行轮不误杀)—')
{
  // lead-worker:只有 critique 轮 eligible,plan/patch 轮冻结。
  const prof = CONVERGENCE_PROFILE['lead-worker']
  const d = makeConvergenceDetector({ stallWindow: prof.stallWindow }) // window=3
  // 模拟:plan(冻结) → patch(冻结) → critique 重复证据×3 才该 stall
  const fr1 = d.feed({ kind: 'proposal', evidence: [] }, { eligible: prof.eligible({ kind: 'proposal' }) })
  const fr2 = d.feed({ kind: 'patch', evidence: [] }, { eligible: prof.eligible({ kind: 'patch' }) })
  ok('plan 轮冻结(frozen)', fr1.frozen === true && !fr1.stall)
  ok('patch 轮冻结(frozen)', fr2.frozen === true && !fr2.stall)
  // 现在三轮 critique 都重复同一证据
  d.feed({ kind: 'critique', evidence: ['证据:同一个问题zzz'] }, { eligible: true }) // 新 → 清零
  const c2 = d.feed({ kind: 'critique', evidence: ['证据:同一个问题zzz'] }, { eligible: true }) // 重复 stalled=1
  const c3 = d.feed({ kind: 'critique', evidence: ['证据:同一个问题zzz'] }, { eligible: true }) // 重复 stalled=2
  const c4 = d.feed({ kind: 'critique', evidence: ['证据:同一个问题zzz'] }, { eligible: true }) // 重复 stalled=3 → stall
  ok('冻结轮不累加 stall 计数', c2.stalledRounds === 1)
  ok('窗口=3 时第3次重复才 stall', !c3.stall && c4.stall && c4.stalledRounds === 3)
}

console.log('— 测试2b:divide-parallel 纯 done 不 stall —')
{
  const prof = CONVERGENCE_PROFILE['divide-parallel']
  const d = makeConvergenceDetector({ stallWindow: prof.stallWindow }) // window=99
  let everStall = false
  for (let i = 0; i < 4; i++) { const r = d.feed({ evidence: [] }, { eligible: prof.eligible({}) }); everStall = everStall || r.stall }
  ok('固定 4 轮全冻结 → 永不 stall(纯靠 done)', !everStall)
}

console.log('— 测试3(回归):red-blue author 轮冻结,author+critic 不误 stall —')
{
  // 实战踩坑:author 轮空证据,若计入则 author(0)+critic(0 因正则漏抽)=2 轮无指纹→窗口2 误停。
  // 修法:red-blue 只有 critique 轮 eligible。这里复现 author/critic 交替,critic 每轮出新证据。
  const prof = CONVERGENCE_PROFILE['red-blue']
  const d = makeConvergenceDetector({ stallWindow: prof.stallWindow }) // window=2
  const seq = [
    { kind: 'proposal', evidence: [] },                  // author 第1轮
    { kind: 'critique', evidence: ['证据1（严重）：真实漏洞甲'] }, // critic 第2轮 新
    { kind: 'proposal', evidence: [] },                  // author 第3轮(改进)
    { kind: 'critique', evidence: ['证据1：另一个真实漏洞乙'] },  // critic 第4轮 新
  ]
  let everStall = false
  for (const m of seq) { const r = d.feed(m, { eligible: prof.eligible(m) }); everStall = everStall || r.stall }
  ok('author 轮冻结 + critic 每轮出新 → 不误 stall', !everStall && d.seenCount === 2)

  // 反面:critic 连续两轮重复同一证据 → 应 stall
  const d2 = makeConvergenceDetector({ stallWindow: prof.stallWindow })
  const seq2 = [
    { kind: 'proposal', evidence: [] },
    { kind: 'critique', evidence: ['证据1：同一个老问题丙'] }, // 新→清零
    { kind: 'proposal', evidence: [] },
    { kind: 'critique', evidence: ['证据1：同一个老问题丙'] }, // 重复→stalled=1
    { kind: 'proposal', evidence: [] },
    { kind: 'critique', evidence: ['证据1：同一个老问题丙'] }, // 重复→stalled=2→stall
  ]
  let stalledAt = -1
  seq2.forEach((m, i) => { const r = d2.feed(m, { eligible: prof.eligible(m) }); if (r.stall && stalledAt < 0) stalledAt = i })
  ok('critic 连续 2 轮重复证据 → 第3个critic轮 stall', stalledAt === 5)
}

console.log(`\n收敛自测:${pass} 过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
