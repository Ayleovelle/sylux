# 03 · 引擎与可换剧本(Playbook 接口 + 四范式)v2.1

> **版本**:v2.1(2026-06-20,run-tag v3.1)。v2→v2.1 吃掉**红队/交叉审查**针对本节的 findings:跨稿接口签名硬对齐(`buildStopContext` D4 / `setStatus` D5 / `validate` D6)、`SyluxErrorCode` 本节产出码清单回填 02(A1/COV-1)、DigestBuilder **基线算法**就地定形打破 03↔17 互推(FEAS-4)、M1 **无 worktree 过渡形态**与 `shouldMergeAt`/files 声明的协调(FEAS-3/COV-9)、stall **资格位**避免主从/并行合法空证据轮误杀(FEAS-5)、`tokenBudget` 标注**stateless 线性口径**纠正 16 误套 resume 超线性公式(ROC-B1)。逐条见 §0.4 H10–H17。相对 v1 的硬化点(H1–H9)见同表上半。
> 本批次吃掉的 findings 主线(v2 部分):**跨稿一致性**(刹车接口/done 路径/上下文命名/下游编号四处与兄弟文档对齐)、**覆盖缺口**(DigestBuilder 接口归属、AgentInput 装配、超时/cancel)、**可行性**(崩溃分类、advancePhase 健壮性、parallel 空计划边界)、**安全**(digest 注入向量、firewall 函数签名)、**运维成本**(resume 累积成本护栏 maxResumeChain + 前瞻预算)。
>
> **本文件地位**:sylux 引擎内核(`@sylux/core`)的权威设计。拥有 `Playbook` / `PromptContext` / `TurnDirective` / `RoundPlan` / `Blackboard`(行为接口)/ `BoardView` / `EngineDeps` / `runEngine` 循环 / `DigestBuilder`(接口形状)的完整契约,以及四范式(红蓝对抗 / 主从规划执行 / 对等结对 / 分工并行)用同一接口实现的对照与逐范式伪代码。
>
> **类型引用而非另写**:`Message` / `EvidenceItem` / `FilePatch` / `Role` / `MessageKind` / `AgentId` / `Round` / `RunStatus` / `BoardState` / `AgentEvent` / `TokenUsage` / `AgentMessagePayload` / `SyluxErrorCode` 全部来自 **黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`)。本文件**只引用、禁止另定义**(焊死红队 R1)。`StopPolicy` / `StopContext` / `StopDecision` / `KEEP_RUNNING` / `CompositeStopPolicy` / `DonePolicy` 由**收敛刹车文档(04-convergence-brakes)**权威定义,本文件**只注入、只调用**(见 §0.4 H1/H2)。`AgentAdapter` / `AgentInput` / `ProviderOverrides` 由**适配层文档(05/06-adapter)**权威定义,本文件只调用。`WorktreeManager` / `MergeResult` 由**隔离文档(09-isolation-worktree)**权威定义。`firewallPeerMessage` / `buildChildEnv` 由**安全文档(08-security-firewall)**权威定义。
>
> **下游编号约定(吃掉跨稿编号漂移)**:仓内同时存在两套文档编号(旧引用把"安全"叫 09、"面板"叫 08;实际文件名是 08=安全、09=隔离、10=面板、11=WS、04=刹车、07=provider)。**本文件一律以实际文件名编号为准**,并在每次引用时同时给**角色名**作为防漂锚点(如"收敛刹车文档 04""隔离文档 09""安全文档 08")。若全仓最终统一到另一套编号,只需按角色名重定位,语义不漂。见 §10 Q6。
>
> **上下文类型命名(吃掉 ContextBundle/PromptContext 漂移)**:本契约的上下文类型权威名是 **`PromptContext`**(术语表 23、02、09、16、20–22 一致)。兄弟文档 05/17/19/25 中出现的 `ContextBundle` 是**同一对象的旧别名**,以本文件 `PromptContext` 为准,需回填那几篇。见 §10 Q7。
>
> **与总体规划 §3 的关系**:`docs/sylux-master-plan.md` §3 是本契约的“摘要镜像”(给了 `planRound`/`TurnSpec` 的初稿)。本文件是其**完整展开**,并对初稿做两处**向后兼容精化**(见 §1,发现差异以本文件为准并回填 §3)。
>
> **事实地基**:进程/token/resume 相关结论一律遵守 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)。凡事实地基已覆盖的不再标【待实测】;仅未实测的标【待实测】。

## 0.4 v2 硬化点(相对 v1 的逐条修订)

| # | 硬化点 | v1 问题 | v2 修订 | 落点 |
|---|---|---|---|---|
| H1 | **刹车接口对齐 04** | v1 自造 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult`,与刹车文档 04 权威 `StopPolicy` 冲突 | 删自造接口;`EngineDeps.stopPolicy: StopPolicy`(04);引擎每轮**末**(无前置)调 `update→shouldStop` 一次 | §0.2 E6、§4.3、§5.1 |
| H2 | **done 路径单一化** | v1 既有 `playbook.isDone` 又有引擎 `if(isDone)` 分支,与 04 的 `DonePolicy`(优先级 0,在 `CompositeStopPolicy` 内)双重检测 | 通用 done+ack 归 04 `DonePolicy`;`playbook.isDone` 经 `PlaybookDonePolicy` 包装注入 04 的 composite(仅 parallel 无 ack / master-worker 清单门这类通用判据覆盖不到处用);引擎**不再**单独判 done | §3.3、§4.3、§5.1 |
| H3 | **AgentInput 真实装配** | v1 `buildAgentInput` 含糊 | 按 05 `AgentInput`(prompt/outputSchema/workdir/sandbox/providerEnv/providerOverrides/timeoutMs/ephemeral)装配;新增 `EngineDeps.agentRuntime` 解析非 playbook 字段 | §4.3、§5.2 |
| H4 | **崩溃分类(05 闸门)** | v1 `consume` 只识别 spawn_failed | 区分闸门**前**(F-a/F-b→`SUBPROCESS_SPAWN_FAILED`,首轮致命)与闸门**后**(F-c→`SUBPROCESS_CRASHED`/`SUBPROCESS_CANCELLED`,可 resume) | §5.2、§5.3、§8 |
| H5 | **digest 注入向量** | v1 firewall 只包 delta,digest 由旧 peer 内容压成却未过滤 | digest 必须由结构化 evidence/自方内容生成或**整体过 firewall**;`DigestBuilder` 接口在此定形,生成策略归性能文档 17 §6.3 | §2.1、§2.3、§4.3 |
| H6 | **firewall 真实签名** | v1 写 `firewall.wrap()` | 改为 `firewallPeerMessage(msg)→{action:'pass'\|'flag'\|'block', wrapped}`,block→`INJECTION_BLOCKED`(安全 08 §4) | §2.3、§5.2、§8 |
| H7 | **resume 成本护栏** | v1 仅有 `tokenBudget` | 新增 `maxResumeChain`(单链 resume 轮数上限,事实 D 累积爆点);依赖 04 前瞻预算刹车(S4)在跨预算前抢停 | §3.3、§5.2、§6、§8 |
| H8 | **advancePhase 健壮性** | v1 凭"上一条 message.kind"推进,失败轮(system 打回)会误推进 | 改为凭**本轮已校验、期望 kind 的 agent 消息**推进;缺失则相位不前进(重试/stall) | §7.2.1 |
| H9 | **parallel 空计划边界** | v1 全 lane done 后 `nextTurn` 返回 `turns:[]` 触发 `EMPTY_ROUND_PLAN` 误判 | `isDone`(经 composite)在**进入 `nextTurn` 前**的上一轮后置裁决即停;空 turns 仅在"应已 done 却没停"时才算 bug | §5.1、§7.4 |
| H10 | **`buildStopContext` 签名对齐 04(D4)** | 03 §5.1 调 `(BoardView,round)` 两参,04 §2.4/§10 写 `(BoardState)` 单参,跨稿硬冲突 | `buildStopContext` 是**引擎侧 03 拥有**的投影适配器(`BoardView`→04 `StopContext`),签名定为 `(board, round, plan)` 三参(plan 提供 stall 资格位 H15);04 只**消费** `StopContext`,不再自己声明 `buildStopContext` 入参形态。回填 04:删 `buildStopContext(BoardState)`,改"`StopContext` 由引擎 03 §5.1.2 投影注入" | §5.1.2、§9 |
| H11 | **`setStatus` 形参对齐(D5)** | 03 §4.2 两参 `(status,reason?)`,04 调三参 `(status,code,reason)`,02 §7.1 `status_changed` 无独立 `code` 字段 | `setStatus(status, opts?: {code?: SyluxErrorCode; reason?: string})` 单对象可选第二参;`code` 折进落盘的 `status_changed.reason` 前缀(02 无独立字段→不新增字段,语义无损)。引擎/04 统一用对象形 | §4.2、§5.1、§9 |
| H12 | **`validate` 签名桥接(D6)** | 02 §8.1 权威 `validateMessage(msg:Message, ctx:ValidateContext)`,03 `EngineDeps.validate(msg:AppendInput, round)` 入参类型与第二参语义都不同 | 显式声明 `EngineDeps.validate` 是**引擎侧对 02 `validateMessage` 的桥接闭包**:装配层把 `(AppendInput, round)` 组装成 02 的 `(Message 草样, ValidateContext)` 再转调;桥接契约在 §4.3.1 给出,02 权威实现不变 | §4.3.1、§9 |
| H13 | **本节产出错误码清单回填 02(A1/COV-1)** | 02 §12 `SyluxErrorCode` union 缺本节实际产出的码,下游编译/穷举会红 | §8.1 新增"本节产出码清单"小表,逐码标注产出点,作为 02 §12 union 的回填来源(本节只**使用**02 的类型,清单供 02 补全,不在此另定义 union) | §8.1、§9 Q11 |
| H14 | **DigestBuilder 基线算法就地定形(FEAS-4)** | 03 §2.1.1 称算法归 17,17 §6.3 称归 03,双向推诿→M1 无 digest 可用、>2 轮失忆 | §2.1.1 就地给**确定性、无 LLM 的基线算法**(结构化 evidence 锚点 + 末 N 决策拼接,token 上界裁剪),保证 M1 连续性可落地;17 §6.3 只负责**可选的高质量压缩升级**(超过基线时启用),不再是连续性的唯一依赖 | §2.1.1、§9、§10 Q4 |
| H15 | **stall 资格位防误杀(FEAS-5)** | 04 `ConvergencePolicy` 把"连续 window 轮 evidence 指纹差集空"判 stall,但主从派活轮、parallel 收口前等**天然不产新对抗证据**的合法轮会被误计入 stall | `RoundPlan.stallEligible:boolean`(默认 true)由 playbook 标注本轮是否"应产新对抗 evidence";引擎经 `StopContext` 透传,04 `ConvergencePolicy` **只对 `stallEligible` 轮累计 stall streak**,非资格轮不清零也不累加(跳过)。主从 plan 标 false、parallel 全标 false | §3.2、§5.1.2、§6.1、§7.2/§7.4、§9 |
| H16 | **M1 无 worktree 过渡形态(FEAS-3/COV-9)** | 03 红蓝 `shouldMergeAt` 恒 true + proposer 声明 files,与 25 M1"不写文件/不建 worktree"相反 | 引入 `EngineDeps.worktreesEnabled`(M1=false):为 false 时引擎**跳过** `mergeRound`(merge 步成 no-op),`shouldMergeAt` 返回值被忽略;此时 `files[]` 仅作**意图声明 evidence**(不落盘、不参与 3-way),`contentHash` 类强证据在 M1 退化为"命令复现"弱锚点。M2 起 `worktreesEnabled=true` 恢复全语义 | §5.1.1、§5.1、§6.1、§9 Q12 |
| H17 | **`tokenBudget` 标注 stateless 线性口径(ROC-B1)** | 16 §6.4 默认预算表对 stateless 范式误套 resume 超线性公式 `base×N(N+1)/2`,默认配置下 B3 预算网失效 | §6.3 显式声明:`PlaybookParams.tokenBudget` 默认值按**该范式 continuity 的真实成本曲线**估——stateless 用**线性** `base×N`(18 §6.4 regime 分叉),resume 段才用累积公式。16 配置层**必须**按 regime 选公式,不可对 stateless 套 resume 公式;§6.3 给出每范式正确口径 | §6.3、§9 Q13 |

---

## 0. 设计目标与不变量

### 0.1 一个循环,四种打法

引擎是**范式无关**的有限循环。一次 run 里反复问 playbook 四件事,引擎只负责忠实执行与守门,绝不内置任何范式逻辑:

| 引擎问 playbook | 接口方法 | 范式差异落点 |
|---|---|---|
| 这一轮**谁**发言、**扮谁**、**给什么上下文** | `nextTurn(board)` | 全部范式差异的主战场 |
| 这一轮末**要不要合并** worktree | `shouldMergeAt(round)` | 串行范式每轮合,parallel 轮末统一合 |
| 在三重刹车+done 出口之上,这一轮**算不算范式意义的完成** | `isDone(board)`(经 `PlaybookDonePolicy` 注入 04 的 `CompositeStopPolicy`,H2) | done 判定的范式特定逻辑 |
| run 开始 / 结束时的**钩子** | `onStart` / `onFinish` | 初始化任务目标、清理 |

“换打法只换 playbook 对象,引擎本体不动”是硬指标(锁定决策 §3)。四个 playbook 共用同一 `runEngine`。**终止判定**(三重刹车 + done 出口)统一由收敛刹车文档 04 的 `CompositeStopPolicy` 拥有;引擎只在每轮末调它一次,不内置任何刹车或 done 逻辑(H1/H2)。

### 0.2 内核不变量(实现必须保持)

- **E1 角色与模型解耦**:`TurnDirective.agent`(物理进程)与 `.role`(本轮扮演角色)正交。任意 agent 可被指派任意角色;换 critic 归谁只改指派,不改引擎(对应 02 §2 `from` ⊥ `role`)。
- **E2 未校验不入黑板**:任何 agent 产出必经 `validateMessage`(02 §8)才能 `blackboard.append`。引擎拿到的永远是已盖章、已校验的 `Message`(02 不变量 I2)。
- **E3 只喂增量**:`PromptContext` 默认只含 delta + digest + goal,绝不重灌全历史。token 成本对轮数累积/超线性(事实地基 D),省钱靠应用层裁剪,这是内核职责而非可选优化(§4)。
- **E4 stall 与 done 解耦**:`isDone`(范式完成)与收敛 stall(连续 N 轮无新 evidence 指纹,02 §9.3)是两条**独立**信号,互不触发(红队 R5)。二者在收敛刹车文档 04 的 `CompositeStopPolicy` 内**按优先级裁决**(done 优先级 0 > stall),但**判据彼此不可见**(04 §7.2 解耦证明)。
- **E5 合并冲突硬停**:worktree 轮末合并冲突 → 引擎**不静默重试**,写 `system` 消息回灌 evidence、置 `paused` 等人工裁决(红队 R7,§5.1)。
- **E6 刹车统一在轮末(对齐 04)**:终止判定由收敛刹车文档 04 的 `CompositeStopPolicy` 拥有。引擎在**每轮关闭后**(`closeRound` 落指纹缓存之后)按 04 §2.4 铁律调 `stopPolicy.update(ctx)` 再 `stopPolicy.shouldStop(ctx)` 各一次,**无前置刹车**——token/轮数预算的"提前抢停"由 04 的**前瞻预算刹车**(S4:用 `lastRoundUsage` 预测下一轮累积是否跨 `tokenBudget`)在后置裁决里完成,不在引擎里另设 `checkBefore`(事实地基 D:成本对累积/超线性,预测须按累积上下文)。`maxResumeChain` 护栏由引擎在 `runTurn` 选 send/resume 时本地强制(§5.2),与 04 预算刹车叠加。
- **E7 失败不静默**:spawn 失败 / schema 违例耗尽重试 / evidence 不可核验 / firewall block,都走显式错误码(02 §12)+ `system` 消息落黑板,绝不吞错继续(总体规划 §11.3)。

### 0.3 本文件负责 / 不负责

| 负责(给完整接口 + 伪代码 + 时序) | 不负责(只引用) |
|---|---|
| `Playbook` 接口(`nextTurn` 等)| `Message`/`Evidence`/`Round`/`BoardState` 数据类型 → 黑板 02 |
| `PromptContext` / `TurnDirective` / `RoundPlan` / `DigestBuilder`(接口形状) | `validateMessage` / 指纹算法实现 → 黑板 02;digest **生成策略** → 性能 17 §6.3 |
| `Blackboard` 行为接口 + `runEngine` 循环 + `PlaybookDonePolicy` 包装 | `AgentAdapter` 启动/resume/schema 传递细节 → 适配层 05/06 |
| 四范式对照表 + 逐范式 `nextTurn` 伪代码 | `StopPolicy`/`StopContext`/`StopDecision`/`CompositeStopPolicy`/`DonePolicy` + 刹车阈值 → 收敛刹车 04 |
| done/stall 与 playbook 协同语义(谁注入 composite) | worktree 3-way 合并算法 / `MergeResult` → 隔离 09 |
| 失败路径在引擎层的处理 | provider 配置 → 07;`firewallPeerMessage` / env 白名单 / 沙箱封顶 → 安全 08 |

---

## 1. 与总体规划 §3 的差异(向后兼容精化)

总体规划 §3 给的是初稿 `planRound(round, bb): TurnSpec[]`。本文件统一为 `nextTurn(board): RoundPlan`,两处精化、均向后兼容(只增不删,语义超集):

| # | §3 初稿 | 本文件 | 理由 |
|---|---|---|---|
| P1 | `planRound(round, bb)` 返回 `TurnSpec[]` | `nextTurn(board): RoundPlan`,`RoundPlan.turns: TurnDirective[]` | 串行范式 `turns.length===1`,parallel `length===2`。统一一个方法,引擎不分叉;`board` 取代 `(round, bb)`,轮号从 `board.currentRound` 读,签名更稳。 |
| P2 | `TurnSpec = {agent, role, kindHint}` | `TurnDirective = {agent, role, kindHint, promptContext}` | 把“给该 agent 什么上下文”从引擎内部下放到 playbook 决策(任务要求 `nextTurn→{agent,role,promptContext}`)。引擎只负责把 `promptContext` 渲染成 prompt + 过防火墙,**不再自行决定喂什么**,范式对上下文的控制更彻底(E3)。 |
| P3 | `assignment: Record<Role, AgentId>` | 保留为**默认指派**;`TurnDirective.agent` 可逐轮覆盖 | `Record<Role,AgentId>` 无法表达 parallel 范式“同一 role(worker)指派给两个 agent”。改为:`assignment` 是 playbook 内部查表的默认,真正生效的是 `TurnDirective.agent`,内核只认后者。 |

> 回填:总体规划 §3.2 的 `planRound`/`TurnSpec` 应改为本文件的 `nextTurn`/`RoundPlan`/`TurnDirective`,或标注“以 03 为准”。这不影响 02 的任何类型(02 不拥有引擎接口)。

---

## 2. PromptContext —— playbook 喂给 agent 的上下文(省 token 的核心)

`PromptContext` 是 `nextTurn` 决策的产物,描述“**这一轮这个 agent 应该看到什么**”。它是引擎的 E3(只喂增量)落地点:playbook 决定喂什么,引擎只渲染、过防火墙、调 adapter。**绝不在此塞全历史**。

### 2.1 续接策略 —— continuity(token 模型的决定性开关)

事实地基 D 是本设计最硬的约束:**resume 不省 token,input_tokens 随轮数累积/超线性上涨**(18755→37645,≈翻倍;8 轮 ≈ 36×base 不是 8×base)。因此“喂什么上下文”必须和“怎么续接会话”一起决策,二者耦合,`PromptContext.continuity` 是这个开关:

```ts
/** 会话续接策略:决定 adapter 用 send(新会话) 还是 resume(续接),直接决定 token 成本曲线 */
export type ContinuityMode =
  /**
   * 'stateless':每轮全新会话(adapter.send),不 resume。
   * - prompt = goal + digest(旧轮压缩结论) + delta(对面上一条 + system)。
   * - 成本对轮数“近似平”(每轮只吃 base + digest + delta,不吃累积全历史)。
   * - 代价:agent 无 CLI 侧记忆,全靠中枢喂的 digest/delta;digest 质量决定连续性。
   * - 【推荐用于长程辩论】红蓝多轮、对等结对:轮数多,resume 的累积成本会爆,stateless 才可控。
   */
  | 'stateless'
  /**
   * 'resume':续接同一 CLI 会话(adapter.resume(sessionId))。
   * - agent 保留 CLI 侧完整记忆,连续性最好。
   * - 成本:事实地基 D —— 每轮按全量历史重计费,累积/超线性。轮数一多就贵。
   * - 【推荐用于短程、强记忆任务】主从范式 planner→worker 紧耦合的少数轮次。
   */
  | 'resume';
```

> **设计立场(对抗性自检结论)**:很多人默认“多轮就该 resume 保记忆”。但事实地基 D 证明 resume 在中转下是累积计费,长程辩论用 resume = 成本炸弹。sylux 的默认是 **stateless + 高质量 digest**,把“记忆”做成中枢应用层可控的 digest,而不是把成本甩给中转会话态。`resume` 仅在 playbook 显式判定“这几轮强耦合且短”时启用,且受 `maxResumeChain` 护栏封顶(§3.3/§5.2,H7)。
>
> **digest 注入向量(H5,安全硬约束)**:`digest` 是“旧轮压结论”,而旧轮里**含 peer 的产出**——若把 peer 原文直接喂进压缩器、压缩结果再喂回对面,等于绕过了 §2.3 只对 `delta` 做的 firewall(注入可藏在被压缩的 peer 措辞里二次进对面 prompt)。因此 `DigestBuilder` 的实现(性能 17 §6.3 拥有生成策略)**必须满足二选一**:① 只从**结构化、已校验的 evidence 锚点**(02 §3 的 file_ref/command/spec_quote 字段,非自由 body 文本)+ 自方历史结论生成 digest;或 ② 生成的 digest 文本在进入 `PromptContext` 后,与 `delta` 一样**整体过 `firewallPeerMessage`**(§2.3)。引擎在 §4.3 注入 `DigestBuilder` 时按本约束校验其输出来源;`DigestBuilder` 接口形状在 §4.3 定义,生成算法归 17。

#### 2.1.1 DigestBuilder 接口 + 基线算法(接口与基线在此,高质量压缩升级归性能 17 §6.3)

DigestBuilder 接口缺乏权威归属、且算法在 03↔17 间双向推诿(FEAS-4)是 v1/v2 的覆盖缺口。**v2.1 就地了结(H14)**:接口形状 + **确定性基线算法**归本文件 03(因为它是 `EngineDeps` 注入项、`PromptContext.digest` 的来源,且 M1 连续性不能等 17),性能 17 §6.3 只负责**可选的高质量压缩升级**(语义摘要/要点抽取),在基线之上择优启用——**17 缺席时基线必须能独立保证 >2 轮不失忆**(打破 FEAS-4 死锁:连续性不再唯一依赖 17)。

```ts
/** 旧轮压结论生成器。EngineDeps 注入(§4.3);基线算法见下方 buildDigestBaseline,高质量升级归性能 17 §6.3。 */
export interface DigestBuilder {
  /**
   * 从黑板只读视图压出"截至 upToRound 轮的结论摘要",喂 PromptContext.digest。
   * 约束(H5):输出只能源自 ① 已校验 evidence 锚点 + 自方结论,或 ② 调用方保证整体过 firewall。
   * 实现侧应优先走 ①(结构化、无自由 peer 文本),从根上断注入链。
   * 默认实现 = buildDigestBaseline(确定性、无 LLM);17 可提供更高质量实现替换之。
   */
  build(board: BoardView, upToRound: number, opts: DigestOptions): string;
}
export interface DigestOptions {
  /** 目标 token 上界(= perTurnContextCap 的一个分配额度);超出由实现自行压缩。 */
  maxTokens: number;
  /** 该 digest 是否将不经 firewall 直喂对面(true→实现必须只用结构化 evidence,H5 路径①)。 */
  bypassFirewall: boolean;
  /** 仅取该 agent 视角相关的结论(parallel 线内/主从子任务隔离;undefined=全局)。 */
  forAgent?: AgentId;
  /** 基线算法保留的末 N 条决策(默认 8);高质量实现可忽略。 */
  decisionTailN?: number;
}
```

**基线算法 `buildDigestBaseline`(H14,M1 可落地、确定性、无 LLM、无注入面)**:不做语义理解,只做"结构化锚点 + 末 N 决策"的可截断拼接。证据锚点全部取自**已校验 `Message.evidence` 的结构化字段**(02 §3:`file_ref{path,lineRange,contentHash}` / `command{cmd,expect}` / `spec_quote`),**绝不**取 peer 的自由 `body` 文本——故天然满足 H5 路径①(`bypassFirewall:true` 也安全):

```ts
/** 确定性基线 digest:结构化 evidence 锚点 + 末 N 条决策摘要,按 maxTokens 从旧到新截断。 */
function buildDigestBaseline(board: BoardView, upToRound: number, opts: DigestOptions): string {
  const lines: string[] = [];
  // 1) 决策类消息(propose/plan/review-accept/done)的结论行:只取 kind + 自方一句话结论锚(body 首行经长度截断)
  //    注:body 首行属"自方历史结论"——若 forAgent 限定,只取该 agent 自己产的,避免引入 peer 自由文本(H5)。
  const tailN = opts.decisionTailN ?? 8;                  // 末 N 条决策(默认 8)
  const decisions = board.messages
    .filter((m) => m.round <= upToRound && DECISION_KINDS.has(m.kind))
    .filter((m) => !opts.forAgent || m.from === opts.forAgent)
    .slice(-tailN);
  // 2) 结构化 evidence 锚点(全程累积、去重):file_ref 的 path+lineRange+hash 前缀 / command 的 cmd+expect 摘要
  const anchors = dedupeAnchors(
    board.messages.filter((m) => m.round <= upToRound).flatMap((m) => structuredAnchors(m.evidence)),
  );
  for (const a of anchors) lines.push(`[EVID] ${a}`);     // 如 "[EVID] file:src/x.ts#L10-22@a1b2c3" / "[EVID] cmd:`npm t` expect:0fail"
  for (const d of decisions) lines.push(`[${d.kind.toUpperCase()}] r${d.round}:${oneLine(d.bodyHeadline, 120)}`);
  // 3) 从旧到新按 maxTokens 截断(新结论与近期锚点优先保留;超界先砍最旧的 [EVID]/[*] 行)
  return truncateToTokens(lines, opts.maxTokens);
}
const DECISION_KINDS = new Set<MessageKind>(['propose', 'plan', 'review', 'done', 'ack']);
```

> **基线 vs 17 升级的边界(FEAS-4 了结)**:基线**只拼结构化锚点 + 决策标题行**,不压缩语义、不改写措辞,故 ① 确定性可回放(同 board 同 digest)、② 零注入面(不含 peer 自由文本)、③ M1 即可用(无需 17/无需额外 LLM 调用 = 不额外烧 token)。其代价是 digest 偏"骨架"——长程辩论里细节论据会丢。性能 17 §6.3 的高质量实现可在**有 token 预算**时把 `body` 语义压成要点替换决策行(但那条路径必须按 H5:要么只喂结构化、要么整体过 firewall)。**两者同接口可热插替换**;M1 用基线,M2+ 视 17 进度择优。digest 质量对连续性的实际影响仍列 §10 Q4 待实测,但 M1 不再被它阻塞。
>
> **`oneLine(bodyHeadline,…)` 的 H5 边界**:`bodyHeadline` 仅在 `forAgent` 限定为**自方**消息时才取(自方文本可信);跨 agent(red-blue/pair 的对面 body)**不进基线**——那些范式的 digest 只靠 `[EVID]` 结构化锚点行支撑连续性,对面观点通过当轮 `delta`(已过 firewall)传递,不沉淀进 digest。这样 `bypassFirewall:true` 在所有范式下都安全。

### 2.2 PromptContext 接口

```ts
export interface PromptContext {
  /** 续接策略(§2.1)。引擎据此选 adapter.send 还是 adapter.resume。 */
  continuity: ContinuityMode;
  /**
   * 任务目标(不变量级,跨轮稳定)。stateless 下每轮都带;resume 下首轮带、后续可省。
   * 来源:onStart 注入的 run 目标 + playbook 固化的范式说明。
   */
  goal: string;
  /**
   * 旧轮压缩结论(应用层维护,省 token 的关键)。stateless 必带;resume 可空。
   * 由 §2.1.1 的 DigestBuilder 产出(生成策略归性能 17 §6.3);本文件只约定它是"截至上一轮的结论摘要",非全文。
   * 安全(H5):其来源受 DigestOptions.bypassFirewall 约束——直喂不过 firewall 时只能用结构化 evidence。
   */
  digest: string;
  /**
   * 本轮新增增量:通常是对面上一条 message + 任何 orchestrator system 消息(打回/合并冲突回灌)。
   * 引擎从 board 取,playbook 选定范围;喂前每条 body/evidence 过内容防火墙(安全 08 `firewallPeerMessage`)。
   */
  delta: readonly Message[];
  /**
   * 角色指令:本轮该 agent 扮演 role 的行为约束(自然语言),由 playbook 按范式注入。
   * 例:critic → “你是红队,必须给可机器核验的 file_ref/command evidence,空泛批判会被打回”。
   * 落地:codex 走 prompt 正文 / AGENTS.md;claude 走 --append-system-prompt(事实地基 F,适配层 05/06)。
   * 注:roleBrief 是 orchestrator 自撰的可信文本,不来自 peer,故不过 firewall(与 delta/digest 区别)。
   */
  roleBrief: string;
  /**
   * 期望产出的消息类型(= TurnDirective.kindHint 的副本,便于 prompt 渲染时点明)。
   * agent 实际 kind 仍以其产出为准并经校验,这里只是“请你这轮做 X”的引导。
   */
  expectedKind: MessageKind;
  /**
   * 单轮上下文体积上限(token 估算,playbook.params.perTurnContextCap)。
   * 引擎渲染后若超限 → 先砍 digest、再砍 delta 旧条目,仍超 → 抛 TOKEN_BUDGET 前置告警(§4.3)。
   */
  contextCap: number;
}
```

### 2.3 PromptContext → prompt 的渲染顺序(引擎侧,固定)

引擎把 `PromptContext` 拼成单个 prompt 字符串的顺序固定如下(stateless 全段;resume 仅 `delta + roleBrief`,goal/digest 已在会话记忆里):

```
[GOAL]      goal                         (resume 后续轮可省)
[DIGEST]    digest                       (resume 可省;stateless 必带)
[ROLE]      roleBrief                    (每轮带:防止角色漂移)
[INPUT]     delta 各 Message(过防火墙)   (每轮带)
[TASK]      “请以 expectedKind 产出,并满足 output schema(02 §6.1)”
```

> 防火墙(安全 08):`delta` 里每条 `body`/`evidence` 文本进对面 prompt 前,调安全文档 08 的 `firewallPeerMessage(msg)`(边界标记 + 特征扫描 + files 路径白名单),防 peer 输出里的注入指令劫持本轮 agent(红队 R8)。其返回 `{action:'pass'|'flag'|'block', wrapped}`:`pass`/`flag` 用 `wrapped`(已包 `<<<SYLUX_PEER_DATA …>>>` 封套)拼入 `[INPUT]`;`block` → 该条不拼入、引擎落 `system` 打回发送方,连续 block 耗尽重试抛 `INJECTION_BLOCKED`(安全 08 §4.5)。引擎在渲染 `[INPUT]` 段时逐条调用,playbook 不接触原始拼接。**`digest` 若走 `bypassFirewall:false` 路径,同样整体过 `firewallPeerMessage`(H5)。**

---

## 3. TurnDirective / RoundPlan / Playbook 接口

### 3.1 TurnDirective —— 一次发言的完整指令

```ts
/** 一次 agent 发言的完整指令:谁、扮谁、做哪类、看什么。nextTurn 的最小产出单元。 */
export interface TurnDirective {
  /** 物理发言主体(覆盖 assignment 默认查表,E1/P3)。 */
  agent: AgentId;
  /** 本轮扮演角色(写入 Message.role)。 */
  role: Role;
  /** 期望产出的消息类型(引导,非强制;实际以校验后的产出为准)。 */
  kindHint: MessageKind;
  /** 喂给该 agent 的上下文(§2)。引擎据 continuity 选 send/resume。 */
  promptContext: PromptContext;
}
```

### 3.2 RoundPlan —— 一轮的发言计划(串行=1,parallel=N)

```ts
/** 一轮的发言计划。turns 长度区分串行/并行;execution 告诉引擎怎么跑这些 turn。 */
export interface RoundPlan {
  /**
   * 本轮所有发言指令。
   * - 串行范式(红蓝/主从/结对):length===1,引擎跑完写黑板再问下一轮 nextTurn。
   * - 并行范式(parallel):length===2,引擎 Promise.all 并发执行,各写各 worktree(E5/隔离 09)。
   */
  turns: TurnDirective[];
  /**
   * 执行模式:'serial' 顺序(本就 1 个无所谓);'parallel' 并发。
   * 引擎据此决定 await 串行 还是 Promise.all。冗余于 turns.length 但显式,防歧义。
   */
  execution: 'serial' | 'parallel';
  /**
   * 可选:本轮结束后是否提示引擎这是“逻辑阶段末”(供 shouldMergeAt 之外的弱信号,
   * 例如主从范式 worker 实现完应触发 planner review)。引擎不强依赖,playbook 自洽即可。
   */
  phaseHint?: string;
  /**
   * ★H15:本轮是否"应当产出新对抗 evidence",决定 04 ConvergencePolicy 是否把本轮计入 stall streak。
   * 默认 true(对抗类轮:critique/review-reject/对等互评)。
   * 设 false 的合法空证据轮(避免 FEAS-5 误杀):
   *   - master-worker:plan(派活)、review-accept(验收通过本就不带新对抗证据)
   *   - parallel:全部轮(靠完成收敛而非辩论,无对抗 evidence 概念)
   * 04 对 stallEligible===false 的轮**跳过**(既不累加也不清零 stall streak),只在资格轮上累计"连续 window 轮无新指纹"。
   * 引擎经 §5.1.2 buildStopContext 把本字段透传进 StopContext.stallEligible。
   */
  stallEligible?: boolean;
}
```

### 3.3 Playbook 接口(换打法只换它)

```ts
export interface Playbook {
  /** 范式标识(写入 BoardState.playbookId,02 §10.2):'red-blue' | 'master-worker' | 'pair' | 'parallel'。 */
  readonly id: PlaybookId;
  readonly name: string;

  /** 角色→agent 默认指派(P3:仅查表默认,实际以 TurnDirective.agent 为准)。 */
  readonly assignment: Partial<Record<Role, AgentId>>;

  /** 运行参数(刹车阈值由 07 消费,本文件只持有声明)。 */
  readonly params: PlaybookParams;

  /** run 启动钩子:注入任务目标、初始化范式状态(如主从的子任务队列)。 */
  onStart(deps: EngineDeps): Promise<void>;

  /**
   * ★核心:基于当前黑板状态,决定下一轮谁发言、扮谁、看什么。
   * 引擎在每轮循环开头调用一次(无前置刹车,H1);返回的 RoundPlan 完全决定本轮行为。
   * 入参是只读 BoardState(02 §10)+ 黑板查询能力(经 board 暴露的只读视图,§5.1)。
   */
  nextTurn(board: BoardView): RoundPlan;

  /** 该轮末是否做 worktree 合并(串行范式可每轮 true;parallel 仅在子任务收口轮 true)。隔离 09 执行。 */
  shouldMergeAt(round: number, board: BoardView): boolean;

  /**
   * 范式特定完成判定(H2:与 04 的通用 DonePolicy 互补,非替代)。返回 true 表示"范式认为收敛完成"。
   * 通用的"一方 done + 对面带证据 ack"由收敛刹车 04 的 `DonePolicy` 统一处理(优先级 0);
   * 本方法只负责通用判据**覆盖不到**的范式特定门(如 parallel 全 lane done 无 ack、master-worker 子任务清单全 accept)。
   * 引擎把它经 `PlaybookDonePolicy`(§4.3)包装成一个 `StopPolicy` 注入 04 的 `CompositeStopPolicy`,
   * **引擎本体不再单独 if(isDone)**(H2)。这与 stall(无新 evidence)解耦——done 是"吵出/做出结果",stall 是"挤不出新东西"。
   */
  isDone(board: BoardView): boolean;

  /** run 结束钩子(任意终态):清理范式状态、产出范式级总结(可选)。 */
  onFinish(status: RunStatus, board: BoardView): Promise<void>;
}

export type PlaybookId = 'red-blue' | 'master-worker' | 'pair' | 'parallel';

export interface PlaybookParams {
  maxRounds: number;                 // 硬上限(→ 04 MaxRoundsConfig;预算按累积上下文估,事实地基 D)
  convergenceWindow: number;         // 连续 N 轮无新 evidence 指纹 → stall(→ 04 ConvergenceConfig.stallWindow,02 §9.3)
  tokenBudget: number;               // 累计 token 硬上限(→ 04 预算刹车 B3,独立于轮数)
  perTurnContextCap: number;         // 单轮 context 体积上限(→ PromptContext.contextCap,分配给 digest/delta)
  sandboxCeiling: 'read-only' | 'workspace-write'; // 自动化沙箱上限(安全 08;不可设 danger)
  defaultContinuity: ContinuityMode; // 范式默认续接策略(§2.1);nextTurn 可逐轮覆盖
  retryOnReject: number;             // schema/evidence/firewall 打回后同 agent 重发上限(默认 3,§5.2)
  maxResumeChain: number;            // ★H7:单 agent 连续 resume 的最大轮数;达上限强制降级 stateless+digest(事实 D 累积爆点护栏)
}
```

---

## 4. Blackboard / BoardView / EngineDeps(引擎依赖契约)

### 4.1 BoardView —— playbook 看到的只读黑板

`nextTurn` / `shouldMergeAt` / `isDone` 收到的是**只读**视图,playbook 不能直接 `append`(只有引擎在校验后写,E2)。`BoardView` 是 02 `BoardState` 数据 + 若干派生查询的只读封装:

```ts
/** playbook 只读视图。所有方法无副作用;写入是引擎特权(E2)。 */
export interface BoardView {
  readonly runId: string;
  readonly currentRound: number;          // = BoardState.currentRound
  readonly status: RunStatus;
  /** 全量消息只读快照(02 §10:回放权威源)。playbook 可遍历但通常只看末尾几条。 */
  readonly messages: readonly Message[];
  /** 各轮快照(含 evidenceFingerprints / usage,02 §10.1)。 */
  readonly rounds: readonly Round[];

  /** 便捷查询(派生,无副作用) */
  lastMessage(): Message | undefined;                       // 最后一条
  lastFrom(agent: AgentId): Message | undefined;            // 某 agent 最后一条
  messagesInRound(round: number): readonly Message[];       // 某轮全部
  byKind(kind: MessageKind): readonly Message[];            // 某类全部(如所有 done)
  /** 某 agent 当前会话句柄态(02 §10:sessionId 空→不可 resume,I5/E3)。 */
  sessionOf(agent: AgentId): { sessionId?: string; resumable: boolean };
  /** 截至上一轮的“新 evidence 指纹差集是否连续 window 轮为空”(02 §9.3,stall 预判)。 */
  stalledFor(window: number): boolean;
}
```

> `stalledFor` 的差集算法在 02 §9.3 定义、收敛刹车 04 §4 实现;`BoardView` 只暴露查询结果给 playbook 的 `isDone` 做范式特定判断(例如 pair 范式可在 stall 前主动 done)。**最终 stall 终止仍由 04 的 `ConvergencePolicy` 强制**,playbook 的判断不能绕过它(E4)。

### 4.2 Blackboard —— 引擎写侧接口(02 §2.5 引用,本文件补全行为语义)

总体规划 §2.5 给了 `Blackboard` 草签。本文件确认其行为契约(数据类型仍属 02):

```ts
export interface Blackboard {
  readonly runId: string;
  /** 追加一条【已校验】消息:盖 id/ts/round/schemaVersion(02 §5.1),落 jsonl,广播订阅者。 */
  append(msg: AppendInput): Promise<Message>;
  /** 关闭一轮:落 round_closed 记录(指纹集合 + usage,02 §7.1),供回放免重算。 */
  closeRound(round: number): Promise<Round>;
  /** 记录 agent 会话句柄(session_started 回吐后,02 §7.1 agent_session)。 */
  recordSession(agent: AgentId, sessionId: string): Promise<void>;
  /**
   * 状态机变更(running→paused→终态,落 status_changed,02 §7.1)。
   * ★H11(对齐 04/02):第二参为可选对象 {code?, reason?}。02 §7.1 status_changed 无独立 code 字段,
   * 故 code 折进落盘 reason 前缀(如 "WORKTREE_CONFLICT: <reason>"),不新增 02 字段、语义无损。
   * 04 与引擎统一用此对象形,消除 03 两参/04 三参漂移。
   */
  setStatus(status: RunStatus, opts?: { code?: SyluxErrorCode; reason?: string }): Promise<void>;
  /** 只读视图(给 playbook;= §4.1)。 */
  view(): BoardView;
  /** 订阅增量(WS 广播,面板 10 / WS 协议 11)。 */
  subscribe(fn: (rec: BroadcastEvent) => void): () => void;
}

/** append 的入参:agent 产出子集(02 §6.1)+ 引擎补的 from/role/round;id/ts/schemaVersion 由 Blackboard 盖。 */
export interface AppendInput {
  from: AgentId;
  role: Role;
  round: number;
  payload: AgentMessagePayload;   // 02 §6.1:{kind, body, files, evidence, inReplyTo?}
}
```

> `AppendInput` 焊死 02 的“agent 不伪造身份/时间/轮次”:agent 只产出 `payload`,`from/role/round` 由引擎按 `TurnDirective` 填,`id/ts/schemaVersion` 由 `Blackboard.append` 盖章(02 §5.1 / §6.1)。

### 4.3 EngineDeps(黑板 02 / 刹车 04 / 适配 05·06 / provider 07 / 安全 08 / 隔离 09 注入)

引擎只依赖接口,所有实现由对应文档拥有并在装配层(`@sylux/core` 的 `wireEngine`)注入。**v2 关键变更(H1/H2/H3)**:删除 v1 自造的 `Brakes`/`BrakeResult`,改注入收敛刹车 04 的 `StopPolicy`(已是 `CompositeStopPolicy`,内含三重刹车 + `DonePolicy` + 本范式的 `PlaybookDonePolicy`);新增 `agentRuntime` 解析 `AgentInput` 里非 playbook 决定的字段(workdir/env/overrides/ephemeral)。

```ts
import type {
  StopPolicy, StopContext, StopDecision, // 收敛刹车 04(权威)
} from '@sylux/core/stop';                // 04 物理落点
import type { AgentAdapter, AgentInput, ProviderOverrides } from '@sylux/agents'; // 适配 05/06
import type { WorktreeManager, MergeResult } from '@sylux/worktree';              // 隔离 09

export interface EngineDeps {
  blackboard: Blackboard;                       // 本文件 §4.2
  adapters: Record<AgentId, AgentAdapter>;      // 适配 05/06(仅 codex/claude;human/orchestrator 不在此)
  /**
   * ★H1:统一终止裁决。装配层用 04 的 CompositeStopPolicy 组装:
   *   [PlaybookDonePolicy(本范式 isDone) , DonePolicy(通用 done+ack) , MaxRoundsPolicy , ConvergencePolicy , BudgetPolicy(前瞻)]
   * 引擎每轮末 update→shouldStop 调一次(§5.1),不感知内部有几条刹车。
   */
  stopPolicy: StopPolicy;                       // 收敛刹车 04
  /** 内容防火墙函数(安全 08 §4)。喂对面前逐条过滤;不是对象方法,是纯函数。 */
  firewall: (msg: Message) => FirewallResult;   // 安全 08:= firewallPeerMessage
  worktrees: WorktreeManager;                   // 隔离 09
  /**
   * ★H16:worktree 是否启用。M1=false(25 M1"不写文件/不建 worktree"):mergeRound 整步 no-op,
   * shouldMergeAt 返回值被忽略,files[] 仅作意图声明 evidence(不落盘/不 3-way)。M2+=true 恢复全语义。
   */
  worktreesEnabled: boolean;
  validate: (msg: AppendInput, round: number) => ValidateResult; // 黑板 02 §8 validateMessage 注入封装
  digest: DigestBuilder;                        // §2.1.1 接口;生成策略性能 17 §6.3
  /** ★H3:解析 AgentInput 里非 playbook 字段(workdir/env/overrides/ephemeral),按 agent 取。 */
  agentRuntime: AgentRuntimeResolver;           // provider 07 + 安全 08 + 隔离 09 合成
  logger: Logger;                               // 脱敏日志(安全 08 redact 通路)
}

/** 安全 08 firewallPeerMessage 的返回(本文件按结构引用,不另定义实现)。 */
export type FirewallResult =
  | { action: 'pass'; wrapped: string }   // 干净:已包边界标记封套,直接拼入
  | { action: 'flag'; wrapped: string; reasons: string[] } // 命中特征但降级放行(已封套)
  | { action: 'block'; reason: string };  // 拦截:不拼入,落 system 打回(连续耗尽→INJECTION_BLOCKED)

/** ★H3:把"该 agent 这轮在哪个 worktree、带什么 env/override、是否 ephemeral"解析出来。 */
export interface AgentRuntimeResolver {
  /** 该 agent 的 worktree 绝对路径(隔离 09 创建/分配)。 */
  workdir(agent: AgentId): string;
  /** buildChildEnv 出口的 env 白名单产物(安全 08;含 provider key,只在此通路)。 */
  providerEnv(agent: AgentId): Record<string, string>;
  /** provider 非密覆盖(provider 07 绑定;base_url/wire_api/model)。 */
  providerOverrides(agent: AgentId): ProviderOverrides;
  /** 沙箱上限(playbook.params.sandboxCeiling 与安全 08 封顶取交,绝不超 workspace-write)。 */
  sandbox(agent: AgentId): 'read-only' | 'workspace-write';
  /** 是否一次性不落盘(playbook/run 配置)。 */
  ephemeral(agent: AgentId): boolean;
}
```

> **`PlaybookDonePolicy`(H2,引擎装配层提供的薄包装)**:把 `playbook.isDone(board)` 适配成 04 的 `StopPolicy`,塞进 `CompositeStopPolicy` 的 done 优先级档(与 04 通用 `DonePolicy` 并列,任一为真即 done)。这样"范式特定完成"与"通用 done+ack"统一走 04 的优先级裁决,引擎主循环**不再**出现 `if(playbook.isDone)` 分支(消除 v1 双重检测)。
>
> ```ts
> /** 引擎装配层薄包装:playbook.isDone → StopPolicy(注入 04 CompositeStopPolicy)。 */
> export class PlaybookDonePolicy implements StopPolicy {
>   readonly id = 'playbook-done';
>   constructor(private readonly playbook: Playbook, private readonly view: () => BoardView) {}
>   update(_ctx: StopContext): void { /* 无状态:isDone 是纯读派生 */ }
>   shouldStop(_ctx: StopContext): StopDecision {
>     return this.playbook.isDone(this.view())
>       ? { shouldStop: true, status: 'done', reason: `playbook(${this.playbook.id}) 范式完成` }
>       : KEEP_RUNNING;
>   }
> }
> ```

### 4.3.1 `validate` 桥接契约(H12:`EngineDeps.validate` ↔ 02 `validateMessage`)

02 §8.1 的权威实现是 `validateMessage(msg: Message, ctx: ValidateContext): ValidateResult`,入参是**已盖章的 `Message`** + 一个 `ValidateContext`(02 §8 定义,含 board 快照/路径白名单/round 等)。但引擎在 `runTurn`(§5.2)拿到的是**尚未盖章的 `AppendInput`** + 当前 `round`,两者入参类型与第二参语义都不同(D6)。`EngineDeps.validate` 因此是**装配层(`@sylux/core` wireEngine)提供的桥接闭包**,不是 02 的原函数:

```ts
/** H12:装配层把引擎侧 (AppendInput, round) 桥接到 02 权威 validateMessage(Message, ValidateContext)。 */
export type EngineValidate = (cand: AppendInput, round: number) => ValidateResult;

function makeEngineValidate(deps: {
  view: () => BoardView;
  pathAllowlist: readonly string[];   // 安全 08 / 隔离 09 提供
  validateMessage: typeof import('@sylux/shared').validateMessage; // 02 权威,原样转调
}): EngineValidate {
  return (cand, round) => {
    // 1) AppendInput → Message"草样":补盖 id/ts/schemaVersion 的占位(校验只读这些字段格式,不依赖真实值)
    const draft: Message = stampDraft(cand);             // 02 §5.1 字段补全(校验态占位 id/ts)
    // 2) 组装 02 ValidateContext:board 快照 + 路径白名单 + 当前 round(承载 03 的 round 语义)
    const ctx: ValidateContext = { board: deps.view(), round, pathAllowlist: deps.pathAllowlist };
    // 3) 转调 02 权威实现(safeParse + 跨字段 + evidence 可核验,02 §8)
    return deps.validateMessage(draft, ctx);
  };
}
```

> **桥接不变量**:① 03 **不重新实现**任何校验逻辑,只做入参形状转换;真伪判定全在 02。② `round` 从 03 的"第二位标量参数"映射进 02 `ValidateContext.round`,语义对齐(02 用它判 `inReplyTo` 是否悬空、evidence 是否引当前可见轮)。③ 校验态的 `id/ts/schemaVersion` 是占位(02 校验只看格式合法性,真实盖章在 `Blackboard.append` 通过后做,§4.2)。回填 02 §8:注明"引擎侧入口经 03 §4.3.1 桥接,02 `validateMessage` 签名不变"。

---

## 5. 引擎循环 runEngine(范式无关本体)

### 5.1 主循环(伪代码,失败路径齐全)

```ts
export async function runEngine(playbook: Playbook, deps: EngineDeps): Promise<RunResult> {
  const bb = deps.blackboard;
  await bb.setStatus('running');
  await playbook.onStart(deps);

  try {
    let round = bb.view().currentRound; // 引擎本地持有轮号(H1:closeRound 不隐式推进控制流)
    while (true) {
      // ── 1. playbook 决定本轮计划(谁/扮谁/看什么)──
      const plan = playbook.nextTurn(bb.view());
      if (plan.turns.length === 0) {
        // 防御(H9):正常情况下,"全部完成"应已被上一轮末 stopPolicy 的 PlaybookDonePolicy 截停,
        // 走不到这里。若仍走到 → playbook 逻辑 bug(该 done 没 done),硬停而非空转(E7)。
        return await finalize(playbook, deps, 'aborted', 'EMPTY_ROUND_PLAN');
      }

      // ── 2. 执行发言(串行 await / 并行 Promise.all,各写各 worktree,E5)──
      //    超时由 AgentInput.timeoutMs 驱动,适配器到点 cancel() 杀进程树(适配 05 §10)。
      const results =
        plan.execution === 'parallel'
          ? await Promise.all(plan.turns.map((t) => runTurn(t, round, deps)))
          : await sequential(plan.turns, (t) => runTurn(t, round, deps));

      // ── 3. 写黑板(仅成功 turn;失败 turn 已在 runTurn 内落 system 消息)──
      for (const r of results) {
        if (r.ok) await bb.append({ from: r.directive.agent, role: r.directive.role, round, payload: r.payload });
      }

      // 致命失败(闸门前 spawn 不可恢复 / 重试耗尽 / firewall 连续 block 耗尽)→ 写 system 后硬停(E7,H4)
      const fatal = results.find((r) => !r.ok && r.fatal);
      if (fatal) return await finalize(playbook, deps, 'aborted', fatal.code);

      // ── 4. 轮末合并(parallel 关键路径;冲突硬停,E5/隔离 09)──
      //    H16:M1(worktreesEnabled=false)整步 no-op——不建 worktree、不 3-way,files 仅意图声明 evidence。
      if (deps.worktreesEnabled && playbook.shouldMergeAt(round, bb.view())) {
        const merge: MergeResult = await deps.worktrees.mergeRound(round);
        if (!merge.ok) {
          // 合并冲突:写 system 消息回灌冲突 evidence,置人工裁决态(不静默重试,不选边)
          await bb.append(systemMessage(round, 'WORKTREE_CONFLICT', merge.conflictEvidence));
          await bb.setStatus('paused', { code: 'WORKTREE_CONFLICT' }); // 等面板 10/11 人工裁决
          return await finalize(playbook, deps, 'paused', 'WORKTREE_CONFLICT');
        }
      }

      // ── 5. 关轮(落指纹集合 + usage,02 §7.1);必在 stopPolicy 之前(04 §2.4 顺序铁律)──
      await bb.closeRound(round);

      // ── 6. 统一终止裁决(H1/H2):先 update 全部子刹车,再 shouldStop 统一裁决(04 §2.3)──
      //    composite 内含:PlaybookDonePolicy + 通用 DonePolicy + MaxRounds + Convergence + 前瞻 Budget。
      //    无前置刹车:轮数/token 的"提前抢停"由 04 前瞻预算刹车在此用 lastRoundUsage 预测累积(事实 D)。
      //    H15:plan.stallEligible 经 buildStopContext 透传,04 ConvergencePolicy 只对资格轮累计 stall。
      const ctx = buildStopContext(bb.view(), round, plan); // = 04 StopContext 投影(§5.1.2)
      deps.stopPolicy.update(ctx);
      const decision = deps.stopPolicy.shouldStop(ctx);
      if (decision.shouldStop) {
        // 04 §2.4:引擎写一条 system 消息(刹车原因)+ 落 status_changed,再终止
        await bb.append(systemMessage(round, decision.code ?? 'STOP', [], decision.reason));
        return await finalize(playbook, deps, decision.status ?? 'stalled', decision.code ?? decision.reason);
      }

      // 下一轮:引擎推进本地轮号(与 bb 的 currentRound 对齐,见 §5.1.1)
      round += 1;
    }
  } catch (e) {
    // E7:任何未预期异常显式落终态,不吞
    await bb.setStatus('aborted', { code: 'ENGINE_FATAL', reason: String((e as Error)?.message ?? e) });
    return await finalize(playbook, deps, 'aborted', 'ENGINE_FATAL');
  }
}

async function finalize(playbook: Playbook, deps: EngineDeps, status: RunStatus, reason?: string): Promise<RunResult> {
  await deps.blackboard.setStatus(status, { reason });
  await playbook.onFinish(status, deps.blackboard.view());
  return { status, reason, runId: deps.blackboard.runId };
}
```

#### 5.1.1 轮号归属与 done/stall 在循环中的位置(消歧)

- **轮号单一权威**:`Blackboard.closeRound(round)` 落盘并把 `BoardState.currentRound` 推进到 `round+1`;引擎本地 `round` 变量是控制流游标,每轮末 `+1` 与之对齐。两者**同源不冲突**:引擎从不读"自增后的 bb.currentRound"做本轮判断,只在循环顶用一次初始值,之后自管游标(避免 v1"currentRound 由 closeRound/append 隐式推进"的歧义)。
- **done 与 stall 都在第 6 步**:二者同属 04 的 `CompositeStopPolicy`,按优先级(done=0 > limit > stall)在同一次 `shouldStop` 里裁决(04 §8.2)。引擎**不再**有独立的 `if(playbook.isDone)`(H2)——范式特定 done 已通过 `PlaybookDonePolicy` 进 composite。`PLAYBOOK_DONE` 这个 v1 错误码随之废弃(done 出口正常完成无错误码,04 §2.2)。
- **为何无前置刹车**:事实地基 D 表明成本对累积/超线性,"下一轮会不会超预算"只能用"刚结束这轮的 `lastRoundUsage`"前瞻预测——这正是 04 的前瞻预算刹车(S4)在后置 `shouldStop` 里做的事。引擎再设 `checkBefore` 既重复又无新信息(轮顶时本轮 usage 尚未产生),故删除(H1)。`maxResumeChain` 是唯一的"轮内、调 adapter 前"护栏,落在 `runTurn`(§5.2),它不读 token、只数 resume 链长,O(1) 本地判定。

#### 5.1.2 `buildStopContext` —— 引擎侧 03 拥有的 StopContext 投影(H10/H15)

`buildStopContext` 是**引擎(03)拥有**的纯函数适配器,把引擎内部的 `BoardView` + 当前 `round` + 本轮 `RoundPlan` 投影成收敛刹车 04 消费的 `StopContext`(D4 了结:04 **不再**自己声明 `buildStopContext(BoardState)` 入参,只定义并消费 `StopContext` 类型)。它是 03→04 的唯一数据出口,承载 H15 的 stall 资格位:

```ts
/** H10:引擎侧投影。BoardView + round + 本轮 plan → 04 StopContext。04 只消费 StopContext,不拥有此函数。 */
function buildStopContext(board: BoardView, round: number, plan: RoundPlan): StopContext {
  const rounds = board.rounds;
  return {
    runId: board.runId,
    round,
    // 累积/前瞻预算刹车(04 S4)用:本轮 usage + 历史累积(事实地基 D)
    lastRoundUsage: rounds.at(-1)?.usage,
    totalUsage: sumUsage(rounds),
    // stall 差集(02 §9.3):本轮新 evidence 指纹集合,04 ConvergencePolicy 据此算连续空轮
    evidenceFingerprints: rounds.at(-1)?.evidenceFingerprints ?? [],
    // ★H15:本轮是否计入 stall streak。默认 true;非资格轮(主从派活/验收通过、parallel)由 plan 标 false。
    //   04 ConvergencePolicy 对 false 轮跳过(不累加不清零),只在资格轮上累计"连续 window 轮空指纹"。
    stallEligible: plan.stallEligible ?? true,
    // done 判定(04 DonePolicy + 经 PlaybookDonePolicy 注入的范式 done)读 board 末尾消息;此处透传只读视图句柄
    board,
  };
}
```

> **D4 回填 04**:04 §2.4/§10 原写的 `buildStopContext(BoardState): StopContext` 删除,改为"`StopContext` 由引擎 03 §5.1.2 投影后注入 `update/shouldStop`"。04 保留 `StopContext` **类型定义**(它是 04 的接口契约),但**不拥有构造函数**——构造在引擎侧,因为只有引擎同时握有 `BoardView`、控制流 `round`、本轮 `plan`(stall 资格位的来源)。
> **H15 与 04 的协作**:`ConvergencePolicy` 内部维护 `emptyStreak`;收到 `stallEligible===false` 的 `ctx` 时**直接 return 不动 streak**(既不累加也不清零),只在 `true` 轮按"差集是否空"累加/清零。这样主从范式 plan/review-accept 轮、parallel 全程不会污染 stall 计数,FEAS-5 的合法空证据轮误杀被根除;而 red-blue/pair 的对抗轮仍正常累计。

### 5.2 单次发言 runTurn(装配 AgentInput → 选 send/resume → 校验 → 重试)

v2 对齐适配层 05 的 `AgentInput`(H3)、崩溃分类(H4)、firewall 真实签名(H6)、resume 链护栏(H7)。

```ts
type TurnResult =
  | { ok: true; directive: TurnDirective; payload: AgentMessagePayload; usage?: TokenUsage }
  | { ok: false; directive: TurnDirective; code: SyluxErrorCode; fatal: boolean };

async function runTurn(directive: TurnDirective, round: number, deps: EngineDeps): Promise<TurnResult> {
  const { agent, role, promptContext } = directive;
  const adapter = deps.adapters[agent];

  // 1. 渲染 prompt(§2.3):delta 每条过 firewallPeerMessage;block 条不拼入(H6/E3/安全 08)
  const rendered = renderPrompt(promptContext, deps.firewall, deps.digest);
  if (rendered.allBlocked) {
    // 全部 delta 被 firewall block 且无其他可喂内容 → 无法构造有效输入,落 system 非致命失败
    await deps.blackboard.append(systemMessage(round, 'INJECTION_BLOCKED', [], rendered.blockReason));
    return { ok: false, directive, code: 'INJECTION_BLOCKED', fatal: false };
  }

  // 2. 装配 AgentInput(H3:prompt 由 playbook 上下文决定;其余字段经 agentRuntime 解析,适配 05 §2)
  const rt = deps.agentRuntime;
  const baseInput: AgentInput = {
    prompt: rendered.prompt,
    outputSchema: buildAgentOutputJsonSchema(promptContext.expectedKind), // 02 §6.2,传对象,文件/内联落点吃进适配器
    workdir: rt.workdir(agent),               // 隔离 09
    sandbox: rt.sandbox(agent),               // 安全 08 封顶 workspace-write(playbook 无法请求 danger)
    providerEnv: rt.providerEnv(agent),       // 安全 08 buildChildEnv 出口(key 只在此通路)
    providerOverrides: rt.providerOverrides(agent), // provider 07(绝不含 key)
    timeoutMs: turnTimeout(directive, deps),  // 到点 adapter.cancel() 杀进程树(适配 05 §10)
    ephemeral: rt.ephemeral(agent),
  };

  // 3. ★H7:maxResumeChain 护栏——选 send vs resume 前,先看本 agent 连续 resume 链长
  const sess = deps.blackboard.view().sessionOf(agent);
  const wantResume = promptContext.continuity === 'resume' && sess.resumable && !!sess.sessionId;
  const chainLen = resumeChainLength(deps.blackboard.view(), agent); // 连续 resume 段已用轮数
  const overChain = chainLen >= playbookParams(deps).maxResumeChain;
  const useResume = wantResume && !overChain; // 超链则强制降级 stateless+digest(事实 D 累积爆点)
  if (wantResume && overChain) {
    deps.logger.info(`resume chain capped for ${agent} (chainLen=${chainLen}); degrade to stateless`);
  }

  let attempt = 0;
  let rejectFeedback: string | undefined; // 上次打回原因(回灌,经 firewall 包边界)

  while (attempt <= playbookParams(deps).retryOnReject) {
    const input = withFeedback(baseInput, rejectFeedback, deps.firewall);
    const stream = useResume
      ? adapter.resume(sess.sessionId!, input)
      : adapter.send(input);

    // 4. 消费事件流(§5.3),区分闸门前/后崩溃(H4,适配 05 §6 F-a/b/c)
    const parsed = await consume(stream, deps);

    if (parsed.kind === 'spawn_failed') {
      // 闸门前死(F-a/F-b):没拿到 session_started,绝不伪造可 resume(适配 05 A1/A2,02 I5)
      // 首轮致命(无 id 可续、无既有进度);非首轮可降级 stateless 重来一次(§8 退化路径)
      const isFirstTurnForAgent = !sess.resumable;
      return { ok: false, directive, code: 'SUBPROCESS_SPAWN_FAILED', fatal: isFirstTurnForAgent };
    }
    if (parsed.kind === 'crashed_after_gate') {
      // 闸门后死(F-c:turn 中途死 / 超时 cancel / 中转断流):id 已落 agent_session(02 §7.1)
      // 可 resume 续接(代价:事实 D 累积计费),或 stateless 重来。本轮按可重试处理(非致命)
      if (parsed.sessionId) await deps.blackboard.recordSession(agent, parsed.sessionId);
      if (attempt < playbookParams(deps).retryOnReject) { attempt++; continue; }
      await deps.blackboard.append(systemMessage(round, parsed.code, []));
      return { ok: false, directive, code: parsed.code, fatal: false }; // SUBPROCESS_CRASHED/CANCELLED
    }
    if (parsed.sessionId) await deps.blackboard.recordSession(agent, parsed.sessionId);

    // 5. safeParse + 跨字段 + evidence 可核验(黑板 02 §8 validateMessage)
    const candidate: AppendInput = { from: agent, role, round, payload: parsed.payload! };
    const v = deps.validate(candidate, round);
    if (v.ok) return { ok: true, directive, payload: parsed.payload!, usage: parsed.usage };

    // 6. 打回处理(02 §8.4 错误码 → 动作)
    if (isRetriable(v.code)) {                 // OUTPUT_SCHEMA_VIOLATION / EVIDENCE_REQUIRED / EVIDENCE_UNVERIFIABLE
      rejectFeedback = buildRejectFeedback(v); // 回喂文本下一轮经 firewall 包边界(02 §8.4 注,防二次注入)
      attempt++;
      continue;
    }
    // 不可重试的协议违规(路径越界/悬空 inReplyTo/system 伪造):落 system,计无效发言,非致命
    await deps.blackboard.append(systemMessage(round, v.code, []));
    return { ok: false, directive, code: v.code, fatal: false };
  }
  // 重试耗尽(schema/evidence 始终不达标)
  return { ok: false, directive, code: 'OUTPUT_SCHEMA_VIOLATION', fatal: false };
}
```

> **`turnTimeout` 与 cancel 语义(H3)**:`timeoutMs` 取 `directive` 显式值或 run 级默认(配置 16);适配器内部计时,到点调 `adapter.cancel()` 杀进程树并 emit `error:SUBPROCESS_CANCELLED`(适配 05 §10)。该事件在 `consume` 里归为 `crashed_after_gate`(若已过闸门)或 `spawn_failed`(若闸门前超时)。
>
> **`resumeChainLength`(H7)**:从 `BoardView` 数本 agent"自上次 `send`(新会话)以来连续 `resume` 的轮数"。一旦 `recordSession` 写入新 sessionId(= 走了 `send`),链长归零。它是纯派生、O(近期轮数)的本地计算,不读 token——与 04 的前瞻 token 预算刹车正交叠加:前者按"会话累积深度"防 resume 成本曲线爆,后者按"绝对 token 总量"封顶。

### 5.3 事件流消费 consume(02 §6.3 AgentEvent → payload + usage)

```ts
async function consume(stream: AsyncIterable<AgentEvent>, deps: EngineDeps) {
  let sessionId: string | undefined;
  let raw: string | undefined;
  let usage: TokenUsage | undefined;
  let sawSessionStarted = false;

  for await (const ev of stream) {
    switch (ev.kind) {
      case 'session_started':            // I5:必为首事件
        sawSessionStarted = true;
        sessionId = ev.sessionId;
        break;
      case 'delta':
      case 'tool_call':
        deps.logger.stream(ev);          // 透传面板观战(面板 10 / WS 11),不入黑板
        break;
      case 'final_message':
        raw = ev.raw;                    // 待 safeParse 的最终 JSON 文本(02 §6.3)
        usage = ev.usage;                // 取自 turn.completed.usage(事实地基 B/D)
        break;
      case 'error':
        // H4:闸门后崩溃(已 emit session_started)→ crashed_after_gate(可 resume);否则 spawn_failed
        return sawSessionStarted
          ? { kind: 'crashed_after_gate' as const, code: ev.code, sessionId, detail: ev.detail }
          : { kind: 'spawn_failed' as const, code: ev.code, detail: ev.detail };
    }
  }
  // 进程结束但没 session_started → 闸门前 spawn/启动期崩溃(事实地基 A/B,02 §6.3,适配 05 F-a/F-b)
  if (!sawSessionStarted) return { kind: 'spawn_failed' as const };
  // 有 session_started 但无 final_message(turn 中途断流)→ 闸门后崩溃,可 resume(适配 05 F-c)
  if (raw === undefined) return { kind: 'crashed_after_gate' as const, code: 'SUBPROCESS_CRASHED', sessionId };

  // raw → AgentMessagePayload(02 §6.1 瘦子集),safeParse 失败在 runTurn 的 validate 阶段统一处理
  const r = agentMessagePayloadSchema.safeParse(safeJsonParse(raw));
  if (!r.success) return { kind: 'parsed' as const, sessionId, payload: undefined, usage, parseError: r.error };
  return { kind: 'parsed' as const, sessionId, payload: r.data, usage };
}
```

> token 计量:`usage` 直接取 `final_message.usage`(源自 codex `turn.completed.usage`,中转回吐可靠,事实地基 B/D),不本地估算。逐轮 `usage` 在 `closeRound` 汇入 `Round.usage`,全 run 汇入 `BoardState.totalUsage`,喂收敛刹车 04 的累积/前瞻预算刹车。
>
> **闸门分类铁律(H4)**:`consume` 三类返回——`spawn_failed`(闸门前,无 sessionId,不可 resume)、`crashed_after_gate`(闸门后,有 sessionId,可 resume)、`parsed`(正常,payload 可能因 safeParse 失败为 undefined→走 validate 打回)。**绝不**在没收到 `session_started` 时伪造一个让上层误判可 resume(适配 05 A1/A2,02 不变量 I5)。`parseError` 透传给 validate,统一计 `OUTPUT_SCHEMA_VIOLATION` 重试。

---

## 6. 四范式对照表(同一接口,四套参数)

四范式是**同一 `runEngine` + 同一 `Playbook` 接口**填不同参数与 `nextTurn` 实现的产物(锁定决策 §3)。引擎本体一行不改;差异全部落在三处:① `assignment`(角色→agent 默认查表);② `params`(刹车/续接默认值);③ `nextTurn` / `shouldMergeAt` / `isDone` 三个方法的范式逻辑。下表是四范式在这些维度上的权威对照,实现时逐范式对照本表自检。

### 6.1 主维度对照(谁主导 / 轮转 / 角色指派 / 停条件)

| 维度 | 红蓝对抗 `red-blue` | 主从规划执行 `master-worker` | 对等结对 `pair` | 分工并行 `parallel` |
|---|---|---|---|---|
| **谁主导**(发言驱动) | 无固定主导,proposer 起手、critic 追打,交替对抗 | planner 主导:派活、验收、决定推进/打回 | 完全对等,无主导,双方轮流既提既批 | 中枢 onStart 派活后**无运行期主导**,两 worker 各跑各的 |
| **`execution`** | `serial`(turns.length===1) | `serial` | `serial` | `parallel`(turns.length===2) |
| **轮转规则**(`nextTurn` 选谁) | 奇偶交替:偶轮 proposer、奇轮 critic(§7.1) | 状态机:plan→implement→review→(accept→下一子任务 / reject→重 implement)(§7.2) | 严格交替上一条的对面;首轮 peerA(§7.3) | 无轮转:每轮两 turn 并发,各自独立子任务线(§7.4) |
| **角色指派**(`assignment` 默认) | `{proposer: codex, critic: claude}`(可换) | `{planner: claude, worker: codex}`(可换) | `{peer: <两 agent 轮流>}`,assignment 无法表达,靠 `nextTurn` 逐轮指定 agent(P3) | `{worker: <两 agent 各一>}`,同上靠 `nextTurn` 逐 turn 指定 agent(P3) |
| **role ⊥ agent**(E1) | critic 可指派给任一 agent,只改 assignment | planner/worker 可互换物理 agent | 两 peer 物理 agent 可任意 | 两 worker 物理 agent 任意 |
| **`continuity` 默认** | `stateless`(长程辩论,resume 累积成本会爆,事实地基 D) | `resume`(planner→worker 短程强耦合,§2.1)或子任务内 resume、跨子任务 stateless | `stateless`(对等长程) | 各 worker 子任务线内可 `resume`,默认 `stateless` |
| **evidence 强制点**(02 §5.2 C1) | critic 每条 critique 强制可核验 evidence | planner 的 reject 走 `critique` 时强制;worker 的 implement 不强制 | 任一方发 `critique` 即强制(role=peer 不豁免) | 不强制(worker 各干各的,无对抗;done 收口才需 ack 证据) |
| **`shouldMergeAt`** | 每轮可合(串行,改动小)或仅 done 前合 | worker implement 轮末合(子任务粒度) | 每轮可合或 done 前合 | **仅子任务收口轮**合,轮末统一 3-way(E5/隔离 09) |
| **`isDone`**(范式完成) | 通用 done+ack 归 04 `DonePolicy`;本范式无额外门(isDone 恒 false) | 子任务清单全 accept 后才 true(通用门覆盖不到清单状态) | 通用 done+ack 归 04;双向 ack 由本范式 isDone 补 | 全 worker `done`(无 ack,通用门不适用,全靠本范式 isDone) |
| **典型 stall**(02 §9.3) | 双方重复旧论点、无新 file_ref/command 指纹 → stall | 罕见(状态机推进);planner↔worker 在同一子任务反复打回无新证据 → stall | 高发:互相礼貌附和或无意义 nitpick → 收紧 `convergenceWindow` | 低发:并行任务靠完成收敛,非靠辩论;worker 卡死靠超时/轮数 limit |
| **`stallEligible`**(H15,本轮是否计入 stall) | 全轮 `true`(对抗轮) | plan `false`;implement/review `true`(review 在 accept/reject 未知时保守计入,偶发 accept 空轮由 window 吸收)(FEAS-5) | 全轮 `true` | 全轮 `false`(无对抗 evidence 概念,只靠完成/limit 收敛) |
| **主要终止刹车** | stall(吵不出新东西)/ done(吵出结论) | done(子任务清单走完)/ limit | stall / done | done(全完成)/ limit / WORKTREE_CONFLICT 硬停 |
| **`maxRounds` 量级建议** | 中(6–12),累积成本随轮超线性,谨慎 | 由子任务数 × 每子任务轮数定,通常较高 | 中(6–12) | 低(≈子任务批次数),每批一轮并发 |
| **`maxResumeChain` 建议(H7)** | 1(stateless,基本不 resume) | 3–4(子任务内 resume 段,超链降级) | 1(stateless) | 2–3(线内可短 resume) |
| **失败放大风险** | 低(串行单 agent) | 低(串行) | 低(串行) | 高:两 worker 改同文件 → 轮末合并冲突,E5 硬停回灌(隔离 09) |

### 6.2 “同一接口”落点核对(四范式 × 三方法)

下表把上表压成“每个范式各方法返回什么”的实现速查,确保四套实现没有任何一个偷偷改引擎:

| 方法 | red-blue | master-worker | pair | parallel |
|---|---|---|---|---|
| `nextTurn().execution` | `'serial'` | `'serial'` | `'serial'` | `'parallel'` |
| `nextTurn().turns.length` | `1` | `1` | `1` | `2` |
| `nextTurn().turns[].agent` | 奇偶查 assignment | 状态机查 assignment | 逐轮交替指定 | 两 worker 各一 |
| `shouldMergeAt` | `true`(小步)/ 末轮 | implement 轮 `true` | `true` / 末轮 | 仅收口轮 `true` |
| `isDone`(经 `PlaybookDonePolicy`) | 恒 `false`(通用 done+ack 归 04 `DonePolicy`) | 清单全 accept 才 `true` | 双向 ack 时 `true`(通用门覆盖单向) | 全 worker done `true`(无 ack) |
| 续接 `continuity` | `stateless` | `resume`(子任务内) | `stateless` | `stateless`(线内可 resume) |
| `maxResumeChain` | 1 | 3–4 | 1 | 2–3 |
| `stallEligible`(H15) | 恒 `true` | plan `false`,implement/review `true` | 恒 `true` | 恒 `false` |

> 关键不变量复核:无论哪个范式,**写黑板的永远是引擎(E2)、未校验不入(E2)、critic/critique 的 evidence 强制可核验(02 C1)、合并冲突硬停(E5)、终止裁决统一走 04 的 `CompositeStopPolicy`(H1/H2)**。范式只能改"谁说话、看什么、何时算完",改不动这五条。

### 6.3 四范式累积成本工作例(事实地基 D 落地,H7)

事实地基 D:基线底价 ≈18.7k input tokens/回合,resume 链上 input 累积/超线性(N 轮 ≈ base×(1+2+…+N))。下表给四范式在**典型轮数 × continuity**下的累积 input token 粗估,验证 `tokenBudget` 与 `maxResumeChain` 默认值不互相打架。`stateless` 每轮 ≈ base + digest + delta(取 ≈25k 含上下文),`resume` 第 k 轮 ≈ base×k。

| 范式 | 轮数 | continuity | 累积 input 粗估 | 对照 `tokenBudget` | 结论 |
|---|---|---|---|---|---|
| red-blue | 12 | stateless | 12 × 25k ≈ 300k | 600k | 充裕,stall 通常更早停 |
| pair | 10 | stateless | 10 × 25k ≈ 250k | 500k | 充裕 |
| master-worker | 13 子任务 × (1 plan + 3 impl-resume + 1 review) ≈ 40 轮,resume 仅在子任务内 ≤3 链 | 混合 | 子任务内 resume 段 ≈ base×(1+2+3)=6×18.7k≈112k/子任务 worst,但 maxResumeChain=3 封顶;跨子任务 stateless 归零 → 全程 ≈ 40 × ~28k ≈ 1.12M | 1.5M | **贴近但不破**;靠 `maxResumeChain=3` 阻止单子任务 resume 链无限累积 |
| parallel | 6 轮 × 2 worker | stateless(线内 ≤3 resume) | 2 × 6 × 25k ≈ 300k(两线并行计费) | 800k | 充裕;并发不改单请求计费,只是同时发生 |

> **护栏协同(H7)**:`master-worker` 是唯一逼近预算的范式。两道护栏叠加防爆:① `maxResumeChain=3` 把单子任务 resume 链的累积上界钉在 `base×(1+2+3)≈112k`,超链强制 `send` 归零(§5.2);② 04 前瞻预算刹车用 `lastRoundUsage` 预测"下一轮累积是否破 `tokenBudget`",在破之前一轮抢停(终态 `limit`)。二者一个管"会话深度",一个管"绝对总量",对 resume 成本曲线双重设防。【待实测 Q1】claude 端 resume 累积曲线是否与 codex 同形,直接影响本表 master-worker 估算。
>
> **★H17 预算口径(ROC-B1,纠正 16 默认表误配)**:本表的 `tokenBudget` 默认值是按**该范式 continuity 的真实成本曲线**估的,**口径必须分 regime**:
> - **stateless 范式(red-blue/pair/parallel)= 线性** `≈ base'×N`(base' 含 digest+delta ≈25k,N=轮数;parallel 再 ×lane 数)。这三个范式每轮全新会话,**绝不**累积全历史,**严禁套 resume 超线性公式**。如 red-blue 12 轮 ≈ 300k,而非 `base×N(N+1)/2×1.2≈808k`。
> - **resume 段(master-worker 子任务内)= 累积** `≈ base×(1+2+…+k)`,k≤`maxResumeChain`,跨子任务 `send` 归零后线性叠加(见上表 master-worker 行)。
>
> 配置层 16 §6.4 的默认预算表**必须**按本口径(= 18 §6.4 的 regime 分叉 `estimateRunTokens`)给值:对 stateless 范式用线性、只对 resume 段用累积。16 v1 对三个 stateless 默认范式误套 `base×N(N+1)/2×1.2`(把 red-blue 估成 808k)是 ROC-B1 blocker——会让 B3 预算网在默认配置下对 stateless 形同虚设(预算被抬高 3.6×,永远刹不住)。**本文件 §7 各范式 `params.tokenBudget` 字面量即按线性口径给定,16 应直接采用或按 18 公式重算,不得反向用 resume 公式覆盖。**

---

## 7. 逐范式 nextTurn 伪代码

四个 `nextTurn` 共享同一辅助:`pc(...)` 构造 `PromptContext`(§2.2),`assign(role)` 查 `assignment` 默认 agent。每个范式额外持有少量**私有状态**(放 playbook 实例字段,不污染 `BoardState`)。所有伪代码入参 `board: BoardView`(§4.1,只读)。

```ts
/** 四范式共用的 PromptContext 构造助手(省略具体 digest/firewall 调用,见 §2/§4.3)。 */
function pc(opts: {
  continuity: ContinuityMode; goal: string; digest: string;
  delta: readonly Message[]; roleBrief: string; expectedKind: MessageKind; contextCap: number;
}): PromptContext { return { ...opts }; }
```

> 伪代码里的 `buildDigest(board)` 是 `deps.digest.build(board, board.currentRound-1, { maxTokens, bypassFirewall })` 的简写(§2.1.1 `DigestBuilder`)。`bypassFirewall` 由范式定:parallel 走纯自方任务线文本可 `true`(无 peer 注入面);含 peer 历史的范式(red-blue/pair/master-worker)应走结构化 evidence(H5 路径①)或令引擎对 digest 再过一次 firewall(H5 路径②)。`systemMessage(round, code, evidence, reason?)` 是引擎侧助手,产 `kind:'system'`、`from:'orchestrator'` 的已校验消息(02 C7)。
### 7.1 红蓝对抗 red-blue

奇偶交替:偶轮 proposer 出/改方案,奇轮 critic 追打。critic 的 critique 由 02 §8 强制可核验 evidence(空泛批判被 `EVIDENCE_REQUIRED`/`UNVERIFIABLE` 打回,§5.2)。done 需对面带证据 ack(由 04 通用 `DonePolicy` 裁,故本范式 `isDone` 恒 false,H2);stall 与 done 解耦(E4):反复旧论点无新指纹 → 04 `ConvergencePolicy` 判 stall。

```ts
class RedBluePlaybook implements Playbook {
  readonly id = 'red-blue' as const;
  readonly name = '红蓝对抗';
  readonly assignment = { proposer: 'codex', critic: 'claude' } as const;
  readonly params: PlaybookParams = {
    maxRounds: 12, convergenceWindow: 3, tokenBudget: 600_000,
    perTurnContextCap: 8_000, sandboxCeiling: 'workspace-write',
    defaultContinuity: 'stateless', retryOnReject: 3, maxResumeChain: 1,
  };
  private goal = '';
  async onStart(deps: EngineDeps) { this.goal = await loadGoal(deps); }

  nextTurn(board: BoardView): RoundPlan {
    const r = board.currentRound;
    const isCriticTurn = r % 2 === 1;          // 偶 proposer / 奇 critic
    const role: Role = isCriticTurn ? 'critic' : 'proposer';
    const agent = this.assignment[role];        // E1:换 critic 归谁只改这张表
    const last = board.lastMessage();           // 对面上一条 = 本轮唯一 delta(E3 只喂增量)
    const roleBrief = isCriticTurn
      ? '你是红队 critic。逐条挑漏洞,每条批判必须带可机器核验 evidence(file_ref 行区间+contentHash 或 command 期望/实际),空泛批判会被打回重发。'
      : '你是 proposer。针对上一条 critique 修订方案或给出新方案;能落代码就在 files 声明改动意图。';
    return {
      execution: 'serial',
      turns: [{
        agent, role,
        kindHint: isCriticTurn ? 'critique' : 'propose',
        promptContext: pc({
          continuity: 'stateless',              // 长程辩论:resume 累积成本会爆(事实地基 D)
          goal: this.goal,
          digest: buildDigest(board),           // §2.1.1 DigestBuilder(策略 17 §6.3),非全历史;受 H5 注入约束
          delta: last ? [last] : [],
          roleBrief,
          expectedKind: isCriticTurn ? 'critique' : 'propose',
          contextCap: this.params.perTurnContextCap,
        }),
      }],
    };
  }

  // 改动小、串行:可每轮合,让 critic 能用 file_ref 引最新 worktree 内容
  shouldMergeAt(_round: number, _board: BoardView) { return true; }

  // 范式完成:红蓝的"done+对面带证据 ack"是 04 通用 DonePolicy 的标准判据(H2),
  // 本范式无额外完成门,故 isDone 恒 false——把 done 判定权完全交给 04 的 DonePolicy,
  // 避免与之双重检测(v1 在此重复实现了一遍 done+ack,删除)。stall 由 04 ConvergencePolicy 独立判(E4)。
  isDone(_board: BoardView): boolean { return false; }
  async onFinish() {/* 红蓝无额外状态 */}
}
```

> **为何 red-blue/pair 的 isDone 恒 false 而 master-worker/parallel 不是(H2 关键)**:04 通用 `DonePolicy` 的判据是"本轮有 `kind:done` + 对面带证据 `ack`"。red-blue 与 pair 的完成正好是这个形状,直接复用 04,本范式 `isDone` 不掺和。master-worker 多一道"子任务清单全 accept"的门(光有 done+ack 不够,清单没走完不算完),parallel 则**根本没有 ack**(worker 各干各的,完成靠"全部发过 done"),这两者通用判据覆盖不到,才需本范式 `isDone` 经 `PlaybookDonePolicy` 补判。四范式 `isDone` 返回值见 §6.2。
### 7.2 主从规划执行 master-worker

planner 主导的状态机:`plan → implement → review →(accept→下一子任务 / reject→重 implement)`。planner 派活与验收,worker 落代码。planner 的 reject 走 `critique` 时强制可核验 evidence(02 C1);worker 的 `implement` 不强制(它产 diff,真伪由 worktree 实际 `git diff` 兜,02 §4)。子任务清单是 playbook 私有状态(不污染 `BoardState`)。续接策略:planner↔worker 在**同一子任务内** `resume`(短程强耦合,记忆有价值),跨子任务切回 `stateless`(把上个子任务压成 digest,避免累积成本,事实地基 D)。

```ts
type SubTask = { id: string; brief: string; status: 'todo' | 'doing' | 'review' | 'done' };
type MwPhase = 'plan' | 'implement' | 'review';

class MasterWorkerPlaybook implements Playbook {
  readonly id = 'master-worker' as const;
  readonly name = '主从规划执行';
  readonly assignment = { planner: 'claude', worker: 'codex' } as const;
  readonly params: PlaybookParams = {
    maxRounds: 40, convergenceWindow: 3, tokenBudget: 1_500_000,
    perTurnContextCap: 10_000, sandboxCeiling: 'workspace-write',
    defaultContinuity: 'resume', retryOnReject: 3, maxResumeChain: 3, // H7:子任务内 resume 链封顶 3,超链降级
  };
  private goal = '';
  private phase: MwPhase = 'plan';     // 状态机当前相位
  private tasks: SubTask[] = [];        // 子任务清单(planner 在 plan 相位填充)
  private cursor = 0;                   // 当前子任务下标
  async onStart(deps: EngineDeps) { this.goal = await loadGoal(deps); }

  nextTurn(board: BoardView): RoundPlan {
    // 状态机相位推进:依据【本轮已校验、期望 kind 的 agent 消息】更新(§7.2.1,H8)——
    // 不凭"上一条 message.kind",因为失败轮 orchestrator 会落 system 打回,那不是相位推进信号。
    this.advancePhase(board);
    const cur = this.tasks[this.cursor];

    if (this.phase === 'plan') {
      // planner 出/补子任务清单。首轮只有 goal,无 delta。
      const agent = this.assignment.planner;
      return this.serial(agent, 'planner', 'plan', pc({
        continuity: 'stateless',                 // 规划轮无需 worker 记忆
        goal: this.goal, digest: buildDigest(board),
        delta: board.lastMessage() ? [board.lastMessage()!] : [],
        roleBrief: '你是 planner。把目标拆成可独立验收的子任务清单(每条给可核验的验收标准 cmd/file)。已有进展见 digest,只补未完成部分。',
        expectedKind: 'plan', contextCap: this.params.perTurnContextCap,
      }));
    }

    if (this.phase === 'implement') {
      // worker 实现当前子任务。同一子任务内 resume(强耦合),保留 worker CLI 侧记忆。
      const agent = this.assignment.worker;
      return this.serial(agent, 'worker', 'implement', pc({
        continuity: 'resume',                    // 子任务内强耦合,resume 有价值(事实地基 D 权衡)
        goal: this.goal, digest: `子任务[${cur?.id}]: ${cur?.brief}`,
        delta: this.deltaForWorker(board),       // planner 的派活 + 上轮 review 的 reject 反馈
        roleBrief: '你是 worker。实现当前子任务并在 files 声明改动意图;改完给可复现验收命令作为 evidence(便于 planner review)。',
        expectedKind: 'implement', contextCap: this.params.perTurnContextCap,
      }));
    }

    // phase === 'review':planner 验收 worker 的 implement
    const agent = this.assignment.planner;
    return this.serial(agent, 'planner', 'review', pc({
      continuity: 'stateless',
      goal: this.goal, digest: `验收子任务[${cur?.id}]`,
      delta: [board.lastFrom('codex')!].filter(Boolean),  // worker 上一条 implement
      roleBrief: '你是 planner,验收 worker 的实现。通过则发 review(accept);不通过必须走 critique 并给可机器核验 evidence(file_ref/command)指出问题,空泛打回会被驳回。',
      expectedKind: 'review', contextCap: this.params.perTurnContextCap,
    }));
  }

  // worker implement 轮末按子任务粒度合并;plan/review 轮不合(无 worktree 改动)
  shouldMergeAt(_round: number, _board: BoardView) { return this.phase === 'implement'; }

  // 范式完成(H2):子任务清单全 done 是通用 DonePolicy 覆盖不到的范式门,故在此判;
  // "planner done + worker 带证据 ack"那一半由 04 通用 DonePolicy 并行判(composite 任一为真即 done)。
  // 本 isDone 只看清单门 + 是否已存在配对的 done(避免清单刚满就抢在 ack 之前误停)。
  isDone(board: BoardView): boolean {
    if (this.tasks.length === 0 || this.tasks.some((t) => t.status !== 'done')) return false;
    // 清单全 done:仍要求存在一条 planner 的 done(收口信号),通用 DonePolicy 会再校 ack 那半
    return board.byKind('done').some((m) => m.from === this.assignment.planner);
  }
  async onFinish() {/* 可产出子任务完成报告 */}

  // —— 私有助手 ——
  private serial(agent: AgentId, role: Role, kind: MessageKind, promptContext: PromptContext): RoundPlan {
    // H15:stall 资格位——只有"应产新对抗 evidence"的轮计入 stall。
    //   nextTurn 在 advancePhase 后、本轮发言前调用,此时尚不知 review 会 accept 还是 reject,
    //   故 review 相位统一标 true(保守:reject 带新 evidence 本就该计;偶发 accept 空轮被 convergenceWindow 吸收,
    //   不会单独触发 stall,除非连续 window 轮卡在无进展)。plan(派活)确定不产对抗证据 → false(FEAS-5)。
    const stallEligible = this.phase === 'implement' || this.phase === 'review';
    return { execution: 'serial', turns: [{ agent, role, kindHint: kind, promptContext }], phaseHint: this.phase, stallEligible };
  }
  private deltaForWorker(board: BoardView): readonly Message[] {
    const lastPlan = board.lastFrom('claude');   // planner 派活 / reject
    return lastPlan ? [lastPlan] : [];
  }
  private advancePhase(board: BoardView): void {/* §7.2.1 状态机转移表 */}
}
```

#### 7.2.1 master-worker 状态机转移表(advancePhase,H8 健壮版)

`advancePhase` 在每轮 `nextTurn` 开头推进相位,是主从范式的全部控制逻辑。引擎不感知相位(E1:范式逻辑全在 playbook)。

**v2 健壮化(H8)**:转移**不**凭"上一条 message.kind",而凭**本轮(刚关闭轮)里、由期望发言者发出、`kind` 等于该相位期望产出、且已校验**的那条 message。理由:失败轮里 orchestrator 会落一条 `kind:'system'` 的打回/错误消息(§5.2),它会成为"最后一条 message",若凭它推进相位会把"worker 这轮其实没成功交付"误判成已交付。因此 advancePhase 只认"**期望角色 × 期望 kind**"的成功消息作为推进信号;缺失(本轮失败/被打回/system)则**相位不前进**,下一轮重试同相位。

```ts
private advancePhase(board: BoardView): void {
  const last = board.currentRound - 1;          // 刚关闭的上一轮
  if (last < 0) { this.phase = 'plan'; return; } // 初始
  const msgs = board.messagesInRound(last);
  // 取"期望角色 × 期望 kind"的成功消息;没有 → 本相位失败,不前进(重试/stall 由 04 判)
  const ok = (role: Role, kind: MessageKind) =>
    msgs.find((m) => m.role === role && m.kind === kind);

  switch (this.phase) {
    case 'plan': {
      const plan = ok('planner', 'plan');
      if (!plan) return;                          // 规划没成功 → 仍 plan,重试
      this.tasks = parsePlan(plan); this.cursor = 0;
      if (this.tasks[0]) this.tasks[0].status = 'doing';
      this.phase = this.tasks.length ? 'implement' : 'plan';
      return;
    }
    case 'implement': {
      if (!ok('worker', 'implement')) return;     // worker 没成功交付 → 仍 implement,重试
      if (this.tasks[this.cursor]) this.tasks[this.cursor].status = 'review';
      this.phase = 'review';
      return;
    }
    case 'review': {
      const accept = ok('planner', 'review');     // accept 走 review kind
      const reject = ok('planner', 'critique');   // reject 必走 critique + evidence(02 C1)
      if (accept) {
        if (this.tasks[this.cursor]) this.tasks[this.cursor].status = 'done';
        this.cursor++;
        const next = this.tasks[this.cursor];
        if (next) { next.status = 'doing'; this.phase = 'implement'; }
        else this.phase = 'plan';                 // 清单走完 → 回 plan 让 planner 收口发 done
      } else if (reject) {
        if (this.tasks[this.cursor]) this.tasks[this.cursor].status = 'doing';
        this.phase = 'implement';                 // reject 反馈进下轮 worker delta
      } // 两者都没有(review 轮失败/system 打回)→ 仍 review,重试
      return;
    }
  }
}
```

| 当前 phase | 推进信号(本轮成功消息) | 动作 | 下一 phase |
|---|---|---|---|
| (初始,round<0) | —— | 进入规划 | `plan` |
| `plan` | `role=planner ∧ kind=plan` | 解析清单填 `tasks`,`cursor=0`,首子任务 `doing` | `implement`(清单空则留 `plan`)|
| `plan` | **无**(规划失败/被打回) | 不前进 | `plan`(重试) |
| `implement` | `role=worker ∧ kind=implement` | 当前子任务 `review` | `review` |
| `implement` | **无**(worker 失败/崩溃/被打回) | 不前进 | `implement`(重试) |
| `review` | `role=planner ∧ kind=review`(accept) | 当前 `done`;`cursor++`;下个 `doing` | `implement`;清单空 → `plan` |
| `review` | `role=planner ∧ kind=critique`(reject,带 evidence) | 当前回 `doing`,reject 进下轮 delta | `implement` |
| `review` | **无**(review 失败/system 打回) | 不前进 | `review`(重试) |

> 转移以**已校验**的 message 为准(E2);review 轮 planner 若想 reject 必须发 `critique` 且带可核验 evidence,否则被 02 §8 打回、本轮无成功 `critique`、相位不前进(防无证据空驳)。连续在同一子任务 reject↔implement 而无新 evidence 指纹 → 04 `ConvergencePolicy` 判 stall(E4),不会无限打回。**"相位不前进"叠加 retryOnReject 与 maxRounds,保证任一相位卡死最终被刹车兜住,不空转**(对抗性自检:H8 的"不前进"若无上层刹车会死循环,故必须依赖 04 的 maxRounds 作最终兜底)。

### 7.3 对等结对 pair

完全对等,无主导:双方轮流,每条既可提(`propose`)又可批(`critique`)。`assignment` 的 `Record<Role,AgentId>` 无法表达“同一 role(peer)轮流给两个 agent”,故靠 `nextTurn` 逐轮指定 `agent`(P3:内核只认 `TurnDirective.agent`)。任一方发 `critique` 即触发 evidence 强制(role=peer 不豁免,02 C1)。pair 的 stall 高发(容易互相礼貌附和),`convergenceWindow` 收紧。

```ts
class PairPlaybook implements Playbook {
  readonly id = 'pair' as const;
  readonly name = '对等结对';
  // peer 角色不绑定单一 agent;此处记录“参与结对的两个物理 agent”,轮流由 nextTurn 决定
  readonly assignment = { peer: 'codex' } as const;        // 仅占位默认;真实指派逐轮算
  private readonly peers: readonly AgentId[] = ['codex', 'claude'];
  readonly params: PlaybookParams = {
    maxRounds: 10, convergenceWindow: 2,                   // 收紧:pair 易附和,无新证据快停
    tokenBudget: 500_000, perTurnContextCap: 8_000,
    sandboxCeiling: 'workspace-write', defaultContinuity: 'stateless', retryOnReject: 3, maxResumeChain: 1,
  };
  private goal = '';
  async onStart(deps: EngineDeps) { this.goal = await loadGoal(deps); }

  nextTurn(board: BoardView): RoundPlan {
    const r = board.currentRound;
    // 严格交替:首轮 peers[0],之后取上一条的对面(E1:role 恒为 peer,agent 轮换)
    const last = board.lastMessage();
    const agent: AgentId = !last
      ? this.peers[0]
      : (last.from === this.peers[0] ? this.peers[1] : this.peers[0]);
    // 期望 kind:开局 propose;之后默认 critique(对等互评),但 agent 可自行产 propose/question(校验放行)
    const expectedKind: MessageKind = !last ? 'propose' : 'critique';
    return {
      execution: 'serial',
      turns: [{
        agent, role: 'peer', kindHint: expectedKind,
        promptContext: pc({
          continuity: 'stateless',                          // 对等长程,stateless 控成本(事实地基 D)
          goal: this.goal, digest: buildDigest(board),
          delta: last ? [last] : [],
          roleBrief: '你和对方对等结对。审视对方上一条:认同就在其基础上推进(propose),有问题就 critique 并给可机器核验 evidence(file_ref/command),不要无证据的礼貌附和——空泛话会被判无新证据而提前停。',
          expectedKind, contextCap: this.params.perTurnContextCap,
        }),
      }],
    };
  }

  shouldMergeAt(_round: number, _board: BoardView) { return true; }  // 串行小步,每轮可合

  // 完成(H2):单向"done + 对面带证据 ack"那一半由 04 通用 DonePolicy 判,本范式不重复;
  // 本 isDone 只补"双向 ack"这个对等特有门(对等无单一拍板者,两 peer 各自带证据 ack 也算成)。
  isDone(board: BoardView): boolean {
    // 双向 ack:两 peer 各自带证据 ack 了对面
    const acks = board.byKind('ack').filter((a) => a.evidence.length > 0);
    return this.peers.every((p) => acks.some((a) => a.from === p));
  }
  async onFinish() {/* 对等无额外状态 */}
}
```

### 7.4 分工并行 parallel

唯一 `execution: 'parallel'` 范式:`onStart` 派活后**无运行期主导**,两 worker 各跑各的独立子任务线,每轮两 turn 并发(`turns.length===2`),各写各 worktree(E5:运行期无锁)。合并只在**子任务收口轮**做轮末 3-way,冲突硬停回灌 evidence(E5/隔离 09),不静默重试。无对抗→ evidence 不强制(done 收口才需 ack 证据)。stall 低发(靠完成收敛而非辩论),主要靠 `maxRounds`/`tokenBudget` 兜底卡死。

```ts
class ParallelPlaybook implements Playbook {
  readonly id = 'parallel' as const;
  readonly name = '分工并行';
  readonly assignment = { worker: 'codex' } as const;       // 占位;两 worker 逐 turn 指定(P3)
  private readonly workers: readonly AgentId[] = ['codex', 'claude'];
  readonly params: PlaybookParams = {
    maxRounds: 6, convergenceWindow: 2, tokenBudget: 800_000,
    perTurnContextCap: 10_000, sandboxCeiling: 'workspace-write',
    defaultContinuity: 'stateless', retryOnReject: 3, maxResumeChain: 3, // 线内可短 resume
  };
  private goal = '';
  private lanes: Record<AgentId, { brief: string; done: boolean }> = {} as any; // 每 worker 一条任务线
  async onStart(deps: EngineDeps) {
    this.goal = await loadGoal(deps);
    // 中枢/planner 一次性切分两条独立任务线(切分逻辑可调外部 planner;此处简化为预置)
    this.lanes = await splitLanes(deps, this.workers);
  }

  nextTurn(board: BoardView): RoundPlan {
    // 两 worker 各一 turn,并发;已 done 的线不再发(turns 仅含未完成线)。
    // H9:当所有线都 done,本应在【上一轮末】PlaybookDonePolicy 已截停(§5.1 第 6 步),不会再进 nextTurn。
    // 故这里若 filter 后为空,是"应已停却没停"的逻辑 bug,引擎 §5.1 会按 EMPTY_ROUND_PLAN 硬停——
    // 这是预期的防御信号,不是正常路径(对抗性自检:确保 isDone 与 lane.done 同步更新,见下方 syncLanes)。
    this.syncLanes(board);                                  // 用本轮已校验 done 消息同步 lanes[w].done(H8/H9)
    const turns: TurnDirective[] = this.workers
      .filter((w) => !this.lanes[w]?.done)
      .map((w) => ({
        agent: w, role: 'worker', kindHint: 'implement',
        promptContext: pc({
          continuity: 'stateless',                          // 跨轮线内可改 resume;默认 stateless(事实地基 D)
          goal: this.goal,
          digest: `你的任务线: ${this.lanes[w]?.brief}`,     // 各看各的线,互不喂对面(隔离);纯自方文本,无 peer 注入面(H5)
          delta: this.laneDelta(board, w),                  // 仅本线上一条 + 任何 system 回灌
          roleBrief: '你独立负责这条任务线,与另一 worker 并行。完成在 files 声明改动意图;全部做完发 done。无需评审对方。',
          expectedKind: 'implement', contextCap: this.params.perTurnContextCap,
        }),
      }));
    return { execution: 'parallel', turns, phaseHint: 'parallel-lanes', stallEligible: false }; // H15:并行靠完成收敛,无对抗 evidence,全程不计 stall
  }

  // 仅收口轮合并:两线本轮都产出后,轮末统一 3-way(E5)。这里简化为每轮收口都合。
  shouldMergeAt(_round: number, _board: BoardView) { return true; }

  // 完成(H2):parallel 无 ack,通用 DonePolicy 不适用——全靠本范式 isDone 判"全部 worker 发过 done"。
  // merge 干净不在此判:若有冲突引擎已在 §5.1 第 4 步置 paused 提前返回,走不到 isDone(隔离 09)。
  isDone(board: BoardView): boolean {
    return this.workers.every((w) => board.byKind('done').some((m) => m.from === w));
  }
  async onFinish() {/* 可汇总两线产出 */}

  /** H8/H9:用本轮已校验 done 消息同步 lanes[w].done,保证 isDone 与 filter 口径一致,杜绝空 turns 误触发。 */
  private syncLanes(board: BoardView): void {
    for (const w of this.workers) {
      if (board.byKind('done').some((m) => m.from === w)) this.lanes[w].done = true;
    }
  }
  private laneDelta(board: BoardView, w: AgentId): readonly Message[] {
    const own = board.lastFrom(w);
    const sys = board.byKind('system').at(-1);   // 合并冲突回灌等
    return [own, sys].filter(Boolean) as Message[];
  }
}
```

> **parallel 的红队要点(E5/R7/R8)**:① 两 worker 运行期**完全隔离**——`laneDelta` 只喂自己线 + system,绝不把对面 worker 的输出喂过来(既省 token 又断注入链,R8);digest 是纯自方任务线文本,无 peer 内容,从根上无注入面(H5)。② 改同一文件的冲突**不在运行期检测**,统一在 `mergeRound` 轮末 3-way,冲突 → 写 `system` 消息(`from:orchestrator`,02 C7)回灌冲突 evidence,`setStatus('paused')` 等人工裁决(E5,不静默重试,隔离 09)。③ `isDone` 不自行判 merge 干净——若有冲突引擎已在 §5.1 第 4 步置 `paused` 提前返回,根本走不到 `isDone`,职责不重叠。④ **空 turns 防御(H9)**:`syncLanes` 保证 `isDone` 与 `filter(!done)` 用同一口径(本轮已校验 done),全 done 时上一轮末 `PlaybookDonePolicy` 已截停,不会再进 `nextTurn` 拿到空 turns;真拿到空 turns = 逻辑 bug,按 `EMPTY_ROUND_PLAN` 硬停。

---

## 8. 失败路径与边界(引擎层汇总)

四范式共用同一 `runEngine`,所有失败路径在引擎层统一处理(E7:不静默吞错),逐条对应 02 §12 错误码与 §5.1/§5.2 落点:

| 失败 | 触发点 | 引擎动作 | 终态/错误码 |
|---|---|---|---|
| spawn 失败(裸名/.cmd/真 exe 缺失) | runTurn 消费流前(闸门前) | 拿不到 `session_started` → `spawn_failed`;**首轮**(该 agent 无既有 session)致命 | `SUBPROCESS_SPAWN_FAILED` / `aborted`(事实地基 A) |
| 首事件非 session_started | consume(§5.3) | `sawSessionStarted=false` → spawn_failed | 同上(I5/事实地基 B) |
| **闸门后崩溃**(turn 中途死/超时 cancel/中转断流) | consume `crashed_after_gate`(H4) | id 已落 agent_session,**可 resume**;本轮按可重试,耗尽落 system(非致命) | `SUBPROCESS_CRASHED`/`SUBPROCESS_CANCELLED`(适配 05 F-c) |
| schema 违例(safeParse 挂) | validate 阶段 A | 带错误回灌重发 ≤retryOnReject,耗尽抛 | `OUTPUT_SCHEMA_VIOLATION` |
| critic/critique 空/不可核验 evidence | validate 阶段 B(02 §8) | 打回回灌“补 file_ref/command”,重发 ≤N | `EVIDENCE_REQUIRED`/`EVIDENCE_UNVERIFIABLE` |
| **peer 内容 firewall block**(H6) | renderPrompt 拼 delta 前(安全 08 §4) | 该条不拼入对面;落 system 打回;连续 block 耗尽 → 致命 | `INJECTION_BLOCKED`(安全 08 §4.5) |
| 路径越界 / 悬空 inReplyTo / system 伪造 | validate 跨字段(02 C6/C8/C7) | 落 system 消息,计红队“无效发言”,本轮该 agent 失败(非致命) | `WORKTREE_PATH_VIOLATION` 等 |
| worktree 轮末合并冲突 | shouldMergeAt 后 mergeRound(隔离 09) | 写 system 回灌冲突 evidence,`paused` 等人工裁决,不重试(E5) | `WORKTREE_CONFLICT` / `paused` |
| playbook 返回空 turns | runEngine §5.1 第 1 步 | "应已 done 却没停"的逻辑 bug,硬停(H9) | `EMPTY_ROUND_PLAN` / `aborted` |
| 轮数超限 | 04 `MaxRoundsPolicy`.shouldStop(每轮末) | 后置裁决命中,写 system + status_changed,正常收尾 | `ROUND_LIMIT_EXCEEDED` / `limit` |
| token 累积/前瞻超预算 | 04 前瞻预算刹车(用 lastRoundUsage 预测累积,事实 D) | 跨预算前一轮抢停 | `TOKEN_BUDGET_EXCEEDED` / `limit` |
| resume 链超 `maxResumeChain` | runTurn 选 send/resume 前(H7) | **非失败**:强制降级 `adapter.send` 全新会话,digest 兜连续性 | (无错误码,降级日志) |
| 连续 N 轮无新 evidence 指纹 | 04 `ConvergencePolicy`.shouldStop(02 §9.3) | 后置裁决命中,与 done 解耦(E4) | `CONVERGENCE_STALL` / `stalled` |
| 引擎未预期异常 | try/catch 兜底 | 落终态不吞 | `ENGINE_FATAL` / `aborted` |

> resume 退化路径(事实地基 B/E):`continuity==='resume'` 但 `sessionOf(agent).resumable===false`(没拿到过 sessionId,如首轮或上次闸门前崩溃)→ runTurn(§5.2)自动降级为 `adapter.send` 全新会话,不报错;digest 兜住连续性。这把“resume 不可用”从致命降为成本/连续性降级。`maxResumeChain` 超链降级走同一路径(H7)。

### 8.1 本节产出错误码清单(H13:回填 02 §12 `SyluxErrorCode` union 的来源)

A1/COV-1 指出 02 §12 `SyluxErrorCode` union 缺本节及兄弟文档实际产出的码,下游 `SyluxError` 与 02 §15 的 `Record` 穷举会编译红。**本节只使用 02 的类型、不另定义 union**;下表枚举**本引擎文档产出/引用**的全部错误码,作为 02 §12 回填来源(其余码由各自文档清单提供)。回填后 02 §12 应包含本表全部成员:

| 错误码 | 产出点(本文件) | 终态 | 类别 |
|---|---|---|---|
| `SUBPROCESS_SPAWN_FAILED` | consume 闸门前(§5.3/§8) | `aborted`(首轮致命) | 进程 |
| `SUBPROCESS_CRASHED` | consume 闸门后断流(§5.3 H4) | 非致命可重试/耗尽落 system | 进程 |
| `SUBPROCESS_CANCELLED` | timeoutMs 到点 cancel(§5.2/适配 05 §10) | 非致命 | 进程 |
| `OUTPUT_SCHEMA_VIOLATION` | validate safeParse 挂/重试耗尽(§5.2) | 非致命 | 校验 |
| `EVIDENCE_REQUIRED` | critic/critique 无 evidence(§5.2/02 §8) | 非致命(打回重试) | 校验 |
| `EVIDENCE_UNVERIFIABLE` | evidence 不可机器核验(§5.2/02 §8) | 非致命(打回重试) | 校验 |
| `INJECTION_BLOCKED` | firewall 连续 block 耗尽(§2.3/§5.2 H6) | 非致命/全 block 致命 | 安全 |
| `WORKTREE_PATH_VIOLATION` | files 路径越界(§5.2/02 C6) | 非致命 | 隔离 |
| `WORKTREE_CONFLICT` | mergeRound 冲突(§5.1 第4步 E5) | `paused` | 隔离 |
| `EMPTY_ROUND_PLAN` | nextTurn 返回空 turns(§5.1 H9) | `aborted` | 引擎 |
| `ROUND_LIMIT_EXCEEDED` | 04 MaxRoundsPolicy(每轮末) | `limit` | 刹车(引擎透传) |
| `TOKEN_BUDGET_EXCEEDED` | 04 前瞻预算刹车 | `limit` | 刹车(引擎透传) |
| `CONVERGENCE_STALL` | 04 ConvergencePolicy(资格轮 H15) | `stalled` | 刹车(引擎透传) |
| `ENGINE_FATAL` | runEngine try/catch 兜底(§5.1) | `aborted` | 引擎 |

> 注:`ROUND_LIMIT_EXCEEDED`/`TOKEN_BUDGET_EXCEEDED`/`CONVERGENCE_STALL` 的**权威产出在 04**,本节经 `decision.code` 透传落 system(§5.1 第6步),一并列出以求 02 union 完整。`PLAYBOOK_DONE` 已废弃(§10 Q10),**不**应在 union 中(done 出口正常完成无错误码)。`STOP` 是 `decision.code` 缺省占位,非独立错误码,02 union 不收。

---

## 9. 与下游文档的接口边界(交接锚点)

| 下游文档(角色名 + 实际文件号,防编号漂移) | 本文件提供 | 本文件依赖其提供 |
|---|---|---|
| **黑板 02** | `AppendInput` 用 02 的 `AgentMessagePayload`;`isDone`/`advancePhase` 读 02 的 `Message`/`Round`;§4.3.1 `validate` 桥接闭包(H12);§8.1 错误码清单回填 02 §12(H13);`setStatus` code 折进 reason(H11,02 不新增字段) | 全部数据类型 + `validateMessage(Message,ValidateContext)`(H12 桥接源) + 指纹 + Role/MessageKind 枚举 + §12 union(据 §8.1 补全) |
| **收敛刹车 04** | 每轮末 `update→shouldStop` 调用点;`PlaybookDonePolicy` 包装把 `playbook.isDone` 注入 composite;§5.1.2 `buildStopContext` 投影(H10,引擎拥有)透传 `stallEligible`(H15) | `StopPolicy`/`StopContext`(**类型**)/`StopDecision`/`KEEP_RUNNING`/`CompositeStopPolicy`/`DonePolicy`/`MaxRoundsPolicy`/`ConvergencePolicy`(资格轮逻辑 H15)/前瞻预算刹车;阈值、累积/前瞻 token 估算、stall 差集。**04 删自有 `buildStopContext(BoardState)`**(D4,改由 03 §5.1.2 注入) |
| **适配层 05/06** | `AgentAdapter.send/resume/cancel` 调用契约(continuity 决定调哪个;timeoutMs 驱动 cancel);`AgentInput` 装配 | `send/resume/cancel` 实现、schema 文件 vs 内联落点、AgentEvent 产出、闸门 F-a/b/c 崩溃分类 |
| **provider 07** | `AgentRuntimeResolver.providerOverrides` 消费契约 | `ProviderOverrides` 形状、base_url/wire_api/model 绑定、热切换 |
| **安全 08** | `firewall`(= `firewallPeerMessage`)调用点(§2.3/§5.2);`sandboxCeiling`/`AgentRuntimeResolver.sandbox/providerEnv` 上限声明 | `firewallPeerMessage` 实现 + `FirewallResult`、`buildChildEnv` env 白名单、沙箱封顶 enforcement、redact |
| **隔离 09** | `shouldMergeAt` 调用时机、冲突硬停语义、`AgentRuntimeResolver.workdir`;`worktreesEnabled` 开关(H16:M1 关→mergeRound no-op,files 仅意图 evidence) | `WorktreeManager`/`mergeRound(round)`→`MergeResult` 3-way 实现、`conflictEvidence` 构造、M1 无 worktree 时的退化落点确认 |
| **面板 10 / WS 11** | `Blackboard.subscribe` 广播、`paused` 态供人工介入、`logger.stream` 透传 | WS 传输、暂停/恢复控制回灌引擎 |
| **性能 17 §6.3** | `DigestBuilder` 接口形状(§2.1.1)、`DigestOptions` | digest 生成算法 + 质量策略 + 裁剪上界(本文件只定接口,不定算法) |

---

## 10. 待实测项 与 留给定稿的开放问题(M0 验证锚点 + 跨稿裁决)

### 10.1 待实测(M0 闭环)

| # | 项 | 影响 | 验证方式 |
|---|---|---|---|
| Q1 | `resume` 真实累积成本曲线在两端是否都符合事实地基 D(codex 已测,claude 未测) | master-worker 子任务内 resume 的成本权衡 + §6.3 成本表 master-worker 估算 | claude `--resume` 连续两轮测 input_tokens 增量 |
| Q2 | `--append-system-prompt`(claude)vs prompt 正文(codex)注入 `roleBrief` 的角色稳定性差异 | 角色漂移风险,影响 stateless 下每轮重注入是否够 | 两端各跑 5 轮看角色保持 |
| Q3 | parallel 两 worker 并发 spawn 的资源/中转限流(并发请求是否被中转限速) | parallel 范式吞吐 | 实测两进程并发 exec 的延迟/报错 |
| Q4 | stateless 下 digest 质量对连续性的实际影响(digest 多短会丢关键约束) | 性能 17 digest 生成策略 + H5 路径①(只用结构化 evidence)是否够维持连续性 | 对比 resume vs stateless+digest 的产出质量 |
| Q5 | parallel `isDone`/`syncLanes` 依赖"全 done 必在上一轮末截停"的假设是否在所有 merge 时序下成立 | H9 空 turns 防御正确性 | 构造冲突场景 + 错峰完成场景验证 paused/done 提前返回 |
| Q8 | `maxResumeChain` 降级时机与 04 前瞻预算刹车的交互(谁先触发、是否重复降级) | H7 两道护栏协同 | master-worker 长子任务跑满 resume 链,观察降级与刹车顺序 |

### 10.2 留给定稿的开放问题(吃不掉,需用户/跨稿裁决)

| # | 问题 | 现状 | 建议裁决 |
|---|---|---|---|
| Q6 | **全仓文档编号漂移**:同时存在"安全=08/面板=10"(实际文件名)与"安全=09/面板=08"(01/02/04/05/06/07/11/23 等旧引用)两套。本文件已统一按实际文件名 + 角色名引用,但兄弟文档未回填 | 跨稿不一致,纯文档层(不影响类型/接口) | 全仓一次性回填到实际文件名编号;或反向统一。需用户拍板一个权威方案,本文件按角色名可零成本重定位 |
| Q7 | **`ContextBundle` vs `PromptContext` 命名**:本文件 + 术语表 23 + 02/09/16/20–22 用 `PromptContext`;05/17/19/25 用 `ContextBundle` | 同一对象两名 | 统一为 `PromptContext`(本文件 + 术语表权威),回填 05/17/19/25 的 `ContextBundle` |
| Q9 | **`DigestBuilder` 接口归属**:本文件因其是 `EngineDeps` 注入项 + `PromptContext.digest` 来源,在 §2.1.1 定形接口;但生成算法在性能 17 §6.3,术语表 23 又写"生成器归刹车 07(旧号)" | 接口/算法/归属三处措辞需对齐 | 确认:接口形状归本文件 03,生成算法归性能 17;术语表 23 那条"归刹车 07"改为"接口归引擎 03、算法归性能 17" |
| Q10 | **`PLAYBOOK_DONE` 错误码废弃**:v2 把 done 出口归 04(正常完成无错误码),v1 的 `PLAYBOOK_DONE` 不再产生 | 02 §12 错误码表若列了 `PLAYBOOK_DONE` 需标废弃 | 02 错误码表移除/标注 `PLAYBOOK_DONE` 废弃;done 终态 reason 由 04 `StopDecision.reason` 给 |
| Q11 | **§8.1 错误码清单回填 02 §12 + 跨稿对齐(H13/A1/COV-1)**:本节给出本引擎产出的 14 个码,但全仓(05/08/09/11/21 等)还有 WS_*/EGRESS_*/FUSION_*/CONFIG_* 等码同样缺在 02 union | 02 §12 union 与下游零散登记不一致,`SyluxError`/§15 Record 穷举会编译红 | 02 §12 一次性合并各文档清单(本节 §8.1 + 各篇)为完整 union;`STOP` 占位不收、`PLAYBOOK_DONE` 标废弃。需 02 owner 总控合并 |
| Q12 | **M1 无 worktree 过渡形态的最终裁决(H16/FEAS-3/COV-9)**:本节给 `worktreesEnabled=false` 时 mergeRound no-op + files 仅意图 evidence;但 M1/M2 是否真有"diff 面板要渲染却无文件写"的矛盾(COV-9)需 25/09/10 共同确认 | 跨稿:M1 范围(25)、隔离退化(09)、diff 面板时机(10)三方需对齐 | 裁决二选一:(a) diff 面板推迟 M3、M1/M2 纯决策 contentHash 退化为命令复现弱锚点;(b) M1 补"单 checkout 无 worktree 落 diff"过渡隔离规格。本节按 (a) 设计,(b) 需 09 补规格 |
| Q13 | **`tokenBudget` regime 口径回填 16(H17/ROC-B1)**:本节 §6.3 明确 stateless 用线性、resume 段用累积,§7 字面量按线性给;16 §6.4 默认表误用 resume 超线性公式 | 16 配置层与本节口径冲突(blocker) | 16 §6.4 按 18 §6.4 regime 分叉 `estimateRunTokens` 重算默认预算表,对 stateless 范式禁用 `base×N(N+1)/2`;采用本节 §7 字面量或按线性公式重算。需 16 owner 修订 |

> 本文件其余结论均已被事实地基(02 / PROBED-FACTS)覆盖,不再标【待实测】。Q1–Q5/Q8 是引擎设计中尚未本机实测、需 M0 闭环的点;Q6/Q7/Q9/Q10 是跨稿一致性裁决项;**Q11–Q13(本轮 v2.1 新增)是吃掉红队 A1/COV-1/FEAS-3/ROC-B1 后留给 02/16/09/25 owner 的回填裁决项**——本节已在自身范围内定形接口/算法/口径,跨稿回填需对应 owner 执行。


