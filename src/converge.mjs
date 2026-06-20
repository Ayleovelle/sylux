// src/converge.mjs —— 收敛检测(M1 落地版,对齐 master-plan §4.3)。
// 核心:evidence 指纹差集。每轮把证据归一成稳定指纹,与历史全集求差;
//   连续 stallWindow 轮"无新强指纹"= 原地打转 → CONVERGENCE_STALL。
// 与 done 解耦:done 是 agent 主动收口(CONVERGED);stall 是引擎客观判定原地转(CONVERGENCE_STALL)。
//
// 范式分化(吃 FEAS-5):
//   辩论型(red-blue/pair):stall 为主信号,窗口小(默认 2)。
//   状态机型(lead-worker/divide-parallel):done 为主,stall 仅兜底,窗口放大,
//     且"派活/同步/复用旧锚点"的轮(stallEligible=false)冻结计数,不误杀合法空证据轮。

// 把一条证据文本归一成稳定指纹:去掉"证据:"前缀、压空白、小写。
//   空证据/占位证据不产强指纹(对抗 agent 每轮换无意义占位来架空收敛)。
export function fingerprint(ev) {
  const s = String(ev || '').replace(/^证据[:：]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!s) return null
  if (/^\(.*未.*证据.*\)$/.test(s) || s === '(critic 未显式标注证据)'.toLowerCase()) return null // 占位不算强指纹
  if (s.length < 4) return null // 太短无意义
  return 's:' + s
}

// 一轮消息产出的强指纹集合。body 兜底:pair 这类无 evidence 数组的范式,
//   用 navigator 的 body 抽要点行做弱锚(仍归一,仍要求非空)。
export function roundFingerprints(msg) {
  const fps = new Set()
  for (const e of msg.evidence || []) { const fp = fingerprint(e); if (fp) fps.add(fp) }
  return fps
}

// 收敛检测器:有状态,逐轮喂消息。
//   stallWindow:连续多少轮无新强指纹判 stall。
//   返回每轮 { newCount, stalledRounds, stall } —— stall=true 即应停。
export function makeConvergenceDetector({ stallWindow = 2 } = {}) {
  const seen = new Set()    // 历史全部强指纹(差集被减数)
  let stalledRounds = 0     // 连续无新指纹的轮数

  return {
    // eligible=false 的轮(派活/同步/复用旧锚点)冻结计数,不参与 stall 判定。
    feed(msg, { eligible = true } = {}) {
      if (!eligible) return { newCount: 0, stalledRounds, stall: false, frozen: true }
      const fps = roundFingerprints(msg)
      let newCount = 0
      for (const fp of fps) { if (!seen.has(fp)) { seen.add(fp); newCount++ } }
      if (newCount > 0) stalledRounds = 0
      else stalledRounds++
      return { newCount, stalledRounds, stall: stalledRounds >= stallWindow, frozen: false, seenTotal: seen.size }
    },
    get seenCount() { return seen.size },
    get stalled() { return stalledRounds },
  }
}

// 范式默认参数:只有"产对抗证据的轮"才算 stall-eligible,其余冻结。
//   否则空证据轮(author 出方案/driver 写码/派活)会被当成"无新指纹"误判原地转。
export const CONVERGENCE_PROFILE = {
  // 红蓝:只有 critic 轮带证据;author 出方案轮冻结。连续 stallWindow 个 critic 轮无新指纹 → stall。
  'red-blue': { stallWindow: 2, eligible: (msg) => msg.kind === 'critique' },
  // 结对:M1 无 evidence 模型(navigator/driver 都不产结构化证据),指纹 stall 不适用,
  //   纯靠 done(navigator STATUS:done)+ maxRounds。全冻结,等于不 stall。
  'pair': { stallWindow: 99, eligible: () => false },
  // 状态机型:done 为主,stall 兜底放大;只有"带证据的复盘轮"(critique)算 eligible,
  //   派活(proposal/plan)/执行(patch)轮冻结——它们本就不产对抗证据。
  'lead-worker': { stallWindow: 3, eligible: (msg) => msg.kind === 'critique' },
  'divide-parallel': { stallWindow: 99, eligible: () => false }, // 固定 4 轮顺序,纯靠 done,不 stall
}
