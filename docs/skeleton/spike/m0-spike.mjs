/**
 * m0-spike.mjs —— M0 双 CLI 物理链路连通性 spike(可直接 node 跑)
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 目的                                                                       ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * 证明 sylux 中枢能用「事实地基(docs/PROBED-FACTS.md)」里的唯一干净姿势,
 * 真起 codex 与 claude 两个 CLI 子进程各问一句、各拿回一句答案,并把两边答案
 * 按黑板协议(02 §5 `messageSchema`)的 Message 结构打印出来 —— 即「双 CLI 物理
 * 链路通」的最小证据。这是 24-m0-gate.md 的 EP-8/EP-12/EP-13 + 事实地基 A/B 的
 * 一次性手验脚手架,不是产品代码。
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 怎么跑                                                                     ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 *   node G:/sylux/docs/skeleton/spike/m0-spike.mjs
 *
 *   可选环境变量(覆盖默认):
 *     SYLUX_CODEX_EXE   覆盖 codex 真 exe 绝对路径(默认见 CODEX_EXE_DEFAULT)
 *     SYLUX_CLAUDE_EXE  覆盖 claude 真 exe 绝对路径(默认见 CLAUDE_EXE_DEFAULT)
 *     SYLUX_WORKDIR     子进程工作目录(默认 G:/sylux)
 *     SYLUX_ONLY        只跑某一端:'codex' | 'claude'(默认两端都跑)
 *     SYLUX_TIMEOUT_MS  单端硬超时毫秒(默认 180000)
 *
 *   纯 Node,零 npm 依赖(不 import zod / 不读 @sylux/*),拷出去也能跑。
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 预期输出(正常路径)                                                       ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 *   [codex] spawn ... → 解析到 thread.started.thread_id=019ee3...
 *   [claude] spawn ... → 解析到 session_id=...
 *   两个 ===== MESSAGE ===== 块,各打印一条 Message 结构(from/role/kind/body/
 *   usage/sessionId),body 是各自模型对那句问题的回答文本。
 *   末尾 ===== SPIKE RESULT ===== 打印 { codex:'ok', claude:'ok' } 与累计 usage。
 *   进程退出码:两端都成功 = 0;任一端失败 = 1。
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 已知限制 / 注意                                                            ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 *  - ⚠ 会真实消耗中转 token:两端各打一次真 provider(codex 走 mouubox,事实地基 D
 *    基线 ≈18.7k input/回合;claude 走其 provider,缓存折价更低)。别反复盲跑。
 *  - 这里把 agent 回答塞进一条**演示用** Message:真实链路里 agent 只产出
 *    agentMessagePayloadSchema 子集(02 §6),id/runId/round/seq/ts 由中枢 append
 *    时盖章(I7),且必过 messageSchema.safeParse;本 spike 为了零依赖**不做**
 *    zod 校验,只按字段形状手工拼装 + 标 TODO,证链路不证契约。
 *  - 事实地基 A:绝不经 shell `>` 重定向(会把 UTF-8 转 UTF-16 乱码),一律 Node
 *    spawn 直捕 stdout;prompt 一律走 stdin,argv 用 '-'(codex)/ 无位置参(claude)。
 *  - 事实地基 A:不裸 spawn `codex` / 不经 .cmd 传带空格 prompt —— 直调真 exe。
 *  - claude 端事件/结果字段形以本机 2.1.x 实测为准;若 `--output-format json` 的
 *    字段名漂移(result/session_id/usage 结构变化),按实际调 parseClaudeJson()。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// 0. 常量:真 exe 路径(事实地基 A;不依赖 PATH shim)
// ════════════════════════════════════════════════════════════════════════════

/** codex 真 exe(事实地基 A:平台包 vendor bin,非 PATH 上的 bash shim)。 */
const CODEX_EXE_DEFAULT =
  'G:/npm-global/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';

/** claude 真 exe(本机实测:claude.cmd → bin/claude.exe;同样直调真 exe 避开 shim 坑)。 */
const CLAUDE_EXE_DEFAULT =
  'G:/npm-global/node_modules/@anthropic-ai/claude-code/bin/claude.exe';

const CODEX_EXE = process.env.SYLUX_CODEX_EXE || CODEX_EXE_DEFAULT;
const CLAUDE_EXE = process.env.SYLUX_CLAUDE_EXE || CLAUDE_EXE_DEFAULT;
const WORKDIR = process.env.SYLUX_WORKDIR || 'G:/sylux';
const TIMEOUT_MS = Number(process.env.SYLUX_TIMEOUT_MS || 180_000);
const ONLY = process.env.SYLUX_ONLY; // 'codex' | 'claude' | undefined

/** 两端各问一句(最小、答案短,省 token)。 */
const CODEX_PROMPT =
  'You are a connectivity probe. Reply with exactly one short sentence confirming you are the codex CLI and you received this message. No code, no markdown.';
const CLAUDE_PROMPT =
  'You are a connectivity probe. Reply with exactly one short sentence confirming you are the claude CLI and you received this message. No code, no markdown.';

// ════════════════════════════════════════════════════════════════════════════
// 1. spawn 真 exe 的最小封装(事实地基 A / 24-m0-gate §5.1 唯一干净姿势)
//    - 直调真 exe,不经 shell、不碰 PATH shim
//    - prompt 走 stdin(argv 不含 prompt 正文,A3/A4)
//    - stdout/stderr 一律按 UTF-8 直捕(不经 `>` 重定向,无 UTF-16 坑)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} exe 真 exe 绝对路径
 * @param {string[]} args argv(prompt 不在此;用 '-' 占位或无位置参)
 * @param {string} stdin 走标准输入的 prompt 正文
 * @param {{timeoutMs?: number, cwd?: string}} [opts]
 * @returns {Promise<{code:number|null, signal:string|null, out:string, err:string, spawnError?:string}>}
 */
function runExe(exe, args, stdin, opts = {}) {
  const { timeoutMs = TIMEOUT_MS, cwd = WORKDIR } = opts;
  return new Promise((resolve) => {
    // windowsHide:true 避免弹控制台;shell:false(默认)杜绝 .cmd %* 打散(事实地基 A2)。
    const child = spawn(exe, args, { windowsHide: true, cwd });
    let out = '';
    let err = '';
    let settled = false;
    let spawnError;

    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));

    // 硬超时:到点杀进程树并以 timeout 收尾(真实适配器是 treeKill + SUBPROCESS_TIMEOUT)。
    const timer = setTimeout(() => {
      if (settled) return;
      spawnError = `timeout after ${timeoutMs}ms`;
      try {
        child.kill('SIGKILL'); // TODO(adapter): Windows 下应 taskkill /T 杀整棵进程树
      } catch {
        /* no-op */
      }
    }, timeoutMs);

    child.on('error', (e) => {
      // spawn 本身失败(exe 不存在 / 非 Win32 / 权限):事实地基 A 的 ENOENT/Win32 坑落点。
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, signal: null, out, err, spawnError: String(e?.message || e) });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, out, err, spawnError });
    });

    // prompt 走 stdin 后立刻 end —— exec/headless 才会开始干活。
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. JSONL 行解析(codex --json 事件流;每行一个 JSON 对象)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 把 codex stdout 切成 JSONL 事件数组。容忍空行 / 残行(skip 不抛,真实 adapter 会
 * 对残行做 buffer 拼接,这里 spike 一次性收完再切,简单跳过非法行)。
 * @param {string} stdout
 * @returns {object[]}
 */
function parseJsonlEvents(stdout) {
  /** @type {object[]} */
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      // 残行 / 非 JSON 输出(如启动 banner):spike 直接跳过。
      // TODO(adapter): 真实 codex-adapter 用增量行缓冲 + MAX_JSONL_LINE_BYTES 守卫。
    }
  }
  return events;
}

/**
 * 从 codex 事件流抽取链路连通所需信息(事实地基 B 的 4 类事件,顺序固定)。
 *   thread.started → thread_id(首行即出,A1/I5 的 sessionId 来源)
 *   item.completed.item(type:'agent_message') → text(最终消息文本)
 *   turn.completed.usage → token 用量(事实地基 D,直接取,不本地估)
 * @param {object[]} events
 * @returns {{sessionId?:string, text?:string, usage?:object, errorDetail?:string}}
 */
function extractCodexResult(events) {
  let sessionId;
  let text;
  let usage;
  let errorDetail;
  for (const ev of events) {
    switch (ev?.type) {
      case 'thread.started':
        sessionId = ev.thread_id; // 事实地基 B:不是旧版 session_meta.payload.id
        break;
      case 'item.completed':
        if (ev.item?.type === 'agent_message' && typeof ev.item?.text === 'string') {
          text = ev.item.text; // 最终消息;若用 -o 文件则另有纯文本副本
        }
        break;
      case 'turn.completed':
        if (ev.usage) usage = normalizeUsage(ev.usage); // codex 字段是 input_tokens 等下划线
        break;
      case 'error':
      case 'turn.failed':
        errorDetail = JSON.stringify(ev);
        break;
      default:
        break; // turn.started / item.started 等不关心
    }
  }
  return { sessionId, text, usage, errorDetail };
}

/**
 * 把 codex turn.completed.usage(下划线命名)归一到 02 tokenUsageSchema 的驼峰字段。
 * @param {Record<string, unknown>} u
 * @returns {{inputTokens:number, cachedInputTokens:number, outputTokens:number, reasoningOutputTokens:number}}
 */
function normalizeUsage(u) {
  return {
    inputTokens: Number(u.input_tokens ?? u.inputTokens ?? 0),
    cachedInputTokens: Number(u.cached_input_tokens ?? u.cachedInputTokens ?? 0),
    outputTokens: Number(u.output_tokens ?? u.outputTokens ?? 0),
    reasoningOutputTokens: Number(u.reasoning_output_tokens ?? u.reasoningOutputTokens ?? 0),
  };
}

/**
 * 解析 claude `-p --output-format json` 的单对象结果(非 JSONL,整段一个 JSON)。
 * 字段形以本机 claude-code 实测为准;常见形态:
 *   { type:'result', subtype:'success', result:'<答案文本>',
 *     session_id:'...', usage:{ input_tokens, output_tokens, cache_read_input_tokens, ... } }
 * @param {string} stdout
 * @returns {{sessionId?:string, text?:string, usage?:object, errorDetail?:string}}
 */
function parseClaudeJson(stdout) {
  const s = stdout.trim();
  if (!s) return { errorDetail: 'empty stdout' };
  let obj;
  try {
    obj = JSON.parse(s);
  } catch (e) {
    // 兜底:claude 偶发在 json 前后夹杂行 → 抠出第一个 {...} 块再试。
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return { errorDetail: `claude json parse failed: ${String(e?.message || e)}` };
      }
    } else {
      return { errorDetail: `claude json parse failed: ${String(e?.message || e)}` };
    }
  }
  // result 字段是最终答案文本;is_error / subtype:'error' 表失败。
  const text = typeof obj.result === 'string' ? obj.result : undefined;
  const sessionId = obj.session_id || obj.sessionId;
  const usage = obj.usage
    ? {
        inputTokens: Number(obj.usage.input_tokens ?? 0),
        cachedInputTokens: Number(
          obj.usage.cache_read_input_tokens ?? obj.usage.cached_input_tokens ?? 0,
        ),
        outputTokens: Number(obj.usage.output_tokens ?? 0),
        reasoningOutputTokens: Number(obj.usage.reasoning_output_tokens ?? 0),
      }
    : undefined;
  const errorDetail =
    obj.is_error || obj.subtype === 'error' ? JSON.stringify(obj).slice(0, 1024) : undefined;
  return { sessionId, text, usage, errorDetail };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 演示用 Message 拼装(形状对齐 02 §5 messageSchema;spike 不做 zod 校验)
//    真实链路:agent 只产 agentMessagePayloadSchema 子集,中枢 append 盖章 +
//    messageSchema.safeParse。这里为零依赖手工拼,仅证「答案能落进 Message 形状」。
// ════════════════════════════════════════════════════════════════════════════

let SEQ = 0; // 中枢单调序号(I6);spike 内自增模拟 append 顺序

/**
 * @param {'codex'|'claude'} from
 * @param {string} body agent 回答文本
 * @param {{sessionId?:string, usage?:object}} meta
 * @returns {object}  形状同 02 messageSchema 的演示对象(未经 zod 校验)
 */
function buildDemoMessage(from, body, meta) {
  return {
    // ── 以下 7 字段真实链路由中枢 append 时盖章(I7),agent 不产出;spike 这里填占位 ──
    id: `spike_${from}_${Date.now()}`, // TODO(orchestrator): nanoid()
    runId: 'm0-spike-run', // TODO: 真 runId
    round: 0,
    seq: SEQ++,
    ts: Date.now(),
    from, // 物理身份(agentIdSchema 子集)
    role: 'peer', // spike 用 peer;真实由 playbook 指派(planner/worker/critic…)
    // ── 以下是 agent 经 output-schema 真正产出的子集(agentMessagePayloadSchema)──
    kind: 'propose', // 连通性回答按 propose 演示;真实由角色/轮次定
    body, // 模型回答文本
    files: [], // 本 spike 无文件改动
    evidence: [], // ⚠ 真实里 critic/critique 必须非空且 ≥1 强证据(C1);连通 spike 留空
    // inReplyTo 省略(无上游)
    // ── spike 附加的链路诊断旁注(非 02 字段,仅 demo 打印用)──
    _spikeMeta: { sessionId: meta.sessionId, usage: meta.usage },
  };
}

/** 打印一条 Message(连通性演示格式)。 */
function printMessage(msg) {
  const u = msg._spikeMeta?.usage;
  console.log('\n===== MESSAGE =====');
  console.log(`from        : ${msg.from}`);
  console.log(`role/kind   : ${msg.role} / ${msg.kind}`);
  console.log(`seq/round   : ${msg.seq} / ${msg.round}`);
  console.log(`sessionId   : ${msg._spikeMeta?.sessionId ?? '(none)'}`);
  console.log(`usage       : ${u ? JSON.stringify(u) : '(none)'}`);
  console.log(`body        : ${msg.body}`);
  console.log('===================');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 两端驱动(各自吃掉启动方式 / 参数 / 解析的不对称,事实地基 A/B/E/F)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 起 codex 问一句。事实地基 A/B/C:
 *   exec --json(JSONL 事件流) + prompt 走 stdin('-' 占位) + -s read-only(只读最安全)
 *   --skip-git-repo-check(WORKDIR 非信任 git 目录时需要,事实地基 E)
 * @returns {Promise<{ok:boolean, message?:object, detail?:string, usage?:object}>}
 */
async function driveCodex() {
  if (!existsSync(CODEX_EXE)) {
    return { ok: false, detail: `codex exe not found: ${CODEX_EXE}` };
  }
  // argv:prompt 用 '-' 占位走 stdin(A3);只读沙箱(自动化封顶,R8/08 S6);跳信任检查(事实地基 E)。
  const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-'];
  console.log(`[codex] spawn ${CODEX_EXE}\n        args=${JSON.stringify(args)}`);
  const r = await runExe(CODEX_EXE, args, CODEX_PROMPT);

  if (r.spawnError) return { ok: false, detail: `spawn/timeout: ${r.spawnError}` };
  const events = parseJsonlEvents(r.out);
  const { sessionId, text, usage, errorDetail } = extractCodexResult(events);

  if (sessionId) console.log(`[codex] thread.started thread_id=${sessionId}`);
  if (errorDetail) return { ok: false, detail: `codex error event: ${errorDetail}`, usage };
  if (r.code !== 0)
    return { ok: false, detail: `codex exit=${r.code} stderr=${r.err.slice(0, 512)}`, usage };
  if (!text) return { ok: false, detail: 'codex: no agent_message text parsed', usage };

  const message = buildDemoMessage('codex', text.trim(), { sessionId, usage });
  return { ok: true, message, usage };
}

/**
 * 起 claude 问一句。事实地基 F:
 *   -p(headless) + --output-format json(单对象结果) + prompt 走 stdin
 *   --permission-mode plan(只读档,不落盘;对齐 24 G3 的只读意图) + --no-session-persistence
 * @returns {Promise<{ok:boolean, message?:object, detail?:string, usage?:object}>}
 */
async function driveClaude() {
  if (!existsSync(CLAUDE_EXE)) {
    return { ok: false, detail: `claude exe not found: ${CLAUDE_EXE}` };
  }
  // -p headless;json 单对象;只读权限档;不落 session(spike 一次性,A7 ephemeral)。
  // prompt 走 stdin —— 避开 Windows 命令行带空格/长度/转义坑(事实地基 A/F)。
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'plan'];
  console.log(`[claude] spawn ${CLAUDE_EXE}\n         args=${JSON.stringify(args)}`);
  const r = await runExe(CLAUDE_EXE, args, CLAUDE_PROMPT);

  if (r.spawnError) return { ok: false, detail: `spawn/timeout: ${r.spawnError}` };
  const { sessionId, text, usage, errorDetail } = parseClaudeJson(r.out);

  if (sessionId) console.log(`[claude] session_id=${sessionId}`);
  if (errorDetail) return { ok: false, detail: `claude error: ${errorDetail}`, usage };
  if (r.code !== 0)
    return { ok: false, detail: `claude exit=${r.code} stderr=${r.err.slice(0, 512)}`, usage };
  if (!text) return { ok: false, detail: 'claude: no result text parsed', usage };

  const message = buildDemoMessage('claude', text.trim(), { sessionId, usage });
  return { ok: true, message, usage };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. main —— 跑两端、打印 Message、汇总放行/阻断
// ════════════════════════════════════════════════════════════════════════════

/** 累加两端 usage(事实地基 D:全 run 求和,成本对轮数累积)。 */
function sumUsage(a, b) {
  const acc = a || { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
  if (!b) return acc;
  return {
    inputTokens: acc.inputTokens + b.inputTokens,
    cachedInputTokens: acc.cachedInputTokens + b.cachedInputTokens,
    outputTokens: acc.outputTokens + b.outputTokens,
    reasoningOutputTokens: acc.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

async function main() {
  console.log('===== sylux M0 spike: 双 CLI 物理链路连通性 =====');
  console.log(`workdir     : ${WORKDIR}`);
  console.log(`timeout     : ${TIMEOUT_MS}ms`);
  console.log(`only        : ${ONLY ?? '(both)'}`);
  console.log('⚠ 本 spike 会真实消耗中转 token(codex 基线 ≈18.7k input/回合)。\n');

  const result = { codex: 'skipped', claude: 'skipped' };
  let totalUsage;

  if (ONLY !== 'claude') {
    const c = await driveCodex();
    if (c.ok) {
      result.codex = 'ok';
      printMessage(c.message);
    } else {
      result.codex = 'fail';
      console.error(`\n[codex] FAIL: ${c.detail}`);
    }
    totalUsage = sumUsage(totalUsage, c.usage);
  }

  if (ONLY !== 'codex') {
    const c = await driveClaude();
    if (c.ok) {
      result.claude = 'ok';
      printMessage(c.message);
    } else {
      result.claude = 'fail';
      console.error(`\n[claude] FAIL: ${c.detail}`);
    }
    totalUsage = sumUsage(totalUsage, c.usage);
  }

  console.log('\n===== SPIKE RESULT =====');
  console.log(`result      : ${JSON.stringify(result)}`);
  console.log(`totalUsage  : ${totalUsage ? JSON.stringify(totalUsage) : '(none)'}`);

  // 放行判定:被跑到的两端都必须 ok(skipped 的端不参与判定)。
  const ran = Object.values(result).filter((v) => v !== 'skipped');
  const allOk = ran.length > 0 && ran.every((v) => v === 'ok');
  console.log(`verdict     : ${allOk ? 'LINK-UP ✅ (双 CLI 物理链路通)' : 'LINK-DOWN ✗'}`);
  console.log('========================');
  process.exitCode = allOk ? 0 : 1;
}

// 仅在被直接 `node m0-spike.mjs` 运行时才真起子进程;被 import 时不 spawn
// (便于零 token 单测下面的纯解析/拼装函数,24 §5.4「能 fake 验结构就不烧 token」)。
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { argv } from 'node:process';

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = argv[1] ? resolvePath(argv[1]) : '';
const isMain = thisFile === invokedFile;

if (isMain || process.env.SYLUX_FORCE_MAIN === '1') {
  main().catch((e) => {
    // 不吞错(总体规划 §11.3):顶层兜底打印后非零退出。
    console.error('\n[spike] FATAL:', e?.stack || e);
    process.exitCode = 1;
  });
}

// 导出纯函数,供 fake-CLI / 单测零 token 验证解析与拼装链路。
export {
  parseJsonlEvents,
  extractCodexResult,
  normalizeUsage,
  parseClaudeJson,
  buildDemoMessage,
};



