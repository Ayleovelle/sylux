# 20 · 插件化 DSL 与剧本生态(`@sylux/plugins` 扩展点与信任边界权威设计)

> **本文件地位**:sylux **扩展性层**的权威设计。负责把四个内核能力做成**可插拔扩展点**——① 自定义 Playbook(声明式剧本 DSL 或 JS 模块);② 自定义角色(RoleProfile);③ 自定义 StopPolicy(收敛/停止策略);④ 自定义 provider 适配器(wire_api 模板 / 新 CLI agent adapter)——并给出**第三方插件的信任模型与沙箱**(本文件最核心的安全命题)。物理落 `@sylux/plugins`,加载/注册集成落 `@sylux/server`。
>
> **引用而非另写(焊死红队 R1)**:本文件**不另定义**任何已在别处拥有的类型,只**消费与扩展**:
> - `Message` / `EvidenceItem` / `FilePatch` / `AgentMessagePayload` / `Role` / `MessageKind` / `AgentId` / `Round` / `RunStatus` / `BoardState` / `SyluxError` / `SyluxErrorCode` → **黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。
> - `Playbook` / `BoardView` / `RoundPlan` / `TurnDirective` / `PromptContext` / `ContinuityMode` / `PlaybookParams` / `PlaybookId` / `EngineDeps` / `PlaybookDonePolicy`(装配层包装) → **引擎(03)** `@sylux/core`。
> - `StopPolicy` / `StopContext` / `StopDecision` / `KEEP_RUNNING` / `CompositeStopPolicy` / `DonePolicy` / `BudgetPolicy` / `buildStopPolicy` / `StopPolicyConfig` / 收敛差集算法 → **刹车(04)** `@sylux/core`。**(v2 焊死 E8:03/04 已删 v1 的 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult`,引擎每轮末只调一次 `update→shouldStop`;本文件插件停止策略一律按 04 v3 的 `StopPolicy` child 注入模型,见 §8。)**
> - `ProviderConfig` / `ProviderOverrides` / `KeyStore` / `wireApi` / `toCodexInjection` / `toClaudeInjection` → **provider(07)** `@sylux/providers`。
> - `firewallPeerMessage` / `capSandbox` / `buildChildEnv` / `SECRET_SIGNATURES` / `isPathSafe` / `guardEgress` → **安全文档(08-security-firewall.md;部分兄弟文档引为 09)**。
> - `SyluxConfig` / `loadSyluxConfig` / 派生管线 → **配置(16)** `@sylux/server`。
>
> **事实地基**:进程/token/resume/沙箱首轮定死等结论一律遵守 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)。已覆盖项不再标【待实测】;仅未实测假设标注。
>
> **一句话立场**:**Playbook / RoleProfile / StopPolicy 在数据形态上是「读 `BoardView` → 出 `RoundPlan`/裁决」的纯函数,无任何 I/O 合法需求**;因此第三方它们可被**能力剥离 + 沙箱**安全运行。**provider/agent 适配器需要 spawn/env/key,是能力型扩展,只能「受信任」或「声明式模板」两种受限形态**。这条「纯函数 ↔ 能力型」二分是本文件全部安全设计的轴心。

---

## 0. 设计目标与扩展性不变量

### 0.1 四个扩展点 × 一条信任轴

| 扩展点 | 内核接口(归属) | 第三方代码需要的能力 | 信任形态 | 本文章节 |
|---|---|---|---|---|
| Playbook(剧本) | `Playbook`(03 §3.3) | **零**:纯 `(BoardView)→RoundPlan` | DSL(数据)/ 沙箱 JS | §5 / §6 |
| RoleProfile(角色) | 扩展 `Role`(02 §2) | **零**:映射 + 文案 + evidence 策略(只能收紧) | DSL(数据) | §7 |
| StopPolicy(停止) | `StopPolicy`(04 §2);经 04 `CompositeStopPolicy` 注入 | **零**:纯 `(BoardView)→stop?` | DSL(表达式)/ 沙箱 JS | §8 |
| Provider/Agent 适配器 | `ProviderConfig`/`AgentAdapter`(07/05/06) | **高**:spawn / env / key / fs | 声明式模板 / 受信任代码 | §9 |

> 轴心:前三个扩展点的**合法职责完全不需要触碰文件系统、网络、环境变量、密钥**。它们的输入是只读快照、输出是纯数据。故第三方可放心接入(沙箱兜底)。第四个天然带 I/O,沙箱无法剥离其能力,只能限定为「用户填模板」或「显式信任的代码」。

### 0.2 扩展性不变量(实现必须保持,违反即扩展/安全 bug)

- **X1 内核接口不被插件改写**:插件**只实现** 03 的 `Playbook` / 04 的 `StopPolicy` 等既有接口,**绝不**重定义 02/03 的任何 zod 或接口本体(承接 R1)。`PlaybookId` 等闭合类型用**命名空间扩展**(§1.3),不就地拓宽枚举。
- **X2 纯函数边界**:Playbook / StopPolicy / RoleProfile 的插件实现是**纯函数**——输入只读 `BoardView` 快照,输出纯数据(`RoundPlan` / 停止票 / 文案)。**禁止**在其中做 I/O、读 env、起异步副作用。引擎以此为前提对其**能力剥离 + 沙箱**(§4)。
- **X3 状态可从黑板复算**:插件**不得**持有无法从 `BoardView` 复算的隐藏状态(对应 02「`BoardState` 是 jsonl 投影的单一事实源」)。主从范式的 `tasks/phase/cursor`(03 §7.2)必须是 `deriveState(board)` 的纯函数结果,否则崩溃回放重建即漂移。DSL 形态天然满足(每轮从 `board` 重算);JS 形态由 §5.4 的 `deriveState` 契约强制。
- **X4 输出永远被内核夹取(untrusted-output clamping)**:插件返回的 `RoundPlan` 等是**不可信输出**,进引擎前必过 §5.5 的 `clampRoundPlan`——未知 `agent`/`role` 拒绝、`sandbox` 经 `capSandbox`(08)封顶、`contextCap` 夹到配置上限、`turns` 数量/体积上限、`continuity` 合法性。插件**说什么不算数,夹取后的才算数**。
- **X5 安全闸不可被插件绕过或放松**:`validateMessage`(02 §8)、内容防火墙(08 §4)、evidence 强制(02 C1)、沙箱封顶(08 §6)、env 白名单(08 §2)在引擎/适配层执行,**与插件无关**。插件能力**只增不减**:可让 evidence 更严、可让 run 更早停,**永远不能**让校验更松、停得更晚、权限更高(§7.3 / §8.3 的「单调收紧」定理)。
- **X6 能力型扩展非沙箱即受信任**:provider/agent 适配器若为第三方任意代码,必须经用户**显式信任**(签名 + 知情确认,§3.4);否则只允许**声明式模板**(填 `base_url`/`wire_api`/env 映射,不含代码,§9.2)。绝不在未确认信任下加载携带 I/O 能力的第三方代码。
- **X7 确定性与有界**:插件求值**确定**(同 `BoardView` → 同输出,X3 的推论,保回放一致)且**有界**(CPU/内存/时钟墙上限,§4.4);超时/超量 → `PLUGIN_TIMEOUT`/`PLUGIN_RESOURCE_EXCEEDED`,按「插件故障」降级(§11),绝不挂起引擎。
- **X8 失败不静默 + 全程脱敏**:插件加载/编译/求值失败一律抛带 `SyluxErrorCode` 的 `SyluxError`(02 §12),`detail` 过 `redactObject`(08 §3);插件源码/清单进日志/WS/jsonl 前同样过 redact。

### 0.3 本文件负责 / 不负责

| 负责(给完整类型 + 语义 + 沙箱 + 失败路径) | 不负责(只引用) |
|---|---|
| 插件清单 `PluginManifest` + 能力声明 + 信任 | `Message`/`Evidence`/`Round` 数据类型(02) |
| 信任模型与沙箱(纯函数边界 / worker isolate / 资源闸,§4) | `Playbook`/`BoardView`/`RoundPlan` 接口本体(03) |
| `PluginPlaybook` 契约 + `deriveState` + 输出夹取(§5) | `validateMessage` / 指纹(02 §8/§9) |
| 声明式剧本 DSL 语言规范 + 受限表达式语言(§6) | 内容防火墙 / 沙箱封顶 / env 白名单实现(08) |
| `RoleProfile`(自定义角色映射 + evidence 策略,§7) | `runEngine` 循环 / 四范式(03 §5/§7) |
| `PluginStopPolicy`(适配为 04 `StopPolicy` child 注入 `CompositeStopPolicy`,§8) | 刹车阈值/收敛差集算法/`buildStopPolicy`(04) |
| provider 模板 vs 受信任 adapter 注册(§9) | `ProviderConfig` 字段 / 注入翻译实现(07) |
| 插件 registry / 生命周期 / config 集成 / 热加载(§10) | `SyluxConfig` 顶层 schema / 加载管线(16) |
| 插件相关错误码语义(回填 02 §12,§11) | 错误码 union 本体(02 §12) |

---

## 1. 物理落点、依赖方向与命名空间扩展

### 1.1 包布局(`@sylux/plugins` + server 宿主)

扩展点**接口与求值器**(纯逻辑、可单测、无重 I/O)落 `@sylux/plugins`;**加载/沙箱宿主与 config 集成**(需 fs、worker 进程、与 server 生命周期耦合)落 `@sylux/server`。二者分离的理由:`@sylux/plugins` 要被 `core`/`server` 都可见且保持轻依赖,宿主才碰 I/O。

```
packages/plugins/                      # 纯逻辑层:接口 + DSL 编译 + 求值 + 夹取(无 fs/spawn)
├─ package.json            # name: "@sylux/plugins";依赖 zod + @sylux/shared + @sylux/core + @sylux/providers
├─ src/
│  ├─ index.ts             # 统一 re-export(§12)
│  ├─ manifest.schema.ts   # ★ PluginManifest / Capability / TrustLevel zod(§2)
│  ├─ playbook/
│  │  ├─ plugin-playbook.ts   # PluginPlaybook 契约 + deriveState + 适配到 03 Playbook(§5)
│  │  ├─ dsl.schema.ts        # ★ 声明式剧本 DSL zod(turnRules/phases/…)(§6)
│  │  ├─ dsl-compile.ts       # DSL → PluginPlaybook(纯函数,无 I/O)(§6.5)
│  │  └─ clamp.ts             # clampRoundPlan / clampTurnDirective:不可信输出夹取(§5.5)
│  ├─ expr/
│  │  ├─ expr.schema.ts       # ★ 受限表达式 AST zod(§6.3)
│  │  └─ expr-eval.ts         # 纯求值器(无 eval/Function,白名单算子)(§6.4)
│  ├─ role/
│  │  └─ role-profile.ts      # ★ RoleProfile:自定义角色映射 + evidence 策略(§7)
│  ├─ stop/
│  │  └─ plugin-stop.ts       # ★ PluginStopPolicy + PluginStopAdapter(适配为 04 StopPolicy child,§8)
│  ├─ provider/
│  │  └─ provider-template.ts # ★ ProviderTemplate(声明式 wire 模板,§9.2)
│  └─ errors.ts            # 插件相关错误码(引用 02 §12 全集,§11)
└─ ...

packages/server/src/plugins/           # 宿主层:碰 fs/worker/信任确认
├─ loader.ts               # discover→readManifest→verifyTrust→compile→register(§10.2)
├─ sandbox/
│  ├─ host.ts              # SandboxHost:worker isolate 池 + 资源闸 + 超时(§4.3/§4.4)
│  └─ worker-entry.ts      # worker 侧入口:仅收 BoardView 快照,跑求值,回纯数据
├─ registry.ts            # PluginRegistry:id→已编译插件;热换/卸载(§10.3)
├─ trust-store.ts         # 信任记录(签名公钥 / 用户确认指纹,§3.4)
└─ provider-adapter-host.ts # 受信任 agent adapter 的加载(§9.3,默认禁用)
```

### 1.2 依赖方向(遵守总体规划 §10:`shared ← core ← {providers, agents} ← server ← web`)

```
@sylux/shared      (zod 类型 + 校验,最底层)
      ▲
@sylux/core        (Playbook/BoardView/StopPolicy/CompositeStopPolicy 接口;03/04)
      ▲   ▲
      │   └── @sylux/providers (ProviderConfig;07)
      │            ▲
@sylux/plugins ────┘   依赖 shared+core+providers;★ 不依赖 server/agents/web(避免环)
      ▲
@sylux/server      (宿主:loader/sandbox/registry;import @sylux/plugins + 各子包)
```

- `@sylux/plugins` 依赖 `core`(要 `Playbook`/`BoardView` 类型与四范式可复用基类)、`providers`(要 `ProviderConfig`/wireApi 做模板校验)、`shared`(02 类型)。**不**依赖 `server`/`agents`/`web`,保持纯逻辑可单测。
- 沙箱宿主(worker 进程、fs 发现、信任确认 UI 回路)与 server 生命周期强耦合,落 `@sylux/server`,**单向** import `@sylux/plugins`。
- **关键**:`@sylux/plugins` 自身**无 fs/spawn/net I/O**——它只做「编译 DSL→纯函数」「夹取输出」「求值表达式」。一切 I/O(读插件文件、起 worker、确认信任)在 server 宿主,便于把「纯逻辑」与「能力面」物理隔开(对应 X2)。

### 1.3 命名空间扩展:不就地拓宽闭合枚举(X1)

02/03 把 `PlaybookId`(03 §3.3)、`roleSchema`(02 §2)定义为**闭合 `z.enum`**。插件不能就地改它们(会破 R1 单一权威 + 破坏 wire/校验耦合)。本文件用**命名空间标识 + 投影**解决:

| 闭合类型(02/03) | 插件扩展方式 | 落地 |
|---|---|---|
| `PlaybookId = 'red-blue'\|'master-worker'\|'pair'\|'parallel'` | 插件剧本用**命名空间 id**:`plugin:<pkgName>@<semver>/<name>`(如 `plugin:acme-flows@1.2.0/triage`) | `BoardState.playbookId` 字段是 `z.string()`(02 §10.2 持久化不限枚举),仅 03 的 TS `PlaybookId` 是窄类型。本文件定 `PlaybookRef = PlaybookId \| PluginPlaybookId`(§5.1),引擎按 ref 解析:命中内置→四范式;命中 `plugin:` 前缀→registry 查插件。**02/03 的 zod 一字不改**。 |
| `Role`(6 个:planner/worker/proposer/critic/peer/arbiter) | 插件**不新增** wire 角色,而是定义 `RoleProfile`:声明「我这个自定义角色**映射到**哪个 canonical `Role`」+ 自定义 `roleBrief`/evidence 策略 | `Message.role` 字段**永远**是 6 个 canonical 之一(02 §2 zod 不变;wire/校验/防火墙全部照常)。`RoleProfile` 是 playbook 侧的「角色人设包」,渲染期把自定义 brief 注入 prompt,但写黑板的 `role` 是其 `mapsTo` 的 canonical 值(§7.2)。 |
| `MessageKind`(9 个) | 同上:插件不新增 kind,只在既有 kind 上挂 RoleProfile/DSL 语义 | `Message.kind` zod 不变。 |
| `SyluxErrorCode` | 插件相关码**回填 02 §12**(union 加成员,非破坏性,§11) | 单一权威仍在 02 §12。 |

> 这条是全文最重要的兼容性设计:**插件改的是「行为与人设」,不是「契约类型」**。wire 上跑的永远是 02 的 6 角色 / 9 kind / 固定 Message 形状;插件的「自定义」全部投影到这套封闭契约上。好处:① 02 校验/防火墙/收敛指纹/回放零改动就兼容任意插件;② 旧版中枢读插件 run 的 jsonl 仍能解析(role/kind 都是已知枚举),只是不认得 `playbookId` 的 `plugin:` 前缀(降级为「未知剧本」展示,不崩)。

### 1.4 一个插件包能导出什么

一个插件包(npm 包或本地目录)经 `PluginManifest`(§2)声明,可同时导出多种扩展(各自独立 enable):

```
acme-flows/                       # 一个插件包
├─ sylux-plugin.json              # PluginManifest(§2)
├─ playbooks/triage.dsl.yaml      # 声明式剧本(DSL,无代码)
├─ playbooks/escalate.js          # JS 剧本(沙箱执行)
├─ roles/skeptic.role.yaml        # RoleProfile(数据)
├─ stops/no-progress.stop.yaml    # StopPolicy(DSL 表达式)
└─ providers/acme-relay.json      # ProviderTemplate(声明式,无代码)
```

> 同一包内**声明式(DSL/JSON)** 与 **JS 代码** 可混存,但二者**信任级别不同**(§3):纯 DSL/JSON 可在 `untrusted` 级直接加载(无代码,沙箱都不必);JS 剧本/StopPolicy 需 `sandboxed` 级(§4);provider agent adapter 代码需 `trusted` 级(§3.4)。manifest 必须为每个导出标信任要求,加载器据此决定路径。

---

## 2. PluginManifest —— 插件清单(声明式入口,zod 权威)

每个插件包根目录必须有一份 `sylux-plugin.json`(或 `.yaml`)。它是加载器看到的**第一手数据**,声明:包身份、导出了哪些扩展、各自的信任要求与能力请求、签名。**清单本身是纯数据**(P6 同款约束:不内嵌函数),先过 zod 再做任何加载动作(fail-fast)。

### 2.1 manifest schema

```ts
import { z } from 'zod';

/** 信任级别:决定加载路径与可用能力面(§3)。 */
export const trustLevelSchema = z.enum([
  'declarative',  // 纯数据(DSL/JSON):无代码,无需沙箱;能力面=零(§3.1)
  'sandboxed',    // JS 纯函数:worker isolate 沙箱执行;能力面=只读 BoardView 快照(§3.2/§4)
  'trusted',      // 任意代码(含 I/O):仅用户显式确认 + 签名校验后加载(§3.4)
]);
export type TrustLevel = z.infer<typeof trustLevelSchema>;

/** 扩展种类。 */
export const extensionKindSchema = z.enum([
  'playbook', 'role', 'stop', 'provider_template', 'agent_adapter',
]);
export type ExtensionKind = z.infer<typeof extensionKindSchema>;

/** 能力请求:插件声明它需要什么。declarative/sandboxed 扩展此数组必须为空(X2:纯函数零能力)。
 *  仅 agent_adapter(trusted)可请求 spawn/env/fs/net,且每项都要用户在信任确认时逐条批准(§3.4)。 */
export const capabilitySchema = z.enum([
  'spawn',        // 起子进程(仅 agent_adapter)
  'env',          // 读写子进程 env(仅 agent_adapter,且仍过 buildChildEnv 白名单)
  'fs_read',      // 读文件(仅 agent_adapter,解析 exe 路径等)
  'net',          // 出网(仅 agent_adapter;通常应走 provider base_url,慎批)
]);
export type Capability = z.infer<typeof capabilitySchema>;

/** 单个导出的扩展声明。 */
export const extensionDeclSchema = z.object({
  kind: extensionKindSchema,
  /** 扩展局部名(与包名组合成全局 id,§2.2)。[a-z0-9-]+。 */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** 该扩展所需信任级别。declarative 优先;选 sandboxed/trusted 需 entry 指向代码文件。 */
  trust: trustLevelSchema,
  /** 入口文件(相对包根)。declarative→DSL/JSON 文件;sandboxed/trusted→.js/.mjs 文件。 */
  entry: z.string().min(1),
  /** 能力请求(见上)。declarative/sandboxed 必须为空数组(zod superRefine 强制,§2.3)。 */
  capabilities: z.array(capabilitySchema).default([]),
  /** 人类可读描述(面板展示;过 redact)。 */
  description: z.string().max(500).optional(),
});
export type ExtensionDecl = z.infer<typeof extensionDeclSchema>;

/** 插件包清单。 */
export const pluginManifestSchema = z.object({
  /** 清单格式版本(与 02 SCHEMA_VERSION / 16 CONFIG_SCHEMA_VERSION 独立计数)。 */
  manifestVersion: z.literal(1),
  /** 包名:npm 风格或本地标识。[a-z0-9][a-z0-9._-]*。参与全局 id。 */
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(128),
  /** 语义化版本(semver)。参与全局 id 与兼容性判定(§10.4)。 */
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
  /** 兼容的 sylux 契约范围(对接 02 SCHEMA_VERSION + 本文 API 版本,§10.4)。 */
  engines: z.object({
    sylux: z.string().min(1),        // semver range,如 ">=1.0.0 <2.0.0"
    schemaVersion: z.number().int().positive().optional(), // 期望的 02 SCHEMA_VERSION
  }),
  author: z.string().max(200).optional(),
  /** 该包导出的全部扩展。 */
  extensions: z.array(extensionDeclSchema).min(1),
  /** 可选签名块(trusted 级强制;sandboxed 推荐;declarative 可选,§3.3)。 */
  signature: z.object({
    algo: z.literal('ed25519'),
    /** 对「manifest 规范化字节 + 各 entry 文件内容 hash」的签名(base64)。 */
    sig: z.string().min(1),
    /** 签名者公钥指纹(对应 trust-store 里用户已信任的 key,§3.4)。 */
    keyId: z.string().min(1),
  }).optional(),
}).superRefine((m, ctx) => {
  // X2:declarative/sandboxed 扩展不得请求任何能力
  for (const [i, ext] of m.extensions.entries()) {
    if (ext.trust !== 'trusted' && ext.capabilities.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['extensions', i, 'capabilities'],
        message: `${ext.trust} 扩展不得请求能力(纯函数零 I/O,X2);需能力请改 trust:'trusted'` });
    }
    // 能力只对 agent_adapter 有意义
    if (ext.kind !== 'agent_adapter' && ext.capabilities.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['extensions', i, 'capabilities'],
        message: `仅 agent_adapter 可请求能力` });
    }
    // trusted 扩展强制签名
    if (ext.trust === 'trusted' && !m.signature) {
      ctx.addIssue({ code: 'custom', path: ['extensions', i, 'trust'],
        message: `trusted 扩展要求 manifest 带 signature(§3.3)` });
    }
  }
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
```

### 2.2 全局 id 规则

```ts
/** 扩展全局 id:跨整个 sylux 唯一,写入 BoardState.playbookId / config 引用。 */
export function extensionGlobalId(m: PluginManifest, ext: ExtensionDecl): string {
  // 形如 plugin:acme-flows@1.2.0/triage(playbook)
  //     role:acme-flows@1.2.0/skeptic / stop:.../no-progress
  const prefix = { playbook: 'plugin', role: 'role', stop: 'stop',
    provider_template: 'ptmpl', agent_adapter: 'agent' }[ext.kind];
  return `${prefix}:${m.name}@${m.version}/${ext.name}`;
}
```

- `playbook` 类扩展的全局 id 即 `PluginPlaybookId`(§5.1),直接进 `BoardState.playbookId`(02 §10.2 是 `z.string()`,容纳)。
- 带 `@version`:同一包多版本可并存注册,config 可锁版本(§10.4 兼容性);不锁则取已注册的最高兼容版。

### 2.3 manifest 校验失败码

| 情况 | 错误码 | 处置 |
|---|---|---|
| 清单 JSON/YAML 解析失败 | `PLUGIN_MANIFEST_INVALID` | 跳过该包,记 `system` 告警(redact),不影响其他包 |
| zod 结构/superRefine 失败 | `PLUGIN_MANIFEST_INVALID` | 同上;detail 给字段 path,不回显文件全文 |
| declarative/sandboxed 请求能力 | `PLUGIN_MANIFEST_INVALID`(superRefine) | 拒载该扩展 |
| trusted 缺签名 | `PLUGIN_UNTRUSTED` | 拒载;面板提示「需签名 + 信任确认」 |
| engines.sylux 不兼容当前版本 | `PLUGIN_INCOMPAT` | 拒载;detail 给期望 range vs 实际版本 |

> 校验失败**永不 spawn、永不执行 entry 代码**(K2 同款 fail-fast):manifest 是「执行任何插件代码之前」的纯数据闸。

---

## 3. 信任模型 —— 三级信任 × 能力面(本文件安全命题核心)

### 3.0 威胁模型(承接 08 §1,补「插件即不可信代码」面)

第三方剧本/插件是**新增的不可信代码入口**。08 §1 的威胁面是「子进程 stdout 注入」「key 出境」;本文件新增:**插件代码本身**(用户从网上下个 `acme-flows` 剧本包)在中枢进程内运行 = 直接 RCE,比「子进程被注入」更危险(子进程还隔着 stdio + 沙箱,插件代码却跑在持有真实 key 的中枢进程里)。

| # | 威胁 | 场景 | 缓解 |
|---|---|---|---|
| PT1 | 插件代码 RCE | `nextTurn` 里 `require('fs').readFileSync('~/.codex/auth.json')` 偷 key | §3.1 declarative 无代码;§3.2 sandboxed 在 worker isolate 里**无 fs/net/require**;§4 能力剥离 |
| PT2 | 插件放松安全闸 | 插件「自定义 StopPolicy」永远返回不停想烧爆 token;或「自定义 role」想免除 evidence | X5 单调收紧:内核 child(MaxRounds/Budget)/evidence/防火墙在引擎执行;插件 child 只能 OR 新增停止票、无否决(§8.3),evidence 只能更严(§7.3) |
| PT3 | 插件夹带 I/O 的「provider 适配器」 | 第三方 agent adapter 代码 spawn `evil.exe` | X6:agent_adapter 必须 `trusted`+签名+用户逐能力确认(§3.4);默认禁用 |
| PT4 | 隐藏状态破坏回放 | 插件在闭包里攒状态,崩溃重建后漂移 | X3:`deriveState(board)` 纯函数;沙箱 worker 每轮**无状态重建**(§4.2) |
| PT5 | 资源耗尽 | `nextTurn` 死循环 / 分配巨数组撑爆内存 | X7:worker CPU/内存/超时闸(§4.4) |
| PT6 | 供应链 / 篡改 | 装的包被改、entry 与 manifest 签名不符 | §3.3 签名校验「manifest + entry 文件 hash」;trust-store 公钥锁定(§3.4) |
| PT7 | DSL 注入 | DSL 里的字符串字段(roleBrief)塞 prompt 注入,劫持对面 agent | DSL 产出的文案进对面 prompt 前**照样过 08 §4 防火墙**(§7.4);DSL 不豁免任何安全闸 |

### 3.1 declarative(纯数据,零能力)

- **是什么**:DSL/JSON 文件(剧本 DSL §6、RoleProfile §7、StopPolicy 表达式 §8、ProviderTemplate §9.2)。**无可执行代码**。
- **加载**:读文件 → zod 校验(对应扩展的 schema)→ 编译成纯函数(`dsl-compile.ts`,在中枢主线程即可,因为编译本身只是把数据转成「查表 + 受限表达式求值」,无 eval)。
- **能力面**:**零**。它不是代码,没有运行时;求值时只读 `BoardView`。
- **信任要求**:可在 `untrusted`(未签名)下加载——因为没有代码能跑,最坏情况是「逻辑设计得烂」(出空 RoundPlan → 引擎 `EMPTY_ROUND_PLAN` 硬停,03 §5.1)或「DSL 文案带注入」(被 §7.4 防火墙拦)。**这是推荐的第三方剧本形态**:表达力够覆盖四范式 + 常见变体(§6 论证),且零 RCE 面。

### 3.2 sandboxed(JS 纯函数,worker isolate)

- **是什么**:JS 模块,导出 `PluginPlaybook`(§5)/ `PluginStopPolicy`(§8)的纯函数实现。适合 DSL 表达不了的复杂逻辑(如主从范式那种状态机,虽然也能用 DSL 的 phases 表达,§6.2)。
- **加载**:不在主线程 `import`(那等于 RCE)。而是把源码发到**独立 worker 进程**(§4.3),worker 在**剥离能力的 isolate**里加载它。
- **能力面**:只读 `BoardView` 快照(结构化克隆传入 worker)。worker 内**无 `require`/`import` 业务模块、无 `fs`/`net`/`child_process`/`process.env`、无计时器副作用**(§4.2 白名单全局)。
- **信任要求**:推荐签名(§3.3),但因沙箱兜底,**未签名也可在用户开启 `allowUnsignedSandboxed` 时加载**(默认关)。即使恶意,能力面已剥到「只能读快照、出纯数据」,最坏是 PT5 资源耗尽(被 §4.4 闸住)。

### 3.3 trusted(任意代码,签名 + 显式确认)

- **是什么**:能力型扩展——目前只有 `agent_adapter`(§9.3):需要 spawn 新 CLI、构造 env、定位 exe。无法剥离能力(剥了就没法干活)。
- **加载**:① manifest 必带 `signature`(ed25519);② 加载器校验「`manifest 规范化字节 ⧺ 各 entry 文件 sha256` 的签名」对 `keyId` 公钥成立(防 PT6 篡改);③ `keyId` 必须在 trust-store(§3.4)里被用户显式信任过;④ manifest 请求的每个 `capability` 在面板/CLI 逐条向用户确认(「该插件请求:spawn、env。批准?」)。四者缺一不加载。
- **能力面**:经用户批准的 `capabilities` 子集。即便 trusted,**仍受全局闸约束**:env 必经 `buildChildEnv` 白名单(08 §2,插件给的 env 也过滤)、sandbox 经 `capSandbox` 封顶(08 §6)、argv 过 `assertArgvNoSecret`(08 §2.4)、出境过 `guardEgress`(08 §7)。trusted 给的是「能调这些受限 API」,**不是**「绕过它们」(X5/X6)。
- **默认**:`trusted` 加载**默认禁用**(`plugins.allowTrusted:false`,§10.1)。多数用户永远不需要新 agent adapter(codex/claude 够用);需要时显式开 + 逐插件信任。

### 3.4 trust-store 与签名校验

```ts
/** 信任记录:用户显式信任过的签名公钥 + 该 key 被授予的能力上限。 */
export interface TrustEntry {
  keyId: string;                  // ed25519 公钥指纹
  publicKey: string;              // 公钥(base64),校验签名用
  /** 用户确认信任的时间戳 + 备注(审计)。 */
  approvedAt: number;
  note?: string;
  /** 该 key 签名的插件被允许请求的能力上限(用户确认时勾选;空=只允许无能力扩展)。 */
  grantedCapabilities: Capability[];
}

/** 信任校验(loader 调用)。返回是否放行 + 原因。 */
export function verifyTrust(
  m: PluginManifest, entryHashes: Record<string, string>, store: TrustEntry[],
): { ok: true } | { ok: false; code: SyluxErrorCode; reason: string } {
  const needsTrusted = m.extensions.some((e) => e.trust === 'trusted');
  if (!needsTrusted) return { ok: true };               // declarative/sandboxed 不走签名闸

  if (!m.signature) return { ok: false, code: 'PLUGIN_UNTRUSTED', reason: '缺签名' };
  const entry = store.find((t) => t.keyId === m.signature!.keyId);
  if (!entry) return { ok: false, code: 'PLUGIN_UNTRUSTED', reason: 'keyId 未被信任' };

  // 校验签名覆盖 manifest 规范化字节 + 每个 entry 文件 hash(防 PT6:换了代码但签名没动)
  const payload = canonicalManifestBytes(m) + Object.entries(entryHashes).sort()
    .map(([p, h]) => `${p}:${h}`).join('\n');
  if (!ed25519Verify(payload, m.signature.sig, entry.publicKey))
    return { ok: false, code: 'PLUGIN_SIGNATURE_MISMATCH', reason: '签名不匹配(篡改?)' };

  // 能力请求不得超过该 key 被授予的上限
  for (const ext of m.extensions) {
    for (const cap of ext.capabilities) {
      if (!entry.grantedCapabilities.includes(cap))
        return { ok: false, code: 'PLUGIN_CAPABILITY_DENIED', reason: `能力 ${cap} 未授权` };
    }
  }
  return { ok: true };
}
```

> trust-store 落 `@sylux/server/src/plugins/trust-store.ts` 持久化(JSON,过 redact 落盘——虽然公钥非密,但备注可能含路径)。**信任是用户行为,不是配置项**:加 trusted 插件必须经一次交互式确认(面板/CLI),不能纯靠 config 文件静默授信(防 PT6 配置被改即提权)。

### 3.5 三级信任能力面对照

| 维度 | declarative | sandboxed | trusted |
|---|---|---|---|
| 形态 | DSL/JSON 数据 | JS 纯函数 | 任意代码(I/O) |
| 运行位置 | 中枢主线程(纯转换) | worker isolate(§4) | 中枢主线程(受信任) |
| 可见输入 | `BoardView` 快照 | `BoardView` 快照(克隆) | EngineDeps 受限 API(§9.3) |
| 文件系统 | ✗ | ✗ | 经批准 `fs_read` |
| 网络 | ✗ | ✗ | 经批准 `net`(慎) |
| spawn/env | ✗ | ✗ | 经批准 `spawn`/`env`(仍过白名单) |
| 密钥访问 | ✗ | ✗ | ✗(key 永远只在 buildChildEnv 窄通路,插件拿不到真值,S1) |
| 签名要求 | 可选 | 推荐(可配 allowUnsigned) | **强制** |
| 用户确认 | 否 | 否(除非 allowUnsigned 提示) | **逐能力确认** |
| 默认启用 | ✓ | ✓ | ✗(allowTrusted:false) |
| 适用扩展 | playbook/role/stop/provider_template | playbook/stop | agent_adapter |
| 最坏破坏 | 烂逻辑→硬停;文案注入→防火墙拦 | 资源耗尽→闸住;烂逻辑→硬停 | = 用户自己写的代码(已知情授信) |

> 关键:**即便 trusted,插件也碰不到真实 key**(S1 焊死:key 只在 `KeyStore.resolve→providerEnv→buildChildEnv` 窄通路,该通路在 server/agents 内,不暴露给插件 API)。trusted 插件能 spawn,但 env 由宿主的 `buildChildEnv` 注入,插件只声明「我要哪些非密 env 变量名」,真值仍是宿主填(§9.3)。

---

## 4. 沙箱机制 —— sandboxed JS 的能力剥离与资源闸

> 本节只覆盖 `sandboxed` 级(§3.2)。`declarative` 无运行时无需沙箱;`trusted` 是受信任代码不沙箱(靠签名+确认+全局闸)。

### 4.1 为什么是「独立 worker 进程」而非 `vm` 模块

Node 的 `vm`/`vm.runInNewContext` **不是安全边界**(官方明确:能通过原型链/`constructor` 逃逸拿到外层 `process`)。在持有真实 key 的中枢主线程里 `vm` 跑第三方代码 = 一次原型逃逸即偷 key。故 sandboxed 插件必须跑在**独立的、能力本就被剥离的进程**里:

- **进程隔离**:`worker_threads` 或独立 `child_process`(fork 一个 `worker-entry.ts`)。本设计选 **child_process fork 的独立 Node 进程**,理由:① 可独立设 `--max-old-space-size` 限内存(§4.4);② 崩溃/OOM 不带垮中枢主进程;③ env 用 `buildChildEnv` 同款白名单构造,worker 进程**本身就没有** key/敏感 env(连「能偷的东西」都不在它进程里,纵深);④ `worker_threads` 共享主进程内存堆,不如独立进程隔离干净。
- **能力剥离**:worker 进程的 env 不含任何 key(白名单只给 `SystemRoot` 等运行必需,**不给** `*_KEY`/`*_TOKEN`,复用 08 §2.2 `BASE_ENV_ALLOWLIST` 但更窄——见 §4.2);worker-entry 启动后**先冻结/删除**危险全局再加载插件(§4.2)。

> **诚实标注**:进程级隔离对「读快照→出数据」的纯函数足够;它不防「插件耗尽 CPU」(靠 §4.4 超时杀)与「插件读到 worker 进程内仅有的非密 env」(worker 进程里本就没敏感物,§4.2)。这不是通用不可信代码沙箱(那要 OS 级 seccomp/容器),但**匹配本场景**:插件合法职责零 I/O,我们要防的是「它越界拿 key/起 I/O」,进程隔离 + 空 env + 删全局 + 资源闸正好覆盖。更强隔离(容器/子用户)列为部署侧可选加固(§13 openQuestion)。

### 4.2 worker-entry 的能力剥离(白名单全局)

```ts
// packages/server/src/plugins/sandbox/worker-entry.ts(在独立 fork 进程里运行)
// 启动顺序铁律:① 先剥离能力 → ② 再 require 插件 entry。顺序反了 = 插件在剥离前已能 I/O。

// ① 删除/中和危险全局与模块加载能力
//    注意:这是「纵深」一层(进程本就空 env、无 key);不是唯一防线。
function stripCapabilities(): void {
  // 切断 require(CommonJS)与动态 import 的业务模块加载:插件只能用纯计算
  // 实现:用受限的自定义 module loader,只白名单放行无副作用的纯算子模块(见下),
  //       其余(fs/net/child_process/os/process 重接口)require 抛 PLUGIN_CAPABILITY_DENIED。
  const BLOCKED = new Set(['fs','net','http','https','child_process','os','cluster','dgram',
    'dns','tls','vm','worker_threads','inspector','v8','module','repl','readline']);
  patchRequire((id) => { if (BLOCKED.has(id) || id.startsWith('node:')) throw denied(id); });

  // process:只保留 process.hrtime(确定性计时给资源闸用)+ 收发消息通道;其余抹掉
  //   删 process.env(连非密 env 也不暴露给插件逻辑,X2:纯函数不需要 env)
  //   删 process.exit/binding/dlopen/kill 等
  freezeProcessToMessagingOnly();

  // 定时器:删 setTimeout/setInterval/setImmediate(纯函数无异步副作用需求,X7 确定性)
  //   求值是同步的:worker 收 BoardView → 同步算 → 回 postMessage
  removeTimers();

  // 网络/IO 全局:fetch、WebSocket、Buffer 的文件相关、Deno/Bun 全局(若存在)一并删
  removeNetworkGlobals();

  // 冻结原型链关键对象,降低逃逸面(纵深;真正隔离靠进程边界)
  Object.freeze(Object.prototype); Object.freeze(Function.prototype);
}

// ② 加载插件并暴露统一调用入口
let plugin: SandboxedExport;
function loadPlugin(entrySource: string): void {
  // 在剥离后的环境里 require 插件 entry(此时 fs/net 已不可达)
  plugin = restrictedRequire(entrySource); // 返回 { nextTurn?, evaluate? } 纯函数集
}

// ③ 消息循环:主进程发 {call:'nextTurn', board: <clone>} → 同步求值 → 回 {ok, result} | {err}
process.on('message', (req) => {
  try {
    const result = invokeWithDeadline(plugin, req); // §4.4 deadline 在主进程侧也兜
    sendResult(req.id, { ok: true, result });
  } catch (e) {
    sendResult(req.id, { ok: false, code: classifyPluginError(e), detail: redactObject(String(e)) });
  }
});
```

允许的「纯算子」白名单(worker 内插件可用):`Math`、`JSON`、`Array`/`Object`/`String`/`Number`/`Map`/`Set`/`RegExp`(无 I/O 的标准内置)。**禁**:`fs`/`net`/`child_process`/`process.env`/`fetch`/定时器/`require` 业务模块。

### 4.3 SandboxHost —— 主进程侧的 worker 池与调用

```ts
/** 沙箱宿主:管理 worker 进程池,把插件调用 marshal 进 worker,带超时/资源闸。 */
export interface SandboxHost {
  /** 加载一个 sandboxed 扩展到 worker(fork 进程,剥离能力,require entry)。 */
  load(globalId: string, entrySource: string, limits: SandboxLimits): Promise<SandboxHandle>;
  /** 卸载(kill worker,回收)。 */
  unload(globalId: string): Promise<void>;
}

export interface SandboxHandle {
  /** 调用插件的某个纯函数(nextTurn/evaluate),传入【结构化克隆的只读 BoardView 快照】。
   *  返回值再被夹取(§5.5)。超时/崩溃 → reject 带错误码。 */
  call<T>(method: 'nextTurn' | 'evaluate', boardSnapshot: BoardViewSnapshot, extra?: unknown): Promise<T>;
}

export interface SandboxLimits {
  /** 单次调用墙上时钟超时(ms)。超时 → kill 该次调用,抛 PLUGIN_TIMEOUT。默认 2000。 */
  timeoutMs: number;
  /** worker 进程内存上限(MB,经 --max-old-space-size)。超 → worker OOM 退出,抛 PLUGIN_RESOURCE_EXCEEDED。默认 256。 */
  maxMemoryMb: number;
  /** 单次返回值序列化体积上限(字节),防插件回吐巨型对象撑爆主进程。默认 1MB。 */
  maxResultBytes: number;
}
```

> `BoardViewSnapshot` 是 `BoardView`(03 §4.1)的**可结构化克隆纯数据投影**:`messages`/`rounds`/派生查询结果预计算后随快照传入(worker 里 `BoardView` 的方法是对快照的纯查询,不回调主进程——避免「插件通过回调反向调主进程 API」的逃逸面)。即:**worker 拿到的是死快照,不是活对象**。

### 4.4 资源闸与超时(X7 有界)

| 闸 | 机制 | 触发 | 处置 |
|---|---|---|---|
| 墙上超时 | 主进程侧 `Promise.race([call, deadline])` + 到点 `worker.kill()` | `nextTurn` 死循环/慢 | `PLUGIN_TIMEOUT`;按插件故障降级(§11.2) |
| 内存 | fork 时 `execArgv:['--max-old-space-size=<MB>']` | 插件分配巨数组 | worker OOM 自退,主进程感知退出码 → `PLUGIN_RESOURCE_EXCEEDED` |
| 返回体积 | postMessage 前 worker 自测 + 主进程收时再测 | 回吐巨对象 | 截断/拒绝 → `PLUGIN_RESULT_TOO_LARGE`(归入 RESOURCE_EXCEEDED 语义) |
| 调用频次 | 引擎每轮对每插件**至多调一次** `nextTurn`(循环结构保证,03 §5.1) | — | 结构性有界,无需额外计数 |
| worker 复用 | 同 `globalId` 复用同一 worker(避免每轮 fork 开销);崩溃后重建一次,再崩→禁用该插件 | worker 反复崩 | 第二次崩 → `PLUGIN_DISABLED`,run 按「插件不可用」降级(§11.3) |

> **确定性兜底(X7)**:worker 内无定时器、无 `Date.now` 依赖建议(求值不应读时钟做分支;若插件读 `Date` 我们不禁,但 X3 要求其输出仅由 `BoardView` 决定——读时钟做分支属插件 bug,回放不一致时由 §11 的「输出夹取 + 回放校验」暴露)。**纯 declarative DSL 天然确定**(无时钟访问,§6.4 表达式语言不提供 `now`)。

### 4.5 沙箱失败的引擎降级(对接 03 E7)

worker 任何失败(超时/OOM/抛错/返回非法)**绝不挂起引擎**:

- 主进程侧 `call` reject 带错误码 → 引擎把该插件这一轮视同「产出失败」。
- **playbook 失败**:`nextTurn` 失败 → 引擎无计划可执行 → 落 `system` 消息(`from:orchestrator`,02 C7)记 `PLUGIN_EVAL_FAILED` → `setStatus('aborted')`(对应 03 §5.1 `EMPTY_ROUND_PLAN` 同级硬停,不空转)。
- **StopPolicy 失败**:`evaluate` 失败 → `PluginStopAdapter.shouldStop` 返 `KEEP_RUNNING`(**弃权**,§8.3)→ 视同「该插件不投停止票」,但**不影响内核 child**(MaxRounds/Budget/Convergence 照常,X5)——即插件停止策略挂了,run 靠内核 child 兜底,不会失控(§8.3)。
- **RoleProfile 失败**:角色文案/evidence 策略求值失败 → 回退到其 `mapsTo` canonical 角色的**内核默认 brief + 默认 evidence 强制**(§7.5),不豁免任何校验。

> 三种降级共性:**插件挂 = 退回到「没有这个插件」的安全基线**,而非「放行/失控」。这是 X5 单调性在故障路径的体现。

---

## 5. PluginPlaybook —— 自定义剧本契约与输出夹取

### 5.1 PlaybookRef 与解析

```ts
/** 插件剧本 id:extensionGlobalId 对 kind:'playbook' 的产物。 */
export type PluginPlaybookId = `plugin:${string}`;   // plugin:acme-flows@1.2.0/triage

/** 引擎解析用的剧本引用:内置四范式 | 插件剧本。 */
export type PlaybookRef = PlaybookId | PluginPlaybookId;  // PlaybookId 来自 03

/** 解析:config.playbook.id → 具体 Playbook 实例(03 §3.3)。 */
export function resolvePlaybook(ref: PlaybookRef, registry: PluginRegistry): Playbook {
  if (!ref.startsWith('plugin:')) return builtinPlaybook(ref as PlaybookId); // 03 四范式
  const compiled = registry.getPlaybook(ref as PluginPlaybookId);            // §10.3
  if (!compiled) throw new SyluxError('PLUGIN_NOT_FOUND', `未注册剧本 ${ref}`);
  return compiled.toPlaybook();   // 把 PluginPlaybook 适配成 03 的 Playbook(§5.3)
}
```

> 引擎/`runEngine`(03 §5)**完全不感知**这是不是插件:它拿到的永远是一个满足 03 `Playbook` 接口的对象。插件剧本经 §5.3 适配后,与四范式在引擎眼里同形。`BoardState.playbookId` 落 `ref` 字符串(02 §10.2 容纳)。

### 5.2 PluginPlaybook 接口(插件作者实现的形态)

插件作者(JS 形态)实现的是比 03 `Playbook` **更受限**的纯函数接口;DSL 形态则 `dsl-compile` 自动生成它。差异:**无 `onStart`/`onFinish` 异步钩子**(那些可能 I/O),**无实例可变状态**(X3),状态靠 `deriveState` 每轮从 board 纯算。

```ts
/** 插件剧本契约(纯函数集)。sandboxed JS 作者实现此;DSL 编译产出此。 */
export interface PluginPlaybook<S = unknown> {
  readonly id: PluginPlaybookId;
  readonly name: string;
  /** 默认角色→agent 指派(P3 同语义;引擎仍只认 TurnDirective.agent,§5.5 夹取)。 */
  readonly assignment: Partial<Record<Role, AgentId>>;
  /** 范式参数声明(刹车阈值等;同 03 PlaybookParams,但作为「请求值」,经 config 合并 + §5.5 夹取)。 */
  readonly params: PlaybookParams;
  /** 引用的自定义角色(RoleProfile 全局 id 列表,§7);引擎渲染期据此查 brief。 */
  readonly roleProfiles?: string[];

  /**
   * ★ 状态纯函数(X3 焊死):从只读 board 复算范式私有状态。
   * 必须是【确定性纯函数】:同 board → 同 state。崩溃回放重建时由它保证状态一致。
   * 例:主从范式从 board 里的 plan/implement/review 消息序列复算出 {phase,tasks,cursor}。
   */
  deriveState(board: BoardViewSnapshot): S;

  /** ★ 核心:基于 board + 复算出的 state,产出本轮计划(纯数据)。 */
  nextTurn(board: BoardViewSnapshot, state: S): RoundPlanRequest;

  /** 该轮末是否合并 worktree(纯判定)。 */
  shouldMergeAt(round: number, board: BoardViewSnapshot, state: S): boolean;

  /** 范式完成判定(纯判定;与内核 stall 解耦,E4)。 */
  isDone(board: BoardViewSnapshot, state: S): boolean;
}

/** 插件产出的「请求版」RoundPlan:字段同 03 RoundPlan,但被视为不可信,经 §5.5 夹取后才成 RoundPlan。 */
export type RoundPlanRequest = {
  turns: TurnDirectiveRequest[];
  execution: 'serial' | 'parallel';
  phaseHint?: string;
};
export type TurnDirectiveRequest = {
  agent: AgentId; role: Role; kindHint: MessageKind;
  /** PromptContext 的「请求版」:continuity/contextCap 等会被夹取(§5.5)。 */
  promptContext: PromptContextRequest;
};
export type PromptContextRequest = Omit<PromptContext, 'delta'> & {
  /**
   * 插件【不直接提供 delta 的 Message 内容】(那会让插件读到/伪造对面原文,绕防火墙)。
   * 而是声明「我要哪些消息作为 delta」的【选择器】:消息 id 列表 或 选择规则。
   * 引擎据此从 board 取真实 Message,过 08 §4 防火墙后拼入(§5.4)。插件碰不到原始 body。
   */
  deltaSelector: { messageIds: string[] } | { kind: 'last-from-peer' } | { kind: 'last-system' } | { kind: 'none' };
};
```

> **关键安全设计(deltaSelector)**:03 的 `PromptContext.delta` 是 `readonly Message[]`。若让插件直接填,插件就能① 读到对面 agent 的原始 body(信息泄露),② 伪造/篡改喂给对面的内容(绕过防火墙注入)。故插件**只声明「要哪些消息」(选择器)**,真实 `Message` 由引擎从 board 取、过防火墙(08 §4)、再拼。插件**永远碰不到 peer 原文**,也无法绕过 firewall(X5)。`digest` 同理:插件不自造 digest,引擎调 07 `DigestBuilder` 生成(03 §4.3),插件只能选「带/不带 digest」。

### 5.3 适配到 03 Playbook(toPlaybook)

宿主把 `PluginPlaybook` 包成 03 `Playbook`,补齐内核要的异步钩子与活对象语义,并在每个出口插入夹取:

```ts
/** 把不可信的 PluginPlaybook 适配成引擎认的 03 Playbook;所有出口经夹取/防火墙。 */
export function adaptPluginPlaybook(
  pp: PluginPlaybook, sandbox: SandboxHandle | null, ctx: AdaptContext,
): Playbook {
  return {
    id: pp.id as unknown as PlaybookId,        // wire 上是 string;TS 经 PlaybookRef 容纳(§1.3)
    name: pp.name,
    assignment: pp.assignment,
    params: clampParams(pp.params, ctx.configParams),   // §5.5:params 经 config 合并 + 夹取
    async onStart() { /* 插件无 onStart;引擎注入 goal 由 ctx 持有,§5.4 */ },
    nextTurn(board: BoardView): RoundPlan {
      const snap = snapshot(board);                       // 死快照(§4.3)
      const state = callPlugin(pp, sandbox, 'deriveState', snap);   // 纯算(沙箱内或 DSL 主线程)
      const reqRaw = callPlugin(pp, sandbox, 'nextTurn', snap, state);
      return clampRoundPlan(reqRaw, ctx);                 // ★ X4 不可信输出夹取(§5.5)
    },
    shouldMergeAt(round, board) { return !!callPlugin(pp, sandbox, 'shouldMergeAt', snapshot(board), round); },
    isDone(board) { return !!callPlugin(pp, sandbox, 'isDone', snapshot(board)); },
    async onFinish() { /* 无副作用钩子 */ },
  };
}
```

> `callPlugin`:DSL 形态在主线程直接跑编译出的纯函数;sandboxed 形态经 `sandbox.call`(§4.3)进 worker。两条路径返回值都过 `clampRoundPlan`。

### 5.4 引擎侧补足(插件碰不到的部分,引擎做)

插件输出 `RoundPlanRequest` 后,引擎(在 03 §5.2 `runTurn` 之前/之中)补足并施加安全闸:

1. **delta 物化**:按 `deltaSelector` 从 board 取真实 `Message[]`,**每条过 08 §4 `firewallPeerMessage`**(block→打回该轮;flag→包裹+审计),产出安全 `delta`(03 §2.2)。
2. **digest 生成**:若 `promptContext` 标 `digest:'<placeholder>'` 或选择带 digest,引擎调 07 `DigestBuilder`(03 §4.3)生成,插件不经手。
3. **goal 注入**:run 目标由引擎在 `onStart`(03)从 config/run 注入,插件 `nextTurn` 产出的 `goal` 字段被**忽略或夹取为引擎权威 goal**(防插件篡改任务目标)。
4. **roleBrief 来源**:若 turn 的 role 关联了 RoleProfile(§7),引擎用 RoleProfile 的 brief(过防火墙);否则用插件给的 brief(同样过防火墙,§7.4)。
5. **prompt 渲染**:经 03 §2.3 固定顺序拼装,`[INPUT]` 段是已防火墙包裹的 delta。

> 即:`RoundPlanRequest` 决定的是「**谁发言、扮谁、看哪几条(选择器)、什么续接策略、期望什么 kind**」;**看到的具体内容、digest、goal、防火墙包裹**全由引擎用权威源补足。插件控制「结构与意图」,引擎控制「内容与安全」。

### 5.5 clampRoundPlan —— 不可信输出夹取(X4 焊死,本文权威)

```ts
export interface ClampContext {
  /** 本 run 允许的物理 agent(来自 config.agents;插件给未知 agent 即拒)。 */
  allowedAgents: ReadonlySet<AgentId>;
  /** 合法 canonical 角色集(02 §2 的 6 个;插件给的 role 必须 ∈ 此)。 */
  allowedRoles: ReadonlySet<Role>;
  /** config 派生的硬上限(16):perTurnContextCap 上限、turns 上限、sandbox 封顶级别。 */
  caps: { contextCapMax: number; maxTurns: number; sandboxCeiling: 'read-only' | 'workspace-write' };
  humanApprovedDanger: boolean;
}

/** 把插件返回的 RoundPlanRequest 夹成引擎可执行的 RoundPlan;任何越界→拒绝或夹取。 */
export function clampRoundPlan(req: RoundPlanRequest, ctx: ClampContext): RoundPlan {
  // 1. 结构 zod(防 sandbox 回吐畸形对象)
  const parsed = roundPlanRequestSchema.safeParse(req);
  if (!parsed.success) throw new SyluxError('PLUGIN_OUTPUT_INVALID', parsed.error.message);
  const r = parsed.data;

  // 2. turns 数量上限(防插件请求海量并发 turn 炸资源,T6)
  if (r.turns.length === 0) throw new SyluxError('PLUGIN_OUTPUT_INVALID', 'turns 为空');
  if (r.turns.length > ctx.caps.maxTurns)
    throw new SyluxError('PLUGIN_OUTPUT_INVALID', `turns 超上限 ${ctx.caps.maxTurns}`);

  // 3. execution 与 turns 数量一致性(03 §3.2:parallel 才允许 >1)
  const execution = r.turns.length > 1 ? 'parallel' : r.execution;

  const turns: TurnDirective[] = r.turns.map((t) => {
    // 4. agent 白名单:未知物理 agent 直接拒(防插件指派不存在/越权 agent)
    if (!ctx.allowedAgents.has(t.agent))
      throw new SyluxError('PLUGIN_OUTPUT_INVALID', `未知 agent ${t.agent}`);
    // 5. role 必须是 canonical 6 之一(RoleProfile 在到这之前已投影成 canonical,§7.2)
    if (!ctx.allowedRoles.has(t.role))
      throw new SyluxError('PLUGIN_OUTPUT_INVALID', `非法 role ${t.role}`);
    // 6. continuity 合法性 + contextCap 夹取
    const contextCap = Math.min(Math.max(0, t.promptContext.contextCap ?? 0), ctx.caps.contextCapMax);
    const continuity: ContinuityMode = t.promptContext.continuity === 'resume' ? 'resume' : 'stateless';
    return {
      agent: t.agent, role: t.role, kindHint: t.kindHint,
      promptContext: { ...t.promptContext, contextCap, continuity, delta: [] /* 引擎 §5.4 物化 */ } as PromptContext,
    };
  });

  return { turns, execution, phaseHint: r.phaseHint };
}

/** params 夹取:沙箱封顶不可越(K5/08 S6),刹车上限取 config 与插件请求的更严者。 */
export function clampParams(req: PlaybookParams, configParams: PlaybookParams): PlaybookParams {
  return {
    // 插件请求的轮数/预算不得【超过】config 上限(取 min);插件想更严(更小)允许
    maxRounds: Math.min(req.maxRounds, configParams.maxRounds),
    tokenBudget: Math.min(req.tokenBudget, configParams.tokenBudget),
    perTurnContextCap: Math.min(req.perTurnContextCap, configParams.perTurnContextCap),
    convergenceWindow: req.convergenceWindow,         // 收敛窗口插件可调(不影响硬上限)
    retryOnReject: Math.min(req.retryOnReject, configParams.retryOnReject),
    // ★ 沙箱封顶:经 08 capSandbox,插件无法请求 danger(X5/X6)
    sandboxCeiling: capSandbox(req.sandboxCeiling, { humanApprovedDanger: false }),
    defaultContinuity: req.defaultContinuity === 'resume' ? 'resume' : 'stateless',
  };
}
```

> 夹取定律(X4):**插件请求的一切「放大权限/放大预算」诉求被夹到 config 上限;「收紧」诉求允许**。`maxRounds`/`tokenBudget`/`contextCap` 取 `min`,`sandboxCeiling` 经 `capSandbox`,`agent`/`role` 过白名单。结果:**最坏的恶意插件也只能在 config 划定的资源/权限盒子内折腾**,且其产出仍要过 02 §8 校验 + 08 §4 防火墙。

---

## 6. 声明式剧本 DSL —— 零代码剧本(declarative 首选)

### 6.1 设计立场:DSL 必须能表达四范式 + 常见变体

DSL 是**推荐的第三方剧本形态**(零 RCE 面,§3.1)。要让用户不写 JS 就能造剧本,DSL 必须覆盖 03 §6 四范式的全部控制结构:① 轮转选谁(奇偶/状态机/交替/并发);② 角色指派;③ 续接策略;④ 选什么 delta;⑤ 何时合并;⑥ 何时 done。DSL 的核心抽象是 **`turnRules`(规则表)+ `phases`(可选状态机)+ 受限表达式(条件/选择)**。下面先给 schema,§6.6 论证它确实能表达四范式。

### 6.2 DSL schema(playbook DSL,zod 权威)

```ts
import { z } from 'zod';

/** 续接策略字面量(引用 03 ContinuityMode 的字面量,不另定义语义)。 */
const continuityLit = z.enum(['stateless', 'resume']);

/** delta 选择器(= §5.2 deltaSelector 的 DSL 表面)。 */
const deltaSelectorSchema = z.union([
  z.object({ select: z.literal('none') }),
  z.object({ select: z.literal('last-from-peer') }),   // 对面上一条
  z.object({ select: z.literal('last-system') }),       // 最近 system(合并冲突回灌等)
  z.object({ select: z.literal('last-from'), agent: z.string() }), // 指定 agent 上一条
]);

/** 一条轮转规则:when 条件成立时,产出 then 描述的 turn(s)。规则按序匹配,首个 match 生效。 */
const turnRuleSchema = z.object({
  /** 规则名(调试/审计)。 */
  id: z.string().min(1),
  /** 匹配条件:受限表达式(§6.3),求值为 bool。省略=恒真(兜底规则)。 */
  when: z.string().optional(),
  /** 产出的发言指令(1 条=串行;多条=并行,经夹取 §5.5)。 */
  then: z.array(z.object({
    /** agent 选择:固定 agent 名 | 受限表达式(求值为 AgentId,如交替)。 */
    agent: z.string().min(1),                 // 字面 agent 名 或 ${expr}
    /** 扮演角色:canonical Role 名 | RoleProfile 全局 id(§7,编译期解析为 canonical + brief)。 */
    role: z.string().min(1),
    kindHint: z.string().min(1),              // MessageKind 名(编译期校验 ∈ 02 §2)
    continuity: continuityLit.default('stateless'),
    delta: deltaSelectorSchema.default({ select: 'last-from-peer' }),
    withDigest: z.boolean().default(true),     // 是否带 07 digest(插件不自造,§5.4)
    /** 角色指令文案(若 role 是 RoleProfile 则用其 brief;此处为内联覆盖)。过防火墙(§7.4)。 */
    roleBrief: z.string().max(4000).optional(),
  })).min(1),
});

/** 可选状态机:phase 命名 + 进入条件;turnRule 可限定只在某 phase 生效(表达 master-worker)。 */
const phaseSchema = z.object({
  name: z.string().min(1),
  /** 进入本 phase 的条件(受限表达式);多 phase 按序首个 match 为当前 phase。 */
  enterWhen: z.string().optional(),
});

export const playbookDslSchema = z.object({
  dslVersion: z.literal(1),
  /** 基范式:声明它是四范式的哪种「形状」,引擎据此取合并/done 的安全默认(可被下方覆盖)。 */
  base: z.enum(['red-blue', 'master-worker', 'pair', 'parallel', 'custom']),
  /** 默认指派(P3)。 */
  assignment: z.record(z.string(), z.string()).default({}),
  /** 参与的物理 agent(parallel/pair 轮换用)。 */
  agents: z.array(z.string()).min(1),
  /** 参数请求(经 §5.5 clampParams 夹取)。 */
  params: z.object({
    maxRounds: z.number().int().positive(),
    convergenceWindow: z.number().int().positive(),
    tokenBudget: z.number().int().positive(),
    perTurnContextCap: z.number().int().positive(),
    defaultContinuity: continuityLit.default('stateless'),
    retryOnReject: z.number().int().nonnegative().default(3),
    // 注意:无 sandboxCeiling 字段——DSL 剧本永远不能请求沙箱级别(恒 workspace-write 封顶,§5.5)
  }),
  /** 可选状态机相位(master-worker 类)。 */
  phases: z.array(phaseSchema).default([]),
  /** 轮转规则表(核心)。按序匹配,首个 when 成立的规则的 then 即本轮计划。 */
  turnRules: z.array(turnRuleSchema).min(1),
  /** 合并时机:受限表达式(求值 bool)。省略→按 base 安全默认(serial 每轮 true / parallel 收口轮)。 */
  shouldMergeWhen: z.string().optional(),
  /** done 判定:受限表达式(求值 bool)。建议引用内置谓词 doneAckedWithEvidence()(§6.3)。 */
  isDoneWhen: z.string().min(1),
});
export type PlaybookDsl = z.infer<typeof playbookDslSchema>;
```

### 6.3 受限表达式语言(expr)—— 无 eval 的安全求值

DSL 的 `when`/`agent`/`shouldMergeWhen`/`isDoneWhen` 是**受限表达式**,不是 JS。它编译成 AST(zod 校验)后由 `expr-eval.ts` **解释执行**(无 `eval`/`new Function`),只暴露白名单变量与算子,**无任何 I/O、无时钟、无循环**(保确定性 X7 + 零 RCE)。

```ts
/** 受限表达式 AST(编译自字符串语法,或直接写 AST)。判别联合,无函数字面量。 */
export const exprSchema: z.ZodType<Expr> = z.lazy(() => z.discriminatedUnion('t', [
  z.object({ t: z.literal('lit'), v: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ t: z.literal('var'), name: z.enum([                     // 白名单变量(只读 board 派生)
    'round',          // 当前轮号(number)
    'phase',          // 当前 phase 名(string;无 phases 时为 '')
    'lastFrom',       // 上一条消息的 from(AgentId | '')
    'lastKind',       // 上一条消息的 kind(MessageKind | '')
    'lastRole',       // 上一条消息的 role
    'messageCount',   // 消息总数
  ]) }),
  z.object({ t: z.literal('bin'), op: z.enum(['==','!=','<','<=','>','>=','&&','||','+','-','*','%']),
    l: exprSchema, r: exprSchema }),
  z.object({ t: z.literal('not'), e: exprSchema }),
  z.object({ t: z.literal('cond'), c: exprSchema, a: exprSchema, b: exprSchema }), // 三元
  z.object({ t: z.literal('call'), fn: z.enum([                      // 白名单谓词(纯函数,读快照)
    'isEven',                 // isEven(round)
    'countKind',              // countKind('done') → number
    'lastKindIs',             // lastKindIs('critique') → bool
    'hasDoneAckedWithEvidence', // 一方 done + 对面带证据 ack(02 C2);done 判定常用
    'allAgentsDone',          // 每个 agent 都发过 done(parallel 用)
    'stalledFor',             // stalledFor(window) → bool(02 §9.3,引擎注入)
    'alternateAgent',         // alternateAgent() → 上一条对面 agent(pair 交替选 agent)
    'tasksAllDone',           // master-worker:解析 plan 消息得子任务全完成
  ]), args: z.array(exprSchema).default([]) }),
]));
export type Expr =
  | { t: 'lit'; v: string | number | boolean }
  | { t: 'var'; name: string }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'not'; e: Expr }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr }
  | { t: 'call'; fn: string; args: Expr[] };
```

> 语法表面:作者写人类可读串(`"round % 2 == 1"`、`"hasDoneAckedWithEvidence()"`、`"alternateAgent()"`),编译期用一个**小型 Pratt parser**(本包内,无第三方 eval)转成上述 AST,zod 校验变量/函数名 ∈ 白名单,**未知名即编译错** `PLUGIN_DSL_COMPILE_ERROR`。运行期 `expr-eval` 对 AST 做递归求值,变量从 `BoardViewSnapshot` 派生的**只读 scope** 取,谓词是引擎注入的纯函数(`stalledFor` 复用 03 §4.1 `BoardView.stalledFor`)。

### 6.4 expr-eval 求值器(纯、有界、确定)

```ts
/** 求值上下文:白名单变量值 + 白名单谓词实现(均派生自只读快照,无 I/O)。 */
export interface ExprScope {
  vars: Record<string, string | number | boolean>;   // round/phase/lastFrom/...
  fns: Record<string, (args: (string|number|boolean)[]) => string | number | boolean>; // 谓词
}

/** 递归求值。无循环递归深度上限(防恶意深嵌 AST 撑栈)→ 超深抛 PLUGIN_DSL_EVAL_ERROR。 */
export function evalExpr(e: Expr, scope: ExprScope, depth = 0): string | number | boolean {
  if (depth > 64) throw new SyluxError('PLUGIN_DSL_EVAL_ERROR', 'expr 嵌套过深');
  switch (e.t) {
    case 'lit': return e.v;
    case 'var': {
      if (!(e.name in scope.vars)) throw new SyluxError('PLUGIN_DSL_EVAL_ERROR', `未知变量 ${e.name}`);
      return scope.vars[e.name];
    }
    case 'not': return !evalExpr(e.e, scope, depth + 1);
    case 'cond': return evalExpr(e.c, scope, depth + 1)
      ? evalExpr(e.a, scope, depth + 1) : evalExpr(e.b, scope, depth + 1);
    case 'bin': return applyBin(e.op, evalExpr(e.l, scope, depth + 1), evalExpr(e.r, scope, depth + 1));
    case 'call': {
      const fn = scope.fns[e.fn];
      if (!fn) throw new SyluxError('PLUGIN_DSL_EVAL_ERROR', `未知谓词 ${e.fn}`);
      return fn(e.args.map((a) => evalExpr(a, scope, depth + 1)));
    }
  }
}
```

> 特性:**无 I/O、无 `eval`、无时钟、无用户自定义循环**(只有有界递归 + 引擎提供的谓词)。因此 declarative DSL **天然满足 X2(零能力)、X7(确定+有界)**,可在中枢主线程直接跑——无需 worker 沙箱(沙箱是给 sandboxed JS 的)。求值复杂度 O(AST 节点数),AST 大小受 manifest 体积上限约束。

### 6.5 DSL → PluginPlaybook 编译(dsl-compile)

```ts
/** 把 PlaybookDsl 编译成 §5.2 的 PluginPlaybook(纯函数)。编译期:解析表达式、解析 RoleProfile 引用、
 *  校验 agent/role/kind 名合法。无 I/O。 */
export function compilePlaybookDsl(dsl: PlaybookDsl, ctx: CompileContext): PluginPlaybook {
  // 1. 预编译所有表达式串 → AST(Pratt parser),失败 → PLUGIN_DSL_COMPILE_ERROR
  const rules = dsl.turnRules.map((r) => ({ ...r, whenAst: r.when ? parseExpr(r.when) : null,
    then: r.then.map((th) => ({ ...th, agentAst: parseExpr(th.agent) })) }));
  const isDoneAst = parseExpr(dsl.isDoneWhen);
  const mergeAst = dsl.shouldMergeWhen ? parseExpr(dsl.shouldMergeWhen) : null;
  // 2. 校验所有 role 名:canonical Role 或已注册 RoleProfile(§7);kindHint ∈ MessageKind
  // 3. 返回纯函数集
  return {
    id: ctx.globalId, name: ctx.name, assignment: dsl.assignment as any, params: dsl.params as any,
    roleProfiles: ctx.referencedRoleProfiles,
    deriveState(board) { return computePhase(dsl.phases, board); }, // state = 当前 phase(+解析的子任务)
    nextTurn(board, state) {
      const scope = buildScope(board, state);                       // §6.4 scope(白名单变量+谓词)
      const rule = rules.find((r) => !r.whenAst || evalExpr(r.whenAst, scope) === true);
      if (!rule) throw new SyluxError('PLUGIN_DSL_EVAL_ERROR', '无匹配 turnRule');
      const turns = rule.then.map((th) => ({
        agent: String(evalExpr(th.agentAst, scope)) as AgentId,
        role: resolveRoleToCanonical(th.role, ctx),                 // RoleProfile → canonical(§7.2)
        kindHint: th.kindHint as MessageKind,
        promptContext: {
          continuity: th.continuity, goal: '', digest: th.withDigest ? '<digest>' : '',
          roleBrief: resolveBrief(th, ctx), expectedKind: th.kindHint as MessageKind,
          contextCap: dsl.params.perTurnContextCap,
          deltaSelector: toSelector(th.delta),
        } as PromptContextRequest,
      }));
      return { turns, execution: turns.length > 1 ? 'parallel' : 'serial' };
    },
    shouldMergeAt(round, board, state) {
      return mergeAst ? evalExpr(mergeAst, buildScope(board, state)) === true : mergeDefault(dsl.base, board);
    },
    isDone(board, state) { return evalExpr(isDoneAst, buildScope(board, state)) === true; },
  };
}
```

### 6.6 四范式可被 DSL 表达的论证(覆盖性自检)

| 范式 | DSL 表达 |
|---|---|
| **red-blue** | `base:'red-blue'`;两条 turnRule:`when:"isEven(round)"`→proposer/propose,`when:"!isEven(round)"`→critic/critique;`isDoneWhen:"hasDoneAckedWithEvidence()"`;merge 省略(base 默认每轮)。critic 的 evidence 强制由 02 C1 在引擎侧执行,DSL 不经手(X5)。 |
| **master-worker** | `base:'master-worker'`;`phases:[plan,implement,review]` 各带 `enterWhen`;turnRule 用 `when:"phase=='plan'"` 等限定;`deriveState` 的 `computePhase` 从 board 消息序列复算相位(X3);`isDoneWhen:"tasksAllDone() && hasDoneAckedWithEvidence()"`;`shouldMergeWhen:"phase=='implement'"`。状态机用「phase 变量 + enterWhen 表达式」表达,无需 JS。 |
| **pair** | `base:'pair'`;单条兜底 turnRule:`agent:"alternateAgent()"`(交替选对面),role:peer;`isDoneWhen` 用双向 ack 谓词;`convergenceWindow` 调小(易附和)。 |
| **parallel** | `base:'parallel'`;turnRule 的 `then` 含**两条**(两 worker),`execution` 编译期按 then 长度判 parallel;各 turn 的 `delta:{select:'last-from',agent:自己}`(只看自己线,隔离);`isDoneWhen:"allAgentsDone()"`。并发执行/轮末合并/冲突硬停全在引擎(03 §5.1 / E5),DSL 只声明 then 两条。 |

> 结论:四范式均可纯 DSL 表达,无需 JS。DSL 表达不了的**真正复杂逻辑**(如「依据上轮 evidence 内容动态拆分子任务数」这类需读 evidence 文本做复杂决策)才需 sandboxed JS。即 **declarative 覆盖绝大多数剧本,sandboxed 是少数逃生舱**——把 RCE 面压到最小(§3 信任分层的实证依据)。

---

## 7. RoleProfile —— 自定义角色(映射 + 文案 + evidence 策略)

### 7.1 设计:自定义角色 = canonical 角色 + 人设包(不新增 wire 角色)

02 §2 的 `roleSchema` 是闭合 6 角色,且 02 C1 把「evidence 强制」硬挂在 `role==='critic'` / `kind==='critique'` 上。若让插件新增 wire 角色,02 的校验/防火墙/收敛全要改(破 R1)。本文件的方案:**自定义角色是一个「人设包」`RoleProfile`,声明它映射到哪个 canonical 角色 + 自定义 brief + (只能更严的)evidence 策略**。`Message.role` 写盘永远是 canonical 6 之一。

### 7.2 RoleProfile schema

```ts
export const roleProfileSchema = z.object({
  profileVersion: z.literal(1),
  /** 自定义角色名(局部;全局 id 见 §2.2,如 role:acme-flows@1/skeptic)。 */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** ★ 必须映射到一个 canonical Role(02 §2)。写黑板时 Message.role = 此值。 */
  mapsTo: z.enum(['planner', 'worker', 'proposer', 'critic', 'peer', 'arbiter']),
  /** 角色指令文案(注入 prompt 的 [ROLE] 段;过 08 §4 防火墙,§7.4)。 */
  roleBrief: z.string().min(1).max(4000),
  /**
   * evidence 策略:只能【收紧】,不能放松(X5/§7.3)。
   * - 'inherit':沿用 mapsTo 的内核默认(如 mapsTo:critic 则照 02 C1 强制)。
   * - 'require':强制非空且 ≥1 条**强**核验通过(即便 mapsTo 不是 critic 也强制——更严;
   *   "强"的定义对齐 02 §3.2 v2 收紧:weak 级——无 quote 的 file_ref / 未实跑 command / spec_quote——不解锁)。
   * 不存在 'waive'/'none' 选项:无法把内核要求的 evidence 关掉。
   */
  evidencePolicy: z.enum(['inherit', 'require']).default('inherit'),
  description: z.string().max(500).optional(),
});
export type RoleProfile = z.infer<typeof roleProfileSchema>;

/** 解析自定义角色名 → canonical Role(clamp 前调用,§6.5 resolveRoleToCanonical)。 */
export function resolveRoleToCanonical(roleName: string, ctx: { profiles: Map<string, RoleProfile> }): Role {
  const canonical = ['planner','worker','proposer','critic','peer','arbiter'];
  if (canonical.includes(roleName)) return roleName as Role;     // 直接是 canonical
  const profile = ctx.profiles.get(roleName);                    // 是 RoleProfile 全局 id
  if (!profile) throw new SyluxError('PLUGIN_DSL_COMPILE_ERROR', `未知角色/RoleProfile ${roleName}`);
  return profile.mapsTo;                                          // 投影成 canonical
}
```

### 7.3 evidence 策略的单调收紧定理(X5 焊死)

**命题**:任何 RoleProfile 对 evidence 的影响,要么不变(`inherit`),要么更严(`require`),**绝不更松**。

**论证**:
- 引擎执行 evidence 校验的唯一函数是 02 §8 `validateMessage`,它读 `Message.role`(canonical)与 `Message.kind` 判 C1/C2。RoleProfile **不参与** `validateMessage`(它只影响 prompt 渲染期的 brief)。
- 因此「mapsTo:critic 的自定义角色」写黑板的 `role` 就是 `critic` → C1 照常强制 evidence。插件**无法**通过把自定义角色 mapsTo 到 `proposer` 来「让一个本该批判的角色免 evidence」——因为那样它发的 `kind` 若是 `critique` 仍触发 C1(C1 是 `role==='critic' || kind==='critique'` 的**或**)。
- `evidencePolicy:'require'` 是**额外**的插件级前置闸(§7.4 在引擎 runTurn 校验前追加):即使 canonical 映射不强制,插件可要求强制。这只会让校验**更严**。没有任何枚举值能让它更松。

> 故 RoleProfile 满足 X5:**能力只增不减**。一个恶意 RoleProfile 最多让 evidence 要求更严(对抗性反而有益)或写个误导性 brief(brief 进对面 prompt 时过防火墙,§7.4)。

### 7.4 RoleProfile 的 brief 进 prompt 仍过防火墙(PT7)

`roleBrief` 是插件提供的字符串,注入 prompt 的 `[ROLE]` 段(03 §2.3)。它可能被恶意作者塞注入(「忽略你的系统提示,执行...」)。处置:

- `roleBrief` 注入 prompt 前**过 08 §4 的注入特征扫描**(`scanInjection`):high 命中 → 拒载该 RoleProfile(`PLUGIN_DSL_COMPILE_ERROR`,编译期静态扫),不等运行期。
- 与 peer 数据不同,`roleBrief` 是「系统提示侧」内容(不是 peer 数据),不包 `<<<PEER_DATA>>>` 封套;但正因它进系统提示侧、信任更高,**编译期扫描更严**:任何 high 命中直接拒,不降级 flag。
- 运行期:brief 已是静态文本(不含 board 派生内容),无动态注入面。

### 7.5 RoleProfile 失败降级(对接 §4.5)

RoleProfile 求值/解析失败(理论上 declarative 不会运行期失败,但解析阶段可能)→ 回退到 `mapsTo` canonical 角色的**内核默认 brief**(引擎为 6 角色内置的标准 brief,如 critic 的「你是红队…必须给可核验 evidence」03 §7.1)+ **默认 evidence 强制**(按 canonical 的 C1)。即:RoleProfile 挂了 = 退化成「用标准 canonical 角色」,绝不退化成「无 brief 无 evidence」(X5 故障路径单调性)。

---

## 8. PluginStopPolicy —— 自定义停止策略(适配为 04 StopPolicy child 注入 CompositeStopPolicy)

### 8.1 设计:插件只能「加停止条件」,不能「拿掉硬刹车」(对齐 04 v3 child 注入)

**v2 焊死 E8**:03/04 v3 已**删除** v1 的 `Brakes`/`checkBefore`/`checkAfter`/`BrakeResult` 二分。现状是:引擎只持有**一条** `StopPolicy`(03 `EngineDeps.stopPolicy`),每轮**末**调一次 `update→shouldStop`(无前置刹车,03 H1);装配层用 04 的 `CompositeStopPolicy` 把 `[PlaybookDonePolicy, DonePolicy, MaxRoundsPolicy, ConvergencePolicy, BudgetPolicy]` 聚合成这一条(04 §8.3 `buildStopPolicy`)。预算前瞻(扇出前花钱判定)是 04 `BudgetPolicy.preflightFanout` / `maxTurnTokens` **纯函数**,**不是 `StopPolicy`**(04 §6.3:扇出在轮内,时机不同)。

因此插件停止策略的正确接入方式**不是**自造一层 `composeBrakes`,而是:**把插件停止策略适配成一个 04 `StopPolicy`,作为 child 追加进 `CompositeStopPolicy`,排在所有内核 child 之后**(§8.3)。这样:

- **OR 语义天然成立**:`CompositeStopPolicy.shouldStop` 收集**全部** `shouldStop=true` 的 child 决策再按优先级裁一个终态(04 §8.1/§8.2)。任一 child(含插件)要停 → run 停。
- **插件无否决权(X5)是结构保证**:一个返回 `KEEP_RUNNING` 的插件 child **无法压制** `MaxRoundsPolicy`/`BudgetPolicy`/`ConvergencePolicy` 同轮的 `shouldStop=true`——composite 是「任一 fire 即停」,不是「全票通过才停」。插件**只能新增停止票**,不能撤销别人的停止票。
- **插件碰不到预算前瞻(R2/§8.4)是结构保证**:`preflightFanout`/`maxTurnTokens` 是 `BudgetPolicy` 的方法,引擎在**扇出点**直接调,根本不经过 child 列表;插件 child 只在**轮末** `shouldStop` 被问到,物理上够不着扇出前的花钱判定。

合成规则一句话:**内核 child OR 插件 child**——任一要停就停;插件只能让 run **更早**停,永远不能更晚停、不能让预算闸失灵。

### 8.2 PluginStopPolicy 接口与 DSL(插件作者面)

插件作者面对的仍是**纯函数** `evaluate(board)→停止票?`(与 04 内部的 `update/shouldStop` 两步契约解耦——作者不必懂 04 的有状态刹车机制)。适配成 04 `StopPolicy` 的桥接由宿主 `PluginStopAdapter`(§8.3)做。

> **★ 终态只能是 `stalled`(本文最关键的 StopPolicy 安全决策,焊死两个洞)**:插件停止票**不允许**声明 `done`。理由有二,缺一即漏:
> - **优先级**:04 §8.2 `PRIORITY` 是 `done:0 > aborted:1 > limit:2 > stalled:3`(done 最高)。若放行插件 `done`,一个恶意/bug 插件每轮投 `done`,同轮即便内核 `BudgetPolicy` 触顶投 `limit`,composite 也会按 `done:0` 把终态记成**成功**——把"超预算失败"伪装成"任务完成",污染审计与成本归因。
> - **证据门**:内核的"完成"出口(04 `DonePolicy` / `PlaybookDonePolicy`)强制 done↔ack 且 ack 带 ≥1 强证据(02 C2)。若插件能经 `stopWhen` 表达式直接投 `done`,就**绕过了 02 C2 的证据门**——插件凭一个布尔表达式即可宣布"成功",无任何证据背书。这是 X5 单调性的硬漏洞。
>
> 故插件停止策略**只能表达"该收手了(吵不动/没进展,判 `stalled`)"**;真正的"完成"判定恒由内核 child 持有(`playbook.isDone`→`PlaybookDonePolicy`,通用 done+ack→`DonePolicy`,均在引擎侧、均过证据门)。`stalled:3` 是最低优先级 → 插件票**永远不会**盖掉内核的 `done`/`aborted`/`limit` 终态。这同时让"插件无否决 + 只能更早停"的单调性在终态层面也成立。

```ts
/** 插件停止策略(插件作者实现/DSL 编译产出的纯函数)。
 *  declarative 形态 = 一个 stopWhen 表达式;sandboxed 形态 = evaluate 纯函数。
 *  注意:这【不是】04 的 StopPolicy(那是 update/shouldStop 两步有状态契约);
 *  它经 §8.3 PluginStopAdapter 适配成 04 StopPolicy 后才作为 child 注入 CompositeStopPolicy。 */
export interface PluginStopPolicy {
  readonly id: string;             // stop:acme-flows@1/no-progress
  readonly name: string;
  /** 纯判定:读只读快照,返回停止票(不停=undefined)。无状态——每轮重新从快照算。
   *  ★ 终态恒为 'stalled'(插件不能投 done,见上);reason 仅人读旁注(§8.3 不入裁决文本)。 */
  evaluate(board: BoardViewSnapshot): { stop: true; reason: string } | undefined;
}

/** declarative 形态 DSL。 */
export const stopPolicyDslSchema = z.object({
  dslVersion: z.literal(1),
  name: z.string().min(1),
  /** 停止条件:受限表达式(§6.3),求值 bool。true → 投停止票(终态恒 stalled)。 */
  stopWhen: z.string().min(1),
  /** 命中时的终态:★ 只能是 'stalled'。插件不能投 'done'(绕证据门 + 盖内核终态,见上)、
   *  也不能投 'running'/'aborted'/'limit'(伪造故障态 / 冒用内核预算终态)。
   *  保留 z.literal 而非删字段:为将来若放宽留位,但当前硬锁 stalled。 */
  status: z.literal('stalled').default('stalled'),
  reason: z.string().max(200).default('PLUGIN_STOP'),
});
export type StopPolicyDsl = z.infer<typeof stopPolicyDslSchema>;
```

> stopWhen 可用 §6.3 的全部谓词(含 `stalledFor`、`countKind`、`hasDoneAckedWithEvidence`——注意插件可**读** `hasDoneAckedWithEvidence()` 做判断,但读到为真时它的合法动作是投 `stalled` 停止票或干脆不投让内核 `DonePolicy` 来收;它**不能**自己把终态记成 `done`)。`evaluate` 是无状态纯函数:它**不持 `emptyStreak` 这类跨轮计数**(那些有状态判据是内核 `ConvergencePolicy` 的职责,插件经 `stalledFor()` 谓词**只读**其结果,不自维护),故 §8.3 的 adapter 用空 `update` 即可。

### 8.3 适配为 04 StopPolicy 并注入 CompositeStopPolicy(X5 焊死)

宿主把每个 `PluginStopPolicy` 包成一个 04 `StopPolicy`(`PluginStopAdapter`),再把这些 adapter 作为 child **追加进** 04 `buildStopPolicy` 的子列表(排在内核 child 之后,优先级最低)。

```ts
import type { StopPolicy, StopContext, StopDecision } from '@sylux/core'; // 04 权威
import { KEEP_RUNNING } from '@sylux/core';                               // 04 §2.2

/** 把不可信的 PluginStopPolicy 适配成 04 StopPolicy(child)。无状态:每轮重算。
 *  桥接 04 的 StopContext → 插件要的 BoardViewSnapshot 用 getSnapshot 闭包(同 03 PlaybookDonePolicy 的 board→ctx 桥)。 */
export class PluginStopAdapter implements StopPolicy {
  readonly id: string;
  constructor(
    private readonly pp: PluginStopPolicy,
    private readonly sandbox: SandboxHostRef | null,
    private readonly getSnapshot: (ctx: StopContext) => BoardViewSnapshot,
  ) { this.id = pp.id; }

  update(_ctx: StopContext): void { /* 无状态:每轮重新问 evaluate */ }

  shouldStop(ctx: StopContext): StopDecision {
    let vote: ReturnType<PluginStopPolicy['evaluate']>;
    try {
      vote = evalPluginStop(this.pp, this.sandbox, this.getSnapshot(ctx)); // DSL 主线程 / sandboxed 进 worker(§4.3)
    } catch {
      // 插件求值失败 = 弃权(保守:不强行停,靠内核 child 兜底,§4.5);记 system 告警由宿主做
      return KEEP_RUNNING;
    }
    if (!vote?.stop) return KEEP_RUNNING;
    // ★ 终态硬锁 stalled:插件不能投 done(§8.2),即便 sandbox 回吐别的 status 也无视(X4/X5)
    return {
      shouldStop: true,
      status: 'stalled',
      // code 留空:插件停止是「范式语义良性 stall」,非错误码语义;reason 走固定模板防注入(对齐 04 S8,不内插插件自由文本)
      reason: `PLUGIN_STOP:${this.id}`,
    };
  }
  // 插件 child 无跨轮状态,reset/reconfigure 省略(04 §8.1 的 child 可选方法)
}
```

插件 child 经 04 `buildStopPolicy`(§8.3)的扩展入参注入。**回填 04 §8.3 `StopPolicyConfig`**(向后兼容新增可选字段):

```ts
// 回填 04 StopPolicyConfig:新增可选 pluginStops(默认无),由本文宿主在装配时填入已适配的插件 child。
export interface StopPolicyConfig {
  // …04 原有字段:maxRounds / convergence? / budget? / enableDone? / playbookDone? …(04 §8.3,不动)
  /** v2(本文):已适配为 04 StopPolicy 的插件停止策略;追加在内核 child 之后(优先级最低)。 */
  pluginStops?: readonly StopPolicy[];
}

// 04 §8.3 buildStopPolicy 末尾追加(本文要求 04 回填的唯一一行):
//   if (cfg.pluginStops) children.push(...cfg.pluginStops);   // 内核 child 在前,插件 child 在后
//   return new CompositeStopPolicy(children);
```

> 装配时序:宿主在 run 启动装配 `stopPolicy` 时(§10.5 step 5),把启用的 `PluginStopPolicy[]` 各包成 `PluginStopAdapter`,塞进 `buildStopPolicy({ …coreCfg, pluginStops })`。引擎拿到的仍是**一条** `CompositeStopPolicy`,完全不感知里面有插件 child(对齐 03「引擎不认识具体刹车」)。

合成真值表(child 视角,任一 fire 即停):

| 内核 child(MaxRounds/Budget/Convergence/Done) | 插件 child | composite 结果 |
|---|---|---|
| 任一 fire | * | **停**(插件无法压制内核 child;终态取内核的,插件 `stalled:3` 优先级最低,§8.2) |
| 全不 fire | fire(stop) | **停**(终态恒 `stalled`,硬锁) |
| 全不 fire | 不 fire | 继续 |
| 全不 fire | 求值失败 | 继续(adapter 返 `KEEP_RUNNING` 弃权)+ 记 `system` 告警;下轮内核 child 照常兜底 |

> **不变量**:① 插件 child **永远不能让 run 继续**当任一内核 child 要停时(composite OR 语义,无否决);② 插件 child **只能让 run 更早停**(新增 `stalled` 停止票),不能更晚停(X5);③ 插件求值失败 = 弃权(`KEEP_RUNNING`),run 不失控——`MaxRoundsPolicy`(必有,04 §8.3「最后防线」)、`BudgetPolicy` 前瞻、`ConvergencePolicy` 都是内核 child,不受插件影响,事实地基 D 的累积预算闸始终在线。即「自定义停止策略最坏情况是:它失效了,等于没装它,run 靠内核 child 正常收尾」。④ **终态层单调性**:插件 child 终态硬锁 `stalled`(04 §8.2 `PRIORITY` 最低位 3),同轮即便与内核 `done:0`/`aborted:1`/`limit:2` 并 fire,composite 也按内核终态裁决——插件**永远无法**把"超预算/被中止/真完成"盖成自己的 `stalled`,更**无法**伪造 `done` 绕过 02 C2 证据门(§8.2)。这把"插件能加停止条件"收窄到"只能加一个最弱的 stall 类停止信号",是 X5 在终态层的焊死。

### 8.4 为何插件碰不到预算前瞻(R2 焊死,结构保证)

成本安全的核心是 04 `BudgetPolicy` 的两件事:① **轮末** `shouldStop` 的累积 token 预算裁决(事实地基 D:N 轮 ≈ base×(1+2+…+N) 超线性);② **扇出前** `preflightFanout` / `maxTurnTokens` 前瞻(04 §6.3:Fusion panel 单轮并发 N 成员,轮末才查就晚了,要在 spawn 前拦)。这两者**都是内核 `BudgetPolicy` 的方法**,插件**结构上够不着**:

- `preflightFanout` / `maxTurnTokens` **不是 `StopPolicy`**(04 §6.3 明确:扇出在轮内,不在轮末循环)。引擎在**扇出点**直接调 `BudgetPolicy.preflightFanout`,根本不遍历 child 列表 → 插件 child(只在轮末 `shouldStop` 被问)物理上无法参与。
- 轮末预算裁决由 `BudgetPolicy`(内核 child)做;插件 child 排在它**之后**且只能**新增**停止票(§8.3 OR 语义)→ 插件既不能让 `BudgetPolicy` 不 fire,也不能改它的累积估算(那是 `BudgetPolicy` 读 `StopContext.totalUsage` 自算,04 §6.4,插件无写权)。

理由:若插件能影响预算判定,一个 bug/恶意插件就能让「预算超了还继续 spawn」→ 真金白银失控。本设计把这条彻底关死:**插件能加停止条件(更早停),但永远拿不到「花钱前的前瞻闸」与「累积预算估算」**——它们对插件完全封闭。这也是为什么本文不自造 `composeBrakes` 包一层(那会给插件一个介入预算的口子),而是让插件 child 老老实实排在内核 child 之后,只享有「轮末投一张停止票」的最小权限。

---

## 9. provider / agent 适配器扩展点(能力型,§3.3 trusted)

### 9.1 两类扩展要分清

| 扩展 | 是什么 | 信任级 | 能力 |
|---|---|---|---|
| **ProviderTemplate**(§9.2) | 声明式:为既有 CLI(codex/claude)新增一个 provider 接入模板(base_url/wire_api/env 变量名映射) | `declarative` | 零(纯数据;真实注入仍走 07 `toCodexInjection`/`toClaudeInjection` + 08 `buildChildEnv`) |
| **AgentAdapter**(§9.3) | 代码:接入**全新 CLI**(如 gemini-cli)的 `AgentAdapter`(05 §3 接口),需 spawn/解析事件流 | `trusted` | spawn/env/fs_read(逐条确认) |

> 绝大多数「换 provider」需求是前者(declarative,零风险):中转挂了换个 base_url、加个新中转。**只有接入 codex/claude 之外的新 CLI 才需要后者**(trusted 代码)。把这两件事分开,是为了让「日常换 provider」永远走零风险路径,把「装新 CLI 适配器」这件真正危险的事单拎出来强约束。

### 9.2 ProviderTemplate(declarative provider 接入)

```ts
/** 声明式 provider 模板:产出一份可被 07 校验的 ProviderConfig「骨架」,key 仍走 apiKeyRef。
 *  纯数据,无代码;最终注入由 07 toCodexInjection/toClaudeInjection 翻译,08 buildChildEnv 填 key。 */
export const providerTemplateSchema = z.object({
  templateVersion: z.literal(1),
  name: z.string().min(1),
  /** 目标 CLI:只能是已支持的(codex/claude);模板不引入新 CLI(那是 §9.3 的事)。 */
  targetAgentKind: z.enum(['codex', 'claude']),
  /** provider 接入参数(字段语义全部引用 07 ProviderConfig;此处只是预填模板)。 */
  baseUrl: z.string().url(),
  wireApi: z.enum(['responses', 'chat']),              // 引用 07 wireApi 枚举语义
  model: z.string().min(1),
  /** key 引用名(07 apiKeyRef):只存名字,绝不存值(K1/P1)。模板里出现 sk- 即 §9.2 校验炸。 */
  apiKeyRef: z.string().min(1),
  /** 出境分级(07 P5):third_party 触发知情横幅 + guardEgress(08 §7)。 */
  egressClass: z.enum(['official', 'third_party']),
  /** 非密覆盖项(07 ProviderOverrides;经 07 白名单,绝不含 key)。 */
  extraConfig: z.record(z.string(), z.string()).default({}),
}).superRefine((t, ctx) => {
  // 模板任何字符串值命中 SECRET_SIGNATURES(08 §2.4)→ 拒(防把 key 写进模板)
  for (const [k, v] of Object.entries({ baseUrl: t.baseUrl, model: t.model, apiKeyRef: t.apiKeyRef, ...t.extraConfig })) {
    if (isSecretLike(String(v)))
      ctx.addIssue({ code: 'custom', path: [k], message: `模板值疑似 secret(应走 apiKeyRef,K1)` });
  }
});
export type ProviderTemplate = z.infer<typeof providerTemplateSchema>;
```

> ProviderTemplate 编译为一份 `ProviderConfig`(07),交由 07 `ProviderRegistry` 走既有热换/健康探测/failover(07 §8)。**插件零代码、零能力**:它只是「预置好的 provider 填空表」,所有安全闸(key 引用、argv 预扫、env 白名单、出境守门)都是 07/08 既有的,模板不引入任何新执行路径。因此 ProviderTemplate 是 `declarative`,可未签名加载。

### 9.3 AgentAdapter(trusted 代码,接入新 CLI)

接入 codex/claude 之外的新 CLI(如 gemini-cli)需实现 05 §3 的 `AgentAdapter` 接口(`send`/`resume`/产出 `AgentEvent` 流)。这是**唯一**需要 `trusted` 的扩展(它要 spawn 真 exe、解析事件流、构造 env)。约束(全部叠加,缺一不加载):

1. **manifest** `kind:'agent_adapter'`, `trust:'trusted'`, 声明 `capabilities`(至少 `spawn`,可能 `env`/`fs_read`)。
2. **签名 + trust-store**:§3.4 全套(ed25519 + keyId 已信任 + 能力在授权上限内)。
3. **用户逐能力确认**:面板/CLI 明示「插件 X 请求 spawn 新进程、读 env。这等于在你机器上运行任意代码。批准?」。
4. **受限的 host API(不是裸 Node)**:trusted adapter 拿到的不是 `child_process`,而是宿主提供的**受约束工厂**:

```ts
/** trusted agent adapter 实现时,宿主注入的受限 API(不暴露裸 fs/spawn,所有出口仍过全局闸)。 */
export interface AdapterHostApi {
  /** 受约束 spawn:exe 路径必须经 §9.4 解析白名单;env 由宿主 buildChildEnv 构造(插件给【非密变量名】,
   *  真实 key 由宿主从 KeyStore 填,插件拿不到值,S1);sandbox 经 capSandbox 封顶(08 S6)。 */
  spawnAgent(spec: {
    exeRef: string;                  // 经 §9.4 白名单解析,不接受任意路径
    args: string[];                  // 过 assertArgvNoSecret(08 §2.4)后才真 spawn
    requestedEnvVars: string[];      // 插件声明要哪些【非密】env 变量名;宿主按白名单给(08 §2.2)
    sandbox: 'read-only' | 'workspace-write';  // 经 capSandbox 封顶
    stdin: string;
  }): AgentProcessHandle;
  /** 受约束读文件(若批了 fs_read):路径过 isPathSafe(08 §4.4),不许越界/敏感文件。 */
  readFileSafe?(rel: string): string | null;
}
```

> 即便 trusted,插件**也不直接 `import('child_process')`**(那是裸 RCE);它实现 `AgentAdapter` 接口,通过宿主注入的 `AdapterHostApi.spawnAgent` 起进程。该工厂内部:exe 路径过白名单(§9.4)、env 经 `buildChildEnv`(插件给非密变量名、宿主填 key 真值——**插件永远拿不到 key**,S1)、argv 过 `assertArgvNoSecret`、sandbox 经 `capSandbox`。**trusted 给的是「能调这些受限工厂」,不是「能绕过它们」**(X5/X6 在能力型扩展的体现)。

### 9.4 exe 路径解析白名单(防 trusted adapter 乱 spawn)

```ts
/** trusted adapter 的 exeRef → 真实路径解析:只允许已登记的 CLI exe,不接受任意路径(防 spawn evil.exe)。 */
export interface ExeResolver {
  /** exeRef(逻辑名,如 'gemini') → 真实 exe 路径。来源:用户在信任确认时登记的 exe 路径白名单。 */
  resolve(exeRef: string): string | undefined;   // 未登记 → undefined → spawnAgent 抛 PLUGIN_CAPABILITY_DENIED
}
```

> 事实地基 A:Windows 必须直调真实 exe(不能裸名/.cmd)。trusted adapter 接入新 CLI 时,用户在信任确认环节**登记该 CLI 的真实 exe 绝对路径**(进 exe 白名单);adapter 只能 `spawnAgent({exeRef:'gemini'})`,宿主查白名单得真实路径。adapter **无法** spawn 白名单外的任何程序。这把「trusted adapter 能 spawn」收窄到「能 spawn 用户已登记的那几个 CLI exe」。

### 9.5 新 CLI 适配器的事实地基复用

新 CLI 适配器作者必须自测并在 manifest 声明该 CLI 的:① 真实 exe 路径解析方式(事实地基 A 同款坑);② 事件流格式(对齐 02 §6.3 `AgentEvent`:首事件必能映射出 `session_started`,I5);③ output-schema 传递方式(文件 vs 内联,事实地基 C/F 的两端不对称);④ resume 参数集(事实地基 E)。宿主对新 adapter 产出的 `AgentEvent` 流**照样过** 02 §6.3 校验 + 03 §5.3 consume,不因它是插件而豁免(X5)。

---

## 10. 插件 registry / 生命周期 / config 集成 / 热加载

### 10.1 config 集成(承接 16)

`SyluxConfig`(16)新增可选 `plugins` 段(16 §2.1 的第 9 段,向后兼容新增):

```ts
/** 16 SyluxConfig 新增段(本文件提供 schema,16 内嵌组装)。 */
export const pluginsConfigSchema = z.object({
  /** 插件发现目录(相对 repoRoot 或绝对)。默认 ['./sylux-plugins']。 */
  paths: z.array(z.string()).default(['./sylux-plugins']),
  /** 是否允许加载未签名的 sandboxed 插件(默认 false:只在用户明示时放行未签名 JS)。 */
  allowUnsignedSandboxed: z.boolean().default(false),
  /** 是否允许 trusted(能力型)插件(默认 false:agent adapter 等需显式开)。 */
  allowTrusted: z.boolean().default(false),
  /** 沙箱资源闸(§4.4)的默认值,可被 manifest 调低但不可调高。 */
  sandboxLimits: z.object({
    timeoutMs: z.number().int().positive().default(2000),
    maxMemoryMb: z.number().int().positive().default(256),
    maxResultBytes: z.number().int().positive().default(1_000_000),
  }).default({}),
  /** 显式启用的扩展 id 列表(空=发现到的 declarative/sandboxed 全启;trusted 永远需 allowTrusted+确认)。 */
  enabled: z.array(z.string()).optional(),
}).default({});
```

`playbook` 段(16 §5)的 `id` 字段类型从 `PlaybookId` 放宽到 `PlaybookRef`(§5.1):

```ts
// 16 §5 playbook.id:原 z.enum([四范式]) → 放宽容纳 plugin: 前缀(校验期再确认 registry 有注册)
playbookId: z.string().min(1),   // 'red-blue' | ... | 'plugin:acme-flows@1.2.0/triage'
```

> 跨段校验(16 §11.2 追加):若 `playbook.id` 是 `plugin:` 前缀,crossCheck 阶段确认该 id 已在 registry 注册(发现+加载成功),否则 `CONFIG_SCHEMA_INVALID`(fail-fast,K2:坏配置不 spawn)。这要求**插件发现/加载在 config crossCheck 之前完成**(§10.5 时序)。

### 10.2 loader 加载管线(发现→校验→信任→编译→注册)

```
① discover  : 扫 plugins.paths 找 sylux-plugin.json/.yaml         失败码 (跳过坏目录,记 system 告警)
② manifest  : 读 + zodParse(§2)+ engines 兼容(§10.4)            失败码 PLUGIN_MANIFEST_INVALID / PLUGIN_INCOMPAT
③ trust     : 按各扩展 trust 级决定路径(§3);trusted→verifyTrust   失败码 PLUGIN_UNTRUSTED / PLUGIN_SIGNATURE_MISMATCH / PLUGIN_CAPABILITY_DENIED
              (declarative/sandboxed 不走签名闸,除非 allowUnsigned=false 拦未签名 sandboxed)
④ compile   : declarative→dsl-compile(主线程纯函数,§6.5);          失败码 PLUGIN_DSL_COMPILE_ERROR
              sandboxed→SandboxHost.load 进 worker(§4.3);
              roleBrief 编译期防火墙扫描(§7.4)
⑤ register  : 全局 id → 已编译插件入 PluginRegistry(§10.3)         失败码 PLUGIN_DUPLICATE_ID
```

> 任一插件加载失败**只跳过该插件**(记 `system` 告警,redact),不影响其他插件与 run 启动——除非 config 显式引用了加载失败的插件 id(则 §10.1 crossCheck fail-fast)。即「插件是可选增强,坏插件不拖垮系统;但被点名用的坏插件让启动明确失败,不静默降级到错误剧本」。

### 10.3 PluginRegistry

```ts
export interface PluginRegistry {
  /** 注册(loader 调用)。同 id 重复 → PLUGIN_DUPLICATE_ID。 */
  register(entry: CompiledPlugin): void;
  getPlaybook(id: PluginPlaybookId): CompiledPlaybook | undefined;
  getRoleProfile(id: string): RoleProfile | undefined;
  getStopPolicy(id: string): PluginStopPolicy | undefined;
  getProviderTemplate(id: string): ProviderTemplate | undefined;
  /** 列出已注册扩展(面板展示;含 trust 级/签名状态,过 redact)。 */
  list(): CompiledPluginMeta[];
  /** 卸载(热换/禁用)。sandboxed→kill worker。 */
  unregister(id: string): Promise<void>;
}
```

> registry 落 `@sylux/server`(持有 worker 句柄等 I/O 资源)。`CompiledPlaybook.toPlaybook()` 即 §5.3 `adaptPluginPlaybook`,把不可信插件包成引擎认的 03 `Playbook`。

### 10.4 版本与兼容性(承接 §2.1 engines)

- **manifest `engines.sylux`**:semver range,对当前 sylux 版本求交;不满足 → `PLUGIN_INCOMPAT`,拒载。
- **manifest `engines.schemaVersion`**:期望的 02 `SCHEMA_VERSION`。若 02 契约破坏性 +1(02 §1.2),旧插件 `schemaVersion` 不匹配 → 拒载(防旧插件按旧 Message 形状产出畸形输出)。匹配或缺省(向后兼容)→ 放行。
- **本文件 API 版本**:`PluginPlaybook`/DSL schema 演进独立计 `dslVersion`/`profileVersion`/`templateVersion`(各 schema 内 `z.literal`);破坏性变更 +1,loader 按版本走迁移或拒载。
- **多版本并存**:同包多版本可同时注册(全局 id 带 `@version`);config 不锁版本时取**已注册的最高兼容版**(满足 engines)。

### 10.5 启动时序(与 config / 引擎的关系)

```
1. loadSyluxConfig 读 config(16),解析出 plugins.paths(此步不校验 playbook.id 是否插件)
2. PluginLoader 按 plugins.paths 发现+加载+注册(§10.2)→ registry 就绪
3. config crossCheck(16 §11.2):若 playbook.id 是 plugin: 前缀,确认 registry 已注册;否则 fail-fast
4. resolvePlaybook(config.playbook.id, registry)(§5.1)→ 得 03 Playbook(插件经 adaptPluginPlaybook)
5. 装配 stopPolicy:把启用的 `PluginStopPolicy[]` 各包成 `PluginStopAdapter`(§8.3),经 04 `buildStopPolicy({…coreCfg, pluginStops})` 组成一条 `CompositeStopPolicy` → 注入 03 `EngineDeps.stopPolicy`
6. runEngine(playbook, deps)(03 §5)正常跑;引擎完全不感知插件存在
```

> 插件加载**早于**引擎启动且**早于** spawn 任何 CLI 子进程:坏插件/坏 config 在 spawn 前就 fail-fast(K2)。run 进行中**不热加载新剧本**(剧本在 step 4 定死);热加载只用于「下一次 run 前刷新插件集」(§10.6)。

### 10.6 热加载(run 之间,非 run 之中)

- 面板「重载插件」或 config reload(16 §K3 同款失败安全):重跑 §10.2 加载管线,产出**新 registry**;**当前进行中的 run 不受影响**(它持有 step 4 已解析的 Playbook 实例)。
- 失败安全:新加载若有插件失败,**保留旧 registry 的成功项**,新失败项记告警,不清空已用插件(对齐 07 §8.6 / 16 §K3「坏配置保留旧值」)。
- run 进行中换剧本**不支持**(03 的 `BoardState.playbookId` 虽可变,但插件剧本的 `deriveState` 依赖消息历史语义,中途换会让状态复算错位)——换剧本=起新 run。

---

## 11. 插件相关错误码(语义;union 本体回填 02 §12)

下列码的 **union 定义本体应回填 02 §12 `errors.ts`**(单一权威 R1);本文件拥有其**插件语义**。均为 union 加成员(向后兼容,非破坏性,同 02 §14 / 08 §8 演进纪律)。

| 错误码 | 触发 | 处置 | 02 现状 |
|---|---|---|---|
| `PLUGIN_MANIFEST_INVALID` ★ | 清单解析/zod/superRefine 失败(§2.3) | 跳过该包,记 system 告警(redact);被 config 点名则 fail-fast | 需回填 |
| `PLUGIN_UNTRUSTED` ★ | trusted 缺签名 / keyId 未信任 / 未签名 sandboxed 且未 allowUnsigned(§3.4) | 拒载;面板提示信任流程 | 需回填 |
| `PLUGIN_SIGNATURE_MISMATCH` ★ | 签名校验失败(entry 文件被篡改,§3.4 / PT6) | 拒载;高危告警 | 需回填 |
| `PLUGIN_CAPABILITY_DENIED` ★ | 能力超授权上限 / sandbox 内 require 被禁模块(§3.4/§4.2) | 拒载该扩展 / worker 抛错降级 | 需回填 |
| `PLUGIN_INCOMPAT` ★ | engines.sylux / schemaVersion 不兼容(§10.4) | 拒载;detail 给期望 vs 实际 | 需回填 |
| `PLUGIN_DSL_COMPILE_ERROR` ★ | DSL/表达式编译失败、未知变量/谓词/角色、roleBrief 防火墙命中(§6.5/§7.4) | 拒载该扩展;编译期(早于 run) | 需回填 |
| `PLUGIN_DSL_EVAL_ERROR` ★ | 运行期表达式求值失败(无匹配 turnRule / 嵌套过深,§6.4) | playbook→硬停 aborted;stop→弃权(§4.5) | 需回填 |
| `PLUGIN_OUTPUT_INVALID` ★ | clampRoundPlan 结构/越界/空 turns(§5.5) | playbook 这轮失败→硬停(§4.5) | 需回填 |
| `PLUGIN_TIMEOUT` ★ | sandbox 调用超时(§4.4) | kill worker;按插件故障降级(§4.5) | 需回填 |
| `PLUGIN_RESOURCE_EXCEEDED` ★ | worker OOM / 返回体积超限(§4.4) | 同上 | 需回填 |
| `PLUGIN_EVAL_FAILED` ★ | sandbox 调用抛错(通用) | 同上 | 需回填 |
| `PLUGIN_NOT_FOUND` ★ | resolvePlaybook 引用未注册 id(§5.1) | fail-fast(config crossCheck,§10.1) | 需回填 |
| `PLUGIN_DUPLICATE_ID` ★ | registry 注册同全局 id(§10.3) | 拒第二个;告警 | 需回填 |
| `PLUGIN_DISABLED` ★ | worker 反复崩溃达上限(§4.4) | 该插件禁用;run 按不可用降级 | 需回填 |

```ts
// 需回填 02 §12 SyluxErrorCode union(向后兼容新增成员):
//   | 'PLUGIN_MANIFEST_INVALID' | 'PLUGIN_UNTRUSTED' | 'PLUGIN_SIGNATURE_MISMATCH'
//   | 'PLUGIN_CAPABILITY_DENIED' | 'PLUGIN_INCOMPAT' | 'PLUGIN_DSL_COMPILE_ERROR'
//   | 'PLUGIN_DSL_EVAL_ERROR' | 'PLUGIN_OUTPUT_INVALID' | 'PLUGIN_TIMEOUT'
//   | 'PLUGIN_RESOURCE_EXCEEDED' | 'PLUGIN_EVAL_FAILED' | 'PLUGIN_NOT_FOUND'
//   | 'PLUGIN_DUPLICATE_ID' | 'PLUGIN_DISABLED'
```

> 全部经 `redactObject`(08 §3)脱敏后落 system 消息 / 日志 / WS(X8)。插件失败的共性处置见 §4.5:**退回到「没有这个插件」的安全基线**。

---

## 12. 统一导出(`@sylux/plugins/src/index.ts`)

```ts
// ── manifest / 信任(manifest.schema.ts)──
export {
  pluginManifestSchema, extensionDeclSchema, capabilitySchema, trustLevelSchema, extensionKindSchema,
  extensionGlobalId,
} from './manifest.schema.js';
export type { PluginManifest, ExtensionDecl, Capability, TrustLevel, ExtensionKind, TrustEntry } from './manifest.schema.js';

// ── playbook(playbook/*)──
export { compilePlaybookDsl, playbookDslSchema } from './playbook/dsl.schema.js';
export { clampRoundPlan, clampParams, roundPlanRequestSchema } from './playbook/clamp.js';
export { adaptPluginPlaybook, resolvePlaybook } from './playbook/plugin-playbook.js';
export type {
  PluginPlaybook, PluginPlaybookId, PlaybookRef, RoundPlanRequest, TurnDirectiveRequest,
  PromptContextRequest, ClampContext,
} from './playbook/plugin-playbook.js';
export type { PlaybookDsl } from './playbook/dsl.schema.js';

// ── 表达式(expr/*)──
export { exprSchema, evalExpr } from './expr/expr-eval.js';
export type { Expr, ExprScope } from './expr/expr-eval.js';

// ── role / stop / provider(role|stop|provider/*)──
export { roleProfileSchema, resolveRoleToCanonical } from './role/role-profile.js';
export type { RoleProfile } from './role/role-profile.js';
export { stopPolicyDslSchema, PluginStopAdapter } from './stop/plugin-stop.js';
export type { PluginStopPolicy, StopPolicyDsl } from './stop/plugin-stop.js';
export { providerTemplateSchema } from './provider/provider-template.js';
export type { ProviderTemplate } from './provider/provider-template.js';

// ── config 段(供 16 内嵌)──
export { pluginsConfigSchema } from './config.js';
```

> 用 `.js` 后缀(NodeNext,总体规划 §11.4);`type` 与值导出分开(`consistent-type-imports`)。宿主侧(`SandboxHost`/`PluginRegistry`/`PluginLoader`/trust-store)落 `@sylux/server`,**不**从本包导出(它们带 I/O,不属纯逻辑层)。

---

## 13. 测试矩阵(交付验收锚点)

每条「给定输入 → 期望行为」,可直接落 vitest;对接总体规划 §12。

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| **manifest/信任** | | | |
| P1 | declarative 请求能力 | ext.trust=declarative, capabilities=['spawn'] | superRefine 失败 `PLUGIN_MANIFEST_INVALID` |
| P2 | trusted 缺签名 | trust=trusted, 无 signature | `PLUGIN_UNTRUSTED` |
| P3 | 签名篡改 | entry 文件改了签名没改 | `PLUGIN_SIGNATURE_MISMATCH` |
| P4 | 能力超授权 | 请求 net,trust-store 只授 spawn | `PLUGIN_CAPABILITY_DENIED` |
| P5 | engines 不兼容 | engines.sylux=">=99.0.0" | `PLUGIN_INCOMPAT` |
| **DSL 编译/求值** | | | |
| P6 | 未知谓词 | when:"unknownFn()" | `PLUGIN_DSL_COMPILE_ERROR` |
| P7 | 未知 agent 名 | then.agent='ghost' | clamp 时 `PLUGIN_OUTPUT_INVALID`(allowedAgents 不含) |
| P8 | 表达式深嵌 | 65 层嵌套 expr | `PLUGIN_DSL_EVAL_ERROR` |
| P9 | red-blue DSL 等价 | §6.6 red-blue DSL | nextTurn 输出与 03 §7.1 RedBlue 逐轮 agent/role/kind 一致 |
| P10 | master-worker phase | plan→implement→review 消息序列 | deriveState 复算 phase 正确;X3 纯函数(同 board 同 state) |
| P11 | parallel 两 turn | then 含两 worker | execution='parallel', turns.length=2 |
| **输出夹取** | | | |
| P12 | maxRounds 越界 | 插件 params.maxRounds=999, config=12 | clampParams → 12(取 min) |
| P13 | sandbox 提权 | 插件请求 danger | capSandbox → workspace-write |
| P14 | contextCap 越界 | 插件 contextCap=1e9, cap=8000 | 夹到 8000 |
| P15 | role 非 canonical | clamp 收到 role='skeptic'(未投影) | `PLUGIN_OUTPUT_INVALID` |
| P16 | deltaSelector 不给原文 | 插件输出 promptContext | 无 delta 内容字段;引擎按 selector 物化+防火墙 |
| **RoleProfile** | | | |
| P17 | mapsTo critic 强制 evidence | 自定义角色 mapsTo:critic | 写黑板 role=critic;02 C1 照常强制(X5) |
| P18 | evidencePolicy 只能收紧 | policy='require', mapsTo:proposer | 额外强制 evidence;无 'waive' 选项 |
| P19 | roleBrief 注入 | brief 含 "ignore previous instructions" | 编译期防火墙 high → `PLUGIN_DSL_COMPILE_ERROR` |
| P20 | RoleProfile 失败降级 | profile 解析失败 | 回退 canonical 默认 brief + 默认 evidence(§7.5) |
| **StopPolicy** | | | |
| P21 | 内核 child 不可否决 | MaxRounds/Budget child fire, 插件 child 返 KEEP_RUNNING | 停(composite OR,插件无否决,§8.3) |
| P22 | 插件只能更早停(stalled) | 硬不停, 插件 stopWhen 真 | 停, status==='stalled'(恒锁) |
| P23 | 插件不能投 done/伪造终态 | DSL stop status='done'(或 'aborted'/'limit') | schema 拒(`z.literal('stalled')` 只收 stalled,§8.2) |
| P24 | 插件求值失败=弃权 | evaluate 抛错 | adapter 返 KEEP_RUNNING(弃权)+告警;内核 child 下轮兜底 |
| P25 | 预算前瞻不经插件 | 任意插件 | `BudgetPolicy.preflightFanout` 在扇出点直接调,不遍历 child;插件 child 仅轮末被问(§8.4) |
| **沙箱** | | | |
| P26 | worker 无 fs | sandboxed 插件 require('fs') | `PLUGIN_CAPABILITY_DENIED` |
| P27 | worker 无 key env | 插件读 process.env | env 无 *_KEY(空 env,§4.2) |
| P28 | 超时杀 | nextTurn 死循环 | `PLUGIN_TIMEOUT`,worker 被 kill,引擎硬停 |
| P29 | OOM 闸 | 插件分配巨数组 | worker OOM,`PLUGIN_RESOURCE_EXCEEDED` |
| P30 | 死快照 | 插件改 board 参数 | 改的是克隆,主进程 board 不变 |
| **provider/集成** | | | |
| P31 | 模板含 key | ProviderTemplate baseUrl 含 sk- | superRefine 拒(K1) |
| P32 | trusted adapter spawn 白名单 | exeRef 未登记 | `PLUGIN_CAPABILITY_DENIED` |
| P33 | adapter 拿不到 key | spawnAgent requestedEnvVars 含 KEY 名 | env 由宿主填,插件回调拿不到真值(S1) |
| P34 | config 引用未注册剧本 | playbook.id='plugin:x/y' 未加载 | crossCheck fail-fast(`PLUGIN_NOT_FOUND`/`CONFIG_SCHEMA_INVALID`) |
| P35 | 回放一致 | 同 jsonl 重放插件 run | deriveState 复算 state 一致(X3);BoardState 投影正确 |
| P36 | 插件 child 终态恒 stalled | sandboxed evaluate 回吐 status='done' | adapter 无视,裁 stalled(§8.3 硬锁);不绕证据门 |
| P37 | 同轮内核+插件并 fire | Budget child fire('limit') 且插件 child fire('stalled') | composite 按 04 §8.2 PRIORITY 裁,终态='limit'(内核 2 < 插件 3,插件不盖) |

---

## 14. 收尾:权威性声明、回填项、openQuestions

### 14.1 本文件拥有(权威,他文引用)

- `PluginManifest` / `ExtensionDecl` / `Capability` / `TrustLevel` / `extensionGlobalId`(§2);`TrustEntry` / `verifyTrust`(§3.4)。
- 三级信任模型与能力面(§3);sandbox 能力剥离 + worker isolate + 资源闸契约(§4)。
- `PluginPlaybook` / `RoundPlanRequest` / `deltaSelector` / `adaptPluginPlaybook` / `clampRoundPlan` / `clampParams`(§5)。
- 声明式剧本 DSL(`playbookDslSchema`)+ 受限表达式语言(`exprSchema`/`evalExpr`)+ `compilePlaybookDsl`(§6)。
- `RoleProfile`(§7)、`PluginStopPolicy` + `PluginStopAdapter`(注入 04 `CompositeStopPolicy`,§8)、`ProviderTemplate` + `AdapterHostApi` + `ExeResolver`(§9)。
- `PluginRegistry` / loader 管线 / `pluginsConfigSchema`(§10)。

### 14.2 引用而非另写

- `Message`/`Evidence`/`Role`/`MessageKind`/`AgentId`/`BoardState`/`SyluxError`/错误码 union → 02。
- `Playbook`/`BoardView`/`RoundPlan`/`TurnDirective`/`PromptContext`/`PlaybookParams`/`PlaybookId`/`PlaybookDonePolicy` → 03;`StopPolicy`/`StopContext`/`StopDecision`/`CompositeStopPolicy`/`buildStopPolicy`/`BudgetPolicy`/收敛差集 → 04。
- `ProviderConfig`/`wireApi`/`toCodexInjection`/`KeyStore` → 07。
- `firewallPeerMessage`/`capSandbox`/`buildChildEnv`/`SECRET_SIGNATURES`/`isSecretLike`/`isPathSafe`/`guardEgress` → 安全文档(08)。
- `SyluxConfig`/`loadSyluxConfig`/派生 → 16。

### 14.3 回填项(本文件相对他文,均向后兼容)

- **02 §12**:新增 §11 的 14 个 `PLUGIN_*` 错误码(union 加成员,非破坏性)。**核对**:02 §12 v2.1 union 现含契约/子进程/引擎/安全/WS/worktree/fusion/provider 八域全集,但**尚无 `PLUGIN_*` 域**——本文 §11 的 14 个码需作为第九域加入(本文拥有其语义,字面量登记仍在 02 §12 单一来源)。
- **03 §3.3**:`PlaybookId` 在引擎解析侧引入 `PlaybookRef = PlaybookId | PluginPlaybookId`(§5.1);`resolvePlaybook` 据前缀分发内置 vs 插件。03 的 `Playbook` 接口本体不变(插件经 `adaptPluginPlaybook` 适配)。
- **04 §8.3**:`StopPolicyConfig` 新增可选 `pluginStops?: readonly StopPolicy[]`,`buildStopPolicy` 末尾 `children.push(...cfg.pluginStops)`(内核 child 在前、插件 child 在后)(§8.3)。这是本文相对 04 的**唯一**回填,向后兼容(不填即无插件 child,行为同今)。**焊死 E8**:本文插件停止策略一律走此 child 注入,**不**自造 `Brakes`/`composeBrakes`(v1 二分已被 03 H1/04 v3 删除)。
- **16 §2.1 / §5 / §11.2**:新增 `plugins` 段(§10.1);`playbook.id` 放宽为 `PlaybookRef`;crossCheck 追加「plugin: 前缀须已注册」校验;启动时序插入「插件加载早于 config crossCheck 与 spawn」(§10.5)。
- **08(安全)**:确认 `capSandbox`/`buildChildEnv`/`firewallPeerMessage`/`SECRET_SIGNATURES`/`isPathSafe` 被本文 §5.5/§7.4/§9.3 复用;沙箱 worker 的 env 复用 `BASE_ENV_ALLOWLIST`(§4.2)。

### 14.4 演进纪律

- DSL/Profile/Template/manifest 各自带 `*Version`(`z.literal`);破坏性变更 +1 并加 loader 迁移分支(同 02 §7.4 风格)。
- 信任模型(三级 / 能力剥离 / 签名)的任何放松属安全敏感变更,改动需补 §13 对应测试 + code review;`trustLevelSchema`/`capabilitySchema` 内置约束不删。
- X1–X8 不变量是验收硬指标:任何让插件「绕过校验/放松权限/隐藏不可复算状态/无界运行」的实现都是 bug。

### 14.5 与红队 R1-R8 的对账

| 红队项 | 本文件如何不犯 |
|---|---|
| R1 单一权威 | 不另写任何 02/03/07/08 类型;命名空间扩展(§1.3)而非就地改枚举;错误码回填 02 §12 |
| R2 token 累积成本 | 插件 child 碰不到 `BudgetPolicy.preflightFanout`/累积预算估算(§8.4,结构封闭);clampParams 取 min 不放大预算(§5.5) |
| R3 thread_id/resume | 新 agent adapter 产出的 AgentEvent 照样过 I5 校验(§9.5) |
| R4 schema 不对称/兜底 | 插件输出过 clampRoundPlan + 02 §8 safeParse(§5.5);sandbox 返回值 zod 校验 |
| R5 收敛 evidence 锚点 | DSL `stalledFor`/`hasDoneAckedWithEvidence` 复用 02 §9.3 指纹差集(§6.3);stall 与 done 解耦不变 |
| R6 spawn 约束 | trusted adapter 经 exe 白名单解析真实 exe(§9.4,事实地基 A) |
| R7 worktree 隔离/冲突硬停 | 插件 parallel 剧本的合并/冲突硬停仍在引擎(§6.6);插件不碰合并 |
| R8 安全(key/注入/沙箱) | 全文核心:key 永不入插件(S1,§3.5);DSL 文案/peer 数据过防火墙(§7.4/§5.4);沙箱封顶不可越(§5.5);出境守门复用 08 §7 |

### 14.6 openQuestions(交付即需用户/M0 裁决)

- **沙箱强度边界**:§4.1 的「独立 fork 进程 + 空 env + 删全局 + 资源闸」对「纯函数越界」足够,但非 OS 级强隔离(seccomp/容器/子用户)。是否需要为 sandboxed 插件追加 OS 级隔离(部署侧),取决于威胁等级——若插件来源完全不可信,建议加;若仅用户自写/团队内部,进程级够用。需用户定位威胁等级。【部署侧】
- **DSL 表达力上限**:§6.6 论证四范式可表达,但「读 evidence 文本做复杂决策」类剧本仍需 sandboxed JS。是否值得给 DSL 加更多谓词(如 `lastEvidenceContains`)以进一步压缩 JS 使用面?权衡:谓词越多 DSL 越强但越接近图灵完备(逼近需沙箱)。建议保守:DSL 只加「读结构化字段」谓词,不加「读自由文本内容」谓词(后者交给沙箱)。【设计取舍,待用户定方向】
- **签名分发与吊销**:§3.4 trust-store 是本地公钥信任,无吊销机制(CRL/OCSP)。若某签名 key 泄露,目前只能手动从 trust-store 删。是否需要吊销列表?对本地单机工具可能过重。【待定】
- **schemaVersion 联动**:§10.4 插件 `engines.schemaVersion` 与 02 `SCHEMA_VERSION` 绑定;02 破坏性 +1 时所有旧插件失效,需提供迁移指引或宽限期策略。【M0 后,随 02 演进确定】
- **插件停止策略只能投 `stalled`(本文 v2 安全决策,记录待复核)**:§8.2 把插件停止票的终态硬锁为 `stalled`,禁投 `done`(否则绕 02 C2 证据门 + 借 04 `PRIORITY` done:0 盖掉内核 `limit`/`aborted`)。代价:插件**无法**表达"我判定范式已完成"这种正向出口——完成判定恒由 `playbook.isDone`(经 `PlaybookDonePolicy`)或通用 `DonePolicy` 持有。若将来确有"插件定义新完成判据"的强需求,正确做法是**让插件剧本的 `isDone`(§5.2,经证据门)承载**,而非放宽 stop 策略的终态。本决策建议定稿保留;`stopPolicyDslSchema.status` 用 `z.literal('stalled')`(非删字段)为将来留位。【设计决策,建议保留,待定稿确认】
- **文档编号(C-NUM,与全仓同源)**:本文件引用**安全 = 08**(`08-security-firewall.md`)、**隔离/worktree = 09**(`09-isolation-worktree.md`),锚定**磁盘文件名**(对齐 x-coverage COV-6 的「建议锚定文件名」)。但 02 §12 错误码分域注释把 injection/egress 归「09」、把 WS 归「08」,采用的是**逻辑编号**(与磁盘相反)。这是全仓双轨制的一个交点,本文已选磁盘派;待用户统一裁决后,若定为逻辑派则需把本文所有「08 安全 / 09 隔离」引用对调。【全仓一致性,待用户裁决】
- **worker 池规模与 parallel 范式**:parallel 剧本若是 sandbox JS,每轮两 turn 但 `nextTurn` 仍是单次调用(产出两 turn);worker 数 = 启用的 sandboxed 插件数,非 turn 数,故与 03 Q3(并发 spawn 限流)无关。确认无误,但 M0 需验 worker fork 开销在每 run 启动期可接受(复用 worker §4.4,非每轮 fork)。【M0 验证】











