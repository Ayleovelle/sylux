/**
 * @sylux/shared · validate.ts
 *
 * validateMessage —— 黑板的【唯一守门函数】(黑板协议 02 §8)。
 * 任何子进程产出在进 engine 前必经此关(不变量 I2)。两阶段:
 *   阶段 A:纯 schema/跨字段(无副作用,可在任何上下文跑)。
 *   阶段 B:需中枢上下文(worktree 文件系统句柄)复算 evidence 锚点(§3.2)。
 *
 * 签名桥接(H11/D6):本函数吃【中枢已盖章的完整 Message】。引擎 03 的
 * EngineDeps.validate(payload, round) 是【适配器】,不是同一函数:它先用 §6.1 瘦
 * payload + 中枢盖章拼出 Message、构造 ValidateContext,再委托给本函数。
 */

import {
  messageSchema,
  type EvidenceItem,
  type Message,
} from './blackboard.schema.js';
import { contentHash, normalizeContent } from './fingerprint.js';
import type { SyluxErrorCode } from './errors.js';

// ============================================================================
// 上下文与返回类型(§8.1)
// ============================================================================

/** 中枢核验上下文:提供 worktree 读、已存在消息查、可选沙箱命令复跑。 */
export interface ValidateContext {
  runId: string;
  /**
   * 本上下文具备的核验能力(H13/FEAS-2)。M1 红蓝纯决策态无 worktree → fs=false,
   * 此时 file_ref 一律降 weak(无可读区间)。verifyEvidence 据此分支。
   */
  capabilities: {
    fs: boolean; // 是否可读 worktree 文件(readFileRange 是否有效)
    sandbox: boolean; // 是否可沙箱复跑 command(runCommandSandboxed 是否注入)
  };
  /**
   * 读 agent worktree 内文件指定行区间(越界 / 不存在 → null;capabilities.fs=false 时恒 null)。
   * 路径已过白名单。返回 1-based 闭区间 [lineStart, lineEnd] 的原文。
   */
  readFileRange(agentWorktreeRel: string, lineStart: number, lineEnd: number): string | null;
  /** 查同 run 是否存在某消息 id(C8 悬空引用校验)。 */
  hasMessage(id: string): boolean;
  /**
   * 可选:查某消息的 kind(用于 C2 判定 ack 是否针对 done)。
   * 未注入时 isAckOfDone 退化为保守策略(见下)。
   * TODO(02 §5.2 C2): 02 §8.1 的 ValidateContext 只列了 hasMessage;此处补一个可选查询
   *   以精确判定「ack→done」。若 03 不提供,validateMessage 对 kind==='ack' 且带 inReplyTo
   *   的一律按需 evidence 保守处理(宁严勿松,防双方互相秒认 done)。
   */
  getMessageKind?(id: string): Message['kind'] | null;
  /**
   * 可选:沙箱内复跑 command evidence(H3 安全约束)。未注入(capabilities.sandbox=false)
   * 则所有 command 证据为 weak。实现必须:① 仅在该 agent worktree 内执行;
   * ② sandbox 封顶 read-only/workspace-write;③ 断网;④ env 走白名单(buildChildEnv,09);
   * ⑤ 硬超时(默认 10s);⑥ 命令本身过预扫描(拒 rm -rf /、curl|sh、含 sk-/base64 疑似 key)。
   * 返回三态(H12/COV-3):
   *  - {ok:true,...}              正常执行完(匹配判定在 verifyEvidence)
   *  - {ok:false,reason:'unsafe'} 预扫描判命令不安全 → EVIDENCE_COMMAND_UNSAFE,fail + 记无效发言
   *  - {ok:false,reason:'infra'}  沙箱/复跑器自身崩 → 该证据 weak(不 fail、不连坐 critic、不计无效发言、不进 stall)
   */
  runCommandSandboxed?: (
    cmd: string,
  ) =>
    | { ok: true; stdout: string; exitCode: number }
    | { ok: false; reason: 'unsafe' | 'infra'; detail: string };
  /** 路径白名单判定(§8.3,安全文档 09 拥有规则,本函数注入)。 */
  isPathAllowed(rel: string): boolean;
}

/** 校验结果:ok 或带错误码 + 人类可读 + 违规字段路径。 */
export type ValidateResult =
  | { ok: true }
  | { ok: false; code: SyluxErrorCode; message: string; path?: string };

/** 单条 evidence 复算结果。pass=强(中枢独立复算通过);weak=仅定位/自报/无能力/基础设施故障;fail=复算不符。 */
export type VerifyResult = 'pass' | 'fail' | 'weak';

// ============================================================================
// 两阶段流程(§8.2)
// ============================================================================

export function validateMessage(msg: Message, ctx: ValidateContext): ValidateResult {
  // ── 阶段 A:结构 + 跨字段(无副作用)──
  const parsed = messageSchema.safeParse(msg);
  if (!parsed.success) {
    return { ok: false, code: 'OUTPUT_SCHEMA_VIOLATION', message: parsed.error.message };
  }
  const m = parsed.data;

  // C3/C4/C5/C7/C9 等纯结构跨字段(superRefine 的命令式实现)
  const struct = checkCrossField(m);
  if (!struct.ok) return struct;

  // C6 路径白名单(file_ref.path + files[].path + renamedFrom)
  for (const p of collectPaths(m)) {
    if (!ctx.isPathAllowed(p)) {
      return { ok: false, code: 'WORKTREE_PATH_VIOLATION', message: `path 越界/敏感: ${p}`, path: p };
    }
  }

  // C8 inReplyTo 悬空
  if (m.inReplyTo && !ctx.hasMessage(m.inReplyTo)) {
    return { ok: false, code: 'DANGLING_REPLY_REF', message: `inReplyTo 不存在: ${m.inReplyTo}` };
  }

  // ── 阶段 B:evidence 可核验(需 worktree;C1/C2)──
  const needsEvidence = m.role === 'critic' || m.kind === 'critique' || isAckOfDone(m, ctx);
  if (needsEvidence) {
    if (m.evidence.length === 0) {
      return { ok: false, code: 'EVIDENCE_REQUIRED', message: 'critic/critique/ack(done) 需非空 evidence' };
    }
    // 至少一条达「强」核验通过(weak 不算:无 quote 的 file_ref / 未实跑 command / spec_quote,§3.2/H2)
    const hasStrong = m.evidence.some((e) => verifyEvidence(e, ctx) === 'pass');
    if (!hasStrong) {
      return { ok: false, code: 'EVIDENCE_UNVERIFIABLE', message: '无任何强 evidence 复算通过(weak 级不解锁)' };
    }
  }
  return { ok: true };
}

// ============================================================================
// 跨字段结构校验(§5.2 C3/C4/C5/C7/C9;C1/C2 在阶段 B,C6/C8 在主流程,C10 在 size 闸,C11 在 append)
// ============================================================================

function checkCrossField(m: Message): ValidateResult {
  // C4:file_ref 行区间 lineEnd >= lineStart 且均 ≥1(positive 已在 schema 保证 ≥1)
  for (const e of m.evidence) {
    if (e.kind === 'file_ref' && e.lineEnd < e.lineStart) {
      return { ok: false, code: 'OUTPUT_SCHEMA_VIOLATION', message: `file_ref lineEnd<lineStart: ${e.path}` };
    }
  }
  // C5:rename 必填 renamedFrom
  for (const f of m.files) {
    if (f.changeKind === 'rename' && !f.renamedFrom) {
      return { ok: false, code: 'OUTPUT_SCHEMA_VIOLATION', message: `rename 缺 renamedFrom: ${f.path}` };
    }
  }
  // C7:system 消息 from 必须为 orchestrator
  if (m.kind === 'system' && m.from !== 'orchestrator') {
    return { ok: false, code: 'INVALID_SYSTEM_SENDER', message: `system 消息 from 非 orchestrator: ${m.from}` };
  }
  // C9:orchestrator 只能发 system(不冒充 agent 发业务消息)
  if (m.from === 'orchestrator' && m.kind !== 'system') {
    return { ok: false, code: 'INVALID_SYSTEM_SENDER', message: `orchestrator 发非 system: ${m.kind}` };
  }
  // C3:done 不得在同轮既 done 又自我 ack —— 需同轮上下文(同 from 是否已 ack 自己的 done),
  // 单条消息内无法判全,留引擎 03 在 append 时按 (round, from) 聚合校验。
  // TODO(02 §5.2 C3): 引擎侧在 append 校验同轮 (from) 的 done/ack 组合,命中抛 INVALID_DONE_SELF_ACK。
  return { ok: true };
}

/** 收集本条消息所有受路径白名单约束的路径(C6)。 */
function collectPaths(m: Message): string[] {
  const paths: string[] = [];
  for (const e of m.evidence) {
    if (e.kind === 'file_ref') paths.push(e.path);
  }
  for (const f of m.files) {
    paths.push(f.path);
    if (f.renamedFrom) paths.push(f.renamedFrom);
  }
  return paths;
}

/**
 * 判定本条 ack 是否针对一条 done(C2:需带强 evidence,防双方互相秒认 done)。
 * 有 getMessageKind:精确判 inReplyTo 指向的 kind==='done'。
 * 无:保守 —— 凡 kind==='ack' 且带 inReplyTo 即按「需 evidence」处理(宁严勿松)。
 */
function isAckOfDone(m: Message, ctx: ValidateContext): boolean {
  if (m.kind !== 'ack' || !m.inReplyTo) return false;
  if (ctx.getMessageKind) return ctx.getMessageKind(m.inReplyTo) === 'done';
  return true; // 保守兜底
}

// ============================================================================
// 单条 evidence 复算(§8.3 verifyEvidence)
// ============================================================================

function verifyEvidence(e: EvidenceItem, ctx: ValidateContext): VerifyResult {
  switch (e.kind) {
    case 'file_ref': {
      if (!ctx.capabilities.fs) return 'weak'; // H13:M1 无文件系统,file_ref 不可作强证据
      const content = ctx.readFileRange(e.path, e.lineStart, e.lineEnd);
      if (content === null) return 'fail'; // 不存在 / 越界
      if (e.quote === undefined) return 'weak'; // H1:仅定位,无内容断言可比
      const ok = normalizeContent(content) === normalizeContent(e.quote);
      // 副作用:中枢派生权威 contentHash 回填(供指纹 §9;覆盖 agent 可能填的值,I7)
      (e as { contentHash?: string }).contentHash = contentHash(content);
      return ok ? 'pass' : 'fail';
    }
    case 'command': {
      // H2/H3:只有沙箱实跑复算通过才算强;未注入复跑器 → 一律 weak(不信 agent 自报 actual)
      if (!ctx.capabilities.sandbox || !ctx.runCommandSandboxed) return 'weak';
      const r = ctx.runCommandSandboxed(e.cmd); // 沙箱/断网/超时/预扫描见 §8.1
      if (!r.ok) {
        // H12/COV-3:区分「命令不安全」与「沙箱自身崩」
        if (r.reason === 'unsafe') return 'fail'; // 安全违规 → fail + 记无效发言(调用侧 §8.4)
        return 'weak'; // reason==='infra':中枢侧故障,不连坐 critic,记 system 告警(调用侧 §8.4)
      }
      if (e.exitCode !== undefined && e.exitCode !== r.exitCode) return 'fail';
      return matchOutput(r.stdout, e.expected, e.matchMode) ? 'pass' : 'fail';
    }
    case 'spec_quote':
      return 'weak'; // 来源可达性弱核验(不做语义比对),不足以单独解除 evidence 要求
  }
}

/** command 证据输出比对:equals 全等 / contains 子串 / regex 正则(归一化后比对)。 */
function matchOutput(stdout: string, expected: string, mode: 'equals' | 'contains' | 'regex'): boolean {
  const a = normalizeContent(stdout);
  const b = normalizeContent(expected);
  switch (mode) {
    case 'equals':
      return a === b;
    case 'contains':
      return a.includes(b);
    case 'regex':
      try {
        // 用未归一化的 expected 作正则源,对未归一化 stdout 测;归一化仅用于 equals/contains。
        return new RegExp(expected).test(stdout);
      } catch {
        return false; // 非法正则视为不匹配(不抛,守门函数不崩)
      }
  }
}

/**
 * 暴露 verifyEvidence 供引擎 03 在「打回与重试」(§8.4)中区分 unsafe/infra:
 * 引擎需要知道某条 command 是 fail(unsafe,计无效发言)还是 weak(infra,不连坐)。
 * validateMessage 只回「整条消息是否过门」,细粒度结果走这里。
 */
export function verifyEvidenceItem(e: EvidenceItem, ctx: ValidateContext): VerifyResult {
  return verifyEvidence(e, ctx);
}
