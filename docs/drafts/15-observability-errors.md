# 15 · 可观测性与错误码(日志 / 指标 / trace / 错误码全集)v2

> **本文件地位**:sylux 的**可观测性权威设计**。负责四件事:① 结构化日志(pino 字段规范 / child 继承 / 事件命名 / 等级 / 与安全 08 redact 的集成点);② 指标(每轮 token、累积成本、延迟、重试次数、stall 计数、活跃 agent 等,含计算口径与采集点);③ trace(`run → round → turn → adapter 调用` 的关联 id 体系与跨进程传播);④ **完整错误码表**(02 §12 v2.1 已定义的 `SyluxErrorCode` **33 码全集**,每个含触发条件 / 来源模块 / 引擎处理动作 / 是否终态 / 日志等级 / 指标计数)。
>
> **v2 变更摘要(吃掉红队/交叉findings)**:
> - 🔴 **错误码全量对齐 02 §12 v2.1**(A1/COV-1/COV-4):§6 由 13 码扩到 02 v2.1 的全 33 码,`ERROR_LEVEL`/`errEvtFor` 同步穷举(§6.7);删除自维护的码子集。
> - 🔴 **文档编号锚定磁盘文件名**(COV-6/C-NUM):全文统一为 安全=08、worktree=09、面板 UI=10、WS=11、收敛刹车=04、provider=07、techstack=12、config=16。v1 用的"安全 09 / worktree 06 / 面板 08"逻辑编号全部改掉。
> - 🔴 **evidence 门收紧为"≥1 强"**(COV-10/E11):全文删"强/中"二档措辞,与 02 §3.2/§8.3 的"≥1 条强核验通过(weak 不解锁)"一致。
> - 🟠 **redact ≠ HTML escape**(RS-B2):§5 钉死「观测脱敏只抹 secret,不做 HTML 转义」,面板 DOM 注入防御(escape/CSP/sanitize)归面板 10,本文件只在出境表标注边界,不让人误以为接了 redact 就防 XSS。
> - 🟠 **流式 redact 跨帧分片**(RS-M1):§5.1 补「按帧无状态 redact 会漏跨 delta 帧拼接的密钥」的失败路径与缓解(不在 info 级透传明文 delta、跨帧不是本文件能单点解的,指向 11 的帧聚合)。
> - 🟠 **usage 缺失/字段漂移成本失明**(ROC-M1):§3.3/§3.4 区分"usage 缺失"与"usage 字段漂移",预算判定用**保守上界**而非把 output 当 0,新增 `sylux_usage_missing_total`,避免成本上限静默失效。
> - 🟢 **复跑器/沙箱自身故障分类**(COV-3):承接 02 v2.1 `EVIDENCE_INFRA_DEGRADED`,§3.2/§6 标注其 weak + system 告警、**不连坐 critic**、**不进 stall 计数**。
> - 🟢 **WORKTREE_CONFLICT 拆出独立 evt**(Q3 采纳):§2.4 新增 `ROUND_MERGE_FAILED`,不再复用 `ROUND_CLOSED`,告警面更纯净。
>
> **依赖与边界(只引用,不另写)**:
> - `Message` / `Evidence` / `AgentEvent` / `TokenUsage` / `Round` / `BoardState` / `JsonlRecord` 及全部枚举,**唯一权威是黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。本文件涉及这些类型时一律引用,绝不另写一份(焊死红队 R1)。
> - `SyluxErrorCode` 联合与 `SyluxError` 类的**定义**归 02 §12 v2.1(物理落 `@sylux/shared/src/errors.ts`)。本文件**不重新定义**联合,只为每个码补「触发 / 处理 / 观测」语义表;新增码的回填义务见 §6.6。
> - `redact()` / `redactObject()` / `SECRET_SIGNATURES` / `SENSITIVE_KEY_NAMES` 的**规则与正则**归安全文档 08 §2/§3。本文件只规定**在哪些观测出境点必须调用它们**,不另写正则。
> - **HTML 转义 / CSP / DOM sanitize**(防面板 XSS)归面板文档 10,**不是 redact 的职责**(RS-B2);本文件只在出境表标注「redact 后仍需面板侧 escape」的边界。
> - pino 选型、版本(`pino@9` + `pino-pretty` devDep)、「脱敏纵深三道」结论归技术栈 12 §5。本文件承接其骨架,补字段语义与事件目录。
> - 刹车阈值(`stallWindow` / `maxRounds` / `tokenBudget`)与收敛指纹差集算法归收敛刹车文档 04;本文件只**采集与暴露**其产生的指标,不定义阈值。
> - token 用量字段口径(`turn.completed.usage` → `TokenUsage`)归 02 §6.3 + 事实地基 D;本文件按其口径求和、累计、估价。
>
> **编号锚定声明(COV-6 裁决)**:全仓存在文件名编号派与逻辑编号派双轨制,本文件**一律锚定磁盘文件名**:`04`=收敛刹车、`05`=adapter-codex、`06`=adapter-claude、`07`=provider-config、`08`=密钥安全/内容防火墙、`09`=worktree 隔离、`10`=Web 面板 UI、`11`=WS 协议、`12`=techstack、`16`=config-schema。文中所有引用按此表读。
>
> **事实标注约定**:凡基于假设而非本机实测的结论,显式标注【待实测】。事实地基(PROBED-FACTS.md)已覆盖的(spawn / 事件流 / token 累积 / resume 参数)不再标。

---

## 0. 设计目标与不变量

### 0.1 三支柱一根轴

可观测性三支柱(logs / metrics / traces)在 sylux 里**共享同一根关联轴**:`runId → round → turn → adapterCallId`。任何一条日志、任何一个指标点、任何一段 trace span 都必须能挂回这根轴,否则「面板看到第 7 轮卡住」与「日志里某条 spawn 失败」无法对齐。这根轴的 id 体系在 §4 定义,日志(§2)与指标(§3)都引用它。

### 0.2 与 02 / 09 / 12 的职责切分(一表锁死)

| 关注点 | 本文件(15)负责 | 引用(不另写) |
|---|---|---|
| 日志字段名 / 等级 / 事件目录 | ✅ §2 | pino 选型 12 §5;redact 规则 08 §3 |
| 指标清单 / 计算口径 / 采集点 | ✅ §3 | token 字段 02 §6.3;成本模型事实地基 D;阈值 04 |
| trace id 体系 / 传播 / span 模型 | ✅ §4 | sessionId 来源 02 §6.3 / 事实地基 B |
| 错误码「触发 + 处理 + 观测」语义 | ✅ §6 | 码的**定义**与联合 02 §12 v2.1 |
| 观测数据出境的 redact 应用点 | ✅ §5(指针)| redact 实现 08 §3;HTML escape/CSP 归面板 10 |
| `Message`/`AgentEvent`/`Round` 形状 | ❌ 仅引用 | 02 权威 |

### 0.3 不变量(实现必须保持)

- **O1 一根轴**:所有结构化日志行必带 `runId`;凡发生在某轮内的,必带 `round`;凡涉及某 agent 调用的,必带 `agent` 与 `turnId`。缺轴字段的日志视为缺陷(§2.7 lint 兜)。
- **O2 出境必脱敏**:任何离开中枢内存的观测文本(日志行、指标 label、trace 属性、错误 `detail`)在序列化前必过 08 的 `redact`/`redactObject`。本文件新增的观测通路若忘接 redact,等同安全漏点(承接安全 08 S4)。**注意 redact ≠ HTML escape**:脱敏只抹 secret,不防 `<script>`;面板 DOM 注入防御归 10(RS-B2,§5)。
- **O3 计量唯一源**:token 数量**只取** `AgentEvent.final_message.usage`(源自 codex `turn.completed.usage`,中转回吐;claude 端由适配层归一,02 §6.3)。**禁止**本地估算器、禁止从 `body.length` 反推。无 usage 的轮在指标里标 `usage_missing` 而非猜值;**预算判定对缺失 usage 取保守上界**(§3.3,ROC-M1),不把 output 当 0。
- **O4 错误不吞**:每个 `SyluxError` 抛出点必产生**恰好一条** `level>=warn` 的结构化日志(带 `errCode`)+ **恰好一次**对应错误计数器自增(§3.4);catch 后静默 = 违反(承接安全 08 S9)。`EVIDENCE_INFRA_DEGRADED` 是例外(系统告警 code,非抛出错误,见 §6.3)。
- **O5 观测不改变控制流**:日志 / 指标 / trace 的采集失败(如 metrics sink 不可达)**绝不**中断 run;采集层自身的异常被吞进一条 `observability_self_error` 日志,不上抛(避免「观测把业务带崩」)。这是 O4「业务错误不吞」的**对偶**:业务错误必抛必记,观测自身错误必吞不抛。
- **O6 可回放**:关键观测事实(每轮 usage、终态原因、stall 计数)同时落 02 §7 jsonl(`round_closed.round.usage` / `status_changed.code`+`reason`)，使面板时间旅行无需依赖外部 metrics 后端即可重建成本曲线与终因。jsonl 是权威,metrics 后端是加速视图。

---

## 1. 物理落点与依赖

### 1.1 文件布局

可观测性代码主要落 `@sylux/core`(logger / metrics / trace 工厂),被 `@sylux/server`、`@sylux/agents`、引擎共用。`SyluxError` / `SyluxErrorCode` 仍在 `@sylux/shared/errors.ts`(02 §12 权威),本文件不挪。

```
packages/core/src/obs/
├─ logger.ts        # pino 根 logger 工厂 + child 约定(§2);承接 12 §5.3 骨架
├─ log-events.ts    # 事件名常量目录 LogEvent(§2.4),全项目唯一来源
├─ metrics.ts       # 指标注册表 + 采集 API(§3);prom-client 可选后端(§3.6)
├─ trace.ts         # 关联 id 生成 / span 模型 / 传播(§4)
└─ obs-context.ts   # ObsContext:把 runId/round/turnId/agent 打包随调用流转(§4.2)

packages/shared/src/
└─ errors.ts        # SyluxError / SyluxErrorCode(02 §12 权威,本文件只补语义表)
```

> 依赖方向遵循总体规划 §10:`shared ← core ← {providers, agents} ← server ← web`。`obs/*` 在 core,可依赖 shared(用 `SyluxErrorCode`、`redact`),不得反向。redact 实现若落 `@sylux/security`(08 §3.2 建议),则 core 依赖 security;若 security 并入 shared,则依赖 shared。本文件按「`redact`/`redactObject` 可从依赖低层 import」消费,不约束其最终包名(08 拥有)。

### 1.2 第三方依赖

| 库 | 版本(承接 12 §6) | 用途 | 必选? |
|---|---|---|---|
| `pino` | `~9.5.x` | 结构化日志 | 必选 |
| `pino-pretty` | `~13.x`(根 devDep) | 开发期美化,生产输出裸 JSON | 仅 dev |
| `nanoid` | 承接 12 | 关联 id 生成(turnId / adapterCallId) | 必选 |
| `prom-client` | 【待定】`~15.x` | Prometheus 指标后端(§3.6) | 可选(默认内存注册表) |

> 指标默认走**进程内内存注册表 + jsonl 投影**(O6),不强依赖 Prometheus。`prom-client` 仅在用户开启 `--metrics-port` 时挂载(§3.6),保持「本地单机优先、外部后端可选」。这与项目「本地 orchestrator」定位一致,不为观测引入重运维。

---

## 2. 结构化日志(pino)

### 2.1 为什么是结构化(而非 console.log)

中枢同时驱动两个 CLI 子进程、多轮辩论、WS 广播。纯文本日志无法按 `runId` 聚合、无法按 `round` 切片、无法机器告警。pino 输出**每行一个 JSON**,字段固定(§2.2),既能 `pino-pretty` 开发期读,又能机器投喂(grep / jq / loki)。选型论证见 12 §5.2,本节只定字段与事件。

### 2.2 字段规范(每行必带 / 条件必带 / 业务字段)

pino 行的字段分三层,**命名一律 camelCase**(与 02 类型字段一致,避免 snake/camel 混用):

| 层 | 字段 | 类型 | 何时出现 | 语义 |
|---|---|---|---|---|
| 基础(pino 自带) | `level` | int | 恒 | 30=info/40=warn/50=error/... |
| | `time` | int | 恒 | epoch ms |
| | `pid` / `hostname` | | 恒 | pino 默认;`hostname` 可在 base 里去掉(单机无意义) |
| 轴(O1) | `runId` | string | 恒(进程级 child 注入) | 关联轴根 |
| | `round` | int | 轮内事件 | 轮次,与 `Message.round` 对齐 |
| | `agent` | `AgentId` | 涉及某 agent 时 | `codex`/`claude`/`human`/`orchestrator` |
| | `role` | `Role` | 该 agent 本轮扮演角色时 | 与 `Message.role` 对齐 |
| | `turnId` | string | 一次 agent 调用内 | §4 trace id |
| | `adapterCallId` | string | 一次 adapter spawn/resume 内 | §4 trace id |
| 事件 | `evt` | `LogEvent` | 恒(强约定) | 事件名常量(§2.4),机器分类主键 |
| | `msg` | string | 恒 | 人类可读短句(pino message) |
| 错误 | `errCode` | `SyluxErrorCode` | 错误事件 | 02 §12 码 |
| | `err` | object | 错误事件 | pino `serializers.err` 序列化,堆栈过 redact |
| 业务 | `kind`/`messageId`/`inReplyTo` | | 消息相关事件 | 引用 02 `Message` 字段,不另定义 |
| | `usage`/`costUsd`/`durationMs`/`retry` | | 见 §3 口径 | 指标同源字段,日志冗余打一份便于单行排障 |

> **`evt` 是一等公民**:不靠 `msg` 文本分类事件(文本会漂),靠 `evt` 枚举(§2.4)。`msg` 只给人看。这样告警规则写 `evt == "adapter.spawn.failed"` 而非脆弱的文本匹配。

### 2.3 child logger 继承链(轴字段自动注入)

不靠每条日志手填 `runId/round`,靠 pino `logger.child()` 逐层 bind,**轴字段一次绑定、整条调用链继承**(对应 O1):

```ts
// @sylux/core/src/obs/logger.ts
import pino from 'pino';
import { redactObject } from '@sylux/shared'; // 或 @sylux/security,08 拥有

/** 根 logger:进程级,配 redact 纵深(承接 12 §5.3)。 */
export const rootLogger = pino({
  level: process.env.SYLUX_LOG_LEVEL ?? 'info',
  base: { svc: 'sylux' },                 // 去掉默认 pid/hostname 噪音可在此覆盖
  timestamp: pino.stdTimeFunctions.epochTime,
  // ① pino 路径 redact(覆盖结构化对象里的 key 字段;正则/路径归安全 08)
  redact: { paths: SYLUX_LOG_REDACT_PATHS, censor: '‹redacted›' },
  serializers: {
    // ② err 序列化:堆栈与 message 过 redact(08 §3.4 / T9)
    err: (e: unknown) => redactObject(pino.stdSerializers.err(e as Error)),
  },
  // ③ 兜底:formatters.log 对每条 mergeObject 过 redactObject(挡住 spawnargs/raw 文本,12 §5.3 第二道)
  formatters: {
    level: (label, n) => ({ level: n }),
    log: (obj) => redactObject(obj) as Record<string, unknown>,
  },
});

/** run 级 child:绑 runId,贯穿一次 run 全程。 */
export function runLogger(runId: string, playbookId: string) {
  return rootLogger.child({ runId, playbookId });
}
/** round 级 child:在 run logger 上再绑 round。 */
export function roundLogger(parent: pino.Logger, round: number) {
  return parent.child({ round });
}
/** turn 级 child:绑 agent/role/turnId,一次 agent 调用内用它打所有日志。 */
export function turnLogger(parent: pino.Logger, b: { agent: AgentId; role: Role; turnId: string }) {
  return parent.child(b);
}
```

> **redact 三道在 logger 层的落点**(12 §5.3 / 08 §3):① `redact.paths` 覆盖结构化对象里的已知 key 路径;② `serializers.err` 覆盖错误堆栈;③ `formatters.log` 对**整条 mergeObject** 过 `redactObject`,覆盖 pino 路径 redact 够不着的动态字段(如 execa `spawnargs` 数组、CLI stderr 原文)。三道叠加才完整,缺第三道则 spawnargs 里的 key 会泄(R8 命门)。
>
> **流式 delta 的跨帧分片盲区(RS-M1,失败路径)**:上述三道都是**单条日志/单帧无状态** redact。当 `AgentEvent.delta` 逐 token 透传(trace 级)或 WS 把流式增量分帧广播时,一个 `sk-ant-...` 可能被切成两个相邻 delta 帧,**各帧单独过正则都不命中**,拼接后在 spectator 端重现明文。本文件的纪律:① **默认不在 info 级透传明文 delta**(§2.5,delta 仅 trace 级、默认关);② 跨帧密钥的根治是**帧聚合后再 redact**,属 WS 协议 11 的帧重组职责(11 §8),本文件只负责"单帧出境前必过 redact"并在此显式标注盲区,不假装单帧 redact 能挡跨帧;③ secret-scan 兜底(§5 末)对落盘 jsonl/logs 做**全文**扫描(非按帧),是跨帧泄露的最后一道网。

### 2.4 事件目录(LogEvent 常量,全项目唯一来源)

`evt` 取值集中在 `@sylux/core/src/obs/log-events.ts`,**禁止散落字面量**。命名 `域.动作[.结果]`,点分层级,便于前缀告警(`adapter.*`)。

```ts
/** 结构化日志事件名。机器分类主键,禁止用 msg 文本分类。 */
export const LogEvent = {
  // —— run 生命周期 ——
  RUN_STARTED:        'run.started',
  RUN_STATUS_CHANGED: 'run.status.changed',   // running→paused/done/stalled/aborted/limit
  RUN_ENDED:          'run.ended',
  // —— round / turn ——
  ROUND_OPENED:       'round.opened',
  ROUND_CLOSED:       'round.closed',          // 带本轮 usage / 新指纹数 / 时长
  TURN_STARTED:       'turn.started',
  TURN_COMPLETED:     'turn.completed',         // 带 usage / durationMs
  // —— adapter(子进程)——
  ADAPTER_SPAWN:        'adapter.spawn',
  ADAPTER_SPAWN_FAILED: 'adapter.spawn.failed', // → SUBPROCESS_SPAWN_FAILED
  ADAPTER_SESSION:      'adapter.session',       // 收到 session_started(I5)
  ADAPTER_RESUME:       'adapter.resume',
  ADAPTER_EXIT:         'adapter.exit',          // code/signal;非零退出 → SUBPROCESS_CRASHED
  ADAPTER_TIMEOUT:      'adapter.timeout',        // 硬墙钟超时被杀 → SUBPROCESS_TIMEOUT
  ADAPTER_CANCELLED:    'adapter.cancelled',      // 人工 abort / 上层取消 → SUBPROCESS_CANCELLED
  // —— 引擎 ——
  ENGINE_FATAL:         'engine.fatal',           // 状态机非法转移等 → ENGINE_FATAL
  EMPTY_ROUND_PLAN:     'engine.empty_round_plan',// playbook 排不出发言计划 → EMPTY_ROUND_PLAN
  // —— 黑板 / 校验 ——
  MSG_APPENDED:        'board.msg.appended',
  MSG_REJECTED:        'board.msg.rejected',     // validateMessage !ok,带 errCode
  SCHEMA_RETRY:        'board.schema.retry',      // safeParse 失败重发第 k 次
  EVIDENCE_VERIFIED:   'board.evidence.verified', // 复算 pass/fail/weak 统计
  EVIDENCE_INFRA_DEGRADED: 'board.evidence.infra_degraded', // 复跑器/沙箱自身故障(02 v2.1 H12)
  // —— 刹车 / 收敛 ——
  BRAKE_TRIGGERED:     'brake.triggered',         // 带 errCode=STALL/LIMIT/BUDGET
  CONVERGENCE_SAMPLE:  'brake.convergence.sample', // 每轮新指纹差集大小
  // —— 安全 ——
  FIREWALL_HIT:        'security.firewall.hit',    // 内容防火墙特征命中 / INJECTION_BLOCKED(08)
  ARGV_SECRET_BLOCK:   'security.argv.blocked',    // argv 预扫命中 → PROVIDER_CONFIG_INVALID
  EGRESS_BLOCKED:      'security.egress.blocked',  // 中转源码出境 secret scan 命中 → EGRESS_SECRET_BLOCKED
  // —— provider / config ——
  PROVIDER_UNAVAILABLE: 'provider.unavailable',    // 中转/base_url 不可达,热换耗尽 → PROVIDER_UNAVAILABLE
  CONFIG_INVALID:       'config.invalid',          // provider/playbook/预算配置 schema 违例 → CONFIG_INVALID
  // —— worktree ——
  ROUND_MERGE_FAILED:  'worktree.merge.failed',    // round 末合并冲突,硬停 → WORKTREE_CONFLICT(Q3 拆出)
  WORKTREE_GIT_FAILED: 'worktree.git.failed',      // git add/merge/diff 子进程失败 → WORKTREE_GIT_FAILED
  // —— Fusion(远景 21) ——
  FUSION_FAILED:       'fusion.failed',            // panel/judge 失败 → FUSION_PANEL_FAILED / FUSION_JUDGE_FAILED
  // —— WS / 控制面 ——
  WS_CONNECTED:        'ws.connected',
  WS_AUTH_FAILED:      'ws.auth.failed',           // WS_UNAUTHORIZED / WS_TICKET_EXPIRED / WS_ORIGIN_REJECTED
  WS_REJECTED:         'ws.rejected',              // WS_RATE_LIMITED / WS_PAYLOAD_INVALID / WS_PROTOCOL_ERROR
  WS_CONTROL:          'ws.control',               // pause/resume/abort/inject;越权 → WS_PERMISSION_DENIED
  // —— 观测自身(O5)——
  OBS_SELF_ERROR:      'observability.self.error',
} as const;
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
```

### 2.5 日志等级约定

| level | 何时用 | 例 |
|---|---|---|
| `trace` | 逐 token delta / 逐事件透传(默认关,排障开) | `AgentEvent.delta` 透传 |
| `debug` | adapter 命令行拼装、prompt 长度、context 裁剪决策 | spawn args(已 redact)、resume 参数集 |
| `info` | 正常生命周期里程碑 | run/round/turn 起止、msg appended、session_started |
| `warn` | 可恢复异常 / 触发打回重试 / 刹车非错误终止 / 连接被拒 | `MSG_REJECTED`、`SCHEMA_RETRY`、`CONVERGENCE_STALL`、`WS_AUTH_FAILED`、`SUBPROCESS_CANCELLED` |
| `error` | run 被迫中止 / 不可恢复 | `ADAPTER_SPAWN_FAILED` 耗尽、`SUBPROCESS_CRASHED`/`SUBPROCESS_TIMEOUT`、`ENGINE_FATAL`、`ROUND_MERGE_FAILED`(WORKTREE_CONFLICT)、`PROVIDER_CONFIG_INVALID` |
| `fatal` | 中枢自身崩溃(进程级) | 未捕获异常落地前最后一条 |

> **CONVERGENCE_STALL / ROUND_LIMIT / TOKEN_BUDGET 是 `warn` 不是 `error`**:它们是**预期内的正常终止**(刹车按设计触发),不是故障。只有「本该继续却被迫中止」(spawn 失败耗尽 / 合并硬冲突 / 配置非法)才 `error`。错误码的等级映射在 §6 每码列出。

### 2.6 一条样例日志行(脱敏后)

```json
{"level":40,"time":1718870400123,"svc":"sylux","runId":"run_8af3","playbookId":"red-blue","round":7,"agent":"codex","role":"critic","turnId":"t_19ee_07_codex","evt":"board.msg.rejected","errCode":"EVIDENCE_UNVERIFIABLE","kind":"critique","messageId":"m_0f2","msg":"critique rejected: no strong evidence passed recompute","retry":2}
```

人读:run_8af3 第 7 轮,codex 扮 critic 发的 critique 被打回,因为没有任何强 evidence 复算通过(weak 不解锁,02 §8.3),这是第 2 次重发。机读:`evt+errCode` 直接进告警 / 计数。

### 2.7 日志质量 lint(O1 兜底)

- CI 加一条 grep 守卫:`@sylux/core/obs` 外**禁止直接 `import pino` / `pino()`**,必须经 `rootLogger`/`*Logger` 工厂(保证 redact 与轴字段),违者 lint fail。
- 禁止 `console.log`/`console.error` 进生产路径(ESLint `no-console`,test/dev 例外)。
- 禁止 `evt` 用裸字面量,必须引 `LogEvent` 常量(ESLint 自定义 rule 或 grep `evt:\s*['"]` 命中即 fail)。

---

## 3. 指标(metrics)

### 3.1 指标分类与命名

命名遵循 Prometheus 习惯:`sylux_<域>_<名>_<单位>`,snake_case(指标名是外部约定,与代码 camelCase 解耦),counter 以 `_total` 结尾。所有指标带公共 label `{runId, playbookId}`;轮级指标加 `{round}`;agent 级加 `{agent, role}`。

> **label 基数控制**:`runId`/`turnId` 是高基数,**不**作为 Prometheus label 滥用(会撑爆时序库)。策略:Prometheus 后端只暴露**聚合指标**(按 `playbookId`/`agent` 聚合,runId 仅当前活跃 run 短期保留);**逐 run 明细**走 jsonl(O6)与面板内存态,不进时序库。这避免「每个 run 一条新时间线」的基数爆炸。

### 3.2 指标清单(权威表)

| 指标名 | 类型 | labels | 口径 / 采集点 | 服务于 |
|---|---|---|---|---|
| `sylux_run_active` | Gauge | playbookId | 当前 running 状态 run 数(±1) | 面板总览 |
| `sylux_round_total` | Counter | playbookId | 每开一轮 +1(`ROUND_OPENED`) | 轮数趋势 |
| `sylux_round_duration_ms` | Histogram | playbookId | `round.endedAt-startedAt`(`ROUND_CLOSED`) | 轮延迟分布 |
| `sylux_turn_duration_ms` | Histogram | agent,role | 一次 agent 调用 wall-clock(spawn→final_message) | 两端速度对比 |
| `sylux_tokens_input_total` | Counter | agent | Σ `usage.inputTokens`(O3,每 `TURN_COMPLETED`) | 成本(事实地基 D) |
| `sylux_tokens_cached_input_total` | Counter | agent | Σ `usage.cachedInputTokens` | 缓存命中观察 |
| `sylux_tokens_output_total` | Counter | agent | Σ `usage.outputTokens` | 成本 |
| `sylux_tokens_reasoning_total` | Counter | agent | Σ `usage.reasoningOutputTokens` | 成本(o系/gpt5 推理) |
| `sylux_usage_missing_total` | Counter | agent | `final_message` 无 usage 字段的 turn 数(O3 / ROC-M1) | 成本失明预警 |
| `sylux_round_input_tokens` | Gauge | round | 本轮累计 input(累积曲线,事实地基 D) | 成本曲线 / 刹车预算 |
| `sylux_cost_usd_total` | Counter | agent | token×单价(§3.3 估价表) | 真金白银上限 |
| `sylux_schema_retry_total` | Counter | agent | safeParse 失败重发次数(`SCHEMA_RETRY`) | 输出对齐稳定性 |
| `sylux_msg_rejected_total` | Counter | agent,errCode | `MSG_REJECTED` 按码计数 | 协议违规 / 红队无效发言 |
| `sylux_evidence_verify_total` | Counter | result | verifyEvidence `pass`/`fail`/`weak`/`infra`(02 §8.3,result=infra 不连坐) | 证据质量 |
| `sylux_convergence_new_fp` | Gauge | round | 本轮新增 evidence 指纹差集大小(02 §9.3) | stall 预警 |
| `sylux_stall_window` | Gauge | runId | 连续无新指纹轮数 / `stallWindow` | stall 进度条 |
| `sylux_brake_triggered_total` | Counter | errCode | 刹车触发(STALL/LIMIT/BUDGET) | 终因分布 |
| `sylux_adapter_spawn_total` | Counter | agent,result | spawn 成功/失败(`ADAPTER_SPAWN*`) | 适配层健康 |
| `sylux_error_total` | Counter | errCode,module | 每个 `SyluxError` 抛出 +1(O4) | 全局错误面板 |
| `sylux_ws_clients` | Gauge | — | 当前 WS 连接数 | 控制面 |
| `sylux_obs_self_error_total` | Counter | — | 观测自身异常(O5) | 观测健康 |

### 3.3 成本估价口径(token → USD)

token 数是硬事实(O3);单价是**可配置**(provider 文档 07 的 provider 配置里带 `pricing`,中转价 ≠ 官方价)。估价公式:

```
costUsd(turn) = inputTokens      / 1e6 * price.inputPerM
              + outputTokens     / 1e6 * price.outputPerM
              + reasoningTokens  / 1e6 * price.reasoningPerM   // 缺省并入 output 价
              - cachedInputTokens/ 1e6 * price.cacheDiscountPerM // 缓存折扣(若 provider 计费区分)
```

- `price.*` 缺省为 0(未配价 → 成本显示为「token only, 价未配」,不报错)。
- **累积成本** = Σ 各 turn,直接对应事实地基 D:N 轮辩论总成本 ≈ base×(1+2+…+N),`sylux_round_input_tokens` 的上升曲线是这条超线性的可视化。
- 估价仅用于**展示与 `TOKEN_BUDGET_EXCEEDED` 判定**;判定优先按 token 数(硬事实),USD 是次级展示(避免价配错导致误刹/漏刹)。【待实测】中转 mouubox 是否对 cached_input 给折扣计费,影响 `cacheDiscountPerM` 默认值;M1 对账实测。

#### 3.3.1 usage 缺失 / 字段漂移下的成本判定(ROC-M1,焊死成本失明)

红队 ROC-M1 命门:若 CLI 升级改了 `turn.completed.usage` 字段名,或某端干脆不回 usage,而成本上限仅按"已知 input 地板 + output 当 0"算,则用户设的 `$12` 上限挡不住真实 `$40+`,**刹车静默失明**。本文件区分两种缺失并都按**保守上界**处理:

| 情形 | 检测 | 展示成本(`cost_usd_total`) | 预算判定(`TOKEN_BUDGET_EXCEEDED`)用值 |
|---|---|---|---|
| usage 完整 | 字段齐全且 ≥0 | 按 §3.3 公式精确 | 精确值 |
| **usage 缺失**(无该字段) | `final_message.usage == null` | 不计入(标 `usageMissing`,避免假低) | **保守上界**:input 取本轮历史地板(事实地基 D 累积值,≈18.7k×轮次),output 取 `input × outputRatioCeil`(默认 1.0,不当 0) |
| **usage 字段漂移**(部分字段缺/类型变) | 19 §6.3 标 degradable,本文件按"已知字段取值、缺失字段按上界补" | 已知字段精确 + 缺失字段上界 | 同上,缺失分量取上界 |

- **原则**:展示侧宁可标"未知"也不假低;**预算侧宁可早停也不漏停**——缺失分量一律取保守上界喂刹车(`estimateCostUsdForBudget` 与展示用 `estimateCostUsd` 是两个函数,§3.4)。这把 ROC-M1 的"$12 挡不住 $40"反过来变成"宁可在 $12 早停"。
- `outputRatioCeil` 默认 1.0(output 不超 input 量级,经验上界),可在 provider 配置(07)按模型覆盖;【待实测】M1 用真实 8-round 数据校准该比例。
- `sylux_usage_missing_total{agent}` 每命中缺失 +1;**连续 ≥2 轮缺失**应在面板打橙色告警(成本曲线进入"估算模式"),提示用户 CLI usage 字段可能已漂移(对接 19 §6.3 的 degradable 监控)。

### 3.4 采集 API(与日志同源,一次产生双写)

指标采集与日志在**同一采集点**触发(不分两套埋点),避免「日志打了但指标漏了」。封装 `recordTurnCompleted` 等高层 API,内部既打日志又自增指标:

```ts
// @sylux/core/src/obs/metrics.ts
export interface MetricsSink {
  counter(name: string, labels: Record<string, string>, inc?: number): void;
  gauge(name: string, labels: Record<string, string>, value: number): void;
  histogram(name: string, labels: Record<string, string>, value: number): void;
}

/** 一次 turn 完成:日志 + 指标 + jsonl(round_closed 时)三处同源写。 */
export function recordTurnCompleted(
  log: pino.Logger,
  sink: MetricsSink,
  ev: { agent: AgentId; role: Role; turnId: string; usage?: TokenUsage; durationMs: number; pricing?: Pricing },
): void {
  const { agent, role, usage, durationMs } = ev;
  log.info({ evt: LogEvent.TURN_COMPLETED, agent, role, turnId: ev.turnId, usage, durationMs }, 'turn completed');
  sink.histogram('sylux_turn_duration_ms', { agent, role }, durationMs);
  if (usage) {
    sink.counter('sylux_tokens_input_total', { agent }, usage.inputTokens);
    sink.counter('sylux_tokens_cached_input_total', { agent }, usage.cachedInputTokens);
    sink.counter('sylux_tokens_output_total', { agent }, usage.outputTokens);
    sink.counter('sylux_tokens_reasoning_total', { agent }, usage.reasoningOutputTokens);
    if (ev.pricing) sink.counter('sylux_cost_usd_total', { agent }, estimateCostUsd(usage, ev.pricing));
  } else {
    // O3:无 usage 不猜值;展示侧标缺失,预算侧由 §3.3.1 取保守上界(ROC-M1)
    sink.counter('sylux_usage_missing_total', { agent }, 1);
    log.warn({ evt: LogEvent.TURN_COMPLETED, agent, turnId: ev.turnId, usageMissing: true }, 'turn completed without usage; budget uses conservative upper bound');
  }
}

/** 复跑器/沙箱自身故障(02 v2.1 H12,EVIDENCE_INFRA_DEGRADED):system 告警,不连坐 critic、不进 stall 计数。
 *  注意:这是系统降级告警而非抛出的 SyluxError,不走 recordError、不自增 sylux_error_total(O4 例外)。 */
export function recordEvidenceInfraDegraded(
  log: pino.Logger, sink: MetricsSink, ev: { agent: AgentId; turnId: string; reason: string },
): void {
  log.warn({ evt: LogEvent.EVIDENCE_INFRA_DEGRADED, errCode: 'EVIDENCE_INFRA_DEGRADED', agent: ev.agent, turnId: ev.turnId }, `evidence recompute infra degraded: ${ev.reason}`);
  sink.counter('sylux_evidence_verify_total', { result: 'infra' }, 1);
}

/** 每个 SyluxError 抛出点统一经此:一条 warn/error 日志 + 一次错误计数(O4)。 */
export function recordError(log: pino.Logger, sink: MetricsSink, err: SyluxError, module: string): void {
  const level = ERROR_LEVEL[err.code]; // §6 映射表,warn|error
  log[level]({ evt: errEvtFor(err.code), errCode: err.code, err, module }, err.message);
  sink.counter('sylux_error_total', { errCode: err.code, module }, 1);
}
```

### 3.5 延迟与重试的精确口径(避免歧义)

| 指标 | 起点 | 终点 | 备注 |
|---|---|---|---|
| `turn_duration_ms` | adapter 决定调用(spawn 前) | 收到 `final_message` 且 safeParse **首次**返回 | 含重试则按**首次成功**计;重试耗时进 `schema_retry` 维度 |
| `round_duration_ms` | `ROUND_OPENED` | `ROUND_CLOSED`(本轮全部 turn + 合并 + 校验完) | 含 worktree 合并(06) |
| `schema_retry_total` | — | — | 每次 `OUTPUT_SCHEMA_VIOLATION` 触发的重发 +1;耗尽抛错另计 `error_total` |
| `spawn` wall-clock | `child_process.spawn` 调用 | 收到 `session_started`(I5) | 拿不到 session_started 即崩 → 计 `spawn.failed`,不计 duration |

> **重试与 turn 时长解耦**:一次 turn 内若发生 K 次 schema 重发,`turn_duration` 仍记一个值(到首个合法 final_message),K 进 `schema_retry_total`。这样「慢」与「反复违规」两个问题在指标上可分。

### 3.6 指标后端(可选,默认内存 + jsonl)

- **默认**:`InMemorySink`(进程内 Map),面板经 WS 拉当前快照;历史靠 jsonl 投影(O6)重算成本曲线。零外部依赖,符合本地单机定位。
- **可选**:`--metrics-port <p>` 启用 `prom-client`,暴露 `/metrics`(仅 127.0.0.1 绑定,承接安全 08 §5 控制面最小暴露)。label 基数按 §3.1 收敛。
- **采集失败处理**(O5):`MetricsSink` 任一方法内部异常被 try/catch 吞进一条 `OBS_SELF_ERROR` 日志 + `sylux_obs_self_error_total` 自增,**绝不**上抛中断 run。

---

## 4. Trace —— run → round → turn → adapter 调用

### 4.1 关联 id 体系(一根轴的具体 id)

sylux 不强依赖外部 trace 后端(Jaeger 等),而是用**确定性可读的关联 id** 把日志 / 指标 / jsonl / 面板四处串起来。id 层级与生成规则:

| 层级 | id 字段 | 生成 | 格式 | 寿命 |
|---|---|---|---|---|
| run | `runId` | 中枢启动时 | `run_<nanoid8>` | 一次 orchestrator 运行 |
| round | `round`(int)+ 派生 `roundId=runId:r{round}` | 引擎开轮 | `run_8af3:r7` | 一轮 |
| turn | `turnId` | adapter 调用前 | `t_<runId短>_<round>_<agent>[_<seq>]` | 一次 agent 发言 |
| adapter call | `adapterCallId` | 每次 spawn/resume | `ac_<nanoid8>` | 一次子进程调用 |
| session(外部) | `sessionId` | 子进程回吐(I5) | codex=`thread_id`(事实地基 B)/claude=其 session id | 跨轮 resume |

> `turnId` 故意**可读且确定**(含 round+agent),便于人在日志里肉眼对齐;`adapterCallId` 用随机 nanoid(一个 turn 可能含多次 adapter 调用:首发 + K 次 schema 重发,各一个 adapterCallId,但同一 turnId)。`sessionId` 是**外部系统 id**(02 §6.3),不由我们生成,只记录与映射。

### 4.2 ObsContext —— 随调用流转的轴载体

不靠全局变量传轴(并发多 run 会串),用显式 `ObsContext` 对象沿调用链传递,每层派生子上下文:

```ts
// @sylux/core/src/obs/obs-context.ts
export interface ObsContext {
  readonly runId: string;
  readonly playbookId: string;
  readonly round: number;
  readonly turnId?: string;
  readonly adapterCallId?: string;
  readonly agent?: AgentId;
  readonly role?: Role;
  readonly log: pino.Logger;   // 已 bind 当前层轴字段的 child(§2.3)
  readonly sink: MetricsSink;
}

/** 派生 turn 级上下文:绑 agent/role/turnId,生成新 child logger。 */
export function forTurn(ctx: ObsContext, agent: AgentId, role: Role, seq = 0): ObsContext {
  const turnId = `t_${ctx.runId.slice(4, 8)}_${ctx.round}_${agent}${seq ? `_${seq}` : ''}`;
  return { ...ctx, agent, role, turnId, log: turnLogger(ctx.log, { agent, role, turnId }) };
}
/** 派生 adapter 调用级上下文:每次 spawn/resume 一个新 adapterCallId。 */
export function forAdapterCall(ctx: ObsContext): ObsContext {
  const adapterCallId = `ac_${nanoid(8)}`;
  return { ...ctx, adapterCallId, log: ctx.log.child({ adapterCallId }) };
}
```

> `ObsContext` 由引擎在开 run/开轮/派发 turn 时逐层构造,向下传给适配层(04)。适配层用 `ctx.log`/`ctx.sink` 打点,无需知道全局状态。这让「哪条 spawn 属于哪轮哪 agent」永远确定。

### 4.3 span 模型(轻量,日志成对 + 时长)

不引 OpenTelemetry SDK(对单机本地过重),用「**成对事件 + durationMs**」近似 span:每个可观测区间打一对 `*.started` / `*.completed`(或 `*.failed`),`completed` 带 `durationMs`。span 嵌套关系由 id 层级隐式表达(`adapterCallId` ⊂ `turnId` ⊂ `roundId` ⊂ `runId`)。

```
run.started ─┬─ round.opened ─┬─ turn.started(t_8af3_7_codex) ─┬─ adapter.spawn(ac_x1)
             │                │                                ├─ adapter.session(sessionId)
             │                │                                └─ turn.completed(durationMs, usage)
             │                ├─ turn.started(t_8af3_7_claude) ── ...
             │                └─ round.closed(durationMs, usage, newFp)
             └─ round.opened(r8) ...
run.ended(status, reason)
```

> 【待实测 / 可选演进】若后续要接 OTel,`ObsContext` 已是天然的 span 载体:`runId`→trace_id、`turnId`/`adapterCallId`→span_id 可一一映射,届时在 `forTurn`/`forAdapterCall` 里额外起 OTel span 即可,不动调用方。当前不引,保持轻。

### 4.4 跨进程边界(中枢 ↔ CLI 子进程)

trace 轴**不穿透**进 CLI 子进程内部(codex/claude 是黑盒,无法注入我们的 trace header)。边界处的衔接靠:
- 出:`adapter.spawn` 日志记录拼好的命令行(已 redact,§2.3 第三道)、`adapterCallId`、prompt 长度。
- 入:子进程 `AgentEvent` 流(02 §6.3)的每类事件由适配层挂上当前 `turnId`/`adapterCallId` 再打日志 / 喂指标。`session_started.sessionId` 记入 `adapter.session` 事件并回填 `BoardState.agents[agent].sessionId`(02 §10.2)。
- token:`final_message.usage` 是唯一跨界计量入口(O3),在适配层 emit 处即 `recordTurnCompleted`。

---

## 5. 观测出境点的 redact 应用清单(O2,指针表)

redact 的**规则 / 正则 / 实现**全归安全 08 §2/§3,本节只钉死「可观测性新增的出境通路在哪调它」,确保无遗漏(承接安全 08 S4「新增出境通路必须接 redact」)。

| 出境通路 | 应用点(本文件代码) | 调用 | 漏接后果 |
|---|---|---|---|
| pino 结构化对象 | `rootLogger.formatters.log` | `redactObject(obj)`(§2.3 第三道) | spawnargs / 动态字段泄 key(R8 命门) |
| pino 错误堆栈 | `rootLogger.serializers.err` | `redactObject(stdSerializers.err(e))` | 堆栈泄 key/路径(T9) |
| pino 已知路径 | `rootLogger.redact.paths` | pino 内建 censor | 配置对象里 `*.apiKey` 泄露 |
| 指标 label 值 | `MetricsSink` 写入前 | label 值过 `redact()`(防 errCode 外的自由文本 label) | 理论上 label 只用枚举,但 `module`/动态值兜底 |
| trace 属性 / `turnId` | 构造时 | turnId 由 runId+round+agent 派生,无 secret;不额外 redact | — |
| 错误 `detail` | `recordError` 前 | `SyluxError.detail` 经 `redactObject`(承接 08 §3.4) | detail 泄 key(T9) |
| WS 广播观测帧 | WsHub 广播前(面板 10 / WS 11) | 帧过 `redactObject`(11 §8,本文件不另写) | 观战者看到 key(T1/T5) |
| 流式 delta 帧 | WS 11 帧聚合后 | **跨帧聚合后**再 `redactObject`(11 §8,RS-M1) | 单帧 redact 漏跨帧拼接的 key(§2.3 盲区) |
| jsonl 观测记录 | `encodeJsonlLine` 上游(02 §7.2) | `round_closed.usage` 无 secret;`status_changed.reason` 过 redact | 审计日志泄 key(T1) |
| **面板 DOM 渲染** | **不在本文件**(归面板 10) | `redact` **不负责** HTML escape;面板需 escape/CSP/sanitize | redact 后仍 XSS:agent 在 body/文件名塞 `<script>`,观战者持 control 被代发 abort/inject(RS-B2) |

> **关键纪律一(redact)**:本文件凡新增一个会把文本送出内存的观测点,必须在本表登记并接 redact;CI 的 secret-scan(12 §6 / 安全 08 §9)对 `logs/`、jsonl、`/metrics` 输出抽样扫 `sk-`/base64/`Bearer`,命中即 fail,作为「忘接 redact」的最后一道网。secret-scan 是**全文扫描**(非按帧),也是跨帧分片(RS-M1)的兜底。
>
> **关键纪律二(redact ≠ escape,RS-B2)**:脱敏与 XSS 防御是**两件正交的事**。redact 把 `sk-...` 换成 `‹redacted›`,但**不会**把 `<script>` 变成 `&lt;script&gt;`。观测文本里的 agent 自由文本(message body、文件名、quote、错误 detail)经 WS 进入面板 DOM 时,**HTML 转义 / CSP / sanitize 归面板 10 的职责**,本文件的出境点只保证「不泄 secret」,不保证「不带可执行标记」。把两者混为一谈会留下 RS-B2 的整片 XSS 威胁面——面板 10 必须独立处理,本表此行只作边界提醒,不在本文件实现。

---

## 6. 错误码全集(触发 / 来源 / 处理 / 观测)

> **定义权威在 02 §12 v2.1**(`SyluxErrorCode` 联合 **33 码** + `SyluxError` 类,落 `@sylux/shared/errors.ts`)。本节为每个码补「触发条件 / 来源模块 / 引擎处理动作 / 是否终态 / 日志等级 / 指标」的完整语义,作为实现与排障的单一查询表。**不在此重新定义联合**(引用 02);本节表与 02 §12 union 一一对应,缺一即 §6.7 的 `Record` 穷举编译红(这是特性)。新增码的回填义务见 §6.6。

### 6.1 错误码总览表(33 码,对齐 02 §12 v2.1)

按 02 v2.1 的分域排列(★=02 拥有契约语义,其余字面量集中登记在 02 但语义归对应文档)。

| 错误码 | 来源模块 | 触发条件(一句话) | 终态? | level | `evt` |
|---|---|---|---|---|---|
| ★`OUTPUT_SCHEMA_VIOLATION` | shared 校验 02 §8 | safeParse / 跨字段结构违例,重发耗尽 | 本轮该 agent 失败 | warn(重试)→error(耗尽) | `board.schema.retry`/`board.msg.rejected` |
| ★`EVIDENCE_REQUIRED` | shared 校验 02 §8 | critic/critique/ack(done) 空 evidence | 否(打回重发) | warn | `board.msg.rejected` |
| ★`EVIDENCE_UNVERIFIABLE` | shared 校验 02 §8 | evidence 锚点复算无一条**强**核验通过(weak 不解锁) | 否(打回重发) | warn | `board.msg.rejected` |
| ★`EVIDENCE_COMMAND_UNSAFE` | shared 校验 02 §8.1 | command 证据复跑违反沙箱安全(curl\|sh / 疑似 key) | 否(该证据 fail,记无效发言) | warn | `board.msg.rejected` |
| ★`EVIDENCE_INFRA_DEGRADED` | shared/复跑器 02 §8.4 | 复跑器/沙箱**自身**故障(非 agent 过错) | 否(该证据 weak,**不连坐 critic**) | warn(系统告警) | `board.evidence.infra_degraded` |
| ★`MESSAGE_SIZE_EXCEEDED` | shared 校验 02 §8(C10) | 单条 message 超 `MAX_MESSAGE_BYTES` | 否(打回 / 截断重发) | warn | `board.msg.rejected` |
| ★`WORKTREE_PATH_VIOLATION` | shared 校验 02 §8(C6) | files/file_ref/renamedFrom 路径越界 / 含 `..` | 否(打回 + 记 system) | warn | `board.msg.rejected` |
| ★`DANGLING_REPLY_REF` | shared 校验 02 §8(C8) | inReplyTo 指向不存在消息 | 否(打回) | warn | `board.msg.rejected` |
| ★`INVALID_DONE_SELF_ACK` | shared 校验 02 §8(C3) | 同轮 from 既 done 又自 ack | 否(打回) | warn | `board.msg.rejected` |
| ★`INVALID_SYSTEM_SENDER` | shared 校验 02 §8(C7/C9) | system 消息 from 非 orchestrator,或反向 | 否(打回 / 疑似伪造) | warn | `board.msg.rejected` |
| ★`EMPTY_ROUND_PLAN` | 引擎 03 §5.1/§8 | playbook 排不出本轮发言计划 | 是(引擎无法推进) | error | `engine.empty_round_plan` |
| `SUBPROCESS_SPAWN_FAILED` | adapter 05/06 | 子进程 spawn 失败 / `session_started` 前崩 | 重试耗尽则是 | warn(重试)→error(耗尽) | `adapter.spawn.failed` |
| `SUBPROCESS_CRASHED` | adapter 05/06 | 运行中非零退出 / 信号杀(闸门后) | 重试耗尽则是 | error | `adapter.exit` |
| `SUBPROCESS_TIMEOUT` | adapter 05/06(01 §3.5) | turn 硬墙钟超时被杀 | 重试耗尽则是 | error | `adapter.timeout` |
| `SUBPROCESS_CANCELLED` | adapter 05 / 引擎 03 | 人工 abort / 上层取消杀进程 | 是(受控取消) | warn | `adapter.cancelled` |
| `ENGINE_FATAL` | 引擎 03/01 | 状态机非法转移等未预期内部错 | 是(run 崩) | error | `engine.fatal` |
| `ROUND_LIMIT_EXCEEDED` | 刹车 04 | round 数触顶 maxRounds | 是(正常终止) | warn | `brake.triggered` |
| `CONVERGENCE_STALL` | 刹车 04(02 §9.3) | 连续 stallWindow 轮无新指纹 | 是(正常终止) | warn | `brake.triggered` |
| `TOKEN_BUDGET_EXCEEDED` | 刹车 04(事实地基 D) | 累计 token/成本触顶(缺 usage 按上界,§3.3.1) | 是(正常终止) | warn | `brake.triggered` |
| `PROVIDER_CONFIG_INVALID` | provider 05 / 安全 08 | argv 预扫命中 sk-/base64,或 provider 配置非法 | 是(该 run 起不来) | error | `security.argv.blocked` |
| `INJECTION_BLOCKED` | 安全 08 §4.5(03 §2.3) | 内容防火墙拦下喂对面的注入特征 | 否(剥离 / 打回,记安全画像) | warn | `security.firewall.hit` |
| `EGRESS_SECRET_BLOCKED` | 安全 08 §8 | 中转源码出境 secret scan 命中 | 是(阻断出境) | error | `security.egress.blocked` |
| `WS_UNAUTHORIZED` | WS 11 §11 | ticket 无效 / 缺失 | 否(拒连,run 不受影响) | warn | `ws.auth.failed` |
| `WS_ORIGIN_REJECTED` | WS 11 §11 | Origin 不在白名单 | 否(拒连) | warn | `ws.auth.failed` |
| `WS_TICKET_EXPIRED` | WS 11 §11 | 一次性 token 过期 / 已用 | 否(拒连) | warn | `ws.auth.failed` |
| `WS_PERMISSION_DENIED` | WS 11 §11 | 观战权限尝试 control 操作 | 否(拒操作) | warn | `ws.control` |
| `WS_RATE_LIMITED` | WS 11 §11 | 连接 / 消息超频 | 否(限流) | warn | `ws.rejected` |
| `WS_PAYLOAD_INVALID` | WS 11 §11 | 入站控制帧 schema 违例 | 否(丢帧) | warn | `ws.rejected` |
| `WS_PROTOCOL_ERROR` | WS 11 §11 | 帧序 / 版本不匹配 | 否(断连) | warn | `ws.rejected` |
| `WORKTREE_CONFLICT` | worktree 09 | round 末合并冲突,硬停回灌 | 是(需人工 / 回灌) | error | `worktree.merge.failed` |
| `WORKTREE_GIT_FAILED` | worktree 09 §12 | git add/merge/diff 子进程失败 | 视情况(重试或硬停) | error | `worktree.git.failed` |
| `FUSION_PANEL_FAILED` | Fusion 21 §9.3 | panel 成员多数失败,无法合成 | 该决策回合失败 | error | `fusion.failed` |
| `FUSION_JUDGE_FAILED` | Fusion 21 §9.3 | judge 裁决失败 / 超时 | 该决策回合失败 | error | `fusion.failed` |
| `PROVIDER_UNAVAILABLE` | provider 05 / config 16 | 中转/base_url 不可达,热换兜底耗尽 | 是(无可用 provider) | error | `provider.unavailable` |
| `CONFIG_INVALID` | config 16 §13 | provider/playbook/预算配置 schema 违例 | 是(起不来) | error | `config.invalid` |

> level 的「重试中 vs 耗尽」:`OUTPUT_SCHEMA_VIOLATION`/`SUBPROCESS_SPAWN_FAILED` 在重试窗口内每次打 `warn`(`SCHEMA_RETRY`/`ADAPTER_SPAWN`),**耗尽抛出**那一刻打 `error` + `error_total` 自增(O4)。打回类(EVIDENCE_*/DANGLING/INVALID_*/MESSAGE_SIZE)每次都是 `warn`,不升级 error(它们由 agent 自我修正,属正常对抗流程)。`EVIDENCE_INFRA_DEGRADED` 虽 level=warn,但**走 `recordEvidenceInfraDegraded` 而非 `recordError`**,不自增 `sylux_error_total`(它是系统降级告警,非 agent/业务错误,O4 例外,§6.3)。
>
> **WS 类码与 run 解耦**:`WS_*` 七码都不终止 run(连接被拒/限流不影响辩论本身),level 一律 warn;它们计 `sylux_error_total{module=ws}` 但不进 `brake_triggered`、不写 `status_changed`。这是「观测不改变控制流」(O5)在错误码层面的体现——观战者掉线不该把辩论带停。
>
> **CONFIG_/PROVIDER_ 类的来源**:M0/M1 配置加载阶段(16)在 spawn 任何子进程**之前**抛,与 `PROVIDER_CONFIG_INVALID` 同属"run 起不来",但 `PROVIDER_CONFIG_INVALID` 特指 argv 里现 key(安全),`CONFIG_INVALID`/`PROVIDER_UNAVAILABLE` 是配置/连通性(16)。

### 6.2 配置 / 启动类(run 起不来)

**`PROVIDER_CONFIG_INVALID`**
- 触发:① `assertArgvNoSecret`(05 §6.4 / 安全 08 §2)在拼 CLI args 时命中 `sk-`/`sk-ant-`/`Bearer`/长 base64;② provider 配置缺 `base_url`/`model`/`wire_api` 或 schema 非法(07)。
- 处理:**启动前**抛,该 run 直接 `aborted`,不 spawn 任何子进程。绝不降级「先跑起来再说」(key 进 argv 是不可逆泄露)。
- 观测:`error` 级,`evt=security.argv.blocked`,`detail` 经 redact(**绝不**把命中的疑似 key 原文打日志,只记「命中签名 `<sig.name>` 在 arg 第 i 位」)。`sylux_error_total{errCode,module=provider}` +1。
- 恢复:人工改 provider 配置(走 env/auth.json,08 §2)后重启 run。

**`CONFIG_INVALID` / `PROVIDER_UNAVAILABLE`**(config 16)
- 触发:`CONFIG_INVALID` = M0/M1 加载 provider/playbook/预算配置时 zod schema 违例(16 §13);`PROVIDER_UNAVAILABLE` = 配置合法但 `base_url` 不可达且热换兜底 provider 全部耗尽(中转挂了)。
- 处理:均在 spawn 前/连通性探测阶段抛,run `aborted`;`PROVIDER_UNAVAILABLE` 若发生在运行中(中转中途挂),引擎按当前轮失败处理并尝试热换(07),全耗尽才终态。
- 观测:`error`,`evt=config.invalid` / `provider.unavailable`,`module=config`/`provider`。`detail` 记非法字段路径(config)或不可达 base_url 主机(provider,**不含 key**)。

**`SUBPROCESS_SPAWN_FAILED`**
- 触发:`child_process.spawn` 抛(exe 路径错 / 权限 / Win32 不可执行,事实地基 A),或进程在 `session_started`(I5)之前退出 / 崩溃。
- 处理:适配层 emit `{kind:'error', code:'SUBPROCESS_SPAWN_FAILED', detail}`,**不**先发 `session_started` → 中枢标 `resumable=false`(02 §6.3 失败路径)→ 引擎按「全新会话」重试 ≤N 次;耗尽则该 run `aborted`,写一条 `kind:'system'`(from=orchestrator)记录终因。
- 观测:重试中 `warn`+`adapter.spawn`;耗尽 `error`+`adapter.spawn.failed`+`sylux_adapter_spawn_total{result=failed}`+`sylux_error_total`。`detail` 含 exe 路径(非 secret,可留)、退出码 / 信号。
- 边界:Windows 下务必区分「裸名 shim 报 %1 not valid」与「真 exe 崩溃」(事实地基 A)——前者是 M0 路径解析 bug(配置问题),后者是运行时失败;日志 `detail` 要能区分,便于定位是配置还是中转挂了。

**`SUBPROCESS_CRASHED` / `SUBPROCESS_TIMEOUT` / `SUBPROCESS_CANCELLED`**(adapter 05/06,运行期)
- 区分:三者都发生在 `session_started` **之后**(已起来过),与 `SUBPROCESS_SPAWN_FAILED`(起来前)正交。
  - `SUBPROCESS_CRASHED`:闸门后非零退出 / 被信号杀(中转中途断、CLI 自身 panic)。`evt=adapter.exit`,`detail` 含 `code`/`signal`。
  - `SUBPROCESS_TIMEOUT`:turn 超过 `hardTimeoutCeilingMs`(05)墙钟,中枢主动 kill。`evt=adapter.timeout`,`detail` 含已等待 ms 与上限。这是 ROC-M5「panel 扇出/单 turn 无 token 上限只靠墙钟兜底」的兜底点之一。
  - `SUBPROCESS_CANCELLED`:人工 abort(WS control)或上层取消(stall/budget 已触发要收尾)杀进程。**level=warn**(受控停止,非故障),`evt=adapter.cancelled`。
- 处理:`CRASHED`/`TIMEOUT` 按可重试处理(≤N 次全新会话),耗尽该 run 终态;`CANCELLED` 不重试(是用户/引擎主动要停)。
- 观测:`CRASHED`/`TIMEOUT` 重试中 warn、耗尽 error + `sylux_error_total`;`CANCELLED` 恒 warn,计 `sylux_error_total{errCode=SUBPROCESS_CANCELLED}` 但不视为故障(面板不红只灰)。

**`ENGINE_FATAL` / `EMPTY_ROUND_PLAN`**(引擎 03/01)
- `ENGINE_FATAL`:状态机非法转移、不变量被破坏等**未预期**内部错(兜底 catch,01 §4.4 / 03 §5.1)。`error`,`evt=engine.fatal`,run `aborted`,`detail` 带 `cause` 堆栈(过 redact)。这是「不该发生」的码,命中即 bug,应 CI/告警高优先。
- `EMPTY_ROUND_PLAN`:playbook 在某轮排不出任何发言计划(turns 为空,03 §5.1/§8 的防御)。`error`,`evt=engine.empty_round_plan`,通常是 playbook 配置或停止条件逻辑 bug;引擎不空转,直接终态并记 `system` 说明哪个 playbook 哪轮排空。

### 6.3 契约校验类(打回重发,正常对抗流程)

这一组全部来自 `validateMessage`(02 §8),**绝大多数不终止 run**——它们是「唱反调」机制的正常工作产物(critic 被要求补证据正是设计目的)。引擎动作统一:打回 → 经内容防火墙(09)包边界标记后回灌错误详情 → 重发该 agent ≤N 次。

**`OUTPUT_SCHEMA_VIOLATION`**(02 §8.2 阶段 A / C4/C5)
- 触发:子进程产出 JSON 过 `messageSchema.safeParse` 失败,或纯结构跨字段违例(C4 行区间反向、C5 rename 缺 renamedFrom)。
- 处理:带 zod 错误详情重发 ≤N(事实地基 C 兜底链);每次重发 `SCHEMA_RETRY`+`sylux_schema_retry_total{agent}`+1;耗尽抛 `OUTPUT_SCHEMA_VIOLATION`(error),本轮该 agent 视为失败,原始 raw 落 raw log(脱敏)。
- 观测:重试 `warn`/`board.schema.retry`;耗尽 `error`/`board.msg.rejected`+`sylux_error_total`。

**`EVIDENCE_REQUIRED`**(C1/C2)
- 触发:`role==='critic'` 或 `kind==='critique'`,或 ack 一个 done,但 `evidence` 为空。
- 处理:打回,回灌「你的 critique/ack 缺 evidence,请补 file_ref/command 锚点」;重发 ≤N。这是焊死「不准空夸」的执行点。
- 观测:`warn`/`board.msg.rejected`+`sylux_msg_rejected_total{agent,errCode=EVIDENCE_REQUIRED}`。连续多轮命中同一 agent → 计入红队「无效发言」画像(可在面板标记该 agent 在敷衍)。

**`EVIDENCE_UNVERIFIABLE`**(02 §8.3)
- 触发:evidence 非空但**无一条达到强核验通过**(file_ref 的 quote 与区间归一化后不一致 / command 输出不匹配 / 仅有 spec_quote 或无 quote 的 file_ref 等 weak 证据)。weak 证据可入指纹、可存在,但**不单独解锁** C1/C2(02 §3.2/§8.3,H2)。
- 处理:打回,回灌「证据复算未通过:`<具体哪条 + 原因>`」;重发 ≤N。
- 观测:`warn`/`board.msg.rejected`;`sylux_evidence_verify_total{result=fail}` 同步 +1(与 verifyEvidence 结果同源)。
- 边界:contentHash/quote 失配可能是 agent 引错行 / worktree 文件已被它轮改动 → 回灌时附「当前该区间实际内容 hash」,助 agent 重新定位(但不直接给明文,防 prompt 膨胀)。

**`EVIDENCE_COMMAND_UNSAFE`**(02 §8.1,H3)
- 触发:command 证据的 `cmd` 预扫判不安全(含 `curl ...|sh`、疑似 key、越白名单可执行),或复跑要越沙箱(workspace-write 封顶 / 断网 / env 白名单被违反)。
- 处理:该条 command 证据判 `fail`(**不计强**),记一条 `system` 消息 + 红队「无效发言」;**不**因单条不安全证据终止本轮(其余证据仍可成立,02 §8.4)。
- 观测:`warn`/`board.msg.rejected`+`sylux_msg_rejected_total{errCode=EVIDENCE_COMMAND_UNSAFE}`;`sylux_evidence_verify_total{result=fail}` +1。若疑似刻意注入(curl 外发)同时打 `security.firewall.hit`。

**`EVIDENCE_INFRA_DEGRADED`**(02 §8.4,v2.1 H12 —— 复跑器自身故障,**非 agent 过错**)
- 触发:`runCommandSandboxed`/复跑器/沙箱**基础设施本身**失败(中枢侧故障,如沙箱起不来、磁盘满),返 `{ok:false,reason:'infra'}`(区别于 `reason:'unsafe'` 的 `EVIDENCE_COMMAND_UNSAFE`)。这正是交叉审查 COV-3 要求分类的「复跑器/沙箱自身失败」。
- 处理:该证据判 **weak**(非 fail)→ **不连坐 critic**、**不计无效发言**、**不进 stall 计数**(02 §8.4 / §15.4)。若 critic 因此无任一强证据,按 `EVIDENCE_UNVERIFIABLE` 正常打回重发(让 agent 换可读 file_ref 锚点,而非惩罚它)。
- 观测:走 `recordEvidenceInfraDegraded`(§3.4)而非 `recordError`——`warn`/`board.evidence.infra_degraded`,`sylux_evidence_verify_total{result=infra}` +1,**不自增 `sylux_error_total`**(它是中枢侧降级,非业务错误,O4 例外)。连续 infra 降级应触发面板「复跑器健康」告警(中枢侧要修,而非 agent 要改)。

**`MESSAGE_SIZE_EXCEEDED`**(02 C10,H4)
- 触发:单条 message 序列化超 `MAX_MESSAGE_BYTES`(02 权威常量)。
- 处理:打回,回灌「消息过大,请精简 body / 拆分 evidence」;重发 ≤N。防单条巨消息撑爆黑板 / WS 帧。
- 观测:`warn`/`board.msg.rejected`+`sylux_msg_rejected_total{errCode=MESSAGE_SIZE_EXCEEDED}`。

**`WORKTREE_PATH_VIOLATION`**(C6)
- 触发:`files[].path` / `file_ref.path` / `renamedFrom` 越出本 agent worktree、含 `..`、或命中敏感白名单(08)。
- 处理:视为协议违规,打回 + 记一条 `system` 消息;连续违规计入「无效发言」指标。**不**放行越界路径(防 agent 借证据/补丁读写 worktree 外文件)。
- 观测:`warn`/`board.msg.rejected`+`sylux_msg_rejected_total{errCode=WORKTREE_PATH_VIOLATION}`。若疑似刻意越界(命中 `.env`/绝对路径系统目录)升 `security.firewall.hit` 记录。

**`DANGLING_REPLY_REF`(C8)/ `INVALID_DONE_SELF_ACK`(C3)/ `INVALID_SYSTEM_SENDER`(C7)**
- 触发:见 02 §5.2 对应行。`INVALID_SYSTEM_SENDER` 尤其敏感——agent 试图伪造 `kind=system` 冒充中枢裁决。
- 处理:打回并记 `system` 消息;`INVALID_SYSTEM_SENDER` 额外标记为**疑似伪造**(safety 关注),计入安全画像。
- 观测:`warn`/`board.msg.rejected`,各自 `errCode` 维度计数。`INVALID_SYSTEM_SENDER` 命中同时打 `security.firewall.hit`。

### 6.4 刹车类(正常终止,warn 不是 error)

这三个码是**预期内的成功收尾或受控停止**,不是故障(§2.5)。引擎触发任一即停,写 `kind:'system'`(from=orchestrator)记录终因,`status_changed` 落 jsonl(O6),面板高亮终态条。

**`ROUND_LIMIT_EXCEEDED`**:`currentRound` 达 `params.maxRounds`(刹车 04,预算按事实地基 D 累积估)→ `status=limit`。`warn`/`brake.triggered`+`sylux_brake_triggered_total{errCode}`。

**`CONVERGENCE_STALL`**:连续 `stallWindow` 轮 evidence 新指纹差集为空(02 §9.3)→ `status=stalled`。每轮采 `sylux_convergence_new_fp{round}` 与 `sylux_stall_window`,触发时 `warn`/`brake.triggered`。**与 done 解耦**(02 §9.3):stall 是「没新证据可吵」的被动停,done 是「对面带证据 ack」的主动停,两条独立刹车。**`EVIDENCE_INFRA_DEGRADED` 产生的 weak 证据不进指纹差集**(§6.3),避免复跑器抽风被误判为「有新进展」或「停滞」。

**`TOKEN_BUDGET_EXCEEDED`**:累计 token(或估价 USD)触顶 `params.tokenBudget`(事实地基 D 超线性成本)→ `status=limit`。判定优先按 token 硬数(§3.3),USD 为展示;**usage 缺失/漂移时按保守上界喂判定**(§3.3.1,ROC-M1),宁可早停不漏停。`warn`/`brake.triggered`。

### 6.5 资源 / 合并类

**`WORKTREE_CONFLICT`**(worktree 09)
- 触发:round 末把各 agent worktree 串行合并回主线时 git 报冲突(R7 纯 worktree 模型:运行期无锁各写各的,只在 round 末合并)。
- 处理:**硬停本轮合并**;把冲突详情(冲突文件 + hunk)作为 `evidence`(spec_quote/file_ref)回灌下一轮,让 agent 自己解(02 §8.4 风格);若策略设为人工,则 `status=aborted` 等人工介入。这是少数 `error` 级的非启动类码——合并冲突意味着两 agent 的改动真实矛盾,需裁决。
- 观测:`error`/`worktree.merge.failed`(Q3 采纳:独立 evt,**不再**复用 `round.closed`,告警面纯净)+`sylux_error_total{errCode=WORKTREE_CONFLICT}`。冲突文件清单进 `detail`(路径非 secret;内容 hunk 过 redact 防其中含 key)。

**`WORKTREE_GIT_FAILED`**(worktree 09 §12)
- 触发:git 子进程本身失败(`add`/`merge`/`diff`/`worktree add` 非零退出,非"冲突"而是"git 操作出错":锁文件占用、对象库损坏、磁盘满)。与 `WORKTREE_CONFLICT`(冲突是预期内的内容矛盾)区分——这是 git **基础设施**失败。
- 处理:视情况重试(锁占用可退避重试),不可恢复则该轮硬停、run `aborted` 或回灌。
- 观测:`error`/`worktree.git.failed`+`sylux_error_total{errCode=WORKTREE_GIT_FAILED,module=worktree}`。`detail` 含 git 命令(已 redact)与 stderr 摘要。

### 6.5b 安全 / WS / Fusion 类

**`INJECTION_BLOCKED`**(安全 08 §4.5)
- 触发:把 peer 输出喂对面前,内容防火墙特征扫描命中注入特征(边界标记伪造、"ignore previous instructions"类、越界 files 路径)。
- 处理:剥离/打回该段内容(不喂给对面),记安全画像;**不**直接终止 run(剥离后可继续),除非连续高危。
- 观测:`warn`/`security.firewall.hit`+`sylux_error_total{errCode=INJECTION_BLOCKED,module=security}`。命中详情过 redact(注入串本身可能含诱导文本,记特征名而非全文)。

**`EGRESS_SECRET_BLOCKED`**(安全 08 §8)
- 触发:中转源码出境(发往 mouubox 等第三方)前 secret scan 命中 `sk-`/base64/`Bearer`,或文件不在 `.syluxignore` 白名单。
- 处理:**阻断该次出境**(error 级,出境是不可逆泄露,从严)。run 视策略中止或跳过该文件。
- 观测:`error`/`security.egress.blocked`+`sylux_error_total{module=security}`。`detail` 记命中签名名 + 文件路径(**不含**命中的 secret 原文)。

**`WS_*`(七码,WS 11)**
- `WS_UNAUTHORIZED`/`WS_TICKET_EXPIRED`/`WS_ORIGIN_REJECTED`:鉴权阶段拒连,`evt=ws.auth.failed`。
- `WS_PERMISSION_DENIED`:已连的观战权限尝试 control(pause/abort/inject),`evt=ws.control`(带 denied 标记)。
- `WS_RATE_LIMITED`/`WS_PAYLOAD_INVALID`/`WS_PROTOCOL_ERROR`:限流/坏帧/帧序错,`evt=ws.rejected`。
- 处理:全部**只影响该连接**,不动 run(O5)。鉴权失败断连;越权拒操作并保留连接;限流退避。
- 观测:一律 `warn`+`sylux_error_total{module=ws}`;**不**进 `brake_triggered`/`status_changed`。安全相关(伪造 Origin/越权)额外计安全画像。RS-M2 提醒:`/ws-ticket` 签发端自身鉴权归 11/08,本文件只观测拒连事件,不实现鉴权。

**`FUSION_PANEL_FAILED` / `FUSION_JUDGE_FAILED`**(Fusion 21,远景)
- 触发:决策回合里 panel 多数成员失败无法合成 / judge 裁决失败或超时。
- 处理:该**决策回合**失败(执行回合不受影响,仍单 agent);视策略降级为单 provider 或终态。
- 观测:`error`/`fusion.failed`+`sylux_error_total{module=fusion}`。注意 ROC-M5/M3:panel 单轮扇出 N 成员可 N 倍烧 token,单 turn 无 token 上限只靠墙钟(`SUBPROCESS_TIMEOUT`)兜底——Fusion 的预算前瞻是 21/04 的事,本文件只暴露 `sylux_tokens_*` 让其可观测。

### 6.6 错误码演进纪律(回填义务)

- 新增错误码 = 给 02 §12 v2.1 的 `SyluxErrorCode` 联合**加成员**(union 加成员是向后兼容,非破坏性,02 §1.2)。新增后必须:① 02 §12 联合加该成员(权威,并标注拥有文档);② 本文件 §6.1 总览表 + §6.2–6.5b 补一段语义;③ §6.7 映射表(`ERROR_LEVEL`/`errEvtFor`)补该码,否则 `recordError`(§3.4)拿不到 level/evt 会落 `OBS_SELF_ERROR`,且 `Record<SyluxErrorCode,...>` 穷举**编译红**(这是特性,强制全集同步,02 §12 末注)。
- **v2 对齐声明**:本文件 §6 已与 02 §12 v2.1 的 33 码**逐一对齐**(含 v2.1 新增的 `EVIDENCE_INFRA_DEGRADED`/`MESSAGE_SIZE_EXCEEDED`/`SUBPROCESS_CRASHED`/`SUBPROCESS_TIMEOUT`/`SUBPROCESS_CANCELLED`/`ENGINE_FATAL`/`EMPTY_ROUND_PLAN`/WS 七码/`WORKTREE_GIT_FAILED`/`FUSION_*`/`PROVIDER_UNAVAILABLE`/`CONFIG_INVALID`)。A1/COV-1/COV-4 的「02 union 残缺 + 各篇建议回填无人补」在 02 v2.1 已闭合,本文件据其全集铺平观测语义。
- **禁止**在本文件或任何文档另定义一份 `SyluxErrorCode` 联合或其子集(焊死 R1):本文件只有语义表与 `ERROR_LEVEL`/`errEvtFor` 这两张**消费侧**映射(它们用 `SyluxErrorCode` 做 key,不另立联合)。联合体只在 `@sylux/shared/errors.ts`。

### 6.7 码 → 观测属性映射(recordError 依赖,全 33 码穷举)

`recordError`(§3.4)与 `recordEvidenceInfraDegraded` 需要按码查 level 与 evt。映射表与 §6.1 表逐行一致,集中一处避免漂移:

```ts
// @sylux/core/src/obs/error-meta.ts —— 与 §6.1 表同源,二者改一处必同步另一处
// Record<SyluxErrorCode,...> 强制穷举:02 §12 新增码而此处漏补,TS 编译即报缺键。
export const ERROR_LEVEL: Record<SyluxErrorCode, 'warn' | 'error'> = {
  // ★ 契约校验(打回类恒 warn;OUTPUT_SCHEMA 耗尽时由调用方升 error)
  OUTPUT_SCHEMA_VIOLATION:  'error',   // 重试中调用方降级打 warn,耗尽抛出时 error
  EVIDENCE_REQUIRED:        'warn',
  EVIDENCE_UNVERIFIABLE:    'warn',
  EVIDENCE_COMMAND_UNSAFE:  'warn',
  EVIDENCE_INFRA_DEGRADED:  'warn',    // 走 recordEvidenceInfraDegraded,不自增 error_total(§3.4/§6.3)
  MESSAGE_SIZE_EXCEEDED:    'warn',
  WORKTREE_PATH_VIOLATION:  'warn',
  DANGLING_REPLY_REF:       'warn',
  INVALID_DONE_SELF_ACK:    'warn',
  INVALID_SYSTEM_SENDER:    'warn',
  EMPTY_ROUND_PLAN:         'error',
  // 子进程
  SUBPROCESS_SPAWN_FAILED:  'error',   // 重试中 warn,耗尽 error
  SUBPROCESS_CRASHED:       'error',   // 同上
  SUBPROCESS_TIMEOUT:       'error',   // 同上
  SUBPROCESS_CANCELLED:     'warn',    // 受控取消,非故障
  // 引擎
  ENGINE_FATAL:             'error',
  ROUND_LIMIT_EXCEEDED:     'warn',
  CONVERGENCE_STALL:        'warn',
  TOKEN_BUDGET_EXCEEDED:    'warn',
  // 安全
  PROVIDER_CONFIG_INVALID:  'error',
  INJECTION_BLOCKED:        'warn',
  EGRESS_SECRET_BLOCKED:    'error',
  // WS(全 warn,不动 run)
  WS_UNAUTHORIZED:          'warn',
  WS_ORIGIN_REJECTED:       'warn',
  WS_TICKET_EXPIRED:        'warn',
  WS_PERMISSION_DENIED:     'warn',
  WS_RATE_LIMITED:          'warn',
  WS_PAYLOAD_INVALID:       'warn',
  WS_PROTOCOL_ERROR:        'warn',
  // worktree
  WORKTREE_CONFLICT:        'error',
  WORKTREE_GIT_FAILED:      'error',
  // Fusion
  FUSION_PANEL_FAILED:      'error',
  FUSION_JUDGE_FAILED:      'error',
  // provider / config
  PROVIDER_UNAVAILABLE:     'error',
  CONFIG_INVALID:           'error',
};

export function errEvtFor(code: SyluxErrorCode): LogEvent {
  switch (code) {
    case 'PROVIDER_CONFIG_INVALID': return LogEvent.ARGV_SECRET_BLOCK;
    case 'SUBPROCESS_SPAWN_FAILED': return LogEvent.ADAPTER_SPAWN_FAILED;
    case 'SUBPROCESS_CRASHED':      return LogEvent.ADAPTER_EXIT;
    case 'SUBPROCESS_TIMEOUT':      return LogEvent.ADAPTER_TIMEOUT;
    case 'SUBPROCESS_CANCELLED':    return LogEvent.ADAPTER_CANCELLED;
    case 'ENGINE_FATAL':            return LogEvent.ENGINE_FATAL;
    case 'EMPTY_ROUND_PLAN':        return LogEvent.EMPTY_ROUND_PLAN;
    case 'ROUND_LIMIT_EXCEEDED':
    case 'CONVERGENCE_STALL':
    case 'TOKEN_BUDGET_EXCEEDED':   return LogEvent.BRAKE_TRIGGERED;
    case 'INJECTION_BLOCKED':       return LogEvent.FIREWALL_HIT;
    case 'EGRESS_SECRET_BLOCKED':   return LogEvent.EGRESS_BLOCKED;
    case 'EVIDENCE_INFRA_DEGRADED': return LogEvent.EVIDENCE_INFRA_DEGRADED;
    case 'WS_UNAUTHORIZED':
    case 'WS_ORIGIN_REJECTED':
    case 'WS_TICKET_EXPIRED':       return LogEvent.WS_AUTH_FAILED;
    case 'WS_PERMISSION_DENIED':    return LogEvent.WS_CONTROL;
    case 'WS_RATE_LIMITED':
    case 'WS_PAYLOAD_INVALID':
    case 'WS_PROTOCOL_ERROR':       return LogEvent.WS_REJECTED;
    case 'WORKTREE_CONFLICT':       return LogEvent.ROUND_MERGE_FAILED;
    case 'WORKTREE_GIT_FAILED':     return LogEvent.WORKTREE_GIT_FAILED;
    case 'FUSION_PANEL_FAILED':
    case 'FUSION_JUDGE_FAILED':     return LogEvent.FUSION_FAILED;
    case 'PROVIDER_UNAVAILABLE':    return LogEvent.PROVIDER_UNAVAILABLE;
    case 'CONFIG_INVALID':          return LogEvent.CONFIG_INVALID;
    // 全部契约校验类(EVIDENCE_REQUIRED/UNVERIFIABLE/COMMAND_UNSAFE/MESSAGE_SIZE/
    //   WORKTREE_PATH/DANGLING/INVALID_*/OUTPUT_SCHEMA)归 board.msg.rejected
    default:                        return LogEvent.MSG_REJECTED;
  }
}
```

> **类型完备性兜底**:`ERROR_LEVEL` 用 `Record<SyluxErrorCode, ...>` 强制穷举——02 §12 新增码而此处漏补,TS 编译即报缺键(非运行时才发现)。`errEvtFor` 的 `switch` **必须**配 `default` 收尾(契约校验类共用 `MSG_REJECTED`);若要"新增码漏处理静态报错"的更强保证,可在 default 前用 `const _exhaustive: never = code` 仅对**应单独处理的码**做穷举断言,但因契约类共用 default,这里采用「`ERROR_LEVEL` 的 Record 穷举」作为新增码不漏的主守卫(测试 E1/E2 兜)。

---

## 7. 测试矩阵(交付验收锚点)

对接总体规划 §12 与测试文档 14。每条「给定 → 期望」可直接落 vitest。

| # | 用例 | 输入 / 动作 | 期望 |
|---|---|---|---|
| L1 | 轴字段继承 | runLogger→roundLogger→turnLogger 打一条 | 行含 runId/round/agent/role/turnId 全部 |
| L2 | redact 第三道挡 spawnargs | log.debug({ args:['--key','sk-xxx'] }) | 输出无 `sk-xxx`,被占位替换 |
| L3 | err 序列化脱敏 | log.error({ err: new Error('Bearer abc...') }) | 堆栈/message 中 token 被 redact |
| L4 | evt 强约定 | grep 全仓 `evt:` | 仅命中 `LogEvent.*` 引用,无裸字面量 |
| L5 | no-console | lint 生产路径 | 无 console.* |
| L6 | redact≠escape 边界 | log 一条含 `<script>` 的 body | redact **不**转义(仍含 `<`);断言面板 10 侧才 escape(RS-B2,文档锚点测试) |
| L7 | 跨帧分片 secret-scan 兜底 | 落盘 jsonl 含被切成两段的 `sk-ant-` | 单帧 redact 漏;**全文** secret-scan 命中 fail(RS-M1) |
| M1 | token 同源 | emit final_message.usage | tokens_*_total 各 +usage 对应值 |
| M2 | usage 缺失不猜 | final_message 无 usage | warn usageMissing=true,token 计数不变,`usage_missing_total`+1 |
| M2b | usage 缺失预算取上界 | 缺 usage + 设 tokenBudget | 预算判定用保守上界(output≠0),不漏停(ROC-M1) |
| M2c | usage 字段漂移 | usage 缺 outputTokens 字段 | 已知字段精确 + 缺失分量按上界,不静默低估 |
| M3 | 成本估价 | usage + pricing | costUsd 按 §3.3 公式;价缺省=0 不报错 |
| M4 | 累积曲线 | 连续多轮(事实地基 D 数据) | round_input_tokens 单调上升、超线性 |
| M5 | 错误计数唯一 | 抛一个 SyluxError | error_total{errCode} 恰 +1,日志恰 1 条 |
| M6 | 重试与时长解耦 | 一 turn 内 K 次 schema 重发 | schema_retry_total +K;turn_duration 记一个值 |
| M7 | sink 异常不崩 run | MetricsSink.counter throw | run 继续;obs_self_error_total +1 |
| M8 | infra 降级不计 error | runCommandSandboxed 返 infra | evidence_verify_total{result=infra}+1;**error_total 不变**;不进 stall(COV-3) |
| T1 | turnId 确定性 | forTurn(ctx, codex, critic) | turnId 含 round+agent,可复现 |
| T2 | adapterCall ⊂ turn | 一 turn 内 spawn+1 次 resume | 两个 adapterCallId,同一 turnId |
| T3 | session 映射 | 收 session_started | adapter.session 日志带 sessionId,BoardState.agents 回填 |
| E1 | 码→level 完备 | 遍历 SyluxErrorCode(33 码) | ERROR_LEVEL 每码有值(TS 编译保证) |
| E2 | 码→evt 完备 | errEvtFor 每码(33 码) | 返回合法 LogEvent,无 fallthrough 漏 |
| E3 | 刹车 warn 非 error | 触发 CONVERGENCE_STALL | level=warn,evt=brake.triggered,status=stalled |
| E4 | spawn 耗尽升 error | spawn 失败 N+1 次 | 前 N 次 warn,末次 error+error_total |
| E5 | EVIDENCE_REQUIRED 打回 | critic 空 evidence | 不终止 run;msg_rejected_total+1;回灌重发 |
| E6 | INVALID_SYSTEM_SENDER 伪造 | agent 发 kind=system | 打回 + firewall.hit + 安全画像计数 |
| E7 | WORKTREE_CONFLICT 独立 evt | round 末合并冲突 | evt=worktree.merge.failed(非 round.closed),error(Q3) |
| E8 | SUBPROCESS_CANCELLED 非故障 | 人工 abort 杀进程 | level=warn,evt=adapter.cancelled,不重试 |
| E9 | WS 码不动 run | WS_RATE_LIMITED 触发 | error_total{module=ws}+1;run status 不变;无 brake |
| S1 | jsonl 观测可回放 | 回放含 round_closed/status_changed 的 jsonl | 重建成本曲线 + 终因,无需 metrics 后端(O6) |
| S2 | secret-scan 兜底 | logs/ 注入含 sk- 的行 | CI secret-scan fail(忘接 redact 的最后一道网) |

---

## 8. 红队自检(对抗性审查,交付前自己先挑刺)

> 遵循工作方式「交付前对结论做一次对抗性自检」。逐条质疑本设计的薄弱点并给出回应或留 open question。

| # | 质疑 | 回应 |
|---|---|---|
| A1 | 「pino redact 三道里第三道 `formatters.log` 对**每条**日志整对象 `redactObject`,正则扫描开销会不会拖垮高频 trace 日志?」 | 真实风险。对策:`trace`/`debug` 级默认关(§2.5),生产只 info+;`redactObject` 对非字符串短路、对已知安全字段(usage 数字、id)免扫。高频 delta 透传若开 trace,接受其开销(排障专用)。【待实测】M1 压一轮 8 round 实测 redact CPU 占比,若超阈值则第三道改为「仅对 args/stderr/raw 等已知危险字段」而非全对象。 |
| A2 | 「token 只信 `final_message.usage`(O3),但 claude 端字段名与 codex 不同(02 §6.3 说适配层归一),万一 claude 没回 usage 呢?成本就漏算。」 | v2 升级:无 usage 不再仅"标记 + 当 0",而走 §3.3.1 的**保守上界**喂预算(output 取 `input×outputRatioCeil`,宁可早停),展示侧标 `usageMissing`+`usage_missing_total`，连续缺失触发面板估算模式告警(ROC-M1 闭合)。残余:claude headless 是否稳定回 usage 仍待 Q1/M0 实测;若长期不回,`outputRatioCeil` 校准(Q-RATIO)决定上界松紧。 |
| A3 | 「`turnId` 用 `runId.slice(4,8)` 截断,多 run 并发会不会撞?」 | turnId 含 round+agent+seq,同一 run 内唯一;跨 run 即便短 id 段相同,日志另有完整 `runId` 字段区分,turnId 只作人读锚点不作全局主键。可接受。 |
| A4 | 「指标默认内存 + jsonl 投影(O6),但长 run(几百轮)jsonl 巨大,面板每次回放重算成本曲线会卡。」 | 真实。对策:`round_closed.round.usage` 已缓存每轮聚合(02 §10.1),回放是累加而非重扫消息;面板增量更新当前 run,历史 run 才全回放。超大 run 的回放性能留 open question Q2(可加周期性快照行,但与 02「BoardState 不独立落盘、单一事实源」张力,需 02 同意)。 |
| A5 | 「O4 说每个错误恰一条日志 + 一次计数,但错误经多层 catch-rethrow,容易重复记或漏记。」 | 焊死点:错误**只在 `recordError` 这一个出口**记日志+计数,中间层 catch 后**只**做 rethrow 或转码(`new SyluxError`),不打日志。`recordError` 在最终处理点(引擎错误处理器)调一次。约定靠 code review + L5/M5 测试。残余风险:转码时丢原 code → 计数归错桶;对策:转码保留 `cause`。 |
| A6 | 「`errEvtFor` 把所有契约校验类都映射到 `MSG_REJECTED`,但 `WORKTREE_CONFLICT` 早期复用 `ROUND_CLOSED`,告警按 evt 分类会把合并冲突混进正常轮结束里。」 | **v2 已采纳 Q3**:新增独立 `ROUND_MERGE_FAILED` evt(§2.4),`errEvtFor('WORKTREE_CONFLICT')` 改返该 evt,不再复用 `ROUND_CLOSED`,告警面纯净。闭合。 |
| A7 | 「label 基数:`sylux_msg_rejected_total{agent,errCode}`、`error_total{errCode,module}` 看似可控,但 `module` 若用文件路径就爆了。」 | `module` 限定为有限枚举(`provider`/`adapter`/`shared`/`engine`/`worktree`/`ws`/`security`/`fusion`/`config`),非自由路径。在 `recordError` 签名上用联合类型约束(非 string),静态挡住。已收敛(原 Q4),`module` 联合随 §6.1 来源域固定。 |
| A8 | 「RS-B2:你 §5 说 redact 抹 secret,但面板把 agent 的 message body 直接塞 DOM,agent 写 `<img onerror=...>` 就能在观战者(可能持 control)浏览器里代发 abort/inject——你的 redact 根本不转义 HTML。」 | **真实且严重,但不在本文件能单解**。v2 已在 §5 出境表显式拆出「面板 DOM 渲染」行 + 关键纪律二:redact≠escape,HTML escape/CSP/sanitize 是面板 10 的硬职责。本文件的边界是「不泄 secret」;XSS 防御必须由 10 独立落地(escape 所有 agent 自由文本 + CSP 禁内联)。留 Q-XSS 给 10 定稿确认其确实做了(本文件只能锚点提醒,测试 L6 验文档边界)。 |
| A9 | 「RS-M1:流式 delta 跨两帧把 `sk-ant-` 切开,你按帧 redact 各帧都不命中,拼接后明文广播给 spectator。」 | v2 §2.3/§5 已补盲区:① 默认不在 info 级透传明文 delta(trace 级才透,默认关);② 跨帧根治=帧聚合后再 redact,归 WS 11 §8 的帧重组(本文件标盲区不假装单帧能挡);③ 落盘 secret-scan 是全文扫描(非按帧),兜底跨帧(测试 L7)。残余风险:实时 WS 广播在聚合前的瞬时窗口仍可能漏——留 Q-STREAM 给 11 确认帧重组策略。 |
| A10 | 「ROC-M1:CLI 升级改了 usage 字段名,你 output 当 0 算成本,用户设 \$12 上限挡不住真实 \$40。」 | v2 §3.3.1 已焊死:展示与预算用**两个**估价函数;预算侧对缺失/漂移分量取**保守上界**(output 不当 0,取 `input×outputRatioCeil`),宁可早停不漏停;`usage_missing_total` 连续命中触发面板「估算模式」橙告警(对接 19 §6.3 degradable 监控)。残余:`outputRatioCeil` 默认 1.0 需 M1 真实数据校准(Q-RATIO)。 |

### 8.1 Open questions(交给后续/GPT 审阅与 M0/M1 实测)

- **Q1**:claude headless(`-p --output-format json`)是否稳定回 token usage,字段名/位置?决定 O3 在 claude 端能否成立,否则成本模型一端瘸腿。(M0 实测)
- **Q2**:超大 run(数百轮)jsonl 回放重建成本曲线的性能上限;是否需周期性快照行(与 02「单一事实源、BoardState 不独立落盘」需协调)。
- **Q5**:【待实测】§8 A1 的 redact 第三道全对象扫描 CPU 开销,8-round 实测后决定是否退化为「仅危险字段」。
- **Q6**:prom-client 是否最终纳入(默认内存已够本地用);若纳入,`/metrics` 的 127.0.0.1 绑定与一次性 token 是否复用 WS 鉴权(11/08),还是独立。
- **Q-XSS**(RS-B2,交面板 10 定稿):面板 10 是否对**所有** agent 自由文本(message body / 文件名 / quote / 错误 detail)做 HTML escape 并设 CSP 禁内联脚本?本文件已在 §5 钉死 redact≠escape 边界,但 XSS 实际防御必须 10 落地——定稿前需 10 给出 escape/CSP/sanitize 的明确实现位点,否则 RS-B2 整片威胁面仍开放。
- **Q-STREAM**(RS-M1,交 WS 11 定稿):流式 delta 的跨帧密钥分片,WS 11 §8 的帧重组是否在**聚合完整后**才 redact+广播?若为低延迟选择逐帧广播,则实时窗口仍可能漏 secret(落盘 secret-scan 只兜事后)。需 11 明确帧重组与 redact 的先后。
- **Q-RATIO**(ROC-M1,M1 实测):usage 缺失时预算上界用的 `outputRatioCeil` 默认 1.0 是否合理?需 M1 真实 8-round 数据校准 output/input 实际比例上界,避免过松(漏停)或过紧(误停)。
- **Q-NUM**(COV-6,交定稿总控):本文件已锚定磁盘文件名编号,但全仓双轨制需一张**权威映射表**统一回填(01/02/04/05/06 等逻辑编号派稿)。本文件单方对齐磁盘名,若定稿最终选逻辑编号,需反向再过一遍本文所有 04/05/06/07/08/09/10/11 引用。

---

## 9. 收尾:本文件权威性声明

1. **本文件拥有**:结构化日志字段规范与 `LogEvent` 事件目录(§2.4)、指标清单与口径(§3.2,含 ROC-M1 的 usage 缺失保守上界 §3.3.1)、trace 关联 id 体系与 `ObsContext`(§4)、错误码的「触发/处理/观测」语义表与 `ERROR_LEVEL`/`errEvtFor` 映射(§6,33 码全集对齐 02 §12 v2.1)。这些在全项目唯一,落 `@sylux/core/src/obs/*` 与本文。
2. **本文件不拥有(只引用)**:`Message`/`Evidence`/`AgentEvent`/`TokenUsage`/`Round`/`BoardState`/`JsonlRecord` 及枚举(02 权威);`SyluxErrorCode` 联合与 `SyluxError` 类(02 §12 v2.1 权威,本文件只补语义表与消费侧 `ERROR_LEVEL`/`errEvtFor`,**不另定义联合**);`redact`/`SECRET_SIGNATURES` 规则(08 权威,本文件只列应用点);**HTML escape/CSP/sanitize**(面板 10 权威,redact≠escape,RS-B2);pino 选型与版本(12 权威);刹车阈值与指纹算法(04 权威);WS 帧重组与跨帧 redact(11 权威,RS-M1)。
3. **回填义务**:§6.6 — 新增错误码须同步 02 §12 v2.1 联合 + 本文 §6.1/§6.7;A1/COV-1/COV-4 的错误码 union 残缺已在 02 v2.1 闭合,本文 §6 已据 33 码全集铺平,无遗留待补码。
4. **不变量**:O1–O6(§0.3)是实现红线,尤以 O2(出境必脱敏,且 redact≠escape)、O3(token 唯一源,缺失取保守上界)、O4(错误不吞,infra 降级例外)、O5(观测不改控制流,WS 码不动 run)为安全/正确性关键,对应测试 L2/L3/L6/L7、M1/M2/M2b/M8、M5、M7/E9。

