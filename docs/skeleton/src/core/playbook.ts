/**
 * @sylux/core · playbook.ts
 *
 * 可换剧本契约 + 红蓝对抗实现(权威设计:03-engine-playbook.md §2/§3/§7.1)。
 *
 * 本文件拥有:`ContinuityMode` / `PromptContext` / `DigestBuilder` / `DigestOptions` /
 *   `TurnDirective` / `RoundPlan` / `Playbook` / `PlaybookId` / `PlaybookParams` 接口,
 *   `buildDigestBaseline`(H14 确定性基线,M1 可落地),以及 `RedBluePlaybook`(红蓝一个实现)。
 *   主从/对等/并行三范式同接口,骨架只交一个红蓝;其余在 §7.2–7.4 已有伪代码,实现时照搬接口。
 *
 * "换打法只换 playbook 对象,引擎本体不动"是硬指标(锁定决策 §3)。
 * 终止判定(三重刹车 + done 出口)统一由 stop-policy.ts 的 CompositeStopPolicy 拥有;
 *   playbook 只通过 isDone 提供"范式特定完成门"(经 PlaybookDonePolicy 注入),不内置刹车(H1/H2)。
 *
 * 类型引用:Message/MessageKind/AgentId/Role 来自 02;BoardView 来自 blackboard.ts;
 *   EngineDeps 来自 engine.ts(仅 type import,编译期擦除,无运行期循环依赖)。
 */

import type { AgentId, Role, MessageKind, Message } from '../shared/index.js';
import type { BoardView } from './blackboard.js';
import type { EngineDeps } from './engine.js';

// ============================================================================
// 1. continuity / PromptContext(省 token 的核心,03 §2)
// ============================================================================

/**
 * 会话续接策略:决定 adapter 用 send(新会话)还是 resume(续接),直接决定 token 成本曲线。
 *  - 'stateless':每轮全新会话(adapter.send),prompt=goal+digest+delta;成本对轮数近似平。
 *    长程辩论(红蓝/对等)默认。代价:无 CLI 侧记忆,全靠中枢喂 digest/delta。
 *  - 'resume':续接同一 CLI 会话(adapter.resume),记忆最好;成本累积/超线性(事实地基 D),
 *    仅主从子任务内强耦合的少数轮启用,受 maxResumeChain 护栏封顶(H7)。
 */
export type ContinuityMode = 'stateless' | 'resume';

/** 旧轮压结论生成器(03 §2.1.1)。EngineDeps 注入;基线见 buildDigestBaseline,高质量升级归性能 17 §6.3。 */
export interface DigestBuilder {
  /**
   * 从黑板只读视图压出"截至 upToRound 轮的结论摘要",喂 PromptContext.digest。
   * 约束(H5):输出只能源自 ① 已校验 evidence 锚点 + 自方结论,或 ② 调用方保证整体过 firewall。
   * 默认实现 = buildDigestBaseline(确定性、无 LLM);17 可提供更高质量实现替换之。
   */
  build(board: BoardView, upToRound: number, opts: DigestOptions): string;
}

export interface DigestOptions {
  /** 目标 token 上界(= perTurnContextCap 的一个分配额度);超出由实现自行压缩。 */
  maxTokens: number;
  /** 该 digest 是否将不经 firewall 直喂对面(true→实现必须只用结构化 evidence,H5 路径①)。 */
  bypassFirewall: boolean;
  /** 仅取该 agent 视角相关的结论(parallel 线内/主从子任务隔离;省略=全局)。 */
  forAgent?: AgentId;
  /** 基线算法保留的末 N 条决策(默认 8);高质量实现可忽略。 */
  decisionTailN?: number;
}

export interface PromptContext {
  /** 续接策略(§2.1)。引擎据此选 adapter.send 还是 adapter.resume。 */
  continuity: ContinuityMode;
  /** 任务目标(不变量级,跨轮稳定)。stateless 每轮带;resume 首轮带、后续可省。 */
  goal: string;
  /** 旧轮压缩结论(DigestBuilder 产出,非全文)。stateless 必带;resume 可空。受 H5 注入约束。 */
  digest: string;
  /**
   * 本轮新增增量:通常是对面上一条 message + 任何 orchestrator system 消息(打回/合并冲突回灌)。
   * 引擎从 board 取,playbook 选范围;喂前每条 body/evidence 过内容防火墙(安全 08 firewallPeerMessage)。
   */
  delta: readonly Message[];
  /**
   * 角色指令:本轮该 agent 扮演 role 的行为约束(自然语言)。
   * 注:roleBrief 是 orchestrator 自撰可信文本,不来自 peer,故不过 firewall(与 delta/digest 区别)。
   */
  roleBrief: string;
  /** 期望产出的消息类型(= TurnDirective.kindHint 副本,便于 prompt 渲染点明)。 */
  expectedKind: MessageKind;
  /** 单轮上下文体积上限(token 估算,playbook.params.perTurnContextCap)。 */
  contextCap: number;
}

// ============================================================================
// 2. TurnDirective / RoundPlan / Playbook(03 §3)
// ============================================================================

/** 一次 agent 发言的完整指令:谁、扮谁、做哪类、看什么。nextTurn 的最小产出单元。 */
export interface TurnDirective {
  /** 物理发言主体(覆盖 assignment 默认查表,E1/P3)。 */
  agent: AgentId;
  /** 本轮扮演角色(写入 Message.role)。 */
  role: Role;
  /** 期望产出的消息类型(引导,非强制;实际以校验后产出为准)。 */
  kindHint: MessageKind;
  /** 喂给该 agent 的上下文(§2)。引擎据 continuity 选 send/resume。 */
  promptContext: PromptContext;
}

/** 一轮的发言计划。turns 长度区分串行(1)/并行(N);execution 告诉引擎怎么跑。 */
export interface RoundPlan {
  /** 本轮所有发言指令。串行 length===1;并行 length===N(各写各 worktree,E5)。 */
  turns: TurnDirective[];
  /** 执行模式:'serial' 顺序 / 'parallel' 并发。冗余于 turns.length 但显式,防歧义。 */
  execution: 'serial' | 'parallel';
  /** 可选:逻辑阶段末弱信号(如主从 worker 实现完应触发 planner review)。引擎不强依赖。 */
  phaseHint?: string;
  /**
   * ★H15:本轮是否"应当产出新对抗 evidence",决定 04 ConvergencePolicy 是否把本轮计入 stall streak。
   * 默认 true(对抗类轮);false 的合法空证据轮(master-worker 派活/验收、parallel 全程)由 playbook 标。
   * 引擎经 buildStopContext 透传进 StopContext.roundEvidenceExpected。
   */
  stallEligible?: boolean;
}

export type PlaybookId = 'red-blue' | 'master-worker' | 'pair' | 'parallel';

export interface PlaybookParams {
  /** 硬上限(→ 04 MaxRoundsConfig;预算按累积上下文估,事实地基 D)。 */
  maxRounds: number;
  /** 连续 N 轮无新 evidence 指纹 → stall(→ 04 ConvergenceConfig.stallWindow,02 §9.3)。 */
  convergenceWindow: number;
  /** 累计 token 硬上限(→ 04 预算刹车 B3,独立于轮数)。 */
  tokenBudget: number;
  /** 单轮 context 体积上限(→ PromptContext.contextCap,分配给 digest/delta)。 */
  perTurnContextCap: number;
  /** 自动化沙箱上限(安全 08;不可设 danger)。 */
  sandboxCeiling: 'read-only' | 'workspace-write';
  /** 范式默认续接策略(§2.1);nextTurn 可逐轮覆盖。 */
  defaultContinuity: ContinuityMode;
  /** schema/evidence/firewall 打回后同 agent 重发上限(默认 3,§5.2)。 */
  retryOnReject: number;
  /** ★H7:单 agent 连续 resume 的最大轮数;达上限强制降级 stateless+digest(事实 D 累积爆点护栏)。 */
  maxResumeChain: number;
}

export interface Playbook {
  /** 范式标识(写入 BoardState.playbookId,02 §10.2)。 */
  readonly id: PlaybookId;
  readonly name: string;
  /** 角色→agent 默认指派(P3:仅查表默认,实际以 TurnDirective.agent 为准)。 */
  readonly assignment: Partial<Record<Role, AgentId>>;
  /** 运行参数(刹车阈值由 04 消费,本文件只持有声明)。 */
  readonly params: PlaybookParams;

  /** run 启动钩子:注入任务目标、初始化范式状态(如主从的子任务队列)。 */
  onStart(deps: EngineDeps): Promise<void>;

  /**
   * ★核心:基于当前黑板状态,决定下一轮谁发言、扮谁、看什么。
   * 引擎每轮循环开头调一次(无前置刹车,H1);返回的 RoundPlan 完全决定本轮行为。
   */
  nextTurn(board: BoardView): RoundPlan;

  /** 该轮末是否做 worktree 合并(串行可每轮 true;parallel 仅收口轮 true)。隔离 09 执行。 */
  shouldMergeAt(round: number, board: BoardView): boolean;

  /**
   * 范式特定完成判定(H2:与 04 通用 DonePolicy 互补,非替代)。
   * 通用"一方 done + 对面带证据 ack"归 04 DonePolicy;本方法只补通用判据覆盖不到的范式门
   * (parallel 全 lane done 无 ack、master-worker 子任务清单全 accept)。
   * 引擎经 PlaybookDonePolicy 包装注入 composite,引擎本体不再单独 if(isDone)(H2)。
   */
  isDone(board: BoardView): boolean;

  /** run 结束钩子(任意终态):清理范式状态、产出范式级总结(可选)。 */
  onFinish(status: import('../shared/index.js').RunStatus, board: BoardView): Promise<void>;
}

// ============================================================================
// 3. DigestBuilder 基线算法(H14:确定性、无 LLM、无注入面,M1 可落地,03 §2.1.1)
// ============================================================================

/** 决策类消息的 kind 集合(基线 digest 只取这些的结论行)。 */
const DECISION_KINDS = new Set<MessageKind>(['propose', 'plan', 'review', 'done', 'ack']);

/** 粗略 token 估算:按 ~4 字符/token(英文)或 ~1.5 字符/token(CJK)折中取 3。骨架够用;17 可换精确分词。 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** 取首行并按 maxChars 截断(基线只取自方可信文本的标题行,H5)。 */
function oneLine(text: string, maxChars: number): string {
  const first = text.split('\n', 1)[0] ?? '';
  return first.length > maxChars ? first.slice(0, maxChars) + '…' : first;
}

/** 单条 evidence → 结构化锚点串(只取 02 §3 结构化字段,绝不取自由 body,故无注入面,H5 路径①)。 */
function structuredAnchors(evidence: Message['evidence']): string[] {
  const out: string[] = [];
  for (const e of evidence) {
    switch (e.kind) {
      case 'file_ref':
        out.push(`file:${e.path}#L${e.lineStart}-${e.lineEnd}@${e.contentHash ?? '?'}`);
        break;
      case 'command':
        out.push(`cmd:\`${oneLine(e.cmd, 60)}\` expect:${oneLine(e.expected, 40)}`);
        break;
      case 'spec_quote':
        out.push(`spec:${e.source}${e.locator ? '#' + e.locator : ''}`);
        break;
    }
  }
  return out;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** 从旧到新按 maxTokens 截断:超界先砍最旧的行(新结论与近期锚点优先保留)。 */
function truncateToTokens(lines: string[], maxTokens: number): string {
  let acc = lines.slice();
  while (acc.length > 0 && estimateTokens(acc.join('\n')) > maxTokens) {
    acc = acc.slice(1); // 砍最旧
  }
  return acc.join('\n');
}

/**
 * 确定性基线 digest:结构化 evidence 锚点 + 末 N 条决策摘要,按 maxTokens 从旧到新截断(H14)。
 * - [EVID] 行:全程累积去重的结构化锚点(file_ref/command/spec_quote 的结构化字段)。
 * - [KIND] 行:末 N 条决策的"自方一句话结论锚"(body 首行截断);跨 agent(对面 body)不进基线(H5)。
 * 故 bypassFirewall:true 在所有范式下都安全(不含 peer 自由文本)。
 */
export function buildDigestBaseline(
  board: BoardView,
  upToRound: number,
  opts: DigestOptions,
): string {
  const tailN = opts.decisionTailN ?? 8;
  // 1) 末 N 条决策结论行。forAgent 限定时只取自方(避免引入 peer 自由文本,H5)。
  const decisions = board.messages
    .filter((m) => m.round <= upToRound && DECISION_KINDS.has(m.kind))
    .filter((m) => !opts.forAgent || m.from === opts.forAgent)
    .slice(-tailN);
  // 2) 结构化 evidence 锚点(全程累积、去重)。
  const anchors = dedupe(
    board.messages
      .filter((m) => m.round <= upToRound)
      .flatMap((m) => structuredAnchors(m.evidence)),
  );
  const lines: string[] = [];
  for (const a of anchors) lines.push(`[EVID] ${a}`);
  for (const d of decisions) lines.push(`[${d.kind.toUpperCase()}] r${d.round}:${oneLine(d.body, 120)}`);
  return truncateToTokens(lines, opts.maxTokens);
}

/** DigestBuilder 的基线实现对象(EngineDeps.digest 默认注入它;17 可换高质量实现)。 */
export const baselineDigestBuilder: DigestBuilder = {
  build: buildDigestBaseline,
};

// ============================================================================
// 4. 红蓝对抗 red-blue(03 §7.1)
// ============================================================================

/**
 * 奇偶交替:偶轮 proposer 出/改方案,奇轮 critic 追打。
 * critic 的 critique 由 02 §8 强制可核验 evidence(空泛批判被打回,引擎 runTurn §5.2)。
 * done 需对面带证据 ack(由 04 通用 DonePolicy 裁,故本范式 isDone 恒 false,H2);
 * stall 与 done 解耦(E4):反复旧论点无新指纹 → 04 ConvergencePolicy 判 stall。
 */
export class RedBluePlaybook implements Playbook {
  readonly id = 'red-blue' as const;
  readonly name = '红蓝对抗';
  readonly assignment: Partial<Record<Role, AgentId>> = { proposer: 'codex', critic: 'claude' };
  readonly params: PlaybookParams = {
    maxRounds: 12,
    convergenceWindow: 3,
    tokenBudget: 600_000, // stateless 线性口径(H17):≈ c×N,N=12,c≈1.5×base,留余量
    perTurnContextCap: 8_000,
    sandboxCeiling: 'workspace-write',
    defaultContinuity: 'stateless', // 长程辩论:resume 累积成本会爆(事实地基 D)
    retryOnReject: 3,
    maxResumeChain: 1,
  };

  private goal = '';
  /** digest 生成器:onStart 从 deps 注入(EngineDeps.digest);缺省退基线。 */
  private digest: DigestBuilder = baselineDigestBuilder;

  async onStart(deps: EngineDeps): Promise<void> {
    this.goal = deps.runGoal;
    this.digest = deps.digest;
  }

  nextTurn(board: BoardView): RoundPlan {
    const r = board.currentRound;
    const isCriticTurn = r % 2 === 1; // 偶 proposer / 奇 critic
    const role: Role = isCriticTurn ? 'critic' : 'proposer';
    const agent = this.assignment[role];
    if (!agent) {
      // 配置漂移:assignment 未给该 role 的 agent。引擎会按空 turns → EMPTY_ROUND_PLAN 兜底,
      // 但这里直接抛更早暴露(playbook 自身配置 bug,非运行期可恢复态)。
      throw new Error(`red-blue assignment 缺角色 ${role} 的 agent`);
    }
    const last = board.lastMessage(); // 对面上一条 = 本轮唯一 delta(E3 只喂增量)
    const roleBrief = isCriticTurn
      ? '你是红队 critic。逐条挑漏洞,每条批判必须带可机器核验 evidence(file_ref 行区间+contentHash 或 command 期望/实际),空泛批判会被打回重发。'
      : '你是 proposer。针对上一条 critique 修订方案或给出新方案;能落代码就在 files 声明改动意图。';
    const expectedKind: MessageKind = isCriticTurn ? 'critique' : 'propose';
    return {
      execution: 'serial',
      stallEligible: true, // 红蓝全轮对抗,都该出新 evidence(H15)
      turns: [
        {
          agent,
          role,
          kindHint: expectedKind,
          promptContext: {
            continuity: 'stateless',
            goal: this.goal,
            // 红蓝含 peer 历史:基线 digest 只用结构化 evidence 锚点 + 自方结论(H5 路径①),bypassFirewall 安全。
            digest: this.digest.build(board, Math.max(0, r - 1), {
              maxTokens: Math.floor(this.params.perTurnContextCap / 2),
              bypassFirewall: true,
            }),
            delta: last ? [last] : [],
            roleBrief,
            expectedKind,
            contextCap: this.params.perTurnContextCap,
          },
        },
      ],
    };
  }

  // 改动小、串行:可每轮合,让 critic 能用 file_ref 引最新 worktree 内容(M2 worktree 启用后生效)。
  shouldMergeAt(_round: number, _board: BoardView): boolean {
    return true;
  }

  // 红蓝的"done+对面带证据 ack"是 04 通用 DonePolicy 的标准判据(H2),本范式无额外完成门 → 恒 false。
  // 把 done 判定权完全交给 04 DonePolicy,避免双重检测;stall 由 04 ConvergencePolicy 独立判(E4)。
  isDone(_board: BoardView): boolean {
    return false;
  }

  async onFinish(): Promise<void> {
    /* 红蓝无额外状态 */
  }
}
