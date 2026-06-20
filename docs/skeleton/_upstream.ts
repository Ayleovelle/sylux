/**
 * _upstream.ts —— 上游契约的「骨架桩」(skeleton-only)
 *
 * ⚠ 这不是权威定义。本文件只是为了让 adapter.ts / codex-adapter.ts /
 *   claude-adapter.ts 三份骨架在 `@sylux/shared` / `@sylux/providers` /
 *   `@sylux/security` 三个真实包尚未落地前能**独立通过 tsc 类型检查**而存在的
 *   前向声明镜像。
 *
 * 真实落地后,三份适配器骨架的 import 路径应改回:
 *   - 类型/错误码/常量  → '@sylux/shared'      (权威源 docs/drafts/02-blackboard-types.md)
 *   - provider 注入/keystore → '@sylux/providers' (权威源 07-provider-config.md)
 *   - buildChildEnv/泄密特征/redact → '@sylux/security' (权威源 08-security-firewall.md)
 * 并删除本文件。骨架内凡引用这些符号处均标注了权威出处。
 *
 * 不变量:本文件**不重新定义** zod(权威在 02);只给出与 02/07/08 逐字段同构的
 *   TS 类型与函数签名,实现体一律 TODO 抛错,杜绝「骨架里混进真逻辑」。
 */

/* ────────────────────────────────────────────────────────────────────────
 * 1. @sylux/shared —— 02 §2 / §5.3 / §6.3 / §12 的类型与常量(权威:02)
 * ──────────────────────────────────────────────────────────────────────── */

/** 02 §2:发言主体(物理进程身份)。适配器只会是 'codex' | 'claude'。 */
export type AgentId = 'codex' | 'claude' | 'human' | 'orchestrator';

/** 02 §5.3:单行 JSONL 字节硬上限(512 KiB)。权威常量,勿在他处重定义。 */
export const MAX_JSONL_LINE_BYTES = 512 * 1024;

/** 02 §6.3:token 用量(取自 codex turn.completed.usage / claude result.usage 归一)。 */
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/**
 * 02 §6.3:适配层向引擎吐的事件流判别联合。第一类事件恒为 session_started(I5)。
 * 注:`usageDegraded` 是 05 §7.1 V3j / 06 回填项 B12 申请的可选附加字段
 *     (供刹车 04 区分「output 字段漂移」与「真 0」);若 02 §6.3 尚未含,需回填。
 *     骨架按「已含」前向声明,真实以 02 为准。
 */
export type AgentEvent =
  | { kind: 'session_started'; sessionId: string }
  | { kind: 'delta'; text: string }
  | { kind: 'tool_call'; name: string; args: unknown }
  | { kind: 'final_message'; raw: string; usage?: TokenUsage; usageDegraded?: boolean }
  | { kind: 'error'; code: string; detail: string };

/** 02 §12:错误码全集(单一权威 union)。骨架按 02 §12 逐项镜像(精确 union,无 string 兜底,narrowing 才成立)。 */
export type SyluxErrorCode =
  // ── ★ 契约校验(02 拥有) ──
  | 'OUTPUT_SCHEMA_VIOLATION'
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_UNVERIFIABLE'
  | 'EVIDENCE_COMMAND_UNSAFE'
  | 'EVIDENCE_INFRA_DEGRADED'
  | 'MESSAGE_SIZE_EXCEEDED'
  | 'WORKTREE_PATH_VIOLATION'
  | 'DANGLING_REPLY_REF'
  | 'INVALID_DONE_SELF_ACK'
  | 'INVALID_SYSTEM_SENDER'
  | 'EMPTY_ROUND_PLAN'
  // ── 子进程 / 适配层(归 04 / 事实 A·B) ──
  | 'SUBPROCESS_SPAWN_FAILED'
  | 'SUBPROCESS_CRASHED'
  | 'SUBPROCESS_TIMEOUT'
  | 'SUBPROCESS_CANCELLED'
  // ── 引擎(归 03 / 04) ──
  | 'ENGINE_FATAL'
  | 'ROUND_LIMIT_EXCEEDED'
  | 'CONVERGENCE_STALL'
  | 'TOKEN_BUDGET_EXCEEDED'
  // ── 安全(归 08) ──
  | 'PROVIDER_CONFIG_INVALID'
  | 'INJECTION_BLOCKED'
  | 'EGRESS_SECRET_BLOCKED'
  // ── WS / 面板(归 11) ──
  | 'WS_UNAUTHORIZED'
  | 'WS_ORIGIN_REJECTED'
  | 'WS_TICKET_EXPIRED'
  | 'WS_PERMISSION_DENIED'
  | 'WS_RATE_LIMITED'
  | 'WS_PAYLOAD_INVALID'
  | 'WS_PROTOCOL_ERROR'
  // ── worktree(归 09) ──
  | 'WORKTREE_CONFLICT'
  | 'WORKTREE_GIT_FAILED'
  // ── Fusion(归 21) ──
  | 'FUSION_PANEL_FAILED'
  | 'FUSION_JUDGE_FAILED'
  // ── provider / config(归 05 / 16) ──
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIG_INVALID';

/** 02 §12:带 code 的错误基类(总体规划 §11.3 不吞错原则)。 */
export class SyluxError extends Error {
  constructor(
    readonly code: SyluxErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SyluxError';
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. @sylux/providers —— 07 §2/§3/§5.2/§6.2 的 provider 注入面(权威:07)
 * ──────────────────────────────────────────────────────────────────────── */

/** 07 §2:provider 绑定配置(base_url/wire_api/model + 密钥引用)。骨架最小镜像。 */
export interface ProviderConfig {
  readonly name: string;
  readonly baseUrl?: string;
  readonly wireApi?: 'responses' | 'chat';
  readonly model?: string;
  /** 密钥**引用**(非明文);由 KeyStore 解析成真实 key 进 env(永不进 argv,A4)。 */
  readonly apiKeyRef?: string;
}

/** 07 §2:密钥解析器。只活在 adapter 内存,绝不经 WS/jsonl 序列化(07 §8.4)。 */
export interface KeyStore {
  /** 解析 apiKeyRef → 真实 key。失败抛 PROVIDER_CONFIG_INVALID(07 §2.3)。 */
  resolve(apiKeyRef: string): string;
}

/** 07 §3:provider 非密覆盖项(值绝不含 key,A4)。权威类型在 07 §3/§4。 */
export interface ProviderOverrides {
  baseUrl?: string;
  wireApi?: 'responses' | 'chat';
  model?: string;
  providerName?: string;
  fallbackModel?: string; // V3c:claude --fallback-model;codex 忽略
  extraConfig?: Record<string, string>;
}

/**
 * 07 §5.2:codex 注入产物(三参权威 toCodexInjection(cfg, keystore, ov?))。
 * cArgs 含 model_provider/base_url/wire_api/-m + key 走 env 的 env_key 行(非密);
 * env 是唯一含真实 key 的字段(由 keystore 解析)。
 */
export interface CodexInjection {
  readonly cArgs: readonly string[];
  readonly env: Record<string, string>;
  readonly keyEnvVar?: string;
}

/** 07 §6.2:claude 注入产物(三参权威 toClaudeInjection(cfg, keystore, ov?))。 */
export interface ClaudeInjection {
  /** --model / --fallback-model 等非密 flag(进 argv)。 */
  readonly flags: readonly string[];
  /** --settings 的 JSON 片段(对象;由 06 §3.1.2 唯一拼装成单个 --settings)。 */
  readonly settingsFragment: Record<string, unknown>;
  /** 唯一含 key/base_url 的 env(ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL)。 */
  readonly env: Record<string, string>;
}

/** 07 §5.2:三参权威。merge(ov 覆盖 cfg 默认)内置,调用方不再自己 mergeProviderOverrides。 */
export declare function toCodexInjection(
  cfg: ProviderConfig,
  keystore: KeyStore,
  ov?: ProviderOverrides,
): CodexInjection;

/** 07 §6.2:claude 端三参权威(对称)。 */
export declare function toClaudeInjection(
  cfg: ProviderConfig,
  keystore: KeyStore,
  ov?: ProviderOverrides,
): ClaudeInjection;

/* ────────────────────────────────────────────────────────────────────────
 * 3. @sylux/security —— 08 §2.2 / §2.4 / §3 的 env 出口 + 泄密特征 + 脱敏(权威:08)
 * ──────────────────────────────────────────────────────────────────────── */

/** 08 §2.2:buildChildEnv 单对象入参(权威签名,v1 双位参已作废)。 */
export interface BuildChildEnvInput {
  /** 唯一允许携带 secret 的字段(S1);含 07 注入的 key env。 */
  providerEnv: Record<string, string>;
  /** 注入非密 SYLUX_AGENT 诊断变量。 */
  agentId: AgentId;
  /** 默认 process.env,只挑 BASE_ENV_ALLOWLIST 白名单键。 */
  inheritFromProcess?: NodeJS.ProcessEnv;
}

/**
 * 08 §2.2:子进程 env 的**唯一**出口。内部 extendEnv:false,绝不 {...process.env}(A5/S2)。
 * 产出 = 白名单 base 变量(SystemRoot/PATH/USERPROFILE…) + providerEnv + SYLUX_AGENT。
 */
export declare function buildChildEnv(input: BuildChildEnvInput): Record<string, string>;

/** 08 §2.4:密钥特征签名(单一权威;adapter 不各自维护 KEY_PATTERNS,V3g)。 */
export interface SecretSignature {
  readonly name: string;
  readonly re: RegExp;
  /** 强特征(sk-/sk-ant-/Bearer/AKIA/ghp_/jwt…):误报极低,可做 argv 硬闸。 */
  readonly strong: boolean;
}

/** 08 §2.4:权威签名集(只读)。 */
export declare const SECRET_SIGNATURES: readonly SecretSignature[];

/** 08 §2.4:强特征判定(argv 硬闸用;避免 b64/hex 高误报误炸合法长参数)。 */
export declare function isStrongSecretLike(s: string): boolean;

/** 08 §3:脱敏(密钥→掩码)。stderr 摘要进 error.detail 前必过(防 detail 成泄密通道,S1)。 */
export declare function redact(s: string): string;
