# 21 · 本地 Fusion 评审团剧本(panel + judge 的决策回合变体)

> **版本**:v2(吃掉红队/交叉审查针对本节的 findings)。v2 相对 v1 的实质变更:
> ① **evidence 门收紧为「≥1 强」**(02v2 §3.2/C1):删除全文「强/中」二档措辞与 `hasStrongOrMidEvidence` 命名,统一为「强」;`command` 只有中枢实跑匹配才算强、`file_ref` 须 `quote` 复算一致才算强,`spec_quote`/无 quote 的 file_ref/未实跑 command 均为 weak,不单独解锁 C1(E4 / COV-10)。
> ② **防火墙改用纯函数 `firewallPeerMessage(msg, ctx)`**(08 §4.3 权威),返回 `{action:'pass'|'flag'|'block', wrapped|reason, hits}`;删除 v1 的 `firewall.wrap()` 对象方法与 `ContentFirewall` 形态(E5 / 03 H6)。
> ③ **fan-out 真 spawn 必经 17 `ConcurrencyGovernor`**(per-endpoint 子池,`cls:'panel_member'`),不再只用 `panel.maxConcurrency` 自行扇出;并新增**扇出感知前瞻闸**(启动 panel 前按 (N+1)× 预测拦截)与**单成员/单 turn token 硬上限**(RS-M5 / ROC-M3 / ROC-m6)。
> ④ **Fusion 边界从「按 kind」收紧为「按该 turn 是否产生 worktree 写」**:会声明非空 `files` / `shouldMergeAt` 的 `propose` 即视为执行性发言,**禁 panel**,杜绝 §5.5 静默清空 `files` 吞掉 proposer 改动意图(FEAS-3);`onStart` 等非发言钩子不进 Fusion(FEAS-9)。
> ⑤ evidence 预检显式接 02v2 的 `ValidateContext.capabilities`(M1 (a)/(b) 部署能力),无 fs/sandbox 时强证据不可得,Fusion 门与单 agent 同步降级(FEAS-2)。
> ⑥ trace 文本是 **agent 可控不可信内容**,面板渲染前须转义(RS-B2),流式/落盘前过 redact(RS-M1)。
>
> **本文件地位**:`@sylux/core` 的 **Fusion 执行子模块**权威设计。它实现「一个角色背后站一个评审团(多 provider 并行答)+ 一个裁判(judge 综合)」的**执行算法**与**黑板落地语义**,把裁判产物映射成 critic 要的可核验 evidence,并给出成本模型与「何时值得用」的判据。
>
> **与已锁定文档的分工(焊死 R1,只引用不另写)**:
> - **配置形态**(`PanelProviderConfig` / `PanelMember` / `JudgeConfig` / `enabledKinds` / `members` / `maxConcurrency` / `memberTimeoutMs`)的唯一权威在 **provider 文档(07)§10**(`@sylux/providers/panel.schema.ts`)。本文件**只消费、不重定义**这些 schema。
> - **消息 / 证据类型**(`Message` / `EvidenceItem`(`file_ref`/`command`/`spec_quote`)/ `AgentMessagePayload` / `Role` / `MessageKind` / `AgentId` / `validateMessage` / `ValidateContext`)的唯一权威在 **黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`)。本文件涉及时一律引用。
> - **引擎循环 / Playbook / TurnDirective / PromptContext / runTurn / AgentAdapter 调用契约**的权威在 **引擎文档(03)**。本文件把 Fusion 接成 03 的 `runTurn`(§5.2)的一个**可选执行路径**,不改引擎本体(E1)。
> - **成本与刹车**:累积/超线性 token 模型遵守 `docs/PROBED-FACTS.md` D 节;预算刹车接口引用刹车文档(`04-convergence-brakes.md`,02/03 交叉引用里称「07」,见 §13 编号说明)。
>
> **权威归属修正(需 07 / 03 回填)**:07 §10.1 / §14.2 把「融合/裁判算法」标注为「归引擎 Fusion 子模块(03)」,但 03 未展开。**本文件(21)即该子模块的权威 spec**;07 与 03 涉及 Fusion 执行算法时应引用 21,而非 03(§13 openQuestion)。
>
> **事实标注约定**:凡基于假设而非本机实测的结论显式标注【待实测】;事实地基(PROBED-FACTS / 02 / 03 / 07)已覆盖的不再标。

---

## 0. 设计目标与不变量

### 0.1 一句话定位

Fusion 不是第五种范式,而是**任意范式的「决策回合」可叠加的一种发言执行方式**:把某个**角色**(通常是 `critic` 或 `proposer`)的一次发言,从「单 agent 一次 send」升级为「N 个 provider 并行独立答 → 1 个裁判综合 → 产出一条带可核验 evidence 的黑板消息」。对黑板与对面 agent 而言,这一条消息和单 agent 发的**完全同形**(同 `from`/`role`/`kind`/`evidence` 契约),panel 是该发言**内部的实现细节**。

### 0.2 严格边界(锁定决策 §5 焊死,本文件第一不变量)

Fusion 边界**不是「按 kind 二分」**(v1 的 propose/review/critique/question 都允许),而是**「按该 turn 是否产生 worktree 写」**:

| 发言形态 | 判据 | provider 形态 | worktree | 是否允许 Fusion |
|---|---|---|---|---|
| **纯决策发言** | `kind∈{propose,review,critique,question}` **且** `files` 为空 **且** 该 turn 不触发 `shouldMergeAt` | panel(N 成员并发 + judge) | 成员**只读**,不写文件 | ✅ 允许 |
| **执行/写文件发言** | `kind==='implement'`,**或** `propose` 声明了非空 `files`(03 红蓝 proposer「落代码就在 files 声明改动意图」),**或** 该轮 `shouldMergeAt()` 为真 | **单 agent** | 单 worktree 写(09 隔离) | ❌ **禁止** |
| **非发言生命周期钩子** | `onStart` / `onFinish`(03 §254,`Promise<void>`,不产 `AgentMessagePayload`) | —(物理上无 `runTurn`,挂不了 panel) | — | ❌ **不适用** |

> **为什么按「是否写文件」而非「按 kind」(FEAS-3)**:`implement` 当然写文件;但 `propose` **跨在决策/执行两边**——03 §7.1 的红蓝 `RedBluePlaybook` 让 proposer「能落代码就在 `files` 声明改动意图」且 `shouldMergeAt` 恒真,即**写文件的 propose**。若仍按 kind 把它当「决策回合」放进 panel,§5.5 的 `synthesizePayload` 会强制 `files:[]`,**静默清空 proposer 的改动意图**——引擎拿到空 files 的 propose、worktree 无改动可合、后续 critic 引「最新 worktree 内容」引到旧内容,链路无声断裂。因此判据下沉到「该 turn 是否写文件」:凡声明非空 `files` 或触发合并的发言,即便 kind 是 `propose`,一律走单 agent,**不进 panel**。这条由 §2.1 的 `runTurn` 分流在命中 panel 后**再查一道 files/merge**焊死(不止配置期 enabledKinds)。
>
> **为什么执行回合禁 Fusion**:写文件要落 diff 进 worktree。若 N 个成员并发写,等于 N 个 worktree 同文件互踩,正是引擎 E5 / 红队 R7 要避免的「多 worktree 打架」。
>
> **为什么 onStart 挂不了 Fusion(FEAS-9)**:`onStart(deps): Promise<void>`(03 §254)在循环外调一次,职责是 `loadGoal`/初始化,**返回 void、不产任何 Message**;而 Fusion 全机制(§5)产出的是**一条 `AgentMessagePayload`**,必须挂在「会产一条发言的执行点」= `runTurn`。`parallel` 范式若想「多 provider 并行切分任务线」,那是一个**不产发言**的能力,**不是 Fusion**,应作为 03 `onStart` 内部独立机制设计(产 `PlaybookState` 而非 payload),不走 §5 的 synthesize 链。v1 §2.3 表里「parallel 在 onStart 外挂 panel」一句已删。
>
> 这条边界由三道闸焊死:① 07 §10.2 `panelProviderConfigSchema.superRefine` 拒绝 `enabledKinds` 含 `implement`(配置期);② `runTurn` 命中 panel 后,若该 turn `directive.kindHint==='implement'` **或** `directive` 声明非空 `files` **或** `playbook.shouldMergeAt(round)` 为真,**不走 Fusion**(执行期边界,§2.1);③ `FusionExecutor.run` 再查一次 kind,命中 `implement` 直接抛 `FUSION_KIND_FORBIDDEN`(执行期防御纵深,§9)。

### 0.3 核心不变量(实现必须保持)

- **F1 同形落地**:Fusion 一次发言最终**只产出一条** `AgentMessagePayload`(02 §6.1),经引擎 `runTurn`(03 §5.2)正常 `validateMessage` + `append`。黑板上看不出它是 panel 产的;`from` = 该角色被指派到的物理 agent 槽(`TurnDirective.agent`),panel 成员身份**不进 `Message`**(02 类型已冻结,不得加字段,§7)。
- **F2 引擎本体不动**(E1):fan-out / judge 全部发生在 `runTurn` 调用的**执行层**(`FusionExecutor`),引擎循环(03 §5.1)与 `Playbook` 接口一行不改。是否走 Fusion 由「当前 turn 的 role+kind 是否命中 `PanelProviderConfig.enabledKinds`」决定(07 §10.4)。
- **F3 成员强制无状态**:panel 成员每轮都是**全新 single-shot**(`ContinuityMode='stateless'`,03 §2.1),**绝不**逐成员 resume——否则把事实 D 的累积/超线性成本再乘以 N,成本爆炸(§8)。成员的「记忆」只来自中枢喂的 `goal + digest + delta`(03 §2.2),与单 agent 一致。
- **F4 裁判产可核验 evidence**:judge 的产物必须映射成 02 `EvidenceItem`,且当发言 `kind==='critique'`(或 `role==='critic'`)时,**至少一条 evidence 达到 02v2 §3.2「强」核验通过**(C1)——`file_ref` 须 `quote` 与区间归一化后一致、或 `command` 经中枢沙箱实跑匹配;weak(无 quote 的 file_ref / 未实跑 command / spec_quote)**单独不解锁** C1。否则被 02 §8 打回。空泛分歧(无强锚点)= `EVIDENCE_UNVERIFIABLE`(§6)。
- **F5 裁判级重试,不重跑全 panel**:evidence 不达标时,`FusionExecutor` **内部**优先只重跑 judge(喂回打回理由 + 已有成员答案),≤k 次;**不**重新 fan-out N 成员(那是 N× 成本)。引擎外层 `runTurn` 的 retry(03 §5.2)作为最后兜底,正常不应为 Fusion 触发(§5.4 / §9)。
- **F6 成员间零串扰**:N 个成员拿**相同**上下文**各自独立**作答,成员之间**互不喂对方输出**(既保 panel 多样性,又断成员间注入链,呼应 R8)。串扰只发生在 judge 这一处汇聚,且**成员输出喂 judge 前逐条过 `firewallPeerMessage`**(08 §4.3,见 §5.3:`block` 的成员答案不喂 judge、`flag` 包封套后喂并告警)。
- **F7 成员 provenance 走观测旁路**:谁是哪个 provider、各成员原文、裁判打分等**审计信息**走 panel 专用观测通道(WS / 日志,08/11/15),**不进**权威 `Message`(F1);进 `Message` 的只有裁判**裁定**的 body + 可核验 evidence(evidence 的 `note` 可带成员标签做溯源,但不靠它做控制流)。
- **F8 成本显式**:每次 Fusion 发言成本 ≈ `(N+1) ×` 单回合地板价(§8),引擎/刹车按此计入累积预算(事实 D + 04)。Fusion 默认**只在关键决策回合**启用,不是每轮。
- **F9 fan-out 受全局限流 + 前瞻闸 + 单成员 token 上限**(RS-M5 / ROC-M3 / ROC-m6):成员真 spawn **必经 17 `ConcurrencyGovernor.acquire({cls:'panel_member', endpoint})`**(per-endpoint 子池),`panel.maxConcurrency` 只是「提交意愿」上界,真并发由 governor 端点子池节流——杜绝 panel 一次性扇出 N 路绕过 8 并发 429 顶。启动 panel **之前**先过**扇出感知前瞻**(§8.3:`当前累积 + (N+1)×预测 > 上限` 则削并发或不启动该 panel 轮),把 RS-M5「轮末才停、panel 一轮超支 N 倍」的窗口压掉;每成员/judge 设**单 turn token 硬上限**,`turn.completed.usage` 累计超阈即 cancel 该成员(§8.5)。

---

## 1. 物理落点与边界

### 1.1 包布局(`@sylux/core/src/fusion/`)

```
packages/core/src/fusion/
├─ fusion-executor.ts     # ★ FusionExecutor:fan-out → collect → judge → synthesize(§5)
├─ member-runner.ts       # 单成员 spawn + 超时 + 弃权(§5.2;复用 05/06 adapter + 07 注入)
├─ judge.ts               # judge 调用 + 三策略(synthesize/vote/best_of)+ 裁判级重试(§5.3/§5.4)
├─ evidence-map.ts        # judge 产物 → 02 EvidenceItem 映射 + 充分性预检(§6)
├─ fusion-cost.ts         # (N+1)× 成本模型 + 决策辅助(§8;计价引用 04 cost-model)
└─ types.ts               # 本文件拥有的执行层类型(§3;不含任何 02/07 已有类型)
```

> Fusion 子模块属 `@sylux/core`(与引擎 03 同包)。依赖方向:`core` 依赖 `shared`(02 类型/校验)+ `providers`(07 panel 配置 + `buildAgentProviderInput`)+ `agents`(05/06 adapter 工厂,用于 spawn 成员)+ `security`(08 `firewallPeerMessage`)+ `perf`(17 `ConcurrencyGovernor`)。**不**反向被它们依赖,避免环(遵守 master §10 `shared ← {providers, agents, security, perf} ← core/server`)。`@sylux/security` / `@sylux/perf` 的具体包名以 master §10 落点为准(08 §10 openQuestion 未定时,import 路径合稿统一)。

### 1.2 本文件负责 / 不负责

| 负责(给完整接口 + 算法 + 时序 + 失败路径) | 不负责(只引用) |
|---|---|
| `FusionExecutor` / `PanelTurnRequest` / `PanelTurnResult` 接口 | `PanelProviderConfig`/`PanelMember`/`JudgeConfig` schema → 07 §10 |
| fan-out → collect → judge → synthesize 算法与时序 | `ProviderConfig` / `buildAgentProviderInput` / `KeyStore` → 07 |
| judge 三策略(synthesize/vote/best_of)产物语义 | `AgentAdapter.send/resume` 实现 → 05/06 |
| judge 产物 → `EvidenceItem` 映射 + 充分性预检 | `EvidenceItem` / `validateMessage` / `verifyEvidence` → 02 |
| Fusion 在 `runTurn` 的接入点(执行路径选择) | 引擎循环 / `Playbook` / `PromptContext` 渲染 → 03 |
| `(N+1)×` 成本模型 + 「何时值得用」判据 | 预算阈值 / `BudgetPolicy` / 累积估算 → 04 |
| Fusion 专属失败路径(成员弃权/全挂/judge 失败) | 内容防火墙 / env 白名单 / redact → 08;worktree 隔离 → 09 |
| Fusion 观测旁路的事件形状(供 08/11/15 渲染) | WS 传输协议 / 面板渲染 → 08/11 |

---

## 2. 接入点:Fusion 是 `runTurn` 的一条执行路径(不改引擎)

### 2.1 决策树(引擎 `runTurn` 入口处)

引擎文档 03 §5.2 的 `runTurn(directive, round, deps)` 现状是「渲染 prompt → 选 send/resume → consume → validate → 重试」。Fusion 在**最前面**插一个分流判定,不改后续校验/append 链(F1/F2):

```
runTurn(directive, round, deps):
  ├─ panelCfg = deps.panels.match(directive.role, directive.kindHint)   // 07 §10:role + enabledKinds 命中?
  │
  ├─ if panelCfg 命中 且 isDecisionTurn(directive, round, deps.playbook):
  │     // isDecisionTurn = kindHint∈{propose,review,critique,question}
  │     //                  且 (directive.files 为空)            ← FEAS-3:写文件的 propose 不进 panel
  │     //                  且 !deps.playbook.shouldMergeAt(round) ← 该轮要合并 = 执行性,不进 panel
  │     payload = await deps.fusion.run({ directive, round, panelCfg })  // ★本文件 §5,产出单条 payload
  │     └─ 之后与单 agent 完全相同:validateMessage(payload) → 重试(裁判级,§5.4)→ 返回 TurnResult
  │
  └─ else(无 panel / implement / 写文件 propose / 合并轮):
        走 03 §5.2 原路径(单 adapter.send/resume → consume → validate)
```

> **关键**:Fusion 路径与单 agent 路径**在 `validateMessage` 处汇合**——无论 panel 还是单 agent,产出的都是一条 `AgentMessagePayload`,过同一个 02 §8 守门(E2)。引擎对二者一视同仁。这就是 F1「同形落地」的落地点。
>
> **`isDecisionTurn` 的两道额外判定(v2,FEAS-3)**:仅 `enabledKinds` 命中不够——必须**同时**确认该 turn 不写文件(`directive.files` 空)且不触发本轮合并(`shouldMergeAt(round)===false`)。这样「写文件的 propose」(03 红蓝 proposer)即便 kind 命中,也老实走单 agent,绝不会进 §5.5 被清空 files。`directive.files`(若 `TurnDirective` 暂无该字段)由 03 §3.1 回填一个 `willWriteFiles?: boolean` 标志或由 `playbook` 在 `nextTurn` 时声明(§11 交接);在 03 回填前,Fusion 侧以 `shouldMergeAt(round)` 为保守判据(合并轮一律不 panel)。

### 2.2 `EngineDeps` 的增量(向后兼容,03 §4.3 回填)

03 §4.3 的 `EngineDeps` 需补两个**可选**注入(不破坏现有四范式:无 panel 配置时二者为空,`runTurn` 永远走原路径):

```ts
// 03 §4.3 EngineDeps 增量(可选字段,向后兼容)
export interface EngineDeps {
  // ...(03 §4.3 现有字段:blackboard / adapters / brakes / firewall / worktrees / validate / digest / logger)

  /** 角色→panel 配置查询(07 §10 ProviderSettings.panels 投影);无 panel 配置时 match 恒返回 undefined。 */
  panels?: PanelMatcher;
  /** Fusion 执行器(本文件 §5);仅在 panels 命中时被调用。 */
  fusion?: FusionExecutor;
}

/** 把 ProviderSettings.panels(07)按 role+kind 索引,供 runTurn O(1) 命中判定。 */
export interface PanelMatcher {
  /** 命中返回该 role 的 PanelProviderConfig(07),且 kind ∈ enabledKinds;否则 undefined。 */
  match(role: Role, kind: MessageKind): PanelProviderConfig | undefined;
}
```

> `PanelMatcher` 是 07 `ProviderSettings.panels: PanelProviderConfig[]` 的运行期索引(按 `role` 建表,命中后再查 `enabledKinds`)。它属 `@sylux/core`(消费 07 的配置),实现平凡(Map<Role, PanelProviderConfig>),不在本文件展开 schema。
>
> **不变量**:`deps.fusion` 与 `deps.panels` **要么都注入、要么都不注入**。`panels.match` 命中却没注 `fusion` = 引擎装配 bug,启动期 `assert`(`FUSION_NOT_WIRED`,§9)。

### 2.3 与四范式的关系(谁会用 Fusion)

Fusion 是**配置叠加**,四范式(03 §6)都可启用,典型组合:

| 范式 | 典型 Fusion 用法 | 说明 |
|---|---|---|
| 红蓝对抗 `red-blue` | **critic 角色配 panel**:多 provider 并行找漏洞,judge 把分歧固化成带锚点 critique | 最契合:panel 的价值就是「多视角挑刺 + 裁判去伪存真」,直接喂红队 evidence。**注意 proposer 若写文件(03 红蓝 proposer 声明 files),其 propose 不进 panel**(§0.2),只对**纯决策的 critic** 回合启用 |
| 主从 `master-worker` | **planner 的 review 配 panel**:多 provider 评审 worker 的 implement,judge 综合验收意见 | review 是纯决策回合(不写文件);worker 的 `implement` 仍单 agent(F2 边界) |
| 对等结对 `pair` | **纯决策的 critique/propose 回合配 panel** | 仅当该 propose **不声明 files / 不触发合并**(FEAS-3)时才 panel 化;一旦 proposer 要落代码,该 propose 走单 agent |
| 分工并行 `parallel` | **不适用 Fusion** | parallel 全是 `implement` 执行回合(F2 禁);其「多 provider 切分任务线」若需要,是 `onStart` 内部独立机制(产 `PlaybookState` 不产发言),**不是 Fusion**(FEAS-9,§0.2) |

> 对 `Playbook.nextTurn`(03 §3.3)而言,它**完全不感知** Fusion:它照常返回 `TurnDirective{agent, role, kindHint, promptContext, files?}`。是否 panel 化由 `EngineDeps.panels` 配置 + `runTurn` 分流(含 §0.2「是否写文件」判定)决定,与范式逻辑解耦。这保住 03 的 E1(范式只决定「谁说话/看什么/何时完」,不决定「怎么执行一次发言」)。

---

## 3. FusionExecutor 接口与执行层类型(本文件权威)

### 3.1 输入 PanelTurnRequest / 输出 PanelTurnResult

```ts
import type { AgentMessagePayload, EvidenceItem, Message, MessageKind, Role, AgentId, TokenUsage, AgentEvent } from '@sylux/shared';            // 02 权威类型
import type { ValidateContext } from '@sylux/shared'; // 02 §8.1(含 capabilities)
import type { AgentAdapter } from '@sylux/agents';   // 05/06(只引用:send/cancel)
import type { FirewallContext, FirewallVerdict } from '@sylux/security'; // 08 §4.3(只引用)
import type { ConcurrencyGovernor, EndpointKey, Permit } from '@sylux/perf';     // 17 §2(只引用)
import type { PanelProviderConfig, PanelMember } from '@sylux/providers'; // 07 §10 配置(只引用)
import type { TurnDirective, PromptContext } from './engine.js';         // 03 §3.1(只引用)

/** runTurn 命中 panel 后递给 FusionExecutor 的一次决策回合请求。 */
export interface PanelTurnRequest {
  /** 该回合的发言指令(03 §3.1)。agent = 该角色被指派的物理槽,决定最终 Message.from(F1)。 */
  readonly directive: TurnDirective;
  /** 当前轮号(写入 usage 归集 / 观测事件)。 */
  readonly round: number;
  /** 命中的 panel 配置(07 §10:members / judge / enabledKinds / maxConcurrency / memberTimeoutMs)。 */
  readonly panel: PanelProviderConfig;
}

/** FusionExecutor.run 的产物:与单 agent runTurn 同形的单条 payload + Fusion 专属计量/观测。 */
export interface PanelTurnResult {
  /** ★ 最终落黑板的单条消息载荷(02 §6.1)。与单 agent 完全同形(F1)。 */
  readonly payload: AgentMessagePayload;
  /** 本次 Fusion 总 token(Σ成员 + judge + 裁判级重试;喂 04 累积预算,F8/§8)。 */
  readonly usage: TokenUsage;
  /** Fusion 专属观测(走旁路,不进 Message;供 08/11/15,F7/§10)。 */
  readonly trace: FusionTrace;
  /** 降级标记:成员不足 quorum 时退化为单 agent(§9.2),引擎据此可写 system 备注。 */
  readonly degraded?: FusionDegradeInfo;
}
```

### 3.2 FusionExecutor 接口

```ts
export interface FusionExecutor {
  /**
   * 执行一次 Fusion 决策回合:fan-out N 成员 → collect → judge → synthesize → evidence 预检。
   * 产出单条 payload(F1);成本计量进 usage(F8);成员原文/裁判细节进 trace(F7)。
   * 失败路径见 §9(成员弃权降级 / 全挂 / judge 失败 / kind 禁用)。
   */
  run(req: PanelTurnRequest): Promise<PanelTurnResult>;
}

/** FusionExecutor 的依赖注入(由引擎装配期提供)。 */
export interface FusionDeps {
  /**
   * 按 providerId 建一个【一次性 single-shot】adapter(F3:成员永不 resume)。
   * 复用 05/06 工厂 + 07 buildAgentProviderInput(成员各自的 ProviderConfig key 通路,P2 不破)。
   * 返回值附带该 provider 的 EndpointKey(17 endpointKeyOf),供 governor 端点子池路由(F9)。
   */
  spawnMember(providerId: string): { adapter: AgentAdapter; endpoint: EndpointKey };  // 05/06 + 17
  /** judge 用的 adapter(judge.providerId,07 §10.2;通常强模型官方直连)+ 其 EndpointKey。 */
  spawnJudge(providerId: string): { adapter: AgentAdapter; endpoint: EndpointKey };
  /**
   * ★全进程并发裁决者(17 §2,per-endpoint 子池 + 全局 hardMax)。
   * 成员/judge 真 spawn 前必经 governor.acquire(F9);panel 不绕过它一次性扇出 N 路(17 §8.1)。
   */
  governor: ConcurrencyGovernor;                      // 17(只引用)
  /**
   * 内容防火墙纯函数(08 §4.3 权威):成员输出喂 judge 前逐条过(F6);返回 {action,wrapped|reason,hits}。
   * 删除 v1 的 firewall.wrap()/ContentFirewall 对象形态(E5)。
   */
  firewallPeerMessage: (msg: Message, ctx: FirewallContext) => FirewallVerdict;  // 08(只引用)
  /** 喂给 firewallPeerMessage 的上下文(08 §4.3:toAgent/from-to worktree 根/maxBodyChars)。 */
  firewallCtxFor: (fromAgent: AgentId, toAgent: AgentId) => FirewallContext;
  /**
   * evidence 充分性预检上下文:复算 file_ref(带 quote)/ command 锚点(02 §8.3 verifyEvidence)。
   * 与引擎给 validateMessage 的 ValidateContext 同源(只读 worktree + capabilities),Fusion 内部先验一道(F5/§6.3)。
   * capabilities.fs/sandbox 为假时(M1 (a)/(b) 部署能力,02v2)file_ref/command 一律 weak,Fusion 门与单 agent 同步降级。
   */
  validateCtx: ValidateContext;                       // 02 §8.1(只引用)
  /** 渲染成员/judge prompt(复用 03 §2.3 的 PromptContext→prompt)。 */
  renderPrompt: (pc: PromptContext, member?: PanelMember) => string;
  /** 单成员/单 judge 的 turn 级 token 硬上限(F9/§8.5);累计 turn.completed.usage 超阈即 cancel。 */
  memberTokenCeiling: number;
  /** 给 04 前瞻闸用的「下一轮单成员预测 input」(§8.3)。 */
  predictBaseInputPerRound: () => number;
  logger: Logger;                                     // 脱敏日志(08 redact)
}
```

### 3.3 成员答案 MemberAnswer / 裁判 I/O

```ts
/** 单个 panel 成员的作答结果(收集阶段产物,F6:各自独立)。 */
export interface MemberAnswer {
  readonly providerId: string;
  readonly label?: string;                 // 07 PanelMember.label,如 'gpt-5.5@official'
  readonly weight: number;                 // 07 PanelMember.weight(裁判加权,§5.3)
  /** 成员产出的瘦载荷(02 §6.1);成员也走 output-schema 强制成形(两端不对称,02 §6.2)。 */
  readonly payload?: AgentMessagePayload;  // 弃权/超时/解析失败时为 undefined
  readonly usage?: TokenUsage;
  /** 作答状态:ok(有效) / timeout(超时弃权) / error(spawn/解析/token 上限) / abstain(产出空)。 */
  readonly status: 'ok' | 'timeout' | 'error' | 'abstain';
  readonly latencyMs: number;
  readonly detail?: string;                // status≠ok 时的原因(脱敏;含 MEMBER_TOKEN_CEILING)
  /** buildJudgeInput 过 firewallPeerMessage 后回填的封套文本(喂 judge 用;F6)。 */
  readonly wrappedBody?: string;
}

/** 喂给裁判的输入:共享上下文摘要 + 全部有效成员答案(F6:成员间不互喂,只在此汇聚)。 */
export interface JudgeInput {
  readonly role: Role;                     // 本回合角色(影响 judge 产出 kind:critic→critique)
  readonly expectedKind: MessageKind;      // 期望产出类型(02 MessageKind)
  readonly goal: string;                   // 任务目标(03 PromptContext.goal)
  readonly digest: string;                 // 旧轮压缩结论(03,省 token)
  readonly delta: readonly Message[];      // 本轮增量(对面上一条等;引擎已过 firewallPeerMessage)
  readonly answers: readonly MemberAnswer[]; // 仅 status==='ok' 且未被防火墙 block 的成员答案(带 wrappedBody)
  readonly strategy: JudgeConfig['strategy']; // 07:synthesize | vote | best_of
  readonly emitDivergenceEvidence: boolean;   // 07 JudgeConfig
  readonly judgeProviderId: string;        // 07 panel.judge.providerId(spawnJudge + endpoint 路由)
  readonly runId: string;                  // governor.acquire / 计量归属
  readonly signal: AbortSignal;            // 等许可期间 abort 放弃排队(17)
  /** 裁判级重试时回灌的上次打回理由(§5.4;仅由已核验锚点拼成,无 peer 自由文本,不必再过防火墙)。 */
  readonly rejectFeedback?: string;
}

/** 裁判产出(经 output-schema 强制;evidence-map §6 据此造最终 payload)。 */
export interface JudgeOutput {
  /** 裁定后的自然语言主体(共识 + 矛盾 + 盲点;synthesize 策略,§5.3)。 */
  readonly body: string;
  /** 裁判裁定的可核验证据(将映射成 02 EvidenceItem,§6;critique 须 ≥1 强,F4)。 */
  readonly evidence: EvidenceItem[];
  /** 裁判建议的最终 kind(通常 = expectedKind;裁判可降级,如 critique→question 见 §5.3)。 */
  readonly kind: MessageKind;
  /** 可选:best_of 策略下选中的成员 providerId(溯源,进 trace 不进 Message)。 */
  readonly pickedMemberId?: string;
  readonly usage?: TokenUsage;
}
```

### 3.4 观测 trace 与降级信息(走旁路,F7)

```ts
/** Fusion 观测旁路事件(WS/日志;绝不进权威 Message,F7/§10)。 */
export interface FusionTrace {
  readonly panelId: string;
  readonly round: number;
  readonly role: Role;
  readonly memberCount: number;
  readonly okCount: number;                // status==='ok' 成员数
  /** 各成员摘要(脱敏:provider label + status + latency + 是否被裁判采纳;不含 key,body 截断) */
  readonly members: readonly {
    providerId: string; label?: string; status: MemberAnswer['status'];
    latencyMs: number; adopted: boolean; bodyPreview: string;
  }[];
  readonly strategy: JudgeConfig['strategy'];
  readonly judgeRetries: number;           // 裁判级重试次数(§5.4)
  readonly totalUsage: TokenUsage;
}

export interface FusionDegradeInfo {
  /** 降级原因:成员有效数 < quorum,退化为单 agent(§9.2)。 */
  readonly reason: 'below_quorum' | 'judge_failed';
  readonly okCount: number;
  readonly quorum: number;
  /** 降级后实际由哪个 agent 单独作答(= directive.agent)。 */
  readonly fallbackAgent: AgentId;
}
```

---

## 4. 端到端时序(一次 Fusion 决策回合)

```
引擎 runTurn(directive: {agent:claude, role:critic, kindHint:critique}, round=3)
  │ panels.match('critic','critique') 命中 PanelProviderConfig{members:[gpt55@official, gpt55@mouubox, claude-opus@official], judge:claude-opus@official}
  ▼
FusionExecutor.run(req)
  │
  ├─ 0. 前置闸:kind∈{propose,review,critique,question}? 否→抛 FUSION_KIND_FORBIDDEN(§0.2/§9)
  │     (会写文件的 propose / 合并轮已在 runTurn §2.1 分流挡掉,根本不进这里)
  │
  ├─ 0'. 扇出感知前瞻闸(§8.3):当前累积 + (N+1)×预测 > 预算上限? 是→削并发或不启 panel(交 04)
  │
  ├─ 1. fan-out(并发,governor 端点子池限流 F9,F3 成员 stateless single-shot)
  │      每成员 spawn 前 await governor.acquire({cls:'panel_member', endpoint=endpointKeyOf(member)})
  │      ├─ member[gpt55@official]  ← acquire(ep:resp:api.openai.com) → spawnMember → send(goal+digest+delta+roleBrief)
  │      ├─ member[gpt55@mouubox]   ← acquire(ep:resp:api.mouubox.com) → 同上(各自 ProviderConfig key 通路,07 P2)
  │      └─ member[claude@official] ← acquire(ep:anthropic:api.anthropic.com) → 同上
  │      每成员:memberTimeoutMs 超时→timeout 弃权;token 累计>memberTokenCeiling→cancel(error);output-schema 强制(02 §6.2)
  │      finally: permit.release()(归还端点子池+全局计数)
  │
  ├─ 2. collect(到齐 / 超时截止)
  │      okCount = Σ(status==='ok')
  │      ├─ okCount < quorum(默认 2)→ 降级:退化为单 agent(directive.agent 正常 send,§9.2),return degraded
  │      └─ okCount ≥ quorum → 继续
  │
  ├─ 3. judge(单次,F6 唯一汇聚点;buildJudgeInput 内成员答案逐条过 firewallPeerMessage 后喂 judge)
  │      JudgeInput{role,expectedKind,goal,digest,delta,answers(仅 ok,带 wrappedBody),strategy,judgeProviderId,...}
  │      → governor.acquire(judge endpoint) → spawnJudge → send → JudgeOutput{body, evidence[], kind, pickedMemberId?}
  │
  ├─ 4. evidence 充分性预检(§6.3,Fusion 内部先验,F5;门=「≥1 强」02v2)
  │      hasStrongEvidence(evidence, validateCtx)  // 02v2 §8.3 复算:file_ref 带 quote / command 实跑
  │      ├─ critique/critic 且 无强证据通过 → 裁判级重试(§5.4):只重跑 judge,回灌已核验强锚点,≤k 次
  │      └─ 通过(或非 critique 无需 evidence)→ 继续
  │
  ├─ 5. synthesize payload(F1 同形)
  │      payload = { kind: judgeOut.kind, body: judgeOut.body, files: [](决策回合不写文件,§0.2),
  │                  evidence: mappedEvidence, inReplyTo: directive 对应的对面消息 id }
  │      usage = Σ成员 + judge + 重试;trace = 成员摘要 + 裁判细节(F7)
  │
  ▼ return PanelTurnResult{payload, usage, trace}
  │
引擎 runTurn 续:validateMessage(payload, ctx)  // 02 §8 守门(与单 agent 同)
  ├─ ok → append(from:claude, role:critic, round:3, payload)  // F1:from=槽位 agent
  └─ !ok(极少,预检已挡)→ 03 §5.2 外层 retry 兜底(§5.4)
```

> **时间预算**:Fusion 一次发言的墙钟 ≈ `max(成员延迟)`(并发)`+ judge 延迟 + 重试`。比单 agent 慢一个 judge 往返 + 落后成员的尾延迟(被 `memberTimeoutMs` 截断)。这是 Fusion 的**延迟代价**,与 §8 的 token 代价并列,是「何时值得用」(§7)的输入。

---

## 5. FusionExecutor.run 算法(逐阶段伪代码)

### 5.1 主流程

```ts
export function createFusionExecutor(deps: FusionDeps): FusionExecutor {
  return {
    async run(req: PanelTurnRequest): Promise<PanelTurnResult> {
      const { directive, round, panel } = req;
      const kind = directive.kindHint;

      // 0. 边界闸(执行期防御纵深,呼应 07 §10.2 配置期闸,F2/§0.2)
      if (!DECISION_KINDS.has(kind)) {
        throw new SyluxError('FUSION_KIND_FORBIDDEN',
          `Fusion 不可用于 ${kind}(仅决策回合 ${[...DECISION_KINDS]});implement 必须单 agent`);
      }

      // 1+2. fan-out 并发 + 收集(governor 端点子池限流 F9,memberTimeoutMs/token 上限截断)
      const answers = await fanOutMembers(panel, directive, round, deps); // §5.2
      const ok = answers.filter((a) => a.status === 'ok');
      const quorum = panel.maxConcurrency ? Math.min(2, panel.members.length) : 2; // 默认 2(§9.2)

      // 2'. 不足 quorum → 降级单 agent(不浪费已得答案:挑权重最高的 ok 成员答案直接用;全无则真退单 agent)
      if (ok.length < quorum) {
        return await degradeToSingleAgent(req, answers, deps); // §9.2
      }

      // 3. judge(单次汇聚,F6;成员答案逐条过 firewallPeerMessage 后才喂 judge)
      let judgeOut = await runJudge(buildJudgeInput(panel, directive, ok, deps), deps); // §5.3

      // 4. evidence 充分性预检 + 裁判级重试(F5/§5.4/§6.3;门=「≥1 强」,02v2)
      let retries = 0;
      const needStrongEvidence = directive.role === 'critic' || judgeOut.kind === 'critique';
      while (needStrongEvidence && !hasStrongEvidence(judgeOut.evidence, deps.validateCtx)) {
        if (retries >= JUDGE_MAX_RETRY) break; // 兜底:k 次仍不达标→交外层(§5.4 末)
        retries++;
        // 回灌素材【仅由 verifyEvidence=pass 的结构化锚点拼成】,不含成员自由 body 文本,
        // 故无 peer 注入向量(同 03 H5 digest 约束),不必再过 firewall(§5.4)。
        const fb = buildEvidenceRejectFeedback(judgeOut, ok, deps.validateCtx);
        judgeOut = await runJudge(
          { ...buildJudgeInput(panel, directive, ok, deps), rejectFeedback: fb }, deps);
      }

      // 5. synthesize payload(F1 同形)+ 计量 + trace
      const payload = synthesizePayload(directive, judgeOut);     // §5.5
      const usage = sumUsage(ok, judgeOut, /*retriesUsage 已并入*/);
      const trace = buildTrace(panel, round, directive.role, answers, judgeOut, retries);
      return { payload, usage, trace };
    },
  };
}

const DECISION_KINDS = new Set<MessageKind>(['propose', 'review', 'critique', 'question']);
const JUDGE_MAX_RETRY = 2 as const; // 裁判级重试上限(F5;不重跑成员)
```

### 5.2 fan-out 成员(并发 + 限流 + 超时弃权)

```ts
async function fanOutMembers(
  panel: PanelProviderConfig, directive: TurnDirective, round: number, deps: FusionDeps,
): Promise<MemberAnswer[]> {
  const limit = panel.maxConcurrency ?? panel.members.length; // 提交意愿上界(07 §10.2)
  // 成员共享同一上下文(F6:相同 goal/digest/delta,各自独立答;成员间不互喂)
  const basePc = directive.promptContext;                     // 03 §2.2,continuity 强制 stateless(F3)
  // ★F9:limit 只是「提交意愿」;真并发由 17 governor 端点子池决定(同 host 成员共享子池,
  //   异端点成员各走各的子池)。governor 同时满足「端点子池有空位 + 全局 hardMax 未满」才放行。
  return await mapWithConcurrency(panel.members, limit, async (member): Promise<MemberAnswer> => {
    const t0 = now();
    const { adapter, endpoint } = deps.spawnMember(member.providerId); // 一次性 single-shot(F3)+ EndpointKey
    let permit: Permit | undefined;
    try {
      // ★必经 governor:panel 成员入端点子池排队,不绕过(17 §8.1)。等许可期间 run 被 abort → 放弃。
      permit = await deps.governor.acquire({
        cls: 'panel_member', endpoint, runId: basePc.runId, agent: directive.agent,
        signal: basePc.signal,
      });
      // 成员 roleBrief:与单 agent 同角色,但点明「你是评审团一员,独立作答,给可核验锚点」
      const prompt = deps.renderPrompt(withMemberBrief(basePc, directive.role), member);
      const stream = adapter.send(buildMemberInput(prompt));   // 05/06;永不 resume(F3)
      // 双重截断:墙钟 memberTimeoutMs 与 token 上限 memberTokenCeiling(F9)先到者为准
      const parsed = await consumeWithTimeoutAndTokenCeiling(
        stream, panel.memberTimeoutMs, deps.memberTokenCeiling, deps); // 02 §6.3 + 超时 + token 闸
      if (parsed.kind === 'timeout') return mk(member, 'timeout', t0);
      if (parsed.kind === 'token_ceiling') return mk(member, 'error', t0, 'MEMBER_TOKEN_CEILING');
      if (parsed.kind === 'spawn_failed' || !parsed.payload) return mk(member, 'error', t0, parsed.detail);
      if (isEmptyAnswer(parsed.payload)) return mk(member, 'abstain', t0);
      return { providerId: member.providerId, label: member.label, weight: member.weight,
               payload: parsed.payload, usage: parsed.usage, status: 'ok', latencyMs: since(t0) };
    } catch (e) {
      return mk(member, 'error', t0, String((e as Error)?.message ?? e));
    } finally {
      permit?.release();                                       // 务必归还端点子池 + 全局两处计数(17)
    }
  });
}
```

> **F3 焊死**:成员 adapter 一律 `send`(全新会话),**没有** resume 分支。成员的连续性全靠 `basePc.digest`(03 省 token 模型)。这把 Fusion 的 per-member 成本钉在「单回合地板价」(事实 D 基线 ≈18.7k codex / claude 更低),不随轮数对单成员累积——累积只发生在中枢维护的 digest 上,与单 agent 一致(§8)。
>
> **F9 焊死(并发不绕 governor)**:每个成员 spawn 前 `await deps.governor.acquire({cls:'panel_member', endpoint})`(17 §2)。`panel.maxConcurrency` 与 `mapWithConcurrency` 只限「同时**发起** acquire 的数量」,真正的 spawn 许可由 governor **端点子池**给——3 个成员若都打 `responses:api.mouubox.com`,共享该端点 `capacity`(默认 2),第 3 个排队,**不会**一次性 3 路打爆中转触 429(RS-M5/ROC-M3)。异端点成员(如 2 codex@mouubox + 1 claude@official)各走各的子池,互不串行。`priority` 默认 `panel_member`=1,**低于** `turn`=0——正常单 agent turn 抢得过 panel 成员,panel 不饿死正常回合(17 §2.2)。
>
> **F6 焊死**:`fanOutMembers` 给每个成员的 `prompt` 由**同一** `basePc` 渲染,成员**看不到彼此**的输出。唯一汇聚在 §5.3 的 judge。`memberTimeoutMs` 到点或 `memberTokenCeiling` 超阈的成员标弃权,**不阻塞** judge(到齐 ok 的就开裁,07 §10.2「成员超时弃权,裁判用到齐的部分」)。

### 5.3 judge 三策略(synthesize / vote / best_of)

裁判把 N 份成员答案综合成一份。三策略(07 §10.2 `JudgeConfig.strategy`)的产物语义:

| 策略 | 何时用 | judge 产出 | evidence 来源 | kind |
|---|---|---|---|---|
| `synthesize`(默认) | critic 找漏洞 / 综合多视角 | **共识 + 矛盾 + 盲点**三段式 body | 每个矛盾点/盲点必带 ≥1 成员给的可核验锚点(F4) | `critique`(分歧实质)/ `review`(评审)/ `propose`(综合方案) |
| `vote` | 离散选项决策(选 A 还是 B) | 加权多数票结论 + 票型分布 | 多数派所引锚点(同一锚点多成员独立指向→可信度高) | 多 `propose`/`review` |
| `best_of` | 选最佳单份(成员答案质量差异大) | **选中成员答案原样** + 裁判选择理由 | 选中成员的锚点(`pickedMemberId` 进 trace,§3.3) | = 选中成员的 kind |

```ts
async function runJudge(input: JudgeInput, deps: FusionDeps): Promise<JudgeOutput> {
  const { adapter, endpoint } = deps.spawnJudge(input.judgeProviderId); // 07 panel.judge.providerId
  // judge prompt:把 N 份成员答案【已在 buildJudgeInput 过 firewallPeerMessage】列为带封套素材
  const prompt = buildJudgePrompt(input); // §5.3.1(input.answers 已是防火墙 wrapped 文本)
  let permit: Permit | undefined;
  try {
    permit = await deps.governor.acquire({ cls: 'panel_member', endpoint,
      runId: input.runId, signal: input.signal }); // judge 也经 governor(F9;judge 端点单独计子池)
    const stream = adapter.send(buildJudgeInputPayload(prompt)); // judge 也走 output-schema 强制(02 §6.2)
    const parsed = await consumeWithTimeoutAndTokenCeiling(
      stream, JUDGE_TIMEOUT_MS, deps.memberTokenCeiling, deps);
    if (parsed.kind !== 'parsed' || !parsed.payload) {
      throw new SyluxError('FUSION_JUDGE_FAILED', `裁判未产出有效结果: ${parsed.detail ?? ''}`);
    }
    return {
      body: parsed.payload.body,
      evidence: parsed.payload.evidence,
      kind: parsed.payload.kind,
      pickedMemberId: extractPickedMember(parsed.payload), // best_of:从 judge 结构化输出读
      usage: parsed.usage,
    };
  } finally {
    permit?.release();
  }
}

/** 组装 JudgeInput:成员答案逐条过 firewallPeerMessage(F6 唯一汇聚点防注入)。 */
function buildJudgeInput(
  panel: PanelProviderConfig, directive: TurnDirective, ok: MemberAnswer[], deps: FusionDeps,
): JudgeInput {
  const fwCtx = deps.firewallCtxFor(directive.agent, /*judge as*/ directive.agent);
  const safeAnswers = ok.flatMap((a) => {
    // 把成员瘦载荷包成 Message 形过防火墙;block 丢弃该成员、flag 仍用 wrapped 并告警
    const asMsg = answerToPeerMessage(a, directive);
    const v = deps.firewallPeerMessage(asMsg, fwCtx);
    if (v.action === 'block') { deps.logger.warn('panel member blocked by firewall', { providerId: a.providerId, reason: v.reason }); return []; }
    if (v.action === 'flag')  deps.logger.warn('panel member flagged', { providerId: a.providerId, hits: v.hits });
    return [{ ...a, wrappedBody: v.wrapped }];
  });
  return { /* role/expectedKind/goal/digest/delta/strategy/emitDivergenceEvidence */
           ...projectPanelInput(panel, directive), answers: safeAnswers,
           judgeProviderId: panel.judge.providerId, runId: directive.promptContext.runId,
           signal: directive.promptContext.signal };
}
```

> **F6 在 judge 入口处兑现**:成员答案在 `buildJudgeInput` 里逐条 `firewallPeerMessage`(08 §4.3)——`block` 的成员**不进 judge**(其注入 body 既不喂裁判也不喂对面);`flag` 的包 `<<<SYLUX_PEER_DATA…>>>` 封套后喂 judge 并告警 + 计红队无效发言。这是成员→judge 这唯一汇聚处的注入闸,与 03 §2.3 对 `delta` 的 firewall 同源同函数(E5)。

#### 5.3.1 judge prompt 骨架(共识/矛盾/盲点 → 02 evidence 形)

```
[GOAL]    input.goal
[DIGEST]  input.digest
[ROLE]    你是裁判(judge)。下面是 N 位独立评审对同一问题的作答(各自独立,未互相参考)。
          你的职责不是附和多数,而是:
          1) 提炼【共识】:多位评审一致指出且有可核验锚点支撑的结论;
          2) 暴露【矛盾】:评审之间冲突的判断 —— 每条矛盾必须落到具体 file_ref(带 quote 行区间)或
             command(可复跑命令 + 期望),空泛分歧不计;
          3) 标记【盲点】:仅个别评审注意到、但有可核验锚点的关键点。
          产出一条 ${input.expectedKind};若 role=critic,则你的结论本身就是一条 critique,
          其 evidence 至少一条必须达到「强」核验(02v2:file_ref 带 quote 且复算一致,或 command 可被中枢实跑匹配),否则会被打回。
[INPUT]   delta 各 Message(引擎已过 firewallPeerMessage,wrapped 封套)
[PANEL]   ── 评审 1 (${label}) ──   ${answers[0].wrappedBody}  (已过防火墙封套)
          ── 评审 2 (${label}) ──   ...
          (rejectFeedback 存在时追加:[上次被打回] ${rejectFeedback},请从下列已核验锚点中选用)
[TASK]    按 ${strategy} 策略产出,满足 output schema(02 §6.1):{kind, body, evidence, files=[]}
```

> **裁判可降级 kind(诚实优先)**:若裁判发现成员们的「分歧」全都给不出**强**可核验锚点(只有口水或仅 spec_quote/无 quote 引用),它**有权**把产出从 `critique` 降级为 `question`(02 MessageKind)——「我无法核实这些分歧,请 proposer 澄清 X」。`question` 不触发 02 C1 的 evidence 强制(02 §5.2),避免 Fusion 被迫编造锚点凑数(这正是 F4 的反面保护:宁可降级提问,不可空泛 critique 蒙混)。这是 Fusion 对「panel 只会附和」失败模式的内建对冲(§7.3)。

### 5.4 裁判级重试(F5:不重跑成员)

evidence 预检(§6.3)不达标时,**只重跑 judge**,把已有成员答案 + 打回理由再喂一次,**不**重新 fan-out N 成员:

```
evidence 预检失败(critique 无【强】锚点,§6.3 hasStrongEvidence=false)
  → buildEvidenceRejectFeedback(judgeOut, ok, ctx): 【只】列出成员 evidence 里
     verifyEvidence==='pass' 的强锚点(结构化短引用,非成员 body 散文),
     或在无强锚点时提示「改发 question,勿硬凑」。
  → (无需 firewallPeerMessage:回灌素材仅由已核验结构化锚点拼成,无 peer 自由文本,
     无注入向量;同 03 H5 digest「只从结构化已校验 evidence 生成」约束)
  → runJudge({...sameInput, rejectFeedback: fb})    // 复用同一批 ok 成员答案,成本只 +1 judge
  → 至多 JUDGE_MAX_RETRY(=2)次;仍不达标 → 返回当前 judgeOut,交引擎外层 runTurn(03 §5.2)
     的 validateMessage 兜底(那里会打 EVIDENCE_UNVERIFIABLE 并按 03 §5.2 处理)
```

成本对比(为什么裁判级重试是必须的):

| 重试策略 | 单次重试成本 | 说明 |
|---|---|---|
| 重跑全 panel(❌ 不采用) | `(N+1) ×` 地板价 | N 成员重答 + judge 重裁,成本爆炸 |
| **裁判级(✅ F5)** | `1 ×` judge | 成员答案是「素材」,素材没变没必要重采;只让裁判重新组织 evidence |

> 依据:成员答案里**通常已含可核验锚点**(成员 roleBrief 已要求给 file_ref/command);evidence 不达标多是**裁判综合时没把锚点带上**,而非素材本身缺锚点。所以重跑裁判(让它「把成员给的锚点带进来」)比重跑成员高效得多。只有当**所有成员都没给任何可核验锚点**时,裁判才应走 §5.3 的 `question` 降级而非硬凑。

### 5.5 synthesize payload(F1 同形落地)

```ts
function synthesizePayload(directive: TurnDirective, j: JudgeOutput): AgentMessagePayload {
  return {
    kind: j.kind,                       // 裁判裁定(通常=expectedKind;可降级 question,§5.3)
    body: j.body,                       // 共识/矛盾/盲点三段(synthesize)或选中答案(best_of)
    files: [],                          // ★决策回合不写文件(§0.2);files 恒空,杜绝 panel 改文件
    evidence: j.evidence,               // §6 映射后的 02 EvidenceItem[](critique 须 ≥1 强,F4)
    inReplyTo: pickInReplyTo(directive),// 指向本回合回应的对面消息(02 §5,构造对话树)
  };
}
```

> `files: []` 是硬约束:Fusion 决策回合**永不**声明文件改动(F2/§0.2)。即便成员/裁判在 body 里建议「改 X 文件」,那也只是**建议**,真正的 `implement`(落 diff)由后续单 agent 执行回合做。这从 payload 构造层焊死「panel 不写文件」。

---

## 6. judge 产物 → critic evidence 映射(02 收口,锁定决策 §5)

### 6.1 映射表(裁判产物 → 02 `EvidenceItem`)

锁定决策:**裁判的「共识/矛盾/盲点」正好是 critic 要的 evidence**。映射严格用 02 的三种 `EvidenceItem`(`file_ref`/`command`/`spec_quote`),**不新增证据类型**:

| 裁判/成员产出 | 映射到 02 `EvidenceItem` | 核验强度(02v2 §3.2) | note 溯源 |
|---|---|---|---|
| 多评审一致指向某文件区间(**带 quote**) | `file_ref{path,lineStart,lineEnd,quote}`(contentHash 中枢派生) | **强**(中枢重读区间 + quote 归一化复算一致,02 §8.3) | `note: "评审 1,3 一致"` |
| 评审指向文件区间但**无 quote** | `file_ref` 无 quote | **weak**(仅定位,无内容断言可比;不单独解锁 C1) | `note: "仅定位"` |
| 评审给出复现命令 + 期望(**且中枢实跑匹配**) | `command{cmd,expected,actual,matchMode,exitCode?}` | **强**(中枢沙箱实跑,真实 stdout/exit 匹配,02 §8.3) | `note: "评审 2 复现"` |
| 评审命令**未被中枢实跑**(仅 agent 自报 actual) | `command` 未实跑 | **weak**(H2:不取信自报;不单独解锁 C1) | `note: "自报未复跑"` |
| 评审引规范/需求条款 | `spec_quote{source,quote,locator?}` | **weak**(来源可达,默认不计 stall,04 §4.2) | `note: "评审 3 引规范"` |
| 裁判合成的**分歧报告** | 上述多条组成的 `critique` 消息 evidence[] | **至少 1 条强**(F4/02v2 C1) | 整条消息即分歧固化 |

> **v2 收紧(E4/COV-10)**:02v2 已把 critic/critique 的 evidence 门从 v1「强或中」收紧为「**≥1 条强**」。所谓「强」只有两类:① `file_ref` **带 quote 且中枢重读区间归一化复算与 quote 一致**;② `command` **被中枢沙箱实跑且 matchMode 下匹配**。无 quote 的 file_ref、未实跑的 command、spec_quote 都是 **weak**,可以存在、可入指纹,但**单独不解除** C1(堵死「空泛引规范」「自报命令输出」的自证绕过 H2)。本文件已删除全部「强/中」二档措辞。

> **evidence 的 `note` 字段(02 §3 `file_ref.note` optional)**用于成员溯源(「这条锚点来自评审几」),但它**不参与核验、不参与指纹**(02 §9.2:`fingerprint` 对 file_ref 不含 note)。这与 F7 一致:成员 provenance 是观测/可读信息,不进控制流、不影响 stall 差集。

### 6.2 为什么 Fusion 天然产「可机器核验」的 critique(panel 的真正价值)

panel 的价值**不是**「多个模型投票附和」(那只是更贵的单 agent),而是:

1. **多视角暴露分歧**:N 个独立 provider 对同一代码/方案的判断分歧,本身就是「值得 critic 关注的点」的高信号来源。
2. **裁判把分歧固化成锚点**:judge 的职责(§5.3.1 prompt)是把「评审 A 说这里有 bug、评审 B 说没有」固化成**指向具体行/命令**的 evidence,而非停留在口水。
3. **02 §8 强校验兜底**:映射出的 critique 喂 `validateMessage`(02 §8),空分歧(无可核验锚点)→ `EVIDENCE_UNVERIFIABLE` 打回(§6.3 预检先挡一道,F5)。**逼** panel 给实证,而非附和。

> 一句话:Fusion 把「多模型的分歧」转化成「可机器核验的 evidence」,而 02 的校验层保证这种转化不掺水。这是 07 §10.3 的算法落地。

### 6.3 evidence 充分性预检(Fusion 内部先验,F5)

引擎外层 `validateMessage`(02 §8)是最终守门,但 Fusion **内部先验一道**,目的是把「不达标」在**裁判级重试**(§5.4,便宜)里解决,而不是丢给外层 `runTurn` retry(那可能重跑整个 panel,贵):

```ts
/** 预检:critique/critic 是否有 ≥1 条【强】evidence 复算通过(复用 02v2 §8.3 verifyEvidence)。 */
function hasStrongEvidence(evidence: EvidenceItem[], ctx: ValidateContext): boolean {
  return evidence.some((e) => {
    if (e.kind === 'spec_quote') return false;        // weak,不解锁(02v2 §3.2)
    return verifyEvidence(e, ctx) === 'pass';         // 'pass'=强:file_ref 带 quote 复算一致 / command 实跑匹配
  });                                                  // 'weak'/'fail' 都不满足 C1
}

/**
 * 重试回灌素材:【只】从成员/judge 已有 evidence 里 verifyEvidence==='pass' 的强锚点拼成,
 * 不含成员自由 body 文本 → 无 peer 注入向量(同 03 H5 digest 约束),故不必再过 firewallPeerMessage。
 */
function buildEvidenceRejectFeedback(
  j: JudgeOutput, ok: MemberAnswer[], ctx: ValidateContext,
): string {
  const usableAnchors = ok.flatMap((a) => a.payload?.evidence ?? [])
    .filter((e) => e.kind !== 'spec_quote' && verifyEvidence(e, ctx) === 'pass')
    .map(anchorToShortRef); // 'src/a.ts:10-20' / 'cmd: npm test → contains "0 failing"'
  return usableAnchors.length > 0
    ? `你产出的 critique 无一条达到「强」核验。成员答案里这些锚点已被中枢复算通过,请选用:\n${usableAnchors.join('\n')}`
    : `成员答案里没有任何可被中枢复算通过的强锚点。请改发 question(诚实提问),不要硬凑 critique(§5.3)。`;
}
```

> **边界一致性**:预检用的 `verifyEvidence` / `ValidateContext` 与引擎给 02 §8 的**同源**(同一 worktree 只读句柄 + 同一 `capabilities`,02 §8.1)。所以「预检通过」⇒「外层 validateMessage 的 evidence 校验也通过」(同算法同输入)。预检挡掉的,正是外层会打回的;预检放过的,外层不会因 evidence 再打回。这保证 §5.4「仍不达标→交外层兜底」是**极少**触发的真兜底,而非常规路径。
>
> **能力门同步降级(M1 (a)/(b),FEAS-2)**:`verifyEvidence` 受 `ctx.capabilities.fs/sandbox` 闸控(02v2 §8.3 H13)。M1 (a) 部署若**无文件系统**,`file_ref` 一律降 weak;**无沙箱**则 `command` 一律降 weak——此时 panel 与单 agent **同步**无法产强证据,critic 门按 02 §8 的部署裁决统一降级(02 §747:M1 必须先确认走 (a)/(b) 哪种能力),Fusion **不**自创一套绕过。Fusion 不引入新的能力假设,完全继承 `validateCtx` 的能力声明。
>
> **非 critique 回合**:`role≠critic` 且 `kind∈{propose,review,question}` 时无 evidence 强制(02 §5.2 仅 C1/C2 挂 critic/critique/ack),预检直接放行,judge 不被强制造锚点。

---

## 7. 何时值得用 Fusion(成本/收益判据)

### 7.1 一句话原则

Fusion 的成本是单 agent 的 `(N+1)×`(§8),且叠加事实 D 的累积曲线。因此**只在「一次决策的质量足够重要、值得付 N+1 倍」的关键回合用**,绝不每轮用。

### 7.2 值得 / 不值得对照

| 场景 | 用 Fusion? | 理由 |
|---|---|---|
| 架构/方案的**首个 propose**(起手定调,错了后面全返工) | ✅ 值得 | 一次高质量起手省后续多轮返工;`best_of`/`synthesize` 选最优方案 |
| 关键 **review/验收**(主从范式 planner 验收核心子任务) | ✅ 值得 | 多视角验收降低漏检;judge 综合验收意见 |
| 高风险 **critique**(安全/正确性敏感,单模型易漏) | ✅ 值得 | 多 provider 互补盲区,分歧即高信号(§6.2) |
| 长程辩论的**每一轮** critique | ❌ 不值得 | 每轮 (N+1)× 叠加事实 D 累积 = 成本爆炸(§8.3);用单 agent critic + 偶尔 panel |
| `implement` 执行回合 | ❌ **禁止** | F2/§0.2 硬边界,不是成本问题是正确性问题 |
| 简单/低风险决策 | ❌ 不值得 | 单 agent 足够,panel 的边际收益 < (N+1)× 成本 |
| 成员 provider 高度同质(同模型同 base_url) | ⚠️ 收益低 | 同质 provider 分歧少,panel 退化为「更贵的单 agent」;成员应**异质**(不同模型/不同 provider)才有融合价值 |

### 7.3 红队视角:Fusion 的失败模式与对冲(对抗性自检)

| 失败模式 | 风险 | 本设计的对冲 |
|---|---|---|
| **附和共识**:N 成员都附和,panel 只是更贵的单 agent | 付了 N× 成本没买到多样性 | ① 成员应异质配置(§7.2 末);② judge prompt 明确「不是附和多数,是提炼共识+暴露矛盾+标盲点」(§5.3.1);③ §8.4 监控 `okCount` 与「采纳分歧数」,长期无分歧→建议关 panel |
| **空泛分歧**:成员吵但都给不出锚点 | critique 无可核验 evidence,被 02 打回,白烧 token | ① 成员 roleBrief 强制给锚点;② §5.4 裁判级重试逼裁判带锚点;③ 仍不达标→裁判降级 `question`(§5.3),诚实提问而非硬凑 |
| **裁判独裁**:judge 自己的偏见盖过成员证据 | panel 沦为「judge 的单模型意见」 | judge evidence 必须**源自成员给的锚点**(§5.4 重试 prompt 明确「从成员锚点中选用」),裁判不能凭空造锚点(造的过不了 §6.3 复算) |
| **成本失控**:误在长程每轮开 panel | 事实 D × (N+1) 爆炸 | ① 默认只在关键回合(`enabledKinds` 收窄,07 §10.5);② §8 成本前瞻,Fusion 回合按 (N+1)× 计入 04 预算前瞻刹车 |
| **延迟尾部**:慢成员拖垮整轮 | 墙钟被最慢成员决定 | `memberTimeoutMs` 截断 + quorum 降级(§9.2):到齐 quorum 即可开裁,慢成员弃权 |

> **对抗性结论**:Fusion 不是「越多模型越好」。它的收益完全来自**成员异质性 + 裁判把分歧固化成可核验证据**两件事;任一缺失,它就退化成「更贵更慢的单 agent」。因此本设计在三处设防:成员异质建议(§7.2)、裁判 prompt 反附和(§5.3.1)、evidence 强制可核验(§6/F4)。这三道都失效时,§8.4 的监控指标会让运营者看见「panel 长期零分歧」并关掉它。

---

## 8. 成本模型(事实 D × (N+1),F8)

### 8.1 单次 Fusion 发言成本

设单回合地板价 `base`(事实 D:codex ≈18.7k input;claude 更低,且 prompt cache 摊薄,06 CF-5),panel 有 `N` 个成员 + 1 裁判:

```
单次 Fusion 发言 input 成本 ≈ Σ_{i=1..N} base_i(各成员,F3 都是全新 single-shot,不累积)
                            + base_judge(裁判,喂 N 份成员答案,故 base_judge 比单 base 略大)
                            + retries × base_judge(裁判级重试,§5.4)
                          ≈ (N + 1) × base   (粗估,成员同质时)
```

关键:**因为成员强制 stateless(F3)**,单成员成本是「地板价」而非累积值——Fusion 的 N 倍是**横向**(N 个并行成员),不是事实 D 的**纵向**(轮数累积)。两者在多轮里相乘(§8.3)。

### 8.2 与事实 D 的关系(横向 N × 纵向累积)

| 维度 | 来源 | 形状 |
|---|---|---|
| **横向**:一次 Fusion = (N+1) 次单回合 | 本文件 F8 | 一次决策的固定倍数 |
| **纵向**:跨轮 input 累积/超线性 | 事实 D(02/04) | 仅作用于**有状态续接**的部分 |

> **省钱关键**:Fusion 成员 stateless(F3),所以**单成员不吃纵向累积**——每个成员每次都只看 `digest+delta`(裁剪后的常量级上下文),不看全量历史。纵向累积只发生在中枢维护的 `digest` 上(对所有发言一视同仁,03 E3)。所以 R 个 Fusion 决策回合的成本 ≈ `R × (N+1) × base_round`(`base_round` 含当轮 digest 体积,随轮缓增但非超线性),**不是** `(N+1) × base × R(R+1)/2`。这是 F3 把「panel 多轮成本爆炸」摁住的根本原因。
>
> 反例(若违反 F3 让成员 resume):每个成员各自吃事实 D 累积,总成本 ≈ `(N+1) × base × R(R+1)/2`,N=3、R=8 时 ≈ `4 × 18.7k × 36 ≈ 2.7M` input tokens 单角色——这正是 F3 禁止成员 resume 的量化理由。

### 8.3 多轮预算估算(接 04 BudgetPolicy)

若某范式在 `R_f` 个回合用 Fusion(N 成员)、`R_s` 个回合单 agent:

```
总 input ≈ Σ_{单agent轮} base×k(事实 D 纵向,04 §6.5)
         + Σ_{Fusion轮}  (N+1) × base_round(横向 N+1,纵向因成员 stateless 不累积)
```

接入 04:Fusion 回合的 usage 由 `PanelTurnResult.usage`(Σ成员+judge+重试,§3.1)如实回吐,进 `BoardState.totalUsage`(02 §10.2)→ 喂 04 `BudgetPolicy`(累积实测触发,S4)。但 04 是**轮末**裁决(04 v2 H1 删了前置刹车),而 panel 一轮就扇出 N+1 路——若只靠轮末,**单个 panel 轮可超支 (N+1)× 才被发现**(RS-M5)。因此 Fusion 在**启动 fan-out 之前**自己先过一道**扇出感知前瞻闸**(§5.1 第 0' 步):

```ts
/** 给 04 前瞻刹车的 Fusion 增量估算(本文件 fusion-cost.ts 提供,04 调用)。 */
export function predictFusionRoundInput(
  panel: PanelProviderConfig, baseInputPerRound: number,
): number {
  const n = panel.members.length;
  return (n + 1) * baseInputPerRound; // 横向 (N+1)×;成员 stateless 故无纵向 ×k(F3/§8.2)
}

/**
 * ★扇出感知前瞻闸(RS-M5):启动 panel 前判「当前累积 + (N+1)×预测」是否破顶。
 * 返回放行的最大成员并发(可削);0 = 不启动该 panel 轮,降级单 agent(§9.2)。
 * 与 04 的轮末 shouldStop 互补:这是 panel 特有的【轮内·事前】闸,把超支窗口从「一整轮」压到「单成员」。
 */
export function admitFanOut(
  panel: PanelProviderConfig, currentTotalInput: number, budgetCeiling: number,
  baseInputPerRound: number,
): { admit: boolean; maxMembers: number } {
  const base = baseInputPerRound;
  const judgeCost = base;                                  // 裁判约 1×
  const headroom = budgetCeiling - currentTotalInput;      // 还能花的 input 额度
  if (headroom <= judgeCost + base) return { admit: false, maxMembers: 0 }; // 连 1 成员+judge 都不够 → 降级
  const affordableMembers = Math.floor((headroom - judgeCost) / base);
  const maxMembers = Math.min(panel.members.length, affordableMembers);
  return { admit: maxMembers >= 1, maxMembers };           // 不足全员时削并发(只跑前 maxMembers 个,按 weight 优先)
}
```

> **前瞻闸语义**:① `headroom` 连「1 成员 + judge」都装不下 → `admit:false`,直接降级单 agent(§9.2),**根本不扇出**,避免轮末才发现超 N 倍;② `headroom` 够部分成员 → 削并发(只跑权重最高的 `maxMembers` 个),保 quorum 即可开裁;③ 够全员 → 正常全扇出。`budgetCeiling`/`currentTotalInput` 由 04 `BudgetPolicy` 提供(Fusion 不自持预算状态,只在事前问一次 04)。这道闸 + 单成员 token 上限(§8.5)联手把 RS-M5 的两个洞(轮末才停、单 turn 无 token 顶)都堵上。
>
> **配置者告诫**(接 04 §6.5「别按线性配预算」+ ROC-m6「默认表无 panel 行」):用了 Fusion 还要再叠 (N+1) 倍。N=3 的 panel 单回合 ≈ 4× 单 agent;预算反推时,启用 panel 的范式 `maxTotalTokens` 应按 `(成员数+1) × base_round × 该范式轮数` 计,**不要**沿用四范式单 agent 默认表(那会被 panel 几轮触顶,或叠 ROC-B1 虚高预算时歪打不触顶却实花 4×)。16 §6.4 默认表应增 panel 维度(ROC-m6,交配置文档回填,§13)。

### 8.4 运营监控指标(供 08/15 + §7.3 对冲)

Fusion 是否「值回票价」要靠数据,本文件定义需上报的指标(走 `FusionTrace` 旁路,F7):

| 指标 | 含义 | 健康区间 / 告警 |
|---|---|---|
| `okRate = okCount/memberCount` | 成员有效率 | 持续 <0.5 → 成员配置/限流有问题(§9) |
| `divergenceRate` | 裁判采纳「矛盾/盲点」的回合占比 | 长期 ≈0 → panel 在附和,建议关(§7.3 附和模式) |
| `judgeRetryRate` | 裁判级重试触发率 | 高 → 成员锚点质量差或 judge prompt 需调 |
| `degradeRate` | 降级单 agent 占比(§9.2) | 高 → quorum/超时/provider 健康问题 |
| `fusionCostShare` | Fusion 回合 token 占全 run 比 | 供成本归因,判断 Fusion 是否吃掉过多预算 |

### 8.5 单成员 / 单 turn token 硬上限(RS-M5 第②点)

04 的预算刹车在**轮末**,墙钟超时(`memberTimeoutMs`)只挡「挂死」不挡「在限内疯狂烧 token」。一个成员可能在 `memberTimeoutMs` 内反复工具循环(事实 D:每次内部 resume 累积计费)烧掉远超预期的 token 却不超时。Fusion 给每个成员/judge 一道**单 turn token 硬上限**:

```ts
/** 消费 adapter 流,墙钟超时与 token 上限先到者为准(F9/RS-M5)。adapter 由调用方(成员/judge)传入。 */
async function consumeWithTimeoutAndTokenCeiling(
  adapter: AgentAdapter, stream: AsyncIterable<AgentEvent>,
  timeoutMs: number, tokenCeiling: number, deps: FusionDeps,
): Promise<MemberParse> {
  let cumInput = 0, cumOutput = 0;
  for await (const ev of withWallClock(stream, timeoutMs)) {  // 墙钟到 → 抛 timeout
    if (ev.type === 'turn.completed') {                       // 02 事实 B:usage 在 turn.completed
      cumInput += ev.usage.inputTokens; cumOutput += ev.usage.outputTokens + (ev.usage.reasoningOutputTokens ?? 0);
      if (cumInput + cumOutput > tokenCeiling) {              // ★超阈即 cancel 本成员(不杀整 run)
        await adapter.cancel();                               // 05/06 adapter.cancel(03 §9 权威方法名)
        return { kind: 'token_ceiling', usage: mkUsage(cumInput, cumOutput) };
      }
    }
    // ...(02 §6.3 output-schema 解析)
  }
  return /* parsed | spawn_failed */;
}
```

> **上限取值**:`memberTokenCeiling` 默认建议 = `预测单成员 base_round × 3`(给推理模型 + 少量工具循环留余量,但远低于「整轮预算」)。它是**单成员**闸,不是整 panel 闸——整 panel 的事前闸是 §8.3 `admitFanOut`。两者正交:`admitFanOut` 防「N 路一起扇出就超」(横向),`memberTokenCeiling` 防「单成员自己烧穿」(纵向)。超阈成员标 `error`(detail=`MEMBER_TOKEN_CEILING`)弃权,**不致命**,judge 用到齐的部分;若因此不足 quorum 则降级(§9.2)。
>
> **reasoning 模型校正**(ROC-m8):token 计数把 `reasoningOutputTokens`(02 `TokenUsage` 字段,事实 B)计入 output——推理模型 output 占比高(30–50%),若只数 `outputTokens` 会系统性低估,上限形同虚设。这里显式 `+ reasoningOutputTokens`。

---

## 9. 失败路径与边界(Fusion 专属,接 02/03 错误码)

### 9.1 失败矩阵

| 失败 | 触发点 | FusionExecutor 动作 | 终态/错误码 |
|---|---|---|---|
| kind 是 `implement`(执行回合) | `run` 第 0 步前置闸 | 立即抛(配置期 07 §10.2 已挡,此为防御纵深) | `FUSION_KIND_FORBIDDEN`(§9.3 新增) |
| 写文件的 propose / 合并轮 | `runTurn` §2.1 分流 | 根本不进 Fusion,走单 agent(§0.2,FEAS-3) | —(非错误,正常分流) |
| 扇出感知前瞻不通过(预算不够) | `admitFanOut`(§8.3) | `admit:false`→降级单 agent;部分够→削并发 | 非致命,降级 |
| 单成员 spawn 失败 / 解析失败 | `fanOutMembers` | 该成员标 `status='error'` 弃权,不影响其他成员(F6) | 成员级,非致命 |
| 单成员超时 | `consumeWithTimeoutAndTokenCeiling` | 该成员标 `status='timeout'` 弃权 | 成员级,非致命 |
| 单成员 token 超上限 | `consumeWithTimeoutAndTokenCeiling` | `adapter.cancel()`,标 `status='error'`(detail=`MEMBER_TOKEN_CEILING`)弃权 | 成员级,非致命(§8.5) |
| governor 取许可超时 | `governor.acquire`(17) | 抛 `CONCURRENCY_ACQUIRE_TIMEOUT`(17),executor 捕获→该成员标 `error` 弃权 | 成员级,非致命 |
| 成员被防火墙 block | `buildJudgeInput` | 该成员答案不喂 judge(丢弃),告警(08) | 成员级,非致命(F6) |
| 有效成员 < quorum(默认 2) | collect 后 | **降级单 agent**(§9.2),`degraded.reason='below_quorum'` | 非致命,run 继续 |
| 全部成员挂(okCount=0) | collect 后 | 降级单 agent;若单 agent 也挂→交 03 §5.2 致命路径 | 退化为单 agent 的失败语义 |
| 裁判 spawn/解析失败 | `runJudge` | 抛 `FUSION_JUDGE_FAILED`;executor 捕获→降级用「权重最高的 ok 成员答案」直接作 payload(§9.2) | 非致命(有成员答案兜底) |
| 裁判级重试耗尽仍无强 evidence | §5.4 末 | 返回当前 judgeOut,交外层 `validateMessage` | `EVIDENCE_UNVERIFIABLE`(02,走 03 §5.2 retry/打回) |
| `deps.fusion` 未注入但 panel 命中 | 引擎装配期 assert | 启动期炸,不 spawn | `FUSION_NOT_WIRED`(§9.3 新增) |

### 9.2 降级单 agent(quorum 不足 / 裁判失败)

Fusion **永不因 panel 问题阻断 run**——它退化为单 agent,run 照常推进:

```ts
async function degradeToSingleAgent(
  req: PanelTurnRequest, answers: MemberAnswer[], deps: FusionDeps,
): Promise<PanelTurnResult> {
  const ok = answers.filter((a) => a.status === 'ok')
                    .sort((a, b) => b.weight - a.weight);   // 权重高优先
  if (ok.length > 0) {
    // 有 ok 成员:直接用权重最高的成员答案作 payload(省一次单 agent spawn)
    const top = ok[0];
    return {
      payload: { ...top.payload!, files: [] },              // 仍守决策回合不写文件(§0.2)
      usage: sumUsage(ok, undefined),
      trace: buildTrace(req.panel, req.round, req.directive.role, answers, undefined, 0),
      degraded: { reason: 'below_quorum', okCount: ok.length,
                  quorum: 2, fallbackAgent: req.directive.agent },
    };
  }
  // 全挂:真退化为单 agent(directive.agent 正常 send,= 03 §5.2 原路径)
  const single = await runSingleAgentFallback(req.directive, req.round, deps);
  return { ...single, degraded: { reason: 'below_quorum', okCount: 0, quorum: 2,
                                  fallbackAgent: req.directive.agent } };
}
```

> **降级语义**:① 有 ok 成员但不足 quorum(或裁判挂)→ 用权重最高成员答案,等价于「就这一个评审说了算」;② 全挂 → 走单 agent 原路径(03 §5.2),Fusion 完全透明退场。两种降级都置 `degraded`,引擎据此写一条 `kind:'system'`(`from:'orchestrator'`,02 C7)备注「panel 降级,reason=X」,面板可见(F7/§10),但**不阻断**收敛流程。

### 9.3 新增错误码(需 02 §12 回填)

Fusion 引入两个执行层错误码(02 §12 `SyluxErrorCode` union 加成员,向后兼容非破坏性,02 §1.2):

```ts
// 02 §12 SyluxErrorCode 增量(回填)
| 'FUSION_KIND_FORBIDDEN'   // Fusion 用于非决策回合(implement);配置期+执行期双闸(§0.2/§9.1)
| 'FUSION_NOT_WIRED'        // panel 命中但 deps.fusion/panels 未注入(引擎装配 bug,§2.2)
```

> 不复用 `FUSION_JUDGE_FAILED` 进 union:它是 executor **内部**捕获并降级的瞬态错误(§9.1/§9.2),不冒泡到引擎终态,故不进 `SyluxErrorCode`(只在 trace/日志出现)。`EVIDENCE_UNVERIFIABLE` 复用 02 已有码(不新增)。

---

## 10. 观测旁路(F7:不进 Message,供 08/11/15)

### 10.1 为什么走旁路

`Message`(02)是黑板权威类型且**已冻结**(02 不变量 I1,不得为 Fusion 加字段)。成员 provenance(谁是哪个 provider、各成员原文、裁判打分)是**审计/观战**信息,不是黑板语义——它走 panel 专用观测事件,与 `Message` 物理分离。这样:① 黑板回放(02 §7)不依赖 panel 细节;② 关掉 Fusion 时黑板格式不变;③ 成员原文不污染 stall 指纹(02 §9,只算 `Message.evidence`)。

### 10.2 Fusion 观测事件(WS 广播形状,08/11 渲染,15 落审计)

```ts
/** Fusion 观测事件:经 08 redact(provider key 绝不出现)后走 WS(08/11)+ 审计日志(15)。 */
export interface FusionObservationEvent {
  readonly type: 'fusion_panel';
  readonly runId: string;
  readonly round: number;
  readonly panelId: string;
  readonly role: Role;
  /** 与 PanelTurnResult.trace 同源(§3.4),WS 推给面板的 panel pane 渲染「N 评审 + 裁判」视图 */
  readonly trace: FusionTrace;
  /** 关联的最终黑板消息 id(panel 产出的那条 Message;面板把 trace 挂到该气泡下) */
  readonly resultMessageId: string;
  readonly ts: number;
}
```

> 面板(08)渲染:主对话流里 Fusion 那条消息**和普通气泡一样**(F1),但带一个「panel」徽标;点开展开 `trace`(N 个评审的摘要 + 裁判综合 + 采纳了谁的锚点)。这让观战者既看到「黑板上的单条 critique」,又能下钻「这条 critique 背后 3 个评审怎么吵的」。redact(08 §3.2)保证 trace 里 `bodyPreview` 截断、provider key/base_url 按 07 §9.4 清单脱敏。
>
> **★trace 文本是 agent 可控不可信内容(RS-B2)**:`FusionTrace.members[].bodyPreview`、`label`、`detail` 等字段**全部源自 agent 产出**(成员 body 截断、provider label),与黑板 `Message.body` 同属「server→client 的不可信内容」。redact 只抹 secret 特征,**不转义 HTML**;面板渲染这些字段**必须**按纯文本或经 DOMPurify 白名单消毒(禁 raw HTML / 禁 `javascript:`/`data:` 链接),否则成员可在 body/label 里塞 `<img onerror=...>` 在持 control 权限的面板源执行脚本代发 abort/inject。这条与黑板 body 的 XSS 消毒(02 §5.1 注 / RS-B2)同源同策,归面板文档(08/10)落地;本文件只声明 trace 字段的不可信属性,提醒消费方按不可信文本渲染。
>
> **★流式/落盘前过 redact(RS-M1)**:`FusionObservationEvent` 走 WS/审计前必过 08 redact;若成员 body 以流式 delta 广播,redact 须**跨帧滑动窗口**(否则 `sk-ant-` 跨两帧分片各自不匹配正则会泄漏)——这归 11 WS 流式 redact 规则,Fusion trace 默认**整块**(非逐帧)落地,规避分片泄漏。

---

## 11. 与上下游文档的接口边界(交接锚点)

| 文档 | 本文件提供 | 本文件依赖其提供 |
|---|---|---|
| 02 黑板 | 产出与单 agent 同形的 `AgentMessagePayload`;judge evidence 用 02 `EvidenceItem`;新增 2 错误码回填(§9.3) | `Message`/`EvidenceItem`/`validateMessage`/`verifyEvidence`/`ValidateContext`(含 capabilities)/指纹/`TokenUsage.reasoningOutputTokens` |
| 03 引擎 | `runTurn` 的 Fusion 执行路径(§2.1,含「写文件 propose 不进 panel」判定);`EngineDeps.panels/fusion` 增量(§2.2 回填);需 `TurnDirective` 暴露 `willWriteFiles?`/`files` 或 `shouldMergeAt(round)` 供分流(§2.1) | `runTurn` 调用契约、`TurnDirective`/`PromptContext`(含 runId/signal)、`AgentAdapter.cancel`(03 §9)、单 agent fallback 路径、`shouldMergeAt` |
| 04 刹车 | `predictFusionRoundInput` + `admitFanOut`(§8.3)供**扇出感知前瞻**;`PanelTurnResult.usage` 如实回吐进累积 | `BudgetPolicy` 累积/前瞻阈值、`budgetCeiling`/`currentTotalInput` 查询、`base_round` 取值、累积模型 |
| 05/06 适配层 | (无)Fusion 复用其 adapter spawn 成员/裁判 | `AgentAdapter.send`(成员永不 resume,F3)/`cancel`、output-schema 强制、`AgentEvent`(turn.completed.usage)消费 |
| 07 provider | Fusion **执行算法**(07 §10.1/§14.2 标注归本文件) | `PanelProviderConfig`/`PanelMember`/`JudgeConfig` schema、`buildAgentProviderInput`/`KeyStore`(成员各自 key 通路 P2)、`endpointKeyOf` 输入(wireApi/baseUrl) |
| 08/11 面板/WS | `FusionObservationEvent`(§10.2)数据形状;trace 字段「agent 可控不可信」属性声明(RS-B2) | WS 传输、panel pane 渲染(**须消毒 trace 文本**,RS-B2)、流式 redact(RS-M1)、暂停/介入控制 |
| 08 安全 | 成员/裁判文本喂 judge 前的 `firewallPeerMessage` 调用点(F6);trace 需 redact/消毒的字段清单 | `firewallPeerMessage(msg,ctx)` / `FirewallContext` / `FirewallVerdict`(08 §4.3)、redact 管道(07 §9.4 清单)、env 白名单 |
| 17 性能 | (无)Fusion 成员/judge spawn 经 governor | `ConcurrencyGovernor.acquire({cls:'panel_member',endpoint})`(per-endpoint 子池)、`endpointKeyOf`、`Permit`、`CONCURRENCY_ACQUIRE_TIMEOUT` |
| 15 观测 | `FusionTrace` 指标(§8.4)供审计/成本归因 | 审计日志落盘、指标聚合 |

---

## 12. 测试矩阵(交付验收锚点)

每条「给定 panel 配置 + 成员答案 mock → 期望 PanelTurnResult / 错误」,成员/裁判 adapter 用桩,纯逻辑可单测。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| F-1 | 纯决策回合命中 panel | role=critic, kind=critique, files 空, !shouldMergeAt, panel 配置存在 | 走 FusionExecutor,产单条 critique payload |
| F-2 | 执行回合禁 Fusion | kind=implement | 抛 `FUSION_KIND_FORBIDDEN`(§9.1) |
| F-3 | 配置期禁 implement | panel.enabledKinds 含 implement | 07 §10.2 superRefine 报错(配置期已挡) |
| F-4 | fan-out 全 ok | 3 成员全 status=ok | judge 收 3 份,产 1 条 payload,usage=Σ3+judge |
| F-5 | 成员超时弃权 | 1/3 超时 | okCount=2≥quorum,judge 用 2 份;trace 标 timeout |
| F-6 | 不足 quorum 降级 | 仅 1/3 ok | `degraded.reason='below_quorum'`,用权重最高成员答案,files=[] |
| F-7 | 全成员挂降级单 agent | 0/3 ok | 走单 agent fallback,degraded.okCount=0 |
| F-8 | 裁判失败降级 | judge spawn 失败 | 用权重最高 ok 成员答案兜底,不抛到引擎 |
| F-9 | critique 无强锚点→裁判级重试 | judge 首次 evidence 全 spec_quote / 无 quote file_ref | 触发裁判级重试(§5.4),不重跑成员 |
| F-10 | 重试后达标 | 重试 judge 带回 file_ref+quote(复算一致) | `hasStrongEvidence`=true,产合格 critique |
| F-11 | 重试耗尽交外层 | k 次仍无强 | 返回 judgeOut,外层 validateMessage 打 `EVIDENCE_UNVERIFIABLE` |
| F-12 | 裁判降级 question | 成员均无强可核验锚点 | judgeOut.kind='question',不触发 02 C1 evidence 强制 |
| F-13 | file_ref 复算预检 | judge evidence quote 与区间不符 | `verifyEvidence`=fail→预检不通过→重试 |
| F-14 | files 恒空(纯决策) | judge 建议改文件 | payload.files===[](§5.5,决策回合不写) |
| F-15 | from=槽位 agent | directive.agent=claude | 最终 append 的 Message.from='claude'(F1),非成员 provider |
| F-16 | 成员零串扰 | mock 检查成员 prompt | 各成员 prompt 不含其他成员输出(F6) |
| F-17 | 成员强制 stateless | mock adapter | 成员只调 send,从不 resume(F3) |
| F-18 | best_of 选中溯源 | strategy=best_of | judgeOut.pickedMemberId 进 trace,不进 Message(F7) |
| F-19 | usage 如实汇总 | Σ成员+judge+重试 | PanelTurnResult.usage 正确,喂 04 累积 |
| F-20 | 成本前瞻估算 | predictFusionRoundInput(N=3,base) | =(3+1)×base=4×base(§8.3) |
| F-21 | 观测事件脱敏 | FusionObservationEvent 经 08 redact | 无 provider key;bodyPreview 截断 |
| F-22 | panels 命中未注 fusion | deps.panels 命中,deps.fusion 缺 | 装配期 assert `FUSION_NOT_WIRED` |
| F-23 | 同质 panel 退化 | 成员全同 provider 答案一致 | divergenceRate≈0,产 review/propose(不强造矛盾) |
| F-24 | maxConcurrency 限流 | 4 成员 maxConcurrency=2 | 提交并发不超 2 |
| **F-25** | **写文件 propose 不进 panel(FEAS-3)** | kind=propose 但 directive.files 非空 / shouldMergeAt=true | runTurn §2.1 走单 agent,**不**调 FusionExecutor;files 不被清空 |
| **F-26** | **成员经 governor 端点子池(F9/RS-M5)** | 3 成员同 endpoint, governor capacity=2 | 同时 spawn ≤2,第 3 个等许可;每成员 acquire({cls:'panel_member',endpoint}) 被调 |
| **F-27** | **异端点成员并行不串行** | 2 codex@mouubox + 1 claude@official | mouubox 子池限 2,claude 子池独立放行,不互相阻塞 |
| **F-28** | **扇出感知前瞻闸(RS-M5)** | currentTotal+( N+1)×base > 上限 | admitFanOut.admit=false→降级单 agent,不扇出 |
| **F-29** | **前瞻削并发** | headroom 够 2 成员不够 3 | maxMembers=2,只跑权重最高 2 个 |
| **F-30** | **单成员 token 上限(RS-M5②)** | 成员累计 usage>memberTokenCeiling | adapter.cancel,标 error(MEMBER_TOKEN_CEILING)弃权 |
| **F-31** | **reasoning output 计入上限(ROC-m8)** | usage 含 reasoningOutputTokens | token 计数含 reasoning,不低估 |
| **F-32** | **成员被防火墙 block 不喂 judge(F6/RS-B2)** | 成员 body 含注入高危特征 | firewallPeerMessage→block,该成员丢弃,不进 JudgeInput.answers |
| **F-33** | **成员 flag 仍喂但告警** | 成员 body 触发 med/low 特征 | action=flag,wrapped 喂 judge + 告警 |
| **F-34** | **能力门同步降级(M1 a/b,FEAS-2)** | validateCtx.capabilities.fs=false | file_ref 一律 weak,hasStrongEvidence 随单 agent 同步降级 |
| **F-35** | **回灌素材仅含已核验锚点** | buildEvidenceRejectFeedback | fb 只含 verifyEvidence=pass 锚点短引用,无成员 body 散文 |
| **F-36** | **onStart 不进 Fusion(FEAS-9)** | playbook.onStart | 无 runTurn,不触发 FusionExecutor;parallel 表标「不适用」 |

> **验收线**:F-2/F-3/**F-25**(执行/写文件回合禁用)是 §0.2 硬边界的验收;F-9/F-10/F-11(裁判级重试,不重跑成员)+ **F-35** 是 F5 成本约束的验收;F-15/F-17(from=槽位 + 成员 stateless)是 F1/F3 的验收;F-12(裁判降级 question)是 §7.3 反附和对冲的验收;F-20/**F-26/F-28/F-30**(governor + 前瞻闸 + token 上限)是 F9/RS-M5/ROC-M3 的验收;**F-32/F-34**(防火墙 block + 能力门)是 F6/FEAS-2 的验收。这些不过,Fusion 子模块不算交付。

---

## 13. 编号说明与 openQuestions

### 13.1 编号说明

任务简报里「引用 02/03/07」中的「07」指 **provider 文档**(`07-provider-config.md`,Fusion 配置形态在其 §10)。**刹车文档**物理落点是 `04-convergence-brakes.md`,但 02/03 的交叉引用里称其为「07」(见 04 §0 编号说明)。本文件对二者分别精确引用(provider=07 文件,刹车=04 文件),合稿时随全仓统一编号一并校正。

### 13.2 需回填的对账项(均向后兼容)

1. **02 §12**:新增 `FUSION_KIND_FORBIDDEN` / `FUSION_NOT_WIRED` 两个错误码(§9.3,union 加成员,非破坏性)。`CONCURRENCY_ACQUIRE_TIMEOUT`(17)/`EVIDENCE_UNVERIFIABLE`(02)复用已有码。
2. **03 §4.3 / §3.1**:`EngineDeps` 增 `panels?: PanelMatcher` / `fusion?: FusionExecutor`(§2.2);`runTurn`(03 §5.2)入口加 Fusion 分流(§2.1);`TurnDirective` 需暴露 `files`(或 `willWriteFiles?: boolean`)供 §2.1「写文件 propose 不进 panel」判定(FEAS-3);分流还需访问 `playbook.shouldMergeAt(round)`。对无 panel 配置的现有四范式零影响。
3. **07 §10.1 / §14.2**:把「融合/裁判算法归引擎 Fusion 子模块(03)」的指向**改为本文件(21)**——算法权威在 21,03 只提供 `runTurn` 接入点。
4. **04 §6.4**:`predictFusionRoundInput` + `admitFanOut`(§8.3)作为**扇出感知前瞻**入口,需在 BudgetPolicy 前瞻分支对「下一轮/本轮是否 Fusion」选用,并向 Fusion 暴露 `budgetCeiling`/`currentTotalInput` 查询(RS-M5)。
5. **16 §6.4 默认预算表**:增 panel 维度——启用 panel 的范式 `maxTotalTokens` 按 `(成员数+1)×base_round×轮数` 估,不沿用四范式单 agent 默认(ROC-m6)。
6. **08/10 面板**:`FusionTrace` 文本字段(bodyPreview/label/detail)按「agent 可控不可信」消毒渲染(RS-B2);`FusionObservationEvent` 走 WS 前过 redact,流式按跨帧窗口(RS-M1)。

### 13.3 openQuestions(交 M1/M2 实测或上层决策)

- 【待实测】**成员异质性的真实分歧率**:N 个不同 provider 对同一 critique 的实际分歧有多大?分歧太小则 Fusion 退化为更贵单 agent(§7.3)。需 M1 用真实任务测 `divergenceRate`,据此定「值得用 Fusion」的 provider 异质度门槛。
- 【待实测】**裁判级重试的收敛率**:§5.4 假设「成员通常已含强锚点,重跑 judge 即可带上」。这个假设的真实命中率(F-9→F-10 比例)需实测;若 judge 重试 k 次仍常失败,说明成员 roleBrief 要更强制锚点,或 quorum 该提高。
- 【待实测】**judge prompt 喂 N 份答案的体积**:N=3~5 份成员答案 + evidence 喂 judge,是否撞 claude `--json-schema`/`--settings` 32KB 内联上限(07 §6.3 / 02 §6.2)?超限则 judge 输入需走文件/stream-json(05/06 备选)。
- 【待实测】**`memberTokenCeiling` 默认取值**:§8.5 取「单成员 base_round×3」是拍的;推理模型 reasoning 占比高(ROC-m8),真实合理上限需 M2 用 `turn.completed.usage.reasoningOutputTokens` 分布校准,避免误杀正常推理或放过烧穿。
- 【待上层决策】**quorum 默认值**:本文件取 2(§5.1/§9.2)。是否随 panel 规模动态(如 `ceil(N/2)`)?涉及「几个评审才算有效融合」的产品判断。
- 【待上层决策】**前瞻削并发 vs 不启动的策略**:§8.3 `admitFanOut` 在 headroom 不足全员时削并发(保 quorum)。但削并发会降多样性(panel 价值来自异质成员数);「宁可少几个成员也跑 vs 预算紧就干脆降单 agent」的取舍门槛待运营校准。
- 【待上层决策】**Fusion 与 stall 的交互**:Fusion 一次产一条 critique,其 evidence 进 02 §9 指纹差集(04 §4)。panel 多视角是否更易/更难触发 stall(更易给新锚点→更难 stall;但也可能 N 成员反复指同一处→指纹同→照常 stall)?需 M2 观测 Fusion 回合对 `emptyStreak` 的实际影响。
- 【待上层决策】**成员 provider 路由策略**:成员池如何选 provider(全官方?官方+中转混?claude+codex 混)涉及成本(§8)、端点子池分布(§5.2 governor)与 07 的 failover 交互;本文件只定执行,选池策略待 07 registry + 运营策略协同。
- 【交 03 裁决,不在本文件 scope】**红蓝 propose 到底写不写文件**(FEAS-3 根因):03 §7.1 红蓝 proposer 声明 files + shouldMergeAt=true(写),25 M1 称纯决策不写。本文件已把 Fusion 边界改为「按是否写文件」**对两种裁决都成立**(写→不 panel,不写→可 panel);但红蓝行为本身的裁决归 03/25,本文件不替它定。







