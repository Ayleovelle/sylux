# 04 · 收敛检测与三重刹车(StopPolicy)v3

> **版本**:v3(2026-06-20,run-tag v3.1)。相对 v1 的硬化点见 §0.5,相对 v2 的增量硬化点见 §0.6。
>
> **v3 吃掉的红队主线**(逐条落点见 §0.6):**合法空证据轮误杀**(FEAS-5:master-worker 派活轮 / review 复用旧锚点轮 / parallel 同步轮天然空集且合法,v2 会把它们计入 stall 误杀)、**扇出无前瞻 + 无单 turn 上限**(RS-M5/ROC-M5:v2 删了前置刹车只留轮末裁决,Fusion panel 单轮并发 N 成员可在轮末检查触发前先烧掉 N×base)、**usage 缺失 output 当 0 绕过费用上限**(ROC-M1:v2 只兜底 input 地板,output 缺失当 0 使 `maxCostUsd` 失明)、**stop 阈值热换承诺落空**(ROC-M2:`buildStopPolicy` 构造期一次性组装,ConvergencePolicy 有状态,v2 无运行期重配接口,热换要么被忽略要么清零 stall 计数)、**buildStopContext / setStatus 跨文档签名漂移**(D4/D5)。
>
> **v2 吃掉的对抗性自检/红队主线**:**预算模型 continuity 失配**(v1 无脑超线性预测对默认的 stateless 范式误杀,B3 重写)、**done 跨轮检测漏判**(v1 `DonePolicy` 只看本轮消息,红蓝 done/ack 跨奇偶轮永不配对)、**`PlaybookDonePolicy` 归属缺失**(引擎 03 H2 依赖本文件提供,v1 没给)、**stall 终态语义与 02 矛盾**(v1 称 stall 可 resume,02 §10.2 钉死终态冻结)、**未核验指纹刷 stall 漏洞**(无 quote 的 file_ref 每轮换区间产新 `:?` 指纹可无限拖住 stall)、**reason 注入面**(裁决文本含 agent 字段直拼进广播 system 消息)。
>
> **类型引用纪律(焊死 R1)**:本文件**不另写任何** `Message`/`Evidence`/`Round`/`BoardState`/`TokenUsage`/`RunStatus`/错误码——它们的唯一权威定义在 **黑板协议(02)**(物理落 `@sylux/shared/src/blackboard.schema.ts`)。本文件涉及这些类型时一律以该路径引用。指纹函数 `fingerprint` / `fingerprintSet` / `normalizeContent` 的**签名与归一化规则**由黑板协议(02)§9 定权威,本文件只调用、不重定义。
>
> **本文件拥有 / 引擎 03 只调用**:`StopPolicy` / `StopContext` / `StopDecision` / `KEEP_RUNNING` / `CompositeStopPolicy` / `DonePolicy` / `PlaybookDonePolicy` 由本文件权威定义;引擎文档 03 **只注入、只调用**(03 §0.2 E6 / H1 / H2 明确)。`PlaybookDonePolicy`(§7.3)是 03 H2 点名要本文件提供的包装器,用来把 `playbook.isDone` 这类范式特定完成判据接入本文件的 `CompositeStopPolicy`。
>
> **事实地基**:成本与轮次模型遵守 `docs/PROBED-FACTS.md` D 节(2026-06-20 本机实测,resume 不省 token、input_token 累积上涨、超线性成本)。**关键澄清(v2)**:事实 D 的"累积/超线性"是 **resume 续接模式**下的成本形状;**stateless 模式**(引擎 03 §2.1 红蓝/对等/并行的默认续接策略)每轮只吃 `base + digest + delta`,成本对轮数**近似平**,不超线性。预算预测必须区分这两种 regime(§6),否则对默认 stateless 范式会严重高估而误杀(v1 缺陷,见 §0.5 H-B3)。凡 D 节已覆盖的结论**不再标【待实测】**;仅对尚未实测的扩展标注。
>
> **编号说明(v2 收敛)**:黑板协议(02)旧交叉引用里称刹车文档为"07";引擎文档 03 v2 已统一改用**实际文件名编号** `04` 并辅以角色名"收敛刹车文档"防漂(03 §0 下游编号约定 / Q6)。本文件即 `04-convergence-brakes.md`,与 03 对齐;02 中残留的"07"引用待回填(§13 openQuestion)。

---

## 0.5 v2 硬化点(相对 v1 的逐条修订)

| # | 硬化点 | v1 问题 | v2 修订 | 落点 |
|---|---|---|---|---|
| H-B3 | **预算预测 continuity 失配** | v1 `predictNextRoundInputTokens` 无脑用超线性 `base×k`;但默认 stateless 范式成本近似平 → 预测虚高 → 前瞻刹车在远未超支时误杀,且越往后越夸张 | 改**实测优先**预测:用最近两轮实测增量线性外推(stateless≈平、resume≈增,自适应);`base×k` 仅作冷启动(<2 轮实测)兜底**上界** | §6.2、§6.4、§6.5 |
| H-DONE | **done 跨轮检测漏判** | v1 `DonePolicy.shouldStop` 只扫 `ctx.roundMessages`;红蓝偶轮 done、奇轮 ack,二者永不同轮 → done 永远配不上 ack → 范式根本停不下来 | `StopContext` 增 `messages`(全量只读);`DonePolicy` 跨全 run 配对 done↔ack(§2.1、§7.1) | §2.1、§7.1 |
| H-PDONE | **`PlaybookDonePolicy` 缺失** | 引擎 03 H2 要求本文件提供包装器把 `playbook.isDone` 注入 composite,v1 没给 | 新增 `PlaybookDonePolicy`(§7.3),工厂 `buildStopPolicy` 接 `playbookDone` 回调 | §7.3、§8.3 |
| H-STALL-TERM | **stall 终态语义与 02 矛盾** | v1 §5.2/§13 称"stall 可 resume",但 02 §10.2 钉死 `stalled` 为冻结终态,不可回 `running` | 改:逃生阀不是"resume 同 run",而是**派生新 run**(注入新指令 + 旧 run digest 作种子);同 run 一旦 finalize 为 stalled 即冻结(§5.2、§13.1) | §5.2、§13.1 |
| H-FP | **未核验指纹刷 stall** | 无 quote 的 file_ref 产 `:?` 占位指纹(02 §9.2);agent 每轮换行区间即得"新 `:?` 指纹"→ 差集非空 → 无限拖住 stall,绕过收敛 | 新增 `requireVerifiedProgress`(默认 true):只有**核验通过的强指纹**(非 `:?`、非 `s:`)才清零 stall 计数(§4.2、§4.3) | §4.2、§4.3 |
| H-INJ | **reason 注入面** | v1 `reason` 直接内插 `done.from`/`ack.from` 等;裁决 reason 写进广播 system 消息(03 §5.1),若字段被污染则成注入/日志投毒面 | `reason` 只用**枚举值/数字/中枢常量**,不内插任何 agent 可控自由文本;agentId 是闭枚举(02 §2)安全,但措辞固定模板化(§2.2、§7.1) | §2.2、§7.1 |
| H-USAGE | **usage 缺失当 0** | v1 触发用 `ctx.totalUsage` 直接求和,未处理 02 H6 的"缺失 usage 不得当 0" | 触发侧对缺失/偏低的累积按 `base×轮数` 兜底下界(H6 保守上界精神),`buildStopContext` 职责(§2.1、§6.4) | §2.1、§6.4 |

---

## 0.6 v3 增量硬化点(相对 v2,吃掉 FEAS/RS/ROC 红队)

| # | 硬化点 | v2 问题 | v3 修订 | 落点 |
|---|---|---|---|---|
| H-EMPTY | **合法空证据轮误杀**(FEAS-5,major) | v2 `ConvergencePolicy` 无脑把"连续空集"计 stall;但 master-worker 派活轮、review 复用旧锚点轮、parallel 同步轮**天然且合法**地无新强指纹 → 被误判 stall 而误杀。03 §7.2 自承 parallel 靠 maxRounds 兜底却未推及 master-worker | `StopContext` 增 `roundEvidenceExpected`(引擎/playbook 标注本轮是否"该出新证据");为 false 的轮**冻结 stall 计数**(不累加、不清零),只有"该出证据却没出"才计 stall(§2.1、§4.2、§4.3) | §2.1、§4.2、§4.3、§9 |
| H-DEGRADE | **复跑器/沙箱自身失败未分类**(COV-3,major) | v2 假定"无新强指纹 = agent 挤不出证据";但若是**中枢侧**复跑器/沙箱基础设施故障导致 evidence 无法核验,把它计入 stall 会连坐 agent、误判收敛 | `StopContext` 增 `roundVerificationDegraded`(中枢侧核验降级标志);为 true 的轮同样**冻结 stall 计数**(判 weak+记 system,不连坐 critic,COV-3 建议),与 H-EMPTY 共用冻结路径(§2.1、§4.3) | §2.1、§4.3 |
| H-FANOUT | **扇出无前瞻 + 无单 turn 上限**(RS-M5/ROC-M5,major) | v2 删前置刹车只留轮末 `shouldStop`;Fusion panel 单轮并发 N 成员,一轮即可超支 N×base 才在轮末停;无单 turn token 上限,只有墙钟超时 | 新增 `maxTurnTokens` 单 turn 硬上限 + `preflightFanout()` 扇出前瞻闸:引擎/panel-runner 在 spawn 成员**之前**调用,预测"当前累积 + 计划并发 turn 数 × 单 turn 预测"是否跨预算,跨则拒绝扇出(§6.6) | §6.3、§6.6、§9 |
| H-OUT0 | **usage 缺失 output 当 0 绕过费用上限**(ROC-M1,major) | v2 H-USAGE 只兜底 `inputTokens` 地板,`outputTokens` 缺失仍当 0;`maxCostUsd` 按"input 地板 + output=0"算 → 用户设 \$12 上限挡不住真实 \$40+,CLI 升级改 usage 字段后成本刹车静默失明 | `buildStopContext` 与 `BudgetPolicy` 双侧对 `outputTokens` 也按基线比例兜底下界(`BASELINE_OUTPUT_PER_ROUND`);usage 字段缺失走 19 §6.3 degradable 仍 warn,但成本估**宁高勿低**(§2.1、§6.2、§6.4) | §2.1、§6.2、§6.4 |
| H-HOTSWAP | **stop 阈值热换承诺落空**(ROC-M2,major) | 16 §11.5 宣称 stop 阈值可热换"下一轮生效",但 v2 `buildStopPolicy` 构造期一次性组装,ConvergencePolicy 有状态(seen/emptyStreak),无运行期重配接口 → 热换被忽略或清零 stall 计数 | `StopPolicy` 增可选 `reconfigure(patch)`:只更新**阈值类配置**(maxRounds/stallWindow/maxTotalTokens/maxCostUsd 等),**绝不动累积状态**(seen/emptyStreak/lastUpdatedRound);composite 透传给子 policy(§2.3、§6.7、§8.4) | §2.3、§6.7、§8.4 |
| H-BRIDGE | **buildStopContext / setStatus 跨文档签名漂移**(D4/D5,minor) | 03 §5.1 传 `(BoardView, round)` 两参建 ctx,04 §2.1 投影自 `BoardState` 单参;03 §4.2 `setStatus(status, reason?)` 两参,04 §2.4 调三参 `(status, code, reason)`,02 §7.1 `status_changed` 无独立 `code` 字段 | 钉死桥接契约:`buildStopContext(board: BoardState)` 为权威单参,03 的 `(BoardView, round)` 经 `board.snapshot()` 桥接(§2.1 注);`setStatus(status, code?, reason?)` 三参为权威,需 02 §7.1 `status_changed` 回填 `code` 字段(§2.4 注、§13.2 openQuestion) | §2.1、§2.4、§13.2 |

---

## 0. 设计目标与不变量

### 0.1 三重刹车 + 一个成功出口

引擎循环的终止由**四条独立信号**驱动,本文件拥有前三条(刹车,safety net),第四条(done)只引用其判定来源:

| # | 信号 | 性质 | 终态(`RunStatus`) | 错误码 |
|---|---|---|---|---|
| B1 | `maxRounds` 硬上限 | 安全网·确定性 | `limit` | `ROUND_LIMIT_EXCEEDED` |
| B2 | 收敛 stall(evidence 指纹差集) | 安全网·被动 | `stalled` | `CONVERGENCE_STALL` |
| B3 | 成本上限(累积 token/费用) | 安全网·确定性 | `limit` | `TOKEN_BUDGET_EXCEEDED` |
| — | done(对面带证据 ack) | **成功出口**·主动 | `done` | (无,正常完成) |

> **B1/B3 终态都映射到 `limit`**(02 §10.2 枚举),用 `code` 区分是轮数还是预算触顶;B2 单独映射 `stalled`。这样 `RunStatus` 枚举不膨胀,审计靠 `code` 细分。

### 0.2 核心不变量(实现必须保持)

- **S1 stall 与 done 解耦**(R5):done 是"双方对结果达成带证据的一致"(02 C2,`kind:'done'` + 对面可核验 `ack`);stall 是"连续 N 轮挤不出新证据可吵"。二者**判据不同、信号源不同、互不触发**:done 看消息语义,stall 看 evidence 指纹差集。一个 run 可以 stall 而从未 done(吵不出结论被动停),也可以 done 而从未接近 stall(快速达成一致)。
- **S2 刹车只读不写黑板语义**:StopPolicy 是**纯裁决**,不产生 `Message`、不改 worktree。触发后由引擎写一条 `kind:'system'`(`from:'orchestrator'`,02 C7)消息 + 落 `status_changed`(02 §7.1)记录,刹车本身无副作用(便于单测:喂数据→断言决策)。
- **S3 指纹是唯一收敛信号源**:收敛判定**只**消费 02 §9 的 evidence 指纹差集,**不**看 `body` 文本、不做 NLP 语义相似度。这是焊死 R5 的关键:body 可被"换措辞"无限刷新,指纹不能(§5.2 反例一)。
- **S4 预算按累积估、按实测停**:预算**预测**用超线性模型(事实 D),预算**触发**用 `turn.completed.usage` 实测累积值(02 `TokenUsage`,中转回吐可靠)。预测只用于"下一轮还启不启动"的前瞻刹车(§4.4),不用于触发终态。
- **S5 优先级确定**:同一轮多刹车可同时满足,裁决按固定优先级(§6.2)给唯一终态,杜绝"既 stalled 又 limit"的二义。
- **S6 只清零于核验进展**(v2,H-FP):收敛 stall 计数只被**核验通过的强指纹**(中枢独立复算过的 file_ref+quote 或实跑 command,02 §3.2)清零;未核验的 `:?` 占位指纹与 `s:` 弱指纹默认不算"进展",防 agent 用换区间的空 file_ref 无限刷新 stall(§4.2)。
- **S7 stall 是冻结终态**(v2,H-STALL-TERM):`stalled`/`limit`/`done` 一经 finalize 即冻结,不可回 `running`(02 §10.2 状态矩阵)。"人工介入续跑"语义是**派生新 run**(旧 run digest 作种子 + 注入新指令),不是同 run resume(§5.2、§13.1)。本层裁决在引擎 finalize **之前**给出,介入只能发生在 finalize 之前的 `paused` 态,不能复活已冻结终态。
- **S8 裁决文本无 agent 自由文本**(v2,H-INJ):`StopDecision.reason`/`metrics` 只含枚举值、数字、中枢常量模板;绝不内插 agent 可控的自由文本(body/note/quote)。`from` 是闭枚举(02 §2 `agentId`)可安全入 reason,但仍走固定模板,杜绝裁决文本成为注入/日志投毒面(裁决 reason 会写进广播 system 消息,03 §5.1)。
- **S9 只有"该出证据的轮"才计 stall**(v3,H-EMPTY/H-DEGRADE):stall 计数只在 `roundEvidenceExpected===true && roundVerificationDegraded===false` 的轮推进。派活/合并/同步轮(`roundEvidenceExpected=false`)与中枢核验降级轮(`roundVerificationDegraded=true`)**冻结**计数(既不累加也不清零),防把"合法不出证据"和"中枢自己坏了"误判成 agent 收敛失败(FEAS-5/COV-3)。冻结≠清零:冻结期不重置已积累的 streak,只是不推进,恢复后从原值续算(§4.3)。
- **S10 成本既要轮末触发也要扇出前瞻 + 单 turn 封顶**(v3,H-FANOUT):预算安全网由三道组成——① 轮末累积触发(§6.4 ①,实测为准);② 启动下一轮前的前瞻(§6.4 ②);③ **扇出前瞻 `preflightFanout` + 单 turn 上限 `maxTurnTokens`**(§6.6),专防 panel 在单轮内并发 N 成员一次性超支。三道叠加,任一触发即停;`maxTurnTokens` 是兜底硬墙(单成员失控也封顶)。
- **S11 成本估宁高勿低,input/output 双侧兜底**(v3,H-OUT0):usage 任一字段缺失,`inputTokens` 按 `BASELINE_INPUT_PER_ROUND` 地板、`outputTokens` 按 `BASELINE_OUTPUT_PER_ROUND` 地板兜底下界(§6.2)。绝不出现"input 兜底但 output 当 0"的半兜底(那会让 `maxCostUsd` 在 output 占比高的 reasoning 模型上失明,ROC-M1)。
- **S12 阈值可热换,累积状态不可被热换清零**(v3,H-HOTSWAP):`reconfigure(patch)` 只改阈值类配置(窗口/上限/系数),**绝不触碰** seen/emptyStreak/lastUpdatedRound 等运行期累积状态。这保证 16 §11.5 的"下一轮生效"承诺为真,且热换不会把 stall 计数清零让 run 起死回生(§6.7、§8.4)。

---

## 1. 物理落点与依赖

```
packages/core/src/stop/
├─ stop-policy.ts        # StopPolicy 接口 + CompositeStopPolicy(§6/§8)
├─ max-rounds.ts         # B1(§3)
├─ convergence.ts        # B2 收敛检测(§4,消费 02 fingerprintSet)
├─ budget.ts             # B3 成本上限 + 实测优先预测(§6)
├─ done-detector.ts      # done 成功出口判定(§7,引用 02 C2)+ PlaybookDonePolicy(§7.3)
└─ cost-model.ts         # 事实 D 成本公式 + provider 计价 + 实测外推(§6.2)
```

依赖方向:`stop/*` 属 `@sylux/core`,只依赖 `@sylux/shared`(02 类型 + `fingerprintSet`/`SyluxError`)。**不**依赖 `agents`/`server`,保持纯函数可单测。provider 计价表从 provider 文档(05)的配置注入,不在本层硬编码。

---

## 2. StopPolicy 接口(统一裁决契约)

三条刹车 + done 出口共用一个接口。引擎不认识具体刹车,只认识 `StopPolicy`;`CompositeStopPolicy`(§6)把多条聚合成一条注入引擎。这样换 playbook 时可换刹车组合(例如"分工并行"放宽 stall、"红蓝对抗"收紧 maxRounds),而引擎循环不动。

### 2.1 输入:StopContext(每轮末快照)

裁决所需上下文,由引擎在**每轮关闭后**组装并传入。全部字段来自 02 已有类型,本文件不新增数据形状。

```ts
import type {
  BoardState, Round, Message, TokenUsage, RunStatus, SyluxErrorCode,
} from '@sylux/shared';

/** 每轮末喂给 StopPolicy 的只读快照。引擎组装,刹车只读。 */
export interface StopContext {
  /** 刚关闭的轮号(0-based,= BoardState.currentRound) */
  readonly round: number;
  /** 全量轮快照(含本轮);收敛差集回看历史轮 + 预算实测外推取最近两轮 usage 用 */
  readonly rounds: readonly Round[];
  /** 本轮新增的消息(已过 validateMessage,02 §8);收敛取本轮指纹、本轮内 done/ack 配对用 */
  readonly roundMessages: readonly Message[];
  /**
   * 全量消息只读快照(= BoardState.messages,按 seq 升序,02 I6)。
   * done 检测**必须**跨轮配对(红蓝偶轮 done、奇轮 ack;H-DONE),只看本轮会永远配不上 ack。
   * 复杂度:DonePolicy 每轮末 O(messages) 扫一次;done 触发即停,不重复扫。
   */
  readonly messages: readonly Message[];
  /**
   * 累计 token(全 run 求和,= BoardState.totalUsage;B3 触发用)。
   * H-USAGE / 02 H6:buildStopContext 组装时,对缺失/偏低的轮 usage 已按事实 D 基线
   * (单回合 ≈18.7k input)兜底为保守下界,绝不传入"把缺失当 0"的低估值。
   */
  readonly totalUsage: TokenUsage;
  /** 本轮 token(= Round.usage);实测外推的最近一轮锚点(§6.2)。缺失同样按基线兜底。 */
  readonly lastRoundUsage: TokenUsage | undefined;
  /**
   * 本轮是否"应当产出新证据"(playbook 标注,v3 H-EMPTY)。默认 true。
   * master-worker 派活轮 / parallel 同步合并轮 / review 复用旧锚点轮 = false:
   * 这些轮天然无新强指纹且合法(03 §7.2),为 false 时 ConvergencePolicy 冻结 stall 计数(S9)。
   * 由 playbook 经 03 §3.3 的 round 元数据给出(如 master-worker 的 dispatch/review 相位)。
   */
  readonly roundEvidenceExpected: boolean;
  /**
   * 中枢侧核验是否降级(v3 H-DEGRADE / COV-3)。默认 false。
   * 复跑器/沙箱基础设施本身故障(非 agent 给不出证据、非命令不安全)导致 evidence 无法核验时为 true;
   * 02 §8 validateMessage 侧判 weak+记 system,引擎据此置位。为 true 时 ConvergencePolicy 冻结 stall 计数,
   * 不连坐 critic(S9)。与 roundEvidenceExpected=false 共用冻结路径。
   */
  readonly roundVerificationDegraded: boolean;
  /** 当前状态(paused 时引擎不会调 StopPolicy;此处恒为 running) */
  readonly status: RunStatus;
}
```

> `StopContext` 是 `BoardState` 的**投影**(02 §10.2),不持有 worktree 句柄——刹车不复算 evidence(那是 02 §8 `validateMessage` 进黑板前的事);刹车只消费已落盘的 `Round.evidenceFingerprints`(02 §10.1,入黑板时已算好缓存)。这条边界很重要:**指纹复算一次(入黑板),刹车 N 轮零成本读缓存**。
>
> **`buildStopContext` 的 usage 兜底职责(H-USAGE+H-OUT0 / 02 H6)**:引擎组装 `StopContext` 时,`totalUsage`/`lastRoundUsage` 必须先过**双侧**兜底——`Round.usage` 为 `undefined` 或字段缺失(02 §6.3:claude 端某些路径不回吐 usage;19 §6.3 把 usage 字段漂移划为 degradable 仅 warn)时,**input 与 output 都不得当 0**:`inputTokens` 按 `BASELINE_INPUT_PER_ROUND`、`outputTokens` 按 `BASELINE_OUTPUT_PER_ROUND`(§6.2)填保守下界,再求和。即 `totalUsage.inputTokens ≥ BASELINE_INPUT_PER_ROUND × (round+1)` 且 `totalUsage.outputTokens ≥ BASELINE_OUTPUT_PER_ROUND × (round+1)` 恒成立。**v2 只兜底 input 是 H-OUT0 的根因**:output 占比高的 reasoning 模型上,output 当 0 会让 `maxCostUsd` 严重低估(ROC-M1:用户设 \$12 挡不住真实 \$40+)。`BudgetPolicy` 内部再加同样的双侧地板(§6.4),双重保险,与 02 H6"宁可早刹不可漏刹"一致。
>
> **`buildStopContext` 签名与桥接(v3,H-BRIDGE / D4)**:权威签名为单参 `buildStopContext(board: BoardState): StopContext`——`StopContext` 是 `BoardState` 的纯投影,`round` 取 `board.currentRound`。引擎 03 §5.1 主循环若持 `BoardView`(只读视图)而非完整 `BoardState`,经 `board.snapshot()`(02 §7.x)取一致快照后调用,**不**采用 03 旧伪代码的 `(BoardView, round)` 两参形态(那会让 round 与 board 状态可能不一致)。`roundEvidenceExpected`/`roundVerificationDegraded` 由引擎从 playbook round 元数据(03 §3.3)+ 本轮 validateMessage 降级标志填入,**不属 `BoardState` 固有字段**,是引擎组装时的附加投影输入。此项需回填 03 §5.1 伪代码(§13.2)。

### 2.2 输出:StopDecision

```ts
/** 单条刹车 / 出口的裁决结果。 */
export interface StopDecision {
  /** 是否应终止本 run */
  readonly shouldStop: boolean;
  /** 终止时的目标终态;shouldStop=false 时为 undefined */
  readonly status?: Extract<RunStatus, 'done' | 'stalled' | 'limit' | 'aborted'>;
  /** 终止原因错误码(done 出口为 undefined,正常完成无错误码) */
  readonly code?: SyluxErrorCode;
  /** 人类可读原因(写入 system 消息 body + status_changed.reason) */
  readonly reason?: string;
  /** 结构化指标(面板展示 + 审计;不参与控制流) */
  readonly metrics?: Readonly<Record<string, number | string>>;
}

/** 不停的规范返回值(常量,避免每轮新建对象) */
export const KEEP_RUNNING: StopDecision = Object.freeze({ shouldStop: false });
```

> **`reason`/`metrics` 安全约束(S8 / H-INJ)**:裁决 `reason` 会被引擎写进 `kind:'system'` 消息 body 并经 WS 广播到面板(03 §5.1)。因此 `reason` **只能**由枚举值、数字、中枢常量模板拼成,**绝不内插 agent 可控自由文本**(`body`/`note`/`quote`/`cmd` 等)。`from`(AgentId)是闭枚举(02 §2),内插安全,但仍走固定模板(如 `done.from=${X}`,X 必为 `codex|claude|human|orchestrator` 之一)。`metrics` 同理只放 `number|string` 且 string 仅取枚举/id 类,不取自由文本。这样即便上游 agent 输出被注入,也无法经裁决文本二次污染面板/日志(防注入与日志投毒)。

### 2.3 StopPolicy 接口本体(shouldStop / update)

任务简报点名 `shouldStop` 与 `update` 两个方法:`update` 在每轮末**先**喂入(让有状态刹车——如 stall 计数器——推进内部状态),`shouldStop` **后**读取裁决。拆成两步是为了:① 有状态刹车的状态推进与裁决可分别测试;② 聚合器能先 `update` 全部子刹车再统一裁决,避免短路导致某些计数器漏更新(§6.1)。

```ts
export interface StopPolicy {
  /** 稳定标识(日志/面板/审计用,如 'max-rounds'|'convergence'|'budget'|'done') */
  readonly id: string;

  /**
   * 每轮末推进内部状态(纯状态机,无副作用,不读外部 IO)。
   * 无状态刹车(maxRounds/budget)可空实现;有状态刹车(convergence stall 计数)必须实现。
   * 幂等性要求:同一 round 的 ctx 重复 update 不得重复累加(防回放/重试双计,§3.4)。
   */
  update(ctx: StopContext): void;

  /**
   * 读取当前裁决(纯读,不改状态)。必须在 update 之后调用。
   * 返回 KEEP_RUNNING 或带 status/code 的 StopDecision。
   */
  shouldStop(ctx: StopContext): StopDecision;

  /** 可选:供回放/崩溃恢复重建内部状态(从已落盘 rounds 重放,§3.4) */
  reset?(rounds: readonly Round[]): void;

  /**
   * 可选:运行期热换【阈值类配置】(v3,H-HOTSWAP / ROC-M2)。下一轮 shouldStop 生效。
   * 铁律:只更新阈值(maxRounds/stallWindow/maxTotalTokens/maxCostUsd/lookaheadFactor 等),
   * **绝不触碰**累积状态(seen/emptyStreak/lastUpdatedRound)——否则热换会清零 stall 计数让
   * 已接近收敛的 run 起死回生(S12)。patch 为对应 *Config 的浅 Partial,未给字段保持原值。
   * 无状态刹车(maxRounds/budget)直接替换 cfg;有状态刹车(convergence)只改 cfg 不动计数器。
   */
  reconfigure?(patch: Readonly<Record<string, unknown>>): void;
}
```

### 2.4 引擎侧调用时序(每轮末)

```
引擎: round 内所有 message 已 append 且 validateMessage 通过
  → blackboard.closeRound(round)         // 落 round_closed,缓存 evidenceFingerprints + usage(02 §7.1)
  → ctx = buildStopContext(boardState)   // §2.1 投影
  → policy.update(ctx)                   // ① 先推进状态(stall 计数等)
  → decision = policy.shouldStop(ctx)    // ② 后裁决
  → if (decision.shouldStop):
        engine.appendSystemMessage(decision)   // 写 kind:'system', from:'orchestrator'(02 C7)
        blackboard.setStatus(decision.status, decision.code, decision.reason) // 落 status_changed(02 §7.1)
        engine.stop()                          // 终止循环,不再启动下一轮
     else:
        engine.startNextRound()                // 进入 round+1
```

> **顺序铁律**:`update` 必在 `shouldStop` 前;`closeRound`(指纹入缓存)必在 `buildStopContext` 前。否则 stall 计数器看不到本轮指纹,差集判定滞后一轮。
>
> **`setStatus` 签名(v3,H-BRIDGE / D5)**:权威签名 `setStatus(status: RunStatus, code?: SyluxErrorCode, reason?: string)` 三参——`code` 是区分 `limit` 终态究竟是 `ROUND_LIMIT_EXCEEDED` 还是 `TOKEN_BUDGET_EXCEEDED` 的唯一手段(§0.1),不可省。但 02 §7.1 `status_changed` 记录当前**无独立 `code` 字段**,03 §4.2 旧签名也只两参 `(status, reason?)`。**裁决**:以本文件三参为权威,需回填 02 §7.1 `status_changed` 增 `code?: SyluxErrorCode` 字段 + 03 §4.2 改三参(§13.2 openQuestion)。在 02 回填前,`code` 可临时塞进 `reason` 前缀(如 `[TOKEN_BUDGET_EXCEEDED] …`)过渡,但这是**临时桥接**不是终态。
>
> **单点裁决,无前/后置二分(对齐 03 H1)**:本层是**每轮末单次** `update→shouldStop`,**没有** `checkBefore`/`checkAfter` 两段式。引擎 03 v1 曾自造 `Brakes.checkBefore/checkAfter`(03 §4.3/§5.1 仍有该残留伪代码),已被 03 §0.4 H1 判为废弃——以本文件 `StopPolicy` 为准。原 `checkBefore` 的"启动下一轮前抢停"职责,由本层的**前瞻预算刹车**(§6.4 ②,在轮末 `shouldStop` 内预测下一轮是否跨预算)等价承担;无需独立前置钩子。03 中残留的 `Brakes` 段落待回填为 `StopPolicy`(§13 openQuestion)。`maxResumeChain` 护栏(03 H7)不在本层——它是引擎 `runTurn` 选 send/resume 时的本地强制(03 §5.2),与本层前瞻预算刹车叠加,二者正交。

---

## 3. B1 · maxRounds 硬上限(确定性安全网)

最简、最不可绕过的一条:轮数到顶即停。它是**最后防线**——即便 stall 检测被对抗性输入骗过(每轮硬塞一条假新指纹,§3.5 反例二的极端化)、即便预算估算偏乐观,maxRounds 也保证 run 必然在有限轮内终止。

### 3.1 算法

```ts
export interface MaxRoundsConfig {
  /** 硬上限(含):round 达到 maxRounds-1 完成后即停(round 0-based) */
  readonly maxRounds: number; // 必 ≥1
}

export class MaxRoundsPolicy implements StopPolicy {
  readonly id = 'max-rounds';
  constructor(private readonly cfg: MaxRoundsConfig) {
    if (cfg.maxRounds < 1) throw new Error('maxRounds 必 ≥1');
  }
  update(_ctx: StopContext): void { /* 无状态 */ }

  shouldStop(ctx: StopContext): StopDecision {
    // round 0-based:刚关闭第 round 轮,已完成 round+1 轮
    if (ctx.round + 1 >= this.cfg.maxRounds) {
      return {
        shouldStop: true,
        status: 'limit',
        code: 'ROUND_LIMIT_EXCEEDED',
        reason: `达到 maxRounds 硬上限(${this.cfg.maxRounds} 轮)`,
        metrics: { roundsRun: ctx.round + 1, maxRounds: this.cfg.maxRounds },
      };
    }
    return KEEP_RUNNING;
  }
}
```

### 3.2 边界与失败路径

| 情形 | 处理 |
|---|---|
| `maxRounds<1` | 构造期抛(配置非法,fail-fast) |
| 首轮(round=0)即崩(adapter error) | 不归 B1;引擎按 02 §6.3 错误路径处理,B1 只管"正常完成轮数到顶" |
| paused 跨越上限 | paused 期间引擎不调 StopPolicy(§2.1),恢复后下一轮末才判,不会"暂停时偷偷触发" |
| 默认值 | 由 playbook 给(无全局默认):红蓝对抗建议 6–8,主从建议 10–12,结对建议 4–6(§7 配置表) |

> B1 是确定性的:给定 `maxRounds` 与已运行轮数,裁决无歧义、无状态、可在 O(1) 判定。它不读 evidence、不读 token,是三重刹车里唯一**完全不依赖 agent 行为**的一条,故作"最后防线"。

---

## 4. B2 · 收敛检测(evidence 指纹差集,焊死 R5)

### 4.1 核心思想

辩论的"进展"不等于"还在说话"——两个 agent 可以无限互相换措辞复读同一立场。**真正的进展 = 桌面上出现了新的、可机器核验的证据**。因此收敛信号取 02 §9.3 定义的 evidence 指纹差集:

- 第 `k` 轮"新指纹集" = `Round[k].evidenceFingerprints \ ⋃_{j<k} Round[j].evidenceFingerprints`(02 §9.3),且**仅计核验通过的强指纹**(S6/H-FP:剔除 `:?` 占位与 `s:` 弱指纹,§4.3 `filterFingerprints`)。
- 连续 `stallWindow` 轮强指纹新增为**空集** → 触发 `CONVERGENCE_STALL`,终态 `stalled`。
- 指纹来自 02 §9.2 `fingerprintSet`(已在入黑板时算好并缓存进 `Round.evidenceFingerprints`,02 §10.1)——**收敛检测不复算、不读 worktree、不碰 body 文本**(不变量 S3)。

为什么是"差集为空"而不是"指纹数不增长":差集精确捕捉"有没有**前所未见**的证据";指纹数可能因去重在新旧混杂时误判(新增 1 旧重 1 净增 0 但其实有新证据)。差集 = 严格的"本轮新事实"。

### 4.2 配置

```ts
export interface ConvergenceConfig {
  /** 连续多少轮"新指纹空集"才判 stall(默认 2)。playbook 可调。 */
  readonly stallWindow: number; // 必 ≥1
  /**
   * 是否把 spec_quote 指纹计入"新证据"。默认 false:
   * spec_quote 是弱核验(02 §3.2),易被"换引文"刷新;计入会削弱 stall 灵敏度。
   * 设 true 仅用于"规范评审"类 playbook(此时引规范本身就是进展)。
   */
  readonly countSpecQuote: boolean; // 默认 false
  /**
   * 最小活跃轮:前 minActiveRounds 轮即使空集也不计 stall(默认 1)。
   * 防止"开场第 0 轮还没人出 critique"被误判。
   */
  readonly minActiveRounds: number; // 默认 1
  /**
   * 只让"核验通过的强指纹"清零 stall 计数(默认 true,H-FP)。
   * 02 §9.2:未核验的 file_ref(无 quote 或复算未过)留 `:?` 占位指纹;spec_quote 是 `s:` 弱指纹。
   * 默认 true 时,这两类**不算进展**——否则失控/对抗 agent 每轮换个行区间产新 `:?` 指纹,
   * 差集永远非空,stall 永不触发(收敛检测被架空)。设 false 仅用于调试或确知无对抗的内部场景。
   * 与 countSpecQuote 的关系:countSpecQuote 控 `s:`;requireVerifiedProgress 控 `:?`(及总开关)。
   * requireVerifiedProgress=true 时,即便 countSpecQuote=true,`s:` 仍不清零(弱核验不是强进展);
   * 要让 `s:` 清零必须 requireVerifiedProgress=false 且 countSpecQuote=true(规范评审特化,§9)。
   */
  readonly requireVerifiedProgress: boolean; // 默认 true
}
```

### 4.3 算法(有状态:累积已见指纹 + 连续空集计数)

```ts
import { fingerprintSet } from '@sylux/shared'; // 02 §9.2,本文件只调用
import { ZERO_USAGE } from './cost-model.js';    // §6.2,reset 占位用(收敛不读 usage)

export class ConvergencePolicy implements StopPolicy {
  readonly id = 'convergence';

  /** 历史所有轮已见过的指纹全集(差集的被减数) */
  private seen = new Set<string>();
  /** 连续"新指纹空集"轮数 */
  private emptyStreak = 0;
  /** 已 update 到哪一轮(幂等护栏,§4.4) */
  private lastUpdatedRound = -1;

  // cfg 为可变私有(非 readonly):reconfigure 热换阈值需改它,但只改阈值不动上面的计数器(S12)。
  constructor(private cfg: ConvergenceConfig) {
    if (cfg.stallWindow < 1) throw new Error('stallWindow 必 ≥1');
  }

  update(ctx: StopContext): void {
    // 幂等:同一轮重复 update 不重复累加(回放/重试护栏)
    if (ctx.round <= this.lastUpdatedRound) return;
    this.lastUpdatedRound = ctx.round;

    const round = ctx.rounds[ctx.round];
    const incoming = this.filterFingerprints(round?.evidenceFingerprints ?? []);

    // 本轮新指纹 = incoming \ seen(02 §9.3 差集);check-and-add 单趟,避免本轮自指纹自我抵消。
    // 无论本轮是否冻结,真实强指纹都并入 seen(它们是历史证据,后续轮算差集要用)。
    let hasNew = false;
    for (const fp of incoming) {
      if (!this.seen.has(fp)) { hasNew = true; this.seen.add(fp); }
    }

    // S9(v3 H-EMPTY/H-DEGRADE):非"该出证据"的轮(派活/合并/同步/review 复用旧锚点)
    // 与中枢核验降级的轮,冻结 stall 计数——既不累加也不清零,恢复后从原 streak 续算。
    if (!ctx.roundEvidenceExpected || ctx.roundVerificationDegraded) {
      return; // 冻结:seen 已更新,但不动 emptyStreak(S9)
    }

    if (ctx.round < this.cfg.minActiveRounds) {
      this.emptyStreak = 0;            // 开场宽限,不计 stall
    } else if (hasNew) {
      this.emptyStreak = 0;            // 有新证据,清零
    } else {
      this.emptyStreak += 1;           // 空集,连续计数 +1
    }
  }

  shouldStop(ctx: StopContext): StopDecision {
    if (this.emptyStreak >= this.cfg.stallWindow) {
      return {
        shouldStop: true,
        status: 'stalled',
        code: 'CONVERGENCE_STALL',
        reason: `连续 ${this.emptyStreak} 轮无新可核验证据(stallWindow=${this.cfg.stallWindow})`,
        metrics: {
          emptyStreak: this.emptyStreak,
          seenFingerprints: this.seen.size,
          stallWindow: this.cfg.stallWindow,
        },
      };
    }
    return KEEP_RUNNING;
  }

  /**
   * 按配置过滤"算作进展"的指纹(02 §9.2 指纹前缀语义):
   * - `s:` 前缀 = spec_quote 弱指纹;countSpecQuote=false 时剔除。
   * - 末尾 `:?` = 未核验 file_ref 占位指纹(无 quote 或复算未过,02 §9.2/§9.3);
   *   requireVerifiedProgress=true 时剔除(H-FP:防换区间空 file_ref 刷 stall)。
   * 剩下的才是"核验通过的强指纹",只有它们能清零 stall 计数(S6)。
   */
  private filterFingerprints(fps: readonly string[]): string[] {
    return fps.filter((fp) => {
      if (!this.cfg.countSpecQuote && fp.startsWith('s:')) return false;
      if (this.cfg.requireVerifiedProgress && fp.endsWith(':?')) return false;
      return true;
    });
  }

  /** 回放/崩溃恢复:从已落盘 rounds 重放重建 seen + emptyStreak(§4.4)。
   *  回放时各轮的 roundEvidenceExpected/roundVerificationDegraded 从落盘 round 元数据取(02 §7.1);
   *  缺失则保守按 true/false(即"该出证据、未降级")重放,确保回放结果不弱于在线判定。 */
  reset(rounds: readonly Round[]): void {
    this.seen.clear();
    this.emptyStreak = 0;
    this.lastUpdatedRound = -1;
    for (let r = 0; r < rounds.length; r++) {
      this.update({
        round: r, rounds, roundMessages: [], messages: [],
        totalUsage: ZERO_USAGE, lastRoundUsage: undefined,
        roundEvidenceExpected: rounds[r]?.evidenceExpected ?? true,
        roundVerificationDegraded: rounds[r]?.verificationDegraded ?? false,
        status: 'running',
      });
    }
  }

  /** 热换阈值(v3 H-HOTSWAP):只改 stallWindow 等阈值,绝不动 seen/emptyStreak(S12)。 */
  reconfigure(patch: Partial<ConvergenceConfig>): void {
    if (patch.stallWindow !== undefined && patch.stallWindow < 1) {
      throw new Error('stallWindow 必 ≥1');
    }
    this.cfg = { ...this.cfg, ...patch }; // cfg 改为可变私有字段;计数器岿然不动
  }
}
```

> 复杂度:每轮 `update` 是 O(本轮指纹数);`seen` 是全程并集,空间 O(全程去重指纹数)。回放 `reset` 是 O(总指纹数),与从 jsonl 重建 `BoardState`(02 §7.3)同阶,可接受。

### 4.4 幂等与崩溃恢复(R5 状态机正确性)

stall 计数器是**有状态**的,必须防三类误差:

| 风险 | 后果 | 护栏 |
|---|---|---|
| 同轮重复 `update`(引擎重试/面板回放) | `seen` 重复加(无害)但 `emptyStreak` 可能误增 | `lastUpdatedRound` 门控,`round<=last` 直接 return |
| 崩溃后从 jsonl 恢复 | 内存计数器丢失 | `reset(rounds)` 从落盘 `Round.evidenceFingerprints` 重放,确定性重建 |
| 乱序轮(理论不应发生) | 差集错位 | `update` 假定 `ctx.round` 单调;`reset` 按数组下标顺序重放保证有序 |
| **未核验指纹刷 stall(对抗,H-FP)** | 无 quote 的 file_ref 每轮换行区间产新 `:?` 指纹 → 差集恒非空 → stall 永不触发,收敛被架空 | `requireVerifiedProgress=true`(默认)在 `filterFingerprints` 剔除 `:?`/`s:`,只有中枢复算通过的强指纹清零(S6) |
| **合法空证据轮误杀(FEAS-5,H-EMPTY)** | master-worker 派活轮 / parallel 同步轮 / review 复用旧锚点轮天然无新强指纹,被计入 stall 误杀 | `roundEvidenceExpected=false` 时冻结 emptyStreak(不累加不清零,S9);由 playbook round 元数据标注(§9) |
| **中枢核验降级连坐(COV-3,H-DEGRADE)** | 复跑器/沙箱基础设施自身故障致 evidence 无法核验,被当作 agent 挤不出证据计入 stall | `roundVerificationDegraded=true` 时冻结 emptyStreak,判 weak+记 system,不连坐 critic(S9) |

> `Round.evidenceFingerprints` 是落盘的(02 §7.1 `round_closed`),所以 `reset` 不需重读 worktree、不需重算 hash——恢复是纯回放,与"指纹复算一次"(§2.1)一致。

---

## 5. B2 两个反例的单测思路(R5 验收锚点)

任务点名两个对抗性反例。它们是收敛检测的**红队验收线**:第一个证明"换措辞刷不出进展",第二个暴露并界定"真新问题复用旧引用"的边界。

### 5.1 反例一:换措辞(同证据、不同 body)→ 必须仍判 stall

**攻击形态**:critic 每轮把同一条 critique 用不同自然语言重写,body 文本每轮都"新",但底层证据锚点完全相同(同 `file_ref` 同区间同 `contentHash`)。

**为何被挡住**:指纹(02 §9.2)对 `file_ref` 取 `f:{path}:{lineStart}-{lineEnd}:{contentHash}`,**body/note 不参与**。换措辞 → 指纹不变 → 差集为空 → `emptyStreak` 照常累加 → `stallWindow` 轮后判 stall。这正是不变量 S3("指纹是唯一收敛信号源,不看 body")的目的。

**单测**:

```ts
// 反例一:body 每轮不同,evidence 指纹恒同 → stall 必触发
test('rephrase-same-evidence still stalls', () => {
  const policy = new ConvergencePolicy({ stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, requireVerifiedProgress: true });
  // 构造三轮:同一 file_ref(同 path/区间/contentHash),body 文本逐轮不同
  const fp = 'f:src/a.ts:10-20:abc123def456';   // 02 §9.2 file_ref 指纹格式
  const rounds = [
    mkRound(0, [fp]),                            // 第 0 轮:首见,有新指纹
    mkRound(1, [fp]),                            // 第 1 轮:换措辞,指纹同 → 空集 streak=1
    mkRound(2, [fp]),                            // 第 2 轮:再换措辞 → 空集 streak=2
  ];
  for (let r = 0; r <= 2; r++) policy.update(stepCtx(r, rounds));
  expect(policy.shouldStop(stepCtx(2, rounds)).code).toBe('CONVERGENCE_STALL');
});
```

> 关键断言:**body 的差异完全不进入判定**。测试里 `mkRound` 只喂指纹数组,根本不构造 body——因为收敛检测的输入是 `Round.evidenceFingerprints`,body 早在 02 §9.2 算指纹时就被丢弃。这从数据通路上保证换措辞无效。

### 5.2 反例二:真·新问题复用旧引用 → 边界与缓解

**攻击/误判形态**:第 5 轮 critic 提出一个**全新的**问题(逻辑漏洞 X),但它"顺手"引用了第 2 轮已出现过的同一段代码(同 `file_ref` 同区间同 `contentHash`)作为锚点。若只看指纹差集,这条指纹早在第 2 轮见过 → 差集为空 → 被误判为"无进展",可能误触发 stall(假阳性)。

**问题本质**:指纹刻意只编码"指向哪段事实"(path+区间+内容 hash),**不编码"为何指向"**。这是为挡反例一(换措辞)付出的代价——它也让"同锚点、新论点"对收敛检测**不可见**。两个反例是同一枚硬币的两面:对 body 越不敏感,越挡得住换措辞,也越看不见"旧锚点新论点"。

**设计裁决(不引入 body 语义比较)**:

1. **协议层强制"新问题须带新锚点"**(主缓解,焊死)。提出实质新问题时,critic **必须**附至少一条前所未见的锚点。手段有三,任选其一即产生新指纹:
   - 新 `file_ref` 区间(哪怕同文件,指向触发新问题的**具体**行,区间不同 → `lineStart-lineEnd` 不同 → 新指纹);
   - `command` 证据(跑出暴露新问题的失败输出 → `c:` 指纹必新,02 §9.2 取 `cmd+expected+matchMode`);
   - `spec_quote`(引被违反的规范条款 → `s:` 指纹新;但默认 `countSpecQuote=false` 不计入 stall,需配合上面两者之一)。

   依据:一个"真的新问题"几乎不可能与旧问题的可核验锚点**逐字节全等**——新问题要么指向不同代码区间、要么有不同的复现命令、要么违反不同规范。若 critic 连一条新锚点都给不出,**它主张的"新问题"在可机器核验意义上与旧问题不可区分**,按 R5 精神就该被当作"无新证据"。这不是 bug,是设计:**不可核验的新颖性不算进展**。

2. **校验层兜底**(02 §8 已有,本文件复用)。02 C1 要求 critic/critique 的 evidence 至少一条**强**核验通过(02 v2 H2 已把"强或中"收紧为"强":未实跑的 command / 无 quote 的 file_ref / spec_quote 都只算 weak,不解锁 C1);只要 critic 想让新问题被采信,就得给可核验锚点,而可核验的新锚点天然产生新强指纹。换言之 **02 §8 的 evidence 强制 + 本文件的指纹差集,合起来"挤"critic 给出新强锚点**。这与 §4 的 `requireVerifiedProgress`(S6)同向:两层都只认中枢能独立复算的强证据。

3. **逃生阀(防真·假阳性,语义对齐 02 §10.2)**。万一出现"新问题客观上只能复用旧锚点"的罕见情形(例如同一行代码有两个独立缺陷),stall 不是死刑,但**纠正路径不是"resume 同 run"**——02 §10.2 钉死 `stalled` 是**冻结终态**,不可回 `running`(S7)。正确语义分两层:
   - **finalize 之前**:stall 触发在引擎 finalize 之前;若面板/arbiter 在引擎写终态**之前**已介入(运行期 `paused`,03 §5.1),可注入新指令(新的可核验锚点)让下一轮产出新强指纹,清零 stall,run 继续——此时 run 从未进入 `stalled` 终态。
   - **finalize 之后**:一旦引擎把 run finalize 为 `stalled`,该 run 即冻结。"继续推进"语义是**派生一个新 run**:以旧 run 的 jsonl digest(02 §7)作种子上下文 + 人工注入的新指令开局。新 run 有新 `runId`、新 stall 计数器,旧 run 作为不可变审计记录保留。这把假阳性的代价从"误杀不可恢复"降到"换个 runId 接着跑",且不违反 02 的终态冻结不变量。

> **为何不让 stalled 复活**:若允许 `stalled→running`,则"终态"不再是终态,02 §10.2 状态矩阵、jsonl 末行语义(§7.3)、面板终态展示全部要改成可逆,牵一发动全身。派生新 run 用同样的 digest 续接,效果等价(agent 看到的上下文相同)而契约干净。这是对抗性自检后选定的方案(H-STALL-TERM)。

**单测**:

```ts
// 反例二之 A:新问题确实带了新锚点(新区间)→ 不应 stall(差集非空)
test('new-issue-with-fresh-anchor resets stall', () => {
  const policy = new ConvergencePolicy({ stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, requireVerifiedProgress: true });
  const old = 'f:src/a.ts:10-20:abc123def456';
  const fresh = 'f:src/a.ts:55-60:9988ffee0011'; // 同文件,新区间 → 新指纹
  const rounds = [
    mkRound(0, [old]),
    mkRound(1, [old]),         // 空集 streak=1
    mkRound(2, [old, fresh]),  // 出现 fresh → 差集非空 → streak 清零
  ];
  for (let r = 0; r <= 2; r++) policy.update(stepCtx(r, rounds));
  expect(policy.shouldStop(stepCtx(2, rounds)).shouldStop).toBe(false);
});

// 反例二之 B:声称新问题但只复用旧锚点(零新指纹)→ 按设计仍计入 stall
// 断言此为"刻意行为"而非 bug:不可核验的新颖性不算进展(S3)。
test('claimed-new-issue-reusing-old-anchor does NOT reset stall', () => {
  const policy = new ConvergencePolicy({ stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, requireVerifiedProgress: true });
  const old = 'f:src/a.ts:10-20:abc123def456';
  const rounds = [mkRound(0, [old]), mkRound(1, [old]), mkRound(2, [old])];
  for (let r = 0; r <= 2; r++) policy.update(stepCtx(r, rounds));
  // 文档化:这是预期行为,缓解靠协议层"新问题须带新锚点" + 人工逃生阀
  expect(policy.shouldStop(stepCtx(2, rounds)).code).toBe('CONVERGENCE_STALL');
});

// 反例三(v2,H-FP):未核验 file_ref 每轮换区间产新 :? 指纹 → 不得清零 stall
// 攻击:critic 不给 quote,每轮指向不同行区间,得"新 :? 指纹"想无限拖住 stall。
test('unverified-fingerprints-with-shifting-ranges still stall', () => {
  const policy = new ConvergencePolicy({ stallWindow: 2, countSpecQuote: false, minActiveRounds: 1, requireVerifiedProgress: true });
  const rounds = [
    mkRound(0, ['f:src/a.ts:10-20:?']),   // 未核验占位指纹(无 quote,02 §9.2)
    mkRound(1, ['f:src/a.ts:30-40:?']),   // 换区间 → 新 :? 指纹,但 requireVerifiedProgress 剔除 → 空集 streak=1
    mkRound(2, ['f:src/a.ts:50-60:?']),   // 再换 → 仍剔除 → streak=2
  ];
  for (let r = 0; r <= 2; r++) policy.update(stepCtx(r, rounds));
  expect(policy.shouldStop(stepCtx(2, rounds)).code).toBe('CONVERGENCE_STALL'); // S6/H-FP
});
```

> **测试工厂约定(v2/v3)**:`mkRound(idx, fps, usage?)` 构造只含指纹(+可选 usage)的 `Round`;`stepCtx(round, rounds, opts?)` 构造 `StopContext`,其中 `messages`/`roundMessages` 默认空数组(收敛检测只读 `rounds[].evidenceFingerprints`,不需要 messages),`totalUsage` 默认按基线兜底(§2.1),**`roundEvidenceExpected` 默认 true、`roundVerificationDegraded` 默认 false**(v3:绝大多数收敛测试是"该出证据"的常规轮;冻结类测试 B2-11/B2-12 才在 `opts` 显式置 false/true)。done 类测试(§12 D-*)才需要在 `stepCtx` 里填 `messages`(跨轮 done/ack 配对,H-DONE)。这从数据通路上保证:收敛检测的输入只有指纹 + 两个轮属性标志,done 检测的输入只有消息,二者信号源不交叉(S1 解耦)。

> 两个反例合起来定义了收敛检测的**精确语义**:进展 = 新可核验锚点出现。换措辞(反例一)产不出新锚点,被正确判 stall;真新问题(反例二之 A)若带新锚点则被正确放行;退化为"空口新问题"(反例二之 B)则按设计与无进展等价,由协议强制 + 人工逃生阀兜底。**收敛检测不承诺识别语义新颖性,只承诺识别可核验新颖性**——这条边界必须写进交付说明,避免使用者误以为它能挡住"狡猾的同锚点新论点"。

## 6. B3 · 成本上限(累积 token / 费用,事实地基 D)

### 6.1 两种成本 regime:resume 超线性 vs stateless 近似平(v2 关键修正 H-B3)

事实地基 D 节(本机实测)钉死的是 **resume 续接模式**的成本形状:`resume` 不省 token,走中转每轮按**全量历史**重新计费,`input_tokens` 随轮数累积上涨(实测 round1=18755 → round2=37645,≈翻倍)。但引擎 03 §2.1 的默认续接策略是 **stateless**(红蓝/对等/并行范式默认),每轮全新会话只吃 `base + digest + delta`,**不重灌全历史**,成本对轮数**近似平**。两种 regime 的累积成本天差地别:

| regime | 第 k 轮 input(1-based) | N 轮累积 input | 何时用(03 §2.1) |
|---|---|---|---|
| **resume**(超线性) | `≈ base × k`(全量历史重计费) | `≈ base × N(N+1)/2` | 主从子任务内强耦合的少数轮 |
| **stateless**(近似平) | `≈ base + digest + delta`(≈ 常数 c) | `≈ c × N`(线性) | **默认**:红蓝/对等/并行长程辩论 |

> **v1 的致命错误(H-B3)**:v1 `predictNextRoundInputTokens` 无脑用 `base×(n+1)` 超线性公式预测**所有** regime。但默认是 stateless——真实下一轮增量 ≈ 常数 c(约 1×base),v1 却预测成 `base×(n+1)`(第 8 轮预测 ≈9×base),**虚高近一个数量级**。后果:前瞻刹车(§6.4 ②)在累积成本远未触顶时就误判"再跑一轮会爆"而**提前误杀** run,且越往后误杀越早。这是把"resume 的最坏成本"错套到"stateless 的实际成本"上。

**v2 修正:实测优先预测**。不再假设 regime,直接用**最近两轮实测增量线性外推**——stateless 下两轮增量≈0(预测≈上轮值),resume 下两轮增量≈base(预测≈上轮+base),**自适应**两种 regime,无需知道 continuity。`base×k` 超线性公式仅在**冷启动(<2 轮实测)**时作兜底**上界**用(§6.2)。

因此预算刹车有两个职责:① **触发**——累积实测 token 触顶即停(用 `turn.completed.usage` 回吐,S4;缺失按基线兜底下界,H-USAGE);② **前瞻**——在启动下一轮**之前**用实测外推预测增量,超则不启动(§6.4),避免"为了发现超预算先花掉一整轮成本"。

### 6.2 成本模型(cost-model.ts,超线性公式)

```ts
/** provider 计价(每百万 token 美元),从 provider 文档(05)配置注入,不硬编码。 */
export interface TokenPricing {
  /** 每 1e6 input token 美元价(未命中缓存) */
  readonly inputPerM: number;
  /** 每 1e6 cached input token 美元价(命中缓存,通常低于 inputPerM) */
  readonly cachedInputPerM: number;
  /** 每 1e6 output token 美元价 */
  readonly outputPerM: number;
}

/** 把一段 TokenUsage 折算成美元(单轮或累积均可)。 */
export function usageToUsd(u: TokenUsage, p: TokenPricing): number {
  const nonCachedInput = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    (nonCachedInput * p.inputPerM +
      u.cachedInputTokens * p.cachedInputPerM +
      (u.outputTokens + u.reasoningOutputTokens) * p.outputPerM) /
    1_000_000
  );
}

/**
 * 实测优先的下一轮【增量 input】预测(v2,H-B3)。不假设 regime。
 *
 * 策略(按可用实测数据降级):
 *  ① ≥2 轮实测 → 线性外推:Δ = max(0, last - prev);predicted = max(last + Δ, base)。
 *     - stateless:last≈prev → Δ≈0 → predicted≈last(近似平,正确)。
 *     - resume:last-prev≈base → Δ≈base → predicted≈last+base(超线性,正确)。
 *  ② 仅 1 轮实测 → predicted = max(last, base)(无增量信息,取上轮值,不外推)。
 *  ③ 0 轮实测(冷启动)→ predicted = base × (nDone+1) 作【保守上界】兜底(沿用事实 D 最坏形状)。
 * 三档都以 base 为地板,保证不低估(H-USAGE)。
 *
 * @param roundInputSeries 各轮已实测 input tokens(按轮序,可含兜底基线值),空数组=冷启动。
 * @param baseInputPerRound 每轮地板价 base(优先取首轮实测,无则 BASELINE_INPUT_PER_ROUND)。
 */
export function predictNextRoundInputTokens(
  roundInputSeries: readonly number[],
  baseInputPerRound: number,
): number {
  const n = roundInputSeries.length;
  if (n >= 2) {
    const last = roundInputSeries[n - 1];
    const prev = roundInputSeries[n - 2];
    const delta = Math.max(0, last - prev);          // 单调增量,负增量(裁剪/缓存)不外推为负
    return Math.max(last + delta, baseInputPerRound);
  }
  if (n === 1) return Math.max(roundInputSeries[0], baseInputPerRound);
  return baseInputPerRound * 1;                       // 冷启动:下一轮(第 1 轮)上界 ≈ base
}

/** 事实 D 实测基线:最简回合固定 input 开销。无首轮实测值/usage 缺失时的保守地板(H-USAGE)。 */
export const BASELINE_INPUT_PER_ROUND = 18_700 as const;

/**
 * 每轮 output 基线地板(v3,H-OUT0)。usage 的 outputTokens 缺失时的保守下界,**绝不当 0**。
 * 取值依据:事实 D 未单列 output,经验上 output≈input 的 ~15%(§6.5),reasoning 模型更高;
 * 为防 maxCostUsd 在 output 占比高的模型上失明(ROC-M1),地板取保守偏高值。M2 用实测分布校准。
 */
export const BASELINE_OUTPUT_PER_ROUND = 3_000 as const;

/** 把任意 TokenUsage 做"双侧地板兜底",任一字段缺失/偏低都不当 0(v3,H-USAGE+H-OUT0)。
 *  nRounds = 已完成轮数(用于按轮数放大地板);单轮兜底传 1。 */
export function floorUsage(u: TokenUsage, nRounds: number): TokenUsage {
  const n = Math.max(1, nRounds);
  return {
    ...u,
    inputTokens: Math.max(u.inputTokens ?? 0, BASELINE_INPUT_PER_ROUND * n),
    outputTokens: Math.max(u.outputTokens ?? 0, BASELINE_OUTPUT_PER_ROUND * n),
  };
}

/** 全零 usage 常量(收敛 reset 占位等;收敛策略不读 usage,故零值无害)。 */
export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
});

/** 从 ctx.rounds 取各轮实测 input 序列(缺失按 base 地板兜底,H-USAGE)。 */
export function roundInputSeries(rounds: readonly Round[], base: number): number[] {
  return rounds.map((r) => Math.max(r.usage?.inputTokens ?? 0, base));
}
```

> 【已实测,不标待实测】`base×k` 上界与 18.7k 地板价来自事实 D 双轮实测(**resume regime**)。【已澄清,不再标待实测】stateless 近似平来自事实 D 同源(每轮新会话只吃 base+digest+delta)+ 引擎 03 §2.1 设计立场。【待实测】仅以下扩展:① 应用层做历史裁剪/旧轮压结论后,resume 增量是否仍守 `base×k` 上界(裁剪应使其**低于**此上界,故作保守上界安全);② resume regime 下 N>2 长程是否仍严格线性(实测只到 round2);③ stateless 下逐轮增量的实际波动幅度(digest 增长会让 c 缓慢上升,实测外推已自适应捕捉,但需校准 factor)。**实测优先预测的好处**:无论上面哪条偏离理论,只要有 ≥2 轮真实 usage,预测就贴合实际曲线,不再依赖 regime 假设。

### 6.3 配置

```ts
export interface BudgetConfig {
  /** 累计 token 硬上限(全 run input+output 求和);0/undefined 表示不限 token */
  readonly maxTotalTokens?: number;
  /** 累计费用硬上限(美元);需配 pricing 才生效 */
  readonly maxCostUsd?: number;
  /** provider 计价(算 maxCostUsd 必需;只设 maxTotalTokens 可省) */
  readonly pricing?: TokenPricing;
  /**
   * 前瞻刹车开关(默认 true):每轮末预测下一轮增量,
   * 若 "当前累积 + 预测增量" 会超任一硬上限,则【提前】停在当前轮,
   * 不启动注定超预算的下一轮(§6.4)。
   */
  readonly lookahead: boolean;
  /**
   * 前瞻安全系数(默认 1.0):predicted×factor 后再比较。
   * >1 更保守(提前停),<1 更激进。
   */
  readonly lookaheadFactor: number;
  /**
   * 单 turn token 硬上限(v3,H-FANOUT / RS-M5 / ROC-M5)。0/undefined 表示不限。
   * 防单个 agent / panel 成员一个 turn 失控烧穿;由引擎在 runTurn 内强制(超则杀该 turn,记 SUBPROCESS_TIMEOUT 类),
   * 与本层轮末刹车正交。本字段供 preflightFanout 估扇出预算用(§6.6)。
   */
  readonly maxTurnTokens?: number;
}
```

### 6.4 算法(确定性触发 + 超线性前瞻)

```ts
import {
  usageToUsd, predictNextRoundInputTokens, roundInputSeries,
  floorUsage, BASELINE_INPUT_PER_ROUND, BASELINE_OUTPUT_PER_ROUND,
} from './cost-model.js';

export class BudgetPolicy implements StopPolicy {
  readonly id = 'budget';
  // cfg 可变(非 readonly):reconfigure 热换上限(S12 / H-HOTSWAP);budget 无累积状态,直接替换安全。
  constructor(private cfg: BudgetConfig) {
    if (cfg.maxCostUsd !== undefined && !cfg.pricing) {
      throw new Error('设置 maxCostUsd 必须同时提供 pricing');
    }
  }
  update(_ctx: StopContext): void { /* 无状态:每轮读 totalUsage 实测值即可 */ }

  /** 热换上限(v3 H-HOTSWAP):budget 无累积计数器,整表替换即可;校验同构造期。 */
  reconfigure(patch: Partial<BudgetConfig>): void {
    const next = { ...this.cfg, ...patch };
    if (next.maxCostUsd !== undefined && !next.pricing) {
      throw new Error('设置 maxCostUsd 必须同时提供 pricing');
    }
    this.cfg = next;
  }

  shouldStop(ctx: StopContext): StopDecision {
    // H-USAGE+H-OUT0:totalUsage 已在 buildStopContext 兜底过;此处再过一道双侧地板,双重保险。
    // 关键:input 与 output 都不当 0(v2 只兜底 input 是 ROC-M1 的根因)。
    const floored = floorUsage(ctx.totalUsage, ctx.round + 1);
    const totalTokens =
      floored.inputTokens + floored.outputTokens + floored.reasoningOutputTokens;
    const costUsd = this.cfg.pricing ? usageToUsd(floored, this.cfg.pricing) : undefined;

    // ① 确定性触发:实测累积(含基线兜底)已触顶(S4)
    if (this.cfg.maxTotalTokens !== undefined && totalTokens >= this.cfg.maxTotalTokens) {
      return this.exceeded('token', totalTokens, costUsd, ctx, /*lookahead*/ false);
    }
    if (this.cfg.maxCostUsd !== undefined && costUsd !== undefined && costUsd >= this.cfg.maxCostUsd) {
      return this.exceeded('cost', totalTokens, costUsd, ctx, false);
    }

    // ② 前瞻刹车:用【实测优先】外推预测下一轮增量(H-B3:不再无脑超线性)
    if (this.cfg.lookahead) {
      const base = ctx.rounds[0]?.usage?.inputTokens ?? BASELINE_INPUT_PER_ROUND;
      const series = roundInputSeries(ctx.rounds, base);       // 各轮实测 input(缺失按 base 兜底)
      const predictedNextInput =
        predictNextRoundInputTokens(series, base) * this.cfg.lookaheadFactor;
      const projectedTokens = totalTokens + predictedNextInput;
      if (this.cfg.maxTotalTokens !== undefined && projectedTokens >= this.cfg.maxTotalTokens) {
        return this.exceeded('token', totalTokens, costUsd, ctx, /*lookahead*/ true, predictedNextInput);
      }
      if (this.cfg.maxCostUsd !== undefined && costUsd !== undefined && this.cfg.pricing) {
        // 预测增量折算成本(全按未命中缓存 input 价,保守上界)
        const predictedCost = (predictedNextInput * this.cfg.pricing.inputPerM) / 1_000_000;
        if (costUsd + predictedCost >= this.cfg.maxCostUsd) {
          return this.exceeded('cost', totalTokens, costUsd, ctx, true, predictedNextInput);
        }
      }
    }
    return KEEP_RUNNING;
  }

  private exceeded(
    by: 'token' | 'cost',
    totalTokens: number,
    costUsd: number | undefined,
    ctx: StopContext,
    lookahead: boolean,
    predicted?: number,
  ): StopDecision {
    const limit = by === 'token' ? this.cfg.maxTotalTokens : this.cfg.maxCostUsd;
    // S8/H-INJ:reason 只用枚举 by + 数字,无 agent 自由文本。
    return {
      shouldStop: true,
      status: 'limit',
      code: 'TOKEN_BUDGET_EXCEEDED',
      reason: lookahead
        ? `前瞻刹车:预测下一轮增量≈${Math.round(predicted ?? 0)} token,将超${by}上限(${limit}),提前停于第 ${ctx.round} 轮`
        : `累积${by}已达上限(${by === 'token' ? totalTokens : costUsd?.toFixed(4)}/${limit})`,
      metrics: {
        totalTokens,
        ...(costUsd !== undefined ? { costUsd: Number(costUsd.toFixed(4)) } : {}),
        triggeredBy: by,
        lookahead: lookahead ? 1 : 0,
        ...(predicted !== undefined ? { predictedNextInput: Math.round(predicted) } : {}),
      },
    };
  }
}
```

### 6.5 预算公式速查(给配置者估额度,**按 regime 分**)

设每轮地板价 `base`(默认 18 700,事实 D)。**先确认范式默认 continuity(03 §2.1),再选对应行估**:

| regime | 量 | 公式 | N=8, base=18.7k 示例 |
|---|---|---|---|
| **stateless**(默认,近似平) | 第 k 轮 input | `≈ base + digest + delta ≈ c`(c≈1–1.5×base) | 第 8 轮 ≈ 18.7k–28k |
| | N 轮累积 input | `≈ c × N` | ≈ 150k–224k |
| **resume**(超线性,事实 D) | 第 k 轮 input(1-based) | `base × k` | 第 8 轮 ≈ 149.6k |
| | N 轮累积 input | `base × N(N+1)/2` | ≈ 673k |
| 两者 | 加 output(粗估 input 的 ~15%) | `× 1.15` | stateless≈172k–258k / resume≈774k |
| 两者 | 折算费用 | `usageToUsd(累积, pricing)` | 依 provider 计价 |

> **配额建议(按 regime)**:
> - **stateless 范式**(红蓝/对等/并行默认):按 `c × N × 1.3`(留 30% 余量,c 取 1.5×base 保守)反推 `maxTotalTokens`。**别套 resume 的超线性公式**——那会把额度配大 3–4 倍,前瞻刹车形同虚设。
> - **resume 范式**(主从子任务内):按 `base × N(N+1)/2 × 1.2` 反推,**别按线性**(线性低估会让预算在中途意外触顶)。
>
> 这是事实 D 对配置者最直接的告诫(v2 细化):**先认 regime,再选公式**。配错公式比配错数字更危险——stateless 套超线性 = 永不触发前瞻误判额度过大;resume 套线性 = 中途爆预算。【待实测】stateless 的 c 系数(1–1.5×base)与 output/input 15% 比例均为经验值,M2 用 `turn.completed.usage` 实测分布校准(reasoning 模型 output 占比更高)。

### 6.6 扇出前瞻闸 + 单 turn 上限(v3,H-FANOUT / RS-M5 / ROC-M5)

**问题**:v2 把前置刹车删了只留轮末 `shouldStop`(对齐 03 H1),这对**串行单 agent** 循环正确——下一轮启动前已前瞻(§6.4 ②)。但 Fusion panel(05/07)在**单轮内并发 N 个成员**同时跑 turn,轮末检查在 N 个 turn 全部烧完之后才触发,**一轮即可超支 N×base**(ROC-M5:panel 单轮 N 成员无单 turn 上限,只有墙钟超时;RS-M5:预算只轮末单次裁决,扇出无前瞻)。轮末刹车对扇出**事后诸葛**,救不回已花的钱。

**修订**:在引擎/panel-runner **spawn 成员之前**插一道**扇出前瞻闸** `preflightFanout`,外加**单 turn 硬上限** `maxTurnTokens`(§6.3)。两者都不是 `StopPolicy`(不在轮末循环),是 `BudgetPolicy` 暴露的**前瞻纯函数**,供引擎在扇出点调用:

```ts
/** 扇出前瞻裁决:在并发 spawn N 个 turn【之前】判这一轮扇出会不会跨预算(v3,H-FANOUT)。 */
export interface FanoutPreflight {
  /** 是否允许本次扇出 */
  readonly allowed: boolean;
  /** 不允许时的原因码(同轮末,TOKEN_BUDGET_EXCEEDED) */
  readonly code?: SyluxErrorCode;
  readonly reason?: string;
  /** 建议可扇出的最大成员数(allowed=false 时引擎可据此降并发重试,而非硬停) */
  readonly maxSafeMembers?: number;
  readonly metrics?: Readonly<Record<string, number | string>>;
}

export class BudgetPolicy implements StopPolicy {
  // …(§6.4 续)

  /**
   * 扇出前瞻(纯函数,引擎在 panel spawn 前调,不改状态)。
   * @param ctx        当前轮末快照(累积已兜底,§2.1)
   * @param plannedMembers 本轮计划并发的成员数 N(panel 大小;串行循环传 1)
   * @param perMemberTokensHint 单成员预估 token(引擎给;无则用 maxTurnTokens,再无则实测外推单轮值)
   */
  preflightFanout(
    ctx: StopContext,
    plannedMembers: number,
    perMemberTokensHint?: number,
  ): FanoutPreflight {
    const floored = floorUsage(ctx.totalUsage, ctx.round + 1);
    const usedTokens =
      floored.inputTokens + floored.outputTokens + floored.reasoningOutputTokens;
    // 单成员成本上界:优先 hint,其次 maxTurnTokens(硬墙即最坏),再次实测外推单轮 input。
    const base = ctx.rounds[0]?.usage?.inputTokens ?? BASELINE_INPUT_PER_ROUND;
    const series = roundInputSeries(ctx.rounds, base);
    const perMember = Math.max(
      perMemberTokensHint ?? 0,
      this.cfg.maxTurnTokens ?? 0,
      predictNextRoundInputTokens(series, base), // 兜底:至少一轮 base 量级
    );
    const projected = usedTokens + perMember * Math.max(1, plannedMembers);

    // 对 token 与 cost 双线判定(取先触发者)
    const overToken =
      this.cfg.maxTotalTokens !== undefined && projected >= this.cfg.maxTotalTokens;
    const projectedCost = this.cfg.pricing
      ? usageToUsd({ ...floored, inputTokens: floored.inputTokens + perMember * plannedMembers }, this.cfg.pricing)
      : undefined;
    const overCost =
      this.cfg.maxCostUsd !== undefined && projectedCost !== undefined &&
      projectedCost >= this.cfg.maxCostUsd;

    if (!overToken && !overCost) {
      return { allowed: true, metrics: { plannedMembers, perMember, projected } };
    }
    // 算"还能安全扇出几个成员"(剩余预算 / 单成员),供引擎降并发而非硬停
    const remaining = (this.cfg.maxTotalTokens ?? Infinity) - usedTokens;
    const maxSafeMembers = Math.max(0, Math.floor(remaining / Math.max(1, perMember)));
    return {
      allowed: false,
      code: 'TOKEN_BUDGET_EXCEEDED',
      // S8/H-INJ:仅数字与枚举,无 agent 文本
      reason: `扇出前瞻:计划 ${plannedMembers} 成员×≈${Math.round(perMember)} token 将超预算,建议降至 ${maxSafeMembers} 成员或停`,
      maxSafeMembers,
      metrics: { plannedMembers, perMember, projected, maxSafeMembers },
    };
  }
}
```

> **三道成本防线(S10)合起来**:① 轮末累积实测触发(§6.4 ①)——事后兜底;② 启动下一轮前瞻(§6.4 ②)——串行循环防超;③ **扇出前瞻 `preflightFanout` + 单 turn 上限 `maxTurnTokens`**(本节)——并发 panel 防一轮烧穿。`maxTurnTokens` 由引擎在 `runTurn` 内强制(超则杀该 turn),是最后兜底硬墙,即便单成员失控也封顶。**引擎扇出时序**:`preflightFanout(allowed=false)` 时引擎**优先降并发**(取 `maxSafeMembers`)重试,降到 0 仍不行才硬停记 `TOKEN_BUDGET_EXCEEDED`——避免"差一点点预算就整轮放弃"。这把 RS-M5/ROC-M5 的"轮末才发现已超 N 倍"前移到"扇出前就拦住"。
>
> **为何不做成 StopPolicy**:`StopPolicy` 是轮末循环钩子(§2.4),扇出发生在**轮内**(一轮 spawn 多 turn),时机不同。把扇出闸做成 `BudgetPolicy` 的前瞻方法(共享同一份 cfg/pricing/兜底逻辑)既复用又不污染轮末单点裁决契约(对齐 03 H1 无前/后置二分)。

### 6.7 阈值热换(v3,H-HOTSWAP / ROC-M2)

16 §11.5 承诺 stop 阈值可运行期热换"下一轮生效",但 v2 `buildStopPolicy` 构造期一次性组装,`ConvergencePolicy` 有状态。v3 经 `StopPolicy.reconfigure(patch)`(§2.3)兑现:

| policy | 热换什么 | 累积状态(绝不动,S12) | 实现 |
|---|---|---|---|
| `MaxRoundsPolicy` | `maxRounds` | 无 | 整表替换 |
| `BudgetPolicy` | `maxTotalTokens`/`maxCostUsd`/`pricing`/`lookaheadFactor`/`maxTurnTokens` | 无(无状态) | 整表替换 + 同构造期校验(§6.4) |
| `ConvergencePolicy` | `stallWindow`/`countSpecQuote`/`requireVerifiedProgress`/`minActiveRounds` | **seen / emptyStreak / lastUpdatedRound** | 只改 cfg(§4.3) |

> **铁律(S12)**:热换**只改阈值,绝不清零累积计数**。反例:run 已连续 1 轮空集(emptyStreak=1,stallWindow=2,下一轮空集就 stall),此时把 stallWindow 热换成 3——正确行为是 emptyStreak 仍为 1、需再 2 轮空集才 stall;**错误行为**(若 reconfigure 误重建 policy)是 emptyStreak 清零,让一个本该收尾的 run 平白多烧好几轮。这正是 ROC-M2 担心的"热换清零 stall 计数"。`reconfigure` 与 `reset`(§4.4 崩溃恢复)是**两条独立路径**:`reset` 从落盘 rounds 确定性重建(状态归零再回放),`reconfigure` 在线改阈值不碰状态。引擎热换走 `reconfigure`,崩溃恢复走 `reset`,**不可混用**。
>
> **热换入口**:由 server(09/11)收到面板的热换指令后,在**轮末 finalize 之前**调 `composite.reconfigure(patch)`(§8.4 透传),下一轮 `shouldStop` 即用新阈值。热换本身落一条 `kind:'system'`(from:'orchestrator')审计消息,patch 内容须过 redact(09)防把 pricing 等敏感配置广播给观战者。

## 7. done · 成功出口(引用 02 C2,非刹车)

done 不是刹车(不是 safety net),是**唯一的主动成功出口**。本文件把它实现成同 `StopPolicy` 接口的一员,纯粹为了让引擎"每轮末问一个聚合 policy 即可"(§8),但语义上 done 与三重刹车正交(不变量 S1)。

### 7.1 判定规则(全部引用 02,不另定义语义)

done 成立的充要条件(对应 02 §5.2 C2、C3 与 §2 `kind`/`role` 语义):

1. 全 run 存在一条 `kind==='done'` 消息(某 agent 自认完成);
2. 存在另一条 `kind==='ack'` 消息,`from` **不同于** done 的发出方(02 C3 禁自 done 自 ack),且 `inReplyTo` 指向该 done 消息;
3. 该 ack 已过 02 §8 `validateMessage`,即其 evidence **非空且至少一条强核验通过**(02 C2 + §8.2)。验证发生在入黑板时,done-detector **只读结论**(`messages` 已是 validated 集),不复算 evidence(S2)。

> **跨轮配对(v2 修正,H-DONE)**:done 与 ack **几乎永远不在同一轮**——红蓝范式偶轮 proposer 发 done、奇轮 critic 才能 ack(03 §7.1);主从范式 planner done 后 worker 下一轮才 ack。v1 `DonePolicy.shouldStop` 只扫 `ctx.roundMessages`(本轮),导致 done 永远等不到同轮 ack,**范式根本停不下来**(靠 maxRounds 兜底硬停,记成 `limit` 而非 `done`,语义错误)。v2 改扫 `ctx.messages`(全量),跨轮配对。复杂度 O(messages),每轮末一次,done 触发即停不重复扫,可接受。

```ts
export class DonePolicy implements StopPolicy {
  readonly id = 'done';
  update(_ctx: StopContext): void { /* 无状态:每轮全量扫 messages 配对 */ }

  shouldStop(ctx: StopContext): StopDecision {
    // H-DONE:跨全 run 配对(非仅本轮)。messages 已过 validateMessage(02 §8),
    // 此处只做语义配对,不复算 evidence(S2)。
    const dones = ctx.messages.filter((m) => m.kind === 'done');
    for (const done of dones) {
      const ack = ctx.messages.find(
        (m) =>
          m.kind === 'ack' &&
          m.from !== done.from &&            // 02 C3:对面 ack,非自 ack
          m.inReplyTo === done.id &&         // 指向该 done
          m.evidence.length > 0,             // 02 C2:ack 带证据(强核验已在入黑板时保证,§8.2)
      );
      if (ack) {
        // S8/H-INJ:from 是闭枚举(02 §2),固定模板,无 agent 自由文本入 reason。
        return {
          shouldStop: true,
          status: 'done',
          code: undefined,                   // 成功出口无错误码
          reason: `done 被对面带证据 ack(done.from=${done.from}, ack.from=${ack.from})`,
          metrics: {
            doneRound: done.round,
            ackRound: ack.round,
            ackEvidenceCount: ack.evidence.length,
          },
        };
      }
    }
    return KEEP_RUNNING;
  }
}
```

> **why `evidence.length > 0` 而非复算**:ack 指向 done 时触发 02 C2,`validateMessage` 在入黑板**那一刻**就已强制"≥1 条强核验通过",未过的 ack 根本进不了 `ctx.messages`。所以这里 `length>0` 是**冗余的廉价护栏**(防御 02 校验链被绕过的回归),真正的强度保证在上游(S2:本层只读结论不复算)。
>
> **maxRounds 在 done 等 ack 期间触顶**:若 done 已发但对面尚未 ack 就撞 maxRounds,优先级裁决(§8.2)给 `limit`(done 未配对成立,不算成功)。这是**预期行为**:done 是"自认"完成,未经对面带证据确认不算真完成。配置者应把 maxRounds 留足够余量让 ack 轮发生(§9 各范式 maxRounds 已含此余量)。

### 7.2 done 与 stall 的解耦证明(S1 落地)

| 维度 | done(成功出口) | stall(收敛刹车 B2) |
|---|---|---|
| 信号源 | 消息语义(`kind:done` + 对面 `ack`) | evidence 指纹差集(§4) |
| 触发性质 | 主动(双方达成一致) | 被动(挤不出新证据) |
| 终态 | `done` | `stalled` |
| 是否需对面参与 | 是(必须对面带证据 ack) | 否(单看历史指纹流) |
| 互相触发 | **不**:done 不看指纹,stall 不看 done/ack 配对 | **不** |

> 一个 run 可"done 而从未接近 stall"(三两轮快速达成一致),也可"stall 而从未 done"(吵到没新证据被动停)。两条信号在 §8 聚合时按优先级裁决(done 优先于 stall,§8.2),但它们的**判定彼此不可见**,这就是 R5 要求的解耦。

### 7.3 PlaybookDonePolicy · 范式特定完成判据的包装器(引擎 03 H2 依赖项)

引擎 03 §0.4 H2 / §3.3 要求:通用的"一方 done + 对面带证据 ack"由本文件 `DonePolicy` 统一处理;但有些范式有**通用判据覆盖不到**的完成门,例如:
- **parallel**:全部 worker 各自发过 `done` 且 merge 干净——**无对面 ack**(各跑各的,无对抗),`DonePolicy` 的"对面 ack"条件天然不成立(03 §7.4);
- **master-worker**:子任务清单**全 accept** 才算范式完成(planner 的私有状态,03 §7.2.1),这是 `DonePolicy` 看不见的 playbook 内部状态。

这些判据是 `playbook.isDone(board)` 的职责(03 §3.3),但引擎 03 H2 明确**引擎本体不再 `if(isDone)`**,而是把 `playbook.isDone` 经一个 `StopPolicy` 包装注入本文件的 `CompositeStopPolicy`(与 `DonePolicy` 并列,同享优先级裁决)。这个包装器就是 `PlaybookDonePolicy`,**由本文件提供**(03 §0.2 点名):

```ts
/** 把 playbook 的范式特定完成判据包装成一个 StopPolicy(03 H2)。
 *  与 DonePolicy 并列注入 composite;二者都映射终态 done(成功出口,优先级 0,§8.2)。 */
export class PlaybookDonePolicy implements StopPolicy {
  readonly id = 'playbook-done';
  /**
   * @param probe 引擎注入的范式完成探针,内部调 playbook.isDone(board)。
   *   入参用 StopContext(本层不持 BoardView);引擎在注入时用闭包桥接 board→ctx(03 §4.3)。
   *   probe 必须是**纯读**(playbook.isDone 是只读 BoardView,03 §4.1),无副作用。
   */
  constructor(private readonly probe: (ctx: StopContext) => boolean) {}

  update(_ctx: StopContext): void { /* 无状态:每轮重新问 probe */ }

  shouldStop(ctx: StopContext): StopDecision {
    if (!this.probe(ctx)) return KEEP_RUNNING;
    // S8/H-INJ:reason 为固定常量,无 agent 文本。范式特定 done 不携带 done/ack 配对信息。
    return {
      shouldStop: true,
      status: 'done',
      code: undefined,
      reason: '范式特定完成判据满足(playbook.isDone)',
      metrics: { doneRound: ctx.round, source: 'playbook' },
    };
  }
}
```

> **DonePolicy vs PlaybookDonePolicy 分工**:`DonePolicy` 管**通用** done+ack(红蓝/对等/主从收口的"对面带证据 ack");`PlaybookDonePolicy` 管**范式特定**门(parallel 全 lane done、master-worker 清单全 accept)。二者都映射 `done` 终态、都在 composite 内、都享优先级 0。一个 run 通常只配其一(看范式),也可并存(取先触发者,终态同为 done 无歧义)。**职责不重叠**:引擎不再单独判 done(03 H2),所有 done 路径都收口到本层 composite,单点裁决。
>
> **与 stall 仍解耦(E4/S1)**:`PlaybookDonePolicy.probe` 内部即便读了 `board.stalledFor(window)`(03 §4.1 BoardView 暴露的 stall 预判),那也只是 playbook 自己的范式判断;**最终 stall 终止仍由本层 `ConvergencePolicy` 强制**(03 §4.1 注:playbook 判断不能绕过 ConvergencePolicy)。done 与 stall 的信号源依旧彼此不可见。

## 8. CompositeStopPolicy · 聚合与优先级裁决(S5)

引擎只认识一个 `StopPolicy`。`CompositeStopPolicy` 把 done 出口 + 三重刹车聚合成一条注入引擎,并解决"同一轮多条同时触发"的二义(不变量 S5)。

### 8.1 聚合的两步铁律(对应 §2.3 update/shouldStop 分离)

```ts
export class CompositeStopPolicy implements StopPolicy {
  readonly id = 'composite';
  constructor(private readonly children: readonly StopPolicy[]) {}

  /** ① 先无条件 update 全部子 policy —— 不短路,保证有状态刹车(stall 计数)不漏更新 */
  update(ctx: StopContext): void {
    for (const p of this.children) p.update(ctx);
  }

  /** ② 后裁决:收集所有 shouldStop 的子决策,按优先级取唯一终态(§8.2) */
  shouldStop(ctx: StopContext): StopDecision {
    const fired = this.children
      .map((p) => ({ id: p.id, d: p.shouldStop(ctx) }))
      .filter((x) => x.d.shouldStop);
    if (fired.length === 0) return KEEP_RUNNING;
    // 健壮性:shouldStop=true 必带 status(接口契约);但防御性地把缺 status 的当最低优先级,
    // 避免 PRIORITY[undefined] 取到 NaN 破坏排序(排序断言:NaN 比较恒 false 会乱序)。
    const prio = (d: StopDecision) =>
      d.status === undefined ? Number.MAX_SAFE_INTEGER : PRIORITY[d.status];
    fired.sort((a, b) => prio(a.d) - prio(b.d));
    const winner = fired[0];
    // 多条同触发时,把并发触发的其他信号塞进 metrics 供审计(不改终态)
    return {
      ...winner.d,
      metrics: {
        ...winner.d.metrics,
        coFired: fired.map((f) => `${f.id}:${f.d.status ?? 'unknown'}`).join(','),
      },
    };
  }

  reset(rounds: readonly Round[]): void {
    for (const p of this.children) p.reset?.(rounds);
  }

  /** 热换:按 child id 把对应 patch 透传给子 policy(v3 H-HOTSWAP / §6.7)。
   *  patches 形如 { 'max-rounds': {maxRounds}, convergence: {stallWindow}, budget: {maxCostUsd} }。
   *  只透传阈值,子 policy 各自保证不动累积状态(S12)。未知 id 忽略(防热换打错名静默无副作用)。 */
  reconfigure(patches: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
    for (const p of this.children) {
      const patch = patches[p.id];
      if (patch && p.reconfigure) p.reconfigure(patch);
    }
  }
}
```

> **为何 update 不短路**:若按"第一个 shouldStop 即返回"短路,则排在 done 之后的 `ConvergencePolicy.update` 可能被跳过,`emptyStreak` 漏加一轮——下次没 done 时 stall 判定滞后。所以**先全量 update,再统一裁决**(§2.3 把两方法拆开的根本原因)。

### 8.2 优先级表(同轮多触发→唯一终态)

```ts
/** 数值越小优先级越高。done 最优先(成功出口优于任何安全网终止)。 */
const PRIORITY: Record<NonNullable<StopDecision['status']>, number> = {
  done: 0,      // 成功出口最优先:既然双方已带证据达成一致,即便同轮也触顶,也算成功
  aborted: 1,   // 人工/致命错误次之
  limit: 2,     // 硬上限(maxRounds / budget)
  stalled: 3,   // 被动 stall 最低:有任何更明确的终止理由都优先于"吵不动了"
};
```

裁决依据(为什么是这个序):

| 终态 | 序 | 理由 |
|---|---|---|
| `done` | 0 | 成功出口。若同轮既达成 done 又恰好触顶 maxRounds,记 **done**——任务实际已完成,不应被记成"超限失败"。 |
| `aborted` | 1 | 人工中止 / 致命错误是外部强信号,优于自动安全网。 |
| `limit` | 2 | 确定性硬上限(轮数/预算),优于被动 stall:既然已确定性触顶,无需再讨论"是不是吵不动了"。 |
| `stalled` | 3 | 最弱。只有在没有任何更明确终止理由时,才以"无新证据"收尾。 |

> 并发触发的全部信号写进 `metrics.coFired`(如 `done:done,max-rounds:limit`),终态取最高优先级,审计可见"还同时撞了哪些线"。这焊死 S5:**给定一轮的多触发,终态唯一且确定**。

### 8.3 工厂:从 playbook 配置组装

```ts
export interface StopPolicyConfig {
  readonly maxRounds: MaxRoundsConfig;
  readonly convergence?: ConvergenceConfig;  // 省略则不启用 stall 检测
  readonly budget?: BudgetConfig;            // 省略则不限成本(仅靠 maxRounds 兜底)
  readonly enableDone?: boolean;             // 通用 done+ack 检测,默认 true
  /**
   * 范式特定完成探针(§7.3 PlaybookDonePolicy)。引擎用闭包桥接 playbook.isDone→ctx 注入(03 §4.3)。
   * 省略则不启用范式特定 done(如纯红蓝只靠通用 done+ack 即可)。
   */
  readonly playbookDone?: (ctx: StopContext) => boolean;
}

/** playbook(引擎 03)据其范式给配置,工厂组装 composite。done 永远在(除非显式关)。 */
export function buildStopPolicy(cfg: StopPolicyConfig): CompositeStopPolicy {
  const children: StopPolicy[] = [];
  if (cfg.enableDone !== false) children.push(new DonePolicy());
  if (cfg.playbookDone) children.push(new PlaybookDonePolicy(cfg.playbookDone)); // §7.3
  children.push(new MaxRoundsPolicy(cfg.maxRounds)); // 必有:最后防线
  if (cfg.convergence) children.push(new ConvergencePolicy(cfg.convergence));
  if (cfg.budget) children.push(new BudgetPolicy(cfg.budget));
  return new CompositeStopPolicy(children);
}
```

> **不变量**:`MaxRoundsPolicy` **永远在场**(§3 最后防线),`convergence`/`budget`/`playbookDone` 可选,`done` 默认在。这保证任何 playbook 配置下 run 必然有限终止——即便配置者忘了设预算、即便 stall 被对抗输入骗过,maxRounds 兜底。**done 路径单点收口**(03 H2):通用 done 走 `DonePolicy`、范式 done 走 `PlaybookDonePolicy`,引擎本体不再自判 done,杜绝"引擎判一次、composite 再判一次"的双重检测。

### 8.4 运行期热换透传(v3,H-HOTSWAP / ROC-M2)

`CompositeStopPolicy.reconfigure(patches)`(§8.1 代码)按 child `id` 把对应 patch 分发给子 policy,子 policy 各自只改阈值不动累积状态(S12 / §6.7)。注意它与 `StopPolicy.reconfigure(patch)` 单 policy 接口**形态不同**:composite 收的是 `{ childId: patch }` 映射(因为它要路由),单 policy 收的是自己的 patch。这是 composite 作为聚合器的合理特化(类似 `reset` 也是遍历透传)。

```ts
// server(09/11)收到面板热换指令 → 轮末 finalize 之前调用
composite.reconfigure({
  'max-rounds': { maxRounds: 10 },        // 放宽轮数上限
  convergence: { stallWindow: 3 },        // 放宽 stall 窗口(emptyStreak 不清零!S12)
  budget: { maxCostUsd: 20 },             // 抬高费用上限
});
// 下一轮 composite.shouldStop 即用新阈值;seen/emptyStreak 一律保持
```

> **热换 vs 崩溃恢复**(再次强调,易混点):`reconfigure` = 在线改阈值、**不碰**累积状态;`reset(rounds)` = 崩溃后从落盘 rounds **确定性重建**全部状态(§4.4)。引擎热换走前者,恢复走后者,混用会导致 stall 计数被意外清零(ROC-M2 的失败模式)。`buildStopPolicy`(§8.3)**只在 run 启动时调一次**,之后阈值变化一律走 `reconfigure`,**绝不**重新 `buildStopPolicy`(重建会丢 ConvergencePolicy 的 emptyStreak)。

## 9. 各范式默认配置(playbook 注入,引擎 03 引用)

四范式(红蓝对抗/主从/对等结对/分工并行)是同一循环填不同参数(锁定决策 §3),刹车组合也随范式调。下表是**建议默认**,playbook 可覆盖;`base` 统一用事实 D 的 18.7k 估预算。`requireVerifiedProgress` 全范式默认 `true`(H-FP),`countSpecQuote` 仅规范评审开。`maxTotalTokens` 估法**按各范式默认 continuity 选公式**(§6.5):stateless 用线性 `c×N`,resume 用超线性。

| 范式 | 默认 continuity(03 §2.1) | `maxRounds` | `stallWindow` | `countSpecQuote` | `roundEvidenceExpected=false` 的轮(H-EMPTY) | `maxTotalTokens` 估法 | done 路径 |
|---|---|---|---|---|---|---|---|
| 红蓝对抗 | stateless | 6–8 | 2 | false | 无(每轮都该出 critique/evidence) | **线性** `c×N×1.3`(N=8,c=1.5base≈225k) | DonePolicy(done+ack) |
| 主从(planner/worker) | resume(子任务内) | 10–12 | 3 | false | **派活轮 + review 轮**(planner 派任务/复用旧锚点验收,无新证据合法,03 §7.2) | **混合**:resume 子任务段超线性 + 跨段 stateless,保守按 N=12 resume≈1.75M | DonePolicy + PlaybookDonePolicy(清单全 accept,§7.3) |
| 对等结对 | stateless | 4–6 | 2 | false | 无(每轮都该推进) | 线性 `c×N×1.3`(N=6≈168k) | DonePolicy(done+ack 或双向 ack) |
| 分工并行 | stateless | 8–10 | 3 | false | **同步/合并轮**(各 lane 已落证据,合并轮本身不产新指纹,03 §7.4) | 线性 `c×N×1.3`(N=10≈281k);**panel 须配 preflightFanout + maxTurnTokens**(§6.6) | **PlaybookDonePolicy**(全 lane done,无对面 ack,§7.3) |
| 规范评审(特化) | stateless | 4–6 | 2 | **true** | 无 | 线性 `c×N×1.3`(N=6≈168k) | DonePolicy |

> 这些只是**起点**,真值待 M2 用 `turn.completed.usage` 实测校准(§6.5 的 c 系数、output/input 比例、长程性)。配置原则(v2/v3):**① 先认 continuity regime 再选预算公式**(stateless 套超线性会把额度配大 3–4 倍,前瞻刹车失效;H-B3);**② 轮数多/证据慢的范式放宽 stall 窗口**(防假阳性误杀);**③ 对抗性范式收紧 maxRounds**(防无限对喷);**④ parallel 无对面 ack,done 必走 PlaybookDonePolicy**(§7.3),否则 `DonePolicy` 永不成立、只能靠 maxRounds 兜底;**⑤ maxRounds 留足 ack 轮余量**(done 等对面 ack 跨轮,H-DONE,否则 done 期间撞 maxRounds 记成 limit);**⑥(v3)派活/合并/review 轮必须标 `roundEvidenceExpected=false`**(H-EMPTY),否则这些天然空证据的合法轮会被计入 stall 误杀——主从/并行尤其要靠 playbook 在 round 元数据(03 §3.3)正确标注相位;**⑦(v3)任何 panel 扇出范式(Fusion 决策回合)必须配 `maxTurnTokens` + 引擎在扇出点调 `preflightFanout`**(§6.6),否则单轮 N 成员并发可在轮末刹车触发前烧穿预算(RS-M5/ROC-M5)。

## 10. 完整每轮末时序(整合 §2.4 + §8)

```
引擎(03)round 内全部 message append 且 validateMessage(02 §8)通过
  │
  ├─【轮内·扇出前】若本轮是 panel 扇出(Fusion 决策回合):
  │     pf = budget.preflightFanout(ctxPrev, plannedMembers)  // §6.6 spawn 前前瞻
  │     ├─ pf.allowed=false → 降并发到 pf.maxSafeMembers 重试;降到 0 仍不行 → 直接 finalize limit
  │     └─ 各成员 turn 受 maxTurnTokens 硬墙约束(引擎 runTurn 内强制,§6.3)
  │
  ├─ blackboard.closeRound(round)
  │     └─ 落 round_closed:缓存 evidenceFingerprints(02 §9.2 fingerprintSet)+ usage(02 §7.1)
  │          + 轮相位元数据 evidenceExpected / verificationDegraded(playbook 03 §3.3 + 校验降级)
  │
  ├─ ctx = buildStopContext(boardState)        // §2.1 投影(单参权威,BoardView 经 snapshot 桥接 H-BRIDGE)
  │     └─ usage 双侧地板兜底(input+output 都不当 0,H-USAGE+H-OUT0);
  │        填 roundEvidenceExpected / roundVerificationDegraded(H-EMPTY/H-DEGRADE)
  │
  ├─ composite.update(ctx)                      // §8.1 ① 全量推进(不短路,stall 计数等)
  │     ├─ DonePolicy.update         (no-op;shouldStop 时跨全量 messages 配对 done↔ack,H-DONE)
  │     ├─ PlaybookDonePolicy.update (no-op;若配置;shouldStop 时调 playbook.isDone 探针,§7.3)
  │     ├─ MaxRoundsPolicy.update    (no-op)
  │     ├─ ConvergencePolicy.update  (推进 seen + emptyStreak;非"该出证据"轮/核验降级轮冻结计数 S9/H-EMPTY)
  │     └─ BudgetPolicy.update       (no-op;shouldStop 时实测外推预测,H-B3)
  │
  ├─ decision = composite.shouldStop(ctx)       // §8.1 ② 收集触发→优先级裁决(§8.2)
  │
  └─ if decision.shouldStop:
        ├─ engine.appendSystemMessage(decision) // kind:'system', from:'orchestrator'(02 C7)
        │     └─ body = decision.reason(仅枚举/数字/常量,S8);evidence=[];过内容防火墙(安全 09)
        ├─ blackboard.setStatus(decision.status, decision.code, decision.reason) // 三参权威 H-BRIDGE
        │     └─ 落 status_changed(02 §7.1,需回填 code 字段),终态(done/stalled/limit/aborted)
        └─ engine.stop()                         // 不再启动下一轮
     else:
        └─ engine.startNextRound()               // round+1;预算前瞻已在 shouldStop 内判过

热换(运行期):server 收面板指令 → 轮末 finalize 前 composite.reconfigure(patches)(§8.4,只改阈值不动计数 S12)
崩溃恢复:从 jsonl 重建 BoardState(02 §7.3)后,composite.reset(rounds) 重放 stall 状态机(§4.4,与热换互斥)
```

## 11. 错误码与终态映射(引用 02 §12,不另定义)

本文件**只产出**已在 02 §12 定义的三个刹车错误码,不新增错误码(焊死 R1):

| 信号 | 错误码(02 §12) | 终态(02 §10.2) | shouldStop 来源 |
|---|---|---|---|
| maxRounds 触顶 | `ROUND_LIMIT_EXCEEDED` | `limit` | `MaxRoundsPolicy`(§3) |
| 收敛 stall | `CONVERGENCE_STALL` | `stalled` | `ConvergencePolicy`(§4) |
| 成本触顶/前瞻 | `TOKEN_BUDGET_EXCEEDED` | `limit` | `BudgetPolicy`(§6) |
| done 成功(通用 done+ack) | (无 code) | `done` | `DonePolicy`(§7.1) |
| done 成功(范式特定) | (无 code) | `done` | `PlaybookDonePolicy`(§7.3) |
| 人工中止/致命 | (各自 code,非本层产) | `aborted` | 引擎/适配层 |

> `limit` 终态由 `ROUND_LIMIT_EXCEEDED` 与 `TOKEN_BUDGET_EXCEEDED` 共用,靠 `code` 区分(§0.1)。终态写入 02 §7.1 `status_changed` 记录,`reason` 取 `decision.reason`。

## 12. 单测矩阵(交付验收锚点,对接 02 §13 风格 + 总体规划 §12 T1.7)

每条"给定 StopContext 序列 → 期望 StopDecision",纯函数无 IO,直接落 vitest。`mkRound(idx, fps, usage?)` / `stepCtx(round, rounds, opts?)` 为测试工厂(`opts` 可填 `messages`/`totalUsage`;收敛类只喂指纹,done 类才填 messages,§5.2 工厂约定)。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| B1-1 | maxRounds 触顶 | maxRounds=3,跑到 round=2 | `limit` / `ROUND_LIMIT_EXCEEDED` |
| B1-2 | 未到顶 | maxRounds=3,round=1 | `KEEP_RUNNING` |
| B1-3 | 非法配置 | maxRounds=0 | 构造期抛 |
| B2-1 | 换措辞仍 stall(反例一) | 三轮同强指纹,stallWindow=2 | `stalled` / `CONVERGENCE_STALL`(§5.1) |
| B2-2 | 新锚点清零(反例二A) | round2 出新强指纹 | `KEEP_RUNNING`(§5.2A) |
| B2-3 | 空口新问题仍 stall(反例二B) | round2 复用旧指纹 | `CONVERGENCE_STALL`(§5.2B) |
| B2-4 | minActiveRounds 宽限 | round0 空集,minActiveRounds=1 | `KEEP_RUNNING`(不计 stall) |
| B2-5 | spec_quote 默认不计 | 仅 `s:` 指纹更新,countSpecQuote=false | 视为空集→累加 stall |
| B2-6 | spec_quote 计入(特化) | 同上但 countSpecQuote=true 且 requireVerifiedProgress=false | 视为新指纹→清零 |
| B2-7 | 幂等 update | 同一 round update 两次 | `emptyStreak` 只 +1(§4.4) |
| B2-8 | reset 回放重建 | 喂 rounds 数组 reset | seen/emptyStreak 与顺序 update 等价 |
| B2-9 | **未核验 `:?` 换区间仍 stall(反例三,H-FP)** | 三轮各换区间的 `:?` 指纹,requireVerifiedProgress=true | `CONVERGENCE_STALL`(§5.2 反例三 / S6) |
| B2-10 | **关闭 requireVerifiedProgress 则 `:?` 清零** | 同上但 requireVerifiedProgress=false | `KEEP_RUNNING`(换区间算新指纹) |
| B2-11 | **派活/合并轮冻结 stall(H-EMPTY)** | 连续空集但 roundEvidenceExpected=false | `KEEP_RUNNING`;emptyStreak 不累加(§4.3/S9) |
| B2-12 | **核验降级轮冻结 stall(H-DEGRADE)** | 空集且 roundVerificationDegraded=true | `KEEP_RUNNING`;emptyStreak 不累加(COV-3) |
| B2-13 | **冻结非清零:恢复后续算(S9)** | streak=1 → 1 个冻结轮 → 再 1 个空证据轮 | `CONVERGENCE_STALL`(冻结轮不清零,续算到 2) |
| B2-14 | **冻结轮指纹仍并入 seen** | 冻结轮带强指纹 fp,后续轮复用 fp | 后续轮 fp 算"已见"→空集(seen 已含 fp) |
| B2-15 | **reconfigure 不清零 emptyStreak(H-HOTSWAP)** | streak=1,reconfigure({stallWindow:5}),再空集轮 | emptyStreak=2(非清零),仍未到新 window 5 → `KEEP_RUNNING` |
| B3-1 | token 累积触顶 | totalUsage 超 maxTotalTokens | `limit` / `TOKEN_BUDGET_EXCEEDED`,lookahead=0 |
| B3-2 | 费用触顶 | costUsd 超 maxCostUsd | 同上 |
| B3-3 | 前瞻提前停 | 当前未超,实测外推下轮超 | `TOKEN_BUDGET_EXCEEDED`,lookahead=1,带 predictedNextInput |
| B3-4 | 前瞻关闭不提前停 | lookahead=false,当前未超 | `KEEP_RUNNING` |
| B3-5 | maxCostUsd 缺 pricing | 构造 BudgetPolicy | 构造期抛 |
| B3-6 | **实测外推:stateless 近似平(H-B3)** | 两轮 input≈相等[19k,19k],base=18.7k | predict≈19k(非 base×k 的≈56k);不误杀 |
| B3-7 | **实测外推:resume 超线性(H-B3)** | 两轮 input[18.7k,37.6k] | predict≈56.5k(last+Δ,贴合事实 D) |
| B3-8 | **冷启动兜底** | 0 轮实测,predictNextRoundInputTokens([],18700) | =18700(上界兜底) |
| B3-9 | usageToUsd 缓存折价 | cached < input 价 | 命中缓存部分按 cachedInputPerM 计 |
| B3-10 | **usage 缺失不当 0(H-USAGE)** | totalUsage 偏低/Round.usage 缺失 | 按 `base×(round+1)` 地板兜底,非 0 |
| B3-11 | **output 缺失不当 0(H-OUT0)** | totalUsage.outputTokens 缺失,设 maxCostUsd | costUsd 含 `BASELINE_OUTPUT_PER_ROUND×(round+1)` 折价,非 0;不绕过 maxCostUsd(ROC-M1) |
| B3-12 | **floorUsage 双侧地板** | usage 全缺,floorUsage(u, n) | input≥base×n 且 output≥outBase×n |
| B3-13 | **扇出前瞻拒绝(H-FANOUT)** | preflightFanout,N 成员预测超 maxTotalTokens | allowed=false,带 maxSafeMembers<N(§6.6) |
| B3-14 | **扇出前瞻放行** | N 成员预测未超 | allowed=true |
| B3-15 | **扇出降并发建议** | 剩余预算够 2 不够 5,plannedMembers=5 | maxSafeMembers=2(引擎据此降并发重试) |
| B3-16 | **reconfigure 热换上限(H-HOTSWAP)** | maxTotalTokens=100k→reconfigure({maxTotalTokens:50k}) | 下一轮按 50k 判,无累积状态变动 |
| B3-17 | **reconfigure maxCostUsd 缺 pricing 抛** | 原无 pricing,patch 设 maxCostUsd | reconfigure 抛(同构造期校验) |
| D-1 | **done 跨轮 ack(H-DONE)** | done 在 round0(codex),ack 在 round1(claude) evidence 非空 | `done`(§7.1,跨轮配对) |
| D-2 | 自 done 自 ack | done 与 ack 同 from | `KEEP_RUNNING`(02 C3,from!== 不配对) |
| D-3 | done 无对面 ack | 仅 done 无 ack | `KEEP_RUNNING` |
| D-4 | done 但 ack 空 evidence | ack.evidence=[] | `KEEP_RUNNING`(§7.1 条件3) |
| D-5 | **done 等 ack 期间撞 maxRounds** | done 已发未 ack,maxRounds 触顶 | `limit`(非 done,§7.1 预期行为) |
| D-6 | **PlaybookDonePolicy 触发(§7.3)** | probe 返回 true | `done`,metrics.source='playbook' |
| D-7 | **parallel 无 ack 靠 playbookDone** | 仅 done 无 ack + playbookDone=true | `done`(DonePolicy 不成立,PlaybookDonePolicy 成立) |
| C-1 | 优先级:done>limit | 同轮 done + maxRounds 触顶 | 终态 `done`,coFired 含两者(§8.2) |
| C-2 | 优先级:limit>stalled | 同轮 budget 超 + stall | 终态 `limit`(§8.2) |
| C-3 | update 不短路 | done 在 stall 前注册 | ConvergencePolicy.update 仍被调(§8.1) |
| C-4 | maxRounds 永在场 | 只配 maxRounds | composite 含 max-rounds + done |
| C-5 | 多触发 coFired 审计 | 同轮 done+limit+stall | metrics.coFired 三项齐 |
| C-6 | **缺 status 不破坏排序(健壮性)** | 子决策 shouldStop=true 但 status 缺 | 当最低优先级,不抛/不乱序(§8.1) |
| C-7 | **reason 无 agent 自由文本(S8/H-INJ)** | done.from/ack.from 入 reason | reason 仅含枚举 agentId,无 body/note |
| C-8 | **composite.reconfigure 路由透传(H-HOTSWAP)** | reconfigure({convergence:{stallWindow:3}}) | 仅 ConvergencePolicy.cfg 改,emptyStreak 不动(§8.4) |
| C-9 | **reconfigure 未知 id 静默忽略** | reconfigure({foobar:{x:1}}) | 不抛、无副作用 |

> **验收线(对接总体规划 §12 T1.7 / M2)**:B2-1/B2-2/B2-3 是 R5 红队验收硬锚点;**B2-9(`:?` 刷 stall)是 H-FP 验收**;**B2-11/B2-12/B2-13(合法空证据轮冻结/续算)是 H-EMPTY/H-DEGRADE 验收(FEAS-5/COV-3)**;**B2-15/C-8(热换不清零计数)是 H-HOTSWAP 验收(ROC-M2)**;**B3-6/B3-7(stateless/resume 实测外推)是 H-B3 验收**;**B3-11/B3-12(output 不当 0)是 H-OUT0 验收(ROC-M1)**;**B3-13/B3-15(扇出前瞻拦截/降并发)是 H-FANOUT 验收(RS-M5/ROC-M5)**;**D-1(跨轮 ack)是 H-DONE 验收**;**D-7(parallel 无 ack)是 H-PDONE 验收**;C-1 是 S5 优先级唯一性验收。这些不过,刹车层不算交付。

## 13. 交付说明与 openQuestions

### 13.1 必须写进交付说明的边界(防误用)

1. **收敛检测只识别"可机器核验的新颖性",不识别"语义新颖性"**(§5.2 已详述)。使用者不要期望它能挡住"同锚点、措辞不同的新论点"——那靠协议层"新问题须带新锚点" + 人工/arbiter 逃生阀(§5.2 缓解三件套),不靠收敛算法本身。
2. **只有核验通过的强指纹算进展**(S6/H-FP):无 quote 的 file_ref(`:?` 占位)与 spec_quote(`s:`)默认不清零 stall。配置者关掉 `requireVerifiedProgress` 等于让 agent 能用换区间的空 file_ref 无限刷 stall——除非确知场景无对抗,否则别关。
3. **预算先认 continuity regime 再选公式**(§6.5,H-B3):stateless(默认)按线性 `c×N` 配额、resume 按超线性 `base×N(N+1)/2` 配额。**最危险的误配是把 stateless 套超线性公式**——额度会大 3–4 倍,前瞻刹车形同虚设;反之 resume 套线性会中途爆预算。预测侧已用实测外推自适应(§6.2),但额度由配置者给,配错公式预测再准也救不回。
4. **前瞻刹车是预测不是保证**(S4):实测外推(§6.2)在 ≥2 轮后贴合真实曲线,但下一轮仍可能因 reasoning 波动偏差;触发终态永远以**实测累积**为准(§6.4 ①),前瞻只决定"启不启动下一轮"(§6.4 ②)。usage 缺失一律按基线兜底,绝不当 0(H-USAGE)。
5. **done 跨轮配对,留足 ack 余量**(H-DONE):done 与对面 ack 几乎不在同轮,`maxRounds` 必须留出 ack 轮;否则 done 已发、ack 未及就撞 maxRounds,记成 `limit` 而非 `done`(D-5,预期但需配置者知情)。**parallel 范式无对面 ack,done 必须走 `PlaybookDonePolicy`**(§7.3/§9),否则永远停不到 done。
6. **stall 是冻结终态,但非不可恢复的死局**(语义对齐 02 §10.2 / S7):`stalled` 一经 finalize 即冻结、不可回 `running`(02 状态矩阵)。"继续推进"有两条合法路径(§5.2 逃生阀):① finalize **之前**人工在 `paused` 态注入新可核验锚点,run 从未真正进入 stalled;② finalize **之后**派生新 run(旧 run digest 作种子 + 新指令,新 runId)。**不存在"resume 已 stalled 的同 run"**——那会破坏 02 终态不变量。
7. **裁决文本不含 agent 自由文本**(S8/H-INJ):`reason`/`metrics` 只用枚举、数字、中枢常量模板;裁决文本会进广播 system 消息,杜绝成为注入/日志投毒面。
8. **合法空证据轮必须由 playbook 标 `roundEvidenceExpected=false`**(v3,H-EMPTY/FEAS-5):master-worker 派活/review 轮、parallel 同步/合并轮天然无新强指纹却合法。若 playbook 漏标(默认 true),这些轮会被计入 stall 误杀。这是**配置/playbook 的责任**——本层只在拿到 false 标志时冻结计数,不会自己推断"这是不是派活轮"。中枢侧复跑器/沙箱故障要置 `roundVerificationDegraded=true`(H-DEGRADE/COV-3),否则基础设施故障会连坐 agent 误判收敛。
9. **panel 扇出范式必须配单 turn 上限 + 扇出前瞻**(v3,H-FANOUT/RS-M5/ROC-M5):Fusion 决策回合单轮并发 N 成员,轮末刹车事后才触发,一轮可烧 N×base。配置者必须设 `maxTurnTokens`(单 turn 硬墙)并让引擎在扇出点调 `preflightFanout`(§6.6)。**串行单 agent 范式不受此约束**(轮末/启动前瞻已足够)。
10. **成本估 input/output 双侧兜底,绝不半兜底**(v3,H-OUT0/ROC-M1):usage 任一字段缺失都按基线地板兜底(`floorUsage`,§6.2),尤其 output——只兜底 input 会让 `maxCostUsd` 在 reasoning 模型(output 占比高)上失明。CLI 升级改 usage 字段名导致字段缺失时,成本刹车仍**宁高勿低**不静默失明。
11. **阈值热换走 `reconfigure`,绝不重建 policy**(v3,H-HOTSWAP/ROC-M2):运行期改阈值必须 `composite.reconfigure(patches)`(§8.4),它只改阈值不动 seen/emptyStreak。**绝不**为热换重新 `buildStopPolicy`——那会清零 stall 计数让本该收尾的 run 起死回生。热换与崩溃恢复 `reset` 是两条互斥路径(§6.7)。

### 13.2 openQuestions(交合稿/M2 实测解,留给定稿)

- **【v3 已部分闭合】五份红队/交叉报告**:`docs/drafts/` 下的 `x-consistency.md`/`x-coverage.md`/`red-feasibility.md`/`red-security.md`/`red-ops-cost.md` 均已存在(与 v1 草稿时不同),其点名本文件(04)的核心 findings 已由任务简报转述并在本轮(v3)逐条吃掉:FEAS-5(合法空证据轮→H-EMPTY)、COV-3(核验降级连坐→H-DEGRADE)、RS-M5/ROC-M5(扇出无前瞻+无单 turn 上限→H-FANOUT)、ROC-M1(output 当 0→H-OUT0)、ROC-M2(热换承诺落空→H-HOTSWAP)、D4/D5(签名漂移→H-BRIDGE)。**ROC-B1 经核对不是本文件缺陷**:它指 16 §6.4 默认预算表对 stateless 误套超线性公式;本文件 §6.5/§9 已给"先认 regime 再选公式"且 stateless 用线性 `c×N`,**需回填的是 16**(把默认表的 stateless 行从超线性改线性,抄 18 §6.4 的 regime 分叉),非本文件。此项列为对 16 的回填要求(下条)。**定稿前建议**:据五份报告全文再过一遍,确认无本节专属 finding 漏吃(本轮以简报转述的总评+逐条 issue 为准)。
- **【对 16 的回填】默认预算表 regime 分叉(ROC-B1)**:16 §6.4 默认预算表对 red-blue/pair/parallel(stateless 默认)套了 resume 超线性公式(`base×N(N+1)/2×1.2`),与本文件 §9/§6.5 的线性 `c×N×1.3` 冲突,且正中 04 §6.5 点名的"最危险误配"。需回填 16:stateless 行改线性,并引用本文件 §6.5 的 regime→公式映射。本文件已是权威,16 须对齐。
- **【对 02 的回填】`status_changed` 增 `code` 字段(H-BRIDGE/D5)**:本文件 `setStatus(status, code?, reason?)` 三参为权威(§2.4),但 02 §7.1 `status_changed` 无独立 `code` 字段、03 §4.2 旧签名两参。需回填 02 增 `code?: SyluxErrorCode` + 03 改三参。过渡期可把 code 塞 reason 前缀(§2.4),非终态。
- **【对 03 的回填】`buildStopContext` 单参 + round 元数据(H-BRIDGE/D4 + H-EMPTY)**:本文件 `buildStopContext(board: BoardState)` 单参为权威(§2.1),03 §5.1 旧伪代码两参 `(BoardView, round)` 需经 `board.snapshot()` 桥接。同时 03 §3.3 需提供 round 相位元数据(`evidenceExpected`/`verificationDegraded`)供引擎填 `StopContext` 的两个 v3 新字段——这两个字段**不是 `BoardState` 固有**,是 playbook 相位 + 校验降级的投影,03 须明确其来源与落盘(02 §7.1 `round_closed`)。
- **【对 02/Round 的回填】`Round` 增相位/降级元数据落盘**:`reset` 回放(§4.3)从 `rounds[r].evidenceExpected`/`verificationDegraded` 取值;这要求 02 `round_closed`(§7.1)落盘这两个字段,否则崩溃恢复回放只能保守按 true/false,可能与在线判定不一致(回放偏严,可接受但需知情)。需 02 确认 `Round` 形状是否纳入这两字段。
- **【与 17 协同】preflightFanout 的 perMemberTokensHint 来源**:§6.6 的单成员预估优先取 hint,但 hint 由谁给未定——应来自 17 的 ConcurrencyGovernor / panel-runner 对成员历史均值的估计(ROC-M3 也点名评测 runner 并发未引 17 全局许可池)。本文件只定 `preflightFanout` 签名与兜底(无 hint 时用 maxTurnTokens→实测外推),hint 的精确来源待 07/17 定稿。
- **【与 08 协同】maxTurnTokens 的强制点**:本文件定 `maxTurnTokens` 配置 + preflightFanout 估算用途,但"超则杀该 turn"的强制发生在引擎 `runTurn`(03/05),记什么错误码(建议复用 `SUBPROCESS_TIMEOUT` 或新增 `TURN_TOKEN_EXCEEDED`)待 02 §12 错误码补全时定(02 §12 union 本就缺 17+ 个下游码,见 x-consistency A1)。
- **编号统一(02 残留"07")**:引擎 03 v2 已统一用实际文件名编号(刹车=04)并辅角色名防漂;但 02 仍在交叉引用里称刹车文档为"07"(02 §0.2/§9.3/§12 多处)。合稿时需回填 02 把"07"改"04",或全仓统一到另一套编号并按角色名重定位。
- **03 残留 `Brakes` 接口**:引擎 03 §0.4 H1 已宣布废弃自造 `Brakes`/`checkBefore`/`checkAfter`,改用本文件 `StopPolicy`;但 03 §4.3 `EngineDeps.brakes: Brakes` 与 §5.1 主循环伪代码仍是旧 `checkBefore/checkAfter` 写法(H1 未落到代码)。需回填 03 把这两处改为 `stopPolicy: StopPolicy` + 每轮末单次 `update→shouldStop`(本文件 §2.4 时序为准)。
- **base 取值与历史裁剪**:`base` 优先取本 run 实测首轮 input,无则退 18.7k。应用层历史裁剪(总体规划 §4.4)上线后 resume 真实增量会**低于** `base×k`,实测外推已自适应捕捉;但裁剪是否引入负增量被 `max(0,…)` 截断后失真,待 M2 实测裁剪曲线后定是否要把裁剪率纳入预测。
- **stateless 的 c 系数 / output 比例 / `BASELINE_OUTPUT_PER_ROUND`**:§6.5 用 c≈1–1.5×base、output≈input 15%,`BASELINE_OUTPUT_PER_ROUND=3000` 为经验值;digest 随轮增长会让 c 缓升。M2 用 `turn.completed.usage` 实测分布校准(reasoning 模型 output 占比更高,3000 地板可能偏低需上调)。
- **resume 长程线性性**:事实 D 只实测到 round2(18755→37645)。N>2 是否严格守 `base×k`,需 M2 长程实测;若超二次,实测外推会滞后一轮(只看相邻两轮增量),必要时升级为带二次项的外推。
- **command evidence 复跑对 stall 灵敏度**:02 §8 抽检复跑比例(默认不跑)影响有多少 command 指纹达"强"从而清零 stall——抽检率与 stall 假阴性的关系待 M2 观测。
- **PlaybookDonePolicy.probe 的 ctx↔board 桥接**:本文件定 `probe: (ctx)=>boolean`,但 `playbook.isDone` 吃 `BoardView`(03 §4.1)。引擎注入时需用闭包桥接(03 §4.3),该桥接的具体形状由 03 定稿确认(本文件只约定 probe 纯读无副作用)。
- **各范式默认配置真值**(§9 表):全部经验起点,M2 实测校准。




