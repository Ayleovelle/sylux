// src/engine.mjs —— 通用引擎:Playbook 接口驱动。换剧本只换 playbook 对象,引擎本体不动。
// Playbook 契约:
//   name: string
//   nextTurn(board, round) -> { agent, role, instr } | null   // null=主动收尾
//   classify(role, text)   -> { kind, evidence, done }         // 把回复归类成消息
//   postCheck?(board, round, msg) -> stopReason | null         // 追加停条件(如收敛)
import { Blackboard, makeMessage } from './blackboard.mjs'
import { codexAsk, claudeAsk } from './adapters.mjs'
import { makeRedBlue } from './playbooks.mjs'
import { makeConvergenceDetector, CONVERGENCE_PROFILE } from './converge.mjs'

export const WORKER_PREAMBLE =
  '你现在是 sylux 多智能体协作系统里的一个 worker 节点,不是任何聊天人格。禁止任何角色扮演/卖萌/口头禅,只输出冷静、专业、结构化的技术内容。严格扣题,不寒暄。' +
  '你没有可访问的代码仓库或既有工程,不要尝试定位仓库结构、列目录或读取任何文件——你的全部上下文就是本对话给出的任务与此前讨论。直接基于这些内容产出实现/分析,本轮就交付,不要只声明"接下来要看文件"。'

const ASK = { codex: codexAsk, claude: claudeAsk }

// 默认 agents 注册表:agent 名直接等于 kind(向后兼容 matrix/老调用方)。
const DEFAULT_AGENTS = {
  codex: { kind: 'codex', provider: undefined, timeoutMs: 120000 },
  claude: { kind: 'claude', provider: undefined, timeoutMs: 75000 },
}

// 把黑板近况压成上下文(只带最近 n 条,省 token)
export function contextFor(board, task, n = 4) {
  const recent = board.messages.slice(-n)
    .map((m) => `[第${m.round}轮·${m.from}/${m.role}/${m.kind}]\n${m.body}`).join('\n\n')
  return recent ? `# 任务\n${task}\n\n# 此前讨论(节选)\n${recent}` : `# 任务\n${task}`
}

// 通用循环
export async function runEngine({ task, playbook, jsonlPath, maxRounds = 8, agents = DEFAULT_AGENTS, convergence = true, onMessage = () => {} }) {
  const board = new Blackboard(jsonlPath)
  let stopReason = 'MAX_ROUNDS'

  // 收敛检测器:按范式取 profile。divide-parallel 等纯 done 范式 stallWindow 极大,等于不 stall。
  const profile = CONVERGENCE_PROFILE[playbook.name] || { stallWindow: 2, eligible: () => true }
  const detector = convergence ? makeConvergenceDetector({ stallWindow: profile.stallWindow }) : null

  for (let round = 1; round <= maxRounds; round++) {
    const turn = playbook.nextTurn(board, round)
    if (!turn) { stopReason = 'CONVERGED'; break }
    const { agent, role, instr } = turn
    const spec = agents[agent] || DEFAULT_AGENTS[agent]
    const ask = spec ? ASK[spec.kind] : ASK[agent]
    if (!ask) { stopReason = 'ADAPTER_UNAVAILABLE'; break }

    // 无状态:每轮起新 session,历史只靠 contextFor 带(黑板是唯一共享记忆)。
    //   不传 threadId/sessionId——否则 codex resume 会服务端重放整段 thread,
    //   叠加 contextFor 成双重喂,input token 无界增长(实测第 4 轮飙到 20 万)。
    const prompt = contextFor(board, task) + '\n\n# 你这一轮的职责(' + role + ')\n' + instr
    const res = await ask({ prompt, systemPreamble: WORKER_PREAMBLE, provider: spec?.provider, timeoutMs: spec?.timeoutMs })

    if (!res || !res.ok) {
      const code = res?.code || 'ADAPTER_UNAVAILABLE'
      const m = board.append(makeMessage({
        round, from: 'orchestrator', role: 'lead', kind: 'status_changed',
        body: `${agent} 调用失败 [${code}]: ${res?.error || 'unknown'}`,
        evidence: [code], status: { code, agent, fixturePath: res?.fixturePath || null },
      }))
      onMessage(m); stopReason = code; break
    }

    const { kind, evidence, done } = playbook.classify(role, res.text || '')
    const msg = board.append(makeMessage({ round, from: agent, role, kind, body: res.text || '', evidence, usage: res.usage, fixturePath: res.fixturePath }))
    onMessage(msg)

    if (done) { stopReason = 'CONVERGED'; break }

    // 收敛检测:done(agent 主动收口)与 stall(引擎判原地转)解耦。
    if (detector) {
      const eligible = profile.eligible(msg)
      const r = detector.feed(msg, { eligible })
      if (r.stall) { stopReason = 'CONVERGENCE_STALL'; break }
    }

    const pc = playbook.postCheck?.(board, round, msg)
    if (pc) { stopReason = pc; break }
  }
  return { board, stopReason }
}

// 兼容 shim:matrix.mjs 等老调用方仍用 runRedBlue({task, assignment:{author,critic}, ...})
export async function runRedBlue({ task, assignment, jsonlPath, maxRounds = 6, onMessage = () => {} }) {
  return runEngine({ task, playbook: makeRedBlue(assignment), jsonlPath, maxRounds, onMessage })
}
