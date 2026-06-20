# 01 · 进程拓扑与引擎主循环 v3

> **版本**:v3(2026-06-20)。相对 v2 的硬化点见 §0.2。**本批次吃掉的交叉/红队 findings 主线**:**D1/E6**(01 通篇 v1 词汇 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult`/`planRound`/`TurnSpec`/`firewall.wrap`/`contextFor` 全面迁移到 03v2 的 `StopPolicy`/`update`+`shouldStop`/`nextTurn`/`RoundPlan`/`TurnDirective`/`firewallPeerMessage`,并删除 §2.0「逐字节兼容」假声明)、**D2**(`AgentAdapter` 第三方法名统一为 `cancel`,删 `kill` 自相矛盾)、**C-NUM**(文档编号双轨制:01 内部既写「刹车 07」又写「对齐 04 §2.1」自相矛盾,全文统一到 **03v2 的文件名编号 + 角色名锚点**)。v2 已吃掉的主线(R1 seq 排序、R5 指纹通路、R7 paused 非终态、R8 env 白名单/注入、WS 背压、turn 超时、jsonl 留存)保持。
>
> **本文件地位**:sylux 的「运行时骨架」权威设计。负责四件事:① 进程拓扑(中枢 / 两适配器 / WS / 两子进程)与职责切分;② 引擎主循环的**运行时切面**(把 03 的范式无关循环重投影成广播触点 + 持久化写序 + `AbortSignal` 注入点 + 失败出口);③ 并发与取消(`AbortSignal` 贯穿全栈);④ 错误传播与重试 + 状态持久化(jsonl 为主 + 可选 sqlite 索引)。
>
> **类型引用而非另写(R1)**:本文件出现的 `Message` / `Evidence` / `EvidenceItem` / `FilePatch` / `AgentMessagePayload` / `AgentEvent` / `TokenUsage` / `Round` / `RunStatus` / `BoardState` / `JsonlRecord` 及所有枚举,**唯一权威定义在黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。`Playbook` / `PromptContext` / `TurnDirective` / `RoundPlan` / `BoardView` / `EngineDeps` / `runEngine` / `runTurn` / `consume` 由**引擎文档 03** 权威定义;`StopPolicy` / `StopContext` / `StopDecision` / `CompositeStopPolicy` / `DonePolicy` / `KEEP_RUNNING` 由**收敛刹车文档 04** 权威定义;`AgentAdapter` / `AgentInput` 由**适配层 05/06** 权威定义;`firewallPeerMessage` / `buildChildEnv` 由**安全文档 08** 权威定义;`WorktreeManager` / `MergeResult` 由**隔离文档 09** 权威定义。本文件**只引用、只调用,禁止另写一份 zod 或接口**。任何字段歧义以权威源为准。
>
> **下游编号约定(吃掉 C-NUM 编号漂移,与 03v2 §0 一致)**:仓内曾存在两套编号(旧「逻辑派」把安全叫 09、面板叫 08、刹车叫 07)。**本文件一律以实际文件名编号为准**:`02`=黑板协议、`03`=引擎、`04`=收敛刹车、`05/06`=适配层、`07`=provider、`08`=安全、`09`=隔离 worktree、`10`=面板、`11`=WS。每次引用同时给**角色名**作防漂锚点(如「收敛刹车 04」「安全 08」「隔离 09」)。若全仓最终改用另一套编号,按角色名零成本重定位。
>
> **事实地基**:进程启动约束、事件流形状、resume 参数集、token 累积模型全部以 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)为准。凡该文件已覆盖的不再标【待实测】;仅对其未覆盖的假设标注。
>
> **与引擎文档 03 的关系**:03 拥有「范式无关循环本体」(`runEngine`/`runTurn`/`consume`/`Playbook`/`EngineDeps` 接口与四范式实现);本文件**不重复定义**,只投影其运行时切面(§2.0)。二者循环行为一致;**发现差异以 03 的接口签名 + 本文件的运行时不变量(§0.3)为准并互相回填**(不再声称「逐字节兼容」——v2 此说法在词汇未对齐时为假,D1)。
>
> **与总体规划的关系**:本文件是 `docs/sylux-master-plan.md` §1(拓扑)、§3(引擎)、§4.5/§7(并发刹车)、§10(持久化)的完整展开。二者接口签名保持兼容;若发现差异,接口签名以 02/03/04 + 本文件为准,并回填总体规划。

---

## 0. 设计目标与不变量(运行时层)

### 0.1 本文件负责 / 不负责

| 负责(给完整拓扑 + 伪代码 + 失败路径) | 不负责(只引用) |
|---|---|
| 进程拓扑图与各组件职责 | `Message`/`Evidence`/`AgentEvent` 等类型(02) |
| 运行时切面:广播触点 + 持久化写序 + AbortSignal 注入点 + 失败出口 | `runEngine`/`runTurn`/`consume`/`Playbook`/`RoundPlan`/`TurnDirective`/`PromptContext` 接口与范式实现(03) |
| `runOrchestration` 取消/持久化壳 + `AbortSignal` 贯穿模型 | `AgentAdapter.send/resume/cancel` 内部 execa 细节(05/06 适配层) |
| 错误分类、传播、重试、退避、熔断 | provider 配置与热换(07) |
| jsonl append-only 持久化 + 崩溃恢复 + 可选 sqlite 索引 | worktree 合并算法(09,本文只调 `mergeRound`) |
| 进程生命周期与 graceful shutdown | 终止判定阈值算法(04,本文只调 `StopPolicy.update/shouldStop`) |
| 一轮生命周期时序 | WS 帧协议 / 鉴权(11,本文只定义广播触点);面板渲染(10) |

### 0.2 v3 相对 v2 的硬化点(变更摘要)

| # | 主题 | v2 问题(交叉/红队 finding) | v3 修正 | 章节 |
|---|---|---|---|---|
| V1 | **v1 刹车词汇残留**(D1/E6) | v2 多处仍用 03v1 自造接口 `Brakes.checkBefore/checkAfter`、`BrakeResult`,且 §2.0 声称与 03「逐字节兼容」——但 03v2 已删前置刹车、改用 `StopPolicy`(`update`+`shouldStop`,每轮**末**调一次,无前置),「逐字节兼容」在词汇未对齐时为假 | 全文 `Brakes`→`StopPolicy`;删 P0 `pre-brake` 相位(无前置刹车);P8 由 `post-brake checkAfter` 重定义为 `stop-decision`(`update→shouldStop`);轮数/token 的「提前抢停」由 04 **前瞻预算刹车**在轮末 `shouldStop` 内做(事实地基 D);删「逐字节兼容」改「行为一致,差异以 03 接口为准」 | §0.1、§0.3 RT11、§1.2、§1.3、§2.0、§2.1、§3.x、§4.x、§5.2 |
| V2 | **adapter 方法名自相矛盾**(D2) | v2 §0.1/§1.2 写 `AgentAdapter.send/resume/kill`,但 §3.4 自己调 `adapter.cancel()`,03v2 §9 权威是 `cancel`——01 内部不自洽 | 全文统一 `cancel`(杀进程树,幂等);删 `kill`(进程信号语义另说,§6.2 graceful shutdown 仍可提 SIGTERM 但不命名为 adapter 方法) | §0.1、§1.2、§3.4 |
| V3 | **文档编号双轨制**(C-NUM) | v2 §0.1 写「刹车阈值算法(07)」「适配 04」,§5.2/§7.1 又写「对齐 04 §2.1」「04 §10」——同一份「刹车」既叫 07 又叫 04,单稿内自相矛盾 | 统一到 03v2 的**文件名编号**:刹车=04、适配=05/06、provider=07、安全=08、隔离=09、面板=10、WS=11,每处带角色名锚点 | 全文 |
| V4 | **firewall 旧签名**(E5/D1) | v2 §1.3 时序写 `firewall.wrap`(对象方法);03v2 H6/08 已改 `firewallPeerMessage(msg)→{action:'pass'\|'flag'\|'block', wrapped}` 纯函数 | §1.3/§2.1 P3/§2.3 改 `firewallPeerMessage`;block→不拼入+落 system,连续耗尽→`INJECTION_BLOCKED`(08) | §1.3、§2.1、§2.3 |
| V5 | **Blackboard 越权 contextFor**(D1) | v2 §1.2/§1.3 让 `Blackboard.contextFor` 算 delta+digest;但 03v2 把「喂什么上下文」下放给 `playbook.nextTurn` 产 `PromptContext`(含 delta 选择 + `DigestBuilder` 产 digest),Blackboard 不算上下文 | `Blackboard` 职责删 `contextFor`,仅 `append/closeRound/setStatus/recordSession/view/subscribe`(03 §4.2);delta/digest 在 `renderPrompt` 阶段由 playbook 决策 | §1.2、§1.3、§2.1 |
| — | (v2→v1 旧硬化点 A1–A7 已并入正文,保留其不变量编号 RT1–RT10) | — | — | §0.3 |

> **v2 已吃掉、v3 继续保持的硬化点(原 A1–A7,不再单列表格)**:seq 排序权威(RT9)、指纹累加非逐条喂刹车(§5.2)、合并冲突 paused 非终态挂起(§2.2/§7.2)、WS 广播非阻塞(RT10)、turn 墙钟超时(§3.5)、新错误码运行时处置(§4.4)、jsonl 体积留存(§5.6)。

### 0.3 运行时不变量(实现必须保持,违反即 bug)

- **RT1 中枢不碰目标文件**:文件改动只发生在 agent 自己的 worktree;中枢只读 diff、调 `mergeRound` 做合并裁决(总体规划 §1.3)。
- **RT2 两 CLI 永不直连**:唯一通路是黑板 `Message`;子进程之间无任何 socket/pipe/文件共享(worktree 物理隔离)。
- **RT3 未校验不入引擎**:任何子进程 stdout JSON 必先过 `validateMessage`(02 §8),失败即错误码,绝不把未校验对象 `append` 进黑板(02 不变量 I2)。
- **RT4 未过防火墙不进对面 prompt**:peer 的 `body`/`evidence` 进对面上下文前必过内容防火墙 `firewallPeerMessage`(安全 08 §4);结构合法 ≠ 意图安全。
- **RT5 单写者持久化**:每个 run 的 jsonl 只有 engine 单线程 append;WS/面板/sqlite 索引都是 jsonl 的**只读投影**,杜绝双写漂移(02 §10.3)。
- **RT6 取消可达**:任一 `AbortSignal.abort()` 必能在有限时间内终止整个 run(含杀掉 `.cmd` shim 背后的真实子进程,事实地基 A);不存在「点了停但子进程还在烧 token」的状态。
- **RT7 append 即广播**:`blackboard.append(msg)` 成功落 jsonl 后**同步触发广播投递与指纹累加**,三者顺序固定(落盘→广播投递→指纹累加进当前轮),崩溃时已广播的一定已落盘。注意「广播投递」是**入队非阻塞**(RT10),「指纹累加」是把该条 evidence 指纹并入**当前轮内存指纹集**(非逐条喂刹车;刹车在轮末 `closeRound` 后读 `Round.evidenceFingerprints` 做差集,§5.2/04 §2.1)。
- **RT8 sessionId 前不可 resume**:拿到 `session_started.sessionId` 前,agent `resumable=false`(02 不变量 I5 / 事实地基 B)。
- **RT9 排序权威是 seq 不是 ts**(A1/02 I6):黑板一切排序、回放折叠、广播顺序、收敛差集均以中枢 `append` 时盖的单调 `seq`(02 §5)为准;`ts`(墙钟 ms)仅供人读,**禁用于排序**(并行范式同轮多条 `ts` 可能相等)。`append` 盖 `id/runId/seq/from/role/ts`;`schemaVersion` **不盖在内存态 message 上**(02 I4:只在 jsonl 行)。
- **RT10 广播不阻塞引擎**(A4):`WsHub.broadcast` 是 fire-and-forget 入队——只写每订阅者的**有界缓冲队列**,绝不 `await` 网络写。慢客户端缓冲满即被驱逐(回发 `resync` 提示重连拉 snapshot,11)。引擎主循环的 `append` 永不因任何 WS 客户端慢而阻塞(否则一个卡住的浏览器标签页能拖死真金白银的 run)。
- **RT11 终止判定统一在轮末、无前置刹车**(v3,V1/对齐 03v2 H1+04 §2.4):本文件**不内置任何刹车或 done 逻辑**。终止裁决全归收敛刹车 04 的 `CompositeStopPolicy`(内含三重刹车 + `DonePolicy` + 范式 `PlaybookDonePolicy`),引擎在**每轮关闭后**(`closeRound` 落指纹缓存之后)按 04 §2.4 顺序铁律调 `stopPolicy.update(ctx)` 再 `stopPolicy.shouldStop(ctx)` 各一次。**没有 `checkBefore`/前置刹车**:轮数/token 的「提前抢停」由 04 的前瞻预算刹车(用 `lastRoundUsage` 预测下一轮累积是否破预算,事实地基 D)在后置裁决里完成。引擎层唯一的「轮内、调 adapter 前」本地护栏是 `maxResumeChain`(只数 resume 链长,O(1),不读 token,§3.3/03 §5.2)。

---

## 1. 进程拓扑

### 1.1 全景图(进程边界 + 数据流 + 信号流)

```
                          ┌───────────────────────────────────────────┐
                          │  浏览器面板 @sylux/web (React+Vite)         │
                          │  观战只读 / 控制介入(pause·inject·abort)   │
                          └──────▲────────────────────────┬─────────────┘
              WS 增量帧(只读)   │   一次性 token + Origin   │ 控制帧(需 control 权限)
              snapshot(初连)    │   白名单 + 127.0.0.1       │ pause/resume/inject/abort
          ┌──────────────────────┴────────────────────────▼─────────────────────────┐
          │  中枢 server @sylux/server                                                │
          │   WsHub(广播+鉴权+权限分级)   RestApi(启动/读配置,不回传 key)          │
          │   CLI 入口 `sylux run --playbook ...`                                      │
          ├───────────────────────────────────────────────────────────────────────────┤
          │  引擎内核 @sylux/core                                                       │
          │   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
          │   │ runEngine   │→ │ Blackboard   │→ │ StopPolicy   │  │ firewallPeerMsg  │  │
          │   │ (主循环)    │  │ (append/广播)│  │ (04 复合刹车)│  │ (注入防护·08)    │  │
          │   └──────┬──────┘  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
          │          │ runTurn        │ persist                                         │
          │   ┌──────▼──────┐  ┌──────▼────────────────────────────┐                    │
          │   │ Playbook    │  │ RunStore (jsonl append-only       │                    │
          │   │ (换打法·03) │  │   + 可选 sqlite 索引,单写者 RT5) │                    │
          │   └─────────────┘  └───────────────────────────────────┘                    │
          ├──────────────────────────────┬────────────────────────────────────────────┤
          │  providers @sylux/providers   │  agents @sylux/agents                       │
          │   配置/校验/热换(下轮生效·07)│  AgentAdapter×2 + buildChildEnv(env 白名单) │
          │                               │  WorktreeManager(隔离+合并·09)             │
          ├───────────────────────────────────────────────────────────────────────────┤
          │  shared @sylux/shared ← 地基:Message/Evidence/AgentEvent 唯一权威 zod(02) │
          └───────────────────────────────────────────────────────────────────────────┘
                 │ spawn(真实 exe + stdin prompt,         │ spawn(同左,claude shim)
                 │  env 白名单 extendEnv:false, windowsHide) │
                 ▼                                          ▼
        ┌───────────────────────┐                  ┌───────────────────────┐
        │ codex 子进程           │   ✗ 永不直连     │ claude 子进程          │
        │ (codex.exe vendor bin) │ ◄────RT2────►    │ (claude shim 背后 node)│
        │ worktree A(隔离副本)  │                  │ worktree B(隔离副本)  │
        └───────────────────────┘                  └───────────────────────┘
```

图例:`→` 进程内调用 / 数据流;`▲▼` 跨进程(WS / spawn-stdio);`✗` 明确禁止的通路(RT2)。

### 1.2 组件职责一览

| 组件 | 包 | 进程 | 单一职责 | 显式不做 |
|---|---|---|---|---|
| `WsHub` | server | 中枢主进程 | WS 广播增量、鉴权、观战/控制权限分级、控制帧(pause/inject/abort)入队 | 不解析业务语义、不直接改黑板(控制帧转 engine 命令队列) |
| `RestApi` | server | 中枢主进程 | 启动 run、读 provider 配置(脱敏)、拉 snapshot | 不回传 key、不做长连接 |
| `runEngine` | core | 中枢主进程(主循环协程) | 编排:`nextTurn`→调 adapter→校验→`append`→轮末 `closeRound`→`stopPolicy.update/shouldStop` 判停;唯一持有 `AbortController` 根 | 不 spawn(委托 adapter)、不写文件(委托 worktree)、不算终止阈值(委托 04 `StopPolicy`)、不内置前置刹车(RT11) |
| `Blackboard` | core | 中枢主进程 | `append` 已校验 Message、`closeRound`、`setStatus`、`recordSession`、`view`、`subscribe`;落盘→广播→指纹累加的固定写序(RT7) | 不校验(委托 `validateMessage`)、**不算上下文 delta/digest**(那是 `playbook.nextTurn` 产 `PromptContext` 的职责,V5)、不算指纹阈值(只缓存,04 读) |
| `Playbook` | core | 中枢主进程 | 决定 `nextTurn`(谁发言/扮谁/`PromptContext`)/ `shouldMergeAt` / `isDone`(经 `PlaybookDonePolicy` 注入 04) | 不执行发言(返回 `RoundPlan`)、不碰进程、不直接判停(只供 `isDone` 给 04 裁) |
| `StopPolicy`(04) | core | 中枢主进程 | `CompositeStopPolicy`:`update(ctx)` 累加状态 + `shouldStop(ctx)` 统一裁决(轮数/前瞻 token 预算/收敛 stall/done-ack),每轮**末**各调一次 | 不杀进程(返回 `StopDecision`,由 engine 走 `finalize` 正常终止);**无前置刹车**(RT11) |
| `AgentAdapter` | agents | 中枢主进程(管理子进程) | `send`/`resume`/`cancel`;execa spawn、解析 JSONL、emit `AgentEvent` | 不校验业务 schema(只保证 `AgentEvent` 形状)、不决定上下文内容 |
| `WorktreeManager` | agents | 中枢主进程(调 git) | create/diff/`mergeRound`/destroy | 不决定何时合并(playbook 决定)、冲突不自动选边(硬停) |
| codex/claude 子进程 | — | 独立 OS 进程 | 在各自 worktree 内干活,产出合 schema 的最终 JSON | 互不通信、不碰对面 worktree |

### 1.3 一轮的生命周期(端到端时序)

```
 面板        WsHub      runEngine     Playbook   Firewall   Blackboard  Adapter(codex)  worktree  StopPolicy
  │            │           │            │          │           │            │            │          │
  │            │     ┌─round k 开始─┐   │          │           │            │            │          │
  │            │     │ nextTurn    ├───►│ RoundPlan │           │            │            │          │
  │            │     │             │◄───┤(turns+PromptContext)  │            │            │          │
  │            │     │ 对每个 turn:                 │          │           │            │            │
  │            │     │  renderPrompt(PromptContext.delta/digest 由 playbook 决策,V5)      │          │
  │            │     │  firewallPeerMessage ────────────────────►│ 包边界/扫描(08)      │          │
  │            │     │  adapter.send/resume ────────────────────────────────────────►│ spawn+stdin │
  │◄─delta─────┤◄────┤  for-await AgentEvent:                                          │ JSONL 流    │
  │  (观战)    │     │   session_started → 标记 resumable                              │            │
  │            │     │   final_message(raw,usage)                                      │            │
  │            │     │  validateMessage(raw)  ──(safeParse+核验,失败重发≤N)            │            │
  │            │     │  blackboard.append ──────────────────────►│ 落 jsonl→广播投递→指纹累加(RT7)  │
  │◄─message───┤◄────┤                                           │            │            │          │
  │            │     │ shouldMergeAt? → worktrees.mergeRound ─────────────────────────────────────►│ 3-way
  │            │     │                                                                  │ {conflicts}│
  │            │     │ closeRound(k) ───────────────────────────►│ 封存 evidenceFingerprints         │
  │            │     │ stopPolicy.update → shouldStop ───────────────────────────────────────────►│ 裁决
  │            │     │              │◄────────────────────────────────────────────────────────────┤{stop?}
  │◄─status────┤◄────┤ stop? → finalize(status,reason) 落 status_changed,广播终态        │          │
  │            │     └─round k 结束,round++─┘                                          │          │
```

关键顺序保证:**nextTurn → renderPrompt(firewallPeerMessage) → adapter → validate → append → merge → closeRound → stopPolicy(update→shouldStop)**。终止判定**统一在轮末 `closeRound` 之后**,无前置刹车(RT11)。任何一步抛错走 §4 错误传播;任何一步收到 abort 走 §3 取消。

---

## 2. 引擎主循环(运行时骨架视角)

### 2.0 与引擎文档(03)的分工(不重复定义)

主循环的**范式语义**(`Playbook.nextTurn` / `shouldMergeAt` / `isDone`、`TurnDirective` / `RoundPlan` / `PromptContext` / `BoardView` / `EngineDeps` 接口、`runEngine` / `runTurn` / `consume` 的完整伪代码)由引擎文档 03 拥有,**终止裁决**(`StopPolicy` / `CompositeStopPolicy` / `DonePolicy`)由收敛刹车文档 04 拥有,本文件**只引用、只调用**(`docs/drafts/03-engine-playbook.md` §3–§5;`docs/drafts/04-convergence-brakes.md`)。本节给的是**同一循环的运行时切面**:把 03 的循环重投影成「广播触点 + 持久化写序 + `AbortSignal` 注入点 + 失败出口」四件事,服务 RT5/RT6/RT7/RT11。

> **不再声称「逐字节兼容」(吃掉 D1)**:v2 §2.0 称本文件与 03「逐字节兼容」,但当时 01 仍带 v1 词汇(`Brakes`/`checkBefore`/`checkAfter`/`planRound`/`TurnSpec`),与 03v2 的 `StopPolicy`/`nextTurn`/`RoundPlan` 并不兼容,该声明为假。v3 已把全文词汇迁移到 03v2/04 的权威接口名。**正确表述**:二者循环行为**一致**;若发现接口签名或语义差异,**以 03 的接口签名 + 04 的终止裁决 + 本文件 §0.3 运行时不变量为准**,并互相回填,不再用「逐字节兼容」这种无法机器核验的措辞。

> 一句话边界:**03 回答「下一句谁来说、说什么」,04 回答「这一轮要不要停」,01 回答「这句话怎么安全地落盘、广播、可被随时掐断」。**

### 2.1 一轮的运行时阶段(7 个固定相位)

引擎把 03 的循环切成 7 个**带副作用标注**的相位(v3 删去 v1 的 P0 `pre-brake`——无前置刹车,RT11)。每个相位标明:是否可被 abort 打断(RT6)、是否触发广播(RT7)、是否写 jsonl(RT5)。`runEngine` 协程严格按此序推进,**不允许相位重排**(乱序会破坏「落盘→广播→指纹累加」的崩溃一致性)。

| 相位 | 名称 | 主要动作 | abort 可打断 | 广播帧(11) | 写 jsonl(02 §7) |
|---|---|---|---|---|---|
| P1 | `plan` | `playbook.nextTurn(view)` → `RoundPlan`(含每 turn 的 `PromptContext`,V5) | 是(纯函数,弃结果即可) | `round_planned` | — |
| P2 | `render` | 对每 turn:`renderPrompt(PromptContext)`——delta/digest 已由 playbook 在 P1 决策(03 §2),引擎只渲染 | 是 | — | — |
| P3 | `firewall` | peer body/evidence 过 `firewallPeerMessage`(边界标记 + 特征扫描,安全 08);`block` 条不拼入 | 是 | — | — |
| P4 | `dispatch` | `adapter.send/resume`,消费 `AgentEvent` 流;**受 `turnTimeoutMs` 墙钟超时保护**(§3.5) | **是(关键)**:abort/超时→杀子进程 | `delta`/`tool_call`(透传观战) | — |
| P5 | `validate` | `validateMessage`(02 §8)+ 打回重试≤N;**evidence 核验在此回填强 `file_ref` 的中枢派生 `contentHash`**(02 §8.3,先于 P6 入指纹) | 是(重试间隙) | — | — |
| P6 | `append` | `blackboard.append` 已校验消息(盖 `seq`,RT9) | 否(原子:要么整条落要么不落) | `message`(入队投递,RT10) | `message` 行 |
| P7 | `merge+close+stop` | `shouldMergeAt`→`mergeRound`(09);冲突→`paused`**挂起**(非终态);`closeRound` 封存 `Round.evidenceFingerprints`;之后 `stopPolicy.update→shouldStop`(04,RT11),终态走 `finalize` | 半(merge/裁决前可断;落盘原子) | `round_closed`/`status`(终态时) | `round_closed`(+冲突/终止时 `message`+`status_changed`) |

> **RT7 焊死点在 P6**:`append` 内部顺序恒为 `盖 seq+落 jsonl → 入队广播投递(非阻塞,RT10）→ 指纹累加进当前轮`,三步同步、不可乱序、不可只做其一(实现见 §5.2 的 `Blackboard.append` 写序)。因此「面板看到的任何一条 message,一定已在 jsonl 里」——崩溃后回放绝不丢面板已展示的消息。注意指纹累加是把该条 evidence 指纹并入**当前轮内存指纹集**(轮末 `closeRound` 才封存为权威 `Round.evidenceFingerprints`),**不是**逐条调刹车——刹车只在 P7 轮末 `closeRound` 之后 `stopPolicy.shouldStop` 读 `Round.evidenceFingerprints` 做差集(04 §2.1/RT11),杜绝 v1 把指纹通路画错的旧措辞。

### 2.2 runEngine 的运行时包装(在 03 循环外再裹一层取消/持久化壳)

03 的 `runEngine(playbook, deps)` 是**范式无关本体**。运行时层在其外再包一个 `runOrchestration`,负责:① 建 `AbortController` 根(§3.1);② 起持久化写者(§5);③ 把控制帧队列(pause/inject/abort,来自 WsHub)接进循环;④ 保证任何出口都 `finalize` + flush + 杀子进程。

```ts
/** 运行时入口:CLI `sylux run` 与 RestApi 启动 run 都走这里。包裹 03 的 runEngine。 */
export interface RunOptions {
  runId: string;
  playbook: Playbook;                 // 03
  signal?: AbortSignal;               // 外部(CLI Ctrl-C / RestApi)可传入;内部再 link 出根(§3.1)
  controlQueue: ControlQueue;         // 面板控制帧入口(§2.3),WsHub 投递
}

export async function runOrchestration(opts: RunOptions, deps: EngineDeps): Promise<RunResult> {
  // ① 取消根:外部 signal 与内部根 link(§3.1),任一 abort 全树取消
  const root = linkAbort(opts.signal);              // AbortController(§3.1)
  // ② 控制帧泵:把 WS 控制帧翻译成 engine 命令(pause/inject/abort),挂在 root 上
  const pump = startControlPump(opts.controlQueue, deps, root); // §2.3
  // ③ 把 root.signal 注入 deps(adapter.send/resume、worktrees、validate 复跑全收同一 signal)
  const deps2: EngineDeps = withSignal(deps, root.signal);      // §3.2

  try {
    // 委托 03 的范式无关本体(已含 P1–P7 相位、轮末 stopPolicy 判停、finalize 不吞错)
    return await runEngine(opts.playbook, deps2);   // 03 §5.1
  } finally {
    pump.stop();
    await deps.runStore.flush();                    // §5.2:确保末行落盘
    await killAllChildren(deps2, 'run_finalized');  // RT6:任何出口都不留烧 token 的子进程
    root.dispose?.();
  }
}
```

> 关键不变量:`runEngine` 自己已保证「任何终态都过 `finalize` 落 `status_changed`」(03 §5.1 的 try/catch),`runOrchestration` 的 `finally` 是**第二道兜底**——即使 `finalize` 本身抛错,子进程也一定被杀、jsonl 也一定 flush。两层兜底应对 RT6「点了停但子进程还在烧 token」。
>
> **paused 不是出口**:`WORKTREE_CONFLICT` 触发 `setStatus('paused')` 时,`runEngine` **不返回**(不进 `finally`)——它在循环内挂起等控制帧(§7.2),只有 resume(续跑)/abort(转终态)/inject(裁决后续跑)才离开挂起。因此 `finally` 的 `killAllChildren` 不会在 paused 时触发(此时也无运行中子进程:冲突发生在轮末 merge,P4 早结束)。这是 v1「finalize('paused')」错误的根因修补:把 paused 当终态会让 run 永远停在 finally 之后,人工裁决无处可去。

### 2.3 控制帧接入(面板介入 → 循环)

面板的 pause/inject/abort(面板 10 / WS 11)不直接改黑板(RT2 的精神延伸:外部输入也走受控通道),而是经 `WsHub`(需 control 权限,11)投递到 `ControlQueue`,由 `startControlPump` 在**相位边界**消费(不在 P4 子进程流中途插队,避免撕裂一次发言)。

```ts
export type ControlFrame =
  | { kind: 'pause' }                                  // → 轮边界暂停循环,setStatus('paused')
  | { kind: 'resume' }                                 // paused→running,从下一轮 P1 继续
  | { kind: 'inject'; from: 'human'; role: Role; payload: AgentMessagePayload } // 人工插一条黑板消息(role 见下注)
  | { kind: 'abort'; reason?: string };                // root.abort() → 全树取消(§3)

export interface ControlQueue {
  /** 非阻塞取下一条控制帧(无则返回 undefined),引擎在相位边界轮询。 */
  poll(): ControlFrame | undefined;
  /** 等待下一条(paused 态下阻塞等 resume/abort,不空转 CPU)。 */
  next(signal: AbortSignal): Promise<ControlFrame>;
}
```

| 控制帧 | 消费时机 | 副作用 | 失败/边界 |
|---|---|---|---|
| `pause` | 轮边界(P7→P1 之间) | `setStatus('paused')`,循环阻塞在 `controlQueue.next()` | P4 进行中收到 → 等本次发言落 P6 再暂停(不杀子进程) |
| `resume` | paused 阻塞中 | `setStatus('running')`,回到下一轮 P1 | 已终态 run 收到 → 忽略 + 告警(11) |
| `inject` | 轮边界(P7→P1 之间) | 经 `validateMessage`(human 的 evidence 同样核验)→ `append`(`from:'human'`,`role` 取控制帧指定值) | 校验失败 → 回 11 报错,不入黑板(RT3);`role` 非法 / `kind==='system'`(02 C7:仅 orchestrator 可发 system)→ 拒 |
| `abort` | **任意相位**(经 signal,不等边界) | `root.abort(reason)` → §3 全树取消 → `finalize('aborted')` | 幂等:重复 abort 只第一次生效 |

> `inject` 是唯一能让 `from:'human'` 进黑板的通路;它**照样过 RT3 校验**(human 也可能粘错路径/伪造 evidence)。**role 取值约束**:02 的 `roleSchema` 不含 `'human'`——human 注入时须显式带一个**业务 role**(通常 `arbiter`,人工裁决场景;或 `proposer`/`peer` 替人下场),引擎用它填 `Message.role`,`from` 固定 `'human'`。若 human 注入的 `kind==='critique'`(或 `role==='critic'`),则**同样触发 02 C1 evidence 强制**——human 想插批判也得给可核验 evidence,否则被打回(RT3 不为人开后门)。**注入消息进对面 prompt 时,与任何 peer 消息一样过 P3 内容防火墙**(RT4):human 粘进来的文本可能含注入,不豁免。`abort` 是唯一不等相位边界、立即经 `AbortSignal` 穿透到 P4 子进程的控制帧(RT6 实时性要求)。

## 3. 并发与取消(`AbortSignal` 贯穿全栈)

### 3.0 取消模型总览(一棵树,一个根,处处可断)

RT6 要求「任一 `abort()` 必能有限时间内终止整个 run,且不留烧 token 的子进程」。实现手段是**单根 `AbortController` + 全栈 signal 透传**:全栈只有一个取消根 `root`,它的 `root.signal` 被注入到每一个会阻塞或会 spawn 的依赖(adapter / worktree / validate 的 command 复跑 / runStore),任何一处都能观察到同一个 abort。取消来源有三类,全部汇流到这一个根:

| 取消来源 | 入口 | 汇流方式 |
|---|---|---|
| 外部进程信号(CLI `Ctrl-C` / `SIGTERM`) | `runOrchestration(opts)` 的 `opts.signal` | `linkAbort` link 进根(§3.1) |
| 面板控制帧 `{kind:'abort'}` | `ControlQueue` → `startControlPump` | pump 调 `root.abort(reason)`(§2.3) |
| 终止判定 / 致命错误 / 范式 done | `runEngine` 内 `finalize` | 走正常返回,不经 abort;`finally` 仍兜底杀子进程(§3.4) |

> 关键区分:**`StopPolicy` 命中(刹车 / done / stall)是「正常终止」,走 `finalize` 返回路径,不调 `abort`**;`abort` 专指「外部要求立刻中止」(人工 / 信号 / 致命),它是唯一不等相位边界、立即穿透到 P4 子进程流的路径(§2.3、§3.3)。两条路径最终都收敛到 §3.4 的 `killAllChildren` 兜底。

### 3.1 取消根与 link(`linkAbort`)

`linkAbort` 建一个内部根 `AbortController`,并把外部传入的 `signal`(可选)单向 link 进来:外部 abort → 内部根 abort;内部根 abort 不反向影响外部(外部 signal 可能被多个 run 复用)。

```ts
export interface LinkedAbort {
  /** 全栈唯一取消根。注入 deps、传子进程、轮询检查点都用它。 */
  readonly signal: AbortSignal;
  /** 触发全树取消。reason 落 finalize/日志;幂等(重复调用只第一次生效)。 */
  abort(reason?: string): void;
  /** 解绑外部 link 的监听器,防泄漏(run 结束 finally 调,见 §2.2)。 */
  dispose(): void;
}

/** 建内部根并单向 link 外部 signal。外部 abort 透传进根;内部 abort 不外溢。 */
export function linkAbort(external?: AbortSignal): LinkedAbort {
  const root = new AbortController();
  const onExt = () => root.abort(external?.reason ?? 'EXTERNAL_ABORT');
  if (external) {
    if (external.aborted) root.abort(external.reason); // 已 abort:立即同步透传
    else external.addEventListener('abort', onExt, { once: true });
  }
  return {
    signal: root.signal,
    abort: (reason?: string) => { if (!root.signal.aborted) root.abort(reason); }, // 幂等
    dispose: () => external?.removeEventListener('abort', onExt),
  };
}
```

> 用 Node 原生 `AbortController`/`AbortSignal`(Node v22,事实地基环境)。`abort(reason)` 把 reason 挂在 `signal.reason` 上,下游 `throwIfAborted()` / `error` 事件可读出原因,落 `finalize(status, reason)`。

### 3.2 signal 注入(`withSignal`)

`runEngine`(03)的 `EngineDeps` 本身不持有 signal——signal 是「这一次 run」的运行时切面,由 `withSignal` 在 `runOrchestration` 里**包一层**注入,使 adapter / worktree / validate 的 command 复跑 / runStore 全部收同一个 `root.signal`。这样 03 的循环本体保持范式无关、与取消解耦,取消能力靠依赖注入获得。

```ts
/** 把 root.signal 注入所有「会阻塞或会 spawn」的依赖,返回新的 EngineDeps(浅包装,不改 03 循环)。 */
export function withSignal(deps: EngineDeps, signal: AbortSignal): EngineDeps {
  return {
    ...deps,
    // adapter.send/resume 内部 spawn 时把 signal 透传给 execa({ signal });
    // abort → execa 自动按 §3.4 杀进程树(适配 05/06 §10),流以 {error,'SUBPROCESS_CANCELLED'} 收尾。
    adapters: mapValues(deps.adapters, (a) => bindSignal(a, signal)),
    // worktree 的 git 子进程同样收 signal(长 merge / clone 可被掐断,隔离 09)。
    worktrees: bindSignal(deps.worktrees, signal),
    // validate 内 evidence 的 command 复跑抽检(02 §8.3)收 signal,abort 时停掉复跑子进程。
    validate: bindSignalFn(deps.validate, signal),
    // runStore 的 flush/append 收 signal,用于「abort 后仍允许最后一次 flush」(§5.2)。
    runStore: deps.runStore,
  };
}
```

> `bindSignal` 是适配器/管理器自带的「绑定本次 run 的 signal」入口(适配 05/06 的 `AgentAdapter` 内部 `send/resume` 接 `execa(..., { signal })`;事实地基 A:execa 经 signal abort 时杀的是它 spawn 的真实 exe,不是 shim)。引擎层不直接对子进程发信号,杀进程树的脏活全在适配 05/06 §10 的 `cancel()`(`tree-kill`)。`StopPolicy`(04)是纯计算、不 spawn,故不需注入 signal;它读 `BoardView` 派生的 `StopContext`,无阻塞 IO。

### 3.3 并发执行模型(serial / parallel,每 turn 隔离)

03 §3.2 `RoundPlan.execution` 决定本轮 turn 是串行还是并发。运行时层对两种模式的取消与失败隔离语义:

| 模式 | 触发范式 | 执行 | 取消语义 | 失败隔离 |
|---|---|---|---|---|
| `serial` | red-blue / master-worker / pair | `await runTurn(t)` 逐个 | abort → 当前 `runTurn` 内 signal 抛出,循环不再起下一个 | 单 turn,无并发隔离问题 |
| `parallel` | parallel | `Promise.all(turns.map(runTurn))` | abort → **同一 signal 同时穿透两个 `runTurn`**,两子进程并行被杀(§3.4) | 各 turn 写**各自 worktree**(RT1/RT2),一个 turn 失败不污染另一个;合并冲突在轮末 `mergeRound` 才暴露(03 E5/隔离 09) |

```ts
/** parallel 轮:两 turn 并发,任一 abort 两者皆停;失败不互相短路(都跑完再汇总,避免漏杀)。 */
async function runRoundParallel(turns: TurnDirective[], round: number, deps: EngineDeps): Promise<TurnResult[]> {
  // 用 allSettled 而非 all:一个 turn 抛错时,另一个仍要被正常收尾(其子进程已被同一 signal 杀,
  // 但需 await 其 runTurn 返回以确保 worktree 句柄/流已清理),避免「悬挂子进程」(RT6)。
  const settled = await Promise.allSettled(turns.map((t) => runTurn(t, round, deps)));
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { ok: false, directive: turns[i], code: classifyThrow(s.reason), fatal: isFatalThrow(s.reason) },
  );
}
```

> 为什么 parallel 用 `allSettled` 不用 `all`:`Promise.all` 在第一个 reject 时立即 resolve 外层,但**另一个 `runTurn` 的协程仍在跑**——若此时直接进 finalize,可能在它清理 worktree/流之前就 `killAllChildren`,虽不致命但易产生竞态日志。`allSettled` 保证两个 `runTurn` 都走完自己的 `finally`(子进程已被同一 abort 杀,所以不会卡)。abort 的实时性由 signal 保证,不靠 `all` 的短路。

### 3.4 取消的全树穿透(`killAllChildren` + 相位级语义)

abort 的「全树穿透」分两层:① **运行中子进程**——靠 §3.2 注入的 signal 让 execa 杀进程树(适配 05/06 §10,含 shim 背后真实 node,事实地基 A);② **兜底清扫**——`runOrchestration` 的 `finally` 调 `killAllChildren`,对任何出口(正常 done / 终止判定 / 异常 / abort)都再扫一遍,确保不留烧 token 的孤儿进程(RT6 第二道兜底,§2.2)。

```ts
/** 对所有 adapter 调 cancel()(适配 05/06:杀进程树,幂等)。任何 run 出口都在 finally 调一次。 */
async function killAllChildren(deps: EngineDeps, reason: string): Promise<void> {
  await Promise.allSettled(
    Object.values(deps.adapters).map((a) => a.cancel()), // 05/06 §3.1 cancel():幂等,无进行中进程则 no-op
  );
  deps.logger.info('all children killed', { reason }); // 脱敏日志(安全 08)
}
```

| abort 到达相位 | 行为 | 子进程处置 |
|---|---|---|
| P1/P2(规划/渲染) | 检查点 `signal.throwIfAborted()` 抛 → 进 catch → `finalize('aborted')` | 无运行子进程,仅 finally 兜底 cancel |
| P3(防火墙) | 同上(纯计算,弃结果) | 同上 |
| **P4(dispatch,关键)** | signal 立即穿透 execa → 杀进程树 → 流以 `{error,'SUBPROCESS_CANCELLED'}` 收尾 → `consume` 返回 → `runTurn` 抛 → finalize | **立即杀**(RT6 实时性) |
| P5(validate)/P6(append) | P6 append 是原子点(§5.2):已开始的 append 跑完(要么整条落要么不落),再 finalize | 无子进程(validate 的 command 复跑收 signal,§3.2) |
| P7(merge/close/stop) | merge 前可断(git 子进程收 signal);已落盘的 round_closed 原子;stopPolicy 是纯计算无 IO | git 子进程被杀 |

> **幂等性**:`linkAbort.abort` 与 `adapter.cancel` 都幂等。重复 abort(面板狂点 / 信号叠加 SIGINT+SIGTERM)只第一次生效,后续 no-op。这保证「点了停但子进程还在烧 token」不可能出现:第一次 abort 已穿透杀树,finally 再兜底,二者皆幂等无副作用。

### 3.5 turn 级墙钟超时(hung 子进程兜底)

abort 解决「外部要求停」,但有一类故障 abort 触发不了:**子进程 spawn 成功、却永不吐 `final_message`、流也不关**(中转挂起、模型死循环、stdout 缓冲死锁)。此时 `consume`(03 §5.3)的 `for-await` 会**无限等**,没有任何 abort 信号到来——RT6「有限时间内终止」落空,真金白银的 token 也可能在子进程侧持续燃烧。修补:每个 turn 套一层墙钟超时,超时即主动 abort 该 turn 的子进程。

```ts
/** 给单个 turn 的 dispatch(P4)套墙钟超时。超时 → abort 子进程 → 计 SUBPROCESS_TIMEOUT。 */
async function runTurnWithTimeout(
  directive: TurnDirective, round: number, deps: EngineDeps, parentSignal: AbortSignal,
): Promise<TurnResult> {
  const turnMs = deps.playbookTimeout(directive);     // playbook.params.turnTimeoutMs,默认 120_000
  // 派生子 controller:parent abort(全树)或本 turn 超时,任一触发都杀这一个子进程
  const turnAc = new AbortController();
  const onParent = () => turnAc.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', onParent, { once: true });
  const timer = setTimeout(() => turnAc.abort('SUBPROCESS_TIMEOUT'), turnMs);
  try {
    return await runTurn(directive, round, withSignal(deps, turnAc.signal));
  } catch (e) {
    if (turnAc.signal.reason === 'SUBPROCESS_TIMEOUT' && !parentSignal.aborted) {
      // 仅本 turn 超时(非全局 abort)→ 非致命:本轮该 agent 失败,可由 playbook 下轮决定降级/换策略
      return { ok: false, directive, code: 'SUBPROCESS_TIMEOUT', fatal: false };
    }
    throw e;                                           // 全局 abort 透传上层(§3.4)
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onParent);
  }
}
```

| 维度 | 规则 | 理由 |
|---|---|---|
| 超时粒度 | **per-turn**(非 per-run),`turnTimeoutMs` 默认 120s,playbook 可覆盖 | run 总时长由轮数 × turn 超时自然封顶;单 turn 超时只杀该 turn 不连坐 |
| 触发动作 | 派生 `turnAc.abort('SUBPROCESS_TIMEOUT')` → §3.4 杀该子进程进程树 | 复用同一杀树路径,无新机制 |
| 致命性 | **非致命**(`fatal:false`):本轮该 agent 失败,run 不炸——hung 可能是偶发中转抖动 | 与熔断(§4.3)分工:偶发超时非致命,连续超时由熔断升级 |
| 与全局 abort 区分 | `turnAc` 派生自 `parentSignal`:全局 abort 仍透传(致命),仅本 turn 超时降级 | 不混淆「用户要停」与「这次卡了」 |
| 计费 | 超时杀进程止损,但已烧的 input token 仍计入累积预算(事实地基 D) | 超时不退费;连续超时会更快撞 token 刹车 |

> 【待实测】`turnTimeoutMs=120s` 是初值。需 M0 跑真实中转(mouubox)的 P99 单回合耗时校准:太短会误杀正常的长推理回合,太长则 hung 检测迟钝。事实地基未覆盖中转回合耗时分布,标【待实测】。超时与熔断协同:连续 `failThreshold` 次 `SUBPROCESS_TIMEOUT` 计入熔断失败计数(§4.3),升级为 `open` 快速失败。

## 4. 错误传播与重试(分类 → 传播 → 退避 → 熔断)

### 4.0 错误分类总览(三层 × 三类)

引擎层不发明错误码——全集在 02 §12 `SyluxErrorCode`。本节给的是**运行时如何对待**每一类:在哪一层被捕获、是否重试、是否致命、最终落什么终态。错误按「捕获层级 × 处置类别」二维归类:

| 处置类别 | 含义 | 重试 | 致命(`TurnResult.fatal`)| 典型错误码(02 §12) |
|---|---|---|---|---|
| **可重试**(retriable) | 输出未成形 / evidence 缺失 / 偶发卡死,同 agent 带反馈或重发可能修好 | 是,≤N(§4.2) | 否(重试耗尽前) | `OUTPUT_SCHEMA_VIOLATION`、`EVIDENCE_REQUIRED`、`EVIDENCE_UNVERIFIABLE`、`MESSAGE_SIZE_EXCEEDED`(02 H4)、`SUBPROCESS_TIMEOUT`(§3.5) |
| **协议违规**(protocol) | 结构合法但违反黑板规则,重发也修不好(agent 行为问题) | 否 | 否(本轮该 agent 失败,run 继续) | `WORKTREE_PATH_VIOLATION`、`DANGLING_REPLY_REF`、`INVALID_*`、`EVIDENCE_COMMAND_UNSAFE`(02 H3:该证据 fail,不连坐本轮) |
| **挂起裁决**(suspend) | 需人工裁决才能继续,**非致命也非正常完成**,转 `paused` 非终态 | 否 | 否(挂起,等控制帧) | `WORKTREE_CONFLICT`(隔离 09,§4.4/§7.2) |
| **致命**(fatal) | 进程级 / 资源级失败,本 run 无法继续 | 否 | 是(硬停 run) | `SUBPROCESS_SPAWN_FAILED`、`PROVIDER_CONFIG_INVALID`、`ENGINE_FATAL` |

> 三类的分界**对齐** 02 §8.4「打回与重试」表:02 定义「错误码 → 引擎动作」,本表定义「同一错误码 → 运行时层级 + 是否致命」。二者发现差异以 02 错误码语义为准。**`StopPolicy` 终止(`ROUND_LIMIT_EXCEEDED`/`CONVERGENCE_STALL`/`TOKEN_BUDGET_EXCEEDED`)不在此表**——它们是「正常终止」走 `finalize` 返回路径(§3.0),不是错误。**`WORKTREE_CONFLICT` 单列「挂起裁决」类**:它转 `paused`(非终态,02 §10.2 可 resume),挂起等人工裁决,**不 `finalize`**;只有人工选择 abort 才转终态(把它归「致命/hard-stop」是 v1 的错)。`SUBPROCESS_TIMEOUT`(§3.5)/`MESSAGE_SIZE_EXCEEDED`(02 H4)是可重试类(超时杀进程后可由 playbook 降级;超大正文回灌「精简」重发)。

### 4.1 错误传播路径(turn → round → run,三级向上)

错误自下而上经三级,每级有明确的「就地处理 or 上抛」决策,绝不静默吞(E7 / 总体规划 §11.3):

```
┌─ turn 级(runTurn,03 §5.2)──────────────────────────────────┐
│ 可重试 → 就地重发≤N(§4.2),不上抛                              │
│ 协议违规 → 落 system 消息 + 返回 {ok:false, fatal:false},不上抛 │
│ 致命 → 返回 {ok:false, fatal:true} 上抛给 round 级               │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─ round 级(runEngine while 体,03 §5.1)─────────────────────┐
│ results.find(r=>!r.ok && r.fatal) 命中 → finalize('aborted')   │
│ 合并冲突 WORKTREE_CONFLICT → system 回灌 + setStatus('paused')  │
│   ↑ 注意:setStatus('paused') 后**挂起循环等控制帧**,NOT       │
│     finalize(paused 非终态);resume/inject→续跑,abort→终态     │
│ 非致命失败 turn(含 SUBPROCESS_TIMEOUT)→ 不入黑板,round 继续关轮 │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─ run 级(runEngine try/catch + runOrchestration finally)──────┐
│ 任意未预期异常 → catch → setStatus('aborted','ENGINE_FATAL')    │
│ 任何出口 → finally:flush jsonl + killAllChildren(§2.2 二道兜底)│
└──────────────────────────────────────────────────────────────┘
```

> **不上抛 ≠ 不记录**:协议违规虽不中断 run,但 turn 级必落一条 `kind:'system'`(`from:'orchestrator'`,02 C7)消息进黑板,并计入红队「无效发言」指标(02 §8.4)。面板因此能看到「这一轮 codex 发言被判协议违规」,而非静默消失(RT7:落盘即广播)。

### 4.2 重试与退避(可重试类:同 agent 带反馈重发)

可重试错误的重发由 `runTurn`(03 §5.2)就地循环承担,上限 `params.retryOnReject`(03,默认 3)。本节给运行时层的退避与反馈回灌细节:

```ts
/** 重发退避:可重试错误在第 attempt 次重发前的等待。指数退避 + 抖动,封顶,响应 signal。 */
async function backoffBeforeRetry(attempt: number, signal: AbortSignal): Promise<void> {
  // attempt 从 1 起:200ms, 400ms, 800ms ...,封顶 5s;±20% 抖动避免与对面 CLI 同步抖动
  const base = Math.min(200 * 2 ** (attempt - 1), 5_000);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  await delay(base + jitter, { signal }); // signal abort → delay 立即 reject,穿透到 §3 取消
}
```

| 维度 | 规则 | 理由 |
|---|---|---|
| 重发上限 | `params.retryOnReject`(默认 3),按 `directive` 取(03 §5.2 `deps.playbookRetry`) | 不同范式可不同;critic 打回可给更多机会 |
| 退避曲线 | 指数 200ms→5s 封顶 + ±20% 抖动 | 中转瞬时限流时避免硬打;抖动防两 CLI 退避共振 |
| 反馈回灌 | 把 `ValidateResult`(02 §8)的 `code+message` 压成 `rejectFeedback`,**过内容防火墙包边界**(安全 08)后拼进下次 prompt(03 §5.2 `withFeedback`) | agent 知道「上次错在哪、怎么补」;过防火墙防回灌文本里夹带注入(RT4) |
| 计费意识 | 每次重发是一次**完整新发言**,吃满 base token(事实地基 D 底价 ≈18.7k);重试计入 token 预算 | 重试不是「免费补正」,3 次重试 ≈ 3×base,刹车 04 累积预算必须含重试开销 |
| 耗尽处置 | `attempt > 上限` → 返回 `{ok:false, code:'OUTPUT_SCHEMA_VIOLATION', fatal:false}`,本轮该 agent 失败但 run 不致命 | 单 agent 一轮失败不该炸全 run;由 playbook 下轮决定是否换策略 |

> **退避与 token 的张力**:退避只挡「中转限流」类瞬时错(网络/429),对「schema 不成形」类内容错退避无意义却仍计费。因此可重试错再细分:`OUTPUT_SCHEMA_VIOLATION`(内容错,**不退避**立即重发,只回灌反馈)vs adapter 上抛的传输层瞬时错(**退避后重发**)。前者是「写错了改」,后者是「线路忙等等」,混用退避会白烧 token 也白等时间。

### 4.3 熔断(provider 级,跨 turn/跨 run 的快速失败)

重试是「同一发言修内容」;熔断是「这个 provider/agent 整体不可用,别再浪费 base token 试」。两者正交:重试在 turn 内,熔断跨 turn。熔断器挂在 **adapter 维度**(每 agent 一个,因 provider 配置每 agent 一份,锁定决策 §4),状态机三态:

```ts
/** 每 agent 一个熔断器。连续致命/spawn 失败累计 → open,快速失败省 token。 */
export interface CircuitBreaker {
  /** 发言前问:是否允许打这个 agent。open 态直接拒,不 spawn(省 base token)。 */
  canDispatch(): boolean;
  /** 一次发言结果回喂:成功清零;spawn/provider 类失败累加。 */
  record(outcome: 'ok' | 'spawn_failed' | 'provider_invalid'): void;
  readonly state: 'closed' | 'open' | 'half-open';
}
```

| 状态 | 含义 | 进入条件 | 行为 |
|---|---|---|---|
| `closed` | 正常 | 初始 / `half-open` 成功一次 | 放行所有发言 |
| `open` | 熔断 | 连续 `failThreshold`(默认 3)次 spawn/provider 失败 | `canDispatch()=false`;`runTurn` 直接得致命 `SUBPROCESS_SPAWN_FAILED`,**不 spawn**(省 base token) |
| `half-open` | 试探 | `open` 后冷却 `cooldownMs`(默认 30s) | 放行**一次**试探发言;成功→`closed`,失败→回 `open` 重新冷却 |

熔断触发后的引擎处置:`runTurn` 在 dispatch 前查 `canDispatch()`,`open` 态直接返回 `{ok:false, fatal:true, code:'SUBPROCESS_SPAWN_FAILED'}` → round 级捕获致命 → `finalize('aborted')`。**致命熔断硬停整个 run**——因为两 CLI 缺一不可,一个 provider 持续挂掉,继续跑只会单边烧 token(事实地基 D),不如快停让用户换 provider(锁定决策 §4 热换)。

> 【待实测】`failThreshold=3` / `cooldownMs=30s` 是初值,需 M0 跑真实中转(mouubox)限流曲线后校准:中转 429 的恢复窗口、连续失败的典型间隔,决定阈值与冷却。事实地基未覆盖中转限流时序,此处标【待实测】。

### 4.4 错误码 → 终态 → 持久化 的完整映射(总表)

把 §4.0–§4.3 压成一张「错误码 → 引擎动作 → 终态 → jsonl 落什么」的权威总表(对接 02 §8.4 + §10.2 终态 + §7 jsonl):

| 错误码(02 §12) | 层级 | 动作 | run 终态 | jsonl 记录(02 §7.1) |
|---|---|---|---|---|
| `OUTPUT_SCHEMA_VIOLATION` | turn | 立即重发≤N(不退避),耗尽则本轮该 agent 失败 | 不变(run 继续)/ 极端全失败→`aborted` | 失败仅 `system` 行;成功才 `message` 行 |
| `EVIDENCE_REQUIRED`/`UNVERIFIABLE` | turn | 回灌「补可核验 evidence」重发≤N | 不变 | 同上 |
| `MESSAGE_SIZE_EXCEEDED`(H4) | turn | 回灌「精简正文/拆 evidence,超 256KiB」重发≤N,耗尽则本轮该 agent 失败 | 不变 | 失败仅 `system` 行 |
| `SUBPROCESS_TIMEOUT`(§3.5) | turn | 超时杀子进程(§3.5),本轮该 agent 失败;连续超时计入熔断(§4.3) | 不变 / 熔断 open 后致命→`aborted` | `system` 行 |
| `EVIDENCE_COMMAND_UNSAFE`(H3) | turn | 该 command 证据判 fail(不计强),落 system 计无效发言;**不连坐本轮**其余证据(02 §8.4) | 不变 | `message`(system) |
| `WORKTREE_PATH_VIOLATION`/`DANGLING_REPLY_REF`/`INVALID_*` | turn | 不重试,落 system,计无效发言 | 不变 | `message`(system) |
| `SUBPROCESS_SPAWN_FAILED` | turn→run | 首轮致命;熔断 open 后直接致命 | `aborted` | `system` + `status_changed(aborted)` |
| `PROVIDER_CONFIG_INVALID` | adapter | 启动前预扫描即抛(key 入 argv,安全 08) | `aborted`(never start) | `status_changed(aborted)` |
| `WORKTREE_CONFLICT` | round | 不静默重试,system 回灌冲突 evidence,`setStatus('paused')` **挂起等裁决,NOT finalize** | **`paused`(非终态,可 resume/inject 续跑;人工 abort 才转 `aborted`)** | `message`(system)+`status_changed(paused)` |
| `ROUND_LIMIT_EXCEEDED`/`TOKEN_BUDGET_EXCEEDED` | stopPolicy(P7 轮末) | 正常终止(非错误),走 finalize | `limit` | `status_changed(limit)` |
| `CONVERGENCE_STALL` | stopPolicy(P7 轮末) | 正常终止,走 finalize | `stalled` | `status_changed(stalled)` |
| (无错误码)人工 abort | signal | 全树取消(§3) | `aborted` | `status_changed(aborted, reason)` |
| `ENGINE_FATAL` | run catch | 未预期异常兜底 | `aborted` | `status_changed(aborted,'ENGINE_FATAL')` |

> 不变量复核:**除 `WORKTREE_CONFLICT` 的 `paused` 是非终态挂起外,其余每行终态都经 `finalize` 落一条 `status_changed`(03 §5.1)**;`paused` 不走 finalize(它要能 resume)——但 `runOrchestration` 进入挂起前已 flush jsonl,且子进程已无运行中 turn(冲突发生在轮末 merge,P4 早已结束),不存在烧 token 的子进程。`runOrchestration.finally` 仅在真正退出(resume 后跑完 / abort)时兜底 flush + killAllChildren(§2.2)。不存在「run 停了但 jsonl 没记录」或「停了但子进程还活着」的状态(RT5/RT6)。**`SUBPROCESS_TIMEOUT`/`MESSAGE_SIZE_EXCEEDED`/`EVIDENCE_COMMAND_UNSAFE` 三码若 02 §12 未列须回填**(均向后兼容新增;`SUBPROCESS_TIMEOUT` 为本文件 §3.5 新增,02 §12 现无此码,见 §7.1 回填项)。

## 5. 状态持久化(jsonl 为主 + 可选 sqlite 索引)

### 5.0 持久化模型总览(单写者 append-only,sqlite 仅只读投影)

持久化遵守两条焊死的不变量:**RT5 单写者**(每 run 的 jsonl 只有 engine 单线程 append)+ **02 §10.3 单一事实源**(`BoardState` 不独立落盘,由 jsonl 行日志顺序回放投影得出)。据此分层:

| 层 | 角色 | 写 | 读 | 权威性 |
|---|---|---|---|---|
| **jsonl 行日志**(`runs/<runId>.jsonl`) | 唯一权威源 | engine 单写者 append-only(02 §7) | 回放重建 BoardState / 崩溃恢复 | ★权威 |
| **sqlite 索引**(可选,`runs/index.sqlite`) | 只读投影 / 跨 run 检索加速 | 从 jsonl 异步派生(可重建) | 面板列表、按 run 检索、跨 run 统计 | 派生(可丢可重建) |
| **内存 BoardState** | 运行期快照 | engine 投影维护 | playbook BoardView / WS snapshot | 派生 |

> 核心立场:**sqlite 是缓存不是真相**。删掉 `index.sqlite` 必须能从全部 `*.jsonl` 完整重建,且重建结果与原索引逐字节一致。任何「只在 sqlite 里、jsonl 没有」的状态都是 bug(违反单一事实源)。这把「双写漂移」从设计上根除:写永远只写 jsonl,sqlite 是 jsonl 的纯函数。

### 5.1 RunStore 接口(jsonl 单写者 + 可选 sqlite 投影)

`RunStore` 是持久化的唯一出口。它是 `runOrchestration` 注入 `EngineDeps` 的运行时依赖(§2.2 用 `deps.runStore.flush()`;03 的 `EngineDeps` 不列它,因为 03 是范式无关本体,持久化是运行时切面——由 01 在 `withSignal` 同层补进 deps)。`Blackboard.append/closeRound/setStatus/recordSession`(03 §4.2)内部都委托 `RunStore.append*` 落盘:

```ts
/** 持久化唯一出口。单写者(RT5):一个 run 只有 engine 串行调用,无并发 append。 */
export interface RunStore {
  /** 开 run:写首行 run_started(02 §7.1),建 jsonl 文件 + 可选 sqlite 行。 */
  open(runId: string, playbookId: string): Promise<void>;
  /** 追加一条记录(message/round_closed/status_changed/agent_session,02 §7.1)。
   *  内部:encodeJsonlLine(02 §7.2)→ fs.appendFile → (可选)投影进 sqlite。 */
  append(rec: JsonlRecord): Promise<void>;
  /** 强制 flush 到磁盘(fsync 语义)。run 任何出口都调(§2.2 finally),保末行落盘。 */
  flush(): Promise<void>;
  /** 关 run:flush + 关文件句柄 + 关 sqlite。幂等。 */
  close(): Promise<void>;
  /** 回放:顺序读 jsonl,decodeJsonlLine(02 §7.2)→ 投影重建 BoardState(§5.4)。 */
  replay(runId: string): Promise<BoardState>;
}
```

> `append` 的入参是 02 §7.1 的 `JsonlRecord`(discriminatedUnion),不是裸 `Message`——这样轮边界、状态变更、会话句柄都进同一份 append-only 流,单文件即可重建完整态(02 §7.3)。`Blackboard.append(AppendInput)` 先盖章成 `Message`、包成 `{recordType:'message', message}` 再交 `RunStore.append`。

### 5.2 写序与崩溃一致性(焊死 RT5/RT7/RT9/RT10)

`Blackboard.append` 的内部写序是**崩溃一致性的核心**,必须固定为「**盖 seq+落盘 → 入队广播投递 → 累加指纹**」三步同步、不可乱序、不可只做其一(RT7,01 §2.1 P6 焊死点):

```ts
/** Blackboard.append 内部写序。三步顺序焊死(RT7);seq 盖章(RT9);广播非阻塞(RT10);指纹只累加不喂刹车(RT11)。 */
async function appendImpl(
  input: AppendInput, store: RunStore, hub: WsHub, roundAccum: RoundFingerprintAccumulator,
): Promise<Message> {
  // ① 盖派生字段:id(nanoid)/seq(单调+1,RT9 排序权威)/ts(墙钟旁注)/from/role 来自 input。
  //    round 由引擎在 input 给(非此处盖,03 AppendInput);schemaVersion **不盖在内存态 message**
  //    (02 I4:只在 jsonl 行)。agent 自填的派生字段一律覆盖(02 I7)。
  const msg = stamp(input, /* seq */ nextSeq());  // 纯内存
  // ② 先落盘(权威)。jsonl 行才带 schemaVersion(02 §7.1)。
  await store.append({ recordType: 'message', schemaVersion: SCHEMA_VERSION, message: msg });
  // ③ 落盘成功后入队广播——非阻塞投递(RT10):写每订阅者有界队列,绝不 await 网络。
  hub.broadcast({ kind: 'message', message: msg });
  // ④ 把该条 evidence 指纹累加进**当前轮内存指纹集**(RT11:非喂刹车!刹车轮末读 Round.evidenceFingerprints)。
  //    强 file_ref 的 contentHash 已在 P5 核验阶段回填(02 §8.3),此处指纹稳定;weak 留 '?' 占位(02 §9.3)。
  roundAccum.add(fingerprintSet(msg.evidence));
  return msg;
}
```

> **指纹通路(吃掉 v1 旧措辞)**:v1 此处曾写 `brakes.feedEvidence(...)`,暗示刹车有逐条喂料接口——**错**。04 §2.1 焊死「指纹入黑板时算一次、缓存进 `Round.evidenceFingerprints`,刹车 N 轮零成本读缓存」。正确通路:`append` 把指纹累加进 `RoundFingerprintAccumulator`(当前轮内存)→ `closeRound` 把累加器封存为 `Round.evidenceFingerprints`(02 §10.1,落 `round_closed` 行)→ 04 的 `ConvergencePolicy` 在 P7 轮末 `shouldStop` 读 `board.rounds[k].evidenceFingerprints` 做差集(04 §2.1/§3)。`StopPolicy` **没有** `feedEvidence`/`checkAfter` 这类逐条接口(RT11),本文件不再杜撰。

| 顺序保证 | 崩溃在此处的后果 | 恢复行为 |
|---|---|---|
| ①盖 seq **先于** 一切 | seq 是 append 串行单调 +1(RT9/02 I8),无并发洞 | 回放按 seq 重排,顺序确定(并行同轮 ts 相等也不乱) |
| ②落盘 **先于** ③广播 | 落盘后、广播前崩 → jsonl 有、面板没见到 | 回放时面板补齐;不丢数据(可接受) |
| ③广播 **后于** ②落盘 | 不可能「广播了但没落盘」 | RT7:面板任何一条 message 必在 jsonl 里 |
| ③广播 **非阻塞** | 慢 WS 客户端不阻塞 append(RT10) | 客户端缓冲满被驱逐,重连拉 snapshot,引擎不停 |
| ②落盘是**原子行** | append 写一半崩(残行) | 回放 §5.4 丢弃末残行,前完整行权威(02 §7.3) |
| ④指纹累加是**内存** | 累加后崩(未 closeRound)→ 该轮指纹未落盘 | 回放重算:从该轮已落盘 message 行的 evidence 重建累加器(确定性,与 04 §3 `reset` 一致) |

> **单写者保证无锁**:RT5 下一个 run 的 jsonl 只有 engine 协程串行 append(parallel 范式的两 turn 也是**汇合后**由 engine 串行 append,03 §5.1 的 `for (results) append`,不是两 turn 各自并发写)。因此 `fs.appendFile` 无需文件锁;`O_APPEND` 语义 + 单写者 = 行不交错。flush 用 `fileHandle.sync()`(fsync)保证 OS 缓冲落盘,在每轮 `closeRound` 后与 run 出口 `finally`(§2.2)各调一次,平衡持久性与 IO 开销(不必每条 message 都 fsync)。

### 5.3 sqlite 可选索引(只读投影,加速面板与跨 run 检索)

sqlite **不存权威数据**,只存「为了不全量扫 jsonl 而预计算的索引」。它解决两个 jsonl 不擅长的查询:① 面板「列出所有 run + 状态 + 起止时间」(否则要开每个 jsonl 读首尾行);② 跨 run 统计(token 总量、按 playbook 聚合)。表结构是 jsonl 的纯投影:

```sql
-- runs:每 run 一行,投影自 run_started + 末 status_changed + 累计 usage(可全量重建)
CREATE TABLE runs (
  run_id        TEXT PRIMARY KEY,
  playbook_id   TEXT NOT NULL,
  status        TEXT NOT NULL,          -- 02 §10.2 RunStatus 末态
  rounds        INTEGER NOT NULL DEFAULT 0,
  total_input   INTEGER NOT NULL DEFAULT 0,   -- 事实地基 D:累积 token
  total_output  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  jsonl_path    TEXT NOT NULL,          -- 指回权威源
  schema_version INTEGER NOT NULL
);
-- messages:轻索引,只存定位字段,正文仍回 jsonl 取(避免双份正文漂移)
CREATE TABLE messages (
  run_id    TEXT NOT NULL,
  msg_id    TEXT NOT NULL,
  round     INTEGER NOT NULL,
  from_agent TEXT NOT NULL,
  role      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,         -- 该 message 行在 jsonl 的字节偏移,正文按需 seek 读
  PRIMARY KEY (run_id, msg_id)
);
CREATE INDEX idx_messages_run_round ON messages(run_id, round);
CREATE INDEX idx_runs_status ON runs(status);
```

| 设计点 | 决定 | 理由 |
|---|---|---|
| 正文存哪 | **只存 jsonl**,sqlite 存 `byte_offset` 回指 | 杜绝「正文两份」漂移;sqlite 删了能重建 |
| 写时机 | jsonl append **成功后**异步投影(可批、可滞后) | 不阻塞单写者主路径;sqlite 落后于 jsonl 可容忍(它是缓存) |
| 写失败处置 | sqlite 投影失败仅告警,**不回滚 jsonl、不中断 run** | jsonl 是权威;索引坏了重建即可,不能让缓存故障拖垮 run |
| 重建命令 | `sylux reindex` 扫所有 `*.jsonl` 重建整库 | 单一事实源的兜底:索引随时可丢可重建 |
| 是否必需 | **可选**:无 sqlite 时面板退化为「扫 jsonl 首尾行列 run」 | 小规模本地够用;sqlite 是规模化加速,非正确性依赖 |

> **一致性边界**:sqlite 可能短暂落后于 jsonl(异步投影窗口)。面板拉 run 列表走 sqlite(快、可容忍秒级滞后),但拉**单 run 详情/回放**直接走 jsonl(`RunStore.replay`,权威、实时)。两条读路径分工:列表求快(sqlite),详情求准(jsonl)。

### 5.4 崩溃恢复与回放(jsonl 顺序投影,接 02 §7.3)

回放是「把 append-only 行日志顺序折叠成 `BoardState`」的纯函数,接 02 §7.3 的重建规则,本节给运行时实现骨架与崩溃恢复的具体处置:

```ts
/** 顺序回放 jsonl → BoardState(02 §7.3 投影规则)。末残行容错(02 §7.3 截断恢复)。 */
export async function replay(runId: string, path: string): Promise<BoardState> {
  let state = emptyBoardState(runId);             // 待 run_started 填壳
  let lineNo = 0;
  for await (const line of readLines(path)) {     // 流式逐行,不全量入内存(大 run 友好)
    lineNo++;
    const r = decodeJsonlLine(line);              // 02 §7.2:JSON.parse → migrate → safeParse
    if (!r.ok) {
      if (await isLastLine(path, lineNo)) break;  // 末行残缺(写一半崩)→ 丢弃,前态权威(02 §7.3)
      throw new SyluxError('OUTPUT_SCHEMA_VIOLATION', `jsonl 中间行损坏 @${lineNo}: ${r.error}`);
    }
    state = foldRecord(state, r.record);          // 按 recordType 折叠(下表)
  }
  return boardStateSchema.parse(sortBySeq(state)); // 投影后按 seq 重排 messages(RT9),再过 schema 自检(02 §10.2)
}
```

> **RT9 回放排序**:jsonl 行**物理顺序 == append 顺序 == seq 升序**(单写者 RT5 + seq 单调 RT9/02 I8),所以正常回放 `foldRecord` 顺序即 seq 序。但为防御「外部工具重排过行 / 手工编辑」,投影末尾对 `messages` 和每个 `Round.messageIds` 按 `seq` 显式重排(`sortBySeq`),**绝不用 `ts` 排序**(并行同轮 ms 相等,02 I6)。`round_closed` 的 `evidenceFingerprints` 在崩溃未落盘时由该轮已落盘 message 的 evidence 重算(§5.2 ④ 注,与 04 §3 `reset` 一致)。

`foldRecord` 按 02 §7.1 的五种 `recordType` 折叠(对齐 02 §7.3 重建规则):

| recordType | 折叠动作 | 对应 BoardState 字段 |
|---|---|---|
| `run_started` | 建壳:`runId/playbookId/createdAt/status='running'` | 顶层元信息 |
| `message` | push 进 `messages`,按 `round` 归桶,**桶内按 `seq` 升序**(RT9) | `messages` |
| `round_closed` | 填 `rounds[index]`(指纹集合 + usage),`currentRound++` | `rounds` / `currentRound` |
| `agent_session` | 填 `agents[agent].sessionId` + `resumable=true`(RT8) | `agents` |
| `status_changed` | 末态覆盖 `status` + `updatedAt` | `status` |

| 崩溃场景 | 检测 | 恢复 |
|---|---|---|
| 末行写一半(残行) | `decodeJsonlLine` 末行 `ok:false` | 丢弃末残行,前完整行即权威态(02 §7.3) |
| 中间行损坏 | 非末行 `decodeJsonlLine` 失败 | **抛错**(不静默跳过):中间损坏意味文件被外部破坏,需人工介入 |
| 无终态 `status_changed` | 回放完末态仍 `running` | run 是崩溃中断的:标记为可恢复,面板提示「上次异常退出」;不自动续跑(需人工确认 resume,RT8 sessionId 已在 `agent_session` 行) |
| sqlite 与 jsonl 不一致 | reindex 校验 | 以 jsonl 重建覆盖 sqlite(jsonl 永远赢,§5.0) |

> **恢复后能否续跑**:回放重建出 `agents[].sessionId/resumable`(02 §7.1 `agent_session` 行),理论上可 `adapter.resume` 续接。但事实地基 D(resume 累积计费)+ 事实地基 A(子进程已死,需重新 spawn 再 resume)意味着「续跑」要重 spawn + 重灌历史,成本可能不低于重开。**默认不自动续跑**:回放仅用于面板回看 / 审计;是否 resume 由用户在面板显式触发(RT8:拿到 sessionId 才允许 resume)。【待实测】崩溃后 `codex exec resume <SESSION_ID>` 能否跨进程重连旧 thread(事实地基 E 给了 resume 参数集,但未实测「进程已死后用旧 SESSION_ID resume」是否成功),M0 需验证。

### 5.5 WsHub 非阻塞广播(焊死 RT10,A4)

RT10 的实现核心:`broadcast` 永远不 `await` 网络,改为「写每订阅者的有界环形缓冲 + 独立 flush 协程」。引擎 P6 调 `broadcast` 是纯内存入队,O(订阅者数),与最慢的客户端 socket 完全解耦。

```ts
interface Subscriber {
  socket: WsSocket;
  buf: BroadcastEvent[];          // 有界缓冲(默认 cap=1024 帧)
  cap: number;
  flushing: boolean;              // 是否有 flush 协程在跑
}

/** 引擎调用:纯内存入队,绝不阻塞。慢客户端缓冲满即驱逐。 */
function broadcast(subs: Subscriber[], ev: BroadcastEvent): void {
  for (const s of subs) {
    if (s.buf.length >= s.cap) {
      // 慢消费者:丢弃其缓冲,发 resync 让它重连拉 snapshot(WS 11),不拖累引擎与其他客户端
      evict(s, 'SLOW_CONSUMER_RESYNC');   // 关闭 socket,客户端按 WS 11 重连 → REST snapshot 补齐
      continue;
    }
    s.buf.push(ev);
    if (!s.flushing) void startFlush(s);  // 独立异步 flush,失败/慢只影响这一个 s
  }
}
```

| 决策 | 取值 | 理由 |
|---|---|---|
| 缓冲上界 | 每订阅者默认 1024 帧(config 16 可调) | 够吸收正常网络抖动;满了说明客户端真慢,驱逐比拖垮 run 划算 |
| 满缓冲处置 | **驱逐 + resync**(关连接,客户端重连拉 snapshot) | RT7 保证 jsonl 是权威,客户端重连能从 snapshot+增量完整恢复,不丢数据 |
| flush 失败 | 仅标记该订阅者断开,不影响引擎/其他订阅者 | 故障隔离:一个浏览器崩了不连坐 run |
| 与持久化关系 | 广播是 jsonl 的**只读投影**(RT5),驱逐任何订阅者都不影响权威源 | 面板是观察者,不是事实源 |

> **为什么这条是硬需求**:没有 RT10,一个挂起的浏览器标签页(socket 缓冲填满、TCP 窗口归零)就能让 `hub.broadcast` 的 `await socket.send()` 永久阻塞 → P6 阻塞 → 整个 run 卡死、两路 CLI 的 base token 白烧(事实地基 D)。把广播降级为「尽力投递 + 慢者驱逐」,引擎的命脉(append→落盘)与面板的死活彻底解耦。

### 5.6 jsonl 体积与留存(ops 护栏)

单 run jsonl 可观增长:主从范式 40 轮、每轮多条 message、每条最大 256KiB(02 H4/C10),理论上界达数十 MB;长期跑会堆积大量 run 文件。jsonl 是权威源(RT5)不能随意截断,但要给运行可观测与留存策略,避免磁盘失控。

| 维度 | 策略 | 说明 |
|---|---|---|
| 单 run 体积告警 | 超 `RUN_JSONL_WARN_BYTES`(默认 64MiB)→ 面板/日志告警(不中断) | 提示该 run 异常啰嗦(可能 agent 刷屏 / 注入),供人工介入;真护栏是 02 C10 单条上限 + 04 token 刹车 |
| 单 run 体积硬顶 | 超 `RUN_JSONL_MAX_BYTES`(默认 256MiB,config 16 可调)→ 落 `system` 告警 + `setStatus('limit','RUN_SIZE_EXCEEDED')` 正常终止 | 末道护栏:防单 run 写爆磁盘;走 limit 终态(非错误),与 token 刹车同语义 |
| 大 run 回放 | `replay` 已是**流式逐行**(§5.4 `for await readLines`),不全量入内存 | 数十 MB 文件回放内存恒定;面板按需分页(面板 10) |
| 历史留存 | run 完成后保留 N 天(默认 30,config 16),过期归档/清理由外部任务,**中枢不自动删**(审计安全) | sqlite 索引留 run 元信息;jsonl 可冷归档(gzip,压缩比高,行日志友好) |
| 删除安全 | 删 jsonl 是不可逆操作 → 需显式运维动作(`sylux prune --before <date>`),不在运行期自动触发 | 对齐安全边界:权威审计源不被进程自动销毁 |

> 体积硬顶 `RUN_SIZE_EXCEEDED` 是否需在 02 §12 加错误码:它走 `limit` 终态,可复用现有 `TOKEN_BUDGET_EXCEEDED` 的「正常终止」路径,新增一个 reason 字符串即可,**不必新增错误码**(reason 是自由串,02 `status_changed.reason`)。此为本文件 ops 补充,回填总体规划 §10 持久化节。


## 6. 进程生命周期与 graceful shutdown

### 6.1 中枢进程生命周期(启动 → 运行 → 退出)

中枢是单个 Node 进程,内部跑 WsHub + RestApi + 0..N 个并发 run 的 `runOrchestration` 协程。生命周期三阶段:

```
启动                            运行                              退出
 │                               │                                │
 ├─ M0 解析两 CLI 真实 exe 路径   ├─ RestApi: POST /runs 起 run    ├─ SIGINT/SIGTERM 捕获
 │  (事实地基 A,不依赖 PATH shim)│  → runOrchestration(协程)      │  → 全 run root.abort('SHUTDOWN')
 ├─ 校验 provider 配置(07)       ├─ WsHub: 广播增量 / 收控制帧     │  → 等所有 run finalize(有超时)
 │  (预扫描 key 入 argv,安全 08) ├─ 多 run 各自独立 AbortController│  → flush 全部 RunStore
 ├─ 绑 127.0.0.1 WS(Origin 白名单)│  (互不影响,§6.3)              │  → killAllChildren 兜底
 └─ 就绪                          └─ jsonl 单写者各写各 run 文件     └─ 进程 exit(0)
```

### 6.2 graceful shutdown 序列(SIGINT/SIGTERM)

中枢收到进程信号时,**不能硬 kill**——否则子进程变孤儿继续烧 token(事实地基 D),且 jsonl 末行可能残缺。必须走有序关闭:

```ts
/** 中枢顶层信号处理:有序关闭,绝不留孤儿子进程(RT6 进程级)。 */
function installShutdownHandler(runs: Map<string, LinkedAbort>, stores: RunStore[]): void {
  let shuttingDown = false;
  const onSignal = async (sig: string) => {
    if (shuttingDown) return; // 幂等:第二次信号不重入(避免半关状态被打断)
    shuttingDown = true;
    logger.info('graceful shutdown', { sig });
    // ① 通知所有 run 取消(经各自 root,§3.1)→ 各 runOrchestration finally 杀子进程 + flush
    for (const r of runs.values()) r.abort(`SHUTDOWN:${sig}`);
    // ② 限时等所有 run 走完 finalize(§2.2);超时则强制进 ③
    await Promise.race([allRunsSettled(runs), delay(SHUTDOWN_GRACE_MS)]); // 默认 10s 宽限
    // ③ 兜底:仍存活的子进程强杀(进程树),flush 所有 store
    await killAllOrphans();
    await Promise.allSettled(stores.map((s) => s.close()));
    process.exit(0);
  };
  process.once('SIGINT', () => void onSignal('SIGINT'));
  process.once('SIGTERM', () => void onSignal('SIGTERM'));
}
```

| 阶段 | 动作 | 超时/兜底 |
|---|---|---|
| ① 取消 | 每个 run `root.abort('SHUTDOWN')` → §3 全树取消穿透到子进程 | abort 幂等,立即生效 |
| ② 等收尾 | 等所有 `runOrchestration` 的 finally 跑完(杀子进程 + flush) | `SHUTDOWN_GRACE_MS`(默认 10s)封顶 |
| ③ 强杀兜底 | 宽限超时后强杀残留进程树 + close 所有 store | 防卡死;事实地基 A:杀 shim 背后真实 exe |

> **Windows 注意**(事实地基 A):子进程是 `codex.exe` 真实进程 / `claude` shim 背后的 node。SIGTERM 在 Windows 语义弱,实际靠 execa 的 `signal` + `tree-kill`(适配 05/06 §10 的 `cancel()`)杀进程树。`SHUTDOWN_GRACE_MS` 给子进程一个「正常退出落最后一条」的窗口,超时才强杀——平衡「不丢数据」与「不卡死」。
>
> **paused run 的关闭(衔接 §7.2)**:处于 `paused` 挂起(等人工裁决 WORKTREE_CONFLICT,§7.2)的 run 没有运行中子进程,但其循环阻塞在 `controlQueue.next(signal)`。shutdown 的 `root.abort('SHUTDOWN')` 通过同一 signal 唤醒挂起的 `next()`(§2.3 `next(signal)` 收到 abort 即 reject)→ run 走 `finalize('aborted','SHUTDOWN')` 正常落终态。因此 paused run 不会卡住 shutdown 的 grace 窗口——它本就无子进程要杀,abort 一到立即收尾。

### 6.3 多 run 隔离(故障域)

中枢可并发多个 run(不同 playbook / 不同任务)。隔离不变量:

- **取消隔离**:每 run 一个独立 `LinkedAbort` 根(§3.1),A run abort 不影响 B run。
- **持久化隔离**:每 run 一份 `runs/<runId>.jsonl`,单写者各写各的(RT5),互不竞争。
- **worktree 隔离**:每 run × 每 agent 一个 worktree(RT1/RT2,隔离 09),物理隔离无共享。
- **故障隔离**:A run 的 `ENGINE_FATAL` 只 `finalize` A,B run 继续;中枢进程本身不退出(除非进程级信号,§6.2)。
- **资源上限**:并发 run 数受配置上限(默认建议低,因每 run 烧两路 base token,事实地基 D);超限 RestApi 拒新 run 而非排队挤爆。

### 6.4 子进程环境构造(buildChildEnv 单一出口,R8)

拓扑图标注「spawn 时 env 白名单 + `extendEnv:false`」——这条安全约束的运行时落点在此明确(算法细节归安全 08 / 适配 05/06,本节定运行时不变量)。每个子进程的环境**只能**经 `buildChildEnv` 这唯一出口构造,杜绝把中枢自身环境(可能含其他 provider 的 key、用户敏感变量)整体泄漏给 CLI 子进程:

| 约束 | 规则 | 防的是什么 |
|---|---|---|
| 单一出口 | 所有 `adapter.send/resume` 的 spawn env 必经 `buildChildEnv({ agentId, providerEnv })`(单对象签名,安全 08 §2.2 权威),不允许任何 spawn 直接传 `process.env` | 防散落的 spawn 点各自拼 env 漏掉脱敏 |
| `extendEnv:false` | execa 不自动继承父进程 env,只用白名单显式注入 | 防中枢全量 env(含无关 key)泄漏给 CLI |
| env 白名单 | 只透传必需变量(`PATH`/`HOME`/平台必需 + 该 agent provider 的 `base_url`/`model`/`wire_api`) | 最小权限 |
| key 不进 argv/`-c` | provider key 经 env(或 codex `auth.json`)注入,**永不进命令行参数**;spawn 前预扫描 argv 命中 `sk-`/base64 即抛 `PROVIDER_CONFIG_INVALID`(§4.4) | 防 key 出现在进程列表 / 日志 / 崩溃栈(R8/事实地基) |
| 每 agent 一份 | env 按 agentId 隔离(provider 配置每 agent 一份,锁定决策 §4) | 防 A agent 的 key 漏给 B agent 子进程 |

> 运行时不变量补充(并入 RT 族精神,实现归安全 08 / 适配 05/06):**任何 spawn 的 env 必出自 `buildChildEnv`,且 `extendEnv:false`**。这条与 RT2(两 CLI 永不直连)同级——前者断「横向 key 泄漏」,后者断「横向通信」。CI 应加 lint:grep 任何 `execa(`/`spawn(` 调用,其 env 来源非 `buildChildEnv` 即报警。

---

## 7. 收尾:本文件的运行时契约声明

### 7.1 运行时契约总声明

1. **运行时不变量 RT1–RT11(§0.3)是本文件的硬交付**:中枢不碰目标文件、两 CLI 永不直连、未校验不入引擎、未过防火墙不进对面、单写者持久化、取消可达、append 即广播、sessionId 前不可 resume、**排序权威是 seq 不是 ts(RT9)**、**广播不阻塞引擎(RT10)**、**终止判定统一在轮末、无前置刹车(RT11)**。任何实现违反即 bug。
2. **类型引用而非另写(R1)**:`Message`/`Evidence`/`AgentEvent`/`Round`/`BoardState`/`JsonlRecord` 等一律引黑板协议(02)`@sylux/shared/src/blackboard.schema.ts`;`Playbook`/`PromptContext`/`TurnDirective`/`RoundPlan`/`BoardView`/`EngineDeps` 引引擎 03;`StopPolicy`/`CompositeStopPolicy`/`DonePolicy` 引刹车 04。本文件零另写 zod/接口。**特别是 `seq`/`schemaVersion` 的语义严格按 02 I4/I6/H5**:`seq` 中枢盖、内存态 message 不带 `schemaVersion`。
3. **循环本体归 03、终止判定归 04、运行时切面归 01**:`runEngine`/`runTurn`/`consume`/`finalize`/`Playbook`/`EngineDeps`/`Blackboard`/`BoardView` 的接口与范式语义在 03,`StopPolicy.update/shouldStop` 在 04;本文件只投影出「广播触点 + 持久化写序 + AbortSignal 注入点 + 失败出口」四件运行时事(§2.0)。二者循环行为**一致**,差异以 03/04 接口签名 + 01 运行时不变量为准并互相回填(**不再用「逐字节兼容」**这种无法机器核验的措辞,吃掉 D1)。
4. **需回填/协调项**(本文件相对 03/04/02/总体规划的运行时补充):
   - `EngineDeps` 增 `runStore: RunStore`(§5.1):03 的 `EngineDeps` 不列持久化(范式无关),由 01 的 `withSignal` 同层注入。建议 03 §4.3 加一行注释指明「持久化依赖由运行时层 01 §5.1 注入」。
   - `Blackboard.append` 写序焊死「盖 seq+落盘→入队广播→累加指纹」(§5.2):建议 03 §4.2 `append` 注释引本节为实现约束。**v1「喂刹车 `feedEvidence`」措辞作废**:`StopPolicy` 无 `feedEvidence`/`checkAfter` 逐条接口(RT11),指纹经 `RoundFingerprintAccumulator`→`closeRound`→`Round.evidenceFingerprints`→04 `ConvergencePolicy.shouldStop` 单向流(对齐 04 §2.1)。
   - **`WORKTREE_CONFLICT` → `finalize('paused')` 是 03 §5.1 现存 bug**:03 §5.1 第 4 步对冲突调 `setStatus('paused')` 后又 `return finalize(...,'paused',...)`,而 02 §10.2 状态矩阵里 `paused` 非终态、`finalize` 冻结它。**回填 03 §5.1**:冲突处改为「`setStatus('paused')` + 进 §7.2 挂起循环」,不 `return finalize`。否则人工裁决后无法 resume,这是真 bug 不是措辞问题。
   - `CircuitBreaker`(§4.3)、`turnTimeoutMs`/`SUBPROCESS_TIMEOUT`(§3.5)是 01 新增的运行时机制;适配层 05/06 实现 `canDispatch` 前置检查与 dispatch 超时 `cancel()` 杀进程。
   - **编号统一(C-NUM)**:本文件已全面采用文件名编号(刹车 04 / 适配 05·06 / provider 07 / 安全 08 / 隔离 09 / 面板 10 / WS 11),与 03v2 §0 一致。**回填**:全仓仍按旧逻辑编号(刹车 07 / 安全 09 / 面板 08)的稿件需统一,详见 §7.3 openQuestions。
5. **错误码协调(02 §12)**:本文件只定义「同一错误码在运行时的层级/重试/致命/终态/jsonl」处置(§4),原则上不新增。但 `SUBPROCESS_TIMEOUT`(§3.5,02 §12 现无)需回填 02(向后兼容新增 union 成员);`MESSAGE_SIZE_EXCEEDED`/`EVIDENCE_COMMAND_UNSAFE` 已在 02 v2 §12,本文件只补运行时处置;`EMPTY_ROUND_PLAN`/`ENGINE_FATAL`/`SUBPROCESS_CRASHED`/`SUBPROCESS_CANCELLED` 若 02 §12 未列同样回填(对接交叉 A1/COV-1 错误码补全 blocker)。体积硬顶用 `limit` 终态 + reason 串,不新增码(§5.6)。
6. **【待实测】清单**(事实地基未覆盖,M0 验证):熔断阈值/冷却初值(§4.3)、`turnTimeoutMs=120s` 是否误杀长推理回合(§3.5)、崩溃后旧 SESSION_ID 跨进程 resume 可行性(§5.4)、`SHUTDOWN_GRACE_MS` 实际足够性(§6.2)、WS 缓冲上界 1024 帧在真实增量速率下是否够(§5.5)。其余进程启动/事件流/resume 参数/token 模型已由事实地基 A–G 覆盖,不再标注。

### 7.2 paused 挂起循环(WORKTREE_CONFLICT 人工裁决)

`paused` 是**非终态挂起**(02 §10.2 可 resume),不是 run 出口。引擎在冲突时 `setStatus('paused')` 后进入挂起,阻塞等控制帧;只有 abort 才转终态。这是修补「v1 把 paused 当 finalize 终态」的运行时落点:

```ts
/** 轮末合并冲突 → 挂起等人工裁决。返回值告诉主循环:续跑 / 终止。 */
async function suspendForArbitration(
  deps: EngineDeps, controlQueue: ControlQueue, signal: AbortSignal,
): Promise<'resume' | 'aborted'> {
  await deps.blackboard.setStatus('paused', 'WORKTREE_CONFLICT'); // 02 §10.2 running→paused(合法)
  while (true) {
    const frame = await controlQueue.next(signal);  // 阻塞;signal abort(含 SHUTDOWN)即 reject → 上层 finalize('aborted')
    switch (frame.kind) {
      case 'inject':                                  // 人工裁决:补一条 system/arbiter 消息(过 RT3 校验,§2.3)
        await applyInject(frame, deps);               // 例:人工选边后回灌「采纳 A 的改动」evidence
        continue;                                     // 裁决可能多条,继续等 resume
      case 'resume':
        await deps.blackboard.setStatus('running');   // 02 §10.2 paused→running(合法);回主循环重试 merge / 下一轮
        return 'resume';
      case 'abort':
        return 'aborted';                             // 上层 finalize('aborted')
      // pause/重复:paused 态下 pause 幂等忽略(已 paused)
    }
  }
}
```

| 裁决路径 | 控制帧 | 后果 |
|---|---|---|
| 人工选边/补丁 | `inject`(arbiter/system 语义,过校验) | 回灌裁决 evidence,留在 paused 等 resume |
| 接受裁决续跑 | `resume` | `paused→running`,主循环重试 merge 或推进下一轮(隔离 09 决定冲突已解则放行) |
| 放弃该 run | `abort` | 转 `aborted` 终态,走 finalize + finally 清理 |
| 中枢关闭 | signal abort(SHUTDOWN,§6.2) | `next()` reject → 上层 `finalize('aborted','SHUTDOWN')` |

> 与 02 §10.2 状态矩阵对齐:`running→paused` 合法、`paused→running` 合法、`paused→aborted` 合法;**`paused` 绝不直接转 `done`/`stalled`/`limit`**(那些是 finalize 终态,需先 resume 回 running 再正常收敛)。这把「冲突挂起 → 人工介入 → 续跑或放弃」做成一等公民循环,而非 v1 的「冲突即死」。冲突是否真正解除由隔离 09 `mergeRound` 在 resume 后重试时判定,引擎不替 09 决定选边(RT1:中枢不碰目标文件,只调 `mergeRound`)。

### 7.3 留给定稿的开放问题(本文件吃不掉,需跨稿/用户裁决)

| # | 问题 | 现状 | 建议裁决 |
|---|---|---|---|
| OQ1 | **全仓文档编号双轨制(C-NUM / COV-6)**:本文件 v3 已统一到文件名编号(刹车 04 / 安全 08 / 隔离 09 / 面板 10 / WS 11),与 03v2 一致;但旧逻辑编号派(部分稿件把安全叫 09、面板叫 08、刹车叫 07)未回填 | 纯文档层(不影响类型/接口);本文件按角色名锚点可零成本重定位 | 全仓一次性回填到文件名编号(锚定磁盘文件名),需用户拍板权威方案 |
| OQ2 | **`SUBPROCESS_TIMEOUT` 错误码须回填 02 §12(A1 / COV-1)**:本文件 §3.5 新增该码,02 §12 union 现无;另 `EMPTY_ROUND_PLAN`/`ENGINE_FATAL`/`SUBPROCESS_CRASHED`/`SUBPROCESS_CANCELLED`/`RUN_SIZE_EXCEEDED`(用 reason 串免新增)等下游已用码,02 本体未补 | 02 §12 union 缺多个下游已用码,`SyluxError` 穷举会编译红 | 02 §12 一次性补全所有下游已用码(本文件贡献 `SUBPROCESS_TIMEOUT`),向后兼容新增 union 成员 |
| OQ3 | **`turnTimeoutMs`/熔断阈值/`SHUTDOWN_GRACE_MS`/WS 缓冲上界初值** | 均为待实测初值(§3.5/§4.3/§6.2/§5.5),事实地基未覆盖中转回合耗时与限流时序 | M0 跑真实中转(mouubox)P99 回合耗时 + 429 恢复窗口校准;在此之前按保守初值实现并加可配置项(config 16) |
| OQ4 | **崩溃后旧 SESSION_ID 跨进程 resume 可行性(§5.4)** | 事实地基 E 给了 resume 参数集,但未实测「子进程已死后用旧 SESSION_ID resume」是否成功 | M0 验证;默认不自动续跑(回放仅供回看/审计),resume 由用户面板显式触发(RT8) |
| OQ5 | **`runRoundParallel` 失败 turn 的非致命码归类**:§3.3 `classifyThrow`/`isFatalThrow` 把 parallel 抛错映射成 `TurnResult.code`,需与 03 §5.2 的崩溃分类(F-a/b/c)口径完全一致 | 接口语义需与 03/05 对齐(闸门前 spawn_failed vs 闸门后 crashed_after_gate) | 定稿期核对 `classifyThrow` 与 03 §5.3 `consume` 三类返回逐一对应,避免并行轮误判致命性 |







