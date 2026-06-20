# 25 · 路线图与明细任务(Roadmap & Task Breakdown,M0–M5)

> **本文件地位**:sylux 项目的**交付路线图权威**。它把已锁定架构(总体规划 + 01–23 设计稿)切成 6 个可独立交付的里程碑(M0–M5),给每个里程碑的**目标 / 范围 / 退出标准**,并把 M0–M2 拆到**可直接开工的明细任务**(ID / 所属 / 一句话 / 验收 / 依赖 / 工作量),M3–M5 给到中粒度任务。本文件还固化**关键路径**与 **6–24 月远景**。
>
> **里程碑划分以本文件为准**:本文件的里程碑切分(M2=Web 面板、M3=四剧本+worktree、M4=provider 热切+成本+回放、M5=评测台+Fusion)取自立项任务简报,**与总体规划 §13 的旧切分不同**(旧切分 M2=工程化、M3=四范式、M4=面板、M5=加固)。二者对账见 §0.3;凡冲突以本文件为准,并回填总体规划 §13/§14。
>
> **引用而非另写(焊死红队 R1)**:本文件**不定义任何类型 / 接口 / 算法**。涉及 `Message`/`Evidence`/`AgentEvent`/`BoardState` 等一律引用**黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`);涉及引擎循环 / Playbook 引用**引擎(03)**;刹车引用 **04**;适配层引用 **05(codex)/06(claude)**;provider 引用 **07**;安全引用 **08**;worktree 引用 **09**;面板引用 **10**;WS 协议引用 **11**;技术栈引用 **12**;monorepo 规范引用 **13**;测试引用 **14**;可观测/错误码引用 **15**;配置引用 **16**;性能引用 **17**;评测台引用 **18**;部署合规引用 **19**;插件 DSL 引用 **20**;Fusion 引用 **21**;e2e 时序引用 **22**;术语/不变量引用 **23**。任务"验收"列引用的实测事实一律以 `docs/PROBED-FACTS.md`(下称 PF)为准。
>
> **事实标注约定**:凡 PF(2026-06-20 本机实测)已覆盖的结论**不再标**【待实测】;仅 PF 未覆盖、需后续实测的标【待实测】。
>
> **编号权威(焊死 x-consistency C-NUM / x-coverage COV-6 全仓编号双轨制)**:本文件一律采用**磁盘文件名编号**(filename camp),即引用号 = `docs/drafts/NN-*.md` 的 `NN`。据此 **08 = 安全/防火墙(`08-security-firewall.md`)、09 = 隔离/worktree(`09-isolation-worktree.md`)、10 = 面板(`10-web-ui.md`)、11 = WS 协议(`11-ws-protocol.md`)**;凡逻辑编号派(把安全记 09、worktree 记 08)的旧引用作废。本文件 §0.6 给出权威映射表,全仓回填以此为准。
>
> **裁决前置(焊死 red-feasibility FEAS-3/4/5 + x-coverage COV-9)**:本文件 §7 汇总**必须在 M1 开工前由人拍板的产品裁决**(红蓝写不写文件 / digest 算法谁定 / 收敛是否按范式分化 / M2 diff 渲染什么)。这些不是措辞回填,是行为语义裁决;§1–§2 已按"红队建议的默认裁决"写死,§7 标注每条的备选与翻盘代价,定稿时若推翻需同步改 §1–§3。

---

## 0. 设计目标与路线图不变量

### 0.1 本文件回答什么

| 问题 | 本文件给出 |
|---|---|
| 先做什么、后做什么? | §1 里程碑总览 + §3 关键路径 |
| 每个阶段做完算"过"? | §1 各里程碑退出标准(可机器/可演示核验) |
| 具体落到哪些任务? | §2 明细任务(M0–M2 细、M3–M5 中) |
| 哪条线卡死全局? | §3 关键路径 + 瓶颈 |
| 哪里可能翻车? | §4 路线图层面风险与缓解 |
| 长期往哪走? | §5 6–24 月远景 |
| 开工前要人拍板什么? | §7 产品裁决(红蓝写不写/digest 算法/收敛分化/diff 渲染) |

### 0.2 里程碑划分三原则

1. **可行性闸优先(吃红队 blocker"先验证地基再搭脚手架")**:M0 不写任何产品代码,只把"中转能否强制成形 / spawn 能否干净 / resume 与计费真相"从假设变事实。PF 已落地大部分,M0 收尾残留探针(§1 M0)。
2. **攻击面随里程碑落地安全守卫**:安全(08)不是一个独立里程碑,而是**哪个里程碑引入了攻击面,对应守卫就在该里程碑内强制就位 + 配断言测试**。spawn 期四守卫(env 白名单 / key 不进 argv / 内容防火墙 / 沙箱封顶)随 M1 的 agents 落地;WS 鉴权随 M2 的面板落地;出站 secret scan / `.syluxignore` 随 M4 的 provider 出境通道落地。守卫未就位则该里程碑不算完成。
3. **每个里程碑可独立演示**:M1 终端能看到一次真实红蓝对抗;M2 浏览器能观战;M3 四剧本各能跑;M4 能热换 provider 并回放历史;M5 能出评测报告。不做"半年后才有第一个 demo"的瀑布。

### 0.3 与总体规划 §13 的里程碑对账(冲突以本文件为准)

立项简报与总体规划 §13 对 M2–M5 切分不一致。本文件采用**立项简报**口径(更贴合"先有可看面板,再补隔离与四剧本,再补成本与回放,最后评测"的演示节奏),对账如下,需回填总体规划 §13/§14:

| 里程碑 | 本文件(立项简报口径,**权威**) | 总体规划 §13(旧口径,作废) | 差异处理 |
|---|---|---|---|
| M0 | 可行性闸(同) | 可行性闸 | 一致,PF 已落地大部分 |
| M1 | 双 CLI + 红蓝单剧本 + 黑板 jsonl + **终端**可看最小闭环 | 最小可行(含最朴素 ws + web 气泡) | 本文件把"web 气泡"后移到 M2,M1 只到**终端可看 + jsonl 落盘**,更小更稳 |
| M2 | **Web 面板**(server WS + 观战面板 + diff + 暂停介入 + WS 鉴权) | 工程化(provider 热换 + 收敛 + token + worktree + CI) | 重排:面板提前到 M2 |
| M3 | **四剧本 + worktree 隔离 + 收敛调优** | 四范式齐备 | 本文件把 worktree + 收敛并入 M3(四剧本依赖隔离与收敛) |
| M4 | **provider 热切 + 成本控制 + 录制回放** | 面板完善 | 重排:成本/回放/provider 热换集中到 M4 |
| M5 | **评测台 + Fusion 评审团** | 加固与体验 | 本文件把 18(评测台)+ 21(Fusion)作为 M5 终极能力;加固项(出站扫描/session 清理)前移并入 M4 的 provider 出境通道 |

> 重排理由:① 面板是"观战"这一核心卖点的载体,越早可见越能驱动迭代,故提前到 M2;② worktree 隔离(09)是 parallel 剧本的硬前提,与四剧本同属 M3 才自洽;③ 评测台(18)与 Fusion(21)都依赖前面全部能力(jsonl 回放、provider 多实例、成本计量),天然压到 M5。

### 0.4 工作量与依赖记法

- **工作量**:S(≤0.5 天)/ M(1–2 天)/ L(3–5 天)/ XL(>5 天,应再拆,本文件出现即标注拆分建议)。
- **依赖**:列任务 ID;跨里程碑依赖显式标里程碑前缀。
- **所属包**:`@sylux/{shared,core,providers,agents,server,web,eval}`,依赖方向单向禁环(12):`shared ← {providers, agents} ← core ← server ← web`,`eval` 依赖 `shared + core`。
- **验收**:尽量写成**可机器核验**(单测断言 / 命令退出码 / 演示可见)或**可演示**,避免"做完了"这种不可判项。

### 0.5 跨里程碑硬前置(开工前必须先发生的"非任务"事件)

这些不是某个包的实现任务,而是**别的文档/人必须先交付的产物**,否则对应里程碑的任务踩空。本文件只负责点名 + 卡里程碑闸,不替它们定内容。

| 前置 | 卡住 | 现状 | 闸门动作 |
|---|---|---|---|
| **PRE-1 · 02 §12 错误码 union 补全**(x-consistency A1 / x-coverage COV-1) | T1.2 落地、全仓 `SyluxError` 编译 | 02 §12 仍缺 17+ 个下游已用码(`SUBPROCESS_CRASHED/TIMEOUT/CANCELLED`、`INJECTION_BLOCKED`、`EMPTY_ROUND_PLAN`、`ENGINE_FATAL`、`EGRESS_SECRET_BLOCKED`、`WS_*`×7、`WORKTREE_GIT_FAILED`/`WORKTREE_CONFLICT`、`FUSION_*`×2、`CONFIG_*`) | T1.2 **开工即先补 02 §12**(作为 T1.2 第一步,不另起任务但列为 T1.2 验收前置);否则 15 的 `Record<SyluxErrorCode,…>` 穷举编译红。本文件 §2.2 T1.2 验收已加该项 |
| **PRE-2 · 02 §6.2 `agentMessagePayloadSchema` 字段集冻结**(red-feasibility FEAS-7) | M0·T0.2 schema 体积探针、T1.11 claude adapter schema 传递方案 | 02 §6.2 `buildAgentOutputJsonSchema` 标【待实测】,字段未冻 | M0 跑 T0.2 **之前**,02 须冻结喂 schema 的 Message 瘦子集**字段集**(错误码 union 可后补,但字段名/层级定死);见 §2.1 T0.2 |
| **PRE-3 · 红蓝写不写文件裁决**(red-feasibility FEAS-3,与 03 §7.1 冲突) | M1 红蓝行为定义、T1.6/T1.10 沙箱等级、21 Fusion 边界 | 03 §7.1 红蓝写文件+每轮合并,本文件 M1 红蓝纯决策不写——相反 | 本文件 §7 D1 采"**M1 红蓝纯决策、critic 引用只读任务快照**"裁决,并要求回填 03 §7.1(M1 档 `shouldMergeAt=false`、proposer 不声明 files);定稿须人确认 |
| **PRE-4 · DigestBuilder v0 算法定址**(red-feasibility FEAS-4,03↔17 双向 punt) | T1.5 连续性、>2 轮红蓝不失忆 | 03 称算法归 17,17 称归 03,中间为空 | 本文件 §7 D2 采"**结构化 evidence 锚点 digest v0**"并钉在 03,要求 03/17 二选一落地;§2.2 拆出独立任务 T1.5b + 连续性验收 |

### 0.6 文档编号权威映射表(全仓回填基准)

> 锚定磁盘文件名。逻辑编号派的旧引用(如把"安全"写成 09、"worktree"写成 08)一律按此表纠正。本表仅列与本文件任务直接相关者。

| 引用号 | 磁盘文件 | 主题 | 本文件任务挂靠 |
|---|---|---|---|
| 02 | `02-blackboard-types.md` | 黑板协议/类型权威 | T1.2/T1.3 |
| 03 | `03-engine-playbook.md` | 引擎循环 + Playbook | T1.4–T1.6、T3.4–T3.6 |
| 04 | `04-convergence-brakes.md` | 收敛 + 刹车 | T1.8、T3.7、T4.4 |
| 05 | `05-adapter-codex.md` | codex 适配 | T1.10 |
| 06 | `06-adapter-claude.md` | claude 适配 | T1.11 |
| 07 | `07-provider-config.md` | provider 配置 | T4.1、T5.6 |
| **08** | `08-security-firewall.md` | **安全/防火墙** | T1.12–T1.15、T2.2–T2.4、T2.12、T4.3/T4.7 |
| **09** | `09-isolation-worktree.md` | **隔离/worktree** | T1.5c、T3.1–T3.3 |
| **10** | `10-web-ui.md` | **面板前端** | T2.7–T2.10 |
| **11** | `11-ws-protocol.md` | **WS 协议** | T2.1–T2.3、T2.13 |
| 14 | `14-testing.md` | 测试 | T1.18、T4.6 |
| 15 | `15-observability-errors.md` | 可观测/错误码穷举 | PRE-1 |
| 16 | `16-config-schema.md` | 配置 schema | T4.1、T4.4 |
| 17 | `17-performance.md` | 性能/digest 裁剪 | T1.5b、T5.6 |
| 18 | `18-eval-harness.md` | 评测台 | T5.1–T5.5 |
| 21 | `21-local-fusion.md` | Fusion | T5.6–T5.9 |
| 24 | `24-m0-gate.md` | M0 闸卡片 | T0.1–T0.7 |

---

## 1. 里程碑总览(目标 / 范围 / 退出标准)

### M0 · 可行性闸(Feasibility Gate)

- **目标**:不写任何产品脚手架,用一次性脚本把"中转能否强制成形 / Windows spawn 能否干净 / resume 与计费真相 / 两端 flag 行为"从假设变成事实,存 fixtures 供后续测试复用。
- **范围**:仅 `fixtures/` 与一次性探针脚本;不建 monorepo、不建包。
- **PF 已落地(不再重测)**:spawn 必须直调真 exe + prompt 走 stdin(PF·A);事件流首行 `thread.started.thread_id`(PF·B);`--output-schema` 经 mouubox 可强制成形 + 留 safeParse 兜底(PF·C);resume 不省 token、input_token 累积翻倍、基线底价 ≈18.7k(PF·D);`codex exec resume` 参数集与 exec 不对称(PF·E);claude 端 flag 集与两端 schema 不对称(PF·F);usage 取 `turn.completed.usage`(PF·B/G)。
- **M0 残留探针(PF 未覆盖,本里程碑收尾)**:见 §2 M0 任务表(claude `--session-id` 预设能力、`$refStrategy:'none'` 摊平后 schema 体积是否逼近 claude 32KB 内联上限、kill 能否杀穿 claude `.ps1/.cmd` shim 背后的 node 子进程、**codex `-s workspace-write` / claude 权限模式下子进程能否出网**)。
- **退出标准**:
  1. 三项残留探针有明确结论并写回 PF 对应节(claude session 预设 / 内联 schema 体积 / claude kill 杀子进程);
  2. codex 简单 + 嵌套(含 evidence discriminatedUnion)两种 schema 的真实 JSONL 样本入 `fixtures/`,注明 codex 版本 `0.141.0`;
  3. claude `-p --output-format stream-json` 真实事件流样本入 `fixtures/`;
  4. 一份"两端能力对照表"沉淀(启动方式 / schema 传递 / resume 参数 / 系统提示注入 / kill 方式 / usage 字段),作为 05/06 适配层实现基准;
  5. **(吃 red-security RS-B1 blocker)沙箱出网实测有结论**:codex `-s workspace-write` 与 claude 实现期所用权限模式下,子进程发起 outbound HTTP(curl 打探测端点)能否成功,结论写回 PF 新增节。整套注入/exfil 防线垫底押在"沙箱断网让中招也跑不掉";若**实测可出网** → 08 的 L4"断网兜底"失效,注入防御须改为应用层强约束(无后门 spawn + 出站白名单),本文件 §4 RP9 记此分叉。
- **闸门含义**:**五项**不全过**不进 M1**。若内联 schema 超 32KB → claude 侧退化为 `stream-json` 输入传 schema(PF·F 备选),影响 M1 的 T1.5/T1.11 工作量评估。**P2(schema 体积)走"两段闸"**:M0 用钉死版临时 schema 估**下界**,M1·T1.2 落地后用正式 dist 复跑校准(吃 FEAS-7,详 §2.1 T0.2 + §4 RP4)——不在 M0 一次性定死,消除"闸门依赖 M1 未来产物"的悖论。

### M1 · 双 CLI + 红蓝单剧本 + 黑板 jsonl(终端最小闭环)

- **目标**:跑通一次真实红蓝对抗——codex 提案 → claude 带**可机器核验** evidence 批判 → 写黑板 → 落 jsonl → **终端**实时可读;三重刹车至少 maxRounds + done(对面带证据 ack)生效;spawn 期安全四守卫就位并过断言测试。
- **范围**:`@sylux/shared`(02 全部 schema + 校验)、`@sylux/core`(引擎循环 + Blackboard + Playbook 接口 + 最小刹车 + digest v0)、`@sylux/agents`(codex/claude 双 adapter + env 白名单 + 防火墙 + **只读任务快照/ValidateContext**)、`red-blue` 单剧本、jsonl 持久化、终端渲染器。**不上**:web 面板(M2)、worktree **写入合并**(M3)、provider 热换(M4)、turbo/双平台 CI/commitlint(M2+)。
- **关键裁剪(已吃 FEAS-2/FEAS-3,与初稿不同,以本版为准)**:M1 的红蓝对抗是**纯决策回合**(propose/critique/ack),**proposer 不写文件、不声明 `files`**,critic 只读引用证据(`file_ref`/`command`)。**但"不写文件"≠"无文件系统"**:critic 的 `file_ref` 指向 `--task` 所指的**真实代码库**,引擎必须能按 path+行区间读出内容、复算 `contentHash` 才能判"强核验通过"。因此 M1 **仍需一个轻量"只读任务快照 + `ValidateContext` 实现"**(09 的只读子集:只读 checkout / 直接只读挂载 + `readFileRange` + `contentHash` 复算),它**远轻于** worktree 写入合并(后者推迟到 M3)。初稿"M1 不需要 worktree(09)"的措辞**过激**——准确说法是"M1 不需要 worktree 的**写入与 3-way 合并**,但需要 09 的**只读快照子集**"。
- **沙箱裁剪(吃 FEAS-8)**:M1 纯决策不写文件,codex spawn 一律封 **`-s read-only`**(比 `workspace-write` 更小更安全、与"不写文件"自洽),claude 用对应只读权限模式;`workspace-write` + automation/interactive 分流整体推迟到 M3(implement 真写)/M4(权限分级)。M1 无 automation 路径(只有人工 `sylux run`),退出标准不再提"automation 路径"这个 M1 不存在的概念。
- **退出标准**:
  1. `pnpm -r build` + `tsc -b` 通过;`@sylux/shared` 契约测试矩阵(02 §13 V1–V20)全绿;**02 §12 错误码 union 已补全**(PRE-1),`SyluxError` 全仓编译无缺码;
  2. 一条命令 `sylux run --playbook red-blue --task <dir>` 能驱动真实 codex + claude 完成 **≥3 轮**对抗(吃 FEAS-4:2 轮会被"最近 K 轮全文"兜过去、掩盖 digest 失忆,**改 ≥3 轮**才真正验到 stateless 连续性),终端按 round/from/role/kind 着色打印气泡;
  3. critic 空 evidence / 仅 spec_quote 被打回并回灌重发(02 §8.4),≤N 次耗尽抛 `EVIDENCE_*`;**强核验真生效**:critic 的 `file_ref` 经 `ValidateContext` 复算 `contentHash`,对得上=强、对不上/读不到=打回,**有可读快照可复算**(吃 FEAS-2:无此项则"强核验通过"是假绿);
  4. maxRounds 触顶停(`ROUND_LIMIT_EXCEEDED`);done + 对面带**复算通过的强 evidence** ack 才真停;
  5. 安全守卫断言测试过:codex 子进程拿不到 `ANTHROPIC_*`、claude 拿不到 `OPENAI_*`(08 env 白名单);args 现 key 模式抛 `PROVIDER_CONFIG_INVALID`;注入样本被防火墙降级;**M1 spawn 一律 `read-only`**(纯决策无需写,断言 codex 命令行含 `-s read-only`);
  6. **连续性验收(吃 FEAS-4)**:第 3 轮的 `PromptContext` 仍含第 1 轮 proposal 的 evidence 锚点(digest v0 保结构化锚点),agent 不重复第 1 轮已被驳回的方案(单测 + 真实 run 抽查);
  7. run 全程落 `runs/<runId>.jsonl`,杀进程后能从 jsonl 重建 BoardState(02 §7.3)。

### M2 · Web 实时面板(观战 + 可暂停介入)

- **目标**:把 M1 的终端闭环搬上浏览器——实时对话气泡 / 轮数进度 / **evidence 引用预览(非 diff)** / 刹车提示 / 暂停 + 介入,且 WS 通路鉴权 + 观战/控制权限分级 + **面板 XSS 防护**就位。
- **范围**:`@sylux/server`(ws server bind 127.0.0.1 + REST 启动/配置 + WS 鉴权中间件 + **ws-ticket 签发端鉴权** + **流式跨帧 redact 缓冲**)、`@sylux/web`(React+Vite 面板 + zustand + evidence 预览渲染 + **输出转义/CSP**)、WS 协议(11)、面板(10)、WS 安全(08)。
- **diff 面板裁决(吃 x-coverage COV-9)**:M1/M2 红蓝**纯决策不写文件**,**没有 diff 可渲染**。故 **M2 不做 diff 面板**,改做 **"evidence 引用预览"**(把 critic 的 `file_ref` 按 path+行区间从只读快照取出高亮展示——这是 M2 真有的数据)。真正的 **unified diff 面板推迟到 M3**(implement 落 worktree 写后才有 diff),随 T3.x 一起做。初稿把 diff 任务(原 T2.6/T2.9)放在 M2 与"无文件写"矛盾,本版纠正。
- **退出标准**:
  1. 浏览器实时看到 M1 红蓝对抗的气泡流(初连拉 snapshot + 增量 append),与 jsonl 一致;
  2. WS 握手校验 Origin 白名单 + 一次性 run token;无 token / 错 Origin 拒连(单测断言);**ws-ticket 签发端点自身有鉴权**(吃 RS-M2:本机 `curl` 直打 `POST /ws-ticket` 拿不到 control token——签发须校验本地 run 持有者凭证 / 进程级密钥,不能仅靠"非浏览器拿不到 token"的循环论证);
  3. 观战只读 与 控制介入 两权限等级;pause/inject 控制类消息二次校验,只读连接发控制消息被拒;
  4. server 单测断言**不监听非回环地址**;
  5. **面板 XSS 防护(吃 RS-B2 blocker)**:agent 内容(`body`/`quote`/文件名/evidence 文本)进 DOM 一律转义、禁 `dangerouslySetInnerHTML` 裸插;设 CSP(禁内联 script、限 connect-src 到本地 ws);单测断言 `body` 含 `<script>`/`<img onerror>` 时被转义不执行——防"被注入 agent 在气泡里塞脚本→借持 control 权限的浏览器代发 abort/inject";
  6. **流式跨帧 redact(吃 RS-M1)**:对 stream-json delta 帧做 redact 时在 server 侧**带状态缓冲**(跨帧拼接后再扫 `sk-ant-`/`sk-`/长 base64,匹配命中整体打码),不按单帧无状态过滤——否则密钥被切成两个 delta 各自不匹配、明文广播给 spectator 后前端拼回;`diff_chunk` 跨 `seqInRef` 同理;单测断言跨帧分片密钥被拦;
  7. 暂停后引擎挂起、可恢复;inject 的人工消息经内容防火墙(08)后入黑板(`from:'human'`);
  8. evidence 引用预览渲染:点 critic 气泡的 `file_ref` 能看到对应快照行区间高亮;超阈值/二进制降级为路径+统计。

### M3 · 四剧本 + worktree 隔离 + 收敛调优

- **目标**:补齐 master-worker / pair / parallel 三个剧本(red-blue 已在 M1);引入 worktree 物理隔离(09)让"执行回合"(implement)能安全落 diff;parallel 的并发执行 + 轮末 3-way 合并 + 冲突硬停回灌;收敛检测(evidence 指纹差集)上线并**按范式分化**(吃 FEAS-5);**真正的 unified diff 面板**(从 M2 移来,此时才有文件写)上线。
- **范围**:`@sylux/core`(三个 playbook + 收敛检测**按范式/kind 分化**)、`@sylux/agents/worktree.ts`(create/diff/3-way merge/冲突硬停)、刹车(04 收敛 stall)、`@sylux/server`+`@sylux/web`(diff 生成 + 渲染)。
- **退出标准**:
  1. 四剧本各有集成测试(FakeAdapter 驱动)跑通,角色↔模型解耦可只改 `assignment` 互换;
  2. worktree:每 agent 独立 worktree,implement 落 diff,轮末 3-way 合并;冲突=硬停 + 错误码 `WORKTREE_CONFLICT` + 冲突作 evidence 回灌下一轮;合并前 tag/stash 可回滚(单测);
  3. parallel 两 agent 并发各写各 worktree,轮末统一合并,合并顺序可配(默认按 agent 声明序);
  4. **收敛检测按范式分化(吃 FEAS-5)**:辩论型(red-blue/pair)用"强指纹差集连续空→stall";状态机型(master-worker/parallel)主收敛信号改为"done 收口(review 通过 + worker done)",指纹 stall 仅辅助兜底且 `stallWindow` 显著放大,planner 的派活 `propose`/`question` 轮与 review 复用旧锚点轮**不计入 stall 窗口**(按 role/kind 豁免);反例单测:① red-blue"换措辞同问题"→`CONVERGENCE_STALL`、"真新问题复用旧引用"不误杀;② **master-worker"派活轮+review 复用轮连续空集"不被误杀**(FEAS-5 的核心反例);
  5. stall ≠ done:stall 升级为面板告警 + 终态 `stalled`,不等于完成;
  6. **diff 面板(从 M2 移来)**:implement 落 worktree 后 `git diff --find-renames` 产 unified diff,面板渲染;二进制/超阈值降级为文件名+统计;经流式跨帧 redact(M2 已建)与 XSS 转义;
  7. **(吃 x-coverage COV-3)复跑器/沙箱基础设施本身失败分类**:`runCommandSandboxed` 复算证据时,若**中枢侧故障**(沙箱起不来/复跑器崩/超时,区别于"命令不安全"与"复算结果不符")→ 判 **weak + 记 `system` 来源 + 不连坐 critic**(不计入 critic 的 evidence 信誉、不触发 stall 计数误判),错误码归 `SUBPROCESS_*`;单测断言"基础设施故障"与"复算不符"走不同分支。

### M4 · provider 热切 + 成本控制 + 录制回放

- **目标**:provider 配置可加载/校验/热换(每 agent 一份,key 不落盘/不进 argv);token/成本硬上限 + 单轮 context cap;录制-回放(把真实 run 的 jsonl/事件流存档,离线复现调试);出站内容守卫 + `.syluxignore` 在此随 provider 出境通道一并落地。
- **范围**:`@sylux/providers`(配置 schema + 热换 + 出站 secret scan)、`@sylux/core/brakes`(token 预算 + context cap)、回放(复用 14 fixtures + 18 ReplayAdapter 雏形)、安全出境(08 §出站守卫)。
- **退出标准**:
  1. provider 热换只影响下一轮 spawn,运行中子进程不强改;新增 provider 仅追加配置过 zod 校验、无需改码;
  2. key 流向:仅 spawn 时注入子进程 env 或 codex auth.json,**绝不**进 argv/`-c`/落盘配置/日志(断言:args 现 `sk-`/长 base64 抛 `PROVIDER_CONFIG_INVALID`;redact 覆盖 spawnargs);
  3. 累计 token 触顶停(`TOKEN_BUDGET_EXCEEDED`),按 PF·D **累积/超线性**模型估算,非按增量;单轮 context 超 `perTurnContextCap` 截断/拒绝;**(吃 FEAS-1)前瞻外推按 regime 选公式**:master-worker 这类 regime 混合范式,在 continuity 从 stateless 切 resume 的那一轮直接用 resume 超线性上界 `base×chainLen` 估,而非标量线性外推(否则滞后 regime 切换 1–2 轮);首轮前瞻不可信(只有 18.7k 地板),显式标注"首轮靠 maxRounds/maxTotalTokens 硬上限兜,不靠前瞻";
  4. **(吃 ROC-M1)usage 字段缺失/漂移时成本不失明**:`turn.completed.usage` 缺失时,input 按 18.7k 地板兜底**且 output 不当 0**(按该范式历史 output 均值或保守上界估),`maxCostUsd` 用此估算——否则 CLI 升级改 usage 字段后,用户设的 \$ 上限挡不住真实花费(成本刹车静默失明);usage 字段漂移**升级为 degradable+告警但仍按上界兜底估**,不是 warn 放行后当 0;
  5. 录制:一次真实 run 的事件流落 fixtures,ReplayAdapter 重放逐字节复现 BoardState(回放态打分稳定,对接 18 EV3/EV8);
  6. 出站守卫:进 prompt 的文件过 secret scan,`.env`/私钥/token 命中拒发或脱敏;`.syluxignore` 默认排除 `.env`/`.git`/credentials;README 标注数据出境;提供官方直连 provider 选项。

### M5 · 评测台 + Fusion 评审团

- **目标**:量化评测(18,`@sylux/eval`):一组固定任务 × 剧本 × provider 组合 → 质量/成本/稳定三维打分 + A/B 对比;Fusion 决策回合评审团(21):决策回合(propose/review/critique/question)可叠加 panel(N provider 并发)+ judge 综合,执行回合(implement)严格禁 Fusion。
- **范围**:`@sylux/eval`(EvalTask/EvalMatrix/EvalScore/ReplayAdapter/AbReport + runner)、`@sylux/core/fusion`(FusionExecutor + judge + evidence-map + 成本模型)、provider panel 配置(07 §10)。
- **退出标准**:
  1. 评测台对历史 jsonl 离线打分(EV2),质量指标可机器核验(EV4:命令退出码/文件 hash/测试数),红队"有效发现"按"核验通过 + 新指纹差集"量化(EV6);
  2. 成本用实测 usage 换算(EV5),A/B 同任务集/同预算口径公平校验(EV7);评测产物带输入指纹可复现(EV8);
  3. Fusion 同形落地:一次 panel 发言只产一条 `AgentMessagePayload`,黑板看不出 panel(F1);成员强制无状态 single-shot,不逐成员 resume(F3);**Fusion 仅在 runTurn 产出的 turn 接入**——`onStart`/`onFinish` 等不产发言的生命周期钩子不挂 panel(吃 FEAS-9:`onStart` 是 `Promise<void>` 钩子、不产 `AgentMessagePayload`,21 §2.3 "parallel 在 onStart 挂 panel"作废,parallel 直接标"不适用 Fusion");
  4. Fusion 执行回合双闸拦截:配置期 `panelProviderConfigSchema.superRefine` 拒 `implement`,运行期 `FusionExecutor` 命中 `implement` 抛 `FUSION_KIND_FORBIDDEN`(21 §0.2);**且"写文件的 propose"同禁**(吃 FEAS-3:边界不只按 kind,凡声明非空 `files`/`shouldMergeAt` 的发言即禁 panel,避免 21 §5.5 把 propose 的 files 静默清空);
  5. judge 产可核验 evidence,不达标时裁判级重试(只重跑 judge,不重 fan-out N 成员,F5);成本按 `(N+1)×` 地板价计入累积预算(F8);
  6. **(吃 ROC-M3)评测 runner 并发受全局许可池管控**:eval runner 的 `(task,cell)` 并发 × parallel 单轮 2 路 × panel N 成员**叠加**不得突破 8 并发 429 顶——runner 必须复用 17 `ConcurrencyGovernor` 全局许可池(按 provider 端点分池,见 ROC-m3),否则评测自身变烧钱大户且 429 退避污染 `passVariance`/wall-clock 使量化结论失真;
  7. **(吃 ROC-B1,前置回填)16 §6.4 默认预算表须先修**:stateless 默认范式(red-blue/pair/parallel)**不得**套用 resume 超线性公式(`base×N(N+1)/2`),应按 18 §6.4 `estimateRunTokens` 的 regime 分叉用**线性**估(stateless 线性目标 ≈225k,而非误配的 808k);此项是 ROC-B1 blocker,M5 评测台开工前 16 必须改对,否则 B3 预算安全网对三个默认范式形同虚设、评测基线本身偏 3.6×。

---

## 2. 明细任务清单

> 列序:ID / 所属包 / 一句话 / 验收(可核验) / 依赖 / 工作量。M0–M2 细到可直接开工;M3–M5 中粒度(开工前各自再开一轮细化)。

### 2.1 M0 · 可行性闸(残留探针 + fixtures 固化)

> PF 已把大部分从假设变事实,M0 只收尾**PF 未覆盖**的探针并固化 fixtures。

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T0.1 | (脚本) | 探针:codex 简单 + 嵌套(含 evidence `discriminatedUnion`)两种 `--output-schema` 经 mouubox 真实成形 | 拿到真实 JSONL;`-o` 文件严格合 schema;嵌套 schema 不合时报错形态记录;两份样本入 `fixtures/codex/`(注 0.141.0) | PF·C | S |
| T0.2 | (脚本) | 探针:`buildAgentOutputJsonSchema()`(02 §6.2,`$refStrategy:'none'`)摊平后 JSON Schema 字节数实测 — **下界估**(吃 FEAS-7) | **不 require 未建的 shared/dist**;把 02 §6.2 当前 `agentMessagePayloadSchema`(含 evidence 三锚点 discriminatedUnion)原样拷进一次性脚本(头注"快照自 02 §6.2 @ 2026-06-20,02 字段变需重量"),量出字节数标为**下界估计**;判定是否 < claude 32KB 内联上限(PF·F);超限→记"claude 走 stream-json 传 schema";**前置 PRE-2(02 字段集须先冻)** | PF·F,PRE-2 | S |
| T0.2b | (脚本) | 回归校验:M1·T1.2 落地后用**正式 dist** 复跑 schema 体积,与 T0.2 下界对账(FEAS-7 两段闸第二段) | T1.2 落地后跑;正式值与 T0.2 下界差异超阈值→claude adapter(T1.11)方案重审;消除"M0 闸依赖未来产物"悖论 | M1·T1.2 | S |
| T0.3 | (脚本) | 探针:claude `-p --output-format stream-json --json-schema`(内联 or 临时文件)真实事件流 | 拿到真实事件流样本入 `fixtures/claude/`;确认 schema 传递方式(内联/文件)与 session id 字段位置 | T0.2 | M |
| T0.4 | (脚本) | 探针:claude `--session-id` 预设能力是否存在(PF·F 标"需 M0 确认") | 明确结论(支持/不支持);若不支持→对齐 codex"id 由它给"模型,写回 PF·F | — | S |
| T0.5 | (脚本) | 探针:kill 能否杀穿 claude `.ps1/.cmd` shim 背后的 node 子进程(对应 codex PF·A 已知,claude 未测) | 起 claude headless 后 kill,确认 node 子进程被回收;否则记"需进程树 kill / `taskkill /T`"结论 | — | S |
| T0.5b | (脚本) | **探针:沙箱出网(吃 red-security RS-B1 blocker)** | codex `-s workspace-write` 与 claude 实现期权限模式下,子进程 `curl` 打本地探测端点能否出网;结论写回 PF 新增节;**可出网→ §4 RP9 触发、08 L4 须改应用层强约束** | — | M |
| T0.6 | (脚本) | 探针:claude 端 token 计量字段(对齐 codex `turn.completed.usage`,PF·B/G) | 找到 claude 事件流里的 usage 字段名;记录到两端能力对照表(适配层 06 归一化用) | T0.3 | S |
| T0.7 | docs | 把 T0.1–T0.6 结论写回 PF 对应节 + 产出"两端能力对照表"(启动/schema/resume/系统提示/kill/usage/出网) | PF 更新(含 T0.5b 出网结论);对照表入库;`fixtures/` 注明版本;M0 闸门**五项**判定全过(含 T0.5b) | T0.1–T0.6,T0.5b | S |

> **M0 不做**:任何 monorepo/包脚手架、任何产品代码。探针脚本是一次性的,产物是**结论 + fixtures**,不进产品依赖图。

### 2.2 M1 · 双 CLI + 红蓝单剧本 + 终端最小闭环

> 关键路径核心。T1.2(shared schema)是所有包地基,必须最先稳定。M1 红蓝为**纯决策回合**,不含 worktree 写,规避最重模块。

#### 脚手架与地基

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T1.1 | (根) | corepack 启用 pnpm + 根脚手架(`pnpm-workspace.yaml` / `tsconfig.base` / `.npmrc`(npmmirror) / `.gitattributes`(eol=lf) / `.gitignore`) | `pnpm -v` 通过;`tsc -b` 空跑过;装包走 npmmirror(PF 外:MEMORY npm-mirror) | M0 | S |
| T1.2 | shared | `@sylux/shared`:落 02 全部 zod schema(Message/Evidence/FilePatch/AgentMessagePayload/AgentEvent/Round/BoardState/JsonlRecord)+ `validateMessage` + 指纹/哈希 + jsonl encode/decode + 错误码 | **第一步先补全 02 §12 `SyluxErrorCode` union(PRE-1)**,再落 schema;02 §13 契约测试矩阵 V1–V20 全绿;`SyluxError` 全仓编译无缺码;`buildAgentOutputJsonSchema()` 产出可用 | T1.1,PRE-1,PRE-2 | L |
| T1.3 | shared | `@sylux/shared`:`contentHash`/`normalizeContent`/`fingerprint`/`fingerprintSet`(02 §9,跨平台 CRLF/LF 归一)+ **指纹前缀/后缀常量与谓词导出**(吃 FEAS-6) | V16(CRLF==LF 同 hash)、V17(两轮同 evidence 新指纹空)过;**导出 `FP_PREFIX_FILEREF='f:'`/`FP_PREFIX_SPEC='s:'`/`FP_PREFIX_CMD='c:'`/`FP_SUFFIX_UNVERIFIED=':?'` + 谓词 `isUnverifiedFp`/`isSpecFp`**,供 04 收敛 import(非裸 `startsWith`/`endsWith`),谓词入契约测试——02 改格式时谓词跟改一处、04 自动跟随 | T1.2 | S |

#### 引擎与剧本(@sylux/core)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T1.4 | core | engine 循环骨架(03 §runEngine):刹车前置→planRound→runTurn→append→刹车后置 | FakeAdapter 驱动跑通一轮;引擎本体范式无关(单测) | T1.2 | L |
| T1.5 | core | Blackboard 实现(append/contextFor/snapshot/subscribe,02 §Blackboard 接口) | append 后 subscribe 收到增量;contextFor 只含 delta(单测) | T1.4 | M |
| T1.5b | core | **DigestBuilder v0(吃 FEAS-4,独立任务+连续性验收)**:结构化锚点 digest——保最近 K 轮全文 + 更早轮只留 evidence 锚点(`file_ref` path:line + `command` cmd),丢 body 散文 | 算法**钉在 03**(停止 03↔17 互相 punt);零 NLP、可单测、与 H5 注入约束兼容(只留结构化);**连续性验收**:第 3 轮 `PromptContext` 仍含第 1 轮 proposal 锚点,agent 不重复第 1 轮已驳方案 | T1.5 | M |
| T1.5c | agents | **只读任务快照 + `ValidateContext` 实现(吃 FEAS-2 blocker,09 只读子集)**:把 `--task` 目录做只读 checkout/挂载,提供 `readFileRange(path,start,end)` + `contentHash` 复算 | critic 的 `file_ref` 能被引擎复算 hash 判强/弱;**远轻于 worktree 写合并**(无写、无 3-way);无此项则 M1 强核验假绿 | T1.2 | M |
| T1.6 | core | Playbook 接口 + `red-blue.ts` 单剧本(proposer↔critic 交替,assignment 可配)**M1 档:`shouldMergeAt=false`、proposer 不声明 `files`**(吃 FEAS-3) | proposer 提案→critic 带证据批判交替;assignment 换边只改配置(单测);**回填 03 §7.1**:M1 红蓝纯决策,03 §7.1 的 proposer "files 声明改动意图"+`shouldMergeAt=true` 属 M3 写文件档,M1 不启用 | T1.4 | M |
| T1.7 | core | runTurn:取上下文→过防火墙→调 adapter→解析事件流→safeParse + 带错重试 ≤N→返回 Message;**evidence 经 `ValidateContext` 复算判强/弱**(吃 FEAS-2) | 不合 schema 重试耗尽抛 `OUTPUT_SCHEMA_VIOLATION`,原文落 raw log(脱敏);critic `file_ref` 复算 hash 对得上=强、对不上/读不到=打回;V14 子集校验过 | T1.5,T1.5c,T1.10 | M |
| T1.8 | core | brakes 最小集:maxRounds(`ROUND_LIMIT_EXCEEDED`)+ done(对面带**复算通过的强 evidence** ack 才停) | 单测两条刹车;一方 done 不直接停,需对面 ack 带**经 T1.5c 复算通过**的强 evidence | T1.4 | M |
| T1.9 | core | jsonl 持久化写入 + 崩溃恢复重建 BoardState(02 §7.3 投影) | run 落 `runs/<runId>.jsonl`;杀进程后回放重建 BoardState 正确(V18–V20) | T1.5,T1.2 | M |

#### 适配层与安全(@sylux/agents)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T1.10 | agents | codex adapter(05):直调真 exe(PF·A 路径解析)+ prompt 走 stdin + 解析 `thread.started.thread_id`→emit `session_started` + `--output-schema` 文件 + **`-s read-only`**(吃 FEAS-8:M1 纯决策不写文件,封 read-only 比 workspace-write 更小更安全)+ `--ignore-user-config` | fake-codex 集成测试跑通;首事件为 session_started;命令行含 `-s read-only`;PF·A/B 约束遵守 | T1.2,T0.7 | L |
| T1.11 | agents | claude adapter(06):`-p --output-format stream-json` + schema 传递(内联或文件,依 T0.2/T0.3 结论)+ session id 回吐 + usage 归一(T0.6) | fake-claude 集成测试跑通;事件流首事件 session_started;usage 字段归一到 `tokenUsageSchema` | T1.2,T0.7 | L |
| T1.12 | agents | `buildChildEnv(agent)` 单一出口(08 env 白名单,`extendEnv:false`) | 断言:codex 子进程无 `ANTHROPIC_*`,claude 子进程无 `OPENAI_*` | T1.10,T1.11 | S |
| T1.13 | agents | key 不进 argv 预扫描(08):execa args 现 `sk-`/长 base64 → 抛 `PROVIDER_CONFIG_INVALID` | 断言:含 key 模式 args 即抛错;redact 覆盖 spawnargs | T1.12 | S |
| T1.14 | agents | kill / 超时:杀穿 shim 背后真实 node 子进程(PF·A codex 已知,claude 依 T0.5) | 单测:kill 后子进程被回收(必要时进程树 kill) | T1.10,T1.11,T0.5 | M |
| T1.15 | core | 内容防火墙 `firewall.sanitize`(08):`<untrusted-peer-output>` 边界 + 注入特征扫描 + files 路径白名单 | 注入样本(ignore previous / 读 auth/.env / 出站 URL)被降级为引用 + 告警;`..`/越界路径拒 | T1.2 | M |

#### 入口与终端渲染(@sylux/server)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T1.16 | server | CLI 入口 `sylux run --playbook red-blue --task <dir>`(commander,`<dir>`=只读快照源) | 一条命令驱动真实 codex+claude **≥3 轮**对抗(吃 FEAS-4) | T1.6,T1.10,T1.11,T1.5c | M |
| T1.17 | server | 终端渲染器:按 round/from/role/kind 着色打印气泡(订阅 Blackboard) | 终端实时见红蓝对抗气泡;与 jsonl 一致 | T1.16,T1.9 | S |
| T1.18 | (全) | M1 端到端冒烟 + fixtures 回归(用 fake-CLI 不烧 token) | `sylux run` 全链路过(含 ≥3 轮连续性 + 强核验复算 + read-only 沙箱断言);CI(本地 pre-push)`pnpm check` 绿 | T1.16,T1.17 | M |

### 2.3 M2 · Web 实时面板

> 把 M1 终端闭环搬上浏览器 + WS 鉴权。WS 是双向控制通路,鉴权(08)未就位则 M2 不算完成。

#### 服务端 WS / REST(@sylux/server)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T2.1 | server | `ws` server 显式 bind `127.0.0.1` + 黑板增量广播 + 初连 snapshot(11) | 单测断言不监听非回环地址;面板初连拉 snapshot 后收增量 | M1·T1.9 | M |
| T2.2 | server | WS 鉴权中间件(08):握手校验 Origin 白名单 + 一次性 run token | 单测:无 token / 错 Origin 拒连 | T2.1 | M |
| T2.2b | server | **ws-ticket 签发端鉴权(吃 RS-M2)**:`POST /ws-ticket` 自身须校验本地 run 持有者凭证(进程级密钥/启动时一次性 secret),不靠"非浏览器拿不到 token"循环论证 | 单测:本机 `curl` 直打 `/ws-ticket` 无持有者凭证→拒发 control token;伪造 Origin+裸打端点穿不透 | T2.2 | M |
| T2.3 | server | 观战/控制权限分级(08):pause/inject 控制类二次校验;只读连接发控制消息被拒 | 单测:只读连接 inject 被拒;控制连接放行 | T2.2b | M |
| T2.4 | server | 暂停/恢复 + inject:暂停挂起引擎、可恢复;inject 人工消息过防火墙后入黑板(`from:'human'`) | pause 后引擎挂起;inject 经 `firewall.sanitize`(M1·T1.15)入黑板 | T2.3,M1·T1.15 | M |
| T2.5 | server | REST:启动 run / 读改 provider 配置(不回传 key) | REST 启动 run 成功;provider 配置响应无 key 字段 | T2.1 | S |
| T2.6 | server | **evidence 引用预览生成(替代初稿 diff,吃 COV-9)**:从只读快照(M1·T1.5c)按 `file_ref` path+行区间取内容供面板高亮;超阈值/二进制降级 | 预览文本正确;**真正的 unified diff 推迟到 M3 T3.x**(M1/M2 无文件写=无 diff) | T2.1,M1·T1.5c | M |
| T2.12 | server | **流式跨帧 redact(吃 RS-M1)**:对 stream-json delta 帧带状态缓冲,跨帧拼接后再扫 `sk-ant-`/`sk-`/长 base64 整体打码;`diff_chunk` 跨 `seqInRef` 同理 | 单测:密钥被切成两个 delta 各自不匹配时,缓冲拼回仍被拦,不明文广播给 spectator | T2.1 | M |
| T2.13 | server | **WS 协议契约(11)先定**:消息格式(snapshot/append/control/error)冻结供前后端并行 | 协议 schema 落地;前后端按同一契约开发 | T2.1 | S |

#### 面板前端(@sylux/web)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T2.7 | web | Vite+React+TS 脚手架 + zustand store + 原生 WebSocket 客户端(10/11) | `pnpm dev:web` 起;连上 server 收气泡 | T2.1 | M |
| T2.8 | web | 对话气泡视图:按 round/from/role/kind 着色 + 轮数进度 + 刹车触发高亮 | 浏览器实时见红蓝对抗气泡流,与 jsonl 一致 | T2.7 | M |
| T2.8b | web | **输出转义 + CSP(吃 RS-B2 blocker)**:agent 内容(`body`/`quote`/文件名/evidence)进 DOM 一律转义,禁 `dangerouslySetInnerHTML` 裸插;设 CSP 禁内联 script、限 `connect-src` 到本地 ws | 单测:`body` 含 `<script>`/`<img onerror>` 被转义不执行;CSP 头存在——防被注入 agent 借 control 浏览器代发 abort/inject | T2.7 | M |
| T2.9 | web | **evidence 引用预览面板(替代初稿 diff,吃 COV-9)**:渲染 critic `file_ref` 对应快照行区间高亮 + 降级展示 | 预览渲染;二进制/大文件降级为路径+统计;**unified diff 面板移至 M3** | T2.7,T2.6 | M |
| T2.10 | web | 暂停/介入控件(权限分级 UI):控制态显示 pause/inject,只读态隐藏 | 控制连接可暂停+注入;只读连接无控制控件 | T2.8,T2.4 | M |
| T2.11 | (全) | M2 端到端:浏览器观战 + 暂停 + 介入一次真实红蓝对抗 | 全链路演示通过;WS 鉴权 + XSS 转义 + 跨帧 redact 断言全绿 | T2.8–T2.10,T2.8b,T2.12 | M |

### 2.4 M3 · 四剧本 + worktree 隔离 + 收敛调优(中粒度)

> worktree(09)是 parallel 剧本硬前提,与四剧本同里程碑。开工前各任务再细化。

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T3.1 | agents | `worktree.ts`:create(独立分支)/ diff(`--find-renames`)/ destroy(09) | 每 agent 独立 worktree;diff 正确;清理无残留 | M1 | L |
| T3.2 | agents | 轮末 3-way 合并 + 冲突硬停:冲突=`WORKTREE_CONFLICT` + 不自动选边 + 合并前 tag/stash 可回滚(09) | 冲突单测硬停;回滚验证;合并串行执行 | T3.1 | L |
| T3.3 | core | 冲突回灌:把 `MergeResult.conflicts` 作 evidence 回灌下一轮让 agent 自解(09) | 冲突回灌单测;下一轮 agent 收到冲突 evidence | T3.2 | M |
| T3.4 | core | `master-worker.ts` 剧本(planner→plan→worker→implement→planner→review) | 集成测试跑通;done=review 通过且 worker done | M1·T1.6,T3.2 | M |
| T3.5 | core | `pair.ts` 剧本(对等结对,交替 propose/review,双方互 ack) | 集成测试跑通;双方互 ack 带证据才 done | M1·T1.6 | M |
| T3.6 | core | `parallel.ts` 剧本(两 agent 并发各领子任务 implement,轮末统一合并) | 集成测试跑通;并发各写各 worktree;合并顺序可配(默认声明序) | T3.2 | L |
| T3.7 | core | 收敛检测(04 + 02 §9.3)**按范式/kind 分化**(吃 FEAS-5):辩论型(red-blue/pair)用强指纹差集连续空→`CONVERGENCE_STALL`;状态机型(master-worker/parallel)主信号改 done 收口、指纹 stall 仅辅助且 `stallWindow` 放大、planner 派活 `propose`/`question` 与 review 复用锚点轮按 role/kind 豁免;用 T1.3 谓词非裸字符串(FEAS-6) | 反例单测:① red-blue 换措辞同问题→stall、真新问题复用旧引用→不误杀;② **master-worker 派活轮+review 复用轮连续空集不被误杀**(FEAS-5 核心反例) | M1·T1.3,M1·T1.8 | M |
| T3.7b | core | **复跑器/沙箱基础设施失败分类(吃 COV-3)**:`runCommandSandboxed` 复算时区分"命令不安全"/"复算不符"/**"中枢侧故障(沙箱起不来/复跑崩/超时)"**;后者判 weak + 记 `system` 来源 + 不连坐 critic、不误算 stall | 单测:基础设施故障与复算不符走不同分支;system 故障不计入 critic evidence 信誉 | T3.7 | S |
| T3.8 | core | stall/done 解耦 + 终态 `stalled`(面板告警,不等于完成) | 单测:stall→终态 stalled + 系统消息;不触发 done | T3.7 | S |
| T3.8b | server/web | **unified diff 面板(从 M2 移来,此时才有文件写)**:implement 落 worktree 后 `git diff --find-renames` 产 diff,面板渲染,经流式 redact(T2.12)+ XSS 转义(T2.8b) | diff 文本正确;二进制/大 diff 降级为文件名+统计;转义/redact 复用 M2 守卫 | T3.2,T2.12,T2.8b | M |
| T3.9 | (全) | M3 端到端:四剧本各跑一次 + parallel 冲突人工裁决演示 + diff 面板 | 四剧本集成测试绿;parallel 冲突可面板裁决;diff 渲染正确 | T3.4–T3.8b | M |

### 2.5 M4 · provider 热切 + 成本控制 + 录制回放(中粒度)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T4.1 | providers | `@sylux/providers`:`ProviderConfig` 加载/校验(07)+ 每 agent 一份绑定 | zod 校验通过;新增 provider 仅追加配置无需改码 | M1 | M |
| T4.2 | providers | 热换 `reloadProvider`:只影响下一轮 spawn,运行中子进程不强改(07) | 单测:热换后下轮 spawn 用新 config;运行中进程不变 | T4.1 | M |
| T4.3 | providers | key 流向加固(08):只走 env/auth.json,绝不落盘/进 argv/日志;临时 config 0600 + run 后删 | 断言:args/日志/落盘配置均无 key;临时 config 权限正确 | T4.1,M1·T1.13 | M |
| T4.4 | core | token/成本硬上限(04):累计 token 触顶 `TOKEN_BUDGET_EXCEEDED`,按 PF·D 累积/超线性估;**前瞻按 regime 选公式(吃 FEAS-1)**:continuity 从 stateless 切 resume 那轮直接用 `base×chainLen` 上界,非标量外推;首轮前瞻不可信、靠 maxRounds/maxTotalTokens 硬上限兜 | 触顶停;master-worker regime 切换轮预算用超线性上界(单测);首轮不依赖前瞻 | M3·T3.7 | M |
| T4.4b | core | **usage 缺失/漂移不失明(吃 ROC-M1)**:`turn.completed.usage` 缺失时 input 按 18.7k 地板**且 output 按范式历史均值/上界估**(不当 0),`maxCostUsd` 用此算;usage 字段漂移=degradable+告警但仍按上界兜底 | 单测:usage 缺失时 output 非 0、\$ 上限仍能挡住真实花费;字段漂移不静默放行 | T4.4 | S |
| T4.5 | core | 单轮 context cap(`perTurnContextCap`):超限截断/拒绝(04) | 单测:超 cap 的 context 被截断/拒 | T4.4 | S |
| T4.6 | core/eval | 录制-回放:真实 run 事件流落 fixtures + ReplayAdapter 重放(14/18 雏形) | ReplayAdapter 重放逐字节复现 BoardState | M1·T1.9 | M |
| T4.7 | providers | 出站内容守卫(08):进 prompt 文件 secret scan + `.syluxignore` 默认排除 `.env`/`.git`/credentials | `.env`/私钥/token 命中拒发或脱敏(断言) | T4.1 | M |
| T4.8 | providers | 官方直连 provider 选项 + README 数据出境标注(08/19) | 提供直连选项;README 显式标注出境 | T4.7 | S |
| T4.8b | (前置) | **16 §6.4 默认预算表修正(吃 ROC-B1 blocker)**:stateless 默认范式(red-blue/pair/parallel)改用线性估(≈225k),不套 resume 超线性公式(误配 808k);对齐 18 §6.4 `estimateRunTokens` regime 分叉 | 16 改对;默认配置下 B3 预算安全网对三个 stateless 范式生效(单测:stateless 预算≈线性目标) | T4.4 | S |
| T4.9 | (全) | turbo + commitlint + husky + 双平台 CI matrix(含 windows-latest)+ secret-scan pre-commit(13) | CI 绿;windows job 过;`.env`/Bearer/sk- pre-commit 拦截 | M3 | M |

### 2.6 M5 · 评测台 + Fusion 评审团(中粒度)

| ID | 所属 | 任务 | 验收 | 依赖 | 工作量 |
|---|---|---|---|---|---|
| T5.1 | eval | `@sylux/eval`:`EvalTask`/`EvalTaskSet`/`Assertion`(18 §2,可机器核验断言) | schema 落地;断言用 file_ref/command 锚点(EV4) | M4·T4.6 | M |
| T5.2 | eval | `EvalMatrix`(剧本×provider 组合枚举)+ runner 管线(18 §3)**接 17 全局许可池(吃 ROC-M3)** | 矩阵展开;runner 喂 SyluxConfig 收 jsonl;**`(task,cell)`×parallel 2 路×panel N 成员叠加不破 8 并发 429 顶**——runner 复用 17 `ConcurrencyGovernor`(按 provider 端点分池),单测断言并发上限不超端点配额 | T5.1 | M |
| T5.3 | eval | `EvalScore` 质量指标:通过率/红队有效发现(核验通过+新指纹)/收敛轮数(18,EV6) | 离线对历史 jsonl 打分(EV2);红队发现量化(EV6) | T5.2 | M |
| T5.4 | eval | 成本指标:累计 token(实测 usage,EV5)+ 费用换算 + wall-clock | 成本用 `turn.completed.usage` 换算,不本地估 | T5.3 | S |
| T5.5 | eval | `AbReport` A/B 对比 + 公平性硬门(EV7)+ 产物输入指纹可复现(EV8) | 同任务集/同预算口径校验;同输入同 EvalScore(回放态) | T5.3,M4·T4.6 | M |
| T5.6 | core | `@sylux/core/fusion`:`FusionExecutor` fan-out→collect→judge→synthesize(21 §5)**仅 runTurn 接入(吃 FEAS-9)** | 一次 panel 发言只产一条 payload(F1);成员无状态 single-shot(F3);**`onStart`/`onFinish` 不挂 panel**(它们 `Promise<void>`、不产 payload);21 §2.3"parallel onStart 挂 panel"作废→parallel 标"不适用 Fusion" | M4·T4.1 | L |
| T5.7 | core | judge(21):synthesize/vote/best_of 三策略 + 裁判级重试(只重 judge 不重 fan-out,F5) | evidence 不达标只重跑 judge ≤k 次(单测) | T5.6 | M |
| T5.8 | core | evidence-map(21 §6):judge 产物→02 EvidenceItem + 充分性预检(F4) | critique 至少一条**强**核验 evidence(02v2 已收紧"≥1 强",weak 不解锁),否则 `EVIDENCE_UNVERIFIABLE` | T5.6 | M |
| T5.9 | core/providers | Fusion 执行回合双闸(21 §0.2)**+ 写文件 propose 同禁(吃 FEAS-3)**:配置期 superRefine 拒 `implement`、运行期抛 `FUSION_KIND_FORBIDDEN`;凡声明非空 `files`/`shouldMergeAt` 的发言也禁 panel(边界按"是否写文件"而非纯 kind) | 配置含 `implement` 校验失败;运行期命中 implement/写文件 propose 抛错;不静默清空 files | T5.6,T4.1 | S |
| T5.10 | (全) | M5 端到端:评测报告产出 + Fusion 决策回合演示(成本按 (N+1)× 计入预算) | 评测报告可 diff/回归;Fusion 成本计入累积预算(F8) | T5.5,T5.9 | M |

---

## 3. 关键路径与瓶颈

### 3.1 关键路径图(从 M0 到 M1 完成)

```
M0 闸(T0.1→T0.7,五项含 T0.5b 出网)── 残留探针 + fixtures;不全过则方案重估
   │ 必须先过(T0.2 内联 schema 体积下界 → 决定 claude schema 传递方式;T0.5b 出网 → 决定注入防线)
   │ 前置 PRE-2(02 字段集冻结)才能跑 T0.2
   ▼
T1.1 脚手架
   │
   ▼
[PRE-1 补 02 §12 错误码 union] → T1.2 shared schema(★全项目地基,所有包卡在它)── T1.3 指纹/哈希+谓词
   │
   ├──────────────┬─────────────────┬──────────────┬──────────────┐
   ▼              ▼                 ▼              ▼              ▼
T1.4 engine    T1.10 codex adapter  T1.11 claude   T1.15 防火墙   T1.5c 只读快照/ValidateCtx
   │            (-s read-only)      adapter        │            (★FEAS-2:无它强核验假绿)
   ▼              └────────┬─────────┘              │              │
T1.5 Blackboard            ▼                        │              │
T1.5b digest v0   T1.12 env 白名单→T1.13 key 不进 argv→T1.14 kill  │
   │(★FEAS-4:无它>2轮失忆)  │                        │              │
   ▼                       ▼                        │              │
T1.6 red-blue     T1.7 runTurn(safeParse+复算强核验)◄── T1.15 ◄────┘
(shouldMergeAt=false)      │
T1.8 brakes                │
   │                       │
   ▼                       │
T1.9 jsonl 持久化          │
   │                       │
   └───────────┬───────────┘
               ▼
        T1.16 CLI 入口(≥3 轮)→ T1.17 终端渲染 → T1.18 e2e 冒烟  ✅ M1 完成
               │
               ▼
        M2:T2.1 ws → T2.2 鉴权 → T2.2b ticket 签发鉴权 → T2.8b XSS转义 → T2.12 跨帧redact → T2.8 气泡  ✅ M2 完成
               │
               ▼
        M3:T3.1 worktree → T3.2 3-way 合并(★parallel 前提)→ T3.6 parallel;T3.7 收敛按范式分化;T3.8b diff 面板
               │
               ▼
        M4:[T4.8b 修 16 预算表] → T4.1 provider → T4.4 token 预算(regime 选公式)→ T4.6 回放
               │
               ▼
        M5:T5.1 eval → T5.2 runner(接 17 许可池)→ T5.6 FusionExecutor(仅 runTurn)→ T5.10 e2e  ✅ 全部完成
```

### 3.2 关键路径瓶颈(优先级最高的卡点)

| 瓶颈 | 卡住什么 | 为何关键 | 缓解 |
|---|---|---|---|
| **T1.2 shared schema**(前置 PRE-1) | 所有包 | 02 是全项目类型地基,它不稳所有人返工;错误码 union 缺码则 15 穷举编译红 | 最先做、最先冻结;先补 02 §12 错误码,契约测试 V1–V20 全绿才往下走 |
| **T1.5c 只读快照/ValidateContext**(FEAS-2) | M1 强核验(退出标准 3/4) | 无可读文件系统则 critic `file_ref` 复算不了 hash,"强核验通过"假绿、M1 核心卖点是假的 | 补 09 只读子集(无写无合并),与 adapter 并行做 |
| **T1.5b digest v0**(FEAS-4) | M1 stateless 连续性(≥3 轮) | 03↔17 双向 punt、算法无人定义,>2 轮 agent 失忆、人为制造收敛假象 | 钉死结构化锚点 v0 算法在 03;独立任务+连续性验收 |
| **T0.2/T0.3 claude schema 传递** | T1.11 claude adapter | 内联超 32KB 则 claude 退化为 stream-json 传 schema,改 adapter 工作量 | M0 用临时 schema 量下界、T1.2 后正式 dist 校(两段闸,FEAS-7),别等 M1 撞墙 |
| **T1.10/T1.11 双 adapter** | M1 整个闭环 | 两端启动/schema/resume/kill 高度不对称(PF·A/E/F),最易出 Windows spawn 坑 | 复用 M0 fixtures + fake-CLI 集成测试,不烧 token |
| **T3.2 worktree 3-way 合并** | parallel 剧本(T3.6)→ M3 | 冲突自动选边=丢写,必须硬停;最重 L 级 | M1 红蓝纯决策回合先绕开;M3 专注啃下 |
| **安全守卫(T1.12–T1.15 + M2 XSS/ticket/redact)** | M1/M2 退出 | 注入=RCE / 凭证串台 / 面板 XSS 是 blocker,守卫未就位不算完成 | 攻击面随里程碑落地守卫 + 断言测试(原则 2) |

### 3.3 可并行的工作流

- M1 内:`T1.10 codex` 与 `T1.11 claude` 两 adapter 可双人并行(接口同为 `AgentAdapter`,02/03 已定);`T1.15 防火墙`、`T1.5c 只读快照`、`T1.5b digest v0` 三者互相独立、且独立于 adapter,可并行。
- M2 内:`server`(T2.1–T2.6/T2.12/T2.13)与 `web`(T2.7–T2.10/T2.8b)经 WS 协议(11)解耦,可前后端并行——先做 `T2.13` 冻结 11 消息格式做契约。
- M3 内:三个剧本(T3.4/T3.5/T3.6)在 worktree(T3.2)就位后可并行;收敛检测(T3.7)独立可并行;diff 面板(T3.8b)依赖 T3.2 + M2 守卫。

---

## 4. 路线图层面风险与缓解

| # | 风险 | 影响里程碑 | 缓解 | 残留 |
|---|---|---|---|---|
| RP1 | mouubox 中转复杂嵌套 schema 不稳定成形 | M1 | 02 §8.4 safeParse 兜底链(带错重发≤N);M0 已证简单/嵌套可行(PF·C) | 复杂度极高 schema 仍可能耗尽重试→`OUTPUT_SCHEMA_VIOLATION`,记开放问题 |
| RP2 | resume 累积 token 让多轮辩论成本爆炸(PF·D 36×base) | M1/M4 | 应用层只喂 delta + 旧轮压 digest v0(T1.5/T1.5b);M4 token 预算按累积估(T4.4) | 长辩论本质贵,靠 maxRounds + 预算硬封顶;digest v0 若退化为全量直传则 M1 不省 token、maxRounds 须压低(FEAS-4 备选) |
| RP3 | Windows spawn / kill 杀不穿 shim 子进程 | M1 | M0·T0.5 先探;T1.14 进程树 kill 兜底 | claude 端 kill 行为待 T0.5 结论 |
| RP4 | claude 内联 schema 超 32KB | M1 | M0·T0.2 量下界字节、T1.2 后 T0.2b 正式校(两段闸);超则 stream-json 传 schema | T0.2 下界与 T1.2 实际值差异超阈则 T1.11 方案重审 |
| RP5 | worktree 3-way 合并顺序敏感(parallel 结果受合并序影响) | M3 | 合并序可配(默认声明序)+ 冲突硬停不自动选边 | 顺序敏感性需 M3 设计时实测(对应总体规划 Q6) |
| RP6 | provider 中转失效需热换 | M4 | provider 可配可热换可加新(锁定决策 4);热换只影响下轮 | 运行中子进程不强改,当轮可能失败需重跑 |
| RP7 | Fusion 成本 (N+1)× 失控 | M5 | Fusion 仅决策回合启用 + 成员无状态 single-shot(F3)+ 裁判级重试不重 fan-out(F5) | 默认不每轮开,关键决策才用 |
| RP8 | 项目若不托管 GitHub → CI 无处跑 | M4 | CI 降级为本地 pre-push 全量 `pnpm check`(总体规划 O3) | 双平台 matrix 仅 GitHub 可用时启用 |
| RP9 | 沙箱**可出网**则注入"断网兜底"防线失效(red-security RS-B1) | M0 探/M1+ 守 | M0·T0.5b 实测出网;若可出网→08 L4 改应用层强约束(无后门 spawn + 出站白名单 + 边界标记/特征扫描两层不再当唯一依赖) | 关键词扫描/边界标记自认可绕,出网兜底是最后一道;实测前 L4 悬空,这条压在 M0 闸 |
| RP10 | 默认预算表 stateless 误套 resume 超线性公式(ROC-B1) | M4/M5 | T4.8b 前置修 16 §6.4 对齐 18 regime 分叉(线性≈225k) | 不修则 B3 预算网对三默认范式形同虚设、评测基线偏 3.6× |

---

## 5. 6–24 个月远景

### 5.1 近景(3–6 月,M5 收尾后的自然延伸)

- **N>2 agent(双工→多工)**:黑板协议(02)的 `AgentId` 与 `Message` 天然支持多发言主体,引擎(03)`planRound` 已是多 turn 返回;扩到 3+ agent 主要是 worktree 管理(09)与合并序(M3 已可配)的工程化,不动核心契约。
- **playbook 市场化**:剧本(03)是纯接口对象,社区可贡献新打法;配合插件 DSL(20)做剧本声明式定义,降低贡献门槛。
- **面板可介入增强**:从 pause/inject 扩到"逐轮单步""回滚到第 k 轮重跑"(基于 jsonl 时间旅行,02 §7)。

### 5.2 中景(6–12 月)

- **范式自动选择**:按任务类型(找 bug / 实现 / 重构 / 探索)推荐 red-blue/master-worker/pair/parallel;用评测台(18)历史数据做推荐依据。
- **成本/质量回归基线**:把评测台(18)的 `EvalScore` 沉淀成回归基线,每次改 playbook/换 provider 自动跑 A/B,防质量退化。
- **录制-回放产品化**:M4 的回放(T4.6)从调试工具升级为"离线复现一次 run + 改 playbook 重跑对比"的标准工作流。

### 5.3 远景(12–24 月)

- **本地小模型做裁判/收敛判定**:把 stall 判定(02 §9)、Fusion judge(21)的部分工作下放本地小模型,省中转 token(PF·D 成本约束的根治方向)。
- **跨仓库编排**:多 worktree 多项目并行,sylux 抽象成"agent 编排内核",接入更多 CLI(不止 codex/claude)。
- **团队协作模式**:多人观战同一 run;需把 08 的本地单机鉴权升级为真正多用户鉴权 + TLS(19 部署合规)。
- **可选商业化**:企业自托管版(官方直连 provider、审计日志、可审计的数据出境策略引擎,把 08 §出站守卫做成策略引擎),对接 19 合规要求。

---

## 7. M1 开工前必须人拍板的产品裁决(红队 FEAS-3/4/5 + COV-9)

> 这些不是回填措辞能解决的——是**同一行为在两份权威稿里定义相反 / 算法无人定义 / 判据套错范式**。§1–§2 已按"红队建议默认裁决"写死,本节列每条的备选与翻盘代价。定稿若推翻默认,须同步改 §1–§3 与对应权威稿(03/16/17/21)。

| ID | 裁决点 | 默认裁决(本文件已据此写死) | 备选 | 翻盘代价 |
|---|---|---|---|---|
| **D1** | 红蓝 propose 写不写文件(03 §7.1 写 vs 25 M1 不写) | **M1 红蓝纯决策、proposer 不声明 files、`shouldMergeAt=false`;critic 引用只读任务快照(T1.5c)**;真实文件写推迟到 M3 implement | M1 即让红蓝写文件→必须把 worktree 写合并(T3.x)整体前移到 M1,M1 不再"最小" | 回填 03 §7.1(M1 档关掉 proposer files + 合并);Fusion 边界(21 §0.2)须从"按 kind"改"按是否写文件"(已在 T5.9 吃);若翻盘则 M1 工作量 +1 个 L 模块 |
| **D2** | DigestBuilder 算法归属(03↔17 双向 punt) | **钉在 03,v0 = 结构化 evidence 锚点(保最近 K 轮全文 + 更早轮只留 file_ref/command 锚点)**;独立任务 T1.5b + 连续性验收 | 归 17;或 v0=全历史直传(不裁剪) | 全历史直传→M1 不省 token、放弃 PF·D 省钱手段、与 16 §783"resume 成本会爆"自相矛盾,maxRounds 须压到很低(如 4) |
| **D3** | 收敛是否按范式分化(04 全局 stallWindow vs 状态机范式空证据轮) | **按范式/kind 分化:辩论型用指纹差集、状态机型用 done 收口 + 派活/复用轮豁免**(T3.7) | 全局统一 stallWindow + 靠调大规避 | 不分化→master-worker 的"派活轮+review 复用轮"固定相位被误杀成 `stalled`,调参只推迟不消除;需 04 增"按 role/kind 豁免"字段 |
| **D4** | M2 diff 面板渲染什么(M1/M2 无文件写=无 diff,COV-9) | **M2 做 evidence 引用预览(快照行区间),unified diff 推迟到 M3**(T3.8b) | 强行 M2 出 diff→须把 implement 写文件前移 | 前移=破坏 M1/M2"纯决策最小闭环"定位,与 D1 联动 |

> 这 4 条与 x-* 的编号/术语项**正交**:x-* 修"同概念两处叫法/编号不同"(回填即可),本节修"同行为两处定义相反 / 判据套错范式"(须先裁决才能开工)。

---

## 6. 收尾:本文件的交付契约

1. **里程碑切分权威**:M0–M5 的目标/范围/退出标准以本文件 §1 为准;与总体规划 §13 冲突处按 §0.3 对账表回填 §13/§14。
2. **任务可开工**:M0–M2 任务(§2.1–§2.3)细到 ID/验收/依赖/工作量,可直接派工;M3–M5(§2.4–§2.6)中粒度,开工前各自再开一轮细化。
3. **不另写类型**:本文件全程引用 02/03/04…23 与 PF,**未定义任何新类型/接口/算法**(焊死红队 R1)。任务验收里出现的 schema/错误码/算法一律指其权威源。
4. **关键路径焊死**:`T1.2 shared schema`(前置 PRE-1 错误码)是全局地基瓶颈,`M0 闸`(五项含 T0.5b 出网)是项目前置闸,`T1.5c 只读快照`/`T1.5b digest v0` 卡 M1 核验与连续性,`T3.2 worktree 合并`卡 parallel/M3;任一滑动整体顺延(§3.2)。
5. **编号权威**:全文用磁盘文件名编号(§0.6 映射表),08=安全、09=worktree、10=面板、11=WS;逻辑编号派旧引用作废,全仓据 §0.6 回填(吃 C-NUM/COV-6)。
6. **裁决前置**:§7 的 D1–D4 是 M1 开工前的人工产品裁决,不是措辞回填;§1–§2 已按默认裁决写死,翻盘须同步改权威稿(吃 FEAS-3/4/5、COV-9)。
7. **跨里程碑硬前置**:§0.5 的 PRE-1(02 错误码补全)、PRE-2(02 字段集冻结)是别的文档须先交付的产物,卡 T1.2/T0.2;闸门不放行未补齐者。
