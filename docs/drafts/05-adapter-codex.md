# 05 · AgentAdapter 接口 与 codex 适配器(权威)v3

> **版本**:v3(2026-06-20,run-tag v3.1)。相对 v2 的硬化点见 §0.6;v2 相对 v1 见 §0.5。本批五份具名红队/交叉报告(x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost)**已在仓内产出**(`docs/drafts/x-*.md`、`red-*.md`),v3 据其针对本节的 findings 逐条吃掉(v2 曾误判报告缺失,已订正)。核对源:02(类型权威)、03(引擎)、07(provider)、08(安全)、06(claude 端,对称回填来源)、PROBED-FACTS。所有跨文签名/编号冲突已就地修正或标注。
>
> **跨文档编号(读前必看,v3 已统一为磁盘文件名编号)**:v2 曾用「逻辑编号」(security=09、worktree=06、brakes=07…),与 06/07 收敛后的**文件名编号**不一致(C-NUM blocker)。v3 全面对齐 06/07,一律用**磁盘文件名编号**引用兄弟文档:类型 **02**、引擎 **03**、刹车/收敛 **04**、本文件 codex 适配 **05**、claude 适配 **06**、provider **07**、安全/防火墙 **08**、worktree 隔离 **09**。下文凡出现 03/04/06/07/08/09 均指同名磁盘文件,不再有「逻辑号 ≠ 文件号」的二义。
>
> **本文件地位**:`@sylux/agents` 子进程适配层的权威设计。拥有 **`AgentAdapter` 接口**(行为契约)与 **codex 端**的精确 spawn / 事件流解析 / 失败路径。claude 端单独成文(`06-adapter-claude.md`),本文件给出对称位置但不展开其内部。
>
> **类型与共享工具一律引用上游**:`AgentEvent` / `TokenUsage` / `AgentMessagePayload` / `Message` / `agentMessagePayloadSchema` / `buildAgentOutputJsonSchema` / `SyluxErrorCode` 等全部类型与错误码,以 `@sylux/shared`(权威源 `docs/drafts/02-blackboard-types.md` §6/§12)引用,**本文件不另定义任何 zod**;`ProviderConfig` / `ProviderOverrides` / `KeyStore` / `toCodexInjection` / `mergeProviderOverrides` 引用 **07**(`@sylux/providers`);`buildChildEnv` / `SECRET_SIGNATURES` / `assertArgvNoSecret`(签名集)规则引用 **08**(`@sylux/security`)。本文件只定义**接口**(`AgentAdapter` / `AgentInput`)与 **codex 端实现规格**。
>
> **事实地基**:spawn(A)、事件流(B)、output-schema(C)、resume 成本(D)、resume 参数集(E)、claude flag(F)全部以 `docs/PROBED-FACTS.md` 为准。凡本机已实测项**不再标**【待实测】;仅未覆盖项标注。
>
> **与总体规划 §4 的差异(需回填修正)**:master-plan §4.1/§4.2 当前写的是 `execa('codex', ['exec', ..., '-C', workdir, '-s', sandbox, ...])`。这与事实 A(裸名 `codex` 是 bash shim,无法 spawn;`.cmd` 打散带空格参数)、事实 E(`exec resume` **拒** `-s`/`-C`)**直接冲突**。本文件以事实地基为准重写为「直调真实 exe + prompt 走 stdin + exec/resume 两套参数」,并在 §11 列出对 §4 的回填项。接口方法名 master-plan §4.1 叫 `kill()`,本文件按任务定为 `cancel()`,`kill` 保留为弃用别名(§3.4)。

### 0.5 v2 相对 v1 的硬化点(变更摘要)

| # | 主题 | v1 问题 | v2 修正 | 章节 |
|---|---|---|---|---|
| A1 | `buildChildEnv` 签名对不上安全 08 | v1 写 `buildChildEnv(provider, providerEnv)`(双位参 + 错误首参) | 改用 08 §2.2 权威单对象签名 `buildChildEnv({providerEnv, agentId})`;焊死 S2 | §8.3 |
| A2 | resume 不发 thread.started 则永卡 | v1 假设 resume 也会吐 `thread.started` 首行;若 codex resume **不**重发,`session_started` 永不 emit,流违反 A1、引擎拿不到 sessionId | resume **预置 gate**(已知 sessionId 入构造),进流即合成 `session_started`;真 `thread.started` 再来则幂等吞掉 | §5.5、§7.3、§8.2 |
| A3 | 生成器惰性 → 首事件竞态 | v1 在 `for await` 前 `feedPromptStdin`,但 AsyncGenerator 体到首次拉取才执行 → 监听器晚于 stdin 写入,可能丢 `thread.started` | 监听器**同步**在 spawn 后立即挂(不进生成器体),事件入 queue;喂 stdin 在挂监听之后 | §7.3、§8.2 |
| A4 | stdin EPIPE 未捕获 | 进程已死时 `stdin.write` 抛异步 EPIPE → 未捕获崩 Node | `feedPromptStdin` 挂 `stdin.on('error')` 吞 EPIPE,转 gate.onFailure | §8.1 |
| A5 | POSIX 进程树 kill 缺 detached | `treeKill` 走 `process.kill(-pid)` 需 spawn 时 `detached:true`,v1 spawnCodex 没设 | spawnCodex 按平台加 `detached`(POSIX),Windows 不设 | §8.1、§10.2 |
| A6 | 无界缓冲(DoS) | LineSplitter.buf / stderr 捕获 / event queue 均无上限,超大单行或刷屏 stderr 撑爆内存 | LineSplitter 单行超 `MAX_JSONL_LINE_BYTES` 即 emit error;stderr 环形缓冲末 N KiB;stdout 背压 pause/resume | §7.2、§7.5 |
| A7 | 错误码 SUBPROCESS_CRASHED/CANCELLED 未登记 | 二者用于事件流但不在 02 §12 `SyluxErrorCode` union(虽 `AgentEvent.error.code` 是开放 string,引擎 03 已按名分支) | §11 增回填项:02 §12 union 补这两码;本文件明列其语义 | §5.2、§11 |
| A8 | ephemeral 与 resume 互斥未声明 | 首轮 `ephemeral:true` 不落盘 → resume 找不到会话 | 显式声明互斥:ephemeral 会话 `resumable` 恒 false,引擎不得 resume | §2.1、§8.4 |
| A9 | 并发 run 无护栏 | `this.current` 在飞时再调 send/resume 行为未定义 | run 入口断言:`current` 非空即抛(引擎 03 保证串行,违约即 bug) | §8.2、§8.4 |
| A10 | timeout 无兜底上限 | 引擎不传 `timeoutMs` 时 codex 挂死可永久阻塞 | 构造期可配 `hardTimeoutCeilingMs` 兜底,input 未给则取它 | §3.2、§8.2 |
| A11 | pushProviderConfig 与 provider 07 重复/缺 env_key | v1 在 §6.3 自拼 `-c`,与 07 `toCodexInjection` 重叠且漏 `env_key` 行 | §6.3 收敛为调用 07 `toCodexInjection` 的 `cArgs`(含 env_key),本文件不另拼 | §6.3 |

### 0.6 v3 相对 v2 的硬化点(吃掉具名红队/交叉报告 findings)

| # | findings 来源 | v2 问题 | v3 修正 | 章节 |
|---|---|---|---|---|
| V3a | x-consistency D9 / 07 V3(blocker) | `toCodexInjection(merged)` 单参,与 07 §5.2 权威三参 `(cfg, keystore, ov?)` 冲突,过不了 07 类型守卫且 key 解析无 keystore | 改 `toCodexInjection(this.provider, this.keystore, input.providerOverrides)`;**adapter 不再自己 `mergeProviderOverrides`**(merge 内置 07);本文件 §6.3/§8.2 全部按三参 | §3.2、§6.3、§8.2 |
| V3b | x-consistency D10 / 07 V3(blocker) | `createCodexAdapter` 工厂无 `keystore` 字段,adapter 无从 resolve key | 工厂签名加 `keystore: KeyStore`(构造期注入,07 §8.4 热换链);`CodexAdapter` 持有 `keystore` 实例,`send` 时传给 `toCodexInjection` | §3.2、§8.2 |
| V3c | x-consistency D13 / 06 §12.1(major) | `AgentInput` 缺 claude 专属字段;`ProviderOverrides` 缺 `fallbackModel` | `AgentInput` 增可选 `appendSystemPrompt?`/`effort?`/`maxTurns?`(codex 忽略,向后兼容);`ProviderOverrides` 增 `fallbackModel?`(回填 07 §3) | §2、§11 |
| V3d | x-consistency C-CTX / 03 Q7(major) | 本文 §2 用旧别名 `ContextBundle` | 统一为权威名 **`PromptContext`**(03 §2 拥有);本文只引用不另写 | §2 |
| V3e | x-consistency C-NUM(blocker) | 全文「逻辑编号」(security=09/worktree=06/brakes=07)与 06/07 收敛的文件名编号冲突 | 全文改文件名编号(security=**08**/worktree=**09**/brakes=**04**/engine=**03**) | 全文 |
| V3f | x-consistency A1 / x-coverage COV-1 / B8 复核 | v2 §11 称 02 §12 缺 `SUBPROCESS_CRASHED`/`CANCELLED` 需回填 | **finding 已闭合**:02 §12 v2 已登记 `SUBPROCESS_SPAWN_FAILED`/`CRASHED`/`TIMEOUT`/`CANCELLED`;v3 改为「引用」并新增用 **`SUBPROCESS_TIMEOUT`** 区分硬超时(原 v2 超时误用 CANCELLED) | §5.2、§8.2、§10、§11 |
| V3g | red-security RS-M1 / 08 §2.4 R1 | §6.4 内联 `KEY_PATTERNS` 自维护一份,违 R1 单一权威 | 改 `import { SECRET_SIGNATURES, isStrongSecretLike } from '@sylux/security'`(08 §2.4 权威);`assertArgvNoSecret` 用强特征子集(避免长 hex/base64 误炸) | §6.4 |
| V3h | x-consistency D15 / 08 §10 | `buildChildEnv` import 路径 v2 写 `@sylux/agents/proc/build-env`,与 06 用 `@sylux/security` 不一致 | 统一从 **`@sylux/security`** import(08 拥有规则);本地 `proc/build-env.ts` 仅在 security 包未落地时作适配桩,定稿删 | §1、§8.3 |
| V3i | red-feasibility FEAS-3 / 25 M1(major) | M1「红蓝纯决策不写文件」与 propose 带 `files` 冲突,适配器层未表态 | 明确:适配器**对 files 无感**——它只透传 prompt/schema,是否产 diff 由 playbook(03/21)与 sandbox 决定;M1 read-only sandbox 即天然不落盘(§2.1 注) | §2.1 |
| V3j | red-ops-cost ROC-M1 / 19 §6.3(major) | usage 字段漂移时 v2 只「缺字段按 0」,output 当 0 会让成本刹车失明 | §7.3 新增:`turn.completed` 有 usage 信封但 `output_tokens` 缺 → 标 `usageDegraded` 透传给刹车 04,**不**静默当 0(防 maxCostUsd 失明) | §7.1、§7.3 |

> v3 范围纪律:本文件仍**只**拥有 `AgentAdapter`/`AgentInput` 接口与 codex 端实现。`toCodexInjection`/`mergeProviderOverrides`/`KeyStore` 形状的权威在 07,`buildChildEnv`/`SECRET_SIGNATURES` 在 08,`PromptContext` 在 03——v3 一律「引用并对齐签名」,不重定义。

---

## 0. 设计目标与不变量

### 0.1 适配层职责(一句话)

把两个**形态高度不对称**的 CLI(codex / claude)封装成**同一个 `AgentAdapter` 接口**:中枢只看 `send()/resume()/cancel()` 三个动作和一条 `AsyncIterable<AgentEvent>` 事件流,所有「exe 在哪、参数怎么拼、id 从哪抓、schema 走文件还是内联、进程树怎么杀」的差异全部吃进适配器内部。

### 0.2 本文件负责 / 不负责

| 负责(本文件给完整规格) | 不负责(引用别处) |
|---|---|
| `AgentAdapter` / `AgentInput` 接口签名 | `AgentEvent` / `Message` 等类型(02) |
| codex exe 路径解析(事实 A) | provider 配置模型 `ProviderConfig` / `KeyStore`(07) |
| codex `exec` 参数集 + `resume` 参数集(事实 E) | `buildChildEnv` env 白名单**规则** / `SECRET_SIGNATURES`(安全 08) |
| codex `--json` 事件流解析 → `AgentEvent` 映射(事实 B) | 内容防火墙 `firewallPeerMessage`(喂对面前过滤,安全 08) |
| output-schema 落盘 + safeParse 兜底重试(事实 C) | engine 的 `runTurn` 循环 + `PromptContext` 上下文裁剪(引擎 03) |
| 首轮 `thread.started` 前崩溃 → 不可 resume 失败路径 | worktree 创建 / 合并(worktree 09) |
| `cancel()` 进程树 kill(shim 背后真子进程) | token 预算/刹车阈值(刹车 04,本文件只**采集** usage) |

### 0.3 接口层不变量(实现必须保持)

- **A1 首事件恒为 session_started**:`send()`/`resume()` 返回的 `AsyncIterable<AgentEvent>` 的第一类有效事件必为 `{kind:'session_started', sessionId}`(02 不变量 I5)。codex 侧 `sessionId` 映射自 `thread.started.thread_id`(事实 B 首行),claude 侧映射自其 session id。中枢拿到它**之前**不得标记该 agent `resumable=true`(红队 R3)。
- **A2 未拿到 id 不可 resume**:若进程在 `thread.started` 之前崩溃,适配器**不得**先 emit 假 `session_started`;只 emit `{kind:'error', code:'SUBPROCESS_SPAWN_FAILED'}`(或对应码),`resumable` 永远 false(§5)。
- **A3 直调真实 exe**:codex 永不经 PATH 裸名 / `.cmd` 启动(事实 A);prompt 永远走 stdin,argv 里以 `-` 占位(事实 A.3 / E)。
- **A4 key 永不进 argv**:任何 `-c`/位置参数/flag 都不得携带 key;spawn 前对最终 argv 做 `SECRET_SIGNATURES` 强特征预扫描(08 §2.4),命中即抛 `PROVIDER_CONFIG_INVALID`(红队 R8 / 安全 08 S3)。key 只走 `providerEnv`。
- **A5 env 单一出口 + 白名单**:子进程 env 只由 `buildChildEnv()`(08 §2.2)产出,`extendEnv:false`,绝不 `{...process.env}`(红队 R8 / 安全 08 S2)。
- **A6 输出必过 safeParse**:`final_message.raw` 在适配器边界**不**解析成 `Message`;适配器只吐 `raw` + `usage`,由引擎调 `agentMessagePayloadSchema.safeParse` + `validateMessage`(02 §6/§8)。适配器只保证「把模型最终文本原样、完整、单条地交出」。
- **A7 ephemeral ⊥ resume**:`ephemeral:true`(`--ephemeral` / 不落盘)的会话**不可** resume——会话态没落盘,resume 无从续接。适配器对 ephemeral 首轮仍照常 emit `session_started`(若 codex 给了 thread_id),但引擎须知该 id **不应**被用于 `resume`;约定:ephemeral run 的 `sessionOf(agent).resumable` 由引擎强制为 false(03)。本文件不阻止物理 resume 调用,但 §8.4 标注其为误用。
- **A8 单进程在飞 / 串行消费**:同一 adapter 实例任一时刻至多一个子进程在飞(`this.current`)。引擎(03)保证对同一 adapter 串行 `send/resume/consume`;若 `current` 非空时再次 `send/resume`,属调用方 bug,适配器**抛**而非静默排队(§8.2/§8.4 L1)。
- **A9 resume 必预置 sessionId**:`resume(sessionId, …)` 进流即可凭传入的 `sessionId` 合成 `session_started`(§5.5),**不依赖** codex resume 是否重发 `thread.started`(待实测,§5.5)。这保证 A1 在 resume 路径同样成立,且与「codex resume 是否回吐首行」解耦。

---

## 1. 物理落点(`@sylux/agents`)

```
packages/agents/
├─ package.json              # name "@sylux/agents";依赖 @sylux/shared、execa、nanoid
├─ src/
│  ├─ index.ts               # re-export AgentAdapter/AgentInput + 两个工厂
│  ├─ adapter.ts             # ★ AgentAdapter / AgentInput 接口(本文件 §2/§3,权威)
│  ├─ codex/
│  │  ├─ resolve-exe.ts      # ★ codex 真实 exe 路径解析(事实 A,§4)
│  │  ├─ args.ts             # ★ exec / resume 两套 argv 拼装(事实 E,§6)
│  │  ├─ parse-events.ts     # ★ --json JSONL → AgentEvent 映射(事实 B,§7)
│  │  ├─ codex-adapter.ts    # ★ CodexAdapter 实现(send/resume/cancel,§8)
│  │  └─ schema-file.ts      # output-schema 写临时文件 + 清理(事实 C,§9)
│  ├─ claude/                # claude 端(对称位置,本文件不展开;见 06-adapter-claude.md)
│  ├─ proc/
│  │  ├─ argv-guard.ts       # spawn 前 argv 泄密预扫描;import SECRET_SIGNATURES@08(A4/§6.4)
│  │  └─ tree-kill.ts        # 进程树 kill(shim 背后真子进程,§3.4 / §10)
│  └─ errors.ts              # 仅 re-export @sylux/shared 的 SyluxError(不另定义码)
└─ fixtures/
   └─ fake-codex.mjs         # 真 .cmd shim 包一层 node,冒烟测试用(事实 A / master §4.5)
```

> 依赖方向遵守 master §10:`shared ← {providers, security, agents} ← {core, server}`。`@sylux/agents` 依赖 `@sylux/shared`(类型 + 校验)、`@sylux/providers`(`ProviderConfig`/`KeyStore`/`toCodexInjection`,07)、`@sylux/security`(`buildChildEnv`/`SECRET_SIGNATURES`,08),**不**依赖 `@sylux/core`(引擎),避免环。
>
> **`buildChildEnv` 落点(V3h)**:规则权威在 08(`@sylux/security`),本文件 `import { buildChildEnv } from '@sylux/security'`,**不**在 `@sylux/agents` 内自建实现(v2 曾写 `proc/build-env.ts`,已删——与 06 用 `@sylux/security` 统一)。`@sylux/security` 包落点若定稿改挂 `@sylux/shared`,两端(05/06)import 路径同步调整(08 §10 openQuestion,见本文 openQuestions)。

---

## 2. AgentInput —— 一次调用的全部输入

`send()` 与 `resume()` 共用同一 `AgentInput`(差异在适配器内部按 exec/resume 拆参数,不暴露给调用方)。字段已是「过完防火墙、只含 delta」的成品,适配器不再做内容裁剪(那是引擎 `PromptContext` 的活,03 §2;v3 订正 v1/v2 旧别名 `ContextBundle` → 权威名 `PromptContext`)。

```ts
import type { AgentId } from '@sylux/shared';

/** 一次 send/resume 调用的输入。所有字段由引擎在调用前备齐。 */
export interface AgentInput {
  /** 已过内容防火墙、已只含 delta 的 prompt 正文(走 stdin,不进 argv)。 */
  prompt: string;
  /**
   * output-schema 的 JSON Schema 对象(buildAgentOutputJsonSchema() 产出,02 §6.2)。
   * 适配器内部决定落点:codex 写临时文件传 --output-schema <FILE>;
   * claude 评估内联 --json-schema 串体积,超 ~32KB 退化为临时文件/stream-json(事实 F)。
   * 传对象而非字符串/路径,把「文件 vs 内联」的不对称完全吃进适配器(02 §6.2)。
   */
  outputSchema: Record<string, unknown>;
  /** 该 agent 的 worktree 绝对路径(worktree 09 创建)。codex 首轮经 -C 设定,resume 继承。 */
  workdir: string;
  /** 自动化沙箱上限。封顶 workspace-write,playbook 无法请求 danger(红队 R8 / 安全 08 S6)。 */
  sandbox: 'read-only' | 'workspace-write';
  /** env 白名单产物(buildChildEnv 出口,A5);含 provider key(只在此,不进 argv)。 */
  providerEnv: Record<string, string>;
  /**
   * provider 的非密覆盖项:base_url / wire_api / model 等,经 codex `-c key=val` / `-m` 注入。
   * 绝不含 key(A4);适配器 spawn 前对展开后的 argv 再做一次泄密预扫描。
   */
  providerOverrides: ProviderOverrides;
  /** 可选:本次调用的硬超时(ms)。到点 treeKill 杀进程树并 emit SUBPROCESS_TIMEOUT(§10)。 */
  timeoutMs?: number;
  /** 可选:一次性任务不落盘(codex --ephemeral / claude --no-session-persistence,事实 E/F)。
   *  ⚠ 与 resume 互斥(A7):ephemeral 会话不落盘 → 不可续接;引擎须把该会话 resumable 置 false。 */
  ephemeral?: boolean;

  // ── claude 专属可选字段(V3c / 06 §3.4 回填);codex 端一律忽略,向后兼容新增 ──
  /** claude `--append-system-prompt`:角色/协议系统提示注入。codex 无等价(事实 F),忽略。 */
  appendSystemPrompt?: string;
  /** claude `--effort`(low|medium|high|xhigh|max,事实 F)。codex 端忽略(其推理强度走 model/`-c`)。 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** claude `--max-turns`:单轮内工具循环封顶(06 CF-6)。codex 端无此 flag,忽略。 */
  maxTurns?: number;
}

/** provider 非密覆盖项(值绝不含 key,A4)。**权威类型在 provider 文档 07 §3/§4**;此处为结构镜像,
 *  仅供本文件阅读连贯,实现一律 `import type { ProviderOverrides } from '@sylux/providers'`(引用不另写)。 */
export interface ProviderOverrides {
  baseUrl?: string;                       // -c model_providers.<name>.base_url=...
  wireApi?: 'responses' | 'chat';         // -c model_providers.<name>.wire_api=...
  model?: string;                         // -m <model>
  providerName?: string;                  // -c model_provider=<name>;默认 'custom'
  fallbackModel?: string;                 // claude --fallback-model(V3c;codex 忽略);权威 07 §3
  /** 其余裸 -c 透传(已过 07 §3.4 白名单 + A4 泄密扫描);键值均非密。 */
  extraConfig?: Record<string, string>;
}
```

> **claude 专属字段的归属(V3c)**:`appendSystemPrompt`/`effort`/`maxTurns` 与 `ProviderOverrides.fallbackModel` 由 claude 端(06 §3.4)使用、codex 端忽略。它们作为 `AgentInput` 的**可选**字段加入(向后兼容,不破坏 codex 既有);权威定义点是本文件 §2(`AgentInput`)+ 07 §3(`fallbackModel` 在 `ProviderOverrides`)。06 不重定义接口,只消费。

### 2.1 AgentInput 字段语义

| 字段 | 来源 | codex 落点 | claude 落点 |
|---|---|---|---|
| `prompt` | 引擎 PromptContext + 防火墙(08) | stdin(argv 占位 `-`) | stdin / `-p` |
| `outputSchema` | `buildAgentOutputJsonSchema()`(02 §6.2) | 临时文件 → `--output-schema <FILE>` | `--json-schema <串>`,超限退临时文件 |
| `workdir` | worktree 09 | `exec` 用 `-C`;`resume` 不传(继承,事实 E) | `--add-dir`/cwd |
| `sandbox` | playbook(封顶 workspace-write) | `exec` 用 `-s`;`resume` **不传**(事实 E 拒 `-s`) | `--permission-mode` |
| `providerEnv` | `buildChildEnv`(A5,08) | 子进程 env,`extendEnv:false` | 同 |
| `providerOverrides` | provider 绑定(07) | `-c`/`-m` | `--model` 等 |
| `timeoutMs` | 引擎/刹车 04 | 适配器内计时器 | 同 |
| `ephemeral` | playbook | `--ephemeral` | `--no-session-persistence` |
| `appendSystemPrompt` | playbook 角色注入 | **忽略**(codex 无等价) | `--append-system-prompt` |
| `effort` | playbook | **忽略** | `--effort` |
| `maxTurns` | playbook | **忽略** | `--max-turns` |

> **V3i 适配器对「是否产生文件」无感**:`AgentInput` 没有 files 字段——适配器只透传 `prompt`/`outputSchema`/`sandbox`,**不**决定 agent 是否落盘改动。M1「红蓝纯决策不写文件」(25)与「propose 带 `files`」(03/21)的张力由**两层**化解,均在适配器之外:① playbook 在 prompt 里约束「只出方案不改文件」;② `sandbox:'read-only'` 时 codex 物理无法写盘(08 §6 封顶)。适配器在 read-only 下照常 spawn、照常吐 `final_message.raw`(方案文本),`-C` 工作目录只读挂载,天然不产 diff。故 M1 无文件写**不需**适配器特判,只需引擎传 `sandbox:'read-only'`(red-feasibility FEAS-3 的适配层澄清)。

---

## 3. AgentAdapter —— 统一接口(权威)

### 3.1 接口签名

```ts
import type { AgentId, AgentEvent } from '@sylux/shared';

/**
 * 子进程 CLI 的统一适配器。中枢只依赖本接口,不感知 codex/claude 的形态差异。
 * 事件流不变量(A1):send()/resume() 返回流的第一类有效事件必为 session_started;
 * 拿到它之前 agent 不可 resume(A2)。
 */
export interface AgentAdapter {
  /** 物理身份(02 agentIdSchema:'codex' | 'claude')。 */
  readonly id: AgentId;

  /**
   * 首轮:spawn 全新会话。
   * @returns 事件流;首事件 session_started 回吐 sessionId(codex=thread_id,A1)。
   * @remarks 不收 sessionId(红队 major:id 由 codex 自生成,不是调用方给的)。
   *          在 thread.started 前崩溃 → 不 emit session_started,只 emit error(A2、§5)。
   */
  send(input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 续接已有会话。必须先从某次 send 的 session_started 拿到 sessionId。
   * @param sessionId send() 回吐的 id(codex=thread_id)。
   * @remarks codex 走 `exec resume <SID> -`,参数集与 exec 不同(事实 E,§6.2):
   *          不传 -s/-C,必带 --skip-git-repo-check;沙箱/工作目录继承首轮。
   *          resume 不省 token(事实 D),成本随轮累积,刹车按累积估(07)。
   */
  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 取消当前进行中的调用:杀进程树(含 shim 背后的真实 node 子进程,§10)。
   * 幂等:无进行中进程时为 no-op。被取消的 send/resume 流以
   * {kind:'error', code:'SUBPROCESS_CANCELLED'} 收尾(§10.2)。
   */
  cancel(): Promise<void>;
}
```

### 3.2 工厂签名(构造期注入 provider + keystore,不在 send 时拼)

```ts
import type { ProviderConfig, KeyStore } from '@sylux/providers';  // 07 §2/§3 权威

/** 构造一个 codex 适配器。exe 路径在此解析(事实 A),失败即抛 SUBPROCESS_SPAWN_FAILED。 */
export function createCodexAdapter(opts: {
  /** 显式 exe 路径;缺省则 resolveCodexExe() 自动定位平台包 vendor bin(§4)。 */
  exePath?: string;
  /** provider 绑定(base_url/wire_api/model + apiKeyRef);热换走引擎重建 adapter(07 §8.1)。 */
  provider: ProviderConfig;
  /**
   * ★V3b:密钥解析器(07 §2)。构造期注入,adapter 内 send/resume 时调
   * `toCodexInjection(provider, keystore, ov)` 解析 key 进 env(07 §5.2 三参权威)。
   * keystore 只活在 adapter 内存,绝不经 WS/jsonl 序列化(07 §8.4)。
   */
  keystore: KeyStore;
  /**
   * 兜底硬超时(ms,A10)。当 AgentInput.timeoutMs 缺省时取此值,防引擎漏传导致 codex 挂死永久阻塞。
   * 缺省取一个保守上界(如 10min);0/undefined 表示不兜底(仅当引擎保证必传 timeoutMs 时)。
   */
  hardTimeoutCeilingMs?: number;
}): AgentAdapter;

/** claude 适配器工厂(对称,本文件不展开内部;06 §9 实现)。同样构造期收 keystore(07 §8.4)。 */
export function createClaudeAdapter(opts: {
  exePath?: string;
  provider: ProviderConfig;
  keystore: KeyStore;
  hardTimeoutCeilingMs?: number;
}): AgentAdapter;
```

> **V3b 注入链**:`ProviderRegistry.keystore`(07 §8.2)是单一实例;引擎在轮边界重建 adapter 时经 `createCodexAdapter({ provider, keystore, ... })` 构造期传入。这吃掉 x-consistency D10——v2 工厂缺 `keystore`,adapter 无从 resolve key,与 07 §8.4 热换链断开。`exePath` 仍构造期解析缓存(§4);`provider`/`keystore` 一对绑定,热换=换一对重建,不改运行中进程(07 P4)。

### 3.3 调用契约(引擎侧消费范式)

适配器是**冷流**:每次 `send()`/`resume()` 调用启动一个新子进程,返回的 `AsyncIterable` 被 `for await` 消费一次。引擎 `runTurn` 的标准消费骨架:

```ts
async function consumeTurn(it: AsyncIterable<AgentEvent>): Promise<{
  sessionId?: string; raw?: string; usage?: TokenUsage; error?: { code: string; detail: string };
}> {
  let sessionId: string | undefined;
  let raw: string | undefined;
  let usage: TokenUsage | undefined;
  for await (const ev of it) {
    switch (ev.kind) {
      case 'session_started': sessionId = ev.sessionId; break;       // A1:必先到
      case 'delta':        /* 透传面板(可选) */                    break;
      case 'tool_call':    /* 透传面板观战 */                        break;
      case 'final_message': raw = ev.raw; usage = ev.usage;          break;
      case 'error':        return { sessionId, error: { code: ev.code, detail: ev.detail } };
    }
  }
  return { sessionId, raw, usage };
}
```

> 引擎据 `sessionId` 是否拿到决定 `resumable`(A2);据 `raw` 走 `agentMessagePayloadSchema.safeParse` + `validateMessage`(02 §6/§8),失败按错误码重试(§9.2 兜底链)。`usage` 喂刹车 04(事实 D 累积模型)。

### 3.4 方法名约定与 kill 别名

任务接口定为 `cancel()`;master §4.1 历史叫 `kill()`。为不破坏既有引用,`AgentAdapter` 可临时导出 `kill` 作为 `cancel` 的 `@deprecated` 别名,M1 后删除。回填 master §4.1 统一为 `cancel()`(§11)。语义同:杀进程树(§10),不只杀直接子进程。

---

## 4. codex 真实 exe 路径解析(事实 A,焊死)

事实 A 三连结论:**裸 `codex` 是 bash shim 不能 spawn**;**`.cmd` 会把带空格 prompt 用 `%*` 打散**;唯一干净路径是**直调平台包里的真实 `codex.exe`**。所以适配器**绝不**依赖 PATH,自己定位 vendor bin。

### 4.1 本机实测路径(事实 A.3)

```
G:\npm-global\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
```

### 4.2 解析算法(跨平台 + 跨安装位置)

不能硬编码上面那条绝对路径(换机即废)。解析按平台拼 vendor 子路径,从若干根候选里探测:

```ts
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';

/** 平台 → codex 平台包名 + vendor target 三元组(事实 A 仅实测 win32-x64,其余按 npm 包命名约定推断)。 */
const CODEX_PLATFORM: Record<string, { pkg: string; target: string; bin: string }> = {
  'win32-x64':  { pkg: '@openai/codex-win32-x64',  target: 'x86_64-pc-windows-msvc', bin: 'codex.exe' }, // ★实测
  'win32-arm64':{ pkg: '@openai/codex-win32-arm64',target: 'aarch64-pc-windows-msvc',bin: 'codex.exe' }, // 【待实测】
  'linux-x64':  { pkg: '@openai/codex-linux-x64',  target: 'x86_64-unknown-linux-gnu', bin: 'codex' },    // 【待实测】
  'darwin-arm64':{pkg: '@openai/codex-darwin-arm64',target:'aarch64-apple-darwin',    bin: 'codex' },     // 【待实测】
};

/**
 * 解析 codex 真实 exe 绝对路径。优先级:
 *   1. 显式 exePath(createCodexAdapter 传入)
 *   2. SYLUX_CODEX_EXE 环境变量(运维逃生口)
 *   3. 从 @openai/codex 主包起,进其内嵌平台包 vendor bin
 *   4. 扫描已知 npm 全局根(npm prefix / NODE_PATH / 常见安装位)
 * 全部落空 → 抛 SUBPROCESS_SPAWN_FAILED(detail 列出已探测路径)。
 */
export function resolveCodexExe(explicit?: string): string {
  const key = `${process.platform}-${process.arch}`;
  const spec = CODEX_PLATFORM[key];
  const tried: string[] = [];
  const check = (p: string): string | null => { tried.push(p); return existsSync(p) ? p : null; };

  if (explicit) { const r = check(explicit); if (r) return r; }
  if (process.env.SYLUX_CODEX_EXE) { const r = check(process.env.SYLUX_CODEX_EXE); if (r) return r; }
  if (!spec) throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `不支持的平台 ${key}`);

  // 从主包定位内嵌平台包(npm 实测把平台包装在主包 node_modules 下,事实 A.3 路径形态)
  for (const root of candidateNodeRoots()) {
    const r = check(join(root, '@openai', 'codex', 'node_modules', spec.pkg,
                         'vendor', spec.target, 'bin', spec.bin));
    if (r) return r;
    // 平台包也可能与主包平级安装
    const r2 = check(join(root, spec.pkg, 'vendor', spec.target, 'bin', spec.bin));
    if (r2) return r2;
  }
  throw new SyluxError('SUBPROCESS_SPAWN_FAILED', `codex.exe 未找到(${key})`, { tried });
}

/** 候选 node_modules 根:npm 全局 prefix、NODE_PATH、cwd 上溯。 */
function candidateNodeRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.SYLUX_NPM_GLOBAL_ROOT)  // 本机如 G:\npm-global\node_modules
    roots.add(process.env.SYLUX_NPM_GLOBAL_ROOT);
  for (const p of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)) roots.add(p);
  // cwd 上溯找 node_modules(略,实现里 walk up)
  return [...roots];
}
```

> **实现注意**:`require.resolve('@openai/codex/package.json')` 更稳,但中枢未必把 codex 装进自己依赖。故以**文件系统探测**为主、`require.resolve` 为辅。`resolveCodexExe` 在 `createCodexAdapter` **构造期**调一次并缓存,spawn 期不再探测(失败提前暴露)。
>
> **claude 端对称坑(事实 F)**:claude 是 `.ps1/.cmd` shim,同样不能裸 spawn 带参数;claude 适配器需各自的 exe/launcher 解析,本文件不展开。

---

## 5. 首轮失败路径 —— thread.started 之前崩溃 → 不可 resume → 全新会话(A2,焊死)

红队 major:`send()` 回吐的 `sessionId`(= codex `thread.started.thread_id`,事实 B 首行)是 resume 的**唯一**凭据。若进程在该首行**之前**就死,适配器**没有** id 可回吐——此时绝不能伪造一个 `session_started` 让上层误以为可 resume(A1/A2、02 不变量 I5)。本节给出 spawn 生命周期闸门、三类崩溃时机、状态机与降级语义。

### 5.1 spawn 生命周期闸门(session_started 是分水岭)

一次 codex `exec` 调用,从适配器视角分为**三段**,`thread.started` 首行是闸门:

```
spawn ──► [A 段:进程未起/起即死] ──► stdout 出 thread.started ──► [B 段:已有 sessionId] ──► turn.completed ──► exit
            (无 stdout / 非法首行)        ▲ 闸门:此刻起 resumable 才可能为 true
```

- **闸门前(A 段)**:尚未拿到 `thread_id`。任何失败 → emit `{kind:'error', code:'SUBPROCESS_SPAWN_FAILED'}`,**绝不**先 emit `session_started`。`resumable` 恒为 `false`。
- **闸门后(B 段)**:已 emit `{kind:'session_started', sessionId}`。此后崩溃(turn 中途死、超时被 cancel)是**可 resume**的失败:id 已落黑板(02 §7.1 `agent_session`),引擎可 `resume(sessionId, …)` 续接(代价:事实 D 累积计费)。

### 5.2 三类崩溃时机与处置(权威表)

| # | 崩溃时机 | 适配器观测 | emit 的 AgentEvent | resumable | 引擎处置(03 §5.2/§8) |
|---|---|---|---|---|---|
| F-a | spawn 即失败(exe 缺失 / 不是有效 PE / EACCES) | `child` 触发 `error` 事件,无 stdout | `error: SUBPROCESS_SPAWN_FAILED` | false | 首轮致命 → `aborted`;非首轮无此情形(exe 已验证过) |
| F-b | 进程起了但 `thread.started` 前退出(参数被拒 / panic / 中转 401 即死) | exit 时仍 `!sawThreadStarted` | `error: SUBPROCESS_SPAWN_FAILED`(detail 带 exitCode+stderr 摘要) | false | 同 F-a:不可 resume,**全新会话**重来(降级,见 5.4) |
| F-c | `thread.started` **后**崩溃(turn 中途死 / 超时 / 人工 cancel / 中转断流) | 已 emit session_started,后续无 `turn.completed` | 先 session_started(已发),再 `error:` 三选一:`SUBPROCESS_CRASHED`(非零退出/信号)/ `SUBPROCESS_TIMEOUT`(硬超时,V3f)/ `SUBPROCESS_CANCELLED`(人工 abort) | **true**(id 已得) | 可 `resume(sessionId)` 续接;或按 continuity 策略 stateless 重来 |

> 判别键是布尔 `sawThreadStarted`:适配器解析 stdout 时一旦命中合法 `thread.started` 首行即置 true 并立刻 emit `session_started`。进程 `close` 时若 `sawThreadStarted===false` → F-a/F-b 路径;若为 true 但无 `turn.completed`/最终消息 → F-c 路径。

### 5.3 首事件闸门状态机(适配器内部,emitFirstEventOrError)

适配器内部维护一个三态机守护 A1/A2,保证「session_started 至多一次、且不在崩溃路径上伪造」:

```ts
type SpawnPhase =
  | 'awaiting_thread'   // 闸门前:还没见 thread.started
  | 'streaming'         // 闸门后:已 emit session_started,正常吐 delta/tool_call/final
  | 'terminal';         // 已 emit error 或 final_message 后流结束;后续事件一律丢弃

/**
 * 单进程一次调用的闸门守护。解析器每拿到一行/一个进程信号就喂给它,
 * 由它决定 emit 哪个 AgentEvent,并维持「session_started 恰好一次、不伪造」不变量。
 */
class FirstEventGate {
  private phase: SpawnPhase = 'awaiting_thread';

  /**
   * @param seededSessionId resume 路径预置(A9):已知 sessionId 时,适配器在进流时立刻
   *   合成 session_started(§5.5),phase 直接进 'streaming';此后即便 codex 重发
   *   thread.started 也被幂等吞掉(onThreadStarted 返回 null)。send 首轮传 undefined。
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

  /** 解析器命中合法 thread.started 首行时调用。返回要 emit 的事件(或 null=吞掉重复)。 */
  onThreadStarted(threadId: string): AgentEvent | null {
    if (this.phase !== 'awaiting_thread') return null;   // 重复/预置后:丢弃(防伪造二次,A9 兼容)
    this.phase = 'streaming';
    return { kind: 'session_started', sessionId: threadId };  // A1:唯一一次
  }

  /** 进程异常结束 / spawn error / 闸门前 exit 时调用。 */
  onFailure(code: 'SUBPROCESS_SPAWN_FAILED' | 'SUBPROCESS_CRASHED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CANCELLED', detail: string): AgentEvent | null {
    if (this.phase === 'terminal') return null;
    const wasBeforeGate = this.phase === 'awaiting_thread';
    this.phase = 'terminal';
    // A2:闸门前失败,绝不补发 session_started;直接 error。
    // 闸门后失败(F-c),session_started 早已发过,这里只补 error。
    return {
      kind: 'error',
      // 闸门前一律归为 SPAWN_FAILED(对引擎=不可 resume);闸门后保留具体 code
      code: wasBeforeGate ? 'SUBPROCESS_SPAWN_FAILED' : code,
      detail,
    };
  }

  /** 正常拿到最终消息。usageDegraded(V3j):usage 信封在但 output 字段漂移,透传给刹车 04。 */
  onFinal(raw: string, usage?: TokenUsage, usageDegraded?: boolean): AgentEvent | null {
    if (this.phase !== 'streaming') return null;  // 没经闸门却出 final = 异常,走 onFailure
    this.phase = 'terminal';
    return { kind: 'final_message', raw, usage, ...(usageDegraded ? { usageDegraded: true } : {}) };
  }

  get resumable(): boolean { return this.phase !== 'awaiting_thread'; } // 见过 thread.started 才可 resume
}
```

> **不变量校验**:`session_started` 只在 `awaiting_thread→streaming` 跃迁时产出一次(A1);`onFailure` 在 `awaiting_thread` 阶段被调用时,**结构上不可能**先产出 `session_started`(A2)——因为那需要先 `onThreadStarted` 把相位推到 `streaming`。这把 R3「拿到 id 前不得标 resumable」焊死在状态机里,而非靠调用方自律。

### 5.4 降级语义(不可 resume → 全新会话)

F-a/F-b(闸门前死)→ `resumable=false`。引擎(03 §5.2/§8)的处置**不是直接放弃**,而是分首轮/非首轮:

| 场景 | 引擎动作 | 依据 |
|---|---|---|
| **首轮**就 F-a/F-b | 致命:`fatal:true` 上报 → run `aborted`(`SUBPROCESS_SPAWN_FAILED`) | 连第一句话都说不出,无降级空间(03 §8) |
| **非首轮**遇 `continuity==='resume'` 但 `resumable===false`(上次闸门前死/从未拿到 id) | **降级为 `adapter.send` 全新会话**,不报错;靠 digest 兜连续性 | 03 §8 resume 退化路径;事实 D 累积成本权衡 |
| 闸门后 F-c | 可 `resume(sessionId)`;或 stateless 下本就 send 重来 | id 已落 `agent_session`(02 §7.1) |

> 关键:适配器**只负责如实 emit**(拿到 id 就 session_started,没拿到就 error),**降级决策在引擎**(03)。适配器不自作主张重试 spawn——重试/降级是引擎按 playbook `retryOnReject` 与 continuity 决定的(职责不越界)。spawn 失败的 `detail` 必须带 `exitCode` + stderr 末 N 行摘要(经脱敏,08),供引擎判 F-a(exe 问题)还是 F-b(参数/中转问题)。

### 5.5 resume 路径的首事件:预置 sessionId,不赌 codex 重发 thread.started(A2/A9,焊死)

事实 B 只实测了 **`exec`(首轮)** 的事件流以 `thread.started` 开头;**`exec resume` 是否同样重发 `thread.started` 首行尚未实测**(标【待实测 R-resume-thread】)。v1 默认 resume 也走同一闸门——若 codex resume **不**重发该行,`FirstEventGate` 永远停在 `awaiting_thread`,`session_started` 永不 emit,流违反 A1,引擎(03 `consume`)拿不到 sessionId、误判崩溃。这是一个**结构性脆弱点**,v2 用「预置」消除对该未知行为的依赖:

- `resume(sessionId, …)` 调用方**已经持有** sessionId(它是 resume 的入参,来自上一轮 `session_started` 落盘的 `agent_session`,02 §7.1)。因此 resume 路径**无需**再从流里抓 id——用 `new FirstEventGate(sessionId)` 预置,进流第一步 `primeIfSeeded()` 立刻合成 `{kind:'session_started', sessionId}`(§5.3),`phase` 直接进 `streaming`。
- 此后两种 codex 行为都被吸收:① codex **重发** `thread.started` → `onThreadStarted` 因 `phase!=='awaiting_thread'` 返回 null,被幂等吞掉(不二次 emit,R-parse-2);② codex **不重发** → 无影响,流照常进入 `delta/tool_call/final`。
- **一致性校验**:resume 合成的 `sessionId` 必等于入参(同一会话);若 codex 竟重发一个**不同** `thread_id`,适配器记 `system` 告警(可能是 codex 内部新建了会话),但**仍以入参 sessionId 为准**对外(引擎已据入参落盘),避免 sessionId 漂移。该不一致计入【待实测 R-resume-thread】闭环观察项。

```ts
// §8.2 run 内,resume 分支:gate 预置 sessionId;send 分支:gate 空构造
const gate = sessionId !== undefined ? new FirstEventGate(sessionId) : new FirstEventGate();
// 进流后(§7.3 drainEventQueue 起始)先 emit primeIfSeeded() 的结果(resume 才非 null)
```

> 这把「resume 可用性」从「依赖 codex resume 重发首行」(未实测、不可控)改为「依赖调用方持有 sessionId」(恒成立)。即便 R-resume-thread 实测结果为「不重发」,本设计也无需改动——这是 A9 的价值。

---

## 6. codex argv 拼装 —— exec 与 resume 两套(事实 E,不对称)

事实 E 是本节铁律:`codex exec` 与 `codex exec resume` **参数集不同**——resume **拒** `-s`(sandbox)/`-C`(cd),且非信任目录必须带 `--skip-git-repo-check`;`SESSION_ID` 与 `PROMPT` 是**位置参数**,prompt 用 `-` 占位走 stdin(事实 A.3)。两套 argv **必须分别拼装,绝不照抄**(A3)。

### 6.1 exec 模式 argv(首轮,send)

```ts
/** 构造 codex exec 首轮 argv(不含 exe 本身)。prompt 不进 argv(走 stdin),用 '-' 占位。
 *  cArgs 由 07 toCodexInjection 算出(含 env_key 行,非密),调用方在 §8.2 一并取得其 env。 */
export function buildExecArgs(input: AgentInput, schemaFilePath: string, cArgs: readonly string[]): string[] {
  const args: string[] = ['exec'];

  // ── 输出对齐:output-schema 走文件(事实 C;两端不对称,claude 才内联)──
  args.push('--output-schema', schemaFilePath);   // 02 §6.2 产出 → §9 落临时文件
  args.push('--json');                            // 事件流 JSONL(事实 B)

  // ── 工作目录:exec 用 -C(resume 继承,不再传,事实 E)──
  args.push('-C', input.workdir);

  // ── 沙箱:exec 用 -s,封顶 workspace-write(09;resume 拒 -s,事实 E)──
  args.push('-s', input.sandbox);                 // 'read-only' | 'workspace-write'

  // ── provider 非密覆盖(来自 07 toCodexInjection().cArgs;key 绝不在此,A4/A11)──
  pushProviderConfig(args, cArgs);                // §6.3

  // ── 一次性会话(可选)──
  if (input.ephemeral) args.push('--ephemeral');  // 事实 E

  // ── prompt 占位:位置参数 '-' = 从 stdin 读(事实 A.3)──
  args.push('-');
  return args;
}
```

### 6.2 resume 模式 argv(续接,resume)—— 参数集不同(事实 E)

```ts
/**
 * 构造 codex exec resume argv。事实 E 硬约束:
 *  - 子命令是 `exec resume`;
 *  - 拒 -s / -C → 不拼这两个(沙箱/工作目录首轮已定,resume 继承);
 *  - 非信任目录必须 --skip-git-repo-check(否则 'Not inside a trusted directory');
 *  - SESSION_ID 与 PROMPT 是位置参数;PROMPT 用 '-' 走 stdin。
 */
export function buildResumeArgs(sessionId: string, input: AgentInput, schemaFilePath: string, cArgs: readonly string[]): string[] {
  const args: string[] = ['exec', 'resume'];

  // resume 接受 --json / --skip-git-repo-check / -c / -m / --ephemeral(事实 E 实测接受集)
  args.push('--json');
  args.push('--skip-git-repo-check');             // 事实 E:非信任目录必带,worktree 多为非 git-trusted

  // output-schema:resume 仍走文件(与 exec 同;事实 E 接受 -c/-m/--json,未列 --output-schema 拒绝,
  // 按 exec 同源处理并保留 §9 safeParse 兜底;若 M0 实测 resume 不收 --output-schema → 退化为 prompt 内联约束 + 强兜底)
  args.push('--output-schema', schemaFilePath);   // 【待实测 R-resume-schema:resume 是否收 --output-schema】

  // ★ 绝不拼 -s / -C(事实 E 实测拒绝,会 'unexpected argument')
  // workdir/sandbox 由首轮 exec 定,resume 继承——这是 A3「两套参数不照抄」的核心体现

  pushProviderConfig(args, cArgs);                // -c / -m 同 exec(07 toCodexInjection,A11)
  if (input.ephemeral) args.push('--ephemeral');

  // 位置参数顺序:SESSION_ID 在前,PROMPT('-')在后(事实 E)
  args.push(sessionId);
  args.push('-');
  return args;
}
```

### 6.3 provider 非密覆盖注入(pushProviderConfig;key 绝不在此,A4)

> **收敛(A11 + V3a)**:`-c`/`-m` 的拼装权威在 **provider 文档(07)§5.2 `toCodexInjection`**——v3 起其权威签名为**三参 `toCodexInjection(cfg, keystore, ov?)`**(merge 内置,不要求调用方先 `mergeProviderOverrides`)。它产出 `{ cArgs, env, keyEnvVar }`:`cArgs` 含 `model_provider` / `base_url` / `wire_api` / `-m` **以及 key 走 env 的 `model_providers.<name>.env_key=<VAR>` 行**(07 §5),`env` 是唯一含真实 key 的字段(由 keystore 解析,喂 §8.3 `buildChildEnv`)。本节 `pushProviderConfig` 是对 `toCodexInjection().cArgs` 的**薄包装**,不自行拼 `-c`。下方拼装形态仅作**说明**,实现以 07 为准。

provider 的 base_url / wire_api / model / provider 名 + `env_key` 经 07 `toCodexInjection` 统一翻译;**key 永不经 `-c`/argv**(红队 R8、A4),只走 `cArgs` 之外的 `env`(§8.3 / 安全 08)。

```ts
import { toCodexInjection } from '@sylux/providers'; // 07 §5.2 权威(cfg, keystore, ov?)

/**
 * 委托 07 toCodexInjection 产出 cArgs(含 env_key 行),本函数只把 cArgs 拼进 args。
 * 不在此处自拼 -c(A11);extraConfig 等非密透传已在 toCodexInjection 内处理。
 * 返回的 env(含 key)由调用方(§8.2 run)交给 buildChildEnv,绝不进 argv。
 */
function pushProviderConfig(args: string[], cArgs: readonly string[]): void {
  for (const a of cArgs) args.push(a);   // cArgs 已是 ['-c','model_provider=…','-c','…env_key=VAR','-m','…'] 形态
  // ★ cArgs 里只有「环境变量名」(env_key 的值是 VAR 名,非密),真实 key 在 toCodexInjection().env(§8.2)
}
```

> **职责边界(对账 07 §5.3,V3a)**:`buildExecArgs`/`buildResumeArgs`(§6.1/§6.2)接收**已算好的 `cArgs`**(只读字符串数组),不接 `ov`——v3 起 `run`(§8.2)直接 `toCodexInjection(this.provider, this.keystore, input.providerOverrides)` 一步算出 `{cArgs, env}`(**merge 在 07 内部做**,adapter 不再自己 `mergeProviderOverrides`),builder 只把 `cArgs` 拼进 argv。adapter 不解释 `ov`/`cArgs` 字段语义(那是 07 的活)。`toCodexInjection` 三参权威签名、`mergeProviderOverrides` 内置语义(input overrides 覆盖 provider 默认)均在 **07 §5.2/§4**,`ProviderOverrides` 类型权威在 07 §3,本文件 §2 仅前向声明、**引用不另写**。事实 E:resume 仍接受 `-c`/`-m`,故同一 `cArgs` 在 exec/resume 两路**原样可用**(07 §5.3 印证)。

### 6.4 spawn 前 argv 泄密预扫描(argvGuard,A4 焊死;V3g 单一权威)

无论上面怎么拼,spawn **前**最后一道闸:对**展开后的完整 argv 数组**逐项扫密钥特征,命中即抛 `PROVIDER_CONFIG_INVALID`,**拒绝 spawn**(红队 R8、安全 08 S3)。这是「即使上游拼错把 key 漏进 argv 也炸在本机、不出网」的兜底。

> **V3g 收敛**:v2 在此**内联**了一份 `KEY_PATTERNS`,与 08 §2.4 `SECRET_SIGNATURES` 双轨维护(违 R1 单一权威)。v3 改为 **import 08 的权威签名集**,本文件不再自维护正则;argv 硬闸用**强特征子集** `isStrongSecretLike`(08 §2.4),避免 `generic_b64`/`hex_secret` 高误报项误炸合法长参数(如 hash)。

```ts
import { SECRET_SIGNATURES, isStrongSecretLike } from '@sylux/security'; // 08 §2.4 权威,不内联副本

/**
 * spawn 前对最终 argv 逐项预扫。命中强特征即抛,绝不 spawn(A4/S3)。
 * 用 isStrongSecretLike(sk-/sk-ant-/Bearer/AKIA/ghp_/jwt 等强特征)做硬闸:
 *   - 强特征误报率极低 → 命中即炸是安全的;
 *   - 不用全特征(含 b64/hex 高误报)→ 否则 worktree 路径里偶发的长 base64/hex 段会误炸 spawn。
 * 真正的 key 走 env(toCodexInjection().env → buildChildEnv),正常根本不该出现在 argv。
 */
export function assertArgvNoSecret(argv: readonly string[]): void {
  for (const a of argv) {
    if (isStrongSecretLike(a)) {
      // detail 只留命中签名名 + 前 8 字符,不回显全值(08 §2.4 T9 脱敏纪律)
      const sig = SECRET_SIGNATURES.find((s) => s.strong && s.re.test(a));
      throw new SyluxError('PROVIDER_CONFIG_INVALID',
        'argv 命中疑似密钥特征,拒绝 spawn(key 必须走 env,A4/S3)',
        { signature: sig?.name, offendingArgHint: a.slice(0, 8) + '…' });
    }
  }
}
```

> **误报/漏报权衡(对账 08 §2.4)**:① 硬闸用强特征 → 几乎不误炸,但**漏报**面(非标准短 token 如某中转 `mb_xxx`)由 08 T1 的「key 必走 `apiKeyRef` 根本不进 argv」主防线兜底,argvGuard 只是最后一道。② `extraConfig` 的值在 07 §3.4 已过白名单(键黑名单 + 禁控制字符),正常 argv 不该含 40+ 连续 base64/hex。③ 新增中转时把其 key 前缀补进 08 `SECRET_SIGNATURES`(配置可扩展),05 自动受益,无需改本文件。

### 6.5 exec ↔ resume 参数差异速查(事实 E,实现自检表)

| 维度 | `exec`(send) | `exec resume`(resume) | 依据 |
|---|---|---|---|
| 子命令 | `exec` | `exec resume` | 事实 E |
| sandbox `-s` | ✅ 传(封顶 workspace-write) | ❌ **不传**(实测拒,继承首轮) | 事实 E |
| workdir `-C` | ✅ 传 | ❌ **不传**(继承首轮) | 事实 E |
| `--skip-git-repo-check` | 视目录(worktree 非 trusted 则带) | ✅ **必带**(否则 Not inside trusted dir) | 事实 E |
| `--json` | ✅ | ✅ | 事实 B/E |
| `--output-schema` | ✅ 文件 | ✅ 文件【待实测 resume 是否收】 | 事实 C/E |
| `-c` / `-m` | ✅ | ✅ | 事实 E |
| `--ephemeral` | ✅ | ✅ | 事实 E |
| SESSION_ID | —— | ✅ 位置参数(在 PROMPT 前) | 事实 E |
| PROMPT | `-`(stdin) 位置参数 | `-`(stdin) 位置参数(在 SESSION_ID 后) | 事实 A.3/E |
| key | ❌ 绝不进 argv(走 env) | ❌ 绝不进 argv(走 env) | A4/R8 |

---

## 7. codex --json 事件流解析 → AgentEvent 映射(事实 B,焊死)

事实 B 实测 codex `exec --json` 吐 **4 类 JSONL 事件,顺序固定**:`thread.started`(首行,带 `thread_id`)→ `turn.started` → `item.completed`(最终消息在 `item.text`)→ `turn.completed`(`usage` 在此)。解析器把这条 codex 专有流归一成 02 §6.3 的 `AgentEvent`。

### 7.1 codex 原生事件 ↔ AgentEvent 映射表(权威)

| codex `--json` 行 `type` | 关键字段 | 映射为 AgentEvent | 备注 |
|---|---|---|---|
| `thread.started` | `thread_id` | `{kind:'session_started', sessionId: thread_id}` | **首行**;经 `FirstEventGate.onThreadStarted`(§5.3),A1 闸门 |
| `turn.started` | —— | (不映射 / 可选透传面板) | 仅时序标记 |
| `item.completed` (`item.type==='agent_message'`) | `item.text` | 暂存为最终 raw 候选 | 最终 JSON 文本在此(事实 B);也可能多条 item,取 `agent_message` 类 |
| `item.completed` (其他 item.type,如 tool) | `item` | `{kind:'tool_call', name, args}` | 透传面板观战(02 §6.3) |
| `turn.completed` | `usage` | 与暂存 raw 合成 `{kind:'final_message', raw, usage}` | usage 取自此(事实 B/D);经 `FirstEventGate.onFinal` |
| (进程 close,`!sawThreadStarted`) | exitCode/stderr | `{kind:'error', code:'SUBPROCESS_SPAWN_FAILED', detail}` | F-a/F-b(§5.2) |
| (进程 close,闸门后无 turn.completed) | —— | `{kind:'error', code:'SUBPROCESS_CRASHED', detail}` | F-c(§5.2) |

> **usage 字段归一(02 §6.3 TokenUsage)**:codex `turn.completed.usage` 字段名 `input_tokens/cached_input_tokens/output_tokens/reasoning_output_tokens`(事实 B)→ 映射为 `TokenUsage` 的 `inputTokens/cachedInputTokens/outputTokens/reasoningOutputTokens`(02 §6.3 驼峰)。解析器负责这层 snake→camel 归一,引擎只见 `TokenUsage`。
>
> **V3j usage 降级标记(吃 red-ops-cost ROC-M1)**:两种 usage 缺失要**区别对待**,不可都「按 0」:① `turn.completed` **整体无 `usage` 信封**(R-parse-4)→ `final_message.usage===undefined`,刹车 04 按地板兜底估(事实 D 基线 ≈18.7k)。② `turn.completed` **有 usage 信封但 `output_tokens` 缺/为 0 而 input 非 0**(中转升级改字段名导致字段漂移)→ 不静默当 0,`final_message.usageDegraded:true` 透传给刹车 04。区别在于:情形①引擎知道「没数据」会走地板;情形②若静默把 output 当 0,`maxCostUsd` 会**漏算 output 成本**导致成本刹车失明(ROC-M1:用户设 \$12 上限挡不住真实 \$40+)。`usageDegraded` 让刹车对 output 也走地板估而非 0。该标记是 `final_message` 的可选附加字段(02 §6.3 若未含则回填,见 §11 B11)。

### 7.2 行边界与缓冲(stdout chunk 不等于行)

子进程 stdout 是字节流,一个 `data` chunk 可能含**半行**或**多行**。解析器必须按 `\n` 切分并缓存残行(事实 A 注:Node 直接捕获 stdout 为干净 UTF-8,不经 shell 重定向,无 UTF-16 污染)。

```ts
import { MAX_JSONL_LINE_BYTES } from '@sylux/shared'; // 02 §5.3,512 KiB

/** 增量行解析器:喂 chunk,吐完整行;残行留缓冲。单行超限即抛(A6,防无界缓冲 DoS)。 */
class LineSplitter {
  private buf = '';
  /** @throws 残行(无 \n)累计超 MAX_JSONL_LINE_BYTES 时,由 push 返回的哨兵触发上层 emit error。 */
  push(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); // 强制 utf8(事实 A)
    // A6:残行(未见 \n)长度超闸 → 视为失控输出/被注入超大行,不再无界累积
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_JSONL_LINE_BYTES) {
      throw new SyluxError('SUBPROCESS_CRASHED',
        `单行超 ${MAX_JSONL_LINE_BYTES}B 未见换行,疑似失控输出`, { bufBytes: Buffer.byteLength(this.buf, 'utf8') });
    }
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';          // 最后一段是残行(无尾随 \n),留到下次
    return lines.filter((l) => l.length > 0);
  }
  /** 进程 close 时冲洗残行(可能是最后一个完整 JSON 无尾 \n)。 */
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}
```

> 单行超闸抛 `SUBPROCESS_CRASHED`(闸门后)/被 §7.3 捕获转 `gate.onFailure`;闸门前出现超大行(罕见,通常是中转吐巨型错误页)则归 `SUBPROCESS_SPAWN_FAILED`(gate 相位决定)。无论哪种,进程随后被 `treeKill`(§10)清掉,不留半死进程刷屏。

### 7.3 解析主循环(EventSink + drainEventQueue)

把 LineSplitter + FirstEventGate 串起来,产出 `AsyncIterable<AgentEvent>`。这是 §3.1 `send()/resume()` 返回流的引擎本体。**关键结构(A3)**:`EventSink` 在 spawn 后**同步**挂好 child 监听并把事件推入 queue;`drainEventQueue` 是个只从 queue 拉取的瘦生成器。这样监听挂载不被生成器惰性求值延后,codex 极快返回也不丢首事件。

```ts
/**
 * 消费 codex 子进程的 stdout/stderr/close,产出归一化 AgentEvent 流。
 * 保证:① session_started 至多一次(send:thread.started 后;resume:进流即预置,A9);
 *       ② 闸门前任何退出 → SPAWN_FAILED 不伪造 session_started(A2);
 *       ③ usage snake→camel 归一(§7.1);④ 监听器在调用本函数前已挂(A3,见 §8.2);
 *       ⑤ 背压 + stderr 环形缓冲 + 单行超闸保护(A6)。
 * @remarks 本函数**不**负责挂 child 事件监听——监听在 §8.2 spawn 后同步挂好并写入 sink,
 *          本函数只从 sink(queue)拉取,彻底消除「生成器惰性 → 首事件竞态」(A3)。
 */
async function* drainEventQueue(sink: EventSink): AsyncIterable<AgentEvent> {
  // resume 预置:进流第一步补发合成 session_started(send 路径为 null,A9/§5.5)
  const primed = sink.gate.primeIfSeeded();
  if (primed) yield primed;

  while (true) {
    if (sink.queue.length > 0) {
      const ev = sink.queue.shift()!;
      sink.maybeResume();                 // A6:队列回落,恢复 stdout 读取(背压)
      yield ev;
      continue;
    }
    if (sink.closed) return;
    await sink.waitNext();                // 等下一个事件 / close
  }
}

/**
 * EventSink:spawn 后同步构造并挂 child 监听(A3)。把事件驱动的 child 回调桥成可拉取 queue。
 * 监听挂载发生在「喂 stdin」之前(§8.2),保证 thread.started 不被漏接。
 */
class EventSink {
  readonly queue: AgentEvent[] = [];
  closed = false;
  /** V3f:cancel/超时路径由 treeKill 写入('SUBPROCESS_CANCELLED'|'SUBPROCESS_TIMEOUT');
   *  onClose 闸门后分支据此 emit 对应 code,缺省则视为真崩溃 CRASHED。 */
  terminationHint?: string;
  private splitter = new LineSplitter();
  private pendingRaw: string | undefined;   // item.completed(agent_message)暂存的最终文本
  private stderrRing = new RingBuffer(16 * 1024); // A6:只留末 16KiB stderr 作 detail(脱敏后,08)
  private resolveWake?: () => void;
  private readonly HIGH = 1024, LOW = 256;  // A6 背压水位(AgentEvent 条数)

  constructor(private readonly child: ChildProcess, readonly gate: FirstEventGate) {
    child.stdout!.on('data', (c) => this.onStdout(c));
    child.stderr!.on('data', (c) => this.stderrRing.push(typeof c === 'string' ? c : c.toString('utf8')));
    child.on('error', (e) => { this.emit(gate.onFailure('SUBPROCESS_SPAWN_FAILED', String(e?.message ?? e))); this.finish(); });
    child.on('close', (code, signal) => this.onClose(code, signal));
  }

  private emit(ev: AgentEvent | null) { if (ev) { this.queue.push(ev); this.maybePause(); this.wake(); } }
  /** stdin 写失败(EPIPE)兜底入口(A4):走 gate(幂等)+ null 守卫 + wake,不直接 push。 */
  failFromStdin(detail: string) { this.emit(this.gate.onFailure('SUBPROCESS_SPAWN_FAILED', detail)); }
  private wake() { this.resolveWake?.(); this.resolveWake = undefined; }
  waitNext(): Promise<void> { return new Promise<void>((r) => { this.resolveWake = r; }); }
  private finish() { this.closed = true; this.wake(); }

  /** A6 背压:queue 高于 HIGH 暂停 stdout,drain 到 LOW 以下再恢复。 */
  private maybePause() { if (this.queue.length >= this.HIGH) this.child.stdout!.pause(); }
  maybeResume() { if (this.queue.length <= this.LOW && this.child.stdout!.isPaused()) this.child.stdout!.resume(); }

  private onStdout(c: Buffer | string) {
    let lines: string[];
    try { lines = this.splitter.push(c); }
    catch (e) { this.emit(this.gate.onFailure('SUBPROCESS_CRASHED', String((e as Error).message))); void treeKill(this.child); return; } // A6 单行超闸
    for (const l of lines) this.handleLine(l);
  }

  private handleLine(line: string) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { return; }   // 非 JSON 行(偶发日志)跳过,不污染流(R-parse-1)
    switch (obj?.type) {
      case 'thread.started':
        this.emit(this.gate.onThreadStarted(String(obj.thread_id))); // A1 闸门;resume 预置后幂等吞掉
        break;
      case 'turn.started':
        break;                                            // 仅时序,不映射
      case 'item.completed': {
        const item = obj.item;
        if (item?.type === 'agent_message') this.pendingRaw = String(item.text ?? ''); // 暂存最终文本(R-parse-3 取末条)
        else this.emit({ kind: 'tool_call', name: String(item?.type ?? 'tool'), args: item }); // 透传面板
        break;
      }
      case 'turn.completed':
        // V3j:把 usage 降级标记一并交给 gate.onFinal,合进 final_message.usageDegraded(供刹车 04)
        this.emit(this.gate.onFinal(this.pendingRaw ?? '', normalizeUsage(obj.usage), isUsageDegraded(obj.usage)));
        break;
      // 未知 type:忽略(向前兼容 codex 新增事件)
    }
  }

  private onClose(code: number | null, signal: string | null) {
    for (const l of this.splitter.flush()) this.handleLine(l);  // 冲洗残行(无尾 \n 的最后 JSON)
    if (this.gate.resumable && this.pendingRaw === undefined) {
      // F-c:闸门后崩溃。V3f:杀因优先用 terminationHint(超时=TIMEOUT/人工=CANCELLED),否则真崩溃=CRASHED。
      const code2 = (this.terminationHint as 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CANCELLED' | undefined) ?? 'SUBPROCESS_CRASHED';
      this.emit(this.gate.onFailure(code2, `closed code=${code} signal=${signal}; stderr=${this.stderrRing.tail()}`));
    } else if (!this.gate.resumable) {
      this.emit(this.gate.onFailure('SUBPROCESS_SPAWN_FAILED', `exit code=${code}; stderr=${this.stderrRing.tail()}`)); // F-a/F-b(gate 归一为 SPAWN_FAILED,A2)
    }
    this.finish();
  }
}

/** codex usage(snake)→ 02 §6.3 TokenUsage(camel)。缺字段按 0(02 default)。 */
function normalizeUsage(u: any): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.input_tokens ?? 0,
    cachedInputTokens: u.cached_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningOutputTokens: u.reasoning_output_tokens ?? 0,
  };
}

/** V3j:usage 信封存在但字段漂移(input 非 0 而 output 缺/为 0)→ 降级标记,供刹车 04 对 output 走地板估而非 0。
 *  纯缺信封(u 为空)不算 degraded(那是 R-parse-4 的 undefined 路径,引擎按地板兜底)。 */
function isUsageDegraded(u: any): boolean {
  if (!u) return false;
  const hasInput = (u.input_tokens ?? 0) > 0;
  const hasOutputField = u.output_tokens !== undefined && u.output_tokens !== null;
  return hasInput && !hasOutputField;   // 有 input 却完全没 output 字段 = 字段漂移嫌疑(中转升级)
}

/** 末 N 字节环形缓冲:stderr 只留尾部作失败 detail,不无界累积(A6)。tail() 出口经 08 脱敏。 */
class RingBuffer {
  private buf = '';
  constructor(private readonly maxBytes: number) {}
  push(s: string) { this.buf = (this.buf + s).slice(-this.maxBytes); } // 仅留末 maxBytes
  tail(): string { return this.buf; } // 调用方(§5.4 detail)再过 redact(08)
}
```

### 7.4 解析健壮性约束(实现必须满足)

- **R-parse-1 非 JSON 行不致命**:中转/codex 偶发打印非 JSON 日志行 → `JSON.parse` 失败即跳过该行,**不**中断流、**不**报错(只有进程退出且闸门前才 SPAWN_FAILED)。
- **R-parse-2 thread.started 幂等**:重复 `thread.started` 经 `gate.onThreadStarted` 返回 null 被吞(§5.3),`session_started` 绝不二次 emit。
- **R-parse-3 多 agent_message 取末条**:若一轮出多条 `item.completed(agent_message)`,`pendingRaw` 覆盖为**最后一条**(codex 流式分段或修订时,最终态为准);最终 raw 的合法性由引擎 `agentMessagePayloadSchema.safeParse` 判(02 §6.1,A6)。
- **R-parse-4 usage 缺失不阻断**:`turn.completed` 无 `usage` → `final_message.usage` 为 `undefined`(02 §6.3 允许),刹车 04 端按缺省/地板处理;不因缺 usage 判失败。**区别于 V3j**:有 usage 信封但 output 漂移 → `usageDegraded:true`(§7.1),非此条的「全缺」。
- **R-parse-5 stderr 不进事件流**:stderr 只进 `RingBuffer`(末 16KiB)留作失败 `detail`(经 08 脱敏),绝不当作 `delta`/`final` 喂引擎(防把报错文本误当模型产出)。
- **R-parse-6 背压**:`EventSink.queue` 仅缓存 AgentEvent(小对象);队列达 `HIGH` 水位 `child.stdout.pause()`,拉取 drain 到 `LOW` 以下 `resume()`(A6)。不缓存原始 stdout 全量,避免大输出占内存。
- **R-parse-7 监听器先于 stdin(A3)**:`EventSink` 构造(挂 stdout/stderr/error/close 监听)必须在 `feedPromptStdin` **之前**完成(§8.2),否则 codex 极快返回时 `thread.started` 会在监听挂上前丢失。生成器 `drainEventQueue` 只拉 queue,**不挂**监听——彻底切断「生成器惰性求值 → 监听晚挂」竞态。
- **R-parse-8 单行超闸(A6)**:残行累计超 `MAX_JSONL_LINE_BYTES`(02 §5.3)→ `LineSplitter.push` 抛 → `EventSink.onStdout` 捕获转 `gate.onFailure` 并 `treeKill`,不无界累积。
- **R-parse-9 resume 预置幂等**:resume 路径 `drainEventQueue` 起始补发预置 `session_started`(§5.5);若 codex 又重发 `thread.started`,`gate.onThreadStarted` 因 phase 非 `awaiting_thread` 返回 null,不二次 emit(R-parse-2 的 resume 推论)。

---

## 8. CodexAdapter 实现(send / resume / cancel,组装全部)

把 §4(exe 解析)+ §6(argv)+ §7(解析)+ §9(schema 文件)+ §10(进程树 kill)组装成 `AgentAdapter`。**spawn 永远直调真实 exe + prompt 走 stdin**(A3),env 经 `buildChildEnv` 单一出口(A5),argv 过 `assertArgvNoSecret`(A4)。

### 8.1 spawn 选项(Windows 干净路径,事实 A)

```ts
import { spawn, type ChildProcess } from 'node:child_process';

/** codex 进程的统一 spawn 选项。直调真实 exe(§4),不经 shell(否则 .cmd 打散参数,事实 A)。 */
function spawnCodex(exePath: string, argv: string[], env: Record<string, string>, cwd: string): ChildProcess {
  assertArgvNoSecret(argv);                 // A4:最后一道泄密闸,命中即抛(不 spawn)
  return spawn(exePath, argv, {
    cwd,                                     // 仅作进程 cwd;codex 工作目录由 -C(exec)定,resume 继承
    env,                                     // A5:buildChildEnv 产物,extendEnv:false,不并 process.env
    stdio: ['pipe', 'pipe', 'pipe'],         // stdin 写 prompt,stdout/stderr 捕获(事实 A:Node 捕获干净 UTF-8)
    windowsHide: true,                       // 事实 A.3 实测选项
    shell: false,                            // ★绝不 shell:裸名/.cmd 都被禁(事实 A),直调 exe
    // A5:POSIX 下建独立进程组,让 §10.2 treeKill 能对 -pid 杀整组;Windows 用 taskkill /T 不需要
    detached: process.platform !== 'win32',
  });
}

/** 把 prompt 写进 stdin 并关闭(事实 A.3:write 后 end)。挂 error 兜底 EPIPE(A4:进程已死时写 stdin)。 */
function feedPromptStdin(child: ChildProcess, prompt: string, onStdinError: (e: Error) => void): void {
  const stdin = child.stdin!;
  // A4:进程在写 stdin 前/中已死 → write 抛异步 EPIPE/ERR_STREAM_DESTROYED;不挂 error 会冒泡崩 Node。
  stdin.on('error', (e: Error) => onStdinError(e));   // 转给 run 的 gate.onFailure,不崩进程
  try {
    stdin.setDefaultEncoding('utf8');
    stdin.write(prompt);
    stdin.end();                             // 必须 end,否则 codex 等 EOF 不返回(L3)
  } catch (e) {
    onStdinError(e as Error);                // 同步抛(stream 已 destroyed)也走同一兜底
  }
}
```

### 8.2 CodexAdapter 类(send/resume/cancel)

```ts
import { toCodexInjection } from '@sylux/providers';   // 07 §5.2 三参权威(cfg, keystore, ov?)→ {cArgs, env}
import { buildChildEnv } from '@sylux/security';        // 08 §2.2 单对象签名(A5/V3h)
import type { ProviderConfig, KeyStore } from '@sylux/providers';

export function createCodexAdapter(opts: {
  exePath?: string; provider: ProviderConfig; keystore: KeyStore; hardTimeoutCeilingMs?: number;
}): AgentAdapter {
  const exePath = resolveCodexExe(opts.exePath);   // §4:构造期解析+缓存,失败提前抛 SUBPROCESS_SPAWN_FAILED
  return new CodexAdapter(exePath, opts.provider, opts.keystore, opts.hardTimeoutCeilingMs ?? DEFAULT_HARD_TIMEOUT_MS);
}

const DEFAULT_HARD_TIMEOUT_MS = 10 * 60_000;       // A10:引擎漏传 timeoutMs 时的兜底上限

class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  private current?: ChildProcess;                  // 当前进行中的进程(cancel 用,§10);A8 单进程在飞
  private currentSink?: EventSink;                  // V3f:cancel/超时把 terminationHint 写它,onClose 据此分类

  constructor(
    private readonly exePath: string,
    private readonly provider: ProviderConfig,
    private readonly keystore: KeyStore,           // ★V3b:构造期注入,run 时传 toCodexInjection 解析 key
    private readonly hardTimeoutCeilingMs: number,
  ) {}

  send(input: AgentInput): AsyncIterable<AgentEvent> {
    return this.run(input, undefined);             // gate 不预置(§5.3),首轮抓 thread.started
  }

  resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> {
    return this.run(input, sessionId);             // gate 预置 sessionId(A9/§5.5)
  }

  async cancel(): Promise<void> {
    if (!this.current) return;                      // 幂等 no-op(§3.1,L5)
    await treeKill(this.current, 'SUBPROCESS_CANCELLED', this.currentSink); // §10:杀进程树 + 记 hint(V3f)
    // 被 cancel 的流由 EventSink.onClose 依 gate 相位 + terminationHint emit CANCELLED/SPAWN_FAILED(§10.2)收尾
  }

  /** send/resume 共享运行骨架:落 schema → 拼 argv(含 07 cArgs)→ spawn → 同步挂 sink(A3)→ 喂 stdin → 拉流。
   *  @param sessionId 非 undefined = resume,预置 gate(A9);undefined = send 首轮。 */
  private async *run(input: AgentInput, sessionId: string | undefined): AsyncIterable<AgentEvent> {
    // A8:同一 adapter 不得并发 run。引擎 03 保证串行;违约即 bug,抛而非静默排队。
    if (this.current) {
      throw new SyluxError('SUBPROCESS_SPAWN_FAILED', 'CodexAdapter 已有进程在飞,禁止并发 run(A8)');
    }

    // 1. output-schema 落临时文件(§9;两端不对称:codex 文件,claude 内联)
    const { path: schemaFile, cleanup } = await writeSchemaFile(input.outputSchema);

    // 2. provider 注入(07 §5.2 三参,V3a):一步算出 cArgs(含 env_key 行,非密)+ env(唯一含 key)。
    //    merge 在 toCodexInjection 内部做(adapter 不再自己 mergeProviderOverrides);keystore 来自构造期(V3b)。
    let cArgs: readonly string[]; let providerKeyEnv: Record<string, string>;
    try {
      ({ cArgs, env: providerKeyEnv } = toCodexInjection(this.provider, this.keystore, input.providerOverrides));
    } catch (e) {
      cleanup();   // key 解析失败(PROVIDER_CONFIG_INVALID,07 §2.3)→ 闸门前失败,不伪造 session_started(A2)
      yield { kind: 'error', code: (e as SyluxError).code ?? 'PROVIDER_CONFIG_INVALID', detail: String((e as Error).message) };
      return;
    }
    const argv = sessionId === undefined
      ? buildExecArgs(input, schemaFile, cArgs)                                    // §6.1
      : buildResumeArgs(sessionId, input, schemaFile, cArgs);                      // §6.2
    // A1/A5:env 单一出口,08 §2.2 单对象签名。providerEnv 合并 07 注入的 key env(都属 secret 通路 S1)
    const env = buildChildEnv({ providerEnv: { ...input.providerEnv, ...providerKeyEnv }, agentId: this.id });

    // 3. spawn(A3/A4)
    let child: ChildProcess;
    try {
      child = spawnCodex(this.exePath, argv, env, input.workdir);  // assertArgvNoSecret 在内(A4)
    } catch (e) {
      cleanup();                                                    // schema 文件清理
      // spawn 同步抛(如 argv 命中 key)→ 闸门前失败,不伪造 session_started(A2)
      yield { kind: 'error', code: (e as SyluxError).code ?? 'SUBPROCESS_SPAWN_FAILED', detail: String((e as Error).message) };
      return;
    }
    this.current = child;
    const gate = new FirstEventGate(sessionId);                     // resume 预置(A9);send 为空构造

    // 4. ★ A3:spawn 后立刻同步挂 sink(挂 stdout/stderr/error/close),先于喂 stdin,避免漏 thread.started
    const sink = new EventSink(child, gate);
    this.currentSink = sink;                                         // V3f:cancel() 用它写 terminationHint

    // 5. 兜底硬超时(A10):input.timeoutMs 优先,缺省取构造期 ceiling;到点 treeKill。
    //    V3f:超时用专用码 SUBPROCESS_TIMEOUT(02 §12 已登记),区别于人工 cancel 的 SUBPROCESS_CANCELLED。
    //    传 sink → treeKill 写 terminationHint → onClose 闸门后分支 emit TIMEOUT(而非误报 CRASHED)。
    const effectiveTimeout = input.timeoutMs ?? this.hardTimeoutCeilingMs;
    const timer = effectiveTimeout > 0
      ? setTimeout(() => { void treeKill(child, 'SUBPROCESS_TIMEOUT', sink); }, effectiveTimeout)
      : undefined;

    // 6. 喂 prompt(stdin EPIPE 兜底转 gate,A4),再拉事件流(§7.3)
    feedPromptStdin(child, input.prompt, (e) => {
      // 经 sink.failFromStdin:内部 gate.onFailure(幂等)+ null 守卫 + wake;
      // 多数情况进程随后 close 也会触发 onClose,gate 幂等保证不二次 emit(A2/A4)
      sink.failFromStdin(`stdin error: ${e.message}`);
    });
    try {
      for await (const ev of drainEventQueue(sink)) yield ev;
    } finally {
      if (timer) clearTimeout(timer);
      cleanup();                                                    // §9:schema 临时文件清理(成功/失败/cancel 都清,L2)
      if (this.current === child) { this.current = undefined; this.currentSink = undefined; }
    }
  }
}
```

### 8.3 buildChildEnv —— env 单一出口(规则属安全 08,本文件按权威签名调用,A5/V3h)

子进程 env **只**由 `buildChildEnv()` 产出,内部 `extendEnv:false`,**绝不** `{...process.env}`(A5、红队 R8、安全 08 §2.2 S2)。签名以**安全文档 08 §2.2 `BuildChildEnvInput` 单对象**为权威——v1 误写成 `buildChildEnv(provider, providerEnv)`(双位参 + 错误首参),v2/v3 已对齐 08。**import 路径(V3h)**:`import { buildChildEnv } from '@sylux/security'`(与 06 统一),不在 `@sylux/agents` 内自建实现。正确调用:

```ts
// 引用 08 §2.2 权威签名,本文件不另定义实现:
import { buildChildEnv, type BuildChildEnvInput } from '@sylux/security'; // 08 拥有规则与类型
// BuildChildEnvInput(08 §2.2 权威,此处仅复述字段,不另定义):
//   providerEnv: Record<string,string>  唯一允许携带 secret 的字段(S1);含 07 注入的 key env
//   agentId: AgentId                     注入非密 SYLUX_AGENT 诊断变量
//   inheritFromProcess?: NodeJS.ProcessEnv  默认 process.env,只挑 BASE_ENV_ALLOWLIST 白名单键

// §8.2 调用点(权威形态):
const env = buildChildEnv({ providerEnv: { ...input.providerEnv, ...providerKeyEnv }, agentId: this.id });
```

> 不变量复核:`spawnCodex` 的 `env` 形参**只**接 `buildChildEnv` 产物;代码评审 grep `\.\.\.process\.env` 在 `@sylux/agents/codex` 下应**零命中**(A5/S2 焊死)。key 经 07 `toCodexInjection().env`(变量名由 `env_key` 的 `-c` 行引用,§6.3)汇入 `providerEnv` → 只此一处进子进程 env;argvGuard(§6.4)是其对偶兜底确保 argv 无密。**provider key env 与 input.providerEnv 合并**时,二者都属 S1 secret 通路(08 §2.1),由 `buildChildEnv` 统一过 default-deny + 自检(08 §2.2 ④)。

> 不变量复核:`spawnCodex` 的 `env` 形参**只**接 `buildChildEnv` 产物;代码评审 grep `\.\.\.process\.env` 在 `@sylux/agents/codex` 下应**零命中**(A5/S2 焊死)。key 经 07 `toCodexInjection().env`(变量名由 `env_key` 的 `-c` 行引用,§6.3)汇入 `providerEnv` → 只此一处进子进程 env;argvGuard(§6.4)是其对偶兜底确保 argv 无密。**provider key env 与 input.providerEnv 合并**时,二者都属 S1 secret 通路(08 §2.1),由 `buildChildEnv` 统一过 default-deny + 自检(08 §2.2 ④)。

### 8.4 进程生命周期不变量(实现自检)

- **L1 单进程在飞(A8)**:`this.current` 同一时刻至多一个;新 `send/resume` 时若 `current` 仍在,`run` 入口**抛** `SUBPROCESS_SPAWN_FAILED`(调用方误用——引擎 03 已保证对同一 adapter 串行消费)。不静默排队、不先 cancel(避免吞掉正在进行的轮)。
- **L2 必清 schema 临时文件**:`run` 的 `finally` 无论成功/失败/cancel 都调 `cleanup()`(§9),不留临时 schema 文件堆积。spawn 同步抛分支也先 `cleanup()` 再 return。
- **L3 stdin 必 end**:`feedPromptStdin` 写完必 `end()`,否则 codex 等 EOF 永不返回(事实 A.3);写失败(进程已死)走 `onStdinError` 兜底,不崩(A4)。
- **L4 timer 必清**:超时计时器在流结束的 `finally` 清除,避免误杀下一个进程。`timeoutMs` 缺省取构造期 `hardTimeoutCeilingMs` 兜底(A10),不会出现「永不超时」。
- **L5 cancel 幂等**:无在飞进程时 `cancel()` 为 no-op(§3.1);重复 cancel 安全。
- **L6 ephemeral 不可 resume(A7)**:`run` 不阻止物理 `resume` 调用,但若引擎对一个 `ephemeral:true` 落过的会话调 `resume`,codex 侧大概率找不到会话 → 闸门前/后失败。约定由引擎(03)在 `ephemeral` run 把 `resumable` 强制为 false,从源头不发起此类 resume;适配器侧把它当普通 resume 失败如实 emit。

---

## 9. output-schema 落临时文件 + safeParse 兜底(事实 C,两端不对称)

事实 C 实测:`codex exec --output-schema <FILE>` 经中转(mouubox)能强制成形,`-o` 输出严格合 schema。codex 收**文件路径**(对比 claude 收**内联串**,事实 F——两端不对称由 `AgentInput.outputSchema` 传**对象**、各适配器自决落点吸收,02 §6.2)。本节定 codex 侧的「对象 → 临时文件 → 用完即删」+ 应用层 safeParse 兜底(事实 C 保留防御面)。

### 9.1 writeSchemaFile —— 对象落临时文件 + 清理钩子

```ts
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 把 buildAgentOutputJsonSchema() 产出的 JSON Schema 对象(02 §6.2)写临时文件,
 * 返回路径 + 幂等清理钩子。codex 用 --output-schema <path> 引用(§6.1/§6.2)。
 */
export async function writeSchemaFile(schema: Record<string, unknown>): Promise<{ path: string; cleanup: () => void }> {
  const dir = await mkdtemp(join(tmpdir(), 'sylux-schema-'));
  const path = join(dir, 'agent-output.schema.json');
  await writeFile(path, JSON.stringify(schema), 'utf8');   // utf8;codex 读文件无 Windows 重定向坑(事实 A)
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    void rm(dir, { recursive: true, force: true });        // 幂等;失败静默(临时目录,不阻断主流程)
  };
  return { path, cleanup };
}
```

> 不用 `-o <FILE>`(单独最终消息文件):适配器走 `--json` 事件流(§7),最终文本从 `item.completed.agent_message.text` 取(事实 B),无需再读 `-o` 文件,少一次 IO 与一个待清理文件。`-o` 仅在「需要纯最终消息落盘」的旁路场景用,本主链不启用。

### 9.2 safeParse 兜底链(事实 C 防御面,与引擎 03 协同)

事实 C 明确:单次实测过不代表复杂嵌套 100% 稳,**必须保留** zod `safeParse` 失败 → 带错误重发 ≤N → 抛 `OUTPUT_SCHEMA_VIOLATION` 的兜底(红队 R4)。**职责分层**:

| 层 | 谁做 | 动作 |
|---|---|---|
| 强制成形 | 适配器(本文件) | 传 `--output-schema` 文件,让 codex 经中转尽量产出合 schema 的 JSON(事实 C) |
| 原样交付 | 适配器(§7/A6) | 适配器**不** parse,只 emit `final_message.raw`(完整最终文本)+ usage |
| safeParse | 引擎 `consume`(03 §5.3) | `agentMessagePayloadSchema.safeParse(JSON.parse(raw))`(02 §6.1) |
| 打回重试 | 引擎 `runTurn`(03 §5.2) | 失败 → 带错误回灌重发 ≤`retryOnReject`,耗尽抛 `OUTPUT_SCHEMA_VIOLATION`(02 §8.4) |

> A6 焊死:适配器边界**不**把 `raw` 解析成 `Message`,只保证「把模型最终文本原样、完整、单条交出」。「raw 合不合 schema」是引擎+02 校验链的事,适配器越界 parse 会让错误归属混乱。事实 C 的「强制成形」是**减少**违例概率,不是**消灭**——兜底链恒在。

---

## 10. cancel() 与进程树 kill(shim 背后真子进程,§3.1)

### 10.1 为什么必须杀整棵树

事实 A:PATH 上的 `codex` 是 bash shim,claude 是 `.ps1/.cmd` shim。即便本文件 codex 适配器**直调真实 exe**(§4)绕开了 shim,仍要防御两点:① 真实 codex.exe 自身可能 fork 子进程(中转代理 / 工具调用);② claude 端(对称实现)走 shim 时 `child` 是 shim 进程,真 node 子进程在其下。`process.kill(child.pid)` 只杀直接子进程,**会留孤儿**。故 `cancel()`/超时一律杀**进程树**。

### 10.2 treeKill 实现(Windows / POSIX 不对称)

```ts
import { spawn } from 'node:child_process';

/**
 * 杀进程树。Windows 用 taskkill /T /F(按 PID 杀整棵);POSIX 用进程组负 PID 信号。
 * @param reasonCode 杀因,写入 sink.terminationHint,供 onClose 在闸门后分支 emit 对应 error code
 *   (V3f:TIMEOUT vs CANCELLED 由此区分;不传则 onClose 默认 CRASHED)。
 * @param sink 可选:有 sink 时把 reasonCode 记进 terminationHint;cancel/超时路径必传。
 */
export async function treeKill(
  child: ChildProcess,
  reasonCode: 'SUBPROCESS_CANCELLED' | 'SUBPROCESS_TIMEOUT' | 'SUBPROCESS_CRASHED' = 'SUBPROCESS_CANCELLED',
  sink?: { terminationHint?: string },
): Promise<void> {
  if (sink) sink.terminationHint = reasonCode;   // ★V3f:onClose 闸门后分支读它,而非硬编码 CRASHED
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return; // 已退出:no-op(L5 幂等)

  if (process.platform === 'win32') {
    // Windows:taskkill /PID <pid> /T(含子树)/F(强杀)。直调,不经 shell。
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false });
      tk.on('close', () => resolve());
      tk.on('error', () => { try { child.kill('SIGKILL'); } catch {} resolve(); }); // taskkill 缺失兜底
    });
  } else {
    // POSIX:spawn 时需 detached:true 建独立进程组,这里对 -pid 发信号杀整组。
    try { process.kill(-pid, 'SIGTERM'); } catch { /* 组可能已散 */ }
    await delay(300);                                        // 宽限期
    try { if (child.exitCode === null) process.kill(-pid, 'SIGKILL'); } catch {}
  }
  // 实际 emit 的 code 由 §7.3 onClose 依 gate 相位决定:闸门前→SPAWN_FAILED(A2);
  // 闸门后→terminationHint(本次 reasonCode)否则默认 CRASHED。
}
```

> **V3f 终止原因贯通**:`cancel()`/超时计时器调 `treeKill(child, reason, sink)`,把 `reason` 写进 `sink.terminationHint`;`EventSink.onClose`(§7.3)的闸门后分支读 `terminationHint`(无则 `SUBPROCESS_CRASHED`)。这修掉 v2 的隐性 bug:v2 把 `reasonCode` `void` 掉、onClose 硬编码 `CRASHED`,导致超时/人工取消都被错报为 `CRASHED`,引擎无法区分「该放宽超时重试」与「真崩溃」。
>
> **POSIX 注(A5)**:`treeKill` 走进程组要求 spawn 时 `detached:true`——`spawnCodex` 已按平台设置(`detached: process.platform !== 'win32'`,§8.1),故 `process.kill(-pid, …)` 对整组生效。Windows 不设 detached(`taskkill /T` 按 PID 树即可),`windowsHide:true` 已足。POSIX 进程组 kill 的端到端行为本机(Windows)未覆盖,标【待实测 R-posix-kill】。

### 10.3 取消语义与流收尾

- `cancel()` → `treeKill(current, 'SUBPROCESS_CANCELLED', sink)` → 进程 `close` → §7.3 的 close 回调按 `gate` 相位 emit:闸门后 → `{kind:'error', code:'SUBPROCESS_CANCELLED'}`(读 terminationHint);闸门前(罕见:刚 spawn 就 cancel)→ `SUBPROCESS_SPAWN_FAILED`(A2,仍不伪造 session_started)。
- 超时(`input.timeoutMs`/`hardTimeoutCeilingMs`)走同一 `treeKill` 路径但 `reason='SUBPROCESS_TIMEOUT'`(§8.2 第 5 步,V3f),闸门后收尾 emit `SUBPROCESS_TIMEOUT`,与手动 cancel 区分;闸门前同样归 `SUBPROCESS_SPAWN_FAILED`。
- 引擎侧:被 cancel 的 turn 在 `consume`(03 §5.3)拿到 `error` 事件,按错误码处理;若闸门后已落 `sessionId`,该 agent 仍 `resumable=true`(F-c),引擎可选 resume 续。

### 10.4 cancel ↔ kill 别名(§3.4 回填)

任务接口为 `cancel()`;master §4.1 历史 `kill()`。`AgentAdapter` 可临时 `kill = cancel` 的 `@deprecated` 别名,M1 后删;回填 master §4.1 统一 `cancel()`(§11)。语义恒为「杀进程树」(本节),非只杀直接子进程。

---

## 11. 跨文档回填项(需修正 master-plan / 07 / 02)

本文件以事实地基(A/E)重写了适配层,且 v3 据具名红队/交叉报告吃掉跨文签名冲突。回填汇总:

| # | 上游初稿 | 本文件(事实/v3 为准) | 理由 |
|---|---|---|---|
| B1 | `execa('codex', ['exec', …])` 裸名启动 | 直调真实 exe(§4 `resolveCodexExe`),`shell:false` | 事实 A:裸 `codex` 是 bash shim,`Start-Process` 报非法 Win32;`.cmd` 打散带空格 prompt |
| B2 | prompt 作 argv 字符串传入 | prompt 走 stdin,argv 用 `-` 占位(§6/§8.1) | 事实 A.3:唯一干净路径 |
| B3 | `exec` 与 `resume` 共用同一组 flag(含 `-s`/`-C`) | 两套 argv(§6.1/§6.2);resume 拒 `-s`/`-C`,必带 `--skip-git-repo-check` | 事实 E 实测拒绝 |
| B4 | 接口方法 `kill()` | `cancel()`(§3.1);`kill` 临时 `@deprecated` 别名 | 任务要求 + §3.4/§10.4 |
| B5 | (未明确)token 本地估算 | 直取 `turn.completed.usage` snake→camel 归一(§7.1) | 事实 B/D:中转回吐可靠 |
| B6 | (未明确)resume 省 token | resume 不省、累积/超线性;continuity 决策在引擎(03 §2.1) | 事实 D |
| B7 | (未明确)output-schema 传法 | codex 文件 / claude 内联,由 `AgentInput.outputSchema` 对象吸收(§9 / 02 §6.2) | 事实 C/F 两端不对称 |
| B8 | ~~02 §12 缺 SUBPROCESS_CRASHED/CANCELLED~~ **已闭合(V3f)** | 02 §12 v2 已登记 `SUBPROCESS_SPAWN_FAILED`/`CRASHED`/`TIMEOUT`/`CANCELLED`(本文核对 02 §12 line 972–975)。本文件改为**引用**,**无需回填** | x-consistency A1 / x-coverage COV-1 已被 02 v2 吃掉;本条降级为「确认一致」 |
| B9 | (07 §5.2)provider 注入权威 | 收敛到 07 `toCodexInjection(cfg, keystore, ov?)` **三参**(V3a),05 不再 `mergeProviderOverrides`;`pushProviderConfig` 薄包装 | 消除 05/07 重复 + 补 `env_key` 行;**07 §5.3/§14.1 已点名要 05 回填此项** |
| B10 | (08 §2.2)`buildChildEnv` 签名 + import 路径 | 单对象 `BuildChildEnvInput`,import 自 `@sylux/security`(V3h) | 与 08 §2.2 权威 + 06 import 路径对齐;v1 双位参作废 |
| **B11** | (07 §3 / §8.4)工厂缺 `keystore`;`ProviderOverrides` 缺 `fallbackModel` | `createCodexAdapter`/`createClaudeAdapter` 构造期收 `keystore`(V3b);`ProviderOverrides` 增 `fallbackModel?`(V3c) | **回填 07 §3** 补 `fallbackModel`(若未含);adapter 工厂签名对齐 07 §8.4 热换链 |
| **B12** | (02 §6.3)`final_message` 是否含 `usageDegraded` | 若 02 §6.3 `AgentEvent.final_message` 未含 `usageDegraded?: boolean`,**回填 02 §6.3**(可选字段,向后兼容);否则确认一致 | V3j:供刹车 04 区分 output 字段漂移 vs 真 0,防成本刹车失明(ROC-M1) |
| **B13** | (05 §2 / 06 §3.4)`AgentInput` claude 专属字段 | `AgentInput` 增 `appendSystemPrompt?`/`effort?`/`maxTurns?`(本文件 §2 已落,06 消费) | V3c / 06 §12.1;codex 端忽略,向后兼容 |

> 另:本文件依赖 02 §6.3 的 `AgentEvent`/`TokenUsage`(已含 `session_started.sessionId.min(1)` 与 `final_message.usage` 增强);新增 `usageDegraded`(B12)若 02 未含需回填,余无新增类型。**02 §12 错误码 union 本文件全部引用,零自造**(对账 02 §12:`SUBPROCESS_SPAWN_FAILED`/`CRASHED`/`TIMEOUT`/`CANCELLED`、`PROVIDER_CONFIG_INVALID`、`OUTPUT_SCHEMA_VIOLATION` 均已登记)。

---

## 12. 测试矩阵(交付验收锚点,对接 master §12)

`@sylux/agents` codex 端必测项。优先用 `fixtures/fake-codex.mjs`(真 `.cmd` shim 包一层 node,事实 A / master §4.5)产出可控 JSONL,免真打中转。

| # | 用例 | 输入 / 构造 | 期望 |
|---|---|---|---|
| A1 | exe 解析命中 | 本机平台包 vendor bin 存在 | `resolveCodexExe()` 返回绝对路径 |
| A2 | exe 缺失 | 所有候选根无 codex.exe | 抛 `SUBPROCESS_SPAWN_FAILED`,detail 列 tried |
| A3 | 显式 exePath 优先 | 传 `exePath` | 用传入路径,不探测 |
| E1 | exec argv 正确 | `buildExecArgs` | 含 `exec --output-schema <f> --json -C <wd> -s <sb>` 末尾 `-`,无 key |
| E2 | resume argv 正确 | `buildResumeArgs` | 含 `exec resume --json --skip-git-repo-check`,**无** `-s`/`-C`,`SESSION_ID` 在 `-` 前 |
| E3 | resume 不含 -s/-C | `buildResumeArgs` 输出 | 断言数组无 `-s`、无 `-C`(事实 E) |
| K1 | argv 含 sk- | argv 注入 `sk-abc…` | `assertArgvNoSecret` 抛 `PROVIDER_CONFIG_INVALID`,detail 仅前缀 |
| K2 | key 走 env | providerEnv 带 key,argv 用 env_key 名 | spawn 成功,argv 无 sk- |
| B1 | 首事件 session_started | fake-codex 吐 `thread.started` 首行 | 流首事件 `{kind:'session_started', sessionId:thread_id}` |
| B2 | final + usage | 吐完整 4 类事件 | 末事件 `final_message`,`usage` snake→camel 正确 |
| B3 | tool_call 透传 | item.completed 非 agent_message | emit `tool_call` |
| B4 | usage 缺失 | turn.completed 无 usage | `final_message.usage===undefined`,不报错(R-parse-4) |
| B5 | 非 JSON 行 | stdout 混入日志行 | 跳过,不中断流(R-parse-1) |
| B6 | chunk 半行 | thread.started 被拆两个 data chunk | LineSplitter 缓冲后正确解析(§7.2) |
| F-a | spawn 即失败 | exePath 指向非 PE 文件 | 仅 emit `error: SUBPROCESS_SPAWN_FAILED`,**无** session_started(A2) |
| F-b | 闸门前退出 | fake-codex 不吐 thread.started 直接 exit 1 | `error: SUBPROCESS_SPAWN_FAILED`,detail 带 exitCode/stderr,resumable=false |
| F-c | 闸门后崩溃 | 吐 thread.started 后 kill | 先 session_started,再 `error: SUBPROCESS_CRASHED`,resumable=true |
| G1 | gate 幂等 | 吐两次 thread.started | session_started 仅一次(R-parse-2/§5.3) |
| C1 | cancel 杀树 | send 进行中 cancel() | 进程树退出,流以 `error: SUBPROCESS_CANCELLED` 收尾 |
| C2 | cancel 幂等 | 无在飞进程 cancel() | no-op 不抛(L5) |
| C3 | 超时 | timeoutMs 到点 | treeKill,流以 cancelled 收尾,timer 清除(L4) |
| S1 | schema 文件落盘+清理 | run 一次 | 临时文件存在于 spawn 期,finally 后删除(L2) |
| S2 | stdin end | feedPromptStdin | stdin 写入后 end(L3),codex 返回 |
| D1 | resume 累积 usage | 连续 send→resume 两轮(真/fake) | round2 inputTokens > round1(事实 D 趋势;真实数值环境相关) |
| RS1 | resume 预置首事件(A9) | resume 入参 sessionId,fake-codex **不**重发 thread.started | 流首事件 `session_started`,sessionId === 入参(§5.5) |
| RS2 | resume 重发 thread.started 幂等 | resume 后 fake-codex 又吐 thread.started(同 id) | session_started 仅一次(预置那次);重发被吞(R-parse-9) |
| RS3 | resume 重发不同 thread_id | fake-codex 吐异 id | 对外仍用入参 sessionId,记 system 告警(§5.5) |
| A3t | 极快返回不丢首事件 | fake-codex spawn 后立即吐全部 4 类事件即 exit | session_started + final 均收到(EventSink 同步挂监听,A3) |
| A4t | stdin EPIPE 不崩 | fake-codex spawn 后立即 exit,prompt 写入失败 | emit `error: SUBPROCESS_SPAWN_FAILED`,进程不崩(A4);无 unhandled rejection |
| A6a | 单行超闸 | fake-codex 吐一行 > 512KiB 无 \n | emit `error`(SUBPROCESS_CRASHED/SPAWN_FAILED 依相位),treeKill,无 OOM(A6) |
| A6b | stderr 刷屏有界 | fake-codex 狂吐 stderr 数 MB 后 exit | detail 仅含末 16KiB,内存不随 stderr 量增长(A6 RingBuffer) |
| A6c | 背压 | fake-codex 极快吐数千 tool_call,消费者慢 | stdout 在 queue 高水位 pause,drain 后 resume;不 OOM(R-parse-6) |
| A8t | 并发 run 抛 | 未消费完前再调 send | 第二次 `run` 抛 SUBPROCESS_SPAWN_FAILED(A8/L1) |
| A10t | 超时兜底 | input 不传 timeoutMs,fake-codex 挂死不返回 | hardTimeoutCeilingMs 到点 treeKill,流以 **SUBPROCESS_TIMEOUT** 收尾(A10/V3f) |
| A11t | provider 注入无重复/含 env_key | buildExecArgs 用 toCodexInjection(provider,keystore,ov).cArgs | argv 含 `-c model_providers.<n>.env_key=<VAR>`,无 sk-;env 含真实 key(A11/V3a) |
| A1t | buildChildEnv 单对象签名 | 调用点 `buildChildEnv({providerEnv, agentId})`,import 自 `@sylux/security` | 类型检查通过;env 仅白名单+providerEnv+key(对账 08 §2.2,V3h) |
| V3a | toCodexInjection 三参 | run 调 `toCodexInjection(provider, keystore, ov)`(无单独 mergeProviderOverrides) | 类型检查通过;keystore.resolve 被调一次;merge 由 07 内置(对账 07 §5.2) |
| V3b | 工厂注入 keystore | `createCodexAdapter({provider, keystore})` 缺 keystore | TS 编译红(keystore 必填);提供后 send 能解析 key 进 env |
| V3b2 | key 解析失败闸门前 | keystore.resolve 抛 PROVIDER_CONFIG_INVALID | run 仅 emit `error: PROVIDER_CONFIG_INVALID`,**无** session_started(A2);schema 文件已 cleanup |
| V3c | claude 字段 codex 忽略 | AgentInput 带 `appendSystemPrompt`/`effort`/`maxTurns` | codex buildExecArgs/buildResumeArgs argv **不含** `--append-system-prompt`/`--effort`/`--max-turns`(只 claude 用) |
| V3f1 | 超时 vs cancel 码区分 | ① timer 触发 ② cancel() 触发,均闸门后 | ① 流以 `SUBPROCESS_TIMEOUT` 收尾;② 以 `SUBPROCESS_CANCELLED` 收尾(terminationHint 贯通,非都 CRASHED) |
| V3f2 | 真崩溃仍 CRASHED | 闸门后进程自己非零退出(无 cancel/超时) | terminationHint 未设 → 流以 `SUBPROCESS_CRASHED` 收尾(F-c 默认) |
| V3j1 | usage output 漂移降级 | turn.completed.usage 有 input_tokens 无 output_tokens | `final_message.usageDegraded===true`,usage.outputTokens=0(供刹车走地板,ROC-M1) |
| V3j2 | usage 全缺不算 degraded | turn.completed 无 usage 信封 | `final_message.usage===undefined`,**无** usageDegraded(R-parse-4 路径,区别于 V3j1) |
| V3i | read-only 不产 diff | send 传 `sandbox:'read-only'`,fake-codex 正常吐 final | argv 含 `-s read-only`;流正常 final_message(方案文本),适配器不因「无文件写」特判 |

> 【待实测 M0 闭环】:R-resume-thread(codex `exec resume` 是否重发 `thread.started` 首行,§5.5——本设计已用预置解耦,实测仅为确认观察项)、R-resume-schema(resume 是否收 `--output-schema`,§6.2)、R-posix-kill(POSIX `detached` 进程组 kill,§10.2)、claude 端内联 schema 32KB 上限(02 §6.2 / 事实 F)。这四项标记保留,余项均由事实地基(A–G)覆盖,不再标【待实测】。
