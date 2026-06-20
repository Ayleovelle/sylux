/**
 * @sylux/core · stop-policy.ts
 *
 * ★ 收敛检测与三重刹车的【权威实现】(权威设计:04-convergence-brakes.md v3)。★
 *
 * 本文件拥有:`StopPolicy` / `StopContext` / `StopDecision` / `KEEP_RUNNING` /
 *   `MaxRoundsPolicy` / `ConvergencePolicy` / `BudgetPolicy` / `DonePolicy` /
 *   `PlaybookDonePolicy` / `CompositeStopPolicy` / `buildStopPolicy` + cost-model 工具。
 * 引擎(engine.ts)只【注入、只调用】——每轮末 `update(ctx)` 再 `shouldStop(ctx)`(04 §2.4)。
 *
 * 类型引用纪律(焊死 R1):`Message`/`Round`/`TokenUsage`/`RunStatus`/`SyluxErrorCode` 等
 *   一律从 `@sylux/shared`(02 权威)引用,本文件不另定义;指纹差集只消费已落盘的
 *   `Round.evidenceFingerprints`(02 §9.2 入黑板时算好缓存),刹车层零复算(04 §2.1)。
 *
 * 物理落点(04 §1):真实仓内拆 stop/{stop-policy,max-rounds,convergence,budget,done-detector,cost-model}.ts;
 *   骨架阶段合并为单文件,便于一次性 tsc 自洽校验。拆分时按 §1 目录搬运、import 不变。
 */

import type {
  Round,
  Message,
  TokenUsage,
  RunStatus,
  SyluxErrorCode,
} from '../shared/index.js';

// ============================================================================
// 1. cost-model —— 事实地基 D 成本公式 + 实测优先外推(04 §6.2)
// ============================================================================

/** provider 计价(每百万 token 美元)。由 provider 文档 07 配置注入,本层不硬编码(04 §6.2)。 */
export interface TokenPricing {
  readonly inputPerM: number;
  readonly cachedInputPerM: number;
  readonly outputPerM: number;
}

/** 事实 D 实测基线:最简回合固定 input 开销;usage 缺失时的保守地板(04 H-USAGE,事实 D §47)。 */
export const BASELINE_INPUT_PER_ROUND = 18_700 as const;

/**
 * 每轮 output 基线地板(04 H-OUT0/ROC-M1)。outputTokens 缺失时的保守下界,绝不当 0;
 * 否则 output 占比高的 reasoning 模型上 maxCostUsd 会失明。M2 用实测分布校准(04 §6.2)。
 */
export const BASELINE_OUTPUT_PER_ROUND = 3_000 as const;

/** 全零 usage 常量(收敛 reset 占位等;收敛策略不读 usage,故零值无害,04 §6.2)。 */
export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

/** 把一段 TokenUsage 折算成美元(单轮或累积均可,04 §6.2)。 */
export function usageToUsd(u: TokenUsage, p: TokenPricing): number {
  const nonCachedInput = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    (nonCachedInput * p.inputPerM +
      u.cachedInputTokens * p.cachedInputPerM +
      (u.outputTokens + u.reasoningOutputTokens) * p.outputPerM) /
    1_000_000
  );
}

/**
 * 双侧地板兜底:任一字段缺失/偏低都不当 0(04 H-USAGE + H-OUT0)。
 * `nRounds` = 已完成轮数(按轮放大地板);单轮兜底传 1。input 与 output 都兜,杜绝半兜底。
 */
export function floorUsage(u: TokenUsage, nRounds: number): TokenUsage {
  const n = Math.max(1, nRounds);
  return {
    ...u,
    inputTokens: Math.max(u.inputTokens, BASELINE_INPUT_PER_ROUND * n),
    outputTokens: Math.max(u.outputTokens, BASELINE_OUTPUT_PER_ROUND * n),
  };
}

/** 从 ctx.rounds 取各轮实测 input 序列(缺失按 base 地板兜底,04 §6.2/H-USAGE)。 */
export function roundInputSeries(rounds: readonly Round[], base: number): number[] {
  return rounds.map((r) => Math.max(r.usage?.inputTokens ?? 0, base));
}

/**
 * 实测优先的下一轮【增量 input】预测(04 H-B3)。不假设 continuity regime。
 *  ① ≥2 轮实测 → 线性外推 Δ=max(0,last-prev),predicted=max(last+Δ, base)。
 *     stateless:Δ≈0→predicted≈last(近似平);resume:Δ≈base→predicted≈last+base(超线性)。
 *  ② 仅 1 轮 → max(last, base);③ 冷启动 0 轮 → base(下一轮上界兜底)。
 * 三档都以 base 为地板,保证不低估(04 H-USAGE)。
 */
export function predictNextRoundInputTokens(
  roundInputSeries: readonly number[],
  baseInputPerRound: number,
): number {
  const n = roundInputSeries.length;
  if (n >= 2) {
    const last = roundInputSeries[n - 1] ?? baseInputPerRound;
    const prev = roundInputSeries[n - 2] ?? baseInputPerRound;
    const delta = Math.max(0, last - prev); // 负增量(裁剪/缓存)不外推为负
    return Math.max(last + delta, baseInputPerRound);
  }
  if (n === 1) return Math.max(roundInputSeries[0] ?? baseInputPerRound, baseInputPerRound);
  return baseInputPerRound; // 冷启动:下一轮上界 ≈ base
}

// ============================================================================
// 2. StopContext / StopDecision(04 §2.1/§2.2)
// ============================================================================

/** 每轮末喂给 StopPolicy 的只读快照。引擎组装(engine.buildStopContext),刹车只读(04 §2.1)。 */
export interface StopContext {
  /** 刚关闭的轮号(0-based,= BoardState.currentRound)。 */
  readonly round: number;
  /** 全量轮快照(含本轮);收敛差集回看历史 + 预算实测外推取最近两轮 usage 用。 */
  readonly rounds: readonly Round[];
  /** 本轮新增消息(已过 validateMessage,02 §8);本轮内信号用。 */
  readonly roundMessages: readonly Message[];
  /**
   * 全量消息只读快照(= BoardState.messages,按 seq 升序,02 I6)。
   * done 检测必须跨轮配对(红蓝偶轮 done、奇轮 ack,04 H-DONE),只看本轮永远配不上。
   */
  readonly messages: readonly Message[];
  /** 累计 token(全 run 求和;B3 触发用)。已在 buildStopContext 双侧兜底(04 H-USAGE/H-OUT0)。 */
  readonly totalUsage: TokenUsage;
  /** 本轮 token(= Round.usage);实测外推的最近一轮锚点(04 §6.2)。缺失同样按基线兜底。 */
  readonly lastRoundUsage: TokenUsage | undefined;
  /**
   * 本轮是否"应当产出新证据"(playbook 标注,04 H-EMPTY / 03 H15 RoundPlan.stallEligible)。默认 true。
   * master-worker 派活轮 / parallel 同步轮 / review 复用旧锚点轮 = false:ConvergencePolicy 冻结 stall 计数(S9)。
   */
  readonly roundEvidenceExpected: boolean;
  /**
   * 中枢侧核验是否降级(04 H-DEGRADE / COV-3)。默认 false。
   * 复跑器/沙箱基础设施故障致 evidence 无法核验时为 true → ConvergencePolicy 冻结 stall 计数(S9),不连坐 critic。
   */
  readonly roundVerificationDegraded: boolean;
  /** 当前状态(paused 时引擎不调 StopPolicy;此处恒为 running)。 */
  readonly status: RunStatus;
}

/** 单条刹车 / 出口的裁决结果(04 §2.2)。 */
export interface StopDecision {
  /** 是否应终止本 run。 */
  readonly shouldStop: boolean;
  /** 终止时的目标终态;shouldStop=false 时省略。 */
  readonly status?: Extract<RunStatus, 'done' | 'stalled' | 'limit' | 'aborted'>;
  /** 终止原因错误码(done 出口省略,正常完成无错误码)。 */
  readonly code?: SyluxErrorCode;
  /**
   * 人类可读原因(写入 system 消息 body + status_changed.reason)。
   * ★S8/H-INJ:只用枚举值/数字/中枢常量模板,绝不内插 agent 可控自由文本(防注入/日志投毒)。
   */
  readonly reason?: string;
  /** 结构化指标(面板展示 + 审计;不参与控制流)。 */
  readonly metrics?: Readonly<Record<string, number | string>>;
}

/** 不停的规范返回值(常量,避免每轮新建对象,04 §2.2)。 */
export const KEEP_RUNNING: StopDecision = Object.freeze({ shouldStop: false });

/** 扇出前瞻裁决:并发 spawn N 个 turn【之前】判这一轮扇出会不会跨预算(04 §6.6 H-FANOUT)。 */
export interface FanoutPreflight {
  readonly allowed: boolean;
  readonly code?: SyluxErrorCode;
  readonly reason?: string;
  /** 不允许时建议的最大安全成员数(引擎据此降并发重试,而非硬停)。 */
  readonly maxSafeMembers?: number;
  readonly metrics?: Readonly<Record<string, number | string>>;
}

// ============================================================================
// 3. StopPolicy 接口本体(04 §2.3)
// ============================================================================

export interface StopPolicy {
  /** 稳定标识(日志/面板/审计用,如 'max-rounds'|'convergence'|'budget'|'done')。 */
  readonly id: string;

  /**
   * 每轮末推进内部状态(纯状态机,无副作用,不读外部 IO)。
   * 无状态刹车(maxRounds/budget)可空实现;有状态刹车(convergence stall 计数)必须实现。
   * 幂等(04 §3.4):同一 round 重复 update 不得重复累加(防回放/重试双计)。
   */
  update(ctx: StopContext): void;

  /** 读取当前裁决(纯读,不改状态)。必须在 update 之后调用(04 §2.3)。 */
  shouldStop(ctx: StopContext): StopDecision;

  /** 可选:供回放/崩溃恢复从已落盘 rounds 重放重建内部状态(04 §4.4)。 */
  reset?(rounds: readonly Round[]): void;

  /**
   * 可选:运行期热换【阈值类配置】(04 H-HOTSWAP)。下一轮 shouldStop 生效。
   * ★铁律 S12:只改阈值,绝不触碰累积状态(seen/emptyStreak/lastUpdatedRound),否则热换会让
   *   已接近收敛的 run 起死回生。patch 为对应 *Config 的浅 Partial,未给字段保持原值。
   */
  reconfigure?(patch: Readonly<Record<string, unknown>>): void;
}

// ============================================================================
// 4. B1 · maxRounds 硬上限(确定性安全网,04 §3)
// ============================================================================

export interface MaxRoundsConfig {
  /** 硬上限(含):round 达 maxRounds-1 完成后即停(round 0-based)。必 ≥1。 */
  readonly maxRounds: number;
}

export class MaxRoundsPolicy implements StopPolicy {
  readonly id = 'max-rounds';
  // 可变私有:reconfigure 热换需改(无累积状态,整表替换安全,S12)。
  private cfg: MaxRoundsConfig;
  constructor(cfg: MaxRoundsConfig) {
    if (cfg.maxRounds < 1) throw new Error('maxRounds 必 ≥1');
    this.cfg = cfg;
  }
  update(_ctx: StopContext): void {
    /* 无状态 */
  }

  shouldStop(ctx: StopContext): StopDecision {
    // round 0-based:刚关闭第 round 轮,已完成 round+1 轮。
    if (ctx.round + 1 >= this.cfg.maxRounds) {
      return {
        shouldStop: true,
        status: 'limit',
        code: 'ROUND_LIMIT_EXCEEDED',
        reason: `达到 maxRounds 硬上限(${this.cfg.maxRounds} 轮)`,
        metrics: { roundsRun: ctx.round + 1, maxRounds: this.cfg.maxRounds },
      };
    }
    return KEEP_RUNNING;
  }

  reconfigure(patch: Partial<MaxRoundsConfig>): void {
    const next = { ...this.cfg, ...patch };
    if (next.maxRounds < 1) throw new Error('maxRounds 必 ≥1');
    this.cfg = next;
  }
}

// ============================================================================
// 5. B2 · 收敛检测(evidence 指纹差集,焊死 R5,04 §4)
// ============================================================================

export interface ConvergenceConfig {
  /** 连续多少轮"新指纹空集"才判 stall(默认 2)。必 ≥1。 */
  readonly stallWindow: number;
  /** 是否把 spec_quote(`s:`)弱指纹计入"新证据"。默认 false(易换引文刷新,削弱灵敏度)。 */
  readonly countSpecQuote: boolean;
  /** 最小活跃轮:前 minActiveRounds 轮即使空集也不计 stall(默认 1,防开场误判)。 */
  readonly minActiveRounds: number;
  /**
   * 只让"核验通过的强指纹"清零 stall 计数(默认 true,04 H-FP)。
   * true 时剔除 `:?` 占位与(由 countSpecQuote 控的)`s:` 弱指纹——否则对抗 agent 每轮换区间产新
   * `:?` 指纹即可无限拖住 stall(收敛被架空)。设 false 仅用于调试或确知无对抗场景。
   */
  readonly requireVerifiedProgress: boolean;
}

export class ConvergencePolicy implements StopPolicy {
  readonly id = 'convergence';

  /** 历史所有轮已见过的指纹全集(差集的被减数)。 */
  private seen = new Set<string>();
  /** 连续"新指纹空集"轮数。 */
  private emptyStreak = 0;
  /** 已 update 到哪一轮(幂等护栏,04 §4.4)。 */
  private lastUpdatedRound = -1;

  // cfg 可变私有(非 readonly):reconfigure 热换阈值需改它,但只改阈值不动计数器(S12)。
  private cfg: ConvergenceConfig;
  constructor(cfg: ConvergenceConfig) {
    if (cfg.stallWindow < 1) throw new Error('stallWindow 必 ≥1');
    this.cfg = cfg;
  }

  update(ctx: StopContext): void {
    // 幂等:同一轮重复 update 不重复累加(回放/重试护栏,04 §4.4)。
    if (ctx.round <= this.lastUpdatedRound) return;
    this.lastUpdatedRound = ctx.round;

    const round = ctx.rounds[ctx.round];
    const incoming = this.filterFingerprints(round?.evidenceFingerprints ?? []);

    // 本轮新指纹 = incoming \ seen(02 §9.3 差集);check-and-add 单趟,避免本轮自指纹自我抵消。
    // 无论本轮是否冻结,真实强指纹都并入 seen(它们是历史证据,后续轮算差集要用,04 §4.3)。
    let hasNew = false;
    for (const fp of incoming) {
      if (!this.seen.has(fp)) {
        hasNew = true;
        this.seen.add(fp);
      }
    }

    // S9(H-EMPTY/H-DEGRADE):非"该出证据"轮 / 中枢核验降级轮,冻结 stall 计数——
    // 既不累加也不清零,恢复后从原 streak 续算(冻结≠清零)。
    if (!ctx.roundEvidenceExpected || ctx.roundVerificationDegraded) {
      return; // 冻结:seen 已更新,但不动 emptyStreak
    }

    if (ctx.round < this.cfg.minActiveRounds) {
      this.emptyStreak = 0; // 开场宽限
    } else if (hasNew) {
      this.emptyStreak = 0; // 有新证据,清零
    } else {
      this.emptyStreak += 1; // 空集,连续计数 +1
    }
  }

  shouldStop(_ctx: StopContext): StopDecision {
    if (this.emptyStreak >= this.cfg.stallWindow) {
      return {
        shouldStop: true,
        status: 'stalled',
        code: 'CONVERGENCE_STALL',
        reason: `连续 ${this.emptyStreak} 轮无新可核验证据(stallWindow=${this.cfg.stallWindow})`,
        metrics: {
          emptyStreak: this.emptyStreak,
          seenFingerprints: this.seen.size,
          stallWindow: this.cfg.stallWindow,
        },
      };
    }
    return KEEP_RUNNING;
  }

  /**
   * 按配置过滤"算作进展"的指纹(02 §9.2 指纹前缀语义,04 §4.3):
   * - `s:` = spec_quote 弱指纹;countSpecQuote=false 时剔除。
   * - 末尾 `:?` = 未核验 file_ref 占位指纹;requireVerifiedProgress=true 时剔除(H-FP)。
   * 剩下的才是"核验通过的强指纹",只有它们能清零 stall 计数(S6)。
   */
  private filterFingerprints(fps: readonly string[]): string[] {
    return fps.filter((fp) => {
      if (!this.cfg.countSpecQuote && fp.startsWith('s:')) return false;
      if (this.cfg.requireVerifiedProgress && fp.endsWith(':?')) return false;
      return true;
    });
  }

  /**
   * 回放/崩溃恢复:从已落盘 rounds 重放重建 seen + emptyStreak(04 §4.4)。
   * 回放各轮的 roundEvidenceExpected/roundVerificationDegraded 从落盘 round 元数据取;
   * 骨架阶段 Round 暂未落该两字段(待 02 回填,见 04 §13.2),缺失保守按 true/false 重放(回放偏严,可接受)。
   */
  reset(rounds: readonly Round[]): void {
    this.seen.clear();
    this.emptyStreak = 0;
    this.lastUpdatedRound = -1;
    for (let r = 0; r < rounds.length; r++) {
      this.update({
        round: r,
        rounds,
        roundMessages: [],
        messages: [],
        totalUsage: ZERO_USAGE,
        lastRoundUsage: undefined,
        // TODO(02 回填 §13.2):Round 落盘 evidenceExpected/verificationDegraded 后改读真值。
        roundEvidenceExpected: true,
        roundVerificationDegraded: false,
        status: 'running',
      });
    }
  }

  /** 热换阈值(H-HOTSWAP):只改 stallWindow 等阈值,绝不动 seen/emptyStreak(S12)。 */
  reconfigure(patch: Partial<ConvergenceConfig>): void {
    if (patch.stallWindow !== undefined && patch.stallWindow < 1) {
      throw new Error('stallWindow 必 ≥1');
    }
    this.cfg = { ...this.cfg, ...patch }; // 计数器岿然不动
  }
}

// ============================================================================
// 6. B3 · 成本上限(累积 token / 费用 + 实测优先前瞻,事实地基 D,04 §6)
// ============================================================================

export interface BudgetConfig {
  /** 累计 token 硬上限(全 run input+output 求和);省略表示不限 token。 */
  readonly maxTotalTokens?: number;
  /** 累计费用硬上限(美元);需配 pricing 才生效。 */
  readonly maxCostUsd?: number;
  /** provider 计价(算 maxCostUsd 必需;只设 maxTotalTokens 可省)。 */
  readonly pricing?: TokenPricing;
  /** 前瞻刹车开关(默认 true):每轮末预测下一轮增量,会超则提前停,不启动注定超预算的下一轮。 */
  readonly lookahead: boolean;
  /** 前瞻安全系数(默认 1.0):predicted×factor 后再比较。>1 更保守,<1 更激进。 */
  readonly lookaheadFactor: number;
  /**
   * 单 turn token 硬上限(04 H-FANOUT)。省略表示不限。引擎在 runTurn 内强制(超则杀该 turn);
   * 本字段供 preflightFanout 估扇出预算用(§6.6)。
   */
  readonly maxTurnTokens?: number;
}

export class BudgetPolicy implements StopPolicy {
  readonly id = 'budget';
  // cfg 可变(非 readonly):reconfigure 热换上限(S12);budget 无累积状态,直接替换安全。
  private cfg: BudgetConfig;
  constructor(cfg: BudgetConfig) {
    if (cfg.maxCostUsd !== undefined && !cfg.pricing) {
      throw new Error('设置 maxCostUsd 必须同时提供 pricing');
    }
    this.cfg = cfg;
  }
  update(_ctx: StopContext): void {
    /* 无状态:每轮读 totalUsage 实测值即可 */
  }

  /** 热换上限(H-HOTSWAP):budget 无累积计数器,整表替换即可;校验同构造期。 */
  reconfigure(patch: Partial<BudgetConfig>): void {
    const next = { ...this.cfg, ...patch };
    if (next.maxCostUsd !== undefined && !next.pricing) {
      throw new Error('设置 maxCostUsd 必须同时提供 pricing');
    }
    this.cfg = next;
  }

  shouldStop(ctx: StopContext): StopDecision {
    // H-USAGE+H-OUT0:totalUsage 已在 buildStopContext 兜底;此处再过双侧地板,双重保险。
    const floored = floorUsage(ctx.totalUsage, ctx.round + 1);
    const totalTokens = floored.inputTokens + floored.outputTokens + floored.reasoningOutputTokens;
    const costUsd = this.cfg.pricing ? usageToUsd(floored, this.cfg.pricing) : undefined;

    // ① 确定性触发:实测累积(含基线兜底)已触顶(S4)。
    if (this.cfg.maxTotalTokens !== undefined && totalTokens >= this.cfg.maxTotalTokens) {
      return this.exceeded('token', totalTokens, costUsd, ctx, false);
    }
    if (
      this.cfg.maxCostUsd !== undefined &&
      costUsd !== undefined &&
      costUsd >= this.cfg.maxCostUsd
    ) {
      return this.exceeded('cost', totalTokens, costUsd, ctx, false);
    }

    // ② 前瞻刹车:用【实测优先】外推预测下一轮增量(H-B3:不再无脑超线性)。
    if (this.cfg.lookahead) {
      const base = ctx.rounds[0]?.usage?.inputTokens ?? BASELINE_INPUT_PER_ROUND;
      const series = roundInputSeries(ctx.rounds, base);
      const predictedNextInput =
        predictNextRoundInputTokens(series, base) * this.cfg.lookaheadFactor;
      const projectedTokens = totalTokens + predictedNextInput;
      if (this.cfg.maxTotalTokens !== undefined && projectedTokens >= this.cfg.maxTotalTokens) {
        return this.exceeded('token', totalTokens, costUsd, ctx, true, predictedNextInput);
      }
      if (this.cfg.maxCostUsd !== undefined && costUsd !== undefined && this.cfg.pricing) {
        // 预测增量折算成本(全按未命中缓存 input 价,保守上界)。
        const predictedCost = (predictedNextInput * this.cfg.pricing.inputPerM) / 1_000_000;
        if (costUsd + predictedCost >= this.cfg.maxCostUsd) {
          return this.exceeded('cost', totalTokens, costUsd, ctx, true, predictedNextInput);
        }
      }
    }
    return KEEP_RUNNING;
  }

  /**
   * 扇出前瞻(纯函数,引擎在 panel spawn 前调,不改状态,04 §6.6 H-FANOUT)。
   * @param plannedMembers 本轮计划并发的成员数 N(panel 大小;串行循环传 1)。
   * @param perMemberTokensHint 单成员预估 token(引擎/17 给;无则用 maxTurnTokens,再无则实测外推单轮值)。
   */
  preflightFanout(
    ctx: StopContext,
    plannedMembers: number,
    perMemberTokensHint?: number,
  ): FanoutPreflight {
    const floored = floorUsage(ctx.totalUsage, ctx.round + 1);
    const usedTokens =
      floored.inputTokens + floored.outputTokens + floored.reasoningOutputTokens;
    const base = ctx.rounds[0]?.usage?.inputTokens ?? BASELINE_INPUT_PER_ROUND;
    const series = roundInputSeries(ctx.rounds, base);
    // 单成员成本上界:优先 hint,其次 maxTurnTokens(硬墙即最坏),再次实测外推单轮 input。
    const perMember = Math.max(
      perMemberTokensHint ?? 0,
      this.cfg.maxTurnTokens ?? 0,
      predictNextRoundInputTokens(series, base),
    );
    const members = Math.max(1, plannedMembers);
    const projected = usedTokens + perMember * members;

    const overToken =
      this.cfg.maxTotalTokens !== undefined && projected >= this.cfg.maxTotalTokens;
    const projectedCost = this.cfg.pricing
      ? usageToUsd({ ...floored, inputTokens: floored.inputTokens + perMember * members }, this.cfg.pricing)
      : undefined;
    const overCost =
      this.cfg.maxCostUsd !== undefined &&
      projectedCost !== undefined &&
      projectedCost >= this.cfg.maxCostUsd;

    if (!overToken && !overCost) {
      return { allowed: true, metrics: { plannedMembers: members, perMember, projected } };
    }
    // 还能安全扇出几个成员(剩余预算 / 单成员),供引擎降并发而非硬停。
    const remaining = (this.cfg.maxTotalTokens ?? Infinity) - usedTokens;
    const maxSafeMembers = Number.isFinite(remaining)
      ? Math.max(0, Math.floor(remaining / Math.max(1, perMember)))
      : members;
    return {
      allowed: false,
      code: 'TOKEN_BUDGET_EXCEEDED',
      // S8/H-INJ:仅数字与枚举,无 agent 文本。
      reason: `扇出前瞻:计划 ${members} 成员×≈${Math.round(perMember)} token 将超预算,建议降至 ${maxSafeMembers} 成员或停`,
      maxSafeMembers,
      metrics: { plannedMembers: members, perMember, projected, maxSafeMembers },
    };
  }

  private exceeded(
    by: 'token' | 'cost',
    totalTokens: number,
    costUsd: number | undefined,
    ctx: StopContext,
    lookahead: boolean,
    predicted?: number,
  ): StopDecision {
    const limit = by === 'token' ? this.cfg.maxTotalTokens : this.cfg.maxCostUsd;
    // S8/H-INJ:reason 只用枚举 by + 数字,无 agent 自由文本。
    const metrics: Record<string, number | string> = {
      totalTokens,
      triggeredBy: by,
      lookahead: lookahead ? 1 : 0,
    };
    if (costUsd !== undefined) metrics['costUsd'] = Number(costUsd.toFixed(4));
    if (predicted !== undefined) metrics['predictedNextInput'] = Math.round(predicted);
    return {
      shouldStop: true,
      status: 'limit',
      code: 'TOKEN_BUDGET_EXCEEDED',
      reason: lookahead
        ? `前瞻刹车:预测下一轮增量≈${Math.round(predicted ?? 0)} token,将超${by}上限(${limit}),提前停于第 ${ctx.round} 轮`
        : `累积${by}已达上限(${by === 'token' ? totalTokens : costUsd?.toFixed(4)}/${limit})`,
      metrics,
    };
  }
}

// ============================================================================
// 7. done · 成功出口(引用 02 C2,非刹车,04 §7)
// ============================================================================

/**
 * done 成立的充要条件(02 §5.2 C2/C3 + §2 语义):
 *  ① 全 run 存在 kind==='done';② 存在 kind==='ack' 且 from≠done.from、inReplyTo===done.id;
 *  ③ 该 ack 已过 02 §8 validateMessage(evidence 非空且 ≥1 强核验)。验证在入黑板时做,本层只读结论(S2)。
 * 跨轮配对(H-DONE):done 与 ack 几乎不在同一轮,故扫全量 ctx.messages,非仅 roundMessages。
 */
export class DonePolicy implements StopPolicy {
  readonly id = 'done';
  update(_ctx: StopContext): void {
    /* 无状态:每轮全量扫 messages 配对 */
  }

  shouldStop(ctx: StopContext): StopDecision {
    const dones = ctx.messages.filter((m) => m.kind === 'done');
    for (const done of dones) {
      const ack = ctx.messages.find(
        (m) =>
          m.kind === 'ack' &&
          m.from !== done.from && // 02 C3:对面 ack,非自 ack
          m.inReplyTo === done.id && // 指向该 done
          m.evidence.length > 0, // 02 C2:ack 带证据(强核验已在入黑板时保证,冗余廉价护栏)
      );
      if (ack) {
        // S8/H-INJ:from 是闭枚举(02 §2),固定模板,无 agent 自由文本入 reason。
        return {
          shouldStop: true,
          status: 'done',
          // 成功出口无错误码:code 省略(exactOptionalPropertyTypes 下不显式置 undefined)。
          reason: `done 被对面带证据 ack(done.from=${done.from}, ack.from=${ack.from})`,
          metrics: {
            doneRound: done.round,
            ackRound: ack.round,
            ackEvidenceCount: ack.evidence.length,
          },
        };
      }
    }
    return KEEP_RUNNING;
  }
}

/**
 * 范式特定完成判据的包装器(引擎 03 H2 点名要本文件提供)。
 * 把 playbook.isDone 这类"通用 done+ack 覆盖不到"的门(parallel 全 lane done 无 ack、
 * master-worker 清单全 accept)接入 composite,与 DonePolicy 并列、同享优先级 0。
 */
export class PlaybookDonePolicy implements StopPolicy {
  readonly id = 'playbook-done';
  /**
   * @param probe 引擎注入的范式完成探针,内部调 playbook.isDone(board)(03 §4.3 闭包桥接 board→ctx)。
   *   必须纯读(playbook.isDone 是只读 BoardView),无副作用。
   */
  constructor(private readonly probe: (ctx: StopContext) => boolean) {}

  update(_ctx: StopContext): void {
    /* 无状态:每轮重新问 probe */
  }

  shouldStop(ctx: StopContext): StopDecision {
    if (!this.probe(ctx)) return KEEP_RUNNING;
    // S8/H-INJ:reason 为固定常量,无 agent 文本。
    return {
      shouldStop: true,
      status: 'done',
      reason: '范式特定完成判据满足(playbook.isDone)',
      metrics: { doneRound: ctx.round, source: 'playbook' },
    };
  }
}

// ============================================================================
// 8. CompositeStopPolicy · 聚合与优先级裁决(S5,04 §8)
// ============================================================================

/** 优先级表:数值越小优先级越高。done 最优先(成功出口优于任何安全网终止,04 §8.2)。 */
const PRIORITY: Record<NonNullable<StopDecision['status']>, number> = {
  done: 0, // 成功出口最优先:既已带证据达成一致,即便同轮触顶也算成功
  aborted: 1, // 人工/致命错误次之
  limit: 2, // 硬上限(maxRounds / budget)
  stalled: 3, // 被动 stall 最低
};

export class CompositeStopPolicy implements StopPolicy {
  readonly id = 'composite';
  constructor(private readonly children: readonly StopPolicy[]) {}

  /** ① 先无条件 update 全部子 policy —— 不短路,保证有状态刹车(stall 计数)不漏更新(04 §8.1)。 */
  update(ctx: StopContext): void {
    for (const p of this.children) p.update(ctx);
  }

  /** ② 后裁决:收集所有 shouldStop 的子决策,按优先级取唯一终态(04 §8.2)。 */
  shouldStop(ctx: StopContext): StopDecision {
    const fired = this.children
      .map((p) => ({ id: p.id, d: p.shouldStop(ctx) }))
      .filter((x) => x.d.shouldStop);
    if (fired.length === 0) return KEEP_RUNNING;
    // 健壮性:shouldStop=true 必带 status(接口契约);防御性地把缺 status 的当最低优先级,
    // 避免 PRIORITY[undefined] 取 NaN 破坏排序(NaN 比较恒 false 会乱序,04 §8.1)。
    const prio = (d: StopDecision): number =>
      d.status === undefined ? Number.MAX_SAFE_INTEGER : PRIORITY[d.status];
    fired.sort((a, b) => prio(a.d) - prio(b.d));
    const winner = fired[0];
    if (!winner) return KEEP_RUNNING; // noUncheckedIndexedAccess 窄化(fired.length>0 已保证非空)
    // 多条同触发时,把并发触发的其他信号塞进 metrics 供审计(不改终态)。
    return {
      ...winner.d,
      metrics: {
        ...winner.d.metrics,
        coFired: fired.map((f) => `${f.id}:${f.d.status ?? 'unknown'}`).join(','),
      },
    };
  }

  reset(rounds: readonly Round[]): void {
    for (const p of this.children) p.reset?.(rounds);
  }

  /**
   * 热换:按 child id 把对应 patch 透传给子 policy(04 H-HOTSWAP / §8.4)。
   * patches 形如 { 'max-rounds': {maxRounds}, convergence: {stallWindow}, budget: {maxCostUsd} }。
   * 只透传阈值,子 policy 各自保证不动累积状态(S12)。未知 id 忽略(防热换打错名静默无副作用)。
   */
  reconfigure(patches: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
    for (const p of this.children) {
      const patch = patches[p.id];
      if (patch && p.reconfigure) p.reconfigure(patch);
    }
  }
}

// ============================================================================
// 9. 工厂:从 playbook 配置组装 composite(04 §8.3)
// ============================================================================

export interface StopPolicyConfig {
  readonly maxRounds: MaxRoundsConfig;
  readonly convergence?: ConvergenceConfig; // 省略则不启用 stall 检测
  readonly budget?: BudgetConfig; // 省略则不限成本(仅靠 maxRounds 兜底)
  readonly enableDone?: boolean; // 通用 done+ack 检测,默认 true
  /** 范式特定完成探针(§7.3 PlaybookDonePolicy)。引擎用闭包桥接 playbook.isDone→ctx 注入。 */
  readonly playbookDone?: (ctx: StopContext) => boolean;
}

/**
 * playbook(引擎 03)据其范式给配置,工厂组装 composite。
 * 不变量:MaxRoundsPolicy 永远在场(最后防线);done 默认在。
 * ★只在 run 启动时调一次;之后阈值变化一律走 composite.reconfigure,绝不重建(否则丢 stall 计数,04 §8.4)。
 */
export function buildStopPolicy(cfg: StopPolicyConfig): CompositeStopPolicy {
  const children: StopPolicy[] = [];
  if (cfg.enableDone !== false) children.push(new DonePolicy());
  if (cfg.playbookDone) children.push(new PlaybookDonePolicy(cfg.playbookDone));
  children.push(new MaxRoundsPolicy(cfg.maxRounds)); // 必有:最后防线
  if (cfg.convergence) children.push(new ConvergencePolicy(cfg.convergence));
  if (cfg.budget) children.push(new BudgetPolicy(cfg.budget));
  return new CompositeStopPolicy(children);
}
