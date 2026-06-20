/**
 * codex-adapter.ts —— codex 端 AgentAdapter 实现(权威:05-adapter-codex.md §4–§10)
 *
 * 遵守事实地基(docs/PROBED-FACTS.md):
 *   A 直调真实 codex.exe + prompt 走 stdin(裸名是 bash shim 不能 spawn;.cmd 打散带空格 prompt)。
 *   B --json 事件流 4 类:thread.started(首行带 thread_id)→ turn.started → item.completed → turn.completed(usage)。
 *   E exec 与 exec resume 参数集不同:resume 拒 -s/-C,必带 --skip-git-repo-check,SESSION_ID/PROMPT 为位置参数。
 *
 * 关键逻辑以 TODO 标注;骨架体现真实接口与控制流,非伪代码。
 *
 * 真实落地后 import 路径改回 @sylux/shared / @sylux/providers / @sylux/security(见 _upstream.ts 顶注)。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

import type { AgentAdapter, AgentInput, CreateCodexAdapterOptions } from './adapter.js';
import {
  SyluxError,
  type AgentEvent,
  type AgentId,
  type TokenUsage,
  type ProviderConfig,
  type KeyStore,
  MAX_JSONL_LINE_BYTES,
  toCodexInjection,
  buildChildEnv,
  SECRET_SIGNATURES,
  isStrongSecretLike,
  redact,
} from './_upstream.js';

/* ════════════════════════════════════════════════════════════════════════
 * §4. codex 真实 exe 路径解析(事实 A,焊死)
 * ════════════════════════════════════════════════════════════════════════ */

/** 平台 → codex 平台包名 + vendor target + bin 名(事实 A 仅实测 win32-x64,余按 npm 命名约定推断)。 */
const CODEX_PLATFORM: Record<string, { pkg: string; target: string; bin: string }> = {
  'win32-x64': { pkg: '@openai/codex-win32-x64', target: 'x86_64-pc-windows-msvc', bin: 'codex.exe' }, // ★实测
  'win32-arm64': { pkg: '@openai/codex-win32-arm64', target: 'aarch64-pc-windows-msvc', bin: 'codex.exe' }, // 【待实测】
  'linux-x64': { pkg: '@openai/codex-linux-x64', target: 'x86_64-unknown-linux-gnu', bin: 'codex' }, // 【待实测】
  'darwin-arm64': { pkg: '@openai/codex-darwin-arm64', target: 'aarch64-apple-darwin', bin: 'codex' }, // 【待实测】
};

/**
 * 解析 codex 真实 exe 绝对路径。优先级:
 *   1. 显式 exePath(createCodexAdapter 传入)
 *   2. SYLUX_CODEX_EXE 环境变量(运维逃生口)
 *   3. 从已知 npm 根进 @openai/codex 内嵌平台包 vendor bin(事实 A.3 路径形态)
 * 全部落空 → 抛 SUBPROCESS_SPAWN_FAILED(detail 列已探测路径)。
 * 在 createCodexAdapter 构造期调一次并缓存,spawn 期不再探测(失败提前暴露)。
 */
export function resolveCodexExe(explicit?: string): string {
  const key = `${process.platform}-${process.arch}`;
  const spec = CODEX_PLATFORM[key];
  const tried: string[] = [];
  const check = (p: string): string | null => {
    tried.push(p);
    return existsSync(p) ? p : null;
  };

  if (explicit) {
    const r = check(explicit);
    if (r) return r;
  }
  if (process.env.SYLUX_CODEX_EXE) {
    const r = check(process.env.SYLUX_CODEX_EXE);
    if (r) return r;
  }
  if (!spec) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `不支持的平台 ${key}`, { tried });

  for (const root of candidateNodeRoots()) {
    // 平台包装在主包 node_modules 下(事实 A.3 实测形态)
    const r = check(join(root, '@openai', 'codex', 'node_modules', spec.pkg, 'vendor', spec.target, 'bin', spec.bin));
    if (r) return r;
    // 也可能与主包平级安装
    const r2 = check(join(root, spec.pkg, 'vendor', spec.target, 'bin', spec.bin));
    if (r2) return r2;
  }
  throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `codex.exe 未找到(${key})`, { tried });
}

/** 候选 node_modules 根:SYLUX_NPM_GLOBAL_ROOT、NODE_PATH、(TODO)cwd 上溯找 node_modules。 */
function candidateNodeRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.SYLUX_NPM_GLOBAL_ROOT) roots.add(process.env.SYLUX_NPM_GLOBAL_ROOT);
  for (const p of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)) roots.add(p);
  // TODO(M0): cwd 上溯 walk-up 找 node_modules;require.resolve('@openai/codex/package.json') 作辅助。
  return [...roots];
}

/* ════════════════════════════════════════════════════════════════════════
 * §9. output-schema 落临时文件 + 清理(事实 C;codex 收文件,claude 收内联)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 把 buildAgentOutputJsonSchema() 产出的对象写临时文件,返回路径 + 幂等清理钩子。
 * codex 用 --output-schema <path> 引用。应用层仍保留 safeParse 兜底(事实 C,引擎做)。
 */
export async function writeSchemaFile(
  schema: Record<string, unknown>,
): Promise<{ path: string; cleanup: () => void }> {
  const dir = await mkdtemp(join(tmpdir(), 'sylux-schema-'));
  const path = join(dir, 'agent-output.schema.json');
  await writeFile(path, JSON.stringify(schema), 'utf8'); // Node 直写,无 Windows 重定向 UTF-16 坑(事实 A)
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    void rm(dir, { recursive: true, force: true }); // 幂等;失败静默(临时目录不阻断主流程)
  };
  return { path, cleanup };
}

/* ════════════════════════════════════════════════════════════════════════
 * §6. argv 拼装 —— exec 与 resume 两套(事实 E,不对称,绝不照抄,A3)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * exec 首轮 argv(不含 exe 本身)。prompt 不进 argv(走 stdin),用 '-' 占位。
 * @param cArgs 由 07 toCodexInjection().cArgs 算出(含 env_key 行,非密);本函数只拼不解释。
 */
export function buildExecArgs(input: AgentInput, schemaFilePath: string, cArgs: readonly string[]): string[] {
  const args: string[] = ['exec'];
  args.push('--output-schema', schemaFilePath); // 事实 C:codex 走文件
  args.push('--json'); // 事实 B:JSONL 事件流
  args.push('-C', input.workdir); // 工作目录;resume 继承不再传(事实 E)
  args.push('-s', input.sandbox); // 沙箱封顶 workspace-write;resume 拒 -s(事实 E)
  pushProviderConfig(args, cArgs); // -c/-m;key 绝不在此(A4/A11)
  if (input.ephemeral) args.push('--ephemeral');
  args.push('-'); // 位置参数:从 stdin 读 prompt(事实 A.3)
  return args;
}

/**
 * exec resume 续接 argv(事实 E 硬约束):
 *   - 子命令 `exec resume`;拒 -s/-C(继承首轮);非信任目录必带 --skip-git-repo-check;
 *   - SESSION_ID 与 PROMPT 是位置参数,PROMPT 用 '-' 走 stdin,SESSION_ID 在前。
 */
export function buildResumeArgs(
  sessionId: string,
  input: AgentInput,
  schemaFilePath: string,
  cArgs: readonly string[],
): string[] {
  const args: string[] = ['exec', 'resume'];
  args.push('--json');
  args.push('--skip-git-repo-check'); // 事实 E:worktree 多非 git-trusted,必带
  // 【待实测 R-resume-schema】resume 是否收 --output-schema;按 exec 同源处理 + 保留 safeParse 兜底。
  args.push('--output-schema', schemaFilePath);
  // ★ 绝不拼 -s / -C(事实 E 实测拒绝,会 'unexpected argument');workdir/sandbox 由首轮继承(A3 核心)。
  pushProviderConfig(args, cArgs);
  if (input.ephemeral) args.push('--ephemeral');
  args.push(sessionId); // 位置参数:SESSION_ID 在前
  args.push('-'); // 位置参数:PROMPT 走 stdin,在后
  return args;
}

/**
 * provider 非密覆盖注入(§6.3)。cArgs 来自 07 toCodexInjection,已是
 *   ['-c','model_provider=…','-c','…env_key=VAR','-m','…'] 形态(含 env_key 行,值是变量名非密)。
 * 本函数只把 cArgs 拼进 args,不自拼 -c(A11);真实 key 在 toCodexInjection().env(§8.2)。
 */
function pushProviderConfig(args: string[], cArgs: readonly string[]): void {
  for (const a of cArgs) args.push(a);
}

/* ════════════════════════════════════════════════════════════════════════
 * §6.4. spawn 前 argv 泄密预扫描(A4 焊死;V3g 单一权威,用 08 强特征子集)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * spawn 前对最终 argv 逐项预扫。命中强特征即抛,绝不 spawn(A4/S3)。
 * 用 isStrongSecretLike(sk-/sk-ant-/Bearer/AKIA/ghp_/jwt 等)做硬闸:强特征误报率极低;
 * 不用全特征(含 b64/hex 高误报),否则 worktree 路径里的长 base64/hex 段会误炸 spawn。
 * 真正的 key 走 env(toCodexInjection().env → buildChildEnv),正常根本不该出现在 argv。
 */
export function assertArgvNoSecret(argv: readonly string[]): void {
  for (const a of argv) {
    if (isStrongSecretLike(a)) {
      const sig = SECRET_SIGNATURES.find((s) => s.strong && s.re.test(a));
      throw new SyluxError(
        'PROVIDER_CONFIG_INVALID',
        'argv 命中疑似密钥特征,拒绝 spawn(key 必须走 env,A4/S3)',
        { signature: sig?.name, offendingArgHint: a.slice(0, 8) + '…' }, // 只留命中签名名 + 前 8 字符(脱敏)
      );
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * §5.3. 首事件闸门状态机 FirstEventGate(守 A1/A2/A9,焊死)
 *   保证「session_started 恰好一次、且不在崩溃路径上伪造」。
 *   注:06(claude 端)复用同一类(经 normalize/gate.ts),send/resume 触发条件不同而已。
 * ════════════════════════════════════════════════════════════════════════ */

type SpawnPhase =
  | 'awaiting_thread' // 闸门前:还没见 thread.started / system.init
  | 'streaming' // 闸门后:已 emit session_started,正常吐 delta/tool_call/final
  | 'terminal'; // 已 emit error 或 final_message 后流结束;后续事件一律丢弃

export class FirstEventGate {
  private phase: SpawnPhase = 'awaiting_thread';

  /**
   * @param seededSessionId resume 预置(A9):已知 sessionId 时进流立刻合成 session_started,
   *   phase 直接进 'streaming';此后即便 CLI 重发 thread.started 也被幂等吞掉。send 首轮传 undefined。
   */
  constructor(private readonly seededSessionId?: string) {
    if (seededSessionId !== undefined) this.phase = 'streaming';
  }

  /** resume 预置时取要补发的首事件(进流后立刻调一次)。send 路径返回 null。 */
  primeIfSeeded(): AgentEvent | null {
    return this.seededSessionId !== undefined
      ? { kind: 'session_started', sessionId: this.seededSessionId }
      : null;
  }

  /** 解析器命中合法 thread.started 首行(codex)/ system.init(claude)时调用。返回要 emit 的事件(或 null=吞重复)。 */
  onThreadStarted(threadId: string): AgentEvent | null {
    if (this.phase !== 'awaiting_thread') return null; // 重复 / 预置后:丢弃(防伪造二次,A9 兼容)
    this.phase = 'streaming';
    return { kind: 'session_started', sessionId: threadId }; // A1:唯一一次
  }

  /** 进程异常结束 / spawn error / 闸门前 exit 时调用。 */
  onFailure(
    code: 'SUBPROCESS_SPAWN_FAILED' | 'SUBPROCESS_CRASHED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CANCELLED',
    detail: string,
  ): AgentEvent | null {
    if (this.phase === 'terminal') return null;
    const wasBeforeGate = this.phase === 'awaiting_thread';
    this.phase = 'terminal';
    // A2:闸门前失败,绝不补发 session_started,直接 error,且一律归 SPAWN_FAILED(对引擎=不可 resume);
    //     闸门后失败(F-c)保留具体 code。
    return { kind: 'error', code: wasBeforeGate ? 'SUBPROCESS_SPAWN_FAILED' : code, detail };
  }

  /** 正常拿到最终消息。usageDegraded(V3j):usage 信封在但 output 字段漂移,透传给刹车 04。 */
  onFinal(raw: string, usage?: TokenUsage, usageDegraded?: boolean): AgentEvent | null {
    if (this.phase !== 'streaming') return null; // 没经闸门却出 final = 异常,应走 onFailure
    this.phase = 'terminal';
    return { kind: 'final_message', raw, usage, ...(usageDegraded ? { usageDegraded: true } : {}) };
  }

  /** 见过 thread.started(或预置)才可 resume。 */
  get resumable(): boolean {
    return this.phase !== 'awaiting_thread';
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * §7.2 / §7.3. 行切分 + usage 归一 + stderr 环形缓冲
 * ════════════════════════════════════════════════════════════════════════ */

/** 增量行解析器:喂 chunk,吐完整行;残行留缓冲。单行超限即抛(A6,防无界缓冲 DoS)。 */
export class LineSplitter {
  private buf = '';

  /** @throws SyluxError 残行(无 \n)累计超 MAX_JSONL_LINE_BYTES。 */
  push(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); // 强制 utf8(事实 A)
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_JSONL_LINE_BYTES && this.buf.indexOf('\n') === -1) {
      const bufBytes = Buffer.byteLength(this.buf, 'utf8');
      this.buf = ''; // 丢弃,避免持续占内存
      throw new SyluxError('SUBPROCESS_CRASHED', `单行超 ${MAX_JSONL_LINE_BYTES}B 未见换行,疑似失控输出`, { bufBytes });
    }
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? ''; // 最后一段是残行(无尾随 \n),留到下次
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.length > 0);
  }

  /** 进程 close 时冲洗残行(可能是最后一个完整 JSON 无尾 \n)。 */
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

/** codex usage(snake)→ 02 §6.3 TokenUsage(camel)。缺字段按 0。 */
export function normalizeUsage(u: any): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.input_tokens ?? 0,
    cachedInputTokens: u.cached_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningOutputTokens: u.reasoning_output_tokens ?? 0,
  };
}

/** V3j:usage 信封存在但字段漂移(input 非 0 而 output 缺/为 0)→ 降级标记,供刹车对 output 走地板估而非 0。 */
export function isUsageDegraded(u: any): boolean {
  if (!u) return false; // 纯缺信封不算 degraded(那是 R-parse-4 的 undefined 路径)
  const hasInput = (u.input_tokens ?? 0) > 0;
  const hasOutputField = u.output_tokens !== undefined && u.output_tokens !== null;
  return hasInput && !hasOutputField;
}

/** 末 N 字节环形缓冲:stderr 只留尾部作失败 detail,不无界累积(A6)。tail() 出口经 08 redact。 */
class RingBuffer {
  private buf = '';
  constructor(private readonly maxBytes: number) {}
  push(s: string): void {
    this.buf = (this.buf + s).slice(-this.maxBytes);
  }
  tail(): string {
    return this.buf;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * §7.3. 解析主循环:EventSink(spawn 后同步挂监听,A3)+ drainEventQueue(瘦生成器)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * EventSink:spawn 后**同步**构造并挂 child 监听(A3),把事件驱动的 child 回调桥成可拉取 queue。
 * 监听挂载发生在「喂 stdin」之前(§8.2),保证 thread.started 不被漏接(codex 极快返回也不丢首事件)。
 */
class EventSink {
  readonly queue: AgentEvent[] = [];
  closed = false;
  /** V3f:cancel/超时路径由 treeKill 写入('SUBPROCESS_CANCELLED'|'SUBPROCESS_TIMEOUT');
   *  onClose 闸门后分支据此 emit 对应 code,缺省视为真崩溃 CRASHED。 */
  terminationHint?: 'SUBPROCESS_CANCELLED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CRASHED';
  private splitter = new LineSplitter();
  private pendingRaw: string | undefined; // item.completed(agent_message)暂存的最终文本
  private stderrRing = new RingBuffer(16 * 1024); // A6:只留末 16KiB stderr 作 detail(脱敏后)
  private lastUsage: any; // turn.completed.usage 原始信封,合进 final 时归一
  private resolveWake?: () => void;
  private readonly HIGH = 1024;
  private readonly LOW = 256; // A6 背压水位(AgentEvent 条数)

  constructor(
    private readonly child: ChildProcess,
    readonly gate: FirstEventGate,
  ) {
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (c) => this.onStdout(c));
    child.stderr!.on('data', (c) => this.stderrRing.push(typeof c === 'string' ? c : c.toString('utf8')));
    child.on('error', (e) => {
      this.emit(this.gate.onFailure('SUBPROCESS_SPAWN_FAILED', String((e as Error)?.message ?? e)));
      this.finish();
    });
    child.on('close', (code, signal) => this.onClose(code, signal));
  }

  private emit(ev: AgentEvent | null): void {
    if (ev) {
      this.queue.push(ev);
      this.maybePause();
      this.wake();
    }
  }

  /** stdin 写失败(EPIPE)兜底入口(A4):走 gate(幂等)+ null 守卫 + wake。 */
  failFromStdin(detail: string): void {
    this.emit(this.gate.onFailure('SUBPROCESS_SPAWN_FAILED', detail));
  }

  private wake(): void {
    this.resolveWake?.();
    this.resolveWake = undefined;
  }
  waitNext(): Promise<void> {
    return new Promise<void>((r) => {
      this.resolveWake = r;
    });
  }
  private finish(): void {
    this.closed = true;
    this.wake();
  }

  /** A6 背压:queue 高于 HIGH 暂停 stdout,drain 到 LOW 以下再恢复。 */
  private maybePause(): void {
    if (this.queue.length >= this.HIGH) this.child.stdout!.pause();
  }
  maybeResume(): void {
    if (this.queue.length <= this.LOW && this.child.stdout!.isPaused()) this.child.stdout!.resume();
  }

  private onStdout(c: Buffer | string): void {
    let lines: string[];
    try {
      lines = this.splitter.push(c);
    } catch (e) {
      this.emit(this.gate.onFailure('SUBPROCESS_CRASHED', String((e as Error).message))); // A6 单行超闸
      void treeKill(this.child);
      return;
    }
    for (const l of lines) this.handleLine(l);
  }

  /** §7.1 codex 原生事件 → AgentEvent 映射(事实 B 4 类)。 */
  private handleLine(line: string): void {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // 非 JSON 行(偶发日志)跳过,不污染流(R-parse-1)
    }
    switch (obj?.type) {
      case 'thread.started':
        this.emit(this.gate.onThreadStarted(String(obj.thread_id))); // A1 闸门;resume 预置后幂等吞掉
        break;
      case 'turn.started':
        break; // 仅时序,不映射
      case 'item.completed': {
        const item = obj.item;
        if (item?.type === 'agent_message') {
          this.pendingRaw = String(item.text ?? ''); // 暂存最终文本(R-parse-3 取末条)
        } else {
          this.emit({ kind: 'tool_call', name: String(item?.type ?? 'tool'), args: item }); // 透传面板观战
        }
        break;
      }
      case 'turn.completed':
        // V3j:usage 降级标记一并交给 gate.onFinal,合进 final_message.usageDegraded(供刹车 04)
        this.emit(this.gate.onFinal(this.pendingRaw ?? '', normalizeUsage(obj.usage), isUsageDegraded(obj.usage)));
        break;
      // 未知 type:忽略(向前兼容 codex 新增事件)
    }
  }

  private onClose(code: number | null, signal: string | null): void {
    for (const l of this.splitter.flush()) this.handleLine(l); // 冲洗残行(无尾 \n 的最后 JSON)
    const stderrTail = redact(this.stderrRing.tail()); // CA10:进 detail 前脱敏
    if (this.gate.resumable && this.pendingRaw === undefined) {
      // F-c:闸门后崩溃。V3f:杀因优先用 terminationHint,否则真崩溃 CRASHED。
      const code2 = this.terminationHint ?? 'SUBPROCESS_CRASHED';
      this.emit(this.gate.onFailure(code2, `closed code=${code} signal=${signal}; stderr=${stderrTail}`));
    } else if (!this.gate.resumable) {
      // F-a/F-b:gate 内部归一为 SPAWN_FAILED(A2)
      this.emit(this.gate.onFailure('SUBPROCESS_SPAWN_FAILED', `exit code=${code}; stderr=${stderrTail}`));
    }
    this.finish();
  }
}

/**
 * 瘦生成器:只从 EventSink.queue 拉取(不挂监听),彻底消除「生成器惰性 → 首事件竞态」(A3)。
 * resume 预置:进流第一步补发合成 session_started(send 路径为 null,A9/§5.5)。
 */
async function* drainEventQueue(sink: EventSink): AsyncIterable<AgentEvent> {
  const primed = sink.gate.primeIfSeeded();
  if (primed) yield primed;

  while (true) {
    if (sink.queue.length > 0) {
      const ev = sink.queue.shift()!;
      sink.maybeResume(); // A6:队列回落,恢复 stdout 读取(背压)
      yield ev;
      continue;
    }
    if (sink.closed) return;
    await sink.waitNext(); // 等下一个事件 / close
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * §8.1. spawn 选项(Windows 干净路径,事实 A)+ stdin 喂入(EPIPE 兜底,A4)
 * ════════════════════════════════════════════════════════════════════════ */

/** 直调真实 exe(§4),绝不经 shell(否则 .cmd 打散参数,事实 A)。argv 先过泄密硬闸(A4)。 */
function spawnCodex(exePath: string, argv: string[], env: Record<string, string>, cwd: string): ChildProcess {
  assertArgvNoSecret(argv); // A4:最后一道泄密闸,命中即抛(不 spawn)
  return spawn(exePath, argv, {
    cwd, // 仅作进程 cwd;codex 工作目录由 -C(exec)定,resume 继承
    env, // A5:buildChildEnv 产物,extendEnv:false(node spawn 传 env 即不继承 process.env)
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true, // 事实 A.3 实测选项
    shell: false, // ★绝不 shell:裸名/.cmd 都被禁(事实 A),直调 exe
    // A5:POSIX 建独立进程组,让 treeKill 对 -pid 杀整组;Windows 用 taskkill /T 不需要
    detached: process.platform !== 'win32',
  });
}

/** 把 prompt 写进 stdin 并关闭(事实 A.3:write 后 end)。挂 error 兜底 EPIPE(A4)。 */
function feedPromptStdin(child: ChildProcess, prompt: string, onStdinError: (e: Error) => void): void {
  const stdin = child.stdin!;
  stdin.on('error', (e: Error) => onStdinError(e)); // 进程已死时 write 抛异步 EPIPE,不挂 error 会崩 Node
  try {
    stdin.setDefaultEncoding('utf8');
    stdin.write(prompt);
    stdin.end(); // 必须 end,否则 codex 等 EOF 不返回(L3)
  } catch (e) {
    onStdinError(e as Error); // 同步抛(stream 已 destroyed)也走同一兜底
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * §10. cancel() 与进程树 kill(shim 背后真子进程)
 * ════════════════════════════════════════════════════════════════════════ */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 杀进程树。Windows 用 taskkill /T /F(按 PID 杀整棵);POSIX 用进程组负 PID 信号。
 * @param reasonCode 写入 sink.terminationHint,供 onClose 在闸门后分支 emit 对应 code(V3f)。
 * @param sink 可选:cancel/超时路径必传,记 reasonCode;真崩溃路径不传(默认 CRASHED)。
 */
export async function treeKill(
  child: ChildProcess,
  reasonCode: 'SUBPROCESS_CANCELLED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CRASHED' = 'SUBPROCESS_CANCELLED',
  sink?: { terminationHint?: 'SUBPROCESS_CANCELLED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CRASHED' },
): Promise<void> {
  if (sink) sink.terminationHint = reasonCode; // ★V3f:onClose 闸门后分支读它,而非硬编码 CRASHED
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return; // 已退出:no-op(L5 幂等)

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false });
      tk.on('close', () => resolve());
      tk.on('error', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve();
      });
    });
  } else {
    // POSIX:spawn 时 detached:true 建独立进程组,这里对 -pid 发信号杀整组。【待实测 R-posix-kill】
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* 组可能已散 */
    }
    await delay(300); // 宽限期
    try {
      if (child.exitCode === null) process.kill(-pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  // 实际 emit 的 code 由 EventSink.onClose 依 gate 相位决定:闸门前→SPAWN_FAILED(A2);闸门后→terminationHint。
}

/* ════════════════════════════════════════════════════════════════════════
 * §8.2. CodexAdapter —— send / resume / cancel(组装 §4/§6/§7/§9/§10)
 * ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_HARD_TIMEOUT_MS = 10 * 60_000; // A10:引擎漏传 timeoutMs 时的兜底上限

/** 构造 codex 适配器。exe 路径在此解析(事实 A),失败即抛 SUBPROCESS_SPAWN_FAILED。 */
export function createCodexAdapter(opts: CreateCodexAdapterOptions): AgentAdapter {
  const exePath = resolveCodexExe(opts.exePath); // 构造期解析 + 缓存,失败提前抛
  return new CodexAdapter(exePath, opts.provider, opts.keystore, opts.hardTimeoutCeilingMs ?? DEFAULT_HARD_TIMEOUT_MS);
}

class CodexAdapter implements AgentAdapter {
  readonly id: AgentId = 'codex';
  private current?: ChildProcess; // 当前进行中的进程(cancel 用);A8 单进程在飞
  private currentSink?: EventSink; // V3f:cancel/超时把 terminationHint 写它

  constructor(
    private readonly exePath: string,
    private readonly provider: ProviderConfig,
    private readonly keystore: KeyStore, // ★V3b:构造期注入,run 时传 toCodexInjection 解析 key
    private readonly hardTimeoutCeilingMs: number,
  ) {}

  send(input: AgentInput): AsyncIterable<AgentEvent> {
    return this.run(input, undefined); // gate 不预置,首轮抓 thread.started
  }

  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> {
    return this.run(input, sessionId); // gate 预置 sessionId(A9)
  }

  async cancel(): Promise<void> {
    if (!this.current) return; // 幂等 no-op(L5)
    await treeKill(this.current, 'SUBPROCESS_CANCELLED', this.currentSink); // 杀进程树 + 记 hint(V3f)
    // 被 cancel 的流由 EventSink.onClose 依 gate 相位 + terminationHint emit CANCELLED/SPAWN_FAILED 收尾
  }

  /** @deprecated 别名,语义同 cancel()。 */
  async kill(): Promise<void> {
    return this.cancel();
  }

  /**
   * send/resume 共享运行骨架:落 schema → 拼 argv(含 07 cArgs)→ spawn → 同步挂 sink(A3)→ 喂 stdin → 拉流。
   * @param sessionId 非 undefined = resume(预置 gate,A9);undefined = send 首轮。
   */
  private async *run(input: AgentInput, sessionId: string | undefined): AsyncIterable<AgentEvent> {
    // A8:同一 adapter 不得并发 run。引擎保证串行;违约即 bug,抛而非静默排队。
    if (this.current) {
      throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'CodexAdapter 已有进程在飞,禁止并发 run(A8)');
    }

    // 1. output-schema 落临时文件(§9)
    const { path: schemaFile, cleanup } = await writeSchemaFile(input.outputSchema);

    // 2. provider 注入(07 §5.2 三参,V3a):一步算出 cArgs(含 env_key 行,非密)+ env(唯一含 key)。
    //    merge 在 toCodexInjection 内部做(adapter 不再自己 mergeProviderOverrides);keystore 来自构造期。
    let cArgs: readonly string[];
    let providerKeyEnv: Record<string, string>;
    try {
      const inj = toCodexInjection(this.provider, this.keystore, input.providerOverrides);
      cArgs = inj.cArgs;
      providerKeyEnv = inj.env;
    } catch (e) {
      cleanup(); // key 解析失败 → 闸门前失败,不伪造 session_started(A2)
      const code = e instanceof SyluxError ? e.code : 'PROVIDER_CONFIG_INVALID';
      yield { kind: 'error', code, detail: String((e as Error).message) };
      return;
    }

    const argv =
      sessionId === undefined
        ? buildExecArgs(input, schemaFile, cArgs) // §6.1
        : buildResumeArgs(sessionId, input, schemaFile, cArgs); // §6.2
    // A1/A5:env 单一出口,08 §2.2 单对象签名。providerEnv 与 07 注入的 key env 并集(都属 secret 通路 S1)。
    const env = buildChildEnv({ providerEnv: { ...input.providerEnv, ...providerKeyEnv }, agentId: this.id });

    // 3. spawn(A3/A4)
    let child: ChildProcess;
    try {
      child = spawnCodex(this.exePath, argv, env, input.workdir); // assertArgvNoSecret 在内(A4)
    } catch (e) {
      cleanup();
      const code = e instanceof SyluxError ? e.code : 'SUBPROCESS_SPAWN_FAILED';
      yield { kind: 'error', code, detail: String((e as Error).message) }; // 闸门前失败,不伪造 session_started(A2)
      return;
    }
    this.current = child;
    const gate = new FirstEventGate(sessionId); // resume 预置(A9);send 为空构造

    // 4. ★A3:spawn 后立刻同步挂 sink(挂 stdout/stderr/error/close),先于喂 stdin,避免漏 thread.started
    const sink = new EventSink(child, gate);
    this.currentSink = sink;

    // 5. 兜底硬超时(A10):input.timeoutMs 优先,缺省取构造期 ceiling;到点 treeKill 记 TIMEOUT(V3f)。
    const effectiveTimeout = input.timeoutMs ?? this.hardTimeoutCeilingMs;
    const timer =
      effectiveTimeout > 0 ? setTimeout(() => void treeKill(child, 'SUBPROCESS_TIMEOUT', sink), effectiveTimeout) : undefined;

    // 6. 喂 prompt(stdin EPIPE 兜底转 gate,A4),再拉事件流(§7.3)
    feedPromptStdin(child, input.prompt, (e) => sink.failFromStdin(`stdin error: ${e.message}`));
    try {
      for await (const ev of drainEventQueue(sink)) yield ev;
    } finally {
      if (timer) clearTimeout(timer);
      cleanup(); // §9:schema 临时文件清理(成功/失败/cancel 都清,L2)
      if (this.current === child) {
        this.current = undefined;
        this.currentSink = undefined;
      }
    }
  }
}




