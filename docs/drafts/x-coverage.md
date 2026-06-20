# 交叉审查报告 · 覆盖缺口审查 (x-coverage)

> run-tag: v3.1 · 审查范围:01~25 全部草稿 + PROBED-FACTS.md
> 审查焦点:覆盖缺口 —— 该有的章节没人写 / 失败路径缺失 / 边界没覆盖 / 事实地基已知约束未被对应章节落实。
> 方法:对抗性红队视角,只挑漏洞与缺口,不复述已写好的内容。已读全文:01-09、11、15、16、21、23、24、25;结构级核查:10、12、13、14、18、19、22;并用 grep 量化跨稿漂移。

## 0. 总览结论(verdict)

整体覆盖**相当完整**:每篇都有失败路径章节、测试矩阵、openQuestions、回填清单,事实地基 A–G 基本都被对应章节落实。没有发现"整章该写没写"的大洞。真正的缺口集中在三类:① 权威源(02 §12 错误码、23 术语表)滞后于下游 v2 —— 下游都说"要回填"但权威源没动,形成"已在用但未登记/已改但未同步"的漂移;② 全仓文档编号双轨制(安全/面板 08↔09 对调)无人总控解决;③ 个别过渡形态(M1/M2 无 worktree 执行、复跑器基础设施失败)无主。这些都不阻断架构,但会让照文档开工的实现者/GPT 踩坑或编译不过。最高优先级:COV-1/COV-4(错误码权威源补全)、COV-6(编号统一)、COV-8(术语表 23 重刷)。

## 1. 章节级缺口(该有没有)

- **COV-1 / COV-4**(详见 §5):02 §12 `SyluxErrorCode` union 缺至少 8 个下游已用的码 —— 这是"权威章节内容缺失",归此类也归一致性类。
- **COV-9**:M1/M2 的"单 checkout 执行 / 无 worktree 落 diff"过渡形态无任何文档拥有规格(详见下)。
- 未发现其他整章缺失:进程拓扑(01)、引擎(03)、刹车(04)、适配(05/06)、provider(07)、安全(08)、worktree(09)、面板(10)、WS(11)、技术栈/monorepo/测试/可观测/配置/性能/评测/部署/DSL/Fusion/e2e/术语/M0/路线图均到位。

### COV-9【章节缺口·M1/M2 无 worktree 执行无主】涉及 25 / 09 / 10 / 11
25 路线图 M1 明确"红蓝为纯决策回合,critic 不产生文件写,不需要 worktree(09)";但 M2 的 T2.6/T2.9 要"从(M3 前用单 checkout)git diff 产 diff 供面板渲染"。矛盾:① M1/M2 既无文件写,M2 的 diff 面板渲染什么?② "M3 前用单 checkout"这个过渡隔离形态(非 worktree、单工作目录跑任何写)没有文档拥有规格 —— 09 只描述 M3+ 完整 worktree 模型,01/03 假设 implement 走 worktree。"M1/M2 若要支持任何文件写用什么隔离、沙箱怎么封顶、与 09 怎么迁移"是一段无主过渡设计。建议二选一:要么明确 M1/M2 完全无文件写(则 M2 diff 面板推迟到 M3,T2.6/T2.9 移出 M2 退出标准),要么补一份"M1/M2 单 checkout 执行"过渡隔离规格。

## 2. 失败路径缺口(异常/降级/恢复没写全)

各篇失败路径章节齐全(01 §4、03 §8、04 §3.2/§5、05 §5/§12、06 §8、08 §1.2、09 §12、10 §10、11 §11、18 §12、19 §7、22 §8)。仅一处真缺口:

### COV-3【失败路径缺口·复跑器基础设施失败未分类】涉及 02 / 08 / 09
02 §8.1 `runCommandSandboxed` 与 08 §4.8 复跑闸覆盖了"命令不安全"(元字符/非白名单 → `EVIDENCE_COMMAND_UNSAFE`)和"复算不符/超时"(→ `EVIDENCE_UNVERIFIABLE`),但**没单列"复跑器/沙箱基础设施本身失败"**(spawn 复跑器崩、沙箱创建失败 —— 不是命令的错,是中枢侧故障)。该判 fail 还是 weak?若判 fail,会让一条本可强核验的 evidence 因中枢侧偶发故障被误降级,连带影响 C1 与收敛 stall 计数;若判 weak 又可能放过真问题。建议 02 §8.3 + 08 §4.8 明确:核验器基础设施失败 → 判 weak + 记 system 告警,**不**连坐 critic"无效发言"(非 agent 的错),并可重试复算 N 次。

## 3. 边界缺口(规模/并发/极值/时序边界)

边界覆盖好:DoS 上限(02 H4/§5.3)、token 累积超线性(D 节贯穿 04/15/17/21/25)、WS 背压(11 §7)、jsonl 体积(01 §5.6)、worktree 磁盘成本(09 §2.5)、并发限流(P5/17)、Windows 路径绕过(08 T12)、长会话虚拟滚动(10 §5/§11)都有量化护栏与降级。未发现明显边界盲区。Fusion 的 `(N+1)×` 横向成本叠事实 D 纵向(21 §8)也算到了。唯一**待实测而非缺口**:Fusion 多视角对 stall 指纹差集的实际影响(21 openQuestion)、judge 喂 N 份答案是否撞 32KB(21 openQuestion)—— 已被标注,不算漏。

## 4. 事实地基落地缺口(PROBED-FACTS A~G 未被对应章节落实)

事实地基 A–G **全部有对应章节落实**,且 M0 闸(24)把残留【待实测】系统性归集成任务卡 + 回填表(§9),这是很强的闭环。逐节核查:
- A(spawn)→ 05 §4/§8.1、06 §2/§9.1、12 §3、INV-A1;CRLF/UTF-8 → 08/09 W8、13 §8 .gitattributes。✓
- B(事件流首行 thread.started)→ 05 §5/§7、06 §5、I5/A1。✓
- C(output-schema 经中转成形 + safeParse 兜底)→ 05 §9、06 §4、02 I2。✓
- D(resume 累积/超线性、18.7k 基线)→ 04 §6(两 regime 修正)、15 §3.3、17、21 §8、25 RP2;**这是落实最彻底的一条**,04 H-B3 还专门修了 v1 "无脑超线性误杀 stateless" 的 bug。✓
- E(resume 参数集不对称)→ 05 §6.2、INV-A4。✓
- F(claude flag、两端 schema 不对称)→ 06 全篇 + §0.3 实测增补(CF-1~6)。✓
- G(usage 取 turn.completed.usage)→ 02 §6.3、15 O3、INV-A5。✓
未发现"事实地基已知约束没被任何章节落实"的缺口。

## 5. 跨文档一致性缺口(权威源/术语/接口对不齐)

### COV-1 / COV-4【错误码权威源(02 §12)滞后于下游已用码】blocker 级一致性缺口
02 §12 被三稿声明为错误码唯一权威(R1)。但下游已在用、02 §12 当前缺失的码至少 8 个,各篇都"建议回填 02"却无人真正补:

| 缺失码 | 下游来源 | 用途 |
|---|---|---|
| `SUBPROCESS_TIMEOUT` | 01 §3.5/A5 | turn 墙钟超时 |
| `SUBPROCESS_CRASHED` | 05 §5.2、06 §8 | 闸门后崩溃 |
| `SUBPROCESS_CANCELLED` | 05 §10、03 §5.3 | cancel/超时杀进程 |
| `EMPTY_ROUND_PLAN` | 03 §5.1/§8 | 空 turns 防御 |
| `ENGINE_FATAL` | 01 §4.4、03 §5.1 | 未预期异常兜底 |
| `INJECTION_BLOCKED` | 03 §2.3、08 §4.5 | 内容防火墙高危命中 |
| `EGRESS_SECRET_BLOCKED` / `WS_AUTH_FAILED` / `WS_FORBIDDEN_CONTROL` / `WS_ORIGIN_REJECTED` / `WS_PROTOCOL_MISMATCH` / `WS_HELLO_TIMEOUT` / `WS_BACKPRESSURE` / `UNKNOWN_FRAME_TYPE` / `DIFF_REF_EXPIRED` | 08 §8、11 §11 | 出境/WS |
| `WORKTREE_GIT_FAILED` | 09 §12 | git 子进程失败 |
| `FUSION_KIND_FORBIDDEN` / `FUSION_NOT_WIRED` | 21 §9.3 | Fusion 边界 |
| `CONFIG_NOT_FOUND` / `CONFIG_PARSE_ERROR` / `CONFIG_ENV_UNRESOLVED` / `CONFIG_SCHEMA_INVALID` / `CONFIG_REPO_INVALID` / `CONFIG_AGENT_UNMAPPED` | 16 §13 | 配置加载 |

后果:`SyluxError` 的 `code: SyluxErrorCode` 与 03 的 `classifyThrow`/15 的 `ERROR_LEVEL: Record<SyluxErrorCode,...>` 在编译期就拒下游引用(15 §6.7 还用 `Record` 强制穷举,漏一个就编译红)。注意 02 的 `AgentEvent.error.code` 是 `z.string()`(开放),运行期不炸,但 union 仍缺登记。必须在 02 §12 一次性补全这 20+ 个码并标 owner 文档,否则 M1 第一刀建 @sylux/shared 就卡。这是 R1"单一权威"在错误码维度的活体缺口。

### COV-6【全仓文档编号双轨制无人总控】blocker 级一致性缺口
两套编号在"安全"和"面板/WS"上正好对调(08↔09):
- 文件名编号派(security=08, worktree=09, codex=05, claude=06, provider=07, 面板=10, WS=11):03、07、08、09、11、24、25。
- 逻辑编号派(security=09, 面板/WS=08, worktree=06, adapter=04或05):01、02、04、05、06、23。
后果:任何"安全 09"引用在文件名体系里指向 worktree;"面板 08"指向 security —— 完全错位。08 顶部、01 §0.2、03 §0 Q6、04 §13.2、07 §V1、09 头部都把它列 openQuestion 但都不动手,互相指。这不是单篇能吃掉的,需一个总控动作(定稿重编号表 + 全仓回填)。建议:以磁盘文件名为唯一权威(08=安全/09=worktree/10=面板/11=WS),回填 01/02/04/05/06/23 的逻辑编号引用,或在 23 落一张双向映射表。

### COV-8【术语表 23 对 v2 全面陈旧,伪装成权威】major 级一致性缺口
23 自我定位"全项目术语权威 + 不变量汇编 + CI 自检基准 + 审阅验收锚点",但内容停在 v1,与 02/03/04 v2 多处冲突:
- INV-T4 写"evidence ≥1 条达【强/中】" —— 02 v2 §3.2/C1 已收紧为"≥1 条【强】"(weak 不解锁,H2)。
- INV-E6 / §1.5 / §3.2 / §4.2 写"刹车前置+后置【双侧检查】"、`checkBefore`/`checkAfter` —— 03 v2 H1 + 04 §2.4 已废前置刹车,改"每轮末单次 update→shouldStop"。
- INV-E4 / §4.2 写"done(isDone)与 stall(checkAfter)两处独立逻辑" —— 03 v2 H2 已把 done 统一进 04 CompositeStopPolicy,引擎不再有独立 `if(isDone)`。
- §1.4 digest 条"生成器归刹车 07" —— 03 v2 Q9 已改"接口归引擎 03、算法归性能 17"(与 17 §6.3 实为 prompt 裁剪、未真正定义 DigestBuilder 算法,见 COV-10)。
- 全文用逻辑编号(同 COV-6)。
后果:23 被定位成验收基准("无落点的不变量=未完成 TODO"),但它引用的不变量已与源漂移。审阅者/CI 照 23 断言会断言出 v1 错误约束(要求 checkBefore、要求引擎独立 isDone、要求"强/中")。23 必须按 02/03/04 v2 全面重刷,否则从"消歧权威"沦为"歧义源"。

### COV-10【"强/中" vs "强" 收紧未全仓贯彻】major 级一致性缺口
grep 命中"强/中|强或中"的有 02、04、07、14、15、20、21、22、23、25(共 10 篇 + 本报告)。02 v2 H2 / §3.2 已把 critic/critique/ack 的 evidence 门从"强或中"收紧为"≥1 条强"(weak = 无 quote 的 file_ref / 未实跑 command / spec_quote,单独不解锁);04 H-FP、07 V8 已对齐到"强"。但仍有多篇用旧"强/中"措辞:
- 15 §6.3 EVIDENCE_UNVERIFIABLE 描述"无一强/中通过"、§6.1 表同;21 F4/§6/§6.3 prose 写"≥1 强/中"(但其代码 `hasStrongOrMidEvidence` 实际只认 `verifyEvidence==='pass'`=强,prose 与 code 自相矛盾);14 EV6、22、25、20、23 同。
注意:这些多数是**措辞滞后**而非语义错(21 的代码、04/02 的权威已是"强")。但术语不统一会让实现者困惑"中等证据到底解不解锁"。建议全仓把"强/中"统一改"强"(或显式写"强核验通过"),与 02 v2 §3.2 对齐。21 prose 尤其要改(它和自己的代码打架)。

### COV-5【陈旧交叉引用残留(已闭合但措辞未更新)】minor
06 §12 回填项 7 仍称"07 §7.1 旧形 `buildChildEnv(cfg, providerEnv)` 双位参,与 08 不一致" —— 实为 06 读到的是 07 旧版本,07 v2 §7.1 已自行修正为单对象 `buildChildEnv({providerEnv, agentId})`(与 08 §2.2、05 A1、06 CA1 一致)。即此项已闭合,但 06 文稿的回填项措辞未更新,会误导审阅者以为仍有 bug。定稿删 06 §12.7 或标"已闭合"。

### COV-7【五份红队报告的幽灵依赖】记录项
04/05/06/07/08/09 六篇 openQuestion 都写:任务点名要"吃掉"的五份报告(x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost)在 docs/drafts/ 不存在,故改用"对抗性自检 + 邻居对账"替代,声明"报告补齐后需再过一遍"。本报告(x-coverage)的产出闭合了其中"x-coverage 缺失"一条 —— 这六篇确实需按本报告逐条复核。但 x-consistency / red-feasibility / red-security / red-ops-cost 四份仍需产出,才能让这六篇的"待复核"声明真正落地。这是结构性覆盖缺口:当前 v2 硬化建立在"自检"而非"被专门红队审过"之上。

## 6. 安全红队(R8)落地缺口

R8 八条(env 白名单/key 不进 argv/防火墙/沙箱封顶/redact/WS 鉴权/出境扫描/官方直连)落地**很扎实**:08 全篇 + 09 worktree 部分 + 07 key 引用模型 + 11 §8 + 15 §5 + 19 §3/§4 + 23 INV-S。未发现 R8 维度的整章缺口。仅留两个已被标注的【待实测】(非缺口,但安全 blocker,M0 必须有结论):
- G3 / 08 §6.2:claude `--permission-mode plan` 是否真只读(只读映射若漏写=沙箱失效)。
- G4 / 08 §6.2/§7:codex `workspace-write` 沙箱是否仍允许出网(若可出网,注入 exfil 有出口,L4 垫底强度依赖此 + 08 §4.9"沙箱挡 agent 直接外发"的断言都悬在此)。
这两条 24 §4 已正确标为 blocker/major 并要求开工前有结论 —— 覆盖到位,只是实测未做。补充一个轻微观察:08 §4.8 命令复跑白名单的精确成员集(node/npx 这类可跑任意代码的是否剔出)留给"04/M0 共定",属合理延后,但需确保 M0 前敲定,否则复跑闸的 default-deny 列表为空时形同虚设。

---

## 附:按优先级排序的行动清单(供定稿)
1. **(blocker)** COV-1/COV-4:02 §12 一次性补全 20+ 缺失错误码 + 标 owner。
2. **(blocker)** COV-6:定一张全仓编号权威映射表(建议锚定磁盘文件名),回填逻辑编号派 6 篇。
3. **(major)** COV-8:按 02/03/04 v2 全面重刷术语表 23(checkBefore 废除、done 统一 composite、强/中→强、编号、digest 归属)。
4. **(major)** COV-10:全仓"强/中"→"强"统一,21 prose 与其代码对齐。
5. **(major)** COV-9:裁决 M1/M2 是否有文件写;无则 diff 面板推迟 M3,有则补过渡隔离规格。
6. **(minor)** COV-3:02 §8.3/08 §4.8 补"复跑器基础设施失败 → weak + 不连坐"。
7. **(minor)** COV-5:删/更新 06 §12.7 陈旧回填措辞。
8. **(记录)** COV-7:补产出另四份红队报告,六篇 v2 稿据此复核。
