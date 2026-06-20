/**
 * src/core/_upstream.ts —— 引擎所依赖的【跨包契约骨架桩】(skeleton-only)
 *
 * ⚠ 这不是权威定义。引擎(engine.ts)依赖适配层(05/06)、隔离(09)、安全(08)三个尚未落地的包;
 *   本文件给出与那些权威文档逐字段同构的 TS 前向声明镜像,让 src/core 能独立通过 tsc 类型检查。
 *
 * 真实落地后,engine.ts 的 import 应改回:
 *   - AgentAdapter/AgentInput → '@sylux/agents'  (权威:05-adapter-codex.md / 06-adapter-claude.md)
 *   - WorktreeManager/MergeResult → '@sylux/worktree'(权威:09-isolation-worktree.md)
 *   - ProviderOverrides → '@sylux/providers'(权威:07-provider-config.md)
 *   - FirewallResult/firewallPeerMessage/buildChildEnv → '@sylux/security'(权威:08-security-firewall.md)
 * 并删除本文件。AgentEvent/TokenUsage 等数据类型仍走 @sylux/shared(02),本文件不镜像它们。
 *
 * 不变量:本文件不重新定义任何 02 类型;只给适配/隔离/安全的接口与函数签名,实现一律留给真实包。
 */

import type { AgentId, AgentEvent } from '../shared/index.js';

/* ────────────────────────────────────────────────────────────────────────
 * 1. 适配层(05/06)—— AgentAdapter / AgentInput / ProviderOverrides
 * ──────────────────────────────────────────────────────────────────────── */

/** 07 §3:provider 非密覆盖项(值绝不含 key,A4)。权威在 07。 */
export interface ProviderOverrides {
  baseUrl?: string;
  wireApi?: 'responses' | 'chat';
  model?: string;
  providerName?: string;
  fallbackModel?: string;
  extraConfig?: Record<string, string>;
}

/** 05 §2:一次 send/resume 调用的全部输入。字段已是过完防火墙、只含 delta 的成品。 */
export interface AgentInput {
  prompt: string;
  outputSchema: Record<string, unknown>;
  workdir: string;
  sandbox: 'read-only' | 'workspace-write';
  providerEnv: Record<string, string>;
  providerOverrides: ProviderOverrides;
  timeoutMs?: number;
  ephemeral?: boolean;
  appendSystemPrompt?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
}

/** 05 §3.1:统一适配接口。首事件恒为 session_started(I5);未拿到 id 不得伪造可 resume(A1/A2)。 */
export interface AgentAdapter {
  readonly id: AgentId;
  send(input: AgentInput): AsyncIterable<AgentEvent>;
  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. 隔离(09)—— WorktreeManager / MergeResult
 * ──────────────────────────────────────────────────────────────────────── */

/** 09:轮末 3-way 合并结果。冲突时 ok=false,conflictEvidence 回灌人工裁决(E5)。 */
export type MergeResult =
  | { ok: true; mergedFiles: readonly string[] }
  | { ok: false; conflictEvidence: import('../shared/index.js').EvidenceItem[] };

/** 09:worktree 管理器。各 agent 一份 worktree,运行期无锁,轮末串行合并(R7)。 */
export interface WorktreeManager {
  /** 该 agent 的 worktree 绝对路径(创建/分配)。 */
  pathFor(agent: AgentId): string;
  /** 轮末 3-way 合并;冲突硬停回灌(E5)。 */
  mergeRound(round: number): Promise<MergeResult>;
}

/* ────────────────────────────────────────────────────────────────────────
 * 3. 安全(08)—— FirewallResult(firewallPeerMessage 返回)
 * ──────────────────────────────────────────────────────────────────────── */

/** 08 §4:内容防火墙返回。block→不拼入对面、落 system 打回(连续耗尽→INJECTION_BLOCKED)。 */
export type FirewallResult =
  | { action: 'pass'; wrapped: string }
  | { action: 'flag'; wrapped: string; reasons: string[] }
  | { action: 'block'; reason: string };

/* ────────────────────────────────────────────────────────────────────────
 * 4. 可观测(15)—— Logger(脱敏日志通路,redact 在 08)
 * ──────────────────────────────────────────────────────────────────────── */

/** 15:脱敏日志接口(骨架最小镜像)。stream() 透传面板观战;不入黑板。 */
export interface Logger {
  info(msg: string, detail?: unknown): void;
  warn(msg: string, detail?: unknown): void;
  error(msg: string, detail?: unknown): void;
  /** 透传 delta/tool_call 给面板观战(WS 11);不落黑板。 */
  stream(ev: AgentEvent): void;
}
