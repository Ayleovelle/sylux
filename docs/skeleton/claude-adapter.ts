/**
 * claude-adapter.ts —— claude 端 AgentAdapter 实现(权威:06-adapter-claude.md §2–§9)
 *
 * 遵守事实地基(PROBED-FACTS §F)+ 06 §0.3 本机实测增补(CF-1~CF-6):
 *   CF-1 claude PATH shim 背后是 .cmd → 真实 claude.exe(主包 bin/,不分平台子包,非 cli.js)。
 *   CF-2 直调 claude.exe + prompt 走 stdin + windowsHide;裸名/.cmd 传带空格 prompt 同踩 %* 打散坑。
 *   CF-3 headless 必带 --bare:否则跑 hooks/CLAUDE.md/skills,首事件是噪声且 input_tokens 暴涨 35×。
 *   CF-4 stream-json 每事件都带 session_id,且 --session-id 可预设;但 A1 仍以观测到的 system.init 为准。
 *   CF-5 result.usage 带 prompt 缓存,resume 走 cache_read(约 1/10 价),与 codex 全量重计费不对称。
 *   CF-6 result.subtype ∈ {success, error_max_turns, error_during_execution};--max-turns 封顶工具循环。
 *
 * 两端归一化(LineSplitter / FirstEventGate / ParsedLine / normalizeStream)与 codex 共享:
 *   骨架直接复用 codex-adapter.ts 导出的 LineSplitter / FirstEventGate / treeKill / assertArgvNoSecret,
 *   只新增 claude 专属的 exe 解析、argv 拼装、schema 三级降级、claudeMapper、usage 归一。
 *   真实落地时这些共享件应抽到 normalize/ 与 proc/ 下两端共用(见 06 §1 物理落点)。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { AgentAdapter, AgentInput, CreateClaudeAdapterOptions } from './adapter.js';
import {
  SyluxError,
  type AgentEvent,
  type AgentId,
  type SyluxErrorCode,
  type TokenUsage,
  type ProviderConfig,
  type KeyStore,
  type ClaudeInjection,
  toClaudeInjection,
  buildChildEnv,
  redact,
} from './_upstream.js';
// 两端共享件复用 codex 文件的导出(真实落地应在 normalize/ proc/ 下共用,06 §1)。
import { FirstEventGate, LineSplitter, treeKill, assertArgvNoSecret } from './codex-adapter.js';

/* ════════════════════════════════════════════════════════════════════════
 * §2. claude 真实 exe 路径解析(CF-1,与 codex §4 对称但更简单:主包 bin/,不分平台子包)
 * ════════════════════════════════════════════════════════════════════════ */

/** 平台 → claude.exe 文件名(主包 bin/ 下,CF-1)。 */
const CLAUDE_BIN: Record<string, string> = {
  win32: 'claude.exe', // ★实测
  linux: 'claude', // 【待实测 M0-5】
  darwin: 'claude', // 【待实测 M0-5】
};

/**
 * 解析 claude 真实 exe 绝对路径。优先级:显式 → SYLUX_CLAUDE_EXE → 主包 bin/ → npm 全局根扫描。
 * 全落空抛 SUBPROCESS_SPAWN_FAILED。构造期调一次缓存(失败提前暴露)。
 */
export function resolveClaudeExe(explicit?: string): string {
  const bin = CLAUDE_BIN[process.platform];
  const tried: string[] = [];
  const check = (p: string): string | null => {
    tried.push(p);
    return existsSync(p) ? p : null;
  };

  if (explicit) {
    const r = check(explicit);
    if (r) return r;
  }
  if (process.env.SYLUX_CLAUDE_EXE) {
    const r = check(process.env.SYLUX_CLAUDE_EXE);
    if (r) return r;
  }
  if (!bin) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `不支持的平台 ${process.platform}`, { tried });

  for (const root of candidateNodeRoots()) {
    const r = check(join(root, '@anthropic-ai', 'claude-code', 'bin', bin));
    if (r) return r;
  }
  throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `claude.exe 未找到`, { tried });
}

/** 候选 node_modules 根(与 codex §4.2 同款)。 */
function candidateNodeRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.SYLUX_NPM_GLOBAL_ROOT) roots.add(process.env.SYLUX_NPM_GLOBAL_ROOT);
  for (const p of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)) roots.add(p);
  return [...roots];
}

/* ════════════════════════════════════════════════════════════════════════
 * §3. argv 拼装:send / resume 两套(事实 F + 实测);prompt 永远走 stdin(CF-2)
 * ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_MAX_TURNS = 32; // 单次调用内工具循环上限;playbook 可覆盖

/**
 * --bare 是否可用。来源:M0-8 探测 `claude --help | grep -- --bare`,固化为模块级常量。
 * 命中则焊死必带 --bare(干净 + 省 35× token);未命中走 §3.1.2 hooks-disable 兜底。
 * 骨架默认 true(本机 2.1.183 实测存在)。【M0-8 闭环后据实改写】
 */
export const BARE_FLAG_AVAILABLE = true;

/** send/resume 共用的 headless 基线 argv(不含 prompt,prompt 走 stdin)。 */
function baseClaudeArgs(input: AgentInput): string[] {
  const args: string[] = [
    '-p', // headless 打印即退(事实 F)
    '--output-format',
    'stream-json', // 事件流(事实 F)
    '--verbose', // stream-json 下必带,否则退化为单 result 拿不到流式 delta/工具观战(实测)
    '--input-format',
    'text', // 默认 text(prompt 走 stdin);超长 schema 时切 stream-json(§4.4)
    '--permission-mode',
    mapPermissionMode(input.sandbox), // 沙箱映射(§3.3)
    '--max-turns',
    String(input.maxTurns ?? DEFAULT_MAX_TURNS), // 封顶轮内工具循环(CF-6)
  ];
  if (BARE_FLAG_AVAILABLE) args.push('--bare'); // ★CF-3:关 hooks/CLAUDE.md/skills/auto-memory
  if (input.ephemeral) args.push('--no-session-persistence'); // 对应 codex --ephemeral;⚠ 不可 resume(A7)
  // ★v3:--model/--fallback-model 不在此 push,改由 toClaudeInjection().flags 统一产出(避免与 provider 注入双写)。
  if (input.effort) args.push('--effort', input.effort); // low|medium|high|xhigh|max(事实 F)
  if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt); // 角色/协议注入(codex 无等价)
  args.push('--add-dir', input.workdir); // worktree 放行(claude cwd 由 spawn cwd 定,不像 codex -C)
  return args;
}

/** sandbox(05 AgentInput,封顶 workspace-write)→ claude --permission-mode。 */
function mapPermissionMode(sandbox: 'read-only' | 'workspace-write'): string {
  // read-only → 'plan'(只读规划不落盘);workspace-write → 'acceptEdits'(自动接受编辑,封顶)。
  // 绝不映射 bypassPermissions(等价 codex danger-full-access,被封顶禁止,08)。
  return sandbox === 'read-only' ? 'plan' : 'acceptEdits';
}

/** --settings 内联预算(UTF-16 字符)。与 §4 schema 预算同抢 32KB 命令行硬顶。 */
const SETTINGS_INLINE_BUDGET = 6000;

/**
 * §3.1.2:--settings 唯一拼装出口(CA15 / 07 §6.2 V4)——消除双写覆盖。
 * claude CLI 对重复 --settings 是「后者整体覆盖前者」,故必须 deep-merge 后单次注入。
 * @param fragment toClaudeInjection().settingsFragment(provider effort 等)
 * @param needHooksDisable 仅当 --bare 不可用走兜底时为 true(注入 hooks-disable 片段)
 */
export function pushClaudeSettings(args: string[], fragment: Record<string, unknown>, needHooksDisable: boolean): void {
  const hooksDisable = needHooksDisable ? { hooks: {}, disableAllHooks: true } : {};
  const merged = deepMerge(hooksDisable, fragment); // fragment 优先;二者键不重叠(hooks vs effort)
  if (Object.keys(merged).length === 0) return; // 都空(--bare 命中且无 extraConfig)→ 不加 --settings
  const json = JSON.stringify(merged);
  if (json.length > SETTINGS_INLINE_BUDGET) {
    throw new SyluxError('PROVIDER_CONFIG_INVALID', `--settings 内联超 ${SETTINGS_INLINE_BUDGET} 字符(extraConfig 过大)`, {
      len: json.length,
    });
  }
  args.push('--settings', json);
}

/** TODO(util):深合并两个普通对象(右值优先)。骨架占位,真实用成熟实现或 06 §3.1.2 约定。 */
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  // TODO: 递归合并嵌套对象;数组按右值覆盖。此处仅浅合并占位。
  return { ...a, ...b };
}

/* ── §4. --json-schema 内联串:命令行长度上限三级对策(核心难点) ── */

/** schema 强制兼容档(来自 provider 07 + M0-3 实测)。 */
export type SchemaStrictness =
  | 'inline_ok' // 后端接受本 schema 形状(含 anyOf/optional)→ 可走 inline 强制
  | 'strict_reject' // strict 后端拒 anyOf/optional → 即便短也不能 inline,直接走软约束
  | 'unknown'; // 未探测;保守当 inline_ok 试,失败链兜底

export type SchemaPlan =
  | { mode: 'inline' } // 一级:--json-schema <串> 进 argv(CLI 强制)
  | { mode: 'append_prompt'; enforced: false } // 二级:schema 塞 system prompt 软约束(全靠 safeParse 兜底)
  | { mode: 'stream_json_input' }; // 三级:走 stream-json 输入通道,长载荷全走 stdin(§4.4)

const SCHEMA_INLINE_BUDGET = 8000; // schema 内联预算(UTF-16 字符)
const CMDLINE_SAFE_LIMIT = 30000; // 整条命令行安全阈值(Windows 32767 UTF-16 硬顶,留 buffer)

/**
 * 决定 outputSchema 怎么进 claude(§4.2 / §4.5)。会 **mutate** 传入的 args。
 * 判定顺序:strict_reject 短路 → 二级 append_prompt;否则按长度三级降级。
 * 注意:必须在 pushClaudeSettings 之后调用(baseLen 才吃到 --settings 占用,§3.1.2)。
 */
export function planJsonSchemaArg(
  schema: Record<string, unknown>,
  args: string[],
  input: AgentInput,
  strictness: SchemaStrictness = 'unknown',
): SchemaPlan {
  const schemaStr = JSON.stringify(schema);
  const schemaLen = schemaStr.length;
  const baseLen = args.reduce((n, a) => n + a.length + 3, 0); // 粗估命令行长度(含引号/分隔余量)

  // §4.5:strict 后端拒 anyOf/optional → 即便短也不 inline(否则进程报 400/schema 不被接受)。
  const canInline = strictness !== 'strict_reject';

  // 一级:inline(强制力最强)
  if (canInline && schemaLen <= SCHEMA_INLINE_BUDGET && baseLen + schemaLen < CMDLINE_SAFE_LIMIT) {
    args.push('--json-schema', schemaStr);
    return { mode: 'inline' };
  }

  // 二级:塞进 --append-system-prompt(软约束)
  const softInstruction = buildSchemaAsPromptInstruction(schemaStr);
  mergeAppendSystemPrompt(args, softInstruction);
  const afterLen = args.reduce((n, a) => n + a.length + 3, 0);
  if (afterLen < CMDLINE_SAFE_LIMIT) {
    return { mode: 'append_prompt', enforced: false };
  }

  // 三级:命令行仍超 → stream-json 输入,长载荷全走 stdin(§4.4)
  stripAppendSystemPrompt(args, softInstruction); // 撤掉刚加的 append 段,改由 stdin user message 承载
  replaceInputFormatWithStreamJson(args); // --input-format text → stream-json
  return { mode: 'stream_json_input' };
}

/** 把 schema 文本包成「只输出合此 schema 的 JSON」软指令(二/三级共用)。 */
function buildSchemaAsPromptInstruction(schemaStr: string): string {
  return [
    '【输出契约·强制】你的最终回复必须是单个 JSON 对象,且严格符合以下 JSON Schema。',
    '不要输出任何额外文字、Markdown 代码围栏或解释,只输出该 JSON 本身。',
    'JSON Schema:',
    schemaStr,
  ].join('\n');
}

/** TODO:把 softInstruction 合并进既有 --append-system-prompt(无则新增)。骨架占位。 */
function mergeAppendSystemPrompt(args: string[], softInstruction: string): void {
  // TODO: 找到现有 '--append-system-prompt' 索引,拼接其值;无则 push 新的一对。
  args.push('--append-system-prompt', softInstruction);
}
/** TODO:撤回 mergeAppendSystemPrompt 注入的软指令(三级降级时)。骨架占位。 */
function stripAppendSystemPrompt(args: string[], softInstruction: string): void {
  // TODO: 从 args 中移除上一步加入的 softInstruction(及空了的 --append-system-prompt 对)。
  void softInstruction;
  const i = args.lastIndexOf('--append-system-prompt');
  if (i >= 0) args.splice(i, 2);
}
/** 把 --input-format text 改成 stream-json(三级)。 */
function replaceInputFormatWithStreamJson(args: string[]): void {
  const i = args.indexOf('--input-format');
  if (i >= 0 && i + 1 < args.length) args[i + 1] = 'stream-json';
  else args.push('--input-format', 'stream-json');
}

/** 首轮 argv:预设 session-id + settings + schema(§3.2)。 */
export function buildClaudeSendArgs(
  input: AgentInput,
  inj: ClaudeInjection,
  needHooksDisable: boolean,
  strictness?: SchemaStrictness,
): { args: string[]; presetSessionId: string; schemaPlan: SchemaPlan } {
  const presetSessionId = randomUUID(); // CF-4:预设合法 UUID;但 A1 仍以观测 system.init 为准
  const args = baseClaudeArgs(input);
  args.push(...inj.flags); // --model / --fallback-model(07 §6.2;非密)
  args.push('--session-id', presetSessionId);
  pushClaudeSettings(args, inj.settingsFragment, needHooksDisable); // §3.1.2 唯一 --settings 出口
  const schemaPlan = planJsonSchemaArg(input.outputSchema, args, input, strictness); // settings 之后(吃其占用)
  return { args, presetSessionId, schemaPlan };
}

/** 续轮 argv:--resume <sid>,sandbox/workdir 继承首轮(重传同值防漂移)(§3.3)。 */
export function buildClaudeResumeArgs(
  sessionId: string,
  input: AgentInput,
  inj: ClaudeInjection,
  needHooksDisable: boolean,
  strictness?: SchemaStrictness,
): { args: string[]; schemaPlan: SchemaPlan } {
  const args = baseClaudeArgs(input);
  args.push(...inj.flags);
  args.push('--resume', sessionId); // 不预设新 --session-id(复用旧 sid);如需新 id 走 --fork-session(默认不 fork)
  pushClaudeSettings(args, inj.settingsFragment, needHooksDisable);
  const schemaPlan = planJsonSchemaArg(input.outputSchema, args, input, strictness);
  return { args, schemaPlan };
}

/* ════════════════════════════════════════════════════════════════════════
 * §6. 两端统一归一化:中性 ParsedLine + claudeMapper(claude stream-json → ParsedLine)
 *   ParsedLine 是适配层内部类型(不进 02,不落黑板),专供 normalizeStream 消费。
 *   codex mapper 产出同一判别集 → pipeline 与 gate 零端分支(换 CLI 只换 mapper ~50 行)。
 * ════════════════════════════════════════════════════════════════════════ */

export type ParsedLine =
  | { t: 'session'; sessionId: string } // codex thread.started / claude system.init
  | { t: 'text_delta'; text: string } // 流式文本增量(透传面板)
  | { t: 'tool'; name: string; args: unknown } // 工具调用(透传面板观战)
  | { t: 'final'; raw: string; usage?: TokenUsage } // 最终结构化文本 + 本轮 usage
  | { t: 'fatal'; code: SyluxErrorCode; detail: string } // 端内可判致命(如 result.error_*)
  | { t: 'ignore' }; // hook 噪声 / 未知 type / 中间态,丢弃

/** mapper 接口:一行 string → 0 或 1 个 ParsedLine。 */
export interface LineMapper {
  map(line: string): ParsedLine;
}

/** claude stream-json 信封(§5)→ 中性 ParsedLine。 */
export const claudeMapper: LineMapper = {
  map(line: string): ParsedLine {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      return { t: 'ignore' }; // 非 JSON 行(理论上不应有)→ 丢
    }
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init' && typeof o.session_id === 'string') {
          return { t: 'session', sessionId: o.session_id }; // 闸门(首个 init,CF-3 保证 init 是首个 system 事件)
        }
        return { t: 'ignore' }; // hook_* 等噪声(CF-3 防御)
      case 'assistant': {
        // message.content[] 可能含多个 block;骨架取首个可映射 block(§6.4.2 多 block 完整透传是可选增强)。
        const blocks = o.message?.content ?? [];
        for (const b of blocks) {
          if (b.type === 'text' && b.text) return { t: 'text_delta', text: b.text };
          if (b.type === 'tool_use') return { t: 'tool', name: b.name, args: b.input };
        }
        return { t: 'ignore' };
      }
      case 'user':
        return { t: 'ignore' }; // tool_result 回灌;面板可另行透传,归一化默认丢
      case 'result':
        if (o.is_error || (o.subtype && o.subtype !== 'success')) return mapResultError(o); // §8.2
        return { t: 'final', raw: String(o.result ?? ''), usage: normalizeClaudeUsage(o.usage) }; // §5.4 / §7
      default:
        return { t: 'ignore' }; // 未知 type:容未来新增,不炸
    }
  },
};

/** §8.2:claude result 应用层错误分级。max_turns/during_execution 均复用 SUBPROCESS_CRASHED + detail 区分。 */
function mapResultError(o: any): ParsedLine {
  const tail = typeof o.result === 'string' ? o.result.slice(0, 500) : '';
  switch (o.subtype) {
    case 'error_max_turns':
      // 工具循环撞 --max-turns 上限:引擎可按 playbook 决定提高 maxTurns 后 resume(CF-5 claude resume 便宜)。
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `error_max_turns(num_turns=${o.num_turns}) ${tail}` };
    case 'error_during_execution':
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `error_during_execution ${tail}` };
    default:
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `result.is_error subtype=${o.subtype} ${tail}` };
  }
}

/* ── §7. usage 归一化(claude result.usage → 02 TokenUsage;缓存语义与 codex 不对称) ── */

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/**
 * claude result.usage → 02 TokenUsage。字段映射(CF-5):
 *   input_tokens                → inputTokens(本轮新输入,非缓存部分)
 *   cache_creation_input_tokens → 计入 inputTokens(写缓存按全价,合进新输入更贴成本)
 *   cache_read_input_tokens     → cachedInputTokens(命中缓存,约 1/10 价;resume 时变大)
 *   output_tokens               → outputTokens
 *   (claude 无独立 reasoning 计数)→ reasoningOutputTokens = 0
 * 只取 result 顶层 usage;不逐 modelUsage 摊(CF-5:含背景 haiku,非主成本)。
 */
export function normalizeClaudeUsage(u: any): TokenUsage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const cacheCreate = num(u.cache_creation_input_tokens);
  return {
    inputTokens: num(u.input_tokens) + cacheCreate, // 新输入 + 写缓存(均近全价)
    cachedInputTokens: num(u.cache_read_input_tokens), // 命中缓存(廉价)
    outputTokens: num(u.output_tokens),
    reasoningOutputTokens: 0,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * §8.1. LineQueue(CA5:spawn 时同步填充,避免惰性 generator 竞态)+ 归一化主循环
 * ════════════════════════════════════════════════════════════════════════ */

export type LineSignal =
  | { kind: 'line'; text: string } // 一条完整 JSONL
  | { kind: 'overflow'; bytes: number } // 单行超 MAX_JSONL_LINE_BYTES(CA3)
  | { kind: 'spawn_error'; detail: string } // child 'error' / stdin EPIPE(CL-a)
  | { kind: 'exit'; tail: string; stderrTail: string; code: number | null; signal: string | null; killCode: SyluxErrorCode };

/** 拉取式行队列:stdout 'data'/'close'/'error' 同步 push,generator 只 next() 消费。 */
export interface LineQueue {
  push(sig: LineSignal): void;
  next(): Promise<LineSignal>;
}

/** 最小 LineQueue 实现:有缓冲先出缓冲,否则挂起等下一个 push。 */
function makeLineQueue(): LineQueue {
  const buf: LineSignal[] = [];
  let waiter: ((s: LineSignal) => void) | undefined;
  return {
    push(sig) {
      if (waiter) {
        waiter(sig);
        waiter = undefined;
      } else {
        buf.push(sig);
      }
    },
    next() {
      if (buf.length > 0) return Promise.resolve(buf.shift()!);
      return new Promise<LineSignal>((r) => {
        waiter = r;
      });
    },
  };
}

/** stderr 末 N KiB 环形缓冲(CA3;有界,防刷屏撑爆内存)。 */
const STDERR_RING_BYTES = 64 * 1024;
function makeStderrRing(maxBytes: number): { push(s: string): void; value(): string } {
  let v = '';
  return {
    push(s) {
      v = (v + s).slice(-maxBytes);
    },
    value: () => v,
  };
}

/**
 * 把「已切行的事件源」归一化成 AgentEvent 异步流(两端共用;mapper 注入,pipeline 零端分支)。
 * @param lines spawn 时同步挂监听后填充的拉取式队列(CA5)
 * @param gate  resume 已 seededSessionId 构造(A9),send 裸构造
 */
export async function* normalizeStream(lines: LineQueue, mapper: LineMapper, gate: FirstEventGate): AsyncIterable<AgentEvent> {
  const primed = gate.primeIfSeeded(); // resume 预置:进流立刻补发 session_started(A9)
  if (primed) yield primed;

  let started = primed != null;
  let done = false;

  while (!done) {
    const sig = await lines.next();
    if (sig.kind === 'line') {
      const p = mapper.map(sig.text);
      switch (p.t) {
        case 'session': {
          const ev = gate.onThreadStarted(p.sessionId); // 唯一一次;重复→null(幂等)
          if (ev) {
            started = true;
            yield ev;
          }
          break;
        }
        case 'text_delta':
          if (started && !done) yield { kind: 'delta', text: p.text }; // delta 不经 gate(不受 A1/A2 约束)
          break;
        case 'tool':
          if (started && !done) yield { kind: 'tool_call', name: p.name, args: p.args };
          break;
        case 'final': {
          const ev = gate.onFinal(p.raw, p.usage);
          if (ev) {
            done = true;
            yield ev;
          }
          break;
        }
        case 'fatal': {
          const ev = gate.onFailure(coerceFailCode(p.code), p.detail); // 闸门前→SPAWN_FAILED,闸门后→原码
          if (ev) {
            done = true;
            yield ev;
          }
          break;
        }
        case 'ignore':
          break;
      }
    } else if (sig.kind === 'overflow') {
      const ev = gate.onFailure('SUBPROCESS_CRASHED', `jsonl line overflow ${sig.bytes}B`); // CA3
      if (ev) {
        done = true;
        yield ev;
      }
    } else if (sig.kind === 'spawn_error') {
      const ev = gate.onFailure('SUBPROCESS_SPAWN_FAILED', sig.detail); // child 'error'(CL-a)
      if (ev) {
        done = true;
        yield ev;
      }
    } else {
      // 'exit':stdout 结束 / 进程退出但未见 final(§8.3 部分输出)
      const ev = onStreamEndWithoutFinal(gate, sig.tail, sig.stderrTail, sig.code, sig.signal, sig.killCode);
      done = true;
      if (ev) yield ev;
    }
  }
}

/** gate.onFailure 只接 4 个子进程码;mapper 的 fatal 码收敛到其中(claude result 错误均映 CRASHED)。 */
function coerceFailCode(code: SyluxErrorCode): 'SUBPROCESS_CRASHED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CANCELLED' | 'SUBPROCESS_SPAWN_FAILED' {
  switch (code) {
    case 'SUBPROCESS_TIMEOUT':
    case 'SUBPROCESS_CANCELLED':
    case 'SUBPROCESS_SPAWN_FAILED':
      return code;
    default:
      return 'SUBPROCESS_CRASHED';
  }
}

/**
 * §8.3:stdout 自然结束(或进程 exit)但从未见 final。残行 + exit code 判因。
 * 绝不把已收集 delta 拼成 final(部分文本过不了 safeParse,污染黑板)——partial 一律走 error。
 * CA17:被我方 kill(signal 非空)用 killCode(超时 TIMEOUT / cancel CANCELLED);否则进程自己挂 → CRASHED。
 */
function onStreamEndWithoutFinal(
  gate: FirstEventGate,
  tail: string,
  stderrTail: string,
  code: number | null,
  signal: string | null,
  killCode: SyluxErrorCode,
): AgentEvent | null {
  const detail = [
    `exit without final_message (code=${code} signal=${signal})`,
    tail ? `partialLine=${tail.slice(0, 200)}` : '', // 残行不强解,只入 detail 供诊断
    stderrTail ? `stderr=${stderrTail.slice(-500)}` : '', // 已过 redact(CA10/§6.6)
  ]
    .filter(Boolean)
    .join('; ');
  const reason = signal != null ? coerceFailCode(killCode) : 'SUBPROCESS_CRASHED';
  return gate.onFailure(reason, detail); // gate 按相位改码:闸门前→SPAWN_FAILED(不可 resume)
}

/* ════════════════════════════════════════════════════════════════════════
 * §9.1. spawn 约束(CF-1/2/3 焊死)+ stdin 喂入(EPIPE 兜底,CA4)
 * ════════════════════════════════════════════════════════════════════════ */

/** spawn claude.exe 的唯一正确姿势。env 必经 buildChildEnv(调用方 §9.3 算好),绝不裸传 input.providerEnv(CA1)。 */
function spawnClaude(exePath: string, args: string[], env: Record<string, string>, workdir: string): ChildProcess {
  // ① 直调真实 exe(CF-1),绝不裸名/.cmd(CF-2 踩 %* 打散);② args 含 --bare 或兜底,prompt 走 stdin。
  const child = spawn(exePath, args, {
    cwd: workdir, // claude cwd = worktree(配合 --add-dir)
    env, // ★A5/CA1:已是 buildChildEnv 出口(含白名单 base + provider key)
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false, // ★绝不 shell(CF-2:.cmd 打散 + shell 注入 process.env)
    detached: process.platform !== 'win32', // POSIX 进程组,配合 treeKill
  });
  child.stdout!.setEncoding('utf8'); // UTF-8(Node 直捕,不经 shell 重定向,事实 A)
  child.stderr!.setEncoding('utf8');
  return child;
}

/** 喂 prompt/stream-json payload 到 stdin 并关闭。CA4:进程已死时 write 抛异步 EPIPE,必挂 error 吞掉转 onPipeError。 */
function feedStdin(child: ChildProcess, payload: string, onPipeError: (e: Error) => void): void {
  const stdin = child.stdin!;
  stdin.setDefaultEncoding('utf8');
  stdin.on('error', (e: Error) => onPipeError(e)); // EPIPE/ERR_STREAM_DESTROYED → 交 pipeline 当 spawn_error
  stdin.write(payload, (err) => {
    if (!err) stdin.end(); // write 回调有 err 时不再 end(避免二次抛)
  });
}

/** renderPayload:stream_json_input 模式把 prompt+schema 软指令包成 user message;否则纯 prompt(§4.4)。 */
function renderPayload(input: AgentInput, schemaPlan: SchemaPlan): string {
  if (schemaPlan.mode === 'stream_json_input') {
    // 【待实测 M0-2】claude stream-json 输入 user message 精确字段形,以实测为准。
    const text = `${input.prompt}\n${buildSchemaAsPromptInstruction(JSON.stringify(input.outputSchema))}`;
    return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
  }
  return input.prompt; // text 模式:schema 已在 argv(inline)或 append-prompt 里
}

/* ════════════════════════════════════════════════════════════════════════
 * §9.3. ClaudeAdapter —— send / resume / cancel(实现 adapter.ts 接口)
 *   对齐 codex/05 v2/v3 三处硬化:CA5 监听同步挂 + LineQueue;CA6 单进程在飞;CA7 兜底超时;CA14 构造期 keystore。
 * ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_HARD_TIMEOUT_MS = 10 * 60_000; // CA7:引擎漏传 timeoutMs 时的兜底上限

/** 构造 claude 适配器。exe 路径在此解析(§2),失败提前抛 SUBPROCESS_SPAWN_FAILED。 */
export function createClaudeAdapter(opts: CreateClaudeAdapterOptions): AgentAdapter {
  const exePath = resolveClaudeExe(opts.exePath); // 构造期解析 + 缓存
  const ceiling = opts.hardTimeoutCeilingMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const needHooksDisable = !BARE_FLAG_AVAILABLE; // --bare 命中 → false(hooks 已关);未命中 → 注入 hooks-disable 片段
  return new ClaudeAdapter(exePath, opts.provider, opts.keystore, ceiling, needHooksDisable);
}

class ClaudeAdapter implements AgentAdapter {
  readonly id: AgentId = 'claude';
  private current: ChildProcess | null = null; // CA6:同一时刻至多一个在飞

  constructor(
    private readonly exePath: string,
    private readonly provider: ProviderConfig,
    private readonly keystore: KeyStore, // ★CA14:构造期注入,run 时 toClaudeInjection 用,仅活内存(07 §8.4)
    private readonly hardTimeoutCeilingMs: number,
    private readonly needHooksDisable: boolean,
  ) {}

  send(input: AgentInput): AsyncIterable<AgentEvent> {
    return this.run(input, undefined); // send 不 seed gate(A1 以观测 system.init 为准)
  }

  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> {
    if (input.ephemeral) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'ephemeral 会话不可 resume(A7)'); // §8.5
    return this.run(input, sessionId); // seed gate(A9):进流立刻补发 session_started,不赌 claude 是否重发 init
  }

  async cancel(): Promise<void> {
    if (this.current) await treeKill(this.current); // §9.2;killCode 默认 CANCELLED,流由 close→exit 收尾
    // current 释放在 run 的 finally(消费侧拉完);cancel 只触发 kill,不直接清 current(防与在飞 generator 抢)
  }

  /** @deprecated 别名,语义同 cancel()。 */
  async kill(): Promise<void> {
    return this.cancel();
  }

  private run(input: AgentInput, sessionId: string | undefined): AsyncIterable<AgentEvent> {
    // CA6 并发护栏:current 非空即调用方 bug(引擎保证串行),抛而非静默排队。
    if (this.current) {
      throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'ClaudeAdapter 已有进程在飞(并发 send/resume 违约)');
    }

    // ★CA14 provider 注入(07 §6.2 三参,merge 内置):一步算 {flags, settingsFragment, env}。
    //   key 解析失败 → 闸门前失败,不伪造 session_started(A2)。
    let inj: ClaudeInjection;
    try {
      inj = toClaudeInjection(this.provider, this.keystore, input.providerOverrides);
    } catch (e) {
      const code = e instanceof SyluxError ? e.code : 'PROVIDER_CONFIG_INVALID';
      return (async function* () {
        yield { kind: 'error', code, detail: String((e as Error).message) } as AgentEvent;
      })();
    }

    // argv 拼装(§3.2/§3.3:push inj.flags + 单次 --settings + §4 schema)。
    // TODO(M0-3): strictness 档由 provider 07 / 实测探测缓存提供;骨架默认 'unknown'。
    const built =
      sessionId === undefined
        ? buildClaudeSendArgs(input, inj, this.needHooksDisable)
        : buildClaudeResumeArgs(sessionId, input, inj, this.needHooksDisable);
    const args = built.args;
    const payload = renderPayload(input, built.schemaPlan);

    assertArgvNoSecret(args); // A4 泄密预扫描(08 §2.4 SECRET_SIGNATURES;claude --settings/--append 可能误塞 key)

    // ★CA1/A5 env 单一出口:input.providerEnv ∪ inj.env(key/base_url)经 buildChildEnv 包白名单 base 变量。
    const env = buildChildEnv({ providerEnv: { ...input.providerEnv, ...inj.env }, agentId: this.id });

    let child: ChildProcess;
    try {
      child = spawnClaude(this.exePath, args, env, input.workdir);
    } catch (e) {
      const code = e instanceof SyluxError ? e.code : 'SUBPROCESS_SPAWN_FAILED';
      return (async function* () {
        yield { kind: 'error', code, detail: String((e as Error).message) } as AgentEvent;
      })();
    }
    this.current = child;

    // ── CA5 同步挂监听 + 填 LineQueue(在返回惰性 generator 之前,杜绝首个 system/init 竞态)──
    const splitter = new LineSplitter();
    const q = makeLineQueue();
    const stderrRing = makeStderrRing(STDERR_RING_BYTES);
    let killCode: SyluxErrorCode = 'SUBPROCESS_CANCELLED'; // ★CA17:超时改写为 TIMEOUT;人工 cancel 保持 CANCELLED
    child.stdout!.on('data', (c: string) => {
      try {
        for (const ln of splitter.push(c)) q.push({ kind: 'line', text: ln });
      } catch (e) {
        // LineSplitter 单行超闸抛 SyluxError(SUBPROCESS_CRASHED);转 overflow 信号并杀进程(CA3)
        q.push({ kind: 'overflow', bytes: (e as SyluxError).detail && (e as any).detail.bufBytes ? (e as any).detail.bufBytes : -1 });
        child.kill();
      }
    });
    child.stderr!.on('data', (c: string) => stderrRing.push(c));
    child.on('error', (e) => q.push({ kind: 'spawn_error', detail: String((e as Error)?.message ?? e) })); // CL-a
    child.on('close', (code, signal) =>
      q.push({ kind: 'exit', tail: splitter.flush().join('\n'), stderrTail: redact(stderrRing.value()), code, signal, killCode }),
    );

    // ── CA7/★CA17 超时:input.timeoutMs ?? ceiling;到点杀树,标 killCode=TIMEOUT,close 走 exit→TIMEOUT ──
    const timeoutMs = input.timeoutMs ?? this.hardTimeoutCeilingMs;
    const timer = timeoutMs
      ? setTimeout(() => {
          killCode = 'SUBPROCESS_TIMEOUT';
          void treeKill(child);
        }, timeoutMs)
      : undefined;

    // ── CA4 喂 stdin(EPIPE 转 spawn_error)──
    feedStdin(child, payload, (e) =>
      q.push({ kind: 'spawn_error', detail: `stdin ${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}` }),
    );

    const gate = new FirstEventGate(sessionId); // resume 预置 sessionId(A9);send 传 undefined
    const self = this;
    return (async function* () {
      try {
        yield* normalizeStream(q, claudeMapper, gate);
      } finally {
        if (timer) clearTimeout(timer);
        if (self.current === child) self.current = null;
      }
    })();
  }
}




