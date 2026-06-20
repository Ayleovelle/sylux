/**
 * @sylux/shared · blackboard.schema.ts
 *
 * ★★★ 全项目类型契约的【唯一权威来源】(黑板协议 02 §5/§14)。★★★
 *
 * `Message` / `EvidenceItem` / `FilePatch` / `AgentMessagePayload` / `AgentEvent` /
 * `TokenUsage` / `Round` / `RunStatus` / `BoardState` / `JsonlRecord` 及其涉及的
 * 全部枚举(`Role`/`MessageKind`/`AgentId`),有且只有本文件一处定义(不变量 I1)。
 *
 * 三位一体(§0.1):同一套 zod schema 同时承担
 *   ① 编译期类型(z.infer 导出 TS 类型)
 *   ② 运行期校验(safeParse 校验子进程返回 JSON)
 *   ③ JSON Schema 产物(zod-to-json-schema 喂 codex --output-schema / claude --json-schema)
 * 改契约 = 改这一个文件,三处自动同步。
 *
 * 其他文档涉及上述类型时一律以路径 `@sylux/shared/src/blackboard.schema.ts` 引用,
 * 禁止在任何地方另写一份(焊死红队 R1)。
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ============================================================================
// 1. 版本常量与资源上限(§1.2 / §5.3)
// ============================================================================

/** 契约 schema 版本。对持久化字段的破坏性变更必须 +1 并在 jsonl.ts 加迁移分支(§7.4)。 */
export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** 单条 message 序列化字节硬上限(H4,C10)。append 前算 JSON.stringify 字节超此 → MESSAGE_SIZE_EXCEEDED。 */
export const MAX_MESSAGE_BYTES = 262_144 as const; // 256 KiB = 256 * 1024

/**
 * 单条 jsonl 行(任意 recordType)字节硬上限,decode 时超限即判残行(§7.3)。
 * ★权威值在此(本文件 02)。其他文档(06 等)只 import 不重声明(B1)。
 */
export const MAX_JSONL_LINE_BYTES = 524_288 as const; // 512 KiB = 512 * 1024(权威,勿在他处重定义)

/** 单轮 evidence 指纹集合条数上限(§9.3,防指纹集膨胀拖慢差集)。 */
export const MAX_FINGERPRINTS_PER_ROUND = 4096 as const;

// ============================================================================
// 2. 基础枚举(role / kind / agentId)—— Message 的判别字段(§2)
// ============================================================================

/** 角色:与模型解耦,playbook 指派,同一 agent 不同轮可换角色。 */
export const roleSchema = z.enum([
  'planner', // 规划者(主从范式的「主」)
  'worker', // 执行者(主从范式的「从」)
  'proposer', // 提案者(红蓝 / 结对)
  'critic', // 批判者(红队角色,evidence 强制可核验)
  'peer', // 对等结对
  'arbiter', // 裁判(可选,通常由中枢承担;人工介入时为人)
]);
export type Role = z.infer<typeof roleSchema>;

/** 消息类型:决定黑板流转语义。 */
export const messageKindSchema = z.enum([
  'propose', // 提出方案 / 代码改动意图
  'critique', // 批判(必须带可核验 evidence)
  'plan', // 规划(任务拆解)
  'implement', // 实现(产出 diff,落 files)
  'review', // 评审
  'ack', // 认可对面(done 流程需对面带证据 ack)
  'question', // 提问 / 澄清
  'done', // 自认完成(需对面 ack 才真停)
  'system', // 中枢系统消息(刹车触发、合并冲突回灌等)
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

/** 发言主体(物理进程身份)。 */
export const agentIdSchema = z.enum(['codex', 'claude', 'human', 'orchestrator']);
export type AgentId = z.infer<typeof agentIdSchema>;

// ============================================================================
// 3. Evidence —— 焊死「唱反调」的核心(§3)
//
// 必须是结构化、带可机器核验锚点的数组,三种锚点用 discriminatedUnion('kind') 区分。
// 核心原则(I3):证据强度由「中枢能否独立复算」决定,与 agent 自报无关。
// ============================================================================

/** 单条证据:必须带可被中枢机器核验的锚点。判别键为 kind。 */
export const evidenceItemSchema = z.discriminatedUnion('kind', [
  // ① 代码锚点:指向 worktree 内某文件的行区间。
  //    contentHash 是中枢派生权威(核验时回填),agent 不必/不应自算(H1)。
  z.object({
    kind: z.literal('file_ref'),
    path: z.string().min(1).max(1024), // 相对本 agent worktree 根;禁 `..` / 越界绝对路径(§8.3)
    lineStart: z.number().int().positive(), // 1-based,含
    lineEnd: z.number().int().positive(), // 1-based,含;约束 lineEnd>=lineStart(C4)
    /**
     * agent 断言该区间的原文(可选)。核验 = 中枢重读区间,双向归一化后比对。
     * 省略则只校验区间存在 + 由中枢派生 contentHash 入指纹(强度降为「仅定位」)。
     */
    quote: z.string().max(8192).optional(),
    /**
     * 中枢核验时派生回填的归一化内容 hash(§9)。agent 提交时通常缺省;
     * 若 agent 填了,中枢一律以自己复算值覆盖(I7),不信任 agent 值。
     */
    contentHash: z.string().max(64).optional(),
    note: z.string().max(2048).optional(), // 人类可读旁注(不参与核验)
  }),
  // ② 命令证据:可复现命令 + 期望/实际输出。
  //    未被中枢实跑前,actual 只是 agent 自报,强度 = weak(H2)。
  z.object({
    kind: z.literal('command'),
    cmd: z.string().min(1).max(4096), // 可复现命令(只在 agent worktree 沙箱内复跑,§8.1)
    expected: z.string().max(8192), // 期望输出(子串 / 全等 / 正则,见 matchMode)
    actual: z.string().max(8192), // agent 声称的实际输出(自报,不可单独取信)
    matchMode: z.enum(['equals', 'contains', 'regex']).default('contains'),
    exitCode: z.number().int().optional(), // 期望退出码(可选)
  }),
  // ③ 规范引用:指向需求 / 规格来源的引文(用于「偏离规范」类批判)。
  z.object({
    kind: z.literal('spec_quote'),
    source: z.string().min(1).max(1024), // 规范 / 需求来源标识(文件名、URL、文档 §号)
    quote: z.string().min(1).max(8192), // 原文引文
    locator: z.string().max(256).optional(), // 定位符(行号、章节、锚点)
  }),
]);
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

// ============================================================================
// 4. FilePatch —— 文件改动声明(files 字段,§4)
//
// 声明 agent 本条消息意图/已做的文件改动。diff 正文不由 agent 自填 ——
// 由中枢从 worktree 实际 `git diff --find-renames` 生成,此处只声明意图。
// ============================================================================

/** agent 声明的单个文件改动意图 / 结果。 */
export const filePatchSchema = z.object({
  path: z.string().min(1).max(1024), // 相对本 agent worktree 根;禁 `..` 与越界绝对路径(§8.3)
  changeKind: z.enum(['add', 'modify', 'delete', 'rename']),
  renamedFrom: z.string().max(1024).optional(), // changeKind==='rename' 时必填(C5)
  isBinary: z.boolean().default(false), // 二进制 / 超阈值 diff 在面板降级展示
});
export type FilePatch = z.infer<typeof filePatchSchema>;

// ============================================================================
// 5. Message —— 黑板消息(全项目唯一 z.object 定义,不变量 I1,§5)
// ============================================================================

export const messageSchema = z.object({
  /** 全局唯一 id,nanoid() 生成(中枢 append 时盖)。 */
  id: z.string().min(1),
  /** 所属 run(一次 orchestrator 运行)。 */
  runId: z.string().min(1),
  /** 轮次,从 0 开始单调递增(同一轮可有多条)。 */
  round: z.number().int().nonnegative(),
  /**
   * 中枢单调序号(append 顺序权威排序键,I6/H5)。同 run 内严格 +1 无洞。
   * 一切排序 / 回放 / 收敛差集以此为准;ts 仅供人读。并行范式同轮多条靠 seq 区分。
   */
  seq: z.number().int().nonnegative(),
  /** 物理发言主体。 */
  from: agentIdSchema,
  /** 本条消息发言时所扮演的角色(与 from 正交)。 */
  role: roleSchema,
  /** 消息类型,决定流转语义。 */
  kind: messageKindSchema,
  /**
   * 自然语言主体(喂给对面前会被防火墙包边界标记,安全 09)。上限防 DoS(H4)。
   * ⚠ agent 可控不可信串(§5.4):面板渲染前必须 escape + CSP,禁 innerHTML 直插。
   */
  body: z.string().max(65536),
  /** 本条涉及的文件改动声明。条数上限防 DoS(H4)。 */
  files: z.array(filePatchSchema).max(256).default([]),
  /**
   * 证据数组(中枢强制,非仅 schema,见 C1/C2 / §8):
   * - role==='critic' 或 kind==='critique':必须非空且 ≥1 条强核验通过,否则打回。
   * - kind==='ack' 认可对面 done:必须带可核验 evidence,防双方互相秒认 done。
   * 条数上限防 DoS(H4)。
   */
  evidence: z.array(evidenceItemSchema).max(128).default([]),
  /** 服务端写入时间戳(epoch ms,中枢盖,agent 不可伪造)。墙钟旁注,禁用于排序(I6)。 */
  ts: z.number().int().nonnegative(),
  /** 可选:本条回应的上游消息 id(构造对话树 / 收敛锚点)。 */
  inReplyTo: z.string().min(1).optional(),
});
export type Message = z.infer<typeof messageSchema>;

// ============================================================================
// 6. 适配层边界 schema(agent 产出子集 + AgentEvent,§6)
// ============================================================================

/**
 * CLI 经 output-schema/json-schema 被强制产出的字段子集。
 * id/runId/round/seq/from/role/ts 全由中枢在 append 时盖章补齐(I7),agent 不产出 ——
 * 这样 agent 无法伪造身份 / 时间 / 轮次 / 排序。
 */
export const agentMessagePayloadSchema = z.object({
  kind: messageKindSchema,
  body: z.string().max(65536),
  files: z.array(filePatchSchema).max(256).default([]),
  evidence: z.array(evidenceItemSchema).max(128).default([]),
  inReplyTo: z.string().min(1).optional(),
});
export type AgentMessagePayload = z.infer<typeof agentMessagePayloadSchema>;

/**
 * 由瘦子集生成 JSON Schema(draft-07)。适配层 04 据此写文件(codex --output-schema)
 * 或内联(claude --json-schema)。两端落点差异由 04 处理,本文件只产一份 schema 对象。
 *
 * 【待实测·H7】严格 structured-output 后端对 discriminatedUnion(→ anyOf)+ optional
 * 字段支持参差;若被拒,04 走退化方案(nullable+required / 摊平单 object / 宽 schema+safeParse)。
 * 本函数只保证「权威 zod 与退化变体语义等价」,退化只改 JSON Schema 形状不改 TS 类型。
 */
export function buildAgentOutputJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(agentMessagePayloadSchema, {
    name: 'AgentMessagePayload',
    $refStrategy: 'none', // 摊平 $ref,规避两端解析差异 + 内联体积可控
    target: 'jsonSchema7',
  });
}

/** token 用量,直接取自 codex turn.completed.usage(中转回吐,可靠,不本地估算)。 */
export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * 适配层向引擎吐的事件流。第一类事件恒为 session_started(不变量 I5);
 * 中枢拿到它之前不得标记 agent 可 resume(红队 R3 / 事实地基 B)。
 * 唯一例外:首事件即 error(spawn 失败,§6.3)。
 */
export const agentEventSchema = z.discriminatedUnion('kind', [
  // ① 首事件:回吐会话 id。sessionId 是适配层统一抽象;
  //    codex 侧映射自 thread.started.thread_id(事实地基 B),claude 侧映射自其 session id。
  z.object({
    kind: z.literal('session_started'),
    sessionId: z.string().min(1),
  }),
  // ② 流式增量(可选透传面板)。
  z.object({ kind: z.literal('delta'), text: z.string() }),
  // ③ 工具调用(透传面板观战)。
  z.object({ kind: z.literal('tool_call'), name: z.string(), args: z.unknown() }),
  // ④ 最终 JSON 文本(待 agentMessagePayloadSchema.safeParse;附本轮 usage)。
  z.object({
    kind: z.literal('final_message'),
    raw: z.string(),
    usage: tokenUsageSchema.optional(), // 取自 turn.completed.usage;缺失按基线上界估,不计 0(H6/H15)
  }),
  // ⑤ 错误(spawn 失败 / schema 违例 / 进程崩溃)。
  z.object({ kind: z.literal('error'), code: z.string(), detail: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

// ============================================================================
// 7. Round 与 BoardState —— 黑板运行态数据类型(§10)
//
// 注意:本段在 jsonlRecord(§8 段)之前定义,因为 jsonlRecordSchema 的
// round_closed/status_changed 分支前向引用 roundSchema/runStatusSchema(TS const 求值序)。
// ============================================================================

/** 单轮快照:一轮内可有多条 message(多 agent / 多 kind)。 */
export const roundSchema = z.object({
  index: z.number().int().nonnegative(), // 轮次号,与 Message.round 对齐
  messageIds: z.array(z.string().min(1)).default([]), // 本轮 message id(按 seq 升序,I6,非 ts)
  /** 本轮所有 evidence 的指纹集合(§9.2 fingerprintSet,核验后算),收敛差集 + 回放用。 */
  evidenceFingerprints: z.array(z.string()).max(MAX_FINGERPRINTS_PER_ROUND).default([]),
  /** 本轮累计 token(各 final_message.usage 求和;缺失按基线保守上界,H6)。 */
  usage: tokenUsageSchema.optional(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(), // 未结束为空
});
export type Round = z.infer<typeof roundSchema>;

/** run 生命周期状态。done/stalled/aborted/limit 为终态(不可再转 running)。 */
export const runStatusSchema = z.enum([
  'running', // 进行中
  'paused', // 面板人工暂停(可恢复 → running)
  'done', // 收敛完成(对面带证据 ack 过 done,C2)
  'stalled', // 连续 N 轮无新 evidence 指纹(CONVERGENCE_STALL,§9.3)
  'aborted', // 人工中止 / 致命错误
  'limit', // 触发 maxRounds / token 预算(ROUND_LIMIT_EXCEEDED / TOKEN_BUDGET_EXCEEDED)
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * 状态转移矩阵(引擎 03 执行,本文件定权威)。只允许下表转移,非法转移抛内部断言。
 *
 * | from \ to | running | paused | done | stalled | aborted | limit |
 * | (init)    |   ✓     |        |      |         |         |       |
 * | running   |   —     |   ✓    |  ✓   |   ✓     |   ✓     |  ✓    |
 * | paused    |   ✓     |   —    |      |         |   ✓     |       |
 * | 终态(done/stalled/aborted/limit) 进入后冻结,任何后续 status_changed 视为非法(回放丢弃 + 告警)。
 *
 * 运行期校验工具,引擎 03 / jsonl 回放(§7.3)用。返回 false 即非法转移。
 */
export const RUN_STATUS_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  running: ['paused', 'done', 'stalled', 'aborted', 'limit'],
  paused: ['running', 'aborted'],
  done: [],
  stalled: [],
  aborted: [],
  limit: [],
};

/** 初始态允许进入的状态(init → ?)。 */
export const RUN_STATUS_INITIAL: readonly RunStatus[] = ['running'];

/** 判定 from→to 是否合法转移(引擎 03 / 回放投影守卫)。 */
export function isValidStatusTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
}

/** 黑板全局快照:一次 run 的完整可序列化状态(面板拉取 / 回放投影共用)。 */
export const boardStateSchema = z.object({
  runId: z.string().min(1),
  playbookId: z.string().min(1), // 当前剧本(红蓝/主从/结对/分工),定义在引擎 03
  status: runStatusSchema,
  currentRound: z.number().int().nonnegative(),
  rounds: z.array(roundSchema).default([]),
  messages: z.array(messageSchema).default([]), // 全量消息(回放权威源;面板可只取增量)
  /**
   * 各 agent 会话句柄态(resume 依据,I5)。仅 codex/claude 出现;
   * human/orchestrator 无会话不入此表。
   */
  agents: z
    .record(
      agentIdSchema,
      z.object({
        sessionId: z.string().min(1).optional(), // 未拿到前为空 → resumable 必 false
        resumable: z.boolean().default(false),
      }),
    )
    .default({}),
  /** 累计 token(全 run 求和,事实地基 D:累积/超线性成本模型)。 */
  totalUsage: tokenUsageSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
});
export type BoardState = z.infer<typeof boardStateSchema>;

// ============================================================================
// 8. jsonl 持久化行格式(append-only 事件日志,§7)
//
// 每 run 一份 runs/<runId>.jsonl,每行一个独立 JSON 对象。BoardState 不直接落盘,
// 由行日志投影得出(单一事实源,§7.3)。encode/decode 实现见 jsonl.ts。
// ============================================================================

/** jsonl 单行记录。recordType 判别;每行自带 schemaVersion(I4)以支持迁移。 */
export const jsonlRecordSchema = z.discriminatedUnion('recordType', [
  // ① run 头:首行,定调 runId/playbook/起始时间。
  z.object({
    recordType: z.literal('run_started'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    playbookId: z.string().min(1),
    ts: z.number().int().nonnegative(),
  }),
  // ② 一条黑板消息(主体,占绝大多数行)。
  z.object({
    recordType: z.literal('message'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    message: messageSchema,
  }),
  // ③ 轮边界(轮结束时落,带当轮指纹集合 + usage,供回放免重算)。
  z.object({
    recordType: z.literal('round_closed'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    round: roundSchema,
  }),
  // ④ 状态变更(running→paused→done/...,面板状态条 + 终态审计)。
  z.object({
    recordType: z.literal('status_changed'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    status: runStatusSchema,
    /**
     * 机读终态原因码(H10/D5):04 调 setStatus(status, code, reason) 三参时落此。
     * 终态(stalled/aborted/limit)应填对应码;running/paused 等正常转移可缺省。
     * 用 string 避免 schema↔errors 循环依赖;04 侧以 SyluxErrorCode 约束、isSyluxErrorCode 窄化。
     */
    code: z.string().optional(),
    reason: z.string().optional(), // 人读旁注(人工备注 / detail),非机读
    ts: z.number().int().nonnegative(),
  }),
  // ⑤ 会话句柄回吐(sessionId 落盘,崩溃后可 resume)。
  z.object({
    recordType: z.literal('agent_session'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    agent: agentIdSchema,
    sessionId: z.string().min(1),
    ts: z.number().int().nonnegative(),
  }),
]);
export type JsonlRecord = z.infer<typeof jsonlRecordSchema>;
