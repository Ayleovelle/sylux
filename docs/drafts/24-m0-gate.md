# 24 · M0 可行性闸与开工清单(实测任务卡 + 前置环境)· v2

> **本文件地位**:本文件是 sylux 从「纸面规格」迈向「敲第一行实现代码」之间的**唯一闸门**。它把事实地基(`docs/PROBED-FACTS.md`,2026-06-20 本机实测)里**仍标【待实测】**的关键假设,逐条转成**可勾验的实测任务卡**(命令 / 期望 / 通过标准 / 失败回退),外加**开工前置环境清单**。M0 闸全绿(或带记录的有条件通过)之前,不开工实现期编码。
>
> **引用而非另写**:本文件**不重定义**任何类型——`Message`/`EvidenceItem`/`AgentEvent`/`AgentMessagePayload`/`buildAgentOutputJsonSchema` 等一律引用「黑板协议(02)」(`@sylux/shared/src/blackboard.schema.ts`)。涉及适配器实现细节引用 05(codex)/06(claude),worktree 引用 09,刹车引用 04/07,并发引用 17,安全引用 08。
>
> **事实地基纪律**:事实地基 A–G 节已把 spawn 约束、事件流、output-schema 经中转成形、resume 成本累积、resume 参数集不对称、token 计量口径**从假设变成事实**。本文件**绝不**把这些重新标【待实测】;只处理事实地基显式未覆盖、或留给 M0 收口的项(见各文档 §「待实测/M0 验证锚点」)。
>
> **事实标注约定**:凡基于假设而非本机实测的结论,显式标【待实测】;一旦本文件某任务卡跑通,回填对应文档(§9)并去标。

> **v2 硬化:红队/交叉审查 findings 吃掉对照(本文件负责范围)**
> - **FEAS-7 / red-feasibility(M0 P2 schema 探针 `require('./packages/shared/dist')`,但 shared 是 M1·T1.2 才建,M0 §禁建包 → 闸门依赖自己不让建的产物)** → §3.2 P2 **重构为两段**:M0 段用一次性 `probe-schema-size.mjs` **内联冻结副本**直接量(零 `pnpm build`、不 `require` dist),M1·T1.2 段对正式产物**复测核对**;并新增「02 payload schema 字段集需先冻结、改则 P2 重跑」硬约束。对齐 12 §158/§3.5/Q3 与 25 §1「M0 不建包」。
> - **RS-B1 / red-security(注入防御 L4 垫底=沙箱真断网,整条 RCE/exfil 防线押在此;关键词扫描/边界标记自认可绕)** → §4 G4(codex `workspace-write` 出网)**升级 major→blocker**,与 G3 并列为开工前必须有结论的安全闸;§1.3/§6.3/§10 同步。
> - **COV-3 / x-coverage(复跑器/沙箱基础设施**自身**失败未分类,误判连坐 critic 与 stall 计数)** → §4.1 新增「中枢侧基础设施故障」处置规则:判 `weak` + 记 `system` + **不连坐 critic、不计入 stall**。
> - **COV-7 / x-coverage(五份红队报告当时不存在,六篇 v2 建立在自检)** → 截至本 v2 交付,`x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost` 五报告**已产出**;本文件 v2 的硬化据其实测复核(非自检),上方 FEAS-7 / RS-B1 / COV-3 三条即逐条吃掉的产物。
> - **A1 / COV-1(02 §12 `SyluxErrorCode` union 缺 17+ 下游已用码)** → 非本文件权威范围(归 02 回填,R1 单一权威);§9 回填纪律已注明「类型相关一律改 02」,本文件用到的 `system`/`weak` 分类与错误码**只引用不另定义**,留 openQuestion 提示 02 定稿补全。

---

## 0. 怎么用这份文件

三段式工作流,顺序不可乱:

1. **过环境闸(§2)**:开工前置环境清单(EP-x)全部勾绿。任一项红 = 不进 M0 实测(连工具都没齐,测了也是噪声)。
2. **跑实测任务卡(§3 核心五项 + §4 归集项)**:每条任务卡是自包含的「命令 / 期望输出 / 通过标准 / 失败回退」单元,可独立执行、独立勾验。核心五项(P1–P5)是任务简报点名的硬闸,**必须全部有结论**;§4 归集项按阻断分级(§1.2)决定是否阻断开工。
3. **过决策闸(§6)**:把 P/G 各项结论填进签收表,按 §1.3 闸门决策矩阵判「通过 / 有条件通过 / 阻断」。通过后才回填文档(§9)并开工。

> **省钱原则(贯穿全篇)**:事实地基 D 已证 `resume 不省 token、基线底价 ≈18.7k input/回合、N 轮 ≈ base×(1+…+N)`。M0 实测里**凡能用 fake-CLI / mock / 离线脚本验证的,绝不烧真中转 token**(§5 给探针脚手架);只有「经中转才有意义」的项(成形稳定性、限流、resume 缓存账单)才打真 provider,且每条标注预估 token 成本,集中一次跑完。

---

## 1. M0 闸的定义

### 1.1 M0 闸要回答的唯一问题

> **「这套纸面架构,在本机(Win11 China + mouubox 中转 + codex 0.141.0 + claude 2.1.183)上,能不能真的搭起来跑通一个最小回合,且关键省钱/安全/正确性假设不塌?」**

不是「实现完了没」,而是「**开工的前提假设是否成立**」。M0 只验假设、不写产品代码;产出是「结论 + 回填 + 放行/阻断」,不是功能。

### 1.2 阻断分级(每条任务卡挂一个)

| 级别 | 含义 | 对开工的影响 |
|---|---|---|
| **blocker** | 假设若不成立,**架构主路径塌**,无替代或替代代价极大 | 必须有明确结论;不成立则**停工**改设计,直到替代路径定下来 |
| **major** | 假设若不成立,**某条已写好的实现路径作废**,但有文档已备的退化路径 | 必须有结论;不成立则**切退化路径**(文档已备),记 openQuestion,可开工 |
| **minor** | 调参 / 体验 / 非关键平台分支 | 可带【待实测】开工,M1/M2 校准;不阻断 |

### 1.3 闸门决策矩阵(§6 签收据此判定)

| 结果组合 | 闸门判定 | 动作 |
|---|---|---|
| 全部 blocker+major = pass | **通过** | 回填文档去标,开工 |
| blocker 全 pass,某 major = fail 但已切文档备好的退化路径 | **有条件通过** | 记 openQuestion + 切路径,开工 |
| 任一 blocker = fail(P4/G3/G4)且无已备防御层 | **阻断** | 停工,回设计层重做该假设的替代方案,再过闸 |
| 任一核心 P1–P5 无结论(没跑/跑挂没定论) | **阻断** | 不许「跳过」,必须有结论才放行 |

---
## 2. 开工前置环境清单(EP-x,全绿才进 §3)

环境闸先于实测闸。下表每行一个可勾项,带**验证命令**与**通过标准**;凡本机 2026-06-20 已确认的标注「✅ 已确认」(免重测,但实现期 CI 仍应断言)。

### 2.1 运行时与包管理

| # | 项 | 验证命令 | 通过标准 | 现状 |
|---|---|---|---|---|
| EP-1 | Node ≥ 20 LTS(NodeNext / `verbatimModuleSyntax` 需要,12 §techstack) | `node --version` | ≥ v20;本机 v22.13.0 | ✅ 已确认 v22.13.0 |
| EP-2 | pnpm 已装且进 PATH(13 monorepo:`pnpm -r`) | `pnpm --version` | ≥ 9;有版本号 | ⚠ 本机 bash PATH 未见,需确认(可能仅在 PowerShell PATH);装:`npm i -g pnpm --registry https://registry.npmmirror.com` |
| EP-3 | npm 可用(装全局工具兜底) | `npm --version` | 有版本号 | ⚠ 同 EP-2,确认 PATH;npm 随 Node 自带 |
| EP-4 | npm registry 走 npmmirror(本机官方源极慢,见 memory `npm-mirror`) | `npm config get registry` | `https://registry.npmmirror.com`,或装包时显式 `--registry` | ⚠ 设:`npm config set registry https://registry.npmmirror.com` |

### 2.2 git(worktree 隔离 09 的地基)

| # | 项 | 验证命令 | 通过标准 | 现状 |
|---|---|---|---|---|
| EP-5 | git ≥ 2.38(`merge-tree --write-tree` 无副作用合并,09 §5.3) | `git --version` | ≥ 2.38 | ✅ 已确认 2.44.0.windows.1 → **走现代 merge-tree 路径,不需 09 §5.3 临时 worktree 退化方案**(回填 09,见 §9) |
| EP-6 | `git merge-tree --write-tree` 本机真支持(版本号够≠功能编进) | 见 §3 P4 任务卡 | 退出码与冲突输出符合 09 §5.3 契约 | 【M0 P4 验】 |
| EP-7 | git 全局 `user.name`/`user.email` 已配(worktree commit 需要,否则 commit 报错) | `git config --get user.name && git config --get user.email` | 两者均非空 | ⚠ 未配则:`git config --global user.name/.email`(09 worktree 内 commit 依赖) |

### 2.3 codex CLI(适配器 05 的地基,事实地基 A)

| # | 项 | 验证命令 | 通过标准 | 现状 |
|---|---|---|---|---|
| EP-8 | codex 真 exe 存在(**不依赖 PATH shim**,事实地基 A) | `test -f "G:\npm-global\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe" && echo OK` | 打印 `OK` | ✅ memory `codex-cli-setup` 记录路径;实现期 05 §2 exe 解析器须能定位 |
| EP-9 | codex 版本固定(行为基线) | `codex.cmd --version`(仅查版本,允许走 shim) | `codex-cli 0.141.0` | ✅ 已确认 0.141.0 |
| EP-10 | `~/.codex/config.toml` 中转 provider 就位(mouubox/Sub2API) | 读 `~/.codex/config.toml` 确认 `model_provider=custom`,`base_url=https://api.mouubox.com`,`wire_api=responses` | 字段齐;key 不在 argv(走 config/env,安全 08) | ✅ memory 记录;**07 §14.2 待验**:改为 `-c model_providers.custom.env_key=` 动态注入是否兼容(见 §4 G6) |

### 2.4 claude CLI(适配器 06 的地基,事实地基 F)

| # | 项 | 验证命令 | 通过标准 | 现状 |
|---|---|---|---|---|
| EP-11 | claude CLI 可用且版本固定 | `claude --version` | 有版本号(06 §0.3 实测基线 2.1.183) | ⚠ 确认本机版本 = 06 基线;偏离则 06 §0.3 实测表需复核 |
| EP-12 | claude headless 真 exe / shim 形态明确(Windows spawn 坑,事实地基 F + 06 §0.3「.cmd→.exe 非 .ps1/cli.js」) | 见 §3 P1/P2 任务卡 spawn 探测 | spawn 真 exe + stdin/stream-json 通,无 `%1 is not valid Win32` | 【M0 P1 验】 |
| EP-13 | claude 中转/鉴权就位(与 codex 可同可不同 provider) | `claude -p --output-format json "ping"`(最小一次,烧少量 token) | 返回合法 json result | ⚠ 最小连通性,纳入 §3 P3 一并跑 |

### 2.5 工作目录与隔离

| # | 项 | 验证命令 | 通过标准 | 现状 |
|---|---|---|---|---|
| EP-14 | 存在可写的 sylux 工作根 + 临时 worktree 父目录(09) | `test -d G:\sylux && echo OK` | `OK`;有空间放 worktree 副本 | ✅ G:\sylux 存在 |
| EP-15 | `.syluxignore` 白名单约定就位(安全 08:中转源码出境 secret scan) | 确认 08 §白名单规则有落点(实现期建文件) | 规则文档化(08);M0 不强制建文件 | minor,实现期建 |
| EP-16 | 终端 UTF-8 输出(事实地基 A:PowerShell `>` 重定向转 UTF-16 乱码) | 中枢用 Node 捕获 stdout,**不经 shell 重定向** | 测脚本一律 Node spawn 捕获,不用 `>` | ✅ 事实地基 A 已定;探针脚手架(§5)遵守 |

> **EP 闸结论写法**:每项填 `✅pass / ⚠todo / ✗fail`。EP-1/5/8/9/14/16 已确认;EP-2/3/4/7/11/13 需开工者本机各跑一条命令确认(分钟级,零 token);EP-6/12 并入 §3 实测。EP 全绿前不进 §3。

---
## 3. 核心实测任务卡(P1–P5,任务简报点名的硬闸)

任务简报点名仍标【待实测】的五项:① claude `--session-id` 预设;② `--json-schema` 长度上限;③ 复杂嵌套 schema 经中转稳定性;④ worktree 合并真机演练;⑤ 并发限流阈值。逐条成卡。每卡格式统一:**目标 / 关联 / 分级 / 命令 / 期望 / 通过标准 / 失败回退 / token 成本**。

> 命令示例里 `$CODEX_EXE` = 事实地基 A 的真 exe 绝对路径;`$CLAUDE_EXE` = 06 §0.3 解析出的 claude 真 exe。Windows 下 spawn 一律走 Node(§5 脚手架),示例中的 shell 形式仅为表意,真跑用 §5 的 `probe.mjs`。

### 3.1 P1 — claude `--session-id` 预设能力

| 字段 | 内容 |
|---|---|
| **目标** | 确认 claude headless 能否**由中枢预设** session id(而非只能 claude 自生成),以对齐 02 不变量 I5(`session_started.sessionId` 中枢可控)与崩溃恢复 resume(19 §6.5)。 |
| **关联** | 事实地基 F(help 未显式见 `--session-id`,`--resume` 存在);23 §6.1;06 §0.3(CF「`--session-id` 预设确认存在」需坐实);19 跨版本 resume。 |
| **分级** | **major**(不成立有退化路径:改「claude 自生成 id,中枢首事件 `session_started` 捕获后记录」,见失败回退)。 |

命令(三步,纯本地 + 一次最小真调):

```bash
# 1) 确认 flag 是否存在(零 token)
$CLAUDE_EXE --help | grep -i "session-id"        # 期望:列出 --session-id <uuid>;若无→走回退

# 2) 预设一个 uuid 起会话(最小 prompt,烧少量 token)
SID=$(node -e "console.log(crypto.randomUUID())")
echo "ping" | $CLAUDE_EXE -p --session-id "$SID" --output-format json --bare > r1.json

# 3) 用同一 SID resume,验证续接 + id 一致
echo "say pong" | $CLAUDE_EXE -p --resume "$SID" --output-format json --bare > r2.json
```

| 字段 | 内容 |
|---|---|
| **期望** | (1) `--help` 含 `--session-id`;(2) `r1.json` 的会话标识 == `$SID`;(3) `r2.json` resume 成功且关联同一会话,无「session not found」。 |
| **通过标准** | 预设 id 被接受**且** resume 用同一 id 续接成功 → P1=pass,02 I5 在 claude 端落点 = 「中枢预设 id」。 |
| **失败回退** | ✗flag 不存在 / 不被接受 → **退化路径**:claude 端 `sessionId` 改为「适配器捕获 claude 首事件回吐的 session id」(06 §6.4 `FirstEventGate` 已支持 `onSession`),中枢不预设、只记录;02 I5 仍满足(拿到才标 resumable)。记 openQuestion,major 不阻断。 |
| **token 成本** | 步 2+3 ≈ 2 个最简回合;claude 端成本模型按 06 §7.3(prompt 缓存折价),量级远低于 codex 18.7k 地板;预估 < 5k input 合计。 |

> **附带产出**:本卡同时坐实 EP-12(claude spawn 真 exe 形态)与 19 §6.5「同版本内旧 sessionId 可 resume」;跨版本兼容性仍是 19 的 minor 待实测,不在 P1 范围。

### 3.2 P2 — `--json-schema` 内联串长度上限 + 本契约 schema 实际体积

| 字段 | 内容 |
|---|---|
| **目标** | 量出 `buildAgentOutputJsonSchema()`(02 §6.2,摊平 `$refStrategy:'none'` 后含 evidence 三锚点 `discriminatedUnion`)的**实际 JSON 串长度**,与 claude `--json-schema` 内联串的 Windows 命令行上限(事实地基 F ≈32KB)对比,决定常态走「内联」还是「stream-json 输入」降级。 |
| **关联** | 02 §6.2【待实测】;06 §4(schema 三级降级)/§11 M0-1;23 §6.1 INV-A6;12 §3.5/Q3。 |
| **分级** | **major**(超限有退化路径:claude 走 `stream-json` 输入 / codex 写文件无此限,06 §4 已备三级)。 |
| **FEAS-7 硬化(闸门不依赖未来产物)** | P2 **拆两段**,根因:`buildAgentOutputJsonSchema()` 实现落 `@sylux/shared`,而建 shared 是 **M1·T1.2**,排在 M0 **之后**;25 §1「M0 不建任何包」+ 24 顶部「全绿前不开工编码」。<br>① **M0 段(本卡,零包零 token)**:一次性 `probe-schema-size.mjs` **内联**当前 02 §6.1 `agentMessagePayloadSchema` 的**冻结副本** + `zodToJsonSchema(..,{$refStrategy:'none',target:'jsonSchema7'})` 直接量体积。脚本即弃,**不** `require('./packages/shared/dist/...')`,不触发 `pnpm build`。<br>② **M1·T1.2 段(回填核对,非 M0 闸内)**:`@sylux/shared` 建成后,对**正式** `buildAgentOutputJsonSchema()` 产物复测体积,与 M0 段数值核对;偏差 > 10% 或跨越 24KB 阈值则以正式产物为准、回填 02 + 本卡结论。<br>**前置冻结约束**:M0 段量的是「冻结副本」,故 P2 跑前必须先冻结 02 §6.1 payload schema **字段集**(字段增删 / evidence 锚点形状变更直接改体积)。02 一旦改 payload schema 形状,**P2 必须重跑**(本约束写入 §9 回填纪律)。注:A1/COV-1 的 `SyluxErrorCode` union 补全只改**错误码枚举值**、不改 payload schema 字段结构,**不触发 P2 重跑**(除非 message body 内嵌错误码字段且参与 schema 约束——当前 02 §6.1 不内嵌,故无影响)。 |

命令(纯本地,**零 token**——只算体积,不调中转;**不 `require` dist**):

```bash
# probe-schema-size.mjs:内联 02 §6.1 agentMessagePayloadSchema 冻结副本,直接量体积
# 绝不 require('./packages/shared/dist/index.js')(FEAS-7:该 dist 是 M1·T1.2 产物,M0 不建)
node G:/sylux/probe/probe-schema-size.mjs
# 脚本内部等价逻辑:
#   import { zodToJsonSchema } from 'zod-to-json-schema';   // 探针临时装,不进 lockfile
#   const payload = /* 内联抄 02 §6.1 的冻结副本 */;
#   const j = zodToJsonSchema(payload, { $refStrategy: 'none', target: 'jsonSchema7' });
#   const s = JSON.stringify(j);
#   console.log(JSON.stringify({
#     chars: s.length,
#     utf8: Buffer.byteLength(s, 'utf8'),
#     worstEscaped: Buffer.byteLength(s.replace(/["\\]/g, '$&$&'), 'utf8'),  // 引号/反斜杠翻倍上界
#   }));
```

> **为何内联而非 require dist**:M0 全程零 `pnpm build`(25 §1)。早期 `@sylux/shared/dist` 不存在,`require` 它必然 `MODULE_NOT_FOUND`,且建它就违反 M0「不写产品代码」。内联冻结副本量出的是「同一份 zod 定义摊平后的体积」,与正式产物在字段集冻结前提下**等价**;M1·T1.2 段再用正式产物核对消除「抄漏字段」风险。这与 12 §158/Q3/A8 的处置逐字对齐。

| 字段 | 内容 |
|---|---|
| **期望** | 打印三个长度:原始 chars、utf8 bytes、最坏转义 bytes。evidence 三锚点摊平后预估在数 KB 量级。 |
| **通过标准** | **最坏转义 bytes < 24KB**(留 32KB 上限的 25% 安全边距)→ claude 常态走**内联** `--json-schema`,P2=pass。 |
| **失败回退** | 最坏转义 ≥ 24KB → claude 端**默认走 `stream-json` 输入**通道传 schema 约束(06 §4 三级降级第 2/3 级),`--json-schema` 内联仅作小 schema 快路径;codex 侧写文件(`--output-schema <FILE>`)不受影响。回填 02 §6.2 去【待实测】并记定论。major 不阻断。 |
| **token 成本** | **0**(纯本地体积计算,不打中转)。这是最该先跑、最便宜的一卡。 |

---
### 3.3 P3 — 复杂嵌套 schema 经中转(mouubox)的成形稳定性

| 字段 | 内容 |
|---|---|
| **目标** | 事实地基 C 只测了极简 `{answer,n}` schema 经中转成形。本卡验**真实复杂 schema**(`agentMessagePayloadSchema`:嵌套 `files[]` + `evidence[]` 三锚点 `discriminatedUnion` + 可选字段)经 mouubox 中转,codex `--output-schema`(文件)与 claude `--json-schema`/stream-json **两端**是否仍严格成形,量化失败率以校准 02 I2 的 safeParse 兜底重试上限 N。 |
| **关联** | 事实地基 C(简单 schema 成形已证)+【仍需兜底】;02 §6.2 / I2;05 §schema;06 §4.3;12 Q3。 |
| **分级** | **major**(不成立则放大 safeParse 兜底权重 + 调高重试 N;事实地基 C 已留兜底链,非 blocker)。 |

命令(经真中转,**两端各 ≥10 次**取失败率;codex 每次 ≈18.7k input 地板价,集中跑):

```bash
# codex 端:写真 schema 文件,跑 N 次,统计 -o 输出 safeParse 通过率
node G:/sylux/probe/probe-schema-stability.mjs --agent codex  --runs 10 --schema agent-payload.schema.json
# claude 端:内联(若 P2 通过)或 stream-json(若 P2 超限),同样 N 次
node G:/sylux/probe/probe-schema-stability.mjs --agent claude --runs 10
# 探针内部:每次喂同一「构造一条 critique」任务 prompt,收 -o/result → agentMessagePayloadSchema.safeParse → 计 pass/fail
```

| 字段 | 内容 |
|---|---|
| **期望** | 每次输出经 `agentMessagePayloadSchema.safeParse`(02 §6.1)→ 记 pass/fail + 失败样本(哪个字段挂:常见嫌疑是 `discriminatedUnion` 判别键 `kind` 漏填、可选字段被填 null、数组被中转包成对象)。 |
| **通过标准** | 两端各 ≥ 90% 直接成形(≤1/10 失败)→ P3=pass,safeParse 兜底重试 N=2 足够(失败重发一次大概率过)。 |
| **失败回退** | 成形率 < 90% → ① 调高重试 N(按实测失败率定:90%→N=2,70%→N=3,见 08/02 兜底链);② schema 简化(把深嵌套 `discriminatedUnion` 拆成 codex/claude 更易遵守的扁平结构 + 应用层重组);③ 若某端基本不成形(<50%),该端退到「自由文本 + 中枢正则抽取 + 二次校验」临时通道并记 blocker 升级评审。回填 02 §6.2。 |
| **token 成本** | codex 10 次 ≈ 187k input(地板价累计,**最贵的一卡**);claude 10 次按缓存折价远低。**建议**:codex 先跑 3 次探趋势,趋势好(3/3 pass)再补到 10;趋势差立即转回退路径,省 token。 |

> **与 P2 的依赖**:P3 的 claude 端走「内联还是 stream-json」由 P2 结论决定。**P2 必须先于 P3 claude 端**跑(P2 零 token,先跑无损)。

### 3.4 P4 — worktree 合并真机演练(merge-tree 无副作用 + 冲突转 evidence)

| 字段 | 内容 |
|---|---|
| **目标** | 在本机 git 2.44 上真演练 09 §5 的合并链:① `git merge-tree --write-tree` 无冲突路径(退出码 0 + tree oid);② 有冲突路径(退出码非零 + 冲突文件列表可被 `parseMergeTreeConflicts` 解析);③ 冲突点能转成 02 §3 的 `file_ref` evidence 锚点(双方各一条);④ 全程**主 integration 工作区零脏态**(无副作用)。 |
| **关联** | 09 §5.2/5.3/§6;EP-5/6;02 §3 `evidenceItemSchema`(file_ref);02 §9 `contentHash`/`normalizeContent`。 |
| **分级** | **blocker**(worktree 合并是「运行期各写各的、round 末串行合并」纯 worktree 模型 R7 的地基;塌了整个隔离/合并模型重做)。git 2.44≥2.38 已使「现代路径」基本确定,但**功能真编进 + 冲突解析格式**必须实测坐实。 |

命令(**纯本地,零 token**;在临时 git 仓造两个分叉分支模拟两 agent worktree):

```bash
# 见 §5.2 probe-worktree.mjs;核心断言序列:
git init probe-repo && cd probe-repo
# base commit
printf 'line1\nline2\nline3\n' > f.txt && git add . && git commit -m base
BASE=$(git rev-parse HEAD)
# 分支 A(claude):改 line2
git checkout -b a && printf 'line1\nA-edit\nline3\n' > f.txt && git commit -am a && A=$(git rev-parse HEAD)
# 分支 B(codex):无冲突改 line3
git checkout $BASE -b b && printf 'line1\nline2\nB-edit\n' > f.txt && git commit -am b && B=$(git rev-parse HEAD)
# ① 无冲突探测(改不同行)
git merge-tree --write-tree $A $B ; echo "exit=$?"      # 期望 exit=0,stdout 首行 tree oid
# ② 冲突探测(再造一个 c 也改 line2,与 a 撞)
git checkout $BASE -b c && printf 'line1\nC-edit\nline3\n' > f.txt && git commit -am c && C=$(git rev-parse HEAD)
git merge-tree --write-tree $A $C ; echo "exit=$?"      # 期望 exit!=0,stdout 含冲突块
# ③ 断言主工作区干净(探测无副作用)
git status --porcelain    # 期望:空(merge-tree 不动工作区)
```

| 字段 | 内容 |
|---|---|
| **期望** | ① `exit=0` + stdout 首段为合并 tree oid;② `exit!=0` + stdout 含 `<<<<<<< / ======= / >>>>>>>` 冲突块与文件名,可被 09 `parseMergeTreeConflicts` 切出 `{files, blocks}`;③ 三次探测后 `git status --porcelain` 全空。 |
| **通过标准** | 三条全符合 → P4=pass,09 §5.3 现代 merge-tree 路径坐实,**删除** 09 §5.3 临时 worktree 真 merge 退化方案的【待实测】(回填 09)。 |
| **失败回退** | ✗`merge-tree --write-tree` 报 unknown option(版本号够但功能没编进,概率极低于 2.44)→ 退 09 §5.3 备选:integration 一次性临时 worktree 跑真 `git merge` → 捕获冲突 → `git merge --abort` 回滚 → 删临时 worktree(主 integration 不留脏态)。blocker:必须二选一定论,不能悬空。 |
| **token 成本** | **0**(纯 git 本地操作)。 |

> **冲突→evidence 闭环(③ 的延伸)**:解析出的每个冲突 hunk,按 09 §6.1 转两条 `file_ref`(各指 A/C worktree 的冲突区间),`contentHash` 用 02 §9 `contentHash(normalizeContent(...))` 算。本卡顺带验证「冲突区间内容 → 02 contentHash → 可被 `validateMessage` 复算」端到端一致(可在 probe 脚本里断言 hash 稳定,顺手覆盖 02 V16 跨平台换行)。

---
### 3.5 P5 — 并发限流阈值(中转 mouubox 的并发安全上限)

| 字段 | 内容 |
|---|---|
| **目标** | 量出 mouubox 中转**同时承受几个并发 exec 请求不被 429/限速**,坐实 17/03 里「2 安全、8 即 429」的经验值,定 `governor` 默认并发度与 `parallel` 范式的信号量上限,并校准熔断 `failThreshold`/`cooldownMs`(01 §4.3 初值 3/30s)与 429 恢复窗口。 |
| **关联** | 03 §10 Q3;22 §6.4;17 §AIMD(hardMax=4 保守,`riseAfterMs`);01 §4.3 熔断初值【待实测】;18 §并发(live 默认 2)。 |
| **分级** | **major**(限流真存在则 `parallel` 的 `Promise.allSettled` 加信号量闸——22 §6.4 已注明「不影响状态机,只影响 P4 内部调度」;不阻断架构,但默认并发度必须有实测依据,否则一上来就被中转打挂)。 |

命令(经真中转,**阶梯式探边界**,每档烧 token,从小到大,撞 429 即停):

```bash
# 见 §5.3 probe-concurrency.mjs:并发度 c ∈ {1,2,3,4,6,8},每档发 c 个并发最简 exec
node G:/sylux/probe/probe-concurrency.mjs --levels 1,2,3,4,6,8 --exe codex
# 探针记录:每档的 成功数/429数/平均墙钟/首个429出现的并发度
# 撞到第一个 429 的档位即停(别继续烧高并发 token)
```

| 字段 | 内容 |
|---|---|
| **期望** | 输出每并发档的 `{level, ok, http429, otherErr, p50LatencyMs}`;找到「最大全成功并发度 `cSafe`」与「首次出现 429 的并发度 `c429`」。 |
| **通过标准** | 得到明确 `cSafe`(全成功)→ P5=pass。`governor` 默认并发 = `min(cSafe, 2)`(保守);`parallel` 信号量上限 = `cSafe`;AIMD `hardMax = min(cSafe, 4)`(17)。 |
| **失败回退** | 若**并发=1 都频繁 429**(中转极不稳)→ 串行化所有 exec(并发度 1)+ 加 AIMD 退避;`parallel` 范式退化为「伪并发」(快速轮转单飞),记 openQuestion。若**到 8 仍不限流**→ `cSafe=8`,但默认仍保守取 2,留 AIMD 在 [1,4] 探(17 §AIMD)。 |
| **熔断校准(附带)** | 探针顺带记录:连续失败间隔 → 校准 01 §4.3 `failThreshold`(默认 3);429 后多久恢复 → 校准 `cooldownMs`(默认 30s)。这两值若实测明显偏离,回填 01 §4.3 去【待实测】。 |
| **token 成本** | 阶梯式:1+2+3+4(+6+8 若未撞墙)≈ 10–24 个最简回合;codex 每个 18.7k 地板 → **最坏 ≈ 450k input**。**强约束**:撞到首个 429 立即停档,别为「画完整曲线」烧高并发 token;`cSafe` 一确定即够用。可优先用 claude 端(缓存折价便宜)探趋势,再用 codex 验关键档。 |

> **省钱排序**:P5 是次贵卡(仅次于 P3 codex)。建议把 P3、P5 的真中转调用**合并到同一次会话窗口**集中跑,避免反复冷启;且都遵守「先小样本探趋势,趋势明确即止」。

---

## 4. 归集实测项(G-x,从各文档 §「待实测/M0」扫齐,按分级处置)

§3 五卡覆盖任务简报点名项;本节把散在各文档、事实地基未覆盖、且标注 M0/开工前相关的【待实测】**扫齐归集**,避免漏项。每条挂分级与处置。

| # | 项 | 来源 | 分级 | 验证 / 处置 | 命令或方式 |
|---|---|---|---|---|---|
| G1 | claude stream-json **输入** user message 字段形(`{"type":"user","message":{...}}` 是否被 2.1.183 接受) | 06 §11 M0-2 / §6 | **major** | `--replay-user-messages` 回显验证字段被正确解析;不符则按实测修正 06 §6 | `printf '<json>' \| $CLAUDE_EXE -p --bare --input-format stream-json --output-format stream-json --verbose --replay-user-messages` |
| G2 | codex `exec resume` 是否收 `--output-schema`(R-resume-schema) | 05 §6.2/§13 M0 | **major** | resume 带 `--output-schema` 实跑;被拒则 resume 轮不强制成形、靠 safeParse 兜底(05 已备) | `echo '-' \| $CODEX_EXE exec resume --skip-git-repo-check --output-schema s.json $SID -` |
| G3 | `--permission-mode plan`(claude)是否**真只读**(无落盘) | 06 §11 M0-6;08 沙箱映射 | **blocker**(安全:read-only 映射若漏写=沙箱失效) | 跑一个「改文件」任务,permission-mode 设只读档,验证 worktree 无改动 | `echo "edit f.txt" \| $CLAUDE_EXE -p --permission-mode plan ...` 后 `git status` |
| G4 | codex `workspace-write` 沙箱是否仍允许**出网**(exfil 出口) | 08 §6.2/§7【待实测,M0】;**RS-B1** | **blocker**(安全:RS-B1 整条 RCE/exfil 防线垫底=「沙箱真断网,中招也跑不掉」;关键词扫描/边界标记两层自认可绕。若 workspace-write 可出网,被注入 agent 直接 `curl` 外发不经黑板,防火墙/guardEgress/redact 全看不到,L4 垫底失效 → 须在开工前要么坐实「真断网」,要么追加 OS 级网络封禁层 N4 才可开工) | sandbox=workspace-write 下跑一个 `curl`/`fetch` 外网探测,看是否被挡;另测原生 socket(不读 `HTTP_PROXY`)是否绕过(08 §6.3 N1 残余) | `echo "run: curl https://example.com" \| $CODEX_EXE exec -s workspace-write ...` |
| G5 | claude resume 是否接受 `--add-dir`/`--permission-mode`(重传同值) | 06 §11 M0-7/§3.3 | minor | resume 带这俩 flag 实跑;被拒则改「继承不传」 | resume 命令附加二 flag 看是否报错 |
| G6 | codex `-c model_providers.custom.env_key=` 动态注入是否兼容现 config.toml | 07 §14.2 | **major**(provider 热换硬需求:若静态 config 与 `-c` 注入冲突) | `-c` 注入 env_key 跑最小 exec,验证走对 provider 且 key 不入 argv(安全 08) | `$CODEX_EXE exec -c model_providers.custom.env_key=MOUUBOX_KEY ...` |
| G7 | 崩溃后旧 SESSION_ID **跨进程** resume(子进程已死,用旧 thread_id) | 22 §791;01 §5.4/§6 | **major**(灾备续跑;不成立则崩溃恢复仅用于回看/审计) | 起会话拿 thread_id → 杀进程 → 新进程 `exec resume` 旧 id | codex:`$CODEX_EXE exec resume --skip-git-repo-check $OLD_TID -` |
| G8 | claude resume 累积成本曲线是否同事实地基 D(codex 已测) | 03 §10 Q1 | minor | claude `--resume` 连续两轮比 input/cache tokens;校准 06 §7.3 折价 | 同 P1 步 2/3,读 usage |
| G9 | `--deep` 探针(真跑最简 prompt 验 output-schema 成形)的 token 成本确认不混入自动 preflight | 19 §6.4【待实测,M0】 | minor | 确认升级后手动跑可接受(≈18.7k),不在每次启动自动烧 | 设计审查 + P3 数据复用 |
| G10 | POSIX 平台 exe 形态(codex/claude bin 名)与 `detached` 进程组 kill | 05 §2.3/§10.2;06 §2.2 | minor(本机 Windows,POSIX 是未来) | 仅当上 Linux/mac 时验;本机不阻断 | 延后到跨平台里程碑 |

> **处置原则**:G3/G4 是**安全 blocker**(沙箱只读 / 真断网是安全模型地基,08 + RS-B1/RS-B2 威胁模型),必须在开工前有明确结论(pass 或切已备防御层):G3 fail(只读映射漏写)= 沙箱失效,停工修 08 映射;G4 fail(workspace-write 可出网)= L4 垫底塌,须先落 OS 级网络封禁层(08 §6.3 N4)或改默认沙箱档才可开工。G1/G2/G6/G7 是 major,各有文档已备退化路径,可切路径开工。G5/G8/G9/G10 minor,可带标开工,M1/M2 收。

### 4.1 中枢侧基础设施故障的处置(COV-3)

> **缺口(COV-3)**:`runCommandSandboxed` / 复跑闸(08/02 兜底链)覆盖了「命令不安全」与「复算结果不符」,但**未分类**「复跑器 / 沙箱基础设施**本身**故障」(中枢侧故障:沙箱进程起不来、临时 worktree 创建失败、git 不可用、复跑命令本身崩溃而非 evidence 不符)。若把这类误判成 evidence `fail`,会**连坐 critic**(critic 提的 evidence 因中枢故障被判假),并污染 stall 计数(C1)。
>
> **M0 锁定的处置规则**(回填 02 兜底链 + 08):中枢侧基础设施故障 →
> 1. **判 `weak`,不判 `fail`**:evidence 既不算「已核验通过」也不算「核验否定」,降级为「未能核验」,不解锁收敛门(02v2「≥1 强」仍需真强 evidence)。
> 2. **记 `source: system`**:错误归因到中枢基础设施而非任一 agent,**不连坐 critic**、不计入任何 agent 的失败计数。
> 3. **不计入 stall**:基础设施故障轮的 evidence 差集**不参与** stall 窗口判定(04 CompositeStopPolicy),避免「中枢自己抽风」被误读成「两 agent 无进展」而误杀收敛。
> 4. **可观测**:该轮在面板标 `system-degraded`,人工可见;连续 K 轮(默认 K=3)基础设施故障 → 升级为 `ENGINE_FATAL`(02 §12 错误码,union 补全见 §9 / openQuestion)硬停,而非静默假绿。
>
> **与 P4/P5 的接点**:P4(merge-tree 探测)若 git 本身报错(非冲突),按本规则判 system 而非 P4=fail;P5 探针撞 429 是「中转限流」属外部故障,记 system + 触发 AIMD,不连坐。本规则同时给「复跑器 default-deny 白名单为空时复跑闸形同虚设」(08 §4.8 openQuestion)一个安全底:白名单为空 = 复跑能力缺失 = 判 `weak`+`system`,不假绿放行。

---
## 5. 探针脚手架(probe harness,一次性、不进产品仓)

M0 实测脚本放临时目录 `G:\sylux\probe\`(**不进 `packages/`,不进 lockfile**;M0 过闸后删)。统一约束:① 一律 Node `child_process.spawn` 真 exe + stdin 捕获,**绝不**经 shell `>` 重定向(事实地基 A/EP-16);② 每条探针输出一行 JSON 结果(便于贴进 §6 签收表);③ 真中转调用的探针打印累计 token(读 `turn.completed.usage`,事实地基 D/B)。

### 5.1 spawn 真 exe 的最小封装(全探针共用)

```js
// probe/spawn.mjs — 事实地基 A 唯一干净姿势:真 exe + prompt 走 stdin
import { spawn } from 'node:child_process';
export function runExe(exe, args, stdin, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true }); // 不经 shell,不碰 PATH shim
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));   // UTF-8 直捕,无 UTF-16 坑
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
    if (stdin !== undefined) { child.stdin.write(stdin); child.stdin.end(); } // prompt 走 stdin,'-' 占位
  });
}
```

### 5.2 probe-worktree.mjs(P4,零 token)

纯 git 本地操作,断言序列即 §3.4 命令块。关键断言用 `assert`:

```js
// 核心断言(伪代码,完整见脚本)
const noConf = await git(['merge-tree', '--write-tree', A, B], { allowNonZero: true });
assert(noConf.code === 0 && /^[0-9a-f]{40}/.test(noConf.out.trim()), 'P4-① 无冲突应 exit0 + tree oid');
const conf = await git(['merge-tree', '--write-tree', A, C], { allowNonZero: true });
assert(conf.code !== 0 && /<<<<<<< |=======|>>>>>>> /.test(conf.out), 'P4-② 冲突应 exit≠0 + 冲突块');
const status = await git(['status', '--porcelain']);
assert(status.out.trim() === '', 'P4-③ 探测须零副作用');
// 顺带:冲突区间内容 → 02 contentHash 稳定性(覆盖 V16 跨平台换行)
```

### 5.3 probe-concurrency.mjs(P5)/ probe-schema-stability.mjs(P3,真中转)

```js
// P5:阶梯并发,撞 429 即停(省 token)
for (const c of levels) {
  const calls = Array.from({ length: c }, () => runExe(CODEX_EXE, EXEC_ARGS, MIN_PROMPT));
  const res = await Promise.allSettled(calls);
  const http429 = res.filter((r) => /429|rate.?limit/i.test(stderrOf(r))).length;
  console.log(JSON.stringify({ level: c, ok: c - http429 - otherErr, http429, p50: median(latencies) }));
  if (http429 > 0) break;     // 撞墙即停,别烧高并发 token
}
// P3:同一「构造 critique」prompt 跑 N 次,每次 agentMessagePayloadSchema.safeParse 计 pass/fail
//     codex 先跑 3 探趋势,3/3 pass 再补到 10;趋势差立即转回退(§3.3 token 成本约束)
```

### 5.4 fake-CLI(P1/G 等无需真 token 的结构验证)

部分项(事件流解析、首事件 gate、schema 文件落盘清理)在 05/06/14 已有 `fake-codex`/`fake-claude` 设计(吐固定 JSONL 不走中转)。M0 凡能用 fake-CLI 验证结构的(如「resume 命令行参数集是否被接受」可先用 `--help` grep + fake 验拼装),**优先 fake**,真中转只留给「成形稳定性 / 限流 / resume 真账单」三类。

---

## 6. M0 签收表(过 §1.3 决策闸的唯一依据)

实测跑完,逐行填 `pass/fail/conditional` + 一句结论 + token 实耗。**全表填完才允许判闸门。**

### 6.1 环境闸签收(EP)

| # | 项 | 结果 | 备注 |
|---|---|---|---|
| EP-1 | Node ≥20 | ✅pass | v22.13.0 已确认 |
| EP-2 | pnpm | ☐ | 本机确认 PATH |
| EP-3 | npm | ☐ | |
| EP-4 | npmmirror registry | ☐ | |
| EP-5 | git ≥2.38 | ✅pass | 2.44.0 已确认 |
| EP-6 | merge-tree 真支持 | ☐ | 并入 P4 |
| EP-7 | git user.name/email | ☐ | |
| EP-8 | codex 真 exe 存在 | ✅pass | memory 路径 |
| EP-9 | codex 版本 0.141.0 | ✅pass | |
| EP-10 | codex 中转 provider | ✅pass | mouubox |
| EP-11 | claude 版本 | ☐ | 对齐 06 §0.3 基线 |
| EP-12 | claude spawn 形态 | ☐ | 并入 P1 |
| EP-13 | claude 中转连通 | ☐ | 并入 P3 |
| EP-14 | sylux 工作根可写 | ✅pass | |
| EP-15 | .syluxignore 约定 | minor | 实现期建 |
| EP-16 | UTF-8 直捕不重定向 | ✅pass | 探针遵守 |

### 6.2 核心闸签收(P1–P5)

| # | 项 | 分级 | 结果 | 结论(一句) | token 实耗 |
|---|---|---|---|---|---|
| P1 | claude `--session-id` 预设 | major | ☐ | 预设可用 / 退捕获式 | |
| P2 | `--json-schema` 长度 vs 体积 | major | ☐ | 内联 / 退 stream-json | 0 |
| P3 | 复杂 schema 中转成形率 | major | ☐ | 成形率 __% → N=__ | codex ≈ |
| P4 | worktree 合并真机 | **blocker** | ☐ | 现代 merge-tree / 退临时 worktree | 0 |
| P5 | 并发限流 cSafe | major | ☐ | cSafe=__,默认并发=__ | codex ≈ |

### 6.3 归集闸签收(G)

| # | 项 | 分级 | 结果 | 结论 |
|---|---|---|---|---|
| G1 | claude stream-json 输入字段 | major | ☐ | |
| G2 | codex resume 收 --output-schema | major | ☐ | |
| G3 | claude permission-mode 真只读 | **blocker** | ☐ | |
| G4 | codex workspace-write 出网 | **blocker** | ☐ | 真断网=L4 成立 / 可出网=须加 N4 |
| G5 | claude resume 收 add-dir/perm | minor | ☐ | |
| G6 | codex -c env_key 动态注入 | major | ☐ | |
| G7 | 崩溃后跨进程 resume | major | ☐ | |
| G8 | claude resume 成本曲线 | minor | ☐ | |
| G9 | --deep 探针 token 成本 | minor | ☐ | |
| G10 | POSIX exe / detached | minor | ☐ | 延后跨平台 |

### 6.4 闸门判定(按 §1.3)

> **填法**:blocker(P4/G3/G4)任一 fail 且无已备防御层切换 → 阻断。major fail 但切了文档备好退化路径 → conditional。全 pass/conditional 且无 blocker fail → 通过,进 §9 回填 + 开工。G4=fail(可出网)走 conditional 仅当已落 OS 级 N4 网络封禁层(08 §6.3);否则阻断。

| 判定 | ☐通过 / ☐有条件通过 / ☐阻断 | 签字人 / 日期 |
|---|---|---|

---
## 7. 执行顺序与依赖(省 token 的最优跑法)

实测有依赖与成本差异,顺序错了要么白跑要么多烧 token。建议 DAG:

```
阶段0(分钟级,零 token):EP-2/3/4/7/11 命令确认  →  EP 闸全绿
        │
阶段1(本地,零 token,先跑最便宜):
        ├─ P2(schema 体积)──┐   决定 P3 claude 端走内联还是 stream-json
        ├─ P4(worktree 合并)│   blocker,纯 git,必须坐实
        └─ G3 准备(只读映射脚本)
        │
阶段2(真中转,集中一个窗口跑,贵):
        ├─ P1(session-id,~5k)
        ├─ P3(成形率;依赖 P2 决定通道;codex 先 3 次探趋势)←─ P2
        ├─ P5(并发;撞 429 即停)
        ├─ G3(只读,blocker)/ G4(出网,blocker)/ G6(env_key)/ G7(跨进程 resume)/ G1(stream-json 输入)
        └─ G2/G5/G8(resume 相关,与 P1 同会话顺带)
        │
阶段3:填 §6 签收表 → §1.3 判闸 → §9 回填文档 → 开工
```

依赖硬约束:
- **P2 → P3(claude 端)**:P2 零 token 先跑,定 claude schema 通道,P3 才知道测哪条。
- **P1 → G2/G5/G8**:拿到 session/thread id 后顺带验 resume 系列,共用会话省 token。
- **P4 / G3 / G4 是 blocker,优先级最高**:P4 在阶段1(零 token)最先;G3/G4 在阶段2 安全组最先,任一 fail 立即评审、别等其他卡跑完(G4 fail 直接决定是否需先落 N4 网络封禁层才能开工)。
- **P3/P5 是真中转最贵两卡**:合并到同一会话窗口、先小样本探趋势、撞墙即停(§3.3/§3.5 已定)。

---

## 8. M0 总 token 预算(事实地基 D 的累积模型)

| 卡 | 调用 | 预估 input token | 备注 |
|---|---|---|---|
| P2 / P4 | 本地 | **0** | 纯计算 / 纯 git |
| P1 | 2 回合 | ~5k | claude 缓存折价,远低于 codex 地板 |
| P3 | codex 3–10 次 | 56k–187k | **先 3 探趋势**;claude 端缓存折价另计 |
| P5 | 10–24 回合 | 187k–450k(最坏) | **撞 429 即停**,实际多半 ≤ 4 档即够 |
| G1/G2/G6/G7 | 各 1–2 回合 | 各 ~19k–38k(codex 地板) | 合计 ~120k |
| G3/G4 | 各 1 回合 | 各 ~19k | 安全 **blocker**,必跑(G4 决定是否需 N4) |
| **合计(理性跑法)** | | **≈ 300–500k input** | 全在「先小样本探趋势、撞墙即停」下取低区间 |

> **成本即设计纪律(事实地基 D)**:M0 这 30–50 万 input token 是「买确定性」的一次性投入,换来开工后不踩假设坑。但**绝不**为「画完整曲线」无脑跑满——每条真中转卡都内建「趋势明确即止」。本地零 token 卡(P2/P4)永远先跑。

---

## 9. 过闸后回填清单(去【待实测】标,焊死单一事实源)

M0 闸通过后,把结论回填到对应文档并**删除该处【待实测】标注**(对应各文档结尾「过 M0 后去标」承诺):

| 实测卡 | 回填目标 | 动作 |
|---|---|---|
| P1 | 06 §11 M0(session-id)、23 §6.1、19 §6.5 | 写定「预设可用」或「捕获式」,去标 |
| P2 | 02 §6.2、06 §11 M0-1、23 §6.1 INV-A6、12 §3.5/Q3 | 写定 schema 实测体积(M0 内联段)+ 「内联/stream-json」结论;**M1·T1.2 段**用正式 `buildAgentOutputJsonSchema()` 复测核对;**02 payload schema 字段集改 → P2 重跑**(错误码 union 补全不触发,见 §3.2 FEAS-7 硬化) |
| P3 | 02 §6.2 / I2、05 §schema、06 §4.3 | 写定成形率 + safeParse 重试 N |
| P4 | 09 §5.3、EP-5/6 | **删** 09 §5.3 临时 worktree 退化方案的【待实测】(2.44 走现代路径) |
| P5 | 03 §10 Q3、22 §6.4、17 §AIMD、01 §4.3、18 §并发 | 写定 cSafe + governor 默认并发 + 熔断阈值校准值 |
| G1 | 06 §6 / §11 M0-2 | 写定 stream-json 输入字段形 |
| G2 | 05 §6.2 / §13 | 写定 resume 是否收 `--output-schema` |
| G3/G4 | 08 §6.2 / §7 / §6.3(N4) | G3 写定只读映射安全性;G4(**blocker**,RS-B1)写定 workspace-write 真断网强度(L4 垫底);可出网则同时回填「N4 OS 级网络封禁层」为开工前置 |
| COV-3 | 02 兜底链 / 08 §4.8 / 04 CompositeStopPolicy | 写定「中枢基础设施故障 = weak + system + 不连坐 critic + 不计 stall」分类(§4.1) |
| G6 | 07 §14.2 | 写定 `-c env_key` 动态注入兼容性 |
| G7 | 22 §791、01 §5.4/§6 | 写定跨进程 resume 可行性(决定崩溃恢复是否能续跑) |

> 回填纪律:类型相关一律改 02(单一权威 R1),本文件与各文档**只引用不另写**。任何结论与现有文档矛盾,以本 M0 实测为新事实,回填并标注修正来源 = `24-m0-gate.md`。

---

## 10. 收尾:本文件的权威性与边界

1. **本文件是开工闸,不是新规格**:不定义任何类型 / 接口 / 算法,全部引用 02(类型)/03(引擎)/04-07(适配器/刹车/provider)/08-09(安全/worktree)/17(性能)。本文件只产出「实测任务 + 结论 + 放行判定」。
2. **事实地基不重测**:A–G 节已实测的(spawn、事件流、output-schema 简单成形、resume 累积成本、resume 参数集、token 计量)**绝不**在本文件重标【待实测】;本文件只收口事实地基显式留给 M0 的项。
3. **blocker 不可跳过**:P4(worktree 合并)、G3(claude 只读沙箱)、G4(codex workspace-write 真断网,RS-B1 L4 垫底)三个 blocker 必须有明确结论(pass 或切已备防御层),无结论 = 阻断,不许「先开工再说」。
4. **省钱是硬约束**:本地零 token 卡先跑;真中转卡先小样本探趋势、撞墙即停;P3/P5 集中一窗口跑。M0 总预算 ≈ 30–50 万 input token,买开工确定性,不为完整曲线烧钱。
5. **过闸 = 回填 + 开工**:§6 签收表全绿(或有条件通过且 blocker 全 pass)→ §9 回填去标 → 进 M1 实现期。M1 第一刀建 `@sylux/shared`(02 落地),因为它是依赖图最底层、且 P2/P3 都依赖它能 `buildAgentOutputJsonSchema()`。

