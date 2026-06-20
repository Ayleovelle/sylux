# 22 · 端到端时序与状态机(运行全景的权威时序图 + 状态机集)v2

> **版本**:v2(2026-06-20,run-tag v3.1)。相对 v1 的硬化点见 §0.0。**本批次吃掉的交叉/红队 findings 主线**:**E1/E6/E13**(本文 v1 镜像 01v1 的 v1 刹车相位表——把 `checkBefore`/`checkAfter` 双侧刹车、`contextFor`、`firewall.wrap`、`feedEvidence`、`PLAYBOOK_DONE` 当 done 错误码、`P0–P8` 八相位再传导一层,根因是当时 01§2.1 未与 03v2/04v2 对齐,现 01v3/03v2/04v3 已全面迁移到 **7 相位 P1–P7 + 轮末单点 `StopPolicy`(`update`+`shouldStop`)+ 无前置刹车 + `firewallPeerMessage` 纯函数 + `playbook.nextTurn` 产 `PromptContext`**)、**C-NUM/E7**(本文双轨编号:把安全也叫 09——与 worktree 同号自相矛盾;全文统一到**文件名编号**:安全=08、worktree 隔离=09)、**E11**(evidence 旧二档「强/中」收紧为「≥1 条强」,02v2)。
>
> **本文件地位**:sylux 的**端到端时序与状态机权威设计**。把分散在运行时骨架(01)、黑板协议(02)、引擎与剧本(03)、收敛刹车(04)、codex/claude 适配层(05/06)、安全防火墙(08)、worktree 隔离(09)、WS 面板协议(11)里的局部契约,**缝合成一条从「用户敲 `sylux run`」到「产出 integration 分支」的完整时间线**,并给出三个层级(中枢 / adapter / agent)的状态机与其转移触发,外加暂停 / 介入 / 中止三类控制的状态转移。本文件**不新增任何类型 / 接口 / 错误码**,只编排既有契约在时间轴上的先后、并发、失败分叉。
>
> **类型与接口一律引用,不另写**:`Message` / `Evidence` / `AgentEvent` / `Round` / `BoardState` / `RunStatus` / `JsonlRecord` 及全部枚举与错误码,唯一权威在**黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。`Playbook` / `runEngine` / `runTurn` / `Blackboard` / `BoardView` / `EngineDeps` / `PromptContext` / `RoundPlan` / `TurnDirective` 在**引擎(03)**;`StopPolicy` / `StopContext` / `StopDecision` / `CompositeStopPolicy` / `DonePolicy` / `PlaybookDonePolicy` / `buildStopContext` 在**收敛刹车(04)**;`runOrchestration` / `AbortSignal` 注入 / `RunStore` / 7 相位 / `RoundFingerprintAccumulator` 在**运行时骨架(01)**;`AgentAdapter.send/resume/cancel` + `AgentInput` + spawn 闸门在**适配层(05/06)**;`firewallPeerMessage` / `buildChildEnv` 在**安全(08)**;`WorktreeManager.create/mergeRound/cleanup` / `conflictEvidence` 在**worktree(09)**;WS 帧 / 关闭码 / 续传在**面板协议(11)**。本文出现这些一律指上述定义。
>
> **下游编号约定(吃掉 C-NUM,与 01v3/03v2/04v3 一致)**:一律用**实际文件名编号**——`02`=黑板、`03`=引擎、`04`=收敛刹车、`05/06`=适配层、`07`=provider、`08`=安全防火墙、`09`=worktree 隔离、`10`=面板、`11`=WS。v1 本文曾把安全也写成「09」(与 worktree 同号),已全面改为安全=08、隔离=09,并辅角色名防漂。
>
> **事实地基**:进程启动(直调真 exe + stdin)、事件流首行 `thread.started.thread_id`、output-schema 经中转可成形、resume 不省 token 且累积上涨、resume 参数集与 exec 不对称、token 计量取 `turn.completed.usage`,全部以 `docs/PROBED-FACTS.md`(2026-06-20 本机实测,A–G 节)为准。凡事实地基已覆盖的不再标【待实测】;仅其未覆盖的假设标注。
>
> **与兄弟文档的边界(只编排,不重定义)**:
> - 7 相位(P1–P7)/ 广播触点 / `AbortSignal` 注入点 / 持久化写序归 **01 §2.1/§3/§5.2**;本文 §2/§3 把它们铺到完整时间线上。**无 P0 前置刹车**(01 RT11/v3 已删 v1 的 P0 `pre-brake`)。
> - 循环本体 `runEngine`/`runTurn`/`consume` 与四范式 `nextTurn` 归 **03 §5/§7**;**终止裁决** `StopPolicy`(轮末单点 `update→shouldStop`)归 **04 §2.4**;本文只引用其调用顺序。
> - spawn 生命周期闸门(`thread.started` 前后崩溃语义)归 **05 §5**;本文 §4/§6 引用其状态。
> - 内容防火墙 `firewallPeerMessage`(纯函数返回 `{action,wrapped}`)归 **08 §4.3**;本文 §3 只画其触发点。
> - 合并冲突硬停 + `conflictEvidence` 构造归 **09 §5/§6**;本文 §7.4 只画其状态转移。
> - 控制帧线格式 / 关闭码归 **11 §4/§5**;本文 §7 只画其触发的状态转移。

---

## 0.0 v2 相对 v1 的硬化点(逐条吃掉 findings)

| # | 硬化点 | v1 问题(交叉/红队 finding) | v2 修正 | 落点 |
|---|---|---|---|---|
| H1 | **v1 刹车相位模型镜像**(E6/E1) | v1 全文用 01v1 的 8 相位 `P0 pre-brake(checkBefore)`…`P8 post-brake(checkAfter)+isDone` 双侧刹车;01v3 已删 P0、改 7 相位 P1–P7,终止裁决全归 04 轮末单点 `StopPolicy.update→shouldStop`(无前置) | 全文相位表/时序/状态机重画为 P1–P7;P0 删除;P8 双检改为 **P7 轮末单点 stop 裁决**;轮数/token「提前抢停」由 04 前瞻预算刹车在轮末 `shouldStop` 内做 | §0.3、§1.x、§2.x、§3.x、§4.1、§5.1、§6.1、§7.x、§8.x |
| H2 | **`contextFor`/`firewall.wrap`/`feedEvidence` 旧接口**(E6/E5/D1) | v1 让 `Blackboard.contextFor` 算 delta+digest、`firewall.wrap` 对象方法、`brakes.feedEvidence` 逐条喂刹车 | delta/digest 改由 `playbook.nextTurn` 产 `PromptContext`(03 §2)、引擎 `renderPrompt` 渲染;防火墙改 `firewallPeerMessage(msg,ctx)→{action,wrapped}`(08);指纹改 `RoundFingerprintAccumulator`→`closeRound` 封存→04 轮末读(01 RT11) | §0.3 P2/P3、§3.1、§3.4 |
| H3 | **done 错误码与 `PLAYBOOK_DONE`**(对齐 04 §0.1/§7) | v1 把 done 终态标 `code=PLAYBOOK_DONE`,且 `isDone` 在 P8 单独判 | done 是**成功出口无错误码**(04 §2.2:`code=undefined`);通用 done+ack 走 `DonePolicy`、范式特定门走 `PlaybookDonePolicy`,二者并入 04 `CompositeStopPolicy` 在 P7 裁决,引擎不再单独 `if(isDone)`(03 H2) | §4.1、§5.1、§5.2 |
| H4 | **evidence 旧二档「强/中」**(E11/02v2 H2) | v1 多处写 critic evidence「≥1 条强/中核验通过」 | 02v2 收紧为「≥1 条强」(weak/未实跑 command/无 quote file_ref/spec_quote 都不解锁 C1) | §3.4、§7.3 |
| H5 | **编号双轨(安全=09 与 worktree 撞号)**(C-NUM/E7) | v1 把防火墙/注入也写「09 安全」,与 worktree 隔离同号 | 安全=08、worktree=09,全文分离 | 全文 |
| H6 | **resolveAndContinue 措辞 vs 09 接口** | v1 §4.1/§5.4 用 `resolveAndContinue`;01v3 §7.2 落为 `suspendForArbitration` 挂起循环 + resume 控制帧 | 改述为 paused 挂起循环 + `resume` 控制帧(01 §7.2),冲突解除判定归 09 `mergeRound` resume 后重试 | §4.1、§5.4 |

---

## 0. 阅读指引与全局符号约定

### 0.1 本文件回答的三个问题

| 问题 | 章节 | 形式 |
|---|---|---|
| 一次 run 在时间轴上**先后发生了什么**(含并发与失败分叉) | §1 全景时序 / §2 首轮 / §3 第二轮 resume / §5 收敛与产出 | 时序图 + 阶段表 |
| 中枢 / adapter / agent **各自处在什么状态、被什么触发转移** | §4 三层状态机 | 状态机图 + 转移表 |
| 人工 **暂停 / 介入 / 中止** 如何穿过这套时序与状态机 | §7 控制转移 | 状态转移图 + 时序 |

### 0.2 时序图角色(纵向泳道,全文统一)

```
用户/CLI   面板(web)   WsHub   runOrchestration   runEngine   Playbook   StopPolicy   Firewall   Blackboard/RunStore   Adapter(codex)   Adapter(claude)   Worktree   子进程
```

> 简记:**中枢** = `runOrchestration`+`runEngine`+`Blackboard`+`StopPolicy`(04 复合刹车)+`firewallPeerMessage`(08)+`WsHub`(同一 Node 进程内的协作单元);**adapter** = `AgentAdapter` 两实例;**agent / 子进程** = codex.exe / claude shim 背后的真实进程(各自独占 worktree)。`Firewall` 泳道实为 08 的 `firewallPeerMessage` 纯函数(非对象方法),`StopPolicy` 泳道实为 04 `CompositeStopPolicy`,仅作泳道占位。

### 0.3 相位锚点(引用 01 §2.1 v3,贯穿全文)

每轮 **7 个固定相位**(01v3 已删 v1 的 P0 `pre-brake`——无前置刹车,RT11),本文所有时序节点都标注其所属相位,便于与 01/11 对齐:

| 相位 | 名 | 关键动作 | 广播帧(11) | 写 jsonl |
|---|---|---|---|---|
| P1 | plan | `playbook.nextTurn` → `RoundPlan`(含每 turn 的 `PromptContext`,delta/digest 由 playbook 决策,03 §2) | `round_planned` | — |
| P2 | render | `renderPrompt(PromptContext)`:渲染 goal+roleBrief+digest+delta(delta/digest 已在 P1 由 playbook 选定) | — | — |
| P3 | firewall | peer body/evidence 过 `firewallPeerMessage(msg,ctx)→{action,wrapped}`(边界标记+扫描,08 §4.3);`block` 条不拼入 | — | — |
| P4 | dispatch | `adapter.send/resume` 消费 `AgentEvent` 流;受 `turnTimeoutMs` 墙钟超时保护(01 §3.5) | `delta`/`tool_call` | — |
| P5 | validate | `validateMessage`(02 §8)+ 打回重试;强 `file_ref` 的 `contentHash` 在此回填(02 §8.3) | — | — |
| P6 | append | `blackboard.append`(盖 seq→落盘→入队广播→累加指纹进当前轮,RT7) | `message` | `message` |
| P7 | merge+close+stop | `shouldMergeAt`→`mergeRound`(冲突→`paused` 挂起);`closeRound` 封存 `Round.evidenceFingerprints`;之后 `stopPolicy.update→shouldStop`(04,轮末单点裁决,RT11),终态走 `finalize` | `diff_ready`/`round_closed`/`usage`/`status`(终态) | `round_closed`(+冲突/终态 `message`+`status_changed`) |

> **无 P0、无 P8 双侧刹车(吃掉 E6)**:v1 在 P0 `checkBefore`、P8 `checkAfter`+`isDone` 双检——已废。v3 终止裁决**统一在 P7 轮末**:`closeRound` 落指纹缓存后,按 04 §2.4 顺序铁律调 `stopPolicy.update(ctx)` 再 `stopPolicy.shouldStop(ctx)` 各一次。轮数/token 的「提前抢停」由 04 的**前瞻预算刹车**(用 `lastRoundUsage` 实测外推下一轮是否破预算,事实 D)在 P7 `shouldStop` 内完成,不再需要独立前置钩子。done(通用 done+ack / 范式特定门)也并入 P7 的 `CompositeStopPolicy`,引擎不再单独 `if(isDone)`(03 H2)。

---

## 1. 端到端全景时序(用户启动 → 产出 integration)

### 1.1 五个宏观阶段

一次 run 的生命周期分五段,每段在后续小节展开细节时序:

| 段 | 名 | 起止 | 关键不变量 |
|---|---|---|---|
| S0 | 启动与就绪 | `sylux run` → 中枢就绪、worktree 建好、adapter 构造完 | 解析真 exe(事实 A)、预扫描 key 不入 argv(08)、base tag 打好(09 §3.3) |
| S1 | 首轮 exec(冷启动) | P1 → 首个 `message` 落黑板 | 首事件必 `session_started`(I5/A1),拿到前 `resumable=false`(RT8) |
| S2 | 广播与观战 | 每次 `append` 落盘后同步广播 | 落盘先于广播(RT7/W2);面板见到必可回放 |
| S3 | 第二轮起的 resume / stateless 循环 | P1(round≥1)→ 收敛或刹车 | resume 累积计费(事实 D),续接策略由 playbook 定(03 §2.1) |
| S4 | 收敛 / 停 / 合并 / 产出 | P7 `shouldStop` 命中 → `finalize` → cleanup | 终态经 `finalize` 落 `status_changed`;冲突硬停不选边(W4) |

### 1.2 全景时序图(压缩版,细节见 §2–§7)

```
用户/CLI  面板   WsHub  runOrchestration runEngine Playbook StopPolicy Blackboard Adapter(cdx) Worktree 子进程
  │        │      │         │              │        │       │       │          │          │       │
  │ sylux run ────────────►│ ① 解析exe/校验provider/linkAbort(01§3.1)                       │       │
  │        │      │         │  worktrees.create(runId) ──────────────────────────────────►│ base/分支/wt(09§3.3)
  │        │      │         │  构造 AgentAdapter×2(05§3.2,exe路径解析)  │          │          │       │
  │        │      │ openRun │◄─ RestApi 注册 run(11§10.1)               │          │          │       │
  │ ◄─ runId/WS票据(REST,11§5.2)                                        │          │          │       │
  │        │ hello+token ──►│ 鉴权(W5)→ snapshot(空壳)                  │          │          │       │
  │        │      │         │── runEngine(playbook,deps2)─►│            │          │          │       │
  │        │      │         │              │ setStatus('running')──────►│ jsonl:run_started│       │
  │═══════════════════════════ S1 首轮(round0)═══════════════════════════════════════════│       │
  │        │◄status(running)│              │ P1 nextTurn ─────►│ RoundPlan(serial,proposer=cdx,含 PromptContext)
  │        │◄round_planned──│              │ P2 renderPrompt(goal+digest+delta,delta/digest 由 P1 playbook 选定)
  │        │      │         │              │ P3 firewallPeerMessage(首轮 delta 空,仅 goal+roleBrief)
  │        │      │         │              │ P4 adapter.send(input) ───────────────────►│ spawn真exe+stdin
  │        │◄delta/tool_call│              │   for-await AgentEvent:                    │ JSONL流  │
  │        │      │         │              │   ① session_started(thread_id)─►recordSession│       │
  │        │      │         │              │   ④ final_message(raw,usage=turn.completed)│       │
  │        │      │         │              │ P5 validateMessage(raw)(02§8,失败重发≤N)  │       │
  │        │◄─message(seq)──│              │ P6 append ───────►│ 盖seq→落盘→广播→累加指纹(RT7)│  │
  │        │      │         │              │ P7 shouldMergeAt?→mergeRound ─────────────►│ 3-way(09§5)
  │        │◄diff_ready/round_closed/usage │   closeRound ────►│ jsonl:round_closed       │       │
  │        │      │         │              │ P7 stopPolicy.update→shouldStop(04,轮末单点)→ 未停,round++
  │        │◄status         │              │                  (无 P0/P8 双检,RT11)      │       │
  │═══════════════════════════ S3 第二轮起(round≥1,resume/stateless)═══════════════════│       │
  │        │      │         │              │ P1..P4: continuity='resume'?→adapter.resume(sid)│  spawn+exec resume
  │        │      │         │              │          continuity='stateless'?→adapter.send│  spawn全新
  │        │      │  (循环 P1–P7 直到 P7 stopPolicy.shouldStop 命中)│          │          │       │
  │═══════════════════════════ S4 收敛/停/产出 ════════════════════════════════════════│       │
  │        │      │         │              │ P7 shouldStop.shouldStop=true → finalize(status,reason)
  │        │◄status(终态)───│              │   onFinish; setStatus(done/stalled/limit/aborted,code?)
  │        │      │         │ finally: pump.stop / flush / killAllChildren(RT6) / cleanup(09§8)
  │ ◄─ RunResult{status,reason,runId}      │              │        │       │ integration 分支=产出
```

### 1.3 关键顺序保证(贯穿全程的硬约束)

| # | 顺序 | 来源 | 违反后果 |
|---|---|---|---|
| O1 | 解析真 exe **先于** 任何 spawn | 事实 A / 05 §4 | 裸名/`.cmd` spawn 失败(`%1 is not valid Win32` / 参数被打散) |
| O2 | `worktrees.create` **先于** 首次 `adapter.send` | 09 §3.2 / 05 `AgentInput.workdir` | 没有 workdir,codex `-C` 无处可设 |
| O3 | `session_started` **先于** 标记 `resumable=true` | I5/RT8/A1 | 误以为可 resume,resume 指向不存在 thread |
| O4 | 落盘(jsonl)**先于** 广播(WS) | RT7/W2 | 面板见到却回放不出(数据不一致) |
| O5 | `validateMessage` 通过 **先于** `append` | RT3/I2 | 未校验对象入黑板,evidence 造假绕过 |
| O6 | `firewallPeerMessage` **先于** delta 进对面 prompt | RT4 | peer 输出注入劫持本轮 agent |
| O7 | `mergeRound` 仅在 P7 且串行 | W3 | 并发合并 / 运行期合并 → 脏态 |
| O8 | 任何终态经 `finalize` 落 `status_changed`,`finally` 再兜底杀子进程 | 01 §2.2/§3.4 | run 停了 jsonl 无终态 / 子进程烧 token |

---

## 2. S0 启动 + S1 首轮 exec(冷启动详时序)

### 2.1 S0 启动与就绪(用户敲命令 → 中枢可接首轮)

```
用户/CLI            runOrchestration / 中枢启动           Worktree              Adapter 工厂          WsHub/RestApi
  │ sylux run --playbook red-blue --task "…"  │             │                     │                    │
  │ ──────────────────────────────────────►   │             │                     │                    │
  │  ① 解析两 CLI 真实 exe 路径(事实 A,不依赖 PATH shim)  │                     │                    │
  │  ② provider 配置校验:argv 预扫描 sk-/base64,命中即抛 PROVIDER_CONFIG_INVALID(08)│                │
  │  ③ buildChildEnv:env 白名单 + extendEnv:false,key 只进 env(08)              │                    │
  │  ④ linkAbort(opts.signal) 建取消根(01§3.1);startControlPump 挂控制泵(01§2.3)│                  │
  │  ⑤ worktrees.create(runId,{repoRoot,[codex,claude]}) ──►│ 打 base tag(不可变)│                    │
  │                                            │             │ 建 integration + 两 agent 分支/worktree(幂等)
  │                                            │◄────────────│ workdir 绝对路径表落 run 元数据(W1 路径定死)
  │  ⑥ createCodexAdapter / createClaudeAdapter(provider 绑定,exe 路径)────────►│ 构造(未 spawn)   │
  │  ⑦ RunStore.open(runId,playbookId):写首行 run_started(02§7.1)              │                    │
  │  ⑧ WsHub.openRun(runId):建 replayBuffer + seq 计数器(11§10.1)             │ ───────────────────►│
  │ ◄─ runId + REST 票据端点就绪;CLI 打印面板 URL                                                     │
```

| 步 | 动作 | 失败分叉 | 错误码 |
|---|---|---|---|
| ① | `resolveCodexExe()` 定位平台包 vendor bin(05 §4) | exe 缺失 → 启动即抛,never start | `SUBPROCESS_SPAWN_FAILED` |
| ② | provider argv 泄密预扫描(08) | 命中 sk-/base64 → 抛,never start | `PROVIDER_CONFIG_INVALID` |
| ⑤ | `worktrees.create`(幂等,09 §3.3) | git 失败 → 抛;`.sylux` 未在 `.gitignore` → 告警 | `WORKTREE_GIT_FAILED` |
| ⑦ | `RunStore.open` 写 `run_started` | 磁盘不可写 → 抛,never start | `ENGINE_FATAL` |

> S0 全程**不 spawn 任何子进程**:adapter 是冷流(05 §3.3),`createXxxAdapter` 只解析 exe + 绑 provider,真正 spawn 在 S1 的 P4。这样「启动期失败」与「首轮发言失败」清晰分离:S0 失败 = run 根本没开始(never start,`status_changed` 都不写或只写 aborted),S1 失败 = run 开始后首轮挂(走 finalize)。

### 2.2 面板接入(可与 S1 并发,不阻塞引擎)

面板接入与引擎首轮**解耦**:用户可在 run 已经跑起来后才打开面板,经 snapshot 补齐历史(11 §6)。握手时序见 11 §5.2,本文只标其与引擎时间线的关系:

```
面板                         RestApi(同源127)        WsHub                     runEngine(已在跑)
  │ POST /runs/:id/ws-ticket ──►│ 签发一次性token+scope │                          │
  │ ◄── {token,scope,runId}     │                       │                          │
  │ WS Upgrade(Origin白名单,09)───────────────────────►│ 101                      │
  │ hello{token,v,subscribe,cursor?} ───────────────────►│ 校验token(一次性,作废) │
  │ ◄── snapshot{seqWatermark, full:BoardState|delta}(11§6)│ 取 BoardState 投影      │
  │ ◄── 之后按 seq>watermark 持续推广播帧 ────────────────│◄── append/closeRound 广播│
```

> **冷启动 vs 中途接入**:run 刚启动面板接入 → snapshot 多为空壳(只 run_started);run 跑一半接入 → snapshot 带 `full:BoardState`(已发生的 message/round 全量,11 §6.3),之后实时增量。两种都不影响引擎(W7:广播不阻塞引擎)。

### 2.3 S1 首轮 exec 详时序(round 0,以红蓝 proposer 首发为例)

首轮是**冷启动**:无 sessionId、无历史、`continuity` 无论何值都只能 `adapter.send`(resume 需先有 sessionId,03 §5.2 第 2 步自动降级)。这是「首轮拿 threadId」的关键一轮。

```
runEngine        Playbook   StopPolicy  Firewall   Blackboard   Adapter(codex)        子进程(codex.exe)
  │ P1 nextTurn(view)──►│ RoundPlan{execution:'serial',turns:[{agent:codex,role:proposer,kindHint:propose,promptContext}]}
  │ ◄───────────────────│ (red-blue:偶轮 proposer,03§7.1;PromptContext.continuity='stateless',digest='',delta=[])
  │ P2 renderPrompt(pc):首轮无 delta,仅渲染 goal+roleBrief(delta/digest 已由 P1 playbook 选定,03§2)
  │ P3 firewallPeerMessage(首轮无 peer delta,仅 goal+roleBrief → 无需过滤,08§4.3)                  │
  │ P4 adapter.send(AgentInput{prompt,outputSchema,workdir,sandbox:'read-only'(propose 是 decision,09§10)})
  │    ───────────────────────────────────────────────────────►│ spawn(真exe,args含'-'占位)
  │                                                             │ stdin.write(prompt);stdin.end()
  │                                                             │◄─ JSONL流(事实B):    │ ───────►
  │    ① {kind:session_started,sessionId}◄── thread.started.thread_id(首行!A1)        │
  │    └─ recordSession(codex,sessionId)─►Blackboard:jsonl agent_session;resumable=true(RT8/O3)
  │    ② delta(可选透传)──►WsHub 广播(droppable)                                       │
  │    ③ tool_call(可选)──►WsHub 广播                                                  │
  │    ④ {kind:final_message,raw,usage}◄── item.completed.text + turn.completed.usage   │ 退出code=0
  │ P5 validateMessage({from:codex,role:proposer,round:0,payload:safeParse(raw)})       │
  │    propose 非 critic/critique → evidence 不强制;safeParse 通过 → ok                │
  │ P6 blackboard.append:盖 seq(id/ts/round 由 input)→落jsonl→入队广播message(seq=N)→累加指纹进当前轮(RT7)
  │ P7 shouldMergeAt(0)? red-blue 每轮 true,但 propose 是 read-only 无改动 → mergeRound 跳过该 agent(09§10.3)
  │    closeRound(0):落 round_closed(evidenceFingerprints=∅,usage)                     │
  │    stopPolicy.update→shouldStop(ctx):无新 evidence 但首轮 minActiveRounds 宽限不计 stall(04§4.2);
  │      done 未配对、未触顶 → KEEP_RUNNING → round→1(轮末单点,无 P0/P8,RT11)
```

### 2.4 首轮拿 threadId 的三个失败分叉(引用 05 §5 闸门)

首轮最关键的风险是「拿不到 sessionId」。adapter 的 spawn 闸门(05 §5)把崩溃时机分三类,本文标其对端到端时序的影响:

| 时机(05 §5) | 现象 | adapter emit | resumable | 引擎处置(03 §5.2) | 端到端后果 |
|---|---|---|---|---|---|
| F-a 闸门前(spawn 即失败) | exe 错/参数错,无任何事件 | 只 `error:SUBPROCESS_SPAWN_FAILED`,**不**发 session_started | false | 致命 → `finalize('aborted')` | run 首轮即终止;熔断器记一次(01 §4.3) |
| F-b 闸门前(`thread.started` 前死) | 进程启动但首行前崩 | 同上,**不**伪造 session_started(A2) | false | 同上致命 | 同上;不会误标可 resume |
| F-c 闸门后(`thread.started` 后死) | 已拿 sessionId,后续 turn 中途崩/超时 | 先 session_started(已发),再 `error:SUBPROCESS_CRASHED/CANCELLED` | **true** | 非致命,可 resume 或 stateless 重来 | sessionId 已落 `agent_session`,下轮可续 |

> **O3 焊死点**:只有 F-c(已 emit session_started)才允许 `resumable=true`。F-a/F-b 下中枢**绝不**因为「进程起来过」就标可 resume——没有 thread_id 就没有 resume 凭据(05 §5 红队 major)。这把「首轮拿 threadId 失败」从隐蔽 bug 变成显式致命终态。

---

## 3. S2 广播 + S3 第二轮 resume(增量循环详时序)

### 3.1 S2 一次 append 的广播扇出(RT7/W2 焊死点)

`blackboard.append` 内部三步同步、顺序焊死(01 §5.2):**盖 seq+落盘 → 入队广播 → 累加指纹进当前轮**。这是「面板见到的一定可回放」的根。注意第④步是**指纹累加进 `RoundFingerprintAccumulator`**(当前轮内存集),**不是**逐条喂刹车——刹车(04 `StopPolicy`)只在 P7 轮末 `closeRound` 封存 `Round.evidenceFingerprints` 后读它做差集(01 RT11/04 §2.1)。v1 此处写 `brakes.feedEvidence` 暗示有逐条喂料接口,**错**,已删:

```
runEngine(P6)        Blackboard.appendImpl       RunStore(jsonl)     WsHub.broadcast        各订阅连接
  │ append(AppendInput)──►│ ① stamp:盖 seq(单调,RT9)/id/ts;round 由 input 给(02§5.1,纯内存)
  │                       │ ② store.append({recordType:'message',schemaVersion,message})──►│ fs.appendFile(O_APPEND,单写者RT5)
  │                       │    (落盘成功返回后才继续 —— O4;jsonl 行才带 schemaVersion,02 I4)│
  │                       │ ③ hub.broadcast(runId,{kind:'message',message})──────────►│ redact(W3)
  │                       │    (非阻塞入队,RT10)                                        │ 入replayBuffer(权威帧)
  │                       │                                                            │ enqueue 各连接(有界,W7)
  │                       │ ④ roundAccum.add(fingerprintSet(msg.evidence))(累加进当前轮内存集,02§9.2;非喂刹车)
  │                       │◄── 返回 stamped Message                                    │ drain→socket.send
  │ ◄─────────────────────│                                                            │ ──► 面板渲染气泡
```

| 顺序点 | 崩溃后果 | 恢复(01 §5.4) |
|---|---|---|
| ②前崩 | 啥都没落,该 message 不存在 | 回放无此条,一致 |
| ②后③前崩 | jsonl 有、面板没见到 | 重连 snapshot 补齐(不丢数据) |
| ③后崩 | 不可能「广播了没落盘」 | W2:面板任何 message 必在 jsonl |
| ④后未 closeRound 崩 | 该轮累加器在内存丢失 | 回放从该轮已落盘 message 的 evidence 重算(确定性,与 04 §4.4 `reset` 一致) |

> **背压不回压引擎(W7)**:③ 的 `enqueue` 对每个连接是有界非阻塞;慢面板队列满 → 11 §7 降级(合并 delta / 丢 droppable / 溢出 `close 4413` 重连续传),`broadcast` 对引擎恒 O(连接数) 立即返回。引擎不会因某个面板卡住而停 P6。

### 3.2 一轮完整广播帧序列(引用 11 §10.3,标相位)

```
相位      广播帧(seq)              入replayBuffer  面板动作
P1 plan   round_planned(seq=k)     是              渲染"第n轮:codex(proposer)将发言"
P4 disp   delta(seq=k+1)           否(droppable)   气泡"正在输入…"流式拼接
P4 disp   tool_call(seq=k+2)       否(droppable)   气泡下挂"读取 src/x.ts"
P6 append message(seq=k+3,hasDiff) 是              打字气泡定型为正式消息 + diff 入口
P7 merge  diff_ready(seq=k+4)      是              diff 入口可点开(按需拉 11§9)
P7 close  round_closed(seq=k+5)    是              本轮折叠 + 收敛指纹徽标
P7 close  usage(seq=k+6,total)     是              累积 token 进度条(事实D)
P7 stop   status(seq=k+7,running)  是              shouldStop=KEEP_RUNNING→继续下一轮
```

> delta/tool_call **占 seq 但不入 replayBuffer**(11 §6.3):参与前端游标推进避免空洞误判,但重连后不补打字过程,只补到已落地的 message。`status` 帧在 P7 轮末 `stopPolicy.shouldStop` 之后广播(running 续跑 / 终态停),无独立 P8 相位。

### 3.3 S3 第二轮 resume vs stateless(continuity 分叉,事实 D 核心)

第二轮起,`PromptContext.continuity`(03 §2.1)决定走 `adapter.resume` 还是 `adapter.send`。这是 token 成本曲线的决定性开关(事实 D:resume 累积计费,8 轮≈36×base)。

```
runEngine(round=1, P4)        runTurn 选择(03§5.2 第2步)              Adapter             子进程
  │ sess = view.sessionOf(agent)  │                                      │                  │
  │ useResume = continuity==='resume' && sess.resumable && sess.sessionId │                  │
  ├─【resume 分支】(主从子任务内,03§7.2)────────────────────────────────│                  │
  │   adapter.resume(sess.sessionId, withFeedback(input)) ───────────────►│ spawn:exec resume
  │                                                                       │  <SID> -(事实E:
  │                                                                       │  拒 -s/-C,需
  │                                                                       │  --skip-git-repo-check)
  │   ◄── ① session_started(同一 sessionId 回吐)                          │  stdin=prompt   │
  │   ◄── ④ final_message(usage:input_tokens 累积↑,事实D:18755→37645)    │                 │
  ├─【stateless 分支】(红蓝/对等长程,03§7.1/§7.3)───────────────────────│                  │
  │   adapter.send(withFeedback(input)) ────────────────────────────────►│ spawn:全新 exec  │
  │                                                                       │  prompt=goal+digest+delta
  │   ◄── ① session_started(**新** sessionId)──►recordSession 覆盖        │  (旧轮压结论,不重灌全史)
  │   ◄── ④ final_message(usage:近似平,只吃 base+digest+delta)            │                  │
  ├─【resume 降级】sess.resumable===false(首轮没拿到/F-a/F-b)─────────────│                  │
  │   自动退化为 adapter.send(03§8 resume 退化路径),不报错,digest 兜连续性 │                  │
```

| 续接策略 | 触发范式(03 §6.1) | spawn 方式 | token 曲线(事实 D) | 连续性来源 |
|---|---|---|---|---|
| `resume` | master-worker 子任务内 | `exec resume <SID> -` | 累积/超线性,轮多则贵 | CLI 侧完整记忆 |
| `stateless` | red-blue / pair 长程 | 全新 `exec` | 近似平(每轮 base+digest+delta) | 中枢 digest(应用层可控) |
| resume 降级 | sessionId 不可用 | 退化全新 `exec` | 同 stateless | digest 兜底 |

> **设计立场(03 §2.1 对抗性自检)**:默认 **stateless + 高质量 digest**,不把「记忆」成本甩给中转会话态。resume 仅在 playbook 显式判定「这几轮强耦合且短」时启用(master-worker 子任务内)。第二轮**不是无脑 resume**——这是 sylux 区别于「多轮就该 resume」直觉的关键决策。

### 3.4 第二轮的角色翻转(red-blue critic 追打)

red-blue 第二轮(round=1,奇轮)切到 critic,delta = proposer 上一条,evidence 强制可核验(02 §8 C1):

```
runEngine(round=1)   Playbook(red-blue)   Firewall          Adapter(claude=critic)   Blackboard
  │ P1 nextTurn ──►│ critic 轮:agent=claude,role=critic,kindHint=critique;PromptContext.delta=[proposer 上一条 message](E3 只喂增量)
  │ P2 renderPrompt:渲染 proposer 上一条 + roleBrief(delta 已在 P1 由 playbook 选定)
  │ P3 firewallPeerMessage(proposer.body+evidence,ctx)→{action,wrapped}:包边界标记+扫描防注入(RT4/O6,08§4.3)
  │    └─ action==='block'(高危注入命中)→ 该条不拼入,落 system,连续耗尽→INJECTION_BLOCKED(08)
  │ P4 adapter.send(stateless,sandbox:'read-only'(critique 是 decision))──►│ spawn
  │    ◄── final_message(raw:critique + evidence[file_ref/command])         │
  │ P5 validateMessage:role==='critic' → evidence 必须非空且**≥1 条强**核验通过(02v2§8.2 阶段B,H4)
  │    ├─ evidence 空 → EVIDENCE_REQUIRED → 回灌"补 file_ref/command"重发≤N(03§5.2/§8)
  │    ├─ 仅 spec_quote / 无 quote file_ref / 未实跑 command(都只算 weak)→ EVIDENCE_UNVERIFIABLE → 同上打回
  │    └─ file_ref 复算(readFileRange→contentHash 比对,09§7)通过 = 强 → ok
  │ P6 append critique;P7 mergeRound(critique read-only 无改动跳过);closeRound(指纹集非空)
  │    stopPolicy.update→shouldStop:本轮有新强指纹 → emptyStreak 清零(04§4.3);done 未配对→ KEEP_RUNNING → round→2
```

> **evidence 复算闭环(O5 延伸)+ 02v2「≥1 条强」(H4)**:critic 的 file_ref 必须能被中枢 `readFileRange`(09 §7)重读 + `contentHash`(02 §9.1)复算一致才算**强**证据放行。02v2 已把 v1 的「强或中」收紧为「**≥1 条强**」:未实跑的 command、无 quote 的 file_ref、spec_quote 都只算 weak,不解锁 C1。空泛批判被 `EVIDENCE_REQUIRED`/`UNVERIFIABLE` 打回重发,这是「焊死唱反调」(02 §3)在时序上的落点:critic 说不出可核验强证据就发不出话。

---

## 4. 三层状态机(中枢 / adapter / agent)

三层状态机各自独立、经事件耦合:**中枢(run 级)**驱动整体生命周期;**adapter(调用级)**管一次 send/resume 的子进程;**agent(进程级)**是 OS 进程的真实生死。下游状态变更经事件冒泡给上游,上游的 abort 经 signal 穿透到下游。

### 4.1 中枢 run 状态机(= `RunStatus`,02 §10.2 权威)

run 的生命周期状态就是 02 的 `RunStatus`;本文给其**转移触发**与对应相位:

```
                    runEngine 入口
                         │ setStatus('running')
                         ▼
        ┌──────────────────────────────────────────┐
        │              running                       │
        │  (P1–P7 循环,每轮推进 currentRound)        │◄──── resume(控制帧)
        └──┬────────┬────────┬────────┬────────┬─────┘ ──┐
           │        │        │        │        │         │ pause(轮边界 P7→P1)
   done    │  stall │  limit │ 致命/  │ 冲突   │         ▼
  (P7 stop)│ (P7stop)│(P7stop)│ abort  │ (P7    │   ┌──────────┐
           │        │        │        │ merge) │   │  paused  │
           ▼        ▼        ▼        ▼        ▼   │(可恢复)  │
        ┌────┐  ┌──────┐ ┌─────┐ ┌──────┐ ┌──────┐│          │
        │done│  │stalled│ │limit│ │aborted│ │paused├┘──────────┘
        └────┘  └──────┘ └─────┘ └──────┘ └──────┘   resume→running
        (终态)  (终态)   (终态)  (终态)  冲突 paused 经人工 inject 裁决
                                          + resume(01§7.2 挂起循环)→running
```

> **done/stall/limit 统一在 P7 轮末单点裁决(吃掉 E6/H1)**:done(`DonePolicy`/`PlaybookDonePolicy`)、stall(`ConvergencePolicy`)、limit(`MaxRoundsPolicy`/`BudgetPolicy`)全部由 04 `CompositeStopPolicy` 在 P7 `closeRound` 之后的 `update→shouldStop` 一次裁决,按优先级取唯一终态(done>aborted>limit>stalled,04 §8.2)。**无 P0 前置、无 P8 后置双检**;轮数/token 的「提前抢停」由 04 前瞻预算刹车在 P7 `shouldStop` 内做。

| 目标状态 | 触发(相位) | reason / 错误码 | 是否终态 | 来源 |
|---|---|---|---|---|
| `running` | runEngine 启动 / `resume` 控制帧 | — | 否 | 01 §2.3 |
| `paused` | `pause` 控制帧(轮边界)/ `WORKTREE_CONFLICT`(P7 merge) | 人工 / `WORKTREE_CONFLICT` | 否(可回 running) | 01 §2.3/§7.2 / 09 §5 |
| `done` | `DonePolicy`(done+ack)/ `PlaybookDonePolicy`(范式特定门)(P7 stop) | **(无 code,成功出口)** | 是 | 04 §7 |
| `stalled` | `ConvergencePolicy` 连续 N 轮无新强指纹(P7 stop) | `CONVERGENCE_STALL` | 是 | 04 §4 |
| `limit` | `MaxRoundsPolicy`/`BudgetPolicy`(累积或前瞻)(P7 stop) | `ROUND_LIMIT_EXCEEDED`/`TOKEN_BUDGET_EXCEEDED`(靠 code 区分) | 是 | 04 §3/§6 |
| `aborted` | 人工 abort / 致命错误 / `ENGINE_FATAL` | 多种(01 §4.4) | 是 | 01 §3 |

> **stall 与 done 解耦(E4)+ done 无错误码(H3)**:`paused` 是唯一可逆中间态(人工暂停 / 冲突等裁决);其余四个终态不可再转 `running`。done 是**成功出口、`code=undefined`**(04 §2.2),v1 标的 `PLAYBOOK_DONE` 错误码已删——它现在只是 `reason` 模板文本(如 `done 被对面带证据 ack`)。冲突 `paused` 经人工 `inject` 裁决 + `resume`(01 §7.2 挂起循环,冲突解除判定归 09 `mergeRound` resume 后重试)可回 `running` 续合,这是 `paused` 比其他终态特殊之处。

### 4.2 adapter 调用状态机(一次 send/resume,引用 05 §5 闸门)

adapter 是冷流:每次 `send()`/`resume()` 是一次**独立**调用生命周期。核心是 spawn 闸门(`thread.started` 前后),决定 `resumable`:

```
   send()/resume()
        │ spawn(真exe + stdin)
        ▼
   ┌─────────┐  spawn 失败(exe错/参数错)   ┌──────────────────────┐
   │SPAWNING ├──────────────────────────►│ error:SPAWN_FAILED     │ (不发 session_started,A2)
   └────┬────┘                            └──────────────────────┘   resumable=false(F-a/F-b)
        │ 进程起来,读 JSONL 流
        ▼
   ┌──────────────┐  thread.started 前死  ┌──────────────────────┐
   │ PRE_GATE     ├──────────────────────►│ error:SPAWN_FAILED     │ resumable=false(F-b)
   │(等首行)      │                        └──────────────────────┘
   └──────┬───────┘
          │ 收到 thread.started.thread_id(事实B首行)
          │ emit session_started(sessionId)  ── 闸门打开 ──► resumable=true(O3/RT8)
          ▼
   ┌──────────────┐  turn 中途死/超时/cancel  ┌─────────────────────────┐
   │ STREAMING    ├──────────────────────────►│ error:CRASHED/CANCELLED  │ resumable=true(F-c)
   │(透传delta/   │                            └─────────────────────────┘ 可 resume
   │ tool_call)   │
   └──────┬───────┘
          │ turn.completed(usage)+ 进程 close code=0
          ▼
   ┌──────────────┐
   │ final_message│ emit{raw,usage};流正常结束(for-await 退出)
   └──────────────┘
```

| 状态 | 含义 | 出边 | emit |
|---|---|---|---|
| `SPAWNING` | 调 spawn,未确认进程起来 | →PRE_GATE / →error | — / `error:SUBPROCESS_SPAWN_FAILED`(F-a) |
| `PRE_GATE` | 进程起来,等 `thread.started` 首行 | →STREAMING / →error | `session_started`(闸门开) / `error:SPAWN_FAILED`(F-b) |
| `STREAMING` | 已拿 sessionId,透传流 | →final / →error | `delta`/`tool_call` / `error:CRASHED|CANCELLED`(F-c) |
| `final_message` | 拿到 `turn.completed.usage` + 终态文本 | (流结束) | `final_message{raw,usage}` |

> **闸门是 adapter 状态机的心脏**:`PRE_GATE→STREAMING` 转移 = emit `session_started` = 置 `resumable=true`,三者同一时刻发生,不可拆。这焊死 O3:没穿过闸门就没有 resume 凭据,`cancel()` 在 PRE_GATE 触发的是 `SPAWN_FAILED`(仍不伪造 session_started),在 STREAMING 触发的才是 `CANCELLED`(05 §10.4)。

### 4.3 agent 进程状态机(OS 进程真实生死)

agent 是 OS 进程(codex.exe / claude shim 背后 node),其状态机最简单,但 cancel/超时的「杀进程树」是 Windows 关键(事实 A:shim 背后有真子进程):

```
        spawn(windowsHide,extendEnv:false,env白名单)
              │
              ▼
        ┌──────────┐ stdin.end() 后开始干活  ┌──────────┐
        │ STARTED  ├────────────────────────►│ RUNNING  │ (读现状/写worktree/调中转)
        └────┬─────┘                          └────┬─────┘
             │ 立即崩(exe错)                       │
             ▼                                      │ 正常产出 + exit(0)
        ┌──────────┐                                ▼
        │ EXIT≠0   │                          ┌──────────┐
        │(F-a/F-b) │                          │ EXITED(0)│ → adapter 收 close,emit final/error
        └──────────┘                          └──────────┘
             ▲                                      ▲
             │  cancel()/超时 → treeKill(进程树)    │
             └──────────────────────────────────────┘ (杀 shim 背后真 node,事实A;不留孤儿RT6)
```

| 状态 | 含义 | 转移 |
|---|---|---|
| `STARTED` | 进程已 spawn,stdin 未关 | →RUNNING(stdin.end) / →EXIT≠0(立即崩) |
| `RUNNING` | 干活中(可能 fork 中转代理子进程) | →EXITED(0)(正常)/ →被 treeKill(cancel/超时/abort) |
| `EXITED(0)` | 正常退出 | adapter emit final_message |
| `EXIT≠0 / killed` | 异常退出 / 被杀树 | adapter 按闸门相位 emit error(05 §10.2) |

> **treeKill 不只杀直接子进程(事实 A)**:`process.kill(child.pid)` 在 Windows 只杀 shim,留 node 孤儿继续烧 token(违反 RT6)。`cancel()`/超时/abort 一律 `treeKill`(05 §10),清理 worktree 前也先 `cancel()` 解除文件锁(09 §8.2)。三层状态机里,这是「点了停子进程还在烧」不可能发生的物理保证。

### 4.4 三层状态机的耦合(事件向上、abort 向下)

```
 中枢 run 状态机(running/paused/终态)
      ▲ 事件冒泡                       │ abort 穿透(root.signal,01§3.2)
      │ (session_started→recordSession;│ ▼
      │  final_message→append;          │
      │  error→致命/重试判定)            ▼
 adapter 调用状态机(SPAWNING→…→final)
      ▲ AgentEvent                      │ cancel()→treeKill
      │                                 ▼
 agent 进程状态机(STARTED→RUNNING→EXITED)
```

| 方向 | 机制 | 例 |
|---|---|---|
| 向上(事件) | `AgentEvent` 经 adapter 流 → engine `consume`(03 §5.3) | `session_started`→`recordSession`→run 标 `resumable`;`final_message`→`append`→run 推进 round |
| 向下(取消) | `root.signal` 注入 adapter(01 §3.2)→ `cancel()`→`treeKill` | 人工 abort→`root.abort`→两 adapter `cancel`→两进程树被杀 |
| 横向(并发) | parallel 范式两 adapter 调用并发(03 §3.2),同一 signal 同时穿透 | abort 时两子进程并行被杀(01 §3.3 `allSettled`) |

---

## 5. S4 收敛 → 停 → 合并 worktree → 产出(详时序)

### 5.1 三类正常停止(done / stall / limit)+ 一类异常(abort)

引擎在**每轮末 P7**(`closeRound` 之后)调一次 04 `CompositeStopPolicy.update→shouldStop` 统一裁决(无 P0 前置、无 P8 后置双检,RT11/H1)。done(成功出口)+ 三重刹车四条停止路径,按优先级取唯一终态(04 §8.2):

```
runEngine 每轮         CompositeStopPolicy(04,P7轮末单点)            finalize(01§2.2)
  │ P7 closeRound(k):封存 Round.evidenceFingerprints + usage         │
  │ stopPolicy.update(ctx)：先全量推进子 policy 状态(stall 计数等,不短路 04§8.1)
  │ stopPolicy.shouldStop(ctx)：收集触发 → 优先级裁决(done>aborted>limit>stalled)
  │   ├─ DonePolicy:跨全 run 配对 done↔对面带强证据 ack(C2)→ status:done(无 code)
  │   ├─ PlaybookDonePolicy:范式特定门(parallel 全 lane done / mw 清单全 accept)→ status:done
  │   ├─ MaxRoundsPolicy:round+1≥maxRounds → status:limit(ROUND_LIMIT_EXCEEDED)
  │   ├─ BudgetPolicy:累积实测 token/费用触顶 或 前瞻外推下轮破预算 → status:limit(TOKEN_BUDGET_EXCEEDED)
  │   └─ ConvergencePolicy:连续 window 轮新强指纹差集为∅(04§4.3)→ status:stalled(CONVERGENCE_STALL)
  │ decision.shouldStop? ── true ──►│ appendSystemMessage(reason)+setStatus(status,code?,reason)→finalize
  │                       └ false ─► engine.startNextRound()(预算前瞻已在 shouldStop 内判过)
  │ 任意相位 abort(signal)─────────────────────────────────────────►│ finalize('aborted',reason)
  │                                                                  ▼
  │                                  setStatus(终态,code?)→onFinish→广播 status(终态,11§7.4 强制不丢)
```

| 停止类型 | 检测点 | 终态 | 错误码 | 是否「正常」 | 走 abort? |
|---|---|---|---|---|---|
| done | P7 `DonePolicy`/`PlaybookDonePolicy` | `done` | (无,成功出口) | 是 | 否,走 finalize 返回 |
| stall | P7 `ConvergencePolicy` | `stalled` | `CONVERGENCE_STALL` | 是 | 否 |
| limit(轮) | P7 `MaxRoundsPolicy` | `limit` | `ROUND_LIMIT_EXCEEDED` | 是 | 否 |
| limit(token) | P7 `BudgetPolicy`(累积/前瞻) | `limit` | `TOKEN_BUDGET_EXCEEDED` | 是 | 否 |
| 人工 abort / 致命 | 任意相位(signal)/ catch | `aborted` | 多种(01§4.4) | 否 | 是,signal 穿透 |

> **done 的「双证据握手」(C2)+ 优先级(04§8.2)**:done 不是单方说完就完——一方发 `done`,对面必须发带可核验**强** evidence 的 `ack`(02 §5.2 C2)才真停。这防止双方互相秒认 done。同轮多刹车并触时按优先级取唯一终态:done(0)>aborted(1)>limit(2)>stalled(3)——既达成 done 又恰好触顶 maxRounds 记 **done**(任务实际已完成,不记超限失败)。stall 是「吵不出新东西」的被动终止,与 done 完全独立(E4):done 走不到时 stall 兜底,反之亦然。

### 5.2 done 的双证据握手时序(red-blue 收尾)

```
runEngine        Adapter(proposer)      Adapter(critic)        Blackboard       DonePolicy(04,P7)
  │ round=k(偶):proposer 自认完成
  │ P4 send ──►│ final_message(kind:done, body:"已满足全部需求")
  │ P6 append done(id=D)──────────────────────────────────────►│
  │ P7 stopPolicy.shouldStop:DonePolicy 跨全 run 找对面带强证据 ack? 无 → KEEP_RUNNING → 继续
  │ round=k+1(奇):critic 验证 proposer 的 done
  │ P4 send ──────────────────►│ final_message(kind:ack, inReplyTo:D,
  │                            │   evidence:[file_ref 复算通过] = 我核实过确实满足)
  │ P5 validateMessage:kind==='ack' 且 inReplyTo→done → evidence 必须**≥1 条强**可核验(C2,02v2 H4)
  │ P6 append ack ─────────────────────────────────────────────►│
  │ P7 stopPolicy.shouldStop:DonePolicy 命中
  │   dones.some(D)+ack(ack.inReplyTo===D.id && ack.from!==D.from && ack.evidence.length>0)=true(04§7.1)
  │ → setStatus('done', /*code*/undefined, reason='done 被对面带证据 ack(done.from=…,ack.from=…)')→finalize('done')
```

> **done 终态无错误码(H3)**:v1 此处写 `finalize('done','PLAYBOOK_DONE')` 把 done 标错误码——已删。done 是 04 §0.1 的**成功出口**,`StopDecision.code=undefined`(04 §2.2);`reason` 只是固定模板文本(只含闭枚举 agentId,不内插 agent 自由文本,04 §2.2 S8/H-INJ)。配对判定 `ack.evidence.length>0` 是廉价护栏——强度保证早在 P5 `validateMessage` 入黑板时已强制「≥1 条强」(04 §7.1)。

### 5.3 收口轮合并 worktree(S4 的关键 IO)

停止判定后(或对 parallel 范式的收口轮),P7 触发 `mergeRound` 把各 worktree 串行并入 integration。这是「产出」的物理动作:

```
runEngine(P7)      Playbook            Worktree(09§5)                         Blackboard
  │ shouldMergeAt(round)? ──►│ true(parallel 收口轮 / red-blue 末轮)
  │ worktrees.mergeRound(round) ──►│ writers=writersOfRound(round)(字典序确定,09§5.4)
  │                                │ for agentId in writers(串行,W3):
  │                                │   commitWorktree(agent 分支固化本轮改动)
  │                                │   mergeTreeProbe(integration, agent分支)(无副作用探冲突,09§5.3)
  │                                │   ├─ 无冲突 → git merge --no-ff 并入 integration
  │                                │   └─ 冲突 → 见 §5.4 硬停分叉
  │ ◄── MergeResult{ok:true,mergedAgents,integrationRef}                      │
  │ closeRound(round)─────────────────────────────────────────────────────►│ jsonl:round_closed
  │ 广播 diff_ready(中枢 git diff 生成,W5)+ round_closed + usage(11§10.2)
```

### 5.4 合并冲突硬停分叉(W4,不选边)

冲突是 S4 唯一会把「正在收尾的 run」打回 `paused` 等人工的路径:

```
Worktree.mergeRound       buildConflictEvidence(09§6)        runEngine(01§7.2 挂起循环)   面板
  │ mergeTreeProbe 冲突(exitCode≠0)
  │ ──► 每个冲突块 → 2条 file_ref(ours=integration / theirs=agent)+ 可选 base spec_quote
  │     (diff3 解析,行号映射回各 worktree 真实行,09§6.2)
  │ return {ok:false,code:WORKTREE_CONFLICT,conflictEvidence,conflictingFiles,blockedAgent}
  │ ──────────────────────────────────────────────────────►│ append systemMessage(round,
  │                                                          │   WORKTREE_CONFLICT,conflictEvidence)
  │                                                          │   (from:orchestrator,C7;evidence 强核验天然通过09§6.3)
  │                                                          │ setStatus('paused','WORKTREE_CONFLICT')
  │                                                          │ **挂起循环 suspendForArbitration(01§7.2),NOT finalize**
  │                                                          │ ──► 广播 status(paused)+round_closed(hadConflict:true)
  │ 人工在 integration worktree 手解冲突,面板 inject 裁决 → resume(01§7.2)────────────────►│ control
  │ ──► setStatus('paused'→'running');主循环重试 mergeRound 续合剩余 writer(冲突解除判定归09)
```

> **paused 是非终态挂起,不 finalize(吃掉 H6 / 对齐 01§7.2)**:v1 此处写 `finalize('paused')` 是 bug——02§10.2 钉死 `paused` 非终态、`finalize` 会冻结它,人工裁决后无处可去。v3 改为 `setStatus('paused')` 后进 `suspendForArbitration` **挂起循环**阻塞等控制帧:`inject`(人工裁决补一条)留在 paused、`resume`(`paused→running`)回主循环重试 merge、`abort` 才转 `aborted` 终态。冲突是否真正解除由 09 `mergeRound` 在 resume 后重试时判定,引擎不替 09 选边(RT1)。
>
> **不选边的物理保证(W4)**:`mergeTreeProbe` 用 `git merge-tree --write-tree` **无副作用**探冲突,冲突时工作区保持合并前干净态——中枢不写 ours/theirs 任何一方进 integration。冲突点构造成**天然可核验**的 `conflictEvidence`(file_ref 指向各 worktree 真实区间,能被 02 §8.3 `verifyEvidence` 复算 pass,09 §6.1),回灌黑板不会被自己的校验管线打回。

### 5.5 finalize 与 cleanup(产出落定)

```
runEngine            finalize             runOrchestration.finally(01§2.2)      Worktree
  │ (任意停止路径)──►│ setStatus(终态,reason)──► jsonl:status_changed(末行)
  │                  │ playbook.onFinish(status,view)(范式级总结,可选)
  │                  │◄── RunResult{status,reason,runId}
  │ ──────────────────────────────────────►│ pump.stop()(控制泵停)
  │                                         │ runStore.flush()(fsync 末行落盘,O8)
  │                                         │ killAllChildren(RT6 二道兜底:两 adapter cancel→treeKill)
  │                                         │ worktrees.cleanup(runId,{keepOnConflict})(09§8)
  │                                         │   ├─ done/stalled/limit → 删 worktree/分支/tag/目录,prune
  │                                         │   └─ paused(冲突)→ keepOnConflict 保留供人工检视
  │ ◄── 进程返回 RunResult;integration 分支 = 最终产出(用户可 merge 回主仓)
```

| 终态 | cleanup 行为 | integration 产出 |
|---|---|---|
| `done` | 全清 worktree/分支/tag | integration 含累积改动,用户可 merge 回 HEAD |
| `stalled`/`limit` | 全清 | integration 含「停止前」的累积改动 |
| `aborted` | 全清(force 兜底 Win 文件锁) | integration 可能不完整(中途停) |
| `paused`(冲突) | **保留**(keepOnConflict) | integration 停在冲突前;人工裁决后续合 |

> **产出 = integration 分支**:sylux 的最终交付物是 `refs/sylux/<runId>/integration`(09 §2.1)。它从 base tag(run 起点)切出,累积每轮串行合并的改动。cleanup 删的是 agent worktree / 临时分支,**integration 的 commit 已在用户仓的 git 对象库**(merge --no-ff 落的),删 worktree 不丢 commit;用户按需 `git merge` 或 cherry-pick 回主分支。【待实测】cleanup 是否保留 integration 分支引用供用户取用,还是仅留游离 commit 靠 reflog —— M0 定策略(见 §8 openQuestions)。

---

## 6. parallel 范式的并发时序(唯一 execution:'parallel')

前文 §2–§5 以串行范式(red-blue)为主线。parallel 范式(03 §7.4)是唯一并发执行的打法:一轮两 turn 并发,各写各 worktree,轮末统一合并。它的时序差异集中在 P4(并发 dispatch)与 P7(收口合并)。

### 6.1 parallel 一轮并发时序

```
runEngine(P1–P7)   Playbook(parallel)   Adapter(codex)         Adapter(claude)        Worktree
  │ P1 nextTurn ──►│ RoundPlan{execution:'parallel',turns:[
  │                │   {agent:codex,role:worker,promptContext:lane_codex},
  │                │   {agent:claude,role:worker,promptContext:lane_claude}]}(各看各的线,互不喂对面)
  │ P4 Promise.allSettled([runTurn(codex),runTurn(claude)])(01§3.3,不用 all 防漏杀)
  │    ├─ runTurn(codex): send ──►│ spawn ──► final_message  │                       │ 写 worktree:codex/
  │    └─ runTurn(claude):send ─────────────────────────────►│ spawn ──► final_message│ 写 worktree:claude/
  │    (两子进程真并发;同一 root.signal 注入,abort 同时穿透两者)
  │ P6 append:engine 串行 append 两条(RT5 单写者,汇合后串行,不并发写 jsonl)
  │ P7 shouldMergeAt(收口轮)? → mergeRound:writers=[claude,codex](字典序,09§5.4)
  │    串行并入 integration:先 claude 后 codex;若改同文件同区间 → 冲突硬停(§5.4)
  │    stopPolicy.shouldStop:PlaybookDonePolicy(parallel 全 lane done & merge 干净,无对面 ack,04§7.3)→ done
```

> **parallel 的 done 走 `PlaybookDonePolicy` 而非 `DonePolicy`(04§7.3/§9)**:parallel 两 worker 各跑各的、**无对面 ack**,`DonePolicy` 的「对面带证据 ack」条件天然不成立。范式特定门「全 lane 发过 done & merge 干净」是 `playbook.isDone` 的职责,经 `PlaybookDonePolicy` 包装注入 04 `CompositeStopPolicy`,在 P7 轮末与其它刹车并列裁决——引擎本体不再单独 `if(isDone)`(03 H2)。冲突时引擎已在 P7 merge 阶段置 paused 提前返回,走不到 stop 裁决(职责不重叠)。

### 6.2 串行 vs 并行时序差异速查

| 维度 | 串行范式(red-blue/master-worker/pair) | 并行范式(parallel) |
|---|---|---|
| P1 `turns.length` | 1 | 2 |
| P4 执行 | `await runTurn` 逐个 | `Promise.allSettled(turns.map(runTurn))`(01 §3.3) |
| 子进程并发 | 否(同时只一个) | 是(两进程真并发,中转限流风险见下) |
| P6 append | 单条 | 两条,engine **汇合后串行** append(RT5,不并发写盘) |
| abort 穿透 | 当前 runTurn signal 抛 | 同一 signal **同时**穿透两 runTurn,两进程并行被杀 |
| 失败隔离 | 单 turn | 各写各 worktree,一 turn 失败不污染另一(合并冲突轮末才暴露) |
| 收口合并 | 每轮可合 | 仅收口轮合,轮末统一 3-way |

> **为何 parallel 用 `allSettled` 不用 `all`(01 §3.3)**:`Promise.all` 在第一个 reject 时立即 resolve 外层,但另一个 runTurn 协程仍在跑;若此时直接 finalize 可能在它清理 worktree/流前就 killAllChildren,产生竞态。`allSettled` 保证两 runTurn 都走完各自 finally(子进程已被同一 abort 杀,不会卡)。abort 实时性靠 signal,不靠 all 短路。

### 6.3 parallel 隔离与注入断链(E5/R7/R8)

```
worker codex 线 ──写──► worktree:codex/ ──┐
                                          │ 运行期无锁、互不可见(W2)
worker claude 线 ─写──► worktree:claude/ ─┘ 只在轮末 mergeRound 交汇(W3)
  │ laneDelta 只喂自己线 + system,绝不把对面 worker 输出喂过来(03§7.4)
  │ ──► ① 省 token(不重灌对面历史)② 断注入链(对面输出无法劫持本线,R8)
```

> parallel 三红队要点(03 §7.4 注):① 两 worker 运行期完全隔离,`laneDelta` 不喂对面;② 改同文件冲突不在运行期检测,轮末 3-way 暴露,冲突→system 回灌→paused 等人工(不静默重试);③ `PlaybookDonePolicy.probe`(范式 `isDone`)不自判 merge 干净——有冲突引擎已在 P7 merge 阶段置 paused 提前返回,走不到 stop 裁决(职责不重叠)。

### 6.4 【待实测】parallel 并发 spawn 的中转限流(Q3)

事实地基未覆盖「两子进程并发 exec 时中转(mouubox)是否限速」。03 §10 Q3 标为 M0 验证项:两进程并发请求若被中转 429 限流,parallel 吞吐优势会被抵消,可能需要错峰 spawn 或并发度降级。本文时序按「并发不限流」画;若实测限流,P4 的 `Promise.allSettled` 需加并发闸(信号量),不影响状态机,只影响 P4 内部调度。

---

## 7. 暂停 / 介入 / 中止的状态转移(控制帧穿越时序与状态机)

三类人工控制(暂停 pause / 介入 inject / 中止 abort)从面板经 WS(11 §4.2)→ `ControlQueue`(01 §2.3)→ 引擎在相位边界或 signal 穿透消费。共同不变量:**控制帧不直改黑板(W4),只投队列,由引擎受控消费**;inject 照样过 `validateMessage`+ 防火墙(RT3)。

### 7.1 控制帧总通路(三类共用)

```
面板         WsHub(11§4.4)          ControlQueue(01§2.3)     runEngine 消费点         效果
  │ {pause/resume/inject/abort,cid} ──►│ admitClientFrame:           │                    │
  │  鉴权门(W5)+权限门(W6:control)   │ scope!=control→close 4403   │                    │
  │ ◄── control_ack{cid,accepted}(受理≠生效,11§2.3)               │                    │
  │                                     │ push(ControlFrame) ────────►│ poll()/next()      │
  │                                     │   pause/resume/inject:在轮边界(P7→P1 之间)消费(不撕裂发言)
  │                                     │   abort:经 signal 任意相位立即穿透(不等边界)
```

| 控制帧 | 消费时机 | 是否等轮边界 | 直接副作用 | 黑板可见效果(异步) |
|---|---|---|---|---|
| `pause` | 轮边界(P7→P1) | 是 | `setStatus('paused')`,循环阻塞 `controlQueue.next()` | `status(paused)` 广播帧 |
| `resume` | paused 阻塞中 | 是 | `setStatus('running')`,回下一轮 P1 | `status(running)` 广播帧 |
| `inject` | 轮边界(P7→P1) | 是 | `validateMessage`+ 防火墙 → `append(from:human)` | `message(from:human)` 广播帧 |
| `abort` | **任意相位** | **否(signal 穿透)** | `root.abort(reason)` → 全树取消 → finalize('aborted') | `status(aborted)` 广播帧 |

### 7.2 暂停 / 恢复状态转移(pause/resume)

pause 在轮边界消费(不在 P4 子进程流中途插队,避免撕裂一次发言):

```
running 态                                    paused 态
  │ P4 进行中收到 pause                          │
  │ ──► 等本次发言落 P6 + 本轮 P7 收尾(不杀子进程)► setStatus('paused')
  │                                              │ 循环阻塞在 controlQueue.next(signal)(不空转CPU)
  │ ◄────────── resume(回 running)──────────────│
  │ 从下一轮 P1 继续                              │ 收 abort?→转 aborted(paused 态也可 abort)
```

```
runEngine 循环         ControlQueue         Blackboard          面板
  │ 轮边界(P7→P1)poll() ─►│ {kind:pause}     │                   │
  │ setStatus('paused')──────────────────►│ jsonl:status_changed(paused)
  │ 广播 status(paused)────────────────────────────────────────►│ 面板显示"已暂停"
  │ next(signal)阻塞… (不进 P1,不烧 token)  │                   │
  │ ◄── {kind:resume}──│                    │                   │ 用户点"恢复"
  │ setStatus('running')─────────────────►│ jsonl:status_changed(running)
  │ 广播 status(running);回 P1 起下一轮                          │
```

| 边界场景 | 行为 |
|---|---|
| P4(子进程流中)收到 pause | 等本次发言落 P6 + 本轮 P7 收尾再暂停,**不杀子进程**(发言完整性优先) |
| 已终态 run 收到 pause/resume | 忽略 + 告警(11);终态不可逆(除冲突 paused) |
| paused 态收到 abort | 允许:paused→aborted(abort 任意态可达) |
| paused 态收到 inject | 允许:在 paused 的挂起循环里消费(人工补一条再恢复,01§7.2) |

### 7.3 介入状态转移(inject,人工插话)

inject 是唯一让 `from:'human'` 进黑板的通路;它**照样过 RT3 校验**(human 也可能粘错路径 / 伪造 evidence):

```
面板          WsHub             ControlQueue      runEngine(轮边界 P7→P1)  Firewall+validate    Blackboard
  │ inject{payload:AgentMessagePayload,cid} ──►│ admit(W6 control)        │                    │
  │ ◄── control_ack{accepted}(仅受理)          │ push{kind:inject,from:human,role,payload}       │
  │                                            │◄── poll() ──────────────►│                    │
  │                                            │  firewallPeerMessage(payload.body/evidence,ctx)→{action,wrapped}(08§4.3)
  │                                            │  validateMessage({from:human,role,...payload})(02§8)
  │                                            │  ├─ block / 校验失败 → 回 error(不入黑板,RT3)──►│ 面板报错
  │                                            │  └─ ok → append(from:human)──────────────────►│ jsonl+广播 message
  │ ◄── message(from:human,seq) ───────────────────────────────────────────────────────────────│ 面板显示人工气泡
```

| 校验项 | 规则(02 §8 / 08) | 失败 |
|---|---|---|
| schema | `agentMessagePayloadSchema.safeParse` | `OUTPUT_SCHEMA_VIOLATION`,不入黑板 |
| role | 02 `roleSchema` 不含 `'human'`,须显式带业务 role(通常 `arbiter`);`kind==='system'` 仅 orchestrator 可发(C7) | 拒,不入黑板 |
| evidence(若 human 发 critique/role=critic) | 同 critic:非空 + **≥1 条强**核验(C1,02v2 H4) | `EVIDENCE_REQUIRED`/`UNVERIFIABLE` |
| 路径 | `file_ref`/`files` 过 `isPathSafe`(C6,08§4.4) | `WORKTREE_PATH_VIOLATION` |
| 防火墙 | body/evidence 边界标记 + 特征扫描(08 §4);高危命中 `action:'block'` | 注入特征命中 → block 不入黑板 |

> **受理 ≠ 生效(11 §2.3)**:面板先收 `control_ack`(inject 已入 ControlQueue),稍后才收该 inject 真正落黑板的 `message` 广播帧(带新 seq)。两者用 `cid`(关联受理)和 `seq`(排序落地)分别承载,不混用。inject 在引擎**轮边界**消费(不在 P4 中途),保证不撕裂正在进行的 agent 发言。human 注入的 critique/critic 同样触发 02 C1 evidence 强制(01 §2.3:RT3 不为人开后门)。

### 7.4 中止状态转移(abort,唯一不等边界穿透)

abort 是唯一**不等相位边界、立即经 signal 穿透到 P4 子进程**的控制帧(RT6 实时性):

```
面板       WsHub        ControlQueue/pump      root(LinkedAbort,01§3.1)    Adapter×2         finalize
  │ abort{reason,cid} ──►│ admit(control)        │                          │                 │
  │ ◄── control_ack       │ pump 调 root.abort(reason)──►│ signal.abort(穿透全栈,01§3.2)
  │                       │                       │ ──► adapter.cancel()×2 ─►│ treeKill 进程树  │
  │                       │                       │     (P4 流以 error:SUBPROCESS_CANCELLED 收尾)
  │                       │                       │ runTurn 抛 → runEngine catch / 检查点
  │                       │                       │ ──────────────────────────────────────────►│ finalize('aborted',reason)
  │ ◄── status(aborted)(11§7.4 强制不丢)─────────────────────────────────────────────────────│ setStatus+jsonl
  │                       │ runOrchestration.finally:flush + killAllChildren(二道兜底)+ cleanup
```

abort 到达不同相位的处置(引用 01 §3.4):

| abort 到达相位 | 行为 | 子进程处置 |
|---|---|---|
| P1/P2/P3(规划/渲染/防火墙) | 检查点 `signal.throwIfAborted()` 抛 → catch → finalize('aborted') | 无运行子进程,finally 兜底 cancel |
| **P4(dispatch)** | signal 立即穿透 execa → 杀进程树 → 流 `error:CANCELLED` → runTurn 抛 → finalize | **立即杀树**(实时性) |
| P5/P6 | P6 append 原子:已开始的 append 跑完(整条落或不落)再 finalize | 无子进程 |
| P7(merge+close+stop) | merge 前可断(git 子进程收 signal);已落盘 round_closed 原子;stopPolicy 纯计算无 IO | git 子进程被杀 |

> **幂等保证(01 §3.4)**:`linkAbort.abort` 与 `adapter.cancel` 都幂等。面板狂点 abort / 信号叠加(SIGINT+SIGTERM)只第一次生效,后续 no-op。这保证「点了停子进程还在烧 token」物理不可能:第一次 abort 已穿透杀树,finally 再兜底,二者皆幂等无副作用(对应 RT6)。

### 7.5 三类控制对状态机的影响汇总

```
                          ┌─────────── inject(轮边界 P7→P1,过校验)──► 黑板加一条 human 消息,状态不变
                          │
   running ───────────────┼─── pause(轮边界 P7→P1)──► paused ──resume──► running
      │                   │                          │
      │                   │                          └── abort ──► aborted
      │                   │
      └── abort(任意相位,signal穿透)─────────────────────► aborted(杀子进程树)
```

| 控制 | run 状态机影响 | adapter 状态机影响 | agent 进程影响 |
|---|---|---|---|
| pause | running→paused(可逆) | 无(等当前调用自然结束) | 无(P4 中则等其完成) |
| resume | paused→running | 无 | 无 |
| inject | 不变(加一条 message) | 无 | 无 |
| abort | →aborted(不可逆) | 进行中调用 →error:CANCELLED | treeKill 进程树 |

---

## 8. 失败路径时序汇总 + 崩溃恢复 + 收尾

### 8.1 全失败路径的时序落点(对接 01 §4.4 / 04 §11)

把所有失败按「在哪个相位触发 → 走什么处置 → 落什么终态」铺到时间线(错误码全集归 02 §12,本表只编排时序):

| 失败 | 触发相位 | 时序处置 | 终态 | jsonl 末态 |
|---|---|---|---|---|
| spawn 失败(F-a/F-b) | P4(闸门前) | adapter emit `SPAWN_FAILED`,不发 session_started → runTurn 致命 → finalize | `aborted` | `system`+`status_changed(aborted)` |
| schema 违例 | P5 | 立即重发≤N(不退避,内容错)→ 耗尽则本轮该 agent 失败 | 不变(run 继续) | 失败仅 `system`;成功才 `message` |
| evidence 缺失/不可核验 | P5 阶段B | 回灌「补 file_ref/command」重发≤N(退避无意义) | 不变 | 同上 |
| 协议违规(路径越界/悬空 ref/system 伪造) | P5 跨字段 | 不重试,落 system,计红队无效发言 | 不变 | `message(system)` |
| 合并冲突 | P7(merge) | system 回灌 conflictEvidence,`setStatus('paused')` 挂起循环等人工(不 finalize、不重试,01§7.2) | `paused`(非终态) | `message(system)`+`status_changed(paused)` |
| provider 熔断 open | P4 前 | `canDispatch()=false`,不 spawn 直接致命(省 base token,01§4.3) | `aborted` | `status_changed(aborted)` |
| 轮数/token 超预算 | P7(轮末 stop) | `MaxRoundsPolicy`/`BudgetPolicy`(累积或前瞻)命中,正常收尾(非错误) | `limit` | `status_changed(limit,code)` |
| 连续 N 轮无新强指纹 | P7(轮末 stop) | `ConvergencePolicy` 命中,与 done 解耦 | `stalled` | `status_changed(stalled)` |
| 引擎未预期异常 | 任意 | try/catch 兜底落终态,不吞 | `aborted` | `status_changed(aborted,ENGINE_FATAL)` |
| 人工 abort | 任意(signal) | 全树取消 → finalize | `aborted` | `status_changed(aborted,reason)` |

> **不变量复核**:除合并冲突 `paused`(非终态挂起,01§7.2,不走 finalize 以便 resume)外,任何一行终态都经 `finalize` 落一条 `status_changed`(03 §5.1),`runOrchestration.finally` 再兜底 flush+killAllChildren(01 §2.2)。轮数/token/stall 三条均为 P7 轮末单点 `shouldStop` 裁决(无 P0/P8 双检,RT11);`limit` 靠 `code`(`ROUND_LIMIT_EXCEEDED`/`TOKEN_BUDGET_EXCEEDED`)区分轮数还是预算。不存在「run 停了 jsonl 没终态行」或「停了子进程还活着」(RT5/RT6/O8)。

### 8.2 重试在时序里的位置(P5 内循环,计费意识)

```
P5 validateMessage ──► !ok 且可重试?
  │ 是:
  │   ├─ OUTPUT_SCHEMA_VIOLATION:内容错 → **不退避**立即重发(只回灌反馈)
  │   └─ adapter 传输层瞬时错(429/网络):**退避后重发**(指数200ms→5s+抖动,01§4.2)
  │   重发 = 一次完整新发言,吃满 base≈18.7k(事实D);重试计入 token 预算
  │   attempt>retryOnReject(默认3)→ 本轮该 agent 失败(非致命),run 不炸
  │ 否(协议违规/致命):见 §8.1 对应行
```

> **退避与 token 的张力(01 §4.2)**:退避只挡「中转限流」类瞬时错;对「schema 写错」类内容错退避无意义却仍计费。故可重试错再细分:内容错不退避(写错了改),传输错退避(线路忙等)。混用会白烧 token 也白等时间。

### 8.3 崩溃恢复时序(中枢进程死后重启,引用 01 §5.4)

```
中枢重启         RunStore.replay(runId)           foldRecord            判定
  │ 扫 runs/<runId>.jsonl 逐行 decode(02§7.2)
  │ ├─ run_started → 建壳(status=running)
  │ ├─ message → push messages,按 round 归桶
  │ ├─ round_closed → 填 rounds[index],currentRound++
  │ ├─ agent_session → agents[].sessionId+resumable=true(RT8)
  │ ├─ status_changed → 末态覆盖 status
  │ └─ 末行残缺(写一半崩)→ 丢弃,前完整行权威(02§7.3)
  │ ──► 重建 BoardState
  │ 回放完末态仍 running? → run 是崩溃中断的:标记可恢复,面板提示"上次异常退出"
  │ **默认不自动续跑**(事实D:resume 累积计费 + 事实A:子进程已死需重 spawn)
  │ 是否 resume 由用户面板显式触发(RT8:agent_session 行已有 sessionId)
```

| 崩溃场景 | 检测 | 恢复 |
|---|---|---|
| 末行残缺 | `decodeJsonlLine` 末行 ok:false | 丢弃末残行,前行权威 |
| 中间行损坏 | 非末行 decode 失败 | **抛错**(文件被外部破坏,人工介入) |
| 无终态行 | 回放完仍 running | 标可恢复,面板提示,不自动续跑 |
| sqlite 与 jsonl 不一致 | reindex 校验 | jsonl 重建覆盖 sqlite(jsonl 永远赢) |

> 【待实测,01 §5.4 / 03 §10 Q1】崩溃后旧 SESSION_ID 跨进程 resume(子进程已死,用旧 thread_id `exec resume`)能否成功——事实地基 E 给了 resume 参数集,但未测「进程已死后用旧 id resume」。M0 需验证;在此之前,崩溃恢复仅用于面板回看 / 审计,不保证续跑。

### 8.4 与 graceful shutdown 的关系(多 run,01 §6.2)

中枢收 SIGINT/SIGTERM 时,对**所有**在跑 run 走 §7.4 的 abort 路径(每 run 独立 LinkedAbort 根):

```
SIGINT/SIGTERM ──► 所有 run root.abort('SHUTDOWN') ──► 各 runOrchestration.finally
  │ 限时等(SHUTDOWN_GRACE_MS 默认10s)所有 run finalize
  │ ──► 超时则强杀残留进程树 + close 所有 RunStore ──► process.exit(0)
```

> Windows 注意(事实 A):SIGTERM 语义弱,实际靠 execa signal + treeKill 杀进程树。宽限窗给子进程「落最后一条」的机会,超时才强杀,平衡「不丢数据」与「不卡死」。

### 8.5 收尾:本文件的编排契约声明

1. **本文件零新增**:不定义任何类型 / 接口 / 错误码 / 阈值,只把 01/02/03/04/05/06/08/09/11 的既有契约编排到统一时间轴与状态机上。任何字段 / 签名歧义一律回上述权威文档,以其为准。
2. **三层状态机权威**:中枢 run 状态机 = 02 §10.2 `RunStatus`(本文只给转移触发);adapter 调用状态机 = 05 §5 spawn 闸门的时序投影;agent 进程状态机 = OS 进程生死 + treeKill(事实 A)。三者经「事件向上、abort 向下、并发横向」耦合(§4.4)。
3. **七相位 P1–P7 + 轮末单点 StopPolicy(RT11/H1)**:终止裁决统一在 P7 轮末 `closeRound` 后 `stopPolicy.update→shouldStop` 一次,**无 P0 前置、无 P8 后置双检**;轮数/token「提前抢停」由 04 前瞻预算刹车在 P7 `shouldStop` 内承担;done(成功出口无错误码)经 `DonePolicy`/`PlaybookDonePolicy` 并入 04 composite,引擎不再 `if(isDone)`(03 H2)。
4. **八个顺序保证 O1–O8(§1.3)是硬交付**:解析真 exe 先于 spawn、worktree 先于 send、session_started 先于 resumable、落盘先于广播、校验先于 append、`firewallPeerMessage` 先于喂对面、合并仅 P7 串行、终态必经 finalize。违反即 bug。
5. **控制三态转移(§7)**:pause/inject 在**轮边界(P7→P1)**消费(不撕裂发言),abort 经 signal 任意相位穿透(实时杀树);全部不直改黑板(W4),inject 照样过校验+`firewallPeerMessage`(RT3/RT4)。合并冲突 `paused` 是**非终态挂起**(01§7.2 `suspendForArbitration`),不走 finalize。
6. **编号纪律(C-NUM)**:安全防火墙=08、worktree 隔离=09(v1 把安全也写 09 已纠);收敛刹车=04(非旧称 07)。
7. **与兄弟文档的回填**:本文件纯编排,无新增;若实现中发现某时序节点在权威文档缺对应契约,以权威文档补全为先,再回本文校时序。

---

## openQuestions(交付即需用户/M0 裁决)

- **integration 产出的取用方式**【§5.5】:cleanup 删 agent worktree 后,`integration` 分支引用是保留供用户 `git merge`,还是只留游离 commit 靠 reflog?保留分支更友好但需约定命名不污染用户分支空间;建议保留 `refs/sylux/<runId>/integration` 至用户显式取走或 gc。需与 09 §8 cleanup 顺序对齐(当前 09 §8.2 第 4 步删 integration 分支)。
- **parallel 并发 spawn 的中转限流**【§6.4 / 03 Q3】:两子进程并发 exec 是否被中转(mouubox)429 限速?若限流,P4 的 `Promise.allSettled` 需加并发信号量错峰,M0 实测定并发度。与 04 H-FANOUT 的 `preflightFanout` 正交:前者防 429、后者防预算超支,两道都在 P4 spawn 前。
- **崩溃后旧 SESSION_ID 跨进程 resume**【§8.3 / 01 §5.4 / 03 Q1】:进程已死后用旧 thread_id `exec resume` 能否重连?决定崩溃恢复能否「续跑」还是只能「回看」。M0 闭环。
- **pause 在 P4 中途的语义粒度**【§7.2】:当前设计「等本次发言落 P6 + 本轮 P7 收尾再暂停,不杀子进程」。若用户期望「立刻停住正在烧 token 的发言」,需把 pause 升级为「软 abort 当前 turn + 标记下轮可重发」,但这会丢弃半成品发言并重计费(事实 D)。两种语义需用户选默认(建议保守:等发言完整,pause 不烧额外 token)。
- **inject 的 round 归属与 stall 计入**【§7.3 / 对接 04 §13.2 D8】:人工 inject 的 `from:'human'` 消息 round 取当前 currentRound 还是单独标记?影响收敛指纹差集(02 §9.3)是否把人工证据计入 stall 判定。04 §13.1 边界 8 已表态「human inject 的 evidence 应能解除 stall」,但 04 把这条列为对本文/04 的协同 openQuestion;需 04 定稿确认 human 强指纹是否经 `roundEvidenceExpected` 正常清零 emptyStreak。
- **shutdown 宽限窗对长发言的足够性**【§8.4 / 01 §6.2 / 01 OQ3】:`SHUTDOWN_GRACE_MS=10s` 是否够一次发言落最后一条 jsonl?长 implement 回合可能超 10s,超时强杀会留残行(可恢复但丢该轮)。M0 按真实发言时长校准。
- **【吃不掉,留定稿】下游编号全仓统一**【§0.0 H5 / 01 OQ1 / x-consistency C-NUM】:本文已统一到文件名编号(安全 08 / worktree 09 / 刹车 04),但全仓尚有逻辑编号派稿件未回填。这是跨稿一致性问题,非本文能单独闭合;需用户拍板权威编号方案后全仓一次性回填。本文按角色名锚点可零成本重定位。
- **【吃不掉,留定稿】02 §7.1 `status_changed` 增 `code` 字段**【对接 04 §2.4 H-BRIDGE / §13.2】:本文 §4.1/§5.1 用 `setStatus(status, code?, reason?)` 三参区分 `limit` 是轮数还是预算触顶,但 02 §7.1 `status_changed` 记录现无独立 `code` 字段。这是 04 已点名要回填 02 的项,本文时序依赖其落地;在 02 回填前,`code` 临时塞 `reason` 前缀过渡。非本文能改。
- **【吃不掉,留定稿】02 §12 错误码补全**【x-consistency A1 / COV-1】:本文时序引用的 `SUBPROCESS_CRASHED`/`SUBPROCESS_CANCELLED`/`SUBPROCESS_TIMEOUT`/`INJECTION_BLOCKED`/`WORKTREE_CONFLICT`/`ENGINE_FATAL` 等码,部分尚未在 02 §12 `SyluxErrorCode` union 登记。本文只编排其触发时序,码的权威登记需 02 一次性补全,非本文职责。
