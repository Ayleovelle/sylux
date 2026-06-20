# 23 · 统一术语表与系统不变量(全文消歧 + 实现自检基准)v2

> **版本**:v2(2026-06-20,run-tag v3.1)。v1→v2 吃掉 x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost 五份报告里针对本节的 findings:**E1/COV-8 术语表整体陈旧于 v2**(强/中、checkBefore/checkAfter、done↔stall 双处、digest 归属、编号逻辑派)、**C-NUM/COV-6 编号双轨制**、**COV-10 evidence 门「强/中」残留**、**A1/COV-1 错误码全集**、**E5 firewall.wrap 旧对象**、**ROC-B1 默认预算超线性误配**、**RS-B2 面板 XSS**、**RS-M1 流式 redact 跨帧**、**FEAS-4 digest 算法无主**、**FEAS-5/COV-3 合法空证据轮/核验降级误杀**、**RS-M5/ROC-M5 扇出无前瞻+无单 turn 上限**、**ROC-M1 usage output 缺失绕过费用上限**。逐条落点见 §0.3 修订台账。
>
> **本文件地位**:sylux 全项目的**术语权威**与**不变量清单**。两个职责:
> 1. **术语表**:把 `round`/`turn`/`agent`/`role`/`adapter`/`playbook`/`blackboard`/`evidence`/`worktree` 等高频词钉成**单一精确含义**,消除跨文档同词不同义、异词同义的歧义。任何文档、任何代码注释、任何对外沟通用到这些词,以本文件为准。
> 2. **不变量清单**:把散落在各文档的不变量(02 的 I 系列、03 的 E 系列、05/06 的 A 系列、09 的 W 系列、21 的 F 系列、安全 08 的 S 系列)**汇编成一张可勾选的总表**,标注**谁强制、在哪强制、违反时的错误码**,供全文交叉引用与实现期自检 / CI 断言。
>
> **本文件不重定义类型**:所有 zod / TS 类型的权威是「黑板协议(02)」(`@sylux/shared/src/blackboard.schema.ts`)。本文件涉及 `Message`/`Evidence`/`Round`/`BoardState`/`AgentEvent` 等一律**引用 02**,不另写一行 `z.object`。术语条目里的「类型锚点」列只给出该术语对应 02 / 03 / 05 / 06 等文档的定义位置,不复制定义体。
>
> **与红队结论的关系**:不变量总表(§3)的每一条都标注其对应的红队条目(R1–R8)或文档内不变量编号,确保「预先吃掉的红队结论」有唯一可追溯落点,不在多处漂移。
>
> **事实标注约定**:凡基于假设而非本机实测,显式标注【待实测】;事实地基(`docs/PROBED-FACTS.md`)已覆盖的不再标注。

---

## 0.2 文档编号权威映射(锚定磁盘文件名,焊死 C-NUM / COV-6)

> **裁决(本表为全仓编号权威)**:历史上文档存在「文件名编号派」与「逻辑编号派」双轨制(C-NUM/COV-6,横跨全仓,11/12/22 单稿自相矛盾)。**本表钉死:一律以磁盘文件名前缀为准**,逻辑分组只作辅助角色名防漂,不再作为引用编号。任何文档、代码注释、交叉引用写「刹车 07」「worktree 06」「安全 09」「面板 08」均为**过期写法**,按本表回填。

| 文件名编号 | 文件 | 角色名(辅助防漂) | 历史逻辑编号(已废) | 拥有的核心契约 |
|---|---|---|---|---|
| 01 | `01-arch-topology-loop.md` | 架构拓扑与主循环 | — | 进程模型 / 顶层时序 |
| 02 | `02-blackboard-types.md` | 黑板协议(唯一类型权威) | — | `Message`/`Evidence`/`Round`/`BoardState`/`AgentEvent`/错误码全集/指纹签名 |
| 03 | `03-engine-playbook.md` | 引擎与剧本 | — | `Playbook`/`PromptContext`/`TurnDirective`/`RoundPlan`/`Blackboard`/`BoardView`/`EngineDeps`/`runEngine`/`DigestBuilder` |
| 04 | `04-convergence-brakes.md` | 收敛刹车(StopPolicy) | **07**(02/03 旧引用) | `StopPolicy`/`StopContext`/`StopDecision`/`CompositeStopPolicy`/`DonePolicy`/`PlaybookDonePolicy`/预算预测 |
| 05 | `05-adapter-codex.md` | codex 适配层 | — | `AgentAdapter`/`createCodexAdapter`/`AgentInput` |
| 06 | `06-adapter-claude.md` | claude 适配层 | — | `createClaudeAdapter`/claude 专属字段 |
| 07 | `07-provider-config.md` | provider 配置 | **05**(逻辑派旧引用) | `ProviderConfig`/`KeyStore`/`PanelMember`/`JudgeConfig`/热换 |
| 08 | `08-security-firewall.md` | 安全与防火墙 | **09**(逻辑派旧引用) | `buildChildEnv`/`redact`/`firewallPeerMessage`/WS 安全规则/面板 XSS 消毒/沙箱封顶 |
| 09 | `09-isolation-worktree.md` | 隔离与 worktree | **06**(逻辑派旧引用) | `WorktreeManager`/`mergeRound`/`diffSince`/base·integration 拓扑 |
| 10 | `10-web-ui.md` | 面板前端 | **08**(逻辑派旧引用) | 渲染 / 控制权限 UI / HTML 消毒落地 |
| 11 | `11-ws-protocol.md` | WS 传输协议 | — | 帧线格式 / snapshot / ws-ticket 端点 |
| 15 | `15-observability-errors.md` | 可观测与错误 | — | 错误码穷举 `Record` / 观测旁路 |
| 16 | `16-config-schema.md` | 配置 schema | — | 运行期配置 / 预算表 / 热换面 |
| 17 | `17-performance.md` | 性能 | — | `ConcurrencyGovernor` / digest 高质量升级算法 |
| 18 | `18-eval-harness.md` | 评测 | — | runner / 成本模型校验 |
| 21 | `21-local-fusion.md` | 本地 Fusion | — | `FusionExecutor`/`panel`/`judge`/决策·执行回合表 |

> **遗留回填项(归对应文档,非本表强制)**:02 §12 错误码注释、03 个别旧引用仍残留逻辑派编号(如 02 注释里「刹车 07」「安全 09」「worktree 06」),需各自回填;本表只提供权威映射,不替它们改。本文件(23)自身全部引用已按本表对齐。

## 0.3 v2 修订台账(逐条吃掉红队 / 交叉 findings)

| # | finding | v1 问题 | v2 修订 | 落点 |
|---|---|---|---|---|
| G-EVID | COV-10 / E1 / E4 evidence 门 | 全文「强/中」二档,INV-T4 写「≥1 强/中」 | 收紧为 **02v2「≥1 条强核验通过」**,weak(无 quote 的 file_ref / 未实跑 command / spec_quote)单独不解锁;删全部「强/中」措辞 | §1.4、§2.3、§2.5、§3.1 INV-T4、§3.6 INV-F4、§4.1 |
| G-BRAKE | E1/E6/E8 刹车模型陈旧 | INV-E6 写 checkBefore/checkAfter 双侧;§1.5 brakes「前置+后置」 | 改 **04v3 单一轮末 `shouldStop` + 扇出/启动前瞻**;删 checkBefore/checkAfter;`CompositeStopPolicy` 拥有三重刹车+done | §1.5 brakes、§3.2 INV-E6 |
| G-DONE | E1 done↔stall「两处独立」 | 称 done 与 stall 是两处独立判定 | 改:判据解耦但**同在 04 `CompositeStopPolicy` 内按优先级裁决**(done 优先级 0 > stall),互不可见 | §1.5、§2.x、§3.2 INV-E4 |
| G-NUM | C-NUM/COV-6 编号双轨 | 刹车 07 / worktree 06 / 安全 09 / 面板 08 | 全部锚定文件名(§0.2 映射表) | 全文 |
| G-DIGEST | FEAS-4 digest 算法无主 + 归属错 | §1.4 称 digest 生成器「归刹车 07」 | digest **接口 `DigestBuilder` + 基线算法归引擎 03**,高质量升级归性能 17;**生成算法本身仍无主(FEAS-4)**,标 openQuestion | §1.4、§6.1 |
| G-ERR | A1/COV-1 错误码 | INV 引用零散,称「下游已用未登记」 | 02v2.1 §12 已补全为分域全集,本表只引用,标已闭合 | §1.8、§3 各违反信号列 |
| G-FW | E5 firewall.wrap | §1.8 ContentFirewall 对象 + `.wrap()` | 改 **08 `firewallPeerMessage(msg,ctx)→{action,wrapped}`** 纯函数 | §1.8、§3.5 INV-S3 |
| G-COST | ROC-B1 默认预算超线性误配(blocker) | INV-C1 称「N 轮 ≈ base×(1+2+…+N)」一刀切超线性 | 改 **regime 感知**:stateless 近似线性(默认范式),resume 才超线性;默认预算按 regime 分叉 | §2.4、§3.7 INV-C1 |
| G-NEW | FEAS-5/COV-3/RS-M5/ROC-M1/RS-B2/RS-M1 | 新硬化点无对应不变量 | 新增 INV-E10(空证据轮冻结)/INV-E11(核验降级不连坐)/INV-C4(扇出前瞻+单 turn 封顶)/INV-C5(usage 双侧兜底)/INV-S9(面板 XSS 消毒)/INV-S10(流式跨帧 redact) | §3.2、§3.5、§3.7 |


---

## 0. 如何使用本文件

| 你是谁 | 怎么用 |
|---|---|
| 写其他设计文档 | 用到本表术语时按本文件定义用词;新造概念前先查本表有无同义词,避免造重复词。 |
| 写实现代码 | 命名(变量 / 类型 / 函数)对齐术语表「规范英文标识」列;提交前过 §4 自检清单。 |
| 写测试 / CI | §3 不变量总表的「强制点」列可直接转成断言;§3 每条给了违反时的可观测信号(错误码 / 状态)。 |
| 审阅(GPT / 红队) | §3 是验收锚点:逐条核对「在哪强制」是否真的有代码 / 校验落点,没有落点的不变量就是 TODO。 |

### 0.1 词法约定(全文统一)

- **斜体保留给范式名**:红蓝对抗 / 主从 / 对等结对 / 分工并行,对应 `PlaybookId` 的 `red-blue` / `master-worker` / `pair` / `parallel`。
- **代码体词**(`round` / `evidence` / `worktree`)指**字段名 / 标识符 / 协议词**,有精确类型锚点。
- **中文词**(轮次 / 证据 / 工作树)是其口语对应,语义等同,正式契约处用代码体词。
- **「中枢」= orchestrator**:调度中枢进程本体,全文中文统一叫「中枢」,代码 / `AgentId` 里叫 `orchestrator`。二者同指,不区分。

---

## 1. 核心术语表（按概念分层）

每条给：**规范中文词** · **规范英文标识**（代码里用的字面量 / 类型名）· **一句话定义** · **类型 / 定义锚点** · **易混点（与谁区分）**。

### 1.1 时间与流程层（round / turn / phase / run）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 运行 | **run** | 一次完整的 orchestrator 编排，从启动到终态（done/stalled/aborted/limit）。有唯一 `runId`，独占一份 `runs/<runId>.jsonl` 与一组 worktree。 | `Message.runId`、`BoardState.runId`（02 §5/§10） | 一个 run 含多个 round；进程重启后凭 `runId` + jsonl 回放恢复同一个 run。 |
| 轮次 | **round** | run 内部的一个**调度单位**，由 playbook 的一次 `nextTurn` 产出的 `RoundPlan` 界定；从 0 起单调递增。一轮内可有 1 条（串行范式）或 N 条（并行范式）发言。 | `Message.round`、`roundSchema`（02 §5/§10.1）、`RoundPlan`（03 §3.2） | **round ≠ turn**：round 是「这一拍」，turn 是「这一拍里某个 agent 的一次发言」。串行范式 round 内只 1 个 turn，二者数量相等但概念不同。 |
| 发言 | **turn** | 一个 agent 在某一轮里的**单次产出**（spawn 一次子进程→拿一条 `AgentMessagePayload`）。由 `TurnDirective` 指令、`runTurn` 执行。 | `TurnDirective`（03 §3.1）、`runTurn`（03 §5.2） | 不要叫它「message」：turn 是「执行动作」，它**成功**后才在黑板上落成一条 `Message`；turn 可失败（spawn 挂 / 校验打回）而不产生有效 message。 |
| 阶段 | **phase** | 范式内部的逻辑段落（如主从的「规划阶段 / 实现阶段 / 评审阶段」）。是 playbook 内部状态，**非内核一等概念**。 | `RoundPlan.phaseHint?`（03 §3.2，弱信号） | phase 是 playbook 自己的事，引擎不强依赖；不要把 phase 和 round 画等号，一个 phase 可跨多 round。 |
| 合并点 | **merge point** | `shouldMergeAt(round)===true` 的轮末时刻，中枢把各 worktree 改动串行并入 integration 的唯一交汇点。 | `Playbook.shouldMergeAt`（03 §3.3）、`mergeRound`（09 §5） | 不是每轮都有合并点；并行范式仅在「子任务收口轮」为 true。 |

### 1.2 主体与角色层（agent / role / from / 中枢 / human）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 执行体 / 代理 | **agent** | 一个**物理 CLI 进程身份**：`codex` 或 `claude`。被 spawn、有 worktree、有会话句柄。 | `agentIdSchema`（02 §2）、`AgentAdapter.id`（05 §3.1） | **agent ≠ role**：agent 是「谁（哪个进程）」，role 是「这一条扮演什么」。同一 agent 不同轮可换 role（角色与模型解耦，锁定决策 §3）。 |
| 发言主体 | **from** | `Message` 上记录「这条物理上是谁发的」的字段，取值 `codex`/`claude`/`human`/`orchestrator`。 | `Message.from`（02 §5）、`agentIdSchema`（02 §2） | `from` 是物理身份，`role` 是扮演角色，二者正交，分别独立成字段。 |
| 角色 | **role** | 一次发言**扮演的职能**：planner/worker/proposer/critic/peer/arbiter。由 playbook 经 `TurnDirective.role` 指派，写入 `Message.role`。 | `roleSchema`（02 §2）、`TurnDirective.role`（03 §3.1） | critic 角色触发 evidence 强制（与 `kind==='critique'` 并列触发，02 §5.2 C1）；role 不等于 kind（见 1.4）。 |
| 中枢 | **orchestrator** | 调度 + 裁判进程本体：spawn 两 CLI、接管 stdio、跑引擎循环、盖章写黑板、跑校验 / 合并 / 广播。**自己不产代码**，只调度与裁判。 | `agentIdSchema` 的 `orchestrator`（02 §2）；system 消息发送者（02 §5.2 C7） | 中枢是 `kind==='system'` 消息的**唯一**合法 `from`（C7）；它不是「第三个 agent」——没有 adapter，不被 spawn。 |
| 人工 | **human** | 经面板介入的真人（观战 / 暂停 / 裁决合并冲突）。在 `AgentId` 里占一个值，主要作为 arbiter 出现。 | `agentIdSchema` 的 `human`（02 §2）、面板控制权限（10/11） | human 不被 adapter 驱动；其发言经面板 WS 注入，同样过 `validateMessage`。 |

### 1.3 适配与执行层（adapter / send / resume / session / event）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 适配器 | **adapter** | 把「一个 agent CLI」抽象成统一 `send`/`resume`/`cancel` 流式接口的对象。封装两端不对称（启动方式、schema 传递、resume 参数集、系统提示注入）。 | `AgentAdapter`（05 §3.1）、`createCodexAdapter`/`createClaudeAdapter`（05 §3.2） | codex 与 claude 的 adapter **实现不对称**但**接口相同**（事实地基 G）；adapter 不做校验（校验是 02 `validateMessage` 的事），只产 `AgentEvent` 流。 |
| 新开会话 | **send** | adapter 首轮调用：spawn 全新子进程，首事件回吐 `session_started.sessionId`。 | `AgentAdapter.send`（05 §3.1）、事实地基 A/B | send 不收 sessionId（id 由 CLI 自生成，红队 major）；stateless 续接策略每轮都走 send。 |
| 续接会话 | **resume** | adapter 续接已有会话：codex 走 `exec resume <SID> -`（参数集与 exec 不同，事实地基 E）。 | `AgentAdapter.resume`（05 §3.1）、事实地基 D/E | **resume 不省 token**（事实地基 D：累积 / 超线性）；必须先有 `session_started` 拿到的 sessionId 才能 resume（不变量 I5/A2）。 |
| 取消 | **cancel** | 杀当前进行中子进程树（含 shim 背后的真实 node 进程），幂等。 | `AgentAdapter.cancel`（05 §3.1/§10） | 被取消的流以 `{kind:'error', code:'SUBPROCESS_CANCELLED'}` 收尾，不是静默结束。 |
| 会话句柄 | **sessionId** | adapter 统一抽象的会话标识。codex 侧映射自 `thread.started.thread_id`（首行即出，事实地基 B），claude 侧映射自其 session id。 | `AgentEvent.session_started.sessionId`（02 §6.3）、`BoardState.agents[].sessionId`（02 §10.2） | sessionId 为空（未拿到）⇒ `resumable=false`，不可 resume（I5）。崩溃恢复靠 jsonl 里 `agent_session` 记录回填。 |
| 适配层事件 | **AgentEvent** | adapter 向引擎吐的流式事件：`session_started` / `delta` / `tool_call` / `final_message` / `error`。首事件恒为 `session_started`（I5）。 | `agentEventSchema`（02 §6.3） | 与 codex 原始 `--json` 4 类事件（事实地基 B）不同：那是 CLI 原生流，`AgentEvent` 是 adapter 归一后的流。 |
| 续接策略 | **continuity / ContinuityMode** | playbook 决定该 agent 这轮走 `send`（`'stateless'`）还是 `resume`（`'resume'`）。直接决定 token 成本曲线。 | `ContinuityMode`、`PromptContext.continuity`（03 §2.1） | sylux 默认 `stateless + 高质量 digest`，不默认 resume（事实地基 D：长程 resume 是成本炸弹）。 |

### 1.4 消息与证据层（message / kind / evidence / files / digest）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 消息 | **message** | 黑板上一条**已校验**的结构化发言。全字段唯一定义在 02 §5。 | `messageSchema`（02 §5） | 全项目唯一 `Message` 定义（I1）；agent 只产出瘦子集 `AgentMessagePayload`，`id/from/role/round/ts/schemaVersion` 由中枢盖章（02 §5.1/§6.1）。 |
| 消息类型 | **kind / MessageKind** | 一条消息「在做什么」：propose/critique/plan/implement/review/ack/question/done/system。决定流转语义。 | `messageKindSchema`（02 §2） | **kind ≠ role**：kind 是「这一条做什么」，role 是「这一轮我是谁」。约束挂在二者组合上（02 §5.2），不预设一一映射。简报别名映射见 02 §2.1（proposal→propose、patch→implement）。 |
| 证据 | **evidence / EvidenceItem** | 结构化、带可机器核验锚点的数组，三种锚点：`file_ref`（代码行区间 + contentHash）/ `command`（命令 + 期望/实际）/ `spec_quote`（规范引文）。 | `evidenceItemSchema`（02 §3） | **绝不是自由字符串**（焊死红队 R5）；critic/critique/ack(done) 必须非空且 **≥1 条「强」核验通过**（C1/C2）。强=中枢能独立复算(带 `quote` 的 file_ref 区间归一化一致 / 实跑 command 匹配);weak(无 quote 的 file_ref、未实跑 command、纯 `spec_quote`)**单独不解锁**(02v2 §3.2，已废 v1「强/中」二档)。 |
| 文件改动声明 | **files / FilePatch** | agent 声明「本条意图 / 已做」的文件改动（path + changeKind），供合并冲突预检与面板 diff。 | `filePatchSchema`（02 §4） | **diff 正文不由 agent 自填**——中枢从 worktree `git diff` 实跑生成，杜绝谎报（02 §4 / 09 §4）。`path`/`quote`/`source` 等 agent 可控串进面板前须 escape(02 §5.4 / 08 §5.7，防 XSS)。 |
| 摘要 | **digest** | 旧轮压缩结论（应用层维护），stateless 续接下每轮喂给 agent 代替全历史，是省 token 的关键手段。 | `DigestBuilder` 接口 + 基线算法归引擎 03 §2.2；高质量升级归性能 17 §6.3 | digest 是中枢侧「人造记忆」，与 CLI 侧 resume 记忆互斥选择；事实地基 D 决定默认用 digest 而非 resume。**生成算法本身仍无主(FEAS-4 blocker:03↔17 互相 punt)**，见 §6.1 openQuestion。 |
| 增量 | **delta** | 本轮喂给 agent 的新增上下文（通常是对面上一条 + orchestrator system 消息）。喂前每条过内容防火墙 `firewallPeerMessage`。 | `PromptContext.delta`（03 §2.2） | delta 是「只喂增量」（E3）的落地；不要把全历史塞进 delta。喂前过 08 `firewallPeerMessage`(03 §5.2)。 |
| 指纹 | **fingerprint** | 一条 evidence 的稳定哈希，用于跨轮「新证据差集」收敛检测。同一锚点指向同一事实必得同一指纹。 | `fingerprint`/`fingerprintSet`（02 §9.2）、`Round.evidenceFingerprints`（02 §10.1） | 指纹算法 = `normalizeContent` + sha256-hex-16，改它是破坏性变更（02 §9.1，需 SCHEMA_VERSION+1）。**仅核验通过的强指纹清零 stall**:`:?` 占位(无 quote 的 file_ref)与 `s:`(spec_quote)弱指纹不算进展(04v3 S6,防换区间空刷)。 |

### 1.5 引擎与剧本层（playbook / engine / blackboard / context）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 剧本 | **playbook** | 「换打法只换它」的可插拔策略对象。四范式（红蓝 / 主从 / 结对 / 分工）是同一引擎循环填不同 playbook。决定「谁发言 / 扮啥角色 / 给啥上下文 / 怎么轮 / 何时停」。 | `Playbook` 接口（03 §3.3）、`PlaybookId`（03 §3.3） | playbook 只读黑板（`BoardView`），**不能直接 append**（写是引擎特权 E2）；范式参数（刹车阈值等）在 `PlaybookParams`，阈值实现归 07。 |
| 引擎 | **engine** | 范式无关的主循环 `runEngine`：前置刹车→`nextTurn`→执行 turn→写黑板→轮末合并→关轮→后置刹车→done 判定。一行不为某个范式特化。 | `runEngine`（03 §5.1） | 引擎本体对 Fusion / 四范式一视同仁（F2）；引擎不决定喂什么上下文，那是 playbook 经 `PromptContext` 的事（E3/P2）。 |
| 黑板 | **blackboard** | 所有沟通的结构化中介：两 CLI **不直接对喷**，全走黑板消息。写侧接口 `Blackboard`（append/closeRound/setStatus/...），读侧只读视图 `BoardView`。 | `Blackboard` 接口（03 §4.2）、`BoardView`（03 §4.1）、数据类型 `BoardState`（02 §10） | 「黑板」既指机制（消息中介），也指其**数据类型** `BoardState`（02 拥有）+ **行为接口** `Blackboard`（03 拥有）；二者分属不同文档。 |
| 黑板视图 | **BoardView** | playbook 拿到的**只读**黑板：全量 message / rounds 快照 + 便捷查询（lastMessage / byKind / sessionOf / stalledFor）。无副作用。 | `BoardView`（03 §4.1） | 只读：playbook 不能用它写黑板（E2）；`stalledFor` 只给查询结果，最终 stall 终止由引擎+07 强制（E4）。 |
| 上下文 | **PromptContext** | `nextTurn` 的产物，描述「这一轮这个 agent 应该看到什么」：continuity + goal + digest + delta + roleBrief + expectedKind + contextCap。 | `PromptContext`（03 §2.2） | 是「只喂增量」（E3）的契约载体；引擎按固定顺序渲染成单个 prompt 串（03 §2.3）。 |
| 一轮计划 | **RoundPlan** | 一轮的发言计划：`turns: TurnDirective[]` + `execution: 'serial'\|'parallel'`。串行 length===1，并行 length===2。 | `RoundPlan`（03 §3.2） | `execution` 冗余于 `turns.length` 但显式，防歧义；空 `turns` 视为 playbook bug，引擎硬停（E7）。 |
| 发言指令 | **TurnDirective** | 一次发言的完整指令：`{agent, role, kindHint, promptContext}`。nextTurn 的最小产出单元。 | `TurnDirective`（03 §3.1） | `kindHint` 是引导非强制，实际 kind 以校验后产出为准；`agent` 覆盖 `assignment` 默认查表（P3）。 |
| 引擎依赖 | **EngineDeps** | 注入引擎的依赖集：blackboard / adapters / **stopPolicy**（=04 `CompositeStopPolicy`，含三重刹车+done）/ firewall（=08 `firewallPeerMessage`）/ worktrees / validate（桥接闭包，03 §4.3.1）/ digest / agentRuntime / logger（+ Fusion 可选注入）。 | `EngineDeps`（03 §4.3）、Fusion 补注入（21 §3） | adapters 只含 `codex`/`claude`（human/orchestrator 无 adapter）；v2 已删 v1 自造 `Brakes`/`BrakeResult`，改注入 04 的 `StopPolicy`（03 H1）。 |
| 收敛刹车 | **StopPolicy / CompositeStopPolicy** | 终止裁决的纯函数式策略对象。三条独立停机条件：轮数上限（maxRounds）/ token 预算（regime 感知估）/ 收敛 stall（连续 N 轮无新强指纹），外加 done 出口，统一组进 `CompositeStopPolicy` 按优先级裁决。 | `StopPolicy`/`StopContext`/`StopDecision`/`CompositeStopPolicy`（04 §2/§7）、token 模型事实地基 D | **v2 起无 `checkBefore`/`checkAfter` 双侧**：引擎每轮**末**调一次 `update→shouldStop`（03 H1）；超支前瞻另由启动前 + 扇出前 `preflightFanout`（04 §6.6）承担。stall 与 done **判据解耦**（R5）但同在 composite 内裁决（done 优先级 0>stall），互不可见。阈值可 `reconfigure` 热换但不动累积状态（04 H-HOTSWAP）。 |

### 1.6 隔离与合并层（worktree / base / integration / merge）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 工作树 | **worktree** | 每个执行体 agent 在每个 run 里独占的一个 git worktree。运行期各写各的、无锁、互不可见。 | `WorktreeManager`（09 §12）、纯 worktree 模型（R7，09 §1） | 「同一时刻一个 worktree 只一个写者」是不变量（见 §3）；删掉了早期「同文件写权串行化」措辞（R7）。 |
| 基线 | **base** | `refs/sylux/<runId>/base` 只读 tag，run 起点快照，3-way 合并的公共祖先（merge-base）。中枢创建时打，全程不动。 | 09 §3 拓扑表 | base 用 tag（不可移动）保证 merge-base 永远是 run 起点，合并语义稳定。 |
| 集成分支 | **integration** | `refs/sylux/<runId>/integration` 分支，累积「已合并」状态，轮末各 agent 改动串行并入此。 | 09 §3 拓扑表、`mergeRound`（09 §5） | 每个 agent 各一条独立分支（git 禁两 worktree checkout 同分支），integration 是它们的汇入点。 |
| 轮末合并 | **mergeRound** | 轮末把本轮所有 writer 改动串行并入 integration；3-way 冲突即硬停，构造 `conflictEvidence` 回灌，绝不自动选边。 | `mergeRound`（09 §5）、冲突硬停（W4/E5） | 合并是**唯一**跨 worktree 交汇点（W3），只在 merge point 发生且逐 writer 串行。 |
| 冲突证据 | **conflictEvidence** | 合并冲突时中枢构造的 `EvidenceItem[]`，回灌黑板供人工裁决。 | `MergeResult`（09 §5）、`EvidenceItem`（02 §3） | 冲突走 `system` 消息 + 置 `paused` 人工裁决态（03 §5.1），中枢不自动重试 / 选 ours/theirs（W4）。 |
| 差异 | **diffSince** | agent 自某 baseRef 以来在其 worktree 的真实改动，生成 `FilePatch`（面板 diff）+ 名状态。 | `diffSince`（09 §4） | 面板 diff 由此实跑产出，不信 agent 自报的 `files`（02 §4）。 |

### 1.7 Provider 与 Fusion 层（provider / panel / judge / fusion）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 供应方 | **provider / ProviderConfig** | 每个 agent 一份的模型接入配置：base_url / key（走 env，不进 argv）/ model / wire_api。可配、可热换、可加新（硬需求）。 | `ProviderConfig`（07 §2）、key 安全（R8/08） | key 永不进 argv 或 `-c`（走 env / auth.json，R8/S 系列）；热换走引擎重建 adapter，不在 send 时拼 provider。 |
| 评审团 | **panel** | Fusion 决策回合里，一个角色背后并行作答的 N 个 provider 成员（各自独立、互不喂对方输出）。 | `PanelMember`/`PanelProviderConfig`（07 §10）、`FusionExecutor`（21 §5） | 成员强制 stateless single-shot（F3），绝不逐成员 resume（否则 N× 累积成本爆炸）；成员身份不进 `Message`（F1/F7）。 |
| 裁判 | **judge** | Fusion 里综合 N 个成员答案的角色，三策略（synthesize/vote/best_of），产物映射成可核验 `EvidenceItem`。 | `JudgeConfig`（07 §10）、`judge.ts`（21 §5.3） | judge 的「共识 / 矛盾 / 盲点」正是 critic 要的 evidence 格式（F4，须 **≥1 强**）；evidence 不达标优先只重跑 judge 不重跑全 panel（F5）。 |
| 融合执行器 | **FusionExecutor** | 在 `runTurn` 执行层做 fan-out→collect→judge→synthesize，最终**只产一条** `AgentMessagePayload`，与单 agent 在 `validateMessage` 处汇合。 | `FusionExecutor`（21 §5）、同形落地（F1） | 引擎本体 / Playbook 接口一行不改（F2）；只在决策回合（propose/review/critique/question）启用，执行回合（implement）禁用（21 决策/执行回合表）。 |
| 决策回合 | **decision turn** | 出方案 / 评审类发言（propose/review/critique/question）。可走 panel，成员只读不写文件。 | 21 §决策/执行回合表 | 与「执行回合」对立；只有决策回合允许 Fusion。 |
| 执行回合 | **execution turn** | 改文件类发言（implement）。保持单 agent + worktree 隔离，**禁止** Fusion。 | 21 §决策/执行回合表 | 执行回合落 worktree 写，必须单写者（隔离不变量）。 |

### 1.8 安全与持久化层（firewall / redact / jsonl / schemaVersion）

| 中文 | 英文标识 | 定义 | 锚点 | 易混点 |
|---|---|---|---|---|
| 内容防火墙 | **firewallPeerMessage** | peer 输出喂对面前的过滤纯函数：加边界标记 + 特征扫描（防注入）+ files 路径白名单。返回 `{action:'pass'\|'flag'\|'block', wrapped, hits}`。 | `firewallPeerMessage(msg,ctx)`（08 §4.3）、R8 | **v2 已删 v1 `ContentFirewall` 对象 + `.wrap()` 方法**（E5 / 03 H6），改纯函数；`block`→`INJECTION_BLOCKED`。防「对面输出里夹带的指令注入」；打回文本回喂 agent 前也过它（02 §8.4 注）。 |
| 脱敏 | **redact** | 日志 / WS / worktree 拷贝 / jsonl 出境前抹掉 key / 敏感串的单一出口管道。流式按**跨帧滑窗**(保上帧尾拼本帧再扫,RS-M1)防密钥被分帧拼回。 | `redact()` 单一出口（08 §3）、跨帧滑窗（08 §3.5）、R8 | 与防火墙不同：redact 是「出境抹密」，防火墙是「入境防注入」，两个方向两件事。单帧无状态 redact 是漏洞(RS-M1),必须跨帧。 |
| 面板消毒 | **HTML escape / sanitize** | agent 可控字符串(body/quote/path/source/文件名)进面板 DOM 前的 XSS 防护:默认纯文本 / DOMPurify 白名单 + strict CSP + 禁 `javascript:`/`data:` 链接。 | 消毒硬规则（08 §5.7）、渲染落地（10）、不可信标注（02 §5.4） | **与 redact 正交**:redact 抹 secret **不转义** `<script>`,消毒转义 HTML 但不抹 key,二者必须并存(RS-B2)。 |
| 行日志 | **jsonl record** | `runs/<runId>.jsonl` 每行一条判别记录（run_started/message/round_closed/status_changed/agent_session）。append-only，崩溃可截断恢复。 | `jsonlRecordSchema`（02 §7.1） | `BoardState` 不独立落盘，是 jsonl 的**投影**（单一事实源，杜绝双写漂移，02 §7.3/§10.3）。 |
| 契约版本 | **schemaVersion** | 每条持久化记录自带的契约版本号，支持迁移。当前 `SCHEMA_VERSION=1`。 | `SCHEMA_VERSION`（02 §1.2）、`migrateRecord`（02 §7.4） | 破坏性变更（删字段 / 改 contentHash 算法 / 改行结构）必须 +1 并加迁移分支（I4）。 |
| 错误码 | **SyluxErrorCode** | 全集中式错误码 union(分域全集:契约 / 子进程 / 引擎 / 安全 / WS / worktree / fusion / provider)。 | `SyluxErrorCode`（02 §12，errors.ts 单一来源） | **A1/COV-1 已闭合**:02v2.1 §12 已补全 30+ 码(含 SUBPROCESS_*/ENGINE_FATAL/INJECTION_BLOCKED/WS_*/WORKTREE_*/FUSION_*/EVIDENCE_INFRA_DEGRADED 等),下游只 `import type`,**禁止**另立 union 子集。不吞错原则:任何未预期异常显式落终态(E7)。 |

---

## 2. 高危混淆词消歧（实现期最易踩的同义/近义陷阱）

下面这些词在多文档高频出现且最易混。每条给「**A 不是 B**」式硬区分，配一句判别口诀。

### 2.1 round vs turn vs message —— 三个最易混的「单位」

- **round（轮次）**= 调度拍子，一次 `nextTurn`→一个 `RoundPlan`。单调递增的整数。
- **turn（发言）**= 一拍里某 agent 的一次执行（spawn→产出）。**可失败**（不留 message）。
- **message（消息）**= turn **成功并通过校验**后落在黑板上的结构化记录。

口诀:**round 是拍子，turn 是动作，message 是落账**。串行范式一拍一动作一落账（数量相等但别画等号);并行范式一拍两动作两落账;校验打回的 turn 一拍有动作但**无落账**(只留 system 消息记打回)。

### 2.2 agent vs role vs from —— 「谁」的三个维度

- **agent / from（物理身份）**= 哪个进程（codex/claude/human/orchestrator）。
- **role（扮演角色）**= 这一条扮谁（planner/worker/proposer/critic/peer/arbiter）。
- 二者**正交**且**都进 `Message`**（`from` + `role` 两个独立字段，02 §5）。

口诀:**from 是户口，role 是戏份**。同一 agent（户口不变）不同轮可演不同 role（戏份可换）——这就是「角色与模型解耦」(锁定决策 §3)。反过来,parallel 范式同一 role(worker)可派给两个 agent(P3)。

### 2.3 kind vs role —— 「做什么」vs「是谁」

- **kind（消息类型）**= 这一条在做什么（propose/critique/implement/...）。
- **role（角色）**= 这一轮我是谁。
- 约束挂在**二者组合**上（02 §5.2），不预设一一映射:`role==='critic'` 可发 `critique` 也可发 `question`;但 `role==='critic'` **或** `kind==='critique'` 任一命中,evidence 即强制(C1)。

口诀:**kind 是动词,role 是身份**;evidence 强制是「critic 身份 OR critique 动作」的并集,不是交集。

### 2.4 send vs resume vs continuity —— 会话续接与成本

- **send（新开）**= spawn 全新会话,对应 `continuity==='stateless'`。
- **resume（续接）**= 续同一 CLI 会话,对应 `continuity==='resume'`。
- **关键事实(地基 D)**:resume **不省 token**,按全量历史累积计费(**resume regime 超线性**)。
- **关键澄清(04v3,焊死 ROC-B1)**:事实 D 的「累积/超线性」**只在 resume regime 成立**;**stateless regime**(默认的红蓝/对等/并行范式)每轮只吃 `base + digest + delta`,成本对轮数**近似线性**,不超线性。预算预测必须 regime 分叉,否则对默认 stateless 范式严重高估而误杀(见 §3.7 INV-C1)。

口诀:**resume 保记忆但烧钱(超线性),stateless 喂 digest 才可控(近似线性)**。默认 stateless(长程辩论 resume 会爆),resume 仅短程强耦合轮次显式启用。别想当然「多轮就该 resume」,也别想当然「成本一律超线性」。

### 2.5 evidence vs files —— 「证据」vs「改动声明」

- **evidence（证据)**= 支撑批判 / 认可的**可核验锚点**(file_ref/command/spec_quote),中枢复算。
- **files（改动声明)**= agent 声明本条**意图改哪些文件**,供合并预检 + 面板 diff。
- 二者都可含 path,但**用途与核验完全不同**:evidence 的 file_ref 须带 `quote` 才能强核验(中枢重读区间归一化比对,派生权威 contentHash);files 的 path 只过白名单,diff 正文中枢实跑生成(不信 agent)。

口诀:**evidence 是「我说的有据可查」,files 是「我改了这些」**。critic 必须有 **≥1 条强** evidence(C1,weak 不解锁);任何 turn 可有 files。

### 2.6 中枢 vs agent vs arbiter —— 三类「参与方」

- **中枢(orchestrator)**= 调度+裁判进程,不产代码,无 adapter,不被 spawn。`system` 消息唯一合法 `from`(C7)。
- **agent(codex/claude)**= 被 spawn 的执行体,有 adapter / worktree / session。
- **arbiter(裁判角色)**= 通常由中枢承担,人工介入时为 human。是 `role` 不是 `from`。

口诀:**中枢是户口里的 orchestrator,arbiter 是它(或 human)演的戏份**。别把中枢当「第三个 agent」——它没 adapter,不在 `EngineDeps.adapters` 里。

### 2.7 done vs stall —— 两种停机,判据解耦但同处裁决

- **done(成功出口)**= 「双方对结果达成带证据的一致」:`kind:'done'` + 对面可核验 `ack`(02 C2)。终态 `done`。看**消息语义**。
- **stall(收敛安全网)**= 「连续 N 轮挤不出新强证据可吵」:evidence 强指纹差集连续空。终态 `stalled`。看**指纹差集**。
- **二者判据不同、信号源不同、互不触发**(R5):一个 run 可 stall 而从未 done(吵不出结论被动停),也可 done 而从未接近 stall(快速达成)。
- **v2 关键澄清(纠 v1「两处独立判定」措辞)**:判据解耦**不等于**「两处独立代码各判各的」。二者**同在 04 `CompositeStopPolicy` 内**按固定优先级裁决(`DonePolicy` 优先级 0 > stall),只是**子 policy 之间判据彼此不可见**(04 §7.2 解耦证明)。引擎主循环**不再**出现独立 `if(isDone)` 分支(03 H2,v1 双重检测已删)。

口诀:**done 是「吵出结果」看语义,stall 是「吵不出新东西」看指纹**;判据互不可见,但都进同一个 composite 排优先级,不是引擎里两段 if。

---

## 3. 系统不变量总表（可勾选自检基准）

> **总表读法**:每条不变量给 **编号** · **不变量陈述（必须永真）** · **强制方（谁保证）** · **强制点（在哪段代码 / 校验落地）** · **违反时可观测信号(错误码/状态/断言失败)** · **溯源(红队 R / 文档内编号)**。
>
> **「强制点」是验收锚点**:审阅时逐条核对该位置是否真有代码 / 校验落地。**没有落点的不变量 = 未完成的 TODO**,不是「已保证」。
>
> 编号前缀按域分:`INV-T`(类型契约)/ `INV-E`(引擎)/ `INV-A`(适配)/ `INV-W`(隔离合并)/ `INV-S`(安全)/ `INV-F`(Fusion)/ `INV-P`(持久化)/ `INV-C`(成本)。

### 3.1 类型契约不变量（INV-T，源:02 I 系列 / R1）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-T1 | `Message` / `EvidenceItem` / `FilePatch` / `AgentEvent` 等类型**有且只有一处** `z.object`/`z.enum`/`z.discriminatedUnion` 定义,物理落 `@sylux/shared/src/blackboard.schema.ts`。 | 项目纪律 + CI | grep `from:.*agentIdSchema` 全仓只命中一处;CI 加 grep 断言 | CI 失败(命中 >1 处) | 02 I1 / R1 |
| INV-T2 | 任何来自子进程 stdout 的 JSON,进 engine 前**必经** `messageSchema.safeParse` + `validateMessage`,未校验对象绝不入引擎。 | 引擎 + 校验层 | `runTurn` 第 4 步 `deps.validate(candidate)`(03 §5.2);`validateMessage`(02 §8) | `OUTPUT_SCHEMA_VIOLATION` | 02 I2 / R4 |
| INV-T3 | `evidence` 永远是结构化数组(三锚点 discriminatedUnion),**绝非自由字符串**。 | 类型层 | `evidenceItemSchema`(02 §3);safeParse 拒绝字符串 | `OUTPUT_SCHEMA_VIOLATION` | 02 I3 / R5 |
| INV-T4 | critic / critique / ack(done) 的 evidence **非空且 ≥1 条达「强」核验通过**;weak(无 quote 的 file_ref、未实跑 command、纯 `spec_quote`)单独不解锁。 | 校验层(两阶段) | `validateMessage` 阶段 B(02 §8.2);`verifyEvidence`(02 §8.3) | `EVIDENCE_REQUIRED` / `EVIDENCE_UNVERIFIABLE` | 02 I3/C1/C2 / R5 / COV-10(已废 v1「强/中」) |
| INV-T5 | 每条持久化记录自带 `schemaVersion`;破坏性变更必须 +1 并加 `migrateV{n-1}toV{n}` 分支。 | 持久化层 | `jsonlRecordSchema`(02 §7.1)、`migrateRecord`(02 §7.4) | decode 失配 / 迁移缺分支 | 02 I4 |
| INV-T6 | `AgentEvent` 流首事件**恒为** `session_started`;拿到前不得标 agent 可 resume。 | 适配层 | `agentEventSchema`(02 §6.3);adapter A1/A2(05 §3.1) | 无 sessionId 仍 resume ⇒ 逻辑错 | 02 I5 / R3 |
| INV-T7 | agent 只产出瘦子集 `{kind,body,files,evidence,inReplyTo?}`;`id/from/role/round/ts/schemaVersion` 一律中枢盖章。 | 引擎 append | `AppendInput`(03 §4.2)、`agentMessagePayloadSchema`(02 §6.1) | agent 伪造身份/时间/轮次被剥离 | 02 §5.1/§6.1 / R8 |
| INV-T8 | `ts` 由中枢盖,agent 不可伪造;时间是权威的服务端时间戳。 | 引擎 | `Blackboard.append` 盖 `ts`(02 §5.1) | agent 自带 ts 被覆盖 | 02 §5.1 |
| INV-T9 | `kind==='system'` 消息 `from` **必须**为 `orchestrator`。 | 校验层 | `validateMessage` C7(02 §5.2/§8) | `INVALID_SYSTEM_SENDER` | 02 C7 |
| INV-T10 | `contentHash` / 指纹算法 = `normalizeContent` + sha256-hex-16,跨平台(CRLF/LF)同内容同 hash。 | shared | `normalizeContent`/`contentHash`(02 §9.1) | 跨平台 hash 失配 ⇒ V16 测试挂 | 02 §9.1 / R5 |

### 3.2 引擎与流程不变量（INV-E,源:03 E 系列 / R5）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-E1 | 引擎主循环 / Playbook 接口**范式无关**:换打法只换 playbook,引擎本体一行不改。 | 架构 | `runEngine`(03 §5.1)对四范式 + Fusion 一视同仁 | 引擎里出现 `if(playbookId===...)` 特化 | 03 E1 / F2 |
| INV-E2 | playbook **只读黑板**(`BoardView`),写黑板是引擎特权;playbook 不能 `append`。 | 接口设计 | `BoardView` 无写方法(03 §4.1);`Blackboard.append` 仅引擎调 | playbook 拿到可写句柄 ⇒ 设计错 | 03 E2 |
| INV-E3 | 「喂什么上下文」由 playbook 经 `PromptContext` 决策,引擎只渲染 + 过防火墙,**绝不自塞全历史**。 | 引擎 + playbook | `renderPrompt`(03 §5.2)只读 `PromptContext`;delta 限增量(03 §2.2) | 引擎里出现全 `messages` 拼 prompt | 03 E3/P2 |
| INV-E4 | done 与 stall **判据解耦**(信号源/判据不同、互不触发),但**同在 04 `CompositeStopPolicy` 内**按优先级裁决(done 优先级 0>stall),子 policy 判据彼此不可见;引擎主循环无独立 `if(isDone)`。 | 04 composite + 引擎 | `CompositeStopPolicy`(04 §7);`DonePolicy`/`PlaybookDonePolicy`(04 §7.1/§7.3);引擎只调 `shouldStop`(03 H2/§5.1) | done 触发 stall 或反之 / 引擎里出现独立 done 分支 ⇒ 逻辑错 | 03 E4 / R5 / E1(纠 v1「两处独立」) |
| INV-E5 | 并行范式各 turn 各写各 worktree;合并只在轮末串行;冲突硬停回灌,不自动选边。 | 引擎 + worktree | `Promise.all`(03 §5.1)+ `mergeRound` 串行(09 §5) | 并发合并 / 自动选 ours ⇒ 违 W3/W4 | 03 E5 / R7 |
| INV-E6 | 刹车是**轮末单点裁决**:引擎每轮**末**(关轮落指纹/usage 后)调一次 `stopPolicy.update→shouldStop`;**无 `checkBefore`/`checkAfter` 双侧**。超支前瞻另由「启动下一轮前」+「扇出前 `preflightFanout`」承担(见 INV-C4)。 | 04 + 引擎 | `runEngine` 轮末 `update→shouldStop`(03 §5.1,H1);`CompositeStopPolicy`(04 §2/§7) | 引擎里出现 `checkBefore`/`checkAfter` / 前置刹车 ⇒ 违 03 H1 | 03 E6/H1 / 04 / 事实地基 D(纠 v1 双侧) |
| INV-E7 | 任何未预期异常 / 空 RoundPlan / 致命 spawn 失败 **显式落终态**,不吞错、不空转。 | 引擎 | `runEngine` catch + `EMPTY_ROUND_PLAN` 守卫(03 §5.1) | 进程挂起 / 静默退出 | 03 E7 |
| INV-E8 | round 号单调不减;`Message.round` 与 `Round.index` / `BoardState.currentRound` 对齐。 | 引擎 | `closeRound`/`append` 推进(03 §4.2) | round 倒退 / 错位 | 02 §10.3 |
| INV-E9 | schema/evidence 打回后同 agent 重发 ≤ `retryOnReject`(默认 3),耗尽则终止本轮。 | 引擎 | `runTurn` 重试循环(03 §5.2) | 无限重试 / 不打回 | 03 §5.2 / 02 §8.4 |
| INV-E10 | stall 计数**只在「该出证据的轮」推进**:`roundEvidenceExpected===false` 的轮(master-worker 派活轮 / review 复用旧锚点轮 / parallel 同步轮)**冻结**计数(不累加不清零),防合法空证据轮被误杀。冻结≠清零,恢复后从原值续算。 | 04 + playbook | `StopContext.roundEvidenceExpected`(04 §2.1/§4.2);`ConvergencePolicy`(04 §4.3) | 合法派活/同步轮被判 stall 误杀 | FEAS-5(major)/ 04 S9/H-EMPTY |
| INV-E11 | 中枢侧复跑器/沙箱**自身故障**(`reason:'infra'`)判 `weak` + 记 `system`(`EVIDENCE_INFRA_DEGRADED`),**不连坐 critic**、不计无效发言、不进 stall;`roundVerificationDegraded` 轮同样冻结 stall 计数。 | 校验层 + 04 | `verifyEvidence` infra 分支(02 §8.3);`StopContext.roundVerificationDegraded`(04 §2.1/§4.3) | 中枢自己坏了却误判 agent 收敛失败 / 连坐 critic | COV-3(major)/ 02 H12 / 04 H-DEGRADE |

### 3.3 适配层不变量（INV-A,源:05/06 A 系列 / 事实地基 A/B/E / R3/R6）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-A1 | codex 必须**直 spawn 真 exe + prompt 走 stdin**;不裸 spawn `codex`、不经 `.cmd` 传带空格 prompt。 | 适配层 | `resolveCodexExe` + `child.stdin.write`(05 §4);事实地基 A | `%1 is not a valid Win32 application` / `unexpected argument` | 事实地基 A / R6 |
| INV-A2 | `send`/`resume` 返回流首个有效事件必为 `session_started`;thread.started 前崩溃只 emit `error` 不 emit session_started。 | 适配层 | adapter A1/A2(05 §3.1/§5) | `SUBPROCESS_SPAWN_FAILED` | 事实地基 B / 02 I5 / R3 |
| INV-A3 | sessionId 由 CLI 自生成(codex=thread_id),adapter **不收**调用方传入的 id。 | 适配层 | `send` 不收 sessionId(05 §3.1) | 调用方塞 id ⇒ 设计错 | 事实地基 B / R3(major) |
| INV-A4 | codex `resume` 参数集与 `exec` 不同:不传 `-s`/`-C`,必带 `--skip-git-repo-check`;沙箱/cwd 继承首轮。 | 适配层 | resume 命令拼装(05 §6.2);事实地基 E | `unexpected argument '-s'` / `Not inside a trusted directory` | 事实地基 E |
| INV-A5 | token 计量直接取 `turn.completed.usage`(中转回吐),不本地估算。 | 适配层 | `final_message.usage`(02 §6.3);事实地基 G | 本地估算器出现 ⇒ 违约 | 事实地基 G / 02 §6.3 |
| INV-A6 | output-schema 两端不对称:codex 收文件路径,claude 收内联串(≤~32KB,超限退 stream-json)。 | 适配层 | `buildAgentOutputJsonSchema`(02 §6.2);事实地基 C/F | 内联超限被截断 / 转义错 | 事实地基 C/F / R4 |
| INV-A7 | CLI output-schema 强制成形后**仍保留** zod safeParse 兜底(失败带错重发≤N→抛)。 | 适配层 + 引擎 | `runTurn` 校验 + 重试(03 §5.2) | 信任 CLI 输出不校验 ⇒ 违 I2 | 事实地基 C / R4 |
| INV-A8 | 中枢用 Node 直接捕获 stdout,**不**用 shell `>` 重定向(避免 UTF-8→UTF-16 乱码)。 | 适配层 | spawn 捕获(05 §4);事实地基 A | 输出乱码 | 事实地基 A |

### 3.4 隔离与合并不变量（INV-W,源:09 W 系列 / R7）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-W1 | **同一时刻一个 worktree 只一个写者**;每个执行体 agent 每 run 独占一个 worktree。 | worktree 管理 | `WorktreeManager.create`(09 §3/§12);每 agent 独立分支 | 两进程写同 worktree ⇒ git `already checked out` | 09 W1 / R7 |
| INV-W2 | 运行期各 worktree **无锁、互不可见**;**不做**「同文件写权串行化」。 | 架构 | 纯 worktree 模型(09 §1) | 出现运行期跨 worktree 锁 ⇒ 违 R7 | 09 / R7 |
| INV-W3 | 合并是**唯一**跨 worktree 交汇点,只在 `shouldMergeAt(round)===true` 轮末,且逐 writer **串行**。 | 引擎 + worktree | `mergeRound`(09 §5);引擎轮末调(03 §5.1) | 并发合并 / 轮中合并 | 09 W3 / E5 |
| INV-W4 | 3-way 冲突**硬停不选边**:构造 `conflictEvidence` 回灌 + 置 `paused`,中枢不自动 ours/theirs、不自动重试。 | 引擎 + worktree | 冲突分支(03 §5.1)、`MergeResult`(09 §5) | 自动 resolve ⇒ 违 W4 | 09 W4 / R7 |
| INV-W5 | worktree 内路径白名单:`file_ref.path` / `files[].path` / `renamedFrom` 无 `..`、不越界、不命中敏感白名单。 | 校验层 | `validateMessage` C6 + `isPathAllowed`(02 §8.2/§8.3,08 拥有规则) | `WORKTREE_PATH_VIOLATION` | 02 C6 / 08 |
| INV-W6 | base 用不可移动 tag,merge-base 永远是 run 起点;worktree 路径 run 内不变(崩溃恢复用同一路径)。 | worktree 管理 | base tag(09 §3);路径固化(09 §3) | base 漂移 ⇒ 合并语义变 | 09 W1 |
| INV-W7 | diff 正文由中枢 `git diff` 实跑生成,**不信** agent 自报 `files`。 | worktree + 面板 | `diffSince`(09 §4);`FilePatch` 仅声明(02 §4) | 渲染 agent 自填 diff ⇒ 可被谎报 | 02 §4 / 09 §4 |

### 3.5 安全不变量（INV-S,源:08 / R8）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-S1 | key **永不进 argv / `-c`**:走 env / auth.json;argv 预扫描命中 `sk-`/base64 即抛。 | provider + 安全 | `buildChildEnv` 单一出口 + argv 预扫描(08) | `PROVIDER_CONFIG_INVALID` | R8 / 08 |
| INV-S2 | `buildChildEnv` 是**单一出口**:env 白名单 + `extendEnv:false`,不泄漏宿主环境。 | 安全 | `buildChildEnv`(08) | 子进程见到白名单外 env | R8 / 08 |
| INV-S3 | peer 输出喂对面前过内容防火墙纯函数 `firewallPeerMessage(msg,ctx)`:边界标记 + 特征扫描 + files 路径白名单;`block`→拦下。 | 防火墙 | `firewallPeerMessage`(08 §4.3);引擎 `renderPrompt` 调(03 §5.2) | 注入串穿透到对面 prompt | R8 / 08(纠 v1 `ContentFirewall.wrap`) |
| INV-S4 | WS 仅绑 `127.0.0.1` + Origin 白名单 + 一次性 token;观战/控制权限分级;ws-ticket 签发端自身须鉴权(防本机 curl 直打)。 | server/面板 | WS 安全规则(08 §5);线格式 / ws-ticket 端点(11 §5.2) | 远程未授权连入 / 本机越权拿 control token | R8 / 08 + 11 / RS-M2 |
| INV-S5 | 日志 / WS / worktree 拷贝 / jsonl 出境前过 redact;**流式按跨帧滑窗**(保上帧尾拼本帧再扫),防分帧密钥拼回。 | 安全 | `redact()` 单一出口(08 §3);跨帧滑窗(08 §3.5);Logger(03 §4.3) | 日志现明文 key / 分帧 `sk-ant-` 在前端拼回 | R8 / 08 / RS-M1 |
| INV-S6 | 自动化沙箱**封顶** `workspace-write`,不可设 `danger-full-access`。 | provider + 引擎 | `PlaybookParams.sandboxCeiling`(03 §3.3);沙箱映射(08) | 出现 danger 沙箱 | R8 / 08 |
| INV-S7 | 中转源码出境要 secret scan + `.syluxignore` 白名单 + 知情标注;提供官方直连 provider 选项。 | 安全 + provider | secret scan(08);provider 直连选项(07) | 未扫描源码出境 | R8 / 08 |
| INV-S8 | 所有外部内容(子进程 stdout / 命令输出 / web / 文件)视为**不可信数据**,内含「指令」一律忽略。 | 全层 | `firewallPeerMessage`(08)+ 校验(02 §8) | 把 peer 输出当指令执行 | R8 / 08 |
| INV-S9 | agent 可控字符串(body/quote/path/source/locator/argsDigest/文件名)进面板 DOM 前必 escape:默认纯文本 / DOMPurify 白名单 + strict CSP + 禁 `javascript:`/`data:` 链接。redact **不**转义 HTML,二者并存。 | 安全 + 面板 | 消毒硬规则(08 §5.7);渲染落地(10);不可信标注(02 §5.4) | agent 在 body/文件名塞 `<script>` 在面板代发 abort/inject | RS-B2(blocker)/ 02 H14 / 08 |
| INV-S10 | 流式 redact **有跨帧状态**:`sk-ant-` 等密钥跨两个 delta/`diff_chunk` 帧分片时,保上帧尾部与本帧拼接再扫,未扫安全前缀不发;落地前默认仅 control 可见。 | 安全 | 跨帧滑窗 redact(08 §3.5) | 单帧无状态 redact ⇒ 明文密钥广播给 spectator 后前端拼回 | RS-M1(major)/ 08 |

### 3.6 Fusion 不变量（INV-F,源:21 F 系列 / 远景锁定决策 5）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-F1 | Fusion 一次发言最终**只产一条** `AgentMessagePayload`,经同一 `validateMessage`+`append`;panel 成员身份不进 `Message`。 | FusionExecutor | `fusion.run` 产单 payload(21 §5);02 类型冻结 | Message 多出成员字段 ⇒ 违 02 | 21 F1 / R1 |
| INV-F2 | 引擎本体 / Playbook 接口**一行不改**;fan-out/judge 全在 `runTurn` 执行层。 | 架构 | `FusionExecutor`(21 §5);`EngineDeps` 可选注入(21 §3) | 引擎里出现 panel 逻辑 | 21 F2 / E1 |
| INV-F3 | panel 成员强制 stateless single-shot,**绝不**逐成员 resume(否则 N× 累积成本爆炸)。 | FusionExecutor | 成员 `ContinuityMode='stateless'`(21 §F3) | 成员走 resume | 21 F3 / 事实地基 D |
| INV-F4 | judge 产物映射成 `EvidenceItem`;critique/critic 时**至少一条达「强」核验**(`file_ref`+`quote` 复算一致 / 实跑 command 匹配),weak 不解锁,否则打回。 | FusionExecutor + 校验 | `evidence-map.ts`(21 §6);`hasStrongEvidence`(21 §6.3);`validateMessage` C1(02 §8) | `EVIDENCE_UNVERIFIABLE` | 21 F4 / C1 / COV-10(纠 v1「强/中」+ `hasStrongOrMidEvidence`) |
| INV-F5 | evidence 不达标优先**只重跑 judge**(≤k),不重新 fan-out N 成员。 | FusionExecutor | judge 级重试(21 §5.3/F5) | 重跑全 panel ⇒ N× 浪费 | 21 F5 |
| INV-F6 | N 成员拿相同上下文各自独立作答,**成员间互不喂对方输出**(断注入链 + 保多样性)。 | FusionExecutor | 成员零串扰(21 F6);喂 judge 前过防火墙 | 成员看到彼此输出 | 21 F6 / R8 |
| INV-F7 | 成员 provenance(谁是哪 provider/原文/打分)走观测旁路(WS/日志),**不进**权威 `Message`。 | FusionExecutor + 观测 | panel 观测通道(21 F7,10/11/15) | provenance 进 Message | 21 F7 |
| INV-F8 | Fusion 只在决策回合(propose/review/critique/question)启用,执行回合(implement)**禁用**;成本 ≈(N+1)× 地板价计入累积预算,且受扇出前瞻 `preflightFanout` 闸(INV-C4)。 | FusionExecutor + 引擎 | 决策/执行回合表(21);成本计入刹车(21 F8);`preflightFanout`(04 §6.6) | implement 走 panel / 单轮扇出 N× 超支才停 | 21 F8 / 锁定决策 5 / RS-M5 |

### 3.7 持久化与成本不变量（INV-P / INV-C,源:02 §7/§10 / 事实地基 D）

| 编号 | 不变量陈述 | 强制方 | 强制点 | 违反信号 | 溯源 |
|---|---|---|---|---|---|
| INV-P1 | `BoardState` **不独立落盘**,是 jsonl 行日志的投影(单一事实源,杜绝快照/日志双写漂移)。 | 持久化 | 投影重建(02 §7.3/§10.3) | 双写快照 ⇒ 漂移 | 02 §7.3 |
| INV-P2 | jsonl append-only:`run_started` 首行,终态 `status_changed` 末行;末行残缺截断丢弃,前行权威。 | 持久化 | `encode/decodeJsonlLine`(02 §7.2/§7.3) | 残行污染恢复 | 02 §7.3 |
| INV-P3 | `inReplyTo` 非空必指向同 `runId` 已存在消息(无悬空引用)。 | 校验层 | `validateMessage` C8(02 §8.2) | `DANGLING_REPLY_REF` | 02 C8 |
| INV-P4 | 同轮同一 `from` 不得既 `done` 又自我 `ack`。 | 校验层 | `validateMessage` C3(02 §8) | `INVALID_DONE_SELF_ACK` | 02 C3 |
| INV-C1 | 成本模型**regime 感知**(焊死 ROC-B1):**resume regime** 超线性(N 轮 ≈ base×(1+2+…+N));**stateless regime**(默认红蓝/对等/并行)每轮只 `base+digest+delta`,对轮数**近似线性**(≈N×base)。预算预测必须按 continuity 分叉,**默认范式禁用超线性公式**。 | 刹车层 | regime 分叉预测(04 §6.2/§6.4);默认预算表(16 §6.4 按 regime);事实地基 D | stateless 套超线性 ⇒ 默认配置下预算安全网+前瞻刹车整条死掉(ROC-B1 blocker) | ROC-B1(blocker)/ 事实地基 D / 04 H-B3 |
| INV-C2 | 基线底价 ≈18.7k input tokens/最简回合(codex 系统上下文),预算下限按此设。 | 刹车层 | token 预算配置(16);事实地基 D | 预算设得低于地板 | 事实地基 D |
| INV-C3 | 省 token 唯一手段是应用层(digest/delta/只喂增量),**不**指望 resume / 中转服务端会话态省钱。 | playbook + 引擎 | `PromptContext.digest/delta`(03 §2.2) | 靠 resume 省钱 ⇒ 反而更贵 | 事实地基 D / R2 |
| INV-C4 | 成本安全网三道叠加:① 轮末累积触发(实测为准)② 启动下一轮前瞻 ③ **扇出前 `preflightFanout` + 单 turn 硬上限 `maxTurnTokens`**;任一触发即停。专防 panel 单轮并发 N 成员在轮末检查前先烧 N×base。 | 04 + 引擎/panel-runner | `preflightFanout()`/`maxTurnTokens`(04 §6.6);spawn 成员前调 | 扇出无前瞻 / 无单 turn 上限 ⇒ 一轮超支 N× 才停 | RS-M5/ROC-M5(major)/ 04 S10/H-FANOUT |
| INV-C5 | usage 任一字段缺失,`inputTokens` 按 `BASELINE_INPUT_PER_ROUND`、`outputTokens` 按 `BASELINE_OUTPUT_PER_ROUND` **双侧兜底下界**,成本估宁高勿低;**绝不出现 input 兜底而 output 当 0** 的半兜底。 | 04 + 校验 | `buildStopContext`/`BudgetPolicy` 双侧兜底(04 §6.2/§6.4);usage 漂移 degradable 仍 warn(15 §6.3) | output 当 0 ⇒ `maxCostUsd` 在 reasoning 模型上失明,$12 上限挡不住真实 $40+ | ROC-M1(major)/ 04 S11/H-OUT0 / 02 H15 |

---

## 4. 实现期自检清单（提交前逐条勾选）

把不变量翻成「动手前 / 提交前」可勾选的检查项。**每条对应 §3 一个或多个 INV 编号**,失败即回到对应文档对齐。

### 4.1 类型 / 校验自检

- [ ] 没有在 02 之外的任何文件新写 `messageSchema`/`evidenceItemSchema` 等 `z.object`（INV-T1）。
- [ ] 子进程产出在入引擎前都过了 `validateMessage`，没有「先用后校验」（INV-T2）。
- [ ] critic/critique/ack(done) 路径有 evidence 非空 + **≥1 条「强」**核验断言（weak 不算，INV-T4）。
- [ ] 改了 `contentHash`/指纹/jsonl 行结构 ⇒ 已 `SCHEMA_VERSION+1` + 迁移分支 + 回放测试（INV-T5/T10）。
- [ ] agent 产出只取瘦子集，`id/from/role/round/ts` 全由中枢盖章（INV-T7/T8）。

### 4.2 引擎 / 流程自检

- [ ] 引擎主循环里**没有** `if(playbookId===...)` 之类范式特化分支（INV-E1）。
- [ ] playbook 拿到的是只读 `BoardView`，无法 `append`（INV-E2）。
- [ ] prompt 渲染只读 `PromptContext`，没有把全量 `messages` 拼进去（INV-E3）。
- [ ] done 判定(`DonePolicy`/`PlaybookDonePolicy`)与 stall 判定(`ConvergencePolicy`)是 04 `CompositeStopPolicy` 内的独立子 policy(判据不可见),引擎主循环**无**独立 `if(isDone)` 分支(INV-E4)。
- [ ] 刹车是**轮末单点** `update→shouldStop`,仓里**无** `checkBefore`/`checkAfter`/前置刹车;超支前瞻走启动前 + `preflightFanout`(INV-E6/C4)。
- [ ] stall 计数只在 `roundEvidenceExpected===true && roundVerificationDegraded===false` 推进;派活/同步/核验降级轮冻结不误杀(INV-E10/E11)。
- [ ] 空 RoundPlan / 致命 spawn / 未捕获异常都显式落终态，无静默退出（INV-E7）。

### 4.3 适配 / 隔离自检

- [ ] codex 直 spawn 真 exe + stdin，没有裸名 / `.cmd` 传空格 prompt（INV-A1）。
- [ ] adapter 流首事件断言为 `session_started`；拿不到 sessionId 不标 resumable（INV-A2/T6）。
- [ ] resume 命令拼装独立于 exec，带 `--skip-git-repo-check`、不带 `-s`/`-C`（INV-A4）。
- [ ] token 取 `turn.completed.usage`，仓里没有本地 token 估算器（INV-A5）。
- [ ] 每 agent 独占 worktree + 独立分支；运行期无跨 worktree 锁（INV-W1/W2）。
- [ ] 合并只在轮末串行；冲突走 `paused` + conflictEvidence，无自动 resolve（INV-W3/W4）。

### 4.4 安全 / Fusion / 成本自检

- [ ] grep argv 拼装处确认 key 不出现；`buildChildEnv` 是唯一 env 出口（INV-S1/S2）。
- [ ] peer 输出喂对面前过 `firewallPeerMessage`(纯函数,非 `ContentFirewall.wrap`);日志/WS 出境过 redact 且**跨帧滑窗**(INV-S3/S5/S10)。
- [ ] 面板渲染 agent 可控串前 escape / DOMPurify + strict CSP;redact 与 HTML 消毒并存(INV-S9)。
- [ ] 沙箱配置上限为 `workspace-write`，无 `danger-full-access`（INV-S6）。
- [ ] Fusion 只挂决策回合；panel 成员 stateless、互不喂输出、provenance 走旁路;judge evidence **≥1 强**(INV-F3/F4/F6/F7/F8)。
- [ ] 扇出前过 `preflightFanout` + 单 turn `maxTurnTokens` 封顶;usage 缺失 input/output 双侧兜底(INV-C4/C5)。
- [ ] 预算 **regime 感知**:stateless 用近似线性,resume 才超线性;默认范式不套超线性公式;下限不低于 ~18.7k 地板价(INV-C1/C2)。

---

## 5. 跨文档用词规则（防再次漂移）

为不再制造同义词 / 漂移,所有文档遵守:

| 规则 | 内容 |
|---|---|
| **优先用右列权威字面量** | `kind` 用 02 §2.1 权威值(`propose`/`implement`/...),简报别名(proposal/patch)只在沟通用。 |
| **「中枢」与 `orchestrator` 同指** | 中文统一「中枢」,代码 / `AgentId` 用 `orchestrator`,不引入第三个叫法。 |
| **「证据」专指可核验 evidence** | 不要把自由文字描述叫「证据」;那是 `body`。证据=结构化 `EvidenceItem`。 |
| **「轮」「发言」「消息」不混用** | 严格按 §2.1:round/turn/message 三层,不互相代称。 |
| **范式名固定四个** | 红蓝对抗 / 主从 / 对等结对 / 分工并行 ↔ `red-blue`/`master-worker`/`pair`/`parallel`,不另造别名。 |
| **新概念先查表** | 引入新名词前先 grep 本表;若已有同义词,复用,不新造。 |
| **类型一律引用 02** | 任何文档写到 `Message`/`Evidence`/...,引用 `@sylux/shared` 路径,不复制 `z.object`。 |

---

## 6. 本文件权威性声明

1. **术语权威**:§1 术语表是全项目用词的唯一基准。任何文档 / 代码 / 沟通中本表收录的词,以本文件定义为准;§2 消歧条目是高危混淆词的硬区分,实现期争议以此裁。
2. **不变量权威汇编**:§3 总表是各文档不变量(02 I / 03 E / 05·06 A / 09 W / 08 S / 21 F / 04 刹车 / 04·16 C)的**汇编镜像**,不新增不变量、不与源文档冲突;若发现某条与源文档不一致,**以源文档为准并回填修正本表**。本表的增量价值在「强制点 + 违反信号 + 溯源」三列的横向对齐,供审阅定位落点。
3. **不重定义类型**:本文件零 `z.object`/`z.enum`;所有类型锚点指向 02(`@sylux/shared/src/blackboard.schema.ts`)及 03/04/05/06/07/08/09/21 的接口定义,引用而非另写(焊死 R1)。
4. **自检基准**:§4 清单可直接转 CI 断言 / PR 模板 checklist;§3「强制点」列是验收锚点——**无落点的不变量视为未完成 TODO**,不得标「已保证」。
5. **编号纪律**:§0.2 文档编号映射表是全仓引用编号的唯一权威,一律锚定磁盘文件名(刹车=04、安全=08、worktree=09、面板=10、WS=11);逻辑派编号(刹车 07/安全 09/worktree 06/面板 08)全部作废。

### 6.1 待实测 / 开放项（移交实现期 M0 / 定稿收口）

- 【开放·FEAS-4 blocker】**digest 生成算法无主**:`DigestBuilder` 接口 + 基线归引擎 03 §2.2、高质量升级归性能 17 §6.3,但**具体压缩算法本身两边互相 punt**(03 称归 17、17 称归 03 ContextBundle),M1 stateless 连续性靠它,>2 轮 agent 会失忆。本表只能钉「接口归 03、升级归 17」,**算法落点须 03/17 定稿前裁定**,非本表可关。
- 【待实测·RS-B1/L4 blocker】INV-S 系列垫底假设「沙箱断网让中招 agent 跑不掉」未实测:codex `workspace-write` 是否允许出网(G4)、claude `--permission-mode plan` 是否真只读(G3)。若可出网则被注入 agent 可绕黑板直接 curl 外发,防火墙/redact 全失效。归安全 08/24 M0 闸,本表只标依赖。
- 【待实测】INV-A6:`buildAgentOutputJsonSchema` 摊平后嵌套 `discriminatedUnion`(evidence 三锚点)生成的 claude 内联 schema 是否逼近 ~32KB 上限;超限则 claude 退 `stream-json` 输入(02 §6.2 / 事实地基 F)。
- 【待实测】claude `--session-id` 预设能力(事实地基 F:help 未显式见到,`--resume` 存在)——影响 INV-A2/A3 在 claude 端的精确落点。
- 【开放】INV-S4 的「一次性 token」生命周期、ws-ticket 签发端鉴权(RS-M2)、「观战/控制权限分级」具体粒度,归面板 / WS 文档(10/11)细化,本表只钉「必须有」。
- 【开放】INV-W5 的敏感路径白名单**规则**归安全 08,本表只钉「必须过 `isPathAllowed`」;白名单具体条目随项目演进。
- 【开放·COV-9】M1/M2 「无 worktree 单 checkout 执行/落 diff」过渡形态无文档拥有规格(M1 称不写文件却要渲染 diff,矛盾),裁决「diff 面板推迟 M3 或 补过渡隔离规格」归裁剪 25,本表只标 INV-W7/INV-T4(M1 无 fs 时 file_ref 降 weak)的依赖。
- 【遗留回填】02 §12 错误码注释、03 个别旧引用仍残留逻辑派编号(「刹车 07」「安全 09」「worktree 06」),按 §0.2 映射表回填,归各源文档,非本表强制。
