# 11 · WebSocket 实时面板协议(权威线格式 + 生命周期 + 背压)

> **本文件地位**:sylux 观战面板的 **WS 线格式权威设计**。负责四件事:① server→client / client→server 全部帧的 zod schema 与信封(`message`/`round_planned`/`round_closed`/`diff`/`status`/`usage`/`error`/`snapshot` ↔ `hello`/`pause`/`resume`/`inject`/`abort`/`ping`/`ack`);② 连接生命周期(握手 → 鉴权 → snapshot → 增量 → 心跳 → 关闭码);③ 重连与游标(`seq` 单调序号 + resume cursor + 断点续传);④ 背压(每连接发送队列 / 合并 / 慢消费者降级)。本地服务安全(127.0.0.1 / Origin 白名单 / 一次性 token / 观战·控制权限分级 / 绝不把 key 推前端)**遵守并引用安全文档(08)R8**,本文不另定义安全规则,只定义“线上怎么走”。
>
> **类型一律引用 02**:`Message` / `Round` / `BoardState` / `RunStatus` / `TokenUsage` / `AgentMessagePayload` / `EvidenceItem` / `FilePatch` / `AgentId` / `SyluxError` / `SyluxErrorCode` 等全部 zod 类型与错误码,**唯一权威定义在黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。本文件涉及它们时**只引用、不另写任何 zod**;需要 `Message`/`Round`/`BoardState` 精确字段时见 02 §5/§10,需要 `AgentMessagePayload` 见 02 §6.1。
>
> **与兄弟文档的边界(只引用,不重写实现)**:
> - WS 的**安全规则**(绑定 127.0.0.1 / Origin 白名单 / 一次性 token / 观战·控制权限分级 / 广播前 `redactObject`)归 **安全文档(08)§5**;本文 §8 只把这些规则映射到**线上帧/关闭码**,规则本体引用 08。
> - 引擎主循环的 **8 相位 / 广播触点 / 控制帧入队**(P1 `round_planned` / P4 `delta`·`tool_call` / P6 `message` / P7 `round_closed`·`status` / P8 终态 `status`)归 **运行时骨架(01)§2.1/§2.3**;本文 §10 把每个触点落成具体帧,逻辑本体引用 01。
> - `Blackboard.append` 的“落盘→广播→喂刹车”写序(RT7)归 **01 §5.2**;本文只消费它在第 ③ 步 `hub.broadcast(...)` 抛出的帧。
> - worktree `diff` 的**生成**(`git diff --find-renames`,中枢从 worktree 实测,不由 agent 自填)归 **worktree 文档(09)**;本文 §9 只定义 `diff` 帧的**线格式**与按需拉取协议。
> - 刹车阈值/累积 token 预算(事实地基 D)归 **刹车文档(04)**;本文 `usage` 帧只**透传** 02 §6.3 `TokenUsage` 与 02 §10 `Round.usage`/`BoardState.totalUsage`,不算阈值。
>
> **事实地基**:WS 是中枢本机 server,与两 CLI 子进程的 spawn/事件流/成本(`docs/PROBED-FACTS.md` A/B/D/E 节)解耦;但 `usage` 帧承载的 `TokenUsage` 直接取自 `turn.completed.usage`(事实地基 B/D,经 02 §6.3 归一)。凡基于假设而非本机实测的结论显式标【待实测】。
>
> **⚠ 编号说明(v2:已统一到物理文件名编号)**:本文件落 `11-ws-protocol.md`。**全文一律采用物理文件名编号**(交叉一致性/覆盖两份红队报告均建议以磁盘文件名为唯一权威):`安全=08`(`08-security-firewall.md`)、`worktree=09`(`09-isolation-worktree.md`)、`面板=10`(`10-web-ui.md`)、`WS=11`(本文)、`刹车=04`、`provider=07`、`adapter-codex=05`、`adapter-claude=06`。**v1 遗留的逻辑编号(安全称「09」、面板称「08」)已在 v2 全文清除**——本文不再出现“安全(09)”这类漂移引用。仍有兄弟文档(01/02/05/06/23)用旧逻辑编号引用本文/安全文档,那是它们的回填项(见 x-consistency C-NUM),不影响本文内部自洽。最终全仓编号归一仍需用户一次性裁决并回填,见 §13 openQuestions;在此之前本文以文件名编号为准。

---

## 0. 设计目标与协议不变量

### 0.1 一句话职责

WS 是**单向为主、控制为辅**的本机实时通道:中枢把黑板增量(对话气泡 / 轮次 / diff / 终态 / token)**推**给浏览器观战;浏览器在 `control` 权限下**回**少量控制帧(暂停 / 恢复 / 插话 / 中止)。**WS 不是黑板的权威源**——jsonl(02 §7)才是;WS 帧是 jsonl 行的**实时投影 + 增量推送**,断线可由 snapshot + 游标补齐,丢帧不丢数据。

### 0.2 本文件负责 / 不负责

| 负责(给完整 zod + 线格式 + 失败路径) | 不负责(只引用) |
|---|---|
| WS 帧信封 `WsEnvelope` + `seq` 序号语义(§2) | `Message`/`Round`/`BoardState` 字段(02 §5/§10) |
| server→client 帧 union(§3) | 引擎相位 / 广播触点逻辑(01 §2.1) |
| client→server 帧 union(§4) | 控制帧入 `ControlQueue` 后的消费(01 §2.3) |
| 连接生命周期状态机 + 关闭码表(§5) | WS 安全规则本体(08 §5) |
| 重连 + resume cursor + 断点续传(§6) | `redactObject` 实现(08 §3) |
| 背压:发送队列 / 合并 / 慢消费者降级(§7) | diff 的 git 生成(worktree 文档 09) |
| 污点字段清单 + 渲染消毒契约 + CSP 要求(§8.4) | HTML 转义/DOMPurify/CSP **实现**(面板 10) |
| 流式跨帧 redact 滑动窗口 + delta spectate 门(§8.5) | `redactString` 正则/签名集(08 §3.2) |
| ws-ticket loopback-secret 准入(线上落点,§8.6) | secret 生成/文件权限规则本体(08 §5.5) |
| `diff` 帧线格式 + 按需拉取(§9) | 刹车阈值(04) |
| `WsHub` 对外接口 + 广播触点映射(§10) | provider 配置 / key 解析(05/07) |
| WS 错误码 / 关闭码语义(§11) | 错误码 union 本体(02 §12) |

### 0.3 协议不变量(实现必须保持)

- **W1 单调 seq**:每个 run 的 server→client **广播帧**带严格单调递增的 `seq`(从 1 起,无空洞)。`seq` 是断点续传游标的唯一锚点(§6)。`snapshot` 帧不占 seq(它本身携带“截至此刻的 seq 水位”),`pong`/`control_ack` 等**点对点应答帧**也不占广播 seq(§2.3)。
- **W2 落盘先于广播(继承 RT7)**:任何 `message`/`round_closed`/`status` 广播帧,其对应 jsonl 行**必已落盘**(01 §5.2)。故“面板见到的一定可回放”,反之未必(落盘后广播前崩溃 → 重连 snapshot 补齐)。WS 层不得在 `append` 落盘前抢发帧。
- **W3 redact 是广播必经**:`WsHub.broadcast` 内,帧 payload 序列化前**必过** `redactObject`(08 §3.2 / S4)。这是 key 不进前端的焊死点(08 S7)。本文所有帧示例均为 **redact 后**形态。
- **W4 控制帧不直改黑板**:client→server 控制帧只翻译成 `ControlFrame` 投递 `ControlQueue`(01 §2.3),由引擎在相位边界消费;WS 层**绝不**直接 mutate `BoardState` 或写 jsonl(W2/RT2 精神延伸)。
- **W5 鉴权先于任何业务帧**:连接建立后,server 在收到合法 `hello`(带一次性 token,08 §5.2)并校验通过前,**不发** snapshot/增量,**不收** 控制帧;未鉴权连接只允许 `hello`/`ping`(§5.2)。
- **W6 权限分级在帧级强制**:`scope:'spectate'` 连接发任何控制帧(`pause`/`resume`/`inject`/`abort`)→ 忽略 + 审计 + `close 4403`(08 §5.3 / S7)。能不能控制由**票据 scope** 决定,不由前端 UI 决定。
- **W7 背压不阻塞引擎**:慢消费者(浏览器卡)绝不能反压到引擎协程(01 P6 `append`)。`broadcast` 对单连接是**有界队列 + 非阻塞**:队列满则按 §7 降级(合并/丢可丢帧/强制重连),引擎侧 `broadcast` 恒立即返回。
- **W8 帧自带 runId + 版本**:每帧带 `runId` 与 `protocolVersion`,多 run 复用一条连接时可路由,协议演进时可识别(§2.2)。
- **W9 agent 来源字段是“污点文本”,线上不转义、渲染端必消毒(吃 RS-B2)**:server→client 帧里凡**源自子进程/agent/human-inject** 的字符串(`message.body`、evidence 的 `quote`/`source`/`locator`、`delta.text`、`tool_call.name`/`argsDigest`、`diff_ready.files[].path`、diff 正文 `diff_chunk.text`、`status.reason`)一律视为**不可信污点**。WS 层**只做 redact(去 secret),不做 HTML 转义**——转义是渲染端(面板 10)的硬契约。本文 §8.4 给出**污点字段清单 + 渲染消毒契约 + CSP 要求**,作为对 10 与安全文档(08)威胁模型(新增 T16:server→client 内容 XSS)的回填锚点。`redactObject` 抹 `sk-` 但**原样放行 `<script>`**,故“redact ≠ 安全可直插 DOM”。
- **W10 流式通路 redact 必须跨帧(吃 RS-M1)**:`delta`/`diff_chunk` 是把一段文本**切片**广播;逐帧无状态 redact 会被 secret 跨帧边界(`sk-ant-ap`+`i03-…`)绕过。`WsHub` 对每条流(`(runId,from,round)` 之于 delta;`diffRef` 之于 diff_chunk)维护**滑动尾缓冲**,只广播“已被 redact 扫描覆盖、确认安全”的前缀(§8.5)。在跨帧 redact 落地前,`delta`/`tool_call` 默认**不广播给 `spectate`**(仅 `control` 可见),由 §8.5 / openQuestion 收口。

---

## 1. 传输层与编码约定

### 1.1 传输选型

- **transport**:WebSocket over TCP,服务端用 `ws`(npm)挂在中枢同一个 Node HTTP server 上(与 `RestApi` 共端口,`Upgrade` 升级)。仅 `127.0.0.1` 明文 `ws://`(loopback 不过网卡,08 §5.1 / §5.5 已论证可接受;跨机需 wss,不在当前范围)。
- **为何不用 SSE/long-poll**:需要**双向**(控制帧 client→server)+ 低延迟 `delta` 透传;SSE 单向、long-poll 控制帧延迟高。WS 一条连接覆盖双向。
- **为何不用 socket.io**:避免私有握手/分帧协议绑定;裸 `ws` + 自定义 JSON 信封足够,且线格式自己说了算(便于 §6 断点续传精确控制)。

### 1.2 消息编码

- 每个 WS message 是**一个 UTF-8 JSON 文本帧**(`opcode=text`),内容是一个 `WsEnvelope`(§2)。**一帧一信封**,不批量数组(批量由 §7.3 的 `batch` 信封显式承载,仍是单 JSON 对象)。
- **禁裸换行外的控制字符**:`JSON.stringify` 保证;接收端 `JSON.parse` 失败 → 计一次 `protocol_error`(§11),累计超阈值 `close 1003`。
- **二进制帧(`opcode=binary`)**:当前协议**不使用**;收到即 `close 1003`(`unsupported data`)。diff 大块走 §9 按需 REST 拉取,不走 WS 二进制,避免分片重组复杂度。
- **大小上限**:单帧 server→client 软上限 **256 KiB**(redact 后);超限的 `diff`/`message.body` 走截断 + 按需拉取(§9.4、§7.5)。client→server 单帧硬上限 **64 KiB**(`inject` 的 `payload` 受此限),超限 `close 1009`(`message too big`)。

### 1.3 心跳与活性

- **应用层 ping/pong**:除 WS 协议级 ping/pong 外,定义**应用层** `ping`/`pong` 帧(§3/§4),携带 `clientTime`/`serverTime` 供前端测 RTT 与时钟偏移(面板时间轴用)。
- **server 主动探活**:server 每 `heartbeatInterval`(默认 15s)对每连接发 WS 协议 ping;`pongTimeout`(默认 10s)内无 pong → 判定死连接,`close 1001`(going away)并回收(§7.2 队列同时释放)。
- 前端无操作不需保活(server 推为主);但前端可发应用层 `ping` 探活 + 校时。

---

## 2. 帧信封 WsEnvelope 与 seq 语义

### 2.1 统一信封

所有 WS 帧(两个方向)共用一层信封,`dir` 隐含于 `type` 取值域(server 帧与 client 帧 type 不重叠),`seq` 仅 server→client 广播帧有意义(§2.3)。

```ts
import { z } from 'zod';
// 引用 02:agentIdSchema / messageSchema / roundSchema / boardStateSchema /
//          runStatusSchema / tokenUsageSchema / agentMessagePayloadSchema
import {
  agentIdSchema, messageSchema, roundSchema, boardStateSchema,
  runStatusSchema, tokenUsageSchema, agentMessagePayloadSchema,
} from '@sylux/shared';

/** 协议版本:线格式破坏性变更(删/改帧字段、改 seq 语义)时 +1,握手 hello 协商(§5.2)。 */
export const WS_PROTOCOL_VERSION = 1 as const;

/** 帧信封外层。payload 由 type 判别(§3 server / §4 client)。 */
export const wsEnvelopeSchema = z.object({
  /** 线协议版本(W8);与 hello 协商结果一致,否则 close 4400(§5.2)。 */
  v: z.literal(WS_PROTOCOL_VERSION),
  /** 帧类型,server 帧与 client 帧取值域不重叠(§3/§4)。 */
  type: z.string().min(1),
  /** 所属 run(W8);多 run 复用一条连接时路由依据。控制帧/鉴权帧亦带。 */
  runId: z.string().min(1),
  /**
   * 广播序号(W1):server→client **广播帧**单调递增,从 1 起无空洞,断点续传游标锚点(§6)。
   * - server 点对点应答帧(pong / control_ack / snapshot / 握手 error)不占广播 seq,置 0。
   * - client→server 帧不带广播 seq(置 0;client 自带 cid 关联应答,§2.3)。
   */
  seq: z.number().int().nonnegative(),
  /** 发送时间戳(epoch ms);server 帧由 server 盖,client 帧为 client 本地时间(仅诊断)。 */
  ts: z.number().int().nonnegative(),
  /** 帧体(下文各 type 的判别联合之一)。 */
  payload: z.unknown(),
});
export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;
```

> **为何 `payload:z.unknown()` 而非直接判别联合**:信封先做**廉价的版本/路由校验**(v/type/runId/seq),再按 `type` 取对应 payload schema `safeParse`。两段式校验让“版本不符/路由错”这类错误在解析重 payload 前就短路(性能 + 清晰错误码)。完整判别在 §3.4 `decodeServerFrame` / §4.4 `decodeClientFrame`。

### 2.2 版本与路由

| 字段 | 用途 | 不符时 |
|---|---|---|
| `v` | 协议版本(W8) | client `v` ≠ server 版本且无法协商 → `close 4400`(`protocol version mismatch`,§5.2) |
| `runId` | 多 run 路由(W8) | 连接已订阅 run 集合外:server 帧不会发;client 帧带未订阅 runId → `error` 帧 + 忽略 |
| `type` | 帧判别 | 未知 type:server→client 端前端忽略并告警;client→server 端 server 回 `error`(`UNKNOWN_FRAME_TYPE`)+ 计 protocol_error |

> **多 run 单连接**:一条 WS 连接可观战多个 run(面板切 tab 不重连)。`hello` 时声明初始订阅集,运行中可发 `subscribe`/`unsubscribe`(§4)增删。**每个 run 各有独立 seq 序列**;故 `seq` 必须与 `runId` 配对解释(游标是 `Map<runId, seq>`,§6.2)。

### 2.3 seq / cid 双轨:广播序 vs 应答关联

协议里有两类“需要配对”的语义,用两个独立机制,不混用:

| 机制 | 方向 | 作用 | 谁分配 |
|---|---|---|---|
| `seq` | server→client 广播帧 | 全序、断点续传游标(W1/§6) | server 按 runId 自增 |
| `cid`(correlation id) | client→server 请求 ↔ server 应答 | 把一次 `inject`/`pause`/`subscribe` 与其 `control_ack`/`error` 关联 | client 生成(nanoid),server 原样回填 |

```ts
/** 控制/请求类 client 帧的关联 id;server 在对应 control_ack/error 里原样回填。 */
export const cidSchema = z.string().min(1).max(64);
```

- 观战帧(`message`/`round_*`/`diff`/`status`/`usage`)只用 `seq`,无 `cid`(单向推送,无“请求”)。
- 控制帧(`pause`/`resume`/`inject`/`abort`/`subscribe`)用 `cid`:client 发 `{type:'pause', cid:'c1'}`,server 异步回 `{type:'control_ack', cid:'c1', accepted:true}` 或 `{type:'error', cid:'c1', code:...}`。`control_ack` 不占广播 seq(W1)。
- **为何分开**:控制帧的“被接受”与“产生的黑板变化”是**两件事**且**异步**——`inject` 被 ack(已入 `ControlQueue`)≠ 已 append(引擎在相位边界才消费,01 §2.3)。前端先收 `control_ack`(请求受理),稍后才收该 inject 真正落黑板的 `message` 广播帧(带新 seq)。用 `cid` 关联前者,用 `seq` 排序后者,语义不打架。

---

## 3. server → client 帧(观战 + 应答)

`payload.kind` 判别。分两组:**广播帧**(占 seq,W1,所有订阅该 run 的连接都收)与**点对点帧**(seq=0,只发给特定连接,如 snapshot/pong/ack/error)。

### 3.1 广播帧(占 seq)

```ts
/** ① 一条黑板消息落地(对话气泡)。源:01 §5.2 appendImpl 第③步 hub.broadcast。
 *  message 已是 02 §5 的完整 Message(中枢盖章后),且已过 redact(W3)。 */
export const sMessageSchema = z.object({
  kind: z.literal('message'),
  message: messageSchema,               // 02 §5,redact 后
  /** 该消息是否有可拉取的 diff(files 非空且 worktree 有实际改动);前端据此显示 diff 入口(§9)。 */
  hasDiff: z.boolean().default(false),
});

/** ② 轮次开始(playbook 排好本轮 turn 计划)。源:01 P1 round_planned。 */
export const sRoundPlannedSchema = z.object({
  kind: z.literal('round_planned'),
  round: z.number().int().nonnegative(),
  /** 本轮将发言的 (agent, role) 计划,供面板预渲染“谁要说话”。不含 prompt(08 不外泄上下文)。 */
  turns: z.array(z.object({
    from: agentIdSchema,
    role: z.string().min(1),            // 02 roleSchema 字面量(string 化,前端只展示)
    execution: z.enum(['serial', 'parallel']).default('serial'),
  })).default([]),
});

/** ③ 轮次关闭(合并 + 收敛指纹 + 本轮 usage)。源:01 P7 round_closed。 */
export const sRoundClosedSchema = z.object({
  kind: z.literal('round_closed'),
  round: roundSchema,                   // 02 §10.1,含 evidenceFingerprints / usage
  /** 本轮是否触发 worktree 合并冲突(冲突硬停,06);前端高亮。 */
  hadConflict: z.boolean().default(false),
});

/** ④ 运行状态变更(running/paused/done/stalled/aborted/limit)。源:01 P8 / 控制帧 pause。 */
export const sStatusSchema = z.object({
  kind: z.literal('status'),
  status: runStatusSchema,              // 02 §10.2
  /** 终态/暂停原因:错误码(02 §12 SyluxErrorCode)或人工备注;已 redact。 */
  reason: z.string().optional(),
});

/** ⑤ token 用量更新(累积成本,事实地基 D)。源:01 P6/P7 聚合后推送。 */
export const sUsageSchema = z.object({
  kind: z.literal('usage'),
  /** 触发本次 usage 推送的轮号(轮末聚合);currentRound 维度。 */
  round: z.number().int().nonnegative(),
  /** 本轮 usage(02 §10.1 Round.usage)。 */
  roundUsage: tokenUsageSchema.optional(),
  /** 全 run 累计(02 §10.2 BoardState.totalUsage);前端画累积曲线。 */
  totalUsage: tokenUsageSchema.optional(),
  /** 可选:刹车文档(04)算出的预算占比 [0,1],便于面板进度条;本文不算,只透传。 */
  budgetFraction: z.number().min(0).optional(),
});

/** ⑥ diff 就绪通知(轻量,不含 diff 正文)。源:01 P7 merge 后 worktree diff 生成。
 *  正文按需经 §9 拉取或 diff_chunk 推送,避免广播大块撑爆慢消费者(W7)。 */
export const sDiffReadySchema = z.object({
  kind: z.literal('diff_ready'),
  round: z.number().int().nonnegative(),
  /** 关联的 message id(哪条发言产生的改动);前端从气泡点开 diff。 */
  messageId: z.string().min(1),
  /** 变更文件清单(路径 + 增删行数 + 是否二进制),供折叠列表;路径已过白名单(08 §4.4)。 */
  files: z.array(z.object({
    path: z.string().min(1),
    changeKind: z.enum(['add', 'modify', 'delete', 'rename']),
    additions: z.number().int().nonnegative().default(0),
    deletions: z.number().int().nonnegative().default(0),
    isBinary: z.boolean().default(false),
    /** 该文件 diff 正文的拉取句柄(§9.2);二进制/超阈值文件可为空(前端显示“二进制,不渲染”)。 */
    diffRef: z.string().optional(),
  })).default([]),
});

/** ⑦ 子进程原始增量(流式 token / 思考流透传观战)。源:01 P4 delta。
 *  ★ 高频帧:背压时**优先丢弃/合并**(§7.4 droppable);丢了不影响最终 message(W2 落盘的是 message,非 delta)。
 *  ★ 安全:文本是污点(W9 §8.4)且须跨帧 redact(W10 §8.5);跨帧 redact 落地前默认**只发 control,不发 spectate**(§8.5 streamDeltaToSpectators)。 */
export const sDeltaSchema = z.object({
  kind: z.literal('delta'),
  from: agentIdSchema,
  round: z.number().int().nonnegative(),
  /** 增量文本片段(已跨帧 redact,W10/§8.5)。前端按 from+round 拼到“正在输入”气泡;渲染须当污点纯文本(W9/§8.4)。 */
  text: z.string(),
});

/** ⑧ 子进程工具调用透传(观战“它在干嘛”)。源:01 P4 tool_call。同 delta:droppable + 默认不发 spectate(§8.5)。 */
export const sToolCallSchema = z.object({
  kind: z.literal('tool_call'),
  from: agentIdSchema,
  round: z.number().int().nonnegative(),
  name: z.string().min(1),            // 污点(W9 §8.4)
  /** 工具入参摘要(已 redactObject,W3;大对象截断)。渲染当污点纯文本(W9 §8.4)。 */
  argsDigest: z.string(),
});
```

### 3.2 点对点帧(seq=0,只发给单连接)

```ts
/** ⑨ 初始/重连快照(全量或自游标增量,§6)。只发给请求方,不广播,不占 seq。 */
export const sSnapshotSchema = z.object({
  kind: z.literal('snapshot'),
  /** 截至此快照的广播 seq 水位:client 之后按 seq>watermark 接增量(§6.2)。 */
  seqWatermark: z.number().int().nonnegative(),
  /** 全量快照:整个 BoardState(02 §10.2,redact 后)。冷启动/游标过期时用。 */
  full: boardStateSchema.optional(),
  /** 增量快照:client 报了游标且仍在缓冲窗内(§6.3),只补 (cursor, watermark] 的帧。 */
  delta: z.object({
    fromSeq: z.number().int().nonnegative(),    // client 已有的最后 seq
    frames: z.array(z.unknown()).default([]),   // 缺口内的广播帧 payload(按 seq 升序)
  }).optional(),
  /** 是否因游标过期/越界而退化为 full(诊断 + 前端清本地缓存)。 */
  resync: z.boolean().default(false),
});

/** ⑩ diff 正文分块推送(可选,作为 §9 REST 拉取的 WS 等价路径)。 */
export const sDiffChunkSchema = z.object({
  kind: z.literal('diff_chunk'),
  diffRef: z.string().min(1),           // 对应 diff_ready.files[].diffRef
  /** unified diff 文本分块(已 redact);大文件分多帧,seqInRef 升序拼接。 */
  text: z.string(),
  seqInRef: z.number().int().nonnegative(),
  last: z.boolean().default(false),     // 末块标记
});

/** ⑪ 应用层 pong(回 client ping,带 server 时间供校时)。不占 seq。 */
export const sPongSchema = z.object({
  kind: z.literal('pong'),
  clientTime: z.number().int(),         // 原样回填 client ping 的 clientTime(算 RTT)
  serverTime: z.number().int(),
});

/** ⑫ 控制帧应答(关联 client cid)。不占 seq。 */
export const sControlAckSchema = z.object({
  kind: z.literal('control_ack'),
  cid: cidSchema,                       // 关联 §2.3
  accepted: z.boolean(),
  /** 受理结果说明:accepted=false 时给原因(如 run 已终态、scope 不足已另发 close)。 */
  note: z.string().optional(),
});

/** ⑬ 错误帧(握手失败前置 / 控制帧拒绝 / 协议错误)。可带 cid(若由某 client 请求触发)。 */
export const sErrorSchema = z.object({
  kind: z.literal('error'),
  /** 复用 02 §12 SyluxErrorCode 子集 + WS 专属码(§11),字符串承载。 */
  code: z.string().min(1),
  message: z.string(),                  // 人类可读,已 redact
  cid: cidSchema.optional(),            // 若由某请求触发则回填
  /** 是否致命(随后 server 会 close);前端据此决定重连或停。 */
  fatal: z.boolean().default(false),
});
```

### 3.3 server 帧判别联合

```ts
/** server→client payload 全集(kind 判别)。 */
export const serverPayloadSchema = z.discriminatedUnion('kind', [
  // 广播帧(占 seq)
  sMessageSchema, sRoundPlannedSchema, sRoundClosedSchema, sStatusSchema,
  sUsageSchema, sDiffReadySchema, sDeltaSchema, sToolCallSchema,
  // 点对点帧(seq=0)
  sSnapshotSchema, sDiffChunkSchema, sPongSchema, sControlAckSchema, sErrorSchema,
]);
export type ServerPayload = z.infer<typeof serverPayloadSchema>;

/** 哪些 kind 占广播 seq(W1):其余点对点帧 seq 恒 0。 */
export const BROADCAST_KINDS = new Set([
  'message', 'round_planned', 'round_closed', 'status', 'usage',
  'diff_ready', 'delta', 'tool_call',
]);

/** 哪些 kind 在背压时可丢弃/合并(§7.4):高频且“最终态可由 snapshot/message 重建”。 */
export const DROPPABLE_KINDS = new Set(['delta', 'tool_call']);
```

### 3.4 server 帧解析(两段式)

```ts
export function decodeServerFrame(
  raw: string,
): { ok: true; env: WsEnvelope; payload: ServerPayload } | { ok: false; error: string } {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'INVALID_JSON' }; }
  const env = wsEnvelopeSchema.safeParse(obj);
  if (!env.success) return { ok: false, error: 'BAD_ENVELOPE' };
  const p = serverPayloadSchema.safeParse(env.data.payload);
  if (!p.success) return { ok: false, error: 'BAD_PAYLOAD' };
  return { ok: true, env: env.data, payload: p.data };
}
```

---

## 4. client → server 帧(鉴权 + 控制 + 订阅)

`payload.kind` 判别。除 `hello`/`ping` 外,所有帧要求连接**已鉴权**(W5);控制类(`pause`/`resume`/`inject`/`abort`)额外要求 `scope:'control'`(W6),否则 `close 4403`。

### 4.1 鉴权与会话管理帧

```ts
/** ① 握手:连接建立后客户端第一帧。携带一次性 token(08 §5.2),声明初始订阅与重连游标。 */
export const cHelloSchema = z.object({
  kind: z.literal('hello'),
  /** 一次性连接票据 token(08 §5.2 WsTicket.token)。绝不进 URL query(08 §5.2)。 */
  token: z.string().min(1),
  /** 期望协议版本;server 不支持则 close 4400(§5.2)。 */
  protocolVersion: z.number().int().positive(),
  /** 初始订阅的 run 集合(通常含票据绑定的 runId;越权 run 被 server 过滤)。 */
  subscribe: z.array(z.string().min(1)).default([]),
  /**
   * 重连游标(§6.2):各 run 已收到的最后广播 seq。
   * 省略 = 冷启动要全量 snapshot;提供 = server 尝试增量补帧(窗内)或退化 full(resync)。
   */
  cursor: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

/** ② 订阅新 run(运行中切 tab,不重连)。需已鉴权;只能订阅票据 scope 覆盖的 run。 */
export const cSubscribeSchema = z.object({
  kind: z.literal('subscribe'),
  cid: cidSchema,
  runId: z.string().min(1),
  cursor: z.number().int().nonnegative().optional(),  // 该 run 的重连游标
});

/** ③ 取消订阅(释放该 run 的 server 端发送状态)。 */
export const cUnsubscribeSchema = z.object({
  kind: z.literal('unsubscribe'),
  cid: cidSchema,
  runId: z.string().min(1),
});

/** ④ 应用层 ping(校时 + 探活)。无需鉴权(W5 例外:hello/ping 允许)。 */
export const cPingSchema = z.object({
  kind: z.literal('ping'),
  clientTime: z.number().int(),
});
```

### 4.2 控制帧(需 scope:'control',W6)

控制帧**不直改黑板**(W4):server 校验 scope 后翻译成 01 §2.3 的 `ControlFrame` 投 `ControlQueue`,立即回 `control_ack`(受理),实际效果稍后经广播帧体现(§2.3)。

```ts
/** ⑤ 暂停:引擎在相位边界(P0/P8)暂停,setStatus('paused')。01 §2.3。 */
export const cPauseSchema = z.object({ kind: z.literal('pause'), cid: cidSchema });

/** ⑥ 恢复:paused→running,下一轮 P0 继续。01 §2.3。 */
export const cResumeSchema = z.object({ kind: z.literal('resume'), cid: cidSchema });

/** ⑦ 中止:root.abort(reason),全树取消 + 杀子进程(01 §2.3,唯一不等边界穿透 P4 的控制帧)。 */
export const cAbortSchema = z.object({
  kind: z.literal('abort'),
  cid: cidSchema,
  reason: z.string().max(500).optional(),
});

/** ⑧ 人工插话:以 from:'human' 注入一条黑板消息。
 *  payload 是 02 §6.1 AgentMessagePayload(瘦子集);server 侧照样过内容防火墙(08 §4)+ validateMessage(02 §8)。 */
export const cInjectSchema = z.object({
  kind: z.literal('inject'),
  cid: cidSchema,
  payload: agentMessagePayloadSchema,   // 02 §6.1;human 的 evidence 同样核验(01 §2.3 / RT3)
});
```

### 4.3 client 帧判别联合

```ts
export const clientPayloadSchema = z.discriminatedUnion('kind', [
  cHelloSchema, cSubscribeSchema, cUnsubscribeSchema, cPingSchema,
  cPauseSchema, cResumeSchema, cAbortSchema, cInjectSchema,
]);
export type ClientPayload = z.infer<typeof clientPayloadSchema>;

/** 控制类 kind(需 scope:'control',W6);其余为观战/会话类。 */
export const CONTROL_KINDS = new Set(['pause', 'resume', 'abort', 'inject']);

/** 免鉴权可发的 kind(W5 例外):仅握手与心跳。 */
export const PRE_AUTH_KINDS = new Set(['hello', 'ping']);
```

### 4.4 client 帧解析与准入门(server 侧)

```ts
/** server 收 client 帧的准入流水:解析 → 鉴权门(W5)→ 权限门(W6)→ 投递。 */
export function admitClientFrame(
  raw: string,
  conn: WsConnState,        // §5.3 连接状态(authed / scope / subscriptions)
): { ok: true; payload: ClientPayload } | { ok: false; close?: number; error: string } {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'INVALID_JSON' }; }
  const env = wsEnvelopeSchema.safeParse(obj);
  if (!env.success) return { ok: false, error: 'BAD_ENVELOPE' };
  const p = clientPayloadSchema.safeParse(env.data.payload);
  if (!p.success) return { ok: false, error: 'UNKNOWN_FRAME_TYPE' };
  const kind = p.data.kind;

  // 鉴权门(W5):未 authed 只放行 hello/ping
  if (!conn.authed && !PRE_AUTH_KINDS.has(kind)) {
    return { ok: false, close: 4401, error: 'WS_AUTH_FAILED' }; // 08 §8 WS_AUTH_FAILED
  }
  // 权限门(W6):spectate 发控制帧 → 4403 + 审计
  if (CONTROL_KINDS.has(kind) && conn.scope !== 'control') {
    return { ok: false, close: 4403, error: 'WS_FORBIDDEN_CONTROL' };
  }
  return { ok: true, payload: p.data };
}
```

---

## 5. 连接生命周期与关闭码

### 5.1 生命周期状态机

```
                 ┌──────────────────────────────────────────────────────────┐
   TCP/Upgrade   │                                                          │
  ───────────►  CONNECTING ──(HTTP Upgrade: Origin 白名单校验,08 §5.1)──┐  │
                                                                         │  │
                              Origin 不白 ─► close 4403 ◄────────────────┘  │
                                                                            │
  握手(等首帧 hello,有 helloTimeout=5s)                                   │
   ─► AWAIT_HELLO ──(收 hello + token 校验,08 §5.2)──► token 无效 ► close 4401
        │  超时无 hello ► close 4408                                        │
        │  v 不兼容 ► close 4400                                           │
        ▼                                                                  │
   AUTHED ──(发 snapshot:full 或 delta,§6)──► STREAMING ◄────────────────┘
        │                                          │
        │  心跳失败 / pongTimeout ► close 1001      │  收控制帧(scope 校验,W6)
        │  背压不可恢复 ► close 4413(§7.5)         │  ► 投 ControlQueue ► control_ack
        │  run 全部 unsubscribe ► 仍 STREAMING(空订阅,保活等再 subscribe)
        ▼
   CLOSING ──► CLOSED(清发送队列 §7.2 / 释放订阅 / 审计)
```

### 5.2 握手序列(时序)

```
client                          server(WsHub)                         RestApi(同源 127)
  │                                  │                                      │
  │ (1) 先 REST 取票据)              │                                      │
  │ ────────────────────────────────────────────────────────────────────► │ POST /runs/:id/ws-ticket  +X-Sylux-Local-Secret(§8.6)
  │ ◄──────────────────────────────────────────────────────────────────── │ secret 不符→401(不签票);符→{ token, scope, runId, expiresAt }
  │                                  │                                      │
  │ (2) WS Upgrade(Origin 头)       │                                      │
  │ ───────────────────────────────►│ 校验 Origin∈白名单(08§5.1)          │
  │                                  │  否→close 4403                        │
  │ ◄───────────────────────────────│ 101 Switching Protocols               │
  │                                  │                                      │
  │ (3) hello{token,v,subscribe,cursor}                                     │
  │ ───────────────────────────────►│ 校验:token 存在/未过期/未用过/runId 匹配(08§5.2)
  │                                  │  否→error{WS_AUTH_FAILED,fatal}+close 4401
  │                                  │  v 不兼容→close 4400                  │
  │                                  │  token 一次性:校验通过即作废(08§5.2)
  │ ◄───────────────────────────────│ (4) snapshot{seqWatermark, full|delta}(§6)
  │ ◄───────────────────────────────│ (5) 之后按 seq>watermark 持续推广播帧
  │                                  │                                      │
```

> **票据从 REST 拿、不从 WS URL**:08 §5.2 焊死 token 不进 URL query(落浏览器历史/代理日志)。前端先 `POST /runs/:id/ws-ticket`(同源 127,REST,**须带 §8.6 的 `X-Sylux-Local-Secret`**)拿一次性 token,再在 `hello` 首帧提交。`scope`(spectate/control)由 RestApi 按用户操作签发,WS 侧只认票据携带的 scope(W6)。**ws-ticket 端点自身的鉴权见 §8.6(吃 RS-M2):无 loopback-secret 不签票,堵死本机 curl 直接取 control 票**。

### 5.3 连接状态对象(server 侧)

```ts
/** 单连接 server 端状态。 */
export interface WsConnState {
  connId: string;                          // 连接唯一 id(审计/日志)
  authed: boolean;                         // 收到合法 hello 后置 true(W5)
  scope: 'spectate' | 'control';           // 票据携带(08 §5.2);决定 W6
  subscriptions: Map<string, number>;      // runId → 已发出的最后 seq(server 视角发送游标)
  sendQueue: BoundedQueue<WsEnvelope>;      // 有界发送队列(§7.2)
  protocolErrors: number;                   // 累计协议错误,超阈值 close 1003(§11)
  lastPongAt: number;                       // 心跳(§1.3)
  redactApplied: true;                      // 类型标记:入队前必已 redact(W3,编译期提醒)
}
```

### 5.4 关闭码表(WS close code)

复用标准 1xxx + 自定义 4xxx(4000–4999 应用私有区)。所有 close 前若可能,先发一帧 `error{fatal:true}` 说明(除非连接已不可写)。

| close code | 名称 | 触发 | 前端应对 |
|---|---|---|---|
| `1000` | normal | run 终态后前端主动断 / server 正常关停 | 不自动重连 |
| `1001` | going away | server 关停 / pongTimeout 死连接(§1.3) | 重连(指数退避,§6.1) |
| `1003` | unsupported data | 收到二进制帧 / 累计 protocol_error 超阈值(§11) | 视为 bug,重连一次,反复则停 |
| `1009` | message too big | client 帧超 64KiB(§1.2) | 不重发该帧;`inject` 内容应分拆/精简 |
| `4400` | protocol mismatch | `hello.protocolVersion` 不兼容且无法协商(§2.2) | 提示升级面板;不盲目重连 |
| `4401` | auth failed | token 无效/过期/重放/runId 不匹配(08 §5.2) | 重新 REST 取票据再连(§6.1) |
| `4403` | forbidden | Origin 不白(§5.1)/ spectate 发控制帧(W6) | Origin 错=配置问题不重连;越权=降级为只读 UI |
| `4408` | hello timeout | helloTimeout 内未发 hello(§5.2) | 重连并立即发 hello |
| `4413` | backpressure | 发送队列不可恢复溢出(§7.5) | 重连 + 走 snapshot 重新对齐(§6) |

> **4xxx 选码理由**:RFC 6455 保留 4000–4999 给应用;末三位**刻意贴近** HTTP 语义(400/401/403/408/413)便于记忆与日志聚合。`WS_AUTH_FAILED`(08 §8)统一映射到 4401(token 类)/4403(Origin、越权类),前端据 code 区分“重新取票据”还是“无权限”。

---

## 6. 重连、游标与断点续传

### 6.1 重连策略(前端)

- **触发**:任何非 `1000`/`4400`/`4403(Origin)` 的 close 都重连;`4401` 先重新 REST 取票据(token 一次性,旧的已作废)。
- **退避**:指数退避带抖动,`min(baseDelay * 2^attempt, maxDelay) ± jitter`(建议 base=500ms,max=15s,jitter ±20%)。避免 server 重启瞬间所有面板齐刷雪崩。
- **重连即续传**:重连时 `hello.cursor` 带上各 run 已收到的最后 `seq`(§6.2),让 server 优先增量补帧而非全量 snapshot。

### 6.2 游标语义(client 端持有)

```ts
/** 前端持久化的续传游标:每 run 已确凿收到并应用的最后广播 seq。 */
export type ResumeCursor = Record<string /*runId*/, number /*lastSeq*/>;
```

- client 每应用一条**广播帧**(`BROADCAST_KINDS`,§3.3)即更新 `cursor[runId] = env.seq`。点对点帧(snapshot/pong/ack)不动游标(它们 seq=0)。
- **空洞检测**:client 收到广播帧若 `env.seq !== cursor[runId] + 1`,说明丢帧(理论上 TCP 有序不丢,但背压降级 §7 可能 server 端主动跳号)→ 触发**主动 resync**:发 `subscribe{runId, cursor:lastSeq}` 请求补缺口(server 回 `snapshot:delta` 或 `resync:full`)。
- 游标存内存即可(刷新页面=冷启动走 full);可选 `sessionStorage` 续命跨刷新。

### 6.3 server 端环形缓冲(断点续传窗)

server 为每个**活跃 run** 维护一个**广播帧环形缓冲**(`replayBuffer`),保留最近 `N` 条广播帧(payload + seq),供短时断线增量补帧。超出窗的缺口退化为 full snapshot(从 02 §10 `BoardState` 投影,01 §5.3 sqlite 索引加速)。

```ts
/** 每 run 的重放缓冲(server 内存)。仅缓存广播帧(占 seq 的);delta/tool_call 是否入缓冲见下。 */
export interface ReplayBuffer {
  runId: string;
  capacity: number;                 // 默认 1024 条;按 run 活跃度可调
  /** 环形存储 [seq, payload];seq 连续。droppable 帧(delta/tool_call)默认**不入缓冲** */
  ring: Array<{ seq: number; payload: ServerPayload }>;
  oldestSeq: number;                // 缓冲内最小 seq;client cursor < oldestSeq → 必须 full resync
  latestSeq: number;                // = 当前广播 seq 水位
}

/** 续传决策:给定 client 游标,返回 full / delta / 已最新。 */
export function resolveResume(
  buf: ReplayBuffer,
  clientLastSeq: number,
): { mode: 'uptodate' } | { mode: 'delta'; frames: { seq: number; payload: ServerPayload }[] }
  | { mode: 'full'; resync: true } {
  if (clientLastSeq === buf.latestSeq) return { mode: 'uptodate' };
  if (clientLastSeq < buf.oldestSeq) return { mode: 'full', resync: true }; // 缺口超窗
  if (clientLastSeq > buf.latestSeq) return { mode: 'full', resync: true }; // 游标越界(server 重启 seq 归零)
  const frames = buf.ring.filter((f) => f.seq > clientLastSeq).sort((a, b) => a.seq - b.seq);
  return { mode: 'delta', frames };
}
```

> **droppable 帧不入缓冲**:`delta`/`tool_call`(§3.3 `DROPPABLE_KINDS`)是高频、非权威(最终态由 `message` 重建,W2),**不进 replayBuffer**——它们丢了无所谓,重连后从 snapshot 拿到的是已落地的 `message`,不需要补回中间打字过程。这让缓冲只装“丢了会缺数据”的帧(message/round/status/usage/diff_ready),容量利用率高。

### 6.4 server 重启的 seq 归零

server 进程重启后 run 的内存 seq 归零,但 jsonl 仍是权威(02 §7)。client 旧游标 `> latestSeq`(新进程从 1 数)→ `resolveResume` 判 `full,resync`。client 收到 `snapshot{resync:true, full}` 即**丢弃本地缓存**用 full 重建,游标重置为 `seqWatermark`。这样跨 server 重启不会因 seq 错位导致永久空洞。

> **为何不持久化 seq**:seq 是“本次 server 进程的广播序”,不是黑板权威(那是 jsonl 的 message id/ts)。持久化 seq 反而要处理“重启后续接旧 seq vs 重放未广播行”的复杂一致性。简单办法:seq 进程内单调,跨重启靠 `resync:full` 重对齐,权威永远回 jsonl。

### 6.5 断点续传时序

```
client                              server
  │  (断线一段时间)                    │  run 仍在跑,replayBuffer 累积 seq 12..40
  │                                   │
  │  重连 + hello{cursor:{run1:12}}    │
  │ ─────────────────────────────────►│ resolveResume(buf, 12)
  │                                   │  oldestSeq=8 ≤ 12 ≤ latestSeq=40 → delta
  │ ◄─────────────────────────────────│ snapshot{seqWatermark:40, delta:{fromSeq:12, frames:[13..40]}}
  │  应用 frames,cursor→40             │
  │ ◄─────────────────────────────────│ 继续推 seq 41,42...(实时)
  │                                   │
  ── 若 cursor:{run1:3}(超窗,oldestSeq=8)──
  │ ◄─────────────────────────────────│ snapshot{seqWatermark:40, full:BoardState, resync:true}
  │  丢本地缓存,用 full 重建,cursor→40 │
```

---

## 7. 背压与慢消费者(W7)

### 7.1 问题与原则

引擎协程在 P6 `append` 第③步同步调 `hub.broadcast(frame)`(01 §5.2)。若某浏览器卡住(WS 发送缓冲堆积),**绝不能**让 `broadcast` 阻塞回引擎——否则一个慢面板能拖垮整个 run(W7)。原则:**broadcast 对引擎永远 O(1) 非阻塞**;慢由各连接的有界发送队列**自己消化或降级**,与引擎解耦。

### 7.2 每连接有界发送队列

```ts
/** 有界发送队列:满时按策略降级,绝不无限堆积(防 OOM,T6 / 08)。 */
export interface BoundedQueue<T> {
  capacity: number;            // 默认 512 帧
  size(): number;
  /** 入队;返回是否成功。满时由 enqueue 内部按 §7.4 降级(丢 droppable / 合并 / 标记溢出)。 */
  enqueue(item: T): { ok: boolean; dropped?: number; coalesced?: number };
  /** WS 可写时批量取出(配合 ws.bufferedAmount 节流,§7.3)。 */
  drain(maxBytes: number): T[];
}
```

- `broadcast` 把帧 `enqueue` 到**每个**订阅连接的队列后立即返回(O(连接数),连接数本机个位数)。
- 真正写 socket 由每连接的 **drain 循环**驱动:监听 `ws` 可写 / `drain` 事件,参考 `ws.bufferedAmount`,低于阈值才继续 `socket.send`。socket 写不动 → 帧滞留队列 → 触发 §7.4 降级,**不回压引擎**。

### 7.3 帧合并与批量(coalescing)

队列接近满时,对**可合并**帧做语义合并,降低帧数与体积:

| 帧 | 合并策略 |
|---|---|
| `delta`(同 from+round) | 多条 `text` 拼接成一条(前端体验等价:打字流合并成一段) |
| `usage` | 只保留**最新**一条(累积量是幂等快照,旧的无意义) |
| `tool_call` | 队列压力大时可丢早期、保留最近 K 条(droppable) |
| `status` | 只保留最新(状态是当前值,中间态可略,但**终态必留**,见 §7.4) |

批量出队用 `batch` 信封一次性 flush(减少 WS 帧数):

```ts
/** 批量信封:把多个 payload 装一帧发送,降低高频小帧开销。前端按序展开应用,seq 取各 payload 自带。 */
export const sBatchSchema = z.object({
  kind: z.literal('batch'),
  frames: z.array(z.object({ seq: z.number().int().nonnegative(), payload: serverPayloadSchema })),
});
```

> 注意:`batch` 内每个 payload 仍带**自己的 seq**(合并不改 seq 语义,W1);前端展开后按 seq 逐条更新游标。`batch` 外层信封 seq 置 0(它是容器,非广播单元)。

### 7.4 降级阶梯(队列压力分级)

```ts
/** 队列水位分级处置(enqueue 内部)。 */
export function onEnqueuePressure(q: BoundedQueue<WsEnvelope>, incoming: ServerPayload): Action {
  const load = q.size() / q.capacity;
  if (load < 0.7) return 'enqueue';                       // 正常
  if (load < 0.9) return coalesceOrEnqueue(incoming);     // 黄:合并 delta/usage/tool_call(§7.3)
  // 红(≥0.9):丢可丢帧(DROPPABLE_KINDS),保权威帧
  if (DROPPABLE_KINDS.has(incoming.kind)) return 'drop';  // delta/tool_call 直接丢
  // 权威帧(message/round/status/usage/diff_ready)即便红区也尽量入队(它们丢了要 resync)
  if (q.size() >= q.capacity) return 'overflow';          // 真满:走 §7.5 不可恢复
  return 'enqueue';
}
```

阶梯总结:
1. **绿(<70%)**:正常入队。
2. **黄(70–90%)**:合并 `delta`/`usage`/`tool_call`(§7.3),减少帧数。
3. **红(≥90%)**:丢 `DROPPABLE_KINDS`(delta/tool_call);权威帧仍尽力入队。
4. **溢出(满且来的是权威帧)**:§7.5 不可恢复处置。

> **终态帧永不丢**:`status` 为终态(done/stalled/aborted/limit,02 §10.2)时**强制入队**(必要时挤掉队列里最老的 droppable 帧腾位),保证前端一定看到 run 结束。

### 7.5 不可恢复溢出:强制 resync 而非堆死

当权威帧也入不进队(队列被权威帧塞满,说明该连接长时间发不出),不无限等也不丢权威数据,而是:

1. server 清空该连接发送队列;
2. 发(若还能写)一帧 `error{code:'WS_BACKPRESSURE', fatal:true}`;
3. `close 4413`(§5.4)。

前端收 4413 → 重连 → `hello.cursor` 带最后 seq → server `resolveResume` 给增量或 full(§6.3)。即**用断点续传兜底背压**:与其在一个堵死的连接上挣扎,不如断开重连重新对齐,权威数据由 jsonl/replayBuffer 保证不丢。

> **为何 resync 优于阻塞**:阻塞会传染引擎(W7 违反);丢权威帧会让前端状态错乱(且无法自愈)。`close+resync` 把“慢消费者”问题**局部化到该连接**,代价是它经历一次重连闪断,但数据最终一致。这是 W2(落盘先于广播)+ §6(续传)给的底气:广播只是投影,断了能补。

---

## 8. 本地服务安全(线上落点;规则本体引用 08 §5 / R8)

> 本节**不重定义**安全规则——绑定/Origin/token/权限分级/redact 的**权威规则在安全文档(08)§5**。本节只把这些规则映射到**线上帧与关闭码**,并列出 WS 层必须遵守的检查点,确保实现不漏。

### 8.1 R8 安全要求 → 本协议落点对照

| 08 / R8 要求 | 本协议落点 | 不满足后果 |
|---|---|---|
| 仅 `127.0.0.1` 绑定(08 §5.1 / S7) | §1.1 transport;server 绑 loopback,不绑 0.0.0.0 | 公网可连(高危) |
| Origin 白名单(08 §5.1) | §5.2 握手第(2)步校验 Origin → 非白 `close 4403` | CSWSH 跨站劫持 |
| 一次性 token(08 §5.2) | §4.1 `hello.token` + §5.2 第(3)步校验“存在/未过期/未用过/runId 匹配”;通过即作废 | 重放/越权连接 |
| token 不进 URL(08 §5.2) | §5.2:token 走 REST 取 + `hello` 首帧提交,不进 WS URL query | token 落历史/日志 |
| 观战/控制权限分级(08 §5.3 / S7) | W6 + §4.4 `admitClientFrame` 权限门;spectate 发控制帧 `close 4403` | 越权控制 run |
| 广播前 redact(08 §3.2 / S4 / W3) | §8.2 `WsHub.broadcast` 内 `redactObject` 必经;尤其 `delta`/`tool_call`(子进程原始流,最可能裹 key) | key 直达浏览器 |
| 控制帧不直改黑板(W4 / 01 §2.3) | §4.2 控制帧→`ControlFrame`→`ControlQueue`,引擎相位边界消费 | 绕过引擎/校验改状态 |
| inject 过防火墙 + 校验(08 §5.3 / 01 RT3) | §4.2 `cInjectSchema`:server 侧 `inject.payload` 走 `firewallPeerMessage`(08 §4)+ `validateMessage`(02 §8) | 人工粘贴注入文本入黑板 |
| **server→client 内容 XSS(08 新增 T16 / RS-B2)** | §8.4 污点字段清单 + 渲染端消毒契约 + CSP;WS 层标污点不转义,面板 10 必消毒 | agent 内容在 control 浏览器执行脚本,代发 abort/inject |
| **流式 redact 跨帧(RS-M1)** | §8.5 `delta`/`diff_chunk` 滑动尾缓冲 redact + 落地前 spectate 不收原始流 | secret 跨帧分片绕过逐帧 redact,明文广播给观战者 |
| **ws-ticket 签发端鉴权(RS-M2)** | §8.6 REST `/ws-ticket` 须带 loopback-secret(0600 文件),否则本机任意进程可取 control 票 | 本机 curl 一条链穿透 127+Origin+token 三层 |

### 8.2 广播 redact 焊死点(W3)

```ts
/** WsHub 广播单一出口:redact 在此焊死(08 S4)。引擎只调它,不自己 send。 */
class WsHub {
  broadcast(runId: string, payload: ServerPayload): void {
    const seq = BROADCAST_KINDS.has(payload.kind) ? this.nextSeq(runId) : 0;  // W1
    // ★ 流式帧(delta/diff_chunk)走跨帧滑动窗口 redact(§8.5),其余整体 redactObject(W3/08 §3.2)
    const safe = isStreamKind(payload.kind)
      ? this.redactStreamingPayload(runId, payload)   // §8.5:可能扣住尾部到下帧
      : (redactObject(payload) as ServerPayload);
    if (BROADCAST_KINDS.has(payload.kind)) this.replay(runId).push(seq, safe); // §6.3 入缓冲(droppable 除外)
    const env: WsEnvelope = { v: WS_PROTOCOL_VERSION, type: `s.${payload.kind}`, runId, seq, ts: Date.now(), payload: safe };
    for (const conn of this.subscribersOf(runId)) {
      // ★ §8.5 spectate 门:跨帧 redact 落地前,delta/tool_call 默认只发 control
      if (DROPPABLE_KINDS.has(payload.kind) && conn.scope === 'spectate' && !this.cfg.streamDeltaToSpectators) continue;
      conn.sendQueue.enqueue(env);   // §7.2 非阻塞;满则降级(§7.4),不回压引擎(W7)
    }
  }
}
```

> 编译期提醒:`WsConnState.redactApplied: true`(§5.3)与“只能由 `broadcast` 入队”的约定共同保证**没有未 redact 的帧能进队列**。新增任何 server→client 发送路径必走 `broadcast` 或显式过 `redactObject`,否则 code review 拦(对应 08 §3.3“新增出境通路必接 redact”)。

### 8.3 控制帧的服务端落地(W4 / inject 双校验)

```ts
/** 控制帧 → ControlFrame 投递(W4)。inject 额外过防火墙 + 校验(08 §4 / 02 §8)。 */
function handleControlFrame(p: ClientPayload, conn: WsConnState, deps: EngineDeps): void {
  switch (p.kind) {
    case 'pause':  deps.controlQueue.push({ kind: 'pause' }); break;       // 01 §2.3
    case 'resume': deps.controlQueue.push({ kind: 'resume' }); break;
    case 'abort':  deps.controlQueue.push({ kind: 'abort', reason: p.reason }); break;
    case 'inject': {
      // human 也可能粘注入文本:照样过 08 §4 防火墙 + 02 §8 校验(在 engine 相位边界二次校验,此处先快筛)
      deps.controlQueue.push({ kind: 'inject', from: 'human', payload: p.payload }); // 01 §2.3
      break;
    }
  }
  conn.send({ kind: 'control_ack', cid: (p as { cid: string }).cid, accepted: true }); // §2.3 受理应答
}
```

> 注意分层:WS 层只做 scope 门(W6)+ 投递 + ack;**真正的 `validateMessage` / `firewallPeerMessage` 在引擎消费 `inject` 时执行**(01 §2.3 / RT3),失败则引擎回一条 `system` 消息说明,经广播帧回到面板。WS 层不抢这一步(单一校验权威在 02/08)。

> **inject 的“已入队未过闸”窗口(吃 RS-m5)**:`controlQueue` 里短暂存在**未过防火墙的 human payload**(从 `cInjectSchema` 受理到引擎相位边界消费之间)。硬约束:**该窗口内的 inject payload 正文绝不进任何广播 / jsonl / 日志通路**——
> - `control_ack`(§2.3)只回 `cid/accepted`,**不回显 payload 正文**;
> - 若审计要记“收到 inject 控制帧”,只记**元数据**(`cid`/`from:'human'`/`ts`/`scope`/`connId`),**不记 `payload.body`/`quote`**;
> - inject 正文只有在引擎消费、过 `firewallPeerMessage`+`validateMessage` 成为正式 `Message` 后,才随 `message` 广播帧落盘/外溢(那时已 redact + 过闸)。
> 即:WS 层对 inject 正文是“只投递不外显”,杜绝“过闸前的人工注入文本被旁路读出”。

### 8.4 server→client 内容 XSS:污点字段 + 渲染消毒契约(吃 RS-B2 / RS-m2,W9)

**威胁(此前整面缺失)**:旧威胁模型只把浏览器当**发起方**(CSWSH / 越权控制帧),从没把浏览器当 server→client 内容的**受害者**。但面板是这套里**唯一持 `control` 权限的实体**:agent(被注入或自身产出)只要在任一污点字段塞 `<img src=x onerror="fetch('/runs/X/ws-ticket',{method:'POST'})…">` 或 `[x](javascript:…)`,若面板按 HTML / 富 markdown 渲染且未消毒,脚本即在面板源(127 同源)执行,可代发 `pause`/`abort`/`inject`、甚至调同源 RestApi 抢 control 票。`redactObject` 抹 `sk-` 但**原样放行 `<script>`**——redact 不是 XSS 防线。

**职责划分(焊死)**:WS 层**不做 HTML 转义**(转义早了会污染回放/审计的原文,且 WS 不知道渲染上下文);WS 层负责的是**把污点标清楚 + 不漏字段**,**渲染端(面板 10)负责消毒**。本节是对 **08 威胁模型(新增 T16)** 与 **10 安全章节**的回填锚点。

**污点字段全清单(渲染端必当不可信文本)**——凡下列字段,面板一律按纯文本渲染或过 DOMPurify 白名单:

| 帧 | 污点字段 | 来源 |
|---|---|---|
| `message` | `message.body`、`message.evidence[].quote`/`.source`/`.locator`、`message.files[].path` | agent / human-inject |
| `delta` | `text` | 子进程原始流 |
| `tool_call` | `name`、`argsDigest` | 子进程原始流 |
| `diff_ready` | `files[].path`(文件名,RS-m2 旁路) | git rename / agent 自填 files |
| `diff_chunk` / REST diff 正文 | `text`(`+`/`-` 行内容) | worktree 实测 |
| `round_planned` | `turns[].role`(字面量,低危但仍 agent 侧配置) | playbook 配置 |
| `status` | `reason`(可能裹 agent 文本 / 错误码) | 引擎 / agent |

> **RS-m2 强调**:消毒必须覆盖**所有**污点字段,**不只 body 和 diff 正文**。文件名、`argsDigest`、evidence `locator`/`source` 这些“短字符串元数据”最常被实现者当“安全”直插 DOM,正是旁路。统一策略:**“agent 来源 = 不可信”,逐字段豁免是反模式**。

**渲染端消毒契约(面板 10 必须实现;本文给硬要求,实现归 10)**:
1. **默认纯文本**:所有污点字段默认 `textContent` 注入,不 `innerHTML`。
2. **markdown 渲染禁 raw HTML**:若气泡用 markdown,必须 `html:false`(或 DOMPurify 白名单标签集),且**禁 `javascript:`/`data:`/`vbscript:` 协议链接**(链接 href 过协议白名单 `http/https/mailto`)。
3. **diff 渲染转义**:diff 库(如 `diff2html`)须确认对 `+`/`-` 行做 HTML 转义;文件名单独走纯文本(不随 diff 库渲染)。
4. **strict CSP**:面板 HTTP 响应带 `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'`(禁 inline script、禁 eval、禁外链),作为消毒漏一处时的兜底——即便某字段漏转义,inline `onerror` 也被 CSP 拦。

> **WS 层能做的辅助硬化(非替代消毒)**:可选在 `redactObject` 之外对污点短字段(`files[].path`/`tool_call.name`)做**控制字符与角括号剥离的轻量 sanitize**(把 `<>` 转义为实体),作为纵深防御**冗余层**;但**不得依赖它替代渲染端消毒**(WS 不知道字段最终进 attribute 还是 text 上下文,转义策略不同)。权威消毒点仍在 10 + CSP。

### 8.5 流式 redact 跨帧滑动窗口(吃 RS-M1,W10)

**威胁**:`redactObject`(08 §3.2)是**对单个字符串跑无状态正则**;而 `delta`/`diff_chunk` 把一段文本**切片**广播。子进程把 `sk-ant-api03-XXXX` 吐成两帧 `"…key is sk-ant-ap"` + `"i03-XXXX…"`,每帧单独过 redact 都**不匹配** `\bsk-ant-[A-Za-z0-9_-]{16,}\b`(被帧边界截断),两帧原样广播 → 前端按 `(from,round)` 拼接后**明文密钥重现在气泡**。最终整条 `message` 会被 redact,但**实时 delta 流已经泄了**。`diff_chunk` 跨 `seqInRef` 同理。

**机制:每条流维护滑动尾缓冲,只发“已被扫描覆盖、确认安全”的前缀**:

```ts
/** 哪些 kind 走流式跨帧 redact(其文本是“切片”而非完整字符串)。 */
function isStreamKind(kind: ServerPayload['kind']): boolean {
  return kind === 'delta' || kind === 'diff_chunk';
}
/** 每条流式通路(delta:key=`${runId}:${from}:${round}`;diff_chunk:key=diffRef)的 redact 状态。 */
interface StreamRedactState {
  /** 上一帧未发出的尾部(可能是某 secret 的前半截);与下一帧拼接后再扫。 */
  tail: string;
}
/** 最长可能 secret 的保守上界(08 SECRET_SIGNATURES 里最长模式 + 余量);尾缓冲至少留这么多字符。 */
const REDACT_TAIL_KEEP = 256;

/** 流式 redact:返回本次“可安全广播的前缀”,把可能跨界的尾部留到下帧。 */
function redactStreaming(st: StreamRedactState, chunk: string): { emit: string; } {
  const buf = st.tail + chunk;
  const scanned = redactString(buf);                 // 08 §3.2 无状态 redact 跑在拼接后的整体上
  // 末尾 REDACT_TAIL_KEEP 字符可能是“下一帧才补全的 secret 前缀”,先扣住不发
  const safeLen = Math.max(0, scanned.length - REDACT_TAIL_KEEP);
  st.tail = buf.slice(buf.length - REDACT_TAIL_KEEP); // 原文尾部留作下次拼接(注意:留原文不留 scanned,避免重复占位)
  return { emit: scanned.slice(0, safeLen) };
}
/** 流结束(收到该 from+round 的 final message,或 diff_chunk.last):把尾缓冲扫描后全部 flush。 */
function flushStreaming(st: StreamRedactState): { emit: string } {
  const out = redactString(st.tail);
  st.tail = '';
  return { emit: out };
}
```

要点与边界:
- **尾缓冲长度** `REDACT_TAIL_KEEP` 必须 ≥ `SECRET_SIGNATURES` 里最长模式的最大匹配长度(含 base64/hex 的 40+ 与 JWT 的可变长),取保守 256 字符 + 余量。短于此则仍可能切穿最长 secret。
- **flush 时机**:delta 流在该 `(from,round)` 的 `message`(整条)落地时 flush 尾缓冲(此后该轮无更多 delta);`diff_chunk` 在 `last:true` 帧 flush。flush 漏做会导致**末尾一段文本永不显示**——属功能 bug,§12 用例 WS33 覆盖。
- **延迟代价**:前端实时性损失 ≤ 一个尾缓冲(256 字符)的延迟,体感可忽略;换来“密钥不会因切片而漏”。
- **降级开关(安全侧硬结论)**:在跨帧 redact 完整落地与回归前,`delta`/`tool_call` 默认**只广播给 `control`,不广播给 `spectate`**(spectate 只收 `message`/`round_*`/`status`/`usage`/`diff_ready`)。这呼应 §3.1 `delta` 的 droppable 性质与 openQuestion「delta 透传隐私/成本」——把“最可能裹推理过程与残漏 secret 的原始流”限制在控制者视野内。该开关由 provider/run 配置项 `streamDeltaToSpectators`(默认 `false`)控制。

> **为何不简单“整条 buffer 完再 redact”**:那等于放弃流式(气泡不再实时打字),退化体验。滑动窗口在“实时”与“不切穿 secret”间取平衡:只扣住末尾一个最长-secret 宽度,其余实时发。

### 8.6 ws-ticket 签发端鉴权:堵死本机非浏览器取票(吃 RS-M2)

**威胁(循环论证已被戳穿)**:08 §5.5 旧论证「真正挡本机越权的是一次性 token,token 经同源 127 的 RestApi 签发,非浏览器拿不到合法 token」是**循环的**——同机恶意脚本 `curl -X POST http://127.0.0.1:<port>/runs/<id>/ws-ticket` **本身就是非浏览器**,它照样能打这个挂在 127 上的端点拿 `control` 票,再伪造 `Origin` 连 WS。于是 Origin 只防浏览器跨站、token 只防重放,**两者都挡不住“本机脚本先 POST 拿票再连”**;整套 WS 鉴权对本机非浏览器退化为“能不能访问 127”。

**机制:`/ws-ticket` 端点必须有真实准入门(loopback-secret),不能裸挂 127**:

```
启动时(中枢):
  1. 生成进程级随机 secret(≥32 字节 CSPRNG);
  2. 写本地文件 ~/.sylux/run-<runId>.secret,权限 0600(仅当前用户可读;Windows 用 ACL 限当前 SID);
  3. 把同一 secret 注入面板首屏(同源页面由中枢自己渲染/内联,不经网络第三方),前端读内存不落 storage。

POST /runs/:id/ws-ticket:
  必带 header  X-Sylux-Local-Secret: <secret>
  server 端:常量时间比较 == 进程 secret  → 否则 401(不签票)
  通过 → 签发 { token, scope, runId, expiresAt }(scope 仍由用户操作/面板上下文决定)
```

要点与边界:
- **为何文件 0600 有效**:本机其他**普通权限**进程读不到 `0600` 文件(类比 Jupyter 的 token 文件 / Docker socket 权限)。能读它的要么是面板(中枢同用户启动)、要么是已提权进程——后者属 08 T5「同机 root/同用户提权」威胁,本就超出威胁模型(任何本机方案都挡不住已提权)。关键是**把门从“能访问 127”抬到“能读 0600 secret 文件”**,挡掉普通本机脚本。
- **control 票额外确认(可选加强)**:`scope:'control'` 票签发可再要求一次中枢终端/面板内人工确认(防面板被 XSS 后静默抢 control,与 §8.4 CSP 形成纵深)。spectate 票可只凭 loopback-secret。
- **诚实标注**:08 §5.5 应据此**改写**——不再用 token 论证“本机安全”,而是写明“本机**普通**进程被 loopback-secret 挡住;已提权进程超出威胁模型”。本文 §8.6 是该论证的线上落点。
- **secret 生命周期**:run 结束删除 secret 文件;secret 绝不进 argv/日志/WS 帧(同 key 的 S3 纪律)。


---

## 9. diff 帧线格式与按需拉取

> **里程碑适用性(吃 COV-9)**:diff 一族帧(`diff_ready`/`diff_chunk` + REST 拉取)**只在 M3+(worktree 隔离 + 实际文件写)生效**。M1/M2 按路线图(25)是**纯决策回合**(critic 不产生文件写、不需要 worktree),此阶段:
> - `message.hasDiff` 恒 `false`,中枢**不生成、不广播** `diff_ready`/`diff_chunk`;面板无 diff 入口可点;
> - 这消解 COV-9 指出的矛盾(“M1/M2 无文件写,diff 面板渲染什么”):**M1/M2 面板不渲染 diff**,diff 面板能力随 worktree 一起在 M3 上线;
> - 若 M2 出现“单 checkout 过渡执行”(非 worktree 的写),其 diff 生成/隔离规格归 worktree 文档(09)/路线图(25)裁定的过渡形态,**本文 §9 线格式不变**(同一 `diff_ready` 帧,只是数据源从 worktree 换成单 checkout),WS 层无需为此改协议。该过渡隔离规格的归属是 25/09 的 openQuestion,不属本文。

### 9.1 设计取舍:通知轻、正文重则按需

diff 正文可能很大(一次重构改几百行)。若每条 diff 都全量广播,慢消费者(§7)立刻被撑爆。故拆两层:

- **`diff_ready`(广播帧,§3.1)**:轻量通知 —— 哪条 message、改了哪些文件、各增删行数、是否二进制、每文件一个 `diffRef` 拉取句柄。占 seq、入 replayBuffer(权威,丢了要补)。
- **diff 正文**:**按需**取。两条等价路径:① REST `GET /runs/:id/diff/:diffRef`(推荐,走 HTTP 天然支持大 body + 浏览器缓存);② WS `diff_chunk` 帧(§3.2,分块推,作为纯 WS 环境备选)。正文**不占广播 seq**(它是点对点响应)。

### 9.2 diffRef 句柄

```ts
/** diffRef:中枢生成的 diff 正文拉取句柄。绑定 (runId, round, messageId, path)。
 *  实现建议:不透明 token(server 内存 Map 或 `${round}:${msgId}:${pathHash}`),前端只透传不解析。 */
export type DiffRef = string;
```

- diff 正文由中枢从 worktree `git diff --find-renames` **实测生成**(worktree 文档拥有,本文只消费),**不由 agent 自填**(02 §4:杜绝谎报 diff)。生成结果经 `redact`(08 §3,worktree 里可能混 secret)后缓存,按 `diffRef` 取。
- 句柄**短时效 + 绑 run**:run 终态后保留一段时间(供回看),GC 清理;过期 `diffRef` 拉取 → REST 404 / WS `error{DIFF_REF_EXPIRED}`,前端可由 message.files 重新触发生成。

### 9.3 REST 拉取(推荐路径)

```
GET /runs/:runId/diff/:diffRef          (同源 127,需有效会话/票据)
→ 200 text/x-diff  (unified diff,UTF-8,已 redact)
→ 404 若 diffRef 过期/不存在
→ 413 若单文件 diff 超上限(改走分页 ?part=k 或前端只显示摘要)
```

> 走 REST 的好处:大 body 不挤 WS 帧通道(§7 背压隔离)、浏览器可缓存(`ETag`=diffRef)、支持 `Range`/分页。WS 只发“可以拉了”的信号,正文与实时流物理分离。

### 9.4 WS diff_chunk(纯 WS 备选)

无独立 REST 资源拉取时(或前端偏好单通道),`diff_chunk`(§3.2)分块推:同 `diffRef` 多帧,`seqInRef` 升序,`last:true` 收尾。单帧仍受 256KiB 软上限(§1.2),超大文件多帧拼。`diff_chunk` 是点对点(应答某次拉取请求),不占广播 seq,但**它会与广播帧争用同一连接发送队列**,故大 diff 优先走 REST(§9.3),保留 WS 通道给实时增量。

### 9.5 二进制/超阈值文件降级

- `isBinary:true`(02 §4 `FilePatch.isBinary`)或 diff 行数超阈值:`diff_ready.files[].diffRef` 可为空,前端显示“二进制 / 超大改动,不渲染文本 diff”,只展示文件名 + 增删摘要。与 02 §4 / 面板降级一致。

---

## 10. WsHub 对外接口与引擎广播触点映射

### 10.1 WsHub 接口(server 拥有,引擎/RestApi 调用)

```ts
/** WS 中枢:广播 + 鉴权 + 权限分级 + 控制帧入队。01 §1.2 列其职责;本节定其线上接口。 */
export interface WsHub {
  /** 引擎唯一广播出口(01 §5.2 第③步)。内部:盖 seq(W1)→ redact(W3)→ 入各连接队列(W7)。 */
  broadcast(runId: string, payload: ServerPayload): void;

  /** RestApi 注册新 run(建 replayBuffer + seq 计数器);run 终态后保留窗口供回看。 */
  openRun(runId: string): void;
  closeRun(runId: string, finalStatus: RunStatus): void;

  /** 升级 HTTP 连接(校验 Origin,§5.2 第 2 步);返回连接句柄进入 AWAIT_HELLO。 */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;

  /** 当前连接统计(诊断/面板自观测)。 */
  stats(): { connections: number; perRun: Record<string, { spectators: number; controllers: number }> };
}
```

### 10.2 引擎相位 → WS 帧映射(权威对照,逻辑本体引用 01 §2.1)

| 引擎相位(01) | 触发动作 | WS 广播帧 | seq | 入 replayBuffer |
|---|---|---|---|---|
| P1 `plan` | `playbook.nextTurn` 出 `RoundPlan` | `round_planned` | 占 | 是 |
| P4 `dispatch` | 消费 `AgentEvent.delta` | `delta` | 占 | **否**(droppable,§6.3) |
| P4 `dispatch` | 消费 `AgentEvent.tool_call` | `tool_call` | 占 | **否**(droppable) |
| P6 `append` | `blackboard.append` 落盘成功后(RT7 第③步) | `message`(+`hasDiff`) | 占 | 是 |
| P7 `merge+close` | worktree diff 生成完 | `diff_ready` | 占 | 是 |
| P7 `merge+close` | `closeRound`(指纹集 + 本轮 usage) | `round_closed` + `usage` | 占 | 是 |
| P7/P8 | 冲突硬停 / 状态切换 | `status`(+reason) | 占 | 是 |
| P8 `post-brake` | 终态(done/stalled/limit/aborted) | `status`(终态,§7.4 强制不丢) | 占 | 是 |
| 控制帧入队后 | `startControlPump` 受理 | `control_ack`(点对点) | 0 | 否 |
| pause 生效 | `setStatus('paused')` | `status(paused)` | 占 | 是 |

> **delta/tool_call 占 seq 但不入缓冲**:它们参与前端实时游标推进(避免空洞误判,§6.2),但因 droppable 不进 replayBuffer——重连后不补打字过程,只补到已落地的 `message`。前端逻辑:收 snapshot 后,`delta` 缺口(snapshot watermark 与某 message 之间的打字流)直接忽略,不算空洞(前端按“message 已到即清该轮 delta 暂存”处理)。

### 10.3 一轮完整帧序列(示例时序)

```
引擎相位         WsHub 广播(seq)                 前端面板动作
─────────       ─────────────────               ──────────────
P1 plan         round_planned(seq=10)           渲染“第3轮:codex(proposer)将发言”
P4 dispatch     delta(seq=11) "我建议…"           codex 气泡出现“正在输入…”流式拼接
P4 dispatch     tool_call(seq=12) read_file      气泡下挂“读取 src/x.ts”
P6 append       message(seq=13, hasDiff=true)    打字气泡定型为正式消息 + 显示 diff 入口
P7 merge        diff_ready(seq=14, files=[…])    diff 入口可点开(按需拉 §9)
P7 close        round_closed(seq=15)             第3轮折叠 + 收敛指纹徽标
P7 close        usage(seq=16, total=37645)       累积 token 进度条更新(事实 D)
P8 brake        status(seq=17, running)          (若未终止)继续下一轮
```

---

## 11. WS 错误码 / 关闭码(语义;union 本体引用 02 §12 + 08 §8)

WS 帧 `error.code` 复用 02 §12 `SyluxErrorCode` 子集 + WS 专属码。WS 专属码**需回填 08 §8 / 02 §12**(08 §8 已提出 `WS_AUTH_FAILED`;本文新增以下,均 union 加成员,向后兼容,非破坏性,§演进纪律同 02 §14)。

| code | 类型 | 触发 | close code | 02/08 现状 |
|---|---|---|---|---|
| `WS_AUTH_FAILED` | 鉴权 | token 无效/过期/重放/runId 不匹配(§5.2) | 4401 | 08 §8 已提出(回填 02 §12) |
| `WS_FORBIDDEN_CONTROL` ★ | 权限 | spectate 发控制帧(W6) | 4403 | **需回填**(新增) |
| `WS_ORIGIN_REJECTED` ★ | 传输 | Origin 不在白名单(§5.1) | 4403 | **需回填**(新增) |
| `WS_PROTOCOL_MISMATCH` ★ | 版本 | hello.protocolVersion 不兼容(§2.2) | 4400 | **需回填**(新增) |
| `WS_HELLO_TIMEOUT` ★ | 握手 | helloTimeout 内无 hello(§5.2) | 4408 | **需回填**(新增) |
| `WS_BACKPRESSURE` ★ | 背压 | 发送队列不可恢复溢出(§7.5) | 4413 | **需回填**(新增) |
| `UNKNOWN_FRAME_TYPE` ★ | 协议 | client 帧未知 type(§4.4) | (计 protocol_error,累计 1003) | **需回填**(新增) |
| `DIFF_REF_EXPIRED` ★ | diff | diffRef 过期(§9.2) | (非致命,不 close) | **需回填**(新增) |
| `WS_TICKET_AUTH_FAILED` ★ | 鉴权(REST 侧) | `/ws-ticket` 缺/错 `X-Sylux-Local-Secret`(§8.6) | (REST 401,非 WS close) | **需回填**(新增) |

```ts
// 需回填 02 §12 SyluxErrorCode union(承接 08 §8 已提的 WS_AUTH_FAILED;均向后兼容新增):
//   | 'WS_AUTH_FAILED'        // 08 §8 已提
//   | 'WS_FORBIDDEN_CONTROL'  // 本文:spectate 越权控制
//   | 'WS_ORIGIN_REJECTED'    // 本文:Origin 不白
//   | 'WS_PROTOCOL_MISMATCH'  // 本文:协议版本不兼容
//   | 'WS_HELLO_TIMEOUT'      // 本文:握手超时
//   | 'WS_BACKPRESSURE'       // 本文:背压不可恢复
//   | 'UNKNOWN_FRAME_TYPE'    // 本文:未知帧类型
//   | 'DIFF_REF_EXPIRED'      // 本文:diff 句柄过期
//   | 'WS_TICKET_AUTH_FAILED' // 本文:ws-ticket 端点 loopback-secret 校验失败(RS-M2)
```

> **致命 vs 非致命**:`error.fatal=true` 的码随后必 `close`(4x00x 系列);`fatal=false`(如 `DIFF_REF_EXPIRED`、单帧 `UNKNOWN_FRAME_TYPE` 未超阈值)只回 error 帧、连接续存。前端按 `fatal` 决定重连或仅提示。

### 11.1 protocol_error 计数与熔断

非致命协议错误(坏 JSON、未知 type、payload 不合 schema)计入 `WsConnState.protocolErrors`;超阈值(默认 16)判定该连接行为异常(bug 或恶意),`close 1003`。防一个坏 client 持续刷错误帧耗 CPU(T6 / 08)。

---

## 12. 协议测试矩阵(交付验收锚点)

每条“给定输入/时序 → 期望线上行为”,可直接落 vitest + ws 测试 client;对接总体规划 §12 与 08 §9 SEC21–25。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| **信封/seq** | | | |
| WS1 | seq 单调无空洞 | 连续 5 条广播帧 | seq 1..5 连续(W1) |
| WS2 | 点对点帧不占 seq | snapshot/pong/ack | seq=0,不推进游标 |
| WS3 | 坏信封 | v 字段缺失 | `decode` BAD_ENVELOPE,计 protocol_error |
| WS4 | 未知 type | type='s.bogus' | client 忽略+告警 / server 回 UNKNOWN_FRAME_TYPE |
| **握手/鉴权** | | | |
| WS5 | 无 hello 超时 | 连后 5s 不发 hello | close 4408 |
| WS6 | token 无效 | hello.token 伪造 | error{WS_AUTH_FAILED,fatal}+close 4401 |
| WS7 | token 重放 | 同 token 连两次 | 第二次 close 4401(08 §5.2 一次性) |
| WS8 | Origin 不白 | Origin=evil.com | close 4403(08 §5.1) |
| WS9 | 版本不兼容 | hello.protocolVersion=99 | close 4400 |
| WS10 | 未鉴权发控制帧 | authed 前发 pause | close 4401(W5) |
| **权限分级** | | | |
| WS11 | spectate 发 pause | scope=spectate | close 4403(W6 / 08 §5.3) |
| WS12 | control 发 pause | scope=control | control_ack{accepted:true} |
| WS13 | inject 过校验 | human inject 带注入文本 | 入 ControlQueue;引擎侧过防火墙(08 §4)+ 校验(02 §8) |
| **redact** | | | |
| WS14 | delta 含 key | 子进程 delta 复述 sk- | 广播 payload 无明文 key(W3 / 08 §3) |
| WS15 | message body 含 key | append 的 body 裹 key | 广播帧已 redact |
| **内容 XSS / 流式 redact(v2 新增)** | | | |
| WS31 | 污点字段标记完整 | message.body / files[].path / argsDigest / status.reason 各含 `<img onerror>` | 广播帧原样保留(WS 不转义),但 §8.4 清单全覆盖;配套 10 渲染测试验证纯文本/DOMPurify 消毒(W9 / RS-B2,RS-m2) |
| WS32 | secret 跨 delta 帧分片 | `sk-ant-ap`+`i03-XXXX…` 切两帧 | 拼接后被 redactStreaming 命中,任一 spectator 收到的拼接结果无明文 key(W10 / RS-M1) |
| WS33 | 流式 flush 不丢尾 | 末帧后无更多 delta | flushStreaming 把尾缓冲扫描后发出,前端文本完整不缺尾(§8.5) |
| WS34 | delta 默认不发 spectate | streamDeltaToSpectators=false | spectate 连接收不到 delta/tool_call,只收 message/round/status/usage/diff_ready(§8.5) |
| WS35 | ws-ticket 无 secret | POST 不带 X-Sylux-Local-Secret | 401 不签票;本机 curl 取不到 control 票(§8.6 / RS-M2) |
| WS36 | inject 正文不外显 | human inject 后立即观察 control_ack / 审计 | control_ack 只含 cid/accepted;审计只记元数据,过闸前 payload 正文不进任何广播/jsonl/日志(§8.3 / RS-m5) |
| **重连/续传** | | | |
| WS16 | 窗内增量补帧 | 断线后 cursor 在窗内 | snapshot{delta} 补缺口,无 full |
| WS17 | 超窗 full resync | cursor < oldestSeq | snapshot{full,resync:true} |
| WS18 | server 重启 seq 归零 | cursor > latestSeq | full resync |
| WS19 | 空洞主动 resync | 收到 seq 跳号 | client 发 subscribe{cursor} 补缺 |
| **背压** | | | |
| WS20 | 慢消费者不阻塞引擎 | 连接 socket 不读 | broadcast 立即返回;引擎不卡(W7) |
| WS21 | delta 黄区合并 | 队列 70-90% + 多 delta | delta 合并成少数帧(§7.3) |
| WS22 | droppable 红区丢弃 | 队列 ≥90% + delta | delta 被丢,message 仍入队(§7.4) |
| WS23 | 终态帧不丢 | 队列满 + status(done) | status 强制入队(§7.4) |
| WS24 | 溢出强制 resync | 权威帧入不进 | close 4413 → 重连续传(§7.5) |
| **diff** | | | |
| WS25 | diff_ready 轻量 | message 带 files | diff_ready 不含正文,带 diffRef |
| WS26 | diff 按需拉取 | GET diff/:ref | 200 unified diff(已 redact) |
| WS27 | diffRef 过期 | 拉过期 ref | 404 / error{DIFF_REF_EXPIRED,fatal:false} |
| WS28 | 二进制降级 | isBinary 文件 | diffRef 空,只摘要 |
| WS37 | M1/M2 无 diff | 纯决策回合 message | hasDiff=false,不发 diff_ready;面板无 diff 入口(§9 里程碑 / COV-9) |
| **心跳** | | | |
| WS29 | pongTimeout 死连接 | 不回 WS pong | close 1001 + 队列释放 |
| WS30 | 应用层校时 | client ping | pong{clientTime,serverTime} |

---

## 13. 收尾:权威性声明与回填项

1. **本文拥有(权威,他文引用)**:
   - WS 帧信封 `WsEnvelope` + `seq`/`cid` 语义(§2);server→client / client→server 全部帧 zod(§3/§4)。
   - 连接生命周期状态机 + 关闭码表(§5);重连 + resume cursor + replayBuffer 续传(§6);背压降级阶梯(§7)。
   - **污点字段清单 + 渲染消毒契约 + CSP 要求(§8.4)**、**流式跨帧 redact 滑动窗口 + delta spectate 门(§8.5)**、**ws-ticket loopback-secret 准入(§8.6)**——线上落点权威,规则本体仍引用 08。
   - `diff_ready`/`diff_chunk`/diffRef 线格式 + 按需拉取(§9);`WsHub` 对外接口 + 引擎相位→帧映射(§10)。
   - WS 专属错误码/关闭码语义(§11)。
2. **引用而非另写**:
   - `Message`/`Round`/`BoardState`/`RunStatus`/`TokenUsage`/`AgentMessagePayload`/`SyluxErrorCode` → 02(`@sylux/shared`)。
   - WS 安全规则(127/Origin/一次性 token/权限分级/广播前 redact/内容防火墙)→ 08 §5;本文 §8 只映射线上落点。
   - 引擎相位/广播触点/控制帧入队 → 01 §2.1/§2.3/§5.2;diff 的 git 生成 → worktree 文档(09);刹车阈值 → 04。
3. **回填项(本文相对他文,均向后兼容新增)**:
   - **02 §12 / 08 §8**:新增 WS 错误码 `WS_FORBIDDEN_CONTROL` / `WS_ORIGIN_REJECTED` / `WS_PROTOCOL_MISMATCH` / `WS_HELLO_TIMEOUT` / `WS_BACKPRESSURE` / `UNKNOWN_FRAME_TYPE` / `DIFF_REF_EXPIRED` / `WS_TICKET_AUTH_FAILED`(承接 08 §8 已提的 `WS_AUTH_FAILED`;union 加成员,非破坏性)。
   - **08 威胁模型新增 T16(server→client 内容 XSS,吃 RS-B2)**:本文 §8.4 给出污点字段清单与渲染消毒契约,08 需把它纳入威胁模型(此前只防浏览器作为发起方,缺“agent 内容→control 浏览器 DOM”这一面)。
   - **08 §3.2 redact 流式化(吃 RS-M1)**:本文 §8.5 给出跨帧滑动窗口算法,08 的“新增出境通路必接 redact”在流式场景需补“接了也要跨帧扫”的规则。
   - **08 §5.5 ws-ticket 鉴权改写(吃 RS-M2)**:本文 §8.6 给出 loopback-secret 准入;08 §5.5 应停止用 token 循环论证本机安全,改为“普通本机进程被 0600 secret 挡住,已提权超出威胁模型”。
   - **10 面板**:§8.4 的渲染消毒(纯文本/DOMPurify 白名单/协议白名单/CSP)与 §8.5 的 `streamDeltaToSpectators` 开关需在 10 落实现。
   - **02 §6.3**:本文 `usage` 帧依赖 `final_message.usage`→`Round.usage` 聚合;与 02 已有定义一致,无新增。
   - **01 §2.1**:本文 §10.2 给出比 01 表更细的“是否入 replayBuffer”列;建议 01 引用本文 §6.3/§10.2 而非重述。
   - **全仓编号**:本文 v2 已统一到物理文件名编号(安全=08/worktree=09/面板=10/WS=11),清除了 v1 逻辑编号残留;兄弟文档(01/02/05/06/23)仍用旧逻辑号引用本文/安全,属它们的回填项(x-consistency C-NUM)。
4. **演进纪律**:线格式破坏性变更(删/改帧字段、改 `seq` 语义、改信封)必须 `WS_PROTOCOL_VERSION+1`,握手 `hello` 协商(§5.2);新增可选字段/新增帧 kind(union 加成员)不强制升版,建议 CHANGELOG 标注。`seq`/redact/鉴权门/污点消毒契约属安全敏感,改动需补 §12 对应测试 + code review。

---

## openQuestions(交付即需用户/M0 裁决)

- **全仓文档编号归一**【本文已自洽,留全仓裁决】:本文 v2 已全文采用物理文件名编号(安全=08、worktree=09、面板=10、WS=11),内部不再有“安全(09)”这类漂移。但兄弟文档仍两套并存(01/02/05/06/23 用逻辑号,03/04/07/08/09 用文件名号),且 11/12/22 历史上单稿自相矛盾(x-consistency C-NUM)。需用户**一次性裁决**:全仓锚定文件名编号 + 在 23 落一张双向映射表,然后回填各稿正文。本文不再硬编会漂的数字,此项不阻塞本文交付。
- **§8.4 消毒/CSP 的实现归属确认**:本文给出污点字段清单 + 消毒契约 + CSP 头作为**线上契约**,实现落在面板(10)。需确认 10 接手并新增安全章节、08 把 T16 纳入威胁模型;否则“契约有了、没人实现”仍是 RS-B2 的洞。
- **§8.5 流式 redact 的尾缓冲长度与性能**【默认 256 字符,待实测】:`REDACT_TAIL_KEEP` 取值需覆盖 `SECRET_SIGNATURES` 最长模式;过大伤实时性,过小切穿 secret。M0 用真实 delta 流压测定参。`streamDeltaToSpectators` 默认 `false`(安全侧硬结论),是否对某些低敏 run 放开由 run 配置定。
- **§8.6 loopback-secret 的 control 二次确认强度**:control 票是否一律要中枢终端/面板人工确认(防面板 XSS 后静默抢 control),还是仅高敏 run 要?与 08 T5 威胁边界、面板体验权衡,需用户定策略。
- **diff 拉取走 REST vs WS**【建议 REST,§9.3】:是否引入独立 `GET /runs/:id/diff/:ref` REST 端点(需 RestApi 配合鉴权复用 WS 票据/会话 + §8.6 secret),还是纯 WS `diff_chunk`?影响 RestApi 表面积与浏览器缓存策略,需与 01 §1.2 RestApi 职责对齐。
- **replayBuffer 容量/时效**【默认 1024 帧,§6.3】:按 run 活跃度与本机内存调;终态 run 的缓冲保留多久供回看?与 sqlite 索引(01 §5.3)+ jsonl full 投影的边界需 M0 压测定参。
- **多 run 单连接的 scope 粒度**:一张 control 票据是否可控多个 run,还是 scope 绑单 runId(08 §5.2 `WsTicket.runId` 暗示绑单 run)?若绑单 run,多 run 观战需多票据/多连接,§2.2「单连接多 run」需限定为“同 scope 同源的只读聚合”。需与 08 §5.2 联调确认。


---







