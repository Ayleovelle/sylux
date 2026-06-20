# 红队报告 · 运维与成本 [run-tag:v3.1]

> 角色:红队·运维与成本。攻击面:token 累积成本模型在各处是否被正确采用、限流(8 并发 429)是否被尊重、长会话内存/性能、版本漂移(codex/claude 升级)、灾备恢复、配置错误的爆炸半径、评测台能否真量化、运行成本是否被低估。
> 方法:逐条带 evidence/反例,标 severity。已通读 04/07/15/16/17/18/19 全文 + x-consistency/x-coverage/red-feasibility/red-security + PROBED-FACTS。
> 分工:red-security 已吃掉 RS-M5(预算轮末才停 / panel 扇出无前瞻)、RS-m4(pause 不止血)。本报告**不复述**,只在成本闸**配置/取值/跨文档采用**维度追加它没碰的洞。
> severity 口径:
> - blocker = 成本失控真实可达 / 安全网形同虚设 / 数据(已花的钱)丢失无法追账,且默认配置即触发。
> - major = 防御有实质缺口但有其他层兜底(maxRounds 兜底烧钱、漂移可被探针部分挡),或跨文档取值矛盾导致实现者大概率配错。
> - minor = 收敛性 / 纵深 / 体验 / 待实测的成本边角。

---

## 0. 总体判定(verdict)

成本模型的**理论骨架**(04 §6 两 regime 修正、事实 D 超线性、实测优先预测、usage 唯一源、17 并发 governor+AIMD+令牌桶、07 V6 健康探测不轮询、19 版本漂移探针)是这批草稿里质量最高的部分之一,绝大多数"烧钱点"都被显式建模。但有**一个 blocker**贯穿默认配置:**16 的范式默认预算表对三个 stateless 默认范式套用了 resume 超线性公式,把额度配大 2.8–4.4×,正好命中 04 §6.5/§13.2 自己点名"最危险的误配",使 B3 预算刹车 + 前瞻刹车在开箱默认下形同虚设**。外加 **3 条 major**(usage 字段漂移被划 degradable → 成本刹车静默失明;16 宣称 stop 阈值可热换但 04 StopPolicy 无重配接口且 ConvergencePolicy 有状态;评测 runner 并发未接 17 全局 governor → 可破 8 并发 429 顶)与若干 minor。

架构无需推翻;blocker×1 必须开工前修(改一张表),major×3 开工前回填。

---

## 1. BLOCKER

### ROC-B1 16 默认预算表对 stateless 范式套用 resume 超线性公式,预算刹车在默认配置下被架空

- severity: **blocker**
- 证据(数值可逐格复算):
  - 16 §6.4 `PLAYBOOK_STOP_DEFAULTS`:`red-blue.maxTotalTokens = 808_000`、`pair = 470_000`、`parallel = 1_230_000`、`master-worker = 1_750_000`。16 §6.4 同段明文:"本表是 04 §9 表的**配置层镜像**,数值必须与 04 §9 **逐格一致**"。
  - 04 §9 表(同四范式 maxTotalTokens 估法):`red-blue`(continuity=**stateless**)="线性 c×N×1.3(N=8,c=1.5base≈**225k**)";`pair`(stateless)="线性 `c×N×1.3`(N=6≈**168k**)";`parallel`(stateless)="线性 `c×N×1.3`(N=10≈**281k**)";`master-worker`(resume)="保守按 N=12 resume≈**1.75M**"。
  - 逐格比对:red-blue 808k vs 225k(**3.6×**)、pair 470k vs 168k(**2.8×**)、parallel 1.23M vs 281k(**4.4×**)、master-worker 1.75M vs 1.75M(✓ 唯一一致,因它确实 resume)。
  - 反向验证 16 用的是哪个公式:`base×N(N+1)/2×1.2` 代入 base=18700——red-blue N=8:18700×36×1.2=**807,840≈808k**;pair N=6:18700×21×1.2=**471,240≈470k**;parallel N=10:18700×55×1.2=**1,234,200≈1.23M**。三个数**精确落在 resume 超线性公式上**。16 §12.1 示例配置的注释更是直接坐实:`maxTotalTokens: 808000 # 按 base×N(N+1)/2×1.2(N=8)反推`——对一个 `defaultContinuity: stateless` 的 red-blue 配置,用了 resume 公式。
- 这正是 04 自己点名的头号误配:04 §6.5 配额建议:"**最危险的误配是把 stateless 套超线性公式——额度会大 3–4 倍,前瞻刹车形同虚设**";04 §13.2 #3 重申同一句。16 把这条禁忌**烤进了默认表**。
- 后果(成本失控真实可达):stateless 范式 N=8 真实累积 input ≈ `c×N` ≈ 150–224k(04 §6.5 stateless 行)。预算顶设成 808k → ① B3 确定性触发(04 §6.4 ①:累积 ≥ maxTotalTokens)永不发生;② 前瞻刹车(04 §6.4 ②:`当前累积 + 预测增量 ≥ 上限`才停)——stateless 实测外推每轮增量≈常数,8 轮累积远不到 808k,projected 永远 < 808k → **前瞻也永不发生**。于是默认配置下**整条 B3 预算安全网(含前瞻)对三个 stateless 范式完全死掉**,唯一兜底退化成 maxRounds。一旦 stateless 因 digest 增长、context 裁剪失效、或误切 resume 而成本上扬,B3 不会拦,只有 maxRounds 在 8/6/10 轮处硬停——而那时已超付 3–4× 名义预算的钱。
- 与兄弟文档的交叉确认:**评测台 18 §6.4 `estimateRunTokens` 做对了**——它按 regime 分叉:`continuity==='resume' ? base*n(n+1)/2 : Math.round(base*n*1.3)`。即同一个 base×n×1.3 的 stateless 线性公式,18 用了、16 没用。16 与 18 对"stateless 该花多少"口径直接打架,而 16 是真正驱动运行期刹车的那份。
- 附带:04 §9 自身也有轻微 number/formula 失配——red-blue 写"c×N×1.3...≈225k",但 28050×8×1.3=292k,≈225k 其实是没乘 1.3 的 c×N。这让"正确目标值"本身有 ±30% 模糊,但不改变 16 用错公式(2.8–4.4×)这一量级结论。
- 要求:① 16 §6.4 `PLAYBOOK_STOP_DEFAULTS` 的三个 stateless 范式(red-blue/pair/parallel)`maxTotalTokens` 改用 stateless 线性公式 `c×N×margin`(与 04 §9 同源、与 18 §6.4 `estimateRunTokens` 同公式),master-worker 保留 resume 超线性;② 16 §12.1/§12.2 示例注释同步改(red-blue 的 808k 注释删掉"base×N(N+1)/2");③ 04 §9 把"c×N×1.3"与"≈225k"的算术对齐(要么数值含 1.3 要么文字去 1.3),消除目标值的 ±30% 模糊;④ 加一条 CI/单测断言:`PLAYBOOK_STOP_DEFAULTS[id]` 与 `estimateRunTokens` 对该范式默认 continuity 的估值同量级(差 <1.5×),把"配置层用错 regime 公式"变成编译/测试期可拦,而非靠人读两张表对齐(16 §6.4 注已承诺"单一真值在 04 §9",但无机器校验)。

---

## 2. MAJOR

### ROC-M1 usage 字段漂移被划为 degradable,成本刹车在 usage 缺失时按 18.7k 地板兜底 → maxCostUsd 静默失明、欠付 run 不被拦

- severity: major
- 证据:
  - 19 §6.3 能力断言清单把 `event.turn_completed.usage` 标 **`degradable`**,失配后果"成本计量缺源(标 usage_missing,15 M2),能跑"——即 codex/claude 升级改了 usage 字段名/结构时,**探针只 drift-warn 放行,不拒启**(19 §6.2 verdict 表:degradable 失配 → drift-warn 可启)。
  - 15 O3 / M2:无 usage 的轮标 `usageMissing` 而非猜值,token 计数**不变**(15 §3.4 `recordTurnCompleted` else 分支:只 warn,不自增 token counter)。
  - 04 §2.1 / §6.4 的兜底:usage 缺失按 `BASELINE_INPUT_PER_ROUND(18.7k) × (round+1)` 地板兜底(H-USAGE)。
- 反例(成本刹车失明):假设某次 claude/codex 升级把 `turn.completed.usage` 改名(19 §6.1 明列此漂移面),探针 degradable 放行继续跑。此后**每轮真实 usage 拿不到** → 04 BudgetPolicy 只能用 18.7k×轮数 地板。但 18.7k 是 codex **最简回合**基线底价(事实 D);真实一轮(长 prompt + reasoning 模型 + resume 累积)可能是 5–10×。于是:① `maxTotalTokens` 按地板算永远远低于真实,**B3 token 顶永不触发**;② `maxCostUsd` 更糟——它由 `usageToUsd(flooredUsage,...)` 算(04 §6.4),地板 input + output=0(缺失当 0)→ 估算费用严重偏低,**用户设的 $12 上限挡不住真实 $40+ 的花费**。15 M2/A2 自己也承认"漏算确实低估成本"。整条按"宁可早刹不可漏刹"设计的兜底(H-USAGE),在 output/reasoning 维度上其实是"漏刹"——地板只兜了 input 下界,没兜 output,而 reasoning 模型 output 占比高。
- 为什么 degradable 不够:`event.turn_completed.usage` 失配不只是"成本曲线展示瘸腿"(那确实只是观测降级),它**直接喂 04 的真金白银刹车**。一个能让 `maxCostUsd` 失效的能力失配,严重度应等同"刹车失灵",不该与"`--append-system-prompt` 退化为 prompt 内拼"同列 degradable。
- 要求:① 把 `event.turn_completed.usage` 的失配处置升级——当配置里**启用了 `maxCostUsd` 或 `maxTotalTokens`**(即用户依赖 token 计量做硬刹车)时,usage 断言视为 **critical**(漂移则拒启,提示"成本刹车依赖 usage,当前 CLI 版本 usage 字段失配,拒绝在预算模式下裸跑");未配预算时才退回 degradable(纯展示)。这把严重度与"用户是否依赖它"绑定。② 04 §6.4 的费用兜底:usage 缺失时 `maxCostUsd` 判定改为**按地板 input + 一个保守 output 估**(如 output=input×0.3 含 reasoning,而非 0),宁可高估早刹;或在 usage 连续 N 轮缺失时直接抛 `TOKEN_BUDGET_EXCEEDED`/转 paused(不带着失明的成本刹车继续烧钱)。③ 15 增一个 `usage_missing_streak` 指标 + 告警,连续缺失即面板红字"成本计量已失效,预算刹车不可信"。

### ROC-M2 16 宣称 stop 阈值可热换"下一轮 checkBefore 生效",但 04 v2 已删 checkBefore 且 StopPolicy 无重配接口、ConvergencePolicy 有状态

- severity: major
- 证据:
  - 16 §11.5 热加载:"运行期可热换的:...**stop 阈值(下一轮 checkBefore 生效)**、logging.level...";16 §15.1 也称 stop 阈值热换。
  - 但 04 §0.5 H1 / §2.4 已**删除 checkBefore / 前置刹车**,改"每轮末单次 `update→shouldStop`";x-consistency D1/E6、x-coverage COV-8 都确认 checkBefore 是被废弃的 v1 词汇。16 引用了一个不存在的机制。
  - 更实质的问题:04 的 `buildStopPolicy(cfg)`(§8.3)是**构造期**一次性组装 `CompositeStopPolicy`,其中 `ConvergencePolicy` 是**有状态**的(§4.3:`seen` 指纹全集、`emptyStreak`、`lastUpdatedRound`)。04 全文**没有**任何"运行期替换 StopPolicy 配置 / 调阈值"的接口——只有 `reset(rounds)` 从头重放。`BudgetPolicy`/`MaxRoundsPolicy` 虽无状态但 cfg 也是构造期注入、`readonly`。
- 反例:用户跑到第 5 轮,面板上把 `stop.maxRounds` 从 8 改到 12、`maxTotalTokens` 调高,保存触发 reload。16 §11.5 承诺"下一轮生效",但 04 侧没有接口接收新 `StopPolicyConfig`——引擎要么忽略(用户以为调了实际没调,继续在旧 8 轮顶硬停 → 体验/成本预期错位),要么 `buildStopPolicy` 重建一个**全新 composite**(则 `ConvergencePolicy.seen`/`emptyStreak` 清零,stall 计数从头算 → 本该第 6 轮 stall 的被重置,run 多跑几轮多烧钱;或反之提前 stall)。两条路都不是"干净地下一轮生效"。
- 要求:① 删 16 §11.5/§15.1 的"checkBefore"措辞(对齐 04 v2);② 明确 stop 阈值热换的真实语义:`maxRounds`/`maxTotalTokens`/`maxCostUsd`(无状态刹车的纯阈值)可在轮边界安全替换(04 给一个 `MaxRoundsPolicy`/`BudgetPolicy` 的 `reconfigure(cfg)` 或重建+迁移接口);`convergence.stallWindow` 等**有状态**项热换需定义状态迁移(重建后用 `reset(rounds)` 重放历史指纹保 `seen`/`emptyStreak` 连续,而非清零)——04 需新增此接口,16 引用它;③ 若决定 stop 阈值**不支持**热换,则 16 §11.5 把它移到"不可热换、需重启 run"清单(与 repoRoot 同列),别承诺做不到的事。

### ROC-M3 评测 runner 并发未接 17 全局 ConcurrencyGovernor,矩阵跑批可破 8 并发 429 顶 + 烧钱不受全局令牌桶约束

- severity: major
- 证据:
  - 18 §9.6:"跨 (task,cell) **可并发**...并发度受 mode 约束:replay 态 IO-bound 可高并发;live 态受中转限流(03 Q3【待实测】),**默认并发 2**,可配"。18 自己定义了一个并发度,但**全文未引用 17 的 `ConcurrencyGovernor`**(17 §2 那个进程级全局许可池)。
  - 17 §2.1 把 governor 立为"唯一的'能不能再发一路请求'的裁决者...任何绕过它直接 spawn 的代码路径都是 bug,CI 应静态检查 spawn 调用必经 governor.acquire"(17 §2.1 / P7 / P8 测试)。17 §9.3 多 run 公平也明说"多 run 共享同一 governor(全局单例)"。
  - 18 §9.1 runner 调 `runEngine(playbook, deps)`,§9.3 "复用 server 的 run 引导,不绕过"(EV1)——若真复用 server run 路径,理论上会经 governor;但 18 §9.6 又**自报一个独立的"默认并发 2"**,说明 runner 在 `runEngine` 之上**还有一层 (task,cell) 并发**,这层是 18 自己调度的,不在 17 governor 视野内。
- 反例(破 429 顶):eval live 矩阵跑 `tasks×cells`,18 §9.6 默认并发 2 个 (task,cell)。每个 cell 跑一个 run;若 cell 是 `parallel` 范式,单 run 一轮 spawn 2 路(17 §2.1 来源 1);叠加 18 的 2 个 cell 并发 → **同时 4 路真 spawn**。若再有 panel(07 §10,N 成员)→ 更多。17 governor 默认 capacity=2、hardMax=4,本是为**防 8 并发 429**(事实:8 即 429,2 安全)。但 eval 的 (task,cell) 并发是 governor **看不见的上游调度**——除非每个 spawn 都过 governor.acquire(18 没说它接了),否则 eval 跑批会叠加突破 governor 上限,直接吃 429。18 §15 EQ2 自己也把"live 态两 worker 并发是否被限流"列待实测,但没把根因(没接全局 governor)点出来。
- 为什么是 major 而非 minor:评测台是**唯一量化成本的工具**(18 §0.1),它本身若因没接 governor 而频繁吃 429,① 429 烧往返+配额还得退避重试(17 P-3:"宁可排队不可吃 429"),评测自己变成烧钱大户;② 429 触发的退避/失败会污染被测 cell 的 wall-clock 与 passVariance(18 §4.5),让"哪个范式快/稳"的结论失真——评测结果不可信,等于量化工具的根基被动摇。
- 要求:① 18 §9.6 显式声明 runner 的所有真 spawn(live 态)**必经 17 `ConcurrencyGovernor`**(同一进程全局单例;eval 与正常 run 共享许可池);(task,cell) 并发只是"提交意愿",真并发由 governor 节流——把 18 的"默认并发 2"改为"提交并发可高,真 spawn 受 governor capacity 约束"。② 17 §2.1 的"spawn 必经 governor"CI 守卫(P8)覆盖范围明确含 `@sylux/eval`。③ replay 态(无真 spawn)不受此限(IO-bound 可高并发,18 §9.6 这半句对)。④ EQ2 的实测改为验证"接了 governor 后 live 评测不吃 429",而非验证 18 自报的裸并发 2。

## 3. MINOR

### ROC-m1 崩溃恢复 resume 时,首个 resumed 轮的 resume 重计费尖峰未计入"是否还在预算内"的判定

- severity: minor
- 证据:19 §5.3 resume 决策树:"累积 token 仍在预算内(stop.budget)→ resume 续接;已近预算 → 转人工"。它用的是**崩溃前已落盘的累积 token**判"在不在预算内"。
- 反例:事实 D——resume 的第一轮按**全量历史**重计费(round1=18755→round2=37645)。崩溃在第 6 轮、累积已 600k、预算顶 808k(还有余量,决策树判"可 resume")。但 resume 续接的那一轮会把前 6 轮历史重灌重计费,单这一轮 input 可能 ≈ `base×7` ≈ 131k,一轮就把累积推到 731k,再跑一轮即破顶。决策树只看"崩溃前累积",没把"resume 重计费尖峰"算进去 → 判了"可 resume",结果 resume 一两轮就触 B3。
- 缓解现状:04 §6.4 B3 在轮末仍会拦(超付至多一轮),不是无限失控,故 minor 不 major。但"决策树说能 resume、实际 resume 没几轮就触顶"是预期外的体验+小额超付。
- 要求:19 §5.3 判"是否 resume 在预算内"时,把 `predictNextRoundInputTokens`(04 §6.2,resume regime 外推)的下一轮尖峰加进去:`崩溃前累积 + resume首轮预测增量 ≥ 预算` 则转 fresh(stateless 重建精简上下文,事实 D 下可能更省)或人工,而非按裸累积判。

### ROC-m2 jsonl 默认不 fsync,断电丢末几行 = 已花的 token 未入账,恢复后预算欠计

- severity: minor
- 证据:19 §5.4 / §9.1 A3 / openQuestion:"默认 `appendFile` 不强制 fsync(性能);断电可能丢 OS 缓冲里的最后几行...本地单机可接受"。15 O6:成本曲线从 jsonl `round_closed.usage` 重建。
- 反例:断电丢掉末尾几行(含某轮 `round_closed.usage` 或 turn usage)→ 恢复重放时这几轮的 token **不在账上**。这些 token 是**真花出去的钱**(中转已计费),但 sylux 的累积 usage 投影会少算它们 → 恢复后 run 继续跑,B3 预算判定基于**偏低的累积**,实际已花的钱比账面多。即"丢的不只是对话,是花了没记的钱",追账失真。
- 缓解现状:本地单机断电罕见;丢的是末几行(至多一轮)。故 minor。但 19 §9.1 A3 把这条归为"worktree 改动不丢"来回应,**没回应"成本入账失真"**这一面——成本视角的丢失比对话丢失更隐蔽(钱花了不知道)。
- 要求:19 §5.4 的 fsync openQuestion 加一条成本维度论证:在 `round_closed`(轮边界)处 fsync 不仅保"最多丢一轮对话",更保"成本入账最多差一轮";恢复后若检测到 `truncatedTailDropped`,面板/日志显式提示"末轮成本可能未入账,实际花费略高于账面"。这把已知残余风险的成本面诚实标注(对齐 19 D8 不吞错)。

### ROC-m3 17 全局 governor 把 codex(中转)与 claude(官方)挤进同一许可池,跨独立端点被过度串行化

- severity: minor
- 证据:17 §2.1 "并发上限...必须是进程级全局的一个许可池——所有 spawn 出口...都先向同一个 `ConcurrencyGovernor` 取许可";17 §9.3 多 run 共享同一 governor;default capacity=2。事实"8 并发即 429"是对**单一中转端点**(mouubox)实测的。
- 反例:红蓝默认 codex=mouubox 中转、claude=anthropic 官方(16 §12.1)。两者是**完全独立的端点**,各有各的限额。但 17 governor 是**单一全局池 capacity=2**,不区分端点——codex 与 claude 并发时共抢这 2 张许可。实际上 mouubox 的并发预算和 anthropic 的并发预算互不相干,本可各跑各的;global=2 把它们串行化,无谓拖慢(尤其 parallel/panel 跨端点场景)。17 §12.2 Q 自己也承认 governor 全局是"有意的串行瓶颈",但论证基于"中转限流是全局物理约束"——这对**单端点**成立,对**多独立端点**不成立。
- 要求:17 §2 的 governor 增**每端点(per egress endpoint / per provider host)子池**维度:全局 hardMax 仍兜底防总爆发,但同一时刻对**不同 base_url** 的并发分别计数(mouubox 2 张、anthropic 官方另 2 张)。AIMD(17 §3.4)的降并发也应**按触发 429 的那个端点**降,而非降全局(否则 mouubox 429 把 claude 官方也降速)。事实地基只测了单端点 8/2,多端点各自阈值【待实测】(17 §3.4 已留 AIMD 调参待实测,此处补"per-endpoint 计数"维度)。降级方案:若不做 per-endpoint,至少 17 §12.2 诚实标注"多独立端点下 global 池会无谓串行,牺牲吞吐换实现简单"。

### ROC-m4 AIMD 砍半并发与 failover 换端点叠加:在挂掉端点上学到的低并发被带到健康新端点

- severity: minor
- 证据:17 §3.4 AdaptiveConcurrency:429 → `resize(capacity/2)`,稳定 120s 才 +1。07 §8.5 failover:active 端点连续报错 → 切到另一候选端点。两者都挂在 provider/并发层但**无联动定义**。
- 反例:mouubox 端点抽风狂 429 → AIMD 把全局 capacity 从 4 砍到 1。紧接着 07 failover 切到 openai-official(健康端点)。但 AIMD 学到的 capacity=1 是**针对 mouubox** 的拥塞信号,被带到了和 mouubox 无关的官方端点 → 官方端点本可 2–4 并发,却被压在 1 跑,要等 120s×N 才缓升回来。AIMD 的拥塞状态没随 failover 重置。
- 要求:与 ROC-m3 同向——AIMD 状态 per-endpoint。failover 切端点时,新端点用它自己的(或初值 2)capacity,不继承旧端点的拥塞惩罚。若 ROC-m3 的 per-endpoint 池落地,这条自然解决;否则 07 §8.5 failover 事件应触发 AIMD `reset` 到初值(17 §3.4 增 reset 钩子)。属边角,但"换了健康端点还被旧端点的病拖累"是真实的吞吐损失。

### ROC-m5 评测回放录制随引擎迭代过期(REPLAY_DESYNC),零成本回放退化为必须 live 重录,评测成本被低估

- severity: minor
- 证据:18 §6.4 "回放态成本为 0";18 §7.3 / §9.5:引擎/playbook 代码变 → `REPLAY_DESYNC` 硬停,该 cell 标 `recordingStale` 待重录;18 §15 EQ5 "录制随引擎迭代的过期速率"待实测。
- 反例:18 把"确定性回放零成本"作为 A/B 反复跑的卖点(EV3)。但引擎(03)在 M2–M3 高频迭代期,`nextTurn` 逻辑稍变就让大批录制 desync(18 §7.3:这是"特性"提醒重录)。重录是 live 跑(烧真 token,18 §9.5 `--record`)。于是"零成本回放"在引擎不稳定期的**真实摊销成本 = 重录频率 × 全矩阵 live 成本**,可能相当高。18 §6.4 "回放态成本为 0"只在录制不过期时成立,这个前提在迭代期常不成立,容易让人低估评测台的实际运行成本(任务简报点名"运行成本是否被低估")。
- 要求:18 §15 EQ5 不只测"过期速率",还要给**摊销成本模型**:`评测台真实成本 ≈ replay跑次数×0 + 重录次数×全矩阵live成本`;并给降低重录频率的工程手段(如把 `nextTurn` 的可变决策与录制解耦、录制只绑"给定输入→agent输出"而非绑引擎版本——18 §7.3 desync 根因是引擎 nextTurn 调用序变,若 ReplayAdapter 按内容而非调用序匹配可降 desync 率)。文档明确"零成本"是"录制有效期内"的零成本,非全周期零成本。

### ROC-m6 panel/Fusion 的 N 倍扇出成本不在 16 默认预算表,启用 panel 后预算口径缺失

- severity: minor(与 red-security RS-M5 同源但角度不同:RS-M5 攻"轮末才停",本条攻"默认表无 panel 行")
- 证据:16 §6.4 `PLAYBOOK_STOP_DEFAULTS` 只有四范式(单 agent)行,无 panel 维度。07 §10.5 panel 成本 = `Σ成员 + 裁判`,N 成员并发;04 §6.5 配额表也只有四范式单 agent 估法(04 §13.2 / 09 表注未含 panel)。
- 反例:用户启用 panel(07 §10,如 critic 角色配 3 成员 panel),单个决策回合成本 ≈ 3×单成员 + 裁判 ≈ 4× 单 agent 轮。但 maxTotalTokens 仍用四范式默认(按单 agent 估)→ panel 几轮就触顶,或(叠加 ROC-B1 的虚高预算)歪打正着没触顶但用户完全不知道实际花了 4×。两种情况都说明 panel 的预算口径在默认表里**缺失**。
- 缓解现状:panel 是远景(07 §10.5 标 M0/M1 先占位),故 minor。但占位不等于不需要预算模型——一旦接上就是 4× 烧钱。
- 要求:16 §6.4 / 04 §6.5 增 panel 预算估法:启用 panel 的范式,`maxTotalTokens ×= (panel成员数 + 1判) / 1`(对启用 panel 的 kind 轮);或在 panel 配置(07 §10.2)里要求显式 `panelTokenBudget`。与 RS-M5(扇出感知前瞻)配套:前瞻刹车要 panel-aware,预算额度也要 panel-aware,两者缺一不可。

### ROC-m7 健康探测 `cli` 模式 + `--deep` 探针的 18.7k/次成本无频率护栏,面板按钮/CI 可被高频触发烧钱

- severity: minor
- 证据:07 §8.5 V6:`cli` 探测 ≈18.7k token/次,"仅面板'验 key'按钮手动触发";19 §6.4 `sylux doctor --deep` 真跑一次最简 prompt 验 output-schema ≈18.7k(事实 D),"升级后手动跑可接受"。
- 反例:两处都是"手动/可接受"的 18.7k 烧钱点,但**无频率护栏**。① 面板"验 key"按钮若用户连点 10 次 = 187k token；② CI 若把 `sylux doctor --deep` 放进每次 push 的 preflight(19 §6.4 没禁止,只说"不混入自动 preflight"是建议非强制)→ 每次 CI 烧 18.7k×agent数。07 V6 把"默认不周期轮询"做对了,但没给"手动触发也要防误触/防 CI 滥用"的护栏。
- 要求:① 面板"验 key"按钮加节流(如 60s 内同 provider 只允许一次,UI 显式"将消耗≈18.7k token"二次确认,07 §8.5 已提示文案但无节流);② 19 §6.4 把"`--deep` 不进自动 preflight/CI"从建议升为**硬约束**(`sylux doctor` 默认不 deep,`--deep` 需显式 flag + 打印成本警告);③ 给 `--deep`/cli 探测一个**进程级日预算计数**,超额拒绝+提示,防脚本循环误烧。

### ROC-m8 04 §9 / 16 §6.4 的 output 占比按 input 15% 估,reasoning 模型(o系/gpt5)output 占比远高,容量与预算双双低估

- severity: minor
- 证据:04 §6.5 "加 output(粗估 input 的 ~15%)×1.15";17 §8.1 容量表同用 ×1.15;两处都标【待实测】reasoning 模型 output 占比更高(04 §6.5 注、04 §13.2 #3、15 §3.3)。02 `TokenUsage` 有独立 `reasoningOutputTokens` 字段(事实 B usage 含 reasoning_output_tokens)。
- 反例:gpt-5.5 / o 系推理模型,reasoning_output_tokens 常达总 output 的 30–50%+,output 总量可能是 input 的 30–60% 而非 15%。按 15% 估的 `maxTotalTokens`/容量表(17 §8.1)会系统性低估,导致:① 容量估算(17 §8)告诉用户"8 轮够 774k",实际因 reasoning 爆到 1M+;② 预算前瞻(04 §6.4 ②)的 output 折算偏低 → 漏刹。这对 reasoning 模型是普遍低估,不是边角(但因有 maxRounds 兜底、且属已标待实测项,定 minor)。
- 要求:04 §6.5 / 17 §8.1 / 15 §3.3 的 output 占比从固定 15% 改为**按模型族分档**(非 reasoning ~15%,reasoning 模型 ~40% 含 reasoning_output_tokens),M2 用 `turn.completed.usage` 的 `reasoning_output_tokens` 实测分布校准(各文档已留此待实测,本条要求把"15% 单一系数"改成"分档+实测校准",别让 reasoning 模型默认低估一个档)。

---

## 4. 跨文档采用一致性速览(成本模型是否被各处正确采用)

事实 D(累积/超线性、18.7k 基线、resume 不省 token)的采用情况逐文档核:

| 文档 | 采用情况 | 结论 |
|---|---|---|
| 04 刹车 | ✓ 两 regime 修正(H-B3)、实测优先预测、usage 唯一源 + 地板兜底 | 正确(骨架权威) |
| 07 provider | ✓ V6 健康探测不轮询(避 18.7k×轮询);§7.3 resume 成本不对称喂路由 | 正确 |
| 15 观测 | ✓ O3 usage 唯一源、§3.3 累积曲线超线性;△ M2/A2 自承 claude usage 缺失低估(见 ROC-M1) | 基本正确,缺口转 ROC-M1 |
| 16 配置 | ✗ §6.4 默认表对 stateless 套 resume 公式(ROC-B1);△ §11.5 checkBefore 幽灵(ROC-M2) | **错(blocker)** |
| 17 性能 | ✓ §5 延迟模型同源 base×k、§6 内存有界、§8 容量逐轮积分;△ governor 单池(ROC-m3) | 正确,缺口转 ROC-m3/m4 |
| 18 评测 | ✓ §6.4 `estimateRunTokens` 按 regime 分叉(做对了,正是 16 该抄的);△ 并发未接 governor(ROC-M3) | 成本估算正确,执行缺口转 ROC-M3 |
| 19 部署 | ✓ §5.3 resume 决策权衡成本、§6.5 jsonl 与 CLI 解耦;△ usage degradable(ROC-M1)、fsync 成本面(ROC-m2)、resume 尖峰(ROC-m1) | 基本正确,缺口转 M1/m1/m2 |

> 一句话:**04/18 把 regime 分叉做对了,16 没抄对**(ROC-B1)——这是成本模型采用的唯一 blocker 级断裂,且恰在驱动运行期刹车的那份配置里。其余是 usage 失明(M1)、热换接口缺失(M2)、评测并发未接闸(M3)三处 major 工程缺口 + 8 条 minor。

---

## 5. 红队自检(对抗性,防自己空喊)

- "ROC-B1 会不会是我误读 04 §9?" —— 不会。808k=18700×36×1.2 是 resume 公式的精确解,16 §12.1 注释**自己写了** "base×N(N+1)/2×1.2(N=8)";04 §9 red-blue 行**自己写了** "stateless...线性 c×N×1.3≈225k"。两份文档对同一范式给了差 3.6× 的数,且 16 用的公式正是 04 §6.5 点名禁用的。证据是文档原文,非推测。
- "RS-M5 已经讲了 panel 成本和轮末才停,ROC-B1/m6 是不是重复?" —— 不重复。RS-M5 攻"刹车**时机**(轮末/无扇出前瞻)";ROC-B1 攻"预算**额度取值**用错 regime 公式";ROC-m6 攻"默认表**无 panel 维度**"。时机对了额度错一样失控,反之亦然,是正交的两个面。
- "ROC-M1 会不会过虑?usage 一般都回得来。" —— 19 §6.1 自己把 usage 字段漂移列为五大漂移面之一,15 M2/A2 自己承认 claude 端 usage 可能不稳(15 EQ Q1 待实测)。它是被文档自己标了风险的面,degradable 的处置与"喂硬刹车"的用途不匹配,不是我凭空假设。
- 没攻到/留给他人的:WS 下游背压(11 §7,non-cost)、worktree 磁盘成本(09,已被 17 §8.4 覆盖且本地磁盘便宜)、Fusion 融合算法成本(21,本批未深读 21 全文,panel 成本框架已在 07/ROC-m6 覆盖)。这些非本报告 scope 或已被邻居覆盖。
