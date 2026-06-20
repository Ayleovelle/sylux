# sylux 草稿交叉审查 · 一致性审查报告 [run-tag:v3.1]

> 审查范围:`docs/drafts/01~25` 全部草稿 + 事实地基 `docs/PROBED-FACTS.md`。
> 审查目标:跨文档矛盾、Message/类型漂移(是否真全引用 02 不另写)、术语不一致、接口签名对不上、不变量违反。
> 权威基准:02-blackboard-types.md(类型唯一权威)、PROBED-FACTS.md(实测事实地基)。
> 标记:🔴 阻断级(矛盾/漂移/不变量违反) · 🟡 应修(术语/签名小差) · 🟢 提示(可改进/存疑)

---

## A. 类型漂移:是否真全引用 02 没另写(I1 单一权威)

### 🔴 A1 [02 §12 vs 01/03/05/08] SyluxErrorCode union 缺多个已被使用的错误码
02 §12 是错误码唯一权威(union 闭集),但下列错误码在 01/03/05 已实际使用/分支,02 §12 union 里没有:
- `SUBPROCESS_CRASHED`(05 §5.2 F-c、01 §4.4)
- `SUBPROCESS_CANCELLED`(05 §10.2、03 §5.3、01 §3.4)
- `SUBPROCESS_TIMEOUT`(01 §3.5 A5 新增、§4.0)
- `INJECTION_BLOCKED`(03 §5.2/§8、安全 08)
- `EMPTY_ROUND_PLAN`(03 §5.1/§8)
- `ENGINE_FATAL`(03 §5.1、01 §4.4)

02 §12 现有集合:PROVIDER_CONFIG_INVALID / SUBPROCESS_SPAWN_FAILED / OUTPUT_SCHEMA_VIOLATION / EVIDENCE_* / MESSAGE_SIZE_EXCEEDED / WORKTREE_PATH_VIOLATION / DANGLING_REPLY_REF / INVALID_DONE_SELF_ACK / INVALID_SYSTEM_SENDER / ROUND_LIMIT_EXCEEDED / CONVERGENCE_STALL / TOKEN_BUDGET_EXCEEDED / WORKTREE_CONFLICT。
08 §8 又新增三个安全码需回填 02:`INJECTION_BLOCKED`、`EGRESS_SECRET_BLOCKED`、`WS_AUTH_FAILED`。
合计待回填 02 §12 的至少 9 个:SUBPROCESS_CRASHED / SUBPROCESS_CANCELLED / SUBPROCESS_TIMEOUT / INJECTION_BLOCKED / EMPTY_ROUND_PLAN / ENGINE_FATAL / EGRESS_SECRET_BLOCKED / WS_AUTH_FAILED(+ 03 提的 PLAYBOOK_DONE 废弃)。09 §12 再加 `WORKTREE_GIT_FAILED`。11 §11 再加一批 WS 码:`WS_FORBIDDEN_CONTROL` / `WS_ORIGIN_REJECTED` / `WS_PROTOCOL_MISMATCH` / `WS_HELLO_TIMEOUT` / `WS_BACKPRESSURE` / `UNKNOWN_FRAME_TYPE` / `DIFF_REF_EXPIRED`。合计待回填 02 §12 的错误码已达 17+ 个。各稿(05 §11 B8、01 §4.4/§7.1、03 §10.2、08 §8/§10、09 §12、11 §11/§13)都各自零散登记,但 02 §12 本体未动。建议:02 §12 一次性补齐(均向后兼容加成员),并明确区分"`AgentEvent.error.code`/`ws error.code` 开放 z.string()"与"`SyluxError`/`StopDecision.code` 闭 union"两类——前者运行期不炸,后者会炸。注意 WS 码多数只走 `ws error.code`(开放 string)+ close code,未必都需进 SyluxError union;02 回填时要甄别哪些真进闭 union(避免 union 膨胀)。

### 🟢 A2 [05/06 vs 02] ProviderOverrides 在 05 §2"结构镜像"
05 §2 写了一份 `ProviderOverrides` 结构但显式注明"权威类型在 provider 07 §3,实现一律 import 不另写"。这是被允许的"前向声明+引用"模式(类似 02 对 Blackboard 接口的处理),不算 I1 违规,但需确保 05 镜像字段与 07 §3 权威逐字段一致(待 07 核对)。

### 🟢 A3 [全仓] Message/Evidence/Round/BoardState/AgentEvent 类型未发现另写
01/03/04/05 均严格"引用 02 不另写 zod",抽查 02 拥有的核心类型在这些文档里都是 import/引用形态,未发现重复 z.object 定义。I1 在已读文档内保持良好(唯一例外是 03/01 引用了被废弃的引擎接口词汇,属 D1 接口漂移而非类型另写)。fingerprint 函数的 I1(02 §15.6 自曝总体规划 §7.2 有独立定义)需在总体规划文件核对——但总体规划不在本次 drafts 审查范围。

<!-- A 续 -->

## B. 跨文档矛盾(事实/约束/数值)

### 🔴 B1 [02 vs 05 vs 06] MAX_JSONL_LINE_BYTES 数值冲突 + I1 违规
同一常量三处不一致:
- 02 §5.3 权威:`export const MAX_JSONL_LINE_BYTES = 512 * 1024 as const; // 512 KiB`。
- 05 §7.2:`import { MAX_JSONL_LINE_BYTES } from '@sylux/shared'; // 02 §5.3,512 KiB`(正确引用 02)。
- 06 §6.2:`export const MAX_JSONL_LINE_BYTES = 1024 * 1024; // 1 MiB/行`,并注释"05 v2 权威常量"。

两个问题:① 数值冲突——512 KiB(02 权威)vs 1 MiB(06)。② I1 违规——06 **重新声明**了 02 拥有的常量(02 §11 已从 `@sylux/shared` 导出 `MAX_JSONL_LINE_BYTES`),而非 import。06 还误称其为"05 v2 权威常量"(实际权威在 02)。修复:06 删除本地声明,改 `import { MAX_JSONL_LINE_BYTES } from '@sylux/shared'`,并接受 02 的 512 KiB(或三方协商一个值回填 02)。注意 02 §5.3 这是 jsonl 行上限;06 用它限 stream-json 单事件行,语义一致但要确认 512 KiB 是否够 claude 大 assistant content(若不够,改 02 权威值而非各稿各定)。

### 🟡 B2 [06 §12.7 vs 07 §7.1] 过期回填note:07 已对齐 buildChildEnv 单对象签名
06 §12.7 + §13 写"07 §7.1 仍写双位参 `buildChildEnv(cfg, providerEnv)`,需回填对齐 08"。但实读 07 §7.1/§10:07 v2(V2 修正)已经改成单对象 `buildChildEnv({ providerEnv, agentId })` 并明确"不再用 v1 的双位参"。即 07 已对齐,06 的这条回填提示是基于旧版 07 的过期判断。处置:06 §12.7 这条可消(07 已修);三方(05/06/07/08)对 buildChildEnv 单对象签名已一致。

### 🟢 B3 [04 §6.1 vs 03 §2.1] stateless/resume 成本 regime 已对齐
03 §2.1 把 stateless 设为长程默认、resume 仅短程;04 §6.1(H-B3)明确区分两 regime 的成本曲线(stateless 近似平、resume 超线性),并据此重写预测。两稿对 continuity 成本模型一致,无矛盾。06 §7.3 又补 claude 端 prompt-cache 不对称(CF-5),与 04 §6 的"分端 pricing"口径一致(04 §13.2 已留 claude regime 待 M2 校准)。三稿协同正确。

<!-- B 续 -->

## C. 术语 / 枚举字面量不一致

### 🔴 C-NUM [全仓] 文档编号双轨制(实际文件名 vs 文内交叉引用)—— 已确认横跨多稿
两套编号并存,且各稿选边不一致:
- 实际文件名:`04`=刹车、`05`=adapter-codex、`06`=adapter-claude、`07`=provider、`08`=security、`09`=isolation-worktree、`10`=web-ui、`11`=ws-protocol。
- 用"实际文件名编号"的稿:03、04、07(07 头部明确订正"安全=08、worktree=09")。
- 用"逻辑编号"的稿(适配=04、provider=05、worktree=06、刹车=07、面板=08、安全=09):01、02、05、06。

矛盾点:同一对兄弟稿选了相反方案——05 明说"沿用 02/06 逻辑编号,不单方改号";07 明说"已订正到实际文件名"。于是 05↔07 互引时号码相反(05 说"安全 09",07 说"安全 08";都指 security-firewall)。03/04/07 已自报为 openQuestion(03 Q6、04 §13.2、07 §0/§14.2)。这是全仓阻断级一致性项,定稿必须一次性统一(纯文档层,不影响类型/接口,但严重影响可读性与回填正确性)。

### 🟡 C-EGRESS [07 内部一致] egressClass 静态 default 已移除
07 §3.1(V5)已把 v1 的 `egressClass.default('third_party')` 改为 optional + 加载层 `normalizeEgressClass` 推断。07 内部自洽。仅提示:16(config-schema)的加载层需提供 `normalizeEgressClass` 调用点,待 16 核对。

### 🟡 C-CTX [03 vs 05/17/19/25] ContextBundle vs PromptContext
03 §0.4 + Q7 自曝:权威名 `PromptContext`(03/02/09/16/20–22/术语表23),05/17/19/25 用旧别名 `ContextBundle`。05 §2/§9 已确认出现 `ContextBundle`("那是引擎 ContextBundle 的活,03")。待核 17/19/25。

### 🟡 C-NUM2 [11 内部] 单稿内混用两套编号
11 头部声明"按角色名 + 现有物理文件名"引用,但正文里实际混用:刹车写"刹车文档(04)"(文件名编号)、安全写"安全文档(09)"(逻辑编号,实际安全是 08)、面板把自己所属的 WS 称谓也绕。即 11 一篇内 04 用文件名号、09 用逻辑号,自身不自洽。08 头部也自曝同样问题(自称 08 但被引用为 09)。这是 C-NUM 的具体发作点,统一编号时需逐稿正文扫描替换,不只改头部声明。

## C. 术语 / 枚举字面量不一致 (cont.)
<!-- 边读边追加 -->

## D. 接口签名对不上

### 🔴 D1 [01 vs 03] 01 全篇用 v1 引擎词汇,03 v2 已废除——01 却声称与 03"逐字节兼容"
03 v2 的 §0.4 H1/H2/H6 + §1 P1 明确做了一批破坏性改名/删接口,但 01 通篇仍用被废除的 v1 词汇,且 01 §2.0 还写"二者循环行为逐字节兼容"。这是最严重的跨文档漂移,实现者照 01 写就会撞 03 的真接口。逐条:

- `Brakes` / `checkBefore` / `checkAfter` / `BrakeResult`:03 §0.4 H1 明文"删自造 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult`,改 `EngineDeps.stopPolicy: StopPolicy`,每轮末只 `update→shouldStop` 一次,**无前置刹车**"。但 01 §0.1 表、§1.2 组件表、§1.3 时序图、§2.1 P0(`pre-brake brakes.checkBefore`)/P8(`post-brake brakes.checkAfter`)、§3.2(`brakes: bindSignal(deps.brakes,…)`)全用 `Brakes.checkBefore/checkAfter`。
- 前置刹车 P0:01 §2.1 把 `checkBefore`(轮数/token 预算)列为 P0 固定相位;03 §0.2 E6 + §5.1.1 明文"**无前置刹车**…引擎再设 `checkBefore` 既重复又无新信息,故删除(H1)"。直接矛盾。
- `playbook.isDone` 独立分支:01 §2.1 P8 写"`brakes.checkAfter` + `playbook.isDone`"两件事;03 §0.4 H2 + §5.1.1 明文"引擎**不再**有独立 `if(playbook.isDone)`,经 `PlaybookDonePolicy` 进 composite"。
- `planRound` / `TurnSpec`:01 §0.1、§1.2、§1.3 时序图用 `planRound`→`TurnSpec[]`;03 §1 P1/P2 已统一为 `nextTurn(board)`→`RoundPlan`/`TurnDirective`。
- `firewall.wrap()` / `firewall.wrap`:01 §1.3 时序图用 `firewall.wrap`;03 §0.4 H6 明文"改为 `firewallPeerMessage(msg)→{action,wrapped}`"。
- `contextFor`:01 §1.2、§1.3 用 `Blackboard.contextFor`(算 delta+digest);03 把"喂什么上下文"下放给 playbook 的 `PromptContext`(§2),`Blackboard` 接口(03 §4.2)无 `contextFor`。
- `EngineDeps.brakes` 字段:01 §3.2 `withSignal` 里 `brakes: bindSignal(deps.brakes, signal)`;03 §4.3 `EngineDeps` 无 `brakes` 字段,只有 `stopPolicy: StopPolicy`。签名对不上。

> 注:01 §0.2 A2 已修对"指纹喂料通路"(删 `feedEvidence`),说明 01 作者部分跟进了刹车侧变更,但**没跟进 03 的 Brakes→StopPolicy 整体改名与去前置刹车**。01 §2.0"逐字节兼容"的声明在此为假,应删除或改为"以 03 v2 接口为准,01 待回填"。

### 🟡 D2 [01 内部 + 01 vs 03] AgentAdapter 第三个方法名:`kill` vs `cancel`
01 §0.1、§1.2 写 `AgentAdapter.send/resume/kill`;但 01 自己 §3.4 调的是 `a.cancel()`,03 §9 接口边界表写的是 `send/resume/cancel`。01 内部就不自洽(`kill` vs `cancel`),且与 03 权威名 `cancel` 不一致。统一为 `cancel`。

### 🟡 D3 [04 应权威] StopContext/StopDecision/KEEP_RUNNING/CompositeStopPolicy — 已核对,基本一致
04 §2 权威定义了 `StopContext`/`StopDecision`/`KEEP_RUNNING`/`StopPolicy`,03 §4.3/§5.1 的调用面与之一致(`decision.shouldStop/status/code/reason` 都对得上,`KEEP_RUNNING` 一致)。04 §13.2 也主动登记了"03 残留 Brakes 需回填"(与 D1 同源)。

### 🟡 D4 [03 vs 04] buildStopContext 签名不一致
03 §5.1 调 `buildStopContext(bb.view(), round)`(两参:BoardView + round);04 §2.4/§10 时序写 `buildStopContext(boardState)`(单参:BoardState)。入参约定不一致(BoardView vs BoardState、是否额外传 round)。需统一签名。

### 🟡 D5 [02 vs 03 vs 04] Blackboard.setStatus 形参个数漂移
- 02 §7.1 `status_changed` 记录字段:`status` + `reason?`(无独立 code 字段)。
- 03 §4.2 `Blackboard.setStatus(status: RunStatus, reason?: string)`(两参)。
- 04 §2.4 + §10 调 `blackboard.setStatus(decision.status, decision.code, decision.reason)`(三参)。
04 比 03 多传一个 `code`。要么 03 的 `setStatus` 补 `code`,要么 04 把 code 折进 reason;02 §7.1 是否加独立 code 字段一并定。

### 🟡 D6 [02 vs 03] validateMessage 注入签名不一致
- 02 §8.1 权威:`validateMessage(msg: Message, ctx: ValidateContext): ValidateResult`。
- 03 §4.3 `EngineDeps.validate: (msg: AppendInput, round: number) => ValidateResult`(第一参 `AppendInput` 而非 `Message`,第二参 `round:number` 而非 `ValidateContext`)。
03 称其为"validateMessage 注入封装",但封装产物入参类型与 02 权威差异大,需在 03 注明桥接(round→ValidateContext、AppendInput→Message),否则读者误判签名冲突。

### 🟢 D7 [03 vs 04] stop 包物理落点引用
03 §4.3 `import ... from '@sylux/core/stop'`;04 §1 落点 `packages/core/src/stop/`。包名子路径映射需在 12/13 的 path alias + 子路径 export 里坐实。

### 🟢 D8 [04 自曝] 五份红队/交叉报告"全部不存在"声明已过期
04 §13.2 写"x-consistency.md/x-coverage.md/red-*.md 全部不存在"。本审查正在生成 x-consistency.md,交付时点该声明不成立;定稿应据实际产出再过一遍 04。

### 🔴 D9 [05 vs 07] toCodexInjection / toClaudeInjection 签名直接冲突
- 07 §5.2/§5.3 权威:`toCodexInjection(cfg: ProviderConfig, keystore: KeyStore, ov?: ProviderOverrides)`(三参,merge 内置,keystore 必传以解析 key)。
- 05 §8.2 实现:`const merged = mergeProviderOverrides(this.provider, input.providerOverrides); const { cArgs, env } = toCodexInjection(merged);`(单参,传 merged,无 keystore)。

冲突实质:05 传的 `merged` 缺 `agentKind`/`apiKeyRef`/`egressClass` 且无 keystore 无从 resolve key,过不了 07 的类型守卫与 key 解析。07 §5.3/§14.2 已明确"以 07 为准,05 需回填",但 05 当前文本仍是旧签名。必须回填 05。`toClaudeInjection` 同理(06 待核对)。

### 🔴 D10 [05 vs 07] createCodexAdapter/createClaudeAdapter 工厂缺 keystore 参数
07 §5.3/§8.4 要求构造期注入 `keystore`:`createCodexAdapter({ provider, keystore })`。但 05 §3.2 工厂签名是 `{ exePath?, provider, hardTimeoutCeilingMs? }`——无 `keystore`。05 §8.2 也未从构造参数拿 keystore。按 07 三参 toCodexInjection,adapter 必须持 keystore 才能 resolve key。需回填 05 工厂签名。

### 🟡 D11 [05 §2 vs 07 §4] ProviderOverrides 字段与章节指向
05 §2 的 `ProviderOverrides` 镜像含 baseUrl/wireApi/model/providerName/extraConfig,07 §4 权威含同五个,字段对得上。但 05 §2 注释指"权威在 07 §3",而 07 自报权威在 §4(§3 是 ProviderConfig)。章节指向小误,需回填 05 改指 07 §4。

### 🟢 D12 [05/07] mergeProviderOverrides 归属
07 §4 定义并在 §11 从 inject-codex.js 导出 `mergeProviderOverrides`;05 §8.2 import 自 @sylux/providers。07 §5.3 说"05 的 mergeProviderOverrides 单独调用可删(已内置)"。需确认 05 回填后是否还 import 它。

### 🟡 D13 [06 vs 05] AgentInput claude 专属字段未在 05 定义
06 §3 用到 `input.maxTurns` / `input.effort` / `input.appendSystemPrompt` / `input.providerOverrides.fallbackModel`,但 05 §2 的 `AgentInput` 接口无这些字段。06 §12.1 已登记"回填 05 §2 新增这些可选字段(codex 端忽略)"。属接口漂移,需回填 05 后两稿才一致。当前 06 引用了 05 尚未定义的字段。

### 🟡 D14 [06 vs 05] FirstEventGate API:06 v2 已自我修正但留可选提案
06 §0.6 CA2 + §12.2 坦白 v1 曾凭空假设 `onSession/passthrough/isTerminal`,v2 已改回用 05 v2 真实 API(`onThreadStarted/primeIfSeeded/onFinal/onFailure/resumable`)。当前 06 与 05 的 gate API 一致(已修)。仅留一个可选回填提案:把 `onThreadStarted` 改名端中性的 `onSession`(codex 留 deprecated 别名)。非阻断,提案性质。

### 🟢 D15 [06 §9.1 import vs 08 落点] buildChildEnv import 路径
06 §9.1 `import { buildChildEnv } from '@sylux/security'`;08 §2.4 注释建议 SECRET_SIGNATURES 落 `@sylux/shared` 或 `@sylux/security`(未定);05 §8.3 `import from '@sylux/agents/proc/build-env'`。三处对 buildChildEnv/安全工具的物理包名不统一(@sylux/security vs @sylux/shared vs @sylux/agents/proc)。08 §10 openQuestions 已留"SECRET_SIGNATURES 落点包待定"。需在 12/13(技术栈/monorepo)定一个安全包落点,统一三稿 import 路径。
<!-- D 续 -->

## E. 不变量违反(I1~I8 + 锁定决策 R1~R8)

### 🔴 E1 [23 vs 02v2/03v2/04v2] 术语表+不变量总表是 v1 镜像,多处已过期
23 自称是各文档不变量的"汇编镜像",但它镜像的是 v1 状态,与 02/03/04 的 v2 硬化点冲突。23 §6.2 自己声明"以源文档为准并回填本表",但当前文本未回填。逐条:

- 🔴 INV-T4(23 §3.1):写"evidence ≥1 条达「强/中」核验通过"。02 v2 §3.2/C1(H2)已**收紧为「≥1 条强」**,weak(含未实跑 command、无 quote 的 file_ref、spec_quote)不解锁。23 还停在 v1 的"强/中"。§1.4 evidence 条目、§4.1 自检项同样写"强/中"。同 07 §10.3(V8 已修为"强")、04 §5.2、02 v2 都不一致。
- 🔴 INV-E6(23 §3.2):写"刹车前置(checkBefore)+ 后置(checkAfter)双侧检查"。03 v2(H1)+ 04 §2.4 已**删除 checkBefore/前置刹车**,改每轮末单次 update→shouldStop。23 还在描述被废弃的双侧 Brakes 模型。§1.5 brakes 条目、§4.2 自检"done 判定 isDone 与 stall 判定 checkAfter 两处独立"同样基于旧模型。
- 🟡 INV-E1(23 §1.5 engine 条目):把 `runEngine` 循环描述为"前置刹车→nextTurn→...→后置刹车→done 判定",与 03 v2/04 的单点裁决矛盾(同 E6)。
- 🟡 INV-A6(23 §3.3):claude 内联 schema 只提"长度 32KB"轴,漏了 06 §4.5/02 H7 的第二轴"strict 后端拒 anyOf/optional"。
- 🟡 23 §1.4 digest 条目写"生成器归刹车 07";03 v2 Q9 已澄清"接口归引擎 03、算法归性能 17"。23 仍指旧归属。
- 🟡 23 §1.4 fingerprint 条目未反映 02 v2 H1(contentHash 中枢派生、agent 不自算)与 04 H-FP(未核验 `:?` 指纹不清零 stall)。

23 作为"术语+不变量权威"被全仓引用,过期会误导实现者按 v1 写。必须按 02v2/03v2/04v2 全面回填 23。

### 🟡 E2 [23 编号] 23 用逻辑编号(worktree=06、刹车=07、安全=08/09 混)
23 通篇用逻辑编号:worktree 引"06"、刹车引"07"、面板引"08"、安全引"08/09"混用(§1.2 human 行写"08/11",§1.8 firewall 写"03 §4.3、09")。与实际文件名(刹车=04、worktree=09、安全=08)系统性错位。属 C-NUM 范畴,但 23 是术语权威,其编号错位影响尤大。

### 🟢 E3 [全仓 I1] 类型单一权威总体守住
跨 01-11 + 23 核查,`Message`/`Evidence`/`Round`/`BoardState`/`AgentEvent` 等 02 拥有的类型,各稿均"引用不另写"(23 §6.3 明确零 z.object)。唯一实质 I1 违规是 B1(06 重声明 MAX_JSONL_LINE_BYTES)。fingerprint 函数的 I1(02 §15.6 自曝总体规划 §7.2 有独立定义且语义错)在 sylux-master-plan.md,不在本次 drafts 范围,但 02 已登记需回填。

### 🔴 E4 [21 vs 02v2] Fusion evidence 沿用 v1"强/中",与 02v2"≥1 强"冲突
21 §0.3 F4、§6.1 映射表、§6.3 `hasStrongOrMidEvidence`、§5.1 主流程都写"critique 须 ≥1 条达「强/中」核验通过",并把 command 标为"中"强度。02 v2 §3.2/C1(H2)已收紧为"≥1 条强"——未实跑 command 只算 weak、不解锁 C1。21 与 23 同病:停在 v1 的"强/中"二档。注意 21 §6.3 的预检函数名直接叫 `hasStrongOrMidEvidence` 且实现 `verifyEvidence(e)==='pass'` 才算(这其实只认 pass=强,与 02v2 一致),但函数命名和 §0.3/§6.1 的文字描述仍是"强/中",自相矛盾。需统一为 02v2 的"强"。07 §10.3(V8 已修)是正确范例,21 未跟上。

### 🟡 E5 [21 §5.1/§5.4 vs 03 H6/08] firewall.wrap() 用了旧 API
21 §5.1 `deps.firewall.wrap(...)`、§5.4 `firewall.wrap(fb)`、§3.2 `firewall: ContentFirewall` 用 `.wrap()` 方法。03 §0.4 H6 + 08 §4.3 已把签名改为 `firewallPeerMessage(msg) → {action:'pass'|'flag'|'block', wrapped}`(纯函数,非对象方法)。21 沿用了被 03 H6 废弃的 `firewall.wrap()` 对象方法形态。同 01 §1.3 时序图的 `firewall.wrap`(D1 已记)。需对齐 08 权威签名。

### 🔴 E6 [22 + 01 vs 03v2/04v2] v1 Brakes 模型经 01 传导到 22,与 03v2/04v2 冲突
22 自称纯编排 01/02/03/05/06/09/11,不新增。但它忠实镜像了 01 §2.1 的 P0-P8 相位表,而 01 §2.1 表本身仍是 v1 Brakes 模型:P0=`checkBefore`、P2=`contextFor`、P8=`checkAfter + playbook.isDone`、§5.2 注释里的 `firewall.wrap`/`brakes.feedEvidence`/`PLAYBOOK_DONE`。这些 03 v2(H1/H2/H6)+ 04(§2.4)已废:无前置刹车、done 经 PlaybookDonePolicy 进 composite、firewallPeerMessage 纯函数、feedEvidence 删除(01 §0.2 A2 自己也修了 feedEvidence,但 §2.1 相位表没同步)、PLAYBOOK_DONE 废弃(03 Q10)。

具体 22 的过期点:
- §0.3 + §2.3 + §5.1 P0/P8 双侧刹车 `checkBefore/checkAfter`(应为轮末单次 update→shouldStop)。
- §1.2/§2.3 `contextFor`(03 已下放给 playbook PromptContext,无此方法)。
- §1.3 O6/§2.3 `firewall.wrap`(应为 firewallPeerMessage)。
- §3.1 `brakes.feedEvidence(fingerprintSet(...))`(01 §0.2 A2 已删,改 roundAccum;22 又抄回旧的)。
- §4.1/§5.2 done 终态 reason 写 `PLAYBOOK_DONE`(03 Q10 已废,done 无错误码)。

根因:01 §2.1 相位表与 03v2/04v2 没对齐(01 §0.2 只修了部分 A1/A2,没修 P0 checkBefore),22 忠实镜像了 01 的旧表,把 v1 模型再传导一层。修复链:先回填 01 §2.1 相位表(去 checkBefore/contextFor/firewall.wrap/feedEvidence)→ 22 自然跟正。这与 D1(01 用 v1 引擎词汇)同根,22 是其下游放大。

### 🟡 E7 [22 编号] 22 用 09 同时指 worktree 和 security
22 §0 声明 worktree=09、WS=11(文件名编号),但正文 §0.3 P3「firewall 包边界+扫描(09 安全)」、§2.3「sandbox(09§10)」——09 既指安全又指 worktree。实际安全=08、worktree=09。22 内部用同一个"09"指两份文档,自相矛盾(比 11 的混用更严重)。统一编号时 22 需逐处甄别。

### 🔴 E8 [20 vs 03v2/04v2] 插件 DSL 自定义 StopPolicy 建在 v1 Brakes.checkBefore/checkAfter 上
20 §8.2/§8.3/§8.4 的插件停止策略合成机制整个建在 `core.checkBefore(round,board)` + `core.checkAfter(round,board)` 双方法上(§8.2 `composeBrakes` 分别合成两者,§8.4 "插件不能改 checkBefore 预算")。但 03v2 H1 + 04 §2.4 已废除 checkBefore/前置刹车,统一为轮末单次 `StopPolicy.update→shouldStop`。20 的插件扩展面("只开后置 checkAfter,前置 checkBefore 对插件封闭")整套语义需重构到 04 的 `StopPolicy`/`CompositeStopPolicy` 模型上:04 的 `CompositeStopPolicy` 已是组合多 StopPolicy,插件 StopPolicy 应作为一个 child 注入 composite(类似 PlaybookDonePolicy),而非包装 checkBefore/checkAfter。20 §8 的"硬刹车 OR 插件停止票、插件无否决权"立意正确,但接口载体是废弃的 Brakes。需按 04 StopPolicy 重写。§9.5.6 测试 P21/P25/P33 同样基于 checkBefore。

### 🟡 E9 [16 vs 03/04] 16 重声明 03/04 拥有的 enum(填 zod 空缺但有字面量漂移风险)
16 §5/§6 新写了 `playbookIdSchema`(注"03 §3.3 PlaybookId")、`continuityModeSchema`(注"03 §2.1")、`tokenPricingSchema`(注"04 §6.2")、`sandboxCeilingSchema`、`playbookParamsOverrideSchema`(注"=03 §3.3 PlaybookParams")。这些是 03/04 拥有的概念,但 03/04 多以 TS 类型/interface 给出(`export type PlaybookId = ...`、`interface TokenPricing`),未导出 zod schema。所以 16 写 zod 是"填空缺"非纯重复,可接受;但字面量/字段必须与 03/04 严格同步(如 `PlaybookId` 四值、`ContinuityMode` 两值、`PlaybookParams` 字段名)。风险:03/04 改了 03/04 的定义,16 的 zod 副本不会自动跟随。建议:要么把这些 zod 上移到 03/04(或 @sylux/shared)作单一权威供 16 import,要么 16 明确标注"镜像,改 03/04 须同步本段"并加 CI 字面量一致性断言。当前 16 已加"03 §x"注释指向源,属轻度风险。

### 🟡 E10 [12/25 vs 08] buildChildEnv(agent) 单参形态
12 §(spawn 骨架,行219)`env: buildChildEnv(agent)`、25 T1.12 `buildChildEnv(agent)` 单参。08 §2.2 权威单对象 `buildChildEnv({providerEnv, agentId})`、07/05/06 v2 已对齐单对象。12/25 用了更旧的单参 `(agent)` 形态(比 07 v1 的双位参还简)。属示意性伪代码,但与 08 权威签名不一致,回填时统一为单对象。

### 🟡 E11 [14/15/20 vs 02v2] "强/中" evidence 旧二档残留
除 23/21(E1/E4)外,这些稿也用旧"强/中":14 EV6 测试"weak,不满足强/中"、15 §(行213/435/476)"无强/中 evidence 复算通过"、20 §8.x roleProfile "≥1 强/中核验"。02 v2 已收紧为"≥1 强"(weak 不解锁)。这些表述需统一为"强"。注意 14 EV6/15 的实际判定逻辑(weak→EVIDENCE_UNVERIFIABLE)与 02v2 一致,只是文字仍写"强/中",改文字即可。

### 🟢 E12 [17/19/25 vs 03] ContextBundle 旧别名
17 §(行475/480)、19 §(行368)、25 T1.5 用 `ContextBundle`。03 §0.4 Q7 权威名是 `PromptContext`,`ContextBundle` 是旧别名(03 列出 05/17/19/25 待回填)。本审查确认 17/19/25 命中(05 在 D 段已记)。统一为 `PromptContext`。

### 🟢 E13 [全仓编号] 12/16/19/24/25 的编号选边
12 头部用文件名编号(安全 08、隔离 09、Web 10、WS 11)但正文大量"安全 09"(行21/219/286/308/...),12 自身头部与正文矛盾(头说 08,体写 09)。19/24 用文件名编号(安全 08),与 12 正文的"安全 09"相反。25/16 混用。这是 C-NUM 的进一步发作面:不仅跨稿不一致,12 单稿内头部与正文都不一致。统一编号是定稿必做项,涉及几乎所有稿的正文逐处替换。

<!-- E 续 -->

## F. 逐文档巡检笔记

逐稿一句话状态(🟢健康/🟡小问题/🔴有阻断级):
- 01 运行时骨架 🔴:用 v1 引擎词汇(Brakes/checkBefore/planRound/firewall.wrap/contextFor),§2.1 相位表是 v1 模型源头(D1/E6 根因);声称与 03"逐字节兼容"为假。kill/cancel 内部不自洽(D2)。
- 02 黑板类型 🟢(权威基准):v2 已硬化,自洽。唯一待办是 §12 错误码 union 需吸收下游 17+ 个回填码(A1);§15.6 自曝总体规划 §7.2 有错误的独立 fingerprint(仓外)。
- 03 引擎 🟡:v2 自身硬化好,主动登记了与 01/04 的回填(Q6/Q9/Q10);残留对 04 的 buildStopContext 签名(D4)、setStatus/validate 签名(D5/D6)需对齐。
- 04 刹车 🟢:v2 StopPolicy 权威清晰,确认 D1/D3;主动登记 03 残留 Brakes 需回填。
- 05 codex 适配 🔴:与 07 的 toCodexInjection/createCodexAdapter 签名硬冲突(D9/D10);用逻辑编号、ContextBundle(C-CTX);cancel/kill 别名。
- 06 claude 适配 🔴:重声明 MAX_JSONL_LINE_BYTES 且值冲突(512KiB vs 1MiB,B1/I1);用 05 未定义的 AgentInput 字段(D13);§12.7 对 07 的回填提示已过期(B2)。
- 07 provider 🟡:v2 硬化好,是 toCodexInjection 等的权威;用文件名编号(与 05/06 逻辑编号相反,C-NUM);egressClass v2 已修。
- 08 安全 🟢:v2 权威清晰;新增 3 错误码待回填 02(A1);自曝编号冲突(自称 08 被引用为 09)。
- 09 worktree 🟢:v2 本机实测校正扎实;新增 WORKTREE_GIT_FAILED 待回填(A1);用文件名编号(与 02/03/08 一致);自曝 readFileRange 签名不对称已桥接(D 段 C2)。
- 10 web-ui:本次未深读正文,grep 无类型另写/旧 API 命中;编号待统一(随 C-NUM)。
- 11 WS 协议 🟡:线格式自洽;新增 7 个 WS 码待回填(A1);单稿内混用 04 文件名号 + 09 逻辑号(C-NUM2)。
- 12 技术栈 🟡:buildChildEnv(agent) 单参(E10);头部文件名编号但正文"安全 09"自相矛盾(E13)。
- 13 monorepo:grep 无类型/API 漂移;需提供 @sylux/security 等包落点以统一 D15 的 import 路径。
- 14 测试 🟡:EV6 用"强/中"文字(E11,判定逻辑正确)。
- 15 可观测 🟡:多处"强/中"文字(E11)。
- 16 配置 🟡:重声明 playbookId/continuityMode/tokenPricing 等 zod(填空缺,有字面量漂移风险,E9);§6 stopConfig 组装 04 子配置;混用编号。
- 17 性能 🟡:用 ContextBundle(E12);拥有 digest 生成算法(与 03 接口归属需对齐 03 Q9)。
- 18 eval 🟢:大量自有 schema(eval 专属,非 02 类型),不违 I1;"04 AgentAdapter"是逻辑编号(adapter=04,C-NUM)。
- 19 部署合规 🟡:用 ContextBundle(E12);用文件名编号(安全 08)与 12 正文相反(E13)。
- 20 插件 DSL 🔴:自定义 StopPolicy 建在废弃的 Brakes.checkBefore/checkAfter 上(E8);roleProfile 用"强/中"(E11);自有 plugin schema 不违 I1。
- 21 Fusion 🔴/🟡:F 系列设计扎实;但 evidence 沿用"强/中"且 §0.3/§6.1 文字与 §6.3 实现自相矛盾(E4);用 firewall.wrap 旧 API(E5);新增 2 错误码待回填(A1)。
- 22 e2e 时序 🔴:纯编排但忠实镜像 01 §2.1 的 v1 Brakes 模型,把 checkBefore/contextFor/firewall.wrap/feedEvidence/PLAYBOOK_DONE 再传导一层(E6);09 同时指 worktree 和 security(E7)。
- 23 术语+不变量 🔴:v1 镜像,INV-T4"强/中"、INV-E6 双侧刹车、digest 归属、fingerprint 等多处过期(E1);通篇逻辑编号(E2)。作为术语权威过期影响大。
- 24 M0 gate 🟢:用文件名编号(安全 08);引用 07 §14.2 待验项,与各稿 openQuestion 一致。
- 25 roadmap 🟡:T1.4 planRound、T1.5 ContextBundle/contextFor、T1.12 buildChildEnv(agent)、T5.8"强/中"——多个旧词/旧签名(D1/E10/E11/E12 的任务清单镜像)。

---

## 总结:定稿前必清的阻断级项(按修复优先级)

1. 🔴 **统一编号(C-NUM)**:全仓两套编号(文件名 vs 逻辑)横跨所有稿,且 11/12/22 单稿内自相矛盾(C-NUM2/E7/E13)。这是改动面最大、最影响可读性与回填正确性的项。建议一次性统一到实际文件名编号(03/04/07/08/09/19/24 已用)+ 角色名双锚点,逐稿正文扫描替换。
2. 🔴 **02 §12 错误码 union 一次性补齐(A1)**:17+ 个码散落在 01/03/05/08/09/11/21 各自登记,02 本体未动。先甄别哪些进闭 union(SyluxError/StopDecision.code)、哪些只走开放 string(AgentEvent/ws error.code),再补。
3. 🔴 **01 §2.1 相位表去 v1 Brakes(D1/E6 根因)**:01 还用 checkBefore/contextFor/firewall.wrap/feedEvidence,且被 22 镜像传导。回填 01 后 22 自然跟正。03 残留 Brakes 段(03 自曝)同批清。
4. 🔴 **23/22/21/20 的 v1 不变量回填(E1/E4/E6/E8)**:"强/中"→"强"(02v2)、双侧刹车→单点 StopPolicy(03v2/04)、PLAYBOOK_DONE 废弃、firewall.wrap→firewallPeerMessage。23 作为术语权威优先。
5. 🔴 **05↔07 签名冲突(D9/D10)**:toCodexInjection 三参 + createCodexAdapter 收 keystore,以 07 为准回填 05。
6. 🔴 **06 重声明 MAX_JSONL_LINE_BYTES 且值冲突(B1)**:删本地声明改 import 02,统一 512KiB(或协商改 02 权威值)。
7. 🟡 余下 D4-D6/D11-D15/E9-E13 等签名与术语小项,随上述大项一并回填。

> 自检(对抗性):本报告基于通读 01-09、11、16、21-23 全文 + 10/12-15/17-20/24-25 的定向 grep。未深读 10/13 全文正文(grep 确认无类型另写/旧 API),若其正文有隐藏的接口签名漂移可能漏检。fingerprint I1 违规(02 §15.6)指向 sylux-master-plan.md,在本次 drafts 范围外,仅转述 02 的自曝。

---

## 审查进度

- [x] 02 权威类型 + PROBED-FACTS 读毕(基准建立)
- [x] 01,03,04 读毕
- [x] 05,06,07 读毕
- [x] 08,09,11 读毕(10 定向 grep)
- [x] 12~19 处理(16 读关键段;12/14/15/17/18/19 定向 grep)
- [x] 20~25 处理(21/22/23 读全文;20/24/25 定向 grep)
