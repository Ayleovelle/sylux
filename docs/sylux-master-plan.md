# sylux 总体规划(Master Plan)· v3.1

> 本文件是 sylux 项目的**唯一权威总体规划**,由 25 篇硬化设计稿(01–25)、五份红队/交叉审查报告(x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost)与 `docs/skeleton/` 代码骨架融合定稿而成。
>
> **类型唯一性原则(不变量 I1)**:全文涉及黑板消息(`Message`)、证据(`EvidenceItem`)、Agent 事件(`AgentEvent`)、错误码(`SyluxErrorCode`)等核心契约的类型定义,**有且只有 §2 一处权威**,物理落 `@sylux/shared/src/blackboard.schema.ts`(错误码落 `errors.ts`)。其它章节只引用、不重定义;任何漂移以 §2 / 骨架代码为准。
>
> **事实标注约定**:凡基于假设而非本机实测的结论显式标注【待实测】;凡 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)已覆盖的,视为事实,不再标注。
>
> **文档编号锚定(吃掉 C-NUM 双轨制)**:全仓统一**锚定磁盘文件名编号**(见 §27 映射表)。历史"逻辑编号派"引用(把"安全"写 09、"worktree"写 08)一律按磁盘文件名纠正:08=安全/防火墙,09=隔离/worktree,10=面板前端,11=WS 协议。
>
> **本版(v3.1)吃掉的红队 blocker 一览**(详见对应章节):
> - RS-B1 注入防御 L4 沙箱出网未实测 → §7.3 + §22(M0 闸 T0.5b 五项硬门之一)
> - RS-B2 面板 XSS 威胁面缺失 → §7.6(输出转义 + CSP)
> - FEAS-2 M1 强核验无可读文件系统 → §8.2(M1 只读快照子集 + `ValidateContext`)
> - FEAS-7 M0 闸依赖 M1 未来产物 → §22(schema 体积两段闸)
> - ROC-B1 默认预算表对 stateless 范式误套超线性公式 → §4.4 + §14(regime 分叉)
> - resume 不省 token(事实地基 D)→ §4.4 全面建模
> - Message 权威定义缺失致跨稿漂移 → §2(以骨架 `blackboard.schema.ts` 为准)

---

## 目录

0. 摘要与愿景 · 1. 架构与进程模型 · 2. 黑板协议(权威类型) · 3. 引擎与四范式 · 4. 收敛与三重刹车 · 5. CLI 适配层 · 6. provider 配置与热切换 · 7. 密钥安全与内容防火墙 · 8. 文件隔离与 worktree · 9. Web 面板与 WS 协议 · 10. 技术栈与 monorepo · 11. 工程开发规范 · 12. 测试策略 · 13. 可观测性与错误码 · 14. 配置全集 schema · 15. 性能与背压 · 16. 评测台 · 17. 部署运维与合规 · 18. 插件化 DSL · 19. 本地 Fusion 评审团 · 20. 端到端时序 · 21. 术语表与不变量 · 22. M0 可行性闸 · 23. 里程碑路线图 M0–M5 · 24. 明细任务清单 · 25. 关键路径 · 26. 6–24 月远景 · 27. 代码骨架索引 · 28. 未决问题清单

## 0. 摘要与愿景

### 0.1 一句话定位

sylux 是一个**本地编排中枢(orchestrator)**:它本身不写代码、不改文件,只做**调度与裁判**。真正干活的是两个隔离运行的 CLI 工具(Claude Code 与 codex),中枢在它们之间当**结构化传话筒 + 流程裁判 + 刹车**,并通过 Web 实时面板让人类"观战 + 可暂停介入"。

愿景:把"两个强模型互相对抗/协作改代码"这件事,从"开两个终端手动复制粘贴"升级为"可配置范式、可实时观测、可安全刹车、可介入、可量化评测"的工程化系统。

### 0.2 核心理念(已锁定,不可推翻,只能细化)

1. **进程模型**:中枢(Node/TS)`spawn` 两个 CLI 子进程并接管 stdio;浏览器经 WebSocket 实时看"黑板"变化。中枢不让两 CLI 直接对喷。
2. **黑板(blackboard)**:所有沟通走结构化消息。消息含 `round/from/role/kind/body/files/evidence`。critic 角色的 `evidence` 强制必填且**必须可机器核验**(不是非空字符串就算数),空着或不可核验就打回——把"唱反调"焊死(见 §2.3 证据强度判据 I3)。
3. **引擎 + 可换剧本(playbook)**:四种范式(红蓝对抗 / 主从规划执行 / 对等结对 / 分工并行)底层是同一个循环,差异全部抽成可配置的 `Playbook` 接口。换打法只换 playbook 对象,引擎本体不动。**角色与模型解耦**——任意模型可指派任意角色。
4. **provider 可配置(硬需求)**:`base_url / key / model / wire_api` 必须软件层可配、可热换、可加新 provider;每 agent 一份 provider 配置。热换=重建 adapter,不改运行中进程。
5. **续接与省 token 是两件事(红队修正,决定性)**:`session/resume` 解决的是 **CLI 本地失忆**(进程退出后能接着聊),它**不会**减少发往第三方中转的 token。token 控制必须靠应用层主动做(增量摘要 / 历史裁剪 / 每轮只塞 delta + 旧轮压结论)。刹车预算按"每轮全量上下文累积"估,不按增量估(详见 §4.4)。
6. **本地 Fusion(远景)**:借鉴 OpenRouter Fusion 的 panel+judge —— 仅用于"决策回合"(出方案/评审),一个角色背后可站一个评审团多 provider 并行答 + 裁判综合;"执行回合"(改文件)严格保持单 agent + worktree 隔离(详见 §19)。

### 0.3 已确认环境事实(本机实测基线,PROBED-FACTS 摘要)

| 项 | 值 |
|---|---|
| 平台 | Windows 11 Home China,shell 主用 PowerShell |
| Node / npm | `v22.13.0` / `11.16.0` |
| git | `2.44.0.windows.1`(PATH:`C:\Program Files\Git`) |
| 工作目录 | `G:\sylux` |
| pnpm | 经 corepack 启用(不全局装) |
| codex CLI | `codex-cli 0.141.0`;真 exe 在 `G:\npm-global\...\codex-win32-x64\vendor\...\bin\codex.exe` |
| codex 中转 | mouubox(Sub2API):`base_url=https://api.mouubox.com`,`wire_api="responses"`,`model=gpt-5.5`,`model_reasoning_effort=xhigh` |
| Claude 端 | 本机 Claude Code;headless `claude -p`,支持 `--output-format stream-json`、`--resume`、`--json-schema`(内联串)、`--append-system-prompt`、`--no-session-persistence` |
| 包安装 | 官方 npm registry 本机极慢,一律走 `--registry https://registry.npmmirror.com` |

### 0.4 五条决定性实测结论(直接约束设计)

- **A. spawn 必须直调真 exe + prompt 走 stdin**:裸名/.cmd 都不行(`.cmd` 的 `%*` 打散带空格 prompt;裸 `codex` 是 bash shim 报 Win32 错)。Node 捕获 stdout 不经 shell `>` 重定向(否则 UTF-8→UTF-16 乱码)。
- **B. codex 事件流首行即 `thread.started.thread_id`**,是 sessionId 来源;最终文本在 `item.completed.item.text`;usage 取 `turn.completed.usage`。
- **C. output-schema 经中转可强制成形**(codex 收文件,claude 收内联串——两端不对称),但仍须应用层 `safeParse` 兜底重发 ≤N → `OUTPUT_SCHEMA_VIOLATION`。
- **D. resume 不省 token,累积/超线性**:同 thread round1=18755→round2=37645(≈翻倍)。N 轮总成本 ≈ base×(1+2+…+N)。基线底价 ≈18.7k input/回合。刹车预算按累积估。
- **E. codex exec resume 参数集与 exec 不同**:拒 `-s`/`-C`,需 `--skip-git-repo-check`,SESSION_ID/PROMPT 为位置参。沙箱/工作目录在首轮 exec 定好,resume 继承。

---

## 1. 架构与进程模型

### 1.1 顶层组件图

```
┌─────────────────────────────────────────────────────────────────┐
│                         浏览器(观战 + 控制)                       │
│   React + Vite 面板:对话气泡 / 轮数 / evidence 预览·diff / 刹车   │
└───────────────────────────────▲───────────────────────────────────┘
                    WS(127.0.0.1 only,Origin 白名单 + 一次性 ticket)
┌───────────────────────────────┴───────────────────────────────────┐
│                      sylux 中枢(Node/TS,@sylux/server)            │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────────────┐ │
│  │  WS Hub +     │   │   引擎 runEngine │   │  Blackboard(投影 +   │ │
│  │  REST + 鉴权   │◀─▶│   (范式无关循环) │◀─▶│  jsonl append-only)  │ │
│  └──────────────┘   └────────┬────────┘   └──────────────────────┘ │
│                              │  Playbook(红蓝/主从/对等/并行)        │
│                              │  StopPolicy(三重刹车 + done)          │
│                     ┌────────┴────────┐                             │
│                     │  AgentAdapter ×2 │  内容防火墙 / env 白名单      │
│                     └───┬─────────┬───┘                             │
└─────────────────────────┼─────────┼─────────────────────────────────┘
       spawn 真 exe + stdin│         │spawn 真 exe + stdin
              ┌────────────▼──┐   ┌──▼─────────────┐
              │  codex.exe     │   │  claude.exe    │
              │ (worktree A)   │   │ (worktree B)   │
              └───────┬────────┘   └────────┬───────┘
                   mouubox 中转            anthropic 官方/中转
```

### 1.2 进程模型与隔离边界

- **中枢单进程**(`@sylux/server`):持有 Blackboard、引擎循环、WS Hub、两个 `AgentAdapter`。中枢自身**不执行任务代码**,只调度。
- **两 CLI 子进程**:各自由 `AgentAdapter` 经 `child_process.spawn` 直调真 exe 拉起,prompt 走 stdin,各写各的 worktree(M3+),运行期无锁。
- **A8 不变量**:同一 adapter 任一时刻至多一个子进程在飞;并发 run 抛错而非排队。
- **浏览器**:纯观战 + 控制端,经 WS 看黑板增量;**控制权(pause/inject/abort)需 `scope:'control'` 的连接**(§9)。

### 1.3 一个循环、四种打法(锁定决策 §3 的落地)

引擎主循环 `runEngine`(骨架 `core/engine.ts`,权威设计 03)是**范式无关**的:它反复问 playbook 三件事——`nextTurn`(谁发言/扮谁/看什么)、`shouldMergeAt`(本轮末是否合并 worktree)、`isDone`(范式特定完成门),自己只忠实执行 + 守门 + 轮末统一裁决刹车,**绝不内置范式逻辑**。

内核七不变量(03 §0.2,引擎实现焊死):

| 编号 | 不变量 | 落点 |
|---|---|---|
| E1 | 角色 ⊥ 模型(任意模型可扮任意角色) | `TurnDirective.agent` 覆盖 `assignment` 默认查表 |
| E2 | 未校验不入黑板 | `Blackboard.append` 只接受过 `validateMessage` 的产出 |
| E3 | 只喂增量(delta) | `PromptContext.delta` 仅含对面上一条 + orchestrator system |
| E4 | stall ⊥ done(解耦) | `ConvergencePolicy` 与 `DonePolicy` 独立,经 `CompositeStopPolicy` 聚合 |
| E5 | 合并冲突硬停(不选边) | `mergeRound` 冲突→回灌 evidence + `paused`,人工裁决 |
| E6 | 刹车统一轮末(无前置刹车) | 每轮末 `update(ctx)` 再 `shouldStop(ctx)` |
| E7 | 失败不静默 | 任何异常显式落终态 + 错误码,不吞 |

### 1.4 控制流时序(单轮)

```
runEngine 主循环(每轮):
  1. plan = playbook.nextTurn(board.view())        // 谁/扮谁/看什么;空 turns→EMPTY_ROUND_PLAN
  2. 执行 turns:serial→逐个 await / parallel→Promise.all
       每个 turn = runTurn:渲染 prompt(delta 过防火墙)→选 send/resume
                  →消费事件流→safeParse→validateMessage→打回重试 ≤N
  3. 成功 turn 写黑板(append 盖章 id/seq/ts);失败 turn 已落 system 消息
  4. 致命失败(spawn 不可恢复/重试耗尽)→ finalize(aborted)
  5. worktreesEnabled && shouldMergeAt → mergeRound;冲突→回灌+paused
  6. closeRound(round)                              // 落指纹集合 + usage(刹车前,顺序铁律)
  7. stopPolicy.update(ctx); decision=shouldStop(ctx)  // 统一裁决
       decision.shouldStop → 写 system(刹车原因)+ finalize(终态)
  8. round += 1
```

## 2. 黑板协议(权威类型)

> **本章是全项目类型契约的唯一权威**(I1)。物理落点 `@sylux/shared/src/blackboard.schema.ts`(三位一体:zod 编译期类型 + 运行期 `safeParse` + `zod-to-json-schema` 喂 CLI output-schema)。其它章节涉及这些类型时只引用本章,禁止另写。下方代码块是骨架的精确摘录,改契约 = 改这一个文件,三处自动同步。

### 2.1 版本常量与资源上限

```ts
export const SCHEMA_VERSION = 1 as const;
export const MAX_MESSAGE_BYTES = 262_144 as const;      // 256 KiB,单条 message append 前 size 闸
export const MAX_JSONL_LINE_BYTES = 524_288 as const;   // ★512 KiB(权威值,06 等只 import 不重声明)
export const MAX_FINGERPRINTS_PER_ROUND = 4096 as const;
```

> **吃掉 x-consistency B1**:`MAX_JSONL_LINE_BYTES` 权威值 **512 KiB** 定于本章(`blackboard.schema.ts`)。05/06 等一律 `import`,不得重声明为 1 MiB 或自称权威。

### 2.2 基础枚举(Message 判别字段)

```ts
roleSchema     = z.enum(['planner','worker','proposer','critic','peer','arbiter'])
messageKindSchema = z.enum(['propose','critique','plan','implement','review','ack','question','done','system'])
agentIdSchema  = z.enum(['codex','claude','human','orchestrator'])
```

### 2.3 Evidence —— 焊死"唱反调"的核心

证据是**结构化、带可机器核验锚点**的数组,三种锚点用 `discriminatedUnion('kind')` 区分。核心原则 **I3:证据强度由"中枢能否独立复算"决定,与 agent 自报无关**。

```ts
evidenceItemSchema = z.discriminatedUnion('kind', [
  // ① 代码锚点:worktree 内文件行区间。contentHash 由中枢核验时派生回填(I7),agent 填了也被覆盖。
  { kind:'file_ref', path, lineStart, lineEnd, quote?, contentHash?, note? },
  // ② 命令证据:可复现命令 + 期望/实际。未被中枢实跑前,actual 只是自报,强度=weak。
  { kind:'command', cmd, expected, actual, matchMode:'equals'|'contains'|'regex', exitCode? },
  // ③ 规范引用:指向需求/规格的引文。
  { kind:'spec_quote', source, quote, locator? },
])
```

**强度三态(`VerifyResult`,验证在入黑板时做)**:
- `pass`(强)= 中枢独立复算通过(file_ref 重读区间归一化比对 quote 相符;command 沙箱实跑匹配)。
- `weak` = 仅定位 / 自报 / 无核验能力 / 基础设施故障(无 quote 的 file_ref、未实跑 command、spec_quote)。
- `fail` = 复算不符 / 区间越界 / 命令不安全。

> **吃掉 x-consistency E11/COV-10(全仓"强/中"旧二档残留)**:门槛统一为 **`role==='critic'` 或 `kind==='critique'` 或 ack(done) 必须 ≥1 条 `pass`(强)证据**;`weak` 不解锁。全文不再出现"强/中"二档措辞。

### 2.4 Message —— 黑板消息(唯一 z.object 定义)

```ts
messageSchema = z.object({
  id, runId,                          // 中枢盖章
  round: int>=0,                      // 轮次,从 0 单调递增
  seq: int>=0,                        // ★中枢单调序号:排序/回放/收敛差集的唯一权威键(I6),ts 仅供人读
  from: agentIdSchema,                // 物理发言主体
  role: roleSchema,                   // 本条扮演角色(与 from 正交)
  kind: messageKindSchema,
  body: z.string().max(65536),        // ⚠ agent 可控不可信:面板渲染必 escape + CSP(§7.6)
  files: filePatchSchema[] .max(256), // 文件改动声明(diff 正文由中枢从 worktree 生成,非 agent 自填)
  evidence: evidenceItemSchema[] .max(128),
  ts: int>=0,                         // 服务端写入时戳(中枢盖,禁用于排序)
  inReplyTo?: string,                 // 对话树 / 收敛锚点
})
```

**关键不变量**:
- **I6 seq 单调**:同 run 内严格 +1 无洞,是排序/回放/收敛差集权威键;并行范式同轮多条靠 seq 区分。
- **I7 中枢盖章**:`id/runId/round/seq/from/role/ts` 全由中枢 `append` 时补,agent 不产出 → 无法伪造身份/时间/轮次。

### 2.5 适配层边界 schema(agent 产出瘦子集)

```ts
agentMessagePayloadSchema = z.object({ kind, body, files, evidence, inReplyTo? })
// CLI 经 output-schema/json-schema 只产出这 5 个字段;其余由中枢盖章。
buildAgentOutputJsonSchema(): // zodToJsonSchema(payload, {$refStrategy:'none', target:'jsonSchema7'})
                              // 摊平 $ref 规避两端解析差异 + 内联体积可控
```

> **【待实测·H7】**:严格 structured-output 后端对 `discriminatedUnion`(→anyOf)+ optional 字段支持参差;若被拒,适配层走退化方案(nullable+required / 摊平单 object / 宽 schema+safeParse)。退化只改 JSON Schema 形状,不改 TS 类型(M0 P3 探针验证)。

### 2.6 AgentEvent —— 适配层向引擎吐的事件流

```ts
agentEventSchema = z.discriminatedUnion('kind', [
  { kind:'session_started', sessionId },   // ★I5:恒为首事件;拿到前不得标 resumable
  { kind:'delta', text },                   // 流式增量(透传面板)
  { kind:'tool_call', name, args },         // 工具调用(透传面板)
  { kind:'final_message', raw, usage? },    // 最终 JSON 文本(待 safeParse);usage 取 turn.completed.usage
  { kind:'error', code, detail },           // spawn 失败 / schema 违例 / 进程崩溃
])
tokenUsageSchema = { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
```

> **I5(事实地基 B 焊死)**:`session_started` 必为首事件(codex 映射 `thread.started.thread_id`,claude 映射其 session id)。中枢拿到它之前不得标 agent 可 resume。唯一例外:首事件即 `error`(spawn 失败)。

### 2.7 Round / BoardState / RunStatus

```ts
roundSchema = { index, messageIds[](按 seq 升序), evidenceFingerprints[], usage?, startedAt, endedAt? }
runStatusSchema = z.enum(['running','paused','done','stalled','aborted','limit'])
boardStateSchema = { runId, playbookId, status, currentRound, rounds[], messages[],
                     agents: Record<agentId,{sessionId?,resumable}>, totalUsage?, createdAt, updatedAt, schemaVersion }
```

**状态转移矩阵**(`isValidStatusTransition` 守卫,非法转移抛 `ENGINE_FATAL`):

| from \ to | running | paused | done | stalled | aborted | limit |
|---|---|---|---|---|---|---|
| (init) | ✓ | | | | | |
| running | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| paused | ✓ | — | | | ✓ | |
| 终态(done/stalled/aborted/limit) | 冻结,任何后续 status_changed 非法(回放丢弃 + 告警) |

### 2.8 jsonl 持久化(append-only,单一事实源)

每 run 一份 `runs/<runId>.jsonl`,每行一个 `jsonlRecordSchema`(判别键 `recordType`):`run_started` / `message` / `round_closed` / `status_changed`(带机读 `code?`)/ `agent_session`。**BoardState 不独立落盘,由行日志投影**(§7.3 崩溃恢复:末行残缺自动截断,中间损坏计 `corruptLines` 告警)。

### 2.9 指纹与内容哈希(收敛差集地基)

`@sylux/shared/fingerprint.ts` 权威(算法即契约,改动须 `SCHEMA_VERSION+1`):

- `normalizeContent`:CRLF/CR→LF + 去行尾空白 + 去首尾空行(**Windows 必需**,否则跨平台同区间算出不同 hash)。
- `contentHash(text)` = `sha256(normalize(text)).slice(0,16)`。中枢对**重读的真实区间**算,非 agent 自算。
- `fingerprint(e)`:
  - `file_ref` → `f:{path}:{lineStart}-{lineEnd}:{contentHash | ?}`(未核验留 `:?` 占位)。
  - `command` → `c:{hash(cmd)}:{hash(expected)}:{matchMode}` ——**绝不含 actual**(焊死 R5/H2:否则对抗 agent 每轮回填不同 actual 即得新指纹,无限拖住 stall)。
  - `spec_quote` → `s:{hash(source)}:{hash(normalize(quote))}`(弱指纹)。
- **指纹常量导出(吃 FEAS-6)**:`FP_PREFIX_FILEREF='f:'` / `FP_PREFIX_SPEC='s:'` / `FP_PREFIX_CMD='c:'` / `FP_SUFFIX_UNVERIFIED=':?'` + 谓词 `isUnverifiedFp`/`isSpecFp`,供 §4 收敛 import(非裸 `startsWith`/`endsWith`)——格式改一处,收敛自动跟随。

### 2.10 守门函数 validateMessage(唯一入口 I2)

`@sylux/shared/validate.ts`。任何子进程产出进引擎前必经此关。两阶段:

- **阶段 A**(纯结构,无副作用):`messageSchema.safeParse` + 跨字段(C4 行区间、C5 rename 必填 renamedFrom、C7 system 必 orchestrator、C9 orchestrator 只发 system)+ C6 路径白名单 + C8 inReplyTo 悬空。
- **阶段 B**(需中枢上下文):`role==='critic' || kind==='critique' || isAckOfDone` 时,evidence 非空且 `≥1` 条 `verifyEvidence===pass`,否则 `EVIDENCE_REQUIRED` / `EVIDENCE_UNVERIFIABLE`。

`ValidateContext.capabilities.{fs,sandbox}`(吃 FEAS-2):M1 红蓝纯决策态有**只读快照**→`fs=true`(file_ref 可强核验),`sandbox=false`(command 一律 weak)。`runCommandSandboxed` 返回三态:`ok`(复算)/`unsafe`(→fail,`EVIDENCE_COMMAND_UNSAFE`)/`infra`(→weak,中枢侧故障**不连坐 critic**,`EVIDENCE_INFRA_DEGRADED`,吃 COV-3)。

## 3. 引擎与四范式

### 3.1 Playbook 接口(可换剧本契约)

`@sylux/core/playbook.ts`(权威设计 03 §3)。"换打法只换 playbook 对象,引擎本体不动"是硬指标。

```ts
interface Playbook {
  readonly id: 'red-blue'|'master-worker'|'pair'|'parallel';
  readonly name: string;
  readonly assignment: Partial<Record<Role, AgentId>>;   // 角色→agent 默认查表(P3,TurnDirective.agent 可覆盖)
  readonly params: PlaybookParams;                       // 刹车阈值由 §4 消费
  onStart(deps: EngineDeps): Promise<void>;              // 注入目标 + 初始化范式状态
  nextTurn(board: BoardView): RoundPlan;                 // ★核心:谁发言/扮谁/看什么(无前置刹车)
  shouldMergeAt(round, board): boolean;                  // 该轮末是否合并 worktree
  isDone(board: BoardView): boolean;                     // 范式特定完成门(经 PlaybookDonePolicy 注入,与通用 DonePolicy 互补)
  onFinish(status, board): Promise<void>;
}
interface PlaybookParams {
  maxRounds; convergenceWindow; tokenBudget; perTurnContextCap;
  sandboxCeiling: 'read-only'|'workspace-write';        // 绝不可设 danger(§7.7 封顶)
  defaultContinuity: 'stateless'|'resume';
  retryOnReject;                                         // schema/evidence 打回重发上限(默认 3)
  maxResumeChain;                                        // ★H7:单 agent 连续 resume 上限,达上限强制降级 stateless(事实 D 累积爆点护栏)
}
```

`RoundPlan = { turns: TurnDirective[], execution:'serial'|'parallel', phaseHint?, stallEligible? }`。
`TurnDirective = { agent, role, kindHint, promptContext }`。

> **吃掉 x-consistency E1/E6/E8(v1 词汇传导)**:全文不再出现 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult`/`planRound`/`TurnSpec`/`firewall.wrap`/`contextFor`/`PLAYBOOK_DONE`。终止判定统一由 §4 `CompositeStopPolicy` 拥有;playbook 只经 `isDone` 提供范式门(无前置刹车,E6/H1)。

### 3.2 省 token 的核心:PromptContext 与 continuity

```ts
type ContinuityMode = 'stateless' | 'resume';
interface PromptContext {
  continuity;            // stateless:每轮全新会话,prompt=goal+digest+delta(成本对轮数近似平);resume:续接(成本累积超线性,受 maxResumeChain 封顶)
  goal; digest;          // digest=旧轮压结论(DigestBuilder 产);delta=本轮增量(对面上一条 + orchestrator system)
  delta: Message[];      // 喂前每条 body/evidence 过 firewallPeerMessage(§7)
  roleBrief;             // 角色指令(orchestrator 自撰可信文本,不过 firewall)
  expectedKind; contextCap;
}
```

**DigestBuilder 基线(吃 FEAS-4,M1 可落地,算法钉死在 03,停止 03↔17 互相 punt)**:`buildDigestBaseline` 确定性、无 LLM、无注入面——只取 ① 结构化 evidence 锚点(`file_ref`/`command`/`spec_quote` 的结构化字段,绝不取自由 body)+ ② 末 N 条决策的自方一句话结论锚(`forAgent` 限定时只取自方)。故 `bypassFirewall:true` 在所有范式下都安全。高质量实现(精确分词、LLM 摘要)归性能 §15,接口不变。

> **连续性验收(吃 FEAS-4)**:M1 验收要求 **≥3 轮**(2 轮会被"最近 K 轮全文"兜过去掩盖 digest 失忆);第 3 轮 PromptContext 仍含第 1 轮 proposal 的 evidence 锚点,agent 不重复已被驳回的方案。

### 3.3 runTurn(单次发言,失败路径齐全)

```
runTurn(directive, round, deps, params):
  1. 渲染 prompt:delta 每条过 firewallPeerMessage;全 block→落 system(INJECTION_BLOCKED,非致命)
  2. 装配 AgentInput:prompt + outputSchema(对象) + workdir + sandbox(封顶 workspace-write)
                    + providerEnv(buildChildEnv 出口,含 key) + providerOverrides(绝不含 key) + ephemeral + timeoutMs?
  3. H7 护栏:wantResume && resumeChainLength>=maxResumeChain → 强制降级 stateless+digest
  4. while attempt<=retryOnReject:
       stream = useResume ? adapter.resume(sid,input) : adapter.send(input)
       consume(stream):归三类
         spawn_failed(闸门前,无 session_started)→ 首轮致命 / 非首轮降级 stateless 重来
         crashed_after_gate(已 session_started)→ 可 resume 重试(非致命)
         parsed → safeParse + validateMessage(桥接 02 §8,H12)
       validate.ok → 返回 payload + usage
       可重试码(OUTPUT_SCHEMA_VIOLATION/EVIDENCE_REQUIRED/EVIDENCE_UNVERIFIABLE)→ 回灌打回原因(经边界标记防二次注入)重试
       不可重试(路径越界/悬空 inReplyTo/system 伪造)→ 落 system,计无效发言,非致命
```

usage 直接取 `final_message.usage`(源自 `turn.completed.usage`,中转回吐可靠),不本地估算。

### 3.4 四范式(同接口,差异在 nextTurn)

| 范式 | 角色循环 | continuity | 合并 | 完成门 | stall 资格 |
|---|---|---|---|---|---|
| **red-blue** 红蓝对抗 | 偶轮 proposer 出/改方案,奇轮 critic 带证据追打 | stateless(长程辩论 resume 会爆) | M3:每轮可合 | 通用 DonePolicy(done+对面带证据 ack),`isDone` 恒 false | 全轮 `stallEligible:true` |
| **master-worker** 主从 | planner 派活 → worker implement → planner review | 子任务内强耦合少数轮可 resume(受 maxResumeChain 封顶) | review 通过收口 | `isDone`=子任务清单全 accept | 派活/review 复用旧锚点轮 `stallEligible:false`(吃 FEAS-5) |
| **pair** 对等结对 | 两 peer 交替补强同一方案 | stateless | 每轮可合 | done+对面带证据 ack | 对抗类 true |
| **parallel** 分工并行 | N agent 同轮并发各写各 worktree | stateless | 仅收口轮合并(轮末 3-way) | `isDone`=全 lane done(无 ack) | 全程 `stallEligible:false`,靠 maxRounds + 收口兜底(吃 FEAS-5) |

> **吃掉 FEAS-3(红蓝写文件行为冲突)**:M1 红蓝是**纯决策回合**——`shouldMergeAt=false`,proposer 不声明 `files`,critic 只读引用证据。03 §7.1 的"proposer files 声明改动意图 + shouldMergeAt=true"属 **M3 写文件档**,M1 不启用。Fusion 边界同步收紧:凡声明非空 `files`/`shouldMergeAt` 的发言即禁 panel(§19),避免静默清空 proposer 改动意图。

### 3.5 EngineDeps(引擎依赖契约,装配层注入)

```ts
interface EngineDeps {
  blackboard; adapters: Partial<Record<AgentId,AgentAdapter>>;
  stopPolicy: StopPolicy;             // CompositeStopPolicy(§4),引擎每轮末调一次,不感知内部几条刹车
  firewall: (msg)=>FirewallResult;    // 内容防火墙纯函数(§7)
  worktrees: WorktreeManager; worktreesEnabled: boolean;  // ★H16:M1=false,mergeRound no-op,files 仅意图声明
  validate: (cand:AppendInput, round)=>ValidateResult;    // 02 §8 桥接(H12)
  digest: DigestBuilder; agentRuntime: AgentRuntimeResolver;  // workdir/providerEnv/sandbox/ephemeral 解析
  logger: Logger; runGoal: string;
}
```

---

## 4. 收敛与三重刹车

> 权威实现 `@sylux/core/stop-policy.ts`(设计 04 v3)。引擎只**注入、只调用**:每轮末 `update(ctx)` 再 `shouldStop(ctx)`(顺序铁律,必在 `closeRound` 之后)。所有刹车统一聚合进 `CompositeStopPolicy`。

### 4.1 StopPolicy 接口与裁决

```ts
interface StopPolicy {
  readonly id: string;
  update(ctx: StopContext): void;     // 推进内部状态(纯状态机,幂等:同 round 重复 update 不重复累加)
  shouldStop(ctx): StopDecision;      // 纯读裁决,必在 update 之后
  reset?(rounds): void;               // 回放/崩溃恢复重建状态
  reconfigure?(patch): void;          // ★S12:只改阈值,绝不触碰累积状态(seen/emptyStreak)
}
StopDecision = { shouldStop, status?:'done'|'stalled'|'limit'|'aborted', code?, reason?, metrics? }
// ★S8/H-INJ:reason 只用枚举值/数字/中枢常量模板,绝不内插 agent 可控自由文本(防注入/日志投毒)
```

### 4.2 三重刹车 + 成功出口

| Policy | id | 触发 | 终态 | 错误码 |
|---|---|---|---|---|
| **MaxRoundsPolicy** | max-rounds | `round+1 >= maxRounds`(确定性最后防线,永远在场) | limit | `ROUND_LIMIT_EXCEEDED` |
| **ConvergencePolicy** | convergence | 连续 `stallWindow` 轮无新强指纹 | stalled | `CONVERGENCE_STALL` |
| **BudgetPolicy** | budget | 累积 token/费用触顶 + 前瞻外推 | limit | `TOKEN_BUDGET_EXCEEDED` |
| **DonePolicy** | done | done + 对面带证据 ack(跨轮配对) | done | (成功出口无码) |
| **PlaybookDonePolicy** | playbook-done | `playbook.isDone`(范式门) | done | — |

`CompositeStopPolicy` 聚合:① 先**无条件 update 全部**子 policy(不短路,保证 stall 计数不漏更新);② 后按优先级裁决(`done:0 < aborted:1 < limit:2 < stalled:3`,成功出口优于任何安全网终止),并发触发塞 `metrics.coFired` 审计。

### 4.3 收敛检测(evidence 指纹差集,焊死 R5)

```ts
class ConvergencePolicy {
  seen: Set<string>;          // 历史全部强指纹(差集被减数)
  emptyStreak; lastUpdatedRound;
  update(ctx):
    if ctx.round <= lastUpdatedRound: return       // 幂等护栏
    incoming = filterFingerprints(round.evidenceFingerprints)  // 剔 s: 弱指纹 + :? 未核验占位(requireVerifiedProgress)
    本轮新强指纹 = incoming \ seen;真实强指纹无论冻结都并入 seen
    if !roundEvidenceExpected || roundVerificationDegraded: return  // ★S9 冻结(不累加不清零),恢复后续算
    if round < minActiveRounds: emptyStreak=0       // 开场宽限
    elif hasNew: emptyStreak=0 else: emptyStreak+=1
}
```

> **吃掉 FEAS-5(master-worker/parallel 合法空证据轮误杀)**:`StopContext.roundEvidenceExpected`(来自 `RoundPlan.stallEligible`)为 false 的轮(派活/同步/review 复用旧锚点)**冻结** stall 计数。`requireVerifiedProgress=true`(默认):只有核验通过的强指纹清零计数——否则对抗 agent 每轮换区间产 `:?` 占位指纹即架空收敛。
>
> **M3 按范式分化(吃 FEAS-5 核心反例)**:辩论型(red-blue/pair)用强指纹差集 stall;状态机型(master-worker/parallel)主信号改"done 收口",指纹 stall 仅辅助且 `stallWindow` 显著放大,planner 派活轮/review 复用轮按 role/kind 豁免。

### 4.4 成本模型(事实地基 D:累积/超线性,实测优先外推)

**基线常量**:`BASELINE_INPUT_PER_ROUND=18_700`(事实 D 底价);`BASELINE_OUTPUT_PER_ROUND=3_000`(★吃 ROC-M1:output 缺失绝不当 0,否则 reasoning 模型 maxCostUsd 失明)。

**`floorUsage` 双侧地板**:input 与 output 都按轮数兜底,杜绝半兜底。`usageToUsd` 按 provider `TokenPricing` 折算(非缓存 input + cached + output 分价)。

**前瞻刹车(实测优先,不假设 regime,吃 H-B3)**:
```
predictNextRoundInputTokens(series, base):
  n>=2 → Δ=max(0,last-prev); predicted=max(last+Δ, base)
         // stateless:Δ≈0→近似平;resume:Δ≈base→超线性,自动从实测数据涌现
  n==1 → max(last, base);  n==0 → base
```
每轮末 `projectedTokens = totalTokens + predicted×lookaheadFactor`,会超则提前停,不启动注定超预算的下一轮。

> **吃掉 ROC-B1(blocker:默认预算表误套超线性)**:**stateless 默认范式(red-blue/pair/parallel)的 `tokenBudget` 按线性口径配**(≈ c×N,如红蓝 600k=12 轮余量),**绝不**套 resume 超线性 `base×N(N+1)/2`(那会得 808k,比线性目标 225k 大 3.6×,使前瞻刹车形同虚设)。配置层 §14 默认表**按 regime 分叉**(对账 18 §6.4 `estimateRunTokens`),M5 评测台开工前 §14 必须改对。
>
> **吃掉 ROC-M2(热换承诺做不到)**:`reconfigure` 只改阈值不动累积计数器(S12)。`buildStopPolicy` 只在 run 启动调一次,之后阈值变化走 `composite.reconfigure`,**绝不重建**(否则丢 stall 计数)。

### 4.5 扇出前瞻(panel 并发预算,吃 RS-M5)

`BudgetPolicy.preflightFanout(ctx, plannedMembers, perMemberTokensHint?)`:在并发 spawn N 个 turn **之前**判扇出会不会跨预算。单成员成本上界取 `max(hint, maxTurnTokens, 实测外推)`;超预算返回 `maxSafeMembers` 供引擎**降并发而非硬停**。配合单 `turn` token 硬上限 `maxTurnTokens`(runTurn 内强制,超则杀该 turn)——否则 panel 单轮并发 N 成员一轮即超支 N 倍才停。

## 5. CLI 适配层(codex + claude)

> `@sylux/agents`,权威设计 05(codex)/06(claude)。把两个形态高度不对称的 CLI 封装成同一 `AgentAdapter`,中枢只看 `send/resume/cancel` + 一条 `AsyncIterable<AgentEvent>`。

### 5.1 统一接口与不变量

```ts
interface AgentAdapter {
  readonly id: AgentId;
  send(input: AgentInput): AsyncIterable<AgentEvent>;            // 首轮:spawn 全新会话
  resume(sessionId, input): AsyncIterable<AgentEvent>;          // 续接:进流即凭 sessionId 预置 session_started(A9,不赌 CLI 重发首行)
  cancel(): Promise<void>;                                       // 杀进程树(幂等);被取消流以 error(SUBPROCESS_CANCELLED) 收尾
}
interface AgentInput {
  prompt;                          // 已过防火墙、只含 delta(走 stdin,不进 argv,A3)
  outputSchema: Record<string,unknown>;   // 传对象!"codex 写文件 / claude 内联"落点不对称吃进适配器内部
  workdir; sandbox; providerEnv; providerOverrides; timeoutMs?; ephemeral?;
  appendSystemPrompt?; effort?; maxTurns?;  // claude 专属,codex 忽略
}
```

接口层九不变量(05 §0.3):A1 首事件恒 session_started;A2 未拿到 id 不伪造 session_started 只 emit error;A3 直调真 exe + prompt 走 stdin;A4 key 永不进 argv(spawn 前 `assertArgvNoSecret` 硬闸);A5 env 单一出口 `buildChildEnv`(`extendEnv:false`);A6 输出必过 safeParse(引擎做,适配器只吐 raw+usage);A7 ephemeral ⊥ resume;A8 同一 adapter 至多一个子进程在飞;A9 resume 预置 sessionId。

### 5.2 工厂签名(构造期注入 provider + keystore,吃 x-consistency D9/D10)

```ts
interface CreateCodexAdapterOptions { exePath?; provider: ProviderConfig; keystore: KeyStore; hardTimeoutCeilingMs?; }
type CreateCodexAdapter = (opts) => AgentAdapter;   // claude 对称
```

> 焊死 D9/D10:`toCodexInjection(cfg, keystore, ov?)` 三参(merge 内置,见 §6);`createCodexAdapter` 构造期注入 keystore,**不在 send 时拼 key**。

### 5.3 两端不对称对照表(M0 产出基准,适配层实现地基)

| 维度 | codex | claude |
|---|---|---|
| 启动 | 真 exe + `exec --json --skip-git-repo-check -s <mode> -` (prompt 走 stdin) | 真 exe + `-p --output-format stream-json` (prompt 走 stdin) |
| sessionId | `thread.started.thread_id`(首行) | `system.init.session_id`(事件流)【待 M0 P1 确认 `--session-id` 预设能力】 |
| output-schema | `--output-schema <FILE>`(文件) | `--json-schema <内联串>`(≈32KB 上限;超限退 stream-json 输入)【M0 P2 实测体积】 |
| resume | `exec resume [SID] [PROMPT]`,拒 `-s`/`-C`,需 `--skip-git-repo-check`(事实 E) | `--resume`/`--continue`/`--fork-session` |
| 系统提示 | 无直接等价(靠 prompt / AGENTS.md) | `--append-system-prompt` |
| ephemeral | `--ephemeral` | `--no-session-persistence` |
| usage | `turn.completed.usage`(下划线命名,归一驼峰) | 事件流 usage 字段【M0 P6 定位 + 归一】 |
| kill | 已知需进程树 kill | 【M0 P5:能否杀穿 .ps1/.cmd shim 背后 node】 |

### 5.4 崩溃分类(H4 闸门铁律)

`consume` 把事件流归三类:`spawn_failed`(闸门前,从未 session_started,**不可 resume**)/ `crashed_after_gate`(已 session_started 但中途断,**可 resume**)/ `parsed`(正常 final_message)。这决定失败后能否续接——绝不在闸门前伪造可 resume(A1/A2,焊死 I5)。

---

## 6. provider 配置与热切换

> `@sylux/providers`,权威设计 07。目标(锁定决策 §4):`base_url/key/model/wire_api` 软件层可配、可热换、可加新 provider,每 agent 一份。

### 6.1 密钥引用模型(key 只存名字,焊死 R8)

配置里**绝不存 key 值,只存引用名**(`${env:NAME}` 或 keystore ref)。真实值经 `KeyStore` 在 spawn 时解析进子进程 env。解析失败抛 `PROVIDER_CONFIG_INVALID`,detail 脱敏。

### 6.2 ProviderConfig(每 agent 一份)

```ts
ProviderConfig = {
  providerName; baseUrl; wireApi:'responses'|'chat'; model; keyRef;   // keyRef 是名字,非值
  fallbackModel?; extraConfig?: Record<string,string>;               // extraConfig 硬化常量白名单(V7)
  _codexHome?;                                                        // 会话隔离(避免 auth.json 串号),路径安全校验(V15/RS-M4)
}
ProviderOverrides = { baseUrl?; wireApi?; model?; providerName?; fallbackModel?; extraConfig? }  // 运行期非密覆盖,绝不含 key(A4)
```

### 6.3 注入翻译(key 走 env,绝不进 argv)

- **`toCodexInjection(cfg, keystore, ov?)`**:key → `OPENAI_API_KEY`(env)或 `auth.json`;base_url/model/wire_api 走 `-c key=value`(**不含 key**);三参在内部 merge override。
- **`toClaudeInjection(cfg, keystore, ov?)`**:provider 走 env,model 走 `--model` flag。
- **`buildChildEnv`**(规则属安全 §7,本节给消费形状):env 单一出口 + 白名单 + `extendEnv:false`。

### 6.4 ProviderRegistry(注册 / 热切 / 健康探测 / failover)

- **热换 = 重建 adapter(P4)**,不改运行中进程:只影响**下一轮** spawn。新增 provider 仅追加配置过 zod 校验,无需改码。
- **健康探测 + failover**:base_url 不可达 → 切候选;耗尽抛 `PROVIDER_UNAVAILABLE`。探测**有成本上界**(V6)+ 抖动防护(V11,AIMD 降并发只降触发 429 的端点,按 provider 端点分池,吃 ROC-m3)。
- **会话隔离**:每 agent/provider 独立 `CODEX_HOME` 避免 auth.json 串号。

### 6.5 resume 成本不对称(影响 provider 选择,事实 D)

codex resume 累积全价(超线性);claude resume 走 prompt 缓存折价更低。成本模型分端(§4.4),刹车按累积估。长程辩论默认 stateless 即源于此。

---

## 7. 密钥安全与内容防火墙

> `@sylux/security`(落点裁决见 §10.2,吃 D15),权威设计 08。三道闸:① 密钥防泄漏全链路;② 内容防火墙(agent 间提示注入);③ WS/控制面安全。

### 7.1 信任边界与威胁模型

信任分级:中枢(可信)> 人类介入(半信)> agent 输出(**不可信数据,非指令**)> 浏览器控制端(凭 token 提权)。STRIDE 威胁:凭证泄漏、提示注入=RCE、面板 XSS、WS 跨源劫持、源码出境、沙箱提权。

### 7.2 闸①·密钥防泄漏(R8 焊死)

- **key 生死通路**:配置存 ref → `KeyStore` 解析 → `buildChildEnv`(白名单 + `extendEnv:false`)→ spawn 子进程 env。**绝不**进 argv/`-c`/落盘配置/日志。
- **`assertArgvNoSecret`**:spawn 前预扫描 argv,命中 `sk-`/长 base64 → 抛 `PROVIDER_CONFIG_INVALID`。
- **env 白名单**:codex 子进程拿不到 `ANTHROPIC_*`,claude 拿不到 `OPENAI_*`(断言测试 M1·T1.12)。
- **`SECRET_SIGNATURES`**:密钥特征签名集(本文权威,焊死 R1)。
- **`redact` 单一出口**:所有出境通路(日志/WS/worktree 拷贝/错误 detail)过脱敏。
- **流式跨帧 redact(★v3.1,吃 RS-M1)**:stream-json delta 帧带**状态缓冲**,跨帧拼接后再扫 `sk-ant-`/`sk-`/长 base64 整体打码——否则密钥被切成两 delta 各自不匹配,明文广播给 spectator 后前端拼回。`diff_chunk` 跨 `seqInRef` 同理。

### 7.3 闸②·内容防火墙(RCE 拦截核心)

威胁本质:**codex 输出被当成 claude 的指令执行**。防御纵深四层(不靠单点):

- **L1 边界标记包裹**:`firewallPeerMessage(msg)` 返回 `{action:'pass'|'flag'|'block', wrapped}`;peer 内容包 `<<<SYLUX_PEER_DATA…>>>` 封套(权威格式,纯函数,吃 x-consistency E5——不再用 `firewall.wrap()` 对象方法)。
- **L2 注入特征扫描**:`ignore previous` / 读 `auth.json`/`.env` / 出站 URL 等模式 → flag/block(诚实标注:可绕,非万能)。
- **L3 路径白名单**:`file_ref.path`/`files[].path` 禁 `..`/越界绝对路径,symlink 加固(合并相位二次校验)。
- **L4 自动化沙箱断网兜底**:中招也跑不掉。

> **吃掉 RS-B1(blocker:L4 未实测)**:整套 RCE/exfil 防线垫底押在"沙箱断网"。**M0 T0.5b 硬门**实测 codex `-s workspace-write` 与 claude 权限模式下子进程能否出网(curl 打探测端点)。**若实测可出网** → L4 失效,注入防御须改应用层强约束(无后门 spawn + 出站白名单),§28 RP9 记此分叉。M0 闸五项之一,不过不进 M1。

### 7.4 命令型 evidence 复跑安全(对接 02 H3)

`runCommandSandboxed`:仅 agent worktree 内执行 + sandbox 封顶 + **断网** + env 白名单 + 硬超时(默认 10s)+ 命令预扫描(拒 `rm -rf /`、`curl|sh`、含疑似 key)。三态见 §2.10(unsafe→fail / infra→weak 不连坐)。

### 7.5 闸③·WS 与控制面安全

- 绑定 `127.0.0.1` only + Origin 白名单 + 一次性 ticket。
- **ws-ticket 签发端鉴权(★v3.1,吃 RS-M2)**:`POST /ws-ticket` 自身须校验本地 run 持有者凭证(进程级密钥/启动时一次性 secret)——本机 `curl` 直打端点拿不到 control token,堵掉"非浏览器拿不到 token"的循环论证。
- 观战 / 控制权限分级:pause/inject/abort 需 `scope:'control'`,只读连接发控制帧被拒(`WS_PERMISSION_DENIED`)。
- inject 入队前不外溢(RS-m5):人工注入经防火墙后才入黑板。

### 7.6 面板 XSS 防护(★v3.1,吃 RS-B2 blocker)

> 威胁面:agent 内容 → 持 control 权限的浏览器 DOM。redact 只抹 secret 不转义 `<script>`,agent 在 `body`/`quote`/文件名塞脚本即可借浏览器代发 abort/inject。

- **输出转义**:`body`/`quote`/文件名/evidence 文本进 DOM 一律转义,**禁 `dangerouslySetInnerHTML` 裸插**。
- **CSP**:禁内联 script、限 `connect-src` 到本地 ws。
- 单测断言 `body` 含 `<script>`/`<img onerror>` 被转义不执行(M2·T2.8b)。

### 7.7 自动化沙箱封顶(S6 / L4)

playbook 无法请求 `danger`;`AgentRuntimeResolver.sandbox` 取 `playbook.params.sandboxCeiling` 与安全封顶的交,**绝不超 `workspace-write`**。M1 纯决策一律 `read-only`(吃 FEAS-8,比 workspace-write 更小更安全且与"不写文件"自洽)。

### 7.8 数据出境合规

进 prompt 的文件过 secret scan;`.syluxignore`(gitignore 语法)默认排除 `.env`/`.git`/credentials;命中拒发或脱敏 → `EGRESS_SECRET_BLOCKED`。README 标注数据经第三方中转出境;提供官方直连 provider 选项。

## 8. 文件隔离与 worktree

> `@sylux/agents/worktree.ts`(或独立 `@sylux/worktree`),权威设计 09。纯 worktree 模型(焊死 R7):运行期各写各 worktree 无锁,只 round 末合并串行 + 冲突硬停回灌 evidence。**删除"同文件写权串行化"措辞**。

### 8.1 仓库与分支拓扑

每 agent 一份独立 git worktree(各自分支),路径全程稳定(`W1`)。Windows 专属约束(事实地基 A):git 在 PATH,worktree 路径避坑长路径/锁。

### 8.2 里程碑分级的隔离退化(吃 FEAS-2 blocker + COV-9)

| 里程碑 | 隔离形态 | 说明 |
|---|---|---|
| **M1** | **只读快照子集**(非 worktree 写) | 红蓝纯决策。`worktreesEnabled=false`,`mergeRound` no-op,`files[]` 仅意图声明 evidence。**但 critic 的 `file_ref` 指向 `--task` 真实代码库,引擎必须能读 path+行区间、复算 contentHash 判强核验** → 需轻量"只读 checkout/挂载 + `readFileRange` + `contentHash`"(09 只读子集),远轻于写合并。无此项则 M1 强核验假绿(FEAS-2)。 |
| **M2** | 同 M1 | evidence 引用预览从只读快照取行区间高亮;**无文件写=无 diff**,真正 unified diff 推迟 M3(吃 COV-9)。 |
| **M3+** | 完整 worktree 写 + 3-way 合并 | `worktreesEnabled=true`,implement 落 diff。 |

> 纠正初稿"M1 不需要 worktree"的过激措辞:准确说法是"M1 不需要 worktree 的**写入与 3-way 合并**,但需要 09 的**只读快照子集**"。

### 8.3 round 末 diff 生成与合并(M3+)

- `diffSince`:`git diff --find-renames`(含未跟踪新增)→ name-status 映射 `FilePatch`(diff 正文由中枢生成,非 agent 自填)。
- agent 意图 vs 实际改动对账(冲突预检前置)。
- `mergeRound`:合并前 tag/stash 可回滚;`mergeTreeProbe` 不碰工作区先探冲突。
- **冲突 → 可核验 evidence(焊死 R7/E5)**:冲突点 → 双 `file_ref`(per-side diff hunk 真实行号)+ base `spec_quote` 回灌,置 `paused` 人工裁决,`WORKTREE_CONFLICT`。**不静默重试,不选边**。人工裁决后 `resolveAndContinue` 续跑。

### 8.4 readFileRange + ValidateContext 装配(供 02 §8.1)

`readFileRange(rel, lineStart, lineEnd)` 走 `isPathSafe` 不裸 fs(S1);越界/不存在返回 null。装配 `ValidateContext`:M1 `capabilities.fs=true`(只读快照可读)、`sandbox=false`。

---

## 9. Web 面板与 WS 协议

> 面板前端 10(`@sylux/web`)+ WS 协议 11(`@sylux/server`)。一句话职责:浏览器实时观战(对话气泡/轮数/evidence 预览·diff/刹车提示)+ 可暂停介入。

### 9.1 WS 帧信封(权威线格式,引用 02 类型)

```ts
WS_PROTOCOL_VERSION = 1
wsEnvelopeSchema = z.object({
  v: literal(1),          // 线协议版本(W8);不符且无法协商 → close 4400
  type: string,           // 帧类型,server 帧与 client 帧取值域不重叠
  runId: string,          // 多 run 路由(一条连接可观战多 run,每 run 独立 seq)
  seq: int>=0,            // ★广播序号:server→client 广播帧单调 +1 无洞(断点续传游标);点对点/client 帧置 0
  ts: int>=0,
  payload: z.unknown(),   // 两段式:先廉价校验 v/type/runId/seq,再按 type safeParse payload
})
```

**两段式校验**:`payload:z.unknown()` 让"版本不符/路由错"在解析重 payload 前短路。完整判别在 `decodeServerFrame`/`decodeClientFrame`。

### 9.2 seq / cid 双轨(广播序 vs 应答关联)

| 机制 | 方向 | 作用 | 分配 |
|---|---|---|---|
| `seq` | server→client 广播帧 | 全序、断点续传游标(`Map<runId,seq>`) | server 按 runId 自增 |
| `cid` | client→server 请求 ↔ server 应答 | 把 inject/pause/subscribe 与其 control_ack/error 关联 | client 生成 nanoid,server 回填 |

> 控制帧"被接受"与"产生黑板变化"是两件异步事:`inject` 被 ack(已入 ControlQueue)≠ 已 append(引擎在相位边界才消费)。用 cid 关联受理,用 seq 排序落地。

### 9.3 帧类型

- **server→client 广播帧(占 seq)**:`message` / `round_closed` / `status_changed` / `usage` / `diff`(M3)。源:`Blackboard.subscribe` 的 `BroadcastEvent`。
- **server→client 点对点帧(seq=0)**:`snapshot`(初连全量)/ `pong` / `control_ack` / `error`。
- **client→server 帧(带 cid)**:`hello`(协商版本 + 初始订阅)/ `subscribe`/`unsubscribe` / `pause`/`resume`/`inject`/`abort`(需 `scope:'control'`)。

### 9.4 连接生命周期与背压

- 握手:`hello`(v 协商 + ticket 鉴权 + Origin 校验)→ `snapshot` → 增量广播。
- **重连 + 断点续传**:client 持游标 `Map<runId,seq>`;server 端环形缓冲(断点续传窗);超窗 → 强制 resync(拉新 snapshot)。server 重启 seq 归零(协议明示)。
- **背压与慢消费者(W7)**:每连接有界发送队列 → 帧合并(coalescing)→ 降级阶梯(队列压力分级)→ 不可恢复溢出强制 resync 而非堆死。
- 关闭码表:4400 版本不符 / 4401 未鉴权 / 4403 权限不足 / 4408 ticket 过期 等。

### 9.5 面板前端(10)

Vite + React + zustand + 原生 WebSocket + diff2html(M3)。视图:对话气泡(按 round/from/role/kind 着色)+ 轮数进度 + 刹车触发高亮 + evidence 引用预览(M2,点 file_ref 看快照行区间高亮)/ unified diff(M3)+ 暂停/介入控件(权限分级 UI,只读态隐藏控制)。**所有 agent 内容进 DOM 转义 + CSP(§7.6)**。

## 10. 技术栈与 monorepo

### 10.1 选型(权威锁定,12)

| 层 | 选型 | 理由(对抗性正面回答) |
|---|---|---|
| 语言/运行时 | TypeScript 5.7 + Node.js 22 LTS(ESM) | 非 Bun/Deno:codex/claude 生态与 child_process 行为以 Node 为基准,事实地基全在 Node 上测得 |
| 模块 | ESM + NodeNext + `verbatimModuleSyntax` | import 用 `.js` 后缀;type 导出与值导出分开(consistent-type-imports) |
| 包管理 | pnpm 9(corepack 启用)+ workspaces | 不全局装 pnpm;`--frozen-lockfile` 防漂移 |
| 子进程 | execa 9,**但被事实 A 强约束** | 事实 A 把"省心用法"判死刑:必直调真 exe + stdin,不裸名/.cmd |
| 校验/Schema | zod 3.23 + zod-to-json-schema | 一份三职;锁 zod 3(非 4,版本纪律) |
| WS / 日志 | ws 8 / pino 9(带 redact) | pino redact 短板见 §7.2 流式跨帧对策 |
| 前端 | Vite 6 + React 18 + zustand + diff2html | |
| CLI/ID/时间 | commander + nanoid + Date.now 注入 | |
| 构建/测试 | tsup + vitest | |

### 10.2 Monorepo 结构与依赖方向(单向禁环)

```
@sylux/shared   ← 02 类型/校验/指纹/jsonl/错误码(唯一权威,无下游依赖)
@sylux/providers← 07 provider 配置/KeyStore/注入翻译
@sylux/agents   ← 05/06 适配 + worktree(09) + 安全(08 buildChildEnv/firewall)
@sylux/core     ← 03 引擎/playbook + 04 刹车 + 19 fusion
@sylux/server   ← 11 WS + REST + 装配 wireEngine
@sylux/web      ← 10 面板前端
@sylux/eval     ← 18 评测台
依赖方向:shared ← {providers, agents} ← core ← server ← web;eval 旁挂
```

> **吃掉 D15(安全工具包落点不统一)**:`buildChildEnv`/`firewallPeerMessage`/`redact`/`SECRET_SIGNATURES` 统一落 `@sylux/security`(被 agents 依赖),不再三处 import 路径(`@sylux/security`/`@sylux/agents/proc`/`@sylux/shared`)分歧。12 §2.4 裁决为准。

### 10.3 镜像安装(P4)

仓库根 `.npmrc` 固定 `registry=https://registry.npmmirror.com` + 原生二进制/平台包镜像(esbuild 等)。官方源本机超慢(记忆 npm-mirror)。供应链安全:依赖钉死版本,异常包名(typosquatting)告警。

---

## 11. 工程开发规范

- **不吞错(§11.3 原则)**:抛错一律 `SyluxError`(`code` 机读 + `message` 人读 + `detail` 上下文)。顶层兜底打印后非零退出。
- **类型纪律**:`@sylux/shared` 是唯一类型权威;下游 `import type { SyluxErrorCode }`,禁另立 union 子集或裸字符串当错误码。
- **TS 严格**:`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(optional 字段不显式置 undefined,用条件展开 `...(x!==undefined?{x}:{})`)。
- **lint/format**:ESLint + Prettier;`consistent-type-imports`。
- **git**:`.gitattributes` 强制 `eol=lf`(跨平台 hash 一致,呼应 §2.9 normalizeContent)。提交前 `pnpm check`(build + tsc + test + lint)。本地 pre-push 跑契约测试。
- **骨架→真实仓搬运**:骨架单文件合并的(如 stop-policy)按设计 §1 目录拆分,import 不变。

---

## 12. 测试策略

> 权威 14。原则:能 fake 验结构就不烧 token(M0 探针除外)。

- **契约测试矩阵(02 §13 V1–V20+)**:Message/Evidence/指纹/jsonl/校验全绿是 M1 退出硬门。关键用例:V16(CRLF==LF 同 hash)、V17(两轮同 evidence 新指纹空)、V18–V20(jsonl 回放重建)、V14(payload 瘦子集校验)、V32(`Record<SyluxErrorCode,…>` 穷举守卫)。
- **FakeAdapter / fake-CLI**:零 token 驱动引擎全链路(四范式集成测试、≥3 轮连续性、强核验复算、read-only 沙箱断言)。
- **ReplayAdapter(M4/M5)**:把真实 run 的 jsonl/事件流存档,逐字节复现 BoardState(回放态打分稳定)。
- **安全断言测试**:env 白名单跨进程隔离、argv 无 key、注入样本降级、XSS 转义、跨帧 redact 拼回拦截、WS 鉴权拒连。
- **对抗性自检(团队红队成员职责)**:交付前对结论做对抗自检,不急着说"搞定"。

---

## 13. 可观测性与错误码

### 13.1 SyluxErrorCode 全集(唯一权威 `errors.ts`,吃 A1/COV-1/COV-4 blocker)

> 焊死 x-consistency A1 + x-coverage COV-1/COV-4:下游各稿零散登记、02 本体未补的 17+ 码全部回填本集。`SYLUX_ERROR_CODES` 运行期数组 + 编译期双向守卫(漏码或混入非法码即编译红——这是**特性**,强制全集同步)。评测 15 的 `Record<SyluxErrorCode,…>` 穷举缺项编译红。

| 分域 | 错误码 |
|---|---|
| 契约校验 | `OUTPUT_SCHEMA_VIOLATION` `EVIDENCE_REQUIRED` `EVIDENCE_UNVERIFIABLE` `EVIDENCE_COMMAND_UNSAFE` `EVIDENCE_INFRA_DEGRADED` `MESSAGE_SIZE_EXCEEDED` `WORKTREE_PATH_VIOLATION` `DANGLING_REPLY_REF` `INVALID_DONE_SELF_ACK` `INVALID_SYSTEM_SENDER` `EMPTY_ROUND_PLAN` |
| 子进程/适配 | `SUBPROCESS_SPAWN_FAILED` `SUBPROCESS_CRASHED` `SUBPROCESS_TIMEOUT` `SUBPROCESS_CANCELLED` |
| 引擎 | `ENGINE_FATAL` `ROUND_LIMIT_EXCEEDED` `CONVERGENCE_STALL` `TOKEN_BUDGET_EXCEEDED` |
| 安全 | `PROVIDER_CONFIG_INVALID` `INJECTION_BLOCKED` `EGRESS_SECRET_BLOCKED` |
| WS/面板 | `WS_UNAUTHORIZED` `WS_ORIGIN_REJECTED` `WS_TICKET_EXPIRED` `WS_PERMISSION_DENIED` `WS_RATE_LIMITED` `WS_PAYLOAD_INVALID` `WS_PROTOCOL_ERROR` |
| worktree | `WORKTREE_CONFLICT` `WORKTREE_GIT_FAILED` |
| Fusion | `FUSION_PANEL_FAILED` `FUSION_JUDGE_FAILED` |
| provider/config | `PROVIDER_UNAVAILABLE` `CONFIG_INVALID` |

### 13.2 日志与指标

- pino 结构化日志,全通路过 `redact` 单一出口(§7.2)。`Logger.stream(ev)` 透传 delta/tool_call 给面板观战,不入黑板。
- metrics:每轮 token、累积成本、stall streak、retry 次数、429 退避、合并冲突数。
- 终态审计:`status_changed` 带机读 `code`(过渡期折进 reason 前缀,待 02 回填独立字段,04 §13.2)。

---

## 14. 配置全集 schema

> 权威 16(`@sylux/config`)。一份 `sylux.config.{yaml|json}`,一次 zod 校验,派生全系统。加载管线五步 fail-fast:read → envRef 解引用(`${env:NAME}` 只解名不碰真值)→ zod → 跨字段 → derive。

### 14.1 顶层 SyluxConfig

```yaml
run:       { goal, taskDir, runId? }
providers: { <ref>: ProviderSettings }      # 复用 07,不另写;snake↔camel 边界在加载层
agents:    { codex: {provider:<ref>}, claude: {provider:<ref>} }  # 每 agent 一份 provider
playbook:  { id, assignment?, params? }      # 范式 + 角色指派 + 参数覆盖
stop:      { maxRounds, convergence?, budget? }  # ★三重刹车阈值单一来源在此,非 playbook.params
worktree:  { enabled, sandboxCeiling, cleanup }
server:    { host:'127.0.0.1', wsPort, originAllowlist, metrics? }  # host 安全校验 K6
logging:   { level, output, redact }
fusion?:   { ... }                           # 远景可选
```

### 14.2 stop 段默认表(★按 regime 分叉,吃 ROC-B1 blocker)

> 刹车阈值单一来源在 `stop` 段(非 `playbook.params`,防二义);playbook 默认 ↔ config 覆盖有优先级合并规则。`derive` 产 §4 `StopPolicyConfig`。

| 范式 | continuity regime | tokenBudget 口径 | 示例(maxRounds=12) |
|---|---|---|---|
| red-blue / pair / parallel | stateless | **线性 ≈ c×N** | ≈225k–600k(留余量) |
| master-worker | 混合(子任务内 resume) | regime 切换轮用 resume 超线性上界 `base×chainLen`,其余线性 | 分段估 |

**绝不**对 stateless 默认范式套 `base×N(N+1)/2`(808k,比线性目标大 3.6×,使前瞻刹车形同虚设)。对账 18 §6.4 `estimateRunTokens` 的 regime 分叉。**M5 评测台开工前本表必须改对**(ROC-B1 前置)。

### 14.3 env 引用与优先级

`${env:NAME}` 只解引用名;配置项 vs 环境变量优先级明确;key 永远是 ref 不入配置值(§6.1/§7.2)。

## 15. 性能与背压

> 权威 17。

- **ConcurrencyGovernor 全局许可池(按 provider 端点分池,吃 ROC-m3)**:codex(mouubox)与 claude(anthropic)各独立端点各一池,不挤同一池;8 并发 429 顶只对单端点实测;AIMD 降并发只降触发 429 的端点(ROC-m4 同源)。
- **digest 裁剪**:基线确定性算法在 §3.2(M1);高质量精确分词/LLM 摘要归本章(接口不变)。
- **WS 背压**:每连接有界发送队列 + 帧合并 + 降级阶梯(§9.4)。
- **jsonl 写**:骨架用同步 `appendFileSync` 图省事;生产换 append-only write stream + fsync 节流 + 背压。
- **评测 runner 并发**(吃 ROC-M3):`(task,cell)` × parallel 单轮 × panel N 成员**叠加**不得破 8 顶,必须复用全局许可池,否则 429 退避污染量化结论。

---

## 16. 评测台

> 权威 18(`@sylux/eval`),M5 落地。

- **EvalTask / EvalMatrix / EvalScore**:固定任务 × 剧本 × provider 组合 → 质量/成本/稳定三维 + A/B 对比。
- **离线打分(EV2)**:对历史 jsonl 离线打分,不重跑 CLI。
- **质量可机器核验(EV4)**:命令退出码/文件 hash/测试数;红队"有效发现"按"核验通过 + 新指纹差集"量化(EV6,正好是 critic evidence 格式)。
- **成本(EV5)**:实测 usage 换算;A/B 同任务集/同预算口径公平(EV7);产物带输入指纹可复现(EV8)。
- **ReplayAdapter**:重放真实 run 逐字节复现 BoardState。
- 前置:`estimateRunTokens` regime 分叉(§14.2,吃 ROC-B1);runner 受全局许可池管控(吃 ROC-M3)。

---

## 17. 部署运维与合规

> 权威 19。本地分发(Windows 优先)。

- **分发形态**:源码 + lockfile,不打二进制。`bootstrap.ps1`:Node 版本闸 → corepack 固定 pnpm → 装包(npmmirror,`--frozen-lockfile`)→ 构建 → 体检。
- **preflight/doctor**:起前体检(Node 版本、git、两端真 exe 定位、provider 可达),不烧 token。启动横幅:知情 + 版本快照。
- **密钥存储**:配置(可入库)vs 密钥(永不入库)两层分离。`set-keys.ps1` 从 Windows 凭据管理器读 key → 会话 env(target 约定 `sylux:<ref>`)。`.env` 降级路径 + 文件权限收紧(仅当前用户)。
- **出境合规**:`.syluxignore` 维护(出境黑名单),secret scan 调用点,知情标注,官方直连选项(§7.8)。
- **灾备恢复**:杀进程后从 `runs/<runId>.jsonl` 重建 BoardState(§2.8)。
- **版本漂移**:CLI 升级改 usage 字段 → degradable + 告警 + 按上界兜底估(吃 ROC-M1),不静默当 0。

---

## 18. 插件化 DSL

> 权威 20。Playbook 是第一插件点;StopPolicy 是第二。

- **自定义 Playbook**:实现 §3.1 接口即接入,引擎不动。
- **自定义 StopPolicy(吃 x-consistency E8)**:重构到 §4 `CompositeStopPolicy` 的 child 注入模型——自定义停止策略作为一个 `StopPolicy` child 注入 composite,**不再建在废弃的 `core.checkBefore/checkAfter` 上**。
- **DigestBuilder**:可替换基线实现(§3.2),接口不变。
- 插件经配置声明,zod 校验 `playbookId`/`continuityMode`/`tokenPricing`/`sandboxCeiling` 等(字面量需与 §3/§4 严格同步,吃 E9)。

---

## 19. 本地 Fusion 评审团

> 权威 21(`@sylux/core/fusion/`),M5 落地。借鉴 OpenRouter Fusion 的 panel+judge。

### 19.1 严格边界(锁定决策 §5,第一不变量)

- **仅决策回合**(propose/review/critique/question)可叠 panel + judge;**执行回合(implement)严格禁 Fusion**。
- 双闸拦截:配置期 `panelProviderConfigSchema.superRefine` 拒 implement;运行期 `FusionExecutor` 命中 implement 抛 `FUSION_KIND_FORBIDDEN`。
- **吃掉 FEAS-3**:边界不只按 kind——**凡声明非空 `files`/`shouldMergeAt` 的发言同禁 panel**(避免 21 §5.5 把 propose 的 files 静默清空)。

### 19.2 接入点(不改引擎)

Fusion 是 `runTurn` 的一条执行路径:决策树在 runTurn 入口判该 turn 是否配 panel,是则走 `FusionExecutor`(N provider 并发答 + judge 综合),否则单 adapter。

> **吃掉 FEAS-9**:Fusion **仅在 runTurn 产出的 turn 接入**——`onStart`/`onFinish` 是 `Promise<void>` 钩子、不产 `AgentMessagePayload`,不挂 panel。21 §2.3 "parallel 在 onStart 挂 panel"作废,parallel 直接标"不适用 Fusion"。

### 19.3 FusionExecutor 与同形落地

- **F1 同形**:一次 panel 发言只产一条 `AgentMessagePayload`,黑板看不出背后是 panel。
- **F3 成员无状态**:成员强制 single-shot,不逐成员 resume。
- **judge 三策略**:synthesize / vote / best_of。
- **裁判级重试(F5)**:judge 不达标只重跑 judge,不重 fan-out N 成员。
- **judge 产物 → critic evidence(锁定决策 §5 收口)**:裁判的"共识/矛盾/盲点"天然映射 02 `EvidenceItem`——panel 的真正价值是天然产可机器核验的 critique。

### 19.4 成本模型(事实 D × (N+1),F8)

单次 Fusion 发言 ≈ `(N+1)×` 地板价(N 成员 + 1 judge)计入累积预算。单成员/单 turn token 硬上限(`maxTurnTokens`,吃 RS-M5)+ 扇出前瞻(§4.5)。运营监控指标供 §7/§13。

## 20. 端到端时序

### 20.1 启动 → 一轮红蓝对抗(M1 终端)

```
sylux run --playbook red-blue --task <dir>
  → loadSyluxConfig(校验 + derive StopPolicyConfig)
  → preflight(Node/git/两端 exe/provider 可达)
  → wireEngine:建 Blackboard(jsonl) + 两 AgentAdapter(注入 provider+keystore)
                + buildStopPolicy(maxRounds+done+convergence+budget) + 只读快照 ValidateContext
  → runEngine:
      round0(偶):playbook.nextTurn → proposer=codex
        renderPrompt(goal+digest+空 delta)→ adapter.send → consume(session_started/final_message+usage)
        → safeParse → validateMessage(propose 无需 evidence)→ append(盖 seq=0)
        closeRound(0)→ stopPolicy.update/shouldStop(未触发)
      round1(奇):critic=claude
        delta=[codex 上一条](过 firewallPeerMessage 包封套)
        → claude 产 critique + file_ref evidence
        → validateMessage 阶段 B:readFileRange 复算 contentHash 比对 quote → pass(强)→ append
        closeRound(1)
      ... ≥3 轮(连续性验收:第3轮仍含第1轮锚点)
      若 codex done + claude 带证据 ack → DonePolicy 触发 → finalize(done)
      终端渲染器订阅 Blackboard 实时着色打印气泡
```

### 20.2 M2 浏览器观战 + 介入

```
浏览器 → POST /ws-ticket(校验本地 run 持有者凭证,吃 RS-M2)→ ticket
       → WS connect(Origin 白名单 + ticket)→ hello(v 协商 + 订阅 runId)
       → server: snapshot(全量)→ 增量广播(message/round_closed/status,过流式跨帧 redact + XSS 转义)
控制连接 → inject{cid} → control_ack{cid}(受理)→ 引擎相位边界消费 → 经防火墙 → append(from:human)→ message 广播{seq}
        → pause → 引擎挂起;resume → 续跑
```

### 20.3 合并冲突回灌(M3)

```
parallel 收口轮:mergeRound → mergeTreeProbe 探冲突
  冲突 → 冲突点转双 file_ref + base spec_quote → append system(WORKTREE_CONFLICT)
       → setStatus(paused)→ 面板告警 → 人工 resolveAndContinue
```

---

## 21. 术语表与不变量

> 23 的术语表/不变量总表**按 v3.1 重刷**(吃 x-consistency E1/COV-8:23 旧版 INV-T4 写"强/中"、INV-E6 写 checkBefore/checkAfter 双侧、done/stall 当两处独立、编号逻辑派——全部过期,照旧断言会断出 v1 错误约束)。

### 21.1 术语

| 术语 | 定义 |
|---|---|
| 黑板 Blackboard | 结构化消息的 append-only 单一事实源(jsonl 落盘,BoardState 投影) |
| Playbook | 范式剧本,决定 nextTurn/shouldMergeAt/isDone;换打法只换它 |
| Evidence | 带可机器核验锚点的证据;强度由中枢能否独立复算决定(I3) |
| continuity | stateless(每轮新会话)/ resume(续接,成本超线性) |
| digest | 旧轮压结论(结构化锚点 + 自方结论),省 token 核心 |
| 指纹 fingerprint | evidence 的稳定哈希,收敛差集用;command 不含 actual(R5) |
| 强指纹 | 核验通过的指纹(剔 `s:` 弱 + `:?` 未核验);只有它清零 stall |
| 三重刹车 | maxRounds + convergence(stall) + budget,统一 CompositeStopPolicy 轮末裁决 |

### 21.2 关键不变量(实现焊死,CI 自检锚点)

| 编号 | 不变量 |
|---|---|
| I1 | Message/Evidence/错误码等类型唯一权威落 `@sylux/shared`,他处只引用 |
| I2 | validateMessage 是入黑板唯一守门 |
| I3 | 证据强度由中枢复算决定,与 agent 自报无关;门槛 ≥1 强(weak 不解锁) |
| I5 | session_started 恒首事件;拿到前不标 resumable |
| I6 | seq 单调 +1 无洞,排序/回放/收敛权威键;ts 仅人读 |
| I7 | 中枢盖章 id/runId/round/seq/from/role/ts,agent 不产出 |
| E4 | stall ⊥ done,独立判定经 composite 聚合 |
| E5 | 合并冲突硬停回灌,不选边不静默重试 |
| E6 | 刹车统一轮末,无前置刹车(checkBefore/checkAfter 已废) |
| S12 | reconfigure 只改阈值不动累积状态 |
| A4 | key 永不进 argv;A5 env 单一出口 extendEnv:false |

> **统一术语(吃全仓漂移)**:`PromptContext`(非 ContextBundle)、`firewallPeerMessage(msg)` 纯函数(非 firewall.wrap)、`buildChildEnv({providerEnv,agentId})` 单对象、`toCodexInjection(cfg,keystore,ov?)` 三参、证据"强/weak"二态(非"强/中")。

---

## 22. M0 可行性闸

> 权威 24。**M0 只验假设、不写产品代码**;产出是"结论 + 回填 + 放行/阻断"。

### 22.1 M0 要回答的唯一问题

"这套纸面架构,在本机(Win11 China + mouubox + codex 0.141.0 + claude 2.1.x)上,能不能真的搭起来跑通一个最小回合,且关键省钱/安全/正确性假设不塌?"

### 22.2 已落地(PF,不再重测)

spawn 直调真 exe + stdin(A);事件流首行 thread_id(B);output-schema 经 mouubox 可成形 + safeParse 兜底(C);resume 不省 token 累积翻倍 + 基线 18.7k(D);resume 参数集不对称(E);两端 flag/schema 不对称(F);usage 取 turn.completed.usage。

### 22.3 M0 残留探针(五项硬门,全过才进 M1)

| ID | 探针 | 阻断级 |
|---|---|---|
| T0.1 | codex 简单+嵌套(evidence discriminatedUnion)schema 经 mouubox 成形,样本入 fixtures(注 0.141.0)。**两端口径:codex 与 claude 都测 discriminatedUnion+optional,任一端拒则走退化 schema、不改 TS 类型(吃 OQ-4)** | major |
| T0.2 | `buildAgentOutputJsonSchema` 摊平后字节数**下界估**(不 require 未建 dist,内联 02 §6.2 冻结副本,吃 FEAS-7)< claude 32KB 内联上限? | major |
| T0.2b | M1·T1.2 落地后用正式 dist 复跑校准(两段闸第二段,消除"闸门依赖未来产物"悖论) | major |
| T0.3 | claude `-p --output-format stream-json --json-schema` 真实事件流 + schema 传递方式 | major |
| T0.4 | claude `--session-id` 预设能力是否存在(不支持→对齐 codex"id 由它给") | major |
| T0.5 | kill 能否杀穿 claude .ps1/.cmd shim 背后 node 子进程 | major |
| **T0.5b** | **沙箱出网(吃 RS-B1 blocker)**:codex `-s workspace-write` / claude 权限模式下子进程 curl 能否出网?**可出网→ §7.3 L4 失效,改应用层强约束(§28 RP9)** | **blocker** |
| T0.6 | claude token 计量字段定位 + 归一 | minor |
| T0.5c | **命令复跑白名单负例验证(吃 OQ-5)**:node / npx / powershell / `curl\|sh` 必须 default-deny 且测通拒绝路径。**失败→关闭 command-evidence 复跑特性(不阻断主干),修好再开;非 build-stop**(T0.5b 仍为唯一硬阻断) | major(硬要求·门控复跑特性) |
| T0.7 | 结论写回 PF + 两端能力对照表入库 + 闸门五项判定 | — |

### 22.4 闸门决策矩阵

> **最终裁决(Aylovelle 2026-06-20)**:T0.5b(沙箱出网)是 M0 唯一 build-stop 硬阻断;major 失败但有文档退化路径可"有条件进 M1";blocker 无结论或 T0.5b 塌了一律不许硬冲。

| 结果组合 | 判定 | 动作 |
|---|---|---|
| T0.5b pass + 其余 major 全 pass | 通过 | 回填去标,开工 |
| T0.5b pass,某 major fail 但已切文档备好退化路径(如 T0.1/OQ-4→退化 schema;T0.5c→关复跑特性) | 有条件通过 | 记 openQuestion + 切路径,开工 |
| **T0.5b fail(任一模式可出网)且无应用层禁 spawn / 出站白名单替代** | **阻断** | 停在 M0,回设计层重做替代方案,不许硬冲 |
| 任一核心探针无结论(没跑/跑挂没定论) | **阻断** | 不许跳过 |

### 22.5 前置环境清单(EP,全绿才进探针)

运行时(Node 22/corepack pnpm)、git(worktree 地基)、codex CLI(真 exe 定位)、claude CLI、工作目录隔离。

## 23. 里程碑路线图 M0–M5

> 权威 25(冲突以 25 为准)。三原则:每个里程碑是可演示的闭环;最重模块(worktree 写合并)尽量后置;红队 blocker 在对应里程碑退出标准里硬验。

| 里程碑 | 目标 | 范围 | 关键退出标准 |
|---|---|---|---|
| **M0** 可行性闸 | 假设变事实 | 仅 fixtures + 一次性探针,不建包 | 五项探针(含 T0.5b 出网 blocker)有结论 + 回填 PF + 两端能力对照表 |
| **M1** 双 CLI + 红蓝 + jsonl | 终端最小闭环 | shared(02 全 schema)+ core(引擎/playbook/最小刹车/digest v0)+ agents(双 adapter + env 白名单 + 防火墙 + 只读快照 ValidateContext)+ red-blue + jsonl + 终端渲染 | `pnpm build`+`tsc -b` 过;契约矩阵 V1–V20 全绿;**02 §12 错误码补全(PRE-1)**;`sylux run` 驱动真实 codex+claude **≥3 轮**对抗(吃 FEAS-4);**强核验真生效**(file_ref 复算 hash,吃 FEAS-2);maxRounds + done(对面带强证据 ack)停;安全四守卫断言过;**M1 一律 read-only 沙箱**(吃 FEAS-8);崩溃可从 jsonl 重建 |
| **M2** Web 面板 | 观战 + 暂停介入 | server(ws bind 127 + 鉴权 + ws-ticket 签发鉴权 + 流式跨帧 redact)+ web(React 面板 + evidence 预览 + 输出转义/CSP)+ WS 协议 | 浏览器实时气泡与 jsonl 一致;Origin+ticket 鉴权拒连;**ws-ticket 签发端鉴权(吃 RS-M2)**;权限分级;不监听非回环;**XSS 防护(吃 RS-B2)**;**流式跨帧 redact(吃 RS-M1)**;暂停/inject 经防火墙;**evidence 引用预览(非 diff,吃 COV-9,diff 推迟 M3)** |
| **M3** 四剧本 + worktree + 收敛 | 补三范式 + 物理隔离 + diff | core(三 playbook + 收敛按范式分化)+ worktree(create/diff/3-way/冲突硬停)+ diff 面板 | 四剧本集成测试 + 角色↔模型解耦只改 assignment;worktree 隔离 + 3-way + 冲突回灌 + 可回滚;parallel 并发各写各;**收敛按范式分化(吃 FEAS-5)**:辩论型强指纹 stall、状态机型 done 收口 + 派活/review 轮豁免;**复跑器/沙箱故障分类(吃 COV-3)**:infra 故障判 weak 不连坐;真正 unified diff 面板上线 |
| **M4** provider 热切 + 成本 + 回放 | 配置可换 + 预算硬上限 + 离线复现 | providers(配置 schema + 热换 + 出站 secret scan)+ core/brakes(token 预算 + context cap)+ 回放 + 出境守卫 | 热换只影响下一轮;key 不进 argv/不落盘(断言);累积 token 触顶停(**按累积/超线性模型 + regime 选公式,吃 FEAS-1**);**usage 缺失 output 不当 0(吃 ROC-M1)**;ReplayAdapter 逐字节复现;`.syluxignore` + 官方直连选项 |
| **M5** 评测台 + Fusion | 量化评测 + 评审团 | eval(EvalTask/Matrix/Score/ReplayAdapter/AbReport + runner)+ core/fusion | 离线打分 EV2/质量可核验 EV4/有效发现量化 EV6;A/B 公平 EV7;Fusion 同形 F1/无状态 F3/双闸禁 implement + 禁写文件 propose(吃 FEAS-3/FEAS-9);judge 产可核验 evidence + 裁判级重试 F5;成本 (N+1)× F8;**runner 受全局许可池(吃 ROC-M3)**;**16 §6.4 预算表先修(吃 ROC-B1 前置)** |

---

## 24. 明细任务清单(M0–M2 可直接开工)

> 记法:ID / 所属包 / 任务 / 验收 / 依赖 / 工作量(S/M/L)。完整 M3–M5 中粒度任务见 25 §2.4–2.6。

### 24.0 跨里程碑硬前置(非任务,开工前必须发生)

- **PRE-1**:补全 02 §12 `SyluxErrorCode` union(已在 §13.1 落定;`errors.ts` 全集 + 双向守卫)。
- **PRE-2**:冻结 02 §6.1 `agentMessagePayloadSchema` 字段集(T0.2 schema 体积探针前置)。
- **人拍板产品裁决(吃 FEAS-3/4/5 + COV-9)**:M1 红蓝纯决策不写文件确认;digest v0 算法钉死 03;收敛按范式分化;diff 推迟 M3。

### 24.1 M0(残留探针 + fixtures)

| ID | 任务 | 验收 | 依赖 | 量 |
|---|---|---|---|---|
| T0.1 | codex 简单+嵌套 schema 经 mouubox 成形探针 | 真实 JSONL + 样本入 fixtures(注 0.141.0) | PF·C | S |
| T0.2 | schema 字节数下界估(内联冻结副本,不 require dist) | < 32KB? 超→记 stream-json 备选 | PF·F,PRE-2 | S |
| T0.2b | M1·T1.2 后正式 dist 复跑校准 | 与下界对账,差异超阈值→T1.11 重审 | M1·T1.2 | S |
| T0.3 | claude stream-json + json-schema 事件流探针 | 样本入 fixtures + schema 传递方式 | T0.2 | M |
| T0.4 | claude `--session-id` 预设能力 | 明确支持/不支持,写回 PF·F | — | S |
| T0.5 | kill 杀穿 claude shim 背后 node | 子进程被回收,否则记进程树 kill | — | S |
| **T0.5b** | **沙箱出网探针(RS-B1 blocker)** | 出网结论写回 PF;可出网→§28 RP9 + L4 改应用层 | — | M |
| T0.6 | claude token 字段定位 | 字段名 + 归一,入对照表 | T0.3 | S |
| T0.7 | 结论回填 PF + 两端能力对照表 + 闸门五项判定 | PF 更新 + 对照表入库 | T0.1–T0.6,T0.5b | S |

### 24.2 M1(双 CLI + 红蓝 + 终端闭环)

| ID | 包 | 任务 | 验收 | 依赖 | 量 |
|---|---|---|---|---|---|
| T1.1 | 根 | corepack pnpm + 脚手架(workspace/tsconfig/.npmrc/.gitattributes eol=lf) | `tsc -b` 空跑过;装包走 npmmirror | M0 | S |
| T1.2 | shared | 02 全 zod schema + validateMessage + 指纹/哈希 + jsonl + 错误码 | **先补 PRE-1**;V1–V20 全绿;buildAgentOutputJsonSchema 可用 | T1.1,PRE-1/2 | L |
| T1.3 | shared | 指纹前缀/后缀常量 + 谓词导出(吃 FEAS-6) | V16/V17 过;`isUnverifiedFp`/`isSpecFp` 入契约测试 | T1.2 | S |
| T1.4 | core | engine 循环骨架(刹车后置/runTurn/append) | FakeAdapter 驱动一轮;范式无关 | T1.2 | L |
| T1.5 | core | Blackboard(append/view/subscribe/closeRound) | append 后 subscribe 收增量;delta 只含增量 | T1.4 | M |
| T1.5b | core | **DigestBuilder v0(吃 FEAS-4)**:结构化锚点 digest | 算法钉死 03;零 NLP;**连续性验收第3轮含第1轮锚点** | T1.5 | M |
| T1.5c | agents | **只读快照 + ValidateContext(吃 FEAS-2 blocker)**:readFileRange + contentHash 复算 | critic file_ref 可复算判强/弱;远轻于写合并 | T1.2 | M |
| T1.6 | core | Playbook 接口 + red-blue(**M1 档:shouldMergeAt=false,proposer 不声明 files**,吃 FEAS-3) | 交替对抗;assignment 换边只改配置 | T1.4 | M |
| T1.7 | core | runTurn:防火墙→adapter→事件流→safeParse+重试→evidence 复算判强/弱 | 重试耗尽抛码;file_ref 复算对得上=强 | T1.5,T1.5c,T1.10 | M |
| T1.8 | core | brakes 最小集:maxRounds + done(对面带复算通过强 evidence ack) | 一方 done 不直接停 | T1.4 | M |
| T1.9 | core | jsonl 写 + 崩溃恢复重建 BoardState | 杀进程后回放重建正确(V18–V20) | T1.5,T1.2 | M |
| T1.10 | agents | codex adapter:真 exe + stdin + thread_id→session_started + output-schema 文件 + **`-s read-only`**(吃 FEAS-8) | fake-codex 集成过;首事件 session_started | T1.2,T0.7 | L |
| T1.11 | agents | claude adapter:stream-json + schema 传递 + session id + usage 归一 | fake-claude 集成过;usage 归一 | T1.2,T0.7 | L |
| T1.12 | agents | `buildChildEnv` 单一出口(env 白名单 extendEnv:false) | codex 无 ANTHROPIC_*,claude 无 OPENAI_* | T1.10/11 | S |
| T1.13 | agents | key 不进 argv 预扫描 | 含 key args 抛 PROVIDER_CONFIG_INVALID;redact 覆盖 spawnargs | T1.12 | S |
| T1.14 | agents | kill/超时杀穿 shim 背后 node | kill 后子进程回收(必要时进程树 kill) | T1.10/11,T0.5 | M |
| T1.15 | core | 内容防火墙 firewallPeerMessage(边界标记 + 注入扫描 + 路径白名单) | 注入样本降级 + 越界路径拒 | T1.2 | M |
| T1.16 | server | CLI 入口 `sylux run --playbook red-blue --task <dir>` | 驱动真实 ≥3 轮对抗(吃 FEAS-4) | T1.6/10/11/1.5c | M |
| T1.17 | server | 终端渲染器(按 round/from/role/kind 着色) | 实时气泡与 jsonl 一致 | T1.16,T1.9 | S |
| T1.18 | 全 | M1 端到端冒烟 + fixtures 回归(fake-CLI 不烧 token) | 全链路过(≥3 轮 + 强核验 + read-only 断言);`pnpm check` 绿 | T1.16/17 | M |

### 24.3 M2(Web 面板)

| ID | 包 | 任务 | 验收 | 依赖 | 量 |
|---|---|---|---|---|---|
| T2.1 | server | ws bind 127.0.0.1 + 黑板增量广播 + 初连 snapshot | 不监听非回环断言;snapshot 后收增量 | M1·T1.9 | M |
| T2.2 | server | WS 鉴权中间件(Origin 白名单 + 一次性 token) | 无 token/错 Origin 拒连 | T2.1 | M |
| T2.2b | server | **ws-ticket 签发端鉴权(吃 RS-M2)** | curl 直打无持有者凭证→拒发 control token | T2.2 | M |
| T2.3 | server | 观战/控制权限分级 | 只读连接 inject 被拒 | T2.2b | M |
| T2.4 | server | 暂停/恢复 + inject(过防火墙入黑板 from:human) | pause 挂起引擎;inject 经 firewall | T2.3,M1·T1.15 | M |
| T2.5 | server | REST 启动 run / 读改 provider(不回传 key) | 响应无 key 字段 | T2.1 | S |
| T2.6 | server | **evidence 引用预览生成(吃 COV-9,替代 diff)** | 从只读快照取行区间;diff 推迟 M3 | T2.1,M1·T1.5c | M |
| T2.12 | server | **流式跨帧 redact(吃 RS-M1)** | 跨帧分片密钥缓冲拼回仍被拦 | T2.1 | M |
| T2.13 | server | WS 协议契约(11)先定冻结供前后端并行 | 协议 schema 落地 | T2.1 | S |
| T2.7 | web | Vite+React+zustand + 原生 WS 客户端 | `pnpm dev:web` 起,连上收气泡 | T2.1 | M |
| T2.8 | web | 对话气泡(着色 + 轮数进度 + 刹车高亮) | 实时气泡与 jsonl 一致 | T2.7 | M |
| T2.8b | web | **输出转义 + CSP(吃 RS-B2 blocker)** | body 含 `<script>` 被转义不执行;CSP 头存在 | T2.7 | M |
| T2.9 | web | **evidence 引用预览面板(吃 COV-9)** | 渲染 file_ref 行区间高亮 + 降级 | T2.7,T2.6 | M |
| T2.10 | web | 暂停/介入控件(权限分级 UI) | 控制态显示,只读态隐藏 | T2.8,T2.4 | M |
| T2.11 | 全 | M2 端到端:浏览器观战+暂停+介入 | WS 鉴权 + XSS + 跨帧 redact 断言全绿 | T2.8–10,T2.8b,T2.12 | M |

## 25. 关键路径

### 25.1 关键路径图(M0 → M1 完成)

```
M0 闸(T0.1–T0.7,含 T0.5b 出网 blocker)
  └─ T1.1 脚手架
       └─ T1.2 shared(PRE-1 错误码 + 全 schema)★最重地基,所有包依赖
            ├─ T1.3 指纹常量
            ├─ T1.5c 只读快照 ValidateContext(吃 FEAS-2)
            ├─ T1.10 codex adapter ─┐
            ├─ T1.11 claude adapter ─┤ T0.7 两端对照表前置
            └─ T1.4 engine ──┬─ T1.5 Blackboard ─ T1.5b digest v0(吃 FEAS-4)
                             ├─ T1.6 red-blue playbook
                             ├─ T1.7 runTurn ── 需 1.5c + 1.10
                             ├─ T1.8 brakes
                             └─ T1.9 jsonl
                                  └─ T1.16 CLI 入口 ─ T1.17 终端渲染 ─ T1.18 端到端
```

### 25.2 瓶颈(优先级最高的卡点)

1. **T1.2 shared(L)**:所有包地基,必须最先稳定。PRE-1 错误码补全是其第一步(否则 `SyluxError` 全仓编译红)。
2. **T1.5c 只读快照(吃 FEAS-2 blocker)**:无它 M1 强核验假绿,红蓝对抗的 critic evidence 形同虚设。
3. **T0.5b 出网探针(RS-B1 blocker)**:不过则 §7.3 L4 防线失效,注入防御整体要改设计,卡 M0 闸。
4. **T1.10/T1.11 双 adapter(L)**:两端不对称吃进适配器,工作量大,依赖 T0.7 对照表。

### 25.3 可并行工作流

- shared 稳定后:adapter(T1.10/11)与 engine(T1.4–1.9)可并行(FakeAdapter 解耦)。
- M2 前后端经 T2.13 协议契约冻结后并行(server T2.1–2.13 ∥ web T2.7–2.10)。
- digest v0(T1.5b)与防火墙(T1.15)独立可并行。

---

## 26. 6–24 月远景

- **近景(3–6 月,M5 收尾延伸)**:更多内置范式(辩论赛制、多轮投票)、digest 高质量 LLM 摘要、provider panel 扩展。
- **中景(6–12 月)**:跨平台(Linux/macOS)适配层;多 run 并行编排;评测台 A/B 自动化回归基线;插件市场(第三方 Playbook/StopPolicy)。
- **远景(12–24 月)**:分布式编排(多机 worktree);更广 Fusion(决策回合多模型评审常态化);自适应范式选择(按任务特征自动选 playbook + 阈值);可观测性深化(成本归因、收敛质量画像)。

---

## 27. 代码骨架索引(指向 docs/skeleton)

> 骨架已通过 tsc 自洽校验,是本规划的可执行锚点。真实仓按 §10.2 依赖方向拆包,import 不变。

| 骨架文件 | 权威内容 | 本规划章节 |
|---|---|---|
| `src/shared/blackboard.schema.ts` | Message/Evidence/AgentEvent/Round/BoardState/jsonl 全部 zod(I1 唯一权威) | §2 |
| `src/shared/errors.ts` | `SyluxErrorCode` 全集 + 双向守卫 + `SyluxError` | §13.1 |
| `src/shared/fingerprint.ts` | normalizeContent/contentHash/fingerprint(command 不含 actual,R5) | §2.9 |
| `src/shared/validate.ts` | validateMessage 两阶段 + verifyEvidence 三态(capabilities.fs/sandbox) | §2.10 |
| `src/shared/index.ts` | 唯一进入点(下游只从 `@sylux/shared` 导入) | §10.2 |
| `src/core/engine.ts` | runEngine 主循环 + runTurn + consume + buildStopContext + EngineDeps | §3.3/§3.5 |
| `src/core/playbook.ts` | Playbook/PromptContext/DigestBuilder + buildDigestBaseline + RedBluePlaybook | §3.1/§3.2/§3.4 |
| `src/core/stop-policy.ts` | StopPolicy/三重刹车/CompositeStopPolicy/cost-model/preflightFanout | §4 |
| `src/core/blackboard.ts` | Blackboard/BoardView/BlackboardImpl + restoreBoardFromJsonl | §1.4/§2.8 |
| `src/core/_upstream.ts` | 跨包契约桩(AgentAdapter/WorktreeManager/FirewallResult/Logger 镜像) | §5/§7/§8 |
| `adapter.ts` / `codex-adapter.ts` / `claude-adapter.ts` | AgentAdapter 统一接口 + 两端实现 + 工厂签名(三参注入) | §5 |
| `spike/m0-spike.mjs` | 双 CLI 物理链路连通性 spike(零依赖,可直接 node 跑) | §22 |

---

## 28. 未决问题清单

> blocker 已全部吃掉并落章节;此处列**吸不掉的 major / 待实测分叉 / 需人拍板项**。

| 编号 | 问题 | 状态 / 处置 |
|---|---|---|
| RP9 | **T0.5b 若实测沙箱可出网** → §7.3 L4"断网兜底"失效,注入防御须改应用层强约束(无后门 spawn + 出站白名单) | 待 M0 实测;分叉路径已备(§7.3),不过闸不进 M1。**【裁决 2026-06-20】T0.5b 为 M0 唯一硬阻断:read-only 与 workspace-write 两种模式都必须测出网;任一关键路径可出网且无应用层禁 spawn / 出站白名单替代,则停在 M0,不许硬冲** |
| OQ-1 | claude `--session-id` 预设能力(T0.4) | 待 M0;不支持则对齐 codex"id 由它给"模型 |
| OQ-2 | schema 内联体积是否逼近 claude 32KB 上限(T0.2/T0.2b 两段闸) | 待 M0 下界估 + M1 dist 校准;超限退 stream-json 输入 |
| OQ-3 | claude token 计量字段名(T0.6) | 待 M0;影响适配层 usage 归一 |
| OQ-4 | 严格 structured-output 后端对 discriminatedUnion+optional 支持(H7) | 待 M0 P3;被拒走退化 schema(语义等价)。**【裁决 2026-06-20】T0.1/OQ-4 须 codex 与 claude 两端都测 discriminatedUnion+optional;任一端失败走文档退化 schema,不改 TS 类型** |
| OQ-5 | 命令复跑白名单精确成员集(node/npx 等可跑任意代码的是否剔出) | M0 前敲定(08 §4.8 与 M0 共定);否则 default-deny 为空时复跑闸虚设。**【裁决 2026-06-20】不只敲白名单,必须带负例验证:node / npx / powershell / `curl\|sh` 这类默认拒绝并测通拒绝路径,否则 command evidence 复跑闸是假安全** |
| OQ-6 | `status_changed` 独立 `code` 字段回填 02(过渡期折进 reason 前缀) | 04 §13.2;不阻断 M1 |
| OQ-7 | Round 落盘 `evidenceExpected`/`verificationDegraded` 两字段(收敛回放当前保守按 true/false 重放) | 02 回填;回放偏严可接受 |
| OQ-8 | AgentInput claude 专属字段(maxTurns/effort/appendSystemPrompt)回填 05 §2 | 06 §12.1 已登记;不阻断 |
| ~~人拍板~~ **已锁** | M1 红蓝纯决策不写文件 / digest v0 算法钉死 03 / 收敛按范式分化 / diff 推迟 M3 | **已确认锁定(Aylovelle 2026-06-20)**:四向均批准,落 §3.4/§3.2/§4.3/§8.2。原则——先把协议/证据/回合/刹车主干跑穿,不把写文件/合并/diff/LLM 摘要质量复杂度提前塞进 M1,不加戏 |

---

*(本规划 v3.1 定稿。所有 blocker 级红队 finding 已吃掉并落章节;major 已尽量吸收,吸不掉者列 §28。类型唯一权威以 `@sylux/shared` 骨架代码为准。)*

*(裁决回填 2026-06-20:四项设计选择已锁定[§28];三条 M0 执行口径已锁——T0.5b 唯一 build-stop 硬阻断[§22.3/§22.4]、OQ-5 须负例验证[T0.5c]、T0.1/OQ-4 两端测 discriminatedUnion+optional。骨架 typecheck/`tsc --noEmit` 零报错,子代理独立复核一致。规划锁,M0 按 §22/§24 开闸实测。)*
