# 06 · claude 适配器 与 两端解析归一化(权威)v3

> **版本**:v3(2026-06-20)。相对 v2 的硬化点见 §0.6(CA13–CA17)。本批任务指定的五份具名红队/交叉报告中,`x-consistency.md` / `x-coverage.md` 在仓库 `docs/drafts/` 下**实际存在**(本轮已 Read 并逐条吃掉针对 06 的 findings:B1 / B2 / D13 / A1 错误码 / 编号双轨);`red-feasibility.md` / `red-security.md` / `red-ops-cost.md` 同样存在但针对 06 的直接条目少(成本不对称 ROC 在 04/16,本文件 §7.3 已给口径)。v2 曾误称「五份报告全部缺失」——v3 更正:报告存在,本轮据实复核。
>
> **本文件地位**:`@sylux/agents` 中 **claude 端**的精确 spawn / argv 拼装 / stream-json 解析 / 失败路径,以及**两端(codex+claude)统一解析归一化状态机**的权威设计。与 05(codex 端)对称;`AgentAdapter` / `AgentInput` 接口由 **05 拥有**,本文件**只实现、不重定义接口**。`toClaudeInjection` / `ProviderConfig` / `ProviderOverrides` / `KeyStore` 由 **07 拥有**,本文件**只消费**(v3 起按 07 §6.2 三参 `toClaudeInjection(cfg, keystore, ov?)` 与 `settingsFragment` 单次注入对齐)。
>
> **跨文档编号约定(读前必看)**:本稿沿用 02/05 同款**逻辑编号**引用兄弟文档(引擎 03、provider「07-provider-config」、worktree「09-isolation-worktree」、刹车「04-convergence-brakes」、安全「08-security-firewall」)。**v3 编号订正**:经 07 v2 §5 与 08 v2 §7 核对,**08 = 安全(密钥/内容防火墙,拥有 `buildChildEnv`/`redact`/`SECRET_SIGNATURES`)**,**09 = worktree 文件隔离**。本文件凡引用安全实现一律写 **08**(v2 个别处误写「安全 09」已在 v3 全文订正,见 §0.6 CA16)。统一收口由定稿处理。
>
> **类型一律引用 02**:`AgentEvent` / `TokenUsage` / `AgentMessagePayload` / `Message` / `agentMessagePayloadSchema` / `buildAgentOutputJsonSchema` / `SyluxErrorCode` / `MAX_JSONL_LINE_BYTES` 等全部 zod 类型与常量,以 `@sylux/shared`(权威源 `docs/drafts/02-blackboard-types.md` §5/§6/§12)引用,**本文件不另定义任何 zod、不重声明任何共享常量**(v2 曾重声明 `MAX_JSONL_LINE_BYTES`,B1,已删)。
>
> **接口/共享件引用 05 v2**:`AgentAdapter` / `AgentInput` / `ProviderOverrides` / `FirstEventGate`(闸门状态机)/ `LineSplitter` / `assertArgvNoSecret` / `treeKill` / `resolveCodexExe` 的对称物,以 `docs/drafts/05-adapter-codex.md` **v2**(权威)引用。**v2 关键对账**:05 v2 的 `FirstEventGate` 真实 API 是 `onThreadStarted(threadId)`/`primeIfSeeded()`/`onFinal(raw,usage)`/`onFailure(code,detail)`/`resumable`(构造期可注入 `seededSessionId`,A9),`LineSplitter` 已含 `MAX_JSONL_LINE_BYTES` 无界缓冲护栏(05 A6),spawn 已含 stdin EPIPE 吞噬(05 A4)、监听器同步挂载(05 A3)、单进程在飞断言(05 A9)、`hardTimeoutCeilingMs` 兜底(05 A10)。本文件 v1 曾擅自假设一套 `onSession/passthrough/isTerminal` 方法——**v2 改为复用 05 v2 真实 API**,只在 §6.4 提一个**向后兼容**的两端泛化回填提案(§12),不再凭空假设接口。
>
> **事实地基**:spawn(A)、claude flag(F)、token 计量(G)以 `docs/PROBED-FACTS.md` 为准。**本文件含 2026-06-20 对 claude-code 2.1.183 的本机实测增补**(见 §0.3),凡已实测项不再标【待实测】;事实 F 中若干旧假设被本轮实测**修正**,在 §0.3 显式列出。

### 0.6 v2/v3 相对前一版的硬化点(变更摘要)

下表 CA1–CA12 为 v2 相对 v1 的硬化(保留备查),**CA13–CA17 为 v3 相对 v2 的新增**(吃掉 x-consistency B1/B2、07 v2 §6.2/§1139 的 06 对账项、02 v2.1 错误码回填闭合、编号订正)。

| # | 主题 | v1 问题 | v2 修正 | 章节 |
|---|---|---|---|---|
| CA1 | **env 出口写错(安全 blocker)** | §9.1 `spawnClaude` 直接 `env: input.providerEnv` → 跳过 08 `buildChildEnv` 白名单与 `extendEnv:false`,base 变量缺失致 exe 起不来,且违反 S2 | 焊死 `env: buildChildEnv({ providerEnv, agentId:'claude' })`(08 §2.2 单对象签名,05 v2 §0.5 A1 同口径) | §9.1 |
| CA2 | `FirstEventGate` 接口凭空假设 | v1 §6.4 用 `onSession/passthrough/isTerminal`,05 v2 实无此法 | 改用 05 v2 真实 API(`onThreadStarted`/`primeIfSeeded`/`onFinal`/`onFailure`/`resumable`);claude session 触发复用 `onThreadStarted`,泛化为可选回填提案(§12) | §6.4 |
| CA3 | 无界缓冲(DoS,05 A6) | v1 `LineSplitter` 无单行上限;claude `assistant` 事件可极大 | 复用 05 v2 含 `MAX_JSONL_LINE_BYTES` 的 `LineSplitter`(v3:该常量 **import 自 02 §5.3=512KiB**,不重声明,见 CA13);stderr 环形缓冲末 N KiB;event queue 背压 | §6.2、§8.1 |
| CA4 | stdin EPIPE 未捕获(05 A4) | 进程已死时 `stdin.write` 抛异步 EPIPE → 未捕获崩 Node | `feedStdin` 挂 `stdin.on('error')` 吞 EPIPE → `gate.onFailure` | §9.1 |
| CA5 | 首事件竞态(05 A3) | 监听器在惰性 generator 体内挂,晚于 stdin 写入 → 可能丢首个 `system/init` | spawn 后**同步**挂 stdout/exit 监听 + 入 queue,再喂 stdin | §6.4、§9.3 |
| CA6 | 并发 run 无护栏(05 A9) | `current` 在飞时再 `send/resume` 行为未定义 | run 入口断言 `current==null` 否则抛(引擎 03 保证串行,违约即 bug) | §9.3 |
| CA7 | 工厂缺兜底超时(05 A10) | 引擎漏传 `timeoutMs` 时 claude 挂死永久阻塞 | `createClaudeAdapter` 增 `hardTimeoutCeilingMs?`,input 未给则取它 | §3.2、§9.3 |
| CA8 | 错误码已登记的错误声明 | v1 §12 称 CRASHED/CANCELLED 已在 02 §12 union | v2 更正为「需回填」;**v3 再更正**:02 **v2.1 §12 已完成回填**(`SUBPROCESS_CRASHED`/`TIMEOUT`/`CANCELLED`/`INJECTION_BLOCKED`/`ENGINE_FATAL` 等全在 union),本文件直接引用,依赖已闭合 | §12 |
| CA12 | ephemeral ⊥ resume 未声明 | v1 §3 push `--no-session-persistence` 但未说该会话不可 resume | 对齐 05 A7/A8:ephemeral 会话 `resumable` 恒 false,预设 `--session-id` 也不得被 resume | §3.1、§8.5 |
| **CA13** | **`MAX_JSONL_LINE_BYTES` 重声明(x-consistency B1,🔴blocker/I1 违规)** | v2 §6.2 `export const MAX_JSONL_LINE_BYTES = 1024*1024`(1 MiB)且注「05 v2 权威」——既数值冲突(02 权威 512KiB)又违 02 I1 单一权威 | **删本地声明,改 `import { MAX_JSONL_LINE_BYTES } from '@sylux/shared'`**(02 §5.3 权威 512KiB),与 05 同口径 | §6.2 |
| **CA14** | **createClaudeAdapter 缺 keystore + toClaudeInjection 签名(07 v2 §6.3/§1139 对账)** | v2 工厂 `{exePath?,provider,hardTimeoutCeilingMs?}` 无 `keystore`,adapter 无从 resolve key;v2 §9.1 用 `input.providerEnv` 当唯一 key 源,未调 `toClaudeInjection` | 工厂构造期收 `keystore: KeyStore`(对齐 05 V3b);`run` 时 `toClaudeInjection(provider, keystore, ov)` 算 `{flags, settingsFragment, env}`,merge 内置 07,adapter 不自 merge | §3.2、§9.1、§9.3 |
| **CA15** | **`--settings` 双写覆盖(07 v2 V4,🔴安全)** | v2 把 `--bare` 兜底的 hooks-disable `--settings` 与 provider `extraConfig` 的 `--settings` 各自直出 → 后者覆盖前者,provider effort 配置或 hooks 配置被整体吞掉 | v3 由 06 **唯一**拼装 `--settings`:`deep-merge(toClaudeInjection().settingsFragment, hooksDisableFragment)` 后**单次**注入(07 §6.2 V4);`flags` 不含 `--settings` | §3.1.2 |
| **CA16** | **编号「安全 09」误写(x-consistency C-NUM)** | v2 多处把内容防火墙/redact 标「安全 09」,但 09=worktree、08=安全(07 v2/08 v2 已订正) | v3 全文订正为 **08**(安全),涉及 §6.6 / §9.1 / §12 内容防火墙与 redact 归属 | 全文 |
| **CA17** | **超时码用 CANCELLED(对齐 05 V3f)** | v2 超时统一 emit `SUBPROCESS_CANCELLED`,与人工 abort 混淆 | v3 超时 emit 专用 `SUBPROCESS_TIMEOUT`(02 v2.1 §12 已登记),人工 cancel 才用 `SUBPROCESS_CANCELLED` | §8.1、§8.5、§9.3 |
| CA9 | schema 强制只考虑长度 | v1 §4 只处理命令行 32KB 上限,漏 02 H7「严格 structured-output 后端拒 anyOf/optional」 | §4.3 增 H7 分支:即便 inline 体积达标,strict 后端仍可能拒 → 回落 `append_prompt` 软约束 | §4.3、§4.5 |
| CA10 | 内容防火墙边界未声明 | v1 未说 claude `tool_use`/`tool_result`/delta 流喂面板或喂对面前的过滤归属 | §6.6 明确:最终 `raw`→Message→引擎 P3 `firewallPeerMessage`(08 §4);面板透传过 redact(**08**,v3 CA16 订正);适配器不自做防火墙但标清边界 | §6.6 |
| CA11 | `--bare` 单点依赖无兜底 | v1 焊死必带 `--bare`,但若该 flag 在某版本不存在则全链失败 | §3.1 增兜底:`--bare` 不可用时退化为 `--settings` 关 hooks + `SYLUX_DISABLE_*`,M0 硬门确认 flag 存在(§11 M0-8) | §3.1、§11 |

---

## 0. 设计目标、边界与实测增补

### 0.1 一句话职责

把 claude-code 这个**与 codex 形态高度不对称**的 CLI(headless `claude -p`、stream-json 双向流、`--json-schema` 收**内联串**、session_id 每事件回吐且可**预设**)封装进 05 定义的同一个 `AgentAdapter` 接口,并提供一个**两端共享的 line-delimited JSON → `AgentEvent` 归一化状态机**:让中枢 `for await (const ev of adapter.send(input))` 时,看到的事件流与 codex 端**逐字段同构**(首事件恒为 `session_started`,末事件为 `final_message` 或 `error`),完全感知不到两端底层差异。

### 0.2 本文件负责 / 不负责

| 负责(本文件给完整规格) | 不负责(引用别处) |
|---|---|
| claude 真实 exe 路径解析(实测修正,§2) | `AgentAdapter` / `AgentInput` 接口签名(05 §2/§3) |
| claude `send` / `resume` 两套 argv 拼装(事实 F,§3) | `AgentEvent` / `Message` / `TokenUsage` 类型(02 §6) |
| `--json-schema` 内联串命令行长度上限三级对策(§4) | `buildChildEnv` env 白名单**规则**(安全 08) |
| claude stream-json 事件信封解析(本机实测,§5) | 内容防火墙(喂对面前过滤,安全 08) |
| **两端统一归一化状态机**(line 解析 + 触发映射,§6) | engine `runTurn` 循环 / continuity 决策(引擎 03) |
| claude `usage` → `TokenUsage` 归一化 + 两端成本不对称(§7) | worktree 创建 / 合并(worktree,另文) |
| 超时 / 崩溃 / 部分输出 / `result.subtype` 错误分级(§8) | token 预算 / 刹车阈值(刹车 07,本文件只**采集** usage) |
| claude spawn shim 坑 + `--bare` 清场 + 进程树 kill(§9) | provider 配置模型 `ProviderConfig`(provider 文档) |

### 0.3 本机实测增补(2026-06-20,claude-code 2.1.183 @ Win11)——修正事实 F

下列为本轮对 `claude.exe` 直跑实测结论,**优先级高于事实 F 中的同名旧假设**(旧假设据 `--help` 推断,本轮据真实运行修正):

| 编号 | 实测结论 | 对事实 F 的修正 |
|---|---|---|
| **CF-1** | `claude` PATH shim 背后是 `.cmd`,`.cmd` 直接 `CALL` **真实 `claude.exe`**(`node_modules\@anthropic-ai\claude-code\bin\claude.exe`,~225MB 原生二进制),**不是** `.ps1` / `cli.js`。 | 修正事实 F「claude 端是 .ps1/.cmd shim」:落点是 `.cmd → .exe`,直调 exe 即可,无需 node 启动 cli.js。 |
| **CF-2** | 直调 `claude.exe` + prompt 走 **stdin** + `windowsHide` 实测 code=0,stdout 干净 UTF-8。裸名 / `.cmd` 传带空格 prompt 同样踩 codex 的 `%*` 打散坑(事实 A),**绝不**经 shim 传 prompt。 | 与 codex 同构:A3 不变量(直调真 exe + stdin)对 claude 同样成立。 |
| **CF-3** | **必须加 `--bare`**:默认会跑 `SessionStart` hooks、加载 `CLAUDE.md` / skills / auto-memory,导致 ① 首事件是 `system/hook_started` 噪声(非 `system/init`),② input_tokens 暴涨(实测 `46331` → 加 `--bare` 后 `1301`,**35× 噪声开销**),③ 用户全局 hook 的 stderr 乱码混入。`--bare` 后首事件恒为 `{"type":"system","subtype":"init"}`,环境纯净。 | 事实 F 未覆盖;**焊死:headless 适配器必带 `--bare`**(§3.2 / §9.1)。 |
| **CF-4** | stream-json **每个事件都带 `session_id`**(不像 codex 仅首行 `thread.started` 带 thread_id)。且 `--session-id <uuid>` 可**预设**会话 id(必须合法 UUID),即调用方 spawn 前就知道 id。 | 落实事实 F 末尾「`--session-id` 预设能力待确认」=**确认存在**。但归一化层仍以观测到的 `system/init.session_id` 为准 emit `session_started`(§6.4),不信预设值直至 init 到达(守 02 I5 / 05 A2)。 |
| **CF-5** | `result` 事件的 `usage` 形状与 codex 不同:`{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, ...}`,且**带 prompt 缓存**——resume 时历史走 `cache_read`(约 1/10 价),与 codex「每轮全量重计费」(事实 D)**成本模型不对称**(§7.3)。另有顶层 `total_cost_usd` 与 `modelUsage`(按模型拆;实测即便 `--model sonnet` 也会顺带计入 `haiku` 背景模型用量)。 | 事实 G(codex `turn.completed.usage`)的 claude 对应物 = `result.usage`;字段名 + 缓存语义不对称,归一化层负责对齐(§7)。 |
| **CF-6** | `result.subtype` ∈ `{success, error_max_turns, error_during_execution}`,带 `is_error` / `stop_reason` / `num_turns` / `terminal_reason` / `permission_denials`。`--max-turns N` 可封顶轮内工具循环次数。 | 事实 F 未覆盖错误分类;§8 据此建 claude 端失败分级。 |

### 0.4 接口层不变量(与 05 v2 A1–A9 对齐,claude 落地)

claude 适配器**完全服从** 05 v2 §0.3 的 A1–A9,本节只标 claude 落地差异:

- **A1 首事件恒为 session_started**:claude 侧 `sessionId` 映射自**首个 `system/init` 事件的 `session_id`**(`--bare` 保证 init 是首个 system 事件,CF-3)。**不**用预设 UUID 直接当已建立(CF-4)。落地复用 05 v2 `FirstEventGate.onThreadStarted(sessionId)`(语义即「session 闸门跃迁」,方法名沿用 codex 语,§6.4)。
- **A2 未拿到 id 不可 resume**:`system/init` 到达前进程崩溃 → 只 emit `error`,`resumable=false`(05 v2 §5;gate 在 `awaiting_thread` 相位 `onFailure` 结构上不可能先发 session_started)。
- **A3 直调真实 exe**:claude 永不经 PATH 裸名 / `.cmd` 启动 prompt(CF-2);prompt 走 stdin(`-p` + stdin)或 stream-json 输入(§4.4)。
- **A4 key 永不进 argv**:claude 不用 `-c`,但 `--settings`(JSON 串,07 §6.2)/ `--model` 等仍过 spawn 前 argv 泄密预扫描(`assertArgvNoSecret`,05 §6.4,**共用** 08 §2.4 `SECRET_SIGNATURES`);key 只走 `providerEnv`(`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`,07 §6.2 `toClaudeInjection().env`)。
- **A5 env 单一出口**:`buildChildEnv({ providerEnv, agentId:'claude' })`(08 §2.2 单对象签名)+ `extendEnv:false`(08 S2)。**焊死**:绝不把 `input.providerEnv` 直接当 spawn 的 `env`(v1 bug,CA1),必须经 `buildChildEnv` 包白名单 base 变量,否则 claude.exe 缺 `SystemRoot`/`PATH`/`USERPROFILE` 起不来。
- **A6 输出必过 safeParse**:适配器只吐 `final_message.raw` + `usage`,不在边界解析成 `Message`(05 A6);claude 的 `raw` 取自 `result.result`(§6.5)。
- **A7 ephemeral ⊥ resume**:`ephemeral:true`(`--no-session-persistence`)的会话**不可** resume——会话态没落盘(对齐 05 A7/A8)。适配器仍按观测到的 `system/init` 照常 emit `session_started`,但引擎须把该会话 `resumable` 强制为 false;预设的 `--session-id`(CF-4)在 ephemeral 下**只**用于日志关联,不得用于 `--resume`(§8.5)。
- **A8 单进程在飞 / 串行消费**:同一 adapter 任一时刻至多一个子进程在飞(`current`);引擎 03 保证串行,`current` 非空再 `send/resume` → 适配器**抛**(05 A9,§9.3)。

---

## 1. 物理落点(`@sylux/agents` 的 claude/ 与 共享 parse/)

```
packages/agents/
├─ src/
│  ├─ adapter.ts            # AgentAdapter/AgentInput 接口(05 拥有,本文件 import)
│  ├─ codex/                # 05 拥有
│  ├─ claude/
│  │  ├─ resolve-exe.ts     # ★ claude.exe 路径解析(CF-1,§2)
│  │  ├─ args.ts            # ★ send/resume 两套 argv 拼装 + --bare(事实 F,§3)
│  │  ├─ json-schema-arg.ts # ★ --json-schema 内联串体积测量 + 三级降级(§4)
│  │  ├─ map-events.ts      # ★ claude stream-json 行 → 中性 ParsedLine(§6.4)
│  │  ├─ usage.ts           # ★ result.usage → TokenUsage 归一化(§7)
│  │  └─ claude-adapter.ts  # ★ ClaudeAdapter 实现(send/resume/cancel,§8)
│  ├─ normalize/
│  │  ├─ ndjson.ts          # ★ 两端共享:line-delimited JSON 增量解析器(§6.2)
│  │  ├─ gate.ts            # FirstEventGate(05 §5.3 拥有;本文件引用,claude 触发=init)
│  │  └─ pipeline.ts        # ★ 两端共享:ParsedLine → AgentEvent 归一化管线(§6.3)
│  └─ proc/                 # build-env / argv-guard / tree-kill(05 拥有)
└─ fixtures/
   └─ fake-claude.mjs       # 吐固定 stream-json 的假 exe,冒烟测试用(§10)
```

> 依赖方向同 05:`@sylux/agents` 依赖 `@sylux/shared`(02 类型 + 校验)与 `@sylux/providers`(`ProviderConfig`),不依赖 `@sylux/core`(引擎),避免环。`normalize/gate.ts` 的 `FirstEventGate` 类**单一定义在 05 §5.3**,本文件复用同一类、只配置 claude 触发条件(§6.4),不另写一份(守 02 I1 / 05 单一权威)。

---

## 2. claude 真实 exe 路径解析(CF-1,与 05 §4 对称)

实测 CF-1:PATH 上的 `claude`(无扩展名)是 sh shim,`claude.cmd` 内部 `CALL` 的是 `node_modules\@anthropic-ai\claude-code\bin\claude.exe`(原生 PE,~225MB),**不是** `cli.js`。所以解析逻辑比 codex 简单——claude 把 exe 放在主包 `bin/` 下、不分平台子包,但仍**绝不依赖 PATH 裸名**(踩 codex 同款 shim 坑,CF-2)。

### 2.1 本机实测路径

```
G:\npm-global\node_modules\@anthropic-ai\claude-code\bin\claude.exe
```

### 2.2 解析算法

```ts
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { SyluxError } from '@sylux/shared';

/** 平台 → claude.exe 文件名(主包 bin/ 下,不分 vendor 子包,CF-1)。 */
const CLAUDE_BIN: Record<string, string> = {
  win32: 'claude.exe',  // ★实测
  linux: 'claude',      // 【待实测】posix 安装形态
  darwin: 'claude',     // 【待实测】
};

/**
 * 解析 claude 真实 exe 绝对路径。优先级:
 *   1. 显式 exePath(createClaudeAdapter 传入)
 *   2. SYLUX_CLAUDE_EXE 环境变量(运维逃生口)
 *   3. 从 @anthropic-ai/claude-code 主包 bin/ 取
 *   4. 扫描已知 npm 全局根
 * 全部落空 → 抛 SUBPROCESS_SPAWN_FAILED(detail 列已探测路径)。
 */
export function resolveClaudeExe(explicit?: string): string {
  const bin = CLAUDE_BIN[process.platform];
  const tried: string[] = [];
  const check = (p: string): string | null => { tried.push(p); return existsSync(p) ? p : null; };

  if (explicit) { const r = check(explicit); if (r) return r; }
  if (process.env.SYLUX_CLAUDE_EXE) { const r = check(process.env.SYLUX_CLAUDE_EXE); if (r) return r; }
  if (!bin) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `不支持的平台 ${process.platform}`);

  for (const root of candidateNodeRoots()) {
    const r = check(join(root, '@anthropic-ai', 'claude-code', 'bin', bin));
    if (r) return r;
  }
  throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `claude.exe 未找到`, { tried });
}

/** 候选 node_modules 根:与 05 §4.2 candidateNodeRoots 同款(npm prefix / NODE_PATH / cwd 上溯)。 */
function candidateNodeRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.SYLUX_NPM_GLOBAL_ROOT) roots.add(process.env.SYLUX_NPM_GLOBAL_ROOT);
  for (const p of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)) roots.add(p);
  return [...roots];
}
```

> 与 05 一致:`resolveClaudeExe` 在 `createClaudeAdapter` **构造期**调一次并缓存,spawn 期不再探测(失败提前暴露)。`require.resolve('@anthropic-ai/claude-code/package.json')` 作辅助(中枢未必把 claude 装进自己依赖,故文件系统探测为主)。

---

## 3. argv 拼装:send / resume 两套(事实 F + 实测)

claude 与 codex 的 argv 差异极大:claude 用长 flag、`--bare` 清场、`--session-id` 预设、`--permission-mode` 控沙箱、schema 走**内联串**。本节给两套权威 argv;`prompt` **永远走 stdin**(CF-2),argv 里**不出现** prompt。

### 3.1 共享基线 flag(send / resume 都带)

```ts
/** send/resume 共用的 claude headless 基线 argv(不含 prompt,prompt 走 stdin)。 */
function baseClaudeArgs(input: AgentInput): string[] {
  const args: string[] = [
    '-p',                                  // headless 打印即退(事实 F)
    '--output-format', 'stream-json',      // 事件流(事实 F)
    '--verbose',                           // stream-json 下必带,否则不逐事件吐(实测:无 --verbose 退化为单 result)
    '--input-format', 'text',              // 默认 text(prompt 走 stdin);超长 schema 时切 stream-json(§4.4)
    '--permission-mode', mapPermissionMode(input.sandbox),  // 沙箱映射(§3.3)
    '--max-turns', String(input.maxTurns ?? DEFAULT_MAX_TURNS),  // 封顶轮内工具循环(CF-6)
  ];
  if (BARE_FLAG_AVAILABLE) args.push('--bare');  // ★CF-3:关 hooks/CLAUDE.md/skills/auto-memory,首事件=system/init,省 35× 噪声;未命中走 §3.1.2 hooks-disable 兜底
  if (input.ephemeral) args.push('--no-session-persistence');  // 事实 F:对应 codex --ephemeral;⚠ 该会话不可 resume(A7,§8.5)
  // ★v3:--model / --fallback-model 不在此 push,改由 toClaudeInjection().flags 统一产出(§3.2/§3.3 push ...inj.flags),
  //   避免与 provider 注入双写。model 的权威来源是 07(provider 绑定 + ov 覆盖,merge 内置 07 §6.2)。
  if (input.effort) args.push('--effort', input.effort);       // low|medium|high|xhigh|max(事实 F)
  // 角色/协议系统提示:claude 有原生 --append-system-prompt(codex 无等价,事实 F)
  if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt);
  // worktree:claude 用 --add-dir 放行(不像 codex 的 -C 切 cwd;claude cwd 由 spawn 的 cwd 定)
  args.push('--add-dir', input.workdir);
  return args;
}

const DEFAULT_MAX_TURNS = 32;  // 单次调用内工具循环上限;由 playbook 可覆盖
```

#### 3.1.1 `--bare` 兜底(CA11:单点依赖硬化)

CF-3 焊死「headless 必带 `--bare`」省 35× 噪声。但 `--bare` 是单点依赖:若某 claude 版本不支持该 flag,spawn 会因 `unknown option` 在 `system/init` 前退出(走 CL-b,不可 resume)。兜底:

- **首选**:`--bare`(本机 2.1.183 实测存在,CF-3)。
- **兜底(M0 探测 `--bare` 不在 `--help` 时启用)**:不传 `--bare`,改 `--settings '{"hooks":{},"disableAllHooks":true}'`(关 SessionStart hooks)+ env `SYLUX_DISABLE_AUTOMEMORY=1` 之类(若 claude 暴露),并在归一化层**显式跳过** `system/init` 之前的所有 `system/subtype:"hook_*"` 事件(§6.4.1 mapper 已默认 `ignore` 这些,防御性已就位)。
- **M0 硬门**(§11 M0-8):开工前 `claude --help | grep -- --bare` 必须命中;命中则焊死必带,未命中则启用兜底并回填本节。

> 决策:`--bare` 命中是**首选且强烈推荐**(干净 + 省 token);兜底仅防版本漂移,不是常态。归一化层对 `hook_*` 噪声的 `ignore` 处置(§6.4.1)无论走哪条都成立,是双保险。
>
> **`BARE_FLAG_AVAILABLE` 常量来源**:M0-8(§11)开工前探测 `claude --help` 是否含 `--bare`,结果固化为模块级 `const BARE_FLAG_AVAILABLE: boolean`(或运行期一次性探测缓存)。`baseClaudeArgs` 据它决定是否 push `--bare`;§9.3 `createClaudeAdapter` 据 `!BARE_FLAG_AVAILABLE` 决定 `needHooksDisable`(是否往 `--settings` 注入 hooks-disable 片段,§3.1.2)。二者同源,保证「argv 带不带 --bare」与「settings 带不带 hooks-disable」一致,不会出现「既没 --bare 又没关 hooks」的裸奔态。

#### 3.1.2 `--settings` 唯一拼装出口(CA15 / 对齐 07 v2 §6.2 V4)——消除双写覆盖

v2 有一个**安全/正确性 bug**:claude 的 `--settings` 在两处独立产生——① §3.1.1 `--bare` 兜底路径的 hooks-disable 片段 `{"hooks":{},"disableAllHooks":true}`;② provider 注入的 `extraConfig`(reasoning effort、请求超时等)。claude CLI 对**重复** `--settings` 是「后者整体覆盖前者」(非 deep-merge),两处各自直出会让一方配置被静默吞掉(provider effort 丢失,或 hooks 没关成)。07 v2 V4 据此把权威**拆责**:`toClaudeInjection` **不再直出** `--settings`,改返回 `settingsFragment`(纯对象);**最终 `--settings` 的拼装权唯一属 06**。

```ts
/** 06 是 --settings 的唯一拼装出口(V4)。把 provider 的 settingsFragment 与本地 hooks-disable 片段
 *  deep-merge 成单个对象,只输出一个 --settings <json>。绝不出现两个 --settings。
 *  @param fragment toClaudeInjection(cfg,keystore,ov).settingsFragment(07 §6.2;extraConfig deep-merge 来源)
 *  @param needHooksDisable 仅当走 §3.1.1 兜底(--bare 不可用)时为 true;--bare 命中则 hooks 已关,无需此片段 */
export function pushClaudeSettings(args: string[], fragment: Record<string, unknown>, needHooksDisable: boolean): void {
  const hooksDisable = needHooksDisable ? { hooks: {}, disableAllHooks: true } : {};
  const merged = deepMerge(hooksDisable, fragment);   // fragment 优先级高于兜底骨架,但二者键不重叠(hooks vs effort 等)
  if (Object.keys(merged).length === 0) return;       // 都空(--bare 命中且无 extraConfig)→ 不加 --settings
  const json = JSON.stringify(merged);
  // 体积闸:--settings 与 --json-schema 抢同一条 32KB 命令行预算(§4.1)。
  // 超 SETTINGS_INLINE_BUDGET → 走 07 §6.3【待实测】的 --settings 文件路径变体(M0-9),或剔除非必需 extraConfig 项告警。
  if (json.length > SETTINGS_INLINE_BUDGET) throw new SyluxError('PROVIDER_CONFIG_INVALID',
    `--settings 内联超 ${SETTINGS_INLINE_BUDGET} 字符(extraConfig 过大);应保持 extraConfig 小或走文件变体`, { len: json.length });
  args.push('--settings', json);
}
/** --settings 内联预算(UTF-16 字符)。与 §4.1 schema 预算共享 32KB 命令行硬顶,二者之和受 CMDLINE_SAFE_LIMIT 约束。 */
const SETTINGS_INLINE_BUDGET = 6000;
```

> **与 §4 schema 预算的耦合(关键)**:`--settings`(本节)与 `--json-schema`(§4)**同抢一条命令行**(Windows 32767 UTF-16 硬顶,§4.1)。v3 把二者预算显式分账:schema 8000(§4.2 `SCHEMA_INLINE_BUDGET`)+ settings 6000 + append-system-prompt + 路径 ≤ `CMDLINE_SAFE_LIMIT`(30000)。`planJsonSchemaArg`(§4.2)在估算 `baseLen` 时**必须**把已 push 的 `--settings` 串计入(它在 `pushClaudeSettings` 之后调用,args 已含 settings),故 schema 降级判定天然吃到 settings 占用,无需额外协调——**调用顺序焊死:先 `pushClaudeSettings`,后 `planJsonSchemaArg`**(§3.2/§3.3 已按此序)。

### 3.2 send(首轮):预设 session-id + settings + schema

```ts
import { randomUUID } from 'node:crypto';

/**
 * 首轮 argv。预设一个合法 UUID 作 --session-id(CF-4),但归一化层仍以观测到的
 * system/init.session_id 为准 emit session_started(§6.4,守 02 I5)。
 * v3:新增 inj 参数(toClaudeInjection 产物),把 flags(--model/--fallback-model)与
 * settingsFragment 在此并入;调用顺序 settings→schema(§3.1.2 体积耦合)。
 * 返回 { args, presetSessionId, schemaPlan }:presetSessionId 供崩溃诊断 / 日志关联。
 */
export function buildClaudeSendArgs(input: AgentInput, inj: ClaudeInjection, needHooksDisable: boolean): {
  args: string[]; presetSessionId: string; schemaPlan: SchemaPlan;
} {
  const presetSessionId = randomUUID();
  const args = baseClaudeArgs(input);
  args.push(...inj.flags);                 // --model / --fallback-model(07 §6.2;非密)
  args.push('--session-id', presetSessionId);
  pushClaudeSettings(args, inj.settingsFragment, needHooksDisable);  // §3.1.2 唯一 --settings 出口(V4)
  const schemaPlan = planJsonSchemaArg(input.outputSchema, args, input);  // §4.2,在 settings 之后(吃到其占用)
  return { args, presetSessionId, schemaPlan };
}
```

### 3.3 resume(续轮):--resume <sid>,sandbox/workdir 继承首轮

```ts
/**
 * 续轮 argv。claude 的 resume 比 codex 干净:同一组 headless flag + --resume <sid>。
 * 关键差异(对比 codex 事实 E):
 *  - claude resume **接受** --permission-mode / --add-dir(不像 codex resume 拒 -s/-C),
 *    但为与 codex 行为一致 + 防漂移,sandbox/workdir 仍重传与首轮**相同**值(继承语义)。
 *  - 不预设新 --session-id(复用旧 sid);如需新 id 走 --fork-session(本设计默认不 fork)。
 *  - resume 成本:claude 走 prompt 缓存,历史多为 cache_read(约 1/10 价),
 *    与 codex「全量重计费」(事实 D)不对称——刹车成本模型按 §7.3 分端估。
 */
export function buildClaudeResumeArgs(sessionId: string, input: AgentInput, inj: ClaudeInjection, needHooksDisable: boolean): {
  args: string[]; schemaPlan: SchemaPlan;
} {
  const args = baseClaudeArgs(input);
  args.push(...inj.flags);                 // --model / --fallback-model(同首轮,07 §6.2)
  args.push('--resume', sessionId);
  pushClaudeSettings(args, inj.settingsFragment, needHooksDisable);  // §3.1.2 唯一 --settings 出口(V4)
  const schemaPlan = planJsonSchemaArg(input.outputSchema, args, input);  // settings 之后
  return { args, schemaPlan };
}

/** sandbox(05 AgentInput,封顶 workspace-write)→ claude --permission-mode。 */
function mapPermissionMode(sandbox: 'read-only' | 'workspace-write'): string {
  // claude choices: acceptEdits|auto|bypassPermissions|default|plan
  // read-only → 'plan'(只读规划,不落盘改动);workspace-write → 'acceptEdits'(自动接受编辑,封顶)
  // 绝不映射到 bypassPermissions(等价 codex danger-full-access,被 05 A 封顶禁止,安全 08)
  return sandbox === 'read-only' ? 'plan' : 'acceptEdits';
}
```

### 3.4 argv 字段映射总表(claude 端,补全 05 §2.1)

| AgentInput 字段 | claude 落点 | 备注 |
|---|---|---|
| `prompt` | **stdin**(`-p` + 管道写入) | CF-2,绝不进 argv |
| `outputSchema` | `--json-schema <内联串>`,超限降级(§4) | 两端不对称核心 |
| `workdir` | `--add-dir <abs>` + spawn `cwd` | 非 codex 的 `-C` |
| `sandbox` | `--permission-mode`(§3.3) | 封顶 acceptEdits |
| `providerEnv` | 子进程 env(`ANTHROPIC_*`),`extendEnv:false` | key 只在此(A4);v3 与 `toClaudeInjection().env` 并集经 `buildChildEnv`(§9.3) |
| `providerOverrides.model` | `--model`(经 `toClaudeInjection().flags`,v3) | merge 内置 07;不再由 06 直读 ov.model |
| `providerOverrides.fallbackModel` | `--fallback-model`(经 `inj.flags`,v3) | claude 独有 |
| `providerOverrides.baseUrl` | env `ANTHROPIC_BASE_URL`(**非** argv) | 中转切换;不进 argv |
| `providerOverrides.extraConfig` | `--settings <json>`(经 `inj.settingsFragment`,deep-merge,§3.1.2) | 07 §3.4 白名单;06 唯一拼装(V4/CA15) |
| `providerOverrides.wireApi` | (claude 无此概念,**静默丢弃**) | 07 §6.3;不报错 |
| `appendSystemPrompt` | `--append-system-prompt`(或 `--append-system-prompt-file`) | 角色/协议注入;codex 无等价 |
| `effort` | `--effort` | low..max |
| `maxTurns` | `--max-turns` | 工具循环封顶 |
| `ephemeral` | `--no-session-persistence` | 对应 codex `--ephemeral` |
| `timeoutMs` | 适配器内计时器(§8.1) | 非 argv |
| (首轮) | `--session-id <uuid>`(预设) | resume 复用 |
| (续轮) | `--resume <sid>` | 不预设新 id |

> **AgentInput 的 claude 专属字段(已闭合)**:`appendSystemPrompt` / `effort` / `maxTurns` / `fallbackModel` 是 claude 端用到、codex 端忽略的可选字段。**05 v3 §2 已把它们纳入** `AgentInput`(`fallbackModel` 在 `ProviderOverrides`,标 V3c),向后兼容新增,不破坏 codex;本文件**只消费不重定义**(D13 闭合)。`providerOverrides` 的 `baseUrl`/`wireApi` 对 claude 多数走 env 而非 argv(`toClaudeInjection` 内 base_url 进 `env.ANTHROPIC_BASE_URL`、wireApi 静默丢弃,07 §6.2/§6.3),适配器按端选择落点。

---

## 4. `--json-schema` 内联串:命令行长度上限三级对策(核心难点)

事实 F + 02 §6.2 已点出:codex 收 schema **文件路径**,claude 收 **内联串**(`--json-schema '<json>'`),且 Windows 命令行有长度上限。本节给权威对策。

### 4.1 长度上限的真实约束(Windows)

- Windows `CreateProcessW` 的 `lpCommandLine` 上限是 **32767 个 UTF-16 字符**(整条命令行,含 exe 路径 + 所有 flag,不只 schema)。这是硬上限,超了 spawn 直接 `ENAMETOOLONG` / `EINVAL`。
- 02 §6.2 已用 `$refStrategy:'none'` 摊平 `$ref`,但 evidence 是三分支 `discriminatedUnion`(file_ref/command/spec_quote),摊平后 `oneOf` 三个对象 + 各自字段描述,JSON Schema 体积**不小**。
- 还要给同条命令行的其它长 flag 留预算:`--append-system-prompt <角色+黑板协议>`(可能上千字)、`--add-dir <长路径>`、`--settings <JSON>`。schema 不能独吞 32KB。

### 4.2 三级降级策略(planJsonSchemaArg)

设一个**保守预算**(默认 8000 字符给 schema 内联,留足余量给其它 flag 与 UTF-16 膨胀),按实际体积三级降级:

```ts
export type SchemaPlan =
  | { mode: 'inline' }                          // 一级:--json-schema <串> 直接进 argv
  | { mode: 'append_prompt'; enforced: false }  // 二级:schema 塞进 system prompt,软约束(无 CLI 强制校验)
  | { mode: 'stream_json_input' };              // 三级:走 stream-json 输入通道(§4.4)

/** schema 内联预算(UTF-16 字符)。整条命令行硬顶 32767;给 schema 8000,余 ~24KB 给其它 flag。 */
const SCHEMA_INLINE_BUDGET = 8000;
/** 整条命令行安全阈值(留 buffer 给 exe 路径 / env 展开差异)。 */
const CMDLINE_SAFE_LIMIT = 30000;

/**
 * 决定 outputSchema 怎么进 claude:
 *  一级 inline:schema 串 ≤ 预算 且 预拼 argv 总长 ≤ 安全阈值 → 直接 --json-schema。
 *  二级 append_prompt:超预算但中等 → 不走 --json-schema(否则 spawn 失败),
 *       改把 schema 文本拼进 --append-system-prompt(“你必须只输出符合此 schema 的 JSON:...”),
 *       CLI 不强制,**全靠应用层 safeParse 兜底**(02 I2:未校验不入引擎,失败重试,§8.4)。
 *  三级 stream_json_input:append 后命令行仍超阈值 → 改 --input-format stream-json,
 *       schema 与 prompt 都从 stdin 的结构化消息里送,argv 不再背长载荷(§4.4)。
 * 注意:本函数会 **mutate** 传入的 args(push --json-schema 或 --append-system-prompt)。
 */
export function planJsonSchemaArg(
  schema: Record<string, unknown>,
  args: string[],
  input: AgentInput,
): SchemaPlan {
  const schemaStr = JSON.stringify(schema);
  const schemaLen = schemaStr.length;

  // 预估整条命令行长度(粗略:现有 args 之和 + schema + 引号/分隔余量)
  const baseLen = args.reduce((n, a) => n + a.length + 3, 0);

  // 一级:inline
  if (schemaLen <= SCHEMA_INLINE_BUDGET && baseLen + schemaLen < CMDLINE_SAFE_LIMIT) {
    args.push('--json-schema', schemaStr);
    return { mode: 'inline' };
  }

  // 二级:塞进 append-system-prompt(软约束)
  const softInstruction = buildSchemaAsPromptInstruction(schemaStr);
  const merged = mergeAppendSystemPrompt(args, softInstruction);  // 合并/新增 --append-system-prompt
  const afterLen = merged.reduce((n, a) => n + a.length + 3, 0);
  if (afterLen < CMDLINE_SAFE_LIMIT) {
    return { mode: 'append_prompt', enforced: false };
  }

  // 三级:命令行仍超 → stream-json 输入,长载荷全走 stdin
  // 撤掉刚加的 append 段,改由 §4.4 的 stream-json user message 承载 prompt+schema 指令
  stripAppendSystemPrompt(merged, softInstruction);
  replaceInputFormatWithStreamJson(args);  // --input-format text → stream-json
  return { mode: 'stream_json_input' };
}

/** 把 schema 文本包成“只输出合此 schema 的 JSON”软指令(二级/三级共用)。 */
function buildSchemaAsPromptInstruction(schemaStr: string): string {
  return [
    '【输出契约·强制】你的最终回复必须是单个 JSON 对象,且严格符合以下 JSON Schema。',
    '不要输出任何额外文字、Markdown 代码围栏或解释,只输出该 JSON 本身。',
    'JSON Schema:',
    schemaStr,
  ].join('\n');
}
```

### 4.3 三级模式与“强制成形”强度对照

| 模式 | 触发条件 | CLI 是否强制 schema | 兜底 | 与事实 C(codex 文件)对比 |
|---|---|---|---|---|
| `inline` | schema 小(≤8KB)且命令行不超 | **是**(`--json-schema` 服务端校验) | safeParse 仍兜(02 I2) | codex 写文件无此限;claude inline 受命令行限 |
| `append_prompt` | schema 中等,inline 超预算 | **否**(纯提示软约束) | **强依赖** safeParse + 重试(§8.4) | codex 此时仍可文件强制,claude 退化为软约束(不对称代价) |
| `stream_json_input` | append 后命令行仍超阈值 | 否(同二级软约束) | 同上 | 仅解决“argv 太长”,不恢复强制力 |

> **关键不对称(回填 02 §6.2 的【待实测】)**:本轮已实测 claude `--json-schema` flag 存在(事实 F)且 evidence 三分支 schema 经 `$refStrategy:'none'` 摊平后体积**有可能逼近预算**。结论:**claude 端的“强制成形”不是无条件的**——schema 一大就退化为软约束,这放大了 02 I2「未校验不入引擎 + safeParse 失败重试」兜底的重要性。codex 端写文件无此退化(事实 C)。因此**evidence 校验的最后防线永远是应用层 `validateMessage`(02 §8),不能依赖 CLI schema**。

### 4.4 三级:stream-json 输入通道(argv 卸载)

当 `--append-system-prompt` 把命令行顶爆时,改用 `--input-format stream-json`:prompt 与 schema 软指令不再进 argv,而是作为 stdin 上的结构化 user message 送入。claude stream-json 输入的 user message 形如:

```jsonc
// 写入 child.stdin 的单行(line-delimited JSON);随后 child.stdin.end()
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<prompt + schema 软指令拼接>"}]}}
```

- 适配器在 `mode==='stream_json_input'` 时,把 `prompt` 与 `buildSchemaAsPromptInstruction(schema)` 拼成一条 user message 的 `text`,JSON.stringify 后 `child.stdin.write(line+'\n'); child.stdin.end()`。
- 此模式下 argv 不含 prompt 也不含 schema 长串,命令行长度恒安全。
- 【待实测】claude stream-json **输入** user message 的精确字段形(本轮只实测了 stream-json **输出**信封,§5)。M0 需实测确认 `{"type":"user","message":{...}}` 是否被 2.1.183 接受;若字段名有出入,以实测为准修正本节。`--replay-user-messages` 可让 claude 回显收到的 user message,用于 M0 校验输入被正确解析。

> **决策**:默认尽量走一级 inline(最强);schema 体积控制在源头——02 §6.2 已用 `$refStrategy:'none'` + 瘦 `agentMessagePayloadSchema`(只 5 字段)。只有 evidence schema 摊平确实超 8KB 时才降级。M0 实测应打印 `JSON.stringify(buildAgentOutputJsonSchema()).length` 落档,确定常态走哪级。

### 4.5 严格 structured-output 后端的拒绝(CA9 / 对齐 02 H7)——长度达标 ≠ 一定能 inline

§4.2 只按**长度**降级,但 02 §6.2 H7 点出第二条独立失败轴:**严格 structured-output 后端**(OpenAI `response_format:json_schema strict`、部分中转)对 schema 形状有额外约束——(a) 每个 object 所有 property 必须 `required`;(b) `additionalProperties:false`;(c) 对 `anyOf`/`oneOf`(`discriminatedUnion` 生成 `anyOf`)支持参差。`agentMessagePayloadSchema` 的 `evidence` 是三分支 union + 多 optional 字段(`note`/`quote`/`exitCode`/`inReplyTo`),即便内联串很短,**strict 后端仍可能直接拒 `--json-schema`**(报 400 / schema 不被接受 → 进程在 `system/init` 后或干活中报错)。

因此 `planJsonSchemaArg` 的判定**不只是长度**,还要吃一个「该 provider 的 strict 兼容档」:

```ts
/** schema 强制兼容档(来自 provider 07 + M0-3 实测,常驻于 ProviderConfig.extraConfig 或运行时探测缓存)。 */
export type SchemaStrictness =
  | 'inline_ok'        // 后端接受本 schema 形状(含 anyOf/optional)→ 可走一级 inline 强制
  | 'strict_reject'    // 后端 strict 拒 anyOf/optional → 即便短也不能 inline,直接走软约束
  | 'unknown';         // 未探测;保守当 inline_ok 试,失败链(§8.4)兜底

/**
 * v2 判定顺序:
 *  1. 若 strictness==='strict_reject' → 直接二级 append_prompt(软约束),不尝试 --json-schema(否则进程报错);
 *  2. 否则按 §4.2 长度三级降级(inline → append_prompt → stream_json_input)。
 * 即:strict 拒绝是「长度之前」的短路,长度是「strict 通过后」的二级闸。
 */
```

> 与事实 C/F 的关系:codex 端写文件**同样**受 strict 后端约束(02 H7 是后端问题,非传递通道问题),但 codex 走 `--output-schema` 文件、claude 走 `--json-schema` 内联,**两端在 strict 拒绝时的退化目标一致**=「宽产出 + 应用层 safeParse 兜底重发」(02 §6.2 退化 C / §8.4)。本文件 claude 端的退化目标是 `append_prompt`(软约束),与 codex 端语义对称。**结论**:无论 inline 体积多小,evidence schema 的强制力都不是无条件的——这第二次放大 02 I2「未校验不入引擎 + safeParse 失败重试」兜底的重要性(§4.3 已就长度轴说过一次,H7 是第二条轴)。`cacheDiscount`/strict 档由 M0-3 实测落档(§11)。

---

## 5. claude stream-json 事件信封(本机实测,2.1.183)

本节是 §6 归一化状态机的**输入契约**:claude `-p --bare --output-format stream-json --verbose` 在 stdout 逐行吐的 line-delimited JSON 信封。以下字段形为 2026-06-20 实测(`--bare` 后)。

### 5.1 事件序列(--bare 后,纯净)

```
{"type":"system","subtype":"init",   ...,"session_id":"<uuid>", ...}   // 首事件(闸门:此刻 emit session_started)
{"type":"assistant","message":{...content...},"session_id":"<uuid>", ...}   // 0..N 条(含 text / tool_use)
{"type":"user","message":{...tool_result...},"session_id":"<uuid>", ...}    // 工具回灌(有工具调用时)
{"type":"result","subtype":"success"|"error_*","result":"...","usage":{...},"session_id":"<uuid>", ...}  // 末事件
```

实测要点:
- **每个事件都带 `session_id`**(CF-4);归一化只认**首个 `system/init`** 的 `session_id` 触发 `session_started`(§6.4),后续重复 id 忽略。
- 不加 `--bare` 时,`system/init` **之前**会有多条 `{"type":"system","subtype":"hook_started"|"hook_response"}`,且其 `stderr`/`output` 字段可能含用户全局 hook 的乱码(实测 GBK 控制台噪声混入)。`--bare` 后这些消失。**焊死必带 `--bare`**(CF-3)。
- 不加 `--verbose` 时,stream-json 退化为只吐一条 `result`(无中间 assistant 事件),拿不到流式 delta/工具观战。**stream-json 必配 `--verbose`**。

### 5.2 五类信封字段(归一化所需子集)

| `type` | 关键子字段 | 语义 | 映射目标(§6.4) |
|---|---|---|---|
| `system` / `subtype:"init"` | `session_id`, `model`, `permissionMode`, `tools`, `cwd` | 会话已建立 | → `session_started`(首个 init) |
| `system` / `subtype:"hook_*"` | `hook_name`, `output`, `stderr` | hook 噪声 | **丢弃**(`--bare` 下通常不出现;防御性忽略) |
| `assistant` | `message.content[]`(`{type:"text",text}` / `{type:"tool_use",name,input}`),`message.usage` | 模型增量回复 / 工具调用 | text→`delta`;tool_use→`tool_call` |
| `user` | `message.content[]`(`{type:"tool_result",...}`) | 工具结果回灌 | 透传面板(可选 `tool_call` 配对)或丢弃 |
| `result` | `subtype`, `is_error`, `result`(最终文本/JSON 串), `usage`, `stop_reason`, `num_turns`, `total_cost_usd`, `terminal_reason`, `permission_denials` | 本次调用终局 | success→`final_message`(raw=`result`);error_*→`error`(§8.2) |

### 5.3 result.usage 实测形(§7 归一化输入)

```jsonc
"usage": {
  "input_tokens": 502,
  "cache_creation_input_tokens": 5359,   // 首轮写缓存
  "cache_read_input_tokens": 0,          // resume 时这里变大(历史命中缓存,约 1/10 价)
  "output_tokens": 2,
  "service_tier": "standard"
}
// 另有顶层 result.total_cost_usd(美元) 与 result.modelUsage(按模型拆,
// 实测含背景 haiku 模型用量;归一化只取顶层 usage,不逐模型摊,§7.1)
```

### 5.4 最终文本的权威来源:result.result

- **非 schema 模式**:`result.result` 是纯文本最终回复(实测 `"pong"`)。
- **schema inline 模式**:`result.result` 是合 schema 的 **JSON 串**(claude 服务端校验后回吐)。
- **append_prompt / stream_json_input 软约束模式**:`result.result` 是模型自觉产出的 JSON 串(无 CLI 强制,可能带围栏/杂质 → 适配器**不清洗**,原样作 `raw` 交引擎 safeParse,失败重试,§8.4)。
- 归一化层取 `result.result` 作 `final_message.raw`(§6.5);**不**用拼接 `assistant` 事件的 text(那些是中间增量,可能含思考/工具叙述,非最终结构化输出)。

---

## 6. 两端统一解析归一化状态机(本文件核心,codex+claude 共享)

这是适配层的脊柱:把**两端形态迥异的 stdout 字节流**收敛成**同一条 `AgentEvent` 流**(02 §6.3)。设计为三层:**字节→行**(`ndjson.ts`,两端共享)、**行→中性 `ParsedLine`**(两端各一个 mapper,`codex/parse-events.ts` vs `claude/map-events.ts`)、**`ParsedLine`→`AgentEvent`**(`pipeline.ts` + `FirstEventGate`,两端共享)。两端差异**只**集中在中间 mapper,首尾两层完全复用。

### 6.1 三层架构图

```
            stdout (Buffer chunks, 可能半行/多行/粘包)
                       │
        ┌──────────────▼──────────────┐
        │ ① ndjson.ts(两端共享)       │  字节累积 + 按 \n 切完整行 + 容半行/CRLF
        │   LineSplitter               │  → 逐条完整 JSON 文本行
        └──────────────┬──────────────┘
                       │ string line
        ┌──────────────▼──────────────┐
        │ ② mapper(两端各一)          │  JSON.parse + 端特定信封 → 中性 ParsedLine
        │   codex: parse-events.ts     │  thread.started/item.completed/turn.completed/...
        │   claude: map-events.ts      │  system.init/assistant/user/result(§5)
        └──────────────┬──────────────┘
                       │ ParsedLine(中性判别联合)
        ┌──────────────▼──────────────┐
        │ ③ pipeline.ts(两端共享)     │  喂 FirstEventGate(05 §5.3)守 A1/A2
        │   + FirstEventGate           │  → 唯一一次 session_started、final/error 收尾
        └──────────────┬──────────────┘
                       │ AgentEvent(02 §6.3)
                       ▼  for await 给引擎
```

### 6.2 ① 行切分器(ndjson.ts,两端共享,含无界缓冲护栏)

stdout 是 chunk 流,一个 chunk 可能含半行、多行或跨 chunk 的行。`LineSplitter` 负责把 Buffer 累积成完整行。**CA3(对齐 05 v2 A6)**:claude 的 `assistant` 事件可携带极大 `content`(长工具输出 / 大段代码),失控或恶意流可用「一行不带 `\n` 的巨型 JSON」撑爆 `buf` 内存。故单行设硬上限 `MAX_JSONL_LINE_BYTES`,超限即视为协议违例 emit error,**不**无限累积。**B1 焊死(v3)**:该常量的**唯一权威是 02 §5.3**(`@sylux/shared`,值 512 KiB),本文件与 05 一样 **import 不重声明**(v2 曾误重声明 1 MiB 且误称「05 权威」,已删)。`LineSplitter` 类与 05 v2 `proc`/`ndjson` 下的同名类是**同一份**(两端共享),本文件只复述契约:

```ts
// ★B1 焊死(v3):MAX_JSONL_LINE_BYTES 的唯一权威是 **02 §5.3**(`@sylux/shared`),值 = 512 KiB。
//   v2 曾在此**重声明**为 1 MiB 并误称「05 v2 权威常量」——那是 I1 单一权威违规 + 数值冲突
//   (x-consistency B1 / 02 §15.6 已登记)。v3 删除本地声明,改 import,与 05(同样 import 02)统一。
import { MAX_JSONL_LINE_BYTES } from '@sylux/shared';  // 02 §5.3 权威,512 KiB(勿在他处重定义)

/** 行切分器溢出信号:由调用方(pipeline)转 gate.onFailure。 */
export class LineOverflowError extends Error {
  constructor(public readonly bytes: number) { super(`jsonl line exceeded ${MAX_JSONL_LINE_BYTES} bytes (got ${bytes})`); }
}

/** 字节流 → 完整行。容忍半行跨 chunk、CRLF、空行;单行超上限抛 LineOverflowError;
 *  最后残行由 flush() 交出供崩溃诊断。两端共享(codex/claude 同款)。 */
export class LineSplitter {
  private buf = '';
  /** 喂一个 stdout chunk,产出本次可切出的完整行(去尾随 \r,跳空行)。
   *  @throws LineOverflowError 当累积未换行的 buf 超 MAX_JSONL_LINE_BYTES(防无界缓冲 DoS,A6) */
  push(chunk: string): string[] {
    this.buf += chunk;
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_JSONL_LINE_BYTES && this.buf.indexOf('\n') === -1) {
      const bytes = Buffer.byteLength(this.buf, 'utf8');
      this.buf = '';                       // 丢弃,避免持续占内存
      throw new LineOverflowError(bytes);
    }
    const lines: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      let line = this.buf.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1); // CRLF(Windows,事实 A)
      this.buf = this.buf.slice(nl + 1);
      if (line.trim() !== '') lines.push(line);
    }
    return lines;
  }
  /** 流结束时调用:返回尚未以 \n 收尾的残留(正常应为空;非空=被截断,§8.3 部分输出)。 */
  flush(): string { const r = this.buf; this.buf = ''; return r.trim(); }
}
```

> pipeline 在 `splitter.push(chunk)` 外层 try/catch `LineOverflowError` → `gate.onFailure('SUBPROCESS_CRASHED', 'jsonl line overflow')`(闸门后)或 `SUBPROCESS_SPAWN_FAILED`(闸门前),并 `proc.kill()` 杀掉刷屏进程(§6.4 主循环已含该 catch)。这把 05 A6 焊在两端共享的同一行切分器里。

### 6.3 ② 中性 ParsedLine(两端 mapper 的统一产物)

两端 mapper 把各自信封翻译成同一个**中性判别联合**,屏蔽端差异。`ParsedLine` 是适配层**内部**类型(不进 02,不落黑板),专供 pipeline 消费:

```ts
/** 两端 mapper 的统一中性产物(内部类型,不持久化)。 */
export type ParsedLine =
  | { t: 'session'; sessionId: string }                       // codex thread.started / claude system.init
  | { t: 'text_delta'; text: string }                         // 流式文本增量(透传面板)
  | { t: 'tool'; name: string; args: unknown }                // 工具调用(透传面板观战)
  | { t: 'final'; raw: string; usage?: TokenUsage }           // 最终结构化文本 + 本轮 usage
  | { t: 'fatal'; code: SyluxErrorCode; detail: string }      // 端内可判的致命(如 result.error_*)
  | { t: 'ignore' };                                          // hook 噪声 / 未知 type / 中间态,丢弃

/** mapper 接口:一行 string → 0 或 1 个 ParsedLine(解析失败返回 ignore 或 fatal)。 */
export interface LineMapper {
  map(line: string): ParsedLine;
}
```

### 6.4 ③ 归一化管线 + FirstEventGate(pipeline.ts,两端共享)

`FirstEventGate`(05 v2 §5.3 的三态机:`awaiting_thread → streaming → terminal`)是守 A1/A2 的唯一闸门。两端**共用同一个类**,差异只在「什么 `ParsedLine` 触发 session 闸门」——而 mapper 已把它统一成 `{t:'session'}`。**CA2 对齐**:05 v2 的真实 API 是 `onThreadStarted(threadId)`(方法名沿用 codex 语,语义=session 闸门跃迁)/ `primeIfSeeded()` / `onFinal(raw,usage)` / `onFailure(code,detail)` / `resumable` getter——**没有** v1 凭空假设的 `onSession`/`passthrough`/`isTerminal`。delta/tool_call **不经 gate**(它们不受 A1/A2 约束),由 pipeline 在「已过闸门、未终结」相位直接构造(对齐 05 v2 §7.3 的 `emit({kind:'tool_call',...})` 直发);pipeline 用本地 `started`/`done` 两个布尔镜像 gate 相位即可。

**CA5 竞态(对齐 05 v2 A3)**:监听器必须在 spawn 后**同步**挂载(不在惰性 AsyncGenerator 体内),事件入内部 queue;否则 `system/init` 可能早于 `for await` 首次拉取而丢失。故 pipeline 不直接 `for await (chunk of stdout)`,而是消费一个**已在 spawn 时同步开始 push 的 queue**(§9.3 adapter 负责同步挂监听 + 喂 queue,本函数只拉)。

```ts
import { FirstEventGate } from './gate.js';        // 05 v2 §5.3 权威,本文件复用(不重定义)
import { LineSplitter, LineOverflowError } from './ndjson.js';  // §6.2,两端共享

/**
 * 把一条「已切行的事件源」归一化成 AgentEvent 异步流。
 * 两端共用:codexMapper / claudeMapper 注入,pipeline 本身无端分支。
 * @param lines  已由 spawn 时同步挂载的监听把 stdout 切行后推入的拉取式队列(CA5;§9.3)。
 *               队列在 stdout 'data' / 'close' / 'error' / LineOverflowError 时被 push,
 *               本函数只消费,不再自行挂 stdout 监听(避免惰性体竞态)。
 * @param mapper claudeMapper(§6.4.1)或 codexMapper(§6.5)。
 * @param gate   resume 路径已 seededSessionId 构造(A9),send 路径裸构造。
 */
export async function* normalizeStream(
  lines: LineQueue,                 // §9.3:{ next():Promise<LineSignal> },同步开始填充
  mapper: LineMapper,
  gate: FirstEventGate,
): AsyncIterable<AgentEvent> {
  // resume 预置:进流立刻补发 session_started(A9;send 路径返回 null)
  const primed = gate.primeIfSeeded();
  if (primed) yield primed;

  let started = primed != null;     // 已过 session 闸门
  let done = false;                 // 已 emit final/error

  while (!done) {
    const sig = await lines.next();        // 'line' | 'overflow' | 'exit' | 'spawn_error'(§9.3)
    if (sig.kind === 'line') {
      const p = mapper.map(sig.text);
      switch (p.t) {
        case 'session': {
          const ev = gate.onThreadStarted(p.sessionId);  // 唯一一次 session_started;重复→null(幂等)
          if (ev) { started = true; yield ev; }
          break;
        }
        case 'text_delta': if (started && !done) yield { kind: 'delta', text: p.text }; break;
        case 'tool':       if (started && !done) yield { kind: 'tool_call', name: p.name, args: p.args }; break;
        case 'final': {
          const ev = gate.onFinal(p.raw, p.usage);        // 仅 streaming 相位有效
          if (ev) { done = true; yield ev; }
          break;
        }
        case 'fatal': {
          const ev = gate.onFailure(p.code, p.detail);    // 闸门前→SPAWN_FAILED,闸门后→原码
          if (ev) { done = true; yield ev; }
          break;
        }
        case 'ignore': break;
      }
    } else if (sig.kind === 'overflow') {
      const ev = gate.onFailure('SUBPROCESS_CRASHED', `jsonl line overflow ${sig.bytes}B`); // CA3
      if (ev) { done = true; yield ev; }
    } else if (sig.kind === 'spawn_error') {
      const ev = gate.onFailure('SUBPROCESS_SPAWN_FAILED', sig.detail);  // child 'error'(CL-a)
      if (ev) { done = true; yield ev; }
    } else { // 'exit':stdout 结束 / 进程退出但未见 final
      const ev = onStreamEndWithoutFinal(gate, sig.tail, sig.stderrTail, sig.code, sig.signal, sig.killCode); // §8.3(CA17:killCode)
      done = true;
      if (ev) yield ev;
    }
  }
}
```

> **gate 复用纪律(CA2)**:`FirstEventGate` 类**单一定义在 05 v2 §5.3**,本文件 `import` 复用、**绝不重写**(守 02 I1 / 05 单一权威)。claude 端把首个 `system/init.session_id` 经 `onThreadStarted` 推闸门——方法名虽叫 `onThreadStarted`(codex 历史命名),但语义对两端一致(session 闸门跃迁)。是否把它**改名**为端中性的 `onSession`(codex 留 `@deprecated` 别名)是一个**可选**的向后兼容回填提案(§12),需 05 同意后统一改;**在 05 改名落地前,本文件按现状用 `onThreadStarted`**,不单方面假设新名(这正是 v1 的错:凭空用了不存在的 `onSession`)。

### 6.4.1 claude mapper(map-events.ts)

```ts
/** claude stream-json 信封(§5)→ 中性 ParsedLine。 */
export const claudeMapper: LineMapper = {
  map(line: string): ParsedLine {
    let o: any;
    try { o = JSON.parse(line); } catch { return { t: 'ignore' }; }  // 非 JSON 行(理论上不应有)→ 丢
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init' && typeof o.session_id === 'string')
          return { t: 'session', sessionId: o.session_id };          // 闸门(首个 init)
        return { t: 'ignore' };                                       // hook_* 等噪声(CF-3 防御)
      case 'assistant': {
        // message.content[] 可能含多个 block;text→delta,tool_use→tool
        const blocks = o.message?.content ?? [];
        // 取首个可映射 block(pipeline 每行 0/1 事件;多 block 由 §6.4.2 拆分迭代)
        for (const b of blocks) {
          if (b.type === 'text' && b.text) return { t: 'text_delta', text: b.text };
          if (b.type === 'tool_use') return { t: 'tool', name: b.name, args: b.input };
        }
        return { t: 'ignore' };
      }
      case 'user':
        return { t: 'ignore' };  // tool_result 回灌;面板可另行透传,归一化默认丢
      case 'result':
        if (o.is_error || (o.subtype && o.subtype !== 'success'))
          return mapResultError(o);                                   // §8.2
        return { t: 'final', raw: String(o.result ?? ''), usage: normalizeClaudeUsage(o.usage) }; // §5.4/§7
      default:
        return { t: 'ignore' };   // 未知 type:容未来新增事件,不炸
    }
  },
};
```

### 6.4.2 多 block 的 assistant 事件(透传完整性)

一条 `assistant` 事件的 `message.content[]` 可能同时含多个 text/tool_use block。§6.4.1 的 mapper 每行只产 0/1 个 `ParsedLine`(接口约定),会丢掉同行的后续 block。两个处理选项:

- **默认(够用)**:面板只需"有动静"的观战感,丢同行后续 block 不影响**最终输出**(最终输出只认 `result.result`,§5.4)。delta/tool_call 是 best-effort 透传。
- **完整透传(可选)**:把 `LineMapper.map` 的返回放宽为 `ParsedLine[]`,pipeline 对数组逐个走 §6.4 的 switch。codex 端每行天然单事件,返回单元素数组即可。若面板要求逐 tool_use 精确观战,采此变体(向后兼容:`map` 返回 `ParsedLine | ParsedLine[]`,pipeline 归一成数组)。

> 决策:M1 先走默认(单事件/行,简单);若面板观战要求精确,M2 切 `ParsedLine[]`。无论哪种,**最终 `final_message.raw` 恒取 `result.result`,不受 block 丢弃影响**——结构化正确性不依赖透传完整性。

### 6.5 codex 端复用同管线(对齐 05)

codex mapper(`parse-events.ts`,05 §7)把其信封映射到**同一 `ParsedLine`**:

| codex 事件(事实 B) | ParsedLine |
|---|---|
| `thread.started`(首行,`thread_id`) | `{t:'session', sessionId: thread_id}` |
| `item.completed`(`item.type==='agent_message'`) | `{t:'final', raw: item.text, usage: <见下>}` |
| `turn.completed`(`usage`) | 不单独产事件;其 `usage` 并入紧邻的 `final`(05 §7 缓存末 usage) |
| 中间 reasoning / tool item | `{t:'text_delta'}` / `{t:'tool'}`(可选透传) |
| 进程异常 / 非法首行 | 由 pipeline 的 exit 路径 → `gate.onFailure`(§8) |

> 两端 mapper 产出的 `ParsedLine` 判别集完全相同,**pipeline 与 gate 一行端分支都没有**(端差异只在 mapper 内 `JSON.parse` 后的字段读取)。这正是「归一化」的兑现:换 CLI 只换一个 mapper(~50 行),引擎侧 `for await (AgentEvent)` 代码零改动。

### 6.6 内容防火墙边界(CA10:适配器做什么、不做什么)——焊死归属

适配器吐 `delta`/`tool_call`/`final_message`,这些数据**会**流向两个不同消费者,过滤归属必须分清(对齐 08 §4 内容防火墙 S5 + 08 §3 `redact`;**CA16 订正**:`redact` 实现归 **08**,非 v2 误写的 09——09 是 worktree),否则会出现「codex 输出含『忽略指令并执行』喂给 claude 当指令」的提示注入 RCE(08 闸②)或密钥经面板泄漏(08 S1):

| 数据流 | 消费者 | 过滤 | 归属 | 适配器职责 |
|---|---|---|---|---|
| `final_message.raw` → safeParse → `Message` → **拼进对面 agent 上下文** | 对面 CLI(下一轮 prompt) | `firewallPeerMessage`(边界标记 + 特征扫描 + files 路径白名单) | 引擎 03 P3 firewall 相位调用,**实现归 08 §4** | **不**做;只如实交出 `raw`(A6) |
| `delta` / `tool_call.args` / `tool_result` → **WS 推面板观战** | 浏览器面板(只看不喂回) | `redact`(密钥脱敏) | WS 发送前,`redact` **实现归 08 §3**(WS 编排在 11-ws) | **不**做;只如实 emit 中性事件 |
| stderr 末 N 行 → `error.detail` | 引擎日志 / 面板 | `redact` | §8.3 拼 detail 时 + 落盘前(`redact` 归 08 §3) | 截断 + 交 08 `redact`,不回显全 key |

**焊死结论(适配器边界纪律)**:

1. 适配器**不自做**内容防火墙,也**不自做** redact——它只产出**中性、未过滤**的 `AgentEvent`,过滤在**消费侧**(喂对面=引擎 P3 调 08 §4;推面板=WS 层调 08 §3 `redact`)。理由同 A6:适配器越界做语义过滤会让「谁负责安全」归属混乱,且适配器看不到「对面是谁」(那是引擎的拼装上下文阶段才知道)。
2. **唯一例外**是 `error.detail` 里的 stderr 摘要——它由适配器**截断**(末 500 字符)并**必过 08 `redact`**后才进 `detail`(§8.3 / §9.3 close 回调已 `redact(stderrRing)`),因为 stderr 可能直接喷出中转返回的含 key 报错串,这条是适配器**主动**脱敏的(防 detail 成泄密通道,08 S1)。
3. `tool_use.args`/`tool_result` 是 claude 在 worktree 内的工具调用(读文件、跑命令),其 `input`/输出可能含本地敏感内容;面板透传前过 08 `redact`;**绝不**把 `tool_result` 当作 `final` 喂回对面(它不是最终结构化输出,§5.4)。

> 与 05 对称:codex 端 stderr 同样过 `redact` 进 detail(05 §5.4 / R-parse-5「stderr 不进事件流」)。两端在「中性事件 + 消费侧过滤」这条边界上完全一致。`redact`/`SECRET_SIGNATURES`/`firewallPeerMessage` 全部权威在 **08**(安全),CA16 已把本节 v2 残留的「09 redact」字样统一订正为 08。

---

## 7. usage 归一化 与 两端成本不对称(刹车 07 的输入)

02 §6.3 的 `TokenUsage` 是 `{inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens}`(取自 codex `turn.completed.usage`,事实 G)。claude 的 `result.usage`(§5.3)字段名不同、且**缓存语义相反**,本节给归一化与刹车告警。

### 7.1 claude result.usage → TokenUsage(usage.ts)

```ts
import type { TokenUsage } from '@sylux/shared';

/**
 * claude result.usage → 02 TokenUsage。字段映射:
 *   input_tokens               → inputTokens(本轮"新"输入,非缓存部分)
 *   cache_read_input_tokens    → cachedInputTokens(命中缓存,约 1/10 价)
 *   cache_creation_input_tokens→ 计入 inputTokens(写缓存按全价,合进新输入更贴成本)
 *   output_tokens              → outputTokens
 *   (claude 无独立 reasoning token 计数)→ reasoningOutputTokens = 0
 * 只取 result 顶层 usage(权威聚合);不逐 modelUsage 摊(CF-5:含背景 haiku,非主成本)。
 */
export function normalizeClaudeUsage(u: any): TokenUsage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const cacheCreate = num(u.cache_creation_input_tokens);
  return {
    inputTokens: num(u.input_tokens) + cacheCreate,   // 新输入 + 写缓存(均近全价)
    cachedInputTokens: num(u.cache_read_input_tokens), // 命中缓存(廉价)
    outputTokens: num(u.output_tokens),
    reasoningOutputTokens: 0,
  };
}
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
```

### 7.2 codex 端 usage 归一(对齐,05 §7)

codex `turn.completed.usage` 字段已与 02 `TokenUsage` 近同名(`input_tokens/cached_input_tokens/output_tokens/reasoning_output_tokens`),直接 snake→camel 即可,无缓存语义差。两端归一化后都产出**同一 `TokenUsage`**,刹车 07 不感知来源端。

### 7.3 两端成本模型不对称(刹车 07 必须分端估)——关键

| 维度 | codex(事实 D) | claude(实测 CF-5) |
|---|---|---|
| resume 历史计费 | **全量重计费**:input_tokens 每轮累积翻倍(18755→37645),N 轮≈base×(1+2+…+N) | **prompt 缓存**:历史多走 `cache_read`(约 1/10 价),resume 远比 codex 便宜 |
| 基线底价 | ≈18.7k input/回合(系统上下文) | `--bare` 后极低(实测 init 后 ~1.3k);但首轮写缓存 `cache_creation` 按全价 |
| 缓存窗口 | 中转侧不可控 | ephemeral 5m/1h(实测 `cache_creation.ephemeral_5m_input_tokens`);超窗失效需重写缓存 |
| 刹车估算口径 | 按**累积** inputTokens 超线性估(02 §10 totalUsage) | 按 `inputTokens`(新+写缓存)累加,`cachedInputTokens` 单独折价计 |

刹车 07(实为 `04-convergence-brakes.md` §6 `cost-model.ts`)的成本函数应接受**分端权重**。本文件**只给口径**,真实折扣率/单价/阈值归 04 §6.2 的 `cost-model`(它已有 `usageToUsd(usage, pricing)` + 超线性外推):

```ts
/** 单轮「等效成本权重」口径(供 04 cost-model 消费;阈值/单价/折扣率归 04,不在本文件硬编码)。
 *  注意:cacheDiscount 不是常数 0.1,而是 provider 计价表的派生项(04 §6.2 pricing);
 *  此处仅示意「命中缓存按折价计」的结构,真实值 M0-4 用账单校准后落 04 pricing。 */
function billedWeightSketch(u: TokenUsage, pricing: { inPerTok: number; cacheReadPerTok: number; outPerTok: number }): number {
  return u.inputTokens * pricing.inPerTok          // 新输入 + 写缓存(normalizeClaudeUsage 已合并,§7.1)按全价
       + u.cachedInputTokens * pricing.cacheReadPerTok  // 命中缓存按 cache_read 单价(claude 远低;codex≈0 不影响)
       + u.outputTokens * pricing.outPerTok;
}
```

> 结论(回填 04 §6.2):**不能用单一成本公式套两端**。codex 按累积全价(事实 D:N 轮≈base×ΣN,仅 resume regime;stateless regime 近似平,见 04 §6.1 两 regime 表),claude 按「新输入全价 + 历史 cache_read 折价」。`TokenUsage`(02 §6.3)是两端**通用聚合容器**(04 `StopContext.totalUsage`),但**美元换算的单价表**必须按 `agent` + provider 分端,落在 04 `cost-model` 的 `pricing`。本文件归一化保证两端都产出**同一 `TokenUsage` 形状**(§7.1/§7.2),让 04 只需切 `pricing` 不必感知来源端的字段差异。`cacheDiscount`/单价 M0-4 用真实账单校准(§11)。

### 7.4 usage 缺失的兜底

- claude 正常 `result` 必带 `usage`;若 `error_during_execution` 中途断流没拿到 `result` → `final`/`error` 的 `usage` 为 `undefined`。
- 刹车 07 遇 `usage===undefined` 时按**该端基线底价**保守记账(codex 18.7k;claude 按上轮 + 写缓存估),宁可高估不低估(事实 D 刹车硬约束:预算只能保守)。

---

## 8. 超时 / 崩溃 / 部分输出 / result 错误分级(失败路径权威)

claude 端的失败路径比 codex 多一类:codex 只有"进程层"信号(spawn 失败 / exit code / 断流),claude 还有**应用层** `result.subtype` 错误(`error_max_turns` / `error_during_execution`,CF-6),进程本身 exit 0。本节给完整分级,接 05 §5 的闸门语义。

### 8.1 进程生命周期监听(ChildLifecycle)+ LineQueue(CA5 同步喂流)

```ts
/** pipeline 消费的拉取式行队列(CA5:spawn 时同步开始填充,避免惰性 generator 竞态)。 */
export interface LineQueue {
  /** 拉下一条信号;无则挂起直到 stdout 'data'/'close'/'error' 推入。 */
  next(): Promise<LineSignal>;
}
export type LineSignal =
  | { kind: 'line'; text: string }                                           // 一条完整 JSONL
  | { kind: 'overflow'; bytes: number }                                      // 单行超 MAX_JSONL_LINE_BYTES(CA3)
  | { kind: 'spawn_error'; detail: string }                                  // child 'error'(CL-a)
  | { kind: 'exit'; tail: string; stderrTail: string; code: number | null; signal: string | null; killCode: SyluxErrorCode }; // 流终;killCode=主动 kill 时的码(CA17:超时 TIMEOUT / cancel CANCELLED)

/** pipeline 监听子进程的三类信号源(spawn 时由 adapter 注入并同步挂载,§9.3)。 */
export interface ChildLifecycle {
  onSpawnError(cb: (err: Error) => void): void;                  // child 'error'
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  /** stderr 脱敏前的末 N KiB 环形缓冲(CA3:有界,防刷屏 stderr 撑爆内存)。 */
  stderrTail(): string;
  kill(): void;                                                  // 超时 / cancel(§9.2)
}

/** stderr 环形缓冲上限(CA3,对齐 05 v2 A6):只留末 N KiB 供 detail,旧的丢弃。 */
export const STDERR_RING_BYTES = 64 * 1024;
```

超时:adapter 在 spawn 时(§9.3)启计时器(`input.timeoutMs ?? hardTimeoutCeilingMs`,CA7);到点把 `killCode` 标为 `SUBPROCESS_TIMEOUT`(CA17,区别于人工 cancel 的 `SUBPROCESS_CANCELLED`)再 `treeKill`,进程 `close` 走 `exit` 信号(带 `killCode`)→ §8.3 → `gate.onFailure(killCode, ...)`(闸门前则归一为 SPAWN_FAILED)。两码均在 02 v2.1 §12 union(CA8)。计时器在 generator `finally` 清除(防误杀下一进程)。

### 8.2 result 应用层错误分级(mapResultError)

```ts
/** claude result 事件且 is_error / subtype≠success → 中性 fatal(§6.4.1 调用)。 */
function mapResultError(o: any): ParsedLine {
  const tail = typeof o.result === 'string' ? o.result.slice(0, 500) : '';
  switch (o.subtype) {
    case 'error_max_turns':
      // 工具循环撞 --max-turns 上限:非协议错,是"没在限内收口"。
      // 当作 final 处理还是 error?→ 视为 fatal,但带专用码,引擎可按 playbook 决定重试/放宽 maxTurns。
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `error_max_turns(num_turns=${o.num_turns}) ${tail}` };
    case 'error_during_execution':
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `error_during_execution ${tail}` };
    default:
      return { t: 'fatal', code: 'SUBPROCESS_CRASHED', detail: `result.is_error subtype=${o.subtype} ${tail}` };
  }
}
```

> **闸门交互**:这些 `result` 错误必在 `system/init` **之后**(claude 先 init 再干活),即闸门已 `streaming` → `onFailure` 保留原码 `SUBPROCESS_CRASHED`(非 SPAWN_FAILED),`resumable=true`(id 已得)。引擎可 `resume(sessionId)` 续接,或 stateless 重来(03 continuity)。`error_max_turns` 引擎可选择**提高 maxTurns 后 resume**(因 claude resume 走缓存便宜,CF-5)。

### 8.3 部分输出(stream 中断没等到 result)

最棘手的失败:`system/init` 来了(`session_started` 已 emit),`assistant` 也吐了几条 delta,但**进程在 `result` 前断流**(中转 502 / 网络断 / 被 kill)。`normalizeStream` 的 `onStreamEndWithoutFinal`:

```ts
/** stdout 自然结束(或进程 exit)但从未见 final。残行 + exit code 判因。
 *  签名对齐 §6.4 normalizeStream 的 'exit' 信号(CA5:tail/stderrTail/code/signal/killCode 由信号携带,
 *  不再持 ChildLifecycle 引用,生成器与进程句柄解耦)。
 *  CA17:killCode = 主动 kill 时设的码(超时 SUBPROCESS_TIMEOUT / 人工 cancel SUBPROCESS_CANCELLED);
 *        仅当判定为「被我方 kill」(signal!=null 或 killCode 非默认)时用它,否则用 SUBPROCESS_CRASHED。 */
function onStreamEndWithoutFinal(
  gate: FirstEventGate, tail: string, stderrTail: string, code: number | null, signal: string | null,
  killCode: SyluxErrorCode,
): AgentEvent | null {
  // 残行可能是被截断的半条 JSON(写到一半进程死)→ 不强解,只入 detail
  const detail = [
    `exit without final_message (code=${code} signal=${signal})`,
    tail ? `partialLine=${tail.slice(0, 200)}` : '',
    stderrTail ? `stderr=${stderrTail.slice(-500)}` : '',  // 末 500 字符,已过 08 redact(CA10/CA16/§6.6)
  ].filter(Boolean).join('; ');
  // 被我方 kill(signal 非空,如 SIGTERM/SIGKILL)→ 用 killCode(超时 TIMEOUT / cancel CANCELLED,CA17);
  // 否则进程自己挂(中转 502/网络断)→ SUBPROCESS_CRASHED。
  const reason: SyluxErrorCode = signal != null ? killCode : 'SUBPROCESS_CRASHED';
  // 闸门前断 → gate 内部归一为 SPAWN_FAILED(不可 resume,CL-b);闸门后断 → 保留 reason(可 resume,CL-c/e)
  return gate.onFailure(reason, detail);  // gate 按相位改码(05 v2 §5.3)
}
```

要点:
- **绝不**把已收集的 delta 拼成 `final_message` 当成功——部分文本不是合 schema 的最终结构化输出,拼出来必过不了 `agentMessagePayloadSchema.safeParse`,反而污染黑板。partial 一律走 `error`,由引擎重试/降级。
- 残行(`splitter.flush()` 非空)= 进程在写一行 JSON 中途死,该残行**不 JSON.parse 强解**,只截断进 `detail` 供诊断(对齐 02 §7.3 jsonl 截断恢复哲学)。

### 8.4 schema 软约束模式下的重试链(接 §4.3 / 02 §8.4)

当 `SchemaPlan` 是 `append_prompt` / `stream_json_input`(CLI 不强制 schema,§4.3),`result.result` 可能不是干净 JSON(带围栏、解释、字段缺失)。失败链:

```
adapter.send → final_message{raw} → 引擎 agentMessagePayloadSchema.safeParse(raw)
   ├─ 成功 → validateMessage(02 §8) → 入黑板
   └─ 失败(OUTPUT_SCHEMA_VIOLATION)→ 引擎带错误详情重发(02 §8.4):
        prompt 追加"你上次输出不合 schema:<zod error 摘要>,请只输出合法 JSON"
        ≤N 次(02 §8.4 配额);耗尽 → 抛 OUTPUT_SCHEMA_VIOLATION,终止本轮(03 §8)
```

> 适配器**不做** JSON 清洗/提取(不剥围栏、不正则抠 `{...}`)——清洗会掩盖模型不守约,且易引入误解析。原样 `raw` 交引擎,让 safeParse + 重试做权威裁决(02 A6 / I2)。inline 模式(CLI 强制)下 `result.result` 本就干净,此链基本不触发;软约束模式才是此链高频路径,故 §4.2 优先级永远是"能 inline 就 inline"。

### 8.5 claude 失败分级总表(对齐 05 §5.2 三类时机)

| # | 时机 | 适配器观测 | emit | resumable | 引擎处置(03) |
|---|---|---|---|---|---|
| CL-a | spawn 即失败(exe 缺失/非 PE/EACCES) | child `error`,无 stdout | `error: SUBPROCESS_SPAWN_FAILED` | false | 首轮致命→aborted;非首轮不应发生(exe 已验) |
| CL-b | 起了但 `system/init` 前退出(参数被拒/中转 401/--bare 未生效崩) | exit 时 `!sawInit` | `error: SUBPROCESS_SPAWN_FAILED`(detail 带 exit+stderr) | false | 同 05 F-b:不可 resume,全新会话重来 |
| CL-c | `system/init` 后断流(中转 502/网络断/被 kill/超时) | session_started 已发,无 result | session_started(已发)+ `error: SUBPROCESS_CRASHED`/`CANCELLED` | **true** | 可 resume(sessionId);claude resume 便宜(CF-5) |
| CL-d | exit 0 但 `result.is_error`(max_turns/during_execution) | result 事件带 is_error | session_started(已发)+ `error: SUBPROCESS_CRASHED`(§8.2) | **true** | 可 resume;max_turns 可放宽 maxTurns 后续接 |
| CL-e | 超时(opts.timeoutMs 到点) | 计时器触发 killCode=TIMEOUT + proc.kill() | session_started(若已发)+ `error: SUBPROCESS_TIMEOUT`(CA17) | 视是否过 init | 同 CL-c 路径;人工 cancel 则为 `SUBPROCESS_CANCELLED` |

> 判别键 `sawInit`(claude 版的 `sawThreadStarted`):mapper 命中首个 `system/init` 即由 gate 经 `onThreadStarted` 置 `streaming`。exit 时 `awaiting_thread` → CL-a/b(不可 resume);`streaming` 但无 final → CL-c/d/e(可 resume)。这把 05 A2/I5 焊在两端共享的同一个 gate 里(`awaiting_thread` 是 05 v2 §5.3 的相位名,两端统一,不另造 `awaiting_session`)。

---

## 9. spawn shim 坑 + ClaudeAdapter 实现 + 进程树 kill

### 9.1 spawn 约束(CF-1/CF-2/CF-3,焊死)

```ts
import { spawn, type ChildProcess } from 'node:child_process';
// 注:buildChildEnv 的实际调用在 §9.3 run(env 单一出口);spawnClaude 只收算好的 env。

/** spawn claude.exe 的唯一正确姿势(对齐 codex 事实 A + claude CF-1/2/3 + 安全 08 S2/S5)。
 *  v3:env 由调用方(§9.3 run)经 buildChildEnv 预先算好传入(已并入 toClaudeInjection().env 的 key/base_url),
 *  spawnClaude 不再自己碰 input.providerEnv —— 保持「env 单一出口」在 run 一处(CA14)。 */
function spawnClaude(exePath: string, args: string[], env: Record<string, string>, workdir: string): ChildProcess {
  // ① 直调真实 exe(CF-1),绝不裸名 / .cmd(CF-2 踩 %* 打散)
  // ② args 必含 --bare(CF-3)或其兜底(§3.1.1);prompt 走 stdin(§9.3 feedStdin),不进 argv
  // ③ ★CA1 焊死:env 必经 buildChildEnv 包白名单(在 §9.3 run 算好),绝不裸传 input.providerEnv ——
  //    那只是 toClaudeInjection().env(ANTHROPIC_API_KEY/BASE_URL,07 §6.2),缺 SystemRoot/PATH/USERPROFILE
  //    等 base 变量,直接当 env 会让 claude.exe 起不来,且违反 08 S2/S5。
  const child = spawn(exePath, args, {
    cwd: workdir,                                            // claude cwd = worktree(配合 --add-dir)
    env,                                                     // ★A5/CA1:已是 buildChildEnv 出口(§9.3),含白名单 base + provider key
    windowsHide: true,                                       // 不弹窗(事实 A)
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,                                             // ★绝不 shell(CF-2:.cmd 打散 + shell 注入 process.env)
    // node spawn 传 env 即不继承 process.env(等价 extendEnv:false);若改用 execa 必显式 extendEnv:false(08 §2.3)
  });
  child.stdout!.setEncoding('utf8');   // UTF-8(Node 直捕,不经 shell 重定向,避 UTF-16 乱码,事实 A)
  child.stderr!.setEncoding('utf8');
  return child;
}

/** 喂 prompt 到 stdin 并关闭。★CA4(对齐 05 A4):进程已死时 write 抛异步 EPIPE,
 *  必挂 stdin 'error' 吞掉,转为流内 onFailure,绝不让未捕获 EPIPE 崩 Node。 */
function feedStdin(child: ChildProcess, payload: string, onPipeError: (e: Error) => void): void {
  const stdin = child.stdin!;
  stdin.setDefaultEncoding('utf8');
  stdin.on('error', (e: Error) => {
    // EPIPE/ERR_STREAM_DESTROYED:进程在我们写完前已退出 → 交 pipeline 当 spawn_error/exit 处理
    if ((e as NodeJS.ErrnoException).code === 'EPIPE') onPipeError(e); else onPipeError(e);
  });
  stdin.write(payload, (err) => { if (!err) stdin.end(); });  // write 回调有 err 时不再 end(避免二次抛)
}
```

> **spawn 前 argv 泄密预扫描(A4,05 §6.4)**:`assertArgvNoSecret(args)`(**复用** 05 的实现,内部用 08 §2.4 权威 `SECRET_SIGNATURES`,不各自维护 `KEY_PATTERNS`)对最终 args 扫 `sk-`/`sk-ant-`/`ANTHROPIC_API_KEY=`/长 base64,命中即抛 `PROVIDER_CONFIG_INVALID`。claude 不用 `-c`,但 `--settings <JSON>`(07 §6.2)/ `--append-system-prompt` 可能误塞 key,**必扫**(安全 08)。命中时 detail 只留前 8 字符提示,不回显全值(08 S1 脱敏)。

### 9.2 进程树 kill(claude.exe 是原生 PE,无 node 子树,但仍防御)

CF-1 实测 claude.exe 是**单个原生二进制**(不像设想的 node→cli.js 双层),理论上 kill 直接子进程即可。但它内部可能 spawn 工具子进程(Bash/PowerShell 等),故仍走进程树 kill(复用 05 §10 `tree-kill.ts`):

```ts
/** cancel():杀进程树。复用 05 proc/tree-kill.ts(Windows: taskkill /T /F /PID;posix: kill -TERM 进程组)。 */
async function cancel(child: ChildProcessHandle): Promise<void> {
  if (!child || child.killed) return;        // 幂等(05 §3.1 cancel 契约)
  await treeKill(child.pid);                  // 含工具子进程
  // 被取消的流以 {kind:'error', code:'SUBPROCESS_CANCELLED'} 收尾(gate.onFailure,05 §10.2)
}
```

### 9.3 ClaudeAdapter 实现骨架(send/resume/cancel,实现 05 §3 接口)

对齐 05 v2 三处硬化:**CA5** 监听器同步挂载 + LineQueue;**CA6** 单进程在飞断言;**CA7** `hardTimeoutCeilingMs` 兜底。

```ts
import type { AgentAdapter, AgentInput } from '../adapter.js';  // 05 拥有
import type { AgentEvent, SyluxErrorCode } from '@sylux/shared';
import type { ProviderConfig, KeyStore, ClaudeInjection } from '@sylux/providers';  // 07 §2/§3/§6 权威
import { toClaudeInjection } from '@sylux/providers';            // 07 §6.2 三参权威(cfg, keystore, ov?)
import { buildChildEnv, redact } from '@sylux/security';         // 08 §2.2 / §3 权威
import { FirstEventGate } from '../normalize/gate.js';           // 05 v2 §5.3
import { LineSplitter, LineOverflowError } from '../normalize/ndjson.js';

/** CA7:兜底超时;★CA14:构造期收 keystore(对齐 05 V3b)。 */
export function createClaudeAdapter(opts: {
  exePath?: string;
  provider: ProviderConfig;     // provider 绑定;热换走引擎重建 adapter(07 §8.1 P4)
  keystore: KeyStore;           // ★CA14:密钥解析器,构造期注入;run 时 toClaudeInjection 用,仅活内存(07 §8.4)
  hardTimeoutCeilingMs?: number;
}): AgentAdapter {
  const exePath = resolveClaudeExe(opts.exePath);   // 构造期解析(§2),失败提前抛 SUBPROCESS_SPAWN_FAILED
  const ceiling = opts.hardTimeoutCeilingMs ?? 10 * 60_000;  // 兜底 10min(0/undefined→不兜底)
  const needHooksDisable = !BARE_FLAG_AVAILABLE;    // §3.1.1 M0-8 探测结果;--bare 命中→false(hooks 已关)
  let current: ChildProcess | null = null;          // CA6:同一时刻至多一个在飞

  function run(input: AgentInput, sessionId: string | undefined): AsyncIterable<AgentEvent> {
    // ── CA6 并发护栏:current 非空即调用方 bug(引擎 03 保证串行),抛而非静默排队 ──
    if (current) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'ClaudeAdapter 已有进程在飞(并发 send/resume 违约,03 串行契约)');

    // ── ★CA14 provider 注入(07 §6.2 三参,merge 内置 07):一步算 {flags, settingsFragment, env}。
    //    key 解析失败 → 闸门前失败,不伪造 session_started(A2)。env 是唯一含 key 的字段。──
    let inj: ClaudeInjection;
    try { inj = toClaudeInjection(opts.provider, opts.keystore, input.providerOverrides); }
    catch (e) {
      const code = (e as SyluxError).code ?? 'PROVIDER_CONFIG_INVALID';
      return (async function* () { yield { kind: 'error', code, detail: String((e as Error).message) }; })();
    }

    // ── argv 拼装(§3.2/§3.3:push inj.flags + §3.1.2 单次 --settings + §4 schema)──
    const built = sessionId === undefined
      ? buildClaudeSendArgs(input, inj, needHooksDisable)
      : buildClaudeResumeArgs(sessionId, input, inj, needHooksDisable);
    const args = built.args;
    const payload = renderPayload(input, built.schemaPlan);
    assertArgvNoSecret(args);                        // A4 泄密预扫描(08 §2.4 SECRET_SIGNATURES)

    // ── ★CA1/A5 env 单一出口:input.providerEnv(若引擎仍传)∪ inj.env(key/base_url)经 buildChildEnv 包白名单 ──
    const env = buildChildEnv({ providerEnv: { ...input.providerEnv, ...inj.env }, agentId: 'claude' });

    const child = spawnClaude(exePath, args, env, input.workdir);
    current = child;

    // ── CA5 同步挂监听 + 填 LineQueue(在返回惰性 generator 之前,杜绝首个 system/init 竞态)──
    const splitter = new LineSplitter();
    const q = makeLineQueue();                       // 内部:push(signal) / next():Promise<LineSignal>
    const stderrRing = makeStderrRing(STDERR_RING_BYTES);  // §8.1 有界环形(CA3)
    let killCode: SyluxErrorCode = 'SUBPROCESS_CANCELLED';  // ★CA17:超时改写为 TIMEOUT,人工 cancel 保持 CANCELLED
    child.stdout!.on('data', (c: string) => {
      try { for (const ln of splitter.push(c)) q.push({ kind: 'line', text: ln }); }
      catch (e) { if (e instanceof LineOverflowError) { q.push({ kind: 'overflow', bytes: e.bytes }); child.kill(); } else throw e; }
    });
    child.stderr!.on('data', (c: string) => stderrRing.push(c));
    child.on('error', (e) => q.push({ kind: 'spawn_error', detail: String(e?.message ?? e) })); // CL-a
    child.on('close', (code, signal) =>
      q.push({ kind: 'exit', tail: splitter.flush(), stderrTail: redact(stderrRing.value()), code, signal, killCode })); // CA10 redact

    // ── CA7/★CA17 超时:input.timeoutMs ?? ceiling;到点杀树,标 killCode=TIMEOUT,close 走 exit→TIMEOUT ──
    const timeoutMs = input.timeoutMs ?? ceiling;
    const timer = timeoutMs ? setTimeout(() => { killCode = 'SUBPROCESS_TIMEOUT'; void treeKill(child.pid); }, timeoutMs) : undefined;

    // ── CA4 喂 stdin(EPIPE 转 spawn_error)──
    feedStdin(child, payload, (e) => q.push({ kind: 'spawn_error', detail: `stdin ${(e as any).code ?? ''} ${e.message}` }));

    const gate = new FirstEventGate(sessionId);      // resume 预置 sessionId(A9);send 传 undefined
    return (async function* () {
      try { yield* normalizeStream(q, claudeMapper, gate); }
      finally { if (timer) clearTimeout(timer); if (current === child) current = null; }
    })();
  }

  return {
    id: 'claude',
    send(input: AgentInput): AsyncIterable<AgentEvent> {
      return run(input, /*sessionId*/ undefined);    // §3.2 argv 在 run 内拼;send 不 seed gate(A1 以观测 init 为准)
    },
    resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> {
      if (input.ephemeral) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'ephemeral 会话不可 resume(A7)'); // §8.5
      // claude resume 每事件仍带 session_id,是否重发 system/init 待 M0-7;为与 codex 对称且不依赖该行为,
      // seed gate(A9)进流立刻补发 session_started;真 init 再来由 onThreadStarted 幂等吞掉(§6.4)。
      return run(input, sessionId);
    },
    async cancel(): Promise<void> {
      if (current) await treeKill(current.pid);   // §9.2;killCode 默认 CANCELLED,流由 close→exit 收尾
      // current 的释放在 run 的 finally(消费侧拉完);cancel 只触发 kill,不直接清 current(防与在飞 generator 抢)
    },
  };
}
```

> **renderPayload**:`schemaPlan.mode==='stream_json_input'` 时返回 `JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text: prompt + schemaInstruction}]}})+'\n'`(§4.4),且 `args` 已被 `planJsonSchemaArg` 切到 `--input-format stream-json`;否则返回纯 `input.prompt`(text 模式,schema 已在 argv 或 append-prompt 里)。
>
> **CA14 注入链对账 05/07**:与 05 v3 `CodexAdapter.run` 同构——adapter **构造期**持 `provider`+`keystore`,**run 时**调 `toClaudeInjection(provider, keystore, ov)` 一步算 `{flags, settingsFragment, env}`(merge 内置 07,adapter **不自** `mergeProviderOverrides`)。`input.providerEnv` 仍合并进 `buildChildEnv`(引擎若经 07 §7.2 `buildAgentProviderInput` 预置了 `providerEnv`,二者并集;若引擎改为「只传 overrides、env 由 adapter 算」则 `input.providerEnv` 为空,inj.env 兜底)——两条路径都焊在「env 单一出口 = run 里这一次 `buildChildEnv`」。
>
> **CA17 超时 vs cancel 分码**:`killCode` 默认 `SUBPROCESS_CANCELLED`;仅超时计时器触发时改写为 `SUBPROCESS_TIMEOUT`(02 v2.1 §12 已登记两码)。`gate.onFailure` 在 exit 路径据 `killCode` 选码(§8.1/§8.3 信号已带 `killCode`),与 05 V3f 对称。人工 `cancel()` 不动 `killCode`,故收尾码为 CANCELLED。
>
> **CA6 与 cancel 的 current 释放纪律**:`current` 由 `run` 的 `finally`(generator 消费结束)释放,`cancel()` 只 `treeKill` 不清 `current`——否则 cancel 与在飞 generator 会抢 `current`,可能让下一个 `run` 误判无进程在飞。引擎(03)对同一 adapter 串行消费,cancel 后必把该 generator 拉到结束(收到 error),`finally` 自然释放。

### 9.4 claude vs codex spawn 差异速查

| 维度 | codex(05) | claude(本文件) |
|---|---|---|
| 真实 exe | 平台子包 vendor bin(分平台,§05.4) | 主包 `bin/claude.exe`(不分平台,§2) |
| 启动层数 | 单原生 exe | 单原生 exe(CF-1,非 node→cli.js) |
| prompt 通道 | stdin(argv `-` 占位) | stdin(`-p`,argv 不占位)/ stream-json 输入(§4.4) |
| 清场 flag | (codex 默认较干净) | **必带 `--bare`**(CF-3,否则 35× 噪声) |
| schema 通道 | 文件 `--output-schema <FILE>` | 内联 `--json-schema <串>`,超限三级降级(§4) |
| session id | 自生成 `thread.started.thread_id`(只首行) | 每事件 `session_id`,可 `--session-id` 预设(CF-4) |
| sandbox flag | exec `-s`;resume 拒 `-s`(事实 E) | `--permission-mode`;resume 仍可带(本设计重传同值) |
| workdir | exec `-C`;resume 不传(事实 E) | `--add-dir` + spawn cwd;resume 重传同值 |
| resume 成本 | 全量重计费(事实 D) | prompt 缓存,cache_read 折价(CF-5) |

---

## 10. 测试矩阵(claude 端 + 归一化层,交付验收锚点)

用 `fixtures/fake-claude.mjs`(吐固定 stream-json 行的假 exe,经真 `.cmd` 包一层验证 spawn 链,对齐 05 fake-codex)+ vitest。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| C1 | LineSplitter 半行跨 chunk | `'{"a":1'` 后 `'}\n'` 两 chunk | 合成一行 `{"a":1}` |
| C2 | LineSplitter CRLF | 行以 `\r\n` 结尾 | 去 `\r`,行体正确 |
| C3 | LineSplitter 残行 flush | 末行无 `\n` | `push` 不产出,`flush()` 返回残行 |
| C4 | claudeMapper init→session | `{"type":"system","subtype":"init","session_id":"u"}` | `{t:'session',sessionId:'u'}` |
| C5 | claudeMapper hook 噪声丢弃 | `{"type":"system","subtype":"hook_started",...}` | `{t:'ignore'}` |
| C6 | claudeMapper assistant text | `{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}` | `{t:'text_delta',text:'hi'}` |
| C7 | claudeMapper tool_use | content 含 `{type:'tool_use',name,input}` | `{t:'tool',name,args}` |
| C8 | claudeMapper result success | `{"type":"result","subtype":"success","result":"{...}","usage":{...}}` | `{t:'final',raw,usage}` |
| C9 | claudeMapper result error_max_turns | `subtype:'error_max_turns'` | `{t:'fatal',code:'SUBPROCESS_CRASHED'}` |
| C10 | gate session 恰一次 | 两条 init(重复 session_id) | 仅首条产 `session_started`,次条 null(A1) |
| C11 | gate init 前崩 | exit `awaiting_session` | `error: SUBPROCESS_SPAWN_FAILED`,无 session_started(A2/CL-b) |
| C12 | gate init 后断流 | session 后无 final,exit | session_started + `error: SUBPROCESS_CRASHED`,resumable(CL-c) |
| C13 | 超时 | timeoutMs 到点 | proc.kill + `error: SUBPROCESS_CANCELLED`(CL-e) |
| C14 | 部分输出不拼 final | init+若干 delta,无 result | 不产 final_message,只产 error(§8.3) |
| C15 | usage 归一(缓存) | `cache_read=1000,input=100,cache_create=50` | `{inputTokens:150,cachedInputTokens:1000,...}`(§7.1) |
| C16 | schema inline 一级 | 小 schema | argv 含 `--json-schema <串>`,SchemaPlan inline |
| C17 | schema 超预算二级 | schema 串 >8KB | 不含 `--json-schema`,`--append-system-prompt` 含 schema,mode append_prompt |
| C18 | schema 命令行顶爆三级 | append 后仍超 30KB | mode stream_json_input,`--input-format stream-json`,argv 无长串 |
| C19 | 软约束 raw 不清洗 | result.result 带 ```围栏 | raw 原样含围栏(适配器不剥,§8.4) |
| C20 | argv 泄密扫描 | `--settings` 含 `sk-xxx` | 抛 `PROVIDER_CONFIG_INVALID`(A4) |
| C21 | resume argv | resume(sid,input) | 含 `--resume <sid>`,无新 `--session-id`,sandbox/workdir 重传(§3.3) |
| C22 | 端等价(归一化对齐) | 同语义 codex 流 vs claude 流喂各自 mapper | 产出 AgentEvent 序列同构(session_started→...→final)(§6.5) |
| C23 | spawn 链(真 .cmd→fake exe) | 经 .cmd shim 传带空格 prompt | 验证**必须走 stdin**(.cmd argv 传会被打散,CF-2) |
| C24 | --bare 缺失检测 | M0 对比 init 前是否有 hook 事件 | 文档断言 `--bare` 必带(CF-3) |
| C25 | **env 经 buildChildEnv(CA1)** | spawn 时 `process.env` 含 `FOO_TOKEN=sk-x` | 子进程 env **无** `FOO_TOKEN`;**有** `SystemRoot`/`PATH`/`ANTHROPIC_API_KEY`(白名单+providerEnv,08 SEC1/2) |
| C26 | **单行溢出(CA3)** | 喂一条 >1MiB 无 `\n` 的行 | `LineSplitter.push` 抛 `LineOverflowError` → 流 `error: SUBPROCESS_CRASHED`,进程被 kill |
| C27 | **stdin EPIPE(CA4)** | 进程在 write 前已退出 | 不崩 Node;stdin 'error' → 流 `error`(spawn_error/exit 路径) |
| C28 | **首事件不丢(CA5)** | fake exe spawn 后**立即**吐 init(早于 for await) | session_started 不丢(监听器同步挂 + queue) |
| C29 | **并发护栏(CA6)** | 未消费完前再调 send/resume | 抛 `SUBPROCESS_SPAWN_FAILED`(current 非空,串行违约) |
| C30 | **兜底超时(CA7)** | input 不传 timeoutMs,fake hang | 到 `hardTimeoutCeilingMs` 杀树,流 `error: SUBPROCESS_CANCELLED` |
| C31 | **H7 strict 拒绝(CA9)** | strictness='strict_reject',小 schema | **不**走 inline,直接 append_prompt 软约束(§4.5) |
| C32 | **ephemeral⊥resume(CA12)** | `resume(sid, {ephemeral:true})` | 抛 `SUBPROCESS_SPAWN_FAILED`(A7,§8.5) |
| C33 | **resume seed gate(A9)** | resume 进流、init 未到 | 立刻补发 session_started(primeIfSeeded);真 init 到达被幂等吞 |
| C34 | **stderr 不进事件流 + redact** | stderr 喷含 `sk-` 报错 | 不当 delta/final;进 error.detail 前过 redact,无明文 key(CA10/08 S1) |
| C35 | **单一 --settings(CA15)** | provider extraConfig `{effort:'high'}` + needHooksDisable=true | argv 恰一个 `--settings`,其 JSON deep-merge 含 `disableAllHooks:true` 与 effort;无第二个 --settings |
| C36 | **--settings + schema 体积共账(CA15)** | 大 extraConfig 占满预算后再加 schema | schema 降级判定吃到 settings 占用(`planJsonSchemaArg` 在 settings 之后);总命令行 < CMDLINE_SAFE_LIMIT |
| C37 | **toClaudeInjection 三参(CA14)** | createClaudeAdapter({provider,keystore}); send | run 调 `toClaudeInjection(provider,keystore,ov)`;flags(--model)进 argv;env(ANTHROPIC_API_KEY)进 buildChildEnv |
| C38 | **key 解析失败闸门前(CA14)** | keystore.resolve 抛 | 只 emit `error: PROVIDER_CONFIG_INVALID`,**无** session_started(A2);不 spawn |
| C39 | **超时码 TIMEOUT 非 CANCELLED(CA17)** | input.timeoutMs 到点 | `error: SUBPROCESS_TIMEOUT`(非 CANCELLED);人工 cancel() 才 CANCELLED |
| C40 | **MAX_JSONL_LINE_BYTES 来自 02(CA13/B1)** | import 断言 | 值=512KiB(`@sylux/shared`);本文件无本地 `export const MAX_JSONL_LINE_BYTES`(grep 零命中) |

### 10.1 fake-claude.mjs 契约

```js
// fixtures/fake-claude.mjs:读 argv 决定吐哪组固定行,模拟成功/崩溃/超时/错误 subtype。
// 经 fixtures/fake-claude.cmd 包一层(真 .cmd),验证 §9.1 spawn 链与 CF-2 stdin 约束。
// 支持环境变量 FAKE_MODE=success|crash_before_init|crash_after_init|max_turns|hang(超时)
//   |partial|overflow(吐巨型无换行行,测 CA3)|init_first(spawn 即吐 init,测 CA5)。
```

---

## 11. M0 实测清单(本文件遗留【待实测】项,开工前确认)

| # | 待测项 | 命令/方法 | 影响 |
|---|---|---|---|
| M0-1 | `buildAgentOutputJsonSchema()` 内联串长度 | `node -e "console.log(JSON.stringify(buildAgentOutputJsonSchema()).length)"` | 定常态走 §4 哪级(预期 inline) |
| M0-2 | claude stream-json **输入** user message 字段形 | `printf '<json>' \| claude.exe -p --bare --input-format stream-json --output-format stream-json --verbose --replay-user-messages` | 焊死 §4.4 三级输入通道字段 |
| M0-3 | `--json-schema` 经中转是否强制成形 + **strict 兼容档** | inline 小 schema(含 evidence anyOf)实跑,看 `result.result` 是否合 schema、是否报 strict 拒 | 确认 inline 强制力 + §4.5 `SchemaStrictness` 取值(strict_reject?) |
| M0-4 | resume 缓存命中实测 | 同 sessionId 两轮,比对 `cache_read_input_tokens` | 校准 §7.3 cache_read 单价(04 cost-model pricing 用真账单定) |
| M0-5 | posix 平台 exe 形态 | linux/mac 装 claude 看 bin 形态 | 补 §2.2 `CLAUDE_BIN` posix 分支 |
| M0-6 | `--permission-mode plan` 是否真只读 | read-only 映射跑改文件任务,验证无落盘 | 确认 §3.3 沙箱映射安全(08) |
| M0-7 | claude resume 是否真接受 `--add-dir`/`--permission-mode`,**是否重发 system/init** | resume 带这俩 flag 实跑;观察是否再吐 init | 确认 §3.3「重传同值」可行 + §9.3 seed gate 是否必要(若重发 init 则 seed 是双保险) |
| M0-8 | **`--bare` flag 存在性(CA11)** | `claude --help \| grep -- --bare` | 命中则焊死必带(`BARE_FLAG_AVAILABLE=true`,§9.3 `needHooksDisable=false`);未命中启用 §3.1.1 兜底 |
| M0-9 | **`--settings` 是否收文件路径变体 + 内联体积(CA15)** | 实跑 `--settings @file.json` 或超 6000 字符内联看是否报错 | 定 §3.1.2 `SETTINGS_INLINE_BUDGET` 超限降级路径(文件变体 or 剔 extraConfig);对齐 07 §6.3【待实测】 |

---

## 12. 回填项(本文件相对 05 / 02 / 04 / 07 的增强,均向后兼容)

1. **回填 05 §2 `AgentInput`(已闭合)**:claude 专属可选字段 `appendSystemPrompt?` / `effort?` / `maxTurns?` 与 `ProviderOverrides.fallbackModel?` ——**05 v3 §2 已纳入**(标 V3c,见 05 §2 字段表),本条闭合;06 只消费不重定义。
2. **回填 05 §5.3 `FirstEventGate`(CA2 修正版)**:本文件**不凭空假设** `onSession`/`passthrough`/`isTerminal`(v1 误用)。claude 端复用 05 v2 真实 API(`onThreadStarted`/`primeIfSeeded`/`onFinal`/`onFailure`/`resumable`),delta/tool_call 不经 gate 直发(§6.4)。**可选**增强提案(需 05 同意):把 `onThreadStarted` 改名 `onSession`(留 `@deprecated` 别名)去 codex 语义味,**非必须**——两端已能共用现有 API。
3. **回填 02 §6.2 的【待实测】**:claude `--json-schema` 内联串体积**确有逼近上限风险**(M0-1);claude 强制成形**非无条件**——两条独立轴:① 长度超限(§4.2)② strict 后端拒 anyOf/optional(§4.5,对齐 02 H7),均退化为软约束,放大 02 I2 safeParse 兜底重要性。
4. **回填 04(刹车/成本模型)**:成本模型**必须分端**——codex 全量累积(事实 D,仅 resume regime),claude prompt 缓存折价(CF-5);本文件 §7.3 给 `TokenUsage` 分端**口径**(两端归一成同一形状),真实单价/cache_read 折扣归 04 §6.2 `cost-model` 的 `pricing`,M0-4 真账单校准。
5. **回填事实 F(PROBED-FACTS §F)**:CF-1~CF-6 六条本机实测修正/补充(§0.3),尤其「claude 是 `.cmd→.exe` 非 `.ps1/cli.js`」「headless 必带 `--bare`(+§3.1.1 兜底)」「`--session-id` 预设确认存在」「usage 缓存语义与 codex 不对称」。建议把 §0.3 表回灌 PROBED-FACTS.md 的 F 节。
6. **错误码依赖(CA8 修正版 / 已闭合)**:本文件未**新增**错误码;所用 `SUBPROCESS_CRASHED`/`SUBPROCESS_TIMEOUT`/`SUBPROCESS_CANCELLED`/(P3 阶段的)`INJECTION_BLOCKED` **均已在 02 v2.1 §12 `SyluxErrorCode` union**(02 §15.x 回填表确认,x-consistency A1 闭合)——v2 称「需回填/不在 union」的措辞**已过期**,v3 更正为「已登记,直接引用」。`error_max_turns` 复用 `SUBPROCESS_CRASHED` + detail 区分,不增新码。`INJECTION_BLOCKED` 由引擎 P3 emit,**不**由本适配器 emit(§6.6 边界)。
7. **回填 08 / 07 env 签名一致性(CA1 / 已闭合)**:`buildChildEnv` 权威签名是 08 §2.2 的**单对象** `buildChildEnv({providerEnv, agentId})`;**07 v2 §7.1 已对齐单对象签名**(07 §28 V2 修正,x-consistency B2 闭合)——v2 §12.7 称「07 仍双位参」的回填提示**已过期**,v3 删除该提示。本文件按单对象签名实现。
8. **回填 07 注入对账(CA14/CA15,07 v2 §1139 点名 06)**:① `toClaudeInjection(cfg, keystore, ov?)` 三参,**adapter 不再自己 merge**(merge 内置 07);② `createClaudeAdapter` 构造期收 `keystore`(§9.3);③ claude 端 `--settings` 由 **06 唯一拼装**:`deep-merge(settingsFragment, hooksDisableFragment)` 后单次注入(§3.1.2,消除 v2 双写覆盖 bug);④ `ProviderOverrides.extraConfig`(07 §3 权威,过 07 §3.4 白名单)经 `settingsFragment` 流入 `--settings`。这四条 07 v2 §1139 已声明「需回填 06」,v3 **本文件已落地**,与 07 对账闭合。
9. **回填 02 编号订正(CA16,x-consistency C-NUM)**:本文件 v2 个别处把安全(`redact`/内容防火墙)误标「09」;08=安全、09=worktree(07 v2/08 v2 已订正)。v3 全文统一为 08,§6.6/§8.3/§9.3 已订正;此条与全仓编号双轨制的最终收口仍由定稿总控(列入 openQuestions)。

---

## 13. 收尾:本文件权威性声明

1. **claude 端唯一实现源**:claude 的 exe 解析、argv 拼装、stream-json 解析、schema 三级降级、失败分级,有且只有本文件定义;05 拥有 `AgentAdapter`/`AgentInput` **接口**,本文件**只实现不重定义**。
2. **归一化层两端共享**:`LineSplitter`(§6.2,含 `MAX_JSONL_LINE_BYTES` 护栏——**v3 该常量 import 自 02 §5.3=512KiB,不重声明**,B1/CA13)、`ParsedLine`(§6.3)、`normalizeStream`(§6.4)是 codex+claude **共用**,pipeline 对端**零分支**;`FirstEventGate`(05 v2 §5.3)单一定义、本文件复用不重写。换 CLI 只换一个 `LineMapper`(~50 行)。这是「两端解析归一化」的兑现。
3. **类型/常量一律引用 02**:`AgentEvent`/`TokenUsage`/`Message`/`agentMessagePayloadSchema`/`SyluxErrorCode`/`MAX_JSONL_LINE_BYTES` 等以 `@sylux/shared` 引用,本文件零 zod 定义、零共享常量重声明(守 02 I1;v2 重声明 `MAX_JSONL_LINE_BYTES` 的 B1 违规已删)。
4. **provider 注入引用 07(v3)**:`toClaudeInjection(cfg, keystore, ov?)` 三参、`ClaudeInjection.{flags,settingsFragment,env}`、`ProviderOverrides`/`KeyStore` 全部权威在 07,本文件**只消费**;`createClaudeAdapter` 构造期收 `keystore`,`--settings` 由本文件唯一拼装(deep-merge settingsFragment+hooksDisable,§3.1.2,V4/CA15)。
5. **不对称已吃进适配器**:启动(分平台 vs 主包 bin)、prompt 通道(stdin vs stream-json)、schema(文件 vs 内联三级 + strict 第二轴)、session id(自生成 vs 预设)、resume 成本(全量 vs 缓存)五大不对称全部封装在适配器内部,引擎侧 `for await (AgentEvent)` 代码两端零差异。
6. **安全/健壮性焊死(v2→v3)**:env 必经 `buildChildEnv` 单对象签名(CA1,v3 在 run 一处出口并入 inj.env)、stdin EPIPE 吞噬(CA4)、监听器同步挂载防首事件竞态(CA5)、单进程在飞断言(CA6)、兜底硬超时 + 超时/取消分码 TIMEOUT/CANCELLED(CA7/CA17)、单行无界缓冲护栏(CA3,512KiB 自 02)、内容防火墙/`redact` 边界归属(CA10,实现归 **08**,CA16 订正)、key 解析失败闸门前不伪造 session_started(CA14)——全部对齐 05 v2/v3 A1–A9 与 08 S1/S2/S5。
7. **演进纪律**:本文件不引入持久化字段,无 `SCHEMA_VERSION` 影响;新增的 `AgentInput` 可选字段(已并入 05 v3)向后兼容;`FirstEventGate` 改名为**可选提案**(§12.2),未落地前用现有 API。M0 清单(§11)九项实测落档后,移除对应【待实测】标注。
8. **v3 吃掉的具名 findings**:x-consistency B1(MAX_JSONL_LINE_BYTES 重声明,🔴)、B2(buildChildEnv 双位参过期回填,已闭合)、A1(错误码 union,已闭合)、C-NUM(08/09 编号订正)、D13(AgentInput claude 字段,已闭合);07 v2 §1139 点名 06 的四条注入对账(三参 toClaudeInjection / 构造期 keystore / 单一 --settings / extraConfig 白名单)全部落地。
