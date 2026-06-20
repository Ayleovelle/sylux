/**
 * @sylux/shared · errors.ts
 *
 * 错误码全集的【唯一权威来源】(黑板协议 02 §12 / §15.4)。
 *
 * 纪律(I1 延伸到错误码):
 * - `SyluxErrorCode` 的字面量集合在本文件出现且只出现一次。
 * - 下游(01/03/04/05/08/09/11/15/21)只 `import type { SyluxErrorCode }`,
 *   禁止另立自己的 union 子集或裸字符串字面量当错误码用。
 * - 新增码必须在此登记并标注拥有文档;评测 15 的 `Record<SyluxErrorCode, …>`
 *   穷举若缺项会编译红 —— 这是【特性】(强制全集同步),不是 bug。
 *
 * 分域:本文件【拥有】"★ 契约校验"项的语义;其余项的语义归对应文档,
 * 但字面量集中登记在此以保证 union 单一来源。
 */

export type SyluxErrorCode =
  // ── ★ 本文件拥有(契约校验,02 §5.2 / §8) ──
  | 'OUTPUT_SCHEMA_VIOLATION' // safeParse / 跨字段结构违例,重试耗尽
  | 'EVIDENCE_REQUIRED' // critic/critique/ack(done) 空 evidence(C1/C2)
  | 'EVIDENCE_UNVERIFIABLE' // evidence 锚点复算失败 / 无强证据(§8.3)
  | 'EVIDENCE_COMMAND_UNSAFE' // command 证据复跑违反沙箱安全约束(H3,§8.1)
  | 'EVIDENCE_INFRA_DEGRADED' // 复跑器/沙箱自身故障 → 该证据 weak,不连坐 critic(H12)
  | 'MESSAGE_SIZE_EXCEEDED' // 单条 message 超 MAX_MESSAGE_BYTES(H4,C10)
  | 'WORKTREE_PATH_VIOLATION' // files/file_ref 路径越界(C6)
  | 'DANGLING_REPLY_REF' // inReplyTo 悬空(C8)
  | 'INVALID_DONE_SELF_ACK' // 同轮自 done 又自 ack(C3)
  | 'INVALID_SYSTEM_SENDER' // system 消息 from 非 orchestrator,或 orchestrator 发非 system(C7/C9)
  | 'EMPTY_ROUND_PLAN' // playbook 排不出本轮发言计划(语义归引擎 03)
  // ── 子进程 / 适配层(归 04 / 事实地基 A·B) ──
  | 'SUBPROCESS_SPAWN_FAILED' // 子进程启动失败(裸名/.cmd/exe 缺失)
  | 'SUBPROCESS_CRASHED' // 运行中非零退出 / 信号杀
  | 'SUBPROCESS_TIMEOUT' // 硬墙钟超时被杀
  | 'SUBPROCESS_CANCELLED' // 人工 abort / 上层取消
  // ── 引擎(归 03 / 04) ──
  | 'ENGINE_FATAL' // 引擎不可恢复内部错(状态机非法转移等)
  | 'ROUND_LIMIT_EXCEEDED' // 触发 maxRounds(刹车 07)
  | 'CONVERGENCE_STALL' // 连续 N 轮无新 evidence 指纹(刹车 07,§9.3)
  | 'TOKEN_BUDGET_EXCEEDED' // 触发 token 预算(刹车 07,事实地基 D)
  // ── 安全(归 09) ──
  | 'PROVIDER_CONFIG_INVALID' // argv/-c 现疑似 key(provider 05 / 安全 09 预扫描)
  | 'INJECTION_BLOCKED' // 内容防火墙拦下喂对面的注入特征(R8,09)
  | 'EGRESS_SECRET_BLOCKED' // 中转源码出境 secret scan 命中(R8,09)
  // ── WS / 面板(归 08 / 11) ──
  | 'WS_UNAUTHORIZED' // ticket 无效 / 缺失
  | 'WS_ORIGIN_REJECTED' // Origin 不在白名单
  | 'WS_TICKET_EXPIRED' // 一次性 token 过期 / 已用
  | 'WS_PERMISSION_DENIED' // 观战权限尝试 control 操作
  | 'WS_RATE_LIMITED' // 连接 / 消息超频
  | 'WS_PAYLOAD_INVALID' // 入站控制帧 schema 违例
  | 'WS_PROTOCOL_ERROR' // 帧序 / 版本不匹配
  // ── worktree(归 06) ──
  | 'WORKTREE_CONFLICT' // round 末合并冲突,硬停回灌
  | 'WORKTREE_GIT_FAILED' // git 操作失败(add/merge/diff 等)
  // ── Fusion(归 21,远景) ──
  | 'FUSION_PANEL_FAILED' // panel 成员多数失败,无法合成
  | 'FUSION_JUDGE_FAILED' // judge 裁决失败 / 超时
  // ── provider / config(归 05 / 16) ──
  | 'PROVIDER_UNAVAILABLE' // 中转/base_url 不可达,热换兜底耗尽
  | 'CONFIG_INVALID'; // provider/playbook/预算配置 schema 违例

/**
 * 全集运行期常量数组。用途:
 * - 评测 15 据此做 `Record<SyluxErrorCode, …>` 穷举守卫(V32);
 * - 运行期判定某 string 是否合法错误码(WS/jsonl `code?: string` 入口窄化)。
 * 必须与上面 union 字面量逐一对齐(新增码两处都要改)。
 */
export const SYLUX_ERROR_CODES = [
  'OUTPUT_SCHEMA_VIOLATION',
  'EVIDENCE_REQUIRED',
  'EVIDENCE_UNVERIFIABLE',
  'EVIDENCE_COMMAND_UNSAFE',
  'EVIDENCE_INFRA_DEGRADED',
  'MESSAGE_SIZE_EXCEEDED',
  'WORKTREE_PATH_VIOLATION',
  'DANGLING_REPLY_REF',
  'INVALID_DONE_SELF_ACK',
  'INVALID_SYSTEM_SENDER',
  'EMPTY_ROUND_PLAN',
  'SUBPROCESS_SPAWN_FAILED',
  'SUBPROCESS_CRASHED',
  'SUBPROCESS_TIMEOUT',
  'SUBPROCESS_CANCELLED',
  'ENGINE_FATAL',
  'ROUND_LIMIT_EXCEEDED',
  'CONVERGENCE_STALL',
  'TOKEN_BUDGET_EXCEEDED',
  'PROVIDER_CONFIG_INVALID',
  'INJECTION_BLOCKED',
  'EGRESS_SECRET_BLOCKED',
  'WS_UNAUTHORIZED',
  'WS_ORIGIN_REJECTED',
  'WS_TICKET_EXPIRED',
  'WS_PERMISSION_DENIED',
  'WS_RATE_LIMITED',
  'WS_PAYLOAD_INVALID',
  'WS_PROTOCOL_ERROR',
  'WORKTREE_CONFLICT',
  'WORKTREE_GIT_FAILED',
  'FUSION_PANEL_FAILED',
  'FUSION_JUDGE_FAILED',
  'PROVIDER_UNAVAILABLE',
  'CONFIG_INVALID',
] as const;

/**
 * 编译期双向守卫:断言 `SYLUX_ERROR_CODES` 的成员集合 === `SyluxErrorCode`。
 * - 数组漏了某个 union 码 → 下面第一行编译红(union 不可赋给较窄的数组并集)。
 * - 数组混入非法字面量 → 第二行编译红(数组并集不可赋给 union)。
 */
type _CodesArrayUnion = (typeof SYLUX_ERROR_CODES)[number];
const _assertArrayCoversUnion: _CodesArrayUnion = '' as SyluxErrorCode;
const _assertUnionCoversArray: SyluxErrorCode = '' as _CodesArrayUnion;
void _assertArrayCoversUnion;
void _assertUnionCoversArray;

/** 运行期窄化:任意 string → 是否合法 SyluxErrorCode。 */
export function isSyluxErrorCode(s: string): s is SyluxErrorCode {
  return (SYLUX_ERROR_CODES as readonly string[]).includes(s);
}

/**
 * 自定义错误基类:继承 Error 带 code(总体规划 §11.3「不吞错」原则)。
 * 抛错一律用本类,`code` 机读、`message` 人读、`detail` 携带原始上下文。
 */
export class SyluxError extends Error {
  constructor(
    readonly code: SyluxErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SyluxError';
    // 保持原型链(extends Error 的 TS/ES5 兼容坑)
    Object.setPrototypeOf(this, SyluxError.prototype);
  }
}
