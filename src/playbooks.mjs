// src/playbooks.mjs —— 四范式剧本。每个工厂吃 assignment(谁扮什么角色)返回 playbook 对象。
// 角色与模型解耦:assignment 把模型映射到角色,剧本只管编排逻辑。

// 共用:从文本抽证据行;判 done 信号
// 证据格式宽容:配 "证据:xxx" / "证据：xxx" / "证据1（…）：xxx",且内容可在冒号同行或换行续写
//   (抓到下一个 证据 标记或空行前)。否则真证据漏抽 → 误判原地打转或反过来漏掉重复。
const EV_MARKER = /证据\s*\d*(?:[（(][^）)\n]*[）)])?\s*[:：]/g
function extractEvidence(text) {
  const s = String(text || '')
  const out = []
  let m, starts = []
  EV_MARKER.lastIndex = 0
  while ((m = EV_MARKER.exec(s)) !== null) starts.push({ at: m.index, end: EV_MARKER.lastIndex })
  for (let i = 0; i < starts.length; i++) {
    const contentStart = starts[i].end
    const contentEnd = i + 1 < starts.length ? starts[i + 1].at : s.length
    // 内容截到下一个证据标记或双换行(段落)前,压成单行
    let body = s.slice(contentStart, contentEnd).split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim()
    if (body) out.push('证据:' + body)
  }
  return out
}
const hasDone = (text) => /STATUS:\s*done/i.test(text)

// ── 1. 红蓝对抗 ── author 出/改,critic 带证据砸,轮流;critic 判 done 收敛
export function makeRedBlue({ author, critic }) {
  return {
    name: 'red-blue',
    nextTurn(board, round) {
      const isAuthor = round % 2 === 1
      return {
        agent: isAuthor ? author : critic,
        role: isAuthor ? 'author' : 'critic',
        instr: isAuthor
          ? '你是 author。给出/修订方案。若上一轮 critic 提了问题,逐条回应并改进。结尾一行「STATUS: proposal」。'
          : '你是 critic(红队)。只挑漏洞、找反例、质疑假设,不准附和空夸。每条必须给具体证据或反例(标「证据:」)。已无实质问题就只回一行「STATUS: done」+理由;否则结尾「STATUS: critique」。',
      }
    },
    classify(role, text) {
      if (role === 'author') return { kind: 'proposal', evidence: [], done: false }
      const done = hasDone(text)
      let evidence = done ? [] : extractEvidence(text)
      if (role === 'critic' && !done && evidence.length === 0) evidence = ['(critic 未显式标注证据)']
      return { kind: done ? 'done' : 'critique', evidence, done: done && role === 'critic' }
    },
  }
}

// ── 2. 主从(规划+执行)── lead 拆任务/分配/验收,worker 闷头执行
export function makeLeadWorker({ lead, worker }) {
  return {
    name: 'lead-worker',
    nextTurn(board, round) {
      // 轮转:lead(规划)→ worker(执行)→ lead(验收)→ worker(返工)...
      const isLead = round % 2 === 1
      const firstLead = round === 1
      return {
        agent: isLead ? lead : worker,
        role: isLead ? 'lead' : 'worker',
        instr: isLead
          ? (firstLead
            ? '你是 lead。把任务拆成清晰的可执行子步骤(编号列出),指明验收标准,交给 worker。结尾「STATUS: plan」。'
            : '你是 lead。审查 worker 上一轮的执行结果:逐条对照验收标准。全部达标就只回「STATUS: done」+结论;否则指出差距、打回返工,结尾「STATUS: review」。')
          : '你是 worker。严格按 lead 的计划/返工意见执行,给出完整结果(代码/步骤)。结尾「STATUS: work」。',
      }
    },
    classify(role, text) {
      const done = hasDone(text)
      const kind = role === 'lead' ? (done ? 'done' : (text.match(/STATUS:\s*plan/i) ? 'proposal' : 'critique')) : 'patch'
      return { kind, evidence: role === 'lead' && !done ? extractEvidence(text) : [], done: done && role === 'lead' }
    },
  }
}

// ── 3. 对等结对(driver/navigator)── navigator 指下一步,driver 写,轮流
export function makePair({ driver, navigator }) {
  return {
    name: 'pair',
    nextTurn(board, round) {
      const isNav = round % 2 === 1
      return {
        agent: isNav ? navigator : driver,
        role: isNav ? 'navigator' : 'driver',
        instr: isNav
          ? '你是 navigator。指出下一步该做什么、要注意的边界与陷阱(简明)。若整体已完成就只回「STATUS: done」+理由;否则结尾「STATUS: nav」。'
          : '你是 driver。按 navigator 的指引写出这一步的实现/产出,结尾「STATUS: drive」。',
      }
    },
    classify(role, text) {
      const done = hasDone(text)
      return { kind: role === 'navigator' ? (done ? 'done' : 'proposal') : 'patch', evidence: [], done: done && role === 'navigator' }
    },
  }
}

// ── 4. 分工并行(顺序版)── lead 切两块,两 agent 各做一块,lead 合并
export function makeDivideParallel({ lead, a, b }) {
  return {
    name: 'divide-parallel',
    nextTurn(board, round) {
      if (round === 1) return { agent: lead, role: 'lead', instr: '你是 lead。把任务切成恰好两个相互独立的子模块 A 和 B,各写清边界与接口。结尾「STATUS: split」。' }
      if (round === 2) return { agent: a, role: 'worker', instr: '你是 worker-A。只实现上面 lead 划的子模块 A,给完整产出。结尾「STATUS: work」。' }
      if (round === 3) return { agent: b, role: 'worker', instr: '你是 worker-B。只实现子模块 B,给完整产出。结尾「STATUS: work」。' }
      if (round === 4) return { agent: lead, role: 'lead', instr: '你是 lead。合并 A、B 两块产出,检查接口对齐、给出集成后的完整结果与一句集成测试结论。结尾「STATUS: done」。' }
      return null // 4 轮收尾
    },
    classify(role, text) {
      const done = hasDone(text)
      const kind = role === 'lead' ? (done ? 'done' : 'proposal') : 'patch'
      return { kind, evidence: [], done: done && role === 'lead' }
    },
  }
}

// 工厂注册表:名字 → (assignment) => playbook
export const PLAYBOOKS = {
  'red-blue': makeRedBlue,
  'lead-worker': makeLeadWorker,
  'pair': makePair,
  'divide-parallel': makeDivideParallel,
}
