/**
 * @sylux/core · engine.ts
 *
 * 范式无关的引擎主循环 runEngine(权威设计:03-engine-playbook.md §4/§5)。
 *
 * 本文件拥有:`EngineDeps` / `AgentRuntimeResolver` / `RunResult` / `runEngine` 主循环 +
 *   `runTurn`(装配 AgentInput→选 send/resume→校验→重试)+ `consume`(AgentEvent→payload+usage)+
 *   `buildStopContext`(BoardView+round+plan→04 StopContext 投影,H10/H15)+ `PlaybookDonePolicy` 装配。
 *
 * 一个循环、四种打法(锁定决策 §3):引擎反复问 playbook nextTurn/shouldMergeAt/isDone,
 *   只忠实执行 + 守门,绝不内置范式逻辑。终止判定统一由 stop-policy 的 CompositeStopPolicy 拥有,
 *   引擎每轮末调它一次(无前置刹车,H1/H2)。
 *
 * 内核不变量(03 §0.2):E1 角色⊥模型;E2 未校验不入黑板;E3 只喂增量;E4 stall⊥done;
 *   E5 合并冲突硬停;E6 刹车统一轮末;E7 失败不静默。
 */

import {
  buildAgentOutputJsonSchema,
  agentMessagePayloadSchema,
  SyluxError,
  type AgentId,
  type AgentEvent,
  type AgentMessagePayload,
  type TokenUsage,
  type RunStatus,
  type SyluxErrorCode,
  type EvidenceItem,
} from '../shared/index.js';
import type { ValidateResult } from '../shared/index.js';
import type {
  AgentAdapter,
  AgentInput,
  ProviderOverrides,
  WorktreeManager,
  MergeResult,
  FirewallResult,
  Logger,
} from './_upstream.js';
import type { Blackboard, BoardView, AppendInput } from './blackboard.js';
import { BlackboardImpl } from './blackboard.js';
import type { Playbook, TurnDirective, RoundPlan, DigestBuilder, PlaybookParams } from './playbook.js';
import {
  buildStopPolicy,
  type StopPolicy,
  type StopContext,
  type StopPolicyConfig,
} from './stop-policy.js';

// ============================================================================
// 1. EngineDeps —— 引擎依赖契约(03 §4.3,各文档注入实现)
// ============================================================================

/** ★H3:把"该 agent 这轮在哪个 worktree、带什么 env/override、是否 ephemeral"解析出来。 */
export interface AgentRuntimeResolver {
  workdir(agent: AgentId): string;
  /** buildChildEnv 出口的 env 白名单产物(安全 08;含 provider key,只在此通路,A5)。 */
  providerEnv(agent: AgentId): Record<string, string>;
  providerOverrides(agent: AgentId): ProviderOverrides;
  /** 沙箱上限(playbook.params.sandboxCeiling 与安全 08 封顶取交,绝不超 workspace-write)。 */
  sandbox(agent: AgentId): 'read-only' | 'workspace-write';
  ephemeral(agent: AgentId): boolean;
  /** 可选:单次调用硬超时(ms),驱动 adapter.cancel() 杀进程树(适配 05 §10)。 */
  timeoutMs?(agent: AgentId): number | undefined;
}

/** engine 验证桥接(H12):装配层把引擎侧 (AppendInput, round) 桥接到 02 validateMessage(Message, ValidateContext)。 */
export type EngineValidate = (cand: AppendInput, round: number) => ValidateResult;

export interface EngineDeps {
  blackboard: Blackboard;
  /** 适配 05/06(仅 codex/claude;human/orchestrator 不在此)。 */
  adapters: Partial<Record<AgentId, AgentAdapter>>;
  /**
   * ★H1:统一终止裁决(stop-policy CompositeStopPolicy)。组装见 wireEngine §标准装配:
   *   [PlaybookDonePolicy(本范式 isDone) , DonePolicy , MaxRounds , Convergence , Budget]。
   * 引擎每轮末 update→shouldStop 调一次,不感知内部有几条刹车。
   */
  stopPolicy: StopPolicy;
  /** 内容防火墙函数(安全 08 §4 firewallPeerMessage)。喂对面前逐条过滤;纯函数。 */
  firewall: (msg: import('../shared/index.js').Message) => FirewallResult;
  worktrees: WorktreeManager;
  /**
   * ★H16:worktree 是否启用。M1=false:mergeRound 整步 no-op,shouldMergeAt 返回值被忽略,
   *   files[] 仅作意图声明 evidence(不落盘/不 3-way)。M2+=true 恢复全语义。
   */
  worktreesEnabled: boolean;
  /** 02 §8 validateMessage 的引擎侧桥接闭包(H12)。 */
  validate: EngineValidate;
  /** digest 生成器(playbook.onStart 从此取;接口 §2.1.1,生成策略性能 17 §6.3)。 */
  digest: DigestBuilder;
  /** ★H3:解析 AgentInput 非 playbook 字段。 */
  agentRuntime: AgentRuntimeResolver;
  /** 脱敏日志(安全 08 redact 通路)。 */
  logger: Logger;
  /** run 任务目标(playbook.onStart 取;来自 run 配置/CLI 入参)。 */
  runGoal: string;
}

/** runEngine 返回:终态 + 原因 + runId。 */
export interface RunResult {
  status: RunStatus;
  reason?: string;
  runId: string;
}

// ============================================================================
// 2. 引擎侧助手:system 消息、StopContext 投影、usage 求和(03 §5.1.2 / §7)
// ============================================================================

/** 产一条 kind:'system'、from:'orchestrator' 的 AppendInput(02 C7;reason 仅枚举/数字/常量,S8)。 */
function systemMessage(
  round: number,
  code: string,
  evidence: EvidenceItem[] = [],
  reason?: string,
): AppendInput {
  return {
    from: 'orchestrator',
    role: 'arbiter',
    round,
    payload: {
      kind: 'system',
      body: reason ? `[${code}] ${reason}` : `[${code}]`,
      files: [],
      evidence,
    },
  };
}

function sumUsage(rounds: readonly { usage?: TokenUsage | undefined }[]): TokenUsage {
  const acc: TokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  for (const r of rounds) {
    if (!r.usage) continue;
    acc.inputTokens += r.usage.inputTokens;
    acc.cachedInputTokens += r.usage.cachedInputTokens;
    acc.outputTokens += r.usage.outputTokens;
    acc.reasoningOutputTokens += r.usage.reasoningOutputTokens;
  }
  return acc;
}

/**
 * ★H10:引擎侧投影。BoardView + round + 本轮 plan → 04 StopContext(04 只消费,不拥有此函数)。
 * 承载 H15 stall 资格位:plan.stallEligible → StopContext.roundEvidenceExpected。
 */
export function buildStopContext(board: BoardView, round: number, plan: RoundPlan): StopContext {
  const rounds = board.rounds;
  const lastRound = rounds[rounds.length - 1];
  return {
    round,
    rounds,
    roundMessages: board.messagesInRound(round),
    messages: board.messages,
    totalUsage: sumUsage(rounds), // buildStopContext 兜底由 BudgetPolicy.floorUsage 再保险(H-USAGE/H-OUT0)
    lastRoundUsage: lastRound?.usage,
    // ★H15:本轮是否计入 stall streak。默认 true;非资格轮由 plan 标 false。
    roundEvidenceExpected: plan.stallEligible ?? true,
    // TODO(H-DEGRADE/COV-3):中枢核验降级标志应由 runTurn 的 evidence 复算结果回填;
    //   骨架暂恒 false(无沙箱复跑器),M1 决策态 file_ref 降 weak 不影响 stall 冻结语义。
    roundVerificationDegraded: false,
    status: board.status,
  };
}

/**
 * 把 playbook.isDone 适配成一个 StopPolicy probe(H2)。装配层用它构造 StopPolicyConfig.playbookDone。
 * probe 纯读(playbook.isDone 是只读 BoardView);board 由闭包捕获(03 §4.3 桥接)。
 */
export function makePlaybookDoneProbe(
  playbook: Playbook,
  view: () => BoardView,
): (ctx: StopContext) => boolean {
  return (_ctx: StopContext) => playbook.isDone(view());
}

/**
 * 标准装配:据 playbook.params 组装 CompositeStopPolicy(03 §4.3 注入档位)。
 * 红蓝 isDone 恒 false,playbookDone 可省;主从/并行需传(清单门/全 lane done)。wireEngine 调用。
 */
export function buildStopPolicyFor(
  playbook: Playbook,
  view: () => BoardView,
  opts?: { pricing?: import('./stop-policy.js').TokenPricing; maxCostUsd?: number; maxTurnTokens?: number },
): StopPolicy {
  const cfg: StopPolicyConfig = {
    maxRounds: { maxRounds: playbook.params.maxRounds },
    convergence: {
      stallWindow: playbook.params.convergenceWindow,
      countSpecQuote: false,
      minActiveRounds: 1,
      requireVerifiedProgress: true,
    },
    budget: {
      maxTotalTokens: playbook.params.tokenBudget,
      lookahead: true,
      lookaheadFactor: 1.0,
      ...(opts?.pricing ? { pricing: opts.pricing } : {}),
      ...(opts?.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}),
      ...(opts?.maxTurnTokens !== undefined ? { maxTurnTokens: opts.maxTurnTokens } : {}),
    },
    enableDone: true,
    // 范式特定门:红蓝恒 false 时给探针无害(每轮返回 false);主从/并行靠它。
    playbookDone: makePlaybookDoneProbe(playbook, view),
  };
  return buildStopPolicy(cfg);
}

// ============================================================================
// 3. runEngine —— 范式无关主循环(03 §5.1,失败路径齐全)
// ============================================================================

export async function runEngine(playbook: Playbook, deps: EngineDeps): Promise<RunResult> {
  const bb = deps.blackboard;
  await bb.setStatus('running');
  await playbook.onStart(deps);

  try {
    let round = bb.view().currentRound; // 引擎本地持有轮号(closeRound 不隐式推进控制流,§5.1.1)
    for (;;) {
      // ── 1. playbook 决定本轮计划(谁/扮谁/看什么)──
      const plan = playbook.nextTurn(bb.view());
      if (plan.turns.length === 0) {
        // 防御(H9):"全部完成"应已被上一轮末 PlaybookDonePolicy 截停;走到这里 = playbook 逻辑 bug。
        return await finalize(playbook, deps, 'aborted', 'EMPTY_ROUND_PLAN');
      }

      // ── 2. 执行发言(串行 await / 并行 Promise.all,各写各 worktree,E5)──
      const results =
        plan.execution === 'parallel'
          ? await Promise.all(plan.turns.map((t) => runTurn(t, round, deps, playbook.params)))
          : await sequential(plan.turns, (t) => runTurn(t, round, deps, playbook.params));

      // ── 3. 写黑板(仅成功 turn;失败 turn 已在 runTurn 内落 system 消息)──
      for (const r of results) {
        if (r.ok) {
          await bb.append({ from: r.directive.agent, role: r.directive.role, round, payload: r.payload });
          // usage 汇入本轮(BlackboardImpl 暴露 recordRoundUsage;接口层未列,故能力探测式调用)。
          if (r.usage) recordUsageIfSupported(bb, r.usage);
        }
      }

      // 致命失败(闸门前 spawn 不可恢复 / 重试耗尽 / firewall 连续 block 耗尽)→ 写 system 后硬停(E7,H4)
      const fatal = results.find((r) => !r.ok && r.fatal);
      if (fatal && !fatal.ok) {
        return await finalize(playbook, deps, 'aborted', fatal.code);
      }

      // ── 4. 轮末合并(parallel 关键路径;冲突硬停,E5/隔离 09)──
      //    H16:M1(worktreesEnabled=false)整步 no-op——不建 worktree、不 3-way,files 仅意图声明 evidence。
      if (deps.worktreesEnabled && playbook.shouldMergeAt(round, bb.view())) {
        const merge: MergeResult = await deps.worktrees.mergeRound(round);
        if (!merge.ok) {
          // 合并冲突:写 system 回灌冲突 evidence,置人工裁决态(不静默重试,不选边,E5)
          await bb.append(systemMessage(round, 'WORKTREE_CONFLICT', merge.conflictEvidence));
          await bb.setStatus('paused', { code: 'WORKTREE_CONFLICT' });
          return await finalize(playbook, deps, 'paused', 'WORKTREE_CONFLICT');
        }
      }

      // ── 5. 关轮(落指纹集合 + usage,02 §7.1);必在 stopPolicy 之前(04 §2.4 顺序铁律)──
      await bb.closeRound(round);

      // ── 6. 统一终止裁决(H1/H2):先 update 全部子刹车,再 shouldStop 统一裁决(04 §2.3/§8.1)──
      const ctx = buildStopContext(bb.view(), round, plan);
      deps.stopPolicy.update(ctx);
      const decision = deps.stopPolicy.shouldStop(ctx);
      if (decision.shouldStop) {
        // 04 §2.4:引擎写一条 system 消息(刹车原因)+ 落 status_changed,再终止。
        await bb.append(systemMessage(round, decision.code ?? 'STOP', [], decision.reason));
        return await finalize(
          playbook,
          deps,
          decision.status ?? 'stalled',
          decision.code ?? decision.reason,
        );
      }

      // 下一轮:引擎推进本地轮号(与 bb.currentRound 对齐,§5.1.1)
      round += 1;
    }
  } catch (e) {
    // E7:任何未预期异常显式落终态,不吞
    const msg = e instanceof Error ? e.message : String(e);
    await bb.setStatus('aborted', { code: 'ENGINE_FATAL', reason: msg });
    return await finalize(playbook, deps, 'aborted', 'ENGINE_FATAL');
  }
}

async function finalize(
  playbook: Playbook,
  deps: EngineDeps,
  status: RunStatus,
  reason?: string,
): Promise<RunResult> {
  // setStatus 可能因"已是终态/非法转移"抛(如 paused 已在循环里置过);finalize 容错,不二次抛。
  try {
    if (status !== deps.blackboard.view().status) {
      await deps.blackboard.setStatus(status, reason !== undefined ? { reason } : undefined);
    }
  } catch (e) {
    deps.logger.warn('finalize setStatus 跳过(可能已终态)', e instanceof Error ? e.message : e);
  }
  await playbook.onFinish(status, deps.blackboard.view());
  return reason !== undefined
    ? { status, reason, runId: deps.blackboard.runId }
    : { status, runId: deps.blackboard.runId };
}

/** 串行执行 turns:逐个 await,保序(parallel 走 Promise.all,见主循环)。 */
async function sequential<T, R>(items: readonly T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const it of items) out.push(await fn(it));
  return out;
}

/** 能力探测:BlackboardImpl 暴露 recordRoundUsage(接口未列);非该实现则跳过(usage 仅影响刹车精度)。 */
function recordUsageIfSupported(bb: Blackboard, usage: TokenUsage): void {
  if (bb instanceof BlackboardImpl) bb.recordRoundUsage(usage);
}

// ============================================================================
// 4. runTurn —— 单次发言(装配 AgentInput → 选 send/resume → 校验 → 重试,03 §5.2)
// ============================================================================

type TurnResult =
  | { ok: true; directive: TurnDirective; payload: AgentMessagePayload; usage?: TokenUsage }
  | { ok: false; directive: TurnDirective; code: SyluxErrorCode; fatal: boolean };

/** 渲染产物:拼好的 prompt + 是否全部 delta 被 firewall block(无可喂内容)。 */
interface RenderedPrompt {
  prompt: string;
  allBlocked: boolean;
  blockReason?: string;
}

/**
 * PromptContext → 单 prompt 串(03 §2.3 固定顺序)。delta 每条过 firewallPeerMessage:
 *   pass/flag 用 wrapped 拼入 [INPUT];block 不拼入。digest 走 bypassFirewall 路径时本骨架信任
 *   playbook 已用结构化 evidence 生成(H5 路径①,见 buildDigestBaseline);否则应在此整体过 firewall(H5 路径②)。
 */
function renderPrompt(
  pc: import('./playbook.js').PromptContext,
  firewall: (msg: import('../shared/index.js').Message) => FirewallResult,
): RenderedPrompt {
  const parts: string[] = [];
  if (pc.goal) parts.push(`[GOAL]\n${pc.goal}`);
  if (pc.digest) parts.push(`[DIGEST]\n${pc.digest}`); // 基线 digest 只含结构化锚点,无注入面(H5)
  parts.push(`[ROLE]\n${pc.roleBrief}`); // orchestrator 可信文本,不过 firewall
  const inputs: string[] = [];
  const blockReasons: string[] = [];
  for (const m of pc.delta) {
    const fw = firewall(m);
    if (fw.action === 'block') {
      blockReasons.push(fw.reason);
      continue; // 该条不拼入(H6/安全 08 §4.5)
    }
    inputs.push(fw.wrapped); // pass/flag:已包 <<<SYLUX_PEER_DATA…>>> 封套
  }
  const allBlocked = pc.delta.length > 0 && inputs.length === 0;
  if (inputs.length > 0) parts.push(`[INPUT]\n${inputs.join('\n---\n')}`);
  parts.push(`[TASK]\n请以 ${pc.expectedKind} 产出,并满足 output schema(02 §6.1)。`);
  return allBlocked
    ? { prompt: parts.join('\n\n'), allBlocked: true, blockReason: blockReasons.join('; ') }
    : { prompt: parts.join('\n\n'), allBlocked: false };
}

/** 从 BoardView 数本 agent 自上次 send(新会话)以来连续 resume 的轮数(H7,O(近期轮数))。 */
function resumeChainLength(_board: BoardView, _agent: AgentId): number {
  // TODO(H7):真实实现需从 agent_session 落盘记录数"自上次新会话以来的轮数";
  //   骨架无该投影,保守返回 0(永不触发降级);M1 接 jsonl agent_session 序列后补全。
  return 0;
}

async function runTurn(
  directive: TurnDirective,
  round: number,
  deps: EngineDeps,
  params: PlaybookParams,
): Promise<TurnResult> {
  const { agent, role, promptContext } = directive;
  const adapter = deps.adapters[agent];
  if (!adapter) {
    // 配置缺该 agent 适配器:首轮致命(无法发言)。
    await deps.blackboard.append(systemMessage(round, 'SUBPROCESS_SPAWN_FAILED', [], `无适配器: ${agent}`));
    return { ok: false, directive, code: 'SUBPROCESS_SPAWN_FAILED', fatal: true };
  }

  // 1. 渲染 prompt(§2.3):delta 每条过 firewall;全 block → 无有效输入,落 system 非致命失败(H6)
  const rendered = renderPrompt(promptContext, deps.firewall);
  if (rendered.allBlocked) {
    await deps.blackboard.append(systemMessage(round, 'INJECTION_BLOCKED', [], rendered.blockReason));
    return { ok: false, directive, code: 'INJECTION_BLOCKED', fatal: false };
  }

  // 2. 装配 AgentInput(H3:prompt 由 playbook 上下文决定;其余字段经 agentRuntime 解析)
  const rt = deps.agentRuntime;
  const timeoutMs = rt.timeoutMs?.(agent);
  const baseInput: AgentInput = {
    prompt: rendered.prompt,
    outputSchema: buildAgentOutputJsonSchema(), // 02 §6.2,传对象,文件/内联落点吃进适配器
    workdir: rt.workdir(agent),
    sandbox: rt.sandbox(agent), // 安全 08 封顶 workspace-write(playbook 无法请求 danger)
    providerEnv: rt.providerEnv(agent), // 安全 08 buildChildEnv 出口(key 只在此通路,A5)
    providerOverrides: rt.providerOverrides(agent), // provider 07(绝不含 key)
    ephemeral: rt.ephemeral(agent),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}), // 到点 adapter.cancel() 杀进程树(05 §10)
  };

  // 3. ★H7:maxResumeChain 护栏——选 send vs resume 前,先看本 agent 连续 resume 链长
  const sess = deps.blackboard.view().sessionOf(agent);
  const wantResume = promptContext.continuity === 'resume' && sess.resumable && !!sess.sessionId;
  const chainLen = resumeChainLength(deps.blackboard.view(), agent);
  const overChain = chainLen >= params.maxResumeChain;
  const useResume = wantResume && !overChain; // 超链则强制降级 stateless+digest(事实 D 累积爆点)
  if (wantResume && overChain) {
    deps.logger.info(`resume chain capped for ${agent} (chainLen=${chainLen}); degrade to stateless`);
  }

  let attempt = 0;
  let rejectFeedback: string | undefined;

  while (attempt <= params.retryOnReject) {
    const input = withFeedback(baseInput, rejectFeedback);
    const stream =
      useResume && sess.sessionId ? adapter.resume(sess.sessionId, input) : adapter.send(input);

    // 4. 消费事件流(§5.3),区分闸门前/后崩溃(H4,适配 05 §6 F-a/b/c)
    const parsed = await consume(stream, deps);

    if (parsed.kind === 'spawn_failed') {
      // 闸门前死(F-a/F-b):没拿到 session_started,绝不伪造可 resume(A1/A2,02 I5)。
      // 首轮致命(无 id 可续、无既有进度);非首轮可降级 stateless 重来(§8 退化路径)。
      const isFirstTurnForAgent = !sess.resumable;
      await deps.blackboard.append(systemMessage(round, 'SUBPROCESS_SPAWN_FAILED', []));
      return { ok: false, directive, code: 'SUBPROCESS_SPAWN_FAILED', fatal: isFirstTurnForAgent };
    }
    if (parsed.kind === 'crashed_after_gate') {
      // 闸门后死(F-c):id 已落 agent_session,可 resume 续接,或 stateless 重来。本轮可重试(非致命)。
      if (parsed.sessionId) await deps.blackboard.recordSession(agent, parsed.sessionId);
      if (attempt < params.retryOnReject) {
        attempt++;
        continue;
      }
      await deps.blackboard.append(systemMessage(round, parsed.code, []));
      return { ok: false, directive, code: parsed.code, fatal: false };
    }
    // parsed.kind === 'parsed'
    if (parsed.sessionId) await deps.blackboard.recordSession(agent, parsed.sessionId);

    if (!parsed.payload) {
      // safeParse 失败(raw 不合 02 §6.1 瘦子集):按 OUTPUT_SCHEMA_VIOLATION 打回重试。
      if (attempt < params.retryOnReject) {
        rejectFeedback = `上轮输出不合 schema(${parsed.parseError ?? 'parse error'}),请严格按 output schema 重发。`;
        attempt++;
        continue;
      }
      await deps.blackboard.append(systemMessage(round, 'OUTPUT_SCHEMA_VIOLATION', []));
      return { ok: false, directive, code: 'OUTPUT_SCHEMA_VIOLATION', fatal: false };
    }

    // 5. safeParse + 跨字段 + evidence 可核验(黑板 02 §8 validateMessage 桥接,H12)
    const candidate: AppendInput = { from: agent, role, round, payload: parsed.payload };
    const v = deps.validate(candidate, round);
    if (v.ok) {
      return parsed.usage
        ? { ok: true, directive, payload: parsed.payload, usage: parsed.usage }
        : { ok: true, directive, payload: parsed.payload };
    }

    // 6. 打回处理(02 §8.4 错误码 → 动作)
    if (isRetriable(v.code)) {
      rejectFeedback = `上轮被打回(${v.code}): ${v.message}。请补强可核验 evidence 后重发。`;
      attempt++;
      continue;
    }
    // 不可重试的协议违规(路径越界/悬空 inReplyTo/system 伪造):落 system,计无效发言,非致命。
    await deps.blackboard.append(systemMessage(round, v.code, []));
    return { ok: false, directive, code: v.code, fatal: false };
  }
  // 重试耗尽(schema/evidence 始终不达标)
  return { ok: false, directive, code: 'OUTPUT_SCHEMA_VIOLATION', fatal: false };
}

/** 把上次打回原因回灌进下次 prompt(经边界标记,防二次注入,02 §8.4 注)。 */
function withFeedback(base: AgentInput, feedback?: string): AgentInput {
  if (!feedback) return base;
  return {
    ...base,
    prompt: `${base.prompt}\n\n[REJECT_FEEDBACK]\n<<<SYLUX_ORCH_FEEDBACK\n${feedback}\nSYLUX_ORCH_FEEDBACK>>>`,
  };
}

/** 可重试错误码:schema/evidence 类(打回回灌重发);协议违规类不可重试(03 §5.2/§8)。 */
function isRetriable(code: SyluxErrorCode): boolean {
  return (
    code === 'OUTPUT_SCHEMA_VIOLATION' ||
    code === 'EVIDENCE_REQUIRED' ||
    code === 'EVIDENCE_UNVERIFIABLE'
  );
}

// ============================================================================
// 5. consume —— 事件流消费(02 §6.3 AgentEvent → payload + usage,03 §5.3)
// ============================================================================

type ConsumeResult =
  | { kind: 'spawn_failed'; code?: string; detail?: string } // 闸门前:无 sessionId,不可 resume
  | { kind: 'crashed_after_gate'; code: SyluxErrorCode; sessionId?: string; detail?: string } // 闸门后:可 resume
  | { kind: 'parsed'; sessionId?: string; payload?: AgentMessagePayload; usage?: TokenUsage; parseError?: string };

/**
 * 消费 AgentEvent 流,归三类(H4 闸门分类铁律):
 *  - spawn_failed:进程结束但从未 session_started(闸门前 spawn/启动崩溃,不可 resume)。
 *  - crashed_after_gate:已 session_started 但 turn 中途 error / 无 final_message(可 resume)。
 *  - parsed:正常拿到 final_message;raw 经 agentMessagePayloadSchema.safeParse(失败 payload=undefined→走打回)。
 * token usage 直接取 final_message.usage(源自 turn.completed.usage,中转回吐可靠,事实地基 B/D),不本地估算。
 */
async function consume(stream: AsyncIterable<AgentEvent>, deps: EngineDeps): Promise<ConsumeResult> {
  let sessionId: string | undefined;
  let raw: string | undefined;
  let usage: TokenUsage | undefined;
  let sawSessionStarted = false;

  for await (const ev of stream) {
    switch (ev.kind) {
      case 'session_started': // I5:必为首事件
        sawSessionStarted = true;
        sessionId = ev.sessionId;
        break;
      case 'delta':
      case 'tool_call':
        deps.logger.stream(ev); // 透传面板观战(面板 10 / WS 11),不入黑板
        break;
      case 'final_message':
        raw = ev.raw; // 待 safeParse 的最终 JSON 文本(02 §6.3)
        usage = ev.usage; // 取自 turn.completed.usage(事实地基 B/D)
        break;
      case 'error':
        // H4:闸门后崩溃(已 session_started)→ crashed_after_gate(可 resume);否则 spawn_failed。
        if (sawSessionStarted) {
          const code = mapErrorCode(ev.code);
          return sessionId !== undefined
            ? { kind: 'crashed_after_gate', code, sessionId, detail: ev.detail }
            : { kind: 'crashed_after_gate', code, detail: ev.detail };
        }
        return { kind: 'spawn_failed', code: ev.code, detail: ev.detail };
    }
  }

  // 进程结束但没 session_started → 闸门前崩溃(事实地基 A/B,适配 05 F-a/F-b)
  if (!sawSessionStarted) return { kind: 'spawn_failed' };
  // 有 session_started 但无 final_message(turn 中途断流)→ 闸门后崩溃,可 resume(F-c)
  if (raw === undefined) {
    return sessionId !== undefined
      ? { kind: 'crashed_after_gate', code: 'SUBPROCESS_CRASHED', sessionId }
      : { kind: 'crashed_after_gate', code: 'SUBPROCESS_CRASHED' };
  }

  // raw → AgentMessagePayload(02 §6.1 瘦子集);safeParse 失败在 runTurn 的 validate 阶段统一打回。
  const r = agentMessagePayloadSchema.safeParse(safeJsonParse(raw));
  if (!r.success) {
    return sessionId !== undefined
      ? { kind: 'parsed', sessionId, parseError: r.error.message, ...(usage ? { usage } : {}) }
      : { kind: 'parsed', parseError: r.error.message, ...(usage ? { usage } : {}) };
  }
  return sessionId !== undefined
    ? { kind: 'parsed', sessionId, payload: r.data, ...(usage ? { usage } : {}) }
    : { kind: 'parsed', payload: r.data, ...(usage ? { usage } : {}) };
}

/** 容错 JSON.parse:失败返回 undefined(交 safeParse 报 schema 错,守门函数不崩)。 */
function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** 适配器 error.code(string)→ SyluxErrorCode(闸门后崩溃归类)。未识别归 SUBPROCESS_CRASHED。 */
function mapErrorCode(code: string): SyluxErrorCode {
  if (code === 'SUBPROCESS_CANCELLED' || code === 'SUBPROCESS_TIMEOUT') return code;
  if (code === 'SUBPROCESS_CRASHED') return code;
  return 'SUBPROCESS_CRASHED';
}

// 复用消除:SyluxError 已从 shared 引入(供 wireEngine/装配层抛配置错时用),此处显式 re-export 方便消费方。
export { SyluxError };
