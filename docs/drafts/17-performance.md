# 17 · 性能与背压(并发上限 / 流式背压 / 长会话内存 / 延迟模型 / 超时分级 / 容量估算)· v2

> **版本**:v2(吃掉 red-feasibility FEAS-4、red-ops-cost ROC-M3/m3/m4/m5、x-consistency C-CTX/E12 与 §12.2 红队自检的反例)。v2 相对 v1 的实质变更:① §2 governor 从**单一全局池**改为**全局 hardMax 兜底 + 每出境端点(per-endpoint)子池**(ROC-m3);② §3 令牌桶/AIMD 改为 **per-endpoint 计量**,并加 failover `reset` 钩子(ROC-m4);③ §6.3 **就地钉死 DigestBuilder v0 算法**(纯结构化抽取、零 NLP、可单测),停止与 03 互相 punt(FEAS-4);④ 全文 `ContextBundle`→`PromptContext`(C-CTX/E12);⑤ §8.1 output 占比从固定 ×1.15 改为**模型族分档**(ROC-m5);⑥ §9.4 明确 `@sylux/eval` 的真 spawn 必经同一 governor(ROC-M3)。
>
> **编号约定**:本文档用**逻辑编号**(01 引擎 / 02 黑板协议 / 03 上下文装配 / 04 刹车·成本 / 05·06 适配层 / 07 provider / 10 面板 / 11 WS / 15 观测 / 16 配置 / 18 评测台 / 19 版本漂移)。全仓"逻辑编号 ↔ 磁盘文件名"的权威映射表由定稿统筹(x-consistency C-NUM / x-coverage COV-6 待裁决),本文件交叉引用一律走逻辑编号,定稿据映射表回填即可,不在此另立映射。
>
> **本文件地位**:sylux 性能与并发的权威设计。负责把"两 CLI 子进程 + 中转限流 + 累积 token + 长会话黑板 + 实时面板"这条全链路的**资源约束、背压策略、超时分级、容量估算**钉成可实现规格。
>
> **引用而非另写**:`Message`/`Evidence`/`Round`/`BoardState`/`AgentEvent`/`TokenUsage` 等一切类型以"黑板协议(02)"`@sylux/shared/src/blackboard.schema.ts` 为唯一权威,本文件**只引用不另写**(焊死红队 R1)。成本/费用折算公式以刹车文档(04 §6)为权威,本文件引用其 `usageToUsd`/`predictNextRoundInputTokens`/`BASELINE_INPUT_PER_ROUND`,只在其上加**延迟维度**与**容量估算**。WS server→client 的背压(慢面板)以 WS 协议(11 §7)为权威,本文件只负责**上游**背压(子进程 stdout → 适配层 → 引擎)。
>
> **事实地基**:全文严格遵守 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)。凡事实地基已覆盖的(spawn 约束 A、事件流 B、output-schema C、token 累积/超线性 D、resume 参数 E、claude flag F)**不再标【待实测】**;仅本机未实测的扩展点标【待实测】。

---

## 0. 设计目标与性能不变量

### 0.1 一句话职责

在**本地单机**(Win11 / Node v22,事实地基环境)上,让一次 run 的两路 CLI 子进程、向第三方中转的请求、随轮累积的 token、可能上千条的黑板消息、以及多个观战浏览器,**都在确定的资源上界内运行**,任何一处压力**不阻塞引擎主循环、不 OOM、不打爆中转限流**,并能给配置者一张"跑 N 轮要多少 token / 内存 / 墙钟时间"的容量账。

### 0.2 本文件负责 / 不负责

| 负责(本文件给完整策略 + 接口 + 估算) | 不负责(只引用,定义在别处) |
|---|---|
| 全局子进程并发上限 + **每端点子池**许可信号量(`ConcurrencyGovernor`) | 单轮 serial/parallel 执行语义(引擎 01 §3.3 / 03) |
| 中转限流(429)探测、令牌桶、退避、与熔断协同(**per-endpoint**) | 熔断状态机本体(provider 07 §送错/failover) |
| 流式解析背压(child stdout → AgentEvent 有界队列) | `LineSplitter`/`parseCodexEvents` 解析本体(适配 05 §7) |
| token 累积 → **延迟增长**模型(事实 D 的时间维度) | token→**费用**折算 + 预算刹车(刹车 04 §6) |
| **DigestBuilder 生成算法**(轮摘要,事实 D 省钱命门,§6.3) | digest 何时调用 / 装进 `PromptContext` 的装配策略(引擎 03) |
| 长会话内存治理(黑板增长 / 投影 / 面板虚拟化窗口) | jsonl 行格式 / BoardState 投影规则(02 §7 / 01 §5) |
| 超时分级(connect/first-event/turn/round/run 五级) | `AbortSignal` 取消树本体(01 §3) |
| 容量估算(内存 / 并发 / 吞吐 / 墙钟)与配置反推 | Prometheus 指标后端(观测 15 §3.6) |
| `PerfConfig` 性能配置 schema | provider 计价 `TokenPricing`(07 注入,04 用) |

### 0.3 性能不变量(实现必须保持,违反即 bug)

- **P-1 引擎永不被 IO 阻塞**:任何子进程慢、面板慢、磁盘慢,都**不能**让引擎主循环的相位推进阻塞超过其超时上界。背压靠**有界队列 + 丢弃/合并/降级**消化,绝不靠无限缓冲(承接 11 §7 W7,扩展到上游)。
- **P-2 有界内存**:单 run 常驻内存有**可计算上界**,与轮数 N 的关系最坏 O(N)(消息线性增长)且可经投影裁剪到 O(window);绝不存在"随轮数无界增长的内存结构"(原始 stdout 全量、未裁剪 prompt 历史、未上界的事件队列都禁止)。
- **P-3 限流前刹车**:对中转的并发请求数**永不超过**实测安全并发(默认 2;事实:8 并发即 429),宁可排队等许可,不可发出去吃 429 再退避(429 也烧往返延迟与配额)。
- **P-4 累积成本即累积延迟**:事实 D(input_tokens 随轮超线性累积)不仅是钱,也是**墙钟时间**——单轮处理延迟随 input 量上涨。延迟模型与成本模型同源(§5),容量估算必须把"第 N 轮比第 1 轮慢"算进去。
- **P-5 超时必分级且各有终态**:不存在"一个超时管全程";连接、首事件、单轮、整 run 各有独立超时与独立错误码/终态(§7),避免"卡在某一层但总超时没到→面板假死"。
- **P-6 性能降级可观测**:每一次丢帧、合并、排队、退避、超时,都有计数/事件落观测通路(15),绝不静默吞掉(承接 15 O2/不吞错原则)。
- **P-7 端点隔离**:并发与限流的物理约束**挂在出境端点(base_url host + wire_api)上,不挂在进程上**。不同端点(如 codex→mouubox 中转、claude→anthropic 官方)各有独立的并发预算与 429 历史,一个端点撞墙不拖慢另一个;全局 hardMax 仅作 OS 级总量兜底(文件句柄/内存),不作限流维度(ROC-m3/m4)。

---

## 1. 物理落点与依赖

### 1.1 文件布局(`@sylux/core` 的 perf 子域)

并发治理与背压属**运行时编排**,落 `@sylux/core`(引擎同包,依赖图 `shared ← core ← {providers, agents} ← server ← web`,02 §1.1):

```
packages/core/src/perf/
├─ governor.ts        # ConcurrencyGovernor:全局 hardMax + 每端点子池许可信号量(§2)
├─ rate-limit.ts      # 每端点令牌桶 + 429 退避 + AIMD + 熔断协同(§3)
├─ backpressure.ts    # 上游有界事件队列 + 降级阶梯(§4,流式解析侧)
├─ latency-model.ts   # token 累积 → 延迟预测(§5,与 04 cost-model 同源)
├─ digest.ts          # DigestBuilder:轮摘要生成算法(§6.3,事实 D 省钱命门)
├─ memory.ts          # 黑板内存治理:窗口/投影/水位(§6)
├─ timeouts.ts        # 五级超时 + 看门狗(§7)
├─ capacity.ts        # 容量估算纯函数(§8,给配置者反推)
└─ perf.config.ts     # PerfConfig zod schema(§10)
```

> `latency-model.ts` 与 04 `cost-model.ts` **同源不同维**:cost 给"花多少钱",latency 给"花多少时间",二者都从 `Round[].usage`(02 §10.1)与事实 D 的 `base×k` 模型推。本文件不复制 cost 公式,`import { predictNextRoundInputTokens, BASELINE_INPUT_PER_ROUND } from '@sylux/core/brakes/cost-model'`(04 §6.2)。
>
> `digest.ts` 与 03 上下文装配 **职责对切**(FEAS-4 二选一定形):**本文件(17)拥有 `DigestBuilder` 的生成算法与裁剪上界**(把一个已闭合 `Round` 压成 `RoundDigest`);**03 拥有"何时调用 digest、把哪些 digest + 哪些全文拼进 `PromptContext`"的装配策略**。03 §2.1.1 只定 `RoundDigest` 接口形状,算法实现 import 自此。停止 03↔17 互相 punt。

### 1.2 依赖与被依赖

| 关系 | 对象 | 用途 |
|---|---|---|
| 依赖 | `@sylux/shared`(02) | `TokenUsage`/`Round`/`BoardState`/`AgentEvent`/`SyluxErrorCode` |
| 依赖 | 04 cost-model | `predictNextRoundInputTokens` / `BASELINE_INPUT_PER_ROUND`(§5 延迟模型借其轮序模型) |
| 依赖 | 03 上下文装配 | `RoundDigest`/`EvidenceAnchor` 接口形状对齐(本文件给生成算法,§6.3);`PromptContext` 装配归 03 |
| 被依赖 | 适配层(05/06) | `governor.acquire({endpoint})` 包住每次 spawn;`backpressure` 队列接 stdout 解析 |
| 被依赖 | 引擎(01/03) | 并发回合受 governor 端点子池节流;超时看门狗包住每相位;`buildRoundDigest` 供 03 装配 |
| 被依赖 | 评测台(18) | eval 真 spawn 必经同一 governor(§9.4,ROC-M3) |
| 被依赖 | provider(07) | `rate-limit` 的 per-endpoint 429 信号喂给 07 的 failover/熔断;failover 触发 `resetEndpoint`(ROC-m4) |
| 被依赖 | server/WS(11) | 上游背压指标 + 容量数喂面板;与 11 §7 下游背压串成全链路 |
| 被依赖 | 观测(15) | 所有 perf 计数/事件经 15 的 sink + redact 出境 |

---
## 2. 并发治理(ConcurrencyGovernor:全局 hardMax + 每端点子池)

### 2.1 为什么需要一个进程级闸门(且按端点分池)

并发压力有三个独立来源,若各管各的就会叠加突破中转限流(P-3):

1. **单轮 parallel 范式**:分工并行范式一轮派两 turn 并发 spawn(03 §7.4,01 §3.3),即 2 路并发请求。
2. **多 run 并行**:中枢可同时跑多个 run(01 §6.3 多 run 隔离),每个 run 各自的并发叠加。
3. **Fusion panel(远景)**:一个决策回合的 panel 可站 N 个成员并发答(07 §10.5),N 可 >2。

三者相乘,峰值并发轻易破 8 → 触发 429(事实:本机实测 8 并发即 429,2 安全)。因此并发上限**不能挂在单轮或单 run**,必须有一个**进程级裁决者**——所有 spawn 出口(adapter / panel / health 探测)都先向同一个 `ConcurrencyGovernor` 取许可。

> **v2 修正(ROC-m3/m4):并发约束按端点分池,不是单一全局池。** v1 把所有 spawn 挤进一个 `capacity=2` 的全局池,但"8 并发即 429"是对**单一中转端点**(mouubox)实测的。红蓝默认 `codex→mouubox 中转`、`claude→anthropic 官方`(16 §12.1)是**两个互不相干的端点**,各有各的限额;单一全局池会把它们无谓串行化(parallel/panel 跨端点尤甚)。故 v2 的 governor 是**两层**:
> - **每端点子池(限流维度,P-7)**:按 `EndpointKey = wire_api + ':' + base_url_host` 分别计数。mouubox 占它自己的 2 张,anthropic 占它自己的 2 张,互不挤占。429/AIMD 也按端点各自升降(§3.4)。
> - **全局 hardMax(OS 兜底,非限流维度)**:所有端点在用许可之和的物理上限,防"端点很多时子进程/文件句柄/解析内存总量失控",**不是**为限流(限流交给每端点子池)。默认 6(留 2 端点×各 2 + 余量),远离任何单端点的 429 阈。

> **不变量 P-3 + P-7 的落地点**:`governor` 是唯一的"能不能再发一路请求"的裁决者,且裁决要**同时**满足"该端点子池有空位"与"全局 hardMax 未满"。任何绕过它直接 spawn 的代码路径都是 bug,CI 应静态检查 spawn 调用必经 `governor.acquire`,且覆盖范围**含 `@sylux/eval` 评测台**(§9.4 / §11 测试矩阵 P8)。

### 2.2 许可信号量接口

```ts
/** 全局并发许可的分类:不同出口共享物理上限,但可带优先级与计量标签。 */
export type AcquireClass = 'turn' | 'panel_member' | 'health' | 'evidence_recheck';

/** 出境端点标识:限流子池的 key。由 provider 配置派生,不含 key/secret(P-7 + R8 安全)。 */
export type EndpointKey = string; // 规范形 `${wire_api}:${base_url_host}`,如 'responses:api.mouubox.com'

/** 从 provider 配置派生 EndpointKey(07 ProviderConfig)。host 取自 base_url,绝不含路径/query/key。 */
export function endpointKeyOf(p: { wireApi: string; baseUrl: string }): EndpointKey {
  const host = new URL(p.baseUrl).host;            // 仅 host:port,丢弃 path/query(避免 key 漏进 key)
  return `${p.wireApi}:${host}`;
}

export interface AcquireOptions {
  cls: AcquireClass;
  /** 出境端点:决定走哪个限流子池(P-7)。同 host 不同 agent 共享子池。 */
  endpoint: EndpointKey;
  /** 归属(计量/取消用) */
  runId: string;
  agent?: AgentId;          // 02 AgentId
  /** 本次 run 的取消 signal(01 §3.2);等许可期间 abort 立即放弃排队 */
  signal: AbortSignal;
  /** 排队优先级:数值小先得许可。turn > panel_member > evidence_recheck > health(默认按 cls) */
  priority?: number;
}

/** 许可句柄:务必在 finally release;支持 using 语法(TS 5.2 显式资源管理)。 */
export interface Permit extends Disposable {
  readonly id: string;
  readonly endpoint: EndpointKey;
  readonly acquiredAt: number;
  release(): void;          // 幂等;[Symbol.dispose] 调它;释放同时归还端点子池与全局两处计数
}

export interface ConcurrencyGovernor {
  /** 取一张许可;须端点子池与全局 hardMax 同时有空位,否则按 priority 排队/abort/超时。 */
  acquire(opts: AcquireOptions): Promise<Permit>;
  /** 全局 + 指定端点的在用/排队/容量(指标 + 容量诊断)。 */
  stats(endpoint?: EndpointKey): {
    global: { inUse: number; queued: number; hardMax: number; peakInUse: number };
    endpoint?: { inUse: number; queued: number; capacity: number; peakInUse: number };
  };
  /** 热调整某端点子池上限(AIMD 升降 / 限流自适应,§3.4)。只允许在 [1, hardMax] 内。 */
  resizeEndpoint(endpoint: EndpointKey, newCapacity: number): void;
  /** failover 切端点后,把旧端点的拥塞惩罚清回初值(ROC-m4)。 */
  resetEndpoint(endpoint: EndpointKey): void;
}
```

### 2.3 实现要点(双层闸门:端点子池 + 全局 hardMax + 公平队列 + 可取消)

许可的授予条件是**两层都过**:该端点子池 `inUse < endpointCapacity` **且** 全局 `globalInUse < hardMax`。任一不满足即排队。释放时两处计数同减并各自尝试唤醒。

```ts
export function createGovernor(cfg: {
  hardMax: number;                 // 全局 OS 兜底上限,默认 6;所有端点在用之和的硬顶
  defaultEndpointCapacity: number; // 新端点子池初值,默认 2(事实:单端点 2 安全)
  acquireTimeoutMs: number;        // 等许可的最长排队时间(默认 60_000),超时抛 CONCURRENCY_ACQUIRE_TIMEOUT
}): ConcurrencyGovernor {
  let globalInUse = 0, peakGlobal = 0;
  // 每端点状态:容量 + 在用 + 该端点的等待者(同优先级 FIFO)
  const pools = new Map<EndpointKey, { cap: number; inUse: number; peak: number }>();
  const waiters: Array<{ endpoint: EndpointKey; priority: number; seq: number;
    resolve: (p: Permit) => void; reject: (e: unknown) => void; onAbort: () => void;
    signal: AbortSignal; timer: NodeJS.Timeout }> = [];
  let seq = 0;
  const poolOf = (k: EndpointKey) =>
    pools.get(k) ?? (pools.set(k, { cap: cfg.defaultEndpointCapacity, inUse: 0, peak: 0 }), pools.get(k)!);

  function canGrant(w: { endpoint: EndpointKey }): boolean {
    const p = poolOf(w.endpoint);
    return p.inUse < p.cap && globalInUse < cfg.hardMax;   // ★两层同时满足
  }
  function tryGrant() {
    // 按 (priority, seq) 全局排序扫描;跳过"端点子池满但全局有空"的等待者,服务下一个可授予者(避免端点级队头阻塞)
    for (const w of sortByPriority(waiters)) {
      if (!canGrant(w)) continue;
      removeWaiter(waiters, w); clearTimeout(w.timer);
      w.signal.removeEventListener('abort', w.onAbort);
      const p = poolOf(w.endpoint); p.inUse++; globalInUse++;
      p.peak = Math.max(p.peak, p.inUse); peakGlobal = Math.max(peakGlobal, globalInUse);
      w.resolve(makePermit(w.endpoint, () => { p.inUse--; globalInUse--; tryGrant(); }));
    }
  }

  return {
    acquire(opts) {
      return new Promise<Permit>((resolve, reject) => {
        if (opts.signal.aborted) return reject(opts.signal.reason);
        const w: any = { endpoint: opts.endpoint, priority: opts.priority ?? defaultPriority(opts.cls),
          seq: seq++, resolve, reject, signal: opts.signal };
        w.onAbort = () => { removeWaiter(waiters, w); clearTimeout(w.timer); reject(opts.signal.reason); };
        w.timer = setTimeout(() => {
          removeWaiter(waiters, w); opts.signal.removeEventListener('abort', w.onAbort);
          const p = poolOf(opts.endpoint);
          reject(new SyluxError('CONCURRENCY_ACQUIRE_TIMEOUT',
            `等并发许可超 ${cfg.acquireTimeoutMs}ms(端点 ${opts.endpoint} 在用 ${p.inUse}/${p.cap},全局 ${globalInUse}/${cfg.hardMax})`));
        }, cfg.acquireTimeoutMs);
        opts.signal.addEventListener('abort', w.onAbort, { once: true });
        waiters.push(w);
        tryGrant();
      });
    },
    stats(endpoint) {
      const g = { inUse: globalInUse, queued: waiters.length, hardMax: cfg.hardMax, peakInUse: peakGlobal };
      if (!endpoint) return { global: g };
      const p = poolOf(endpoint);
      return { global: g, endpoint: { inUse: p.inUse, queued: waiters.filter(w => w.endpoint === endpoint).length,
        capacity: p.cap, peakInUse: p.peak } };
    },
    resizeEndpoint(k, n) { poolOf(k).cap = Math.max(1, Math.min(n, cfg.hardMax)); tryGrant(); },
    resetEndpoint(k) { poolOf(k).cap = cfg.defaultEndpointCapacity; tryGrant(); },
  };
}

function defaultPriority(cls: AcquireClass): number {
  // 小=先得。turn 业务关键最优先;health 探测最低(不能挤占业务)
  return { turn: 0, panel_member: 1, evidence_recheck: 2, health: 3 }[cls];
}
```

> **端点级队头阻塞的规避**:`tryGrant` 不是只看队头,而是扫描整个等待序列服务**第一个两层都满足**的等待者。这样"mouubox 子池已满"的等待者不会挡住"anthropic 子池有空"的等待者——跨端点不互相阻塞(P-7)。同端点内仍按 `(priority, seq)` 公平。

### 2.4 默认值与边界

| 参数 | 默认 | 依据 | 边界/失败 |
|---|---|---|---|
| `defaultEndpointCapacity`(每端点初始并发) | **2** | 事实地基:单端点 2 安全、8 即 429 | resizeEndpoint 下限 1(串行降级),不可 0 |
| `hardMax`(全局 OS 兜底) | **6** | 2 端点 × 各 2 + 余量;非限流维度,防句柄/内存总量失控 | 端点子池之和不得超 hardMax;超则后到者排队 |
| `acquireTimeoutMs` | 60_000 | 等许可上界,防饿死(P-1) | 超时抛 `CONCURRENCY_ACQUIRE_TIMEOUT`,该 turn 走可重试退避(01 §4.2)或下轮重排 |
| panel 并发 | `min(panel.maxConcurrency, 该端点剩余许可, 全局剩余)` | 07 §10.5 `maxConcurrency` | panel 整体仍受端点子池 + 全局 hardMax 双重约束 |

> **关键约束**:`parallel` 范式一轮要 2 张许可。若两 turn 走**同一端点**(如都用 codex→mouubox),它们共抢该端点的 2 张,正好占满(设计意图:单端点 parallel 打满其安全并发)。若两 turn 走**不同端点**(红蓝默认 codex/claude 异端点),则各占各端点的 1 张,**真并发不互相挤占**(P-7,这正是 v2 相对 v1 的吞吐收益)。多 run 并行时,同端点的 turn 公平排队共享该端点的子池;要提单端点吞吐只能 `resizeEndpoint` 升其子池,且需用户确认该中转能扛(否则吃 429)。

### 2.5 与单轮 execution 的关系(不重复定义)

引擎 01 §3.3 的 `serial`/`parallel` 决定**一轮内**几个 turn;governor 决定**全进程**几路能同时真正 spawn(且按端点分别限)。二者正交:`parallel` 的 `Promise.all([runTurn,runTurn])` 里,每个 `runTurn` 内部 spawn 前先 `await governor.acquire({cls:'turn', endpoint: endpointKeyOf(thisAgentProvider)})`。若该端点许可只剩 1,两个**同端点** turn 中一个先跑、另一个在 `acquire` 处挂起等许可——**parallel 语义不变(都会跑),只是被端点闸门串行化到许可可用时**;若两 turn 异端点则并行不阻塞。这把"并发声明"(03)与"并发实施"(本文件)解耦,符合 P-3/P-7。

---
## 3. 中转限流(429)与令牌桶 + 退避 + 熔断协同

### 3.1 两道防线:并发闸门(主动)+ 退避(被动)

事实:本机实测 8 并发即 429,2 安全。429 有两类成因,需两道独立防线:

| 成因 | 防线 | 归属 |
|---|---|---|
| **瞬时并发过高**(同时在飞请求数超阈) | `ConcurrencyGovernor`(§2)从源头限并发到 2 | 主动预防,本文件 §2 |
| **单位时间请求速率过高 / 中转配额**(并发不高但 RPM 超限,或 token-per-min 超限) | 令牌桶限速 + 收到 429 后退避 | 本节 §3.2/§3.3 |

> 单靠并发闸门**不够**:即便并发=2,若每轮很快(短回合)也可能在 1 分钟内发出超过中转 RPM 的请求。令牌桶补这一维。二者叠加:**先过令牌桶(速率),再过 governor(并发)**,两关都过才真正 spawn。

### 3.2 令牌桶(速率维度)

```ts
/** 每端点令牌桶:平滑请求速率,与并发上限正交。每次 spawn 前对该端点 take() 一个令牌。 */
export interface RateLimiter {
  /** 取一个令牌(指定端点);桶空则等到补足或 signal abort / 超时。返回等待了多久(ms,计量)。 */
  take(endpoint: EndpointKey, signal: AbortSignal): Promise<{ waitedMs: number }>;
  /** 收到该端点上游 429:按 Retry-After(或指数退避)临时停发,期间该端点所有 take() 挂起(不影响别的端点)。 */
  penalize(endpoint: EndpointKey, retryAfterMs?: number): void;
  /** failover 切走该端点后清其惩罚(ROC-m4),新端点不继承旧端点拥塞。 */
  reset(endpoint: EndpointKey): void;
  stats(endpoint: EndpointKey): { tokens: number; ratePerMin: number; penalizedUntil?: number };
}

export function createRateLimiter(cfg: {
  ratePerMin: number;       // 每端点默认保守:30(≈每 2s 一个);用户按各中转实际 RPM 配
  burst: number;            // 桶容量(突发上限),默认 = ceil(ratePerMin/10) 且 ≥2
  maxBackoffMs: number;     // 429 退避封顶,默认 60_000
}): RateLimiter {
  // 内部维护 Map<EndpointKey, {tokens, lastRefill, penalizedUntil}>,首次见某端点惰性建桶。
  // take/penalize/reset 均以 endpoint 为 key 操作各自的桶,端点间完全隔离(P-7)。
  /* 标准令牌桶 + penalize 把该端点 penalizedUntil 推后,take 期间检查 */
}
```

> **per-endpoint 桶的意义(P-7)**:mouubox 限流不该让 anthropic 官方陪绑。各端点独立计速率、独立退避;一个端点 penalize 期间,另一个端点照常 take。`ratePerMin` 可按端点在 16 §provider 配置里各配一份(默认 30/min 兜底)。

### 3.3 429 退避与抖动(被动防线)

收到 429 时(适配层从 stderr / 退出码 / 中转响应体识别,05/06),走**带抖动的指数退避**,并喂回令牌桶 `penalize`:

```ts
/** 第 n 次 429(n 从 0)的退避时延:优先用服务端 Retry-After,否则指数+抖动。 */
export function backoffMs(n: number, retryAfterMs: number | undefined, cfg: {
  baseMs: number;     // 默认 1_000
  maxMs: number;      // 默认 60_000
  jitter: number;     // 默认 0.5(±50% 全抖动,防多 run 同步重试再次撞 429)
}): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, cfg.maxMs);
  const exp = Math.min(cfg.baseMs * 2 ** n, cfg.maxMs);
  const rand = 1 + (Math.random() * 2 - 1) * cfg.jitter; // [1-jitter, 1+jitter]
  return Math.round(exp * rand);
}
```

| 场景 | 处理 | 终态/续行 |
|---|---|---|
| 单次 429 | `penalize(backoffMs)` → 该请求退避后**同 provider 重试**,退避计入 turn 超时预算(§7) | 重试成功则续行,不计失败 |
| 退避后仍 429,累计 ≤N 次 | 继续退避重试(N 默认 3) | — |
| 连续 429 超 N 次 | 上抛 provider 层 → 触发 07 的 **failover/熔断**(切备用 provider 或熔断该 provider) | provider 切换事件(07 §送错) |
| 熔断后无可用 provider | 致命 → run `aborted` | `PROVIDER_UNAVAILABLE`(07)/ `ENGINE_FATAL` |

> **退避与并发自适应联动(§3.4)**:首次 429 不只退避当前请求,还**临时把该端点的 governor 子池并发降一档**(`resizeEndpoint(ep, cap-1)`,下限 1),一段稳定无 429 后再缓慢回升。这把"撞墙"反馈进主动防线,且**只降撞墙的那个端点**,不连坐其他端点(P-7,ROC-m4)。

### 3.4 限流自适应(AIMD:撞了猛降,稳了缓升)

借鉴 TCP 拥塞控制的 AIMD(加性增、乘性减),把中转当作"未知容量的管道":

```ts
/** 限流自适应控制器:429 乘性降并发,稳定期加性升,稳态收敛到中转实际安全并发。
 *  v2:所有状态 per-endpoint —— 每个端点各有自己的拥塞窗口与 lastEvent(P-7/ROC-m4)。 */
export class AdaptiveConcurrency {
  // 每端点独立的最近事件时刻;无则视为很久以前(允许升)
  private lastEvent = new Map<EndpointKey, number>();
  constructor(private gov: ConcurrencyGovernor, private cfg: {
    floor: number;          // 默认 1
    ceil: number;           // = governor.hardMax(默认 6);单端点不会真涨到这,受其 ratePerMin/429 自限
    riseAfterMs: number;    // 稳定多久无 429 才 +1,默认 120_000
    riseStep: number;       // 默认 1(加性增)
  }) {}

  on429(ep: EndpointKey): void {
    const cur = this.gov.stats(ep).endpoint!.capacity;
    this.gov.resizeEndpoint(ep, Math.max(this.cfg.floor, Math.floor(cur / 2))); // 乘性减(/2),仅此端点
    this.lastEvent.set(ep, Date.now());
  }
  onStablePeriod(ep: EndpointKey): void { // 定时器对每个活跃端点周期调
    const last = this.lastEvent.get(ep) ?? 0;
    if (Date.now() - last < this.cfg.riseAfterMs) return;
    const cur = this.gov.stats(ep).endpoint!.capacity;
    if (cur < this.cfg.ceil) { this.gov.resizeEndpoint(ep, cur + this.cfg.riseStep); this.lastEvent.set(ep, Date.now()); }
  }
  /** 07 §8.5 failover 切走某端点时调:清该端点拥塞历史 + governor 子池回初值(ROC-m4)。 */
  onFailover(ep: EndpointKey): void { this.lastEvent.delete(ep); this.gov.resetEndpoint(ep); }
}
```

- **每端点初值 2**(事实安全值),**端点上限受其速率与 429 自限**(不会无脑涨到 hardMax),**下限 1**(串行降级仍可推进,绝不卡死)。
- 某端点撞 429 → 仅**它**砍半(2→1);它稳定 120s 无 429 → 仅它 +1。不同端点的拥塞窗口互不影响(mouubox 被降速不拖累 anthropic,ROC-m4)。
- failover 切端点(07 §8.5)→ `onFailover(oldEp)` 把旧端点子池清回初值,避免"换了健康端点还被旧端点的病拖累"(ROC-m4)。
- 【待实测】AIMD 的 `riseAfterMs`/`riseStep` 与**各端点**的安全并发阈在 mouubox/anthropic 上的最优值需 M2 实测校准;本机已知 mouubox"2 安全、8 不安全",anthropic 官方阈值未测,故每端点默认保守取初值 2、全局 hardMax 6,留给 per-endpoint AIMD 在 [1, hardMax] 内各自探。

---
## 4. 流式解析背压(上游:child stdout → AgentEvent → 引擎)

### 4.1 背压链全景(上游 vs 下游)

整条链有两段背压,本文件管**上游**,11 §7 管**下游**:

```
codex/claude 子进程 stdout(字节流,可高频)
   │  ① LineSplitter 切行(05 §7.2,已定义,本文件不重写)
   ▼
原始 JSON 行
   │  ② parseCodexEvents 映射成 AgentEvent(05 §7.3,已定义)
   ▼
AgentEvent 流 ──── ★本文件 §4:有界事件队列 + 降级 ────┐
   │  ③ 引擎消费(append 落盘 → 02 §7)                  │
   ▼                                                     │
Blackboard.append → hub.broadcast(frame)                 │
   │  ④ 11 §7:每连接有界发送队列(下游,慢面板)        │
   ▼                                                     │
浏览器                                                    │
                                                          │
P-1:②③之间若引擎消费慢(append 落盘 IO 慢 / 校验慢),─┘
     不能让原始 stdout 在内存无限堆(大输出 OOM)
```

### 4.2 上游背压的两种压力源与对策

| 压力源 | 现象 | 对策 | 不变量 |
|---|---|---|---|
| **delta 洪流** | agent 流式吐字,`delta` 事件高频(每 token 一个) | `delta` 是 **droppable**:有界队列满时直接丢(面板体验降级为"少几帧打字动画",不影响最终 `final_message`) | P-1 / P-2 |
| **巨型 final/tool 输出** | 单条 `item.completed` 文本极大(几 MB diff/日志) | 原始 stdout **不全量缓存**(05 §7 R-parse-6);`final_message.raw` 落 `maxRawBytes` 上限,超限截断 + 标记(§4.4) | P-2 |

> **关键区分**:`delta` 可丢(只是动画);`final_message`/`session_started`/`error` **不可丢**(权威事件,丢了引擎拿不到结果或 sessionId)。这与 11 §7.4 的 `DROPPABLE_KINDS` 同构,但作用在**上游 AgentEvent 队列**而非下游 WS 队列。

### 4.3 有界 AgentEvent 队列(适配层 → 引擎)

05 §7.3 的 `parseCodexEvents` 产出 `AsyncIterable<AgentEvent>`;本文件在其与引擎消费之间插一个**有界、可降级**的桥队列,把"解析回调推"与"引擎拉"解耦并限内存:

```ts
/** 上游事件桥:解析侧 push,引擎侧 async-pull;满时按 kind 降级(droppable 丢,权威保留)。 */
export interface AgentEventQueue {
  capacity: number;                  // 默认 256 事件
  /** 解析侧入队;返回处置(入队/丢弃/合并)。绝不阻塞解析回调(P-1)。 */
  offer(ev: AgentEvent): 'enqueued' | 'dropped' | 'coalesced';
  /** 引擎侧:async 拉取(无则等;close 后排空返回 done)。 */
  [Symbol.asyncIterator](): AsyncIterator<AgentEvent>;
  /** 进程 close:flush 残余 + 标记结束。 */
  close(): void;
  stats(): { size: number; droppedDelta: number; coalescedDelta: number };
}

const UPSTREAM_DROPPABLE = new Set<AgentEvent['kind']>(['delta', 'tool_call']);

export function createAgentEventQueue(cap = 256): AgentEventQueue {
  const buf: AgentEvent[] = [];
  let dropped = 0, coalesced = 0;
  // ...wake/asyncIterator 略(同 05 §7.3 的 queue+resolveWake 模式)
  return {
    capacity: cap,
    offer(ev) {
      if (buf.length < cap * 0.7) { buf.push(ev); return 'enqueued'; }       // 绿
      if (ev.kind === 'delta') {                                             // 黄/红:delta 合并或丢
        const last = buf[buf.length - 1];
        if (last?.kind === 'delta') { last.text += ev.text; coalesced++; return 'coalesced'; }
        if (buf.length >= cap) { dropped++; return 'dropped'; }              // 队列满,丢 delta
      }
      if (buf.length >= cap && UPSTREAM_DROPPABLE.has(ev.kind)) { dropped++; return 'dropped'; }
      buf.push(ev);                                                          // 权威事件:即便超软阈也入(挤掉 droppable)
      return 'enqueued';
    },
    /* asyncIterator / close / stats ... */
  } as AgentEventQueue;
}
```

> **为何上游也要有界**:若引擎在 P5(校验)/P6(append 落盘)慢,而子进程仍在猛吐 delta,无界队列会把整轮 delta 全堆内存。256 上限 + delta 合并/丢弃,把单 turn 的事件内存钉在常数级(P-2)。`final_message` 永不丢:它一轮只一条(05 §7 R-parse-3 取末条),不会撑爆。

### 4.4 巨型输出的截断(防单条 OOM)

```ts
/** final_message.raw 的字节上限;超限截断并标记,引擎按 OUTPUT_SCHEMA_VIOLATION 兜底重发或降级。 */
export const MAX_RAW_BYTES = 1_000_000 as const; // 1MB,远超正常结构化 payload,够大 diff 也防失控

export function clampRaw(raw: string): { raw: string; truncated: boolean; originalBytes: number } {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes <= MAX_RAW_BYTES) return { raw, truncated: false, originalBytes: bytes };
  // 按字节安全截断(避免切坏多字节 UTF-8),尾部加标记
  const sliced = Buffer.from(raw, 'utf8').subarray(0, MAX_RAW_BYTES).toString('utf8');
  return { raw: sliced + '\n…[TRUNCATED]', truncated: true, originalBytes: bytes };
}
```

- `diff` 正文不走 AgentEvent(02 §4:diff 由中枢从 worktree `git diff` 生成,不由 agent 自填),故 `final_message.raw` 只是结构化 payload(`{kind,body,files,evidence}`,02 §6.1),正常远小于 1MB;1MB 上限是**防失控**的安全阀,触发即视为 agent 行为异常,走 `OUTPUT_SCHEMA_VIOLATION` 兜底(02 §8.4 重发 ≤N)。
- 面板 diff 的"通知轻、正文按需拉"已由 11 §9 处理,本文件不重复。

---
## 5. 延迟模型(token 累积 → 墙钟延迟增长,事实 D 的时间维度)

### 5.1 为什么延迟随轮数涨(与成本同源)

事实 D 钉死:`resume` 不省 token,每轮按**全量历史**重计费,`input_tokens` 随轮超线性累积(round1=18755 → round2=37645,≈翻倍)。这对**墙钟时间**的直接后果(P-4):

- 单轮处理延迟 ≈ `首字节延迟(TTFT) + 处理时间`。处理时间随 **input_tokens 量**上涨(prefill 阶段要过更多 token),输出时间随 **output_tokens** 上涨。
- 第 k 轮 input ≈ `base × k`(04 §6.2 模型,1-based)。故**第 N 轮比第 1 轮慢约 N 倍的 prefill**。8 轮辩论里,后几轮单轮墙钟可能是首轮的 5–8 倍。
- 容量估算(§8 墙钟)必须按"逐轮变慢"积分,不能用 `N × 首轮耗时`(线性低估,与 04 §6.5"别按线性配预算"同理)。

### 5.2 延迟预测模型(latency-model.ts)

延迟模型**复用** 04 的轮序模型(`base×k`),只把 token 量映射成时间,不复制成本公式:

```ts
import { predictNextRoundInputTokens, BASELINE_INPUT_PER_ROUND } from '../brakes/cost-model.js'; // 04 §6.2

/** provider 的吞吐画像(从实测 turn 耗时 + usage 拟合;无实测用保守默认)。 */
export interface LatencyProfile {
  /** 首字节延迟(网络往返 + 中转排队 + 模型启动),ms。默认 2_000(中转经验值)。 */
  ttftMs: number;
  /** prefill 速率:每 1k input token 增加的处理 ms(过历史 token 的开销)。默认 120。 */
  prefillMsPer1kInput: number;
  /** 生成速率:每 1k output token 的 ms(含 reasoning)。默认 600(≈1.6k tok/s 等效)。 */
  genMsPer1kOutput: number;
}

/** 预测第 (nRoundsDone+1) 轮的单轮墙钟(ms)。base 优先用实测首轮 input。 */
export function predictRoundLatencyMs(
  nRoundsDone: number, baseInputPerRound: number, expectedOutputTokens: number, p: LatencyProfile,
): number {
  const inputThisRound = predictNextRoundInputTokens(nRoundsDone, baseInputPerRound); // base×(n+1)
  return p.ttftMs
    + (inputThisRound / 1000) * p.prefillMsPer1kInput
    + (expectedOutputTokens / 1000) * p.genMsPer1kOutput;
}

/** 预测从第 1 轮到第 N 轮的累计墙钟(ms)——逐轮积分,非线性。 */
export function predictCumulativeLatencyMs(
  N: number, baseInputPerRound: number, expectedOutputTokens: number, p: LatencyProfile,
): number {
  let sum = 0;
  for (let k = 0; k < N; k++) sum += predictRoundLatencyMs(k, baseInputPerRound, expectedOutputTokens, p);
  return sum; // ≈ N·ttft + (base·N(N+1)/2/1000)·prefillMsPer1k + N·(out/1000)·genMsPer1k
}
```

### 5.3 延迟预测的两个用途

1. **超时分级的动态基线**(§7.3):turn 超时不应全程固定——第 8 轮天然比第 1 轮慢数倍,固定超时会在后期误杀正常轮。`turnTimeoutMs` 取 `predictRoundLatencyMs(...) × safetyFactor`(默认 ×3),**随轮放大**。
2. **前瞻提醒**(面板/容量):每轮末用 `predictRoundLatencyMs(round+1, …)` 估"下一轮大概要等多久",喂面板进度条(11)与容量诊断(§8),让用户对"越往后越慢"有预期,而非干等假死。

> **延迟模型仅用于估算与动态超时,不用于硬刹车**(硬刹车看实测累积 token/费用,04 §6;延迟只是体验维度)。理由同 04:延迟实测波动大(中转排队、reasoning 抖动),`base×k` 是保守上界,适合做"放大超时窗"与"提前提示",不适合做"到点硬停"的确定性裁决。

### 5.4 默认 LatencyProfile 与校准

| 字段 | 默认 | 来源 | 校准 |
|---|---|---|---|
| `ttftMs` | 2_000 | 中转经验值 | M2 用 `turn.started`→首个 `delta` 时间差实测 |
| `prefillMsPer1kInput` | 120 | 经验值 | M2 用多轮 `turn.completed` 墙钟 vs `input_tokens` 线性拟合斜率 |
| `genMsPer1kOutput` | 600 | 经验值 | M2 用墙钟 vs `output_tokens` 拟合 |

> 【待实测】三个速率默认值是经验起点,非本机实测(事实 D 只实测了 token 量,未实测对应墙钟)。M2 落 `turn.completed.usage` + 墙钟时戳做最小二乘拟合,把 profile 从经验值替成本中转实测值。在拟合前,动态超时用经验 profile ×3 安全系数兜底(宁可超时窗偏大,不误杀正常轮)。

---
## 6. 长会话内存治理(黑板增长 / 投影 / 面板虚拟化)

### 6.1 内存增长的三个来源(逐一上界化,P-2)

| 来源 | 增长形态 | 上界化手段 |
|---|---|---|
| **黑板消息**(`BoardState.messages`,02 §10.2) | O(N×轮内条数),长 run 可上千条,每条含 body+evidence | 内存只保**滑窗**;全量在 jsonl(权威源),按需投影(§6.2) |
| **喂给 agent 的 prompt 历史** | 若每轮全量回灌,O(N) 文本 × 每轮 → O(N²) 拼接(且撞事实 D 累积计费) | 应用层裁剪:旧轮压结论 + 只喂 delta(§6.3,这是事实 D 下省钱的唯一手段) |
| **上游事件队列 / WS 队列** | 已在 §4 / 11§7 有界 | 常数级,不随 N 增长 |

> **不变量 P-2 的核心**:`messages` 在内存里**不是**随 N 无界增长的——它是 jsonl 行日志(02 §7,权威源)的**有界投影**。内存常驻只需"最近 window 条 + 当前轮"+ 各轮 `usage`/指纹摘要(02 §10.1 已缓存,标量,极小)。要看历史全量,从 jsonl 流式回放(01 §5.4),不常驻内存。

### 6.2 黑板内存投影窗口(BoardState 内存态裁剪)

```ts
/** 内存态黑板的窗口配置:常驻多少条消息,超出落盘后从内存逐出(jsonl 仍有全量)。 */
export interface BoardMemoryWindow {
  /** 常驻消息上限(条);超出按 ts 升序逐出最老。默认 2_000。 */
  maxResidentMessages: number;
  /** 至少保留最近 K 轮的全部消息(供引擎构造下一轮上下文)。默认 4。 */
  minResidentRounds: number;
  /** 单条 body 内存上限(超长 body 在内存态截断,全文在 jsonl)。默认 64KB。 */
  maxResidentBodyBytes: number;
}

/** 逐出策略:保最近 minResidentRounds 轮全量 + 全局摘要(usage/指纹),逐出更老的 body。 */
export function evictIfNeeded(state: BoardState, win: BoardMemoryWindow): EvictReport { /* … */ }
```

- 逐出**只动内存态**:被逐出消息的全文仍在 `runs/<runId>.jsonl`(02 §7,append-only),面板要看历史走回放/REST 拉取(11 §9),不从内存。
- **保最近 K 轮全量**:引擎构造下一轮上下文(03 `PromptContext`)只需最近几轮 + 全局摘要,不需要全量历史常驻。这与 §6.3 的 prompt 裁剪是同一约束的两面(内存 & 计费都受益)。
- `Round.usage` / `evidenceFingerprints`(02 §10.1)是**标量摘要**,永不逐出(撑收敛检测 04 §4 与成本/延迟模型 §5),其内存占用与 N 成正比但每轮仅几十字节,O(N) 但系数极小,千轮量级仍 <1MB。

### 6.3 prompt 历史裁剪 + DigestBuilder v0 算法(事实 D 省钱命门,本文件拥有算法,FEAS-4)

事实 D 已钉死:`resume`/中转服务端会话态**不省 token**,省钱唯一靠**应用层裁剪喂给 CLI 的上下文**。`PromptContext` 的装配(喂哪些全文、拼哪些 digest)归引擎 03;但**把一个已闭合 `Round` 压成 `RoundDigest` 的生成算法,v2 在此就地钉死**(停止 03↔17 互相 punt,FEAS-4)。

#### 6.3.1 性能约束(裁剪策略,03 装配时遵守)

| 约束 | 规则 | 依据 |
|---|---|---|
| 不全量回灌 | 喂下一轮的上下文 = 最近 K 轮全文 + 更早轮的 **`RoundDigest`**(非全文) | 事实 D:全量回灌 = O(N²) token = 钱+延迟双爆 |
| evidence 锚点优先保留 | 裁剪时 `evidence`(file_ref/command 锚点)比 body 散文更该留(收敛检测 04 §4 靠指纹差集) | 02 §9 / 04 §4 |
| 裁剪后仍守 `base×k` 上界 | 裁剪应使实际 input **低于** `base×k`(04 §6.2 注),故 `base×k` 作为预测**保守上界**安全 | 04 §6.2 |

#### 6.3.2 DigestBuilder v0:纯结构化抽取(零 NLP、确定性、可单测)

v0 **不做语义摘要**(不调 LLM、不做抽象式压缩),只做**抽取式结构化**:保该轮的 evidence 锚点(收敛命门)+ 角色结论的**机械截断头部** + 标量 usage。理由:① 零额外 token(语义摘要要再调一次模型,自身烧钱且不确定);② 确定性可复现(同一 Round 永远压出同一 digest,可进 §11 单测与 CI 断言);③ 与 H5 注入约束天然兼容(只搬结构化字段 + 截断纯文本,不引入模型再解释的注入面)。

```ts
/** 一轮的压缩摘要;接口形状与 03 §2.1.1 对齐,本文件给生成算法。落 @sylux/shared(02 引用)或 03 由其 import。 */
export interface RoundDigest {
  round: number;
  /** 每个发言角色一条:谁、什么 kind、结论头部(截断)、该发言的 evidence 锚点列表。 */
  entries: Array<{
    from: AgentId; role: string; kind: Message['kind'];
    /** body 的机械截断头部(非语义摘要);保留前 headChars 字符,够看清"在说什么/驳了什么"。 */
    head: string;
    /** 该消息 evidence 的锚点(结构化,verbatim 搬运,不改写)——收敛检测命门,优先保。 */
    anchors: EvidenceAnchor[];
  }>;
  /** 本轮 usage 标量(02 §10.1),延迟/成本/收敛都用 */
  usage: TokenUsage;
  /** 本轮指纹集合(02 §10.1 evidenceFingerprints),供 04 §4 stall 差集 */
  fingerprints: string[];
}

/** evidence 锚点的最小结构化形态(从 02 §9 Evidence 抽取定位字段,丢弃自由文本说明)。 */
export type EvidenceAnchor =
  | { t: 'file_ref'; path: string; startLine?: number; endLine?: number; contentHash?: string }
  | { t: 'command';  cmd: string; expectExitCode?: number; outputHash?: string }
  | { t: 'spec_ref'; docId: string; section?: string };

export interface DigestConfig {
  /** 每条 entry 的 body 截断字符数,默认 280(≈一条结论的核心句)。 */
  headChars: number;
  /** 单个 RoundDigest 的总字节硬上限,默认 2_048;超限按 §6.3.3 降级。 */
  maxDigestBytes: number;
  /** 每 entry 最多保留几个 anchor(防某轮 evidence 爆表),默认 12;超出留前 N(按 evidence 顺序)。 */
  maxAnchorsPerEntry: number;
}

/** 把已闭合 Round 压成 RoundDigest。纯函数、确定性:同输入同输出(可单测 P21)。 */
export function buildRoundDigest(round: Round, cfg: DigestConfig): RoundDigest {
  const entries = round.messages.map((m) => ({
    from: m.from, role: m.role, kind: m.kind,
    head: truncateUtf8(m.body, cfg.headChars),            // 机械截断,不改写
    anchors: extractAnchors(m.evidence ?? []).slice(0, cfg.maxAnchorsPerEntry),
  }));
  const digest: RoundDigest = {
    round: round.index, entries,
    usage: round.usage,                                    // 02 §10.1,标量直引
    fingerprints: round.evidenceFingerprints ?? [],        // 02 §10.1,收敛差集用
  };
  return clampDigestBytes(digest, cfg);                    // §6.3.3 超限降级
}

/** 从 02 §9 Evidence 提取定位锚点(只搬可机器核验的结构化字段,丢弃 prose 说明)。 */
function extractAnchors(evs: Evidence[]): EvidenceAnchor[] {
  return evs.map((e) => {
    switch (e.kind) {
      case 'file_ref': return { t: 'file_ref', path: e.path, startLine: e.startLine, endLine: e.endLine, contentHash: e.contentHash };
      case 'command':  return { t: 'command', cmd: e.cmd, expectExitCode: e.expectExitCode, outputHash: e.outputHash };
      case 'spec_ref': return { t: 'spec_ref', docId: e.docId, section: e.section };
    }
  });
}
```

#### 6.3.3 超限降级阶梯(`clampDigestBytes`:保命门、弃散文)

当某轮 digest 仍超 `maxDigestBytes`(罕见:超长轮 / evidence 爆表),**逐级丢弃,优先级从低到高保留**——anchors 与 fingerprints 最后才动(它们是收敛检测命门,丢了会假阳性 stall):

```ts
function clampDigestBytes(d: RoundDigest, cfg: DigestConfig): RoundDigest {
  let cur = d;
  const size = (x: RoundDigest) => Buffer.byteLength(JSON.stringify(x), 'utf8');
  // 阶梯 1:砍 head 长度(散文最不重要)——逐 entry 把 head 减半,直到达标或 head 见底
  for (let hc = cfg.headChars; size(cur) > cfg.maxDigestBytes && hc > 40; hc = Math.floor(hc / 2)) {
    cur = { ...cur, entries: cur.entries.map(e => ({ ...e, head: truncateUtf8(e.head, hc) })) };
  }
  // 阶梯 2:仍超 → 丢 head,只留 {from,role,kind} 标签 + anchors(结论散文全弃,锚点全留)
  if (size(cur) > cfg.maxDigestBytes) cur = { ...cur, entries: cur.entries.map(e => ({ ...e, head: '' })) };
  // 阶梯 3:仍超(anchors 本身巨大)→ 每 entry anchors 再砍半;fingerprints 永不丢(差集命门)
  while (size(cur) > cfg.maxDigestBytes && cur.entries.some(e => e.anchors.length > 1)) {
    cur = { ...cur, entries: cur.entries.map(e => ({ ...e, anchors: e.anchors.slice(0, Math.max(1, e.anchors.length >> 1)) })) };
  }
  // 阶梯 4:理论兜底——anchors/fingerprints 都已最小仍超,标 truncated 标志(几乎不会到,maxDigestBytes 已宽)
  return cur;
}
```

> **降级顺序的依据**:`head`(散文结论)< `anchors`(可核验锚点)< `fingerprints`(收敛差集输入)。事实 D 要省的是 token,而 head 的散文是最占字节又最不影响"下一轮 agent 别重复已驳方案"的部分;anchors/fingerprints 是 04 §4 stall 差集的输入,丢了会让收敛检测产生**假阳性 stall**(FEAS-4 红队点名:digest 失效则 stall 反而提前误停),故最后才动且 fingerprints 永不丢。

#### 6.3.4 连续性保证(回应 FEAS-4 的 ">2 轮失忆")

- v0 保证:第 j 轮的 **proposal/critique 锚点**(file_ref path:line、command cmd、spec_ref)在 digest 里 **verbatim 留存**;故第 j+2、j+3 轮的 `PromptContext`(03 装配)仍能拼进这些锚点,agent 看得到"第 1 轮提过的方案锚点已被第 2 轮驳过",**不会重复已驳方案**。
- 这把 FEAS-4 要求的退出验收落成可断言项:**"第 3 轮 `PromptContext` 仍含第 1 轮 proposal 的 evidence 锚点,且第 3 轮 agent 不重复第 1 轮已驳方案"**(§11 P21/P22 + M1 连续性验收)。
- v0 的已知损失:**散文级细节**(论证过程、措辞)在 >K 轮后只剩 head 截断甚至丢失。这对"红蓝靠 evidence 锚点收敛"是可接受的(收敛看锚点差集不看散文);若某 playbook 确需更早轮的散文全文,从 jsonl 按需回读(§6.2 罕见路径)。【待实测】v0 digest 的 head 截断长度(默认 280)对连续性的够用度,需 M1 连续性验收实测(03 §1109 Q4 同款 openQuestion,v2 把它从"算法未定"降级为"参数待调"——算法已定,只剩 headChars 调参)。
- **若 M1 选择 digest=全历史直传(不裁剪)**:必须显式标注"M1 不省 token、成本按全量 resume 量级、`maxRounds` 压到很低(如 4)",因为那等于放弃事实 D 省钱手段,与 16 resume 累积成本会爆自相矛盾(FEAS-4 要求③)。v0 算法的存在正是为了让 M1 **不必**走这条退路。

### 6.4 面板虚拟化(前端,引用 10,本文件给数据契约约束)

长 run 上千条消息全渲染会卡前端。虚拟化是**前端**职责(面板文档 10),本文件给**后端必须支持的拉取契约**:

- **不一次推全量**:WS 初次 `hello` 后,server 只推**最近 window 帧** + `cursor`(11 §6),历史按需经 REST 分页拉(`GET /runs/:id/messages?before=<seq>&limit=<n>`)。
- **增量优先**:活跃 run 走 WS 增量(11 §3.1 广播帧);历史 run / 回滚查看走 REST 分页 + 前端窗口虚拟滚动。
- **摘要先行**:面板时间轴先渲染每轮 `Round` 摘要(标量,02 §10.1),用户展开某轮才拉该轮消息全文(懒加载)。

> 这把"前端渲染量"从 O(N×条数)降到 O(视口窗口),与 §6.2 后端内存窗口呼应:**两端都只在内存/DOM 里持有窗口,全量永远在 jsonl**。承接 15 §A4(`round_closed.usage` 已缓存,回放是累加非重扫)。

### 6.5 内存水位与背压联动

```ts
/** 进程内存水位监控:超阈触发更激进逐出 + 降并发(最后一道防 OOM,P-2)。 */
export interface MemoryWatch {
  /** 周期采样 process.memoryUsage().rss / heapUsed。 */
  sample(): { rssBytes: number; heapUsedBytes: number };
  /** 水位分级:绿<softLimit / 黄<hardLimit / 红≥hardLimit。 */
  level(): 'green' | 'yellow' | 'red';
}
```

| 水位 | 触发 | 动作 |
|---|---|---|
| 黄(>softLimit,默认 1.5GB heap) | 内存偏高 | 收紧 `maxResidentMessages`(减半逐出);delta 队列软阈降到 0.5 |
| 红(≥hardLimit,默认 2.5GB) | 逼近 OOM | 强制逐出到 `minResidentRounds`;**所有活跃端点** `governor.resizeEndpoint(ep,1)` 降并发(少一路子进程少一份解析内存);告警事件(15) |

> 【待实测】softLimit/hardLimit 默认值(1.5/2.5GB)按本机常见 Node 默认 heap 上限估;实际应按 `--max-old-space-size` 与机器内存配。M2 跑千轮压测取实际 rss 曲线校准。

---
## 7. 超时分级(五级,各有独立终态,P-5)

### 7.1 为什么要分级(一个超时管不了全程)

不同层卡住的成因与处置完全不同:连接卡(中转不通)要快失败 failover;首事件卡(spawn 成功但 thread 不来)要判 spawn 异常;单轮卡(模型在想/中转排队)要给足时间且**随轮放大**(§5);整 run 卡(无限辩论)是刹车的事(04)。一个全局超时要么误杀慢轮、要么纵容卡死,故必须五级独立(P-5)。

### 7.2 五级超时定义

```ts
export interface TimeoutTiers {
  /** L1 连接:从 spawn 到进程可用 / 首字节网络可达。超 → SUBPROCESS_SPAWN_FAILED(可 failover)。 */
  connectMs: number;        // 默认 15_000
  /** L2 首事件:从 spawn 到首个 session_started(codex: thread.started)。超 → 判 spawn 异常,resumable=false。 */
  firstEventMs: number;     // 默认 30_000
  /** L3 单轮:从 turn 起到 final_message 落。动态:= predictRoundLatencyMs × turnSafetyFactor(§5.3)。 */
  turnBaseMs: number;       // 静态下限,默认 120_000(与 07 timeoutMs 对齐)
  turnSafetyFactor: number; // 动态放大系数,默认 3
  /** L4 轮:一轮内所有 turn(含 parallel)+ 校验 + 合并的总墙钟。超 → 本轮判失败,run 续或停看刹车。 */
  roundMs?: number;         // 默认 = Σturn 预测 × 1.5;0/undefined 表示不单独限(靠 L3+L5)
  /** L5 整 run:全 run 墙钟硬上限(防整体卡死)。超 → run aborted(RUN_TIMEOUT)。 */
  runMs?: number;           // 默认 undefined(靠 maxRounds/token 预算 04 兜,L5 仅可选保险)
}
```

### 7.3 各级语义、看门狗与终态

| 级 | 计时区间 | 默认 | 超时动作 | 错误码 / 终态 |
|---|---|---|---|---|
| L1 connect | spawn → 进程 spawn 成功(execa spawn 事件) | 15s | 杀进程 → 该 provider failover(07);无备用→致命 | `SUBPROCESS_SPAWN_FAILED` → 重试/aborted |
| L2 first-event | spawn 成功 → 首个 `session_started`(02 I5) | 30s | 杀进程,**不**标 resumable(02 §6.3 失败路径),按全新会话重来或失败 | `SUBPROCESS_SPAWN_FAILED` |
| L3 turn | turn 起 → `final_message` | **动态** `max(turnBaseMs, predictRoundLatencyMs(round,…)×3)` | 杀该 turn 进程(signal,01 §3.4)→ 可重试退避(01 §4.2) | `TURN_TIMEOUT`(可重试类) |
| L4 round | 轮起 → 轮末 append+merge 完 | Σturn×1.5(可选) | 取消本轮未完 turn → 本轮判失败 | `ROUND_TIMEOUT` → run 续(看刹车) |
| L5 run | run 起 → 终态 | 可选,默认无 | `root.abort('RUN_TIMEOUT')`(01 §3) | `RUN_TIMEOUT` → aborted |

> **L3 动态是关键**(P-5 + §5.3):第 1 轮超时窗 ≈ `max(120s, 首轮预测×3)`;第 8 轮 input ≈ 8×base,预测墙钟数倍于首轮,超时窗自动放大到 `预测×3`,**不会误杀正常的慢后期轮**。静态下限 `turnBaseMs` 保证早期短轮也有足够窗(不会因首轮预测过小而过早超时)。

### 7.4 看门狗实现(每级一个,挂 AbortSignal)

```ts
/** 通用看门狗:在 signal 上叠一个超时 abort;喂"心跳"可续期(L3 收到 delta 续期,防长输出误判)。 */
export function withTimeout<T>(
  signal: AbortSignal, ms: number, label: string,
  body: (timeoutSignal: AbortSignal, heartbeat: () => void) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  const linked = linkAbort(signal); // 01 §3.1:外部 abort 透传
  let timer = setTimeout(() => ctl.abort(new SyluxError(timeoutCode(label), `${label} 超 ${ms}ms`)), ms);
  const heartbeat = () => { clearTimeout(timer); timer = setTimeout(/* 同上 */, ms); }; // 续期
  // 把 ctl.signal 与 linked.signal 合并喂 body;finally 清 timer + dispose
  /* … */
}
```

- **心跳续期(L3)**:turn 超时窗在**收到 `delta`/`tool_call`**时续期——只要 agent 还在吐字/调工具就不算卡死,真正卡死(长时间无任何事件)才超时。这避免"输出特别长的正常轮"被误杀,同时仍能抓"中转挂起无响应"。
- **与取消树统一**:所有看门狗的 abort 都经 `linkAbort`(01 §3.1)汇流到同一取消根,超时杀进程走 01 §3.4 的 `killAllChildren`,不另造杀进程路径。

### 7.5 超时与退避的预算叠加(防双花)

429 退避(§3.3)与 L3 turn 超时的关系需明确,避免"退避把超时预算吃光":

- 429 退避时间**计入** L3 turn 超时预算(退避也是 turn 在等)。
- 但退避时**进程已退/未发**,不在烧 token(只烧墙钟);故退避期 L3 看门狗**暂停心跳计时**或单独计 `backoffBudgetMs`(默认与 turnBaseMs 同),退避总和超 `backoffBudgetMs` 才判超时,与"模型在跑"的超时分开记。
- 设计意图:模型慢(在烧 token)与中转限流等待(不烧 token)是两类等待,前者受 L3 动态窗管,后者受退避预算管,不混算。

---
## 8. 容量估算(给配置者反推:跑 N 轮要多少 token / 内存 / 墙钟 / 磁盘)

### 8.1 token 容量(引用 04 §6.5,延迟维度补充)

token/费用反推**以 04 §6.5 为权威**(`base×N(N+1)/2×1.2` 留 20% 余量),本文件不重复。这里只补一张把"轮数 → 各维资源"串起来的速查,供配置者一眼估全局(base=18.7k,事实 D):

| N 轮 | 累积 input(`base·N(N+1)/2`) | +output(分档,见下) | 单 run 内存(§8.2) | jsonl 磁盘(§8.4) | 累积墙钟(§8.3,经验 profile) |
|---|---|---|---|---|---|
| 4 | ≈187k | ≈215k / ≈262k | <50MB | ~1–4MB | ≈ 0.5–1.5 min |
| 8 | ≈673k | ≈774k / ≈942k | <80MB | ~3–10MB | ≈ 2–5 min |
| 16 | ≈2.5M | ≈2.9M / ≈3.5M | <150MB | ~8–30MB | ≈ 8–20 min |
| 32 | ≈9.9M | ≈11.4M / ≈13.9M | <250MB(投影窗封顶) | ~20–80MB | ≈ 30–70 min |

> **output 占比按模型族分档(ROC-m5,非固定 ×1.15)**:`+output` 列给两档——`非 reasoning 模型 ×1.15 / reasoning 模型 ×1.40`。reasoning 模型(gpt-5.5 / o 系)的 `reasoning_output_tokens`(事实 B,02 `TokenUsage.reasoningOutputTokens`)常占总 output 30–50%,固定 ×1.15 会系统性低估容量与预算前瞻 → 漏刹。容量估算(§8.5 `estimateCapacity`)按 agent 实际 model 族取对应系数;无法判定族时取保守高档(×1.40)。【待实测】两档系数(15%/40%)是经验起点,M2 用 `turn.completed.usage.reasoning_output_tokens` 实测分布校准(与 04 §6.5 / 15 §3.3 同步改,别让 reasoning 模型默认低估一档)。
>
> 表中内存/磁盘/墙钟为**单 run、单 agent 对、无 panel、经验 profile** 下的量级估算,非实测,供反推配额用。**panel(Fusion)放大**:决策回合站 N 成员则该轮 token/墙钟 ×N(并发受端点子池节流不线性叠墙钟,但 token 实打实 ×N),§8.5 `estimateCapacity` 须把 panel 轮的 N 倍计入(否则低估,ROC-M5 同源)。多 run 并行内存/磁盘叠加,墙钟受 governor 端点并发节流不线性叠加。【待实测】墙钟列依赖 §5.4 经验 profile,M2 校准后替实测值。

### 8.2 内存容量公式(memory.ts 配套)

```ts
/** 单 run 常驻内存粗估(字节)。投影窗封顶后,N 增长只增标量摘要(O(N) 小系数)。 */
export function estimateRunMemoryBytes(N: number, win: BoardMemoryWindow, avgMsgBytes = 4_000): number {
  const residentMsgs = Math.min(win.maxResidentMessages, N * AVG_MSGS_PER_ROUND);
  const windowBytes = residentMsgs * Math.min(avgMsgBytes, win.maxResidentBodyBytes);
  const summaryBytes = N * ROUND_SUMMARY_BYTES; // usage+指纹摘要,每轮 ~200B,永不逐出
  return windowBytes + summaryBytes + FIXED_OVERHEAD; // FIXED:适配器/队列/运行时常数
}
const AVG_MSGS_PER_ROUND = 2, ROUND_SUMMARY_BYTES = 200, FIXED_OVERHEAD = 30_000_000; // 30MB 常数底
```

- **关键性质**:`windowBytes` 被 `maxResidentMessages`(默认 2000)封顶 → 与 N **无关**(超窗逐出,§6.2);只有 `summaryBytes`(O(N) 但每轮 200B)随 N 涨。故 **1000 轮的常驻 ≈ 窗口(默认 ~不超 130MB) + 200KB 摘要 + 30MB 底 ≈ <200MB**,满足 P-2 有界。
- 不含 Node 运行时基线(~50–80MB)与 V8 heap 碎片;红区 hardLimit(§6.5,2.5GB)留足冗余。

### 8.3 墙钟容量(latency-model.ts 配套)

直接调 §5.2 `predictCumulativeLatencyMs(N, base, expectedOutput, profile)`。要点:

- **逐轮变慢**:累积墙钟 ≈ `N·ttft + (base·N(N+1)/2/1000)·prefillMsPer1k + N·(out/1000)·genMsPer1k`,中项是 N² 项(prefill 随 input 累积),故墙钟也**超线性**——与成本同源(P-4)。
- **并发不缩短单 run 串行轮**:辩论范式轮间有依赖(后轮要看前轮),无法并发;governor 并发只在 parallel 范式/多 run 间起作用。故单 run 辩论的墙钟是各轮**串行积分**,加大并发不缩短它(只缩短分工并行范式的轮内)。

### 8.4 磁盘容量(jsonl)

```ts
/** jsonl 文件大小粗估(字节)。每条 message 一行,含 body+evidence 的 JSON 序列化。 */
export function estimateJsonlBytes(N: number, avgLineBytes = 3_000): number {
  return (N * AVG_MSGS_PER_ROUND + N /*round_closed*/ + 8 /*头尾+session*/) * avgLineBytes;
}
```

- jsonl 是 append-only 全量(02 §7,权威源,不逐出),随 N **线性**增长(非 token 的超线性——磁盘存的是消息文本,不是累积重发的 prompt)。千轮量级几十 MB,本地磁盘无压力。
- 大 body(被 §6.2 内存截断的)在 jsonl 仍**全文**落盘(磁盘便宜,保审计完整);只有内存态截断。
- 可选 sqlite 索引(01 §5.3)是只读投影,大小同量级,加速面板检索,不改容量结论。

### 8.5 容量诊断接口(喂面板 + 启动预检)

```ts
/** 给定 PerfConfig + 目标 N,返回各维预估 + 是否触配额,启动时预检 + 面板实时显示。 */
export interface CapacityEstimate {
  targetRounds: number;
  predictedTokens: number;    // 04 §6.5 公式 × output 分档(§8.1)× panel N 倍(决策轮)
  predictedCostUsd?: number;  // 04 usageToUsd(需 pricing)
  predictedWallClockMs: number; // §8.3
  predictedPeakMemBytes: number;// §8.2
  predictedJsonlBytes: number;  // §8.4
  /** 是否会触各刹车上限(maxTotalTokens/maxCostUsd/runMs);触则启动时警告。 */
  willHitBudget: { token: boolean; cost: boolean; time: boolean };
}

/** 估算入参补充:模型族(选 output 分档,§8.1)+ panel 规模(决策轮 N 倍,ROC-M5)。 */
export interface CapacityEstimateInput {
  /** 各 agent 的模型族,决定 output 占比档(§8.1 ROC-m5)。 */
  modelFamilies: Array<'reasoning' | 'non_reasoning'>;
  /** 每个决策回合的 panel 成员数(无 panel = 1);panel 轮 token ×panelSize(§8.1)。 */
  panelSize?: number;
  /** 哪些轮是决策回合(panel 只在决策轮放大,执行轮单 agent)。 */
  decisionRounds?: number;
}
export function estimateCapacity(
  cfg: PerfConfig, brakeCfg: BudgetConfig & TimeoutTiers, N: number, input: CapacityEstimateInput,
): CapacityEstimate;
```

> 启动预检用途:① 用户配了 `maxRounds=32` 但 `maxTotalTokens` 只够 8 轮 → 启动就警告"按当前预算最多约 8 轮就会触 token 上限",而非跑到第 8 轮才发现(对接 04 §6"别按线性配预算"的事前版);② 开了 panel(`panelSize=5`)→ 决策轮 token ×5 计入,避免"忘了 panel 放大导致预算估少 5 倍"(§8.1 / §12.2 panel Q);③ reasoning 模型用 ×1.40 档,避免 reasoning output 低估(ROC-m5)。

---
## 9. 全链路背压与节流的整合时序

### 9.1 一次 turn 从取许可到落盘的完整闸门序列

```
runTurn(turn, round, deps):
  ep = endpointKeyOf(turn.agent.provider)       // §2.2 该 turn 走哪个出境端点
  1. await rateLimiter.take(ep, signal)          // §3.2 该端点速率闸门(令牌桶;429 退避期挂起)
  2. permit = await governor.acquire({cls:'turn', endpoint: ep, signal, priority})  // §2 端点子池+全局双层闸门
     │  ← 等许可期间 abort/超时 → 放弃,turn 走重试/失败(§2.4)
  3. try:
       withTimeout(signal, L1 connectMs, 'connect', ...) 内:
         child = spawn(realExe, args, {signal})  // 事实 A:直调真 exe + stdin
       withTimeout(signal, L2 firstEventMs, 'first-event', ...) 内:
         await first session_started            // 02 I5;超时→SPAWN_FAILED 不标 resumable
       withTimeout(signal, L3 turnMs(动态), 'turn', heartbeat) 内:
         for ev of agentEventQueue(child.stdout):  // §4.3 有界队列;delta 收到→heartbeat 续期
           if ev.delta → 透传面板(可丢)
           if ev.final_message → clampRaw(§4.4) → break
       validate(final)                          // 02 §8(P5)
       append(message)                          // 02 §7 落盘(P6,先盘后广播 W2)
       hub.broadcast(frame)                      // → 11 §7 下游背压(慢面板自己消化)
  4. finally:
       permit.release()                          // §2 还端点子池+全局两处计数 → 唤醒排队 turn
       memoryWatch.level()=='red' → evict + 各端点 governor.resizeEndpoint(ep,1)  // §6.5
       on429(若本 turn 遇 429) → adaptiveConcurrency.on429(ep) + rateLimiter.penalize(ep)  // §3.4,仅此端点
```

### 9.2 背压在链路各段的"泄压阀"对照(绝不回压引擎,P-1)

| 链段 | 压力 | 泄压阀 | 回压引擎? |
|---|---|---|---|
| 速率(§3.2) | RPM 超限 | 令牌桶等待(turn 内,计退避预算 §7.5) | 否(turn 自己等) |
| 并发(§2) | 在飞请求 >2 | governor 排队(优先级,可取消) | 否(排队的 turn 挂起,不占引擎) |
| 上游事件(§4) | delta 洪流 / 巨型输出 | 丢 delta / 合并 / clampRaw | 否(解析侧降级,引擎按需拉) |
| 落盘(§6/01§5) | append IO 慢 | 单写者串行 append(01 §5),上游队列吸收抖动 | 否(队列缓冲;真慢则 §4 丢 delta) |
| 下游 WS(11§7) | 慢面板 | 每连接有界队列 → 降级 → 4413 resync | 否(11 §7 W7) |

> 全链路一句话:**每一段都能自己泄压(等/丢/合并/降级/断连重连),没有一段把压力反推给引擎主循环**。引擎的 P6 `append→broadcast` 永远 O(1) 非阻塞(11 §7.1 已定下游,本文件补齐上游)。

### 9.3 多 run 并行下的全局公平

多 run 共享同一 `governor`(全局单例,§2.1,带每端点子池)与 `rateLimiter`(每端点桶)。公平性:

- governor 按 `(priority, seq)` FIFO **在同端点内**公平(同优先级先到先得),跨端点不互相阻塞(§2.3);全局 hardMax 满时后到者排队,无 run 饿死(acquireTimeout 兜底,§2.4)。
- 速率桶**按端点**共享 → 同端点的多 run 总 RPM 不超该中转限额(P-3 跨 run 成立);不同端点各自计速率,互不连坐(P-7)。
- 内存水位(§6.5)是进程级 → 任一 run 撑大内存,红区降的是**所有活跃端点**子池,所有 run 同受节流(代价公平)。

### 9.4 评测台(`@sylux/eval`)的真 spawn 必经同一 governor(ROC-M3)

评测台(18)跑 `tasks×cells` 矩阵,18 §9.6 自报"默认并发 2 个 (task,cell)"。**这层 (task,cell) 并发是 governor 看不见的上游调度**:若不接 governor,2 个 cell × 各自 parallel 范式(单 run 一轮 2 路)× 可能的 panel(N 成员)会叠加突破并发,直接吃 429——而评测台是**唯一量化成本的工具**(18 §0.1),它自己吃 429 会让 wall-clock/passVariance 失真,量化结论不可信(ROC-M3,major)。

硬约束(本文件钉死,18 遵守):

1. **eval live 态的所有真 spawn 必经本进程同一 `ConcurrencyGovernor`**(与正常 run 共享许可池与每端点子池)。18 的"默认并发 2"语义改为**"提交并发"**(可高),**真并发由 governor 端点子池节流**——(task,cell) 调度只表达"想跑",能不能真 spawn 由 governor 裁决。
2. **CI 守卫(P8)覆盖 `@sylux/eval`**:静态扫描确保 eval 的 spawn 路径也过 `governor.acquire`,与正常 run 同一张网(无旁路)。
3. **replay 态(无真 spawn)不受此限**:回放是 IO-bound,可高并发(18 §9.6 这半句对),不占端点子池。
4. **EQ2 实测改写**:18 §15 EQ2 从"验证裸并发 2 是否被限流"改为"验证接了 governor 后 live 评测不吃 429"(根因是接没接全局 governor,不是裸并发数)。
5. **panel 成员计入端点子池**:eval 跑 panel cell 时,N 成员各自 `acquire({cls:'panel_member', endpoint})`,受对应端点子池约束(panel 不能绕过 governor 一次性扇出 N 路,§8.1 panel 放大同源)。

---

## 10. PerfConfig 配置 schema(perf.config.ts)

```ts
import { z } from 'zod';

export const concurrencyConfigSchema = z.object({
  defaultEndpointCapacity: z.number().int().positive().default(2),  // 事实:单端点 2 安全
  hardMax: z.number().int().positive().default(6),                  // 全局 OS 兜底,非限流维度
  acquireTimeoutMs: z.number().int().positive().default(60_000),
  /** 可选:按 EndpointKey 覆盖各端点初始并发(未列的用 defaultEndpointCapacity)。 */
  perEndpointCapacity: z.record(z.string(), z.number().int().positive()).default({}),
  adaptive: z.object({                                   // §3.4 AIMD(per-endpoint)
    enabled: z.boolean().default(true),
    floor: z.number().int().positive().default(1),
    riseAfterMs: z.number().int().positive().default(120_000),
    riseStep: z.number().int().positive().default(1),
  }).default({}),
});

export const rateLimitConfigSchema = z.object({
  ratePerMin: z.number().int().positive().default(30),   // 每端点默认兜底
  burst: z.number().int().positive().default(3),
  /** 可选:按 EndpointKey 覆盖各端点 RPM(各中转限额不同)。 */
  perEndpointRatePerMin: z.record(z.string(), z.number().int().positive()).default({}),
  backoff: z.object({
    baseMs: z.number().int().positive().default(1_000),
    maxMs: z.number().int().positive().default(60_000),
    jitter: z.number().min(0).max(1).default(0.5),
    maxRetries: z.number().int().nonnegative().default(3),
  }).default({}),
});

export const backpressureConfigSchema = z.object({
  agentEventQueueCapacity: z.number().int().positive().default(256),
  maxRawBytes: z.number().int().positive().default(1_000_000),
});

export const digestConfigSchema = z.object({         // §6.3 DigestBuilder v0
  headChars: z.number().int().positive().default(280),
  maxDigestBytes: z.number().int().positive().default(2_048),
  maxAnchorsPerEntry: z.number().int().positive().default(12),
});

export const memoryConfigSchema = z.object({
  maxResidentMessages: z.number().int().positive().default(2_000),
  minResidentRounds: z.number().int().positive().default(4),
  maxResidentBodyBytes: z.number().int().positive().default(65_536),
  softLimitBytes: z.number().int().positive().default(1_500_000_000),
  hardLimitBytes: z.number().int().positive().default(2_500_000_000),
});

export const timeoutConfigSchema = z.object({
  connectMs: z.number().int().positive().default(15_000),
  firstEventMs: z.number().int().positive().default(30_000),
  turnBaseMs: z.number().int().positive().default(120_000),  // 与 07 timeoutMs 对齐
  turnSafetyFactor: z.number().positive().default(3),
  roundMs: z.number().int().positive().optional(),
  runMs: z.number().int().positive().optional(),
  backoffBudgetMs: z.number().int().positive().default(120_000), // §7.5
});

export const latencyProfileSchema = z.object({
  ttftMs: z.number().int().nonnegative().default(2_000),
  prefillMsPer1kInput: z.number().nonnegative().default(120),
  genMsPer1kOutput: z.number().nonnegative().default(600),
  /** §8.1 output 占 input 的比例分档(ROC-m5):非 reasoning / reasoning 模型。 */
  outputRatioNonReasoning: z.number().positive().default(0.15),
  outputRatioReasoning: z.number().positive().default(0.40),
});

export const perfConfigSchema = z.object({
  concurrency: concurrencyConfigSchema.default({}),
  rateLimit: rateLimitConfigSchema.default({}),
  backpressure: backpressureConfigSchema.default({}),
  digest: digestConfigSchema.default({}),
  memory: memoryConfigSchema.default({}),
  timeouts: timeoutConfigSchema.default({}),
  latencyProfile: latencyProfileSchema.default({}),
});
export type PerfConfig = z.infer<typeof perfConfigSchema>;
```

> 所有默认值"开箱安全":每端点并发 2、每端点速率 30/min、全局 hardMax 6、退避带抖动、超时分级动态放大、内存 2.5GB 红线——本机直接能跑不撞 429、不 OOM。激进调优(某端点 `capacity` 升、`ratePerMin` 升)需用户确认该中转能扛。

### 10.1 错误码(引用 02 §12,本文件拥有项)

错误码全集在 `@sylux/shared/errors.ts`(02 §12)。本文件新增/拥有的性能相关项,需回填 02 §12 union:

| 错误码 | 触发 | 类别(01 §4) |
|---|---|---|
| `CONCURRENCY_ACQUIRE_TIMEOUT` | 等并发许可超 `acquireTimeoutMs`(§2.4) | 可重试 |
| `RATE_LIMITED` | 连续 429 超 `maxRetries`(§3.3),上抛触发 failover | 致命(provider 级,转 07 failover) |
| `TURN_TIMEOUT` | L3 单轮超时(§7.3) | 可重试 |
| `ROUND_TIMEOUT` | L4 轮超时(§7.3) | 协议/续行 |
| `RUN_TIMEOUT` | L5 整 run 超时(§7.3) | 致命(aborted) |
| `BACKPRESSURE_OVERFLOW` | 上游队列权威帧也入不进(§4,极端,等价 OOM 前兆) | 致命 |

> 【回填】上述 6 个错误码需加入 02 §12 `SyluxErrorCode` union(向后兼容新增 union 成员,非破坏性,02 §1.2)。`RATE_LIMITED`/`RUN_TIMEOUT` 等也需在 01 §4.4 错误码→终态表登记。

---
## 11. 性能测试矩阵(交付验收锚点,对接 02 §13 / 04 §12 风格)

| # | 用例 | 输入/操作 | 期望 |
|---|---|---|---|
| P1 | governor 限并发(端点子池) | 同端点 cap=2,同时 acquire×5 同端点 | 同时只 2 张 in-use,3 张排队;release 后按优先级唤醒 |
| P2 | governor 优先级 | 同端点队列含 turn(0)+health(3) | turn 先得许可,health 最后 |
| P3 | governor 可取消等待 | acquire 后 signal.abort | 立即 reject(signal.reason),不占许可,不泄监听器 |
| P4 | acquire 超时 | 池占满 + acquireTimeoutMs=10ms | reject `CONCURRENCY_ACQUIRE_TIMEOUT` |
| P5 | 令牌桶速率(端点) | epA ratePerMin=60,连发 100 take(epA) | 实际放行速率 ≤ ~1/s + burst,不超 RPM;epB 不受影响 |
| P6 | 429 退避抖动 | 模拟 429,n=0..3 | backoffMs 单调上升、封顶 maxMs、含 ±jitter |
| P7 | AIMD 降并发(per-endpoint) | on429(epA) 当 epA cap=4 | epA cap→2(砍半);epB cap 不变;epA stable 120s 后 +1 |
| P7b | 端点隔离不连坐 | epA 撞 429 降到 1,epB 持续无 429 | epB 仍跑满其 cap,不被 epA 拖慢(P-7) |
| P7c | failover reset | onFailover(epA) 当 epA cap=1 | epA cap 回 defaultEndpointCapacity(2),清拥塞历史 |
| P8 | spawn 必经 governor(含 eval) | 静态扫描所有 spawn 调用(含 @sylux/eval) | 全部包在 governor.acquire 内(CI 守卫,P-3/ROC-M3) |
| P9 | 上游队列丢 delta | 队列满 + 灌 delta 洪流 | delta 被合并/丢(droppedDelta>0),final_message 必达 |
| P10 | 巨型 raw 截断 | final raw > MAX_RAW_BYTES | clampRaw truncated=true,UTF-8 不切坏 |
| P11 | 上游不回压引擎 | 引擎消费暂停 + 子进程猛吐 | 内存有界(队列 cap 封顶),不 OOM,引擎恢复后正常拉 |
| P12 | 延迟预测超线性 | predictCumulativeLatencyMs N=1..16 | 含 N² 项,非线性;后轮单轮 > 前轮 |
| P13 | 动态 turn 超时放大 | round=0 vs round=8 | round=8 的 turnMs 显著 > round=0(随 input 预测放大) |
| P14 | L3 心跳续期 | 持续 delta 但超 turnBaseMs | 不超时(心跳续期);停 delta 超窗才 TURN_TIMEOUT |
| P15 | L2 首事件超时 | spawn 成功但无 session_started | firstEventMs 后 SPAWN_FAILED,resumable=false(02 §6.3) |
| P16 | 内存窗口逐出 | append > maxResidentMessages | 最老消息逐出内存,jsonl 仍全量;保最近 minResidentRounds |
| P17 | 内存红区降级 | 模拟 heap≥hardLimit | 各活跃端点 resizeEndpoint(ep,1) + 激进逐出 + 告警事件 |
| P18 | 容量估算反推 | estimateCapacity(N=32, 预算够8轮) | willHitBudget.token=true,启动警告 |
| P19 | 退避不双花超时 | turn 内 429 退避 | 退避计 backoffBudgetMs,不吃 L3 模型超时窗(§7.5) |
| P20 | 多 run 公平(同端点) | 2 run 各请 2 turn 同端点,cap=2 | 4 turn 公平排队共享该端点 2 张,无饿死,总 RPM 不超限 |
| P20b | 多 run 跨端点不阻塞 | run1 turn→epA,run2 turn→epB,各 cap=2 | 两 run 真并行,不互相排队(P-7) |
| P21 | DigestBuilder 确定性 | 同一 Round 调 buildRoundDigest 两次 | 输出逐字节相同(纯函数,可 CI 断言) |
| P22 | digest 连续性锚点 | round1 propose 带 file_ref;裁剪到 round3 PromptContext | round3 上下文仍含 round1 的 evidence 锚点(path:line),不丢(FEAS-4) |
| P23 | digest 超限降级顺序 | 构造超 maxDigestBytes 的 Round | 先砍 head→丢 head→砍 anchors;fingerprints 永不丢(§6.3.3) |
| P24 | eval 真 spawn 经 governor | eval live 矩阵 2 cell × parallel | 真并发受端点子池约束,不破阈不吃 429(ROC-M3) |
| P25 | output 占比分档 | estimateCapacity(reasoning model, N=8) | 用 ×1.40 档,预测 token 高于 ×1.15(ROC-m5) |

> 压测类(P11/P16/P17/P20/P24)用 mock adapter(可控吐字速率/输出大小)+ fake timer,不依赖真中转;延迟/容量/digest 类(P12/P13/P18/P21/P23/P25)是纯函数单测。真中转的**各端点** 429 阈值/AIMD 收敛留 M2 集成测(openQuestions Q1);digest v0 的 headChars 连续性够用度留 M1 连续性验收(P22 的人工判读版,openQuestions Q6)。

---

## 12. 交付说明与红队自检

### 12.1 必须写进交付说明的边界(防误用)

1. **每端点默认并发 2 是安全下限,不是性能目标**:升某端点 `capacity` 前必须确认该中转能扛(本机 mouubox 8 即 429);AIMD 会按端点自动探,但初值保守。全局 hardMax(6)是 OS 兜底不是限流。
2. **延迟模型是估算非保证**:`LatencyProfile` 三速率是经验默认(§5.4),M2 校准前墙钟估算只看量级,动态超时靠 ×3 安全系数兜底。
3. **内存有界靠投影窗 + jsonl 权威源**:看历史全量必走 jsonl 回放(01 §5.4)/REST 拉取(11 §9),不从内存;内存只持窗口(P-2)。
4. **省 token 唯一靠应用层裁剪**(事实 D):本文件的并发/背压/超时治理省的是**资源与稳定性**,不省 token;token 省钱靠 §6.3 DigestBuilder 裁剪历史 + 刹车 04 预算。**性能层不限单轮 token**(panel N 倍预算靠 04 + §8.5 预检,§12.2)。
5. **上游背压只丢 delta(动画),不丢权威事件**:面板偶尔少几帧打字动画是预期降级,`final_message`/`session_started`/`error` 永不丢。
6. **DigestBuilder v0 是抽取式不是语义式**:保 evidence 锚点 + fingerprints(收敛命门)+ body 截断头部,丢散文论证;够红蓝靠锚点收敛,不够某些需散文的 playbook 时从 jsonl 回读(§6.3.4)。

### 12.2 红队自检(对抗性,逐条正面回应)

- **Q「governor 全局单例会不会成为多 run 的串行瓶颈?」** v1 会(单池),v2 已按端点分池(§2,ROC-m3):不同端点(codex→mouubox、claude→anthropic)各有独立子池,跨端点不互相挤占;只有**打同一个中转的多 run**才共享该端点子池——而那正是该中转的真实物理约束(8 即 429),共享是对的。全局 hardMax 仅作 OS 总量兜底,不是限流维度。要提单端点吞吐只能换更高限额 provider 或开多中转(各自独立子池),属 07 provider 配置范畴。
- **Q「per-endpoint 池靠 base_url host 分,若两 provider 同 host 不同 key/path 呢?」** 仍归同一子池(同 host 即同物理限流域,key/path 不同不改变中转的并发限额)。`endpointKeyOf` 只取 `wire_api + host`(丢弃 path/query/key),既正确归并同中转,又**绝不让 key 漏进 EndpointKey**(R8 安全:EndpointKey 会进日志/指标)。极端反例(同 host 多租户各有独立配额)【待实测】,可由 16 §provider 配置显式覆盖 `perEndpointCapacity` 区分。
- **Q「AIMD 砍半后若中转恢复很慢,会不会长期卡在 cap=1?」** 会暂时卡 1(该端点串行),但**仍能推进**(不卡死,P-1);riseAfterMs(120s)无 429 即缓升。且只卡撞墙的端点,别的端点照跑(P-7)。最坏退化成该端点串行执行,正确性不受损,只是慢——"宁慢不死"的取舍。
- **Q「L3 动态超时用预测值,若预测严重偏低会误杀正常轮?」** 已防:① 静态下限 `turnBaseMs`(120s)兜底,预测再低也不低于它;② ×3 安全系数;③ 心跳续期——只要 agent 在吐字就不超时。三重保险下误杀需"预测低 + 无任何输出 + 超 max(120s,预测×3)"同时成立,即真卡死。
- **Q「内存投影窗逐出后,引擎构造下一轮上下文若需要更早的轮怎么办?」** 引擎构造上下文只需"最近 K 轮全文 + 更早轮 `RoundDigest`"(§6.3,事实 D 下本就不该全量回灌);digest 含该轮 evidence 锚点(常驻不逐出的 fingerprints + 落盘的 digest)。若某 playbook 确需更早轮全文,从 jsonl 按需回读(罕见路径,可接受一次磁盘读),不为此把全量常驻内存。
- **Q「DigestBuilder v0 只截断不语义压缩,会不会丢掉关键论证导致 agent 重复已驳方案?」** 收敛靠 evidence 锚点差集(04 §4),不靠散文论证:v0 verbatim 保留每轮 anchors + fingerprints,故"第 1 轮提过、第 2 轮驳过"的**锚点**在第 3 轮仍在上下文里,agent 看得到不会重复(P22 验收)。散文级措辞确实会丢,但那不进收敛判定;真需要散文从 jsonl 回读。这正是 v0 选"结构化抽取"而非"LLM 摘要"的理由:LLM 摘要会再烧一轮 token 且不确定(还引入注入面),与省钱初衷相悖。
- **Q「panel 站 N 成员并发,governor 限了并发但没限单轮 token,会不会一轮烧 N 倍预算才被发现?」** 诚实承认:**本文件的 governor 限的是"同时在飞几路"(并发/墙钟/429 维度),不限"一轮花多少 token"。** 单轮 token 上限是**成本刹车的职责**(04 §6 轮末 `shouldStop` + panel 的 per-turn token 预算),不是性能层能做的——因为 token 用量要到 `turn.completed.usage` 才知道(事实 B),无法在 spawn 前预判单 turn 会吐多少。性能层能做的是:① governor 把 panel N 成员的**并发**钉在端点子池内(不会真的 N 路同时打爆中转);② §8.5 `estimateCapacity` 把 panel 轮的 N 倍 token **计入启动预检**,让用户事前看到"开 panel 这轮约 ×N token";③ `maxRawBytes`(§4.4)给单条输出兜底防失控。真正的"单轮 token 超支即停"留给 04(本文件 §8.5 喂它估算,§9.4 把 panel 成员纳入 governor 计数)。
- **Q「上游丢 delta 会不会丢掉 final 之外的关键信息?」** 不会:delta 是 final_message 的**流式前缀**,最终态以 final_message.raw 为权威(05 §7 R-parse-3 取末条);丢 delta 只影响"实时打字动画",不影响引擎拿到的最终结构化结果。tool_call 丢失只影响面板观战细节,不影响黑板权威态(权威态是 message,02)。
- **Q「令牌桶 + governor 两道闸叠加,会不会过度限制导致空等?」** 二者正交且都是"过则等"非"过则丢":速率桶管 RPM、governor 管在飞并发,正常负载下二者都不是瓶颈(默认 30/min/端点 与端点并发 2 对本机够用);只在真逼近限额时才生效,生效即"该等"——空等正是防 429 的代价,优于发出去吃 429(429 烧往返+配额还得重试,更慢)。

### 12.3 openQuestions(交合稿 / M2 实测解)

见结构化返回 openQuestions 字段。

---

## 13. 收尾:本文件的性能契约声明

1. **唯一定义**:`ConcurrencyGovernor`(全局 hardMax + 每端点子池)/`RateLimiter`(每端点)/`AdaptiveConcurrency`(per-endpoint AIMD)/`AgentEventQueue`/`LatencyProfile`/`TimeoutTiers`/`DigestBuilder`(v0 抽取算法,§6.3)/`PerfConfig` 及配套估算纯函数,落 `@sylux/core/src/perf/`,本文件为权威。
2. **引用而非另写**:类型契约引用 02;成本/费用公式引用 04 §6;`PromptContext` 装配策略引用 03(本文件只给 `RoundDigest` 生成算法);下游 WS 背压引用 11 §7;取消树引用 01 §3;provider failover/熔断引用 07。本文件只在其上加**上游背压 + 每端点并发/限流 + per-endpoint AIMD + 延迟维度 + 超时分级 + DigestBuilder 算法 + 容量估算**。
3. **回填项**:§10.1 新增 6 个错误码(`CONCURRENCY_ACQUIRE_TIMEOUT`/`RATE_LIMITED`/`TURN_TIMEOUT`/`ROUND_TIMEOUT`/`RUN_TIMEOUT`/`BACKPRESSURE_OVERFLOW`)需回填 02 §12 union + 01 §4.4 终态表(向后兼容新增,非破坏性)。`RoundDigest`/`EvidenceAnchor` 接口需与 03 §2.1.1 对齐(03 import 本文件算法,或接口落 02 由两方引用,定稿定落点)。
4. **事实地基遵守**:每端点并发上限(单端点 2 安全/8 即 429)、token 累积超线性(事实 D)、spawn 真 exe + stdin(事实 A)、首事件 session_started(事实 B)、usage 计量(事实 B)全部硬约束落地;未实测的延迟速率/per-endpoint AIMD 调参/各端点 429 阈/内存红线/digest headChars 够用度明确标【待实测】并给经验兜底。
5. **吃掉的红队/交叉 findings**(v2):FEAS-4(DigestBuilder 算法定形,§6.3)、ROC-m3(per-endpoint 子池,§2)、ROC-m4(per-endpoint AIMD + failover reset,§3.4)、ROC-M3(eval 接 governor,§9.4)、ROC-m5(output 占比分档,§8.1)、C-CTX/E12(`ContextBundle`→`PromptContext`,全文)、§12.2 panel per-turn token 诚实边界。

