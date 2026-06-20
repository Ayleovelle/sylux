# 红队 · 可行性审查报告 (red-feasibility) [run-tag:v3.1]

> 审查范围:docs/drafts/01~25 全部草稿 + 交叉审查报告(x-consistency / x-coverage / red-security / red-ops-cost)+ docs/PROBED-FACTS.md。
> 审查角色:红队·可行性。专挑「能不能真跑起来」「事实/flag 有没有被正确使用」「引擎/剧本是否过度设计」「收敛检测是否可靠」「25 份是否互相矛盾」「M0/M1 是否藏隐性依赖」「Fusion 边界是否站得住」。
> 与既有报告分工:x-consistency/x-coverage 已穷尽编号双轨制、错误码 union 缺失、强/中→强、Brakes→StopPolicy、术语漂移等一致性/覆盖项;red-security 已覆盖沙箱出网/XSS/流式 redact/argvGuard/_codex_home/预算轮末/node 复跑/出境扫描;red-ops-cost 仅占位。本报告**不复述**它们已记条目(除非可行性角度有新反例),只追加「实现层会爆炸 / 跑不起来 / 隐性依赖」的洞。
> 方法:逐条带 evidence/反例,标 severity(blocker/major/minor)。先骨架 + 第一条,再边砸边追加。

severity 口径:
- blocker = M0/M1 按现规格根本搭不起来 / 退出标准无法真达成 / 架构主路径塌,无低成本替代。
- major = 某条已写好的实现路径作废或实现者大概率写错,有退化但必须开工前定。
- minor = 收敛性/边角/文档级隐患,可带标开工。

---

## 0. 总览结论

verdict:**架构无需推翻,但「M1 最小可行」这层纸是破的——它藏了两条未排期的硬依赖(evidence 核验需要 checkout、stateless 多轮需要 digest 生成器),且 03 的红蓝剧本与 25 的 M1 红蓝是两个不同的东西。** 这三条(FEAS-2/3/4)合起来意味着:照 25 的 M1 任务表(T1.1–T1.18)开工,会在「critic 给 file_ref → 引擎要复算 contentHash → 没有文件系统可读」这一步直接卡死,退出标准 3/4 无法真达成。这不是推翻架构,是 M1 切分把「最小」切过头、把隐性依赖切丢了。

blocker × 1(FEAS-2:M1 evidence 核验无文件系统,退出标准 3/4 假绿)。
major × 5(FEAS-1 预算前瞻 regime 盲区 / FEAS-3 红蓝写文件语义双稿冲突且污染 Fusion 边界 / FEAS-4 M1 digest 生成器未排期 / FEAS-5 收敛器对状态机范式假阳性 / FEAS-7 M0 schema 实测建立在未定 02 之上)。
minor × 3(FEAS-6 收敛过滤的脆弱字符串耦合 / FEAS-8 M1 非真最小+死字段 / FEAS-9 Fusion onStart 接入点不存在)。

收敛检测(04)的**核心算法本身是可靠的**(指纹差集 + requireVerifiedProgress 三反例验收扎实),问题不在算法在「套用范式」(FEAS-5)与「跨稿字符串耦合」(FEAS-6)。Fusion 边界**大方向站得住**(kind=implement 双闸禁),但 `propose` 能带 files 这条缝没缝死(FEAS-3)。

---

## 1. 事实地基(PROBED-FACTS A~G)与 flag 是否被正确使用

### FEAS-1【预算前瞻在 regime 切换点与冷启动会失准,事前刹车有结构性盲区】severity: major

事实地基 D 说 resume 累积超线性、stateless 近似平、基线 18.7k。04 §6.4 ② 的前瞻刹车用「最近两轮实测增量线性外推」(predictNextRoundInputTokens),这一步**确实**回答了 FEAS 骨架原问题(预算是事前/事后):04 有前瞻分支,在启动下一轮**之前**用 lastRoundUsage 预测,不是纯事后。所以「超支一整轮才发现」的基础 lag 已被前瞻覆盖。red-security RS-M5 已把 panel 扇出的前瞻盲区记为 major,本条不复述。

但两个 NEW 盲区前瞻接不住:

1. **regime 切换点失准(master-worker)**:04 §6.2 的外推是 `Δ = last - prev` 的标量线性外推。master-worker(03 §7.2)在「子任务内 resume(超线性) ↔ 跨子任务 stateless(归零)」之间反复切。当第 k 轮刚从 stateless plan 切进 resume implement 链时,prev 是 stateless 的低值、last 是 resume 首轮的低值,`Δ≈0` → 预测「下轮也便宜」;但 resume 链的真实成本在第 2、3 轮才超线性抬头。外推只看相邻两轮,**永远滞后于 regime 切换一到两轮**。03 §6.3 自己估 master-worker「贴近但不破」1.5M 预算,靠的是 maxResumeChain=3 封顶而非前瞻——也就是说前瞻在这个最逼近预算的范式上恰恰最不可靠,真正兜底的是 maxResumeChain 那道硬护栏。反例:子任务 A 的 implement resume 链(18.7k→37k→56k),外推在第 1→2 轮预测 56k(=37+19,对),但第 0(plan,stateless 19k)→1(implement resume 首轮 19k)轮预测 19k,完全没预见这是一条即将超线性的链的起点。

2. **冷启动地板低估真实首轮**:04 §6.2 ③ 冷启动 `predictNextRoundInputTokens([], 18700)` 返回 18.7k。但 18.7k 是事实 D 的「最简回合」基线(空任务 ping)。真实 run 首轮带 goal + 任务文件 + roleBrief,首轮 input 轻松数万。前瞻在第 0→1 轮用 18.7k 地板预测,会**低估**首轮真实成本(red-security RS-M5 关注的是 panel 高估方向,这里是普通 run 首轮低估方向)。无大碍(首轮一般离预算很远),但「base 取 18.7k 地板」这个数字被 04 §6.4 同时用作「每轮至少 base 的兜底下界」(H-USAGE),若真实每轮远高于 18.7k,这个下界形同虚设——它兜的是「usage 缺失当 0」而非「真实低估」。

证据:04 §6.2 predictNextRoundInputTokens 三档;03 §6.3 master-worker 成本表注「贴近但不破…靠 maxResumeChain=3」;事实 D「基线底价≈18.7k」是最简回合实测,非带任务上下文的真实回合。

要求:① 前瞻外推对 master-worker 这类 regime 混合范式,应在「即将进入 resume 链」时(continuity 从 stateless 切 resume 的那一轮)直接用 resume 超线性上界 `base×chainLen` 估,而非标量外推(04 已有 `roundInputSeries` 和 continuity 信息,可据 PromptContext.continuity 选公式而非纯实测外推);② base 地板应区分「最简回合基线(18.7k,用于 usage 缺失兜底)」与「本 run 实测首轮(用于前瞻外推锚点)」,04 §6.2 已写 base 优先取首轮实测——但首轮实测要到第 1 轮末才有,第 0→1 轮前瞻仍只能用 18.7k,这一轮的前瞻天然不可靠,文档应明确「首轮前瞻不可信,靠 maxRounds/maxTotalTokens 硬上限兜」。

> 自检:这条不与 RS-M5 重复——RS-M5 是 panel 扇出 N× 的横向盲区;本条是 regime 切换的纵向外推滞后 + 冷启动地板语义混用,两个不同的失准源。

---

## 2. M0/M1 是否真最小可行(隐性依赖)

### FEAS-2【M1 退出标准 3/4 要求 evidence 强核验,但 M1 没有可供复算的文件系统——强核验跑不了,退出标准假绿】severity: blocker

这是本报告的头号洞,也是 M1「最小」切过头的直接后果。

M1 退出标准(25 §1 M1)第 3 条:「critic 空 evidence / 仅 spec_quote 被打回」;第 4 条:「done + 对面带证据 ack 才真停」。「带证据 ack」与「critique 至少一条强核验通过」的语义全仓一致钉死在 02 §3.2/C1(H2)+ 04 §7.1 条件3:**强 = 中枢独立复算 file_ref 的 contentHash 通过、或实跑 command**。复算需要 `verifyEvidence(e, ctx)`,而 `ctx: ValidateContext`(02 §8.1、21 §3.2)是**只读 worktree 句柄**——必须有一个能按 path + 行区间读出文件内容、算 contentHash 的文件系统。

但 25 §1 M1「关键裁剪」明写:「M1 的红蓝对抗是**纯决策回合**,critic 只读引用证据(file_ref/command),**不产生文件写**,因此 M1 不需要 worktree 合并(09)」。x-coverage COV-9 已点到 M2 diff 面板没东西可渲染,但**没点到更致命的一层**:critic 的 file_ref 指向**哪个文件系统**?M1 任务表 T1.1–T1.18 里:

- T1.2/T1.3 落 `@sylux/shared` 的 `contentHash`/`normalizeContent`/`fingerprint`(纯函数,给定字符串算 hash);
- T1.7 runTurn 里 `deps.validate(candidate, round)` 调 02 §8 validateMessage;
- **但没有任何一个 M1 任务创建「critic 能引用、引擎能复算」的 checkout / workdir**。worktree(T3.1)在 M3,`AgentRuntimeResolver.workdir`(03 §4.3)也没在 M1 排期。

后果:critic 发 `file_ref{path:'src/a.ts', lineStart:10, lineEnd:20, contentHash:'abc'}`,引擎调 verifyEvidence 要去读 `src/a.ts` 第 10–20 行复算 hash——**没有 ctx、没有 workdir、没有 checkout**。两种结局都坏:① 若 M1 干脆不复算(verifyEvidence 恒 pass 或跳过),则退出标准 3「空 evidence 被打回」可以做(空就是空),但「仅 spec_quote 被打回」与「强核验通过」做不到——没复算就分不出强/弱,「强核验」是假绿;② 若要真复算,M1 必须有 checkout,而它被「关键裁剪」明确排除了。

更尖锐:M1 跑的是**真实 codex+claude 对一个真实任务**(退出标准 2:`sylux run --playbook red-blue --task <file>`)。任务必然涉及某个代码库。critic 要引真实代码的 file_ref,引擎要复算,就**必须**把那个代码库以某种只读形式 checkout 出来给 ValidateContext。这个 checkout 不是 worktree 合并(那是写+合并),是「只读快照 + 按 path/区间读文件 + 算 hash」——一个比 worktree 轻得多但**仍然存在**的模块,M1 没排。

证据:25 §1 M1 关键裁剪「不产生文件写…不需要 worktree」;25 §2.2 T1.1–T1.18 无 checkout/workdir 任务;02 §8.1 ValidateContext「只读 worktree」;02 §3.2 强核验 = 复算 contentHash;04 §7.1 done 条件3「ack 已过 validateMessage,evidence 非空且至少一条强核验通过」;21 §3.2 `validateCtx: ValidateContext // 同源,只读 worktree`。x-coverage COV-9 仅记 diff 面板无主,未记核验无文件系统。

要求:**M1 必须补一个「只读任务快照 + ValidateContext 实现」任务**(轻量:把 `--task` 指向的仓/目录做只读 checkout 或直接只读挂载,提供 readFileRange + contentHash 复算)。否则二选一明示:① M1 退出标准 3/4 降级为「只验 evidence 非空 + 结构合法,不验强核验」,并在 25 显式标注「强核验推迟到 M3 有 checkout 后」——但这等于 M1 的红蓝对抗**核心卖点(可机器核验的批判)是假的**,M1 demo 价值大打折扣;② 把这个只读 checkout 模块提进 M1(它本就是 09 的只读子集),代价是 M1 不再是「最朴素的 18 任务」。无论哪条,当前 25 的 M1 是「看起来能跑、实则核验链断裂」的假最小。

### FEAS-3【03 红蓝剧本写文件 + 每轮合并,与 25 的「M1 红蓝纯决策不写文件」直接冲突;且 propose 能带 files 把 Fusion 决策/执行边界冲穿】severity: major

03 §7.1 的 `RedBluePlaybook`:`shouldMergeAt` 恒返回 `true`(注「改动小、串行:可每轮合,让 critic 能用 file_ref 引最新 worktree 内容」),proposer 的 roleBrief「能落代码就在 files 声明改动意图」。即 **03 设计的红蓝是「proposer 写文件 + 每轮 worktree 合并」**。

25 §1 M1 关键裁剪:**红蓝「不产生文件写,不需要 worktree 合并」**。

两稿对「红蓝是什么」根本对不上:03 的红蓝有 worktree 写+每轮合并,25 的红蓝是纯决策无写无合并。这不是编号/术语漂移,是**同一剧本的行为定义在两份权威稿里相反**。实现者照 03 写 RedBluePlaybook(shouldMergeAt=true),引擎到 §5.1 第 4 步就会 `deps.worktrees.mergeRound(round)`——而 25 M1 没有 worktrees。反之照 25 裁剪做,03 §7.1 的 proposer「files 声明改动意图」+ shouldMergeAt=true 全是死代码。

连带把 Fusion 边界(21 §0.2)冲出一条缝:Fusion 严格边界是「决策回合(propose/review/critique/question)允许 panel,执行回合(implement)禁」。但 03 红蓝的 **propose 回合本身就在写文件**(proposer「files 声明改动意图」+ shouldMergeAt 合并)。于是:

- 21 §5.5 synthesizePayload 对 panel propose **强制 `files: []`**(注「决策回合不写文件…即便成员建议改 X 文件,那也只是建议」)。
- 那么对一个「proposer 要落代码」的红蓝,一旦给 propose 配 panel(21 §2.3 表里明列 pair 的「proposer 回合配 panel」、red-blue 的 critic 配 panel),propose 的 files 会被 Fusion **静默清空**——proposer 本该声明的改动意图凭空消失,引擎拿到一条 files=[] 的 propose,worktree 无改动可合,后续 critic 的 file_ref 引用「最新 worktree 内容」引到的是没被改的旧内容。

根因:Fusion 用「kind ∈ {propose,review,critique,question} = 决策回合 = 不写文件」这个等式划边界,但 03 的 `propose` **就是写文件的**(声明 files)。「决策 vs 执行」按 kind 切,而 propose 跨在两边:它既是决策(给方案)又可能携带文件改动意图。21 §0.2 的二分对 propose 不成立。

证据:03 §7.1 RedBluePlaybook `shouldMergeAt(){ return true }` + proposer roleBrief「能落代码就在 files 声明改动意图」;25 §1 M1「红蓝…不产生文件写…不需要 worktree 合并」;21 §0.2 边界表 propose=决策回合=成员只读不写文件;21 §5.5 `files: []` 硬清空 + 注「即便成员建议改 X 文件那也只是建议」;21 §2.3「pair…proposer 回合配 panel」。

要求:① 先裁决「红蓝的 propose 到底写不写文件」——若写(03 口径),则 25 M1 必须含 worktree(与 FEAS-2 合流:M1 不可能既无 checkout 又跑真红蓝),且 Fusion **不可对会写文件的 propose 启用**(21 §0.2 边界要从「按 kind」改成「按该 turn 是否声明 files / shouldMergeAt」);若不写(25 口径),则 03 §7.1 必须删 proposer 的 files 声明 + 改 shouldMergeAt=false,红蓝退化为纯口头辩论(但那 critic 引的 file_ref 指向何处又回到 FEAS-2)。② Fusion 边界的「决策/执行」二分不能只看 kind——propose 是反例;应改为「该发言是否产生 worktree 写(声明非空 files 或 shouldMergeAt)」,凡写文件即禁 panel,与 kind 解耦。

> 这条与 x-consistency D1(01 用 v1 引擎词汇)不同源:D1 是 01↔03 的接口词汇漂移;本条是 03↔25 对红蓝**行为语义**的实质冲突 + 传导到 21 Fusion 边界的二分失效。

### FEAS-4【M1 default stateless 红蓝靠 digest 维持连续性,但 DigestBuilder 生成算法在 03↔17 之间互相踢皮球、无人定义,M1 也未排期;>2 轮红蓝 agent 会失忆】severity: major

红蓝范式(03 §7.1 / §7.2)`defaultContinuity: 'stateless'`(16 §783 示例配置也明写 `defaultContinuity: stateless # 长程辩论:resume 累积成本会爆`),这是事实地基 D「resume 累积超线性」逼出来的正确选择。但 stateless 意味着每轮 spawn 是全新进程、零会话记忆,agent 看到的全部上下文 = `PromptContext`,而连续性**唯一**靠 `PromptContext.digest`(03 §2.1.1)——「截至上一轮的结论摘要」。红蓝四范式伪代码每轮都调 `buildDigest(board)`(03 §758、§814、§965)喂 digest。digest 的质量直接决定 stateless agent 是否记得住上一轮自己说过什么、对面批了什么。

问题:`DigestBuilder` 的**生成算法没有任何文档真正定义**,两份权威文档互相把它推给对方:

- 03 §2.1.1 明写:「本文件在此**定形其接口**…**生成算法与质量策略归性能文档 17 §6.3**」;03 §1096 归属表:「性能 17 §6.3 → digest 生成算法 + 质量策略 + 裁剪上界(本文件只定接口,不定算法)」。
- 17 §6.3 标题就叫「prompt 历史裁剪(事实 D 省钱的唯一手段,**引擎 03 拥有算法**,本文件给约束)」,正文:「本文件不定义裁剪算法(**归引擎 03 ContextBundle**),但给性能约束」。

即 03 说算法归 17,17 说算法归 03,**双向 punt,中间是空的**。x-coverage COV-10 顺带提过一句「17 §6.3 实为 prompt 裁剪、未真正定义 DigestBuilder 算法」,但没展开成可行性后果。两份文档都只给了「接口形状」和「性能上界约束」(保最近 K 轮全文 + 更早压结论、evidence 锚点优先保留、裁剪后仍守 base×k),**没有一处给出「如何把第 j 轮的一条 propose+critique 压成一段既短又不丢关键约束的结论文本」的算法**——而这恰恰是 stateless 连续性成立与否的命门(03 §1109 Q4 自己也承认「stateless 下 digest 质量对连续性的实际影响(digest 多短会丢关键约束)」是 openQuestion)。

传导到 M1:25 T1.5「Blackboard 实现…+ ContextBundle(只喂 delta + digest,PF·D 省 token)」是唯一沾边的任务,验收只写「contextFor 只含 delta(单测)」——**digest 生成被夹带在一个 M 级任务里、无独立验收、无算法来源**。退出标准 2 要求「≥2 轮对抗」:恰好 2 轮时,第 2 轮的 PromptContext 可以靠「最近 K 轮全文」(K≥1 就够覆盖第 1 轮)兜过去,digest 可以是空操作或全文直传,**所以 M1 的 2 轮 demo 不会暴露这个洞**。但只要红蓝跑到第 3 轮(stallWindow 默认 2,真实辩论常 4–8 轮),第 1 轮就滑出 K 窗口、必须靠 digest 承载——此时 digest 若是 naive 截断或空,proposer/critic 就**失忆**:看不到自己最初的提案与对面最早的批判,会重复出已被驳回的方案,反而**人为制造 FEAS-5/收敛假象**(换措辞复读)。

证据:03 §2.1.1 + §1096「算法归 17」;17 §6.3「算法归 03」;03 §1109 Q4 自承 digest 质量对连续性影响是未决问题;25 T1.5 把 digest 塞进 ContextBundle 任务且无算法验收;03 §702 成本表注红蓝「stall 通常更早停」——但那是在 digest 能维持连续性的前提下,digest 失效则 stall 反而提前(假阳性)。

要求:① 在 03 或 17 **二选一**钉死 DigestBuilder 的**最小可用算法**(哪怕是 v0:「保最近 K 轮全文 + 更早轮只保留其 evidence 锚点列表(file_ref path:line + command cmd)丢弃 body 散文」——这版纯结构化、零 NLP、可单测,且与 H5 注入约束天然兼容因为只留结构化 evidence),停止互相 punt;② M1 必须给 digest 生成一个**独立任务 + 连续性验收**(如「第 3 轮 PromptContext 仍含第 1 轮的 proposal 锚点」),否则退出标准 2 的「≥2 轮」是踩在「恰好不触发失忆」的临界点上的假绿——把退出标准改成「≥3 轮且第 3 轮 agent 不重复第 1 轮已驳方案」才真正验到连续性;③ 若 M1 决定 digest = 全历史直传(不裁剪),必须显式标注「M1 不省 token、成本按全量 resume 量级,maxRounds 压到很低(如 4)」,因为那等于放弃事实 D 的省钱手段,与 16 §783「resume 累积成本会爆」自相矛盾。

> 自检:这条与 FEAS-1(预算前瞻)不同源——FEAS-1 是「花多少钱预测不准」,本条是「省钱手段(digest)的算法根本不存在,导致 stateless 连续性无保障」。与 x-coverage COV-10 的区别:COV-10 把它当一致性/归属漂移记一句;本条论证它是 M1 连续性的**可行性命门**且 2 轮 demo 会掩盖它。

---

## 3. 收敛检测(04)是否可靠

### FEAS-5【收敛 stall 检测把「evidence 指纹差集为空」等同「无进展」,但 master-worker / parallel 这类状态机范式存在「合法的无新证据轮」,会被误判 stalled】severity: major

04 §4 的收敛核心算法**本身扎实**:S3「指纹是唯一收敛信号源、不看 body 文本」焊死了 R5,H-FP 的 `requireVerifiedProgress`(剔 `:?` 占位 + `s:` 弱指纹)堵死了「换行区间刷假指纹」的对抗,三反例验收(换措辞同问题→stall、真新问题复用旧引用→不误杀)是对的。问题不在算法,在**它被无差别套用到所有范式**,而「连续 stallWindow 轮强指纹新增为空集 = stall」这个判据只对**辩论型范式(red-blue/pair)**成立。

反例(master-worker,03 §7.2 / §1004):master-worker 的轮结构是状态机 `planner→plan→worker→implement→planner→review→…`。其中:
- **planner 出 plan 的那一轮**:planner 的产出是「把任务拆成子任务/给 worker 下一步指令」,kind 偏 `propose`/`question`,**本质上不产生 file_ref/command 强证据**——它在派活,不在举证。这一轮强指纹新增天然为空,且是**合法的**。
- **review 打回但未给新锚点的轮**:planner review 说「这版不行,重做」,若它的 evidence 引的是**上一轮 worker 已提交的同一批 file_ref**(指出同样的文件有问题),差集 = 空(复用旧指纹),但这是**真实的评审推进**,不是停滞。

于是一个正常推进的 master-worker:planner 派活轮(空)→worker implement 轮(有新 file_ref,非空)→planner review 轮(可能复用旧锚点,空)。stallWindow 默认 2,只要「派活轮 + review 复用轮」连续出现两次空集,就触发 `CONVERGENCE_STALL` 终态 `stalled`——**把一个正推进的主从流程误杀成停滞**。03 §989 自己也承认 parallel「stall 低发(靠完成收敛而非辩论)…主要靠 maxRounds/tokenBudget 兜底」——这等于默认 parallel 的 stall 判据基本失效,但**没说 master-worker 同样需要不同的 stall 语义**,而 master-worker 的「派活/验收」空证据轮比 parallel 更规律。

04 §4.2 有 `minActiveRounds`(默认 1,前 N 轮空不计)和 `stallWindow`(可调),理论上 playbook 可以调大 stallWindow 规避。但:① 这是「靠调参绕过」而非「判据本身对范式正确」,03 §702 的成本表给每个范式估了不同 N,却**没给每个范式配不同的 stallWindow/收敛语义**;② 更根本的是,master-worker 的「空证据轮」不是偶发噪声、是**状态机的固定相位**,调大 stallWindow 只是推迟误杀,不能消除——只要连续两个「派活+复用」相位撞在一起就中招。

证据:04 §4.1「连续 stallWindow 轮强指纹新增为空集 → stall」;04 §243「仅计核验通过的强指纹」;03 §7.2 master-worker 状态机 planner/worker/review 相位;03 §989 自承 parallel「stall 低发…靠 maxRounds 兜底」;03 §702 成本表按范式给不同 N 但收敛参数未按范式分化;04 §4.3 `ConvergenceConfig` 只有全局 `stallWindow`,无「按 kind / 按相位豁免」机制。

要求:① 收敛检测必须**按范式/按发言 kind 分化**——至少:planner 的 `propose`/`question`(派活)轮不计入 stall 窗口(类似 minActiveRounds 但按角色而非轮序);master-worker/parallel 的主收敛信号改为「done 收口(review 通过 + worker done)」而非「指纹差集空」,指纹 stall 仅作辅助兜底且 stallWindow 显著放大。② 03 的每个 playbook 应声明自己的收敛语义(辩论型用指纹差集、状态机型用 done 收口),04 的 `ConvergenceConfig` 增「豁免 kind 集合」或「按 role 不计窗口」字段,由 playbook 注入。③ 把 03 §989「parallel 靠 maxRounds 兜底」这句从「parallel 特例」升格为「所有非辩论范式的 stall 判据需重新定义」,否则 M3 T3.7 的收敛反例单测只验了 red-blue 的两个反例,**没验 master-worker 派活轮不被误杀**,会上线一个对主从范式系统性误判的刹车。

> 自检:这不与 H-FP(未核验指纹刷 stall)冲突——H-FP 防的是「假指纹让 stall 永不触发」(漏杀),本条指的是「合法空证据轮让 stall 误触发」(误杀),是同一判据的相反失效方向。04 把精力全花在防漏杀(对抗 agent 刷指纹),没防误杀(状态机正常空轮)。

### FEAS-6【收敛过滤器靠裸字符串前缀/后缀(`s:` / `:?`)耦合指纹格式,02 改格式时 04 静默失效,无编译期保护】severity: minor

02 §9.2 用裸模板串定义指纹格式:`f:${path}:${lineStart}-${lineEnd}:${contentHash}`,未核验时退化为 `…:?`(02 §720-722),弱指纹用 `s:` 前缀(spec_quote)、command 类用 `c:` 前缀(02 §9.2 同段)。04 §4.3 `filterFingerprints` 用裸字符串操作消费这套格式:`fp.startsWith('s:')`(剔弱)、`fp.endsWith(':?')`(剔未核验,04 §348-349)。

两份文档对指纹格式的耦合**完全靠字符串字面量约定,没有任何共享常量/类型/解析函数**。后果:02 §709 自己声明「`normalizeContent` + sha256-hex-16 是 contentHash 的权威定义,任何改动都是破坏性变更必须 SCHEMA_VERSION+1」——但这个版本纪律只覆盖 contentHash **算法**,不覆盖**指纹的字符串布局**。若哪天 02 把 file_ref 指纹前缀从 `f:` 改成 `fr:`、或把未核验占位从后缀 `:?` 改成前缀 `?:`、或 path 里本身含 `:`(Windows 盘符 `G:` 就含!)导致 `endsWith(':?')` 与 split 逻辑错位——04 的 `filterFingerprints` **不会编译报错、不会运行抛错,只会静默过滤错误**:该剔的 `:?` 没剔(漏杀,stall 永不触发)或不该剔的被剔(误杀)。

尤其 Windows 路径耦合:02 §219 file_ref.path 是「worktree 内相对路径」,相对路径一般不带盘符,但若实现里混入绝对路径或 `path` 含冒号,`f:G:\src\a.ts:10-20:?` 这种串用 `endsWith(':?')` 仍对(后缀稳),但任何「按 `:` split 取字段」的下游(如面板展示、evidence-map)会被 path 里的 `:` 打散。本条聚焦 04↔02 耦合面,split 风险只是旁证。

证据:02 §9.2 `f:`/`s:`/`c:` 前缀 + `:?` 后缀均为裸模板串;04 §348 `fp.startsWith('s:')`、§349 `fp.endsWith(':?')` 裸操作;02 §709 版本纪律只锁 contentHash 算法未锁指纹布局;02 §55 指纹函数签名归 02 但「实现服务于刹车 07」——即指纹格式的生产方(02/07)与消费方(04)是不同文档不同包,纯字符串约定跨包。

要求:① 02 §9 把指纹格式的**前缀/后缀常量与判定谓词导出**为 `@sylux/shared` 的具名导出(如 `FP_PREFIX_FILEREF='f:'`、`FP_PREFIX_SPEC='s:'`、`FP_SUFFIX_UNVERIFIED=':?'`,以及 `isUnverifiedFp(fp)`/`isSpecFp(fp)` 谓词函数),04 §4.3 改为 import 这些谓词而非裸 `startsWith`/`endsWith`;② 这样 02 改格式时,谓词跟着改一处,04 自动跟随,且谓词可被 02 §13 契约测试矩阵覆盖(V16/V17 已测指纹,顺带断言谓词);③ minor 级:不阻断开工,但应在 M1 T1.3(指纹/哈希)落地时一并把谓词导出,避免 M3 T3.7 收敛检测落地时再回头改 02。

### FEAS-7【M0 闸的 P2 schema 体积探针要 `require @sylux/shared/dist`,但 shared 是 M1·T1.2 才建——M0 退出标准依赖一个 M0 不让建的产物,闸门自相矛盾】severity: major

24 §3.2 P2 任务卡(决定 claude schema 走内联还是 stream-json,是 25 §3.2 自认的关键路径瓶颈之一)的验证命令(24 §147-152):
```bash
# 在 @sylux/shared 构建后,或用临时脚本直接调 buildAgentOutputJsonSchema()
node -e "const { buildAgentOutputJsonSchema } = require('./packages/shared/dist/index.js'); ..."
```
它 `require('./packages/shared/dist/index.js')`——需要 `@sylux/shared` **已构建出 dist**。但:
- 25 §1 M0 范围明写「仅 `fixtures/` 与一次性探针脚本;**不建 monorepo、不建包**」;25 §0.2 原则 1「M0 不写任何产品代码」;24 §3 顶部「M0 闸全绿之前,不开工实现期编码」。
- `buildAgentOutputJsonSchema()` 定义在 02 §6.2,实现落 `@sylux/shared`,而建 `@sylux/shared` 是 **M1·T1.2(L 级任务)**,排在 M0 **之后**。

于是 P2 的退出标准踩了循环:M0 要量 schema 字节数 → 需要 `buildAgentOutputJsonSchema()` 的真实输出 → 需要 `@sylux/shared` 构建产物 → 而建 shared 是 M0 之后的 M1·T1.2,且 M0 范围明确禁止建包。24 §147 那句「**或用临时脚本直接调**」试图给后门,但临时脚本要复现 `buildAgentOutputJsonSchema()` 就得**把 agentMessagePayloadSchema(02 §6.2 整个 zod 定义,含 evidence 三锚点 discriminatedUnion)在临时脚本里重抄一遍**——而 02 此刻还没冻结(x-consistency 列了 02 §12 错误码 union 缺 17+ 个、A 段类型仍在回填),抄出来的临时 schema 与最终 T1.2 落地的可能字节数不同。量出的 32KB 判定因此**建立在一个未冻结、可能要重抄的 02 之上**:M0 量到 28KB 判「内联可行」,等 T1.2 真落地 02 补全字段后涨到 35KB,claude adapter(T1.11)已按内联写完,撞 32KB 上限返工——而这正是 M0 闸本来要提前消除的风险(25 §3.2「M0 先量字节数定方案,别等 M1 撞墙」)。

更尖锐:M0 闸的**闸门含义**(25 §69)是「四项不全过不进 M1」,P2 是其中之一。但 P2 物理上**必须在 M1·T1.2 之后**才能用「正式产物」跑——这意味着要么 P2 永远只能用「临时重抄 schema」跑(则它验的不是真东西,假绿),要么 M0/M1 的「M0 必须先全绿」边界对 P2 这条不成立(它实际跨在 M0/M1 之间)。

证据:24 §147-152 require dist/index.js;25 §1 M0「不建包」+ §0.2「M0 不写产品代码」;25 T1.2「`@sylux/shared`…落 02 全部 zod schema…`buildAgentOutputJsonSchema()` 产出可用」属 M1;02 §6.2 `buildAgentOutputJsonSchema` 标【待实测】(02 H7);x-consistency A1/COV-1 02 §12 仍缺 17+ 错误码=02 未冻结。

要求:① 明示 P2 的执行形态:M0 阶段用**钉死版临时 schema**(把 02 §6.2 当前的 agentMessagePayloadSchema 连同 evidence 三锚点 discriminatedUnion 原样拷进一次性脚本,并在脚本头注明「快照自 02 §6.2 @ 2026-06-20,02 字段若变需重量」),量出的字节数标为「下界估计」;② 02 必须在 M0 跑 P2 **之前**冻结 agentMessagePayloadSchema 的**字段集**(错误码 union 可后补,但喂给 schema 的 Message 瘦子集字段必须定死),否则 P2 量的是流沙;③ 在 M1·T1.2 落地后**重跑一次 P2**(用正式 dist)作为回归校验,把「M0 量的下界」与「T1.2 实际值」对账,差异超阈值则 claude adapter 方案重审——把 P2 从「M0 一次性」改成「M0 估 + T1.2 校」两段,消除「闸门依赖未来产物」的悖论。

---

## 4. 引擎/剧本是否过度设计 + Fusion 边界

### FEAS-8【M1 退出标准 5 要求验「automation 路径强制 -s workspace-write / claude 对应权限模式」,但 M1 是终端手动 demo、无 automation 路径,这条要么验空气要么逼 M1 提前实现 M4 的权限分级】severity: minor

25 §1 M1 退出标准 5 末句:「自动化路径 spawn 强制 `-s workspace-write`(codex)/ 对应权限模式(claude)」。但 M1 的定位(25 §1 M1 目标 + §3.2)是「一条命令 `sylux run` 终端跑一次真实红蓝、终端可读」——这是**人工手动发起的单次 demo**,不是 CI/自动化批跑。「automation 路径 vs 交互路径」的区分(谁来决定沙箱封顶等级)是 08 §6 + M4(provider/权限)的概念。M1 既没有「交互 vs automation」两条路径的分叉(它只有一条手动 `sylux run`),「automation 路径强制 workspace-write」这条断言**在 M1 没有被测对象**:要么实现者把它解读成「M1 所有 spawn 都封 workspace-write」(那不是 automation 特化,是无条件封顶,措辞误导),要么为了「验 automation 路径」逼 M1 提前搭出 M4 才有的 interactive/automation 模式分流(范围蔓延)。

附带死字段:M1 红蓝是**纯决策回合不写文件**(25 §1 关键裁剪),codex 的 `-s workspace-write` 是「允许写工作区」——一个不写文件的纯决策 demo 给 workspace-write 既无必要(它不写)又与「最小」矛盾(更该给 `read-only`,封得更死更安全)。25 T1.10 验收也确实写了 codex adapter `-s workspace-write`,但 M1 critic 只读引用证据(且 FEAS-2 已指出 M1 根本没文件系统可写),workspace-write 在 M1 是**配了用不上的权限**,反而扩大了攻击面(red-security RS-B1 正担心 workspace-write 是否允许出网)。

证据:25 §1 M1 退出标准 5「自动化路径 spawn 强制 -s workspace-write」;25 §1 M1 目标=终端手动 demo,无 automation/interactive 分流;25 §1 关键裁剪「纯决策回合不产生文件写」;25 T1.10 codex adapter 验收含 `-s workspace-write`;FEAS-2 已证 M1 无可写文件系统;red-security RS-B1 workspace-write 出网未实测。

要求:① M1 既是纯决策、无文件写,codex 沙箱应封到 **`read-only`** 而非 `workspace-write`(更小、更安全、与「不写文件」自洽),退出标准 5 的措辞从「automation 路径强制 workspace-write」改为「M1 spawn 一律 read-only(纯决策无需写)」——把 workspace-write + automation/interactive 分流整体推迟到 M3(implement 真写文件)/M4(权限分级);② 若坚持 M1 用 workspace-write(为了让 adapter 代码一步到位不返工),则删掉「automation 路径」这个 M1 不存在的限定词,直接写「M1 spawn 封顶 workspace-write」,并接受 red-security RS-B1 的出网实测前置。无论哪条,当前「automation 路径强制」是把 M4 的概念漏进 M1 退出标准,验收时无对象可验。

> 自检:这条比 FEAS-2 轻——FEAS-2 是核验链断裂(blocker),本条只是退出标准里一句措辞引入了 M1 不存在的概念 + 一个用不上的权限,实现者会困惑但不会卡死,故 minor。

### FEAS-9【21 称 parallel 范式可在「onStart 切分任务线那一步外挂 panel」,但 onStart 是 `Promise<void>` 钩子、不产出 AgentMessagePayload,Fusion 的接入点(runTurn)在 onStart 不存在】severity: minor

Fusion 边界(21 §0.2)**大方向站得住**:执行回合(implement)双闸禁 panel 是对的(F2)。21 §2 也明确「Fusion 是 runTurn 的一条执行路径」——即 Fusion 只在 `runTurn`(产一条发言)处接入。但 21 §2.3 适用面表给 parallel 范式写的是:「几乎不用…仅在 **onStart 切分任务线那一步**可外挂 panel」(21 §131)。

矛盾:`onStart` 在 03 的接口里是 `onStart(deps: EngineDeps): Promise<void>`(03 §254),runEngine 在循环外调一次 `await playbook.onStart(deps)`(03 §435)。它的职责是「初始化任务目标」(03 §44、§739 `this.goal = await loadGoal(deps)`),**返回 void、不产出任何 Message/AgentMessagePayload、不经过 runTurn**。而 Fusion 的全部机制(21 §5 fan-out→collect→judge→synthesize)产出的是**一条 `AgentMessagePayload`**(F1:一次 panel 发言只产一条 payload),它必须挂在「会产出一条发言的执行点」上——也就是 runTurn,不是 onStart。onStart 既不产发言、也不在 runTurn 路径上,**21 §2.2/§796 自己定的接入点(runTurn 加 Fusion 分流)在 onStart 处根本不存在**。

所以 21 §2.3 表里「parallel 在 onStart 外挂 panel」这句要么是**接入点写错**(onStart 无法挂 Fusion),要么 parallel 想做的「多 provider 并行切分任务线」是一个**全新的、不产 AgentMessagePayload 的 Fusion 变体**(panel 答的不是「一条发言」而是「一份任务切分方案」),那它就**不在 21 §0.2/§5 定义的 Fusion 机制内**——21 §5 的 synthesizePayload 强制产 AgentMessagePayload + files:[](21 §5.5),一份「任务切分方案」既不是发言也不该清空 files,套不进去。结果是 parallel 这一行要么作废(onStart 挂不上),要么需要 21 补一个「决策型 onStart panel」的独立机制,而 21 通篇没有。

这条 severity 定 minor 是因为:21 §2.3 自己也说 parallel「几乎不用 Fusion…适用面最小」,且 Fusion 整体是 M5 远景(25 M5),不阻断 M1–M4。但它暴露 Fusion 边界二分(决策/执行按 kind 切)的第二条缝(第一条是 FEAS-3 的 propose 写文件):**onStart 这种「不产发言的生命周期钩子」既不是决策回合也不是执行回合,却被 21 当成了可挂 panel 的决策点**——边界模型只覆盖了「会产出一条 Message 的 turn」,没覆盖「不产 Message 的钩子」。

证据:21 §131 parallel「仅在 onStart 切分任务线那一步可外挂 panel」;03 §254 `onStart(deps): Promise<void>`;03 §435 runEngine 循环外调一次 onStart;03 §739/§801/§948/§1004 onStart 实现全是 `loadGoal`/初始化、无发言产出;21 §2.2「Fusion 在 runTurn 的接入点」+ §796「runTurn 入口加 Fusion 分流」;21 §5.5 synthesizePayload 产 AgentMessagePayload + files:[]。

要求:① 删掉 21 §2.3 表里 parallel 的「onStart 外挂 panel」这句(onStart 物理上挂不了 Fusion),直接写 parallel「不适用 Fusion(全 implement 执行回合,F2 禁)」,与「适用面最小」自洽;② 若确实想要「多 provider 并行出任务切分方案」这个能力,它不是 Fusion(不产发言),应作为 03 onStart 内部的一个独立可选机制单独设计,明确它产出的是 PlaybookState(任务切分)而非 AgentMessagePayload,不走 21 §5 的 synthesize 链;③ 21 §0.2 的「决策/执行」二分应补第三类「非发言钩子(onStart/onFinish)= Fusion 不适用」,把边界从「按 kind 二分」收紧为「仅 runTurn 产出的 turn 才进 Fusion 分流,且其中 implement 禁、写文件的 propose 禁(FEAS-3)」。

> 自检:这条与 FEAS-3 同根(都是 Fusion 边界二分不够用),但不同源:FEAS-3 是「propose 跨决策/执行两边、写文件的 propose 不该挂 panel」;本条是「onStart 根本不是 turn、不产发言、物理上挂不了 Fusion,却被列为可挂点」。FEAS-3 是 major(传导到 M1 红蓝是否写文件 + files 被清空的真 bug),本条是 minor(parallel 几乎不用 Fusion + M5 远景,改一句表格)。

---

## 5. 25 份是否互相矛盾(可行性视角,不复述 x-* 已记)

x-consistency / x-coverage 已穷尽编号双轨制、错误码 union、强/中→强、Brakes→StopPolicy、术语漂移、ContextBundle 别名等**一致性/措辞**矛盾。本报告从**可行性**角度补充的「行为语义级」跨稿冲突已分散在上文,汇总如下(不重复 evidence):

- **红蓝是否写文件**:03 §7.1(写+每轮合并)vs 25 M1(纯决策不写)——FEAS-3,major,传导污染 Fusion 边界。
- **DigestBuilder 算法归属**:03(归 17)vs 17(归 03)双向 punt——FEAS-4,major,M1 连续性命门。
- **stateless 预算公式**:16 §6.4(三个 stateless 范式套 resume 超线性公式)vs 18 §6.4 `estimateRunTokens`(按 regime 分叉用线性)——red-ops-cost ROC-B1 已记 blocker,本报告确认它与 04 §9/§6.5 自相矛盾,不复述。
- **收敛语义按范式分化缺失**:03 给每范式不同 N 但 04 只有全局 stallWindow——FEAS-5,major。
- **M1 沙箱等级**:25 退出标准 5「automation workspace-write」vs M1「纯决策不写文件」(该 read-only)——FEAS-8,minor。

这些与 x-* 的编号/术语项**正交**:x-* 修的是「同一概念两处叫法/编号不同」,本报告修的是「同一行为在两处定义相反 / 算法无人定义 / 判据套错范式」——前者回填措辞即可,后者必须先做产品裁决(红蓝写不写、digest 算法谁定、收敛按不按范式分化)才能开工。

---

## 6. 总结:可行性视角必清项(按 severity)

| ID | severity | 一句话 | 阻断什么 | 最低成本动作 |
|---|---|---|---|---|
| FEAS-2 | **blocker** | M1 无可读文件系统,evidence 强核验跑不了,退出标准 3/4 假绿 | M1 核心卖点(可机器核验批判) | 补「只读任务快照 + ValidateContext」轻量任务进 M1,或显式降级退出标准并标注 |
| FEAS-3 | major | 03 红蓝写文件+合并 vs 25 红蓝纯决策,直接冲突且 propose 带 files 冲穿 Fusion 边界 | M1 红蓝行为定义 + 21 边界二分 | 裁决红蓝写不写;Fusion 边界改「按是否声明 files」而非按 kind |
| FEAS-4 | major | DigestBuilder 算法 03↔17 互相 punt、无人定义,M1 未排期 | M1 stateless 连续性(>2 轮失忆) | 二选一钉死 v0 算法(只留结构化 evidence 锚点)+ M1 给独立验收 |
| FEAS-5 | major | 收敛 stall 判据套到 master-worker/parallel 的合法空证据轮 → 误杀 | M3 收敛检测对状态机范式正确性 | 收敛语义按范式/kind 分化,状态机型主信号改 done 收口 |
| FEAS-7 | major | M0 P2 schema 探针 require 未建的 shared/dist,闸门依赖未来产物 | M0 闸 P2 能否真跑 + claude adapter 方案 | P2 拆「M0 临时 schema 估 + T1.2 正式校」两段,先冻结 02 字段集 |
| FEAS-1 | major | 预算前瞻在 regime 切换/冷启动失准,master-worker 最逼近预算处最不可靠 | 成本前瞻刹车可靠性 | regime 切换轮用 base×chainLen 上界估;区分 18.7k 兜底地板 vs 实测锚点 |
| FEAS-6 | minor | 收敛过滤靠裸 `s:`/`:?` 字符串耦合指纹格式,02 改格式 04 静默失效 | 跨包格式耦合鲁棒性 | 02 导出指纹前缀常量 + 谓词,04 import 不裸操作 |
| FEAS-8 | minor | M1 退出标准 5 引入 M1 不存在的 automation 路径 + 用不上的 workspace-write | M1 退出标准可验性 | M1 沙箱改 read-only;删「automation 路径」限定词 |
| FEAS-9 | minor | 21 称 parallel 在 onStart 挂 panel,但 onStart 是 void 钩子、不产发言、挂不了 Fusion | Fusion 边界完整性(M5 远景) | 删该行;Fusion 仅 runTurn 产出的 turn 可进分流 |

合计:blocker×1、major×5、minor×3。

**verdict(对抗性自检后)**:已锁定架构(进程模型/黑板/引擎+剧本/provider 可换/Fusion 边界)**无需推翻**,04 收敛核心算法与 02 类型契约质量高。但「M1 最小可行」这层在三处破:FEAS-2(无文件系统→核验链断,blocker)、FEAS-4(digest 算法无人定义→连续性无保障)、FEAS-7(闸门依赖未建产物)。FEAS-3/5 是引擎层「行为语义跨稿相反 / 判据套错范式」,必须开工前做**产品裁决**(不是回填措辞能解决)。引擎/剧本**没有过度设计**——四范式同循环填参数是合理抽象,onStart/StopPolicy/Playbook 接口都用得上;唯一「配了用不上」的是 M1 的 workspace-write(FEAS-8)。Fusion 边界**大方向对**,两条缝(FEAS-3 的写文件 propose、FEAS-9 的 onStart 钩子)是「按 kind 二分」覆盖不到的边角,缝死即可,不动主路径。

> 全局对抗性自检:本报告 9 条均带具体行号 evidence,且逐条标注了与既有报告(x-consistency/x-coverage/red-security/red-ops-cost)的分工边界,未发现复述。最可能被反驳的是 FEAS-5(有人会说「调大 stallWindow 就行」)——已在该条正文回应:状态机空证据轮是固定相位而非偶发噪声,调参只推迟不消除误杀。次可能被反驳的是 FEAS-8 定 minor(有人会说 workspace-write 出网是 blocker)——出网实测归 red-security RS-B1(已 blocker),本报告只记「M1 配了用不上的权限+措辞误导」这一可行性面,故 minor,不抢 RS-B1 的账。







