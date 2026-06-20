# 16 · 配置全集 Schema(`sylux.config` 顶层契约与字段文档)

> **v2(红队硬化)**:吃掉 ROC-B1(blocker:§6.4 默认预算表按 regime 分口径,stateless 线性/resume 累积,删超线性误配)、ROC-M2(major:§11.5 stop 阈值热换走 04 `reconfigure`,删废弃 `checkBefore`)、E9(major:§5.1/§6.1/§7 zod 补空缺标注 + 编译期漂移护栏)。详见 §15.1.4。

> **本文件地位**:sylux **整体配置文件**(YAML / JSON)的权威 zod schema 与字段文档。拥有顶层 `SyluxConfig`(聚合 run 目标 / agents·provider / playbook 选择与参数 / 三重刹车 stop 策略 / worktree·沙箱 / server·WS·面板 / 日志可观测),以及**配置加载管线**(文件解析 → env 引用解析 → zod 校验 → 跨段交叉校验 → 派生各子系统配置对象)。一份磁盘配置进来,产出引擎(03)/ 刹车(04)/ provider(07)/ worktree(09)/ WS(08·11)/ 日志(15)各自需要的配置实例。
>
> **类型引用而非另写(焊死红队 R1)**:本文件**不另定义**任何已在别处拥有的类型,只**组装**:
> - `Message`/`EvidenceItem`/`AgentId`/`Role`/`MessageKind`/`RunStatus`/`SyluxErrorCode` → **黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。
> - `ProviderSettings`/`ProviderConfig`/`KeyRefBinding`/`PanelProviderConfig` → **provider(07)** `@sylux/providers`。本文件 §4 直接内嵌 `providerSettingsSchema`,**不重画 provider 字段**。
> - `PlaybookParams`/`PlaybookId`/`ContinuityMode` → **引擎(03)** `@sylux/core`。
> - `StopPolicyConfig`/`MaxRoundsConfig`/`ConvergenceConfig`/`BudgetConfig`/`TokenPricing` → **刹车(04)** `@sylux/core/src/stop`。
> - `WorktreeRunConfig` 及沙箱封顶 `capSandbox` → **worktree(09)** / **安全(08)**。
> - WS 安全规则(127.0.0.1 / Origin / 一次性 token / 权限分级)→ **安全(08)§5**;WS 线格式 → **WS 协议(11)**。
> - 日志字段 / 级别 / redact 落点 → **可观测(15)** / **安全(08)§3**。
>
> **事实地基**:凡涉及 spawn/token/resume 成本/沙箱首轮定死,以 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)为准,已覆盖项不再标【待实测】。基线底价 ≈18.7k input/回合、累积/超线性成本模型贯穿 stop 段默认值(§6)。

---

## 0. 设计目标与不变量

### 0.1 一份文件,一次校验,派生全系统

配置层解决三件事:① 让用户用**一份**人类可读文件(YAML 优先,JSON 兼容)声明整个 run 的全部可调项;② 启动时**一次性**做结构 + 跨段语义校验,**fail-fast**(坏配置绝不 spawn 任何子进程);③ 把校验后的配置**派生**成各子系统已定义的配置对象(不让各子系统各自读文件,杜绝多处解析漂移)。

```
sylux.config.yaml ──load──▶ 原始对象 ──env解析──▶ ──zodParse──▶ SyluxConfig ──derive──▶ ┬─ ProviderSettings (07)
   (磁盘/面板)        (只解引用名→env)   (结构+跨段)                       ├─ Playbook + PlaybookParams (03)
                                                                          ├─ StopPolicyConfig (04)
                                                                          ├─ WorktreeRunConfig + sandboxCeiling (09)
                                                                          ├─ WS/Server 运行参数 (08/11)
                                                                          └─ Logger/Metrics 配置 (15)
```

### 0.2 本文件负责 / 不负责

| 负责(给完整 zod + 字段语义 + 派生 + 示例) | 不负责(只引用,定义在别处) |
|---|---|
| 顶层 `SyluxConfig` 聚合 schema | 各子配置字段本体(provider 07 / stop 04 / worktree 09 …) |
| 配置加载管线 `loadSyluxConfig`(解析/env/校验/派生) | `KeyStore.resolve` 真值解析(07 §2)/ redact 规则(08) |
| 跨段交叉校验(playbook↔stop↔provider↔agents 一致性) | `validateMessage` / 指纹(02)/ 刹车算法(04) |
| playbook 默认参数与 config 覆盖的**优先级合并**(§6.3) | 引擎循环 `runEngine`(03)/ WS 帧线格式(11) |
| 命名/格式约定(snake↔camel 边界、env 引用语法、§10) | env 白名单 `BASE_ENV_ALLOWLIST` 规则(08 §2.2) |
| 红蓝对抗 / 主从 两份可直接用的示例配置(§12) | 面板 UI 渲染(10) |

### 0.3 配置层不变量(实现必须保持)

- **K1 key 永不入文件(承接 07 P1)**:配置文件里**只有 `apiKeyRef` 引用名**,没有任何 `apiKey`/`sk-` 真值。真实 key 仅经 `KeyStore`(07 §2)从 env/auth.json 解析。grep 配置文件应零命中密钥值。校验期对疑似把 secret 写进配置值的情况(命中 08 `SECRET_SIGNATURES`)直接 `PROVIDER_CONFIG_INVALID` 炸,`detail` 不回显值。
- **K2 fail-fast 不半启动**:任何 zod 结构错 / 跨段语义错 / key 引用缺绑定 → 抛 `SyluxError`,**不 spawn 任何子进程、不建 worktree**。坏配置 0 副作用。
- **K3 单一解析出口**:配置文件**只**由 `loadSyluxConfig` 解析一次,产出 `SyluxConfig` 后各子系统从派生对象取,**不重新读盘**。热加载(面板保存)走同一函数 + 07 §8.6 `reload` 失败安全(坏配置保留旧值)。
- **K4 派生不丢校验**:派生出的子配置(如 `ProviderSettings`)必须是**已过其自身 zod**的实例;本文件聚合 schema 内嵌各子 schema,`safeParse` 一次到底,不存在「顶层过了子层没过」。
- **K5 沙箱封顶不可越(承接 08 S6 / 09 W7)**:配置无论怎么写,自动化路径 `sandboxCeiling` 最高 `workspace-write`;文件里出现 `danger-full-access` → 校验期降级到 `workspace-write` 并告警(不静默接受,也不直接拒整份配置)。
- **K6 WS 默认最小暴露(承接 08 S7)**:WS 默认绑 `127.0.0.1`、默认 `spectate` 只读;配置可改端口但**不可**把 host 改成 `0.0.0.0`(校验期拒,见 §8.2)。
- **K7 schema 自带版本**:配置带 `version` 字段,与 02 `SCHEMA_VERSION` 解耦(配置结构演进独立计数,§1.3),旧文件可识别 + 迁移。

---

## 1. 物理落点、文件格式与加载管线

### 1.1 包归属与文件布局

配置聚合层是**组合根**职责,落 `@sylux/server`(依赖图最上游可见 providers/core,总体规划 §10:`shared ← core ← {providers, agents} ← server ← web`)。它 import 各子包的 schema 做内嵌组装,不被任何子包反向依赖。

```
packages/server/
├─ src/
│  ├─ config/
│  │  ├─ config.schema.ts     # ★ SyluxConfig 顶层 zod(内嵌 07/03/04/09 子 schema)
│  │  ├─ load.ts              # loadSyluxConfig:read→parse→envResolve→zodParse→crossCheck(§11)
│  │  ├─ env-ref.ts           # ${env:NAME} 引用语法解析(§10.2;只解引用名,不碰 key 真值)
│  │  ├─ derive.ts            # SyluxConfig → 各子系统配置对象(§11.4)
│  │  ├─ defaults.ts          # 各 playbook 的默认 stop 参数表(§6.4,源自 03 §7 params 字面量 + 18 §6.4 regime 公式)
│  │  └─ errors.ts            # 复用 02 §12 SyluxErrorCode(不新增,§13)
│  └─ ...
```

### 1.2 文件格式:YAML 优先,JSON 兼容

- **YAML**(`.yaml`/`.yml`):默认与推荐格式(注释友好、多行 string 友好)。用 `yaml`(npm)解析为普通 JS 对象后,与 JSON 路径合流,**统一进同一个 `syluxConfigSchema.safeParse`**。
- **JSON / JSONC**(`.json`):兼容格式(面板导出 / 程序生成);JSONC 注释在解析前剥离。
- **解析后即同构**:无论来源,进 zod 的都是同一种 JS 对象。格式只影响 §1.4 的 read 步,不影响 schema 本体。
- 默认查找顺序(CLI 未显式 `--config <path>` 时):`./sylux.config.yaml` → `./sylux.config.yml` → `./sylux.config.json` → 报 `CONFIG_NOT_FOUND`(K2)。

### 1.3 配置 schema 版本(与 02 解耦)

```ts
/** 配置文件结构版本。与黑板 SCHEMA_VERSION(02 §1.2)独立计数:
 *  配置结构演进(加段/改字段)不必牵动黑板契约版本,反之亦然。 */
export const CONFIG_SCHEMA_VERSION = 1 as const;
export type ConfigSchemaVersion = typeof CONFIG_SCHEMA_VERSION;
```

> 破坏性变更(删段、改字段类型、改 env 引用语法)+1 并在 `load.ts` 加迁移分支(同 02 §7.4 风格)。新增**可选**段 / 字段不强制 +1。`version` 缺省视为 `1`(向后兼容首版无版本号的文件)。

### 1.4 加载管线总览(五步,任一步失败即 fail-fast,K2)

```
① read     : 按格式读盘/收面板串 → 原始 JS 对象          失败码 CONFIG_NOT_FOUND / CONFIG_PARSE_ERROR
② envRef   : 解析 ${env:NAME} 占位为「引用名」(§10.2)   失败码 CONFIG_ENV_UNRESOLVED
             ★只解引用名,绝不在此读取 key 真值(K1;真值留给 KeyStore 07 §2)
③ zodParse : syluxConfigSchema.safeParse(内嵌全部子 schema)  失败码 CONFIG_SCHEMA_INVALID
④ crossChk : 跨段语义校验(§11.2:playbook↔stop↔provider↔agents)  失败码见 §11.2 表
⑤ derive   : 派生各子系统配置对象(§11.4),沙箱封顶在此 enforce(K5)  失败码 PROVIDER_CONFIG_INVALID 等
```

详细伪代码见 §11.1。

---

## 2. 顶层 `SyluxConfig` schema 总览

### 2.1 段落组成与来源映射

顶层是 8 个段(`run`/`agents`(=providers)/`playbook`/`stop`/`worktree`/`server`/`logging`/`fusion`)的聚合。每段的字段权威在下游文档,本文件只**内嵌组装 + 顶层语义**:

| 段 | 内容 | 字段权威来源 | 本文件章节 |
|---|---|---|---|
| `version` | 配置结构版本 | 本文件 | §1.3 |
| `run` | run 目标 / repoRoot / runId 策略 | 本文件 | §3 |
| `providers` | keyBindings + 各 agent 槽 + 候选(`ProviderSettings`) | **07** | §4 |
| `playbook` | 范式选择 + 角色指派 + 参数覆盖 | **03** | §5 |
| `stop` | 三重刹车(maxRounds/收敛/预算)+ pricing | **04** | §6 |
| `worktree` | 隔离/沙箱封顶/清理策略 | **09 / 08** | §7 |
| `server` | WS/HTTP 端口 + 安全(127/Origin/token)+ 面板 + metrics | **08·11 / 15** | §8 |
| `logging` | 级别 / 输出 / redact 落点(指针) | **15 / 08** | §9 |
| `fusion` | 远景 panel(可选,占位) | **07 §10** | §4.4 |

### 2.2 顶层 schema(组装,字段细节见各段)

```ts
import { z } from 'zod';
import { providerSettingsSchema } from '@sylux/providers';        // 07 §3.3(内嵌 panels)

export const syluxConfigSchema = z.object({
  /** 配置结构版本(K7);缺省视为 1。 */
  version: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION),
  /** run 目标与仓库(§3) */
  run: runConfigSchema,
  /** provider 全集(07 权威,直接内嵌;含 keyBindings/slots/panels) */
  providers: providerSettingsSchema,
  /** 剧本选择与参数覆盖(§5) */
  playbook: playbookSelectionSchema,
  /** 三重刹车(§6;省略段则全用 playbook 默认) */
  stop: stopConfigSchema.optional(),
  /** worktree / 沙箱(§7;省略用默认) */
  worktree: worktreeConfigSchema.default({}),
  /** server / WS / 面板 / metrics(§8;省略用默认) */
  server: serverConfigSchema.default({}),
  /** 日志(§9;省略用默认) */
  logging: loggingConfigSchema.default({}),
}).superRefine(crossFieldCheck); // §11.2 跨段语义(playbook↔stop↔provider↔agents)
export type SyluxConfig = z.infer<typeof syluxConfigSchema>;
```

> `providers` 直接复用 07 的 `providerSettingsSchema`(含其 `keyBindings`/`slots`/`panels`/superRefine),**一字不改**——这正是 K1/K3 的落地:provider 字段只有一处定义,配置层只是把它挂在 `providers` 键下。`fusion` 段即 `providers.panels`(07 §10),不另起顶层段,避免与 provider 配置割裂。

---

## 3. `run` 段 —— run 目标与仓库

```ts
export const runIdStrategySchema = z.enum([
  'nanoid12',   // 默认:12 位 nanoid(短,缓解 Windows MAX_PATH,09 §2.4)
  'explicit',   // 用 fixedRunId 指定(回放/调试复跑同一 runId)
]);

export const runConfigSchema = z.object({
  /** 本次 run 的任务目标(自然语言)。引擎 onStart 注入为 PromptContext.goal(03 §2.2)。 */
  goal: z.string().min(1),
  /** 用户目标仓库绝对路径(worktree 在此派生,09 §2.2)。必须存在且是 git 仓库(crossChk 校验)。 */
  repoRoot: z.string().min(1),
  /** runId 生成策略(默认短 nanoid,09 §2.4 Windows 路径约束) */
  runIdStrategy: runIdStrategySchema.default('nanoid12'),
  /** runIdStrategy==='explicit' 时必填:固定 runId(crossChk 强制,§11.2) */
  fixedRunId: z.string().min(1).max(64).optional(),
  /** 可选:goal 太长时改从文件读(与 goal 二选一;都给以 goalFile 为准并告警) */
  goalFile: z.string().min(1).optional(),
  /** 可选:run 级标签(面板分组 / 日志 base 字段;非密) */
  labels: z.record(z.string(), z.string()).default({}),
}).superRefine((c, ctx) => {
  if (c.runIdStrategy === 'explicit' && !c.fixedRunId)
    ctx.addIssue({ code: 'custom', message: "runIdStrategy='explicit' 需 fixedRunId", path: ['fixedRunId'] });
  if (!c.goal && !c.goalFile)
    ctx.addIssue({ code: 'custom', message: 'goal 与 goalFile 至少给一个', path: ['goal'] });
});
export type RunConfig = z.infer<typeof runConfigSchema>;
```

| 字段 | 类型 | 必填 | 派生去向 | 语义 |
|---|---|---|---|---|
| `goal` | string | 是* | `PromptContext.goal`(03) | run 任务目标 |
| `repoRoot` | string | 是 | `WorktreeRunConfig.repoRoot`(09) | 目标仓库;crossChk 验存在+是 git 仓 |
| `runIdStrategy` | enum | 默认 nanoid12 | runId 生成 | 短 id 缓解 MAX_PATH(09) |
| `fixedRunId` | string? | explicit 时必填 | runId | 回放复跑 |
| `goalFile` | string? | 与 goal 二选一 | 读文件→goal | 长目标外置 |
| `labels` | record | 默认 {} | 日志 base / 面板 | 非密标签 |

\* `goal` 或 `goalFile` 至少一个;`repoRoot` 必须存在且为 git 仓库(crossChk,否则 worktree 无法 `create`,09 §3.3)。

---

## 4. `providers` 段 —— 直接复用 07 `ProviderSettings`(不另写)

### 4.1 内嵌而非重画

`providers` 段**就是** 07 §3.3 的 `providerSettingsSchema`,本文件不重复其字段定义(焊死 R1)。它包含:

- `keyBindings: KeyRefBinding[]` —— 密钥**引用名→来源**绑定表(07 §2;`source: env|auth_json|none`,只名字无真值,K1)。
- `slots: AgentProviderSlot[]` —— 每个执行体 agent 槽(`codex`/`claude`)的 `activeId` + `candidates[]`(07 §3.3;含热换/failover 候选)。
- `panels: PanelProviderConfig[]` —— 远景 Fusion(07 §10;默认空,§4.4)。

字段全集、superRefine(activeId∈candidates、同槽 agentKind 一致、apiKeyRef 有绑定)、注入翻译、热换流程**全部见 07**,本文件只规定它在配置文件里的**位置**与**与其他段的交叉校验**(§11.2)。

### 4.2 配置文件里的 provider 表达(snake↔camel 边界,§10.1)

provider 字段在**配置文件层保留 snake_case**(对齐 codex `config.toml` 习惯,13 §4.2),进 TS 后由加载层转 camelCase。即文件写 `base_url`/`wire_api`/`api_key_ref`,zod 收到的是 `baseUrl`/`wireApi`/`apiKeyRef`。转换集中在 `load.ts`(§10.1),`providerSettingsSchema` 本身收 camelCase(07 现状),不污染 07。

### 4.3 与 agents 的关系:providers 段即「每 agent 一份 provider」

立项简报说「agents(每个的 provider/role)」。在 sylux 模型里这拆成两处,**不在一处混写**:

- **agent 的 provider** = `providers.slots[].candidates`(07,每 agent 槽一份 active + 候选)。
- **agent 的 role** = **不在配置里静态绑定**,而是 playbook 运行期逐轮指派(03 E1:role⊥agent)。配置只在 `playbook.assignment`(§5)给**默认指派**,真实 role 由 `nextTurn` 决定。

> 这是刻意的:把「role 写死进 agent 配置」会破坏 03 的 role⊥agent 解耦(E1)。配置层只声明「哪个物理 agent 用哪个 provider」,「谁扮 critic」交给 playbook。§5 的 `assignment` 仅是 playbook 的默认查表覆盖。

### 4.4 `fusion`(远景,可选)

Fusion panel 即 `providers.panels`(07 §10 `PanelProviderConfig[]`),不另起顶层段。默认 `[]`(M0/M1 单 agent,panel 先占位)。启用时每个 panel 绑定一个**角色**(02 `roleSchema`)+ 成员(≥2 provider)+ 裁判;`enabledKinds` 不可含 `implement`(07 §10.2 superRefine:执行回合必须单 agent)。配置层不校验 Fusion 算法(归引擎 03),只透传 07 的 schema 校验。

---

## 5. `playbook` 段 —— 范式选择 + 角色指派 + 参数覆盖

### 5.1 schema

```ts
import { agentIdSchema, roleSchema } from '@sylux/shared';        // 02 权威枚举
import type { PlaybookId as PlaybookIdT, ContinuityMode as ContinuityModeT } from '@sylux/core'; // 03 权威 TS 类型

/**
 * 范式标识 zod(03 §3.3 给的是 TS union `type PlaybookId = 'red-blue'|…`,**未导出 zod**;
 * 配置层需要运行期校验文件输入,故在此**补 zod**——属"填 03 留的 zod 空缺"(E9),不是另立权威。
 * 字面量集必须与 03 §3.3 逐字一致;下方 `satisfies` 断言在编译期锁死二者同构(漂移即编译红)。
 */
export const playbookIdSchema = z.enum(['red-blue', 'master-worker', 'pair', 'parallel']);
export type PlaybookId = z.infer<typeof playbookIdSchema>;
// ★E9 漂移护栏:若 03 §3.3 PlaybookId 增删成员,以下两行任一编译失败,逼迫本表同步。
const _piFwd: PlaybookIdT = '' as unknown as PlaybookId;   // 本地 ⊆ 03
const _piBwd: PlaybookId = '' as unknown as PlaybookIdT;   // 03 ⊆ 本地  → 双向 ⇒ 相等
void _piFwd; void _piBwd;

/** 续接策略 zod(03 §2.1 ContinuityMode 同为未导出 zod 的 TS union;此处补 zod,E9 同上)。影响 token 成本曲线(事实地基 D)。 */
export const continuityModeSchema = z.enum(['stateless', 'resume']);
const _cmFwd: ContinuityModeT = '' as unknown as z.infer<typeof continuityModeSchema>;
const _cmBwd: z.infer<typeof continuityModeSchema> = '' as unknown as ContinuityModeT;
void _cmFwd; void _cmBwd;

/**
 * playbook 参数覆盖(全部可选;省略则用该范式 defaults.ts 默认,§6.4)。
 * 字段语义=03 §3.3 PlaybookParams,但这里全 optional —— 配置只覆盖想改的项,
 * 其余继承范式默认(§6.3 优先级合并)。
 */
export const playbookParamsOverrideSchema = z.object({
  perTurnContextCap: z.number().int().positive().optional(),   // 单轮 context 上限(03 §2.2)
  defaultContinuity: continuityModeSchema.optional(),          // 范式默认续接(03 §2.1)
  retryOnReject: z.number().int().nonnegative().optional(),    // 打回重发上限(03 §5.2,默认 3)
  // 注:maxRounds/convergenceWindow/tokenBudget/sandboxCeiling 不在此 —— 它们归 stop 段(§6)
  //     与 worktree 段(§7),避免「同一阈值两处可写」的二义(§5.3)。
}).strict();

export const playbookSelectionSchema = z.object({
  /** 选哪个范式(必填) */
  id: playbookIdSchema,
  /**
   * 角色→agent 默认指派覆盖(03 §3.3 assignment;P3:仅默认查表,真实以 TurnDirective.agent 为准)。
   * 省略则用该范式内置 assignment(03 §7 各范式)。键是 02 Role,值是 02 AgentId(codex/claude)。
   */
  assignment: z.record(roleSchema, agentIdSchema).optional(),
  /** 参数覆盖(§5.1;省略全用范式默认) */
  params: playbookParamsOverrideSchema.optional(),
}).superRefine((p, ctx) => {
  // assignment 的 value 只能是执行体 agent(codex/claude),不能是 human/orchestrator
  for (const [role, agent] of Object.entries(p.assignment ?? {})) {
    if (agent === 'human' || agent === 'orchestrator')
      ctx.addIssue({ code: 'custom', message: `assignment[${role}] 不能指派给 ${agent}(仅 codex/claude 可执行)`, path: ['assignment', role] });
  }
});
export type PlaybookSelection = z.infer<typeof playbookSelectionSchema>;
```

| 字段 | 类型 | 必填 | 派生去向 | 语义 |
|---|---|---|---|---|
| `id` | enum | 是 | 选 Playbook 实例(03) | 四范式之一 |
| `assignment` | record? | 否 | `Playbook.assignment` 覆盖(03) | 角色→agent 默认查表 |
| `params.perTurnContextCap` | int? | 否 | `PlaybookParams`(03) | 单轮 context 上限 |
| `params.defaultContinuity` | enum? | 否 | `PlaybookParams`(03) | 默认续接(stateless 省钱,事实 D) |
| `params.retryOnReject` | int? | 否 | `PlaybookParams`(03) | 打回重发上限 |

### 5.2 为什么刹车阈值不放 `playbook.params`,而放 `stop` 段

03 §3.3 的 `PlaybookParams` 把 `maxRounds`/`convergenceWindow`/`tokenBudget`/`sandboxCeiling` 与上下文/续接参数放在一起。在**配置文件层**,本文件把它们**拆开**:

- `maxRounds` / `convergenceWindow` / `tokenBudget` → `stop` 段(§6),因为它们是**刹车阈值**(04 拥有语义),且预算与 pricing 强相关,集中在 stop 段才能就近写 pricing 与前瞻开关。
- `sandboxCeiling` → `worktree` 段(§7),因为它是**沙箱封顶**(08/09 拥有),与 worktree 隔离同源。
- `perTurnContextCap`/`defaultContinuity`/`retryOnReject` → 留在 `playbook.params`,因为它们是**范式行为参数**(03 拥有),不是刹车也不是沙箱。

> 拆开的代价是「一个范式的可调项分散在三段」,收益是「每个阈值只有一处可写、就近写它的相关项」。派生层(§11.4)负责把三段重新组装回 03 需要的 `PlaybookParams` + 04 需要的 `StopPolicyConfig`,用户视角是「按职责分区」,引擎视角拿到的仍是完整对象。

### 5.3 单一阈值单一来源(防二义)

**铁律**:同一个语义阈值,配置文件里**有且只有一处**能写。`maxRounds` 只在 `stop.maxRounds`、`sandboxCeiling` 只在 `worktree.sandboxCeiling`。`playbook.params` 用 `.strict()`(§5.1)**拒绝**出现 `maxRounds` 等越界字段——写了就 `CONFIG_SCHEMA_INVALID`,明确报「maxRounds 请写在 stop 段」。这从 schema 层焊死「两处写同一阈值，到底谁赢」的二义。

---

## 6. `stop` 段 —— 三重刹车(maxRounds / 收敛 / 预算)

### 6.1 schema(组装 04 的子配置)

字段语义全部=刹车文档 04(`MaxRoundsConfig`/`ConvergenceConfig`/`BudgetConfig`/`TokenPricing`),本文件只把它们组装成一个可选段,并让大多数字段可省(省略走范式默认,§6.4)。

```ts
/** provider 计价(04 §6.2 `TokenPricing`;算 maxCostUsd 必需)。每 1e6 token 美元价。
 *  【E9】04 §6.2 以 TS interface 给出 `TokenPricing`,**未导出 zod**;此处补 zod 填空缺,
 *  字段名/语义与 04 §6.2 严格同步(inputPerM/cachedInputPerM/outputPerM)。 */
export const tokenPricingSchema = z.object({
  inputPerM: z.number().nonnegative(),
  cachedInputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
});

export const stopConfigSchema = z.object({
  /** B1 硬上限(04 §3;必 ≥1)。省略走范式默认(§6.4)。最后防线,始终在场。 */
  maxRounds: z.number().int().positive().optional(),
  /** B2 收敛(04 §4);省略整个对象=用范式默认;给则逐字段可省。 */
  convergence: z.object({
    /** 连续 N 轮无新 evidence 指纹判 stall(04 §4.2 `stallWindow`;必 ≥1) */
    stallWindow: z.number().int().positive().optional(),
    /** 是否把 spec_quote(`s:` 弱指纹)计入新证据(默认 false;仅规范评审类开,04 §4.2) */
    countSpecQuote: z.boolean().optional(),
    /** 开场宽限轮(04 §4.2 `minActiveRounds`,默认 1) */
    minActiveRounds: z.number().int().nonnegative().optional(),
    /**
     * 只让"核验通过的强指纹"清零 stall 计数(04 §4.2 H-FP `requireVerifiedProgress`,默认 true)。
     * true 时 `:?` 占位指纹与 `s:` 弱指纹不算进展,防失控/对抗 agent 每轮换行区间刷 `:?` 指纹拖死 stall。
     * 配置层默认透传 true,一般不改;仅极特殊调试场景显式关。
     */
    requireVerifiedProgress: z.boolean().optional(),
    /** 显式关闭收敛检测(只靠 maxRounds 兜底);默认启用 */
    enabled: z.boolean().default(true),
  }).optional(),
  /** B3 预算(04 §6);省略=不限成本(仅 maxRounds 兜底)。 */
  budget: z.object({
    /** 累计 token 硬上限(input+output 求和);省略=不限 token */
    maxTotalTokens: z.number().int().positive().optional(),
    /** 累计费用硬上限(美元);需配 pricing */
    maxCostUsd: z.number().positive().optional(),
    /** provider 计价(算 maxCostUsd 必需;只设 maxTotalTokens 可省) */
    pricing: tokenPricingSchema.optional(),
    /** 前瞻刹车(默认 true,04 §6.4:预测下轮超支则提前停) */
    lookahead: z.boolean().default(true),
    /** 前瞻安全系数(默认 1.0;>1 更保守) */
    lookaheadFactor: z.number().positive().default(1.0),
  }).superRefine((b, ctx) => {
    if (b.maxCostUsd !== undefined && !b.pricing)
      ctx.addIssue({ code: 'custom', message: '设 maxCostUsd 必须同时给 pricing(04 §6.4)', path: ['pricing'] });
  }).optional(),
  /** done 成功出口开关(默认启用;04 §7) */
  enableDone: z.boolean().default(true),
}).optional();
export type StopConfig = z.infer<typeof stopConfigSchema>;
```

### 6.2 派生为 04 的 `StopPolicyConfig`

派生层(§11.4)把 `stop` 段 + playbook 默认合并成 04 §8.3 的 `StopPolicyConfig`,喂 `buildStopPolicy`:

```ts
// derive.ts(片段):config.stop(可空)+ 范式默认 → 04 StopPolicyConfig
function deriveStopPolicy(cfg: SyluxConfig): StopPolicyConfig {
  const d = PLAYBOOK_STOP_DEFAULTS[cfg.playbook.id];   // §6.4 表
  const s = cfg.stop ?? {};
  return {
    maxRounds: { maxRounds: s.maxRounds ?? d.maxRounds },                    // 必有(最后防线)
    convergence: s.convergence?.enabled === false ? undefined : {
      stallWindow:             s.convergence?.stallWindow             ?? d.stallWindow,
      countSpecQuote:          s.convergence?.countSpecQuote          ?? d.countSpecQuote,
      minActiveRounds:         s.convergence?.minActiveRounds         ?? d.minActiveRounds,
      requireVerifiedProgress: s.convergence?.requireVerifiedProgress ?? true,  // 04 §4.2 H-FP 默认 true
    },
    budget: s.budget ? {
      maxTotalTokens: s.budget.maxTotalTokens ?? d.maxTotalTokens,           // 省略也回填范式默认估额(regime 正确,§6.4)
      maxCostUsd:     s.budget.maxCostUsd,
      pricing:        s.budget.pricing,
      lookahead:      s.budget.lookahead,
      lookaheadFactor: s.budget.lookaheadFactor,
    } : { maxTotalTokens: d.maxTotalTokens, lookahead: true, lookaheadFactor: 1.0 }, // 默认给范式估额预算
    enableDone: s.enableDone,
  };
}
```

> **设计立场**:即便用户完全省略 `stop` 段,派生层也**强制注入范式默认的 `maxTotalTokens`**(按该范式 continuity 的**真实 regime** 给值,§6.4),不让 run 在「无预算」下裸跑。这是事实地基 D 对配置层最直接的保护:**默认就有预算兜底,而非默认无限烧**。**关键(ROC-B1)**:默认额度对 stateless 默认范式(red-blue/pair/parallel)用**线性**口径,对 resume 范式(master-worker)才用累积口径——绝不对 stateless 套 resume 超线性公式(否则额度虚高 3–4 倍,B3 前瞻刹车形同虚设,§6.4 详述)。

### 6.3 优先级合并规则(playbook 默认 ↔ config 覆盖)

三层优先级,**高覆盖低**:

```
范式内置默认(03 §7 各 playbook 的 params 字面量)        ← 最低(单一真值在此)
   ↑ 被覆盖
本文件 §6.4 PLAYBOOK_STOP_DEFAULTS(stop 维度的范式默认表,逐字段镜像 03 §7)
   ↑ 被覆盖
config.stop 段显式字段                              ← 最高(用户写了就用用户的)
```

- 用户**写了**某字段 → 用用户值。
- 用户**没写**(undefined)→ 回退 §6.4 范式默认。
- §6.4 与 03 §7 的 `params` 在 stop 维度**逐字段一致**(§6.4 即 03 §7 各范式 `params` 的 `{maxRounds, convergenceWindow→stallWindow, tokenBudget→maxTotalTokens}` 投影);若发现不一致,**以 03 §7 为准**并回填本表(§6.4 注)。

### 6.4 各范式 stop 默认表(配置层镜像 03 §7 params,**按 regime 分口径**)

`PLAYBOOK_STOP_DEFAULTS`(`defaults.ts`)是 config 省略 stop 字段时的回退值,**逐字段对齐 03 §7 各 playbook 的 `params` 字面量**(单一真值在 03 §7 的 `PlaybookParams` 实例)。预算口径**必须分 regime**(ROC-B1 / 03 §6.3 H17 / 18 §6.4):

- **stateless 范式(red-blue/pair/parallel)= 线性** `≈ base'×N`(`base'≈25k` 含 digest+delta,N=轮数;parallel 再 ×lane 数)。每轮全新会话,绝不累积全历史,**严禁套 resume 超线性公式**。
- **resume 范式(master-worker 子任务内)= 累积** `≈ base×(1+…+k)`,k≤`maxResumeChain`,跨子任务 `send` 归零后线性叠加。

| 范式 | `maxRounds` | `stallWindow` | `countSpecQuote` | `minActiveRounds` | `maxTotalTokens` | continuity / regime | 真实累积粗估(03 §6.3)|
|---|---|---|---|---|---|---|---|
| `red-blue` | 12 | 3 | false | 1 | **600k** | stateless / 线性 | 12×25k≈300k(预算留 2× 余量)|
| `master-worker` | 40 | 3 | false | 1 | **1.5M** | resume / 累积(子任务内 ≤3 链) | ≈1.12M(贴近不破,maxResumeChain=3 封顶)|
| `pair` | 10 | 2 | false | 1 | **500k** | stateless / 线性 | 10×25k≈250k |
| `parallel` | 6 | 2 | false | 1 | **800k** | stateless / 线性(×2 lane) | 2×6×25k≈300k(并发不改单请求计费)|

```ts
export const PLAYBOOK_STOP_DEFAULTS: Record<PlaybookId, {
  maxRounds: number; stallWindow: number; countSpecQuote: boolean;
  minActiveRounds: number; maxTotalTokens: number;
}> = {
  // ★ 数值逐格镜像 03 §7 各 playbook 的 params:{maxRounds, convergenceWindow→stallWindow, tokenBudget→maxTotalTokens}。
  //   countSpecQuote/minActiveRounds 取 04 §4.2 ConvergenceConfig 默认(false/1)。
  //   预算口径已按 regime(ROC-B1):stateless 线性、resume(master-worker)累积。绝不对 stateless 套 base×N(N+1)/2。
  'red-blue':      { maxRounds: 12, stallWindow: 3, countSpecQuote: false, minActiveRounds: 1, maxTotalTokens: 600_000   }, // stateless 线性
  'master-worker': { maxRounds: 40, stallWindow: 3, countSpecQuote: false, minActiveRounds: 1, maxTotalTokens: 1_500_000 }, // resume 累积
  'pair':          { maxRounds: 10, stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, maxTotalTokens: 500_000   }, // stateless 线性
  'parallel':      { maxRounds: 6,  stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, maxTotalTokens: 800_000   }, // stateless 线性 ×2 lane
};
```

> 【对账·ROC-B1 焊死】本表是 03 §7 各 playbook `params` 字面量的**配置层投影**,数值必须与 03 §7 逐格一致。**16 v1 的 blocker**:对三个 stateless 默认范式误套 `base×N(N+1)/2×1.2`(把 red-blue 估成 808k),被 ROC-B1 判定会让 B3 预算网在默认配置下对 stateless 形同虚设(额度虚高 3.6×、前瞻刹车永不触发)。v2 已按 03 §6.3 H17 改回线性口径,red-blue 600k(非 808k)、pair 500k、parallel 800k,只有 resume 范式 master-worker 用累积口径 1.5M。**单一真值在 03 §7**;M2 用 `turn.completed.usage` 实测校准 `base'`(stateless 含 digest 的每轮均值)时,改 03 §7 即回填本表。
>
> 【cross-doc 待协调】04 §3 line 279 的 prose 给 maxRounds 建议区间(红蓝 6–8 / 主从 10–12 / 结对 4–6)与 03 §7 的 `params` 代码字面量(12 / 40 / 10 / 6)**不一致**。04 该处自述「默认值由 playbook 给(无全局默认)」,故**以 03 §7 代码字面量为权威**,04 §3 prose 属过期松散描述,列入 §15.2 openQuestion 待 04 回填对齐。

---

## 7. `worktree` 段 —— 隔离 / 沙箱封顶 / 清理

```ts
/** 自动化沙箱上限(09 §10 / 08 §6;danger 不可达,K5)。
 *  【E9】03 §3.3 `PlaybookParams.sandboxCeiling` 与 08 §6 均以 TS union `'read-only'|'workspace-write'` 给出,
 *  未导出 zod;此处补 zod 填空缺,成员集与 03/08 严格一致(刻意**不含** danger,K5 从枚举层焊死)。 */
export const sandboxCeilingSchema = z.enum(['read-only', 'workspace-write']);

export const worktreeConfigSchema = z.object({
  /**
   * 自动化沙箱封顶(03 §3.3 sandboxCeiling 的配置入口;默认 workspace-write)。
   * 写 'danger-full-access' 会在校验期被降级到 workspace-write 并告警(K5;不直接拒整份配置)。
   * 真实每回合 sandbox 由 kind 推导(09 §10.1:decision→read-only / implement→workspace-write),
   * 此处只设上限。
   */
  sandboxCeiling: sandboxCeilingSchema.default('workspace-write'),
  /** 终态为 conflict/aborted 时是否保留 worktree 供事后检视(09 §8.1;默认 true 便于排障) */
  keepOnConflict: z.boolean().default(true),
  /** 正常终态(done/limit/stalled)后是否自动清理 worktree(09 §8;默认 true) */
  cleanupOnFinish: z.boolean().default(true),
  /** worktree 根相对 repoRoot 的子目录(默认 .sylux/worktrees,09 §2.2;一般不改) */
  rootSubdir: z.string().min(1).default('.sylux/worktrees'),
  /** 改名检测阈值(diffSince --find-renames,09 §4.1;默认 50) */
  renameThreshold: z.number().int().min(1).max(100).default(50),
}).strict();
export type WorktreeConfig = z.infer<typeof worktreeConfigSchema>;
```

| 字段 | 默认 | 派生去向 | 语义 |
|---|---|---|---|
| `sandboxCeiling` | `workspace-write` | `PlaybookParams.sandboxCeiling`(03)→ `capSandbox`(08) | 自动化封顶;danger 降级+告警(K5) |
| `keepOnConflict` | true | `cleanup` opts(09 §8.1) | 冲突保留 worktree |
| `cleanupOnFinish` | true | `cleanup`(09 §8) | 正常终态后清理 |
| `rootSubdir` | `.sylux/worktrees` | worktree 路径(09 §2.2) | 隔离目录 |
| `renameThreshold` | 50 | `diffSince`(09 §4.1) | 改名检测灵敏度 |

> **K5 落地**:`sandboxCeilingSchema` 枚举里**根本没有** `danger-full-access` —— 写它会先被 zod 当未知字面量拒。但用户可能从别处抄来 `danger`,§11.2 crossChk 对「原始对象里 sandboxCeiling 文本是 danger*」做**预降级**:替换成 `workspace-write` + push 一条告警,而非整份配置 `CONFIG_SCHEMA_INVALID`(否则用户体验差)。降级后再过 zod。这是「封顶不可越」与「不因一个字段拒整份配置」的平衡。

---

## 8. `server` 段 —— WS / HTTP / 面板 / metrics

### 8.1 schema

```ts
export const serverConfigSchema = z.object({
  /** HTTP + WS 共用端口(11 §1.1:ws 挂在同一 Node HTTP server)。默认 7878。 */
  port: z.number().int().min(1).max(65535).default(7878),
  /**
   * 绑定地址。默认且强制 127.0.0.1(08 S7/K6);写 0.0.0.0 / 外网 IP → 校验期拒(§8.2)。
   * 远程观战只能用户自己开 SSH 隧道,不在软件层暴露公网监听。
   */
  host: z.string().default('127.0.0.1'),
  /** WS 心跳(11 §1.3) */
  ws: z.object({
    heartbeatIntervalMs: z.number().int().positive().default(15_000), // server ping 间隔
    pongTimeoutMs: z.number().int().positive().default(10_000),       // 无 pong 判死连接
    /** 单连接发送队列上限(11 §7 背压;超限按 droppable 降级/强制重连) */
    sendQueueLimit: z.number().int().positive().default(1_000),
  }).default({}),
  /** 一次性 token 有效期(08 §5.2;默认 60s,短时效) */
  ticketTtlMs: z.number().int().positive().default(60_000),
  /**
   * 默认连接权限(08 §5.3)。默认 spectate 只读;control 需显式签 control 票据。
   * 配置可改默认,但 control 仍需票据 scope 匹配(运行期 08 §5.3 强制,配置改不动鉴权)。
   */
  defaultScope: z.enum(['spectate', 'control']).default('spectate'),
  /** 额外允许的 Origin(08 §5.1;默认只含 127.0.0.1/localhost:vitePort,此处补充开发端口) */
  extraAllowedOrigins: z.array(z.string().url()).default([]),
  /** 可选 Prometheus metrics 端口(15 §3.6;省略=仅内存注册表+jsonl 投影,不挂 /metrics) */
  metricsPort: z.number().int().min(1).max(65535).optional(),
}).strict();
export type ServerConfig = z.infer<typeof serverConfigSchema>;
```

### 8.2 host 安全校验(K6 / 08 S7)

```ts
// crossChk 片段:host 只允许 loopback;其余一律拒(不静默改,明确报错让用户知情)
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function checkServerHost(host: string, ctx: RefinementCtx) {
  if (!LOOPBACK.has(host))
    ctx.addIssue({ code: 'custom',
      message: `server.host 仅允许 loopback(127.0.0.1/localhost);要远程观战请用 SSH 隧道(08 S7)。收到: ${host}`,
      path: ['server', 'host'] });
}
```

> 与 sandboxCeiling 的「降级+告警」不同,host 非 loopback 是**直接拒**(`CONFIG_SCHEMA_INVALID`):因为「悄悄帮你绑回 127」可能让用户误以为开了公网监听,反而危险;明确报错让用户清楚「软件层不暴露公网」。`metricsPort` 同样仅 127.0.0.1 绑定(15 §3.6),不单独给 host(复用 server.host 的 loopback 约束)。

### 8.3 派生去向

| 字段 | 派生去向 |
|---|---|
| `port` / `host` | Node HTTP server listen(11 §1.1)|
| `ws.*` | `WsHub` 心跳/背压参数(11 §1.3/§7)|
| `ticketTtlMs` / `defaultScope` / `extraAllowedOrigins` | WS 鉴权(08 §5.1/§5.2/§5.3)|
| `metricsPort` | `prom-client` 挂载开关(15 §3.6)|

---

## 9. `logging` 段 —— 级别 / 输出 / redact(指针)

```ts
/** 日志级别(15 §2.3;pino 级别)。 */
export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

export const loggingConfigSchema = z.object({
  /** 全局级别(15 §2.2;默认 info)。可被 env SYLUX_LOG_LEVEL 覆盖(§10.3 优先级)。 */
  level: logLevelSchema.default('info'),
  /** 输出形态(15):'json' 裸 JSON(生产)/ 'pretty' pino-pretty(开发) */
  format: z.enum(['json', 'pretty']).default('json'),
  /** 日志文件目录(省略=仅 stdout);jsonl run 记录另由黑板落盘(02 §7,不在此) */
  fileDir: z.string().min(1).optional(),
  /** 是否透传子进程逐 token delta/tool_call 到 trace 级(15 §2.3;默认 false,排障才开) */
  streamPassthrough: z.boolean().default(false),
}).strict();
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
```

| 字段 | 默认 | 派生去向 | 语义 |
|---|---|---|---|
| `level` | info | `rootLogger` level(15 §2.2) | 日志级别;env 可覆盖(§10.3) |
| `format` | json | pino transport(15) | 生产 JSON / 开发 pretty |
| `fileDir` | (stdout) | pino file sink(15) | 日志文件目录 |
| `streamPassthrough` | false | trace 级 delta 透传(15 §2.3) | 排障开关 |

> **redact 不在配置里开关(承接 08 S4 / 15 O2)**:脱敏是**强制单一出口**,任何离开内存的文本必过 `redact`/`redactObject`,**不提供「关闭 redact」的配置项**——关得掉就是漏点。配置只调级别/输出/目录,redact 规则与落点归 08 §3 / 15 §2.3,配置层无权关。这是 K1 在日志侧的延伸。`SECRET_SIGNATURES` 可扩展(新增中转 key 前缀)走代码/常量,不走运行期配置(避免「配置错填把脱敏关了」)。

---

## 10. 命名、格式与 env 引用约定

### 10.1 snake_case(文件) ↔ camelCase(TS)边界

承接 13 §4.2:**配置文件层** provider 字段保留 snake_case(对齐 codex `config.toml`),其余段一律 camelCase(与 TS 一致,减少转换面)。

| 段 | 文件层命名 | 进 TS 后 | 转换点 |
|---|---|---|---|
| `providers.*`(base_url/wire_api/api_key_ref/codex_provider_name…) | **snake_case** | camelCase | `load.ts` 对 providers 段做 snake→camel(§10.1) |
| 其余所有段(run/playbook/stop/worktree/server/logging) | **camelCase** | 同名 | 无转换 |

```ts
// load.ts:仅对 providers 段做 key 的 snake→camel(其余段文件即 camelCase,不转)
function camelizeProviderKeys(raw: unknown): unknown { /* base_url→baseUrl 等,深度遍历 providers 子树 */ }
```

> 只转 providers 一段,不全局转：全局转会让用户在 stop/server 段也能写 `max_rounds`/`heartbeat_interval_ms` 产生两种写法,反而乱。**providers 段 snake、其余段 camel** 是刻意的不对称(provider 对齐 codex 生态,其余对齐 TS),边界清晰且集中在一处转换。

### 10.2 env 引用语法 `${env:NAME}`(只解引用名,不碰真值)

配置文件里需要引用环境变量处(主要是 `api_key_ref` 指向的 `envVar` 名、以及少量路径),用 `${env:NAME}` 占位:

```yaml
providers:
  key_bindings:
    - ref: MOUUBOX_KEY
      source: env
      env_var: ${env:SYLUX_KEY_MOUUBOX_VARNAME}   # 解析为「变量名字符串」,不是 key 值
```

- **②envRef 步(§1.4)只做字符串替换**:`${env:X}` → `process.env.X` 的**字符串值**。用于把「变量名/路径/端口」这类**非密**配置外置。
- **K1 红线**:`${env:...}` **绝不**用来注入 key 真值。`api_key_ref` 永远是引用名,真值由 `KeyStore.resolve`(07 §2)在 spawn 时从 `envVar` 指向的环境变量取,**不经配置文件、不经 envRef 步**。envRef 解出的值若命中 08 `SECRET_SIGNATURES`(像个 key)→ `CONFIG_ENV_UNRESOLVED` 拒绝(防有人用 `${env:}` 把 key 灌进配置值)。
- 未定义的 env 变量 → `CONFIG_ENV_UNRESOLVED`(fail-fast,K2)。

### 10.3 配置项 vs 环境变量的优先级

少数项同时可由配置文件与 env 设(13 §3 列了 `SYLUX_LOG_LEVEL`/`SYLUX_WS_PORT`)。优先级:

```
显式 CLI flag(如 --metrics-port)   ← 最高
   ↑ 覆盖
SYLUX_* 环境变量(SYLUX_LOG_LEVEL / SYLUX_WS_PORT …)
   ↑ 覆盖
配置文件对应字段(logging.level / server.port …)
   ↑ 覆盖
schema 默认值                       ← 最低
```

> 理由:env/flag 是「临时改这一次跑」的快捷手段,应能压过文件里的持久设定。派生层(§11.4)在 zod 默认填充**之后**、derive **之前**应用 env/flag 覆盖,确保覆盖的是「文件值或默认值」。覆盖项白名单固定(`SYLUX_LOG_LEVEL`→logging.level、`SYLUX_WS_PORT`→server.port),不开放任意 env 覆盖任意字段(避免隐式配置面失控)。

---

## 11. 加载管线 `loadSyluxConfig`(read→envRef→zod→crossChk→derive)

### 11.1 主流程(伪代码,失败路径齐全,K2 fail-fast)

```ts
import { syluxConfigSchema, type SyluxConfig } from './config.schema.js';

export interface LoadResult { config: SyluxConfig; derived: DerivedConfigs; }

/** 单一解析出口(K3)。任一步失败抛 SyluxError,0 副作用(不 spawn、不建 worktree)。 */
export async function loadSyluxConfig(
  pathOrObject: string | object,
  opts?: { env?: NodeJS.ProcessEnv; cliFlags?: CliFlagOverrides },
): Promise<LoadResult> {
  // ① read:按格式读盘 / 收面板对象(§1.2)
  const raw = typeof pathOrObject === 'string'
    ? readConfigFile(pathOrObject)            // CONFIG_NOT_FOUND / CONFIG_PARSE_ERROR
    : pathOrObject;

  // ② envRef:解析 ${env:NAME} 为字符串(只引用名/非密;命中 secret 特征即拒,§10.2)
  const resolved = resolveEnvRefs(raw, opts?.env ?? process.env); // CONFIG_ENV_UNRESOLVED

  // ②.5 providers 段 snake→camel(其余段不转,§10.1);sandboxCeiling=danger* 预降级(K5/§7)
  const normalized = predowngradeSandbox(camelizeProviderKeys(resolved));

  // ③ zodParse:一次到底(内嵌全部子 schema,K4)
  const parsed = syluxConfigSchema.safeParse(normalized);
  if (!parsed.success)
    throw new SyluxError('CONFIG_SCHEMA_INVALID', firstIssue(parsed.error), redactObject(parsed.error.issues));
  let config = parsed.data;

  // ③.5 env/flag 覆盖少数项(§10.3 优先级:flag > env > 文件 > 默认)
  config = applyEnvAndFlagOverrides(config, opts?.env ?? process.env, opts?.cliFlags);

  // ④ crossChk:跨段语义(§11.2;zod superRefine 够不着的跨子系统一致性)
  const cross = crossSystemCheck(config);     // 返回 issues[];非空即抛
  if (cross.length) throw new SyluxError(cross[0].code, cross[0].message, redactObject(cross));

  // ⑤ derive:派生各子系统配置对象(§11.4);沙箱封顶在此最终 enforce(K5)
  const derived = deriveAll(config);          // PROVIDER_CONFIG_INVALID 等(key 绑定检查在此)

  return { config, derived };
}
```

### 11.2 跨段语义校验(crossSystemCheck)

zod `superRefine` 只能看单段;**跨段一致性**靠 `crossSystemCheck`(纯函数,无 IO,除 repoRoot 存在性需 fs):

| # | 检查 | 失败码 | 理由 |
|---|---|---|---|
| X1 | `run.repoRoot` 存在且是 git 仓库 | `CONFIG_REPO_INVALID` | worktree 必须能 `create`(09 §3.3) |
| X2 | `playbook.assignment` 引用的 agent 都在 `providers.slots` 有槽 | `CONFIG_AGENT_UNMAPPED` | 指派了没 provider 的 agent = 无法 spawn |
| X3 | 范式需要的角色都有 agent 可担(red-blue 需 proposer+critic 两个不同 agent 槽) | `CONFIG_AGENT_UNMAPPED` | 单 agent 跑红蓝对抗无意义 |
| X4 | `parallel` 范式必须有 ≥2 个 agent 槽(两 worker 并发) | `CONFIG_AGENT_UNMAPPED` | parallel 靠两 worktree 并行 |
| X5 | `stop.budget.maxCostUsd` 给了但所在 provider 无 pricing 来源 | `PROVIDER_CONFIG_INVALID` | 算不出费用(04 §6.4)|
| X6 | `server.host` 非 loopback | `CONFIG_SCHEMA_INVALID` | K6/08 S7(§8.2)|
| X7 | 所有 `providers` 的 `apiKeyRef` 在 `keyBindings` 有绑定 | `PROVIDER_CONFIG_INVALID` | 07 §3.3 已查(zod)+ 此处复核 KeyStore.has |
| X8 | `run.runIdStrategy='explicit'` 的 `fixedRunId` 不含路径非法字符(Windows) | `CONFIG_SCHEMA_INVALID` | 进 worktree 路径(09 §2.4 MAX_PATH)|
| X9 | `fusion`(providers.panels)成员 providerId 都在某槽 candidates | `PROVIDER_CONFIG_INVALID` | panel 成员复用主配置(07 §10.2)|

> X2–X4 是「范式与 agent 数量匹配」的核心:配置层在 spawn 前就挡住「红蓝对抗只配了一个 agent」「parallel 只有一个 worker」这类逻辑错配,避免引擎跑起来才发现没人可指派(03 `EMPTY_ROUND_PLAN`)。X1 需 fs 探测(唯一带 IO 的 crossChk 项),失败仍 fail-fast。

### 11.3 key 引用校验时机(K1/K2,承接 07 §2.3)

- **zod 层(X7 的 zod 部分)**:`providerSettingsSchema` 已校验每个 `apiKeyRef` 在 `keyBindings` 有**声明**(07 §3.3 superRefine)。
- **derive 层(KeyStore.has)**:`deriveAll` 构造 `KeyStore`(07 §2.3)后,对**当前 active**的每个 provider 调 `keystore.has(apiKeyRef)`,确认对应 env/auth.json **真的可解析**(不读值,只 boolean)。缺 → `PROVIDER_CONFIG_INVALID`,`detail` 只给 ref/envVar 名(07 §2.3,绝不回显值)。
- **候选(非 active)**:不强制启动期可解析(failover 时再校验,07 §8.5)；但若 active failover 到一个 key 不可解析的候选,运行期 07 §8.5 转 paused。

### 11.4 派生(deriveAll → DerivedConfigs)

```ts
export interface DerivedConfigs {
  providerSettings: ProviderSettings;        // = config.providers(已过 07 zod;构造 ProviderRegistry/KeyStore)
  keystore: KeyStore;                        // 07 §2.3 createKeyStore(config.providers.keyBindings, io)
  playbookId: PlaybookId;                    // config.playbook.id
  playbookParams: PlaybookParams;            // §5.2 三段重组:playbook.params + stop + worktree.sandboxCeiling
  stopPolicy: StopPolicyConfig;              // §6.2 deriveStopPolicy
  worktreeRunConfig: WorktreeRunConfig;      // { repoRoot, agents: 从 slots 取 codex/claude }
  sandboxCeiling: 'read-only' | 'workspace-write'; // §7;capSandbox 的上限(08 §6)
  serverRuntime: { port; host; ws; ticketTtlMs; defaultScope; allowedOrigins; metricsPort? }; // §8
  loggerConfig: { level; format; fileDir?; streamPassthrough };                                // §9
}

function deriveAll(cfg: SyluxConfig): DerivedConfigs {
  const keystore = createKeyStore(cfg.providers.keyBindings, keyStoreIo());     // 07 §2.3
  assertActiveKeysResolvable(cfg.providers, keystore);                          // §11.3
  return {
    providerSettings: cfg.providers,
    keystore,
    playbookId: cfg.playbook.id,
    playbookParams: assemblePlaybookParams(cfg),    // §5.2:三段重组回 03 PlaybookParams
    stopPolicy: deriveStopPolicy(cfg),              // §6.2
    worktreeRunConfig: { repoRoot: cfg.run.repoRoot, agents: agentsFromSlots(cfg.providers.slots) },
    sandboxCeiling: cfg.worktree.sandboxCeiling,    // K5 已在 ②.5 预降级 danger
    serverRuntime: { /* §8 字段 + Origin 白名单合成 */ },
    loggerConfig: { level: cfg.logging.level, format: cfg.logging.format, fileDir: cfg.logging.fileDir, streamPassthrough: cfg.logging.streamPassthrough },
  };
}

/** §5.2 三段重组:把分散在 playbook/stop/worktree 的字段拼回 03 PlaybookParams。 */
function assemblePlaybookParams(cfg: SyluxConfig): PlaybookParams {
  const d = PLAYBOOK_STOP_DEFAULTS[cfg.playbook.id];
  const p = cfg.playbook.params ?? {};
  return {
    maxRounds:         cfg.stop?.maxRounds ?? d.maxRounds,
    convergenceWindow: cfg.stop?.convergence?.stallWindow ?? d.stallWindow,
    tokenBudget:       cfg.stop?.budget?.maxTotalTokens ?? d.maxTotalTokens,
    perTurnContextCap: p.perTurnContextCap ?? defaultContextCap(cfg.playbook.id),
    sandboxCeiling:    cfg.worktree.sandboxCeiling,
    defaultContinuity: p.defaultContinuity ?? defaultContinuityOf(cfg.playbook.id),
    retryOnReject:     p.retryOnReject ?? 3,
  };
}
```

> `assemblePlaybookParams` 是 §5.2「拆三段写、派生时重组」的落地:用户按职责分区写,引擎拿到的仍是完整 `PlaybookParams`(03)。`maxRounds`/`convergenceWindow`/`tokenBudget` 来自 stop 段(§6),`sandboxCeiling` 来自 worktree 段(§7),其余来自 playbook 段。三处缺省都回退范式默认。

### 11.5 热加载(reload,承接 07 §8.6)

面板保存配置触发 `reload`:走**同一** `loadSyluxConfig`(K3),失败安全(07 §8.6):

```
新配置 → loadSyluxConfig(safeParse 不抛、捕获)
  ├─ 成功 → 原子替换 derived;provider 变更走 07 §8 热换(轮边界,P4);不打断运行中那一轮
  └─ 失败 → 返回 {ok:false, code, message},保留旧 derived(坏配置不生效,K2/07 §8.6)
```

> 运行期可热换的:provider(07 §8 轮边界重建 adapter)、**stop 阈值**(经 04 `StopPolicy.reconfigure(patch)`,下一轮 `shouldStop` 生效——见下方铁律)、logging.level、server 的非绑定项。**不可热换**:`run.repoRoot`/`runIdStrategy`(worktree 已建,W1 路径定死)、`server.port/host`(连接已建)。这些改动需重启 run,reload 检测到则告警「需重启生效」,不静默忽略。

> **stop 阈值热换的正确机制(ROC-M2 / 04 §2.3·§6.7·§8.4 焊死)**:配置层**绝不**为改阈值而重新 `buildStopPolicy`——重建会丢掉 `ConvergencePolicy` 的累积状态(`emptyStreak`/`seen`),把一个本该收尾的 run 的 stall 计数清零、平白多烧好几轮(这正是 ROC-M2 担心的失败模式)。正确路径:reload 检测到 `stop` 段阈值变更后,把变更投影成 04 §8.4 的 **child→patch 映射**,在**轮末 finalize 之前**调 `composite.reconfigure(patches)`:
>
> ```ts
> // reload 时 stop 段 diff → 04 CompositeStopPolicy.reconfigure(patches)(§8.4 形态:{childId: patch})
> composite.reconfigure({
>   'max-rounds':  { maxRounds: newCfg.stop?.maxRounds },                       // 无状态,直接替换
>   convergence:   { stallWindow: newCfg.stop?.convergence?.stallWindow },      // 只改阈值,emptyStreak/seen 不动!
>   budget:        { maxCostUsd: newCfg.stop?.budget?.maxCostUsd },             // 无累积状态,替换安全
> });
> ```
>
> **铁律(04 S12)**:`reconfigure` 只更新**阈值类配置**(maxRounds/stallWindow/maxTotalTokens/maxCostUsd/lookaheadFactor),**绝不触碰** `seen`/`emptyStreak`/`lastUpdatedRound` 等累积状态。它与崩溃恢复 `reset(rounds)`(04 §4.4,从落盘 rounds 确定性重建状态)是**两条独立路径**,不可混用。注意旧版 16 §11.5 写「下一轮 checkBefore 生效」是**错的**:04 v2(H1,对齐 03 §0.4)已删除 `checkBefore`/`checkAfter` 两段式,只剩每轮末单次 `update→shouldStop`;原 `checkBefore` 的「启动下一轮前抢停」职责由 04 §6.4 ② 的**前瞻预算刹车**(在轮末 `shouldStop` 内预测)等价承担。**本文件不再出现 `checkBefore` 措辞**。热换 patch 内容须过 redact(09)防把 pricing 广播给观战者(04 §6.7)。

---

## 12. 可直接用的示例配置

> 两份都遵守 K1(无 sk- 真值,只有引用名 + `env_var` 指向的变量名);真实 key 在 `SYLUX_KEY_*` 环境变量,中枢启动前由脚本设好。provider 段用 snake_case(§10.1),其余段 camelCase。

### 12.1 红蓝对抗(codex 走中转 + 官方直连兜底,claude 官方直连)

```yaml
# sylux.config.yaml —— 红蓝对抗:codex 提案 vs claude 红队批判
version: 1

run:
  goal: "审查并加固 src/auth 的会话校验逻辑,找出并修复越权与时序漏洞"
  repoRoot: "G:/myrepo"
  runIdStrategy: nanoid12

providers:                      # 段内 snake_case(对齐 codex config.toml)
  key_bindings:
    - { ref: MOUUBOX_KEY,    source: env, env_var: SYLUX_KEY_MOUUBOX }
    - { ref: OPENAI_KEY,     source: env, env_var: SYLUX_KEY_OPENAI }
    - { ref: ANTHROPIC_KEY,  source: env, env_var: SYLUX_KEY_ANTHROPIC }
  slots:
    - agent: codex
      active_id: mouubox-gpt55
      candidates:
        - { id: mouubox-gpt55, agent_kind: codex, base_url: "https://api.mouubox.com",
            model: "gpt-5.5", wire_api: responses, api_key_ref: MOUUBOX_KEY,
            codex_provider_name: custom, egress_class: third_party }
        - { id: openai-official, agent_kind: codex, model: "gpt-5.5",
            wire_api: responses, api_key_ref: OPENAI_KEY,
            codex_provider_name: openai, egress_class: official }   # failover 兜底
    - agent: claude
      active_id: anthropic-official
      candidates:
        - { id: anthropic-official, agent_kind: claude, model: "claude-opus-4-8",
            fallback_model: "claude-sonnet-4-5", api_key_ref: ANTHROPIC_KEY,
            egress_class: official }
  panels: []                    # 无 Fusion(M0/M1 单 agent)

playbook:
  id: red-blue
  assignment:                   # 覆盖默认:codex 提案、claude 红队(可省→用范式内置)
    proposer: codex
    critic: claude
  params:
    perTurnContextCap: 8000
    defaultContinuity: stateless   # 长程辩论:resume 累积成本会爆(事实地基 D)
    retryOnReject: 3

stop:
  maxRounds: 8                  # 覆盖范式默认 12(收紧:不想让对抗拖太久)
  convergence:
    stallWindow: 2             # 覆盖默认 3,对抗易换措辞收紧
    countSpecQuote: false
  budget:
    maxTotalTokens: 300000     # stateless 线性口径:8 轮 ×~25k≈200k,留 ~1.5× 余量(ROC-B1:绝不套 resume 超线性 808k)
    maxCostUsd: 12.0
    pricing: { inputPerM: 1.25, cachedInputPerM: 0.13, outputPerM: 10.0 }  # 中转价,非官方价(15 §3.5)
    lookahead: true
  enableDone: true

worktree:
  sandboxCeiling: workspace-write   # implement 回合可写;decision 回合自动降 read-only(09 §10)
  keepOnConflict: true

server:
  port: 7878
  host: 127.0.0.1             # 强制 loopback(K6);远程观战用 SSH 隧道
  defaultScope: spectate      # 默认只读观战

logging:
  level: info
  format: pretty              # 开发期;生产改 json
```

### 12.2 主从规划执行(claude 规划 / codex 实现)

```yaml
# sylux.config.yaml —— 主从:claude 当 planner 拆活验收,codex 当 worker 落代码
version: 1

run:
  goal: "把 packages/core 的同步文件 IO 全部改成异步,并补齐单测,分子任务推进"
  repoRoot: "G:/myrepo"
  runIdStrategy: nanoid12
  labels: { project: core-async, owner: aylovelle }

providers:
  key_bindings:
    - { ref: ANTHROPIC_KEY, source: env, env_var: SYLUX_KEY_ANTHROPIC }
    - { ref: MOUUBOX_KEY,   source: env, env_var: SYLUX_KEY_MOUUBOX }
    - { ref: OPENAI_KEY,    source: env, env_var: SYLUX_KEY_OPENAI }
  slots:
    - agent: claude          # planner
      active_id: anthropic-official
      candidates:
        - { id: anthropic-official, agent_kind: claude, model: "claude-opus-4-8",
            fallback_model: "claude-sonnet-4-5", api_key_ref: ANTHROPIC_KEY, egress_class: official }
    - agent: codex           # worker
      active_id: mouubox-gpt55
      candidates:
        - { id: mouubox-gpt55, agent_kind: codex, base_url: "https://api.mouubox.com",
            model: "gpt-5.5", wire_api: responses, api_key_ref: MOUUBOX_KEY,
            codex_provider_name: custom, egress_class: third_party }
        - { id: openai-official, agent_kind: codex, model: "gpt-5.5", wire_api: responses,
            api_key_ref: OPENAI_KEY, codex_provider_name: openai, egress_class: official }

playbook:
  id: master-worker
  assignment:
    planner: claude
    worker: codex
  params:
    perTurnContextCap: 10000
    defaultContinuity: resume    # 主从子任务内强耦合,resume 有价值(03 §2.1;跨子任务回 stateless)
    retryOnReject: 3

stop:
  maxRounds: 12                  # 覆盖范式默认 40(只想跑前 12 轮试水)
  convergence:
    stallWindow: 3              # 证据增量慢,放宽防误杀(03 §7 master-worker 默认即 3)
  budget:
    maxTotalTokens: 700000      # resume 累积口径:子任务内 ≤3 链 base×(1+2+3)≈112k/子任务,12 轮约 4 子任务 ≈450k,留余量(范式全程默认 1.5M)
    lookahead: true
    lookaheadFactor: 1.1        # 略保守:执行回合 output 占比波动

worktree:
  sandboxCeiling: workspace-write
  keepOnConflict: true
  cleanupOnFinish: true

server:
  port: 7878
  host: 127.0.0.1
  metricsPort: 9090            # 可选:开 Prometheus /metrics(仅 127 绑定,15 §3.6)

logging:
  level: info
  format: json
  fileDir: "G:/myrepo/.sylux/logs"
```

### 12.3 两份示例的差异速读

| 维度 | 红蓝对抗(12.1) | 主从(12.2) |
|---|---|---|
| 范式 | `red-blue`(对抗) | `master-worker`(状态机) |
| 默认续接 | `stateless`(长程省钱) | `resume`(子任务内强耦合) |
| maxRounds | 8(覆盖默认 12,收紧) | 12(覆盖默认 40,试水) |
| stallWindow | 2(收紧) | 3(放宽防误杀) |
| 预算 regime | stateless 线性 | resume 累积 |
| 预算 | 300k + $12 上限(线性口径) | 700k(累积口径;范式全程默认 1.5M) |
| codex provider | 中转 active + 官方 failover | 同 |
| claude provider | 官方直连 | 官方直连 |
| metrics | 关 | 开 9090 |

---

## 13. 配置相关错误码(复用 02 §12,列拥有项 + 需回填项)

配置层尽量**复用** 02 §12 已有码;确需新增的标注回填。

| 失败场景 | 错误码 | 来源 | 阶段 |
|---|---|---|---|
| 找不到配置文件 | `CONFIG_NOT_FOUND`【新增,回填 02 §12】 | 本文件 | ① read |
| YAML/JSON 解析失败 | `CONFIG_PARSE_ERROR`【新增,回填】 | 本文件 | ① read |
| `${env:NAME}` 未定义 / 解出疑似 secret | `CONFIG_ENV_UNRESOLVED`【新增,回填】 | 本文件 | ② envRef |
| zod 结构 / 跨字段(含 host 非 loopback X6) | `CONFIG_SCHEMA_INVALID`【新增,回填】 | 本文件 | ③ zodParse / X6 |
| repoRoot 不存在 / 非 git 仓 | `CONFIG_REPO_INVALID`【新增,回填】 | 本文件 | ④ X1 |
| 范式与 agent 槽数量/角色不匹配 | `CONFIG_AGENT_UNMAPPED`【新增,回填】 | 本文件 | ④ X2–X4 |
| apiKeyRef 无绑定 / active key 不可解析 / pricing 缺 / panel 成员越界 | `PROVIDER_CONFIG_INVALID` | **02 §12 已有** | ④ X5/X7/X9 / ⑤ |
| sandboxCeiling=danger | (不报错)→ 降级 + 告警 | K5 | ②.5 |

> **需回填 02 §12 的新增码**:`CONFIG_NOT_FOUND` / `CONFIG_PARSE_ERROR` / `CONFIG_ENV_UNRESOLVED` / `CONFIG_SCHEMA_INVALID` / `CONFIG_REPO_INVALID` / `CONFIG_AGENT_UNMAPPED`。六个均为 union 加成员(向后兼容新增,非破坏性,02 §1.2)。其余配置失败一律复用 `PROVIDER_CONFIG_INVALID`(07/02)。配置层**不**碰刹车/worktree 运行期码。所有错误 `detail` 经 `redactObject`(08 §3,K1:绝不回显 key 值)。

---

## 14. 测试矩阵(交付验收锚点,对接 02 §13 / 总体规划 §12 风格)

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| CF1 | 合法红蓝配置 | §12.1 | `loadSyluxConfig` 成功,derived 完整 |
| CF2 | 合法主从配置 | §12.2 | 成功,playbookParams.maxRounds=12 |
| CF3 | YAML/JSON 等价 | 同配置两种格式 | 解析后 deep-equal |
| CF4 | 缺配置文件 | 路径不存在 | `CONFIG_NOT_FOUND` |
| CF5 | YAML 语法错 | 坏缩进 | `CONFIG_PARSE_ERROR` |
| CF6 | env 引用缺失 | `${env:MISSING}` | `CONFIG_ENV_UNRESOLVED` |
| CF7 | env 引用解出 sk- | env 值像 key | `CONFIG_ENV_UNRESOLVED`(K1,detail 无值) |
| CF8 | 配置里直接写 sk- | api_key_ref 值是 sk- | 命中 SECRET_SIGNATURES → `PROVIDER_CONFIG_INVALID` |
| CF9 | snake→camel | base_url/wire_api | TS 收到 baseUrl/wireApi(§10.1) |
| CF10 | 其余段写 snake | stop.max_rounds | `.strict()` 拒(§5.3 提示写 stop 段) |
| CF11 | maxRounds 写进 playbook.params | params.maxRounds=8 | `.strict()` 拒,提示写 stop |
| CF12 | host=0.0.0.0 | server.host | `CONFIG_SCHEMA_INVALID`(X6/K6) |
| CF13 | sandboxCeiling=danger | worktree | 降级 workspace-write + 告警(K5),不拒 |
| CF14 | repoRoot 非 git | 普通目录 | `CONFIG_REPO_INVALID`(X1) |
| CF15 | 红蓝单 agent | 只配 codex 槽 | `CONFIG_AGENT_UNMAPPED`(X3) |
| CF16 | parallel 单 worker | 一个 agent 槽 | `CONFIG_AGENT_UNMAPPED`(X4) |
| CF17 | assignment 指 human | critic: human | superRefine 拒(§5.1) |
| CF18 | apiKeyRef 无绑定 | 引用未声明 ref | `PROVIDER_CONFIG_INVALID`(07/X7) |
| CF19 | active key 不可解析 | env 未设 | `PROVIDER_CONFIG_INVALID`,detail 只给 ref 名(§11.3) |
| CF20 | maxCostUsd 无 pricing | budget 缺 pricing | `PROVIDER_CONFIG_INVALID`(X5/04) |
| CF21 | stop 全省略(red-blue) | 无 stop 段 | 派生注入 `maxTotalTokens=600000`(范式默认,非无限;§6.2/§6.4)|
| CF22 | stop 部分覆盖 | 只写 maxRounds | 其余回退范式默认(§6.3) |
| CF23 | env 覆盖优先级 | SYLUX_LOG_LEVEL=debug + 文件 info | 生效 debug(§10.3) |
| CF24 | CLI flag 优先级 | --metrics-port 9091 + 文件 9090 | 生效 9091(§10.3) |
| CF25 | reload 坏配置 | 非法新配置 | `{ok:false}`,旧 derived 保留(§11.5/K2) |
| CF26 | reload 改 repoRoot | 新 repoRoot | 告警「需重启生效」,不静默(§11.5) |
| CF27 | panel 成员越界 | providerId 不在 candidates | `PROVIDER_CONFIG_INVALID`(X9) |
| CF28 | panel 启用 implement | enabledKinds 含 implement | 07 superRefine 拒(§4.4) |
| CF29 | derive 完整性 | §12.2 | playbookParams 三段重组正确(§11.4) |
| CF30 | version 缺省 | 无 version 字段 | 默认 1,不报错(§1.3/K7) |
| CF31 | **regime 预算口径(ROC-B1)** | 四范式各自 stop 全省略 | red-blue/pair/parallel 走线性额度(600k/500k/800k),master-worker 走累积 1.5M;**断言 red-blue≠808k**(防超线性回潮)|
| CF32 | **stop 阈值热换不清零(ROC-M2)** | run 中 emptyStreak=1,reload 把 stallWindow 改 3 | 走 04 `composite.reconfigure({convergence:{stallWindow:3}})`;emptyStreak **仍为 1**(未被清零),阈值已更新;**断言不重建 policy**(§11.5/04 S12)|
| CF33 | 默认补 requireVerifiedProgress | 无 convergence 段 | 派生 convergence.requireVerifiedProgress=true(§6.2/04 H-FP)|

> **验收线**:CF7/CF8/CF19(K1 密钥不入文件/不回显)、CF12(K6 host)、CF13(K5 沙箱封顶)、CF21/CF31(默认有预算兜底且 **regime 口径正确**,ROC-B1)、CF32(阈值热换不清零 stall 计数,ROC-M2)、CF10/CF11(单一阈值单一来源 §5.3)是配置层红队验收硬锚点。这几条不过,配置层不算交付。

---

## 15. 收尾:本文件权威性声明与开放问题

### 15.1 权威声明

1. **聚合而非另写**:`SyluxConfig` 顶层及 `RunConfig`/`PlaybookSelection`/`StopConfig`/`WorktreeConfig`/`ServerConfig`/`LoggingConfig` 的**配置层组装**有且只有本文件定义,落 `@sylux/server/src/config/`。各段**字段本体**权威在下游(providers 07 / stop 04 / worktree 09 / WS 08·11 / 日志 15),本文件**内嵌引用、不重画**(焊死 R1)。
2. **加载单一出口(K3)**:配置只由 `loadSyluxConfig` 解析一次,产出 `SyluxConfig` + `DerivedConfigs`;各子系统从派生对象取,不重读盘。热加载走同一函数 + 失败安全(07 §8.6)。
3. **R8 焊死复核(配置侧)**:key 无字段(K1)、坏配置 0 副作用(K2)、沙箱封顶不可越(K5)、WS 默认最小暴露(K6)、redact 无关闭开关(§9)。
4. **红队焊死(v2)**:
   - **ROC-B1(blocker)已修**:§6.4 默认预算表改回**按 regime 分口径**——stateless 默认范式(red-blue 600k / pair 500k / parallel 800k)用线性、resume 范式(master-worker 1.5M)用累积,逐格镜像 03 §7 `params` 字面量。删去 v1 对 stateless 误套 `base×N(N+1)/2×1.2`(red-blue 808k)的超线性配额。
   - **ROC-M2(major)已修**:§11.5 stop 阈值热换改走 04 `StopPolicy.reconfigure(patch)`/`Composite.reconfigure(patches)`(只改阈值、不碰 `emptyStreak`/`seen`),删去对已废弃 `checkBefore` 的引用(04 v2 H1 / 03 §0.4 已删两段式)。
   - **E9(major)已修**:§5.1/§6.1 对 `playbookIdSchema`/`continuityModeSchema`/`tokenPricingSchema` 标注「填 03/04 留的 zod 空缺」,并加编译期 `satisfies`/双向赋值漂移护栏锁死与 03/04 TS 类型同构。
5. **需回填项**:
   - 02 §12:新增六个配置错误码(§13),回填 `SyluxErrorCode` union(向后兼容新增)。
   - **03 §7 ↔ 本文件 §6.4**:两表保持逐格一致(**单一真值在 03 §7 `params` 字面量**);M2 实测校准 `base'` 时改 03 §7 即回填本表。
   - 13 §3:`SYLUX_*` env 覆盖白名单(§10.3)与命名约定对齐。

### 15.2 openQuestions

- 【待 04 回填】04 §3(line 279)maxRounds prose 建议区间(红蓝 6–8/主从 10–12/结对 4–6)与 03 §7 `params` 代码字面量(12/40/10/6)**不一致**。本文件 §6.4 已锚定 03 §7 代码为权威(04 该处自述"默认由 playbook 给"),但 04 prose 仍需回填对齐,否则审阅者两处读到不同默认会困惑。
- 【待实测】YAML 解析库选型(`yaml` vs `js-yaml`)与多文档/锚点支持是否需要;面板「保存配置」回写 YAML 时注释保留(round-trip)如何处理(可能退化为 JSON 回写)。
- 【待上层决策】配置分层/继承(base 配置 + run 级 override)是否需要,还是保持「一份文件一个 run」的扁平模型(当前按扁平设计,§0.1)。
- 【待协调】`SYLUX_*` env 覆盖白名单的最终清单(§10.3)需与 13 §3 + 各子系统 env 用法对齐,避免遗漏或冲突。
- 【待实测】`predowngradeSandbox`(K5 danger 预降级,§7)对原始对象的改写是否会与 §10.1 的 camelize 顺序耦合出边界 case(当前定义为先 camelize provider 段再 predowngrade,二者作用不同子树,应无冲突,需单测 CF13 覆盖)。
- 【待实测·承接 03/04】stateless 的每轮均值 `base'`(含 digest+delta,§6.4 取 ≈25k)与 output/input 比例是经验值;M2 用 `turn.completed.usage` 实测分布校准后,03 §7 与本文件 §6.4 同步刷新(reasoning 模型 output 占比更高,可能抬高线性额度)。
- 【待上层决策】provider 段 snake_case、其余段 camelCase 的不对称(§10.1)是否会让用户困惑;是否需要在 schema 错误信息里主动提示「这段该用 snake/camel」(当前 `.strict()` 报未知字段,可加更友好的提示文案)。
- 【待协调】reload 时「需重启生效」字段集(§11.5)与面板(10)的提示交互:面板应禁用这些字段的热改入口还是允许改但提示重启,待面板文档确认。

