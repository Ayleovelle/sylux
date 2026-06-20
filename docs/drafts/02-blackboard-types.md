# 02 · 黑板协议与消息契约(全项目唯一权威类型源)v2.1

> **版本**:v2.1(2026-06-20)。v2→v2.1 吃掉第二批交叉/红队 findings(A1/COV-1 错误码全集、D5 status code、D6 validate 签名桥接、COV-3 复跑基础设施故障分级、FEAS-2 M1 无文件系统降级、B1 MAX_JSONL_LINE_BYTES 权威重申、RS-B2 面板 XSS 不可信串、ROC-M1 usage output 缺失),见 §0.4 表 H9–H15。v1→v2 硬化点见同表 H1–H8。本文件吃掉的红队/交叉 findings 主线:R1(权威漂移)、R5(收敛锚点)、R8(安全)+ 跨稿一致性核对。
>
> **本文件地位**:这是 sylux 全项目类型契约的**唯一权威来源**。`Message` / `Evidence` / `Round` / `BoardState` / `AgentEvent` 以及它们涉及的所有枚举,只在本文件定义,物理落在 `@sylux/shared/src/blackboard.schema.ts`。
>
> **引用而非另写**:其他所有设计文档(技术栈、引擎、适配层、刹车、面板、安全等)涉及上述类型时,一律以路径 `@sylux/shared/src/blackboard.schema.ts` 引用本文件的定义,**禁止在任何地方另写一份**。任何跨文档的字段漂移,以本文件为准。这条规则焊死红队 blocker R1(“Message 权威定义缺失导致跨稿漂移”)。
>
> **与总体规划 §2 的关系(v2 修正,焊死 R1)**:`docs/sylux-master-plan.md` §2 是本契约早期的“摘要镜像”。v1 曾声称二者“逐字节兼容”——这是**不准确的**:本文件已对 §2 做了多处收紧与扩字段(见 §15 完整对账台账)。v2 起明确:**本文件是唯一权威,§2 已被本文件取代(superseded)**;凡 §2 与本文件不一致,一律以本文件为准,并按 §15 台账逐条回填 §2。实现者**只读本文件**,不要照 §2 的 zod 片段写代码。
>
> **事实标注约定**:凡基于假设而非本机实测的结论,显式标注【待实测】。

### 0.4 v2 相对 v1 的硬化点(变更摘要)

| # | 主题 | v1 问题 | v2 修正 | 章节 |
|---|---|---|---|---|
| H1 | `file_ref.contentHash` 喂活锁 | 强制 agent 产出 `contentHash`,但 CLI 无法复现 `normalizeContent`+sha256-16 → 每条 file_ref 必失配 → critic 永远过不了 C1 | `contentHash` 改为**中枢派生权威**(agent 可不填);agent 改提供可选 `quote`(断言文本),核验=中枢重读区间归一化后比对 | §3、§9 |
| H2 | `command` 证据自证 | 默认不复跑时,`expected`/`actual` 全由 agent 自填 → 自洽校验形同虚设,critic 可凭空过 C1 | 未实跑的 command 证据降级为 `weak`(等同 spec_quote),**不**解锁 C1;仅当中枢实跑复算通过才算强 | §3.2、§8.3 |
| H3 | command 复跑安全 | `ctx.runCommand(e.cmd)` 直接跑 agent 自供命令 | 复跑必须在 agent worktree 沙箱内、`workspace-write` 封顶、断网、env 白名单、超时;违规 `EVIDENCE_COMMAND_UNSAFE`(R8) | §8.1 |
| H4 | 无资源上限(DoS) | `body`/`evidence`/`files` 无长度与条数上限 → 失控 agent 可发 100MB 正文撑爆内存/WS/jsonl | 全字段加 `.max()`,jsonl 行有硬上限,超限 `MESSAGE_SIZE_EXCEEDED`(R8/ops) | §5、§5.3 |
| H5 | 回放排序不确定 | 并行范式同轮多条 message 的 `ts`(ms 粒度)可能相等,无 tie-break → 回放顺序非确定 | 新增 `seq`(中枢单调序号,权威排序键);`ts` 降为墙钟旁注 | §5、§10 |
| H6 | usage 缺失被当 0 | claude 端某些情形无 usage → 刹车按 0 计 → 低估成本超支 | 缺失 usage 按事实地基 D 基线(≈18.7k)保守上界估,绝不计 0 | §6.3、§10 |
| H7 | 结构化输出兼容 | discriminatedUnion + optional 字段在严格 structured-output 后端(必须 required + additionalProperties:false + 不支持 anyOf)可能被拒 | 加【待实测】+ 摊平退化方案(union 降为单对象 + kind 枚举,应用层补判) | §6.2 |
| H8 | §2 对账缺口 | v1 §14 只回填 2 类差异 | §15 给完整对账台账(全部字段级差异 + 回填项) | §15 |
| H9 | 错误码 union 残缺(A1/COV-1,blocker) | §12 `SyluxErrorCode` 仅 16 项,下游 01/03/04/05/08/09/11/15/21 用了 20+ 个未登记的码 → `SyluxError` 与 15(评测)`Record` 穷举编译红 | §12 补全为分域全集(契约 / 子进程 / 引擎 / 安全 / WS / worktree / fusion / provider),本文件“拥有契约项”,其余“登记但归属注明” | §12、§15.4 |
| H10 | `status_changed` 缺 `code`(D5) | §7.1 只有 `reason?`,04 调 `setStatus(status, code, reason)` 三参、需机读终态原因 | jsonl `status_changed` 加 `code?: SyluxErrorCode`;`reason` 降为人读旁注 | §7.1、§10.2 |
| H11 | validate 签名跨稿不对称(D6) | 03 `EngineDeps.validate(msg: AppendInput, round)` 与本文件 `validateMessage(msg: Message, ctx)` 入参类型/语义不同 | §8.1 加“适配器桥接”:03 侧传瘦 payload + round,中枢盖章成 `Message` 后才调本函数;两者不是同一函数 | §8.1 |
| H12 | 复跑基础设施故障未分类(COV-3) | §8 只分“命令不安全 / 复算不符”,未分“复跑器 / 沙箱自身崩(中枢侧故障)” | `verifyEvidence` 对沙箱内部故障返回 `weak` + 记 `system`,**不连坐 critic**、不计“无效发言”、不进 stall 计数 | §8.1、§8.3 |
| H13 | M1 无文件系统时强核验假绿(FEAS-2) | M1 红蓝纯决策不写文件、无 worktree,但 C1 要 `file_ref`+`quote` 强核验 → 无可读区间 | §8.1 定义 `ValidateContext.capabilities`;无 `readFileRange` 时 `file_ref` 一律 `weak`,critic 只能靠 `spec_quote`/`command`,C1 在 M1 用 playbook 级 evidence 策略放宽(归引擎 03/裁剪 25) | §8.1、§8.5 |
| H14 | 面板 XSS:body/quote/path 是 agent 可控不可信串(RS-B2) | 这些字段进面板 DOM,redact 只抹 secret 不转义 `<script>` | §5 标注全部 agent 可控字符串为**不可信**,面板 08/10 渲染前必须 escape/CSP(归属注明,本文件只打标) | §5.4 |
| H15 | usage output 缺失被当 0 低估成本(ROC-M1) | H6 只说 input 按基线兜底,未明确 output 缺失语义 → maxCostUsd 用 output=0 算,挡不住真实超支 | §6.3 明确:usage 整体或 output 缺失时,output 也按 regime 保守上界估(非 0),`degradable` 漂移只 warn 但成本仍按上界算 | §6.3、§10 |

---

## 0. 设计目标与不变量

### 0.1 一份 schema,三个职责(三位一体)

本契约用**同一套 zod schema** 同时承担三件事,正中项目“输出对齐”难点:

| 职责 | 用法 | 服务对象 |
|---|---|---|
| ① 编译期类型 | `z.infer<typeof messageSchema>` 导出 `Message` 等 TS 类型 | 全项目所有包 |
| ② 运行期校验 | `schema.safeParse(json)` 校验子进程返回的 JSON | 适配层 `@sylux/agents`(边界守门) |
| ③ JSON Schema 产物 | `zod-to-json-schema` 生成 `.json` 文件/串,喂 codex `--output-schema` / claude `--json-schema` | 适配层强制 CLI 输出成形 |

因此:**改契约 = 改这一个文件**,三处自动同步,不存在“类型定义对、运行期校验漏、CLI schema 又是另一份”的三套漂移。

### 0.2 本文件负责 / 不负责的边界

| 负责(本文件给完整 zod + 语义 + 校验规则) | 不负责(只引用,定义在别处) |
|---|---|
| `Message` 黑板消息 | engine 循环逻辑(引擎文档 03) |
| `Evidence`(discriminatedUnion) | `Playbook` / `TurnSpec` 接口(引擎文档 03) |
| `FilePatch` 文件改动声明 | `AgentAdapter` 接口(适配层文档 04) |
| `Round` / `BoardState` | provider 配置(provider 文档 05) |
| `AgentEvent` 适配层事件流 | worktree 合并算法(worktree 文档 06) |
| 各基础枚举(role/kind/agentId/...) | 刹车阈值与算法(刹车文档 07,但**指纹函数签名在本文件给**) |
| 错误码常量中“契约校验”相关项 | WS 传输协议(面板文档 08) |
| jsonl 持久化“行格式” | 日志/脱敏管道(安全文档 09) |

> 说明:`Blackboard` / `ContextBundle` 这两个**接口**(行为契约)由引擎文档 03 拥有;本文件只拥有它们读写的**数据类型**(`Message`/`Round`/`BoardState`)。指纹函数 `fingerprint(e: EvidenceItem)` 的实现归刹车文档 07,但其**签名与归一化规则**因为强耦合 `EvidenceItem` 结构,在本文件 §9 给出权威定义,07 引用。

### 0.3 类型层不变量(实现必须保持)

- **I1 单一权威**:`Message` 类型有且只有一处 `z.object` 定义,即本文件。grep `from:.*agentIdSchema` 全仓应只命中一处。
- **I2 未校验不入引擎**:任何来自子进程 stdout 的 JSON,必须先过 `messageSchema.safeParse`,失败即 `OUTPUT_SCHEMA_VIOLATION`,绝不把未校验对象传入 engine(对应总体规划 §11.3)。
- **I3 evidence 可机器核验**:`evidence` 永远是结构化数组,不是自由字符串;critic/critique/ack 的 evidence 必须**非空且锚点可被中枢复算核验**(§2、§8)。核验的“强度”不取决于 agent 自报,只取决于中枢能否独立复算(§3.2)。
- **I4 schema 自带版本**:每条持久化记录带 `schemaVersion`,契约演进时可识别旧数据(§7)。`schemaVersion` 只挂在**持久化行(jsonlRecord)**层,内存态 `Message` 不带(§5 修正,避免双处版本戳漂移)。
- **I5 事件流首事件恒为 session_started**:`AgentEvent` 流的第一类事件必为 `{kind:'session_started', sessionId}`,拿到前不得标记 agent 可 resume(对应红队 R3)。唯一例外:首事件即 `error`(spawn 失败,§6.3)。
- **I6 排序权威是 seq 不是 ts**(v2 新增,H5):黑板内一切排序、回放、收敛差集均以中枢盖的单调 `seq` 为准;`ts`(墙钟 ms)仅供人读,**禁止**用于排序或相等判定(并行范式同轮多条 `ts` 可能相等)。
- **I7 派生字段中枢盖章**(v2 新增,H1):`id/runId/round/from/role/ts/seq/contentHash` 全由中枢在 `append`/核验阶段盖,agent 产出的瘦子集(§6.1)**不含**这些;agent 自填的派生字段一律被中枢覆盖,不信任。
- **I8 单写者串行 append**(v2 新增):同一 run 的 `append` 必经中枢单事件循环串行执行,保证 `seq` 单调无洞、jsonl 行不交错。并行范式下多 agent 并发产出,但**写黑板这一步串行**(对应锁定决策 R7:运行期各写各 worktree 无锁,落黑板串行)。

---

## 1. 物理落点与版本常量

### 1.1 文件布局(`@sylux/shared`)

```
packages/shared/
├─ package.json            # name: "@sylux/shared",仅依赖 zod + zod-to-json-schema
├─ src/
│  ├─ index.ts             # 统一 re-export(见 §11)
│  ├─ blackboard.schema.ts # ★ 本文件定义的全部 zod schema + 推导类型(唯一权威)
│  ├─ validate.ts          # validateMessage(msg, ctx):跨字段 + 可核验性校验(§8)
│  ├─ fingerprint.ts       # evidence 指纹(签名见 §9,实现服务于刹车 07)
│  ├─ jsonl.ts             # 持久化行的 encode/decode + 版本迁移(§7)
│  └─ errors.ts            # SyluxErrorCode(契约相关项,§12)
└─ ...
```

> `@sylux/shared` 是依赖图的最底层(总体规划 §10:`shared ← core ← {providers, agents} ← server ← web`),**只能依赖 zod 系**,不得反向依赖任何 sylux 内部包,避免环。

### 1.2 schema 版本常量

```ts
/** 契约 schema 版本。任何对持久化字段的破坏性变更必须 +1,并在 jsonl.ts 加迁移分支(§7.4)。 */
export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;
```

破坏性变更的判定:删字段、改字段类型、改枚举字面量含义、改 `contentHash` 算法、改 jsonl 行结构。新增**可选**字段或新增枚举成员(向后兼容读)不强制 +1,但建议在 CHANGELOG 标注。

### 1.3 公共导入约定

本文件所有 schema 假定文件头有:

```ts
import { z } from 'zod';
```

下文各代码块为节省篇幅省略该行,实现时统一置于 `blackboard.schema.ts` 顶部。

---

## 2. 基础枚举(role / kind / agentId)

三个枚举是 `Message` 的判别字段,决定“谁、扮谁、说哪类话”。**角色与模型解耦**:`from`(物理发言主体)与 `role`(本条扮演角色)正交,任意 agent 可被指派任意角色(对应锁定决策 §3)。

```ts
/** 角色:与模型解耦,playbook 指派,同一 agent 不同轮可换角色 */
export const roleSchema = z.enum([
  'planner',    // 规划者(主从范式的“主”)
  'worker',     // 执行者(主从范式的“从”)
  'proposer',   // 提案者(红蓝 / 结对)
  'critic',     // 批判者(红队角色,evidence 强制可核验)
  'peer',       // 对等结对
  'arbiter',    // 裁判(可选,通常由中枢承担;人工介入时为人)
]);
export type Role = z.infer<typeof roleSchema>;

/** 消息类型:决定黑板流转语义 */
export const messageKindSchema = z.enum([
  'propose',     // 提出方案 / 代码改动意图
  'critique',    // 批判(必须带可核验 evidence)
  'plan',        // 规划(任务拆解)
  'implement',   // 实现(产出 diff,落 files)
  'review',      // 评审
  'ack',         // 认可对面(done 流程需对面带证据 ack)
  'question',    // 提问 / 澄清
  'done',        // 自认完成(需对面 ack 才真停)
  'system',      // 中枢系统消息(刹车触发、合并冲突回灌等)
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

/** 发言主体(物理进程身份) */
export const agentIdSchema = z.enum(['codex', 'claude', 'human', 'orchestrator']);
export type AgentId = z.infer<typeof agentIdSchema>;
```

### 2.1 枚举命名对照(任务简报 ↔ 权威枚举)

立项简报里用过一组简写(`proposal/patch/...`),为避免实现期歧义,固定如下映射,**实现一律用右列权威字面量**,左列仅作沟通别名:

| 简报别名 | 权威 `MessageKind` | 说明 |
|---|---|---|
| proposal | `propose` | 出方案 |
| patch | `implement` | 产出 diff(落 `files`) |
| critique | `critique` | 不变 |
| question | `question` | 不变 |
| done | `done` | 不变 |
| (无) | `plan` / `review` / `ack` / `system` | 主从拆解 / 评审 / 认可 / 系统 |

> `role` 与 `kind` 的关系:`role` 是“这一轮我是谁”,`kind` 是“这一条我在做什么”。约束只挂在二者的组合上(§5.2),不预设一一映射;例如 `role==='critic'` 既可发 `critique` 也可发 `question`,但只要 `role==='critic'` 或 `kind==='critique'` 命中,evidence 即强制。

---

## 3. Evidence —— 焊死“唱反调”的核心

红队 R5/blocker 结论:`evidence` 若是自由字符串,critic 填 `"代码有问题"` 即可绕过“非空”校验,既达不到“不准空夸”,也无法支撑收敛检测的“新 evidence 差集”判定。因此 `evidence` **必须是结构化、带可机器核验锚点的数组**,三种锚点用 `discriminatedUnion('kind')` 区分。

### 3.0 v2 核心修正:核验强度只看中枢能否独立复算(H1/H2)

v1 有两个致命漏洞,v2 焊死:

- **H1(file_ref 活锁)**:v1 强制 agent 产出 `contentHash`,中枢拿 `normalizeContent`+sha256-16 复算比对。但 agent 是 CLI,**无法复现**中枢的归一化与哈希算法(它不知道我们截 16 hex、不知道我们去尾空白),于是几乎每条 `file_ref` 都失配 → critic 永远过不了 C1 → “唱反调”机制整体瘫痪。**修正**:`contentHash` 不再由 agent 提供,改为**中枢核验时派生并回填**的权威字段;agent 只需提供 `path` + 行区间 + 可选 `quote`(它断言该区间“长这样”的原文)。核验语义 = 中枢重读区间、与 `quote` 双向归一化后比对(无 `quote` 时仅校验区间存在 + 派生 hash 入指纹)。
- **H2(command 自证)**:v1 默认不复跑时,`expected` 与 `actual` 全由 agent 自填,“自洽校验”等于让 agent 自己判自己对——critic 凭空写一对自洽串即可过 C1。**修正**:未被中枢实跑的 command 证据强度为 `weak`(等同 spec_quote),**不解锁** C1;只有中枢实跑复算通过的 command 才是强证据。

> 一句话原则(I3):**证据强度由“中枢能否独立复算”决定,与 agent 自报无关。** agent 说什么都不算数,中枢复算通过才算数。

```ts
/** 单条证据:必须带可被中枢机器核验的锚点。判别键为 kind。 */
export const evidenceItemSchema = z.discriminatedUnion('kind', [
  // ① 代码锚点:指向 worktree 内某文件的行区间。
  //    contentHash 是中枢派生权威(核验时回填),agent 不必/不应自算(H1)。
  z.object({
    kind: z.literal('file_ref'),
    path: z.string().min(1).max(1024),       // 相对本 agent worktree 根;禁 `..` / 越界绝对路径(§8.3)
    lineStart: z.number().int().positive(),  // 1-based,含
    lineEnd: z.number().int().positive(),    // 1-based,含;约束 lineEnd>=lineStart(§5.2)
    /** agent 断言该区间的原文(可选)。核验=中枢重读区间,双向归一化后比对。
     *  省略则只校验区间存在 + 由中枢派生 contentHash 入指纹(强度降为“仅定位”)。 */
    quote: z.string().max(8192).optional(),
    /** 中枢核验时派生回填的归一化内容 hash(§9)。agent 提交时通常缺省;
     *  若 agent 填了,中枢一律以自己复算值覆盖(I7),不信任 agent 值。 */
    contentHash: z.string().max(64).optional(),
    note: z.string().max(2048).optional(),   // 人类可读旁注(不参与核验)
  }),
  // ② 命令证据:可复现命令 + 期望/实际输出。
  //    未被中枢实跑前,actual 只是 agent 自报,强度=weak(H2)。
  z.object({
    kind: z.literal('command'),
    cmd: z.string().min(1).max(4096),        // 可复现命令(只在 agent worktree 沙箱内复跑,§8.1)
    expected: z.string().max(8192),          // 期望输出(子串 / 全等 / 正则,见 matchMode)
    actual: z.string().max(8192),            // agent 声称的实际输出(自报,不可单独取信)
    matchMode: z.enum(['equals', 'contains', 'regex']).default('contains'),
    exitCode: z.number().int().optional(),   // 期望退出码(可选)
  }),
  // ③ 规范引用:指向需求 / 规格来源的引文(用于“偏离规范”类批判)
  z.object({
    kind: z.literal('spec_quote'),
    source: z.string().min(1).max(1024),     // 规范 / 需求来源标识(文件名、URL、文档 §号)
    quote: z.string().min(1).max(8192),      // 原文引文
    locator: z.string().max(256).optional(), // 定位符(行号、章节、锚点)
  }),
]);
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
```

### 3.1 Evidence 字段语义

| 锚点 | 字段 | 语义 | 中枢核验方式 |
|---|---|---|---|
| `file_ref` | `path` | worktree 内相对路径 | 路径白名单 + 文件存在 |
| | `lineStart/End` | 1-based 闭区间 | 区间在文件行数内 |
| | `quote`(可选) | agent 断言的区间原文 | 重读区间,双向 `normalizeContent` 后比对(§9) |
| | `contentHash`(中枢派生) | 区间内容归一化 hash | 中枢复算回填(I7),用于指纹差集;agent 填了也覆盖 |
| `command` | `cmd` | 可复现命令 | 仅在沙箱内可选复跑(§8.1);默认不跑 → weak |
| | `expected/actual` | 期望 / agent 自报实际 | `actual` 自报不取信;复跑后用真实 stdout 比对 |
| | `matchMode` | 比对模式 | equals/contains/regex |
| `spec_quote` | `source/quote` | 规范来源 + 引文 | 来源可达性(弱核验) |

### 3.2 可核验性分级(中枢侧,机器可判;v2 修正 H1/H2)

`evidence` 的“可核验”不是 schema 能表达的,需中枢上下文(worktree 句柄 + 文件系统 + 沙箱跑批)在 `validateMessage` 后的**核验阶段**判定。强度只取决于**中枢能否独立复算**(I3),与 agent 自报无关:

| 锚点 | 触发条件 | 核验强度 | 失败错误码 |
|---|---|---|---|
| `file_ref` + `quote` | 区间存在 + `quote` 与区间归一化后一致 | **强** | `EVIDENCE_UNVERIFIABLE` |
| `file_ref` 无 `quote` | 仅区间存在(无内容断言可比) | **仅定位(weak)** | — (不单独解锁 C1) |
| `command` 已实跑 | 中枢沙箱复跑,`matchMode` 下真实 stdout/exit 匹配 | **强** | `EVIDENCE_UNVERIFIABLE` / `EVIDENCE_COMMAND_UNSAFE` |
| `command` 未实跑 | 仅 agent 自报 `actual` | **weak**(H2:不取信自报) | — (不单独解锁 C1) |
| `spec_quote` | `source` 可达即可 | **weak** | 仅告警,不打回 |

> **强约束(v2 收紧)**:**critic / critique / ack 至少一条 evidence 必须达到“强”核验通过**。weak 级(无 quote 的 file_ref、未实跑的 command、spec_quote)**单独不足以**解除 evidence 要求——防止用“空泛引用规范”或“自报命令输出”绕过 critique 的证据门。这把 v1 的“强或中”收紧为“强”,堵死 H2 自证路径。

## 4. FilePatch —— 文件改动声明(files 字段)

`files` 声明的是 agent 本条消息**意图/已做**的文件改动,供两件事:① worktree 合并时的冲突预检(worktree 文档 06);② 面板 diff 渲染(面板文档 08)。**diff 正文不由 agent 自填**——由中枢从 worktree 实际 `git diff --find-renames` 生成,此处只声明意图,杜绝 agent 谎报 diff。

```ts
/** agent 声明的单个文件改动意图 / 结果 */
export const filePatchSchema = z.object({
  path: z.string().min(1).max(1024),                // 相对本 agent worktree 根;禁 `..` 与越界绝对路径(§8.3)
  changeKind: z.enum(['add', 'modify', 'delete', 'rename']),
  renamedFrom: z.string().max(1024).optional(),     // changeKind==='rename' 时必填(§5.2)
  isBinary: z.boolean().default(false),             // 二进制 / 超阈值 diff 在面板降级展示(§8 面板文档)
});
export type FilePatch = z.infer<typeof filePatchSchema>;
```

| 字段 | 语义 | 约束 |
|---|---|---|
| `path` | worktree 内相对路径 | 路径白名单(§8.3),`add` 外须已存在(核验阶段软校验) |
| `changeKind` | 改动类型 | rename 时 `renamedFrom` 必填 |
| `renamedFrom` | 重命名前路径 | 仅 rename;同样过路径白名单 |
| `isBinary` | 是否二进制 | true 时面板不渲染文本 diff |

---

## 5. Message —— 黑板消息(全文唯一定义)

这是全项目唯一的 `Message` `z.object`(不变量 I1)。其他文档涉及消息字段一律引用本节,**禁止另写**。

```ts
export const messageSchema = z.object({
  /** 全局唯一 id,nanoid() 生成 */
  id: z.string().min(1),
  /** 所属 run(一次 orchestrator 运行) */
  runId: z.string().min(1),
  /** 轮次,从 0 开始单调递增(同一轮可有多条) */
  round: z.number().int().nonnegative(),
  /**
   * 中枢单调序号(append 顺序权威排序键,I6/H5)。同 run 内严格 +1 无洞。
   * 一切排序 / 回放 / 收敛差集以此为准;ts 仅供人读。并行范式同轮多条靠 seq 区分。
   */
  seq: z.number().int().nonnegative(),
  /** 物理发言主体 */
  from: agentIdSchema,
  /** 本条消息发言时所扮演的角色(与 from 正交) */
  role: roleSchema,
  /** 消息类型,决定流转语义 */
  kind: messageKindSchema,
  /** 自然语言主体(喂给对面前会被防火墙包边界标记,§见安全文档 09)。上限防 DoS(H4) */
  body: z.string().max(65536),
  /** 本条涉及的文件改动声明。条数上限防 DoS(H4) */
  files: z.array(filePatchSchema).max(256).default([]),
  /**
   * 证据数组。约束(中枢强制,非仅 schema,见 §5.2 / §8):
   * - role==='critic' 或 kind==='critique':必须非空且至少一条强核验通过,否则打回
   * - kind==='ack' 认可对面 done:必须带可核验 evidence,防双方互相秒认 done
   * 条数上限防 DoS(H4)。
   */
  evidence: z.array(evidenceItemSchema).max(128).default([]),
  /** 服务端写入时间戳(epoch ms,中枢盖,agent 不可伪造)。墙钟旁注,禁用于排序(I6) */
  ts: z.number().int().nonnegative(),
  /** 可选:本条回应的上游消息 id(构造对话树 / 收敛锚点) */
  inReplyTo: z.string().min(1).optional(),
});
export type Message = z.infer<typeof messageSchema>;
```

### 5.1 Message 字段语义表

| 字段 | 类型 | 必填 | 谁来写 | 语义 |
|---|---|---|---|---|
| `id` | string | 是 | 中枢(append 时) | 全局唯一,nanoid |
| `runId` | string | 是 | 中枢 | 归属 run |
| `round` | int≥0 | 是 | 引擎 | 轮次,单调不减 |
| `seq` | int≥0 | 是 | 中枢 append | **排序权威**(I6),同 run 单调 +1 无洞 |
| `from` | AgentId | 是 | 适配层 | 物理主体 |
| `role` | Role | 是 | playbook 指派 | 本条扮演角色 |
| `kind` | MessageKind | 是 | agent 产出 | 消息语义类型 |
| `body` | string(≤64KiB) | 是 | agent | 自然语言正文 |
| `files` | FilePatch[](≤256) | 默认 `[]` | agent | 文件改动声明 |
| `evidence` | EvidenceItem[](≤128) | 默认 `[]` | agent | 结构化证据 |
| `ts` | int≥0 | 是 | 中枢 | 写入墙钟(ms),**禁排序用**(I6) |
| `inReplyTo` | string? | 否 | agent / 引擎 | 上游消息 id |

> **agent 实际产出的子集**:CLI 经 `--output-schema`/`--json-schema` 只需产出 `{kind, body, files, evidence, inReplyTo?}`(见 §6 的 `agentMessagePayloadSchema`);`id/runId/round/seq/from/role/ts` 全部由中枢在 `append` 时盖章补齐(I7)。这样 agent 无法伪造身份 / 时间 / 轮次 / 排序。`schemaVersion` 不在内存态 `Message` 上,只在 jsonl 持久化行(§7)——避免同一信息两处存放漂移(I4 修正)。

### 5.2 跨字段强约束(`validateMessage` 实现,zod `superRefine` + 中枢上下文)

| # | 触发条件 | 约束 | 违反错误码 |
|---|---|---|---|
| C1 | `role==='critic'` 或 `kind==='critique'` | `evidence` 非空且 ≥1 条**强**核验通过(weak 不算,§3.2) | `EVIDENCE_REQUIRED` / `EVIDENCE_UNVERIFIABLE` |
| C2 | `kind==='ack'` 且 `inReplyTo` 指向 `done` | `evidence` 必须 ≥1 条强核验通过 | `EVIDENCE_REQUIRED` / `EVIDENCE_UNVERIFIABLE` |
| C3 | `kind==='done'` | `from` 不得在同轮既 done 又自我 ack | `INVALID_DONE_SELF_ACK` |
| C4 | `evidence[].kind==='file_ref'` | `lineEnd >= lineStart` 且均 ≥1 | `OUTPUT_SCHEMA_VIOLATION` |
| C5 | `files[].changeKind==='rename'` | `renamedFrom` 必填 | `OUTPUT_SCHEMA_VIOLATION` |
| C6 | 任意 `file_ref.path` / `files[].path` / `renamedFrom` | worktree 内、无 `..`、不命中敏感白名单 | `WORKTREE_PATH_VIOLATION` |
| C7 | `kind==='system'` | `from` 必须为 `orchestrator` | `INVALID_SYSTEM_SENDER` |
| C8 | `inReplyTo` | 若非空,必须指向同 `runId` 已存在消息 | `DANGLING_REPLY_REF` |
| C9 | `from==='orchestrator'` | `kind` 必须为 `system`(中枢不冒充 agent 发业务消息) | `INVALID_SYSTEM_SENDER` |
| C10 | 序列化后单条 message 字节数 | ≤ `MAX_MESSAGE_BYTES`(默认 256KiB,§5.3) | `MESSAGE_SIZE_EXCEEDED` |
| C11 | `seq`(中枢盖) | 同 run 内严格 = 前一条 +1(单调无洞,I8) | `OUTPUT_SCHEMA_VIOLATION`(内部断言) |

> C1/C2 的“强核验通过”是**两阶段**:先 zod 结构校验(非空、字段齐、size 内),再中枢核验阶段(§8.2)对 `file_ref`(带 quote)/`command`(实跑)复算。结构过但无任一条达“强” = `EVIDENCE_UNVERIFIABLE`。weak 级证据(无 quote 的 file_ref、未实跑 command、spec_quote)可以存在、可入指纹,但**不能单独满足** C1/C2(H2)。
> C9 与 C7 互补:C7 防 agent 冒充中枢发 `system`;C9 防中枢身份被误用于业务 kind。二者共用 `INVALID_SYSTEM_SENDER`。

### 5.3 资源上限常量(H4,DoS 护栏)

失控或被注入的 agent 可能产出超大正文撑爆中枢内存 / WS 帧 / jsonl 行。除字段级 `.max()`(§3/§5)外,再设一道**序列化字节**总闸,落 `@sylux/shared`:

```ts
/** 单条 message 序列化(encodeJsonlLine 的 message 行)字节硬上限。 */
export const MAX_MESSAGE_BYTES = 256 * 1024 as const;   // 256 KiB
/** 单条 jsonl 行(任意 recordType)字节硬上限,decode 时超限即判残行(§7.3)。
 *  ★权威值在此(本文件 02)。B1:06 §6.2 曾把它重声明为 1MiB 并误称“05 权威”——
 *  那是 I1 违规 + 数值冲突。统一以本常量 512KiB 为准,06/任何其他文档只 import 不重声明。 */
export const MAX_JSONL_LINE_BYTES = 512 * 1024 as const; // 512 KiB(权威,勿在他处重定义)
/** 单轮 evidence 指纹集合条数上限(§10,防指纹集膨胀拖慢差集)。 */
export const MAX_FINGERPRINTS_PER_ROUND = 4096 as const;
```

字段级上限汇总(已写进各 schema):`body ≤64KiB`、`files ≤256`、`evidence ≤128`、`file_ref.quote/command.expected/actual ≤8KiB`、`path ≤1024`。中枢在 `append` 前先算 `JSON.stringify(message)` 字节,超 `MAX_MESSAGE_BYTES` → `MESSAGE_SIZE_EXCEEDED`,走打回重发链(§8.4)而非崩溃。这些上限可被 config(16)覆盖,但有编译期默认兜底。

### 5.4 agent 可控字段=不可信数据(H14,面板 XSS 护栏)

`Message` 的下列字段**完全由 agent 文本产出**,属不可信数据,可能被注入(失控/被提示注入的 agent 可在其中塞 `<script>` / `<img onerror>` / 控制序列):

| 字段 | 不可信来源 |
|---|---|
| `body` | agent 自然语言正文 |
| `evidence[].quote` / `note` / `cmd` / `expected` / `actual` / `source` / `locator` | agent 自填证据文本 |
| `files[].path` / `renamedFrom`、`file_ref.path` | agent 声明的路径(还兼受 §8.3 白名单约束) |

> **契约层职责到此为止**:本文件保证这些字段**结构合法、长度受限、路径白名单**(C6),但**不保证 HTML/终端安全**——`normalizeContent`/redact 只统一空白、抹 secret,**不转义** `<`/`>`/`&`。任何把这些字段送进浏览器 DOM、HTML 模板或终端的消费者(面板 08/10、日志 09)**必须自行 escape + CSP**,且**禁止 `innerHTML` 直接插 agent 串**。这条把 RS-B2(面板 XSS 威胁面缺失)在数据源头打上“此为不可信数据”的契约标记;具体转义/CSP 规则归面板 08 与安全 09,本文件只焊死“别把它当可信文本”的认知。
> 关联:喂给**对面 agent** 前的边界标记/内容防火墙(防提示注入)是另一条独立防线,归安全 09(`firewallPeerMessage`),与此处“喂给浏览器前 escape”正交,二者都要做。

---

## 6. 适配层边界 schema(agent 产出子集 + AgentEvent)

本节定义**子进程边界**上的两个 schema:`agentMessagePayloadSchema`(CLI 经 `--output-schema`/`--json-schema` 实际产出的字段子集)与 `agentEventSchema`(适配层向引擎吐的事件流)。二者都属本文件权威,适配层文档 04 只引用。

### 6.1 agentMessagePayloadSchema —— CLI 实际产出的字段子集

§5.1 末尾已定:`id/runId/round/from/role/ts/schemaVersion` 全由中枢 `append` 时盖章,**agent 不产出**。喂给 codex `--output-schema`(文件)/ claude `--json-schema`(内联串)的,只是下面这个瘦子集。这样 agent 无法伪造身份 / 时间 / 轮次(对应 I2、安全文档 09 防伪造)。

```ts
/** CLI 经 output-schema/json-schema 被强制产出的字段。其余字段中枢盖章。 */
export const agentMessagePayloadSchema = z.object({
  kind: messageKindSchema,
  body: z.string(),
  files: z.array(filePatchSchema).default([]),
  evidence: z.array(evidenceItemSchema).default([]),
  inReplyTo: z.string().optional(),
});
export type AgentMessagePayload = z.infer<typeof agentMessagePayloadSchema>;
```
### 6.2 由瘦子集生成 CLI 强制 schema(两端不对称)

事实地基 C/F 节:codex 收**文件路径**(`--output-schema schema.json`),claude 收**内联串**(`--json-schema '<json>'`),且 claude 内联串在 Windows 命令行有约 32KB 上限与转义风险。本契约只负责产出**一份 JSON Schema 对象**,落点差异由适配层 04 处理。

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';

/** 由瘦子集生成 JSON Schema(draft-07)。适配层据此写文件(codex)或内联(claude)。 */
export function buildAgentOutputJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(agentMessagePayloadSchema, {
    name: 'AgentMessagePayload',
    $refStrategy: 'none', // 摊平 $ref,规避两端对 $ref 解析差异 + 内联体积可控
    target: 'jsonSchema7',
  });
}
```

> 【待实测】`$refStrategy:'none'` 摊平后,嵌套 `discriminatedUnion`(evidence 三锚点)生成的 schema 体积是否逼近 claude 32KB 内联上限,需 M0 实测;若超限,适配层退化为 claude 走 `stream-json` 输入而非 `--json-schema` 内联(事实地基 F 节备选)。codex 侧写文件无此限。
>
> 【待实测·H7 结构化输出兼容性】严格 structured-output 后端(OpenAI `response_format: json_schema strict`、部分中转)对 schema 有额外约束:(a) 每个 object 的所有 property 必须出现在 `required` 里;(b) `additionalProperties:false`;(c) 对 `anyOf`/`oneOf`(discriminatedUnion 会生成 `anyOf`)支持参差。本契约的 `evidence` 是三分支 union、且多字段 optional(`note`/`quote`/`exitCode`/`inReplyTo`),在 strict 模式可能被拒。M0 必测两端真实行为,并准备**退化方案**:
> - 退化 A(推荐):把 optional 字段转成 `nullable + required`(`z.string().nullable()` 而非 `.optional()`)再喂 strict 后端,应用层把 `null` 当缺省;
> - 退化 B:`evidence` 项降为**单 object + `kind` 枚举 + 各锚点字段全 optional-nullable**,把“判别”从 schema 层移到应用层 `superRefine`(牺牲 schema 表达力换取后端兼容);
> - 退化 C:放弃 CLI 端强制 schema,改“宽 schema 产出 + 中枢 zod safeParse 兜底重发”(事实地基 C 的兜底链,永远保留)。
> 选型在适配层 04 落地;本文件只保证**权威 zod 与退化变体在语义上等价**(退化只改 JSON Schema 形状,不改 `Message`/`EvidenceItem` 的 TS 类型与校验语义)。

### 6.3 AgentEvent —— 适配层事件流(权威定义,04 引用)

本节为 `AgentEvent` 的权威定义,总体规划 §2.6 是早期镜像、已被本节取代(差异见 §15.3)。补 `usage`、`sessionId` 映射语义、首事件不变量。事件流的**第一类事件恒为 `session_started`**(不变量 I5);中枢拿到它之前不得标记 agent 可 resume(红队 R3 / 事实地基 B 节)。

```ts
/** token 用量,直接取自 codex turn.completed.usage(中转回吐,可靠,不本地估算) */
export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/** 适配层向引擎吐的事件流。第一类事件必为 session_started(I5)。 */
export const agentEventSchema = z.discriminatedUnion('kind', [
  // ① 首事件:回吐会话 id。sessionId 是适配层统一抽象;codex 侧映射自
  //    thread.started.thread_id(事实地基 B),claude 侧映射自其 session id。
  z.object({
    kind: z.literal('session_started'),
    sessionId: z.string().min(1),
  }),
  // ② 流式增量(可选透传面板)
  z.object({ kind: z.literal('delta'), text: z.string() }),
  // ③ 工具调用(透传面板观战)
  z.object({ kind: z.literal('tool_call'), name: z.string(), args: z.unknown() }),
  // ④ 最终 JSON 文本(待 agentMessagePayloadSchema.safeParse;附本轮 usage)
  z.object({
    kind: z.literal('final_message'),
    raw: z.string(),
    usage: tokenUsageSchema.optional(), // 取自 turn.completed.usage,可缺省(claude 端字段名不同时由适配层归一)
  }),
  // ⑤ 错误(spawn 失败 / schema 违例 / 进程崩溃)
  z.object({ kind: z.literal('error'), code: z.string(), detail: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
```

> **与 §2.6 的差异(见 §15 对账台账)**:本节给 `session_started.sessionId` 加了 `.min(1)`,给 `final_message` 加可选 `usage`(挂 token 计量,刹车文档 07 用)。
>
> **失败路径(红队 major,事实地基 A/B)**:首轮在 `session_started` 之前进程崩溃 → 拿不到 sessionId → 适配层 emit `{kind:'error', code:'SUBPROCESS_SPAWN_FAILED'|...}` 且**不**先发 `session_started`(I5 唯一例外) → 中枢标记该 agent `resumable=false`,引擎据此写一条 `kind:'system'` 消息(`from:'orchestrator'`),按全新会话重来。
>
> **usage 缺失处理(v2 H6 / v2.1 H15)**:`final_message.usage` 可缺省(claude 端字段名不同或某些路径不回吐)。刹车 07 **绝不把缺失当 0**:
> - **input 缺失**:按事实地基 D 基线底价(单回合 ≈18.7k input tokens)作保守上界估;
> - **output 缺失**(ROC-M1 漏洞:v1 只兜 input,output 当 0 → `maxCostUsd` 用 output=0 算 → 用户设 $12 上限挡不住真实 $40+):output 也必须按 regime 保守上界估(非 0)。建议上界 = 该 agent 历史 output 滑窗 P90,无历史则取 config(16)`outputCeilingTokens` 默认;`usageToUsd` 一律喂上界值,宁可早刹车不可低估。
> - **字段漂移(对接 19 degradable)**:usage 字段在 CLI 升级后改名/缺失时,事件流校验把它划 `degradable`(只 warn 放行,不崩),**但成本计量仍按上述上界算**——“放行”指不阻断管线,不等于“按 0 计”。这样成本刹车不会因 CLI 升级静默失明。
>
> 归一化职责在适配层 04:能拿到就填真值,拿不到就由刹车侧按 `round` 累积模型(事实地基 D:N 轮 ≈ base×ΣN)+ 上述 output 上界兜底。`Round.usage` / `BoardState.totalUsage` 落的是“真值优先、缺失填上界”的结果,且**标记 estimated 位**(供面板区分实测/估算,字段归 04/10 细化)。

---

## 7. jsonl 持久化行格式(append-only 事件日志)

黑板持久化采用**单文件 append-only jsonl**:每 run 一份 `runs/<runId>.jsonl`,每行一个独立 JSON 对象(无逗号、无外层数组),崩溃可截断到最后完整行恢复。这是回放(面板时间旅行)与审计的权威源。`jsonl.ts` 负责 encode/decode 与版本迁移。

### 7.1 行的判别联合(jsonlRecord)

每行是一条**带 `recordType` 判别**的记录,不只存 message——还存轮边界、状态变更、系统裁决,这样单文件即可重建完整 `BoardState`。

```ts
/** jsonl 单行记录。recordType 判别;每行自带 schemaVersion(I4)以支持迁移。 */
export const jsonlRecordSchema = z.discriminatedUnion('recordType', [
  // ① run 头:首行,定调 runId/playbook/起始时间
  z.object({
    recordType: z.literal('run_started'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    playbookId: z.string().min(1),
    ts: z.number().int().nonnegative(),
  }),
  // ② 一条黑板消息(主体,占绝大多数行)
  z.object({
    recordType: z.literal('message'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    message: messageSchema,
  }),
  // ③ 轮边界(轮结束时落,带当轮指纹集合 + usage,供回放免重算)
  z.object({
    recordType: z.literal('round_closed'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    round: roundSchema,
  }),
  // ④ 状态变更(running→paused→done/...,面板状态条 + 终态审计)
  z.object({
    recordType: z.literal('status_changed'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    status: runStatusSchema,
    /** 机读终态原因码(H10/D5):04 调 setStatus(status, code, reason) 三参时落此。
     *  终态(stalled/aborted/limit)应填对应码;running/paused 等正常转移可缺省。 */
    code: z.string().optional(),         // SyluxErrorCode 字面量(§12);用 string 避免 schema↔errors 循环依赖,04 侧以 SyluxErrorCode 约束
    reason: z.string().optional(),       // 人读旁注(人工备注 / detail),非机读
    ts: z.number().int().nonnegative(),
  }),
  // ⑤ 会话句柄回吐(sessionId 落盘,崩溃后可 resume)
  z.object({
    recordType: z.literal('agent_session'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    agent: agentIdSchema,
    sessionId: z.string().min(1),
    ts: z.number().int().nonnegative(),
  }),
]);
export type JsonlRecord = z.infer<typeof jsonlRecordSchema>;
```

> `roundSchema`/`runStatusSchema` 的权威定义在 §10(Round/BoardState),此处前向引用同文件类型,实现时 §10 的 const 在 §7 之前求值即可(单文件内提升靠 import 顺序无关,均同模块导出)。
### 7.2 encode / decode 契约

```ts
/** 序列化单行:JSON.stringify + 换行。禁止内嵌裸换行(JSON 转义保证单行)。 */
export function encodeJsonlLine(rec: JsonlRecord): string {
  return JSON.stringify(jsonlRecordSchema.parse(rec)) + '\n';
}

/** 解析单行 → 经迁移 → safeParse。返回 discriminated 结果,绝不抛进引擎。 */
export function decodeJsonlLine(
  line: string,
): { ok: true; record: JsonlRecord } | { ok: false; error: string; raw: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: 'INVALID_JSON', raw: line };
  }
  const migrated = migrateRecord(parsed); // §7.4
  const r = jsonlRecordSchema.safeParse(migrated);
  return r.success
    ? { ok: true, record: r.data }
    : { ok: false, error: r.error.message, raw: line };
}
```

### 7.3 崩溃恢复与回放规则

- **写**:append-only,`fs.appendFile` 单行追加;`run_started` 必为首行,终态 `status_changed` 为末行(正常退出)。
- **截断恢复**:读到最后一行若 `decodeJsonlLine` 失败(写到一半崩),丢弃该残行,前面完整行即权威态。
- **重建 `BoardState`**:顺序回放 → `run_started` 建壳 → `message` 推入 `messages` 并按 `round` 归桶 → `round_closed` 填 `rounds[]` → `agent_session` 填 `agents[].sessionId/resumable=true` → `status_changed` 末态。`BoardState` 不直接落盘,由行日志投影得出(单一事实源,杜绝快照与日志双写漂移)。

### 7.4 版本迁移(I4)

```ts
/** 把任意旧版本记录就地升到当前 SCHEMA_VERSION。每次 +1 加一个分支。 */
function migrateRecord(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const v = (raw as { schemaVersion?: number }).schemaVersion ?? 0;
  let rec = raw;
  // 示例骨架:版本提升链,逐级搬运。当前仅 v1,无迁移分支。
  // if (v < 1) rec = migrateV0toV1(rec);
  // if (v < 2) rec = migrateV1toV2(rec);
  void v;
  return rec;
}
```

迁移原则:**只升不降**,每条记录自带 `schemaVersion`(不靠全局推断);破坏性变更(删字段 / 改 `contentHash` 算法 / 改行结构,§1.2)必须 `SCHEMA_VERSION+1` 并补一个 `migrateV{n-1}toV{n}` 分支 + 对应回放快照测试(§13)。

---

## 8. 校验管线 —— validateMessage(两阶段:结构 + 可核验)

`validate.ts` 的 `validateMessage` 是黑板的**唯一守门函数**:任何子进程产出在进 engine 前必经此关(不变量 I2)。它分两阶段:**阶段 A** 纯 schema/跨字段(无副作用,可在任何上下文跑);**阶段 B** 需中枢上下文(worktree 文件系统句柄)复算 evidence 锚点(§3.2)。

### 8.1 上下文与返回类型

```ts
/** 中枢核验上下文:提供 worktree 读、已存在消息查、可选沙箱命令复跑。 */
export interface ValidateContext {
  runId: string;
  /**
   * 本上下文具备的核验能力(H13/FEAS-2)。M1 红蓝纯决策态无 worktree → fs=false,
   * 此时 file_ref 一律降 weak(无可读区间),不可作强证据。verifyEvidence 据此分支。
   */
  capabilities: {
    fs: boolean;       // 是否可读 worktree 文件(readFileRange 是否有效)
    sandbox: boolean;  // 是否可沙箱复跑 command(runCommandSandboxed 是否注入)
  };
  /** 读 agent worktree 内文件指定行区间(越界 / 不存在 → null;capabilities.fs=false 时恒 null);路径已过白名单 */
  readFileRange(agentWorktreeRel: string, lineStart: number, lineEnd: number): string | null;
  /** 查同 run 是否存在某消息 id(C8 悬空引用校验) */
  hasMessage(id: string): boolean;
  /**
   * 可选:沙箱内复跑 command evidence(H3 安全约束)。未注入(capabilities.sandbox=false)则所有 command 证据为 weak。
   * 实现必须:① 仅在该 agent worktree 内执行;② sandbox 封顶 read-only/workspace-write(自动化封顶,R8);
   * ③ 断网(无出境);④ env 走白名单(buildChildEnv,安全 09);⑤ 硬超时(默认 10s);
   * ⑥ 命令本身过预扫描(拒 `rm -rf /`、`curl|sh`、含 `sk-`/base64 疑似 key,R8)。
   * 返回判别结果区分三态(H12/COV-3):
   *  - {ok:true,...}        正常执行完(无论 stdout 是否匹配,匹配判定在 verifyEvidence)
   *  - {ok:false,reason:'unsafe'}  预扫描判命令不安全 → EVIDENCE_COMMAND_UNSAFE,该证据 fail + 记红队“无效发言”
   *  - {ok:false,reason:'infra'}   沙箱/复跑器自身崩(spawn 失败、超时杀进程、磁盘满等中枢侧故障)
   *                                → 该证据判 weak(不 fail、不连坐 critic、不计无效发言、不进 stall 计数),记 system 告警
   */
  runCommandSandboxed?: (
    cmd: string,
  ) =>
    | { ok: true; stdout: string; exitCode: number }
    | { ok: false; reason: 'unsafe' | 'infra'; detail: string };
  /** 路径白名单判定(§8.3,安全文档 09 拥有规则,本函数注入) */
  isPathAllowed(rel: string): boolean;
}

/** 校验结果:ok 或带错误码 + 人类可读 + 违规字段路径。 */
export type ValidateResult =
  | { ok: true }
  | { ok: false; code: SyluxErrorCode; message: string; path?: string };
```

> **签名桥接:`validateMessage` ≠ `EngineDeps.validate`(H11/D6)**。本文件的 `validateMessage(msg: Message, ctx: ValidateContext)` 吃的是**中枢已盖章的完整 `Message`**(含 `id/seq/from/role/ts`)。引擎 03 的 `EngineDeps.validate(payload: AgentMessagePayload, round: number)` 是**适配器**,不是同一函数:它先用 §6.1 瘦 payload + 中枢盖章(§5.1 I7)拼出 `Message`,构造 `ValidateContext`,再委托给本文件的 `validateMessage`。两层语义:03 入参是 agent 产出的瘦子集(`AppendInput`/`AgentMessagePayload`),本函数入参是盖章后的权威 `Message`。回填动作:03 §4.3 注明 `EngineDeps.validate` 内部调 `@sylux/shared` 的 `validateMessage`,入参经盖章桥接,**勿把二者当同一签名**。

### 8.2 两阶段流程(伪代码)

```ts
export function validateMessage(msg: Message, ctx: ValidateContext): ValidateResult {
  // ── 阶段 A:结构 + 跨字段(无副作用)──
  const parsed = messageSchema.safeParse(msg);
  if (!parsed.success) {
    return { ok: false, code: 'OUTPUT_SCHEMA_VIOLATION', message: parsed.error.message };
  }
  const m = parsed.data;

  // C4 file_ref 行区间;C5 rename;C7 system sender;C3 done 自 ack —— 纯结构,见 §5.2
  const struct = checkCrossField(m); // superRefine 等价的命令式实现
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
    // 至少一条达到“强”核验通过(weak 不算:无 quote 的 file_ref / 未实跑 command / spec_quote,§3.2 / H2)
    const hasStrong = m.evidence.some((e) => verifyEvidence(e, ctx) === 'pass');
    if (!hasStrong) {
      return { ok: false, code: 'EVIDENCE_UNVERIFIABLE', message: '无任何强 evidence 复算通过(weak 级不解锁)' };
    }
  }
  return { ok: true };
}
```

> 说明:`verifyEvidence` 只把**中枢能独立复算通过**的证据判 `pass`(强);`weak` 与 `fail` 都不满足 C1/C2。这把 v1 “强或中(含 agent 自报 command)”收紧为“强”,堵死 H2 自证绕过。

### 8.3 单条 evidence 复算(verifyEvidence)

```ts
type VerifyResult = 'pass' | 'fail' | 'weak'; // pass=强(中枢独立复算通过);weak=仅定位/自报/无能力/基础设施故障;fail=复算不符

function verifyEvidence(e: EvidenceItem, ctx: ValidateContext): VerifyResult {
  switch (e.kind) {
    case 'file_ref': {
      if (!ctx.capabilities.fs) return 'weak';             // H13:M1 无文件系统,file_ref 不可作强证据
      const content = ctx.readFileRange(e.path, e.lineStart, e.lineEnd);
      if (content === null) return 'fail';                 // 不存在 / 越界
      // H1:agent 提供 quote 才能“强”核验——中枢重读区间,双向归一化后比对
      if (e.quote === undefined) return 'weak';            // 仅定位,无内容断言可比
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
        // H12/COV-3:区分“命令不安全”与“沙箱自身崩”
        if (r.reason === 'unsafe') return 'fail';          // 安全违规 → fail + 记无效发言(§8.4)
        // reason==='infra':中枢侧故障,不连坐 critic、不计无效发言、不进 stall
        return 'weak';                                     // 记 system 告警(在调用侧落,§8.4)
      }
      if (e.exitCode !== undefined && e.exitCode !== r.exitCode) return 'fail';
      return matchOutput(r.stdout, e.expected, e.matchMode) ? 'pass' : 'fail';
    }
    case 'spec_quote':
      return 'weak'; // 来源可达性弱核验(不做语义比对),不足以单独解除 evidence 要求
  }
}
```

> v2 关键变化:① `file_ref` 无 `quote` 时只 `weak`(不再凭 agent 自算 hash 判强,H1);② `command` 未实跑一律 `weak`(不再信 agent 自报 `actual` 自洽,H2);③ `command` 实跑走 `runCommandSandboxed` 的安全沙箱(H3)。三者合力保证“强”证据=中枢亲自复算,agent 无法自证。
> v2.1 追加:④ `capabilities.fs=false`(M1 无 worktree)时 `file_ref` 降 `weak`(H13),M1 的 critic 只能靠实跑 `command` 或 playbook 级放宽(§8.5);⑤ 复跑器**基础设施故障**(`reason:'infra'`,沙箱崩/超时杀/磁盘满)判 `weak` 而非 `fail`(H12/COV-3)——这是中枢侧的锅,不能连坐写对了证据的 critic,也不计入“无效发言”、不刷新 stall。只有命令**本身不安全**(`reason:'unsafe'`)才 `fail` + 计无效发言。

### 8.4 打回与重试(对接 safeParse 兜底)

`validateMessage` 返回 `!ok` 时,引擎按错误码处理(事实地基 C 兜底链):

| 错误码 | 引擎动作 |
|---|---|
| `OUTPUT_SCHEMA_VIOLATION` | 带错误详情重发该 agent ≤N 次,耗尽则抛(终止本轮) |
| `EVIDENCE_REQUIRED` / `EVIDENCE_UNVERIFIABLE` | 打回:回灌“你的 critique 缺**强**核验 evidence,请补带 `quote` 的 file_ref 或可被复跑的 command 锚点”,重发该 agent ≤N 次 |
| `MESSAGE_SIZE_EXCEEDED` | 打回:回灌“输出超 256KiB,请精简正文 / 拆分 evidence”,重发 ≤N 次;耗尽则抛(防失控 agent 反复撑爆) |
| `EVIDENCE_COMMAND_UNSAFE` | 该 command 证据判 fail(不计强),记 `system` 消息 + 红队“无效发言”;不因单条不安全证据终止本轮(其余证据仍可成立) |
| (复跑器基础设施故障,H12) | **无错误码**:`verifyEvidence` 返 `weak`,引擎记 `system` 告警(`code:'EVIDENCE_INFRA_DEGRADED'`,见 §12);该证据不 fail、**不连坐 critic**、不计无效发言、不进 stall 计数;若 critic 因此无任一强证据,按 `EVIDENCE_UNVERIFIABLE` 正常打回重发(让 agent 换可读 file_ref 锚点) |
| `WORKTREE_PATH_VIOLATION` / `DANGLING_REPLY_REF` / `INVALID_*` | 视为协议违规,打回并记 `system` 消息;连续违规计入红队“无效发言”指标 |

> 打回文本经内容防火墙(安全文档 09)包边界标记后才回喂 agent,防注入。

### 8.5 M1 无文件系统态的 evidence 策略(H13/FEAS-2,与裁剪 25 / 引擎 03 对接)

FEAS-2(blocker)指出:M1“红蓝纯决策、不写文件、无 worktree”与 C1“`file_ref`+`quote` 强核验”矛盾——无 worktree 则 `readFileRange` 恒 `null`,`file_ref` 永远 `weak`,critic 拿不出强证据 → C1 在 M1 永远过不了(假绿或卡死)。本文件给**契约层**的可机读出口,**策略选型归引擎 03 / 裁剪 25**:

- 契约层只暴露 `ValidateContext.capabilities`(§8.1)。`validateMessage` **不**硬编码“M1 放宽”——它只忠实反映“当前能力下哪些证据算强”。
- M1 下 `capabilities.fs=false`:强证据来源只剩 ① 沙箱实跑 `command`(若 M1 给只读 checkout + sandbox 能力,见下);② `spec_quote` 仍 `weak`。
- **裁决点(留引擎 03/25 定,本文件不替它定)**:M1 要么
  - (a) 给一个**只读单 checkout**(非 worktree)+ `capabilities.fs=true`,让 `file_ref`+`quote` 对该 checkout 强核验——这与“M1 不写文件”不冲突(读≠写),是推荐解;或
  - (b) 引入 **playbook 级 `evidencePolicy`**(归 03 Playbook 接口):M1 红蓝 playbook 声明 `criticEvidenceMode:'spec_or_command'`,允许 `spec_quote`+实跑 `command` 组合满足 critique 门,`file_ref` 不可用时不卡死。
- 无论选 (a)/(b),**契约层 C1 的语义不变**(“≥1 强”),变的是“M1 提供哪种能力让强证据可得”。这把矛盾从“契约自相矛盾”降级为“部署能力配置”,FEAS-2 的“退出标准 3/4 假绿”由此关闭:M1 验收必须先确认走 (a) 或 (b),否则 critic 门形同虚设。
- 关联 COV-9(diff 面板 M1 矛盾):若 M1 选 (a) 只读 checkout,T2.6/T2.9 的 diff 渲染也有了文件源;若 M1 彻底无文件,diff 面板推迟 M3。此裁决归 25,本文件只标依赖。

---

## 9. Evidence 指纹与内容哈希(签名权威,刹车 07 引用)

收敛检测(红队 R5)的核心是“**新 evidence 差集**”:把每轮 evidence 归约成稳定指纹集合,连续 N 轮无新指纹 → `stall`。指纹算法**强耦合 `EvidenceItem` 结构**,故签名与归一化规则在本文件定权威(§0.2),刹车 07 只调用、不另定义。

### 9.1 内容归一化(contentHash 与指纹共用)

`file_ref.contentHash` 与指纹都对“文本内容”做哈希,必须先归一化,否则跨平台换行 / 尾空白会让同一区间算出不同 hash。**v2 修正(H1)**:`contentHash` 是**中枢核验时派生**的权威值(对中枢重读的真实区间内容算),不是 agent 自算——因此归一化算法只需中枢自己一致,agent 无需复现:

```ts
/** 文本归一化:统一换行为 \n、去每行尾随空白、去首尾空行。不动行内语义空白。 */
export function normalizeContent(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')        // CRLF/CR → LF(Windows 必需,事实地基 A)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '')) // 去行尾空白
    .join('\n')
    .replace(/^\n+|\n+$/g, '');     // 去首尾空行
}

/** 区间内容哈希:归一化 → sha256 → hex 前 16 字符(碰撞概率足够低,体积友好)。 */
export function contentHash(text: string): string {
  // 实现用 node:crypto createHash('sha256');此处给契约:输入先 normalizeContent。
  return sha256hex(normalizeContent(text)).slice(0, 16);
}
```

> **算法即契约**:`normalizeContent` + sha256-hex-16 是 `contentHash` 的权威定义。任何改动(换算法 / 改截断长度 / 改归一化规则)都是破坏性变更,必须 `SCHEMA_VERSION+1`(§1.2),否则旧 jsonl 里的 `contentHash` 全部失配。

### 9.2 指纹函数签名(权威,07 实现复用)

```ts
/** 单条 evidence 的稳定指纹。同一锚点指向“同一事实”必得同一指纹,用于跨轮差集。 */
export function fingerprint(e: EvidenceItem): string {
  switch (e.kind) {
    case 'file_ref':
      // 路径 + 区间 + 中枢派生 contentHash;note/quote 不参与(它们不改变“是哪条证据”)。
      // contentHash 缺省(未核验/无 quote)时退回区间定位指纹,核验后再以含 hash 指纹替换。
      return e.contentHash
        ? `f:${e.path}:${e.lineStart}-${e.lineEnd}:${e.contentHash}`
        : `f:${e.path}:${e.lineStart}-${e.lineEnd}:?`;
    case 'command':
      // 命令 + 期望 + 模式;actual 不参与(同一断言无论实测值都算同一“声明”)
      return `c:${stableHash(e.cmd)}:${stableHash(e.expected)}:${e.matchMode}`;
    case 'spec_quote':
      // 来源 + 引文归一化
      return `s:${stableHash(e.source)}:${stableHash(normalizeContent(e.quote))}`;
  }
}

/** 一组 evidence 的指纹集合(去重),供 Round.evidenceFingerprints 缓存。 */
export function fingerprintSet(items: EvidenceItem[]): string[] {
  return [...new Set(items.map(fingerprint))];
}
```

### 9.3 差集语义(供刹车 07,本节只给定义)

- 第 k 轮“新指纹” = `Round[k].evidenceFingerprints \ ⋃_{j<k} Round[j].evidenceFingerprints`。
- 连续 `stallWindow`(默认值由 07 配)轮新指纹为空集 → `CONVERGENCE_STALL`。
- **stall 与 done 解耦**(红队 R5):done 需对面带证据 ack(C2);stall 是“没新证据可吵”的被动终止,两条独立刹车,不互相触发。
- **指纹时机(v2/H1)**:`fingerprintSet` 在**轮末核验完成后**算,此时强 `file_ref` 的 `contentHash` 已由中枢回填,指纹稳定;未过核验的 weak file_ref 留 `?` 占位指纹(同区间反复提交不算“新”,避免空证据刷新 stall 计数)。指纹集条数受 `MAX_FINGERPRINTS_PER_ROUND`(§5.3)限,超限截断并记 `system` 告警。

---

## 10. Round 与 BoardState —— 黑板运行态数据类型

`Round`/`BoardState` 是黑板**数据快照**类型(本文件拥有);读写它们的 `Blackboard` **接口**(append/snapshot/persist 等行为)归引擎文档 03,本节只定义数据形状。§7 jsonl 行已前向引用本节的 `roundSchema`/`runStatusSchema`(同模块导出,引用顺序无关)。

### 10.1 收敛指纹与轮摘要

收敛检测(红队 R5)靠 §9 的 evidence 指纹差集;`Round` 内缓存当轮指纹集合(`fingerprintSet` 结果),引擎做跨轮差集时不必重算,回放时也免重读 worktree。

```ts
/** 单轮快照:一轮内可有多条 message(多 agent / 多 kind)。 */
export const roundSchema = z.object({
  index: z.number().int().nonnegative(),              // 轮次号,与 Message.round 对齐
  messageIds: z.array(z.string().min(1)).default([]), // 本轮 message id(按 seq 升序,I6,非 ts)
  /** 本轮所有 evidence 的指纹集合(§9.2 fingerprintSet,核验后算),收敛差集 + 回放用 */
  evidenceFingerprints: z.array(z.string()).max(4096).default([]), // MAX_FINGERPRINTS_PER_ROUND
  /** 本轮累计 token(各 final_message.usage 求和;缺失按基线保守上界,H6) */
  usage: tokenUsageSchema.optional(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),  // 未结束为空
});
export type Round = z.infer<typeof roundSchema>;
```

### 10.2 运行状态机与 BoardState

```ts
/** run 生命周期状态。done/stalled/aborted/limit 为终态(不可再转 running)。 */
export const runStatusSchema = z.enum([
  'running',   // 进行中
  'paused',    // 面板人工暂停(可恢复→running)
  'done',      // 收敛完成(对面带证据 ack 过 done,C2)
  'stalled',   // 连续 N 轮无新 evidence 指纹(CONVERGENCE_STALL,§9.3)
  'aborted',   // 人工中止 / 致命错误
  'limit',     // 触发 maxRounds / token 预算(ROUND_LIMIT_EXCEEDED / TOKEN_BUDGET_EXCEEDED)
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * 状态转移矩阵(引擎 03 执行,本文件定权威):只允许下表转移,非法转移抛内部断言。
 *
 * | from \ to | running | paused | done | stalled | aborted | limit |
 * |-----------|---------|--------|------|---------|---------|-------|
 * | (init)    |   ✓     |        |      |         |         |       |
 * | running   |   —     |   ✓    |  ✓   |   ✓     |   ✓     |  ✓    |
 * | paused    |   ✓     |   —    |      |         |   ✓     |       |
 * | done/stalled/aborted/limit(终态) | 不可再转 | | | | | |
 *
 * - paused 只能回 running 或被 aborted(人工放弃);不能从 paused 直接判 done/stall。
 * - 四个终态(done/stalled/aborted/limit)进入后冻结,任何后续 status_changed 视为非法(回放时丢弃并告警)。
 */

/** 黑板全局快照:一次 run 的完整可序列化状态(面板拉取 / 回放投影共用)。 */
export const boardStateSchema = z.object({
  runId: z.string().min(1),
  playbookId: z.string().min(1),                  // 当前剧本(红蓝/主从/结对/分工),定义在引擎 03
  status: runStatusSchema,
  currentRound: z.number().int().nonnegative(),
  rounds: z.array(roundSchema).default([]),
  messages: z.array(messageSchema).default([]),   // 全量消息(回放权威源;面板可只取增量)
  /** 各 agent 会话句柄态(resume 依据,I5)。仅 codex/claude 出现;human/orchestrator 无会话不入此表。 */
  agents: z.record(
    agentIdSchema,
    z.object({
      sessionId: z.string().min(1).optional(),    // 未拿到前为空 → resumable 必 false
      resumable: z.boolean().default(false),
    }),
  ).default({}),
  /** 累计 token(全 run 求和,事实地基 D:累积/超线性成本模型) */
  totalUsage: tokenUsageSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
});
export type BoardState = z.infer<typeof boardStateSchema>;
```

### 10.3 BoardState 字段语义表

| 字段 | 语义 | 谁写 | 备注 |
|---|---|---|---|
| `runId` | run 唯一 id | 中枢启动时 | 贯穿全程 |
| `playbookId` | 当前剧本标识 | 引擎 03 | 热换剧本时变 |
| `status` | 运行状态机 | 引擎 | 终态见 §10.2 |
| `currentRound` | 当前轮号 | 引擎 | 与 `rounds[].index` 对齐 |
| `rounds` | 各轮快照 | 引擎 | 收敛 / 计量 |
| `messages` | 全量消息 | 中枢 append | 回放权威源 |
| `agents` | 会话句柄态 | 适配层回吐 | `sessionId` 空→不可 resume(I5) |
| `totalUsage` | 累计 token | 刹车 07 | 累积成本模型(事实地基 D) |
| `createdAt/updatedAt` | 时间戳 | 中枢 | epoch ms |
| `schemaVersion` | 契约版本 | jsonl 层 | I4 |

> `BoardState` 不独立落盘:它是 §7 jsonl 行日志的**投影**(顺序回放重建)。单一事实源避免“快照 vs 日志”双写漂移。面板可缓存投影结果,但权威永远是 jsonl。

---

## 11. 统一导出(index.ts re-export 清单)

`@sylux/shared/src/index.ts` 是全项目唯一进入点。其他包**只从 `@sylux/shared` 导入**,不深引 `blackboard.schema.ts`(便于内部重构)。

```ts
// ── schema + 推导类型(blackboard.schema.ts)──
export {
  SCHEMA_VERSION,
  MAX_MESSAGE_BYTES, MAX_JSONL_LINE_BYTES, MAX_FINGERPRINTS_PER_ROUND,
  roleSchema, messageKindSchema, agentIdSchema,
  evidenceItemSchema, filePatchSchema, messageSchema,
  agentMessagePayloadSchema, tokenUsageSchema, agentEventSchema,
  roundSchema, runStatusSchema, boardStateSchema,
  jsonlRecordSchema,
  buildAgentOutputJsonSchema,
} from './blackboard.schema.js';
export type {
  SchemaVersion, Role, MessageKind, AgentId,
  EvidenceItem, FilePatch, Message,
  AgentMessagePayload, TokenUsage, AgentEvent,
  Round, RunStatus, BoardState, JsonlRecord,
} from './blackboard.schema.js';

// ── 校验(validate.ts)──
export { validateMessage } from './validate.js';
export type { ValidateContext, ValidateResult } from './validate.js';

// ── 指纹 / 哈希(fingerprint.ts)──
export { fingerprint, fingerprintSet, contentHash, normalizeContent } from './fingerprint.js';

// ── jsonl(jsonl.ts)──
export { encodeJsonlLine, decodeJsonlLine } from './jsonl.js';

// ── 错误码(errors.ts)──
export { SyluxError } from './errors.js';
export type { SyluxErrorCode } from './errors.js';
```

> 用 `.js` 后缀(NodeNext/`verbatimModuleSyntax`,总体规划 §11.4 要求);`type` 导出与值导出分开(`consistent-type-imports`)。

---

## 12. 错误码(全集权威,errors.ts)

错误码全集集中在 `@sylux/shared/errors.ts`(本文件为权威单一来源)。**A1/COV-1(blocker)**:v2 的 union 只列 16 项,但下游 01/03/04/05/08/09/11/15/21 已用了 20+ 个未登记的码,导致 `SyluxError` 与评测 15 的 `Record<SyluxErrorCode, …>` 穷举**编译红**。v2.1 把全集补齐,**按拥有文档分域**:本文件**拥有**“★契约校验”项的语义定义;其余项的**语义归对应文档**,但**字面量集中登记在此**以保证 union 单一来源(下游只 import,不另写)。

```ts
export type SyluxErrorCode =
  // ── ★ 本文件拥有(契约校验) ──
  | 'OUTPUT_SCHEMA_VIOLATION'   // safeParse / 跨字段结构违例,重试耗尽
  | 'EVIDENCE_REQUIRED'         // critic/critique/ack(done) 空 evidence(C1/C2)
  | 'EVIDENCE_UNVERIFIABLE'     // evidence 锚点复算失败 / 无强证据(§8.3)
  | 'EVIDENCE_COMMAND_UNSAFE'   // command 证据复跑违反沙箱安全约束(H3,§8.1)
  | 'EVIDENCE_INFRA_DEGRADED'   // v2.1:复跑器/沙箱自身故障 → 该证据 weak,不连坐 critic(H12,§8.3/§8.4)
  | 'MESSAGE_SIZE_EXCEEDED'     // 单条 message 超 MAX_MESSAGE_BYTES(H4,C10)
  | 'WORKTREE_PATH_VIOLATION'   // files/file_ref 路径越界(C6)
  | 'DANGLING_REPLY_REF'        // inReplyTo 悬空(C8)
  | 'INVALID_DONE_SELF_ACK'     // 同轮自 done 又自 ack(C3)
  | 'INVALID_SYSTEM_SENDER'     // system 消息 from 非 orchestrator,或 orchestrator 发非 system(C7/C9)
  | 'EMPTY_ROUND_PLAN'          // playbook 排不出本轮发言计划(语义归引擎 03,§15.4)
  // ── 子进程 / 适配层(归 04 / 事实地基 A·B) ──
  | 'SUBPROCESS_SPAWN_FAILED'   // 子进程启动失败(裸名/.cmd/exe 缺失)
  | 'SUBPROCESS_CRASHED'        // 运行中非零退出 / 信号杀
  | 'SUBPROCESS_TIMEOUT'        // 硬墙钟超时被杀
  | 'SUBPROCESS_CANCELLED'      // 人工 abort / 上层取消
  // ── 引擎(归 03 / 04) ──
  | 'ENGINE_FATAL'              // 引擎不可恢复内部错(状态机非法转移等)
  | 'ROUND_LIMIT_EXCEEDED'      // 触发 maxRounds(刹车 07)
  | 'CONVERGENCE_STALL'         // 连续 N 轮无新 evidence 指纹(刹车 07,§9.3)
  | 'TOKEN_BUDGET_EXCEEDED'     // 触发 token 预算(刹车 07,事实地基 D)
  // ── 安全(归 09) ──
  | 'PROVIDER_CONFIG_INVALID'   // argv/-c 现疑似 key(provider 05 / 安全 09 预扫描)
  | 'INJECTION_BLOCKED'         // 内容防火墙拦下喂对面的注入特征(R8,09)
  | 'EGRESS_SECRET_BLOCKED'     // 中转源码出境 secret scan 命中(R8,09)
  // ── WS / 面板(归 08 / 11) ──
  | 'WS_UNAUTHORIZED'           // ticket 无效 / 缺失
  | 'WS_ORIGIN_REJECTED'        // Origin 不在白名单
  | 'WS_TICKET_EXPIRED'         // 一次性 token 过期 / 已用
  | 'WS_PERMISSION_DENIED'      // 观战权限尝试 control 操作
  | 'WS_RATE_LIMITED'           // 连接 / 消息超频
  | 'WS_PAYLOAD_INVALID'        // 入站控制帧 schema 违例
  | 'WS_PROTOCOL_ERROR'         // 帧序 / 版本不匹配
  // ── worktree(归 06) ──
  | 'WORKTREE_CONFLICT'         // round 末合并冲突,硬停回灌
  | 'WORKTREE_GIT_FAILED'       // git 操作失败(add/merge/diff 等)
  // ── Fusion(归 21,远景) ──
  | 'FUSION_PANEL_FAILED'       // panel 成员多数失败,无法合成
  | 'FUSION_JUDGE_FAILED'       // judge 裁决失败 / 超时
  // ── provider / config(归 05 / 16) ──
  | 'PROVIDER_UNAVAILABLE'      // 中转/base_url 不可达,热换兜底耗尽
  | 'CONFIG_INVALID';           // provider/playbook/预算配置 schema 违例

/** 自定义错误基类:继承 Error 带 code(总体规划 §11.3 不吞错原则)。 */
export class SyluxError extends Error {
  constructor(
    readonly code: SyluxErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SyluxError';
  }
}
```

> **分域登记纪律(I1 延伸到错误码)**:union 字面量**只在本文件出现一次**;下游文档引用某码时写 `import type { SyluxErrorCode }`,**禁止**另立自己的 union 子集或字符串字面量当错误码用。新增码必须在此登记并标注拥有文档,否则 15 的穷举 `Record` 编译红——这个编译红是**特性**(强制全集同步),不是 bug。
> **需回填**:总体规划 §11.2 与各下游文档凡“建议回填 02”的散落错误码,以本表为准对齐(§15.4 给逐项)。`EVIDENCE_INFRA_DEGRADED` 是 v2.1 新增(H12),用于复跑器自身故障的 `system` 告警 code,非打回码(不阻断本轮,§8.4)。

---

## 13. 契约测试矩阵(交付验收锚点)

本节给 `@sylux/shared` 单测的必测项(对接总体规划 §12 T1.2)。每条都是“给定输入 → 期望 safeParse/validate 结果”,可直接落 vitest。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| V1 | 合法 message | 全字段齐、evidence 空、kind=propose | `safeParse.success===true` |
| V2 | critic 空 evidence | role=critic, evidence=[] | `EVIDENCE_REQUIRED` |
| V3 | critique 仅 spec_quote | kind=critique, evidence=[spec_quote] | `EVIDENCE_UNVERIFIABLE`(weak 不解锁) |
| V4 | critique file_ref quote 不符 | quote 与区间内容不一致 | `EVIDENCE_UNVERIFIABLE` |
| V5 | critique file_ref quote 正确 | quote 与区间归一化后一致 | `ok:true`,contentHash 被中枢回填 |
| V6 | file_ref 行区间反向 | lineEnd<lineStart | `OUTPUT_SCHEMA_VIOLATION`(C4) |
| V7 | rename 缺 renamedFrom | changeKind=rename, 无 renamedFrom | `OUTPUT_SCHEMA_VIOLATION`(C5) |
| V8 | 路径越界 | file_ref.path 含 `../` | `WORKTREE_PATH_VIOLATION`(C6) |
| V9 | system 非 orchestrator | kind=system, from=codex | `INVALID_SYSTEM_SENDER`(C7) |
| V10 | inReplyTo 悬空 | 指向不存在 id | `DANGLING_REPLY_REF`(C8) |
| V11 | done 自 ack | 同轮 from 既 done 又 ack | `INVALID_DONE_SELF_ACK`(C3) |
| V12 | command 未实跑 | 无 runCommandSandboxed,actual contains expected | `EVIDENCE_UNVERIFIABLE`(weak,不取信自报,H2) |
| V13 | command 沙箱复跑通过 | 注入 runCommandSandboxed,真实 stdout 匹配 | `ok:true` |
| V13b | command 沙箱复跑不符 | 真实 stdout 不匹配 | `EVIDENCE_UNVERIFIABLE` |
| V13c | command 不安全 | cmd 含 `curl ...|sh` / 疑似 key | `EVIDENCE_COMMAND_UNSAFE`,该证据 fail |
| V14 | agent payload 子集 | 仅 {kind,body,files,evidence} | `agentMessagePayloadSchema` 通过;无 id/ts/seq |
| V15 | AgentEvent 首事件 | session_started.sessionId='' | 失败(`.min(1)`,I5) |
| V16 | contentHash 跨平台 | 同内容 CRLF vs LF | 中枢派生 hash 相同(`normalizeContent`,§9.1) |
| V17 | 指纹差集 | 两轮相同 evidence | 第二轮新指纹集为空(§9.3 → stall 计数) |
| V18 | jsonl 往返 | encode→decode 每种 recordType | `ok:true` 且 deep-equal |
| V19 | jsonl 残行恢复 | 末行截断 | decode 该行 `ok:false`,前行不受影响 |
| V20 | BoardState 投影 | 回放一串 record | 重建 `messages/rounds/agents/status` 正确,按 seq 排序 |
| V21 | message 超限 | body 超 64KiB 或整体超 256KiB | `MESSAGE_SIZE_EXCEEDED`(C10/H4) |
| V22 | seq 单调 | append 三条 | seq 严格 0,1,2 无洞;乱序输入按 seq 排序(I6) |
| V23 | jsonl 行超限 | 单行超 512KiB | decode `ok:false`(MAX_JSONL_LINE_BYTES) |
| V24 | usage 缺失 | final_message 无 usage | 刹车按基线保守上界,非 0(H6) |
| V25 | runStatus 非法转移 | done→running | 抛内部断言 / 回放丢弃告警(§10.2 矩阵) |
| V26 | orchestrator 发非 system | from=orchestrator, kind=propose | `INVALID_SYSTEM_SENDER`(C9) |
| V27 | 复跑器基础设施故障(H12) | runCommandSandboxed 返 {ok:false,reason:'infra'} | 该证据=weak;非 fail;不计无效发言;若 critic 无其他强证据则 `EVIDENCE_UNVERIFIABLE` 打回(非连坐) |
| V28 | 复跑命令不安全(H12) | runCommandSandboxed 返 {ok:false,reason:'unsafe'} | `EVIDENCE_COMMAND_UNSAFE`,该证据 fail + 计无效发言 |
| V29 | M1 无文件系统(H13) | capabilities.fs=false, critique 仅 file_ref+quote | file_ref 判 weak → `EVIDENCE_UNVERIFIABLE`(验证 M1 不假绿) |
| V30 | M1 实跑 command 补强(H13) | capabilities.fs=false, sandbox=true, command 实跑匹配 | `ok:true`(M1 经 command 路径可得强证据) |
| V31 | status_changed code 往返(D5) | encode {status:'limit',code:'TOKEN_BUDGET_EXCEEDED',reason:'...'} → decode | deep-equal,code/reason 各就位 |
| V32 | 错误码 union 穷举(A1) | `Record<SyluxErrorCode, X>` 缺任一码 | TS 编译红(全集同步守卫,§12) |
| V33 | usage output 缺失(H15) | final_message.usage 有 input 无 output / 整体缺 | 成本估算 output≠0,按 regime 上界;非 0 |

---

## 14. 收尾:本文件的权威性声明

1. **唯一定义**:`Message`、`EvidenceItem`、`FilePatch`、`AgentMessagePayload`、`AgentEvent`、`TokenUsage`、`Round`、`RunStatus`、`BoardState`、`JsonlRecord` 及其涉及的全部枚举(`Role`/`MessageKind`/`AgentId`),**有且只有本文件一处 `z.object`/`z.enum`/`z.discriminatedUnion` 定义**,物理落 `@sylux/shared/src/blackboard.schema.ts`。
2. **引用而非另写**:技术栈、引擎(03)、适配层(04)、provider(05)、worktree(06)、刹车(07)、面板(08)、安全(09)等所有文档,涉及上述类型时一律以 `@sylux/shared` 路径引用本文件,**禁止在任何地方另定义一份**。任何跨文档字段漂移以本文件为准(焊死红队 R1)。
3. **§2 已被取代**:总体规划 §2 的 zod 片段是早期镜像,与本文件不一致处一律以本文件为准;实现者只读本文件。完整字段级差异与回填动作见 §15 台账。
4. **演进纪律**:破坏性变更(§1.2 列举)必须 `SCHEMA_VERSION+1` + jsonl 迁移分支(§7.4)+ 回放测试(§13 V18–V20)。非破坏性新增(可选字段 / union 加成员)不强制升版,建议 CHANGELOG 标注。

---

## 15. 与总体规划 §2/§11 的完整对账台账(焊死 R1 / H8)

v1 声称“逐字节兼容”但实际已多处分歧。本节把**每一处差异**列清,并标注回填动作。原则:**本文件为权威,§2/§11 按此回填**;差异分两类——“收紧/护栏”(向后兼容,读旧数据不破)与“扩字段”(新增 optional/必填派生字段)。

### 15.1 EvidenceItem 差异

| 字段 | 总体规划 §2.2 | 本文件 v2 | 类型 | 回填动作 |
|---|---|---|---|---|
| `file_ref.lineStart/End` | `int().nonnegative()` | `int().positive()` | 收紧 | §2.2 改 positive(行号 1-based) |
| `file_ref.contentHash` | agent 提供、`z.string()` 必填 | 中枢派生、`.max(64).optional()` | **语义反转(H1)** | §2.2 改为中枢派生 + 加 `quote` 字段 |
| `file_ref.quote` | 无 | `.max(8192).optional()`(新核验入口) | 扩字段 | §2.2 新增 |
| `command.matchMode` | 无 | `enum(...).default('contains')` | 扩字段 | §2.2 新增 |
| `command` 自报 actual | 隐含可作核验 | 未实跑仅 weak,不解锁 C1(H2) | 语义收紧 | §2.2 注释更新 |
| 各 string 字段 | 无上限 | 加 `.max()`(H4) | 护栏 | §2.2 同步 |

### 15.2 Message 差异

| 字段 | 总体规划 §2.4 | 本文件 v2 | 类型 | 回填动作 |
|---|---|---|---|---|
| `seq` | 无 | `int().nonnegative()` 必填(排序权威 I6/H5) | 扩字段 | §2.4 新增 |
| `id/runId` | `z.string()` | `.min(1)` | 收紧 | §2.4 同步 |
| `ts` | `z.number().int()` | `.nonnegative()`,且注明禁排序 | 收紧 | §2.4 同步 |
| `body` | `z.string()` | `.max(65536)`(H4) | 护栏 | §2.4 同步 |
| `files/evidence` | 无条数限 | `.max(256)` / `.max(128)`(H4) | 护栏 | §2.4 同步 |
| `inReplyTo` | `z.string().optional()` | `.min(1).optional()` | 收紧 | §2.4 同步 |
| `schemaVersion` | 无(v1 02 草案曾加,现移除) | 不在内存态,仅 jsonl 行(I4) | 澄清 | 无需改 §2.4 |

### 15.3 AgentEvent 差异

| 字段 | 总体规划 §2.6 | 本文件 v2 | 类型 | 回填动作 |
|---|---|---|---|---|
| `session_started.sessionId` | `z.string()` | `.min(1)` | 收紧 | §2.6 同步 |
| `final_message.usage` | 无 | `tokenUsageSchema.optional()`(挂计量) | 扩字段 | §2.6 新增 |
| usage 缺失语义 | 未定义 | 按基线保守上界,非 0(H6) | 新规则 | §2.6 注释 + 刹车 07 |

### 15.4 错误码差异(§11.2)—— v2.1 全集对齐(A1/COV-1)

v2.1 把 `SyluxErrorCode` 从 16 项补到分域全集(§12)。相对总体规划 §11.2 与各下游散落用法,**新增/登记**的码:契约域 `DANGLING_REPLY_REF`/`INVALID_DONE_SELF_ACK`/`INVALID_SYSTEM_SENDER`/`EVIDENCE_COMMAND_UNSAFE`/`MESSAGE_SIZE_EXCEEDED`/`EVIDENCE_INFRA_DEGRADED`/`EMPTY_ROUND_PLAN`;子进程域 `SUBPROCESS_CRASHED`/`SUBPROCESS_TIMEOUT`/`SUBPROCESS_CANCELLED`;引擎域 `ENGINE_FATAL`;安全域 `INJECTION_BLOCKED`/`EGRESS_SECRET_BLOCKED`;WS 域 7 项(`WS_*`);worktree 域 `WORKTREE_GIT_FAILED`;Fusion 域 `FUSION_PANEL_FAILED`/`FUSION_JUDGE_FAILED`;provider/config 域 `PROVIDER_UNAVAILABLE`/`CONFIG_INVALID`。全部为 union 加成员(向后兼容)。回填动作:① 总体规划 §11.2 与下游各文档删除自立的错误码字面量,改 `import type { SyluxErrorCode }`;② 评测 15 的 `Record<SyluxErrorCode,…>` 穷举据本全集对齐(原本编译红即因缺项);③ 字面量集中本文件,下游零散“建议回填 02”全部闭合于此表。

### 15.5 新增常量(§5.3)

`MAX_MESSAGE_BYTES` / `MAX_JSONL_LINE_BYTES` / `MAX_FINGERPRINTS_PER_ROUND` 为本文件新增 DoS 护栏常量,总体规划无对应项;落 `@sylux/shared`,config(16)可覆盖。回填动作:总体规划 §2 增一句“资源上限常量见 02 §5.3”。

### 15.6 fingerprint 差异(总体规划 §7.2,**新发现的 R1/I1 违规 + R5 漏洞**)

总体规划 §7.2 携带了一份**独立的 `fingerprint()` 定义**(非 zod,但同属 I1 “单一权威”管辖的契约函数),与本文件 §9.2 权威定义有两处分歧,其中第一处是**会被 agent 利用绕过 stall 的真漏洞**:

| 分支 | 总体规划 §7.2 | 本文件 v2 §9.2 | 类型 | 风险 / 回填动作 |
|---|---|---|---|---|
| `command` | `c:${norm(cmd)}=>${hash(e.actual)}` —— **把 `actual` 喂进指纹** | `c:${hash(cmd)}:${hash(expected)}:${matchMode}` —— **`actual` 不参与** | **语义反转(H2 漏洞)** | §7.2 含 `actual` → 失控/对抗 agent 对同一命令每轮回填不同 `actual` 串即得不同指纹 → 永远“有新证据” → **stall 检测被绕过(直接打穿 R5)**。这与 H2“`actual` 自报不取信”同源:`actual` 既不进核验也不进指纹。回填动作:§7.2 改为引用本文件 §9.2,删 `hash(e.actual)`,改用 `expected+matchMode`(“同一断言”稳定指纹) |
| `file_ref` | `f:${normPath(e.path)}:...:${e.contentHash}` —— 直用 agent 自填 `contentHash` | `f:${e.path}:...:${中枢派生 contentHash}`,无则 `:?` 占位 | 语义收紧(H1) | §7.2 假定 `contentHash` 由 agent 提供且可信;本文件改为中枢核验后回填(H1)。回填动作:§7.2 注明 `contentHash` 为中枢派生,未核验留 `?`(§9.3) |

> **为何这是 R1 的活体反例**:§7.2 不是“早期镜像被取代”那么简单——它是一份**仍在并行存在、且语义已经错的**契约函数定义。这正是 R1 警告的“跨稿漂移导致实现者照错的那份写”。回填后,总体规划 §7.2 的代码块必须降级为**只引用** `@sylux/shared` 的 `fingerprint`(§9.2),不得保留独立函数体。

> **回填校验(交付前自检)**:实现期对 §2/§7.2/§11 做一次 `diff` 核对本台账每一行;CI 加两条契约一致性测试——(a) 从本文件 zod 生成 JSON Schema 快照,若总体规划再出现独立 zod 片段,grep 报警;(b) grep 全仓 `function fingerprint(`,命中数必须 ==1(只允许 `@sylux/shared/fingerprint.ts`),§7.2 等处再现独立函数体即 CI 红(焊死 I1 对“契约函数”而非仅“类型”的覆盖)。

### 15.7 v2.1 新增对账项(D5 / D6 / H12 / H13 / H14 / B1)

| 项 | 下游现状 | 本文件 v2.1 | 回填动作 |
|---|---|---|---|
| `status_changed.code`(D5) | 04 调 `setStatus(status, code, reason)` 三参;02 §7.1 只有 `reason?` | §7.1 加 `code?`(SyluxErrorCode 字面量,用 string 避免循环依赖);`reason` 降人读 | 04 `setStatus` 第二参语义=`code`(机读),第三参=`reason`(人读);02 `status_changed` 行据此落 |
| `validateMessage` 签名(D6) | 03 `EngineDeps.validate(payload, round)` vs 02 `validateMessage(msg: Message, ctx)` | §8.1 注明二者**非同函数**:03 是适配器,盖章成 `Message` 后委托本函数 | 03 §4.3 注明内部调 `@sylux/shared.validateMessage`,入参经盖章桥接 |
| 复跑基础设施故障(H12/COV-3) | COV-3 指出未分类“沙箱自身崩” | §8.1/§8.3 `runCommandSandboxed` 返三态,`infra` 故障判 `weak` + `EVIDENCE_INFRA_DEGRADED` system 告警,不连坐 critic | 08(复跑基础设施)按此区分 unsafe/infra;15 stall 计数排除 infra weak |
| M1 无文件系统(H13/FEAS-2) | M1 不写文件但 C1 要 file_ref 强核验 | §8.1 `capabilities.fs`;§8.5 给契约出口(策略归 03/25) | 25 裁决 M1 走只读 checkout(推荐)或 playbook `evidencePolicy`;契约 C1 语义不变 |
| 面板 XSS 不可信串(H14/RS-B2) | 10 全文无 sanitize/CSP;redact 不转义 | §5.4 把 agent 可控字段标“不可信数据” | 08/10 渲染前 escape + CSP,禁 innerHTML 直插;09 redact 不负责 HTML 转义 |
| `MAX_JSONL_LINE_BYTES`(B1) | 06 §6.2 重声明 1MiB 且误称“05 权威” | §5.3 权威 512KiB,注明勿重声明 | 06 删重声明,改 `import { MAX_JSONL_LINE_BYTES }`;值统一 512KiB |
| usage output 缺失(H15/ROC-M1) | v1 只兜 input,output 当 0 → maxCostUsd 失明 | §6.3 output 缺失也按 regime 上界估,degradable 只 warn 但成本按上界 | 07 成本计量、19 字段漂移分级据此;`Round.usage`/`totalUsage` 标 estimated 位(字段归 04/10) |



