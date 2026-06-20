/**
 * adapter.ts —— AgentAdapter / AgentInput 统一接口(权威:05-adapter-codex.md §2/§3)
 *
 * 把两个形态高度不对称的 CLI(codex / claude)封装成同一接口:中枢只看
 *   send() / resume() / cancel() 三个动作 + 一条 AsyncIterable<AgentEvent> 事件流。
 * 所有「exe 在哪 / 参数怎么拼 / id 从哪抓 / schema 走文件还是内联 / 进程树怎么杀」
 * 的差异全部吃进各端适配器实现内部(codex → codex-adapter.ts;claude → claude-adapter.ts)。
 *
 * 接口层不变量(实现必须保持,05 §0.3):
 *   A1 首事件恒为 session_started;拿到前不得标记 agent resumable。
 *   A2 未拿到 id(thread.started/system.init 前崩溃)不得伪造 session_started,只 emit error。
 *   A3 直调真实 exe;prompt 走 stdin,argv 用 '-' 占位(codex)/ -p+stdin(claude)。
 *   A4 key 永不进 argv;spawn 前 assertArgvNoSecret 硬闸。
 *   A5 env 单一出口 buildChildEnv,extendEnv:false。
 *   A6 输出必过 safeParse(引擎做);适配器只吐 raw + usage,不在边界解析成 Message。
 *   A7 ephemeral ⊥ resume。
 *   A8 同一 adapter 任一时刻至多一个子进程在飞;并发 run 抛而非排队。
 *   A9 resume 必预置 sessionId(进流即合成 session_started,不赌 codex 重发 thread.started)。
 */

import type { AgentId, AgentEvent } from './_upstream.js';
import type { ProviderConfig, KeyStore, ProviderOverrides } from './_upstream.js';

// 重导出 provider 非密覆盖类型,方便消费方从适配层单点 import(权威仍在 07 §3)。
export type { ProviderOverrides } from './_upstream.js';

/* ──────────────────────────────────────────────────────────────────────────
 * AgentInput —— 一次 send/resume 调用的全部输入(05 §2)
 * send() 与 resume() 共用;差异在适配器内部按 exec/resume 拆参数,不暴露给调用方。
 * 字段已是「过完内容防火墙、只含 delta」的成品,适配器不再做内容裁剪(那是引擎 PromptContext 的活)。
 * ────────────────────────────────────────────────────────────────────────── */
export interface AgentInput {
  /** 已过内容防火墙、已只含 delta 的 prompt 正文(走 stdin,不进 argv,A3)。 */
  prompt: string;
  /**
   * output-schema 的 JSON Schema 对象(buildAgentOutputJsonSchema() 产出,02 §6.2)。
   * 传**对象**而非串/路径:把「codex 写文件 / claude 内联」的落点不对称完全吃进适配器内部。
   */
  outputSchema: Record<string, unknown>;
  /** 该 agent 的 worktree 绝对路径(worktree 09 创建)。codex 首轮经 -C 设定,resume 继承。 */
  workdir: string;
  /** 自动化沙箱上限。封顶 workspace-write,playbook 无法请求 danger(R8 / 08 S6)。 */
  sandbox: 'read-only' | 'workspace-write';
  /** env 白名单产物来源之一(A5);含 provider key(只在此,不进 argv)。 */
  providerEnv: Record<string, string>;
  /** provider 非密覆盖:base_url/wire_api/model 等;绝不含 key(A4)。 */
  providerOverrides: ProviderOverrides;
  /** 可选:本次调用硬超时(ms)。到点 treeKill 并 emit SUBPROCESS_TIMEOUT。 */
  timeoutMs?: number;
  /** 可选:一次性任务不落盘(codex --ephemeral / claude --no-session-persistence)。⚠ 与 resume 互斥(A7)。 */
  ephemeral?: boolean;

  // ── claude 专属可选字段(V3c);codex 端一律忽略,向后兼容 ──
  /** claude --append-system-prompt:角色/协议系统提示注入。codex 无等价,忽略。 */
  appendSystemPrompt?: string;
  /** claude --effort。codex 端忽略(推理强度走 model/-c)。 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** claude --max-turns:单轮内工具循环封顶。codex 端无此 flag,忽略。 */
  maxTurns?: number;
}

/* ──────────────────────────────────────────────────────────────────────────
 * AgentAdapter —— 统一接口(05 §3.1)
 * ────────────────────────────────────────────────────────────────────────── */
export interface AgentAdapter {
  /** 物理身份(02 agentIdSchema 子集:'codex' | 'claude')。 */
  readonly id: AgentId;

  /**
   * 首轮:spawn 全新会话。
   * @returns 事件流;首事件 session_started 回吐 sessionId(codex=thread_id;claude=system.init.session_id,A1)。
   * @remarks 不收 sessionId(id 由 CLI 自生成,不是调用方给的)。
   *          在 id 闸门前崩溃 → 不 emit session_started,只 emit error(A2)。
   */
  send(input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 续接已有会话。必须先从某次 send 的 session_started 拿到 sessionId。
   * @param sessionId send() 回吐的 id。
   * @remarks 适配器进流即凭传入 sessionId 预置 session_started(A9),不依赖 CLI 是否重发首行。
   *          resume 不省 token(codex 累积全价;claude 走 prompt 缓存折价)——成本模型分端,刹车按累积估。
   */
  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 取消当前进行中的调用:杀进程树(含 shim 背后真子进程)。
   * 幂等:无进行中进程时为 no-op。被取消的流以 {kind:'error', code:'SUBPROCESS_CANCELLED'} 收尾。
   */
  cancel(): Promise<void>;

  /** @deprecated master §4.1 历史别名;语义同 cancel()(杀进程树)。M1 后删除。 */
  kill?(): Promise<void>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 工厂签名(05 §3.2)——构造期注入 provider + keystore,不在 send 时拼。
 * 实现分别在 codex-adapter.ts / claude-adapter.ts。
 * ────────────────────────────────────────────────────────────────────────── */

/** codex 适配器工厂参数。 */
export interface CreateCodexAdapterOptions {
  /** 显式 exe 路径;缺省则 resolveCodexExe() 自动定位平台包 vendor bin。 */
  exePath?: string;
  /** provider 绑定;热换走引擎重建 adapter(07 §8.1)。 */
  provider: ProviderConfig;
  /** 密钥解析器(07 §2);构造期注入,send/resume 时传给 toCodexInjection(07 §5.2 三参)。 */
  keystore: KeyStore;
  /** 兜底硬超时(ms,A10);input.timeoutMs 缺省时取此值。0/undefined 表示不兜底。 */
  hardTimeoutCeilingMs?: number;
}

/** claude 适配器工厂参数(对称)。 */
export interface CreateClaudeAdapterOptions {
  exePath?: string;
  provider: ProviderConfig;
  keystore: KeyStore;
  hardTimeoutCeilingMs?: number;
}

/** 工厂函数类型;具体实现见两端文件。 */
export type CreateCodexAdapter = (opts: CreateCodexAdapterOptions) => AgentAdapter;
export type CreateClaudeAdapter = (opts: CreateClaudeAdapterOptions) => AgentAdapter;
