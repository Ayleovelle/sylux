# 18 · 剧本评分评测台(Eval Harness)

> **版本**:v2(吃掉红队/交叉审查:red-ops-cost ROC-M1/ROC-M3/ROC-m5/ROC-m6、red-feasibility FEAS-1、red-security RS-M5/RS-B2、x-coverage COV-10、x-consistency E11/C-NUM)。v2 相对 v1 的实质变更:① §6 成本失明硬化——usage 缺失/字段漂移时 `CostScore.costReliable=false` + `estimatedCostUsd=null`,绝不吐偏低估算(ROC-M1);② §6.4 `estimateRunTokens` 从「二分 stateless/resume」升级为「regime 感知 + panel 扇出 + master-worker 混合链」三档(FEAS-1/ROC-m6/RS-M5);③ §9.6 runner 真 spawn **强制经 17 `ConcurrencyGovernor`**(全局单例 + 每端点子池),(task,cell) 并发降级为「提交意愿」(ROC-M3);④ §5.2/EV6 红队发现门从「强/中」收紧为「≥1 条强」对齐 02 v2(COV-10/E11);⑤ §6.4/§9.5 给出回放摊销成本模型,「零成本」限定在录制有效期内(ROC-m5);⑥ §10 报告经面板渲染必经 10 的 XSS 消毒,redact≠HTML 转义(RS-B2);⑦ 全文交叉引用改**锚定磁盘文件名**(见下「编号约定」,C-NUM)。
>
> **编号约定(C-NUM,锚定磁盘文件名)**:本文件交叉引用一律用**磁盘文件名编号**(02 黑板 / 03 引擎·playbook / 05 codex 适配·`AgentAdapter` 接口权威 / 06 claude 适配 / 07 provider / 08 安全·防火墙·redact / 09 worktree 隔离 / 10 Web 面板 / 11 WS 协议 / 14 测试 / 15 观测·错误 / 16 配置 / 17 性能·并发治理 / 19 部署·版本漂移 / 21 Fusion 评审团)。v1 曾用「逻辑编号」(adapter=04/worktree=06/security=09/面板=08·10·11),与磁盘不符,v2 已全部回填为磁盘名。全仓「逻辑编号 ↔ 磁盘文件名」权威映射表仍由定稿统筹(x-consistency C-NUM / x-coverage COV-6 待裁决);本文件先就地锚定磁盘名以消歧。
>
> **本文件地位**:sylux 评测子系统(`@sylux/eval`)的权威设计。拥有评测任务集结构(`EvalTask`)、评测矩阵(`EvalMatrix` = 剧本 × provider 组合)、打分 schema(`EvalScore` 质量 + 成本)、确定性回放(录制事件流 → 重放)、A/B 对比(`AbReport`)的完整契约,以及评测 runner 的执行管线、报告产出格式、失败路径。
>
> **类型引用而非另写**:`Message` / `EvidenceItem` / `Round` / `RunStatus` / `BoardState` / `TokenUsage` / `JsonlRecord` / `SyluxErrorCode` 全部来自 **黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`);`Playbook` / `PlaybookParams` / `PlaybookId` / `ContinuityMode` 来自 **引擎(03)**;`AgentAdapter` / `AgentInput` / `AgentEvent` 接口来自 **适配层(05 拥有接口,06 为 claude 实现)**;`ConcurrencyGovernor` / `EndpointKey` 来自 **性能·并发治理(17)**;`PanelProviderConfig` / `enabledKinds` 来自 **Fusion(21)**;`ProviderSettings` / `AgentProviderSlot` / 单价 `pricing` 来自 **provider(07)**;`RunConfig` / `SyluxConfig` 来自 **配置(16)**;录制 fixtures / fake-CLI / execa-mock 复用 **测试(14)**。本文件**只引用、禁止另定义**(焊死红队 R1)。文中出现这些类型一律指其权威源定义。
>
> **与总体规划的关系**:评测台不在总体规划的核心 9 文档里,是 M2+ 的质量基建。它**不引入新的运行期类型**,只在既有 jsonl 行日志(02 §7)与 BoardState 投影(02 §10)之上做**聚合与对比**,外加一层评测专属的任务/打分/报告类型(全部物理落 `@sylux/eval`,不污染 `@sylux/shared`)。
>
> **事实地基**:成本模型(累积/超线性 token,基线底价 ≈18.7k/回合)、token 计量(`turn.completed.usage`)、resume 行为一律遵守 `docs/PROBED-FACTS.md`(2026-06-20 本机实测,D 节)。凡事实地基已覆盖的不再标【待实测】;仅未实测的标【待实测】。

---

## 0. 设计目标与不变量

### 0.1 评测台要回答的三个问题

sylux 有四范式(03)× 每 agent 可换 provider(07)× 可调刹车参数(03 `PlaybookParams`),组合爆炸。没有量化评测,「红蓝对抗比主从好」「换 provider 划不划算」全是拍脑袋。评测台用**一组固定任务**把主观判断变成可复算的数字,回答:

| 问题 | 量化指标 | 数据来源 |
|---|---|---|
| **质量**:这个剧本/provider 组合把任务做得多好? | 任务通过率、红队有效发现数、收敛轮数 | jsonl 行日志(02 §7)+ 任务自带断言 |
| **成本**:做到这个质量花了多少? | 累积 input/output token、估算费用、wall-clock 时长 | `Round.usage` / `BoardState.totalUsage`(02 §10) |
| **稳定**:换一次能不能复现? | 确定性回放比对(录制 == 重放) | 录制的事件流 fixtures(14 §3.2) |

### 0.2 核心不变量(实现必须保持)

- **EV1 评测不改运行期**:评测台是 `runEngine`(03 §5)的**外层包裹 + 事后聚合**,绝不修改引擎/黑板/适配层。它喂 `SyluxConfig`(16)、收 jsonl,在外面打分。引擎不感知自己正被评测。
- **EV2 打分只读 jsonl**:所有质量/成本指标从 `runs/<runId>.jsonl`(02 §7 append-only 权威源)投影计算,**不另开数据通道**。评测可对**历史 run** 离线打分(只要有 jsonl),不必重跑。
- **EV3 确定性来自录制,不来自运行**:真 CLI 经中转有不可复现性(温度、中转抖动)。确定性回放靠**录制真实事件流**(14 §3.2 fixtures)→ 用 ReplayAdapter 重放,而非奢望真 CLI 可复现。录制态打分必须逐字节稳定(EV8)。
- **EV4 质量指标可机器核验**:任务「通过」不靠 LLM 自评,靠任务自带的**可机器核验断言**(命令退出码 / 文件内容 hash / 测试通过数),复用 02 §3 evidence 锚点的核验机制(`file_ref` / `command`)。杜绝「agent 说自己做完了就算通过」。
- **EV5 成本用实测 usage,不本地估**:token 取 `turn.completed.usage`(事实地基 B/D,中转回吐可靠),费用按 provider 单价表换算。绝不用本地 tokenizer 估算(会与计费口径漂移)。
- **EV6 红队发现可量化**:critic 的「有效发现」= 一条**经核验通过**(02 §8.3,门槛对齐 02 v2:**至少一条强核验** evidence,weak/medium 单独不解锁)且**带来新 evidence 指纹**(02 §9.2 差集非空)的 critique。空泛批判、重复旧论点不计分。这把「唱反调质量」从主观变客观。
- **EV7 A/B 公平性**:对比两个剧本/provider 必须**同任务集、同录制种子(回放态)或同 N 次重复(真跑态)、同刹车预算口径**。否则数字不可比,A/B 结论无效(§8.3 公平性校验硬门)。
- **EV8 评测产物可复现可审计**:每次评测产出带 `evalRunId` + 输入指纹(任务集 hash + config hash + fixtures hash),同输入必得同 `EvalScore`(回放态)。报告落盘,可 diff、可回归。

### 0.3 本文件负责 / 不负责

| 负责(给完整 schema + 算法 + 管线) | 不负责(只引用) |
|---|---|
| `EvalTask` / `EvalTaskSet` 任务集结构 | `Message`/`Evidence`/`Round`/`BoardState`/`TokenUsage` → 02 |
| `EvalMatrix`(剧本 × provider 组合枚举) | `Playbook`/`PlaybookParams`/`runEngine` → 03 |
| `EvalScore`(质量 + 成本打分 schema) | `validateMessage` / 指纹算法 → 02 |
| 质量指标算法(通过率/红队发现/收敛轮数) | `ProviderSettings` / 单价口径源 → 07 |
| 成本指标算法(累积 token / 费用换算) | 录制 fixtures 字节纪律 / fake-CLI → 14 |
| `ReplayAdapter`(录制事件流重放) | `SyluxConfig` 组装 / crossChk → 16 |
| `AbReport`(A/B 对比 + 显著性) | WS 面板渲染评测结果 → 10/11 |
| 评测 runner 管线 + 报告产出格式 | 脱敏(报告落盘过 redact)+ 面板渲染 XSS 消毒 → 08/10 |

---
## 1. 物理落点与依赖

### 1.1 包布局(`@sylux/eval`)

```
packages/eval/
├─ package.json              # name: "@sylux/eval";依赖 @sylux/shared(02) + @sylux/core(03) + zod
├─ src/
│  ├─ index.ts               # re-export(§11)
│  ├─ task.schema.ts         # ★ EvalTask / EvalTaskSet / Assertion(本文件 §2 权威)
│  ├─ matrix.schema.ts       # ★ EvalCell / EvalMatrix(剧本×provider 组合,§3)
│  ├─ score.schema.ts        # ★ EvalScore / QualityScore / CostScore(打分,§4)
│  ├─ metrics/
│  │  ├─ quality.ts          # 质量指标:通过率/红队发现/收敛轮数(§5)
│  │  ├─ cost.ts             # 成本指标:累积 token/费用换算(§6)
│  │  └─ project.ts          # jsonl → BoardState 投影 + 指标输入(复用 02 §7.3,EV2)
│  ├─ replay/
│  │  ├─ record.ts           # 录制:真跑时把 AgentEvent 流落 .rec.jsonl(§7.1)
│  │  └─ replay-adapter.ts   # ★ ReplayAdapter:实现 05 AgentAdapter 接口,从录制重放(§7.2)
│  ├─ runner.ts              # ★ 评测 runner:枚举 cell → 跑/回放 → 打分 → 报告(§9)
│  ├─ ab.ts                  # A/B 对比 + 公平性校验 + 显著性(§8)
│  └─ report.ts              # 报告产出(json + markdown),落盘过 redact(§10)
├─ tasks/                    # 内置任务集(随包发布,§2.4)
│  ├─ refactor-rename.task.json
│  ├─ bugfix-nullderef.task.json
│  └─ ...
└─ recordings/               # 录制的事件流(确定性回放源,EV3;.gitattributes eol=lf)
   └─ <taskId>/<cellId>/<agent>.rec.jsonl
```

> `@sylux/eval` 在依赖图里位于 `core` 之上、`server` 之下(它要 `runEngine`,但 server 才编排 run)。它**只读** `@sylux/shared` 的 schema 做打分,**不新增**任何 `@sylux/shared` 类型(EV1)。评测专属类型(`EvalTask`/`EvalScore`/...)留在本包,因为它们不参与运行期黑板契约。

### 1.2 schema 版本常量

```ts
/** 评测契约版本。EvalTask/EvalScore/报告行结构破坏性变更时 +1(独立于 02 SCHEMA_VERSION)。 */
export const EVAL_SCHEMA_VERSION = 1 as const;
```

> 与 02 的 `SCHEMA_VERSION` 解耦:运行期黑板契约升版不一定要动评测契约,反之亦然。报告里两个版本号都记(§10.2),回归对比时识别口径变化。

### 1.3 与既有资产的复用关系(不重造轮子)

| 评测台要的能力 | 复用谁 | 不自己造 |
|---|---|---|
| jsonl → BoardState 投影 | 02 §7.3 回放重建算法 | `metrics/project.ts` 只是薄封装 |
| evidence 核验(file_ref/command) | 02 §8.3 `verifyEvidence` + `ValidateContext` | 质量打分直接调,口径与运行期一致(EV4) |
| evidence 指纹差集(红队发现) | 02 §9.2 `fingerprint` / `fingerprintSet` | 红队「新发现」= 差集非空,与 stall 同源(EV6) |
| token 计量 | 02 `TokenUsage` + `Round.usage` / `BoardState.totalUsage` | 成本打分只做单价换算(EV5) |
| 真 spawn 并发节流 | 17 `ConcurrencyGovernor`(全局单例 + 每端点子池) | runner 不自管并发,只提交意愿,真 spawn 经 `acquire`(EV1/ROC-M3,§9.6) |
| 录制事件流字节纪律 | 14 §3.2 fixtures + `.gitattributes eol=lf` | recordings/ 复用同纪律,文件名注明版本 |
| 真跑 run | 03 `runEngine` + 16 `SyluxConfig` | runner 只是外层枚举 + 注入 ReplayAdapter |
| 报告落盘脱敏 + 面板渲染消毒 | 08 redact 管线 + 10 面板 XSS 消毒/CSP | report.ts 落盘前 redact;面板渲染前按 10 DOMPurify/CSP 消毒(EV2,§10.4) |

---

## 2. EvalTask —— 评测任务集结构

### 2.1 设计原则:任务自带「可机器核验的成功定义」

评测的命门是 EV4:**任务通过与否不能靠 agent 自评**。每个 `EvalTask` 必须携带一组**断言**(`Assertion`),在 run 结束后由评测台在**最终合并的 worktree**(09)上机器核验。断言复用 02 §3 的两种强核验锚点(`command` / `file_ref`),不发明新核验机制——这样「任务通过」和「critic 的 evidence 通过」用的是同一把尺(口径统一)。

```ts
import { evidenceItemSchema, playbookIdSchema } from '@sylux/shared'; // 02/引用

/** 任务难度档(影响 maxRounds 建议与基线对照,非硬约束)。 */
export const taskDifficultySchema = z.enum(['trivial', 'easy', 'medium', 'hard']);

/** 任务类别(决定哪些范式适用 + 报告分组)。 */
export const taskCategorySchema = z.enum([
  'bugfix',        // 修 bug:断言多为「测试由红转绿」command
  'refactor',      // 重构:断言为「行为不变(测试仍绿)+ 结构变化(file_ref)」
  'feature',       // 加功能:断言为「新测试通过 + 新文件存在」
  'design-review', // 纯方案评审(无代码改动):断言为「产出含规定要点」(弱核验,见 §2.3 警告)
  'adversarial',   // 红队专项:故意埋缺陷,考「critic 能否发现」(§5.3)
]);
```

### 2.2 Assertion —— 单条可机器核验的成功断言

```ts
/**
 * 单条任务断言。判别键 kind。复用 02 evidence 的核验语义但用途不同:
 * evidence 是 agent「声称的证据」,assertion 是评测台「客观的成功标准」(预先写死,agent 不可见不可改)。
 */
export const assertionSchema = z.discriminatedUnion('kind', [
  // ① 命令断言:在合并后 worktree 跑命令,比对退出码/输出。bugfix/feature/refactor 主力。
  z.object({
    kind: z.literal('command'),
    id: z.string().min(1),                       // 断言唯一 id(报告里逐条列通过/失败)
    cmd: z.string().min(1),                       // 可复现命令(如 `npm test -- foo.test.ts`)
    expectExitCode: z.number().int().default(0),  // 期望退出码
    expectStdout: z.string().optional(),          // 可选:stdout 子串/正则匹配
    matchMode: z.enum(['equals', 'contains', 'regex']).default('contains'),
    timeoutMs: z.number().int().positive().default(120_000),
    weight: z.number().positive().default(1),     // 加权:核心断言权重高(§5.1 通过率加权)
  }),
  // ② 文件断言:合并后 worktree 内某文件区间内容 hash == 期望(重构「结构变化」可验)。
  z.object({
    kind: z.literal('file_ref'),
    id: z.string().min(1),
    path: z.string().min(1),                      // 相对 repoRoot;过路径白名单(02 §8.3 同款)
    lineStart: z.number().int().positive().optional(), // 省略=整文件
    lineEnd: z.number().int().positive().optional(),
    expectContentHash: z.string().optional(),     // 期望区间 hash(02 §9.1 normalizeContent+sha256-16)
    expectExists: z.boolean().default(true),       // 仅验存在/不存在(feature 加文件 / 删文件)
    weight: z.number().positive().default(1),
  }),
  // ③ 产出断言:run 的 BoardState 投影里必须出现满足条件的 message(design-review 用,弱核验)。
  z.object({
    kind: z.literal('produced'),
    id: z.string().min(1),
    requireKind: z.string().optional(),           // 如必须有一条 kind==='done'
    bodyContains: z.array(z.string()).default([]), // body 必须含的关键词(全部命中才算)
    minEvidenceVerified: z.number().int().nonnegative().default(0), // 至少 N 条 evidence 核验通过
    weight: z.number().positive().default(1),
  }),
]);
export type Assertion = z.infer<typeof assertionSchema>;
```

### 2.3 produced 断言的弱核验警告(对抗性自检)

`produced.bodyContains` 是**关键词匹配**,本质是弱核验——agent 可能恰好提到关键词却没真做对。这是 design-review 类任务的固有局限(无代码可跑断言)。纪律:

- **能用 command/file_ref 就不用 produced**:bugfix/refactor/feature 必须以 command/file_ref 为主断言,produced 至多作辅助(如「最终要发 done」)。
- **produced 不单独决定通过**:任务的 `passThreshold`(§2.4)若全靠 produced 断言达成,报告标 `weakVerification: true` 警示(§5.1),A/B 对比时该任务降权或剔除(EV7)。
- **design-review 任务的红队价值在 critic**:与其验「方案对不对」(主观),不如验「critic 发现了多少真问题」(§5.3 adversarial 模式更可靠)。

### 2.4 EvalTask —— 单个任务的完整定义

```ts
export const evalTaskSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  /** 任务唯一 id(稳定,跨版本不变;报告/录制目录名用它,§7.1)。kebab-case。 */
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  category: taskCategorySchema,
  difficulty: taskDifficultySchema,
  /** 喂给引擎的任务目标(= RunConfig.goal,16 §3)。agent 看得到。 */
  goal: z.string().min(1),
  /**
   * 任务仓库 fixture:一个可被 worktree 派生的 git 仓库快照(目录路径或 tar 引用)。
   * 评测时复制到临时 repoRoot,保证每次从同一初始态开始(确定性,EV8)。
   */
  repoFixture: z.string().min(1),
  /** 成功断言集(EV4;agent 不可见——评测台私有的客观标准)。 */
  assertions: z.array(assertionSchema).min(1),
  /**
   * 通过阈值:加权断言通过比例 >= 此值才算任务 PASS(§5.1)。
   * 默认 1.0(全部核心断言必须过);可放宽给「部分完成也算分」的任务。
   */
  passThreshold: z.number().min(0).max(1).default(1),
  /** 适用范式白名单(空=全部)。如 design-review 不适合 parallel,可限定。 */
  applicablePlaybooks: z.array(playbookIdSchema).default([]),
  /**
   * adversarial 任务专用:已知缺陷清单(每条带一个可核验锚点)。
   * 用于「critic 发现率」打分:critic 的 critique 命中越多越高分(§5.3)。
   */
  knownDefects: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    anchor: evidenceItemSchema,   // 缺陷所在位置的标准锚点(file_ref/command)。critic 命中即与之指纹比对
  })).default([]),
  /** 建议刹车预算(评测时覆盖 playbook 默认;保证同任务跨剧本预算可比,EV7)。 */
  budget: z.object({
    maxRounds: z.number().int().positive(),
    tokenBudget: z.number().int().positive(),
  }),
  /** 元信息:作者、来源、标签(报告分组)。 */
  labels: z.record(z.string(), z.string()).default({}),
});
export type EvalTask = z.infer<typeof evalTaskSchema>;
```

### 2.5 EvalTaskSet —— 一组固定任务

```ts
/** 评测任务集:一批 EvalTask + 集合级元信息。A/B 必须同一 task set(EV7)。 */
export const evalTaskSetSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  tasks: z.array(evalTaskSchema).min(1),
  /** 集合内容指纹(所有 task 规范化后 hash;EV8 输入指纹的一部分,§9.4)。加载层算,不手填。 */
  contentHash: z.string().optional(),
});
export type EvalTaskSet = z.infer<typeof evalTaskSetSchema>;
```

### 2.6 任务字段语义表

| 字段 | 谁可见 | 语义 | 约束 |
|---|---|---|---|
| `goal` | agent 可见 | 喂引擎的目标 | = RunConfig.goal(16) |
| `repoFixture` | — | 初始仓库快照 | 每次复制到临时 repoRoot(EV8) |
| `assertions` | **agent 不可见** | 客观成功标准 | ≥1 条;尽量 command/file_ref |
| `passThreshold` | — | 加权通过阈值 | 默认 1.0 |
| `knownDefects` | **agent 不可见** | adversarial 已知缺陷 | 仅 adversarial 类用 |
| `budget` | 评测台用 | 统一刹车预算 | 跨剧本同任务必须同(EV7) |

> **关键纪律(EV7)**:`budget` 写在**任务**上而非剧本上。同一任务在四个剧本下跑,共用任务的 `maxRounds`/`tokenBudget`,覆盖各剧本 `PlaybookParams` 的默认(03 §3.3)。否则红蓝默认 12 轮、主从默认 40 轮,成本天然不可比,A/B 失真。

### 2.7 内置任务集(随包发布,M2 起步)

| taskId | category | difficulty | 主断言形态 | 考察点 |
|---|---|---|---|---|
| `bugfix-nullderef` | bugfix | easy | command:失败测试转绿 | 基础修 bug + 收敛 |
| `refactor-rename` | refactor | easy | command(测试仍绿)+ file_ref(符号已改) | 行为保持 + 结构变更 |
| `feature-pagination` | feature | medium | command(新测试通过)+ file_ref(新文件存在) | 多文件协作 |
| `adversarial-auth-bypass` | adversarial | hard | knownDefects×N(埋鉴权漏洞) | critic 发现率(§5.3) |
| `design-review-cache` | design-review | medium | produced(要点齐全)+ produced(发 done) | 方案质量(弱核验,§2.3) |

> 任务集随 `@sylux/eval` 发布,`repoFixture` 是 `tasks/repos/<id>/` 下的最小 git 仓库快照(M2 落地)。新增任务只加 `*.task.json` + 对应 repo fixture + 录制(§7),不改评测台代码。

---
## 3. EvalMatrix —— 剧本 × provider 组合枚举

### 3.1 一个 cell = 一次可打分的运行配置

评测的笛卡尔积是「任务 × 剧本 × provider 组合 × 续接策略」。把后三者打包成 `EvalCell`(一个可执行的运行配置变体),任务正交于 cell(同一 cell 跑全任务集)。一次评测 = `tasks × cells` 个 run。

```ts
import { playbookIdSchema, continuityModeSchema } from '@sylux/shared'; // 03 引用

/**
 * 一个 provider 指派:把物理 agent 绑到 provider 候选 id(07 AgentProviderSlot.activeId)。
 * 评测台不重画 provider 字段(R1):只引用 07 的 activeId 名,真正的 base_url/key 在 SyluxConfig.providers 里。
 */
export const cellProviderBindingSchema = z.object({
  codex: z.string().min(1),    // codex 槽用哪个 provider candidate id(07 §3.3)
  claude: z.string().min(1),   // claude 槽用哪个 provider candidate id
});

/** 评测单元:一组「剧本 + 角色指派 + provider 绑定 + 续接策略 + 刹车覆盖」的运行配置变体。 */
export const evalCellSchema = z.object({
  /** cell 唯一 id(报告/录制目录名;由 §3.3 规范化生成,稳定可复算)。 */
  id: z.string().min(1),
  playbookId: playbookIdSchema,
  /** 角色→agent 指派覆盖(03 §3.3 assignment;空=用范式默认)。换 critic 归谁在此调。 */
  assignment: z.record(z.string(), z.enum(['codex', 'claude'])).default({}),
  /** provider 绑定:每 agent 用哪个 provider(EV7 公平性:A/B 时只此项不同)。 */
  providers: cellProviderBindingSchema,
  /** 续接策略覆盖(03 §2.1;空=范式默认 defaultContinuity)。stateless vs resume 成本对比用。 */
  continuity: continuityModeSchema.optional(),
  /**
   * 刹车参数覆盖(03 PlaybookParams 子集;但 maxRounds/tokenBudget 被任务 budget 覆盖,EV7)。
   * 仅 convergenceWindow / perTurnContextCap / maxResumeChain 在此可调
   * (评 stall 敏感度 / context 裁剪策略 / resume 链长——后者喂 §6.4.1 mixed regime 估算)。
   */
  brakeOverride: z.object({
    convergenceWindow: z.number().int().positive().optional(),
    perTurnContextCap: z.number().int().positive().optional(),
    maxResumeChain: z.number().int().positive().optional(),  // master-worker resume 链封顶(03 §6.3);估算用
  }).default({}),
  /** cell 级标签(报告分组,如 "provider:official" vs "provider:mouubox")。 */
  labels: z.record(z.string(), z.string()).default({}),
});
export type EvalCell = z.infer<typeof evalCellSchema>;

/** 评测矩阵:task set + cell 列表 + 执行模式。runner 跑 tasks × cells 个 run。 */
export const evalMatrixSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  id: z.string().min(1),
  taskSetId: z.string().min(1),          // 指向某 EvalTaskSet(EV7:A/B 必同 task set)
  cells: z.array(evalCellSchema).min(1),
  /** 每个 (task,cell) 重复次数(真跑态用,降随机性;回放态恒为 1,§7.4)。 */
  repeats: z.number().int().positive().default(1),
  /** 执行模式:'replay' 确定性回放(EV3) | 'live' 真跑(烧 token)。 */
  mode: z.enum(['replay', 'live']),
});
export type EvalMatrix = z.infer<typeof evalMatrixSchema>;
```

### 3.2 cell 维度的取值空间

| 维度 | 取值 | 来源 | A/B 常见对比 |
|---|---|---|---|
| `playbookId` | red-blue / master-worker / pair / parallel | 03 §3.3 | 「哪个范式适合 bugfix」 |
| `assignment` | critic/planner 归 codex 还是 claude | 03 E1(role⊥agent) | 「codex 当 critic vs claude 当 critic」 |
| `providers` | 每 agent 的 provider candidate | 07 §3.3 | 「官方直连 vs mouubox 中转」 |
| `continuity` | stateless / resume | 03 §2.1 | 「resume 多花的 token 换来多少质量」(事实地基 D) |
| `brakeOverride.convergenceWindow` | 2 / 3 / 4 | 03 §3.3 | 「stall 窗口收紧会不会早停漏结论」 |

### 3.3 cell id 的规范化生成(稳定可复算,EV8)

cell id 不手填,由内容**规范化哈希**生成,保证同配置必得同 id(录制目录稳定、回放可定位):

```ts
/** 由 cell 的语义内容生成稳定 id。字段排序后 JSON 规范化 → sha256-16(02 §9.1 同款哈希)。 */
export function deriveCellId(cell: Omit<EvalCell, 'id'>): string {
  const canonical = JSON.stringify({
    p: cell.playbookId,
    a: sortedEntries(cell.assignment),
    pr: { codex: cell.providers.codex, claude: cell.providers.claude },
    c: cell.continuity ?? 'default',
    b: sortedEntries(cell.brakeOverride),
  });
  return `${cell.playbookId}-${contentHash(canonical)}`; // contentHash 复用 02 §9.1
}
```

> **labels 不进 id**:`labels` 是纯展示元信息,改 label 不应改 cell 身份(否则录制全失效)。只有语义字段(playbook/assignment/providers/continuity/brake)参与 id。

### 3.4 矩阵展开与剪枝

- **任务-范式适用性剪枝**:若 `EvalTask.applicablePlaybooks` 非空,跳过不在白名单的 cell(如 design-review 不跑 parallel)。
- **provider 可达性预检**:`mode==='live'` 时,展开前对每个 cell 的 provider 做一次连通性探针(07 健康检查),不可达的 cell 标 `skipped` 而非中途崩(§9.3)。
- **组合爆炸护栏**:`tasks × cells × repeats` 超过 `maxRunsGuard`(默认 200)时,runner 拒绝启动并报需要的预算估算(§6.4 累积成本模型,事实地基 D),要求显式 `--force` 或缩小矩阵。

---
## 4. EvalScore —— 打分 schema(质量 + 成本)

### 4.1 三层结构:断言级 → run 级 → 聚合级

打分自下而上三层,每层都可序列化进报告(可审计,EV8):

```
AssertionResult[]   ← 单条断言核验结果(命令退出码/hash 比对)
   ↓ 聚合
RunScore            ← 单个 (task,cell,repeatIndex) run 的质量+成本(一份 jsonl 一个)
   ↓ 聚合(按 cell 跨任务、跨 repeat)
CellScore           ← 一个 cell 在整个 task set 上的综合分(A/B 的比较单元)
```

### 4.2 AssertionResult —— 单条断言核验结果

```ts
export const assertionResultSchema = z.object({
  assertionId: z.string().min(1),
  kind: z.enum(['command', 'file_ref', 'produced']),
  passed: z.boolean(),
  weight: z.number().positive(),
  /** 核验细节(失败时人类可读;command 记 exitCode/输出片段,file_ref 记 hash 对比)。过 redact。 */
  detail: z.string().default(''),
  /** 弱核验标记:produced 类为 true(§2.3),用于 weakVerification 汇总。 */
  weak: z.boolean().default(false),
});
export type AssertionResult = z.infer<typeof assertionResultSchema>;
```

### 4.3 QualityScore —— 质量分(单 run)

```ts
export const qualityScoreSchema = z.object({
  /** 任务是否 PASS:加权通过比例 >= task.passThreshold(§5.1)。 */
  passed: z.boolean(),
  /** 加权断言通过比例 [0,1]:Σ(passed?weight:0) / Σweight。 */
  passRate: z.number().min(0).max(1),
  assertionResults: z.array(assertionResultSchema),
  /** 收敛轮数:run 终止时的轮数(02 BoardState.currentRound+1)。越少越好(同等 passed 下)。 */
  convergenceRounds: z.number().int().nonnegative(),
  /** 终止状态(02 RunStatus):done/stalled/limit/aborted/paused。done 最优。 */
  terminalStatus: runStatusSchema,        // 02 引用
  /** 红队有效发现数(§5.3;非 adversarial 任务也算,反映对抗质量,EV6)。 */
  redTeamFindings: z.number().int().nonnegative(),
  /** adversarial 专项:已知缺陷被 critic 命中的比例 [0,1](§5.3;非 adversarial 为 null)。 */
  defectRecall: z.number().min(0).max(1).nullable().default(null),
  /** 无效发言数:被打回的 critique / schema 违例 / 路径越界(02 §8.4;反映协议健康)。 */
  invalidUtterances: z.number().int().nonnegative().default(0),
  /** 弱核验警告:passed 是否主要靠 produced 断言达成(§2.3,A/B 降权)。 */
  weakVerification: z.boolean().default(false),
});
export type QualityScore = z.infer<typeof qualityScoreSchema>;
```

### 4.4 CostScore —— 成本分(单 run)

```ts
export const costScoreSchema = z.object({
  /** 累计 token(02 BoardState.totalUsage 求和;事实地基 D:累积/超线性)。EV5:取实测 usage。 */
  totalInputTokens: z.number().int().nonnegative(),
  totalCachedInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalReasoningTokens: z.number().int().nonnegative(),
  /** 估算费用(USD):按 provider 单价表换算(§6.2)。**costReliable=false 时强制 null**(不吐偏低估算,ROC-M1)。 */
  estimatedCostUsd: z.number().nonnegative().nullable().default(null),
  /**
   * 成本可信标志(吃掉 red-ops-cost ROC-M1):
   *   true  = 全轮都有实测 turn.completed.usage,token/费用是真金白银口径;
   *   false = 有轮 usage 缺失/字段漂移(15 usageMissing / 19 §6.3 degradable 漂移),
   *           token 计量按地板兜底会**严重低估**(地板只兜 input 下界,output/reasoning 当 0),
   *           此时 estimatedCostUsd 置 null,报告标「成本计量失效,不可比」,A/B 不拿它比成本(§8.3 F6)。
   */
  costReliable: z.boolean().default(true),
  /** usage 缺失的轮数(>0 即 costReliable=false 的成因;= 15 usage_missing_streak 投影)。 */
  usageMissingRounds: z.number().int().nonnegative().default(0),
  /** 每轮 token 明细(事实地基 D 累积曲线可视化;= 各 Round.usage)。 */
  perRoundInputTokens: z.array(z.number().int().nonnegative()).default([]),
  /** wall-clock 时长(ms,真跑态有意义;回放态恒为重放耗时,标记 fromReplay)。 */
  wallClockMs: z.number().int().nonnegative(),
  /** 是否来自回放(true 时 wallClockMs 不反映真实 CLI 延迟,§7.3)。 */
  fromReplay: z.boolean(),
});
export type CostScore = z.infer<typeof costScoreSchema>;
```

### 4.5 RunScore / CellScore —— run 级与聚合级

```ts
/** 单个 run 的完整打分(一份 jsonl → 一个 RunScore)。 */
export const runScoreSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  taskId: z.string().min(1),
  cellId: z.string().min(1),
  repeatIndex: z.number().int().nonnegative().default(0),
  runId: z.string().min(1),                 // 被打分的那次 run(02 jsonl 文件名)
  quality: qualityScoreSchema,
  cost: costScoreSchema,
  /** run 是否成功完成评测(false=run 本身崩了/jsonl 残缺,§9.3;与 quality.passed 区分)。 */
  evaluated: z.boolean(),
  error: z.string().optional(),             // evaluated=false 时的原因(SyluxErrorCode 或解析错误)
});
export type RunScore = z.infer<typeof runScoreSchema>;

/** 一个 cell 在整个 task set 上的聚合分(A/B 比较单元)。 */
export const cellScoreSchema = z.object({
  cellId: z.string().min(1),
  /** 任务通过率:PASS 的任务数 / 总任务数(跨 repeat 取多数表决或均值,§5.4)。 */
  taskPassRate: z.number().min(0).max(1),
  /** 平均收敛轮数(仅对 PASS 任务取,避免被超时任务拉高)。 */
  avgConvergenceRounds: z.number().nonnegative(),
  /** 红队发现总数 / 平均缺陷召回率。 */
  totalRedTeamFindings: z.number().int().nonnegative(),
  avgDefectRecall: z.number().min(0).max(1).nullable(),
  /** 成本聚合:总 token、总估算费用、单位质量成本(§6.3 tokenPerPass)。 */
  totalInputTokens: z.number().int().nonnegative(),
  totalEstimatedCostUsd: z.number().nonnegative().nullable(),
  /** 成本可信:cell 内任一 run costReliable=false → 整 cell 成本聚合不可信,totalEstimatedCostUsd 置 null(ROC-M1)。 */
  costReliable: z.boolean().default(true),
  costMissingRuns: z.number().int().nonnegative().default(0).describe('usage 缺失致不可信的 run 数'),
  tokenPerPass: z.number().nonnegative().nullable(),  // 总 token / PASS 任务数(性价比,§6.3)
  /** 稳定性:跨 repeat 的 passed 方差(真跑态;0=每次同结果)。 */
  passVariance: z.number().min(0).default(0),
  runScores: z.array(runScoreSchema),       // 明细(可下钻)
});
export type CellScore = z.infer<typeof cellScoreSchema>;
```

### 4.6 打分维度优先级(对抗性自检:不要只看通过率)

单看任务通过率会误导——一个剧本可能「通过但烧 10× token」或「通过但靠 produced 弱核验」。报告强制多维呈现,排序时按下列**字典序**默认排,但报告展示全维度:

| 优先级 | 维度 | 理由 |
|---|---|---|
| 1 | `taskPassRate`(强核验部分) | 做对了没有是第一位;弱核验通过单列 |
| 2 | `avgDefectRecall`(adversarial) | 红队任务的核心价值 |
| 3 | `tokenPerPass` | 性价比;同等通过率下越低越好(事实地基 D 真金白银) |
| 4 | `avgConvergenceRounds` | 同等质量下收敛越快越好 |
| 5 | `passVariance` | 稳定性;真跑态高方差说明结果不可靠 |

> **反作弊**:`weakVerification=true` 的 PASS 在排序里**不计入** `taskPassRate` 的主值,只进 `taskPassRateWeak` 旁列(§10.2 报告分两列)。防止某剧本靠「嘴上说做完了」刷分(EV4/EV6)。

---
## 5. 质量指标算法

所有质量指标从 `runs/<runId>.jsonl` 投影出的 `BoardState`(02 §7.3)+ 合并后 worktree(09)计算。打分器拿不到运行期状态,只拿这两样(EV2)。

### 5.1 任务通过率(加权断言)

```ts
/**
 * 在合并后 worktree 上核验任务断言。复用 02 §8.3 verifyEvidence 的核验上下文(EV4 口径统一)。
 * @param task 任务(含 assertions,agent 不可见)
 * @param ctx  核验上下文:合并后 worktree 句柄 + BoardState 投影(EV2)
 */
export function scoreQuality(task: EvalTask, board: BoardState, ctx: AssertCtx): QualityScore {
  const results: AssertionResult[] = task.assertions.map((a) => verifyAssertion(a, board, ctx));
  const totalW = results.reduce((s, r) => s + r.weight, 0);
  const passW = results.reduce((s, r) => s + (r.passed ? r.weight : 0), 0);
  const passRate = totalW === 0 ? 0 : passW / totalW;
  const passed = passRate >= task.passThreshold;

  // 强/弱核验拆分:若 passed 仅靠 produced(weak) 断言达成 → weakVerification
  const strongPassW = results.reduce((s, r) => s + (r.passed && !r.weak ? r.weight : 0), 0);
  const strongTotalW = results.reduce((s, r) => s + (!r.weak ? r.weight : 0), 0);
  const weakVerification = passed && (strongTotalW === 0 || strongPassW / strongTotalW < task.passThreshold);

  return {
    passed, passRate, assertionResults: results,
    convergenceRounds: board.currentRound + 1,
    terminalStatus: board.status,
    redTeamFindings: countRedTeamFindings(board),          // §5.2
    defectRecall: task.category === 'adversarial' ? defectRecall(task, board) : null, // §5.3
    invalidUtterances: board.messages.filter(isInvalidUtterance).length, // §5.4
    weakVerification,
  };
}
```

`verifyAssertion` 三分支:`command` → 在 worktree 跑命令比 exitCode/stdout(02 §8.3 command 核验同款);`file_ref` → 读区间 `contentHash` 比对(02 §9.1 normalizeContent,跨平台稳);`produced` → 扫 `board.messages` 关键词 + evidence 核验数,标 `weak:true`。

### 5.2 红队有效发现数(EV6)

「有效发现」必须同时满足两条,缺一不计——这是把「唱反调质量」客观化的核心(门槛对齐 02 v2:**至少一条强核验**,COV-10/E11):

```ts
/**
 * 红队有效发现 = critique 消息满足:
 *   (a) 至少一条 evidence 经 02 §8.3 核验为 **strong**(file_ref hash 一致 / command 自洽);
 *       —— 对齐 02 v2 收紧后的门:weak/medium 单独不解锁,不计有效发现(EV6);
 *   (b) 该 critique 带来新 evidence 指纹(02 §9.2 差集非空,不是重复旧论点)。
 * 二者缺一不计:空泛批判(无强核验)与复读旧批判(无新指纹)都是 0 分。
 */
export function countRedTeamFindings(board: BoardState): number {
  const seen = new Set<string>();           // 累积已出现的 evidence 指纹
  let findings = 0;
  for (const m of board.messages) {
    if (m.kind !== 'critique' && m.role !== 'critic') continue;
    const verifiedNew = m.evidence
      .filter((e) => verifyEvidence(e, asValidateCtx(board)) === 'strong' && e.kind !== 'spec_quote') // (a) 仅强核验
      .map(fingerprint)                                                                              // 02 §9.2
      .filter((fp) => !seen.has(fp));                                                                // (b)
    if (verifiedNew.length > 0) findings += 1;  // 一条 critique 计一次发现(无论它带几条新证据)
    m.evidence.forEach((e) => seen.add(fingerprint(e)));
  }
  return findings;
}
```

> **核验档枚举对齐 02 v2**:`verifyEvidence` 返回 02 §8.3 的核验档(v2 实质只有「强 / 非强」两态:`strong` 解锁,`weak`/`unverifiable` 不解锁)。本文件不复刻其枚举字面量,以 02 §8.3 为准;若 02 仍保留 `medium` 中间态,评测台口径是 **medium 不计入有效发现**(与 done 解锁门同尺,EV4/EV6)。

> **与 stall 同源**:红队发现用的「新指纹差集」与刹车的收敛 stall(02 §9.3)是**同一个指纹集合**。这不是巧合——「没有新发现」既是 stall 的触发条件,也是「红队没价值了」的信号。评测台复用 02 §9 的 `fingerprint`/`fingerprintSet`,不另算(EV6)。

### 5.3 adversarial 缺陷召回率(defectRecall)

adversarial 任务在 `knownDefects` 里预埋 N 个缺陷,每个带标准锚点。打分=critic 的 critique evidence 指纹**命中**了多少预埋缺陷:

```ts
/** 缺陷召回率 = 被任一 critique 命中的已知缺陷数 / 总已知缺陷数。命中=指纹匹配或锚点区间重叠。 */
export function defectRecall(task: EvalTask, board: BoardState): number {
  if (task.knownDefects.length === 0) return 0;
  const critiqueFps = new Set(
    board.messages.filter((m) => m.kind === 'critique' || m.role === 'critic')
      .flatMap((m) => m.evidence.map(fingerprint)),
  );
  const hit = task.knownDefects.filter((d) =>
    critiqueFps.has(fingerprint(d.anchor)) || anchorOverlap(d.anchor, critiqueFps), // §5.3.1 重叠判定
  ).length;
  return hit / task.knownDefects.length;
}
```

#### 5.3.1 锚点重叠判定(防「位置对但 hash 因上下文微变不等」漏判)

精确指纹匹配会漏掉「critic 指对了行但引用区间略有出入」的情况。`anchorOverlap` 放宽为:同 `path` 且 critic 的 `file_ref` 行区间与缺陷锚点行区间**有交集**即算命中。这是 recall 指标(宁可宽松计命中),与 precision 互补(§5.5 误报另算)。

### 5.4 收敛轮数与无效发言

- **收敛轮数** = `board.currentRound + 1`(0-based 轮号 +1)。仅在 `terminalStatus==='done'` 时有「收敛」语义;`stalled`/`limit` 时它是「耗尽轮数」,报告区分标注(§10)。
- **无效发言**(`isInvalidUtterance`)= 黑板里 `kind==='system'` 且 reason 命中 `OUTPUT_SCHEMA_VIOLATION`/`EVIDENCE_*`/`WORKTREE_PATH_VIOLATION`/`DANGLING_REPLY_REF`/`INVALID_*`(02 §12 打回类错误码)。反映 agent 产出的协议健康度——高无效发言说明 prompt/角色设计有问题。

### 5.5 红队 precision(误报率,可选高级指标)

仅 adversarial 任务:critic 提出的「发现」里有多少是**真缺陷**(命中 knownDefects)vs 误报(指向无缺陷处)。`precision = hit / 全部 verifiedNew critique 数`。低 precision = critic 爱喊狼来了。**默认不进主排序**(precision 需要「无缺陷处」的 ground truth,只有精心构造的 adversarial 任务才有),仅在任务显式标 `labels.measurePrecision='true'` 时计算并旁列。

---
## 6. 成本指标算法

### 6.1 token 计量(EV5:用实测 usage,不本地估)

成本只取 `turn.completed.usage`(事实地基 B/D),逐轮在 `Round.usage`(02 §10.1)、全 run 在 `BoardState.totalUsage`(02 §10.2)已聚好。打分器直接读,不重算。**但必须先核 usage 完整性(ROC-M1)**:CLI 升级改 `turn.completed.usage` 字段名/结构时(19 §6.1 明列此漂移面),19 §6.3 把该断言划为 `degradable`(drift-warn 放行),15 把无 usage 的轮标 `usageMissing` 且 token 计数不自增。于是评测态可能拿到「部分轮 usage 缺失」的 board——此时若闷头按地板算费用,会**严重低估**(地板只兜 input 下界,output/reasoning 当 0),让「这剧本多省钱」的结论失真。打分器据此**显式判 costReliable**:

```ts
export function scoreCost(board: BoardState, fromReplay: boolean, wallClockMs: number, price?: PriceTable): CostScore {
  const u = board.totalUsage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
  const perRound = board.rounds.map((r) => r.usage?.inputTokens ?? 0);  // 事实地基 D 累积曲线
  // ROC-M1:核 usage 完整性。某轮无 usage(02 Round.usage 缺失)或被 15 标 usageMissing(投影时带入)→ 成本不可信。
  const usageMissingRounds = board.rounds.filter((r) => r.usage == null || isUsageMissing(board, r)).length;
  const costReliable = usageMissingRounds === 0;
  return {
    totalInputTokens: u.inputTokens,
    totalCachedInputTokens: u.cachedInputTokens,
    totalOutputTokens: u.outputTokens,
    totalReasoningTokens: u.reasoningOutputTokens,
    // 不可信时强制 null:宁可「不知道花了多少」也不吐一个偏低的假数误导 A/B(ROC-M1)。
    estimatedCostUsd: costReliable && price ? estimateCost(u, price) : null,  // §6.2
    costReliable,
    usageMissingRounds,
    perRoundInputTokens: perRound,
    wallClockMs,
    fromReplay,
  };
}
```

> **为什么不在评测台按保守 output 估补**:补估(如 output=input×0.3)是**运行期成本刹车**(04 §6.4)的职责——那里要「宁可早刹不可漏刹」,补估有意义。评测台是**事后如实记账**:它要么报真实 usage,要么诚实标「这次计量失效」(`costReliable=false`),绝不拿补估的数去和别的 cell 比性价比(那会把「计量瘸了」伪装成「真省钱」)。评测台对 usage 漂移的正确反应是**标红 + 退出该 cell 的成本对比**,而非猜一个数。19 §6.3 的 degradable 处置面向「能不能跑」;评测台面向「能不能比」,门更严。

> **`isUsageMissing` 的数据来源**:它**不在 02 Round 上加字段**(02 类型已冻结,EV1/R1)。usage 缺失信号来自两处投影:① `Round.usage == null`(02 投影时本轮无 `turn.completed.usage`);② 15 在 jsonl 里对该轮落的 `usage_missing` 观测标记(15 O3/M2),`isUsageMissing(board, r)` 从 board 的 15-侧投影读,不污染 02 权威类型。两者任一命中即计入 `usageMissingRounds`。

### 6.2 费用换算(provider 单价表)

```ts
/** provider 单价(USD per 1M tokens)。来源:provider 配置(07)的可选 pricing 字段或评测台单价表。 */
export interface PriceTable {
  inputPerM: number;       // input token 单价
  cachedInputPerM: number; // 缓存命中的 input 单价(通常更低;事实地基 D cached_input_tokens)
  outputPerM: number;
  reasoningPerM?: number;  // 推理 token 单价(部分模型单独计;缺省按 output 价)
}

export function estimateCost(u: TokenUsage, p: PriceTable): number {
  const nonCachedInput = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    nonCachedInput * p.inputPerM +
    u.cachedInputTokens * p.cachedInputPerM +
    u.outputTokens * p.outputPerM +
    u.reasoningOutputTokens * (p.reasoningPerM ?? p.outputPerM)
  ) / 1_000_000;
}
```

> **单价口径来源**:单价表归 provider(07)拥有(每 provider 一份 pricing,与 base_url/wire_api 同级配置),评测台**引用不另写**(R1)。中转(mouubox)的真实计费可能与官方单价不同,单价表必须按 provider 实际计费口径填,否则 `estimatedCostUsd` 失真。无单价的 provider → `estimatedCostUsd=null`,报告只比 token 不比钱。

### 6.3 性价比指标:tokenPerPass

通过率高但烧钱多 ≠ 好。`tokenPerPass` 把质量和成本合成一个性价比数:

```
tokenPerPass = cell 总 input token / cell 内 PASS(强核验) 任务数
```

- PASS 任务数为 0 → `tokenPerPass=null`(无穷大,标「无有效产出」)。
- 只用强核验 PASS(`weakVerification=false`)做分母,防弱核验刷低分母(EV6)。
- 这是 §4.6 排序的第 3 优先级:同等 `taskPassRate` 下,`tokenPerPass` 低者胜。

### 6.4 累积成本预算估算(事实地基 D,组合爆炸护栏)

启动前 runner 必须估算整个矩阵的 token 预算,据此触发 §3.4 的 `maxRunsGuard`。事实地基 D 是硬约束:**resume 续接每轮按全量历史重计费,N 轮累积 ≈ base×(1+2+…+N) = base×N(N+1)/2**(累积/超线性);**stateless 每轮只喂 goal+digest+delta,近似线性 n×base×k**。red-ops-cost ROC-B1 点名:**绝不能对 stateless 范式套 resume 超线性公式**(16 §6.4 犯了此错,本文件 v1 已分叉做对、被红队确认正确)。v2 进一步吃掉两条:① FEAS-1——master-worker 是 stateless/resume **混合**,二分法估不准;② ROC-m6 / RS-M5——cell 启用 panel(21)时单轮扇出 N 成员,base 要乘 N+judge:

```ts
/** 单 run 累积 token 上界估算(事实地基 D + FEAS-1 混合 regime + ROC-m6 panel 扇出)。 */
export function estimateRunTokens(cell: EvalCell, task: EvalTask, panel?: PanelProviderConfig): number {
  const base = 18_700;                                  // 事实地基 D 基线底价/回合(最简回合;真实首轮更高,见下注)
  const n = task.budget.maxRounds;
  const regime = continuityRegimeOf(cell);              // 'stateless' | 'resume' | 'mixed'(§6.4.1)

  // 单 agent 单轮的 regime 估法
  let perRunSingleAgent: number;
  switch (regime) {
    case 'resume':
      // 累积/超线性:base×n(n+1)/2(事实地基 D 实测翻倍曲线)
      perRunSingleAgent = base * (n * (n + 1)) / 2;
      break;
    case 'stateless':
      // 近似线性:n×base×k(k≈1.3 含 digest/delta 系数)
      perRunSingleAgent = Math.round(base * n * 1.3);
      break;
    case 'mixed': {
      // master-worker:plan 段 stateless(每轮 base×1.3)+ implement 段以 resume 链推进,
      // 单链长受 maxResumeChain 封顶(03 §6.3)。FEAS-1:不能当纯 stateless 也不能当纯 resume。
      // 上界估 = stateless 轮数×base×1.3 + ⌈n/chainLen⌉ 条链 × (base×chainLen(chainLen+1)/2)。
      const chainLen = cell.brakeOverride.maxResumeChain ?? defaultResumeChainOf(cell.playbookId); // 默认 3
      const resumeRounds = Math.floor(n * 0.6);         // 经验:master-worker ~60% 轮在 resume 实现段
      const statelessRounds = n - resumeRounds;
      const chains = Math.ceil(resumeRounds / chainLen);
      perRunSingleAgent = Math.round(base * statelessRounds * 1.3)
                        + chains * (base * (chainLen * (chainLen + 1)) / 2);
      break;
    }
  }

  // ROC-m6 / RS-M5:cell 启用 panel 时,决策回合一次扇出 N 成员 + 1 judge,该轮 base 乘 (N+1)。
  // 成员强制 stateless(21 F3),不参与 resume 累积;只把「决策轮」的单轮成本放大。
  const fanout = panelFanoutFactor(cell, panel);        // §6.4.2;无 panel 返回 1
  return Math.round(perRunSingleAgent * fanout);
}

/** 整矩阵预算 = Σ over (task,cell,repeat)。超 maxRunsGuard 或预算阈值 → 拒启动(§9.2)。 */
export function estimateMatrixTokens(matrix: EvalMatrix, taskSet: EvalTaskSet): number { /* Σ estimateRunTokens × repeats */ }
```

#### 6.4.1 continuityRegimeOf —— 三态判定(FEAS-1)

```ts
/** cell 的 continuity regime。master-worker 等混合范式即使 continuity 字段单值,实际是混合链。 */
export function continuityRegimeOf(cell: EvalCell): 'stateless' | 'resume' | 'mixed' {
  // master-worker:plan stateless + implement resume 链交替(03 §7.2),无论 continuity 覆盖如何,算 mixed
  if (cell.playbookId === 'master-worker') return 'mixed';
  const c = cell.continuity ?? defaultContinuityOf(cell.playbookId);
  return c === 'resume' ? 'resume' : 'stateless';
}
```

> **FEAS-1 的诚实标注**:`mixed` 的 0.6 / chainLen 是**经验上界估**,非精确模型——master-worker 真实成本由 `maxResumeChain` 硬护栏兜底(03 §6.3「贴近但不破」),前瞻外推在 regime 切换点天然滞后一两轮(FEAS-1)。本估算用于**启动前护栏**(够不够触 maxRunsGuard),宁可高估早拦,不追求精确。运行期真实刹车归 04(轮末 `shouldStop`),不靠本估算。

#### 6.4.2 panelFanoutFactor —— panel 扇出系数(ROC-m6 / RS-M5)

```ts
/**
 * cell 若给某决策角色启用 panel(21),该角色发言轮一次并发 N 成员 + 1 judge。
 * 系数 = 1 + (决策轮占比 × N成员 × 成员单轮成本/单agent单轮 + judge占比)。保守上界:按全程决策轮估。
 * 成员 stateless 单 shot(21 F3),judge 一次综合;不进 resume 累积。
 */
export function panelFanoutFactor(cell: EvalCell, panel?: PanelProviderConfig): number {
  if (!panel || panel.members.length === 0) return 1;
  const N = panel.members.length;
  // 上界:假设每个决策轮都触发 panel(enabledKinds 命中),该轮成本 ≈ N 成员 + 1 judge。
  // 决策轮占全程比例 decisionRatio(red-blue ~1.0 全是 critique/propose;master-worker 较低)。
  const decisionRatio = decisionRoundRatioOf(cell.playbookId);  // red-blue≈1, master-worker≈0.4
  return 1 + decisionRatio * (N /* 成员并发 */ + 0.5 /* judge 综合约半轮 */ - 1 /* 原本就有的单 agent */);
}
```

> **为什么 panel 必须进估算(RS-M5/ROC-m6)**:red-security RS-M5 点出「预算只在轮末裁决,panel 单轮一次扇出 N 倍就能冲过预算」。评测态若不把 N 倍算进**启动前**的 `maxRunsGuard`,一个 5 成员 panel × 10 轮的 cell 估算会差 5×,矩阵预算护栏形同虚设,直接烧穿。本系数与 16/04 默认预算表的 panel 行(ROC-m6 要求补)对齐口径;评测台**先于运行**用它拦住「无意识开 panel 跑全矩阵」的烧钱。

> **回放态成本为 0(仅限录制有效期内,ROC-m5)**:`mode==='replay'` 时不调真 CLI,token 来自录制(已花过的钱)。回放的 `CostScore` 反映的是**被录制那次真跑的成本**(从录制元数据读),不是重放本身的成本。这让「成本对比」可在零额外花费下反复跑(EV3)。**但「零成本」只在录制有效期内成立**——引擎(03)迭代会让录制 desync(§7.3),重录是 live 真跑(§9.5)。评测台的**真实摊销成本**:
>
> ```
> 评测台真实成本 ≈ Σ(replay 跑次数 × 0) + Σ(重录次数 × 该 cell live 成本)
> ```
>
> 在引擎高频迭代期(M2–M3),`nextTurn` 稍变即触发大批 `REPLAY_DESYNC`,重录频率高,「零成本回放」的卖点被摊销成本侵蚀。文档诚实标注:**回放零成本是「录制有效期内」的零成本,非全生命周期零成本**。降低重录频率的工程手段见 §7.3 注与 §15 EQ5(把 ReplayAdapter 的匹配从「绑引擎调用序」往「绑输入内容」方向走,可降 desync 率)。

---
## 7. 确定性回放(录制事件流 → 重放)

### 7.1 录制:真跑时落 AgentEvent 流(EV3)

确定性来自**录制真实事件流**,不来自奢望真 CLI 可复现(中转有温度/抖动,真跑两次不同)。录制层在 `mode==='live'` 跑评测时,把每个 agent 的 `AgentEvent` 流(02 §6.3)逐条落盘,与 jsonl 黑板日志平行:

```
recordings/<taskId>/<cellId>/<agent>.rec.jsonl
```

每行是一条 `RecordedEvent`:原始 `AgentEvent` + 录制元数据(供回放严格还原 + 成本回填):

```ts
export const recordedEventSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  /** 第几次 send/resume 调用(从 0)。回放按 turn 序号定位该喂哪段事件(§7.2)。 */
  turnIndex: z.number().int().nonnegative(),
  /** 该 turn 是 send 还是 resume(回放校验调用序一致,§7.3 防漂移)。 */
  call: z.enum(['send', 'resume']),
  /** 原始事件(02 §6.3 AgentEvent:session_started/delta/tool_call/final_message/error)。 */
  event: agentEventSchema,                  // 02 引用
  /** 录制时的真实壁钟偏移(ms,可选用于回放节流模拟;默认回放不 sleep)。 */
  tOffsetMs: z.number().int().nonnegative().default(0),
});
export type RecordedEvent = z.infer<typeof recordedEventSchema>;
```

录制元信息(每个 `.rec.jsonl` 配一个 sidecar `.meta.json`,复用 14 §3.2 README 纪律):录制日期、codex/claude 版本(如 `0.141.0`)、provider(mouubox/官方)、wire_api、原始命令行(redact 后无 key)、被录制 run 的 `BoardState.totalUsage`(供回放回填 CostScore,§6.4)。

> **录制即 fixtures**:`recordings/` 与 14 §3.2 的 `fixtures/` 字节纪律完全一致(`.gitattributes text eol=lf`,文件名注版本,手编只用于负向)。区别仅用途:`fixtures/` 测适配器解析(14),`recordings/` 喂评测回放。两者可互相借用真实录制(同源)。

### 7.2 ReplayAdapter —— 实现 AgentAdapter 接口,从录制重放

回放的关键:用一个**实现 05 `AgentAdapter` 接口**的 `ReplayAdapter` 替换真 codex/claude adapter,注入进 `EngineDeps.adapters`(03 §4.3)。引擎完全不知道自己在回放(EV1)——它照常 `send`/`resume`,只是事件来自录制文件而非真子进程。

```ts
/**
 * 回放适配器:实现 05 AgentAdapter 接口,从 <agent>.rec.jsonl 按 turnIndex 顺序吐录制事件。
 * 严格校验调用序(send/resume 顺序与录制一致),不一致 → REPLAY_DESYNC 硬停(EV3 不静默漂移)。
 */
export class ReplayAdapter implements AgentAdapter {   // AgentAdapter 接口属 05
  private cursor = 0;
  constructor(private readonly recorded: RecordedEvent[]) {}

  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    yield* this.replayTurn('send');
  }
  async *resume(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent> {
    yield* this.replayTurn('resume');
  }

  private async *replayTurn(call: 'send' | 'resume'): AsyncIterable<AgentEvent> {
    const turn = this.recorded.filter((r) => r.turnIndex === this.cursor);
    if (turn.length === 0) throw new EvalReplayError('REPLAY_EXHAUSTED', `turn ${this.cursor} 无录制`);
    if (turn[0].call !== call) {
      // 调用序漂移:录制是 send 但引擎来 resume(或反之)→ playbook/引擎行为已变,录制失效
      throw new EvalReplayError('REPLAY_DESYNC', `turn ${this.cursor} 录制为 ${turn[0].call},实调 ${call}`);
    }
    for (const r of turn) yield r.event;     // 逐条吐(session_started 首,final_message 末,02 §6.3 顺序)
    this.cursor += 1;
  }
}
```

### 7.3 回放的确定性边界(对抗性自检:回放不等于全确定)

回放只能保证**「给定相同的 agent 输出,引擎/打分的决策相同」**。它**不**能保证:

| 能确定性复现 | 不能(回放无能为力) |
|---|---|
| 引擎循环、playbook nextTurn 决策、validateMessage 判定 | 真 CLL 本身的输出(那是被录制的、已固定的) |
| 收敛 stall / done 判定、刹车命中 | worktree 真实文件操作的副作用(需 repoFixture 同初始态) |
| 质量打分(断言核验)、成本聚合 | 真跑壁钟时长(回放 `fromReplay=true`,wallClock 无意义) |

确定性的**前提条件**(任一不满足则回放结果不可比):
1. **repoFixture 同初始态**:每次回放从任务的同一仓库快照派生 worktree,否则断言核验环境不同。
2. **引擎/playbook 代码未变**:若 03 的 nextTurn 逻辑改了,调用序会与录制漂移 → `REPLAY_DESYNC` 硬停(这是**特性**:提醒「录制已过期,需重录」)。
3. **schema 未破坏性升版**:02 `SCHEMA_VERSION` 或 `EVAL_SCHEMA_VERSION` 变了,旧录制可能解析失败 → 报告标 `recordingStale`。

> **REPLAY_DESYNC 是信号不是 bug**:回放硬停说明「这份录制对应的引擎行为已经不存在了」。CI 里它触发「重录该 cell」的告警(§9.5)。绝不静默跳过或猜测——那会让回放打分悄悄失真(EV3/EV8)。

### 7.4 录制态 repeats 恒为 1

`EvalMatrix.repeats` 在 `mode==='replay'` 时强制为 1(§3.1):同一份录制重放 N 次必得同结果,重复无意义。`repeats>1` 仅 `mode==='live'` 有效(降真 CLI 随机性,算 `passVariance`,§4.5)。runner 在展开时对 replay 矩阵的 `repeats!==1` 报配置错(§9.2)。

---
## 8. A/B 对比(不同 playbook / provider)

### 8.1 AbReport —— 两 cell 的对比结果

A/B 是评测台的主用途:「红蓝 vs 主从哪个修 bug 强」「官方 provider vs 中转划不划算」。对比单元是两个 `CellScore`(§4.5),在**同一 task set** 上(EV7)。

```ts
export const abComparisonSchema = z.object({
  metric: z.enum([                              // 对比哪个维度(§4.6)
    'taskPassRate', 'avgDefectRecall', 'tokenPerPass', 'avgConvergenceRounds', 'totalEstimatedCostUsd',
  ]),
  baselineValue: z.number().nullable(),         // A(baseline)cell 的值
  candidateValue: z.number().nullable(),        // B(candidate)cell 的值
  /** 差值方向已归一:正=candidate 更好(对成本类指标已取反,「越小越好」转成「越大越好」)。 */
  delta: z.number().nullable(),
  /** 相对变化百分比(baseline 为 0 或 null 时为 null)。 */
  relativePct: z.number().nullable(),
  /** 显著性(§8.4;仅真跑多 repeat 有意义,回放态为 'n/a')。 */
  significance: z.enum(['significant', 'not-significant', 'n/a']),
});

export const abReportSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  taskSetId: z.string().min(1),
  baselineCellId: z.string().min(1),
  candidateCellId: z.string().min(1),
  /** 公平性校验结果(§8.3;不通过则 comparisons 不可信,fair=false 时报告头部红字警告)。 */
  fair: z.boolean(),
  fairnessIssues: z.array(z.string()).default([]),
  comparisons: z.array(abComparisonSchema),
  /** 逐任务胜负明细(哪些任务 A 赢、哪些 B 赢、哪些平/都失败)。 */
  perTaskOutcome: z.array(z.object({
    taskId: z.string(),
    winner: z.enum(['baseline', 'candidate', 'tie', 'both-fail']),
    note: z.string().default(''),
  })),
  /** 总体结论(机器生成的一句话:谁在多少任务上更优 + 成本代价)。 */
  verdict: z.string(),
});
export type AbReport = z.infer<typeof abReportSchema>;
```

### 8.2 对比口径:成本类指标方向归一

不同指标「好」的方向相反(通过率越高越好,token 越低越好)。`delta` 字段统一归一为**正=candidate 更优**,避免读报告时方向混乱:

| metric | 原始方向 | delta 归一 |
|---|---|---|
| `taskPassRate` / `avgDefectRecall` | 越大越好 | `candidate - baseline` |
| `tokenPerPass` / `avgConvergenceRounds` / `totalEstimatedCostUsd` | 越小越好 | `baseline - candidate`(取反) |

### 8.3 公平性校验(EV7 硬门)

A/B 数字可比的前提是「只变一个维度,其余全同」。`checkFairness` 在生成对比前强制校验,任一不满足 → `fair=false` + 报告头部红字警告(不阻止出报告,但标记结论不可信):

```ts
export function checkFairness(a: CellScore, b: CellScore, ctx: AbContext): { fair: boolean; issues: string[] } {
  const issues: string[] = [];
  // F1 同 task set(EV7)
  if (ctx.taskSetIdOf(a) !== ctx.taskSetIdOf(b)) issues.push('不同 task set,不可比');
  // F2 同 mode(replay vs live 不可混比:live 有随机性,replay 无)
  if (ctx.modeOf(a) !== ctx.modeOf(b)) issues.push('replay 与 live 混比');
  // F3 同任务预算口径(EV7:maxRounds/tokenBudget 来自任务而非剧本,本应天然同;校验防意外覆盖)
  if (!sameBudgets(ctx.budgetsOf(a), ctx.budgetsOf(b))) issues.push('任务刹车预算不一致');
  // F4 单变量原则:cell 间应只有一个语义维度不同(playbook 或 provider 或 continuity 之一)
  const diffDims = cellDiffDimensions(ctx.cellOf(a), ctx.cellOf(b));   // §8.3.1
  if (diffDims.length > 1) issues.push(`多维度同时变化: ${diffDims.join(',')},无法归因`);
  // F5 覆盖任务一致(两 cell 实际评测的任务集合相同,无一方因 applicablePlaybooks 剪枝掉某些任务)
  if (!sameTaskCoverage(a, b)) issues.push('任务覆盖不一致(applicablePlaybooks 剪枝导致)');
  // F6 成本可比性(ROC-M1):比成本类指标时,任一方 costReliable=false → 成本对比不可信
  if (ctx.metricInvolvesCost && (!a.costReliable || !b.costReliable)) {
    issues.push('一方成本计量失效(usage 缺失/漂移),tokenPerPass/估算费用不可比');
  }
  return { fair: issues.length === 0, issues };
}
```

#### 8.3.1 单变量原则(F4)的现实让步

严格「只变一维」在 playbook 对比里不总成立——换范式往往连带换 `assignment`、`continuity` 默认值(红蓝默认 stateless,主从默认 resume)。处理:

- **provider A/B**:F4 严格执行(只 `providers` 不同,其余全锁)。这是最干净的对比。
- **playbook A/B**:F4 放宽为「记录所有差异维度」,`fair=true` 但 `verdict` 必须显式声明「范式差异连带了 continuity/assignment 变化,归因到单一因素需谨慎」。不假装单变量。
- **F5 任务覆盖**:design-review 任务被 parallel 剪枝时,playbook A/B 自动**取交集任务**重算两边 `CellScore`,保证分母一致(否则一方少跑难任务会虚高)。

### 8.4 显著性(真跑多 repeat)

回放态结果确定(方差 0),`significance='n/a'`。真跑态(`repeats>1`)用逐任务 paired 比较判显著:

- 每任务在 A/B 下各跑 `repeats` 次,得两组 PASS/FAIL(或连续指标如 token)。
- **二元指标(passed)**:用 McNemar 检验(配对,看「A过B败」与「A败B过」的不对称),p<0.05 标 `significant`。
- **连续指标(token/rounds)**:Wilcoxon signed-rank(配对、不假设正态),p<0.05 标 `significant`。
- repeats 太少(<5)无法判显著 → `significance='not-significant'` 并在报告标「样本不足」。

> **诚实纪律(对抗性自检)**:不要把「candidate 通过率 0.8 vs baseline 0.7」直接宣布胜利——若只跑 3 次、5 个任务,这点差异可能纯噪声。`significance` 字段强制把「看起来更好」和「统计上更好」分开。回放态因为确定,差异是真的(但只反映那一次被录制的运行,不代表分布)——报告对回放态 verdict 加注「单次录制,非分布」。

---
## 9. 评测 runner 管线

### 9.1 总流程(时序)

```
load(taskSet, matrix)                         # 解析 + zod 校验 + 算 contentHash(§9.4)
  → estimateMatrixTokens                      # 预算估算(§6.4);超 maxRunsGuard 拒启动(§9.2)
  → expand(tasks × cells × repeats)           # 笛卡尔积 + 剪枝(§3.4)
  → for each (task, cell, repeat):            # 可并发(§9.6),各自隔离 repoRoot
       prepareRepo(task.repoFixture)          #   复制初始仓库快照到临时 repoRoot(EV8)
       buildSyluxConfig(task, cell)           #   组装 16 SyluxConfig(§9.3)
       if mode==='replay': inject ReplayAdapter(§7.2)
       else (live):        inject 真 adapter + Recorder(§7.1)
       runResult = runEngine(playbook, deps)  #   03 §5;评测台不改引擎(EV1)
       board = project(runs/<runId>.jsonl)    #   02 §7.3 投影(EV2)
       runScore = score(task, cell, board)    #   §5 质量 + §6 成本
  → aggregate → CellScore[]                   # 按 cell 跨任务/repeat 聚合(§5.4)
  → ab(baseline, candidate)?                  # 可选 A/B(§8)
  → report(json + markdown)                   # §10,落盘过 redact(08)+ 面板渲染前消毒(10)
```

### 9.2 启动前校验(fail-fast)

| 校验 | 失败动作 |
|---|---|
| taskSet/matrix zod 解析 | 配置错误,拒启动并指出字段路径 |
| `mode==='replay'` 且 `repeats!==1`(§7.4) | 配置错误,拒启动 |
| `mode==='replay'` 且录制缺失/版本不符 | 标该 cell `recordingStale`,跳过并告警(§9.5) |
| `estimateMatrixTokens > tokenGuard` 或 runs > `maxRunsGuard` | 拒启动,打印预算估算,要求 `--force` 或缩矩阵(事实地基 D) |
| `mode==='live'` provider 不可达(07 健康检查) | 标该 cell `skipped`,继续其余(§3.4) |
| repoFixture 不存在 / 非 git 仓 | 该任务全 cell 标 `evaluated=false`,继续 |

### 9.3 SyluxConfig 组装(引用 16,不另写)

runner 把 `(task, cell)` 翻译成一份 `SyluxConfig`(16),喂给现有的 run 启动路径(EV1:复用 server 的 run 引导,不绕过):

```ts
function buildSyluxConfig(task: EvalTask, cell: EvalCell, base: SyluxConfig): SyluxConfig {
  return {
    ...base,
    run: { ...base.run, goal: task.goal, repoRoot: prepareRepo(task.repoFixture),
           runIdStrategy: 'explicit', fixedRunId: deriveRunId(task, cell) }, // 16 §3:固定 runId 便于回放定位
    playbook: { id: cell.playbookId, assignment: cell.assignment,
                params: { maxRounds: task.budget.maxRounds, tokenBudget: task.budget.tokenBudget, // EV7:任务预算覆盖
                          convergenceWindow: cell.brakeOverride.convergenceWindow,
                          perTurnContextCap: cell.brakeOverride.perTurnContextCap } },
    providers: bindProviders(base.providers, cell.providers),  // 07:把 cell 的 activeId 应用到 slots
  };
}
```

> `bindProviders` 只改各 slot 的 `activeId` 为 cell 指定的 candidate(07 §3.3),不碰 keyBindings/base_url(那是 provider 配置,R1)。`deriveRunId(task,cell)` = `eval-<taskId>-<cellId>-<repeat>`,稳定可定位录制与 jsonl。

### 9.4 输入指纹(EV8 可复现锚点)

每次评测产出带 `evalRunId` + 三段输入指纹,同输入回放必得同分:

```ts
export interface EvalInputFingerprint {
  taskSetHash: string;    // taskSet 规范化 JSON 的 contentHash(02 §9.1)
  matrixHash: string;     // matrix 规范化 JSON 的 contentHash
  recordingsHash: string; // replay 模式:所有用到的 .rec.jsonl 字节 hash 串联再 hash;live 模式为 'live'
}
```

报告头记录这三段 + `EVAL_SCHEMA_VERSION` + 02 `SCHEMA_VERSION` + 引擎 git commit(回放态),任一变化都说明「这次评测与上次输入不同」,回归对比时据此判断差异是真实变化还是口径变化。

### 9.5 录制过期处理(replay 模式)

`mode==='replay'` 跑到 `REPLAY_DESYNC`(§7.3)或录制版本不符时:**该 cell 标 `recordingStale`,不打分,报告列入「待重录」**。绝不静默猜测或跳过事件——回放的全部价值就是逐字节确定(EV3/EV8)。重录由 `runner --record --cell <id>` 触发一次 live 跑并落新录制。

### 9.6 并发与隔离(真 spawn 必经 17 ConcurrencyGovernor,ROC-M3)

**核心纪律(吃掉 red-ops-cost ROC-M3)**:评测 runner 在 `runEngine` 之上有一层 (task,cell) 调度,但它**绝不自管真并发**——所有 live 态真 spawn 必经 17 的 `ConcurrencyGovernor`(进程级全局单例 + 每端点子池,17 §2 v2)。(task,cell) 并发只是**「提交意愿」**,真正能不能再 spawn 一路由 governor 裁决:

- **提交并发可高,真 spawn 受 governor 节流**:runner 可同时提交多个 (task,cell) run,但每个 run 内部的 adapter spawn(05/06)都先 `await governor.acquire({ endpoint, priority })`(17 §2.2)。governor 按 `EndpointKey`(wire_api+base_url_host)分池计数:`codex→mouubox` 占它的子池、`claude→anthropic` 占它的子池,互不挤占(17 P-7);全局 hardMax 兜 OS 总量。评测与正常 run **共享同一 governor 单例**(17 §9.3 多 run 共享),不另起池。
- **为什么不能自管「默认并发 2」(v1 的错)**:v1 §9.6 自报一个独立「默认并发 2」,但 (task,cell) 并发 × parallel 范式单轮 2 路 spawn × panel N 成员**三者相乘**,峰值轻易破 8(事实:8 并发即 429,2 安全,17 §2.1)。这层在 governor 视野之外 → 叠加突破上限直接吃 429。429 的代价不只是重试烧钱(17 P-3「宁可排队不可吃 429」),更会**污染被测 cell 的 wallClockMs 与 passVariance**(§4.5)——让「哪个范式快/稳」的结论失真。评测台是**唯一量化成本的工具**(§0.1),它自己吃 429 等于量纲被噪声毁掉。故 v2 删掉「默认并发 2」,改为「提交意愿 + governor 节流」。
- **CI 守卫覆盖 `@sylux/eval`**:17 §2.1 / P8 的「spawn 必经 governor.acquire」静态检查**明确含本包**(17 §9.4 已声明)。任何评测代码路径绕过 governor 直 spawn 都是 bug。
- **replay 态不受此限**:`mode==='replay'` 无真 spawn(ReplayAdapter 从文件吐事件),IO-bound,可高并发,不取 governor 许可(17 §9.4 同此结论)。这是 v1 §9.6「replay 态可高并发」唯一正确的半句,保留。
- **失败隔离**:单个 run 崩溃(spawn 失败 / jsonl 残缺 / `acquire` 超时 `CONCURRENCY_ACQUIRE_TIMEOUT`)→ 该 `RunScore.evaluated=false` + error,**不**拖垮整个矩阵(EV1 评测是外层包裹,逐 run try/catch + 释放已持 permit)。
- **隔离**:每个 run 有独立 `repoRoot`(临时目录复制)与独立 worktree(09),互不干扰。
- **清理**:每个 run 结束后清临时 repoRoot 与 worktree(保留 jsonl 与录制),并确保 `permit.release()` 已调(`[Symbol.dispose]`,17 §2.2)。评测台不留垃圾、不泄漏 permit(对齐 verification 纪律)。

> **EQ2 实测口径修正**:§15 EQ2 原是「验 live 态两 worker 并发是否被中转限流」(把裸并发 2 当变量);v2 改为**「验接了 governor 后 live 评测不吃 429」**——根因(没接全局 governor)已在本节点出,实测要确认的是 governor 的每端点子池在评测跑批下确实把峰值压在安全线内。

---
## 10. 报告产出格式

### 10.1 两种产物:机器可读 json + 人类可读 markdown

| 产物 | 用途 | 落点 |
|---|---|---|
| `eval-report.json` | CI 回归对比、面板渲染(08/10)、机器 diff | `eval-runs/<evalRunId>/report.json` |
| `eval-report.md` | 人读 / PR 附录 / 决策 | `eval-runs/<evalRunId>/report.md` |
| `runs/*.jsonl` | 原始权威源(每 run 一份,02 §7) | 保留供下钻/重打分 |
| `recordings/**` | 回放源(live 态新增) | §7.1 |

两者**同源**:都从 `CellScore[]` + `AbReport` 渲染,markdown 是 json 的人类视图,数字逐字段一致(单一事实源)。

### 10.2 EvalReport 顶层 schema

```ts
export const evalReportSchema = z.object({
  evalSchemaVersion: z.literal(EVAL_SCHEMA_VERSION).default(EVAL_SCHEMA_VERSION),
  boardSchemaVersion: z.number().int(),       // 02 SCHEMA_VERSION(口径标识)
  evalRunId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  mode: z.enum(['replay', 'live']),
  inputFingerprint: z.object({                // §9.4
    taskSetHash: z.string(), matrixHash: z.string(), recordingsHash: z.string(),
  }),
  engineCommit: z.string().optional(),        // 回放态:引擎 git commit(REPLAY_DESYNC 溯源)
  cellScores: z.array(cellScoreSchema),
  abReports: z.array(abReportSchema).default([]),
  /** 跳过/失败的 cell(provider 不可达/录制过期/repoFixture 缺失,§9.2/§9.5)。 */
  skipped: z.array(z.object({ cellId: z.string(), taskId: z.string().optional(), reason: z.string() })).default([]),
  /** 弱核验旁列:weakVerification PASS 单列,不计主 taskPassRate(EV6 反作弊,§4.6)。 */
  weakVerificationNote: z.string().default(''),
  /** 成本计量失效汇总(ROC-M1):有 cell costReliable=false 时,头部红字标「N 个 cell 成本不可信,费用对比已禁用」。 */
  costReliabilityNote: z.string().default(''),
});
export type EvalReport = z.infer<typeof evalReportSchema>;
```

### 10.3 markdown 报告骨架(人类视图)

```
# Eval Report <evalRunId>  (mode: replay | live)

## 输入指纹
taskSetHash / matrixHash / recordingsHash / EVAL_SCHEMA_VERSION / boardSchemaVersion / engineCommit

## 排行榜(按 §4.6 字典序)
| cell | playbook | providers | taskPassRate(强核验) | (弱核验旁列) | defectRecall | tokenPerPass | avgRounds | passVar | cost? |
> cost? 列:✓=costReliable,⚠=usage 缺失成本不可信(该行 tokenPerPass/费用不参与排序与 A/B,ROC-M1)

## A/B 对比(每对一节)
baseline vs candidate · fair? · 公平性 issues
| metric | baseline | candidate | delta(正=B更优) | relative% | significance |
逐任务胜负表 + verdict 一句话

## 成本曲线
每 cell 的 perRoundInputTokens 折线(事实地基 D 累积/超线性可视化);costReliable=false 的 cell 折线标灰 + 「计量失效」

## 计量与覆盖告警(头部红字)
weakVerificationNote(EV6)+ costReliabilityNote(ROC-M1:N 个 cell 成本不可信,费用对比已禁用)

## 跳过与待重录
skipped[] + recordingStale[] 清单(§9.5)

## 下钻
每任务每 cell 的 assertionResults(失败断言 detail,已 redact)
```

### 10.4 落盘脱敏 + 面板渲染消毒(EV2 / 08 / 10)

**两道独立的处理,缺一不可——redact 抹的是 secret,escape 防的是 XSS,二者正交(吃掉 red-security RS-B2)**:

1. **落盘脱敏(08 redact)**:报告落盘前过内容防火墙的 redact 管线(08):`assertionResults[].detail`(命令 stdout 可能含路径/token)、`fairnessIssues`、`verdict` 全部 redact;`cmd` 字段按 08 的命令行 redact(去 key/base64)。锚点(path+hash)保留(可回放,非密)。**报告里永不出现 provider key/base_url 真值**——只出现 cell 的 provider candidate **名**(07 K1:配置只存引用名)。
2. **面板渲染消毒(10 XSS,RS-B2)**:`eval-report.json` 里所有**源自 agent 产出**的自由文本——`assertionResults[].detail`(含命令 stdout、agent 写的文件名/路径)、`verdict`、`perTaskOutcome[].note`、`weakVerificationNote`——在面板(10)渲染前**必须经 10 的 XSS 消毒**(DOMPurify 白名单 + strict CSP `script-src 'self'`,禁 raw HTML / `javascript:` / `data:` 链接)。**redact ≠ escape**:redact 只抹密钥,不转义 `<script>`;一个被注入的 agent 完全可以把脚本塞进 detail/文件名,经 redact 后明文仍是脚本,面板若直接 innerHTML 即 XSS,且面板持 control 权限可代发 abort/inject(RS-B2 威胁链)。评测台侧的纪律:report.ts 产出的 json 是**纯数据**,**绝不预渲染 HTML**;转义/消毒责任在面板(10),但本文件**显式声明此契约**,防止「评测 json 被当可信 HTML 直插」的误用。

> **为什么评测台要管这条**:评测报告是 agent 产出经多层聚合后的「看似可信的结构化数字」,最容易让人放松警惕直接渲染。但 `detail` 里嵌着 agent 原始 stdout、`note` 里可能复述 agent 的话——它们和黑板 `body` 同属**不可信的 agent 来源文本**(02 边界),渲染纪律必须一致。本条与 10 安全章节的 T16(server→client 内容 XSS)对账;评测 json 进面板走与黑板消息**同一条**消毒管线,不开后门。

---

## 11. 统一导出(index.ts)

```ts
// 任务与矩阵
export { evalTaskSchema, evalTaskSetSchema, assertionSchema, evalCellSchema, evalMatrixSchema, deriveCellId } from './...';
export type { EvalTask, EvalTaskSet, Assertion, EvalCell, EvalMatrix } from './...';
// 打分
export { qualityScoreSchema, costScoreSchema, runScoreSchema, cellScoreSchema, assertionResultSchema } from './score.schema.js';
export type { QualityScore, CostScore, RunScore, CellScore, AssertionResult } from './score.schema.js';
// 指标算法
export { scoreQuality, countRedTeamFindings, defectRecall } from './metrics/quality.js';
export { scoreCost, estimateCost, estimateRunTokens, estimateMatrixTokens, continuityRegimeOf, panelFanoutFactor } from './metrics/cost.js';
// 回放
export { recordedEventSchema, ReplayAdapter } from './replay/...';
export type { RecordedEvent } from './replay/record.js';
// A/B + 报告 + runner
export { checkFairness, abReportSchema } from './ab.js';
export { evalReportSchema } from './report.js';
export { runEval } from './runner.js';
export { EVAL_SCHEMA_VERSION } from './version.js';
export { EvalReplayError } from './errors.js';
```

> 评测专属错误码**不进** 02 §12 `SyluxErrorCode`(那是运行期黑板契约,评测不污染)。`EvalReplayError` 独立:`REPLAY_DESYNC` / `REPLAY_EXHAUSTED` / `RECORDING_STALE` / `EVAL_BUDGET_EXCEEDED` / `EVAL_CONFIG_INVALID`。运行期错误(02 §12)被评测台**作为数据消费**(进 `QualityScore.terminalStatus` / `invalidUtterances`),不重新定义。

---

## 12. 失败路径汇总

| 失败 | 触发点 | runner 动作 | 标记 |
|---|---|---|---|
| 矩阵/任务 zod 解析失败 | load(§9.2) | 拒启动,指字段路径 | `EVAL_CONFIG_INVALID` |
| 预算超 guard | estimateMatrixTokens(§6.4) | 拒启动,打印估算,需 --force | `EVAL_BUDGET_EXCEEDED` |
| replay 调用序漂移 | ReplayAdapter(§7.3) | 该 cell 不打分,列待重录 | `REPLAY_DESYNC` |
| 录制缺失/版本不符 | load replay(§9.5) | 该 cell 跳过 + 告警 | `RECORDING_STALE` |
| provider 不可达 | live 预检(§3.4) | 该 cell skipped,继续其余 | skipped |
| 单 run 崩溃(spawn/jsonl 残) | run 执行(§9.6) | RunScore.evaluated=false,继续 | run-level error |
| governor 取许可超时 | live spawn(§9.6) | 该 run evaluated=false,释放已持 permit | `CONCURRENCY_ACQUIRE_TIMEOUT`(17) |
| usage 缺失/字段漂移 | scoreCost(§6.1) | 该 run costReliable=false,estimatedCostUsd=null,成本不进 A/B | run 仍 evaluated=true(质量有效) |
| repoFixture 缺失/非 git | prepareRepo(§9.2) | 该任务全 cell evaluated=false | run-level error |
| 断言命令超时 | verifyAssertion(§5.1) | 该断言 passed=false + detail | 断言级 |

> **不静默吞错(对齐 03 E7)**:评测台所有失败都显式落进报告的 `skipped`/`evaluated=false`/待重录清单,绝不让一个崩溃的 run 悄悄从分母消失(那会虚高通过率)。报告头部汇总「N 个 run 中 M 个未评测」,读者一眼看到覆盖缺口。

---

## 13. 评测台测试矩阵(交付验收锚点)

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| E1 | EvalTask 解析 | 合法 task json | safeParse 成功 |
| E2 | assertion 缺核验锚点 | produced-only 任务达 passThreshold | `weakVerification=true` |
| E3 | command 断言通过 | 测试转绿的 worktree | assertionResult.passed=true |
| E4 | file_ref hash 跨平台 | CRLF vs LF 同内容 | hash 一致(02 §9.1 normalizeContent) |
| E5 | 红队有效发现 | critique 带核验通过+新指纹 | findings+1 |
| E6 | 红队空泛批判 | critique 无核验 evidence | findings 不增(EV6) |
| E7 | 红队复读旧论点 | critique 证据指纹与前轮重复 | findings 不增(差集空) |
| E8 | defectRecall | critic 命中 2/3 已知缺陷 | recall=0.667 |
| E9 | 成本聚合 | board.totalUsage 已知 | CostScore 各字段 == usage(EV5) |
| E10 | tokenPerPass 零 PASS | 全任务 FAIL | tokenPerPass=null |
| E11 | 累积预算估算 resume | maxRounds=8 | ≈ base×36(事实地基 D 超线性) |
| E12 | ReplayAdapter 顺序 | 录制 send→resume | 引擎照序拿到事件 |
| E13 | REPLAY_DESYNC | 录制 send 实调 resume | 抛 REPLAY_DESYNC 硬停 |
| E14 | replay repeats>1 | matrix.mode=replay,repeats=3 | EVAL_CONFIG_INVALID(§7.4) |
| E15 | 公平性 F1 不同 taskset | A/B 不同 task set | fair=false |
| E16 | 公平性 F4 多维变化 | cell 同时换 playbook+provider | fair=true(放宽)+verdict 注明(§8.3.1) |
| E17 | 公平性 F5 覆盖不一致 | parallel 剪掉 design-review | 取交集任务重算(§8.3.1) |
| E18 | 显著性 n/a | replay 模式 A/B | significance='n/a' |
| E19 | 输入指纹稳定 | 同 taskSet/matrix 两次 | fingerprint 三段全等(EV8) |
| E20 | 报告脱敏 | detail 含 key/base_url | 落盘行无明文(§10.4) |
| E21 | run 崩溃不污染 | 1/5 run jsonl 残 | 该 run evaluated=false,余 4 正常 |
| E22 | 弱核验不计主排序 | weakVerification PASS | taskPassRate 主值不含它(§4.6) |
| E23 | usage 缺失成本失明 | 某轮 usageMissing=true | costReliable=false,estimatedCostUsd=null(ROC-M1) |
| E24 | 成本不可信不参与 A/B | 一方 costReliable=false 比 tokenPerPass | fair=false + F6 issue(§8.3) |
| E25 | 红队发现仅强核验 | critique 仅 medium evidence | findings 不增(对齐 02 v2,§5.2) |
| E26 | master-worker 混合估算 | playbook=master-worker | estimateRunTokens 走 mixed 档,非纯 stateless/resume(§6.4.1) |
| E27 | panel 扇出估算 | cell 启用 5 成员 panel | estimateRunTokens ≈ 单 agent × fanout(N+judge,§6.4.2) |
| E28 | 真 spawn 经 governor | live 矩阵跑批 | 每 spawn 过 governor.acquire,峰值不破端点子池上限(ROC-M3,§9.6) |
| E29 | replay 不取 governor 许可 | replay 矩阵高并发 | 不调 acquire,IO-bound 并发(§9.6) |
| E30 | 报告进面板消毒 | detail 含 `<script>` | 面板渲染前经 10 消毒,不执行(RS-B2,§10.4) |

---

## 14. 与下游/上游文档的接口边界

| 文档 | 评测台依赖其提供 | 评测台提供给它 |
|---|---|---|
| 02 黑板 | Message/Evidence/Round/BoardState/TokenUsage/JsonlRecord、verifyEvidence、fingerprint、contentHash | 无(只读消费) |
| 03 引擎 | runEngine、Playbook/PlaybookParams、AgentEvent、EngineDeps(注入 ReplayAdapter) | 无(EV1 不改引擎) |
| 05 适配层 | AgentAdapter/AgentInput 接口(ReplayAdapter 实现它) | ReplayAdapter 作为测试/评测替身 |
| 06 claude 适配 | claude 端 AgentAdapter 实现(live 态录制源) | 无 |
| 07 provider | ProviderSettings、provider candidate id、单价表(pricing) | 无 |
| 08 安全 | redact 管线(报告落盘)、路径白名单 | 无 |
| 09 worktree | 合并后 worktree 句柄(断言核验环境) | 无 |
| 10 面板 | XSS 消毒/CSP 管线(报告渲染前过它,RS-B2) | EvalReport.json(面板渲染排行榜/成本曲线) |
| 11 WS | 无 | EvalReport 推送(可选实时进度) |
| 14 测试 | 录制 fixtures 字节纪律、fake-CLI、execa-mock | recordings/(可与 fixtures/ 互借真实录制) |
| 16 配置 | SyluxConfig 组装、RunConfig、fixedRunId | 无(buildSyluxConfig 复用其装配) |
| 17 性能 | ConcurrencyGovernor(全局单例 + 每端点子池)、EndpointKey | 真 spawn 经 governor.acquire(ROC-M3);CI 守卫覆盖本包 |
| 21 Fusion | PanelProviderConfig/enabledKinds(panel 扇出系数输入,§6.4.2) | 无 |

---

## 15. 待实测项(M2 验证锚点)

| # | 项 | 影响 | 验证方式 |
|---|---|---|---|
| EQ1 | 中转(mouubox)真实计费口径 vs 官方单价表偏差 | estimatedCostUsd 准确性(§6.2) | 跑已知 token 量对账单 |
| EQ2 | 接了 17 governor 后 live 评测是否仍吃 429(承接 03 Q3;根因已接 governor,验残余风险) | runner 真并发安全(§9.6) | 接 governor 跑 parallel/panel cell 看 429 率应趋零 |
| EQ3 | 真 CLI 重复 N 次的 passed 方差有多大(决定 repeats 默认值) | passVariance / 显著性样本量(§8.4) | 同 cell 同任务跑 10 次统计 |
| EQ4 | adversarial 任务的 knownDefects 锚点稳定性(代码微变后行号漂移) | defectRecall 精度(§5.3.1) | 构造缺陷+轻微重构看命中 |
| EQ5 | 录制随引擎迭代的过期速率 + 摊销成本模型(评测台真实成本 = replay×0 + 重录×全矩阵 live,ROC-m5) | 回放维护成本/「零成本」是否被高估(§6.4 注/§9.5) | 跨引擎版本回放看 REPLAY_DESYNC 率 × 重录 live 成本 |
| EQ6 | stateless+digest 与 resume 的质量差距(承接 03 Q4)能否被任务断言量化 | continuity A/B 的可信度(§8) | 同任务两 continuity cell 跑断言对比 |

> 评测台其余结论由事实地基(02/03/PROBED-FACTS)覆盖,不再标【待实测】。EQ1–EQ6 是需 M2 闭环的评测专属实测点。

