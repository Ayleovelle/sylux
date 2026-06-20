# 09 · 文件隔离与 worktree 生命周期(权威)

> **版本**:v3.1(2026-06-20)。相对 v2 的硬化点见 §0.7;v2 相对 v1 见 §0.6。
>
> **红队报告已就位(v3.1 修正 v2 的过期声明)**:v2 头部曾称五份具名报告「实际不存在」——该声明**已过期**。本轮 `docs/drafts/` 下五份报告**均存在**:`x-consistency.md` / `x-coverage.md` / `red-feasibility.md` / `red-security.md` / `red-ops-cost.md`。v3.1 已**逐文核对其中点名本节(09)的 findings 并就地吃掉**,清单见 §0.7。仍保留 v2 的本机实测结论(git 2.44.0 的 `merge-tree` stdout 形状,§5.3)与逐文地基核对(02/03/05/08/`PROBED-FACTS.md`)。
>
> **跨文档编号约定(读前必看)**:本文件沿用 02/03/08 的**文件名编号**(安全=08,worktree=09,codex 适配=05)。注意 05/06 用的是另一套**逻辑编号**(其中安全="09"、worktree="06"、provider="05/07"),02 §12 注释亦出现"worktree 06"。两套编号**不一一对应**;本文件与 02/03/08 一致,故**不单方面改号**(改号会与这三份失同步),统一收口交定稿。涉及具体签名处给文件名直链消歧。
>
> **本文件地位**:sylux 的**文件隔离权威设计**。拥有 `WorktreeManager` 行为接口(被引擎 03 §4.3 注入 `EngineDeps.worktrees`)、git worktree 的完整生命周期(创建 / 分配 / round 末 diff / 串行合并 / 3-way 冲突硬停回灌 evidence / 清理)、风险分级到 codex 沙箱的映射,以及 **decision 回合 vs execution 回合的隔离差异**(呼应远景 Fusion)。落地红队 **R7**(纯 worktree 模型)与 **R8**(沙箱封顶)的 worktree 相关部分。
>
> **类型一律引用 02**:`Message` / `EvidenceItem` / `FilePatch` / `AgentId` / `SyluxError` / `SyluxErrorCode` 等全部 zod 类型与错误码,**唯一权威定义在黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。本文件**只引用、不另写任何 zod**。需要 `EvidenceItem` 三锚点精确字段见 02 §3(其中 `file_ref` 的 `contentHash` 是**中枢派生权威**、agent 不自算,强核验靠 agent 提供的 `quote`,见 02 §3/§8.3 的 H1 修正),`FilePatch` 见 02 §4,`ValidateContext.readFileRange/isPathAllowed/runCommandSandboxed` 见 02 §8.1。
>
> **签名不对称(C2,本文件吃掉)**:02 §8.1 的 `ValidateContext.readFileRange(agentWorktreeRel, lineStart, lineEnd)` **不带 agentId**(它由「按发该 critique 的 agent 构造的 context」闭包绑定 worktree 根);本文件 `WorktreeManager.readFileRange(agentId, rel, lineStart, lineEnd)` **带 agentId**(它是无状态的 run 级单例)。二者经一个 `makeValidateContext(agentId)` 适配器桥接(§7.2),**不再用** v1 的可变全局 `currentVerifyAgent`(并发核验下是 bug)。
>
> **与兄弟文档的边界(只引用,不重写实现)**:
> - 引擎主循环 `runEngine` 在轮末调用 `worktrees.mergeRound(round)`、冲突时写 `system` 消息并置 `paused` 的流程归**引擎(03)** §5.1;本文件拥有 `mergeRound` 的**返回契约**与冲突 evidence 的**构造规则**。
> - `WorktreeManager` 被 `EngineDeps.worktrees` 注入(03 §4.3);本文件是该接口的**唯一权威**,03 只引用方法名。
> - `AgentInput.workdir` / `AgentInput.sandbox` 的**字段语义**归 codex 适配器(05)§2;本文件拥有 `workdir` 的**来源(worktree 路径生成)**与 `sandbox` 的**风险分级映射规则**(§10)。
> - 沙箱**封顶到 `workspace-write`** 的安全策略本体、`.syluxignore` / secret-scan / 出境合规、路径白名单 `isPathAllowed` 的**规则**(其权威实现是 08 §4.4 的 `isPathSafe`,含 Windows 专属绕过加固 T12:ADS 冒号流 / UNC / 设备前缀 / 8.3 短名 / realpath)归安全(08)§6/§7;本文件**消费**这些规则做 worktree 拷贝与路径解析,不重定义。**合并相位的二次路径归属校验**(08 §4.4 末尾明确点名 worktree 文档负责)在本文件 §5.5 实现。
> - 命令型 evidence 的**沙箱复跑器** `runCommandSandboxed`(02 §8.1 / 08 §4.8)在 agent 的 worktree 内执行,其 cwd/sandbox/断网/env 约束由本文件 §7.3 提供实例(规则归 08 §4.8)。**子进程网络出境的 fail-closed 封禁本体**(清代理 env + OS per-agent 出站 deny + base_url 白名单)归 **08 §6.3**(v3.1 已落地,不再是「沙箱断网未实测的唯一垫底」);本文件 §7.3/§10 的 `network:'off'` 是**消费方声明**,真实封禁强度由 08 §6.3 兜底(RS-B1)。
> - `contentHash` / `normalizeContent`(CRLF→LF 归一)归 02 §9.1;本文件在 diff/合并里**遵守**该归一,不另写哈希。
>
> **本文件产出的内容是 agent 可控的"不可信数据"(v3.1·RS-B2)**:`diffSince` 产出的 unified diff 正文、`FilePatch.path` / `renamedFrom`、冲突 evidence 里的 `file_ref.quote` / `spec_quote.quote` —— 其字节**全部源自 agent 在 worktree 里写的文件内容与文件名**,属**不可信数据**(可含 `<script>`、`javascript:` 链接、终端转义序列)。本文件**只生产**,**绝不**把它当可信 HTML;面板渲染侧的 **HTML 消毒 / CSP / 纯文本化**是 server→client XSS 的真正防线,归 **08 §5.7 + 10 面板**(v3.1·08 已新增 T16/§5.7)。本文件的责任是:(1) 出境前过 08 `redact`/`guardEgress`(§4.4);(2) 在接口契约上**显式标注该正文为不可信**,提示下游必须消毒。redact ≠ 转义:redact 只抹 secret、**不转义 `<script>`**,二者职责不同必须并存(对齐 08 §B2)。
>
> **事实地基**:spawn 真 exe(A)、codex `-C` 设 cwd 仅首轮、resume 拒 `-C/-s` 且需 `--skip-git-repo-check`(E)、Windows UTF-8/换行坑(A)全部以 `docs/PROBED-FACTS.md` 为准。凡本机已实测项**不再标**【待实测】;仅未覆盖项标注。

---

## 0. 设计目标与不变量

### 0.1 一句话模型

每个**执行体 agent**(`codex` / `claude`)在每个 run 里独占一个 git worktree。运行期**各写各的、无锁、互不可见**;只在**轮末**由中枢**串行**把各 worktree 的改动并入一条 integration 分支;**冲突即硬停**,把冲突点构造成可核验 `EvidenceItem[]` 回灌黑板,**绝不自动选边**,等人工裁决。这就是红队 R7 的「纯 worktree 模型」。

### 0.2 本文件负责 / 不负责

| 负责(本文件给完整规格) | 不负责(引用别处) |
|---|---|
| `WorktreeManager` 接口签名 + 全部方法语义 | `Message` / `EvidenceItem` / `FilePatch` 类型(02) |
| 仓库 / 分支拓扑(base / integration / agent 分支) | engine `runEngine` 循环与 `shouldMergeAt`(03) |
| 创建 / 分配 / round-start 同步 / round 末 diff / 清理 | `validateMessage` 结构与可核验校验(02 §8) |
| 串行 3-way 合并算法 + 冲突检测 | 沙箱**封顶策略本体** / `.syluxignore` / secret-scan(08) |
| 冲突 → `conflictEvidence: EvidenceItem[]` 构造规则 | 路径白名单 `isPathAllowed` **规则**(08;本文件注入消费) |
| 风险分级 → `sandbox` 字段映射(§10) | `AgentInput` 其余字段 / resume 参数拼装(05) |
| decision vs execution 隔离差异(§11,呼应 Fusion) | Fusion panel/judge 调度本体(远景,引擎 03 / 总体规划) |
| `readFileRange` 实现(给 02 §8.1 `ValidateContext`) | `contentHash` 算法(02 §9.1;本文件遵守) |

### 0.3 接口层不变量(实现必须保持)

- **W1 一体一树,全程稳定**:每个执行体 agent 一个 worktree,其**绝对路径在整个 run 内不变**。理由(硬约束):codex `-C <cwd>` 只在首轮 `exec` 生效,`resume` 拒收 `-C`(事实地基 E),故 cwd 在首轮定死、resume 继承;若中途移动 / 重建 worktree,resume 会指向错目录。**禁止 run 中改 worktree 路径**。
- **W2 运行期无锁**:同一轮内多 agent 并发写各自 worktree,**不加任何跨 worktree 写锁、不做「同文件写权串行化」**(R7 明确删除该措辞)。隔离靠文件系统物理分离,不靠锁。
- **W3 合并只在轮末且串行**:合并是**唯一**的跨 worktree 交汇点,只发生在 `shouldMergeAt(round, board)===true`(03 §3 真实签名,C3)的轮末,且**逐 writer 串行**并入 integration,绝不并发合并。
- **W4 冲突硬停不选边**:3-way 合并出现冲突 → 立即停,构造 `conflictEvidence` 回灌,置人工裁决态。中枢**不自动选 ours/theirs、不自动重试**(R7 / 引擎 E5)。
- **W5 diff 由中枢生成,不信 agent**:面板 diff 与 `FilePatch` 的**事实**来自中枢对 worktree 跑 `git diff --find-renames`,agent 自填的 `files` 仅作**意图声明**与冲突预检(02 §4),不作为 diff 真值。
- **W6 路径不出 worktree**:所有 `file_ref.path` / `files[].path` / `renamedFrom` 解析前先过 08 的 `isPathAllowed`(其权威实现 `isPathSafe`,08 §4.4),含 Windows 专属绕过加固(ADS 冒号流 / UNC / 设备前缀 `\\?\` `\\.\` / 8.3 短名 / realpath 解析 symlink·junction),命中即 `WORKTREE_PATH_VIOLATION`(02 §5.2 C6)。
- **W7 沙箱封顶**:自动化下 `sandbox` 最高 `workspace-write`,playbook / agent **无法**请求 `danger-full-access`(08 §6 拥有封顶,本文件按风险分级在其下取值,§10)。
- **W8 换行归一对齐 02**:worktree 内一切内容哈希 / 区间比对走 02 §9.1 `normalizeContent`(CRLF/CR→LF);git 侧关掉自动换行改写(`core.autocrlf=false`),避免 git 与哈希两套换行观打架(§3.3)。本机实测已复现:`autocrlf` 缺省下 git 会告警「LF will be replaced by CRLF」,正是 W8 要消灭的源头。
- **W9 merge-base 随轮推进,base tag 只是 run 起点锚**:`base` tag 是**全程不动的 run 起点**(整 run diff、首轮 merge-base);但第 N(>1)轮合并的真实 merge-base 是 `git` 自算的 `integration` 与 `agent/<id>` 的公共祖先,**会随前序轮合并自然前移**,不是 base tag。合并探冲突一律传 `(integrationTip, agentBranch)` 两参,**让 git 自己算 merge-base**,绝不手动把 base tag 钉成 merge-base(否则多轮后会把早已合入的改动当成冲突重报)。
- **W10 合并相位二次路径校验**:除消息层 W6 外,合并落地的 tree 里每个路径在写入 integration **之前**再过一次 `isPathSafe` 归属校验(08 §4.4 末尾点名 worktree 文档负责,堵 TOCTOU:消息校验通过到真正落盘之间被塞 symlink),命中即 `WORKTREE_PATH_VIOLATION` 硬停(§5.5)。

### 0.6 v2 硬化点(相对 v1)

| # | 类别 | v1 的洞 | v2 修正 | 章节 |
|---|---|---|---|---|
| F1 | 可行性(致命) | v1 §5.3/§6.2 假设 `merge-tree --write-tree` 在 **stdout 直接吐 diff3 冲突块**,据此 `parseMergeTreeConflicts`。**本机实测证伪**:stdout 只有 tree-OID + `<mode> <oid> <stage>\t<path>` 信息行 + 人类消息;diff3 标记在**写出的 tree 的 blob 里**(`git cat-file -p <tree>:<path>`),且 base/ours/theirs 直接是 stage 1/2/3 的 blob OID | 重写 §5.3 解析 stdout 拿 tree-OID + 冲突路径 + 三 stage blob OID;§6.2 改为从 stage blob **直接取三方原文**,行号靠**与 base 各侧 diff 的 hunk** 映射回真实 worktree 行号 | §5.3 §6.2 |
| F2 | 可行性 | git 版本兜底标【待实测】 | 本机实测 **git 2.44.0** 支持 `merge-tree --write-tree`(≥2.38),退【待实测】;仍保留 <2.38 临时 worktree 退化路径供他机 | §5.3 |
| F3 | 可行性 | `diffSince` 用 `git diff <baseRef>` **看不到未跟踪新增文件**(agent 新建的文件不在 diff 里) | 用**临时 index**(`GIT_INDEX_FILE`)`add -A` 后 `diff --cached`,捕获含未跟踪文件的全量改动,且不污染真 index | §4.1 |
| F4 | 可行性 | `create` 用 `git tag -f base HEAD` 幂等重入时会**把 base 移到当前 HEAD**(若 integration 已前移,base 被冲掉,merge-base 失真) | base tag 用 `--no-replace` 语义:已存在则**校验指向不变**,不存在才建;绝不 `-f` 移动(W9) | §3.3 |
| S1 | 安全 | `readFileRange` 用裸 `fs.existsSync`/`..` 字符串判,绕不过 Windows ADS/8.3/junction | 改走 08 `isPathSafe`(realpath + 设备/UNC/冒号流否决);自身再加 realpath 落 worktree 根校验 | §7 |
| S2 | 安全 | 无并发安全:`currentVerifyAgent` 可变全局,多核验并发串味 | `makeValidateContext(agentId)` 闭包绑定,无共享可变态 | §7.2 |
| S3 | 安全 | 合并落地无二次路径校验(TOCTOU) | W10:合并前对 tree 路径再过 `isPathSafe` | §5.5 |
| S4 | 安全 | diff 正文进 WS / 出境未显式接 redact | §4.4 显式:diff 正文广播前过 08 `redact`,整文件/片段命中 secret 走 `guardEgress` 阻断(08 §7 T15 两级) | §4.4 §8.3 |
| C1 | 一致性 | 跨文档编号混用(05/06 逻辑号 vs 本文件名号) | 头部加编号约定;本文件锚定 02/03/08 文件名号,不单方面改 | 头部 |
| C2 | 一致性 | `readFileRange` 签名与 02 §8.1 不对称(本文件带 agentId,02 不带) | 头部 + §7.2 显式桥接,`makeValidateContext` 消化差异 | §7.2 |
| C3 | 一致性 | `shouldMergeAt(round)` 漏 board 参 | 对齐 03 §3 真实签名 `shouldMergeAt(round, board)` | §3.2 §11 |
| V1 | 覆盖 | 命令型 evidence 的沙箱复跑器在 worktree 哪跑、什么权限,无人给实例 | §7.3 给 `runCommandSandboxed` 实例:cwd=agent worktree、read-only、断网、env 白名单、超时、命令预扫(规则归 08 §4.8) | §7.3 |
| V2 | 覆盖 | 无「writer 本轮零改动」分支(空 commit 会脏) | §5.2 守卫:`diff --cached` 空 → 跳过该 agent,不空 commit、不计 writer | §5.2 |
| V3 | 覆盖 | `resolveAndContinue` 与引擎状态机职责含糊 | §6.4 明确:本方法只完成 git 侧合并 + 续合剩余 writer,**状态机 paused→running 归引擎**;给「中途冲突→续跑」时序 | §6.4 |
| O1 | 成本 | 未提 N worktree = N 份全量 checkout 的磁盘/IO 成本 | §2.5 成本与缓解(浅副本不可用的原因、大仓告警、清理回收) | §2.5 |
| O2 | 成本 | `gc.auto=0` 全程关,对象只涨不回收 | §8.2 清理含 `git gc --prune=now`(或 prune),run 末回收 | §8.2 |

### 0.7 v3.1 硬化点(相对 v2,吃红队五报告点名 09 的 findings)

| # | 来源 finding | 类别 | v2 的洞 | v3.1 修正 | 章节 |
|---|---|---|---|---|---|
| X1 | x-coverage **COV-9**(blocker:M1/M2「无 worktree 单 checkout 执行/落 diff」过渡形态**无任何文档拥有规格**) | 覆盖(blocker) | 09 只写 M3 起的多 worktree 稳态,M1(纯决策无写)、M2(单 checkout 出 diff 给面板,见 25 T2.6)的**过渡隔离形态无主**;且 25 称 M1/M2「无文件写」却要 M2 渲染 diff,看似矛盾 | 新增 **§2.6 里程碑分级的隔离退化**:M1=单只读 checkout、critic 只读零写零合并;M2=单 checkout + diff plumbing(decision 轮 diff 恒空,非矛盾);M3 起=本文件多 worktree 稳态。给 `SingleCheckoutManager` 退化适配(同 `WorktreeManager` 接口子集),让 `readFileRange`/`diffSince` 在 M1/M2 有依托,合并相关方法在过渡期 no-op/抛 `WORKTREE_GIT_FAILED` | §2.6 |
| X2 | red-feasibility **FEAS-2**(blocker:M1 evidence 强核验无可读文件系统,`ValidateContext` 无依托) | 可行性(blocker) | 09 的 `readFileRange` 假定 `workdirOf(agentId)` 多 worktree 已建;M1 无 worktree,强核验读不到文件 | §2.6:M1 用**单只读 checkout**(= repoRoot 自身或一份只读副本)作所有 agent 的共同 `workdirOf`,`readFileRange` 照常工作;`makeValidateContext` 在 M1 把所有 agentId 映射到同一只读根 | §2.6/§7 |
| X3 | red-feasibility **FEAS-3** + x-consistency(03 红蓝写文件每轮合并 vs 25 红蓝纯决策不写,**行为定义相反**;21 对 panel propose 强制 `files:[]` 会静默清空 proposer 改动意图) | 可行性/一致性(major) | 09 §10/§11 把 decision 回合判为 read-only 但未点破:decision 回合 agent **本就无写权**,`message.files` 在 decision 回合是**纯意图声明、永不触发真实写**;强制 `files:[]` 不是「清空改动」(根本没有改动可清) | §11.1 末 + §10.3 显式:decision 回合 `files` 是意图元数据,sandbox=read-only 从物理上保证零写;若 playbook 在 decision 回合声明 `files` 并期望落盘=**配置错误**(回合性质矛盾),`mergeRound` 对该 agent 因 `diffSince` 空而跳过(V2),不存在「静默丢写」 | §10.3/§11.1 |
| X4 | red-security **RS-B1**(blocker:注入 L4 垫底沙箱出网未实测,exfil 有出口) | 安全(blocker·依赖) | 09 §7.3/§10 写 `network:'off'` 但把「沙箱断网」当唯一且未实测的垫底 | 改为引用 **08 §6.3 v3.1 fail-closed 网络封禁**(清代理 env + OS per-agent 出站 deny + base_url 白名单)作真实防线;09 的 `network:'off'` 降为消费方声明。M0 实测仅用于「校准」非「决定有无防线」。残留实测项入 openQuestions | §7.3/§10.2/§12 |
| X5 | red-security **RS-B2**(blocker:面板 XSS,agent 内容→DOM,redact 不转义 `<script>`) | 安全(blocker·边界) | 09 产出的 diff 正文/path/quote 流向面板 DOM,v2 只接 redact 未声明其为不可信、未点名消毒归属 | 头部边界段 + §4.4 显式声明本文件产出为**不可信数据**,消毒(HTML escape/CSP/纯文本)归 **08 §5.7 + 10**;09 只负责 redact/guardEgress + 标注 taint | 头部/§4.4 |
| X6 | red-security **RS-M1**(major:流式 redact 按帧无状态,`sk-ant-` 跨两 delta 帧分片各自不匹配,明文拼接重现) | 安全(major) | §4.4 只说「diff 正文过 redact」,未规定**redact 的粒度**;若 diff 被切块流式广播,跨块密钥会漏 | §4.4 硬规则:diff 正文**必须在「完整单文件 diff」整体上 redact 后再切块广播**,**禁止**对已切分的 `diff_chunk` 逐块 redact(跨块 secret 会漏);切块是 redact 之后的纯传输分片(对齐 11 §8.2 / RS-M1) | §4.4 |
| C4 | x-consistency **A1** + x-coverage **COV-1** + 08 §12 现状 | 一致性 | v2 全篇称 `WORKTREE_GIT_FAILED` 需「回填 02 §12」 | **已过期**:02 §12(line 995)已登记 `WORKTREE_GIT_FAILED`,08 §12 亦含全集。v3.1 把所有「需回填」改为「**已在 02 §12,确认对齐**」 | §12/§15 |
| C5 | 08 已升 v3.1(自身吃掉 RS-B1/B2) | 一致性 | v2 引用 08 §7 两级、§6 封顶,但未引 08 新增的 §5.7(XSS)、§6.3(网络 fail-closed) | 全文引用补齐 08 §5.7/§6.3;`EGRESS_SECRET_BLOCKED` 错误码已在 02/08,§4.4/§8.3 显式点名 | 头部/§4.4/§8.3/§12 |

---

## 1. 物理落点与依赖

### 1.1 包归属

`WorktreeManager` 是引擎依赖(`EngineDeps.worktrees`,03 §4.3),与引擎同包,落 `@sylux/core`:

```
packages/core/
├─ src/
│  ├─ worktree/
│  │  ├─ manager.ts        # ★ WorktreeManager 实现(本文件 §12 接口权威)
│  │  ├─ git.ts            # git 子进程薄封装(execa;-c 注入一次性配置,§3)
│  │  ├─ topology.ts       # 仓库/分支/路径命名(§2)
│  │  ├─ merge.ts          # round 末 3-way 合并 + 冲突检测(§5/§6)
│  │  ├─ diff.ts           # git diff --find-renames → FilePatch[](§4)
│  │  ├─ read-range.ts     # readFileRange → ValidateContext(02 §8.1)(§7)
│  │  └─ types.ts          # 本文件接口(WorktreeHandle/MergeResult/...);zod 仍引 02
│  └─ ...
```

> 依赖方向遵守总体规划 §10:`core` 依赖 `shared`(取 02 类型与 `contentHash`),被 `server` 依赖。worktree 子模块**只用 `shared` 的类型**,不反向依赖 `agents`/`server`(避免环)。git 调用经 `execa`(与适配层同),**不经 shell**(事实地基 A:PowerShell `>` 把 UTF-8 转 UTF-16,Node 直接捕获 stdout 无此坑)。

### 1.2 git 调用的统一约束(git.ts)

所有 git 调用走一个薄封装,强制三件事(与事实地基 A 一致):

```ts
import { execa } from 'execa';

/** 每次 git 调用都注入的一次性配置(不污染用户全局 / 仓库 .git/config)。 */
const GIT_HARDENING = [
  '-c', 'core.autocrlf=false',   // W8:不让 git 改写换行,哈希才稳(§3.3)
  '-c', 'core.longpaths=true',   // Windows MAX_PATH:worktree 路径深,必开(§2.4)
  '-c', 'gc.auto=0',             // run 期间禁后台 gc,避免动到正被合并的对象
  '-c', 'merge.conflictStyle=diff3', // 冲突标记带 base,供 evidence 三方对照(§6.2)
];

export async function git(
  cwd: string,
  args: readonly string[],
  opts?: { input?: string; allowNonZero?: boolean; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await execa('git', [...GIT_HARDENING, ...args], {
    cwd,
    input: opts?.input,
    // env 仅用于 GIT_INDEX_FILE 等无害 git 变量(§4.1);不透传 secret(那走 08 buildChildEnv,与此无关)
    env: opts?.env,
    extendEnv: true,          // git 需 PATH/HOME 等;此处不涉及 provider key(key 永不进 git 调用)
    reject: false,            // 自己判 exitCode,合并冲突的非零码是预期信号(§5)
    windowsHide: true,
    encoding: 'utf8',         // 事实地基 A:Node 直接拿干净 UTF-8
    stripFinalNewline: false,
  });
  if (!opts?.allowNonZero && res.exitCode !== 0) {
    throw new SyluxError('WORKTREE_GIT_FAILED', `git ${args[0]} 失败: ${redact(res.stderr)}`, { args, exitCode: res.exitCode });
  }
  return res;
}
```

> `-c key=value` 注入是一次性的,不写盘、不动用户配置。`merge.conflictStyle=diff3` 让冲突块带 `|||||||` base 段,§6.2 据此把 base/ours/theirs 三方都塞进 evidence,人工裁决时三方可见。

---

## 2. 仓库与分支拓扑

### 2.1 三类分支

一次 run 在用户目标仓库(`repoRoot`)上派生固定三类 git 引用:

| 引用 | 命名 | 作用 | 谁动它 |
|---|---|---|---|
| **base** | `refs/sylux/<runId>/base`(只读 tag) | run 起点快照,3-way 合并的**公共祖先**(merge-base) | 中枢创建时打,全程不动 |
| **integration** | `refs/sylux/<runId>/integration`(分支) | 累积「已合并」状态,轮末各 agent 改动并入此 | 中枢串行合并时动(§5) |
| **agent 分支** | `refs/sylux/<runId>/agent/<agentId>` | 每个执行体 agent 的 worktree 所 checkout 的分支 | 该 agent 的子进程在自己 worktree 写,中枢轮末读 |

> **为什么 agent 各一条分支(硬约束)**:git 禁止两个 worktree 同时 checkout 同一分支(报 `already checked out`)。故每个执行体 agent 必须有**独立分支**;integration 留在主仓(或独立 worktree),agent 分支各挂各的 worktree。base 用 tag(不可移动)保证 merge-base 永远是 run 起点,合并语义稳定。

### 2.2 目录布局(路径全程稳定,W1)

```
<repoRoot>/                      # 用户目标仓库(integration 分支在主仓 checkout 或独立)
└─ .sylux/
   └─ worktrees/
      └─ <runId>/
         ├─ integration/        # integration 分支的 worktree(中枢合并的落点)
         ├─ codex/              # AgentInput.workdir(agent=codex);分支 agent/codex
         └─ claude/             # AgentInput.workdir(agent=claude);分支 agent/claude
```

- `AgentInput.workdir`(05 §2)= `<repoRoot>/.sylux/worktrees/<runId>/<agentId>` 的**绝对路径**。
- 路径在 `WorktreeManager.create(runId)` 时一次性确定,**run 内不变**(W1);存进 `BoardState.agents` 旁的 run 元数据,崩溃恢复后 resume 用同一路径。
- `.sylux/` 整目录建议进用户仓 `.gitignore`(中枢启动时检查,缺则告警),避免 worktree 自身被误纳入目标仓提交。

### 2.3 整图(创建后)

```
                refs/sylux/<runId>/base (tag, 不可变, = run 起点)
                          │ (merge-base)
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
  agent/codex        agent/claude       integration
  (worktree:codex/) (worktree:claude/) (worktree:integration/)
        │                 │                  ▲
        └── round 末 ──────┴── 串行合并 ───────┘   (§5)
```

### 2.4 Windows 专属约束(事实地基 A)

| 坑 | 表现 | 对策 |
|---|---|---|
| `MAX_PATH` 260 | worktree 路径 `.sylux/worktrees/<runId>/<agentId>/<深层文件>` 易超 260 | `git -c core.longpaths=true`(§1.2)+ 建议用户开 OS 长路径策略;runId 用短 id(nanoid 12 位)不用长 UUID |
| 换行改写 | git `autocrlf` 默认在 Win 可能为 `true`,checkout 时 LF→CRLF,污染 `contentHash` | `git -c core.autocrlf=false`(W8/§1.2);哈希前再走 02 `normalizeContent` 双保险 |
| UTF-8 捕获 | shell `>` 重定向转 UTF-16 LE 乱码 | 一切 git 输出经 Node `execa` `encoding:'utf8'` 捕获,**不经 PowerShell 重定向**(§1.2) |
| 文件占用锁 | Win 下子进程仍持文件句柄时删 worktree 失败 | 清理前先 `cancel()` kill 子进程树(05),再删;删失败进 orphan 回收(§8.4) |
| 大小写不敏感 | `Foo.ts` vs `foo.ts` 在 Win 同名,合并可能漏判改名 | `git diff --find-renames` + 改名检测(§4);路径比对统一小写仅用于**告警**,不改 evidence 原文 |

### 2.5 worktree 成本与缓解(O1)

每个执行体 agent 一个 worktree = 一份**全量工作区 checkout**(N agent → N 份)。这是 R7 纯隔离模型的固有代价,诚实标注并缓解:

| 成本面 | 量级 | 缓解 |
|---|---|---|
| 磁盘 | N × 工作区大小(`.git` 对象库**共享**主仓,不复制;只复制 checkout 出的工作文件) | 大仓(>1GB 工作树)启动时**告警**预估占用;`.git` 共享已是 git worktree 原生行为,无额外对象库拷贝 |
| 创建 IO | N × 一次 checkout(冷盘大仓秒级) | 串行 create 给进度;`runId` 短 id 缩路径(§2.4 MAX_PATH 协同) |
| 为何不用浅副本 | `git worktree` 不支持 `--depth`;且浅历史会破坏 merge-base 计算(W9 需真实公共祖先) | 不做浅副本;接受全量 checkout |
| 清理回收 | 残留 worktree 占盘 | §8 清理删目录 + `git gc --prune=now`(O2);删失败进 orphan 下次回收(§8.4) |

> decision-only 回合可进一步省:Fusion panel 多 provider 共享**一份只读快照**而非各建 worktree(§11.3),把「N provider N worktree」降到「1 只读快照」。只有 execution 回合的隔离是硬需求。

### 2.6 里程碑分级的隔离退化(X1/X2/X3:M1/M2 过渡形态权威)

红队 COV-9(blocker)指出 M1/M2 的「单 checkout、无多 worktree」过渡形态**无文档拥有规格**,FEAS-2 进一步指出 M1 的 evidence 强核验**无可读文件系统依托**。本节认领该缺口:**worktree 隔离不是从第一天就全量上线,而是随里程碑分级退化**。25(路线图)把 worktree 多树隔离压在 M3;M1/M2 用更轻的单 checkout 形态。三段形态共享**同一 `WorktreeManager` 接口的子集**,实现按里程碑切换,引擎/校验层调用点不变(只是底层 manager 不同)。

| 里程碑 | 隔离形态 | `workdirOf` 返回 | 写权 | `diffSince` | `mergeRound` | 谁实现 |
|---|---|---|---|---|---|---|
| **M1** | 单只读 checkout(纯决策红蓝,25 §75) | 所有 agentId → **同一**只读根(repoRoot 或其只读副本) | 全 read-only(critic 只读引证据,无 implement) | 恒返回空 patch(无写) | **no-op**:返回 `{ok:true,mergedAgents:[],integrationRef:HEAD}` | `SingleCheckoutManager`(§2.6.1) |
| **M2** | 单 checkout + diff plumbing(25 §94/T2.6) | 同 M1(单根) | 仍以 decision 为主;diff 面板就位 | 对单 checkout 跑 `git diff`(decision 轮**恒空**,非矛盾——见下) | 同 M1 no-op(M2 仍不做真合并) | `SingleCheckoutManager` |
| **M3+** | 每 agent 独立 worktree(本文件 §1–§13 稳态) | 各 agent 各自 worktree 绝对路径(W1) | execution 回合 `workspace-write` | 临时 index 全量改动(§4.1) | 串行 3-way 合并 + 冲突硬停(§5) | `WorktreeManager`(本文件权威实现) |

**「M2 要渲染 diff 却无文件写」不是矛盾(澄清 COV-9 的表观冲突)**:M2 的 diff 面板是**plumbing 提前就位**(server→client 通路、`diff2html` 渲染、降级展示,25 T2.6/T2.9),不代表 M2 一定有非空 diff。M1/M2 红蓝是纯决策回合,`git diff` 结果**恒为空**,面板显示「本轮无文件改动」——这正确反映了「决策回合不落文件」。diff 面板的**真实非空内容**要到 M3 execution 回合(implement 落 diff)才出现。故:**diff 通路 M2 上线、diff 内容 M3 才有**,二者解耦,无矛盾。

#### 2.6.1 SingleCheckoutManager(M1/M2 退化适配)

```ts
/** M1/M2 退化实现:单只读 checkout,无多 worktree、无合并。实现 WorktreeManager 接口的可用子集;
 *  合并相关方法在过渡期 no-op 或显式抛错,杜绝「以为在隔离其实没有」的假绿。 */
export class SingleCheckoutManager implements WorktreeManager {
  constructor(private readonly root: string) {}   // 单只读根:repoRoot 或一份只读副本

  async create() { /* M1/M2 不建多 worktree;校验 root 可读即可 */ }

  // X2/FEAS-2:所有 agentId 映射到同一只读根 → readFileRange/强核验有依托
  workdirOf(_agentId: AgentId): string { return this.root; }

  // decision 回合零写;diff 恒空(M1)或对单 checkout 跑 git diff(M2,decision 轮仍空)
  async diffSince(): Promise<{ patches: FilePatch[]; raw: string }> { return { patches: [], raw: '' }; }

  // M1/M2 无合并语义:no-op 成功(无 writer)。绝不静默假装合并了 agent 改动。
  async mergeRound(): Promise<MergeResult> {
    return { ok: true, mergedAgents: [], integrationRef: 'HEAD' };
  }

  // 过渡期不该被调到的多树专属方法 → 显式抛,暴露误用(而非静默 no-op 掩盖 bug)
  async syncToIntegration(): Promise<void> {
    throw new SyluxError('WORKTREE_GIT_FAILED', 'M1/M2 单 checkout 形态无 integration 可同步;升 M3 用 WorktreeManager');
  }
  async resolveAndContinue(): Promise<MergeResult> {
    throw new SyluxError('WORKTREE_GIT_FAILED', 'M1/M2 无合并,不存在冲突续跑');
  }

  // 读区间照常走(X2:强核验在 M1 可用),路径安全仍过 08 isPathSafe(单根作 root)
  readFileRange(_agentId: AgentId, rel: string, s: number, e: number): string | null {
    return readRangeFromRoot(this.root, rel, s, e);   // 同 §7.1,root 固定为单 checkout
  }
  makeValidateContext(forAgent: AgentId, runId: string): ValidateContext {
    return makeValidateContextOn(this.root, runId);   // 所有 agent 同根(只读,本就无并发写串味)
  }
  async cleanup(): Promise<void> { /* 只读副本场景删副本;repoRoot 直用则 no-op */ }
}
```

- **接口同形,实现可换(关键设计)**:引擎 03 §4.3 注入的 `EngineDeps.worktrees` 类型恒为 `WorktreeManager`;M1/M2 注入 `SingleCheckoutManager`,M3+ 注入真 `WorktreeManager`。引擎调用点、`validateMessage` 装配、面板 diff 通路**全程不变**,只换底层实例。这让「过渡→稳态」是**注入替换**而非引擎改写。
- **单只读根的来源**:M1 直接用 `repoRoot`(decision 回合零写,无污染风险)即可;若担心 agent 工具越权写(08 §4.9 作用域),M2 可改为一份**只读副本**(`cleanup` 负责删)。两种都满足「`readFileRange` 有文件可读」(FEAS-2 闭合)。
- **零写 ≠ 零隔离失效**:M1/M2 的隔离强度本就只需「agent 不互相覆盖文件」——决策回合无写,天然满足,无需多 worktree。把多树隔离推到 M3(execution 真正落 diff 时)是**成本最优**,与 25 路线图一致。
- **升级断言**:从 M2 切 M3 时,任何残留对 `SingleCheckoutManager.syncToIntegration/resolveAndContinue` 的调用会**抛 `WORKTREE_GIT_FAILED`**(而非静默成功),把「该升 manager 却没升」的配置错误炸在本机(对接 §12 失败路径)。


---

## 3. 生命周期状态机

### 3.1 一个 worktree 的状态

```
            create()                assign()              round 内子进程写
  (none) ───────────▶ CREATED ─────────────▶ ASSIGNED ───────────────────▶ DIRTY
                                                 ▲                            │
                          syncToIntegration()    │   mergeRound() 成功         │
                          (decision 回合 / 下一轮起点)└───── CLEAN ◀────────────┘
                                                          │
                                          mergeRound() 冲突 │
                                                          ▼
                                                     CONFLICTED ──(人工裁决/abort)──▶ (清理)
                                                 cleanup() / 任意态 ──▶ REMOVED
```

| 态 | 含义 | 可执行操作 |
|---|---|---|
| `CREATED` | worktree 目录+分支已建,内容=base | `assign` / `cleanup` |
| `ASSIGNED` | 已绑定某 agent,workdir 交给适配器(05) | 子进程写 / `diffSince` / `cleanup` |
| `DIRTY` | 子进程已写,未合并 | `diffSince`(生成 FilePatch)/ `mergeRound` / `cleanup` |
| `CLEAN` | 上轮改动已并入 integration,工作区与 integration 对齐 | `syncToIntegration`(领下一轮新起点)/ 继续写 |
| `CONFLICTED` | 合并冲突,等人工裁决 | `cleanup` / 人工解决后 `resolveAndContinue`(§6.4) |
| `REMOVED` | 已 `git worktree remove` + 分支删 + 目录回收 | 终态 |

### 3.2 与引擎循环的对接点(03 §5.1)

| 引擎循环位置 | 调 WorktreeManager | 本文件章节 |
|---|---|---|
| `onStart` 之前 / run 初始化 | `create(runId, {repoRoot, agents})` | §3.3 |
| 每轮发言前(decision 回合需新鲜起点) | `syncToIntegration(agentId)`(execution 不强制) | §11.2 |
| 每轮发言后,生成面板 diff / `FilePatch` | `diffSince(agentId, baseRef)` | §4 |
| `shouldMergeAt(round, board)===true` 轮末 | `mergeRound(round)` → `MergeResult` | §5 |
| `validateMessage` 核验 file_ref | `readFileRange(...)`(经 ValidateContext 注入) | §7 |
| `finalize`(任意终态) | `cleanup(runId, {keepOnConflict})` | §8 |

### 3.3 create():幂等创建(伪代码)

```ts
async function create(runId: string, cfg: WorktreeRunConfig): Promise<void> {
  const root = path.join(cfg.repoRoot, '.sylux', 'worktrees', runId);

  // 0. 前置校验:repoRoot 必须是干净工作树(无未提交改动),否则合并语义被污染
  await assertCleanTree(cfg.repoRoot);              // git status --porcelain 非空 → WORKTREE_GIT_FAILED(§5.0)
  await ensureSyluxIgnored(cfg.repoRoot);           // .sylux/ 不在 .gitignore → 告警(否则 worktree 自身进 diff)

  // 1. 起点快照:base tag 全程不动(W9/F4)。已存在→校验指向不变;不存在才建。绝不 -f 移动。
  const head = (await git(cfg.repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const baseTag = `sylux/${runId}/base`;
  const existing = await git(cfg.repoRoot, ['rev-parse', '--verify', '-q', `refs/tags/${baseTag}`],
                             { allowNonZero: true });
  if (existing.exitCode === 0) {
    if (existing.stdout.trim() !== head) {
      // 重入时 HEAD 已变(用户在跑期间又提交了),base 已锚定起点,以 base 为准、告警,不移动
      // 用 base tag 指向作为后续所有操作的起点真值
    }
  } else {
    await git(cfg.repoRoot, ['tag', baseTag, head]);   // 无 -f:首次建,之后恒不动
  }
  const baseOid = (await git(cfg.repoRoot, ['rev-parse', baseTag])).stdout.trim();

  // 2. integration 分支 + worktree(从 base 切)
  await ensureBranch(cfg.repoRoot, `sylux/${runId}/integration`, baseOid);
  await ensureWorktree(cfg.repoRoot, path.join(root, 'integration'), `sylux/${runId}/integration`);

  // 3. 每个执行体 agent 一分支一 worktree(W1 路径定死)
  for (const agentId of cfg.agents) {              // 仅 'codex' | 'claude'
    await ensureBranch(cfg.repoRoot, `sylux/${runId}/agent/${agentId}`, baseOid);
    await ensureWorktree(cfg.repoRoot, path.join(root, agentId), `sylux/${runId}/agent/${agentId}`);
  }
  // 4. 落 run 元数据(workdir 绝对路径表),resume / 恢复用同一路径(W1)
  await persistWorktreeMeta(runId, root, cfg.agents);
}
```

> `ensureWorktree` 用 `git worktree add --checkout <path> <branch>`;若 `<path>` 已存在且是该分支的有效 worktree(`git worktree list --porcelain` 命中)→ 幂等跳过(支持中枢崩溃后重入,不重复 add)。所有写操作可重入是 W1「路径稳定」的前提。
> **base tag 不可移动(F4/W9)**:v1 用 `tag -f ... HEAD`,重入时会把 base 冲到当前 HEAD;若此时 integration 已前移,merge-base 失真、历史改动被当冲突重报。v2 改为「存在即校验不动、不存在才建」,base 永远钉在 run 起点。

---

## 4. round 末 diff 生成(FilePatch 真值,W5)

`FilePatch`(02 §4)的**事实**由中枢生成,agent 自填 `files` 仅作意图与冲突预检(02 §4 / W5)。面板 diff(08)与合并预检都吃这一份。

### 4.1 diffSince:worktree 改了什么(F3:含未跟踪新增)

```ts
/** agent 自 baseRef 以来在其 worktree 里的真实改动(含未跟踪新增文件)。
 *  baseRef 通常是上次合并点或 base。 */
async function diffSince(agentId: AgentId, baseRef: string): Promise<DiffResult> {
  const wt = workdirOf(agentId);

  // F3:裸 `git diff <baseRef>` 看不到 agent 新建的未跟踪文件(它们不在 index 也不在 baseRef tree)。
  // 用临时 index 文件把工作区全部改动(含未跟踪)stage 进去,再 `diff --cached`,
  // 全程不碰 agent 真 index / 分支历史(GIT_INDEX_FILE 指向临时文件)。
  const tmpIndex = path.join(os.tmpdir(), `sylux-idx-${runId}-${agentId}-${nanoid(6)}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(wt, ['read-tree', baseRef], { env });          // 临时 index 起点 = baseRef
    await git(wt, ['add', '-A', '--', '.'], { env });        // stage 全部含未跟踪(尊重 .gitignore)
    // --find-renames=50% 开改名检测;--no-color 干净文本;-z NUL 分隔防路径含特殊字符
    const raw = await git(wt, [
      'diff', '--find-renames=50%', '--no-color', '-z',
      '--name-status', '--cached', baseRef,
    ], { env });
    return {
      patches: parseNameStatusZ(raw.stdout),   // → FilePatch[](02 §4 形状)
      // 面板正文 diff 另跑 `git diff --cached <baseRef>`(同 env);isBinary 由 git 标 `Binary files` 判
      // 正文进 WS 前必过 08 redact(S4/§4.4)
    };
  } finally {
    await fs.promises.rm(tmpIndex, { force: true });         // 临时 index 用完即删
  }
}
```

> **时序前提(V4)**:`diffSince` 只在该 agent 子进程**本轮已结束**(`turn.completed` / cancel 收口,05)后调,避免读到子进程半写的撕裂状态。引擎在轮末发言收口后才调本方法(03 §5)。
> **.sylux 自身不入 diff**:`add -A` 尊重 `.gitignore`;若用户仓未把 `.sylux/` 加 ignore(§3.3 已告警),worktree 嵌套目录可能被 stage,故 create 期强制检查。

### 4.2 name-status → FilePatch 映射

| git status 码 | `FilePatch.changeKind` | 备注 |
|---|---|---|
| `A` | `add` | |
| `M` | `modify` | |
| `D` | `delete` | |
| `R<score>` | `rename` | `renamedFrom`=旧路径,新路径=`path`;score<阈值则降级为 D+A |
| `C<score>` | `add` | copy 视为新增(保守,避免漏报) |
| `T` | `modify` | 类型变更(文件↔符号链接)按 modify 处理 |

> **二进制 / 超阈值**:`git diff` 对二进制输出 `Binary files a/x and b/x differ`,据此置 `FilePatch.isBinary=true`,面板降级展示(08)。超大文本 diff(行数 > 阈值)同样标记降级,正文不进 WS 广播(避免撑爆传输)。

### 4.3 agent 意图 vs 实际改动的对账(冲突预检前置)

合并前中枢拿两份:agent 在消息里声明的 `message.files`(意图)与 `diffSince` 的实际改动。对账规则:

- **实际 ⊄ 意图**(改了没声明的文件)→ 不阻断合并,但记 `system` 告警 + 面板高亮(可能是 agent 越界改动,人工关注)。
- **意图 ⊄ 实际**(声明改了实际没改)→ 仅告警(agent 乐观声明,无害)。
- 两份的**路径并集**用于 §5.2 的轻量冲突预检(两 agent 改同一文件 = 潜在冲突候选)。

> 对账只做**告警与预检**,不做硬阻断:硬判定留给 §5 的真实 3-way 合并(预检可能漏报语义冲突,真合并才是权威)。

### 4.4 diff 正文出境与脱敏(S4,引用 08 §3/§7)

diff 正文是「worktree 内容离开中枢内存」的主要通路之一(进 WS 广播给面板、可能进 jsonl)。按 08 的 S4 单一出口规则:

- **WS / 日志 / jsonl 广播前**:diff 正文(unified diff 文本)必过 08 `redact()`——某行恰好新增了 `sk-...` / `Bearer ...` 会被脱敏占位(08 §3.2),不裸奔进面板。
- **redact 必须在「完整单文件 diff」整体上做,再切块广播(X6/RS-M1,硬规则)**:redact 是**有状态边界敏感**的——`sk-ant-...` 若被切成两个 `diff_chunk`,逐块跑正则**各自不匹配**,前端拼接后明文密钥重现。故顺序**强制**为:① 对**完整的单文件 unified diff** 跑一次 `redact` → ② 再把脱敏后的文本按传输需要切成 `diff_chunk` 广播。**禁止**先切块再逐块 redact,也禁止流式逐 delta 帧 redact(11 §8.2 同此约束)。切块是 redact **之后**的纯传输分片,不承担任何脱敏职责。
- **整文件 / 大片段命中 secret**:若某文件正文整体命中强 secret 特征(如新增了一个 `.env` 或私钥块),按 08 §7 T15 的两级处置——**`guardEgress` 阻断**该文件正文出境(错误码 `EGRESS_SECRET_BLOCKED`,02/08 §12 已登记),面板只显示「该文件含疑似密钥,正文已隐藏」+ 路径 + changeKind,而非脱敏后照发。
- **超大 / 二进制 diff**:`isBinary` 或行数超阈值 → 不进 WS 正文广播,面板降级展示(只发 name-status + 行数统计,§4.2)。
- **diff 正文是不可信数据(X5/RS-B2)**:经 redact 后的 diff 正文仍是 **agent 可控内容**(redact 抹 secret、**不转义 HTML**)。面板渲染前必须由 **08 §5.7 / 10** 做 HTML 消毒(纯文本化 / DOMPurify 白名单 / strict CSP);`FilePatch.path` / `renamedFrom` 同属 agent 可控(文件名可塞 `<img onerror>`),一并消毒。本文件在 `FilePatch` / diff 正文出口**标注 taint**,提示下游强制消毒;消毒**不**在本文件做(职责归面板侧),但 taint 标注是本文件的契约责任。
- `readFileRange`(§7)返回内容仅用于**本机哈希复算**,不出境,无需 redact;但若该区间正文被塞进面板展示,同样走上面规则。

> 一句话:本文件**生产** diff 正文,**消费** 08 的 `redact`/`guardEgress` 出口;新增任何把 worktree 正文送出中枢的通路,都必须接这两个出口(否则是 08 S4 漏点)。

---

## 5. round 末串行合并(mergeRound)

### 5.1 合并契约(引擎 03 §5.1 消费)

```ts
/** 轮末把本轮所有 writer 的改动并入 integration。串行(W3),冲突即停(W4)。 */
async function mergeRound(round: number): Promise<MergeResult>;

export type MergeResult =
  | { ok: true; mergedAgents: AgentId[]; integrationRef: string }
  | {
      ok: false;
      code: 'WORKTREE_CONFLICT';
      conflictEvidence: EvidenceItem[];   // 02 §3,回灌黑板(引擎 systemMessage)
      conflictingFiles: string[];
      blockedAgent: AgentId;              // 合并到谁时停的
    };
```

> 引擎在 `merge.ok===false` 时写 `systemMessage(round,'WORKTREE_CONFLICT',merge.conflictEvidence)`、置 `paused('WORKTREE_CONFLICT')`,并**从 `runEngine` 循环 return**(03 §5.1 实测 line 466-471:不是 continue 循环,而是 `finalize(...,'paused',...)` 返回)。续跑靠 §6.4 的 `resolveAndContinue` 经引擎 resume 入口重入,不是循环内自然继续。本文件**只负责把冲突变成可核验 evidence**,不决定终态(那是引擎/人工)。

### 5.0 合并前置(V2 守卫 + 干净态保证)

- **干净起点**:create 期已 `assertCleanTree`(§3.3),integration worktree 在每次合并成功后保持干净;合并探测(§5.3)无副作用,故任何一次 `mergeRound` 进入时 integration 工作区都干净。
- **零改动 writer 守卫(V2)**:某 agent 本轮被指派但实际没写(decision 回合、或 implement 但没动文件)→ `diffSince` 空 → **不 commit、不计入 writers、不参与合并**。避免空 commit 把 integration 历史搅乱、也避免误报「冲突」。
- **merge-base 不手钉(W9)**:探冲突与真合并都只传 `(integrationTip, agentBranch)`,git 自算 merge-base。
- **`integrationTip()` 辅助**:返回 integration 分支当前 tip 的 ref(`sylux/${runId}/integration`,每次合并成功后随 git 前移);`MergeResult.integrationRef` 字段即合并后该 tip 的 OID,回给引擎/面板。

### 5.2 串行合并流程(伪代码,W3/W4/V2)

```ts
async function mergeRound(round: number): Promise<MergeResult> {
  const integ = workdirOf('integration');
  const merged: AgentId[] = [];

  // 仅本轮「真有改动」的执行体 agent,按确定序(§5.4)。零改动者被守卫剔除(V2)。
  const writers = await writersWithChanges(round);   // 内部对每个候选跑 diffSince 判空

  for (const agentId of writers) {                   // ── 逐 writer 串行,绝不并发(W3)──
    const agentBranch = `sylux/${runId}/agent/${agentId}`;

    // 1. 把 agent worktree 的本轮改动(含未跟踪,F3 同款临时 index 思路)固化成 agentBranch 的一个 commit。
    //    commitWorktree 内部:add -A 到该分支 index → commit;若 nothing staged 则跳过(V2 双保险)。
    const committed = await commitWorktree(workdirOf(agentId), agentBranch, `sylux round ${round} by ${agentId}`);
    if (!committed) continue;                         // 守卫:真没改动,跳过

    // 2. 干跑探冲突:merge-tree 无副作用算合并(§5.3)。整 run 不在 integration 工作区留半成品。
    const probe = await mergeTreeProbe(integ, integrationTip(), agentBranch);
    if (probe.hasConflict) {
      // ── 冲突硬停:构造 evidence,不选边、不重试(W4)。integration 工作区此刻仍干净(探测无副作用)──
      const evidence = await buildConflictEvidence(round, agentId, probe);   // §6
      return { ok: false, code: 'WORKTREE_CONFLICT',
               conflictEvidence: evidence, conflictingFiles: probe.files, blockedAgent: agentId };
    }

    // 3. 合并相位二次路径校验(W10/S3):对 probe.mergedTree 里的路径再过 isPathSafe,堵 TOCTOU symlink
    await assertTreePathsSafe(probe.mergedTree, agentId);   // §5.5;命中 → WORKTREE_PATH_VIOLATION 硬停

    // 4. 真合并进 integration worktree(干跑过、无冲突,几乎必成)
    await git(integ, ['merge', '--no-ff', '--no-edit', agentBranch]);
    merged.push(agentId);
  }
  return { ok: true, mergedAgents: merged, integrationRef: integrationTip() };
}
```

### 5.3 mergeTreeProbe:不碰工作区先探冲突(F1/F2,本机实测校正)

合并前用 `git merge-tree --write-tree` 在**不动任何工作区**的前提下算出合并 tree 与冲突,避免「真 merge 一半冲突、工作区留半成品」的脏态。

**本机实测(git 2.44.0)的真实 stdout 形状**——v1 的「stdout 直接吐 diff3 块」是**错的**:

```
<merged-tree-oid>                              ← 第 1 行:写出的合并 tree 的 OID
<mode> <oid> 1\t<path>                         ← 冲突文件的 stage 1 = base
<mode> <oid> 2\t<path>                         ← stage 2 = ours(integration)
<mode> <oid> 3\t<path>                         ← stage 3 = theirs(agent)
                                               ← 空行分隔
Auto-merging <path>                            ← 人类可读信息段
CONFLICT (content): Merge conflict in <path>
```

退出码:无冲突=0(stdout 仅 tree-OID 行),有冲突=1。**diff3 标记不在 stdout**,而在「写出的合并 tree 里那个文件的 blob」(`git cat-file -p <merged-tree-oid>:<path>`)。三方原文则**直接是 stage 1/2/3 的 blob OID**(无需解析标记即可 `cat-file` 取)。

```ts
interface MergeProbe {
  hasConflict: boolean;
  mergedTree: string;                 // 合并 tree OID(第 1 行)
  files: string[];                    // 冲突路径集
  stages: Map<string, { base?: string; ours?: string; theirs?: string }>; // path → 三 stage blob OID
  raw: string;
}

async function mergeTreeProbe(integWt: string, ours: string, theirs: string): Promise<MergeProbe> {
  // --no-messages 去掉人类信息段,只留机读首段;-z NUL 分隔防路径特殊字符(实测 -z 支持)
  const res = await git(integWt,
    ['-c', 'merge.conflictStyle=diff3', 'merge-tree', '--write-tree', '-z', ours, theirs],
    { allowNonZero: true });
  const mergedTree = res.stdout.split('\0', 1)[0].trim();       // 第 1 段恒为 tree OID
  if (res.exitCode === 0) return { hasConflict: false, mergedTree, files: [], stages: new Map(), raw: res.stdout };
  // 非零:解析 `<mode> <oid> <stage>\t<path>` 段,按 path 归并三 stage 的 blob OID
  const stages = parseStageEntries(res.stdout);                 // F1:解析 stage 行,不再找 diff3 块
  return { hasConflict: true, mergedTree, files: [...stages.keys()], stages, raw: res.stdout };
}
```

> **git 版本(F2,本机实测已退【待实测】)**:本机 **git 2.44.0** 支持 `merge-tree --write-tree`(需 ≥2.38),`-z` / `--no-messages` 均可用。若部署到 <2.38 的他机,退化方案:在 integration **一次性临时 worktree** 跑真 `git merge`,冲突后 `git merge --abort` 回滚,临时 worktree 用完即删——保证主 integration worktree 不留脏态。启动期探测 git 版本选路径(§12 失败路径表)。

### 5.4 串行顺序的确定性

`writersWithChanges(round)` 在剔除零改动者后,顺序**必须确定**(同一回放结果一致):按 `AgentId` 字典序(`claude` < `codex`)或 playbook 指定的固定优先级。串行下「先合谁」会影响「谁撞上冲突」,故顺序是合并语义的一部分,必须可复现(对接 02 回放投影 V20)。

### 5.5 合并相位二次路径校验(W10/S3,焊死 08 §4.4 点名项)

08 §4.4 末尾明确:消息层 `isPathSafe` 是「第一道」,**合并相位对落地文件再做一次归属校验**由 worktree 文档负责(堵「消息校验通过 → 真正落盘前被塞 symlink」的 TOCTOU 窗口)。

```ts
/** 对 merge-tree 算出的合并 tree 里每个路径,再过一次 isPathSafe(08 §4.4),命中即硬停。 */
async function assertTreePathsSafe(mergedTree: string, agentId: AgentId): Promise<void> {
  // 列 tree 内全部路径(含子目录递归);-z 防特殊字符
  const ls = await git(workdirOf('integration'), ['ls-tree', '-r', '-z', '--name-only', mergedTree]);
  const root = workdirOf('integration');            // 落地点是 integration worktree
  for (const rel of splitZ(ls.stdout)) {
    // isPathSafe 权威实现归 08 §4.4:realpath + 拒 ADS/UNC/设备前缀/8.3 短名 + 落 root 内
    if (!isPathSafe(rel, root, workdirOf(agentId))) {
      throw new SyluxError('WORKTREE_PATH_VIOLATION',
        `合并落地路径越界/敏感(agent=${agentId}): ${rel}`, { agentId, path: rel });
    }
  }
}
```

> 这是 W6(消息层)之外的**第二查**:即便 agent 在消息里没声明该路径、或声明时还合法,合并真正要把内容写进 integration 前再验一次物理落点,realpath 后必须仍在 integration worktree 内。命中 → `WORKTREE_PATH_VIOLATION` 硬停(同冲突一样回灌、等人工),绝不静默落地越界文件。

---

## 6. 冲突 → 可核验 evidence(W4 核心,焊死红队 R7)

冲突**不自动选边**。中枢把冲突点构造成 `EvidenceItem[]`(02 §3)回灌黑板,让人工(或下一轮 agent)看到三方原文后裁决。「不选边」= 中枢不写 ours/theirs 任何一方进 integration,工作区保持合并前干净态(§5.3 `merge-tree` 探测无副作用保证了这点,不像真 `merge --abort` 还要回滚)。

### 6.1 冲突点 → 双 file_ref + base spec_quote(F1 校正:基于 per-side diff hunk)

v1 假设从 `merge-tree` stdout 的 diff3 块拿行号——**已被本机实测证伪**(§5.3:diff3 标记不在 stdout)。v2 改用**稳的办法**:对冲突文件分别跑 `git diff -U0 <base> <side>` 拿 hunk header 的真实行号(直接是各 side 文件的 1-based 行号),无需解析合并标记文件、也不必反推标记行号。

```ts
async function buildConflictEvidence(round: number, blocked: AgentId, probe: MergeProbe): Promise<EvidenceItem[]> {
  const out: EvidenceItem[] = [];
  const baseOid = await mergeBaseOf(integrationTip(), `sylux/${runId}/agent/${blocked}`); // git 自算(W9)
  for (const path of probe.files) {
    // 每侧相对 merge-base 的改动 hunk(真实行号);-U0 让 hunk 边界 = 纯改动区间
    const oursHunks   = await sideHunks(integrationTip(), baseOid, path);  // integration 侧改了哪些行
    const theirsHunks = await sideHunks(`sylux/${runId}/agent/${blocked}`, baseOid, path); // agent 侧
    // 取「两侧改动行号在 base 上重叠」的冲突 hunk 配对(重叠 = 真冲突候选)
    for (const [ours, theirs, baseSpan] of overlappingPairs(oursHunks, theirsHunks)) {
      // ① ours = integration worktree 当前内容(强核验:quote=实读区间,H1)
      out.push(await fileRefOf('integration', path, ours.start, ours.end,
        `合并冲突@round${round}:integration 现有内容`));
      // ② theirs = 被合并 agent worktree 的改动(强核验)
      out.push(await fileRefOf(blocked, path, theirs.start, theirs.end,
        `合并冲突@round${round}:${blocked} 的改动`));
      // ③ base = 公共祖先内容,弱核验(spec_quote),给裁决者三方对照
      const baseQuote = await readBlobRange(baseOid, path, baseSpan.start, baseSpan.end);
      if (baseQuote !== null) out.push({
        kind: 'spec_quote', source: `merge-base:${path}`,
        quote: baseQuote, locator: `${baseSpan.start}-${baseSpan.end}`,
      });
    }
  }
  return out;
}
```

> **强核验可过(H1 关键,服务下一轮引用)**:`fileRefOf` 读对应 worktree 的真实区间,**把读到的正文塞进 `file_ref.quote`**,再让中枢按 02 §9.1 `normalizeContent` 归一。02 §8.3 `verifyEvidence` 复算时 `readFileRange` 读的是**同一份内容**、与 `quote` 双向归一比对必然相等 → 判 `pass`(强)。`contentHash` 由中枢派生回填(I7),agent 不自算。注意:这条 evidence 挂在 `system` 消息上、其本身**不经** `validateMessage` 阶段 B(§7.2 澄清);此「天生可过强核验」的价值在于——**下一轮裁决 agent 把同一 file_ref+quote 抄进自己的 critique/ack 时,能过 C1/C2 强核验**(只要那段内容还没被改),让冲突点天然成为可机器核验的红队锚点。
>
> `fileRefOf` 实现 = §7 `readFileRange(agentId, path, s, e)` 取正文 → 组 `{kind:'file_ref', path, lineStart:s, lineEnd:e, quote:正文}`(`contentHash` 留空待中枢回填)。

### 6.2 sideHunks:从 per-side diff 拿真实行号(取代 v1 的 diff3-stdout 解析)

```ts
/** side 相对 base 在某文件改了哪些「目标侧行号」区间。-U0:hunk 边界即纯改动区间。 */
async function sideHunks(sideRef: string, baseRef: string, path: string): Promise<LineSpan[]> {
  // `@@ -<baseStart>,<baseLen> +<sideStart>,<sideLen> @@`;解析 + 段拿 side 侧 1-based 行号区间
  const d = await git(workdirOf('integration'),
    ['diff', '-U0', '--no-color', baseRef, sideRef, '--', path], { allowNonZero: true });
  return parseHunkHeaders(d.stdout).map(h => ({ start: h.sideStart, end: h.sideStart + Math.max(h.sideLen,1) - 1 }));
}
```

- **为什么不再解析合并标记文件**:`merge-tree` 写出的 blob 里 diff3 标记的行号是「带标记的合成文件」行号,**不等于** agent/integration 真实文件行号;v1 要「映射回真实行号」很脆。直接对各 side 跑 `git diff` 拿 hunk header,**header 里的 `+<start>,<len>` 就是该 side 文件的真实 1-based 行号**,零映射、稳。
- **重叠判定**:两侧 hunk 的 **base 侧行号区间**(`-<baseStart>,<baseLen>`)相交 = 同一段被两边改 = 冲突点;据此把 ours/theirs hunk 配对,各出一条 file_ref。
- **行号区间过 W6**:所有 `path` 在 `fileRefOf` 内先经 `isPathAllowed`(§7),越界直接不产出该条(冲突文件路径本就来自 git tree,正常落 worktree 内)。
- **新增/删除整文件冲突**(add/add、modify/delete):无共同 base hunk,退化为「ours 全文区间 vs theirs 全文区间」两条 file_ref + 注明改动类型,base spec_quote 省略。

### 6.3 回灌后的黑板语义

引擎拿 `conflictEvidence` 写一条 `kind:'system'`、`from:'orchestrator'` 的消息(02 §5.2 C7 强制 system 必须 orchestrator 发),`evidence` 即上面构造的数组。这条消息:

- 满足 02 §3.2「强核验」(file_ref 带 quote、中枢可复算)→ 不会被 `validateMessage` 打回(EVIDENCE_UNVERIFIABLE);system 消息本不强制 evidence,但仍做成强可核验,便于下一轮 agent / critic 引用(§6.1)。
- 进入下一轮 `PromptContext.delta`(03 §3),喂给负责裁决的 agent 前过内容防火墙(08 `firewallPeerMessage`)。
- 是收敛检测的合法 evidence 指纹(02 §9.2);但合并冲突属**异常硬停**,默认置 `paused` 等人工,不靠 stall 自然收敛。

### 6.4 人工裁决后的续跑(resolveAndContinue,V3 职责厘清)

面板(10/11)人工在 integration worktree 手动解决冲突(编辑保留哪方)后,提供续跑入口:

```ts
/** 人工已在 integration worktree 解决冲突并 stage,中枢据此完成「本次被卡的那个 writer 的合并」
 *  并续合本轮剩余 writer。只管 git 侧合并,不碰引擎状态机(V3)。 */
async function resolveAndContinue(round: number, resolution: ConflictResolution): Promise<MergeResult>;
```

**职责边界(V3,本方法 vs 引擎)**:

| 步骤 | 归属 | 说明 |
|---|---|---|
| 人工在 integration worktree 编辑、`git add` 解决冲突 | 人工(经面板) | 只在 integration worktree 改;**agent worktree 不被中枢改写**(保持 W4 不替 agent 选边) |
| 中枢把人工 stage 的解决结果 `commit` 进 integration | `resolveAndContinue` | 完成被 `blockedAgent` 卡住的那次合并 |
| 续合本轮剩余未合并 writer(§5.2 循环从 `blockedAgent` 之后继续) | `resolveAndContinue` | 可能再撞冲突 → 再回 `ok:false`,再 paused |
| 落审计 `system` 消息 + file_ref evidence(记最终采纳内容 hash) | `resolveAndContinue` | 审计可见「谁、采纳了哪方」 |
| `paused → running` 状态迁移、决定是否进下一轮 | **引擎(03)** | 本方法只返回 `MergeResult`;引擎据其 `ok` 决定 running/再 paused/终态 |

- 本方法**不**自己改 `RunStatus`(那是引擎状态机的活,03 §4.1 `setStatus`)。它是被引擎 resume 入口调用的「git 侧合并续作」,返回 `MergeResult` 后由引擎决定后续。
- **中途冲突 → 续跑时序**:`mergeRound` 在 writer₂ 撞冲突返回 `ok:false`(writer₁ 已合入)→ 引擎 paused → 人工解决 writer₂ → `resolveAndContinue` commit writer₂ 的解决 + 续合 writer₃… → 全过返回 `ok:true`,引擎转 running。**已合入的 writer₁ 不回滚、不重合**(integration 是累积态)。

---

## 7. readFileRange + ValidateContext 装配(供 02 §8.1)

`validateMessage`(02 §8)核验 `file_ref` 时调 `ValidateContext.readFileRange`;其实现归本文件(读 worktree 文件区间)。

### 7.1 readFileRange(S1:走 isPathSafe,不裸 fs)

```ts
/** 读 agentId worktree 内某文件的 1-based 闭区间;越界/不存在/路径不安全→null(02 §8.1 契约)。 */
function readFileRange(agentId: AgentId, rel: string, lineStart: number, lineEnd: number): string | null {
  const root = workdirOf(agentId);
  // S1:路径安全走 08 §4.4 isPathSafe(realpath + 拒 ADS 冒号流/UNC/设备前缀/8.3 短名 + 落 root 内)
  //     不再用 v1 的裸 fs.existsSync + `..` 字符串判(绕不过 Windows 专属绕过 T12)。
  if (!isPathSafe(rel, root, root)) return null;          // 越界/敏感 → null(02 §8.3 视为 fail)
  const abs = path.resolve(root, rel);
  // realpath 后必须仍在 root 内(双查 symlink/junction 逃逸;isPathSafe 已查,这里是落地兜底)
  let real: string;
  try { real = fs.realpathSync.native(abs); } catch { return null; } // 不存在 → null
  if (!isInside(real, fs.realpathSync.native(root))) return null;
  const buf = fs.readFileSync(real, 'utf8');
  const lines = buf.split(/\r\n?|\n/);                    // 读时容忍任意换行
  if (lineStart < 1 || lineEnd > lines.length || lineEnd < lineStart) return null; // 区间越界
  return lines.slice(lineStart - 1, lineEnd).join('\n');  // 02 §9.1 再归一后算 hash
}
```

### 7.2 makeValidateContext:桥接签名不对称(C2/S2)

02 §8.1 的 `ValidateContext.readFileRange(rel, s, e)` **不带 agentId**;本文件 `WorktreeManager.readFileRange(agentId, rel, s, e)` **带**。用每次核验**新建**的 context 闭包绑定来源 agent,**消除 v1 的可变全局 `currentVerifyAgent`**(并发核验会串味,S2):

```ts
/** 为「发该消息的 agent」构造一次性 ValidateContext;readFileRange 闭包绑定其 worktree 根。
 *  每条待核验消息一个 context,无共享可变态(S2)。 */
function makeValidateContext(forAgent: AgentId, runId: string): ValidateContext {
  return {
    runId,
    readFileRange: (rel, s, e) => wt.readFileRange(forAgent, rel, s, e),   // ← 闭包补 agentId(C2)
    hasMessage: (id) => board.hasMessage(id),
    runCommandSandboxed: makeSandboxedRunner(forAgent),                    // §7.3(V1)
    isPathAllowed: (rel) => isPathSafe(rel, wt.workdirOf(forAgent), wt.workdirOf(forAgent)), // 08 §4.4
  };
}
```

> **冲突 evidence 不走 makeValidateContext 路由(澄清)**:§6 冲突 evidence 各条 file_ref 来源 worktree 不同(ours=integration、theirs=blocked agent),挂在一条 `kind:'system'`、`from:'orchestrator'` 消息上。按 02 §8.2,`validateMessage` 只对 `role==='critic'` / `kind==='critique'` / `ack(done)` 触发阶段 B 的 evidence 复算;**`system` 消息不在此列,其 evidence 不被 `verifyEvidence` 复算**。故不存在「system 消息核验要按 evidence.source 在多 worktree 间路由」的问题——`makeValidateContext(forAgent)` 只服务**单 agent 自发的** critic/critique/ack 消息(其 file_ref 必指向自己的 worktree)。冲突 evidence 的可核验性是为**下一轮 agent / 人工引用**(它们可在自己回合用 file_ref+quote 再断言),不是为 system 消息自身的入板校验。v1 那句「按 evidence.source 路由」措辞删除(它把不存在的需求当成了约束)。

| 要点 | 规则 |
|---|---|
| 换行 | 读时按任意换行切,返回用 `\n` 拼;`contentHash` 内部再 `normalizeContent`(02 §9.1),Win 稳定(W8) |
| 越界/不安全 | 行号越界 / 文件不存在 / `isPathSafe` 否决 / realpath 逃逸 一律 `null`(02 §8.3 fail) |
| 路径安全 | 必经 08 `isPathSafe`(W6),含 Windows T12 绕过加固;不再用裸 `..` 字符串判(S1) |
| 并发 | 每次核验新建 context,无共享可变态(S2);多消息并发核验互不串味 |

### 7.3 runCommandSandboxed —— command evidence 复跑器实例(V1,规则归 08 §4.8)

02 §8.1 的 `ValidateContext.runCommandSandboxed?` 是命令型 evidence 的沙箱复跑钩子;**复跑发生在哪个 worktree、什么权限**由本文件提供实例(**安全规则本体归 08 §4.8**,本文件只把 worktree 上下文喂进去):

```ts
/** 为 forAgent 造一个沙箱命令复跑器:cwd=该 agent worktree、read-only、断网、env 白名单、超时、命令预扫。 */
function makeSandboxedRunner(forAgent: AgentId): (cmd: string) => { stdout: string; exitCode: number } {
  const cwd = workdirOf(forAgent);
  return (cmd: string) => {
    // ① 命令预扫(08 §4.8):拒 `rm -rf /`、`curl|sh`、含 sk-/base64 疑似 key → EVIDENCE_COMMAND_UNSAFE
    assertCommandSafe(cmd);                              // 08 §4.8 规则;违规抛 EVIDENCE_COMMAND_UNSAFE
    // ② 复跑封顶 read-only(核验不该改文件)、断网、env 走 buildChildEnv 白名单(08 §2.2)、硬超时 10s
    return runInSandbox(cmd, {
      cwd,                                               // 仅该 agent worktree 内(物理隔离 W2)
      sandbox: 'read-only',                              // 核验复跑封顶 read-only(W7;比 §10 还紧)
      network: 'off',                                    // 断网,无出境
      env: buildChildEnv({ providerEnv: {}, agentId: forAgent }), // 08:无 key 的白名单 env
      timeoutMs: 10_000,
    });
  };
}
```

- 复跑器的安全约束(预扫规则集、沙箱实现)是 **08 §4.8 / §6** 的权威;本文件只负责「在正确的 worktree、用正确的 cwd」实例化它。
- **`network:'off'` 的真实兑现归 08 §6.3(X4/RS-B1)**:本节 `network:'off'` 是**消费方声明**;子进程真实出境封禁(清代理 env + OS per-agent 出站 deny + base_url 白名单,fail-closed)由 **08 §6.3**(v3.1 已落地)兜底。即「沙箱断网」不再是「未实测的唯一垫底」——08 §6.3 给了主动断网设计,M0 实测仅用于校准强度而非决定有无防线。复跑器除沙箱外还叠加这层网络封禁,核验命令即便含 `curl` 也无出境(且 §7.3 预扫已先拒 `curl|sh`)。
- 与 §10 的差异:§10 是 **agent 执行回合**的沙箱(implement 可 `workspace-write`);本节是**核验复跑**沙箱,封顶 `read-only`(核验绝不该落文件)。两者都封顶、都断网(出境封禁同走 08 §6.3),但核验更紧。
- 未注入复跑器时(02 §8.3),所有 command 证据降为 weak——但 critic 的强核验靠 file_ref+quote 已够(§6.1),command 是补充。

---

## 8. 清理(cleanup)

### 8.1 cleanup 契约

```ts
async function cleanup(runId: string, opts?: { keepOnConflict?: boolean; force?: boolean }): Promise<void>;
```

| opts | 语义 |
|---|---|
| `keepOnConflict` | 终态为 `paused/aborted`(WORKTREE_CONFLICT)时**保留** worktree,供人工事后检视;默认按全局配置 |
| `force` | Win 文件占用导致删除失败时,kill 残留句柄后强删(谨慎,§8.4) |

### 8.2 清理顺序(避免脏态)

```
1. 确保所有 agent 子进程已 cancel()(05;Win 文件锁前提,§2.4)
2. 对每个 agent worktree:git worktree remove <path>(失败→--force,再失败→orphan §8.4)
3. 删 integration worktree(同上)
4. 删分支:git branch -D sylux/<runId>/{integration,agent/*}
5. 删 base tag:git tag -d sylux/<runId>/base
6. git worktree prune(清 .git/worktrees 残留登记)
7. git gc --prune=now(O2:run 期 gc.auto=0 攒下的悬空对象——本 run 的 base/integration/agent
   commit 在删引用后已不可达——在此回收,避免对象库只涨不收;大仓可改 `git prune` 轻量版)
8. 删 .sylux/worktrees/<runId> 目录(残留文件)
9. 删 run 元数据(persistWorktreeMeta 的反向)
```

> **顺序原则**:先停进程(解锁文件),再删 worktree(git 登记),再删分支/tag(引用),最后删目录(物理)。反序会留 git 悬空登记或文件锁失败。

### 8.3 出境合规挂钩(引用 08 §7,不重定义)

worktree 内容被拷贝 / 经中转出境前(面板快照、日志、喂对面、发往第三方中转的整请求体),按安全 08 §7 走两级处置(T15):`.syluxignore` 白名单 + secret-scan + 知情标注。本文件**只在拷贝点调用** 08 暴露的过滤器,不重定义规则。涉及通路:

- diff 正文进 WS 广播 / 日志 / jsonl 前 → 08 `redact()`(脱敏占位,§4.4)。
- 整文件 / 大片段命中强 secret → 08 `guardEgress` **阻断**(不是脱敏后照发,§4.4 / 08 §7 T15)。
- worktree 文件正文被拼进发往第三方中转的请求体(喂对面 agent)→ 同样过 08 §7 出境闸(secret scan + `.syluxignore`);中转 `egressClass:'third_party'` 时面板显式知情(08 S8)。
- `readFileRange`(§7)返回内容仅用于**本机哈希复算**,不出境,无需 redact;但若该区间正文被塞进面板展示,走上面规则。

### 8.4 orphan 回收(Win 文件锁兜底)

`git worktree remove` 在 Win 下可能因残留句柄失败。兜底:

- 删除失败的 worktree 记入 `<repoRoot>/.sylux/orphans.json`(path + runId + ts)。
- 下次中枢启动 / 显式 `gc` 时重试 `git worktree remove --force` + `git worktree prune`。
- 仍失败则告警面板,留给用户手动删(绝不静默吞错,对接引擎 E7)。

---

## 9. WorktreeManager 接口(权威,03 §4.3 引用)

```ts
import type { AgentId, EvidenceItem, FilePatch, ValidateContext } from '@sylux/shared';

export interface WorktreeRunConfig {
  repoRoot: string;                 // 用户目标仓库绝对路径
  agents: readonly AgentId[];       // 仅执行体:('codex' | 'claude')[];human/orchestrator 不建 worktree
}

export interface WorktreeManager {
  /** run 初始化:打 base tag、建 integration + 各 agent 分支/worktree(幂等,§3.3)。 */
  create(runId: string, cfg: WorktreeRunConfig): Promise<void>;

  /** 取某 agent 的 worktree 绝对路径(= AgentInput.workdir,05 §2;W1 全程不变)。 */
  workdirOf(agentId: AgentId): string;

  /** decision 回合 / 新一轮起点:把 agent worktree 同步到 integration HEAD(§11.2)。 */
  syncToIntegration(agentId: AgentId): Promise<void>;

  /** 生成 agent 自 baseRef 以来的真实改动 → FilePatch[](面板 diff + 冲突预检,§4)。 */
  diffSince(agentId: AgentId, baseRef: string): Promise<{ patches: FilePatch[]; raw: string }>;

  /** ★轮末串行合并各 writer 进 integration;冲突即停并回吐可核验 evidence(§5/§6)。 */
  mergeRound(round: number): Promise<MergeResult>;

  /** 人工裁决冲突后续跑本次合并(§6.4)。 */
  resolveAndContinue(round: number, resolution: ConflictResolution): Promise<MergeResult>;

  /** 读 agent worktree 文件区间(带 agentId);经 makeValidateContext 闭包桥接到 02 §8.1
   *  无 agentId 的 ValidateContext.readFileRange(C2/§7.2)。 */
  readFileRange(agentId: AgentId, rel: string, lineStart: number, lineEnd: number): string | null;

  /** 为「发某消息的 agent」构造一次性核验上下文(闭包绑 worktree 根 + 沙箱复跑器);无共享可变态(S2/§7.2)。 */
  makeValidateContext(forAgent: AgentId, runId: string): ValidateContext;  // ValidateContext 类型源在 02 §8.1

  /** 终态清理:停进程→删 worktree→删分支/tag→prune→gc→删目录(§8)。 */
  cleanup(runId: string, opts?: { keepOnConflict?: boolean; force?: boolean }): Promise<void>;
}

export type MergeResult =
  | { ok: true; mergedAgents: AgentId[]; integrationRef: string }
  | { ok: false; code: 'WORKTREE_CONFLICT'; conflictEvidence: EvidenceItem[];
      conflictingFiles: string[]; blockedAgent: AgentId };

export interface ConflictResolution {
  /** 人工在 integration worktree 解决后,声明最终采纳;中枢据此完成 commit 并记审计。 */
  resolvedFiles: string[];
  note?: string;
}
```

> `MergeResult.ok===false` 的 `conflictEvidence` 是 02 §3 的 `EvidenceItem[]`,**唯一类型源在 02**,本文件只构造实例(§6),不另定义类型。

---

## 10. 风险分级 → codex 沙箱映射(W7,封顶引用 08 §6)

`AgentInput.sandbox`(05 §2,枚举 `'read-only' | 'workspace-write'`)由本文件按**回合 kind** 推导,**封顶 `workspace-write`**(08 §6 拥有封顶本体,本文件在其下取值,绝不出现 `danger-full-access`,事实地基 E:resume 还拒 `-s`,沙箱首轮定死)。

### 10.1 kind → sandbox 映射表

| 回合性质 | 触发 `MessageKind`(02 §2) | `sandbox` | 理由 |
|---|---|---|---|
| **decision** | `propose` / `critique` / `plan` / `review` / `question` / `ack` | `read-only` | 只读现状给方案/批判,不该落文件;读不到写权=无副作用,可安全并行(§11) |
| **execution** | `implement` | `workspace-write` | 唯一允许落 diff 的回合;仅写本 agent worktree(物理隔离 W2) |
| **system** | `system` | (不 spawn) | orchestrator 自己发,无子进程 |

### 10.2 封顶与降级规则

```ts
function sandboxFor(kindHint: MessageKind): 'read-only' | 'workspace-write' {
  const isExecution = kindHint === 'implement';
  const want = isExecution ? 'workspace-write' : 'read-only';
  return capSandbox(want);  // 08 §6:封顶 workspace-write;danger 永不可达
}
```

- **封顶**:即便 playbook/agent 显式请求更高权限,`capSandbox`(08)也压到 `workspace-write`。R8 焊死:自动化下没有 `danger-full-access` 路径。
- **最小授权**:decision 回合给 `read-only`,从根上让「出方案/批判」的回合无法写文件——既符合语义,也缩小注入攻击面(被注入的 agent 即便想落后门也无写权)。
- **首轮定死**:codex `-C`/`-s` 只首轮 `exec` 生效,`resume` 拒收(事实地基 E)。故同一 agent 的 sandbox 在**首次 spawn 时**按其首个回合定;若同一 worktree 后续回合需要从 read-only 升到 workspace-write,**必须新开一次 `exec`(非 resume)** 重设沙箱,而非在 resume 上改(适配器 05 据此选 exec/resume)。
- **网络出境与沙箱级别正交(X4/RS-B1)**:`workspace-write` 给的是**文件写权**(限本 worktree),**不**等于放开网络。子进程出境封禁(无论 read-only 还是 workspace-write)统一由 **08 §6.3** fail-closed 兜底(清代理 env + OS per-agent 出站 deny + base_url 白名单)。即 execution 回合能写文件但仍不能随意出网,exfil 类注入无网络出口——这是 L4 垫底从「沙箱可能断网(未实测)」升级为「主动封禁(08 §6.3 已设计)」的关键。

### 10.3 与 worktree 隔离的协同

| sandbox | worktree 写入 | 合并参与 |
|---|---|---|
| `read-only` | 子进程**不写**(即便写也被沙箱拦) | 该回合不产生改动,`mergeRound` 跳过此 agent |
| `workspace-write` | 仅能写**本 agent worktree 内**(沙箱根=workdir) | 轮末改动进 §5 串行合并 |

> 沙箱根与 worktree 根重合(都是 `workdirOf(agentId)`),双层隔离:沙箱拦「写 worktree 外」,worktree 拦「看见别人改动」。

> **decision 回合的 `message.files` 是纯意图,永不触发真实写(X3/FEAS-3,焊死一致性冲突)**:红队指出 03(红蓝写文件每轮合并)与 25(红蓝纯决策不写)行为定义看似相反,且 21 对 panel propose 强制 `files:[]` 疑似「静默清空 proposer 改动」。澄清:decision 回合(propose/critique/plan/review/...)sandbox=`read-only`,子进程**物理上无写权**;此时 `message.files` 仅是**意图/关注点声明元数据**(「我建议改这些文件」),**不对应任何已落盘的 diff**。因此——(1) 强制 `files:[]` 不是「清空改动」,而是「本就没有改动可清」(read-only 回合零写);(2) 若某 playbook 在 decision 回合声明 `files` 并期望它落盘,那是**回合性质配置错误**(decision 与 execution 混淆),应在 playbook 校验期拦(03/20),而非靠 worktree 静默吞;(3) execution 回合(implement,workspace-write)才有真实写,`diffSince` 取真值(§4.1),`mergeRound` 据真实改动合并。**「谁能写」由 sandbox 决定,不由 `files` 字段决定**——`files` 永远只是声明,真值永远来自中枢对 worktree 的 `git diff`(W5)。故 03「红蓝写文件」与 25「红蓝纯决策不写」的差异,本质是**剧本把红蓝配成 decision-only(M1)还是含 execution 回合(M3)**的差异,不是 worktree 层的矛盾;worktree 层对两者一视同仁:read-only 回合零合并,workspace-write 回合走 §5。

---

## 11. decision 回合 vs execution 回合的隔离差异(呼应 Fusion)

这是 worktree 模型与远景 Fusion(02 锁定决策 5 / 引擎 03)的接缝:两类回合的隔离需求**根本不同**,worktree 层必须区别对待。

### 11.1 两类回合对照

| 维度 | **decision 回合**(出方案/评审) | **execution 回合**(改文件) |
|---|---|---|
| 代表 kind | propose / critique / plan / review / question / ack | implement |
| sandbox(§10) | `read-only` | `workspace-write` |
| 是否落文件 | 否(只读现状给判断) | 是(写本 worktree) |
| 起点要求 | **必须看到最新 integration**(基于最新真值评判) | 继续在自己 worktree 累积 |
| 并行性 | **可多 provider 并行**(Fusion panel):同一角色背后多 provider 各读同一 integration 快照各答,裁判综合 | **单 agent**(R7:执行回合单 agent + worktree 隔离) |
| 合并参与 | 不参与(无改动) | 参与 §5 串行合并 |
| evidence 来源 | 读 integration 快照构造 file_ref(指向共享真值) | 读自己 worktree 改动 |

### 11.2 decision 回合的起点同步(syncToIntegration)

decision 回合评判的是「**当前最新状态**」,故每个 decision turn 前把该 agent worktree 同步到 integration HEAD:

```ts
async function syncToIntegration(agentId: AgentId): Promise<void> {
  const wt = workdirOf(agentId);
  // 硬重置到 integration tip:decision 回合不保留 agent 自己的脏改动(它本就不该写)
  await git(wt, ['reset', '--hard', integrationTip()]);
  await git(wt, ['clean', '-fd']);   // 清未跟踪文件,保证 file_ref 指向的就是 integration 真值
}
```

- 这样 decision 回合 agent 的 `file_ref` evidence 指向的内容 == integration 真值,多 provider 并行评判时**所有 panel 成员看同一份快照**(Fusion 一致性前提)。
- execution 回合**不**调 `syncToIntegration`(否则冲掉它正在累积的改动);它只在轮末合并后,由下一轮按需同步。

### 11.3 Fusion panel 的 worktree 复用(远景)

Fusion 下一个 decision「角色」背后站多 provider(02 锁定 5)。worktree 层策略:

- **decision panel 共享只读快照**:panel 成员都是 `read-only`,且都 `syncToIntegration` 到同一 tip → 可共用**一份**只读 worktree(或各自只读副本),无写冲突、无需各建可写 worktree。省去 N 个 provider N 个 worktree 的开销。
- **裁判综合不落文件**:judge 产出「共识/矛盾/盲点」是 evidence(02 §3),不是 diff;不碰 worktree。这正是 critic 要的 evidence 格式(02 §3 锚点),天然可核验。
- **execution 仍单 agent**:Fusion 只作用于 decision 回合;一旦进入 implement,回到 R7 单 agent + 独占可写 worktree + 轮末合并,**不允许** panel 多 provider 并发写同一目标(否则回到「直接对喷+写冲突」的泥潭)。

> 一句话:**decision 可扇出(读多答多裁判合),execution 必收敛(单写隔离串行并)**。worktree 隔离只对 execution 是硬需求;decision 的隔离退化为「共享只读快照」。

### 11.4 隔离差异决策表(实现查表)

| 回合 | create 时 | turn 前 | turn 中写权 | 轮末 |
|---|---|---|---|---|
| decision(单) | 复用已建 worktree | `syncToIntegration` | read-only | 无合并 |
| decision(Fusion panel) | 复用/共享只读快照 | 各成员 `syncToIntegration` 同一 tip | read-only | 仅裁判 evidence,无合并 |
| execution | 复用已建 worktree | 不同步(保留累积) | workspace-write | `mergeRound` 串行并入 |

---

## 12. 失败路径与错误码

| 场景 | 错误码 | 处理 | 引用 |
|---|---|---|---|
| git 子进程非预期失败 | `WORKTREE_GIT_FAILED`(02 §12 已登记,line 995) | 抛 `SyluxError`(stderr 过 redact),引擎写 system 置 aborted(E7) | §1.2 |
| repoRoot 起点不干净(有未提交改动) | `WORKTREE_GIT_FAILED` | create 期 `assertCleanTree` 拦,提示用户先提交/暂存 | §3.3/§5.0 |
| 轮末 3-way 冲突 | `WORKTREE_CONFLICT`(02 §12 已有) | `mergeRound` 回 `ok:false`+evidence,引擎 paused 等人工(W4) | §5/§6 |
| file_ref 路径越界(消息层) | `WORKTREE_PATH_VIOLATION`(02 §12 已有,C6) | `isPathSafe`(08 §4.4)拦,validateMessage 打回 | §7/W6 |
| 合并落地路径越界(TOCTOU symlink) | `WORKTREE_PATH_VIOLATION` | 合并相位二次校验 `assertTreePathsSafe` 拦,硬停回灌(W10/S3) | §5.5 |
| worktree 路径中途被移动 | `WORKTREE_GIT_FAILED` | 违反 W1,resume 指错目录;视为致命,abort + 提示 | W1 |
| 同分支被两 worktree checkout | (create 期 git 报错) | `create` 幂等检查拦,改名/复用现有 | §2.1/§3.3 |
| base tag 重入时 HEAD 已变 | (不抛) | 以已锚 base 为准、不移动、告警(F4/W9) | §3.3 |
| Win 文件锁删除失败 | 不抛,进 orphan | 记 orphans.json,下次重试(不吞错,告警) | §8.4 |
| git 版本 <2.38 无 merge-tree --write-tree | (启动期探测) | 退化临时 worktree 真 merge+abort 方案;本机 2.44 不触发(F2) | §5.3 |
| command evidence 复跑违反沙箱约束 | `EVIDENCE_COMMAND_UNSAFE`(02 §12 已有) | 该证据判 fail(不计强),记 system;不终止本轮(规则归 08 §4.8) | §7.3 |
| diff 正文/整文件出境命中 secret | `EGRESS_SECRET_BLOCKED`(02/08 §12 已登记) | `guardEgress` 阻断该片段出境,面板显示「已隐藏」,不终止 run(规则归 08 §7) | §4.4/§8.3 |
| M1/M2 单 checkout 误调多树专属方法(syncToIntegration/resolveAndContinue) | `WORKTREE_GIT_FAILED` | `SingleCheckoutManager` 显式抛,暴露「该升 M3 manager 却没升」的配置错误,不静默 no-op(X1) | §2.6.1 |

> **错误码已对齐 02 §12(v3.1 修正 v2 过期声明)**:v2 曾称 `WORKTREE_GIT_FAILED` 需「回填 02 §12」。**已过期**:02 §12(line 995)已登记 `WORKTREE_GIT_FAILED`,且 `WORKTREE_CONFLICT` / `WORKTREE_PATH_VIOLATION` / `EVIDENCE_COMMAND_UNSAFE` / `EGRESS_SECRET_BLOCKED` 均在 02/08 §12 全集内。本文件**只引用、不新增**错误码(焊死 02 类型单一权威 I1/R1)。`EGRESS_SECRET_BLOCKED` / `INJECTION_BLOCKED` 的拥有文档是 08(本文件消费)。

---

## 13. 命令示例(本机可复现锚点)

> 全部经 Node `execa` 调用(不经 PowerShell 重定向,事实地基 A);此处列等价命令供人工核对。`-c` 注入见 §1.2。**本机(git 2.44.0)实测锚点**已在 §5.3 给出 `merge-tree` 的真实 stdout 形状。

```bash
# 创建 base tag(run 起点快照,不可移动:无 -f;F4/W9)
git rev-parse --verify -q refs/tags/sylux/<runId>/base || git tag sylux/<runId>/base HEAD

# 建 integration worktree(从 base 切)
git branch sylux/<runId>/integration sylux/<runId>/base
git worktree add .sylux/worktrees/<runId>/integration sylux/<runId>/integration

# 建 codex agent worktree
git branch sylux/<runId>/agent/codex sylux/<runId>/base
git worktree add .sylux/worktrees/<runId>/codex sylux/<runId>/agent/codex

# round 末:agent 真实改动(含未跟踪新增,F3:临时 index)
export GIT_INDEX_FILE=$(mktemp)
git read-tree sylux/<runId>/base
git add -A -- .
git -c core.autocrlf=false diff --find-renames=50% --no-color -z --name-status --cached sylux/<runId>/base
unset GIT_INDEX_FILE   # 临时 index 用完即弃,不碰真 index

# 把 agent 改动固化成 agentBranch 一个 commit(在 agent worktree 内)
git add -A && git commit -m "sylux round <n> by codex"   # nothing staged 则跳过(V2)

# 无副作用探冲突(本机 git 2.44.0 实测;stdout = tree-OID + stage 行 + 信息段,退出码非零=冲突)
git -c merge.conflictStyle=diff3 merge-tree --write-tree -z \
    sylux/<runId>/integration sylux/<runId>/agent/codex
# 取冲突文件三方原文:stage 1/2/3 的 blob OID 直接 cat-file(无需解析 diff3 标记)
git cat-file -p <stage2-blob-oid>      # ours(integration)原文
git cat-file -p <stage3-blob-oid>      # theirs(agent)原文
# 取真实行号:对各侧跑 -U0 diff,hunk header 的 +start,len 即该侧文件 1-based 行号(§6.2)
git diff -U0 --no-color $(git merge-base sylux/<runId>/integration sylux/<runId>/agent/codex) \
    sylux/<runId>/agent/codex -- <path>

# 合并落地前二次路径校验(W10/§5.5):列合并 tree 全路径,逐个过 isPathSafe
git ls-tree -r -z --name-only <merged-tree-oid>

# 真合并(探测无冲突 + 路径校验过后,在 integration worktree 内)
git merge --no-ff --no-edit sylux/<runId>/agent/codex

# decision 回合起点同步(agent worktree → integration tip)
git reset --hard sylux/<runId>/integration && git clean -fd

# 清理(含 gc 回收 run 期 gc.auto=0 攒下的对象,O2)
git worktree remove .sylux/worktrees/<runId>/codex
git branch -D sylux/<runId>/agent/codex sylux/<runId>/integration
git tag -d sylux/<runId>/base
git worktree prune
git gc --prune=now
```

---

## 14. 测试矩阵(交付验收锚点)

| # | 用例 | 输入/操作 | 期望 |
|---|---|---|---|
| WT1 | create 幂等 | 连调两次 create(同 runId) | 第二次跳过已存在 worktree,无报错 |
| WT2 | 路径稳定 | create 后取 workdirOf,resume 多轮 | 路径不变(W1) |
| WT3 | 同分支拦截 | 两 worktree 试 checkout 同分支 | create 拦截/改名,不崩 |
| WT4 | diffSince 改名 | 改名文件 score≥阈值 | FilePatch.changeKind='rename'+renamedFrom |
| WT5 | diff 二进制 | 改二进制文件 | FilePatch.isBinary=true |
| WT6 | 无冲突合并 | 两 agent 改不同文件 | mergeRound ok:true,integration 含两改动 |
| WT7 | 冲突硬停 | 两 agent 改同文件同区间 | ok:false,WORKTREE_CONFLICT,blockedAgent 确定 |
| WT8 | 冲突 evidence 可核验 | WT7 的 conflictEvidence | 每条 file_ref 经 02 §8.3 verifyEvidence='pass' |
| WT9 | 不选边 | WT7 后查 integration | 工作区干净,未写入任一方(W4) |
| WT10 | 串行确定性 | 同输入多次 mergeRound | blockedAgent / 合并顺序一致(§5.4) |
| WT11 | readFileRange 越界 | 行号超文件长度 | 返回 null(02 §8.3 fail) |
| WT12 | readFileRange 换行 | CRLF 文件读区间 | 哈希与 LF 版相同(W8/02 §9.1) |
| WT13 | 路径越界 | file_ref.path 含 `../` | readFileRange→null,WORKTREE_PATH_VIOLATION |
| WT14 | sandbox 映射 | kindHint=propose / implement | read-only / workspace-write(§10.1) |
| WT15 | sandbox 封顶 | 请求 danger-full-access | 压到 workspace-write(W7/08) |
| WT16 | decision 同步 | syncToIntegration 后 file_ref | 内容==integration tip(§11.2) |
| WT17 | execution 不同步 | execution 回合不调 sync | agent 累积改动不丢 |
| WT18 | cleanup 全清 | cleanup 后 | worktree/分支/tag/目录全删,prune 干净 |
| WT19 | orphan 回收 | 模拟删除失败 | 记 orphans.json,下次重试成功 |
| WT20 | 崩溃重入 | create 中途杀进程后重跑 | 幂等补齐,不重复 add(§3.3) |
| WT21 | diffSince 含未跟踪新增(F3) | agent 新建文件(从未 `git add`) | FilePatch 含该 add,临时 index 不污染真 index |
| WT22 | base tag 不移动(F4/W9) | integration 已前移后再调 create(重入) | base tag 指向仍是 run 起点,未被冲到 HEAD |
| WT23 | 多轮 merge-base 推进(W9) | 第 2 轮合并,前轮改动已在 integration | 前轮改动不被当冲突重报;merge-base=git 自算 |
| WT24 | merge-tree stdout 解析(F1) | 制造冲突,跑 mergeTreeProbe | 正确取 tree-OID + stage1/2/3 blob OID,不依赖 stdout diff3 块 |
| WT25 | 冲突 evidence 行号真实(F1/§6.2) | WT7 的 file_ref.lineStart/End | 指向 agent/integration 真实文件行号,readFileRange 取到对应正文 |
| WT26 | 零改动 writer 守卫(V2) | agent 被指派 implement 但没动文件 | 不空 commit、不计 writer、mergeRound 跳过 |
| WT27 | 合并落地路径二次校验(W10/S3) | 合并 tree 含越界 symlink 路径 | assertTreePathsSafe 拦,WORKTREE_PATH_VIOLATION 硬停 |
| WT28 | Windows 路径绕过(S1/T12) | file_ref.path 用 `a.txt:ads` / `\\?\` / 8.3 短名 | isPathSafe 否决,readFileRange→null |
| WT29 | 并发核验无串味(S2) | 同时核验两 agent 的 file_ref | 各自读对的 worktree,无 currentVerifyAgent 串味 |
| WT30 | command 复跑沙箱(V1) | critic 提交 `command` evidence | 在 agent worktree、read-only、断网复跑;不安全→EVIDENCE_COMMAND_UNSAFE |
| WT31 | resolveAndContinue 续合(V3) | 冲突解决后调用 | 完成 blockedAgent 合并 + 续合剩余 writer;不自改 RunStatus |
| WT32 | diff 正文出境脱敏(S4) | diff 含新增 `sk-...` 行 | WS 广播前过 redact;整文件命中 secret 走 guardEgress 阻断 |
| WT33 | 起点不干净拦截 | repoRoot 有未提交改动时 create | assertCleanTree 抛 WORKTREE_GIT_FAILED |
| WT34 | gc 回收(O2) | cleanup 后查对象库 | run 期产生的不可达对象被 gc --prune=now 回收 |
| WT35 | M1 单 checkout 强核验(X2/FEAS-2) | M1 形态(SingleCheckoutManager),critic 提交 file_ref | readFileRange 读到单 checkout 内容,verifyEvidence='pass';无多 worktree |
| WT36 | M1/M2 mergeRound no-op(X1) | M1/M2 调 mergeRound | 返回 ok:true、mergedAgents:[];不报错、不假装合并 |
| WT37 | 过渡误用暴露(X1) | M1/M2 调 syncToIntegration/resolveAndContinue | 抛 WORKTREE_GIT_FAILED(不静默 no-op) |
| WT38 | redact 在完整 diff 上做(X6/RS-M1) | diff 含跨拟切块边界的 `sk-ant-...` | 先整体 redact 再切块,广播无明文 key;反例:先切后逐块 redact 应被测试拒绝 |
| WT39 | diff 正文 taint 标注(X5/RS-B2) | diff 含 `<script>` / path 含 `<img onerror>` | FilePatch/diff 出口带 taint 标注;消毒由面板侧(08 §5.7)验,本文件不裸传可信 HTML |
| WT40 | decision 回合零写不丢意图(X3/FEAS-3) | decision 回合 agent 声明 files 但 read-only | diffSince 空、mergeRound 跳过该 agent;无「静默丢写」(本就无写) |
| WT41 | 网络出境封禁正交(X4/RS-B1) | workspace-write 回合子进程试 curl 外发 | 受 08 §6.3 fail-closed 封禁拦(env 无代理 + OS deny);写文件权不放开网络 |

---

## 15. 收尾:本文件权威性声明

1. **唯一定义**:`WorktreeManager` / `MergeResult` / `ConflictResolution` / `WorktreeRunConfig` 接口有且只有本文件定义,落 `@sylux/core/src/worktree/`。引擎 03 §4.3 只引用方法名。`makeValidateContext` 桥接 02 §8.1 的 `ValidateContext`(签名不对称 C2,§7.2)。
2. **类型引用 02**:`EvidenceItem` / `FilePatch` / `AgentId` / `SyluxError` / `ValidateContext` 等全部 zod 类型与错误码唯一权威在黑板协议(02);本文件只构造实例、不另写 zod(焊死 R1)。`contentHash` 是中枢派生权威(02 H1/I7),冲突 evidence 靠 `quote` + 实读区间达成强核验(§6.1)。
3. **遵守 R7**:纯 worktree 模型——运行期无锁(W2)、轮末串行合并(W3)、冲突硬停不选边(W4)、删除「同文件写权串行化」措辞。
4. **遵守 R8(worktree 部分)**:沙箱封顶 workspace-write(W7/§10),decision 回合最小授权 read-only,核验复跑封顶 read-only(§7.3)。封顶本体在 08 §6,本文件按风险分级在其下取值。
5. **本机实测校正(v2 核心,v3.1 保留)**:`merge-tree --write-tree` 的 stdout **不含** diff3 块(本机 git 2.44.0 实测),改用 stage blob + per-side diff 拿真实行号(F1,§5.3/§6.2);git 版本 ≥2.38 已退【待实测】(F2)。
6. **里程碑分级隔离(v3.1·X1/X2/X3 核心)**:M1=单只读 checkout 零写零合并、M2=单 checkout + diff plumbing(decision 轮 diff 恒空,非矛盾)、M3+=本文件多 worktree 稳态;三段共享 `WorktreeManager` 接口,M1/M2 用 `SingleCheckoutManager` 退化实现(§2.6),`readFileRange`/强核验在 M1 有依托(闭合 COV-9/FEAS-2);decision 回合 `files` 是纯意图永不触发真实写(闭合 FEAS-3)。
7. **安全引用对齐 08 v3.1(v3.1·X4/X5/X6)**:子进程网络出境 fail-closed 封禁归 08 §6.3(本文件 `network:'off'` 是消费方声明,RS-B1);本文件产出的 diff 正文/path/quote 是**不可信数据**,HTML 消毒归 08 §5.7 + 10,本文件标 taint(RS-B2);diff redact 必须在完整单文件 diff 上做再切块,禁逐块 redact(RS-M1)。
8. **错误码对齐 02/08 §12(v3.1 修正 v2 过期声明)**:`WORKTREE_GIT_FAILED` / `WORKTREE_CONFLICT` / `WORKTREE_PATH_VIOLATION` / `EVIDENCE_COMMAND_UNSAFE` / `EGRESS_SECRET_BLOCKED` **均已在 02/08 §12 登记**;本文件只引用不新增(焊死 I1/R1)。v2 全篇「需回填 02 §12」措辞已删/改为「已对齐」。
9. **回填/对齐项(v3.1 复核)**:
   - 02 §12:`WORKTREE_GIT_FAILED` 等本文件用到的码**已登记**(line 995 等),无需再回填,确认对齐。
   - 02 §8.1:`ValidateContext` 类型被 09 import;`makeValidateContext` 构造责任归本文件(§7.2),02 只定义 context 形状——确认对齐。
   - 引擎 03 §5.1 已消费 `mergeRound`/`conflictEvidence`/`paused` 流程(实测 line 466-471 冲突即 return finalize),与 §5/§6 契约一致,无需改 03。
   - 08 §4.4 末尾点名的「合并相位二次路径校验」由本文件 §5.5 `assertTreePathsSafe` 兑现(W10);08 §5.7(XSS 消毒)/ §6.3(网络封禁)由本文件消费,确认对齐。
   - 25 路线图:M1/M2 单 checkout 形态由本文件 §2.6 给规格,与 25 §75/T2.6/T3.1 一致,确认对齐。
10. **演进纪律**:`contentHash`/`normalizeContent` 归一规则(02 §9.1)与合并行号映射(§6.2 per-side diff hunk)强耦合,改动须同步 02 并升 `SCHEMA_VERSION`(02 §1.2)。
11. **编号纪律**:本文件用文件名编号(安全=08、worktree=09),与 02/03/08 一致;05/06 用逻辑编号(安全="09"、worktree="06"),不一一对应,统一收口交定稿(C1)。

