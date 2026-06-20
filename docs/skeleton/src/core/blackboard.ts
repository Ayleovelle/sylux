/**
 * @sylux/core · blackboard.ts
 *
 * 黑板运行态 + append-only jsonl 持久化(权威设计:03-engine-playbook.md §4.1/§4.2,持久化格式 02 §7)。
 *
 * 本文件拥有引擎写侧/读侧的【行为接口】契约:`Blackboard` / `BoardView` / `AppendInput` /
 *   `BroadcastEvent`,以及内存态实现 `BlackboardImpl`(投影 + jsonl 落盘 + 订阅广播)。
 *   数据类型(`Message`/`Round`/`BoardState`/...)仍属黑板协议 02,本文件只引用(焊死 R1)。
 *
 * 不变量:
 *   E2 未校验不入黑板 —— append 只接受【已经过 validateMessage 的产出】;校验在引擎 runTurn 做,
 *      本层只做"盖章(id/seq/ts/schemaVersion)+ size 闸 + 落盘 + 广播"(02 §5.1 / §6.1)。
 *   I6 seq 单调 —— 同 run 内严格 +1 无洞,是排序/回放/收敛差集的权威键(02 §5.1);ts 仅供人读。
 *   I7 中枢盖章 —— agent 不产出 id/runId/round/seq/from/role/ts,全由中枢补齐,杜绝伪造身份/时间/轮次。
 *   §7.3 单一事实源 —— BoardState 不独立落盘,由 jsonl 行日志投影;本实现内存持有投影,落盘只追加行。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  SCHEMA_VERSION,
  MAX_MESSAGE_BYTES,
  messageSchema,
  fingerprintSet,
  encodeJsonlLine,
  decodeJsonlFile,
  isValidStatusTransition,
  SyluxError,
  type Message,
  type Round,
  type RunStatus,
  type AgentId,
  type Role,
  type TokenUsage,
  type AgentMessagePayload,
  type JsonlRecord,
} from '../shared/index.js';

// ============================================================================
// 1. 行为接口契约(03 §4.1/§4.2;数据类型属 02)
// ============================================================================

/**
 * append 的入参:agent 产出子集(02 §6.1)+ 引擎补的 from/role/round。
 * id/ts/seq/schemaVersion 由 Blackboard 盖章(I7),agent 与引擎都不提供。
 */
export interface AppendInput {
  from: AgentId;
  role: Role;
  round: number;
  payload: AgentMessagePayload; // 02 §6.1:{kind, body, files, evidence, inReplyTo?}
}

/** 订阅广播事件(WS 面板 10/11 消费;骨架只定形状,传输在 server 层)。 */
export type BroadcastEvent =
  | { type: 'message'; message: Message }
  | { type: 'round_closed'; round: Round }
  | { type: 'status_changed'; status: RunStatus; code?: string; reason?: string }
  | { type: 'agent_session'; agent: AgentId; sessionId: string };

/** playbook 只读视图(03 §4.1)。所有方法无副作用;写入是引擎特权(E2)。 */
export interface BoardView {
  readonly runId: string;
  readonly currentRound: number;
  readonly status: RunStatus;
  /** 全量消息只读快照(02 §10:回放权威源)。 */
  readonly messages: readonly Message[];
  /** 各轮快照(含 evidenceFingerprints / usage,02 §10.1)。 */
  readonly rounds: readonly Round[];

  // 便捷查询(派生,无副作用)
  lastMessage(): Message | undefined;
  lastFrom(agent: AgentId): Message | undefined;
  messagesInRound(round: number): readonly Message[];
  byKind(kind: Message['kind']): readonly Message[];
  /** 某 agent 当前会话句柄态(02 §10:sessionId 空→不可 resume,I5/E3)。 */
  sessionOf(agent: AgentId): { sessionId?: string; resumable: boolean };
  /** 截至上一轮"新 evidence 强指纹差集是否连续 window 轮为空"(02 §9.3,stall 预判)。 */
  stalledFor(window: number): boolean;
}

/** 引擎写侧接口(03 §4.2)。 */
export interface Blackboard {
  readonly runId: string;
  /** 追加一条【已校验】消息:盖 id/ts/seq/round/schemaVersion(02 §5.1),落 jsonl,广播订阅者。 */
  append(msg: AppendInput): Promise<Message>;
  /** 关闭一轮:落 round_closed(指纹集合 + usage,02 §7.1),推进 currentRound,供回放免重算。 */
  closeRound(round: number): Promise<Round>;
  /** 记录 agent 会话句柄(session_started 回吐后,02 §7.1 agent_session)。 */
  recordSession(agent: AgentId, sessionId: string): Promise<void>;
  /**
   * 状态机变更(running→paused→终态,落 status_changed,02 §7.1)。
   * 第二参对象 {code?, reason?}(03 H11 / 04 H-BRIDGE)。02 §7.1 暂无独立 code 字段时,
   * code 折进落盘 reason 前缀(语义无损,待 02 回填 code 字段,04 §13.2)。
   */
  setStatus(status: RunStatus, opts?: { code?: string; reason?: string }): Promise<void>;
  /** 只读视图(给 playbook;= §4.1)。 */
  view(): BoardView;
  /** 订阅增量(WS 广播)。返回取消订阅函数。 */
  subscribe(fn: (ev: BroadcastEvent) => void): () => void;
}

// ============================================================================
// 2. 内存态投影 + jsonl 落盘实现(BlackboardImpl)
// ============================================================================

/** run 内可变运行态(BoardState 的内存投影,§7.3:不独立落盘,由 jsonl 行重建)。 */
interface MutableState {
  status: RunStatus;
  currentRound: number;
  seqCounter: number; // 下一条 message 的 seq(I6 单调键)
  readonly messages: Message[];
  readonly rounds: Round[];
  readonly agents: Map<AgentId, { sessionId?: string; resumable: boolean }>;
  totalUsage: TokenUsage;
}

export interface BlackboardOptions {
  readonly runId: string;
  readonly playbookId: string;
  /** jsonl 落盘路径(runs/<runId>.jsonl)。省略则纯内存(测试用,不落盘)。 */
  readonly jsonlPath?: string;
  /** 时钟注入(测试可控);默认 Date.now。 */
  readonly now?: () => number;
  /** id 生成器注入(测试可控);默认 randomUUID。 */
  readonly genId?: () => string;
}

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

export class BlackboardImpl implements Blackboard {
  readonly runId: string;
  private readonly playbookId: string;
  private readonly jsonlPath: string | undefined;
  private readonly now: () => number;
  private readonly genId: () => string;
  private readonly subscribers = new Set<(ev: BroadcastEvent) => void>();
  private readonly st: MutableState;
  /** 本轮 final_message.usage 暂存(closeRound 时汇入 Round.usage;引擎经 recordRoundUsage 喂)。 */
  private pendingRoundUsage: TokenUsage = zeroUsage();

  constructor(opts: BlackboardOptions) {
    this.runId = opts.runId;
    this.playbookId = opts.playbookId;
    this.jsonlPath = opts.jsonlPath;
    this.now = opts.now ?? Date.now;
    this.genId = opts.genId ?? randomUUID;
    this.st = {
      status: 'running',
      currentRound: 0,
      seqCounter: 0,
      messages: [],
      rounds: [],
      agents: new Map(),
      totalUsage: zeroUsage(),
    };
    if (this.jsonlPath) {
      mkdirSync(dirname(this.jsonlPath), { recursive: true });
      this.writeLine({
        recordType: 'run_started',
        schemaVersion: SCHEMA_VERSION,
        runId: this.runId,
        playbookId: this.playbookId,
        ts: this.now(),
      });
    }
  }

  async append(input: AppendInput): Promise<Message> {
    // 盖章:补 id/seq/ts/schemaVersion(I7);from/role/round 由引擎按 TurnDirective 给。
    const msg: Message = {
      id: this.genId(),
      runId: this.runId,
      round: input.round,
      seq: this.st.seqCounter++,
      from: input.from,
      role: input.role,
      kind: input.payload.kind,
      body: input.payload.body,
      files: input.payload.files,
      evidence: input.payload.evidence,
      ts: this.now(),
      ...(input.payload.inReplyTo !== undefined ? { inReplyTo: input.payload.inReplyTo } : {}),
    };
    // size 闸(H4/C10):append 前算 JSON 字节,超 MAX_MESSAGE_BYTES → MESSAGE_SIZE_EXCEEDED。
    if (Buffer.byteLength(JSON.stringify(msg), 'utf8') > MAX_MESSAGE_BYTES) {
      throw new SyluxError('MESSAGE_SIZE_EXCEEDED', `message 超 ${MAX_MESSAGE_BYTES} 字节`, {
        id: msg.id,
      });
    }
    // 末道防线:盖章后再过一次 02 权威 schema(防内部构造漂移;真伪/evidence 已在引擎侧 validate)。
    const parsed = messageSchema.safeParse(msg);
    if (!parsed.success) {
      throw new SyluxError('OUTPUT_SCHEMA_VIOLATION', `盖章后消息不合 schema: ${parsed.error.message}`);
    }
    this.st.messages.push(parsed.data);
    this.writeLine({ recordType: 'message', schemaVersion: SCHEMA_VERSION, message: parsed.data });
    this.broadcast({ type: 'message', message: parsed.data });
    return parsed.data;
  }

  /** 引擎在 consume 拿到 final_message.usage 后喂入,累计进本轮与全 run(02 §6.3 / 事实 D)。 */
  recordRoundUsage(usage: TokenUsage): void {
    this.pendingRoundUsage = addUsage(this.pendingRoundUsage, usage);
    this.st.totalUsage = addUsage(this.st.totalUsage, usage);
  }

  async closeRound(round: number): Promise<Round> {
    const msgs = this.st.messages.filter((m) => m.round === round);
    // 指纹集合在轮末核验完成后算(02 §9.2 fingerprintSet);此处假设 evidence 已由引擎 validate 回填 contentHash。
    const fps = fingerprintSet(msgs.flatMap((m) => m.evidence));
    const startedAt = msgs[0]?.ts ?? this.now();
    const usage = this.pendingRoundUsage;
    const r: Round = {
      index: round,
      messageIds: [...msgs].sort((a, b) => a.seq - b.seq).map((m) => m.id), // 按 seq 升序(I6,非 ts)
      evidenceFingerprints: fps,
      usage,
      startedAt,
      endedAt: this.now(),
    };
    this.st.rounds[round] = r;
    this.st.currentRound = round + 1; // 推进轮号(03 §5.1.1:closeRound 是轮号单一权威)
    this.pendingRoundUsage = zeroUsage();
    this.writeLine({ recordType: 'round_closed', schemaVersion: SCHEMA_VERSION, round: r });
    this.broadcast({ type: 'round_closed', round: r });
    return r;
  }

  async recordSession(agent: AgentId, sessionId: string): Promise<void> {
    this.st.agents.set(agent, { sessionId, resumable: true });
    this.writeLine({
      recordType: 'agent_session',
      schemaVersion: SCHEMA_VERSION,
      agent,
      sessionId,
      ts: this.now(),
    });
    this.broadcast({ type: 'agent_session', agent, sessionId });
  }

  async setStatus(status: RunStatus, opts?: { code?: string; reason?: string }): Promise<void> {
    if (!isValidStatusTransition(this.st.status, status)) {
      throw new SyluxError(
        'ENGINE_FATAL',
        `非法状态转移 ${this.st.status} → ${status}(02 §10.2 状态矩阵)`,
      );
    }
    this.st.status = status;
    // code 折进 reason 前缀过渡(02 §7.1 暂无独立 code 字段,04 §13.2 回填后改独立字段)。
    const reason =
      opts?.code !== undefined ? `[${opts.code}] ${opts.reason ?? ''}`.trim() : opts?.reason;
    this.writeLine({
      recordType: 'status_changed',
      schemaVersion: SCHEMA_VERSION,
      runId: this.runId,
      status,
      ...(opts?.code !== undefined ? { code: opts.code } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ts: this.now(),
    });
    this.broadcast({
      type: 'status_changed',
      status,
      ...(opts?.code !== undefined ? { code: opts.code } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  view(): BoardView {
    return new BoardViewImpl(this.runId, this.st);
  }

  subscribe(fn: (ev: BroadcastEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private broadcast(ev: BroadcastEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(ev);
      } catch {
        // 订阅者抛错不影响黑板;真实实现走 logger.warn(redact)(安全 08)。TODO: 接 logger。
      }
    }
  }

  /**
   * 追加单行 jsonl(纯同步 appendFileSync;Node 捕获 UTF-8 不经 shell 重定向,事实地基 A)。
   * TODO(02 §7.3 / 17 性能):骨架用同步写图省事;生产应换 append-only write stream + fsync 节流,
   *   并做背压控制。崩溃恢复用 decodeJsonlFile 截断到最后完整行(02 §7.3)。
   */
  private writeLine(rec: JsonlRecord): void {
    if (!this.jsonlPath) return;
    appendFileSync(this.jsonlPath, encodeJsonlLine(rec), 'utf8');
  }
}

// ============================================================================
// 3. BoardViewImpl —— 只读视图(派生查询,无副作用)
// ============================================================================

class BoardViewImpl implements BoardView {
  constructor(
    private readonly _runId: string,
    private readonly st: MutableState,
  ) {}

  get runId(): string {
    return this._runId;
  }
  get currentRound(): number {
    return this.st.currentRound;
  }
  get status(): RunStatus {
    return this.st.status;
  }
  get messages(): readonly Message[] {
    return this.st.messages;
  }
  get rounds(): readonly Round[] {
    return this.st.rounds;
  }

  lastMessage(): Message | undefined {
    return this.st.messages[this.st.messages.length - 1];
  }
  lastFrom(agent: AgentId): Message | undefined {
    for (let i = this.st.messages.length - 1; i >= 0; i--) {
      const m = this.st.messages[i];
      if (m && m.from === agent) return m;
    }
    return undefined;
  }
  messagesInRound(round: number): readonly Message[] {
    return this.st.messages.filter((m) => m.round === round);
  }
  byKind(kind: Message['kind']): readonly Message[] {
    return this.st.messages.filter((m) => m.kind === kind);
  }
  sessionOf(agent: AgentId): { sessionId?: string; resumable: boolean } {
    const a = this.st.agents.get(agent);
    if (!a) return { resumable: false };
    return a.sessionId !== undefined
      ? { sessionId: a.sessionId, resumable: a.resumable }
      : { resumable: a.resumable };
  }

  /**
   * 截至上一轮"新强指纹差集是否连续 window 轮空"(02 §9.3 stall 预判)。
   * 与 ConvergencePolicy.filterFingerprints 同口径:只认强指纹(剔除 `:?` 占位与 `s:` 弱指纹,H-FP)。
   * 注:这是给 playbook.isDone 的【预判】;最终 stall 终止仍由 ConvergencePolicy 强制(E4,不可绕过)。
   */
  stalledFor(window: number): boolean {
    if (window < 1) return false;
    const rounds = this.st.rounds;
    if (rounds.length < window) return false;
    const seen = new Set<string>();
    let emptyStreak = 0;
    for (const r of rounds) {
      const strong = (r?.evidenceFingerprints ?? []).filter(
        (fp) => !fp.startsWith('s:') && !fp.endsWith(':?'),
      );
      let hasNew = false;
      for (const fp of strong) {
        if (!seen.has(fp)) {
          hasNew = true;
          seen.add(fp);
        }
      }
      emptyStreak = hasNew ? 0 : emptyStreak + 1;
    }
    return emptyStreak >= window;
  }
}

// ============================================================================
// 4. 崩溃恢复:从 jsonl 行日志重建运行态(02 §7.3 单一事实源投影)
// ============================================================================

/**
 * 从 jsonl 文件内容投影出消息/轮/会话/状态(02 §7.3)。
 * 末行残缺(写到一半崩)自动截断丢弃(decodeJsonlFile);中间行损坏计 corruptLines 供告警。
 * TODO(03 §4.2):返回值喂一个"已预填态"的 BlackboardImpl 构造重入口(本骨架先只投影出只读快照,
 *   重新挂载到可写 Blackboard 的接口留待 server 层 wireEngine 实现)。
 */
export interface RestoredBoard {
  readonly records: JsonlRecord[];
  readonly messages: Message[];
  readonly rounds: Round[];
  readonly agents: Map<AgentId, { sessionId?: string; resumable: boolean }>;
  readonly status: RunStatus;
  readonly truncatedTail: boolean;
  readonly corruptLines: number;
}

export function restoreBoardFromJsonl(path: string): RestoredBoard {
  if (!existsSync(path)) {
    throw new SyluxError('ENGINE_FATAL', `jsonl 不存在,无法恢复: ${path}`);
  }
  const content = readFileSync(path, 'utf8');
  const { records, truncatedTail, corruptLines } = decodeJsonlFile(content);
  const messages: Message[] = [];
  const rounds: Round[] = [];
  const agents = new Map<AgentId, { sessionId?: string; resumable: boolean }>();
  let status: RunStatus = 'running';
  for (const rec of records) {
    switch (rec.recordType) {
      case 'message':
        messages.push(rec.message);
        break;
      case 'round_closed':
        rounds[rec.round.index] = rec.round;
        break;
      case 'agent_session':
        agents.set(rec.agent, { sessionId: rec.sessionId, resumable: true });
        break;
      case 'status_changed':
        status = rec.status;
        break;
      case 'run_started':
        break; // 仅定调,无需投影
    }
  }
  return { records, messages, rounds, agents, status, truncatedTail, corruptLines };
}
