# 10 · Web 观战面板 UI(布局 / 增量消费 / 虚拟滚动 / 人工介入 / 组件拆分 / 读写解耦)

> **本文件地位**:sylux **观战面板(`@sylux/web`)的权威 UI 设计**。负责六件事:① 整体布局与视觉编码(对话时间线 / 轮数进度 / 角色配色 / diff 查看 / 控制栏)的 ASCII 线框;② **面板如何消费 WS 帧并合流进只读 store**(reducer / 去重 / resync 触发 / 流式聚合 / 帧→渲染映射);③ 长会话虚拟滚动与增量合流;④ 人类 `inject` 如何影响下一轮(端到端时序 + UI 态机);⑤ 前端组件拆分;⑥ **面板「只读黑板」与「发控制命令」两条通路的解耦**。
>
> **⚠ v2 重大边界修正(吃掉 R1 双权威)**:WS 的**线格式权威**(帧信封 `WsEnvelope`、server↔client 帧 zod union、`seq`/`cid` 语义、连接生命周期与关闭码、断点续传 `replayBuffer`、背压降级)**全部归 WS 协议文档(物理落 `11-ws-protocol.md`,下称「WS 协议 11」)**。v1 本文 §4 曾自写一份 `WsDownFrame`/`WsUpFrame` zod —— 那是 R1 式的**第二份权威**,且与 11 实际帧名(`control_ack`/`diff_ready`/`round_planned`/`batch`、关联键 `cid`)冲突,**v2 已删除本文所有自写帧 zod**。本文 §4 改为 11 帧的**纯消费层**:只定义「收到 11 的帧后,UI 怎么去重 / 合流 / 渲染 / 触发 resync」,所有帧形状、`seq`/`cid` 规则、关闭码一律 `import type` 自 11 并**引用、不另写**。
>
> **引用而非另写**:所有黑板数据类型(`Message` / `EvidenceItem` / `FilePatch` / `BoardState` / `Round` / `RunStatus` / `AgentEvent` / `AgentMessagePayload` / `TokenUsage`)以 `@sylux/shared`(黑板协议 02,`@sylux/shared/src/blackboard.schema.ts`)为唯一权威;所有 WS 帧类型(`WsEnvelope` / `ServerPayload` / `ClientPayload` / 各 `s*`/`c*` 帧 / `BROADCAST_KINDS` / `DROPPABLE_KINDS`)以 WS 协议 11(`@sylux/server/src/ws-frames.ts`)为唯一权威。面板是二者的**只读消费端 + 控制命令生产端**,**禁止另写一份 zod**。
>
> **与其他文档的边界**:WS 的**安全规则**(127.0.0.1 绑定 / Origin 白名单 / 一次性 token / 观战·控制权限分级 / 广播前 redact)归安全文档(物理落 `08-security-firewall.md`,§5),本文只**引用**并描述其在 UI 上的呈现;WS 的**线格式 / 生命周期 / 背压**归 WS 协议 11;控制帧进引擎后的**消费语义**(`ControlQueue` / `startControlPump` / 相位边界消费 / inject 校验)归 arch 文档 01 §2.3,本文只描述「面板发什么、何时发、收到 11 的回执/广播后 UI 怎么变」。
>
> **事实标注约定**:凡基于假设而非本机实测的结论,显式标注【待实测】。
>
> **⚠ 编号说明**:本文落 `10-web-ui.md`,WS 协议落 `11-ws-protocol.md`,安全落 `08-security-firewall.md`;但部分兄弟文档(01/02/05/06/07)在旧交叉引用里称「面板/WS 文档=08」「安全=09」——与现仓物理文件名不一致。在用户对编号做统一裁决前,本文一律按**角色名 + 现物理文件名**引用(「黑板协议 02」「WS 协议 11」「安全文档 08」「arch 文档 01」「provider 文档 07」「worktree 文档 09」),不硬编会漂的数字。见 §13 openQuestions。

---

## 0. 设计目标与不变量

### 0.1 本文件负责 / 不负责

| 负责(本文给完整设计) | 不负责(只引用) |
|---|---|
| 面板整体布局 / 视觉编码 ASCII 线框(§2、§3) | 黑板数据类型 zod 定义(02,只引用) |
| **WS 帧的 UI 消费层**:reducer / `seq` 去重 / resync 触发 / 流式聚合 / 帧→渲染映射(§4) | **WS 帧线格式 / 信封 / `seq`·`cid` 语义 / 生命周期 / 关闭码 / 背压 / replayBuffer(WS 协议 11,只引用)** |
| 长会话虚拟滚动 + 增量合流(§5) | WS 鉴权·权限分级·绑定·redact 规则(安全文档 08,只引用) |
| 人工 `inject`/`pause`/`abort` 的 UI 时序 + 态机(§6) | 控制帧进引擎后的消费 / inject 校验(arch 文档 01 §2.3,只引用) |
| 前端组件树拆分(§7) | `ControlQueue` / 相位边界 / `validateMessage`(01/02) |
| 只读态 store 与控制命令 client 的解耦(§8) | diff 正文生成(worktree 文档 `git diff --find-renames`) |
| diff 查看器 + 降级策略(§9) | 刹车阈值算法(provider/刹车文档) |
| **面板侧不可信内容渲染 / XSS 防御 / CSP(§3.6,U8)** | 中枢 redact / 内容防火墙 / 沙箱(安全文档 08,只引用;XSS 是 08 缺的受害面,本文落地并提请 08 补 T16) |
| evidence 核验态的 UI 呈现(§3/§9) | jsonl 持久化行格式(02 §7,面板经 snapshot 投影消费) |

### 0.2 不变量(面板实现必须保持)

- **U1 面板纯投影**:面板**绝不持有黑板权威态**。它显示的一切都是中枢 `BoardState`(02 §10)的**只读投影**;UI 本地状态(滚动位置、展开的 diff、草稿 inject 文本)与黑板态严格分两个 store(§8),禁止把 UI 态写回黑板路径。
- **U2 读写双通路解耦**:**收**(WS 增量 / snapshot)与**发**(控制命令)在前端是**两个独立模块**:`BoardStream`(只读订阅)与 `ControlClient`(命令发送)。二者只通过「`ControlClient` 发命令 → 中枢处理 → 增量帧从 `BoardStream` 回流」闭环,**不允许** `ControlClient` 直接 mutate board store(对应 arch 01 RT2 / 安全文档 08 §5.3 / 11 W4「控制帧不直接改黑板」在前端的镜像)。
- **U3 帧序即真相**:面板渲染顺序严格跟随中枢广播序(arch 01 RT7:`落 jsonl → 广播 → 喂刹车`;WS 协议 11 W1:每 run 广播帧带单调 `seq`,点对点帧 seq=0)。面板**不重排、不补算**消息顺序;`seq` 的分配/单调/无洞由 11 保证,面板只按 11 的规则**去重 + 检测空洞 + 触发 resync**(§4.3,机制本体引用 11 §6)。多 run 单连接下 `seq` 按 `runId` 分序列(11 §2.2),面板游标是 `Map<runId, seq>`。
- **U4 redact 后才到前端**:面板收到的任何文本(`body`/`delta`/`tool_call`/diff/错误 `message`)都已在中枢 `WsHub.broadcast` 前过 `redactObject`(安全文档 08 §3.2 / S4,WS 协议 11 W3 焊死)。面板**不做二次脱敏**,也**不得假设**前端能见到原始 key——前端是不可信展示端(安全文档 08 B2)。⚠ **已知残漏(红队 RS-M1,面板需知情但无法修)**:中枢 redact 是**逐帧无状态**正则,跨帧分片的 secret(如 `sk-ant-` 被切进两个 `delta`/`diff_chunk` 帧)单帧各自不匹配,会原样到前端,**面板在前端拼接后明文密钥可能重现**(§4.4)。这是中枢侧缺口(应做跨帧滑窗 redact 或流式默认不发 spectate),面板**不能靠前端二次扫描补救**(U8:前端不可信、且会与 redact 占位符规则脱节);面板侧的纵深兜底是 §13 openQuestion 10「流式帧默认仅 control 可见」——在中枢流式 redact 落地前,`delta`/`tool_call`/`diff_chunk` 默认**不向 `spectate` 连接渲染**(§4.4)。
- **U5 evidence 可视即可核验**:critic 的 evidence(02 §3 `EvidenceItem` 三锚点)在面板上**结构化呈现**(file_ref 跳转 diff 行、command 显示 cmd/expected/actual、spec_quote 显示来源引文),不是一坨自由文本。核验状态由中枢 §8.3 `verifyEvidence` 算出,**只有三态** `pass`(强)/ `weak`(仅定位/未实跑/spec_quote)/ `fail`(复算不符,02 §8.3 焊死),面板按色标呈现(§3.1),**不自己复算、不发明第四态**。⚠ 当前 02 `Message` 与 WS 协议 11 `message` 帧**都未携带逐条 verdict**——面板需要的 `evidenceVerdicts` 旁路属**待回填项**(§4.2、§13 openQuestion),缺失时降级(§3.1)。
- **U6 终态只读**:run 进入终态(`done`/`stalled`/`aborted`/`limit`,02 §10.2)后,控制栏的 pause/inject/abort **禁用**,面板进入「回放 / 审计」模式(可时间旅行,§5.4),control 通路对终态命令的拒绝(arch 01 §2.3)在 UI 上提前灰化,不让用户发无效命令。
- **U7 体积有界**:长会话(数百轮、数千消息、巨型 diff)下面板内存与 DOM 必须有界:消息列表虚拟滚动(§5)、diff 懒加载 + 降级(§9)、`delta` 流式片段在 `final_message` 落定后丢弃中间态(§4.4)。
- **U8 不可信内容零执行(吃掉红队 RS-B2 blocker)**:面板把**所有 agent 来源字符串**(`body`/evidence `quote`·`source`·`locator`/`FilePatch.path`·`renamedFrom`/`diff_ready.files[].path`/diff 正文/`tool_call.argsDigest`/`error`·`system` 的 `reason`·`body`/可配 `playbookId`)一律当**不可信数据**渲染,**绝不**作为 HTML/JS 执行——默认纯文本 `textContent`,markdown 渲染禁 raw HTML + 协议白名单 + DOMPurify 二次消毒,叠加 strict CSP(§3.6)。**redact(U4)只抹 secret、不转义 HTML,与 XSS 防护正交,二者都要**。面板是这套系统里**唯一持 `control` 权限的实体**,一次 XSS 即可越权代发 `pause`/`abort`/`inject` 或抢 `ws-ticket`,故按零信任渲染,无逐字段豁免。安全文档 08 威胁模型当前只把浏览器当**攻击发起方**(CSWSH/越权),缺「agent 内容 → 浏览器 DOM」这一受害面——本文 §3.6 在面板侧落地该防御,并提请 08 新增威胁项 T16(见 §13)。

---

## 1. 技术形态与依赖(对齐总体规划 §8.1)

| 维度 | 选型 | 理由 / 约束 |
|---|---|---|
| 构建 | Vite 6 | dev server 端口从配置读,Origin 白名单据此(安全文档 08 §5.1) |
| 框架 | React 18 + TS(strict) | 并发特性可选;`useSyncExternalStore` 直接订阅外部 store(§8.3) |
| 状态 | zustand | 两个独立 store:`boardStore`(只读投影)/ `uiStore`(本地 UI 态)。控制命令不走 store,走 `ControlClient`(§8) |
| 传输 | 原生 `WebSocket` | 不引 socket.io(与 WS 协议 11 §1.1 选型一致);帧线格式由 11 定义,本文只消费。token 走 REST 取 + `hello` 首帧提交,不进 URL(安全文档 08 §5.2 / 11 §5.2) |
| 虚拟滚动 | `@tanstack/react-virtual`(virtualizer) | 消息时间线 + 大 diff 行级虚拟化(§5、§9) |
| diff 渲染 | `diff2html` 或 `react-diff-viewer-continued` | 输入是中枢生成的 unified diff(按需经 11 §9 REST 拉取);降级策略 §9.3。二选一在 §13 openQuestion |
| 样式 | CSS Modules / Tailwind(实现期定) | 角色配色用 CSS 变量集中定义(§3.2),便于主题切换 / 无障碍对比度 |

> 依赖图最上层:`shared ← core ← {providers, agents} ← server ← web`(总体规划 §10)。`@sylux/web` **只**从 `@sylux/shared` 导入黑板类型(`import type { Message, BoardState, ... }`),从 WS 协议 11 的帧契约(物理落 `@sylux/server/src/ws-frames.ts`)导入 `WsEnvelope`/`ServerPayload`/`ClientPayload` 等帧类型(`import type` only)。web 不反向依赖 core/agents,也**不**重新声明任何帧或黑板 zod。

---

## 2. 整体布局(ASCII 线框)

### 2.1 全局三栏 + 顶栏 + 控制栏

桌面默认布局:顶部状态条(run 元信息 + 刹车/预算 + 第三方中转告警),左侧轮数导航(round rail),中间对话时间线(主区,虚拟滚动),右侧 detail 抽屉(diff / evidence / agent 会话态),底部控制栏(pause/resume/inject/abort + scope 指示)。

```
┌─ TopBar ──────────────────────────────────────────────────────────────────────────────────┐
│ ● sylux  run:7f3a…e1  playbook:[红蓝对抗 ▾]  status:[● running]  round 6/maxR 12            │
│ tokens累积 214k / 预算 360k ▓▓▓▓▓▓░░░░  | ⚠ codex 经第三方中转 mouubox(代码会出境)[切直连]│
│ conn:[● control · ws已连]  spectators:2                                          [⏯][⎘审计] │
├──────────┬──────────────────────────────────────────────────────────────┬───────────────────┤
│ RoundRail│  Timeline(对话气泡,虚拟滚动)                                 │  DetailDrawer     │
│          │                                                              │  (tab 切换)       │
│ ▸ R0 plan│  ┌──────────────────────────────────────────────────────┐    │ ┌──[Diff][Evid][会话]│
│ ▸ R1     │  │ ⟦R3⟧ codex · proposer · propose            12:04:11   │    │ │ Diff: codex@R5    │
│ ▸ R2     │  │ 我建议把鉴权中间件抽到 authGuard.ts …                │    │ │ src/auth.ts  +24-3│
│ ▸ R3 ◀───┼──│ files: [M] src/auth.ts  [A] src/authGuard.ts         │    │ │ ┌───────────────┐ │
│ ▸ R4     │  └──────────────────────────────────────────────────────┘    │ │ │@@ -10,3 +10,24│ │
│ ▸ R5     │  ┌──────────────────────────────────────────────────────┐    │ │ │+ export func… │ │
│ ▸ R6 ●now│  │ ⟦R3⟧ claude · critic · critique   ⚑evid✓×2  12:04:48  │    │ │ │-  old line    │ │
│  ├ now    │  │ authGuard 漏了对 OPTIONS 预检的放行,见 ↓            │    │ │ └───────────────┘ │
│  │ ▓token │  │ evidence:                                            │    │ ├───────────────────┤
│  │        │  │  ▣ file_ref src/authGuard.ts:14-22  [跳转] hash✓     │    │ │ Evidence(critic)  │
│ ─────────│  │  ▣ command  `npm test -- auth`  exit≠0  [展开]       │    │ │ ✓ file_ref ……     │
│ [收敛指纹]│  └──────────────────────────────────────────────────────┘    │ │ ⚠ command(未复跑)│
│  R5→R6:+3│  ┌──────────────────────────────────────────────────────┐    │ │ ○ spec_quote(弱) │
│  stall:0 │  │ ⟦sys⟧ orchestrator · system   ⛔合并冲突 硬停        │    │ └───────────────────┘
│  /win 3  │  │ src/auth.ts 在 round6 合并冲突,已回灌 evidence       │    │  会话态:           │
│          │  │ … 等待人工裁决或下一轮                                │    │  codex sess:019e…  │
│          │  │ [▌codex 正在输出… ▍流式 delta]                       │    │  resumable:✓       │
│          │  └──────────────────────────────────────────────────────┘    │  claude sess:abc…  │
│          │  ▼ 自动跟随底部(有新消息时)         [↧回到最新 (3)]      │  resumable:✓       │
├──────────┴──────────────────────────────────────────────────────────────┴───────────────────┤
│ ControlBar  [⏸暂停][▶恢复]  [✎ 介入(inject)…]  [■中止(abort)]   scope:control  ·  R6 进行中 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

要点标注(对应后续小节):

- 顶栏 `playbook` 显示当前剧本(引擎文档 03 / arch 01 的 `playbookId`),**热换剧本**只读展示(切换入口若开放归 RestApi,本文不主张面板直改);`status` 用色点(§3.3);`tokens累积/预算` 是事实地基 D 的**累积**模型可视化(非每轮增量),进度条满则刹车 `TOKEN_BUDGET_EXCEEDED`。
- 第三方中转告警常驻(安全文档 08 §7.1),带「切官方直连」入口(动作归 RestApi/provider 配置,面板只触发)。
- `conn` 区分 `spectate`/`control` scope(安全文档 08 §5.3);`spectators` 计数依赖中枢 presence——⚠ 11 当前无 presence 广播帧(只有 `WsHub.stats()` 查询,11 §10.1),此项为可选能力,见 §13 openQuestion,不实现则隐藏。
- RoundRail 底部嵌「收敛指纹」小面板:展示每轮新增 evidence 指纹数(02 §9.3 差集)与 stall 计数 `stall:k/win N`,让人直观看到「还在不在吵出新东西」。
- Timeline 是虚拟滚动主区(§5);底部「自动跟随」与「回到最新(N)」按钮处理长会话滚动锚定(§5.3)。
- 流式 `delta`(P4 透传,arch 01 §2.1;11 `delta` droppable 帧)在气泡内以「正在输出」态增量拼接,`message` 帧落定后替换为定稿气泡(§4.4)。

### 2.2 窄屏 / 折叠布局(响应式降级)

```
┌─ TopBar(压缩:status + round + token 条)───────────┐
│ ● run:7f3a status:● running  R6/12  tok 214k▓▓▓░ ⚠中转│
├───────────────────────────────────────────────────────┤
│  Tab: [时间线] [轮次] [Diff] [Evidence] [会话/配置]    │  ← 三栏塌成 tab
├───────────────────────────────────────────────────────┤
│  (当前 tab 内容,时间线仍虚拟滚动)                     │
│                                                         │
├───────────────────────────────────────────────────────┤
│ ControlBar  [⏸][▶][✎介入][■中止]  scope:control       │
└───────────────────────────────────────────────────────┘
```

- 断点(建议 `< 1024px`)把三栏折叠成 tab;RoundRail / DetailDrawer 成为可切 tab。ControlBar 始终常驻底部(介入是高频且时效敏感动作,§6)。
- 时间线在任何布局下都保留虚拟滚动与「回到最新」锚定。

## 3. 视觉编码(角色配色 / kind 标记 / 状态 / 气泡解剖)

视觉编码的目标:**一眼区分「谁(from)/ 扮谁(role)/ 说哪类话(kind)/ 是否带可核验证据」**。这四个维度正交(02 §2:`from` 与 `role` 解耦,`kind` 独立),所以用**四种独立视觉通道**编码,互不抢占。

### 3.1 四通道编码总表

| 维度 | 视觉通道 | 取值与编码 |
|---|---|---|
| `from`(物理主体) | **头像图标 + 主色相** | codex=蓝系、claude=紫系、human=绿系、orchestrator=灰系(中性) |
| `role`(本条扮角色) | **气泡左侧 4px 边条 + 角色徽标文字** | planner/worker/proposer/critic/peer/arbiter,边条用角色专色(§3.2) |
| `kind`(消息类型) | **气泡内 kind 徽章(图标+缩写)** | propose⟂ critique⚑ plan▤ implement⌗ review☑ ack✓ question? done■ system⚙ |
| evidence 核验态 | **徽章 ⚑evid 后的角标** | 三态(对齐 02 §8.3 `verifyEvidence`):✓ `pass`(中枢独立复算通过=强)/ ○ `weak`(无 quote 的 file_ref、未实跑 command、spec_quote——仅定位,不解锁 C1)/ ✗ `fail`(复算不符,被打回) |

> 关键设计:`from` 用**色相**(hue),`role` 用**边条专色**,二者不冲突——同一个 codex(蓝头像)这一轮可能是 proposer(蓝边条)下一轮是 critic(红边条),头像色相不变、边条变,人能同时读出「还是 codex,但现在在唱反调」。这正是「角色与模型解耦」(02 §2、锁定决策 §3)的视觉落地。
>
> ⚠ **核验态只有三态**:02 §8.3 `verifyEvidence` 返回 `'pass'|'weak'|'fail'`,**没有第四态**。v1 本文曾画「⚠ 未复跑」作为独立态——已并入 `weak`(○)。「未实跑的 command」与「无 quote 的 file_ref」「spec_quote」在语义上同属 weak(02 §3.2:不单独解锁 critique 的 evidence 要求),面板统一用 ○ 呈现,hover 显示具体子原因(「未实跑」「无 quote」「规范引用」)。

### 3.2 配色变量(CSS 自定义属性,集中定义便于主题/无障碍)

```css
:root {
  /* from 主色相(头像/名字) */
  --from-codex:    #2563eb;  /* 蓝 */
  --from-claude:   #7c3aed;  /* 紫 */
  --from-human:    #16a34a;  /* 绿 */
  --from-orch:     #6b7280;  /* 灰(系统中性) */

  /* role 边条专色(与 from 色相错开,避免同屏混淆) */
  --role-planner:  #0891b2;  /* 青 */
  --role-worker:   #65a30d;  /* 橄榄 */
  --role-proposer: #2563eb;  /* 蓝 */
  --role-critic:   #dc2626;  /* 红(唱反调,最醒目) */
  --role-peer:     #d97706;  /* 琥珀 */
  --role-arbiter:  #9333ea;  /* 品紫(裁判) */

  /* kind 徽章底色(低饱和,不抢边条) */
  --kind-bg:       #f1f5f9;
  --kind-fg:       #334155;

  /* 状态点 */
  --status-running: #16a34a; /* 绿 */
  --status-paused:  #d97706; /* 琥珀 */
  --status-done:    #2563eb; /* 蓝 */
  --status-stalled: #dc2626; /* 红 */
  --status-aborted: #6b7280; /* 灰 */
  --status-limit:   #b45309; /* 棕(预算耗尽) */

  /* evidence 核验态(三态,对齐 02 §8.3 verifyEvidence) */
  --evid-pass: #16a34a; --evid-weak: #94a3b8; --evid-fail: #dc2626;
}
```

> **无障碍**:配色仅作辅助,**不单独靠颜色传意**——`role` 同时有文字徽标、`kind` 同时有图标+缩写、核验态同时有 ✓/○/✗ 字形,满足色盲可读(WCAG 1.4.1 不仅靠颜色)。对比度建议达 AA(4.5:1);完整 WCAG 合规需人工 + 辅助技术验证(本文不主张已合规,仅按惯例设计)。【待实测】真实对比度需实现期用工具量。

### 3.3 run 状态机的状态点(02 §10.2 `RunStatus`)

```
● running   绿 · 脉冲动画(进行中)
● paused    琥珀 · 静止(人工暂停,可恢复)
● done      蓝 · 实心(对面带证据 ack 过 done,C2)
● stalled   红 · 三角警示(连续 N 轮无新指纹,CONVERGENCE_STALL)
● aborted   灰 · ✕(人工中止 / 致命错误)
● limit     棕 · ⏱(maxRounds / token 预算,ROUND_LIMIT_EXCEEDED / TOKEN_BUDGET_EXCEEDED)
```

状态来源:WS `status` 帧(§4.2),对应中枢 `status_changed`(02 §7.1)。终态(done/stalled/aborted/limit)触发 U6 只读模式。

### 3.4 气泡解剖(单条 Message 的完整渲染)

```
┌─[role 边条] ─────────────────────────────────────────────────────────┐
│ ⟦R3⟧  [●codex头像]  codex · critic       ⚑evid✓×2   12:04:48  ⟲reply │  ← header
│       └from色相      └from·role          └核验角标   └ts     └inReplyTo锚
├──────────────────────────────────────────────────────────────────────┤
│ [⚑critique]  authGuard 漏了对 OPTIONS 预检的放行,见下。               │  ← kind 徽章 + body
│                                                                        │     (body 已 redact)
├── files(若有)────────────────────────────────────────────────────────┤
│  [M] src/auth.ts   [A] src/authGuard.ts   [D] old.ts                    │  ← FilePatch 芯片,点击→Diff tab
├── evidence(若有,结构化)──────────────────────────────────────────────┤
│  ▣ file_ref  src/authGuard.ts:14-22   hash✓   [跳转 diff 行]            │
│  ▣ command   `npm test -- auth`  expect:contains "PASS" actual:✗ exit1  │
│  ○ spec_quote 需求§4.2「预检必放行」  [来源]                            │
└──────────────────────────────────────────────────────────────────────┘
```

- **header**:`⟦R{round}⟧` 轮次锚(点击 → RoundRail 定位)、from 头像+名(色相)、`· role`(边条同色)、`⚑evid{态}×{n}` 核验角标(§3.1)、`ts` 本地化时间(中枢权威 ts,02 §5.1)、`⟲reply` 若有 `inReplyTo`(点击高亮上游气泡,构造对话树)。
- **body**:已 redact 文本(U4);长 body 折叠「展开全文」;`system` 类(orchestrator)用整条中性灰底 + ⚙,刹车/合并冲突高亮(§3.5)。
- **files**:`FilePatch[]`(02 §4)渲染成芯片,`changeKind` 用 `[A]/[M]/[D]/[R]` 前缀;点击跳 Diff tab 对应文件;`isBinary` 芯片标「⬚二进制」不可展开 diff。
- **evidence**:`EvidenceItem[]`(02 §3)三锚点结构化呈现,核验态色标(§3.1);`file_ref` 带「跳转 diff 行」联动右侧 Diff(§9.4);`command` 展示 cmd/expected/actual/exitCode + matchMode;`spec_quote` 展示 source/quote/locator。**evidence 永不渲染成自由文本块**(U5)。

### 3.5 system 消息的高亮(刹车 / 合并冲突 / 打回)

`kind:'system'`(from 必为 orchestrator,02 C7)是中枢的「裁判播报」,需最高视觉优先级:

| system 子情形(由 body / 关联错误码区分) | 渲染 |
|---|---|
| 刹车触发(ROUND_LIMIT / TOKEN_BUDGET / CONVERGENCE_STALL) | 整条红/棕底 + ⛔/⏱,顶栏状态点同步变 |
| worktree 合并冲突硬停(worktree 文档 R7 / arch 01 §4.4:冲突→`paused` 挂起等裁决,非终态) | 红底 ⛔ + 「冲突文件列表」+「等待人工裁决」提示,联动 Diff tab 显示冲突 |
| evidence 打回 / 注入拦截(02 §8.4 / 安全文档 08 §4) | 琥珀底 ⚑/🛡 +「第 k 次打回,原因 `<code>`」,计入 RoundRail 的「无效发言」计数 |
| inject 回执 / 校验失败(§6) | 绿底 ✎(已入板)或 红底(校验失败,未入板) |

### 3.6 不可信内容渲染与 XSS 防御(吃掉红队 RS-B2 blocker / RS-m2)

> **威胁(红队 RS-B2,blocker)**:面板渲染的几乎所有文本都是 **agent 原始输出**(被注入或自身产出),经中枢 redact 后直送前端。redact 只替换 secret 特征(`sk-` 等),**不转义 HTML**——`<script>`/`<img onerror>`/`[x](javascript:…)` 原样放行。面板源站(127.0.0.1)与 `ws-ticket` 端点同源,且面板是**唯一持 `control` scope 的实体**:一旦脚本在面板上下文执行,即可代发 `pause`/`abort`/`inject`,或 `fetch('/runs/:id/ws-ticket',{method:'POST'})` 抢 control 票据。**注入由「喂对面 agent」换道成「喂持控制权的人类浏览器」**,而 08 内容防火墙只防前者(§4.9 T13 自认作用域仅黑板→对面 prompt)。本节是面板侧对这条受害面的硬防御(U8)。

**D1 默认纯文本,不开 HTML 通道。** 所有 agent 来源字段默认走 React 文本节点(`{text}` / `textContent`),**不用** `dangerouslySetInnerHTML`、不用 `innerHTML`、不 `v-html` 类等价物。气泡 `body`、evidence `quote`/`source`/`locator`、`FilePatch.path`/`renamedFrom`、`diff_ready.files[].path`、`tool_call.argsDigest`、`error`/`system` 的 `reason`/`message`——**无一例外**。React 默认对文本子节点转义,这是第一道焊死。

**D2 markdown(若启用)严格收口。** body 若要 markdown 渲染(列表/代码块提升可读性),必须:
- 关 raw HTML(`marked{ sanitize 已废→改用渲染后 DOMPurify }` / `markdown-it({ html:false })`);
- **链接协议白名单**:仅 `http`/`https`/`mailto`,显式拒 `javascript:`/`data:`/`vbscript:`/`blob:`;`<a>` 强制 `rel="noopener noreferrer"` + `target` 受控;
- 渲染产物再过 **DOMPurify**(白名单标签集:`p/span/strong/em/code/pre/ul/ol/li/a/br/blockquote`,禁所有事件属性 `on*`、禁 `style`、禁 `srcset`、禁 `<svg>`/`<math>`/`<iframe>`/`<object>`/`<embed>`/`<form>`);
- 代码块只渲染纯文本 + 语法高亮(高亮器对 token 做 `textContent`,不注入 HTML)。
- ⚠ 默认建议:**body 先上纯文本 + 等宽换行保留**,markdown 作为可关闭增强项;markdown 渲染链一旦引入即是 XSS 高发区,默认关、按需开并全程消毒。

**D3 strict CSP(纵深防御,即便 D1/D2 漏了也兜底)。** 面板 HTML 响应头(由 Vite 预览/部署层或中枢静态服务注入):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';                 /* 禁 inline、禁 eval;打包产物全走外链 self */
  style-src  'self' 'unsafe-inline';  /* CSS-in-JS 需要;若用纯 CSS Modules 可去 unsafe-inline */
  img-src    'self' data:;            /* data: 仅图标;不放 http 外链图,杜绝 onerror 外发探测 */
  connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:*;  /* 只许连本机 WS + 同源 REST */
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self';
```

- `script-src 'self'` + 无 `'unsafe-inline'`/`'unsafe-eval'`:即便注入了 `<script>` 或 inline handler 也不执行;
- `connect-src` 锁本机:即便脚本跑起来也**发不出**外联请求(堵 exfil 出口,与 08 沙箱断网思路同构,在浏览器侧再设一道);
- `frame-ancestors 'none'`:防点击劫持把面板嵌进 evil 页;`base-uri 'none'`:防 `<base>` 改相对 URL 基址劫持 ticket 请求。
- 【待实测】CSP 与 Vite dev HMR(需 inline/eval)的兼容:dev 模式可放宽,**生产/默认构建必须严格**;实现期验证 HMR 与严格 CSP 的取舍(dev 用宽 CSP + 显式标注,prod 收紧)。

**D4 短「元数据」字段不豁免(红队 RS-m2)。** 实现者最易把文件名、`argsDigest`、`locator`、`source`、`reason` 当「安全短串」直接拼 DOM——它们**同样 agent 可控**。面板统一一个 `<Untrusted text={…}/>` 文本组件渲染**一切** agent 来源串,**没有**「这字段看起来无害就 innerHTML」的特例。属性注入面同样守:agent 串**绝不**进 `href`/`src`/`style`/`title` 等属性的拼接(只进 `textContent`);确需做属性的(如 `<a href>` 用于 spec_quote 的 `source` URL)先过 D2 协议白名单。

**D5 与 redact 正交、互补,不替代。** U4 的 redact 防的是**密钥泄漏**,U8/本节防的是**脚本执行**——两类威胁正交:redact 把 `sk-ant-…` 抹了但 `<script>` 原样放行,本节把 `<script>` 转义了但不管它内容是不是密钥。**两道都要**,前端**不做** redact 的二次扫描(U4:前端不可信、且跨帧拼接后扫描与中枢占位符规则脱节,见 RS-M1)。

> **测试锚点**:§12 W28(body 含 `<script>`/`onerror` → 纯文本呈现不执行)、W29(markdown `[x](javascript:…)` → 链接被中和)、W30(文件名/argsDigest 含标签 → 转义)、W31(CSP 头存在且 `connect-src` 锁本机)。这条 blocker 的验收必须有自动化用例,不能只靠 review。

## 4. WS 帧的 UI 消费层(线格式引用 WS 协议 11,本文只定义「收到后怎么办」)

> **边界焊死(v2 / R1)**:帧信封 `WsEnvelope`、server→client 帧 union(`message`/`round_planned`/`round_closed`/`status`/`usage`/`diff_ready`/`delta`/`tool_call`/`snapshot`/`diff_chunk`/`pong`/`control_ack`/`error`/`batch`)、client→server 帧 union(`hello`/`subscribe`/`unsubscribe`/`ping`/`pause`/`resume`/`abort`/`inject`)、`seq`/`cid` 语义、连接生命周期状态机、关闭码表、`replayBuffer` 断点续传、背压降级——**全部权威定义在 WS 协议 11**(`@sylux/server/src/ws-frames.ts`)。本文 §4 **不复制任何帧 zod**,只 `import type { ServerPayload, ClientPayload, WsEnvelope, ... } from '@sylux/server'`,并定义面板**消费**这些帧的逻辑:去重门、合流 reducer、resync 触发、流式聚合、帧→store 映射、帧→渲染映射。任何帧字段以 11 为准,本文与 11 不一致时**以 11 为准**(本文需回填)。

### 4.1 连接握手与生命周期(UI 视角;机制本体引用 11 §5)

握手方向**以 11 §5.2 为准**:`hello` 是 **client 首帧**(携带一次性 token),server 校验通过后直接推 `snapshot`,**没有** server 主动发的 `hello` 帧(v1 本文画反了,已更正)。面板侧时序:

```
浏览器(@sylux/web)                       中枢(RestApi + WsHub @sylux/server)
  │  ① POST /runs/:id/ws-ticket ─────────► RestApi 签发 WsTicket(安全 08 §5.2)
  │  ◄── { token, scope, runId, expiresAt }   (token 一次性、短时效、绑 runId+scope)
  │
  │  ② WS Upgrade(带 Origin 头)──────────► WsHub 校验 Origin 白名单(安全 08 §5.1)
  │     token 不进 URL(走 ③ 首帧)            非白 → close 4403(11 §5.4)
  │  ◄── 101 Switching Protocols ──────────  进入 AWAIT_HELLO
  │
  │  ③ ──► hello{ token, protocolVersion, ── WsHub 校验 token(存在/未过期/未用/runId 匹配,
  │         subscribe:[runId], cursor? }       08 §5.2)+ 版本(不兼容→close 4400)
  │                                            token 一次性,校验即作废
  │  ◄── snapshot{ seqWatermark, full|delta } 全量 BoardState 投影(02 §10,已 redact)
  │                                            或自 cursor 的增量(11 §6.3)
  │  ◄── (之后)message|round_*|status|… ──── 按 seq>watermark 持续推广播帧
  │  ◄══► ping/pong(应用层校时 + 探活,11 §1.3)
```

- **重连游标**:面板持久化 `Map<runId, lastSeq>`,重连时放进 `hello.cursor`(11 §6.2),让 server 优先增量补帧而非全量 snapshot。游标推进规则见 §4.3。
- **多 run 单连接**:11 §2.2 允许一条 WS 观战多 run(面板切 tab 不重连),运行中发 `subscribe`/`unsubscribe`。每 run 独立 `seq` 序列,故面板游标必须按 `runId` 分桶。⚠ 票据 scope 是否可跨多 run 见 §13 openQuestion(与 11 同一悬置项)。
- **控制命令**是上行帧,需 `control` scope(§4.5);`spectate` 连接发控制帧 → 中枢忽略 + 审计 + `close 4403`(安全 08 §5.3 / 11 W6)。面板 UI 在 spectate 下提前灰化控制区(§6.5),不发无效帧。

### 4.2 下行帧的 UI 消费映射(帧定义引用 11 §3,本文给「每帧 → 改哪个 store」)

面板**不重新定义**下行帧;以下是 11 `ServerPayload`(`payload.kind` 判别)各 kind 到面板 store 动作的映射表。所有帧已 redact(U4),广播帧(11 `BROADCAST_KINDS`)带单调 `seq`、点对点帧 `seq=0`(11 W1)。

| 11 帧 `kind` | 类别(11 §3.1/3.2) | 面板消费动作 | 写哪个 slice |
|---|---|---|---|
| `message` | 广播 | append 一条 `Message` 到 `messages`,按 `round` 归桶;若 `hasDiff` 显示 diff 入口(§9) | `boardStore.messages` |
| `round_planned` | 广播 | 预渲染 RoundRail「第 k 轮:谁(role)将发言」(11 含 `turns:[{from,role,execution}]`) | `boardStore.plannedTurns` |
| `round_closed` | 广播 | 关轮:填 `rounds[]`(含 `evidenceFingerprints`/`usage`),驱动收敛指纹面板;`hadConflict` 高亮 | `boardStore.rounds` |
| `status` | 广播 | 更新 `RunStatus` 状态点(§3.3);终态触发 U6 只读 | `boardStore.status` |
| `usage` | 广播 | 顶栏 token 累积条 + 预算进度;11 可带 `budgetFraction`(刹车算,面板只显示) | `boardStore.totalUsage`/`roundUsage` |
| `diff_ready` | 广播 | 标记某 message 的变更文件清单 + 各 `diffRef`(正文按需拉,§9.2) | `boardStore.diffIndex[messageId]` |
| `delta` | 广播(droppable) | 按 `(from,round)` 聚合到「正在输出」气泡(§4.4);**不进** `messages` | `boardStore.streaming` |
| `tool_call` | 广播(droppable) | 挂在进行中气泡下「它在干嘛」(`argsDigest` 已 redact) | `boardStore.streaming` |
| `snapshot` | 点对点 | 用 `full` 全量替换 board,或 `delta.frames` 增量补;`seqWatermark` 设新游标(§4.3) | 整个 `boardStore` |
| `diff_chunk` | 点对点 | diff 正文分块拼接(§9.4 纯 WS 备选路径) | `uiStore.diffCache` |
| `control_ack` | 点对点 | 按 `cid` 匹配回执:标记某次 pause/inject/abort「已受理」(≠已生效,§6.3) | `uiStore.pendingControls` |
| `pong` | 点对点 | 刷新心跳计时 + RTT/时钟偏移(时间轴用) | `BoardStream` 内部 |
| `error` | 点对点 | WS 层错误:`fatal` 决定重连或停;非致命(如 `DIFF_REF_EXPIRED`)仅提示(§4.7) | `uiStore.wsErrors` |
| `batch` | 点对点容器 | 展开内部 frames,按各自 `seq` 逐条套用上面规则(11 §7.3) | (展开后分发) |

> **evidence 核验态从哪来(⚠ 待回填,U5)**:面板要按 §3.1 给每条 evidence 标 ✓/○/✗,数据源是中枢 §8.3 `verifyEvidence` 的 `pass/weak/fail`。但 **02 `Message` 与 11 `message` 帧当前都不携带逐条 verdict**——`contentHash` 是中枢核验时派生回填到 `EvidenceItem`(02 §8.3),但「这条算 pass 还是 weak」的判定结果没有进任何线上字段。
> - **建议回填**(向后兼容,本文 §13 openQuestion + 提给 02/11):给 11 `sMessageSchema` 加可选旁路 `evidenceVerdicts?: { index:number; verdict:'pass'|'weak'|'fail'; note?:string }[]`,中枢广播 `message` 时附上 `verifyEvidence` 结果(已 redact 的 `note`)。这与 `contentHash` 同源(都是核验阶段产物),不破坏 02 的 `Message` 内存态。
> - **缺失时的降级(面板必须能跑)**:若帧无 `evidenceVerdicts`,面板按**保守推断**呈现——既然该 `message` 已入板(过了 02 §8.2 `validateMessage`),则 critic/critique 的 evidence **必至少有一条 pass**(C1),但具体哪条 pass 未知 → 全部标「待核验」灰态,只对结构上注定 weak 的(`spec_quote`、无 `quote` 的 `file_ref`)标 ○。`fail` 的 evidence 不会出现在已入板消息里(被打回了),其 fail 态只能从打回时的 `system` 消息(§3.5)看到。

### 4.3 seq 去重 / 顺序 / resync(机制本体引用 11 §6,本文给面板侧实现)

长会话 + 重连下要「不丢、不重、不乱」。**规则本体在 11 §6**(单调 `seq`、`replayBuffer` 窗、`resolveResume` 的 delta/full 决策、server 重启 seq 归零);面板侧只是 11 这套机制的客户端实现:

- **游标**:面板按 `runId` 维护 `cursor[runId] = lastSeq`(11 §6.2)。**只有广播帧**(11 `BROADCAST_KINDS`:message/round_planned/round_closed/status/usage/diff_ready/delta/tool_call)推进游标;点对点帧(snapshot/diff_chunk/pong/control_ack/error/batch 外层,`seq=0`)**不动游标**。
- **去重**:收到广播帧 `seq <= cursor[runId]` 直接丢弃(11 §6.3 的增量补帧可能与已收帧重叠)。
- **空洞检测**:收到广播帧 `seq > cursor[runId] + 1` ⇒ 有缺口 ⇒ 面板发 `subscribe{runId, cursor:lastSeq}`(11 §6.2 的主动 resync 路径)请求补缺;**不阻塞**继续应用后续帧,补帧到达后按 seq 去重合流。
- **resync 两种结果(11 §6.3 `resolveResume` 决定,面板兼容)**:
  - 缺口在 server `replayBuffer` 窗内 ⇒ server 回 `snapshot{delta:{fromSeq, frames}}`,面板按 seq 升序补、去重。
  - 缺口超窗 / server 重启 seq 归零 ⇒ server 回 `snapshot{full, resync:true}`,面板**整体重置** board 到该 full,丢弃旧增量,`cursor = seqWatermark`。
- **snapshot 合流**:收 `snapshot` ⇒ 若带 `full` 全量替换 board,`cursor = seqWatermark`;之后 `seq <= seqWatermark` 的滞后增量一律丢弃(U3)。

> ⚠ **droppable 帧不入 11 的 `replayBuffer`**(11 §6.3):`delta`/`tool_call` 重连后**不补**。面板逻辑因此要点:收到 snapshot 后,某轮的 `delta` 打字流缺口**不算空洞**——只要该轮 `message` 已到(或 snapshot 已含),就清掉该 `(from,round)` 的 streaming 暂存(§4.4),不去 resync 追打字过程(11 §10.2 焊死此语义)。

```ts
// 增量合流核心(boardStore reducer,§8.2)。frame 是 11 的 ServerPayload(import type 自 @sylux/server)。
// seq/去重/游标规则遵循 11 §6;此处只写面板侧 store 变更。
function applyServerPayload(p: ServerPayload, seq: number, runId: string, st: BoardSlice): BoardSlice {
  const isBroadcast = BROADCAST_KINDS.has(p.kind);           // 11 §3.3 导出的集合
  if (isBroadcast) {
    if (seq <= st.cursor[runId]) return st;                  // 去重(11 §6.3)
    if (seq > st.cursor[runId] + 1) requestResync(runId, st.cursor[runId]); // 空洞→subscribe(11 §6.2),不阻塞
  }
  switch (p.kind) {
    case 'snapshot':      return p.full ? resetFromSnapshot(st, p.full, p.seqWatermark, runId)
                                        : applyDeltaFrames(st, p.delta, runId);   // 11 §6.3
    case 'message':       return advance(appendMessage(st, p.message, p.hasDiff), seq, runId);
    case 'round_planned': return advance(setPlanned(st, p.round, p.turns), seq, runId);
    case 'round_closed':  return advance(closeRound(st, p.round, p.hadConflict), seq, runId);
    case 'status':        return advance(setStatus(st, p.status, p.reason), seq, runId); // 终态→U6
    case 'usage':         return advance(setUsage(st, p.totalUsage, p.roundUsage, p.budgetFraction), seq, runId);
    case 'diff_ready':    return advance(indexDiff(st, p.messageId, p.files), seq, runId);
    case 'delta':         return advance(applyDelta(st, p), seq, runId);          // §4.4 独立流式缓冲
    case 'tool_call':     return advance(pushToolCall(st, p), seq, runId);
    case 'diff_chunk':    return appendDiffChunk(st, p);     // 点对点,不动游标
    case 'control_ack':   return resolveControlAck(st, p);  // §6.3,点对点
    case 'error':         return pushWsError(st, p);         // §4.7,点对点
    case 'pong':          return st;                         // 心跳,BoardStream 内部处理
    case 'batch':         return p.frames.reduce((s, f) => applyServerPayload(f.payload, f.seq, runId, s), st);
    default:              return st;                         // 未知 kind:忽略+告警(§4.7)
  }
}
// advance:广播帧成功套用后推进 cursor[runId]=seq
```

### 4.4 流式 delta 的聚合与丢弃(U7)

`delta` 是子进程**未定稿**的流式输出,只为「观战时看到 agent 正在打字」。规则:

- 按 `(agent, round)` 聚合到一个**临时「正在输出」气泡**(`streamingBubbles[agent:round]`),`text` 持续 append。
- 该气泡**不进** `messages` 列表(不参与虚拟滚动的稳定项),单独渲染在时间线尾部「正在进行轮」区域。
- 对应的 `final_message`(经 02 `agentMessagePayloadSchema` 校验后,中枢盖章成 `Message` 广播为 `message` 帧)到达时:**丢弃**该 `(agent,round)` 的流式缓冲,改由稳定 `message` 气泡渲染。流式中间态不留(U7,省内存)。
- 若该轮 agent 报 `error`(02 §6.3,如 spawn 失败)而无 `final_message`:流式气泡转为「⚠ 本轮失败」占位,中枢另发 `system` 消息说明(§3.5)。
- **背压**:`delta` 高频(逐 token),面板对同一气泡的 append 用 `requestAnimationFrame` 节流批量刷新,避免每 token 一次 React render。
- **⚠ 流式帧的 spectate 门控(红队 RS-M1)**:中枢 redact 逐帧无状态,跨帧分片的 secret 在面板**前端拼接后可能明文重现**(`text` 持续 append 正是拼接动作,U4 残漏)。在中枢落地「跨帧滑窗 redact」前,面板**默认不向 `spectate` 连接渲染** `delta`/`tool_call`/`diff_chunk` 的实时流(只渲染落定后已整体 redact 的 `message`/diff 正文);`control` 连接可见但仍属已知残漏(横幅提示)。该默认值受 §13 openQuestion 10 的策略裁决控制(中枢可下发开关),面板按帧的 `scope` 适配渲染——**安全侧硬结论:流式原始流默认仅 control,且即便 control 也不保证无残漏**。拼接呈现的 `body` 文本永不进 D4 之外的 HTML 通道(U8/§3.6)。

### 4.5 上行帧的发送(帧定义引用 11 §4,需 control scope)

面板**不定义**上行帧 zod;以下是面板**发送** 11 `ClientPayload` 各 kind 的时机与关联约定。控制类(`pause`/`resume`/`abort`/`inject`)需 `control` scope(11 W6),`spectate` 发即被 `close 4403`。

| 11 上行帧 `kind` | 面板发送时机 | 关联键(11 §2.3) | 备注 |
|---|---|---|---|
| `hello` | 握手首帧(§4.1) | — | 带一次性 token + `subscribe` + 重连 `cursor` |
| `subscribe` | 切 tab 加 run / 空洞补帧(§4.3) | `cid` | 复用 11 §6.2 的 cursor 补帧路径 |
| `unsubscribe` | 关闭某 run 视图 | `cid` | 释放 server 发送状态 |
| `ping` | 校时 / 探活(免鉴权,11 §4.1) | — | 回 `pong{clientTime,serverTime}` |
| `pause` / `resume` | 控制栏按钮(§6.5) | `cid` | server 回 `control_ack{cid}` 受理(≠生效) |
| `abort` | 控制栏二次确认后 | `cid` | `reason?` 可带 |
| `inject` | 介入表单提交(§6.2) | `cid` | `payload` 是 02 `AgentMessagePayload` |

- **关联用 `cid`(11 §2.3),不是自造的 `clientToken`**:v1 本文发明了 `inject_ack` + `clientToken`——11 实际用 `cid`(client 生成的 correlation id,nanoid)关联请求与 `control_ack`。面板对每次控制帧生成 `cid`,把后续 `control_ack{cid}` 匹配回该次操作的 pending UI(§6.3),避免双击重发歧义。
- **`control_ack` 只表「已受理入队」**(11 §2.3),**不表**「已生效/已入板」。生效要等后续广播帧(pause→`status:paused`;inject→`message(from:human)` 或校验失败的 `system` 消息)。面板态机据此分两段(§6.3)。
- **resync 走 `subscribe{runId,cursor}`**(11 §6.2),不是 v1 自造的 `resync` 帧;`spectate` 也可发(纯补只读帧,无副作用)。

> ⚠ **inject 的 `role` 落点缺口(待回填)**:arch 01 §2.3 的 `ControlMsg.inject` 形如 `{kind:'inject', from:'human', role:Role, payload:AgentMessagePayload}`——`role` 在 `payload` **之外**(02 `AgentMessagePayload` 瘦子集**不含** `role`,见 02 §6.1)。但 11 §4.2 `cInjectSchema` 只有 `{kind:'inject', cid, payload}`,**没有 `role` 字段**。这是 11 与 01 的一处不一致:human inject 的 `role`(arbiter/critic/…)无处可放。**建议回填 11**:`cInjectSchema` 增 `role: roleSchema` 字段(引用 02),与 01 §2.3 对齐;在裁决前面板表单的 `role` 选择(§6.2)暂记 `uiStore`,待 11 补字段后随帧发送。见 §13 openQuestion。

### 4.6 心跳与掉线(机制引用 11 §1.3)

- 11 §1.3:server 周期发 WS 协议 ping(默认 15s),`pongTimeout`(10s)无 pong → `close 1001`;另有应用层 `ping`/`pong` 供校时。面板侧:周期发应用层 `ping{clientTime}`,收 `pong` 算 RTT/时钟偏移;若超时未收任何帧 ⇒ 判定掉线 ⇒ 进「重连」态(§7.3)。
- 重连需**重新取 ticket**(token 一次性,安全 08 §5.2):旧 token 已作废,面板向 RestApi 重签发再握手,`hello.cursor` 带各 run `lastSeq` 走 11 §6 续传。

### 4.7 前端帧守卫(轻量,非业务校验)

面板对**入站帧**做形状守卫(防中枢 bug / 篡改帧结构),但**不重做业务校验**(业务校验是中枢 `validateMessage` 职责,02 I2,面板信任已校验):

- 复用 **11 导出的解析器** `decodeServerFrame(raw)`(11 §3.4,两段式 safeParse:信封 → payload)校验 `WsEnvelope` + `ServerPayload` 形状;面板**不自写一份帧 zod**(否则又成 R1 第二权威)。
- `message.message` 信任 11 已 `safeParse`(11 §3.4)+ 中枢已 `validateMessage`;面板只读字段渲染,不重算 evidence 核验(U5)。
- 形状不合的帧(`decodeServerFrame` 返回 `ok:false`):丢弃 + 计数 + 控制台告警(不崩 UI);连续异常 ⇒ 顶栏「连接异常」提示并触发 resync(`subscribe{cursor}`)。这与 11 §11.1 server 侧 `protocolErrors` 熔断对称(面板侧的客户端镜像)。

## 5. 长会话虚拟滚动与增量合流(U7)

事实地基 D:N 轮辩论 token 累积/超线性,意味着**长会话是常态**(几十轮、上千条 message、每条带 body+files+evidence+可能巨型 diff)。时间线必须虚拟化,否则 DOM 爆炸。

### 5.1 虚拟化策略

- 用 `@tanstack/react-virtual` 的动态高度 virtualizer(`useVirtualizer`),`count = messages.length`(+ 尾部若干流式气泡作为额外项)。
- **变高项**:气泡高度因 body 长度 / files / evidence / 折叠态而异 ⇒ 用 `measureElement` 动态量高 + 高度缓存(`estimateSize` 给初值,实测后缓存,避免抖动)。
- **overscan**:上下各 5–8 项预渲染,平衡滚动平滑与内存。
- **稳定 key**:用 `message.id`(02 §5.1,nanoid 全局唯一)作 React key 和 virtualizer key,**绝不用 index**(增量 append 会让 index 漂移导致错位)。
- **diff 不进时间线虚拟项**:气泡里只放 files 芯片(轻);完整 diff 在右侧 DetailDrawer 懒加载(§9),避免单个虚拟项过重。

### 5.2 增量 append 与高度稳定

新 `message` 帧到达 ⇒ push 到 `messages` 尾部。virtualizer 需保证:

- 若用户在**底部跟随区**(距底 < 阈值,如 80px)⇒ append 后自动滚到底(跟随最新,§5.3)。
- 若用户在**上方查看历史**⇒ append **不**打断滚动位置:新项加到尾部,当前可视项的滚动偏移保持(virtualizer 按 id-key 维持锚定);仅「回到最新(N)」按钮的未读计数 +1。
- **顶部加载更早历史**:初连只 snapshot 全量(BoardState.messages 已是全量,02 §10),通常无需分页;但**超大 run**(数千条)可让中枢 snapshot 只带「近 K 条 + rounds 摘要」,面板向上滚拉更早段。⚠ 11 §6 的续传机制是**按 seq 向后补**(`cursor`→更大 seq),并无「向更早 seq 反向分页」的帧;若要顶部加载历史需 11/RestApi 另出能力(如 `GET /runs/:id/messages?beforeSeq=`)。【待实测】snapshot 是否需要分页取决于真实 run 规模,M0/实现期定;默认全量,超阈值再启分页(与 11 §6 同一悬置项,见 §13)。

### 5.3 滚动锚定与「回到最新」

```
时间线底部:
  ┌──────────────────────────────────────────────┐
  │ … 历史消息 …                                   │
  │ ⟦R6⟧ codex · proposer · propose   12:09       │ ← 用户停在这(查看历史)
  │ ……                                            │
  └──────────────────────────────────────────────┘
                                   [↧ 回到最新 (3) ●] ← 浮动按钮,3=未读新消息数,红点=有 system 高亮
```

- **自动跟随**:`followTail` 状态(默认 true)。用户手动上滚 ⇒ `followTail=false`,出现「回到最新(N)」浮动按钮;点按钮或滚回底部 ⇒ `followTail=true`,清未读计数。
- **强制打断跟随的高优先事件**:出现 `system` 刹车/合并冲突(§3.5)或 run 进终态时,即使 `followTail=false` 也**弹一个非阻塞 toast**(不强制滚动,尊重用户正在看历史),toast 点击跳到该 system 消息。
- **RoundRail 联动**:点 RoundRail 某轮 ⇒ 时间线滚到该轮首条 message(virtualizer `scrollToIndex`),并临时 `followTail=false`;高亮该轮所有气泡。

### 5.4 时间旅行 / 回放(终态 & 审计模式,U6)

run 终态后(或用户点顶栏「⎘审计」)进入回放模式:

- 数据源仍是同一份 board store(snapshot 投影);回放是**纯前端**对 `messages`/`rounds` 的「截止到第 k 轮」过滤渲染,**不重连、不回放 jsonl**(jsonl 回放是中枢能力,02 §7.3;面板只需已投影的 BoardState)。
- 时间轴拖动条:按 `round` 或 `ts` 定位;拖到第 k 轮 ⇒ 时间线只显示 `round <= k` 的消息,RoundRail 高亮,Diff/Evidence drawer 显示该轮快照。
- 回放模式下 ControlBar 全禁用(U6);可导出当前 run 的 jsonl 路径提示(实际文件在中枢 `runs/<runId>.jsonl`,02 §7,面板给路径不直接读盘)。

### 5.5 内存与 DOM 上界(U7 量化)

| 资源 | 上界策略 |
|---|---|
| DOM 节点 | 虚拟滚动:可视区 + overscan,与总消息数无关(常数级) |
| board store messages | 全量保留(回放需要);单条 message 体积有界(body 折叠不影响存储,diff 不存 store) |
| 流式 delta 缓冲 | 仅「进行中轮」的 `(agent,round)`,final 到达即丢(§4.4),常数级 |
| diff 文本 | 不进 store;按需从中枢拉(§9.2),LRU 缓存近 N 个文件 diff |
| 高度缓存 | 按 message.id 缓存,随 store 生命周期;run 切换即清 |

## 6. 人类介入(inject / pause / abort)如何影响下一轮

> 核心约束(arch 01 §2.3 + 安全文档 08 §5.3,面板侧镜像 U2):面板控制命令**不直接改黑板**,而是经 `WsHub`(需 control scope)投递 `ControlQueue`,由 `startControlPump` 在**相位边界**消费。`abort` 是唯一不等边界、立即穿透到 P4 子进程的命令(arch 01 §3.3)。面板的职责是「正确地发命令 + 如实反映命令被引擎消费后的结果」,**不预测、不本地模拟**引擎行为。
>
> **两段确认(对齐 11 §2.3)**:每个控制帧有两个时间点——① server 回 `control_ack{cid,accepted}` 表「已受理入队」(`accepted:false` 仅指受理失败,如 run 已终态/scope 不足);② 真正生效由后续**广播帧**体现(pause→`status:paused`;inject 入板→`message(from:human)`;inject 校验失败→`system` 消息,§6.3)。面板 UI 必须区分这两段,**不能**把 `control_ack{accepted:true}` 当成「已生效/已入板」。

### 6.1 三种介入的时序差异(面板必须如实呈现)

| 命令 | 引擎消费时机(arch 01 §2.3) | 面板 UI 表现(两段,§6.3) | 对「下一轮」的影响 |
|---|---|---|---|
| `pause` | P0/P8 相位边界;P4 进行中收到 → 等本次发言落 P6 再暂停(不杀子进程) | `control_ack` →「暂停请求中…」;`status:paused` 帧才变实心暂停 | 当前发言**照常完成**,下一轮 P0 前阻塞 |
| `resume` | paused 阻塞中 | `control_ack` → 等 `status:running` 帧恢复 | 从下一轮 P0 继续 |
| `inject` | P0/P8 边界,经 `validateMessage`(human evidence 同样核验)→ append(`from:'human'`) | `control_ack` →「介入待处理…」;`message(from:human)` 才标「已入板」,校验失败则收 `system` 打回(§6.3) | **入板的 human 消息成为下一轮 agent 的上下文**(§6.4) |
| `abort` | **任意相位**(经 signal,不等边界,arch 01 §3.3) | 二次确认 → `control_ack` →「中止中…」→ `status:aborted` | 全树取消,run 终结,无下一轮(U6 只读) |

> **关键诚实点**:`pause` 不是「立刻冻结」。若 P4 正在跑(agent 正在输出),面板必须显示「暂停将于本次发言结束后生效」,**不能**让用户以为子进程已停(它还在烧 token,直到本轮发言落 P6)。这是对 arch 01 §2.3「P4 进行中收到 pause → 等本次发言落 P6」的忠实 UI 表达,避免误导。
>
> **成本止血只有两档(红队 RS-m4)**:面板必须让用户明白——想**立即**停止烧 token,`pause` 做不到(要等本轮发言完,中转每轮 resume 仍累积计费,事实地基 D),唯一立即止血是 `abort`(但终结整个 run、丢进度)。即「松油门(pause,等本轮)」与「熄火(abort,丢一切)」之间**没有点刹**。`pause` 按钮的 pending 态文案显式标注「不会立即停止当前发言的 token 消耗,如需立即止血请用中止」,避免用户误以为按了 pause 就省钱。若中枢/04 未来提供「本 turn 到达 X token 即 cancel 本 turn 但保 run」的中间档(RS-m4 要求),面板再补对应控制项;在此之前不假装有点刹。

### 6.2 inject 表单(人工插一条黑板消息)

inject 是唯一让 `from:'human'` 进黑板的通路(arch 01 §2.3),且**照样过 02 `validateMessage`**(human 也可能粘错路径 / 伪造 evidence / 带注入文本 —— 安全文档 08 §5.3 / S5:inject 内容也过内容防火墙 `firewallPeerMessage`)。表单据此设计:

```
┌─ 介入(inject) ─ 以 human 身份插入一条黑板消息 ───────────────────────┐
│ role: [arbiter ▾]     kind: [question ▾]                               │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ body: 你俩在 authGuard 的 OPTIONS 放行上还没达成一致,先把测试跑通  │ │
│ │       再继续。                                                      │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│ files(可选,声明意图,路径将过 worktree 白名单)  [+ 添加]              │
│ evidence(可选;若 role=critic/kind=critique 或 ack(done) 则必填可核验) │
│   [+ file_ref] [+ command] [+ spec_quote]                              │
│   ▣ file_ref  src/auth.ts:14-22   (hash 由中枢复算,前端不填)           │
│ ───────────────────────────────────────────────────────────────────── │
│ ⚠ 内容会经内容防火墙扫描 + validateMessage 校验,失败则不入板          │
│                                          [取消]  [提交介入 ▸]          │
└────────────────────────────────────────────────────────────────────────┘
```

字段规则(全部引用 02,前端只做**输入辅助**,权威校验在中枢):

- `role` / `kind`:下拉选 02 §2 枚举值。前端做**前置软提示**(不是硬校验):选了 `critic` 或 `critique` 或「ack 一条 done」⇒ 提示「evidence 必填且需可核验(02 C1/C2)」,evidence 为空时提交按钮置灰+提示,但**最终判定以中枢回执为准**(`control_ack` 受理 + 后续 `message`/`system` 结果,§6.3;前端校验只为体验,U5 不替代中枢)。⚠ `role` 的线上落点见 §4.5 缺口(11 `cInject` 暂无 `role` 字段,待回填)。
- `body`:自由文本;前端可选做**注入特征预扫描软提示**(安全文档 08 §4 `INJECTION_RULES` / `SECRET_SIGNATURES` 的镜像,纯提示「这段含疑似注入/密钥关键词,可能被防火墙降级/拦截」),但**不前端拦截**——拦不拦是中枢防火墙 `firewallPeerMessage` 的权威决定(S5)。
- `files`:`FilePatch`(02 §4)输入;`changeKind=rename` 时 `renamedFrom` 必填(前端软提示 C5)。
- `evidence`:三锚点表单。**`file_ref.contentHash` 前端不填**——由中枢读 worktree 区间复算(02 §8.3);前端只填 path/行区间 + 可选 `quote`(02 §3:有 `quote` 才可能达「强」核验)。`command` 填 cmd/expected/actual/matchMode/exitCode(但未被中枢沙箱实跑前只算 weak,02 §3.2)。这样人也无法伪造 hash / 自证 command。
- 提交 ⇒ 发 11 `inject` 帧 `{kind:'inject', cid, payload}`(§4.5;`role` 落点待回填)。payload 是 `AgentMessagePayload`(02 §6.1 瘦子集:`{kind,body,files,evidence,inReplyTo?}`),`id/runId/round/seq/from/ts` 由中枢盖章(02 §5.1 / I7),**human 无法伪造身份/轮次/时间/排序**。

### 6.3 inject 的端到端时序(发起 → 入板 → 影响下一轮)

```
面板(control)        WsHub            startControlPump        Engine(P0/P8)     validateMessage/firewall  Blackboard        Adapter(下一轮)
  │ ✎ 填表提交         │                    │                      │                   │                 │                │
  │─inject{cid,        │                    │                      │                   │                 │                │
  │  payload}─────────►│ scope=control?✓    │                      │                   │                 │                │
  │                    │─ControlFrame{inject}►│ enqueue ControlQueue│                   │                 │                │
  │ ◄─control_ack{cid, ─│ (受理,≠生效,11 §2.3)                    │                   │                 │                │
  │   accepted:true}   │                    │                      │                   │                 │                │
  │ [介入待处理…]      │                    │                      │ 到达相位边界 ◄────│                 │                │
  │                    │                    │ pump.next()─────────►│ 取出 inject       │                 │                │
  │                    │                    │                      │─firewall+validate►│ 防火墙(08 §4)+ │                │
  │                    │                    │                      │                   │ 结构+路径白名单+│                │
  │                    │                    │                      │                   │ evidence 核验   │                │
  │                    │                    │                      │ ◄──ok / !ok───────│                 │                │
  │                    │                    │                      │  ok: append(human)──────────────────►│ 落jsonl→广播   │
  │ ◄═══ message 帧(from:human, seq++)══════════════════════════════════════════════════════════════════════│ (seq++)        │
  │ [✎ 已入板 R6]      │                    │                      │                   │                 │                │
  │                    │                    │                      │ 下一轮 P1 plan:   │                 │                │
  │                    │                    │                      │ playbook.nextTurn │                 │                │
  │                    │                    │                      │ 把 human 消息纳入 │                 │                │
  │                    │                    │                      │ contextFor(delta) │                 │── 喂给下一轮 ──►│
  │ ◄═══ 下一轮 agent 发言(回应了 human)═══════════════════════════════════════════════════════════════════│ (P4 delta…)    │
```

失败路径(防火墙/校验不过,arch 01 §2.3 RT3:不入黑板,回一条 system 说明):

```
  │─inject{cid,payload}►│──►│─►│ firewall/validateMessage !ok (EVIDENCE_REQUIRED / WORKTREE_PATH_VIOLATION / 注入拦截 …)
  │ ◄─control_ack{cid, accepted:true} ──────────  (受理成功:已入队;校验是入队后在引擎做的)
  │ ◄═══ system 消息(from:orchestrator, kind:system,body:"inject 被拒:<code>")══ 广播帧 ════════
  │ [✎ 介入被拒:critic 需可核验 evidence] ← 表单保留草稿,高亮缺失项,可改后重发(新 cid)
```

- **两段语义(对齐 11 §2.3,不可混)**:
  1. `control_ack{cid, accepted}`——`accepted:true` 仅表「已入 `ControlQueue`」;`accepted:false` 仅表**受理**失败(run 已终态、scope 不足——后者其实已 `close 4403`)。**校验在受理之后**(引擎相位边界才 `firewallPeerMessage`+`validateMessage`),故 `control_ack` **永远不带校验结果**。
  2. 真正结果是后续**广播帧**:入板成功 → `message(from:human)`(面板据此标「已入板 R{k}」);校验失败 → 中枢一条 `system` 消息说明(arch 01 §2.3「校验失败→回 08 报错,不入黑板 RT3」;面板按 §3.5 红底呈现「第 k 次打回,原因 `<code>`」)。
- ⚠ **失败回执的关联缺口(待回填)**:成功路径的 `message(from:human)` 与失败路径的 `system` 消息都是**广播帧,不带 `cid`**(11 §2.3:`cid` 只在 client 请求↔`control_ack` 间关联)。面板**无法用 `cid` 把广播结果精确匹配回是哪次 inject 草稿**——尤其并发多次 inject 或失败 `system` 消息时,只能靠启发式(时间相邻 + 当前唯一 pending draft)。**建议回填**:让 inject 产生的 `message`/失败 `system` 在 02 `Message` 上带一个可选 `causedByCid?`(或把发起 `cid` 塞进 `system` 消息 body 的结构化字段),供面板精确闭环。在回填前,面板侧兜底:**同一时刻只允许一个 pending inject**(提交后禁用按钮直到收到 `control_ack` + 一条 human `message` 或 `system` 回执),牺牲并发换取确定性匹配。见 §13 openQuestion。
- **幂等**:面板对每次提交生成唯一 `cid`(11 §2.3),双击不重发(按钮禁用);中枢是否按 `cid` 去重 inject 见 11 §13 同名悬置项——在其落地前,面板「单 pending + 禁用按钮」是去重的实际保证。

### 6.4 inject 对「下一轮上下文」的影响(为什么能改变走向)

- inject 入板后是一条普通 `Message`(`from:'human'`,02 §5),进 `messages` / 当前 `round` 桶。
- **下一轮 P1**(arch 01 §2.1)`playbook.nextTurn(view)` 看到的 `BoardView` 含这条 human 消息;**P2 `contextFor`** 算 delta 时会把它纳入喂给下一轮 agent 的上下文(provider 文档 07 的上下文构造)。
- 因此 human 的 `question`/`arbiter` 裁决/补充 `spec_quote` evidence,会成为下一轮 codex/claude 的输入,**真实改变辩论走向**(如人裁定「按需求 §4.2 必须放行 OPTIONS」,下一轮 critic 的攻防焦点随之转移)。
- **面板不预测这个影响**——它只如实显示「human 消息已入板(R6)」,下一轮 agent 如何回应由引擎+子进程决定,面板等 `message` 帧呈现结果(U1 纯投影)。

### 6.5 控制栏状态机(按钮可用性)

```
run.status     │ pause │ resume │ inject │ abort │ 说明
───────────────┼───────┼────────┼────────┼───────┼──────────────────────
running        │  ●    │   ○    │   ●    │   ●   │ 可暂停/介入/中止
 └ ack-pending  │  ○    │   ○    │   ○    │   ●   │ 控制帧已发未收 control_ack,等受理
 └ pause-pending│  ○    │   ○    │   ○    │   ●   │ 已受理,等 status:paused 广播帧(§6.1)
paused         │  ○    │   ●    │   ●    │   ●   │ 可恢复/介入(边界已停,inject 下一轮生效)
conflict-paused│  ○    │   ●    │   ●    │   ●   │ 合并冲突挂起(arch 01 §4.4),等 resume/inject 裁决或 abort
done/stalled/  │  ○    │   ○    │   ○    │   ○   │ 终态全禁用(U6),进回放模式
 aborted/limit │       │        │        │       │
scope=spectate │  ○    │   ○    │   ○    │   ○   │ 观战只读,控制区整体灰化+「需 control 权限」
```

- `abort` 始终需**二次确认**(不可逆,arch 01 §3:全树取消 + finalize);确认弹窗说明「将立即杀掉两个子进程并终结 run,不可恢复」。
- scope=spectate:控制区整体灰化,hover 提示「当前为观战连接,控制需 control 票据」(安全文档 08 §5.3),不发任何上行控制帧(发了也被 `close 4403`,11 W6)。
- **`conflict-paused` 是 `paused` 的子情形**(arch 01 §4.4:`WORKTREE_CONFLICT` → `setStatus('paused')` 挂起等裁决,**非终态**):面板按 `paused` 处理(可 resume/inject/abort),但 system 消息高亮冲突(§3.5),提示「需人工裁决冲突后 resume」。

## 7. 前端组件拆分

### 7.1 组件树

```
<App>                                   // 路由 / run 选择 / 全局 error boundary
└─ <RunView runId>                      // 一个 run 的容器;持有 BoardStream + ControlClient(§8)
   ├─ <ConnectionGate>                  // 取 ticket→hello 握手→snapshot;掉线重连态(§4.6/§7.3)
   ├─ <TopBar>                          // 状态条
   │  ├─ <RunMeta>                      //   runId/playbookId(只读)
   │  ├─ <StatusPill>                   //   RunStatus 状态点(§3.3)
   │  ├─ <RoundProgress>                //   round k/maxR + 进度
   │  ├─ <TokenBudgetBar>               //   累积 token / 预算(事实地基 D)
   │  ├─ <EgressWarning>                //   第三方中转告警 + 切直连(安全 08 §7.1)
   │  └─ <ConnBadge>                    //   scope + ws 连接态 + spectators(若 11 出 presence,见 §13)
   ├─ <MainGrid>                        // 三栏布局(响应式塌成 tab,§2.2)
   │  ├─ <RoundRail>                    //   左:轮数导航 + 收敛指纹面板
   │  │  ├─ <RoundItem round>           //     单轮(点击 scrollToIndex,§5.3)
   │  │  └─ <ConvergencePanel>          //     newFingerprintCount / stallCount(§4.2 round_closed)
   │  ├─ <Timeline>                     //   中:虚拟滚动主区(§5)
   │  │  ├─ <VirtualList>               //     @tanstack/react-virtual
   │  │  │  └─ <MessageBubble message verdicts>  // 单条气泡(§3.4);memo
   │  │  │     ├─ <BubbleHeader>        //       from/role/kind/ts/reply 锚(角色名等经 <Untrusted>)
   │  │  │     ├─ <BubbleBody>          //       body 经 <Untrusted>/markdown 消毒链(§3.6),折叠
   │  │  │     ├─ <FilePatchChips>      //       FilePatch[]→芯片;路径经 <Untrusted>(§3.6 D4)
   │  │  │     └─ <EvidenceList>        //       EvidenceItem[] 结构化 + 核验色标(§3.1/U5);quote/source/locator 经 <Untrusted>
   │  │  ├─ <StreamingBubble>           //     进行中轮的 delta 聚合气泡(§4.4)
   │  │  └─ <JumpToLatest unread>       //     回到最新(N)浮动按钮(§5.3)
   │  └─ <DetailDrawer>                 //   右:tab 抽屉
   │     ├─ <DiffTab>                   //     diff 查看器(§9);懒加载 + 降级
   │     ├─ <EvidenceTab>               //     选中气泡 evidence 详情 + 跳转联动(§9.4)
   │     └─ <SessionTab>                //     agent 会话态(sessionId/resumable,从 BoardState.agents 投影,§4.2 注)+ provider 脱敏视图
   ├─ <ControlBar>                      // 底:控制栏(§6.5)
   │  ├─ <PauseResumeBtn>               //   pending 态处理(§6.1)
   │  ├─ <InjectButton>                 //   打开 <InjectDialog>
   │  └─ <AbortButton>                  //   二次确认
   ├─ <InjectDialog>                    // 介入表单(§6.2);提交→ControlClient
   ├─ <ReplayBar>                       // 终态/审计:时间旅行拖动条(§5.4)
   └─ <ToastHost>                       // system 高亮 / inject 回执 / 掉线 等非阻塞提示
```

### 7.2 数据流与职责边界

| 组件 | 读什么 | 写什么 | 备注 |
|---|---|---|---|
| `<RunView>` | — | 创建 `BoardStream`/`ControlClient`(§8),注入 context | 唯一持有连接生命周期 |
| `<ConnectionGate>` | 连接态 | 触发取 ticket / 重连 | 鉴权流程在此,不散落 |
| `<Timeline>`/`<MessageBubble>` | `boardStore`(messages + verdicts) | — | 纯展示,memo by message.id |
| `<RoundRail>` | `boardStore`(rounds) | `uiStore`(selectedRound, followTail) | 点击改 UI 态,不改 board |
| `<DiffTab>` | 按需拉 diff(§9.2) | `uiStore`(选中文件/diff 缓存) | diff 不进 boardStore |
| `<InjectDialog>` | `uiStore`(草稿) | `ControlClient.inject(...)` | **不直接写 boardStore**(U2);等帧回流 |
| `<ControlBar>` | `boardStore.status` + scope | `ControlClient.{pause,resume,abort}` | 按钮可用性由 status+scope 派生(§6.5) |
| `<ReplayBar>` | `boardStore`(全量) | `uiStore`(回放游标) | 纯前端过滤,不重连(§5.4) |

- **memo 边界**:`<MessageBubble>` 用 `React.memo` + 稳定 props(message 引用不变即不重渲染);`boardStore` 用细粒度 selector(§8.3),避免一条新 message 触发整列表重渲染(只有虚拟可视项 + 列表长度变化项重渲)。
- **context 传递**:`BoardStream`/`ControlClient` 经 React context 提供,组件用 hook(`useBoard()`/`useControl()`)取,不 prop-drilling。

### 7.3 连接态 UI(`<ConnectionGate>`)

```
连接生命周期(§4.1/§4.6,机制本体 11 §5)→ UI:
  ticketing   →  「正在获取连接票据…」(骨架屏;REST 取 WsTicket)
  handshaking →  「握手中…」(已 Upgrade,正发 hello 首帧)
  authed      →  hello 校验通过(等 snapshot)
  syncing     →  顶栏「同步中…」(snapshot / delta 补帧未到)
  open(synced)→  正常渲染 RunView
  reconnecting→  顶栏黄条「连接中断,重连中…(第 n 次)」;时间线置灰但保留已有内容(不清屏)
  failed      →  「连接失败:<原因>」+「重试」按钮(ticket 过期 4401 / Origin 拒绝 4403 / 版本 4400)
  closed-fatal→  error 帧 fatal=true 或 close 1000(正常关停):全屏说明 + 不自动重连(如 run 已被别处 abort)
```

- 重连**不清空** board store(保留 `cursor`),重连成功走 §4.3 / 11 §6 续传补帧;只有收到带 `full` 的 `snapshot` 才整体替换(§4.3)。
- 关闭码语义以 11 §5.4 为准:`1000` 正常不重连;`1001`/`4413` 重连续传;`4401` 重新取 ticket 再连;`4403`(Origin)配置错不重连、(scope)降级只读;`4400` 提示升级面板。鉴权类失败给明确文案,引导重新取 ticket(token 一次性,安全 08 §5.2)。

## 8. 「只读黑板」与「发命令」的解耦(U2 核心)

面板对黑板是**只读投影 + 命令生产**两条独立通路。物理上拆成两个模块,二者**不互相 mutate**,只通过中枢闭环连接:

```
        ┌─────────────────────────────────────────────────────────────┐
        │                       <RunView> context                       │
        │                                                               │
        │   ┌───────────────┐                  ┌────────────────────┐    │
   WS下行│   │  BoardStream  │                  │   ControlClient    │    │WS上行
  (只读) │──►│ (订阅+合流)   │                  │ (命令发送+回执跟踪) │──►│(控制帧)
        │   └──────┬────────┘                  └─────────┬──────────┘    │
        │          │ 写                                   │ 只发,不写 board│
        │          ▼                                      │               │
        │   ┌───────────────┐      读        ┌───────────▼──────────┐    │
        │   │  boardStore   │◄───────────────│  组件(ControlBar/    │    │
        │   │ (zustand,只读)│                │   InjectDialog)      │    │
        │   └───────────────┘                └──────────────────────┘    │
        │          ▲ 读                                                   │
        │   ┌──────┴────────┐                                            │
        │   │   uiStore     │  本地 UI 态(滚动/选中/草稿/回放游标)        │
        │   └───────────────┘                                            │
        └─────────────────────────────────────────────────────────────┘

闭环:ControlClient 发 inject/pause/abort → 中枢处理 → 结果作为「下行帧」回流 →
      BoardStream 写 boardStore → 组件读到变化。ControlClient 永不直接写 boardStore。
```

### 8.1 三个状态容器(职责严格分离,U1)

| 容器 | 类型 | 内容 | 谁写 | 谁读 | 生命周期 |
|---|---|---|---|---|---|
| `boardStore` | zustand | BoardState 投影:messages / rounds / status / agents / usage / plannedTurns / diffIndex / streaming / `cursor:Map<runId,seq>` | **仅** `BoardStream`(WS 下行) | 全展示组件 | 随 run;resync full snapshot 整体替换 |
| `uiStore` | zustand | 滚动位置 / followTail / selectedRound / selectedFile / inject 草稿(含 role) / pendingControls(cid→态) / 回放游标 / diffCache / wsErrors | UI 组件 | UI 组件 | 随 run;不持久化到黑板 |
| `connState` | BoardStream 内部 | 连接态 / cursor / 重连计数 / pending resync(cid) | BoardStream | `<ConnectionGate>` | 随连接 |

> **U1 焊死**:`boardStore` 是 BoardState 的**只读镜像**,只有 `BoardStream` 这一个写者(对应中枢 RT5「单写者」在前端的镜像:前端 board 也单写者)。任何组件、`ControlClient`、`uiStore` 都**不得**写 `boardStore`。inject 后的乐观 UI?**不做乐观写**——等真实 `message` 帧回流(§6.3),保证面板显示的永远是黑板权威态,不出现「面板显示已插入但其实被校验/防火墙拒了」的假象。
>
> 注:evidence 逐条核验态(verdicts)不单列容器——若 11 回填 `message.evidenceVerdicts`(§4.2),它随 `message` 进 `boardStore.messages`;未回填则按 §4.2 降级推断,无独立存储。

### 8.2 BoardStream(只读订阅 + 合流)

```ts
// @sylux/web/src/board-stream.ts
// 帧类型 import type 自 @sylux/server(11 §3/§4);decodeServerFrame 复用 11 §3.4。
import type { WsEnvelope, ServerPayload, ClientPayload } from '@sylux/server';
import { decodeServerFrame, BROADCAST_KINDS } from '@sylux/server';

export class BoardStream {
  private cursor = new Map<string, number>();   // runId → lastSeq(11 §6.2)
  constructor(
    private runId: string,
    private getTicket: (scope: 'spectate' | 'control') => Promise<WsTicket>, // 调 RestApi(安全 08 §5.2)
    private store: BoardStoreApi,   // 唯一被它写的 store
  ) {}

  async connect(scope: 'spectate' | 'control'): Promise<void> { /* §4.1:取 ticket → Upgrade → 发 hello 首帧 */ }

  /** 唯一入口:每个下行帧 → decode(11 §3.4)→ applyServerPayload(§4.3)→ 写 boardStore。其它模块不碰 store.write。 */
  private onMessage(raw: string) {
    const r = decodeServerFrame(raw);            // 11 §3.4 两段式 safeParse
    if (!r.ok) { this.onBadFrame(r.error); return; }  // §4.7 守卫:丢弃+计数+连续异常 resync
    const { env, payload } = r;
    this.store.setState((st) => applyServerPayload(payload, env.seq, env.runId, st)); // §4.3 reducer(内部推进 cursor)
  }

  private onClose(code: number) { /* §4.6 / 11 §5.4:按 close code 决定重连;重连重取 ticket,hello.cursor 带各 run lastSeq */ }
  requestResync(runId: string, lastSeq: number) { this.send({ kind: 'subscribe', cid: nanoid(), runId, cursor: lastSeq }); } // §4.3 / 11 §6.2

  // BoardStream 承载上行的「纯传输」职责,但命令语义由 ControlClient 决定(§8.3)。帧形状是 11 ClientPayload。
  send(up: ClientPayload) { /* 仅 control scope 可发控制类;spectate 仅 hello/ping/subscribe/unsubscribe */ }
}
```

### 8.3 ControlClient(命令发送 + 回执跟踪,不碰 board)

```ts
// @sylux/web/src/control-client.ts
import type { ServerPayload, ClientPayload } from '@sylux/server';

export class ControlClient {
  private pending = new Map<string, { kind: ClientPayload['kind']; at: number }>(); // cid → 发起记录
  constructor(
    private stream: BoardStream,         // 复用同一条 WS 发上行帧(物理一条连接,逻辑两职责)
    private scope: 'spectate' | 'control',
    /** control_ack 回调(11 control_ack 帧,点对点),按 cid 更新 uiStore.pendingControls 受理态 */
    private onAck: (ack: Extract<ServerPayload, { kind: 'control_ack' }>) => void,
  ) {}

  pause()  { return this.fire({ kind: 'pause', cid: nanoid() }); }
  resume() { return this.fire({ kind: 'resume', cid: nanoid() }); }
  abort(reason?: string) { return this.fire({ kind: 'abort', cid: nanoid(), reason }); }

  /** inject:发命令 + 用 cid 跟踪 control_ack 受理;绝不写 boardStore(等 message/system 帧回流,§6.3) */
  inject(payload: AgentMessagePayload /*, role 待 11 回填后随帧带,§4.5 */): string {
    return this.fire({ kind: 'inject', cid: nanoid(), payload });
  }

  /** 统一发送:断言 scope、记 pending(cid)、发帧;返回 cid 供 UI 跟踪 pending(§6.5 ack-pending) */
  private fire(frame: Extract<ClientPayload, { cid: string }>): string {
    this.assertControl();
    this.pending.set(frame.cid, { kind: frame.kind, at: Date.now() });  // 匹配后续 control_ack{cid}
    this.stream.send(frame);
    return frame.cid;
  }

  private assertControl() {
    if (this.scope !== 'control') throw new Error('SPECTATE_NO_CONTROL'); // UI 早已灰化,这是兜底
  }
}
```

> **物理一条 WS,逻辑两职责**:`BoardStream` 与 `ControlClient` 共用同一条 WebSocket(省连接 + 同一鉴权上下文),但**代码职责分离**:`BoardStream` 拥有「下行→boardStore」的唯一写路径;`ControlClient` 只拥有「组件意图→上行命令帧」,**没有 boardStore 写权**。`control_ack`(11 点对点帧)虽是下行,但 `BoardStream` 收到后回调 `ControlClient.onAck` 去更新 `uiStore.pendingControls`(受理态,按 cid);命令**生效**则由后续广播帧(`message`/`system`/`status`)经 `BoardStream` 写进 `boardStore`——**core 数据进 boardStore,UI 回执/pending 态进 uiStore**,互不越界(§6.3 两段语义)。

### 8.4 React 订阅(useSyncExternalStore / zustand selector)

```ts
// 细粒度 selector,避免一条新 message 触发全树重渲(§7.2 memo 边界)
const messages   = useBoard((s) => s.messages);              // Timeline 用;长度变才重渲
const status     = useBoard((s) => s.status);                // ControlBar/StatusPill 用
const round      = useBoard((s) => s.currentRound);
const verdictsOf = (id: string) => useBoard((s) => s.messages.find((m) => m.id === id));  // 单气泡;verdicts 随 message(§4.2 若回填)
const totalUsage = useBoard((s) => s.totalUsage);            // TokenBudgetBar 用
// UI 态独立 store,改它不动 board
const followTail = useUi((s) => s.followTail);
const pendingCtl = useUi((s) => s.pendingControls);          // cid→受理/生效态(§6.3)
```

- `boardStore` 用 zustand 的浅比较 selector;`messages` 是稳定数组引用(append 用不可变更新,新引用),virtualizer 只对新增项与可视项做工。
- **绝不**把 `delta` 流式文本塞进 `messages`(§4.4):流式态单独放 `boardStore.streaming[agent:round]`,只有 `<StreamingBubble>` 订阅它,与稳定列表解耦(避免每 token 触发列表 diff)。

## 9. Diff 查看器(吸收红队 minor)

### 9.1 数据来源(diff 正文不由 agent 自填)

02 §4 焊死:**diff 正文不由 agent 声明**,由中枢从 worktree 实际 `git diff --find-renames` 生成(worktree 文档拥有)。面板的 diff 来源是中枢:11 `diff_ready` 广播帧(§4.2)带「哪条 message、改了哪些文件、各增删行、是否二进制、每文件一个 `diffRef` 拉取句柄」,正文按 `diffRef` **按需拉**(§9.2)。`Message.files`(FilePatch)只是**意图声明**(02 §4),面板用它做芯片导航,**不**用它当 diff 正文;`diff_ready.files[].diffRef` 才是拉正文的句柄。

### 9.2 懒加载(diff 不进 boardStore,U7;通道引用 11 §9)

- diff 正文**不随 message/diff_ready 帧下发**(会撑爆增量帧 + boardStore + 慢消费者,11 §9.1)。面板在用户点开某文件 diff 时按 `diffRef` **按需拉**。两条等价路径(11 §9,**倾向 REST**):
  - **REST(推荐,11 §9.3)**:`GET /runs/:runId/diff/:diffRef` → `200 text/x-diff`(unified diff,UTF-8,已 redact);`404` 句柄过期(`DIFF_REF_EXPIRED`);`413` 单文件超限(走分页/摘要)。走 HTTP 天然支持大 body + 浏览器缓存(`ETag=diffRef`)。
  - **WS `diff_chunk`(11 §9.4 备选)**:同 `diffRef` 分块推,`seqInRef` 升序拼接,`last:true` 收尾。会与广播帧争用同连接队列,故大 diff 优先 REST。
- LRU 缓存近 N 个 `diffRef` 的 diff 文本于 `uiStore.diffCache`,随 run 生命周期;切 run 即清。`diffRef` 过期(`404`/`DIFF_REF_EXPIRED`)⇒ 由该 message 的 `files` 提示「diff 已过期,可触发重新生成」(11 §9.2)。
- diff 文本同样**已 redact**(中枢出境前过 redact,安全 08 §3.2 / 11 W3;若经第三方中转还过 `guardEgress`,安全 08 §7.2)——面板信任已脱敏(U4)。

### 9.3 渲染与降级(总体规划 §8.3)

| 情形 | 渲染 |
|---|---|
| 普通文本 diff | `diff2html` / `react-diff-viewer-continued` 渲染 unified diff;支持 split/inline 切换 |
| 大 diff(超行数阈值,如 >2000 行) | **降级**:默认折叠,只显示文件名 + `+adds/-dels` 统计 + 「仍要渲染」按钮;渲染时 diff 行级虚拟滚动(§5 同款 virtualizer) |
| 二进制(`FilePatch.isBinary`,02 §4) | 不渲染文本:显示「⬚ 二进制文件,+N/-M 字节」+ 文件名 |
| rename(`changeKind=rename`) | 显示 `renamedFrom → path`,diff 为重命名 + 内容变更(`--find-renames`) |
| 合并冲突(worktree 硬停,§3.5;arch 01 §4.4 → paused 挂起) | 冲突文件特殊标记 ⛔,显示冲突区块(`<<<<<<< ours/theirs`),提示「等人工裁决,面板不自动选边」(worktree R7) |

> **diff 渲染的 XSS 守则(U8/§3.6,红队 RS-B2)**:diff 正文与文件名都是 agent 可控。① diff2html 默认对 `+`/`-` 行内容做 HTML 转义,但**必须显式确认所选版本/配置未开 raw HTML 透传**(实现期单测验证含 `<script>` 的 diff 行被转义,§12 W30);react-diff-viewer 同样需验。② **文件名 / `renamedFrom` / 冲突标记里的路径**不走 diff 库的正文转义,需各自经 `<Untrusted>`(D4)——文件名可以是 `<img onerror=…>.ts`(`isPathSafe` 只拦穿越不拦 HTML,RS-m2)。③ 自渲染的统计/降级占位文案里嵌入的文件名同样过 D4。**二选一的 diff 库(§13 openQuestion 9)必须把「raw-HTML 透传可关 + 默认转义」列入选型硬条件**,否则换掉。

### 9.4 evidence ↔ diff 行级联动(U5)

critic 的 `file_ref` evidence(02 §3:path + lineStart/End + contentHash)是「指着 diff 某几行说事」,面板做**双向跳转**:

```
气泡 evidence:                          DiffTab(src/authGuard.ts):
  ▣ file_ref src/authGuard.ts:14-22  ──►   @@ 行 14-22 高亮黄底 + 滚动定位
     hash✓  [跳转 diff 行] ◄──────────      点 diff 行号 → 反查引用它的 evidence,高亮对应气泡
```

- 点 evidence 的「跳转 diff 行」⇒ DetailDrawer 切 DiffTab + 加载该 path diff + `scrollToLine(lineStart)` + 高亮 `[lineStart,lineEnd]` 区间。
- `hash✓/✗` 角标来自 `evidenceVerdicts`(§4.2,中枢 §8.3 `verifyEvidence` 复算结果;⚠ 该字段待 11 回填,缺失时按 §4.2 降级);`fail` 表示 agent 的 `quote` 与中枢复算的区间内容不符(02 §9.1 归一化后),或 file_ref 越界——面板显眼标红「证据与实际代码不符,已被打回」(这类消息其实**不会入板**,只在打回的 `system` 消息里出现,§3.5)。这正是「焊死唱反调不准空夸」的可视化(02 §3 R5)。
- `command` evidence:展示 cmd/expected/actual/matchMode/exitCode;`weak`(○:未被中枢沙箱实跑,仅 agent 自报 actual)与 `pass`(✓:中枢沙箱复跑通过)色标区分,让人知道这条命令证据是否被中枢真跑过(02 §8.3 / §3.2;**未实跑只算 weak,不取信自报**,H2)。

### 9.5 Evidence Tab(独立审视 critic 火力)

DetailDrawer 的 EvidenceTab 聚合**当前选中气泡 / 当前轮**的所有 evidence,按核验态排序(fail/weak 置顶最该看),供人快速判断「这一轮的批判到底有没有实锤」:

```
┌─ Evidence(R3 critique by claude)──────────────────────┐
│ ✓ pass  file_ref src/authGuard.ts:14-22  quote 一致    │
│ ○ weak  command `npm test -- auth`(未被中枢实跑)      │
│ ○ weak  spec_quote 需求§4.2(弱核验,不单独解锁 C1)     │
│ ✗ fail  file_ref src/auth.ts:1-3  quote 不符 → 已打回   │  ← 仅在打回 system 消息里见到
└────────────────────────────────────────────────────────┘
```

> 三态严格对齐 02 §8.3 `verifyEvidence`(pass/weak/fail),**无 warn**;`fail` 的 evidence 因被打回**不会**出现在已入板消息中,只在 §3.5 的打回 `system` 消息呈现。已入板的 critique 必含 ≥1 条 `pass`(02 C1),其余可为 weak。

## 10. 失败路径与边界(面板侧)

面板是不可信展示端(安全文档 B2),且依赖一条可能抖动的 WS。失败路径必须明确,不能静默坏掉。

| # | 失败 | 面板处置 | 不变量守护 |
|---|---|---|---|
| F1 | 取 ticket 失败(RestApi 不可达 / 4xx) | `<ConnectionGate>` failed 态 + 重试按钮 | 不进 RunView,不渲染陈旧态 |
| F2 | 握手被拒(Origin 4403 / token 4401 / 版本 4400) | 明确文案(跨源/票据失效/需升级)+ 重新取 ticket(4401) | 安全 08 §5.1/5.2、11 §5.4 在 UI 的诚实反馈 |
| F3 | WS 中途断(1001/4413) | reconnecting 态,保留已有内容,重连后 `subscribe{cursor}` 续传(§4.3/4.6) | 不清屏、cursor 续接、不丢已展示消息(U3) |
| F4 | 掉帧(广播帧 seq 跳变) | 自动 `subscribe{cursor}`,11 §6.3 delta 补帧或 full 重置(§4.3) | 不重不漏(U3) |
| F5 | snapshot 与增量竞态(full snapshot 到达时已有更新增量) | 以 `seqWatermark` 为界,丢弃 ≤ 该 seq 的滞后增量(§4.3) | 帧序即真相(U3) |
| F6 | 帧形状异常(中枢 bug / 篡改) | `decodeServerFrame` 返回 ok:false → 丢弃 + 计数 + 告警;连续异常触发 resync(§4.7) | 不崩 UI;不重做业务校验(U4/U5) |
| F7 | inject 校验/防火墙失败 | `control_ack` 受理后,引擎相位边界判失败 → `system` 打回消息(§3.5/§6.3),表单保留草稿 + 高亮 | 失败不入板(arch 01 §2.3 RT3);面板不乐观写(U1) |
| F8 | pause 请求后子进程仍在输出 | 显示「本次发言结束后生效」,不谎称已停(§6.1) | 忠实 arch 01 §2.3,不误导 |
| F9 | abort 后子进程清理延迟 | 「中止中…」直到 `status:aborted` 帧;不提前显示已停 | 等中枢 finalize(arch 01 §3) |
| F10 | run 已被别处 abort / 终结(error fatal / close 1000) | 全屏说明 + 不自动重连,转回放(U6) | 终态只读 |
| F11 | diff 拉取失败 / 过期 / 超大 | DiffTab 错误占位 + 重试(`DIFF_REF_EXPIRED`→提示重新生成);超大走降级折叠(§9.2/9.3) | diff 不进 store(U7) |
| F12 | 第三方中转告警 | 顶栏常驻(安全 08 §7.1),不可关闭(知情合规) | 不隐藏出境事实 |
| F13 | spectate 误触控制 | 控制区灰化 + 不发帧;即便发也被中枢 `close 4403`(§6.5 / 11 W6) | 权限分级(安全 08 §5.3) |
| F14 | 背压被踢(close 4413) | 当作 F3 重连续传(11 §7.5:server 端背压不可恢复→踢→重连对齐) | 续传兜底背压(U3) |
| F15 | inject 失败回执无法精确匹配草稿 | 单 pending 兜底(§6.3):同时只一个 in-flight inject,回执必属它;待 11 回填关联键再放开并发 | 不误标他次草稿状态 |
| F16 | agent 内容含 HTML/JS(`<script>`/`onerror`/`javascript:` 链接,在 body/quote/文件名/diff/argsDigest 任一字段) | 默认纯文本渲染不执行;markdown 经协议白名单 + DOMPurify;CSP `script-src 'self'` 兜底;短元数据字段同样过 `<Untrusted>`(§3.6 D1-D4) | 不可信内容零执行(U8);防越权代发控制帧 |
| F17 | 跨帧分片 secret 在前端拼接重现(中枢逐帧 redact 残漏,RS-M1) | 流式 `delta`/`tool_call`/`diff_chunk` 默认不渲染给 `spectate`;control 可见且横幅标残漏;前端**不**做二次扫描(§4.4 / U4) | redact 缺口知情兜底,不靠不可信前端补救 |
| F18 | XSS 经脚本尝试外联 exfil(即便 D1/D2 漏) | CSP `connect-src` 锁本机 + `img-src` 不放 http 外链,脚本发不出外联请求(§3.6 D3) | 浏览器侧 exfil 出口封堵,与 08 沙箱断网同构 |

---

## 11. 性能预算(长会话量化目标)

| 指标 | 目标 | 手段 |
|---|---|---|
| 首屏(snapshot 渲染) | < 500ms(千条消息) | 虚拟滚动只渲可视区;diff/evidence 懒加载 |
| 增量帧→上屏延迟 | < 50ms(单条 message) | 细粒度 selector + memo;不全列表重渲(§8.4) |
| delta 流式刷新 | ≤ 60fps,不掉帧 | rAF 节流批量 append(§4.4);流式态独立订阅 |
| 滚动 | 60fps,千条无卡顿 | virtualizer + 高度缓存(§5.1) |
| 内存 | 与消息数近线性(store)+ DOM 常数(虚拟) | diff 不进 store;delta final 即丢(§5.5) |
| 重连恢复 | < 1s 补帧(缺口在 11 replayBuffer 窗内) | 11 §6.3 delta 补帧;超窗才 full snapshot(§4.3) |

【待实测】上述数值是设计目标,真实值需实现期在代表性 run(如 30 轮、80+ 消息、含数个大 diff)上压测确认。

---

## 12. UI 测试矩阵(交付验收锚点)

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| W1 | snapshot 渲染 | hello(client)→ snapshot{full} | 时间线/轮次/状态/token 正确呈现 |
| W2 | 增量 append | 连续 message 帧 seq 递增 | 按序追加,followTail 时滚到底 |
| W3 | seq 去重 | 重复 seq 的广播帧 | 第二条丢弃,不重复渲染(§4.3) |
| W4 | 掉帧 resync | 广播帧 seq 跳变(+3) | 发 subscribe{cursor},11 §6.3 补帧后无缺口(F4) |
| W5 | full snapshot 重置 | resync 回 snapshot{full,resync} | board 全量替换,旧滞后增量丢弃(F5) |
| W6 | delta 聚合 | 同 (agent,round) 多 delta + message | 流式拼接→message 替换→流式缓冲清空(§4.4) |
| W7 | 角色配色解耦 | codex 先 proposer 后 critic | 头像色相不变、边条由蓝变红(§3.1) |
| W8 | evidence 核验态(三态) | verdicts: pass/weak/fail(或缺失降级) | 三色标 ✓/○/✗ + EvidenceTab fail/weak 置顶;缺失时按 §4.2 降级(§3.1/9.5) |
| W9 | file_ref↔diff 联动 | 点 evidence 跳转 | DiffTab 加载(按 diffRef)+ 行高亮(§9.4) |
| W10 | 大 diff 降级 | diff >阈值行 | 折叠+统计+「仍渲染」(§9.3) |
| W11 | 二进制 diff | isBinary=true / diffRef 空 | 不渲文本,显字节统计(§9.3) |
| W12 | inject 入板(两段) | 合法 payload | control_ack 受理 → message(human)入板才标「已入板」(§6.3) |
| W13 | inject 校验失败 | critic 空 evidence | control_ack 受理 → system 打回(EVIDENCE_REQUIRED),草稿保留(F7) |
| W14 | inject 不乐观写 | 提交后回执前 | board 无 human 消息,仅 uiStore pending 态(U1/U2) |
| W15 | pause pending | running 时 pause,P4 进行中 | 「本次发言后生效」,收 status:paused 才实心(F8/§6.1) |
| W16 | abort 二次确认 | 点 abort | 弹确认;确认后「中止中」→aborted(F9) |
| W17 | 终态只读 | status=done | 控制栏全禁用,进回放(U6) |
| W18 | spectate 无控制 | scope=spectate | 控制区灰化,不发控制帧(F13) |
| W19 | 重连不清屏 | WS 断后重连 | 保留内容,subscribe{cursor} 续接(F3) |
| W20 | 时间旅行 | 拖回放游标到 R3 | 只显 round≤3,纯前端过滤不重连(§5.4) |
| W21 | 帧守卫 | 畸形帧 | decodeServerFrame ok:false → 丢弃+不崩,连续异常 resync(F6/§4.7) |
| W22 | 不监听非回环 | 启动 server | 单测断言 WS 仅 bind 127.0.0.1(安全 08 §5.1 / 11,server 侧测) |
| W23 | redact 信任 | 含疑似 key 的 delta | 面板直显(已脱敏),不二次处理(U4) |
| W24 | 虚拟滚动 key | 大量 append | 用 message.id 作 key,无错位(§5.1) |
| W25 | conflict-paused | status:paused + system 冲突 | 按 paused 处理(可 resume/inject/abort),高亮冲突(§6.5) |
| W26 | 多 run 游标隔离 | 两 run 同连接交错帧 | cursor 按 runId 分桶,各自去重不串(§4.1/4.3) |
| W27 | control_ack 受理≠生效 | 收 control_ack{accepted:true} | 仅标「受理」,等广播帧才标「生效」(§6.1/6.3) |
| W28 | XSS:body 含脚本 | message.body=`<img src=x onerror="fetch('/runs/X/ws-ticket',{method:'POST'})">` | 纯文本呈现,onerror 不触发,无外联请求(§3.6 D1/F16) |
| W29 | XSS:markdown 恶意链接 | body=`[点我](javascript:alert(document.cookie))` | 链接被协议白名单中和/剥离,点击无脚本执行(§3.6 D2) |
| W30 | XSS:元数据 + diff 字段 | 文件名/argsDigest/locator/diff 行含 `<script>` | 全部转义为可见文本,diff 库未透传 raw HTML(§3.6 D4/§9.3/F16) |
| W31 | CSP 生效 | 加载面板 HTML | 响应头含 CSP,`script-src 'self'` 无 unsafe-inline、`connect-src` 锁 127.0.0.1(§3.6 D3/F18) |
| W32 | 流式帧 spectate 门控 | spectate 连接收 delta/diff_chunk | 默认不渲染实时流(仅渲染落定 message);control 可见(§4.4/F17,RS-M1 兜底) |

---

## 13. openQuestions(交付即需用户/跨文档裁决)

> **安全级(吃掉红队后仍需跨文档落地,优先级最高)**:
>
> - **S-a 面板 XSS 防御进 08 威胁模型(回填 08 新增 T16)**:本文 §3.6/U8 已在面板侧落地「不可信内容零执行 + CSP」,但 08 威胁模型当前只把浏览器当攻击发起方(CSWSH/越权),缺「agent 内容 → 持 control 权限浏览器 DOM」这条受害面(红队 RS-B2 blocker)。需 08 新增 T16 并与本文 §3.6 对账(消毒/CSP/markdown 收口的职责边界:中枢只 redact 不转义,转义/CSP 归面板)。**这是 blocker,定稿前 08 必须补面**。
> - **S-b 流式 redact 跨帧残漏的中枢侧修复(回填 08 §3.3 + 11 §8.2,红队 RS-M1)**:面板侧只能「默认不向 spectate 渲染实时流 + 不做前端二次扫描」兜底(§4.4/F17),真正修复需中枢对 `delta`/`tool_call`/`diff_chunk` 做**跨帧滑窗 redact**(保留上帧尾 N 字符拼接再扫)或显式确认流式默认仅 control。本文给出面板侧硬默认(仅 control 可见实时流),但中枢不修则残漏始终在。与下方第 10 项联动,需用户定策略 + 08/11 落地。
> - **S-c CSP 与 dev HMR 兼容**:§3.6 D3 生产严格 CSP(无 unsafe-inline/eval)与 Vite dev HMR 冲突,需实现期定「dev 宽 / prod 严」的构建分叉与验证(W31 验 prod)。【待实测】

> **跨文档回填项(本文 v2 相对 WS 协议 11 / 02 / 01 发现的缺口,优先级高)**:

1. **⚠ evidence 逐条 verdict 的线上传输(回填 11 + 02)**:面板按 §3.1 给每条 evidence 标 ✓/○/✗,数据源是中枢 §8.3 `verifyEvidence` 的 `pass/weak/fail`,但 **02 `Message` 与 11 `message` 帧都不带逐条 verdict**。建议 11 `sMessageSchema` 加可选旁路 `evidenceVerdicts?: {index,verdict,note?}[]`(与 `contentHash` 同为核验阶段产物,已 redact)。未回填前面板按 §4.2 降级。
2. **⚠ inject 的 `role` 字段(回填 11)**:arch 01 §2.3 `ControlMsg.inject` 含 `role`(在 payload 外),但 11 §4.2 `cInjectSchema` 只有 `{kind,cid,payload}` 无 `role`。human inject 的 role(arbiter/critic…)无处放。建议 11 给 `cInjectSchema` 加 `role: roleSchema`(引用 02),与 01 对齐(§4.5)。
3. **⚠ inject 结果回执的关联键(回填 02 或 11)**:成功 `message(from:human)` / 失败 `system` 都是广播帧不带 `cid`(§6.3),面板无法精确把结果匹配回是哪次 inject 草稿。建议在 02 `Message` 或失败 `system` 上带 `causedByCid?`。未回填前面板靠「单 pending inject」兜底(F15)。
4. **文档编号统一**:本文落 `10-web-ui.md`、WS 协议落 `11-ws-protocol.md`、安全落 `08-security-firewall.md`,但部分兄弟文档旧引用称面板/WS=08、安全=09。需用户裁决统一编号(本文已按角色名+物理文件名引用规避硬编)。
5. **inject 幂等去重**:§6.3 依赖中枢按 `cid` 去重 inject(与 11 §13 同名悬置项);否则面板侧靠「单 pending + 禁用按钮」兜底(F15),并发场景需 11/server 落地 cid 去重才放开。
6. **snapshot 分页 / 顶部加载历史**:§5.2 默认 snapshot 全量;超大 run 是否需「近 K 条 + 摘要」分页 + 向更早 seq 反向拉取(11 §6 当前只向后补 seq)。【待实测】M0 定(与 11 §13 同一悬置项)。
7. **replayBuffer 窗口大小**:§4.3 delta 补帧依赖 11 §6.3 `replayBuffer` 容量(默认 1024 帧);窗口多大、超窗强制 full 的阈值与 server 协商(11 §13 同名项)。
8. **diff 传输通道**:§9.2 倾向 11 §9.3 的 REST `GET /runs/:id/diff/:diffRef`(可缓存),还是纯 WS `diff_chunk`;需与 server/RestApi 定鉴权复用(ticket scope)。与 11 §13 同名项。
9. **diff 库二选一**:`diff2html` vs `react-diff-viewer-continued`(总体规划 §8.3),实现期按大 diff 虚拟滚动支持度 + 包体积定。
10. **delta 透传开关**:`delta`/`tool_call`(arch 01 §2.1,11 droppable)高频且裹原始流,是否默认开放给 `spectate`(已 redact 但仍原始),还是仅 `control` 可见。隐私/性能权衡,与 11 §13 同名项,需用户定策略。**安全侧已给硬默认**(S-b / §4.4:流式实时流默认仅 control,因跨帧 redact 残漏 RS-M1);本项的开放需在中枢流式 redact 落地后才考虑放给 spectate。
11. **presence/spectators 计数**:§4.1/§7 顶栏 spectators 依赖中枢广播连接计数,但 11 **无 presence 广播帧**(只有 `WsHub.stats()` 查询接口,11 §10.1)。需 11 增 presence 帧,或面板轮询 REST stats;不实现则顶栏隐藏该项。
12. **多 run 单连接的 scope 粒度**:§4.1 / 11 §2.2 允许单连接多 run,但票据 scope 是否绑单 runId(11 §13 同名项)未定;若绑单 run,多 run 观战需多连接。
13. **WCAG 合规级别**:§3.2 按「不仅靠颜色 + AA 对比度」设计,完整 WCAG 合规需人工 + 辅助技术验证,是否作为交付硬指标需用户确认。
14. **diff 面板的里程碑落点(交叉审查 COV-9)**:交叉报告指出 M1/M2「无 worktree 单 checkout 执行、不落 diff」的过渡形态与「面板要渲染 diff」(§9)矛盾——若 M1/M2 真不产生文件写,则 §9 的 `diff_ready`/diff 正文在那两个里程碑无数据源。需裁决:**diff 面板推迟到 M3**(M1/M2 面板隐藏 Diff tab,只显 files 芯片为空/灰),**或**补 M1/M2 的过渡隔离规格(由 25/09 拥有)让其也能产 diff。本文 §9 的 UI 设计与里程碑无关、按「有 diff 数据即渲染」写;何时有数据归里程碑文档裁决。见交叉报告 x-coverage COV-9。

---

## 14. 收尾:本文件权威性声明

1. **本文拥有**:面板整体布局与视觉编码(§2/§3)、**面板侧不可信内容渲染 / XSS 防御 / CSP**(§3.6,吃掉红队 RS-B2)、**WS 帧的 UI 消费层**(§4:reducer / 去重 / resync 触发 / 流式聚合 / 帧→store/渲染映射)、虚拟滚动与合流(§5)、人工介入 UI 时序与态机(§6)、组件拆分(§7)、读写解耦(§8)、diff 查看 UI(§9)。
2. **本文引用而非另写(v2 焊死 R1)**:所有黑板数据类型以 `@sylux/shared`(02)为唯一权威;**所有 WS 帧线格式 / 信封 / `seq`·`cid` / 生命周期 / 关闭码 / 背压 / replayBuffer 以 WS 协议 11(`@sylux/server/src/ws-frames.ts`)为唯一权威**,本文 §4 只 `import type` 消费、不复制任何帧 zod;WS 安全规则以安全文档 08 为准;控制帧消费语义 / inject 校验以 arch 01 §2.3 为准;diff 正文生成以 worktree 文档为准;刹车阈值以 provider/刹车文档为准。任何字段以被引用文档为准,本文与之不一致时**以被引用文档为准(本文回填)**,绝不制造第二份定义。**例外**:面板侧 XSS 消毒/CSP(§3.6)是 08 威胁模型当前缺的受害面,本文在面板侧落地并提请 08 补 T16(§13 S-a),非另造第二权威而是补缺。
3. **核心不变量**:U1 面板纯投影 / U2 读写双通路解耦 / U3 帧序即真相(seq 规则遵 11) / U4 redact 后才到前端(含流式跨帧残漏的知情兜底) / U5 evidence 可视即可核验(三态,verdict 传输待回填) / U6 终态只读 / U7 体积有界 / **U8 不可信内容零执行(XSS 防御 + CSP)**——实现必须保持,§12 测试矩阵(含 W28-W32 XSS/CSP/流式门控)为验收锚点。

