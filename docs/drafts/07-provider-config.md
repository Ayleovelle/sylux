# 07 · Provider 配置与热切换(`@sylux/providers` 权威设计)v3.1

> **本文件地位**:`@sylux/providers` 包的权威设计。`ProviderConfig`(每 agent 一份的 base_url/api_key_ref/model/wire_api 等)、`ProviderOverrides`(运行期非密覆盖,05/06 适配层引用)、密钥引用模型(`api_key_ref` → `KeyStore`)、codex/claude 两端注入翻译、中转热切换流程、官方直连选项、本地 Fusion panel 配置形态——这些**只在本文件定义**,适配层 05/06、安全 **08**、worktree **09**、引擎 03、Fusion 21 涉及时一律以 `@sylux/providers` 路径引用,禁止另写。
>
> **⚠ v2 文档编号订正(交叉一致性 blocker)**:v1 多处把「安全」误标为 **09**、把「worktree」误标为 **06**。实际编号:**08 = 密钥安全与内容防火墙**(拥有 `buildChildEnv` / `redact` / `SECRET_SIGNATURES` / 出境 secret scan),**09 = 文件隔离与 worktree 生命周期**,06 = claude 适配器。本 v2 全文已订正为 08(安全)/ 09(worktree)。**残留待协调**:05 §6.3/§9 与 21 §6/§7 内仍有少量「安全 09」字样指代安全文档,应同步订正为 08(见 §14.2 openQuestions)。
>
> **引用而非另写**:
> - `Message` / `EvidenceItem` / `AgentId` / `Role` / `MessageKind` 等黑板类型见**黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`),本文件只引用。
> - `AgentAdapter` / `AgentInput` 接口由**适配层 05**(`docs/drafts/05-adapter-codex.md` v2)拥有;`ProviderOverrides` 在 05 §2 被前向声明为「完整定义在 provider 文档」,**本文件即其权威定义**(§4)。
> - `buildChildEnv` env 白名单**规则**归**安全 08 §2.2**;**其签名是单对象 `buildChildEnv({ providerEnv, agentId })`**(08 §2.2 权威,05 A1 / 06 CA1 已焊死)。本文件拥有它消费的 `providerEnv` 形状 + key 注入变量名约定(§7),按 08 单对象签名调用,**不再用 v1 的双位参 `(cfg, providerEnv)`**(那是 05 A1 已修的 bug)。
> - codex `-c` / `env_key` 拼装、`assertArgvNoSecret`、`SECRET_SIGNATURES` 由 **08 §2.4**(签名集权威)+ 05 §6.4 / 06 §A4(调用闸)实现;本文件给出**要被翻译的配置语义**(§5),不重写拼装/扫描代码。
>
> **事实地基**:provider 注入(C/E/F 节)、resume 成本(D 节)、spawn 约束(A 节)以 `docs/PROBED-FACTS.md` 为准。已实测项不再标【待实测】。
>
> **红队 R8 焊死**:key 永不进 argv/`-c` 字面量(走 env / `auth.json`);`buildChildEnv` 单一出口 + 白名单 + `extendEnv:false`;中转源码出境需 secret scan + `.syluxignore` 白名单 + 知情标注 + 官方直连选项。这些贯穿全文,集中在 §2 / §7 / §9(安全实现归 08)。

---

## 0. 设计目标与不变量

### 0.0 v2 硬化变更表(逐条吃掉交叉/红队 findings)

> 注:v2 编写时 5 份红队报告(x-consistency / x-coverage / red-feasibility / red-security / red-ops-cost)在 `docs/drafts/` 下尚不存在,故 v2 改为直接对账权威邻居文档。**v3.1 更新**:5 份报告现已产出,本轮逐条吃掉其中**点名 07** 的 findings(RS-M4/M5/M7、ROC-m3/m4/m5/m6、FEAS-3),新增 V15–V20(下表)。V1–V14 见 v2 记录(保留)。

| # | 类别 | v1 缺陷 | v2 修正 | 落点 |
|---|---|---|---|---|
| V1 | 一致性(blocker) | 文档编号 rot:安全标 09、worktree 标 06 | 全文订正:安全=08、worktree=09 | 全文 + 头部 |
| V2 | 一致性(blocker) | `buildChildEnv(cfg, providerEnv)` 双位参,与 08 §2.2 / 05 A1 / 06 CA1 单对象签名冲突 | 改 `buildChildEnv({ providerEnv, agentId })`;§7 焊死 | §7.1/§7.2 |
| V3 | 一致性(blocker) | `toCodexInjection(cfg,ov,keystore)` 三参 vs 05 §8.2 `toCodexInjection(merged)` 单参;keystore 未串进适配器 | 统一签名 `toCodexInjection(cfg, keystore, ov?)`;merge 内置;keystore 经 `createCodexAdapter({provider,keystore})` 构造期注入,回填 05 | §5.2/§5.3/§8.4 |
| V4 | 安全(blocker) | claude 端 `extraConfig`→`--settings` 与 06 §3.1 hooks-disable 的 `--settings` 互相覆盖 | `toClaudeInjection` 不再直出 `--settings`,改产 `settingsFragment`(对象),由 06 与 hooks 配置 deep-merge 后单次注入 | §6.2/§6.3 |
| V5 | 安全(major) | `egressClass.default('third_party')` 抹掉 `inferEgressClass`,官方直连被误标第三方 | 去掉静态 default,改 §16 加载层 `normalizeEgressClass`:缺省时按 baseUrl 推断;显式值仅允许「收紧」不允许「放宽」 | §3.1/§9.2 |
| V6 | 成本(major,事实 D) | health probe 用 CLI ping=18.7k tok/次,若周期轮询则烧钱 | 默认**不**周期轮询;仅 on-demand / send 失败后探;优先 HTTP HEAD(近 0 tok);CLI ping 仅手动「验 key」 | §8.5 |
| V7 | 安全(major) | `extraConfig` 任意 `-c k=v` 可覆盖 `env_key`/`base_url`/sandbox,绕开密钥/出境管控;值含换行可断 argv | `extraConfig` key 过白名单正则 + 黑名单关键键(`api_key`/`env_key`/`model_provider*`/`sandbox*`);值禁控制字符;违规 `PROVIDER_CONFIG_INVALID` | §3.4 |
| V8 | 一致性(02 v2) | 裁判 evidence 写「≥1 强/中」,02 §3.2 已收紧为「≥1 **强**」 | §10.3 改「≥1 强核验通过」,weak 不解除 | §10.3 |
| V9 | 一致性 | panel `members[].providerId` / `judge.providerId` 从不校验是否真实存在 | `providerSettingsSchema.superRefine` 增「panel 引用的 providerId 必须在某 slot 的 candidates.id 内」 | §3.3/§10.2 |
| V10 | 一致性 | 决策回合 kind 集(21 §3 = propose/review/critique/question)与 `enabledKinds` 默认(缺 question)不一致 | 默认 `enabledKinds` 补 `question` | §10.2 |
| V11 | 健壮性 | failover 无「坏候选冷却」,可在两个挂掉的候选间抖动 | §8.5 增 per-run 失败冷却表 + 单轮 failover 预算 | §8.5 |
| V12 | 一致性 | `agentProviderSlot.agent` 用 `agentIdSchema`(含 human/orchestrator),但只 codex/claude 可执行 | superRefine 限定 `agent∈{codex,claude}` | §3.3 |
| V13 | 健壮性 | `timeoutMs` 与适配器 `hardTimeoutCeilingMs`(05 A10 / 06 CA7)无映射 | §3.2 明确 `timeoutMs` → 适配器 `hardTimeoutCeilingMs` 默认值 | §3.2 |
| V14 | 安全(协调) | §7.1/§8.4 要白名单放行 `CODEX_HOME`,但 08 `BASE_ENV_ALLOWLIST` 未含 | 改走 `providerEnv`(非密路径)注入 `CODEX_HOME`,免改 08 白名单(路径非 secret-like,过 08 §2.2 自检) | §7.1/§8.4 |
| V15 | 安全(major,RS-M4) | V14 引入的 `_codex_home`→`CODEX_HOME` **无任何路径校验**:能写 provider 配置者(本地文件 / 面板 reload,§8.6 只跑 zod)可把 `CODEX_HOME` 指向任意目录 → codex 读攻击者预置 `auth.json`(用攻击者凭证 / 发往攻击者端点) | 新增 `assertCodexHomeSafe`(绝对路径 + realpath 落在批准的 sylux 数据根 + 不逃逸 + 非指向外部 symlink,符号链接解析复用 08 §4.4 `isPathSafe`);在 §8.6 reload superRefine 外置校验 + 启动加载校验;`toCodexInjection` 兜底再做廉价绝对路径断言 | §3.2.2/§5.2/§8.6 |
| V16 | 成本(major,RS-M5+ROC-m6) | panel N 路扇出无单 turn token 上限 + 预算只轮末裁决 + 默认预算表无 panel 维度 → 一轮可超支 N 倍才被发现 | panel schema 增 `panelTokenBudget`(单轮 Σ成员+裁判 硬顶)+ `perMemberTokenCap`(单成员 turn 累计 usage 超阈即 cancel);新增 `estimatePanelFanout` 供引擎做**扇出感知前瞻**(累积 + N×预测 > 上限则削并发/不启 panel 轮);明确单成员 token 闸归 adapter(05/06 据 `turn.completed.usage` 累计) | §10.2/§10.5/§10.6 |
| V17 | 可行性(major,FEAS-3) | 决策回合 `propose` 既是 panel 启用 kind 又可携带 `files`(写);21 §5.5 对 panel propose 强制 `files:[]` **静默清空** proposer 改动意图 | 焊死契约:panel 启用的决策 kind 成员产物 `files` **必须为空**;非空 → **硬拒**(不静默清空),报 `PROVIDER_CONFIG_INVALID`/运行期 `INJECTION_BLOCKED` 语义,提示「带 files 的 propose 属执行语义,不可 panel 化」;panel 配置增 `rejectMemberFiles:true`(默认) | §10.2/§10.4 |
| V18 | 成本(minor,ROC-m3/m4) | failover 跨端点切换不重置 per-endpoint 拥塞状态:mouubox 抽风把全局 AIMD capacity 砍到 1,切到健康官方端点后仍被压在 1 | `ProviderSwitchEvent` 增 `fromBaseUrlHost`/`toBaseUrlHost`(host 非密),跨端点切换时引擎据此通知 17 governor 按端点 key AIMD / failover 触发 `reset`(信号本文件给,池实现归 17) | §8.3/§8.5 |
| V19 | 成本(minor,ROC-m5) | V6 把 `cli` 探测限「手动」但无节流:面板「验 key」连点 / CI 滥用可 18.7k×N 烧钱 | `cli` 探测加 per-provider 节流(默认 60s 一次)+ 进程级 cli-probe **日预算计数**(超额拒绝);面板按钮二次确认文案已有,补强制节流 | §8.5 |
| V20 | 安全(协调,RS-M7) | 出境横幅只说「会出境」,未点破「secret-scan 非泄漏保证」;`.syluxignore` 默认凭证模板缺位 | 横幅文案前置「出境扫描挡不住短/非标准密钥,官方直连(P5)才是唯一可靠手段」;`third_party` 启用时提示 08 §7 应预置 `.env*`/`.npmrc`/`*.pem` 等凭证文件默认 ignore(实现归 08,本文件给信号 + 文案) | §9.4/§9.5 |

### 0.1 核心目标(对应锁定决策 §4「provider 可配置(硬需求)」)

中转随时可能失效,因此 provider 必须是**软件层一等公民**:`base_url` / `api_key` / `model` / `wire_api` 必须可配、可热换、可加新 provider,**每 agent 一份**。本文件把这件事拆成五层:

| 层 | 解决什么 | 落点 |
|---|---|---|
| ① 配置模型 | 每 agent 的 provider 声明(含密钥**引用名**) | `ProviderConfig`(§3) |
| ② 密钥引用 | key 只存名字,真实值从 `KeyStore`(env / auth.json)解析 | `api_key_ref` + `KeyStore`(§2) |
| ③ 注入翻译 | 同一份 `ProviderConfig` → codex `-c`/env_key vs claude env/`--model`(两端不对称) | `toCodexInjection` / `toClaudeInjection`(§5、§6) |
| ④ 热切换 | 中转挂了不重启进程,下一轮换 provider 重建 adapter | `ProviderRegistry` + 热换流程(§8) |
| ⑤ Fusion panel | 一个角色背后站一个多 provider 评审团 + 裁判 | `PanelProviderConfig`(§10) |

### 0.2 本文件负责 / 不负责的边界

| 负责(本文件给完整类型 + 语义 + 流程) | 不负责(只引用,定义在别处) |
|---|---|
| `ProviderConfig`(每 agent 一份) | `Message`/`Evidence`/`AgentId` 枚举(02) |
| `ProviderOverrides`(运行期非密覆盖) | `AgentAdapter`/`AgentInput` 接口(05) |
| `KeyStore` 密钥解析(env / auth.json) | `buildChildEnv` env 白名单**规则实现**(08) |
| `api_key_ref` 引用模型 + 解析失败码 | codex argv 拼装 / `assertArgvNoSecret` / `SECRET_SIGNATURES`(08 §2.4 + 05 §6.4) |
| codex / claude 注入翻译**语义**(产出什么 `-c`/env) | claude stream-json 解析(06) |
| 中转热切换流程 + 健康探测 + failover | 引擎循环 / playbook(03) |
| 官方直连 provider 选项(出境合规开关) | redact 管道实现(08,本文件给需脱敏字段清单) |
| Fusion `PanelProviderConfig`(角色→panel) | panel 融合/裁判**算法**(Fusion 21;本文件给配置形状) |
| provider 相关错误码语义 | WS 传输(08) |

### 0.3 类型层不变量(实现必须保持)

- **P1 key 永不入配置值**:`ProviderConfig` 里**没有** `apiKey: string` 字段,只有 `apiKeyRef: string`(引用名)。grep `apiKey\s*:` 在 `@sylux/providers` 下应**零命中**真实密钥字段(红队 R8)。
- **P2 单一解析出口**:真实 key 只能由 `KeyStore.resolve(ref)` 取出,且其返回值只允许流向 `providerEnv`(喂 `buildChildEnv`),**绝不**进 argv、`-c`、日志、WS、jsonl(§2.3、§7、§9)。
- **P3 注入非密性**:`toCodexInjection` / `toClaudeInjection` 的**非密产物**(`-c` 项、`--model` 等)经设计保证不含 key;唯一含 key 的产物是 `providerEnv`,与非密产物物理分离(不同返回字段,§5.3)。
- **P4 热换不改进程**:provider 热切换通过**重建下一轮的 adapter**实现(05 工厂构造期注入 provider),不向运行中的子进程动态改 env;运行中进程沿用 spawn 时的 provider(事实 E:resume 继承首轮设定)。
- **P5 出境知情**:任何 `kind:'relay'`(第三方中转)provider 在配置校验期标记 `egressClass:'third_party'`,中枢启动横幅 + 面板必须显式提示「代码/上下文会发往 <base_url>」,并提供官方直连切换入口(§9.3)。
- **P6 配置即数据**:`ProviderConfig` 是纯可序列化对象(zod 可校验),热加载来自磁盘/面板;**不内嵌函数/闭包**,便于 jsonl 审计(脱敏后)与回放重建。
- **P7 路径配置半可信(V15)**:任何会落到子进程 env 的**路径型**配置(当前仅 `_codex_home`→`CODEX_HOME`)视为**半可信输入**(面板 reload 可写),必须过 `assertCodexHomeSafe`(绝对路径 + realpath 落在批准的 sylux 数据根内 + 不经 symlink 逃逸,§3.2.2)。校验不通过 = `PROVIDER_CONFIG_INVALID`,绝不下发。这把 V14「精确隔离」的优点补上它缺的安全闸(RS-M4)。
- **P8 panel 单轮成本有顶(V16)**:panel 决策回合在**启动前**做扇出感知前瞻(`estimatePanelFanout`),且每个成员有单 turn token 硬上限(`perMemberTokenCap`)。panel 永不出现「轮末才发现超支 N 倍」(RS-M5)。

---

## 1. 物理落点与依赖方向

### 1.1 包布局(`@sylux/providers`)

```
packages/providers/
├─ package.json            # name: "@sylux/providers";依赖 zod + @sylux/shared
├─ src/
│  ├─ index.ts             # 统一 re-export(§11)
│  ├─ provider.schema.ts   # ★ ProviderConfig / ProviderOverrides / wireApi 等 zod(唯一权威)
│  ├─ panel.schema.ts      # ★ PanelProviderConfig / JudgeConfig(Fusion,§10)
│  ├─ keystore.ts          # KeyStore 接口 + EnvKeyStore / AuthJsonKeyStore 实现(§2)
│  ├─ inject-codex.ts      # toCodexInjection:ProviderConfig → {cArgs, env}(§5)
│  ├─ inject-claude.ts     # toClaudeInjection:ProviderConfig → {flags, env}(§6)
│  ├─ registry.ts          # ProviderRegistry:多 provider 注册 + 热换 + failover(§8)
│  ├─ health.ts            # 健康探测(轻量 ping,§8.4)
│  ├─ presets.ts           # 官方直连预设(openai/anthropic 直连模板,§9)
│  └─ errors.ts            # provider 相关错误码(引用 02 全集,§12)
└─ ...
```

### 1.2 依赖方向(遵守 master §10:`shared ← {providers, agents} ← server ← web`)

```
@sylux/shared   (zod 类型 + 校验,最底层)
      ▲
      │ providers 依赖 shared(取 AgentId 枚举、SyluxError)
      │
@sylux/providers ──► 不依赖 @sylux/agents、@sylux/core(避免环)
      ▲
      │ agents 依赖 providers(05/06:createCodexAdapter({provider}))
      │
@sylux/agents    (适配层,消费 ProviderConfig)
```

- `@sylux/providers` **只**依赖 `zod` + `@sylux/shared`;**不**反向依赖 `agents`/`core`/`server`。05/06 的 `AgentAdapter` 工厂在构造期 `import type { ProviderConfig } from '@sylux/providers'`,单向。
- `KeyStore` 的具体实现(读 env / 读 `~/.codex/auth.json`)有 I/O,但接口在 providers,实现细节(文件路径解析)可注入,保持 providers 本身无重 I/O 依赖,便于测试桩。

## 2. 密钥引用模型 —— key 只存名字,真实值走 KeyStore(红队 R8 焊死)

### 2.1 为什么是「引用」而不是「值」

红队 R8 与事实地基:key **永不进 argv / `-c` 字面量 / 配置文件**。因此 `ProviderConfig` 里存的是 `apiKeyRef`(一个**引用名**,如 `MOUUBOX_KEY`),不是 sk- 真值。真实密钥只存在两处可信源:

| 来源 | 适用 | 读取方 |
|---|---|---|
| **进程环境变量** | 中枢启动前由用户/启动脚本设好(`SYLUX_KEY_MOUUBOX=sk-...`) | `EnvKeyStore` |
| **`auth.json`(codex 原生)** | codex 已有的 `~/.codex/auth.json`,复用其凭证 | `AuthJsonKeyStore` |

`apiKeyRef` 是**逻辑名**,经 `KeyStore` 映射到上述某个真实来源。这样:
- 配置文件(磁盘 / 面板传入)、jsonl 日志、WS 推送里**只出现引用名**,泄露了也不是密钥。
- 真实值在内存里只活在 `KeyStore.resolve()` 返回值 → `providerEnv` → `buildChildEnv` → 子进程 env 这一条窄通路(P2)。

### 2.2 KeyStore 接口与实现

```ts
import type { AgentId } from '@sylux/shared';

/** 密钥来源种类(决定 resolve 从哪取真值)。 */
export const keySourceSchema = z.enum([
  'env',        // 从进程环境变量取(变量名见 KeyRefBinding.envVar)
  'auth_json',  // 从 codex auth.json 取(复用 codex 原生凭证)
  'none',       // 无需 key(官方直连且走 OS keychain / 本地模型)
]);
export type KeySource = z.infer<typeof keySourceSchema>;

/** 一个 apiKeyRef 的解析绑定(配置层声明 ref → 来源,但绝不含真值)。 */
export const keyRefBindingSchema = z.object({
  ref: z.string().min(1),                 // 逻辑名,ProviderConfig.apiKeyRef 引用它
  source: keySourceSchema,
  /** source==='env' 时:真实 key 所在的环境变量名(非密,如 SYLUX_KEY_MOUUBOX) */
  envVar: z.string().min(1).optional(),
  /** source==='auth_json' 时:auth.json 内的字段路径(如 'OPENAI_API_KEY' / 'tokens.access') */
  authJsonField: z.string().min(1).optional(),
}).superRefine((b, ctx) => {
  if (b.source === 'env' && !b.envVar)
    ctx.addIssue({ code: 'custom', message: "source='env' 需 envVar" });
  if (b.source === 'auth_json' && !b.authJsonField)
    ctx.addIssue({ code: 'custom', message: "source='auth_json' 需 authJsonField" });
});
export type KeyRefBinding = z.infer<typeof keyRefBindingSchema>;

/** 密钥解析器。resolve 返回真实 key(仅允许流向 providerEnv,P2)。 */
export interface KeyStore {
  /** 解析引用名 → 真实 key。失败抛 PROVIDER_CONFIG_INVALID(不回显值)。 */
  resolve(ref: string): string | undefined;
  /** 该 ref 是否可解析(健康检查 / 启动预检用,不返回值,只 boolean)。 */
  has(ref: string): boolean;
  /** 列出所有已知 ref 名(非密,供面板下拉;绝不含值)。 */
  listRefs(): string[];
}
```

### 2.3 解析失败与安全处置

```ts
/** 标准实现:绑定表来自配置,真值来自 env / auth.json,内存不缓存明文超出必要范围。 */
export function createKeyStore(
  bindings: KeyRefBinding[],
  io: { readEnv(name: string): string | undefined; readAuthJson(field: string): string | undefined },
): KeyStore {
  const byRef = new Map(bindings.map((b) => [b.ref, b]));
  return {
    has(ref) {
      const b = byRef.get(ref);
      if (!b) return false;
      if (b.source === 'none') return true;
      if (b.source === 'env') return !!io.readEnv(b.envVar!);
      return !!io.readAuthJson(b.authJsonField!);
    },
    resolve(ref) {
      const b = byRef.get(ref);
      if (!b) throw new SyluxError('PROVIDER_CONFIG_INVALID', `未知 apiKeyRef: ${ref}`);
      if (b.source === 'none') return undefined;
      const val = b.source === 'env' ? io.readEnv(b.envVar!) : io.readAuthJson(b.authJsonField!);
      if (!val)
        // detail 绝不含值;只报 ref 名 + 来源,防日志泄密(09)
        throw new SyluxError('PROVIDER_CONFIG_INVALID',
          `apiKeyRef '${ref}' 解析为空(source=${b.source})`,
          { ref, source: b.source });
      return val;
    },
    listRefs: () => [...byRef.keys()],
  };
}
```

| 失败场景 | 错误码 | 处置 |
|---|---|---|
| `apiKeyRef` 不在绑定表 | `PROVIDER_CONFIG_INVALID` | 启动预检即炸,不 spawn |
| `source='env'` 但 env 变量空 | `PROVIDER_CONFIG_INVALID` | 同上;detail 只给 ref/envVar 名,不读值 |
| `auth.json` 字段缺失 | `PROVIDER_CONFIG_INVALID` | 同上 |
| resolve 返回值疑似被拼进 argv | `PROVIDER_CONFIG_INVALID` | 由 05 §6.4 `assertArgvNoSecret` 兜底(双保险) |

> **不变量复核**:`KeyStore.resolve` 的返回值在整个代码库的合法去向**只有一处**:组装 `AgentInput.providerEnv`(§7.2)。代码评审 grep `\.resolve(` 命中点必须全部流向 providerEnv 构造,不得 `console.log` / 写盘 / 拼字符串进 `-c`。

## 3. ProviderConfig —— 每 agent 一份的 provider 声明(本文件唯一权威)

### 3.1 schema

```ts
import { agentIdSchema } from '@sylux/shared'; // AgentId 枚举(02 权威)

/** CLI 后端种类:决定走 codex 还是 claude 的注入翻译(§5/§6 分流)。 */
export const agentKindSchema = z.enum(['codex', 'claude']);
export type AgentKind = z.infer<typeof agentKindSchema>;

/** wire 协议(codex 概念,claude 端忽略;见 §5.2 / §6.1)。 */
export const wireApiSchema = z.enum(['responses', 'chat']);
export type WireApi = z.infer<typeof wireApiSchema>;

/** 出境分级(P5:第三方中转必须知情 + 提供官方直连开关)。 */
export const egressClassSchema = z.enum([
  'official',     // 官方直连(api.openai.com / api.anthropic.com)
  'third_party',  // 第三方中转(代码/上下文出境到非官方端点,需横幅提示)
  'local',        // 本地 / 自托管(localhost / 内网,不出公网)
]);
export type EgressClass = z.infer<typeof egressClassSchema>;

/** 单个 provider 完整声明。绝无 apiKey 真值字段(P1),只引用 apiKeyRef。 */
export const providerConfigSchema = z.object({
  /** provider 唯一 id(注册表 key、热换目标、面板下拉值) */
  id: z.string().min(1),
  /** 人类可读名(面板展示) */
  label: z.string().min(1).optional(),
  /** 后端 CLI 种类:codex | claude(决定注入分流) */
  agentKind: agentKindSchema,
  /** 端点 base_url(codex: model_providers.<name>.base_url;claude: ANTHROPIC_BASE_URL) */
  baseUrl: z.string().url().optional(),       // 官方直连可省(用 CLI 默认端点)
  /** 模型名(codex: -m;claude: --model) */
  model: z.string().min(1),
  /** 备用模型(claude: --fallback-model;codex 无直接等价,失败走 registry failover) */
  fallbackModel: z.string().min(1).optional(),
  /** wire 协议(codex 用;claude 忽略,见 §6.1) */
  wireApi: wireApiSchema.default('responses'),
  /** ★ 密钥引用名(只名字,真值经 KeyStore.resolve,P1/P2) */
  apiKeyRef: z.string().min(1),
  /**
   * codex 端 provider 名(写进 -c model_provider=<name> 与 model_providers.<name>.*)。
   * 默认 'custom'(本机 config.toml 现状,事实/setup 笔记)。claude 端忽略。
   */
  codexProviderName: z.string().min(1).default('custom'),
  /**
   * 出境分级(P5;**不设静态 default**,缺省时由加载层 normalizeEgressClass 据 baseUrl 推断,§9.2)。
   * v2(V5):v1 的 .default('third_party') 会抹掉推断、把官方直连误标第三方,已移除。
   * 显式值仅允许「收紧」(third_party 永远生效),不允许把明显第三方 host 标 official(§9.2 告警)。
   */
  egressClass: egressClassSchema.optional(),
  /**
   * 非密的额外 -c 覆盖(codex)/ settings 片段(claude)。
   * v2(V7)双重闸:① key 必须匹配 SAFE_EXTRA_KEY_RE 且不在 EXTRA_CONFIG_DENY(不得覆盖
   *   api_key/env_key/model_provider*/base_url/sandbox* 等密钥/出境/沙箱关键键);
   * ② 值禁含控制字符/换行(防断 argv)。违规在校验期抛 PROVIDER_CONFIG_INVALID(§3.4)。
   * 此外仍过 05 §6.4 / 06 §A4 argvGuard(疑似 key 兜底)。这里只放 reasoning effort、超时等非密项。
   */
  extraConfig: z.record(z.string(), z.string()).default({}),
  /** 请求超时(ms),health 探测与 send 共用上限 */
  timeoutMs: z.number().int().positive().default(120_000),
}).superRefine((c, ctx) => {
  // third_party / official 通常需要 key;local 可 none(§2)。egressClass 缺省时按 baseUrl 视为非 local(保守)
  const eff = c.egressClass ?? inferEgressClass(c.baseUrl);
  if (eff !== 'local' && !c.apiKeyRef)
    ctx.addIssue({ code: 'custom', message: 'non-local provider 需 apiKeyRef' });
  // V7:extraConfig key 白名单 + 关键键黑名单 + 值禁控制字符(§3.4)
  for (const [k, v] of Object.entries(c.extraConfig ?? {})) {
    if (!SAFE_EXTRA_KEY_RE.test(k) || EXTRA_CONFIG_DENY.some((d) => k === d || k.startsWith(d)))
      ctx.addIssue({ code: 'custom', message: `extraConfig key 非法或受保护: ${k}` });
    if (/[\x00-\x1f]/.test(v))
      ctx.addIssue({ code: 'custom', message: `extraConfig['${k}'] 值含控制字符(防断 argv)` });
  }
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
```

### 3.2 字段语义表

| 字段 | 类型 | 必填 | codex 落点 | claude 落点 | 语义 |
|---|---|---|---|---|---|
| `id` | string | 是 | — | — | 注册表 key / 热换目标 |
| `agentKind` | `codex\|claude` | 是 | — | — | 注入翻译分流 |
| `baseUrl` | url? | 否 | `-c model_providers.<n>.base_url` | `ANTHROPIC_BASE_URL` env | 端点;官方直连可省 |
| `model` | string | 是 | `-m <model>` | `--model <model>` | 模型名 |
| `fallbackModel` | string? | 否 | (registry failover) | `--fallback-model` | 备用模型 |
| `wireApi` | `responses\|chat` | 默认 responses | `-c model_providers.<n>.wire_api` | 忽略 | 协议线型 |
| `apiKeyRef` | string | 是* | → env_key 指向的 env(§5.2) | → `ANTHROPIC_API_KEY` env(§6.2) | **引用名,非真值** |
| `codexProviderName` | string | 默认 custom | `-c model_provider=<n>` | 忽略 | codex provider 段名 |
| `egressClass` | enum? | 缺省→推断 | — | — | 出境知情(P5;无静态 default,§9.2 推断) |
| `extraConfig` | record | 默认 {} | 追加 `-c k=v`(key 过白名单/黑名单) | deep-merge 进 settingsFragment(§6.3) | 非密额外项(V7 校验) |
| `timeoutMs` | int | 默认 120k | — | — | 请求/探测超时;→ 适配器 `hardTimeoutCeilingMs` 默认(V13) |

\* `apiKeyRef` 对 `egressClass==='local'`(且绑定 `source:'none'`)可省语义上的真实 key;schema 仍要求字段非空(指向一条 `none` 绑定)。

### 3.2.1 extraConfig 硬化常量(V7;`provider.schema.ts` 内联)

```ts
/** extraConfig key 合法字符:点分小写标识(codex -c 路径 / claude settings 键),禁空格/引号/等号。 */
export const SAFE_EXTRA_KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/**
 * 受保护键前缀:extraConfig 绝不允许覆盖这些(否则可绕开密钥/出境/沙箱管控)。
 * 命中即 PROVIDER_CONFIG_INVALID(§3.1 superRefine)。
 */
export const EXTRA_CONFIG_DENY: readonly string[] = [
  'model_provider',                       // 段名/路由(覆盖会改 base_url 解析)
  'model_providers',                      // 含 .base_url / .env_key / .api_key(密钥/出境)
  'sandbox', 'sandbox_mode', 'approval',  // 沙箱/审批(自动化封顶归 08 §6,不许放宽)
  'cwd', 'codex_home',                    // 工作目录/凭证目录(worktree 隔离 09 / §8.4)
];
```

> **为什么白名单 key 而非只扫 value**:R8 的 argvGuard(05 §6.4)只拦**值**里的 sk-/base64;但 `extraConfig` 的**键**若是 `model_providers.<n>.api_key` 则键本身就是攻击面(值可能是合法 ref 名但语义上把 key 写进 config)。V7 在键层 default-deny,堵死「用 extraConfig 改 env_key 指向攻击者控制的变量」「把 sandbox 放宽到 danger-full-access」等绕过。`extraConfig` 只配 reasoning effort、请求超时、`model_reasoning_effort` 这类纯调参项。

### 3.2.2 `_codex_home` 路径安全校验(V15 / RS-M4;`provider.schema.ts` + 加载层)

V14 让 `_codex_home`(内部键)经 `providerEnv` 注入 `CODEX_HOME`,实现「每 provider 凭证目录隔离」。但 `CODEX_HOME` 决定 codex 读哪个 `auth.json`——**这是凭证目录**。`SAFE_EXTRA_KEY_RE` 允许下划线开头(`_codex_home` 畅通),`EXTRA_CONFIG_DENY` 只拦无下划线的 `codex_home`,故 v1/v2 早期 `_codex_home` 的**值**未经任何路径校验。能写 provider 配置者(本地配置文件,或经面板 reload §8.6)可把某 provider 的 `CODEX_HOME` 指向**任意目录**:① 指向攻击者预置的 `auth.json` → codex 用攻击者凭证 / 把请求发往攻击者控制端点;② 指向敏感目录诱导 codex 读写。V15 给它配安全闸:

```ts
/**
 * codex 数据根:所有 provider 的隔离 CODEX_HOME 必须落在此目录下。
 * 由中枢启动配置给出(用户批准的 sylux 数据目录,如 <userData>/sylux/codex-home),
 * 不写死;此处只示意约定。realpath 解析复用 08 §4.4 的 isPathSafe 原语。
 */
export interface CodexHomePolicy {
  /** 批准的根(绝对路径,已 realpath)。CODEX_HOME 必须是它或其子目录。 */
  approvedRoot: string;
  /** 复用 08 §4.4:路径在 approvedRoot 内 + realpath 不逃逸 + 不经 symlink 指向外部。 */
  isPathSafe(candidate: string, root: string): boolean;
  /** 解析为绝对真实路径(realpath);不存在时按父目录链判定(08 §4.4 同义)。 */
  realpath(p: string): string;
}

/**
 * 校验 _codex_home 值安全(V15 / RS-M4)。失败抛 PROVIDER_CONFIG_INVALID(detail 只给路径,非密)。
 * 调用点:① 启动加载(§8.6);② 面板 reload superRefine 之外(zod 校不了文件系统,§8.6);
 *        ③ toCodexInjection 兜底再做一次廉价的「绝对路径 + 非空」断言(§5.2)。
 */
export function assertCodexHomeSafe(value: string, policy: CodexHomePolicy): void {
  if (!value || typeof value !== 'string')
    throw new SyluxError('PROVIDER_CONFIG_INVALID', '_codex_home 为空');
  // ① 必须绝对路径(相对路径解析依赖 cwd,不可控)
  if (!isAbsolutePath(value))   // win32: 盘符或 UNC;posix: 以 / 开头
    throw new SyluxError('PROVIDER_CONFIG_INVALID', `_codex_home 必须是绝对路径: ${value}`);
  // ② 禁控制字符 / null(防断 env / 注入),与 §3.4 值校验同源
  if (/[\x00-\x1f]/.test(value))
    throw new SyluxError('PROVIDER_CONFIG_INVALID', '_codex_home 含控制字符');
  // ③ realpath 后必须落在批准根内 + 不经 symlink 逃逸(复用 08 §4.4 isPathSafe)
  const real = policy.realpath(value);
  if (!policy.isPathSafe(real, policy.approvedRoot))
    throw new SyluxError('PROVIDER_CONFIG_INVALID',
      `_codex_home 逃逸出批准的 codex 数据根: ${value}`, { codexHome: value, root: policy.approvedRoot });
}
```

| 攻击/失败 | 校验项 | 处置 |
|---|---|---|
| `_codex_home: '../../attacker'`(相对逃逸) | ① 非绝对路径 | `PROVIDER_CONFIG_INVALID`,启动/ reload 即拒 |
| `_codex_home: 'C:\\Users\\victim\\.codex'`(指向他人凭证) | ③ 不在 approvedRoot 内 | 同上 |
| `_codex_home` 是 symlink → 外部目录 | ③ realpath 逃逸 | 同上(复用 08 §4.4 symlink 解析) |
| 面板 reload 携带恶意 `_codex_home` | §8.6 zod 后置校验 | reload 整体拒,保留旧配置(失败安全) |

> **职责切分**:`isPathSafe` / realpath / symlink 解析的**实现**归安全 **08 §4.4**(已有原语,worktree 09 也复用);本文件只拥有「`_codex_home` 是凭证路径、必须落批准根、何时校验」的语义,经 `CodexHomePolicy` 注入 08 的能力,不重写路径算法。`approvedRoot` 的具体值由中枢启动配置(16)给定,本文件不写死。**注意**:`assertCodexHomeSafe` 需要文件系统访问(realpath),故**不在 zod superRefine 内**(schema 必须纯函数);它在加载层 / reload 后置跑(§8.6),`toCodexInjection` 内只做不碰文件系统的廉价兜底(绝对路径 + 非空 + 无控制字符)。

### 3.3 每 agent 一份 + 一个 agent 多候选(热换 / failover)

锁定决策「每 agent 一份」= 运行期**每个物理 agent 槽位(codex/claude)绑定一个 active `ProviderConfig`**;但注册表为每个槽位可存**多个候选**,热换/failover 在候选间切:

```ts
/** 一个 agent 槽位的 provider 集合:active + 候选池(热换/failover 用)。 */
export const agentProviderSlotSchema = z.object({
  /** 物理 agent 身份(02 AgentId;此处仅 codex|claude 两个可执行槽) */
  agent: agentIdSchema,                        // 实际取值 'codex' | 'claude'
  /** 当前激活的 provider id(必须在 candidates 内) */
  activeId: z.string().min(1),
  /** 候选 provider 列表(热换/failover 目标;按优先级排序) */
  candidates: z.array(providerConfigSchema).min(1),
}).superRefine((s, ctx) => {
  // V12:agent 槽只接受可执行体(codex/claude),拒 human/orchestrator(它们不 spawn CLI)
  if (s.agent !== 'codex' && s.agent !== 'claude')
    ctx.addIssue({ code: 'custom', message: `agent 槽只允许 'codex'|'claude',收到 '${s.agent}'` });
  if (!s.candidates.some((c) => c.id === s.activeId))
    ctx.addIssue({ code: 'custom', message: `activeId '${s.activeId}' 不在 candidates 内` });
  // 同槽候选 agentKind 必须一致(codex 槽不能塞 claude provider)
  const kinds = new Set(s.candidates.map((c) => c.agentKind));
  if (kinds.size > 1)
    ctx.addIssue({ code: 'custom', message: '同 agent 槽候选 agentKind 必须一致' });
  // 候选 id 在槽内唯一(failover 按 id 索引,重复 id 致歧义)
  const ids = s.candidates.map((c) => c.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', message: '同槽 candidates.id 必须唯一' });
  // agent 槽种类应与候选 agentKind 对齐(codex 槽配 codex provider)
  if (kinds.size === 1 && [...kinds][0] !== s.agent)
    ctx.addIssue({ code: 'custom', message: `agent='${s.agent}' 与候选 agentKind='${[...kinds][0]}' 不符` });
});
export type AgentProviderSlot = z.infer<typeof agentProviderSlotSchema>;

/** 全局 provider 配置根(磁盘 / 面板热加载的顶层对象)。 */
export const providerSettingsSchema = z.object({
  /** 密钥引用绑定表(§2;名字→来源,无真值) */
  keyBindings: z.array(keyRefBindingSchema).default([]),
  /** 各 agent 槽的 provider 配置 */
  slots: z.array(agentProviderSlotSchema).min(1),
  /** 可选:Fusion panel 配置(§10),按角色覆盖单 agent */
  panels: z.array(z.lazy(() => panelProviderConfigSchema)).default([]),
}).superRefine((s, ctx) => {
  // 所有 ProviderConfig.apiKeyRef 必须在 keyBindings 里有绑定(启动预检,§2.3)
  const refs = new Set(s.keyBindings.map((b) => b.ref));
  const allProviderIds = new Set<string>();
  for (const slot of s.slots)
    for (const c of slot.candidates) {
      allProviderIds.add(c.id);
      if (!refs.has(c.apiKeyRef))
        ctx.addIssue({ code: 'custom', message: `provider '${c.id}' 的 apiKeyRef '${c.apiKeyRef}' 无绑定` });
    }
  // 全局 provider id 唯一(跨槽也不重;热换/panel 按 id 全局索引)
  const seen = new Set<string>();
  for (const slot of s.slots)
    for (const c of slot.candidates) {
      if (seen.has(c.id))
        ctx.addIssue({ code: 'custom', message: `provider id '${c.id}' 跨槽重复` });
      seen.add(c.id);
    }
  // V9:panel 成员 / 裁判引用的 providerId 必须是某 slot 候选里真实存在的 id
  for (const p of s.panels ?? []) {
    for (const m of p.members)
      if (!allProviderIds.has(m.providerId))
        ctx.addIssue({ code: 'custom', message: `panel '${p.id}' 成员 providerId '${m.providerId}' 不存在于任何 slot 候选` });
    if (!allProviderIds.has(p.judge.providerId))
      ctx.addIssue({ code: 'custom', message: `panel '${p.id}' judge providerId '${p.judge.providerId}' 不存在` });
  }
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
```

## 4. ProviderOverrides —— 运行期非密覆盖(05 引用本节为权威)

适配层 05 §3 的 `AgentInput.providerOverrides` 与 `ProviderOverrides` 接口在 05 里**前向声明**为「值绝不含 key,完整定义在 provider 文档」。本节即权威定义。它是 `ProviderConfig` 投影出的**纯非密子集**,用于:① 引擎在 send 时传入(虽 provider 主要在 adapter 构造期绑定,P4);② 单轮临时覆盖(如某轮换 effort)。

```ts
/** 运行期非密覆盖。与 05 §3 的同名接口逐字段兼容;值绝不含 key(P3、A4)。 */
export const providerOverridesSchema = z.object({
  baseUrl: z.string().url().optional(),
  /** codex provider 段名(-c model_provider=<name>) */
  providerName: z.string().min(1).optional(),
  wireApi: wireApiSchema.optional(),
  model: z.string().min(1).optional(),
  /** 非密额外 -c / settings 片段(同 ProviderConfig.extraConfig) */
  extraConfig: z.record(z.string(), z.string()).optional(),
});
export type ProviderOverrides = z.infer<typeof providerOverridesSchema>;
```

> **与 05 的对账**:05 §3 列的 `ProviderOverrides` 含 `baseUrl` / `wireApi` / `model`(经 `pushProviderConfig` 注 `-c`/`-m`) / `providerName`。本节是其超集补 `extraConfig`(非密)。05 的 `mergeProviderOverrides(provider, input.providerOverrides)` 语义:**input 覆盖 provider 默认**,产出最终注入用 overrides。本节定义该 merge:

```ts
/** ProviderConfig + 单轮 overrides → 最终非密注入参数(key 不在内,P3)。 */
export function mergeProviderOverrides(
  base: ProviderConfig,
  ov?: ProviderOverrides,
): Required<Pick<ProviderOverrides, 'model'>> & ProviderOverrides {
  return {
    baseUrl: ov?.baseUrl ?? base.baseUrl,
    providerName: ov?.providerName ?? base.codexProviderName,
    wireApi: ov?.wireApi ?? base.wireApi,
    model: ov?.model ?? base.model,                 // model 必有(base 强制)
    extraConfig: { ...base.extraConfig, ...(ov?.extraConfig ?? {}) },
  };
}
```

> **不变量**:`ProviderOverrides` 结构上**无 `apiKeyRef` / `apiKey`** 字段——key 不走 overrides 这条路,只走 `providerEnv`(§7)。这从类型层焊死「单轮覆盖也碰不到 key」(P3)。

## 5. codex 注入翻译(`toCodexInjection`) —— key 走 env_key,绝不进 argv

### 5.1 codex 的 key 通路(事实 + 红队 R8 焊死)

codex `-c` 可覆盖任意 config(事实/setup 笔记),但**绝不能**写 `-c model_providers.<n>.api_key=sk-...`(key 进 argv = R8 违规)。codex 原生支持「key 走环境变量」:`model_providers.<n>.env_key=<ENV_VAR_NAME>` 让 codex 自己去**环境变量**里取 key,argv 里出现的只是**变量名**(非密)。

因此翻译产出**两份物理分离的东西**(P3):

| 产物 | 内容 | 含 key? | 去向 |
|---|---|---|---|
| `cArgs` | `-c model_provider=...` / `-c model_providers.<n>.base_url=...` / `-c model_providers.<n>.env_key=<VAR>` / `-m <model>` | **否** | 拼进 argv(05 §6.3 `pushProviderConfig`) |
| `env` | `{ <VAR>: <真实key> }` | **是** | 喂 `buildChildEnv` → 子进程 env(§7) |

`<VAR>` 是中枢约定的统一密钥环境变量名(如 `SYLUX_PROVIDER_KEY_CODEX`),codex 据 `env_key` 去该变量取值。真实 sk- 只在 `env` 字段,从不在 `cArgs`。

### 5.2 toCodexInjection 实现

```ts
/** codex 注入产物:非密 -c/-m(进 argv)与含 key 的 env(进 buildChildEnv),物理分离(P3)。 */
export interface CodexInjection {
  /** 非密 -c / -m 参数数组(直接 concat 进 argv;保证无 key)。 */
  cArgs: string[];
  /** 含真实 key 的 env(只此一处含 key;喂 buildChildEnv,§7)。 */
  env: Record<string, string>;
  /** codex 据此去 env 取 key 的变量名(非密;写进 env_key 的 -c) */
  keyEnvVar: string;
}

/** 统一密钥环境变量名约定(中枢侧固定;codex env_key 指向它)。 */
export const CODEX_KEY_ENV_VAR = 'SYLUX_PROVIDER_KEY_CODEX' as const;

/**
 * V3 权威签名:`(cfg, keystore, ov?)`。merge 在函数内部做(不要求调用方先 mergeProviderOverrides)。
 * 这与 05 §8.2 v2 的 `toCodexInjection(merged)` 单参写法**不一致**——以本签名为准,05 需回填:
 *   adapter 不再自己 `mergeProviderOverrides` 后传 merged,而是 `toCodexInjection(this.provider, this.keystore, input.providerOverrides)`。
 *   keystore 经 `createCodexAdapter({ provider, keystore })` 构造期注入(§8.4 / 回填 05 §8.2)。
 */
export function toCodexInjection(
  cfg: ProviderConfig,
  keystore: KeyStore,
  ov?: ProviderOverrides,
): CodexInjection {
  if (cfg.agentKind !== 'codex')
    throw new SyluxError('PROVIDER_CONFIG_INVALID', `toCodexInjection 收到非 codex provider: ${cfg.id}`);
  const m = mergeProviderOverrides(cfg, ov);
  const name = m.providerName ?? 'custom';
  const cArgs: string[] = [];

  // ① provider 段名
  cArgs.push('-c', `model_provider=${name}`);
  // ② base_url(中转/官方;official 直连可省→用 codex 默认)
  if (m.baseUrl) cArgs.push('-c', `model_providers.${name}.base_url=${m.baseUrl}`);
  // ③ wire_api(responses | chat)
  if (m.wireApi) cArgs.push('-c', `model_providers.${name}.wire_api=${m.wireApi}`);
  // ④ ★ key 走 env_key:argv 里只出现变量名(非密),真实 key 在 env(R8/P3)
  cArgs.push('-c', `model_providers.${name}.env_key=${CODEX_KEY_ENV_VAR}`);
  // ⑤ 模型
  cArgs.push('-m', m.model);
  // ⑥ 非密 extraConfig(已过 §3.4 key 白名单/黑名单;argvGuard 再兜底拦截疑似 key,05 §6.4)
  //    注意:下划线前缀的内部键(_codex_home 等)在此被跳过,不下发 -c(它非合法 config 路径)
  for (const [k, v] of Object.entries(m.extraConfig ?? {})) {
    if (k.startsWith('_')) continue;
    cArgs.push('-c', `${k}=${v}`);
  }

  // env:含 key(唯一出口,P2)+ 可选 CODEX_HOME(非密路径,V14:走 providerEnv 免改 08 白名单)
  const env: Record<string, string> = {};
  // V14/V15:若 provider 走 auth_json 且需隔离凭证目录,把 CODEX_HOME 放进 providerEnv。
  //   值此前已在加载层 / reload 经 assertCodexHomeSafe 全量校验(§3.2.2);此处只做不碰 FS 的廉价兜底
  //   (绝对路径 + 非空 + 无控制字符),防「配置绕过加载层直达注入」的边角。realpath 校验不在热路径重复跑。
  const codexHome = cfg.extraConfig?.['_codex_home'];   // 约定:下划线前缀的内部键,翻译期消费不下发 -c
  if (codexHome) {
    if (!isAbsolutePath(codexHome) || /[\x00-\x1f]/.test(codexHome))
      throw new SyluxError('PROVIDER_CONFIG_INVALID', `_codex_home 未过安全校验(应在加载层先 assertCodexHomeSafe): ${codexHome}`);
    env.CODEX_HOME = codexHome;
  }
  if (cfg.egressClass !== 'local' || keystore.has(cfg.apiKeyRef)) {
    const key = keystore.resolve(cfg.apiKeyRef);     // 失败抛 PROVIDER_CONFIG_INVALID(§2.3)
    if (key) env[CODEX_KEY_ENV_VAR] = key;
  }
  return { cArgs, env, keyEnvVar: CODEX_KEY_ENV_VAR };
}
```

> **`_codex_home` 内部键约定(V14)**:`extraConfig` 里下划线前缀的键(如 `_codex_home`)是**中枢内部消费**的元数据,翻译期被读走、**不**作为 `-c` 下发给 codex(它不是合法 config 路径)。`§3.4` 的 `SAFE_EXTRA_KEY_RE` 允许下划线开头,但 `EXTRA_CONFIG_DENY` 含 `codex_home`(无下划线的那个才是要拦的 `-c` 注入);内部键 `_codex_home` 不与之冲突。`CODEX_HOME` 是目录路径、非 secret,经 `providerEnv` 注入即可,**无需**改 08 `BASE_ENV_ALLOWLIST`(否则会把所有子进程的 `CODEX_HOME` 都从 `process.env` 带出,反而是泄漏面)。

### 5.3 与 05 适配层的衔接(V3 对账,需 05 回填)

- **签名统一(V3)**:本文件 `toCodexInjection(cfg, keystore, ov?)` 是权威。05 §8.2 v2 现写 `const merged = mergeProviderOverrides(...); toCodexInjection(merged)`——**两处都得改**:① 不传 `merged`(它不是完整 `ProviderConfig`,缺 `agentKind`/`apiKeyRef`/`egressClass`,过不了本函数的类型守卫,且无从解析 key);② 改为 `toCodexInjection(this.provider, this.keystore, input.providerOverrides)`,merge 在本函数内部做。05 的 `mergeProviderOverrides` 单独调用可删(本函数已内置)。
- **keystore 注入(V3)**:适配器要能解析 key,故 `createCodexAdapter` 构造期必须收 `keystore`(§8.4)。05 §8.2 工厂签名回填 `createCodexAdapter({ provider, keystore, ... })`。
- 05 §6.3 `pushProviderConfig(args, cArgs)`(v2 已是薄包装,接收算好的 `cArgs`)→ 与本节产物对接,语义一致,无需再改。
- 05 §6.4 `assertArgvNoSecret(argv)`:本函数产出的 `cArgs` 设计上无 key,但仍**必须**过 argvGuard(双保险,R8;签名集权威在 08 §2.4)。`env` 字段不过 argvGuard(它本就该含 key)。
- 05 §8.3 `buildChildEnv`:**单对象签名 `buildChildEnv({ providerEnv, agentId })`**(08 §2.2 权威;V2 修正 v1 的 `buildChildEnv(provider, providerEnv)` 双位参)。`providerEnv` = 本函数 `env` 字段 ∪ `input.providerEnv`(§7.2 组装)。

### 5.4 resume 注入(事实 E:参数集不同)

事实 E:`codex exec resume` 拒 `-s`/`-C`,需 `--skip-git-repo-check`,但 **`-c`/`-m` 仍接受**。因此 `cArgs`(纯 `-c`/`-m`)在 resume 时**原样可用**——provider 注入与 exec 一致,沙箱/cwd 在首轮 exec 定好(事实 E:resume 继承)。这印证 P4:热换=重建 adapter(新首轮 exec),不是改运行中 session 的 provider。05 §6.2 `buildResumeArgs(..., cArgs)`(v2 接收算好的 `cArgs`)衔接同 §5.3。**注意**:跨 provider 热换后 resume 无意义(旧 thread_id 属旧端点),引擎据 `ProviderSwitchEvent` 标 `resumable=false`(§8.3)。

## 6. claude 注入翻译(`toClaudeInjection`) —— provider 走 env,model 走 flag

### 6.1 claude 与 codex 的不对称(事实 F / 06)

claude-code **没有** codex 的 `-c model_providers.*` 机制。它的 provider 切换走**环境变量**:

| 维度 | codex | claude |
|---|---|---|
| base_url | `-c model_providers.<n>.base_url=` | `ANTHROPIC_BASE_URL` env |
| api key | `env_key` → env 变量 | `ANTHROPIC_API_KEY` env(直接) |
| model | `-m <model>` | `--model <model>` flag |
| fallback | (registry failover) | `--fallback-model <model>` flag |
| wire_api | `-c ...wire_api=` | **无此概念**(claude 协议固定),忽略 |
| 额外非密 | `-c k=v` | `--settings '<json>'`(内联 JSON)/ `--append-system-prompt` |

claude 端 key 通路更直接:`ANTHROPIC_API_KEY` 本就是 env 变量,**天然不进 argv**(R8 自动满足);base_url 同理走 `ANTHROPIC_BASE_URL`。因此 claude 的 `env` 字段含两项(key + base_url),`flags` 全非密。

### 6.2 toClaudeInjection 实现

```ts
/** claude 注入产物:非密 flags + settingsFragment(进 argv 前由 06 与 hooks 合并)与含 key 的 env。 */
export interface ClaudeInjection {
  /** 非密命令行 flags(--model / --fallback-model;**不含** --settings,V4)。 */
  flags: string[];
  /** 非密 settings 片段(纯对象);由 06 与 hooks-disable 片段 deep-merge 后单次 --settings 注入(V4)。 */
  settingsFragment: Record<string, unknown>;
  /** 含 key + base_url 的 env(喂 buildChildEnv,§7)。 */
  env: Record<string, string>;
}

export function toClaudeInjection(
  cfg: ProviderConfig,
  keystore: KeyStore,
  ov?: ProviderOverrides,
): ClaudeInjection {
  if (cfg.agentKind !== 'claude')
    throw new SyluxError('PROVIDER_CONFIG_INVALID', `toClaudeInjection 收到非 claude provider: ${cfg.id}`);
  const m = mergeProviderOverrides(cfg, ov);
  const flags: string[] = [];

  // ① 模型 / 备用模型(非密 flag)
  flags.push('--model', m.model);
  if (cfg.fallbackModel) flags.push('--fallback-model', cfg.fallbackModel);
  // ② ★V4:不再直出 --settings(会与 06 §3.1 的 hooks-disable --settings 互相覆盖)。
  //    改产 settingsFragment(纯对象),由 06 与它的 {hooks:{},disableAllHooks:true} deep-merge 后【单次】注入。
  const settingsFragment: Record<string, unknown> =
    m.extraConfig && Object.keys(m.extraConfig).length > 0 ? { ...m.extraConfig } : {};

  // env:base_url(非密但放 env)+ key(密,唯一出口)
  const env: Record<string, string> = {};
  if (m.baseUrl) env.ANTHROPIC_BASE_URL = m.baseUrl;       // 官方直连省略→用 claude 默认端点
  if (cfg.egressClass !== 'local' || keystore.has(cfg.apiKeyRef)) {
    const key = keystore.resolve(cfg.apiKeyRef);           // 失败抛(§2.3)
    if (key) env.ANTHROPIC_API_KEY = key;                  // claude 标准变量名(事实 F / 06 A4)
  }
  return { flags, settingsFragment, env };
}
```

> **`ClaudeInjection` 类型增 `settingsFragment`(V4)**:接口改为 `{ flags: string[]; settingsFragment: Record<string, unknown>; env: Record<string, string> }`。`flags` 里**不再含** `--settings`——`--settings` 的最终拼装权属 06:06 把本函数的 `settingsFragment` 与它自己的 hooks-disable 片段(`{hooks:{},disableAllHooks:true}`,06 §3.1 / CA11)做 deep-merge,**只输出一个** `--settings <json>`。这消除 v1 的「两个 `--settings` 后者覆盖前者」bug(provider 的 effort 配置会被 hooks 配置整体覆盖,反之亦然)。

### 6.3 claude 端注意点(对账 06)

- **签名统一(V3)**:`toClaudeInjection(cfg, keystore, ov?)` 与 codex 端同序。`createClaudeAdapter` 构造期收 `keystore`(回填 06 §9 工厂签名)。
- **`--settings` 体积/转义 + 单次拼装(V4)**:Windows 命令行约 32KB 上限 + 转义风险(事实 F)。06 合并 `settingsFragment` + hooks 片段后**单次** `--settings`;`extraConfig` 应保持小(reasoning effort、超时等),不塞大对象;超限走 06 的降级路径(§6 / CA11)。【待实测】`--settings` 是否收文件路径变体(超限降级)。
- **`wireApi` 忽略不报错**:claude provider 的 `wireApi` 字段保留(schema 统一),翻译时**静默丢弃**,不视为配置错误(便于同一 `ProviderConfig` schema 跨两端)。
- **key 名固定**:claude 认 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`(事实 F)。这两个变量名由本函数固定写入 `env`,与 codex 的 `CODEX_KEY_ENV_VAR` 是**不同变量名**——`buildChildEnv` 的白名单(08 §2.2)必须同时放行 provider key 变量(经 `providerEnv` 注入,不在 base 白名单里;见 §7.1)。
- **官方直连**:`baseUrl` 省略 → 不写 `ANTHROPIC_BASE_URL` → claude 走官方 `api.anthropic.com`(§9)。

## 7. env 单一出口(`buildChildEnv`) —— 白名单 + extendEnv:false(规则属 08,本节给消费形状)

### 7.1 职责切分(本文件 vs 安全 08)

`buildChildEnv` 的**白名单规则实现 + 单对象签名**归安全 **08 §2.2**(`BuildChildEnvInput`)。本文件拥有它**消费的输入形状**与**必须经 `providerEnv` 注入的 provider 相关变量清单**:

```ts
/** 08 §2.2 权威签名(单对象,V2 修正 v1 的双位参)。本文件按此调用,不另定义。 */
declare function buildChildEnv(input: {
  providerEnv: Record<string, string>;   // 即 toCodex/ClaudeInjection 的 env 字段(§7.2);含 key + 可选 CODEX_HOME/ANTHROPIC_BASE_URL
  agentId: AgentId;                       // 'codex' | 'claude'(决定日志归属;08 自检用)
}): Record<string, string>;
```

`buildChildEnv` 内部 `extendEnv:false`(绝不 `{...process.env}`,08 S2 / R8),env 分两类:

| 类别 | 变量 | 注入路径 |
|---|---|---|
| 基础运行(08 `BASE_ENV_ALLOWLIST`) | `PATH` / `SystemRoot` / `windir` / `TEMP` / `USERPROFILE` / locale 等 | 08 default-deny 白名单从 `process.env` 挑取 |
| codex provider key | `SYLUX_PROVIDER_KEY_CODEX`(=`CODEX_KEY_ENV_VAR`) | `toCodexInjection().env` → `providerEnv` |
| claude provider | `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | `toClaudeInjection().env` → `providerEnv` |
| codex 凭证隔离(可选,V14) | `CODEX_HOME`(指向隔离 auth.json 目录,§8.4) | **`providerEnv`**(非 base 白名单!路径非 secret,过 08 §2.2 自检) |

> **V14 焊死**:`CODEX_HOME` **不**进 08 `BASE_ENV_ALLOWLIST`。若进白名单,会把中枢自己 `process.env.CODEX_HOME` 无差别带给每个子进程(串号 + 泄漏面)。改由 `toCodexInjection` 按 provider 显式放进 `providerEnv`,**每 provider 各自指定**,精确隔离。08 §2.2 的自检(base 白名单里疑似 secret 即炸)对 `CODEX_HOME` 这种路径值放行(它不匹配 `isSecretLike`)。
>
> **不变量 P2 复核**:`providerEnv` 是含 key 的**唯一**入口,且 key 只能由 `toCodexInjection`/`toClaudeInjection` 的 `env` 字段产出(它们内部唯一调用 `keystore.resolve`)。任何其他路径往 `providerEnv` 塞 key = 评审 block(08 S1)。

### 7.2 端到端组装(provider → AgentInput.providerEnv → spawn)

把 §5/§6 注入产物组装成 05 的 `AgentInput`(`providerEnv` + `providerOverrides` 两字段,05 §3):

```ts
/** 中枢/引擎构造 send 入参:provider 注入分解到 AgentInput 的非密(overrides/flags)+ 密(providerEnv)两槽。 */
export function buildAgentProviderInput(
  cfg: ProviderConfig,
  keystore: KeyStore,
  ov?: ProviderOverrides,
): { providerEnv: Record<string, string>; cliArgs: string[]; settingsFragment?: Record<string, unknown> } {
  if (cfg.agentKind === 'codex') {
    const inj = toCodexInjection(cfg, keystore, ov);
    return { providerEnv: inj.env, cliArgs: inj.cArgs };   // cArgs 仍过 05 §6.4 argvGuard
  } else {
    const inj = toClaudeInjection(cfg, keystore, ov);
    // V4:settingsFragment 单独回传,由 06 与 hooks 片段 deep-merge;flags 不含 --settings
    return { providerEnv: inj.env, cliArgs: inj.flags, settingsFragment: inj.settingsFragment };
  }
}
```

调用链(对账 05 §8.2;V2/V3 签名):
```
ProviderConfig + KeyStore + ov?
   └─► buildAgentProviderInput
          ├─ cliArgs ────────► 拼进 argv ──► assertArgvNoSecret(05§6.4,08§2.4 签名集) ──► spawn args
          ├─ settingsFragment ► (claude only)06 与 hooks deep-merge ──► 单次 --settings(V4)
          └─ providerEnv ─────► buildChildEnv({ providerEnv, agentId }) [extendEnv:false,08§2.2] ─► spawn env
```

### 7.3 resume 时的成本不对称(事实 D vs 06 CF-5,影响 provider 选择策略)

provider 选择直接影响真金白银,本节给**决策依据**(刹车 07 主体在别处,此处只给 provider 维度):

| 端 | resume 成本模型 | 来源 | provider 配置启示 |
|---|---|---|---|
| codex(走中转) | 每轮全量重计费,input_tokens 累积/超线性(18755→37645) | 事实 D | 长辩论 codex 侧贵;Fusion panel 多 provider 并发要算总账(§10.4) |
| claude | 历史走 prompt cache(`cache_read` 约 1/10 价) | 06 CF-5 | claude 侧 resume 相对便宜;同任务可优先 claude 多轮 |

> 这条不对称是 **provider 路由的成本输入**:`ProviderRegistry`(§8)的 failover/选择策略可参考(但本文件不实现刹车阈值,归刹车文档)。

## 8. ProviderRegistry —— 注册、热切换、健康探测、failover

### 8.1 为什么热换=重建 adapter(P4),不是改运行中进程

事实 E:codex resume 继承首轮 exec 的设定;运行中子进程的 env/argv 在 spawn 时已定死,无法中途改 base_url。因此**热切换的语义是**:在**轮边界**(round 末,引擎调度点)把某 agent 槽的 active provider 切到另一候选,**下一轮**用新 provider **重建 adapter**(05 工厂 `createCodexAdapter({provider})` 构造期注入)。运行中那一轮不动(P4)。这天然契合事实 D 的「每轮新进程」成本模型。

### 8.2 ProviderRegistry 接口

```ts
/** provider 注册表:持有 ProviderSettings,提供 active 查询 + 热换 + failover。 */
export interface ProviderRegistry {
  /** 取某 agent 槽当前 active 的 ProviderConfig(送去建 adapter)。 */
  getActive(agent: AgentId): ProviderConfig;
  /** 取某槽全部候选(面板下拉 / failover 遍历)。 */
  getCandidates(agent: AgentId): ProviderConfig[];
  /**
   * 热切换:把 agent 槽 active 切到 providerId(必须是该槽候选)。
   * 仅改注册表状态;不碰运行中进程。返回切换事件供引擎在轮边界应用(§8.3)。
   */
  switchTo(agent: AgentId, providerId: string, reason: ProviderSwitchReason): ProviderSwitchEvent;
  /** failover:从当前 active 沿候选优先级取下一个健康候选(§8.5)。 */
  failover(agent: AgentId, reason: ProviderSwitchReason): ProviderSwitchEvent | null;
  /** 热加载新配置(面板保存 / 文件变更);校验通过才生效(§8.6)。 */
  reload(settings: ProviderSettings): { ok: true } | { ok: false; code: SyluxErrorCode; message: string };
  /** 当前 KeyStore(reload 时按 keyBindings 重建)。 */
  readonly keystore: KeyStore;
}

export const providerSwitchReasonSchema = z.enum([
  'manual',          // 面板人工切换
  'health_failed',   // 健康探测失败触发 failover
  'send_error',      // send 期间 provider 报错(5xx/超时)触发 failover
  'cost_policy',     // 成本策略切换(预留;刹车文档可驱动)
]);
export type ProviderSwitchReason = z.infer<typeof providerSwitchReasonSchema>;

export interface ProviderSwitchEvent {
  agent: AgentId;
  fromId: string;
  toId: string;
  reason: ProviderSwitchReason;
  ts: number;
  /** 应用时机:'next_round'(默认,P4)| 'immediate'(仅未 spawn 时) */
  applyAt: 'next_round' | 'immediate';
  /**
   * V18(ROC-m3/m4):切换前后端点 host(非密;official 直连无 baseUrl 时为 'default')。
   * 引擎据此通知 17 ConcurrencyGovernor:跨端点切换(fromHost!==toHost)时,新端点用自己的
   * AIMD capacity / 触发 reset,不继承旧端点(如抽风的 mouubox)的拥塞惩罚。host 经 redact 可留(非密)。
   */
  fromBaseUrlHost: string;
  toBaseUrlHost: string;
}
```

### 8.3 热切换流程(时序)

```
[面板/健康探测/send错误]
   │ switchTo / failover(agent, toId, reason)
   ▼
ProviderRegistry: 校验 toId∈candidates、agentKind 一致、keystore.has(toId.apiKeyRef)
   │ 通过 → 更新 active 状态(内存),产出 ProviderSwitchEvent{applyAt:'next_round'}
   │ 失败 → 不切,抛/返回 PROVIDER_CONFIG_INVALID,保持原 active(失败安全)
   ▼
引擎在【轮边界】消费 ProviderSwitchEvent:
   │ 1. 写一条 kind:'system' 黑板消息(from:'orchestrator';02 C9:orchestrator 只能发 system):
   │      body="provider 切换 codex: mouubox→official(reason=health_failed)"
   │      (经 08 redact:base_url host 可留,key 名/值绝不出现)
   │ 2. 下一轮该 agent:用新 active ProviderConfig 经 05 工厂【重建 adapter】(keystore 一并注入,§8.4)
   │ 3. 新 adapter 首轮走 exec(非 resume)——因 base_url 变,旧 session 不可续(下方关键约束)
   ▼
面板:状态条更新 active provider 徽标 + egressClass 标记(P5)
```

> **V18 跨端点拥塞重置(ROC-m3/m4)**:`ProviderSwitchEvent` 带 `fromBaseUrlHost`/`toBaseUrlHost`。引擎在轮边界应用切换时,若 `fromHost!==toHost`(跨端点),通知 17 `ConcurrencyGovernor`:旧端点(如抽风狂 429 的 mouubox)学到的 AIMD `capacity=1` 是**针对旧 host** 的拥塞信号,**不**带给新端点;新端点用它自己的 per-endpoint capacity(若 17 已落 per-endpoint 池)或触发 `reset` 到初值(17 §3.4 增 reset 钩子)。否则「切到健康官方端点却被旧端点的病压在 1 跑」是真实吞吐损失。本文件只发 host 信号,池/AIMD 实现归 17。

> **关键约束**:跨 provider(尤其跨 base_url / 跨 official↔third_party)切换时,**旧 session 不可 resume**(不同端点的 thread_id/session_id 无意义)。引擎据 `ProviderSwitchEvent` 把该 agent 标 `resumable=false`(02 I5/BoardState.agents),新 provider 首轮全新 exec。同 provider 内仅换 model/effort 的轻量覆盖可保留 resume(【待实测】同端点换 model 是否破坏中转会话态)。
>
> **reload 与在飞轮的竞态(V11 相关)**:`switchTo`/`failover`/`reload` 都只改**内存注册表状态**,产出 `applyAt:'next_round'` 事件;引擎在**轮边界**(单线程调度点,03 §5.1)消费,**绝不**在某 agent 的 turn 在飞时改它的 provider。若 reload 在 turn 中途到达,事件入队,下一个轮边界才应用(失败安全:在飞轮用旧 provider 跑完)。

### 8.4 会话隔离与 CODEX_HOME(避免 auth.json 串号)+ keystore 注入

多 codex provider 若都默认读 `~/.codex/auth.json`,热换 official↔third_party 时凭证可能错配。对策:每个走 `auth_json` 的 codex provider 可在 `extraConfig._codex_home`(内部键,§5.2)指定独立 `CODEX_HOME`,由 `toCodexInjection` 放进 **`providerEnv`**(V14:非 base 白名单,精确每 provider 隔离),指向该 provider 专属的 `auth.json` 目录,互不污染。`env_key` 模式(§5.2)的 provider 无此问题(key 直接经 env 注入,不读 auth.json)。

> **keystore 注入链(V3)**:`ProviderRegistry.keystore` 是单一 keystore 实例;重建 adapter 时经 `createCodexAdapter({ provider, keystore })` / `createClaudeAdapter({ provider, keystore })` 构造期传入(回填 05 §8.2 / 06 §9 工厂签名)。adapter 内 `send` 调 `toCodexInjection(this.provider, this.keystore, ov)`。keystore 在 adapter 内存活,**不**经 WS/jsonl 序列化(它只是 resolve 入口,不持久化明文)。

### 8.5 健康探测与 failover(V6 成本焊死 + V11 抖动防护)

```ts
/** 轻量健康探测:不跑真任务,最小请求验证 base_url(+ 可选 key)可用。默认走 HTTP,不烧 token。 */
export interface HealthProbe {
  /** 探测单 provider:成功/失败 + 延迟。超时用 cfg.timeoutMs。mode 决定成本(默认 'http')。 */
  probe(cfg: ProviderConfig, keystore: KeyStore, mode?: 'http' | 'cli'): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
}
```

| 探测方式 | codex | claude | 成本 | 何时用 |
|---|---|---|---|---|
| `http`(默认) | HTTP HEAD/OPTIONS `base_url`(不经 CLI) | 同 | **近 0 token** | 默认所有探测;验连通 |
| `cli`(仅手动) | `codex exec` 极短 prompt + `--output-schema` 收 `{ok}` | `claude -p "ping"` text | **≈18.7k token/次(事实 D 基线)** | 仅面板「验 key 有效性」按钮手动触发 |

> **V6 成本焊死(事实 D)**:**默认不周期轮询**。CLI ping 单次 ≈18.7k input token(基线底价),周期探测=持续烧钱。探测只在三处触发:① 启动预检(用 `http` 验所有 active 的 base_url 可达 + `keystore.has` 验 key 存在,**不**发 CLI 请求验有效性);② send 失败后 failover 前(`http` 探下一候选);③ 面板手动「验 key」按钮(允许 `cli`,UI 显式提示「将消耗 ≈18.7k token」)。`http` 验不了 key 有效性,但 key 无效会在真实 send 时暴露并触发 failover,不必为此预烧 token。
>
> **V19 cli 探测节流 + 日预算(ROC-m5)**:`cli` 模式(唯一烧 token 的探测)再加两道护栏,堵「手动也能被滥用」:
> 1. **per-provider 节流**:同一 provider 的 `cli` 探测 60s(`cliProbeThrottleMs`)内只允许一次,重复请求直接复用上次结果 + UI 提示「节流中」;面板「验 key」按钮二次确认文案(「将消耗 ≈18.7k token」)保留,叠加节流防连点。
> 2. **进程级 cli-probe 日预算计数**:`health.ts` 维护进程级 `cliProbeCount`/`cliProbeTokenSpent` 日计数,超 `cliProbeDailyBudget`(默认按 ~10 次 ≈187k token 设)拒绝并提示,防脚本循环 / CI 误把 `cli` 探测放进每次 push 的 preflight。`http` 探测不计入(近 0 token)。
> 3. 与 19 `sylux doctor --deep` 对齐:`--deep`(真跑 ≈18.7k)同属 cli 级烧钱点,应共用「需显式 flag + 成本警告 + 不进自动 CI」口径(归 19,本文件给探测侧护栏)。

failover 策略(§8.2 `failover`)+ **抖动防护(V11)**:
1. 当前 active 探测失败(或 send 连续报错 ≥ `failoverErrorThreshold`,默认 2)→ 沿 `candidates` 优先级取下一个**不在冷却表**且 `http` probe.ok 的候选。
2. **per-run 失败冷却表**:任一候选 failover 失败(probe 不通 / send 报错)记入 `Map<providerId, cooldownUntil>`,默认冷却 `cooldownMs`(默认 60s)。冷却期内该候选**跳过**,避免在两个挂掉的候选间秒级抖动。
3. **单轮 failover 预算**:同一轮边界最多尝试 `maxFailoverPerRound`(默认 = 候选数)次,全部命中冷却/失败 → 返回 `null`。
4. 全候选不可用 → 返回 `null`,引擎据此把 run 转 `paused`(等人工)或 `aborted`,写 `system` 消息说明(不暴露 key,08 redact)。
5. failover 与热换共用 `applyAt:'next_round'`(P4),不打断运行中轮。
6. 冷却表**per-run** 生命周期:run 结束清空(不跨 run 记忆,避免长期误封一个临时抖动的 provider)。

### 8.6 热加载校验(reload)

面板保存 / 配置文件变更触发 `reload(newSettings)`:
1. `providerSettingsSchema.safeParse` → 失败返回 `{ok:false, code:'PROVIDER_CONFIG_INVALID'}`,**保留旧配置**(失败安全,不让坏配置生效)。
2. 校验所有 `apiKeyRef` 在新 `keyBindings` 有绑定且 `keystore.has`(§3.3 superRefine + §2.3)→ 缺 key 拒绝。panel `providerId` 引用校验同样在 superRefine(V9)。
2b. **V15 文件系统级后置校验(zod 之外)**:对每个 codex 候选,若带 `_codex_home`,跑 `assertCodexHomeSafe(value, codexHomePolicy)`(§3.2.2;realpath + 落批准根 + 非 symlink 逃逸)。**任一不过 → 整个 reload 拒绝,保留旧配置**(P7;面板 reload 是半可信输入,RS-M4)。zod superRefine 是纯函数碰不了文件系统,故这步必须在 parse 之后单独跑。
3. 通过 → **轮边界**原子替换内存 settings + 重建 keystore(§8.3 竞态约束:在飞轮不受影响);已运行 agent 的 active 若仍存在则保持,不存在则 failover 到候选首位(写 system 消息)。
4. reload **不影响运行中那一轮**(P4);新配置在下一轮边界生效。
5. 重建 keystore 后,冷却表(§8.5)清空(配置变了,旧的失败判定作废);若 reload 改了某 agent 的 active 端点 host,一并发 V18 跨端点信号让 17 重置该端点 AIMD。

## 9. 官方直连 provider 选项与出境合规(红队 R8:中转源码出境)

### 9.1 为什么必须有官方直连开关

红队 R8:第三方中转(本机现状 mouubox)意味着**代码 + 上下文出境到非官方端点**。设计必须始终提供**官方直连**作为对等候选,让用户一键切到 `api.openai.com` / `api.anthropic.com`,不经任何中转。这是 P5(出境知情)的落地出口。

### 9.2 egressClass 推断与规范化(V5:无静态 default,加载层推断 + 收紧约束)

`egressClass` schema 层是 `optional()`(§3.1,V5 去掉了 v1 的 `.default('third_party')`)。规范化在**加载层**(16 §10 / `presets.ts`):缺省按 `baseUrl` 推断;显式值只允许「比推断更严」(收紧),不允许「放宽」(把第三方标成 official 逃避横幅)。

```ts
const OFFICIAL_HOSTS = new Set([
  'api.openai.com', 'api.anthropic.com',
]);
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)(:\d+)?$/i;

/** 据 base_url 推断出境分级。inferEgressClass 落 presets.ts(无依赖),供 §3.1 superRefine 与加载层共用。 */
export function inferEgressClass(baseUrl?: string): EgressClass {
  if (!baseUrl) return 'official';                  // 省略 base_url = 用 CLI 默认官方端点
  let host: string;
  try { host = new URL(baseUrl).hostname; } catch { return 'third_party'; }
  if (LOCAL_HOST_RE.test(host)) return 'local';
  if (OFFICIAL_HOSTS.has(host)) return 'official';
  return 'third_party';                              // 其余一律按第三方中转(保守)
}

/** 严格度序:official(最宽,可省 scan) < local < third_party(最严,触发横幅+scan)。 */
const EGRESS_STRICTNESS: Record<EgressClass, number> = { official: 0, local: 1, third_party: 2 };

/**
 * 规范化:缺省→推断;显式值仅当「不弱于推断」才采纳,否则取推断值并告警(V5)。
 * 即用户可把推断为 official 的标 third_party(更保守,采纳);
 * 但把推断为 third_party 的标 official(放宽)→ 拒绝放宽,回落 third_party + 告警。
 */
export function normalizeEgressClass(cfg: { baseUrl?: string; egressClass?: EgressClass }):
  { egressClass: EgressClass; warning?: string } {
  const inferred = inferEgressClass(cfg.baseUrl);
  if (!cfg.egressClass) return { egressClass: inferred };
  if (EGRESS_STRICTNESS[cfg.egressClass] >= EGRESS_STRICTNESS[inferred])
    return { egressClass: cfg.egressClass };          // 收紧或相等:采纳
  return {
    egressClass: inferred,                            // 试图放宽:拒绝,回落推断
    warning: `egressClass='${cfg.egressClass}' 比 base_url 推断的 '${inferred}' 更宽,已回落为 '${inferred}'(防绕过出境横幅)`,
  };
}
```

> 安全默认:**未知 host 一律判 `third_party`**(保守),触发横幅。自托管 vLLM 等可显式标 `local`(若 host 已被 `LOCAL_HOST_RE` 命中则推断本就 local;非本机 IP 的自托管想标 local 属「放宽」会被告警回落——这是有意的,真要标需走显式白名单,见 §14.2)。**循环依赖注意**:`inferEgressClass` 落 `presets.ts`(仅依赖 zod 类型),`provider.schema.ts` 的 superRefine `import { inferEgressClass } from './presets.js'`——两文件无环(presets 不 import schema 的值,只 import 类型)。

### 9.3 官方直连预设(presets.ts)

```ts
/** 官方直连模板:省 base_url(用 CLI 默认端点),egressClass='official',留 apiKeyRef 占位。 */
export const OFFICIAL_PRESETS: Record<string, Omit<ProviderConfig, 'id' | 'apiKeyRef'>> = {
  'openai-official': {
    agentKind: 'codex',
    // baseUrl 省略 → codex 用默认 OpenAI 端点(不写 model_providers.<n>.base_url)
    model: 'gpt-5.5',
    wireApi: 'responses',
    codexProviderName: 'openai',
    egressClass: 'official',
    extraConfig: {},
    timeoutMs: 120_000,
  },
  'anthropic-official': {
    agentKind: 'claude',
    // baseUrl 省略 → claude 不写 ANTHROPIC_BASE_URL,走 api.anthropic.com
    model: 'claude-opus-4-8',
    egressClass: 'official',
    extraConfig: {},
    timeoutMs: 120_000,
  },
};
```

> 这两个预设作为**每个 agent 槽的兜底候选**默认进 `candidates` 末位:中转全挂时 failover 最终落到官方直连(前提:用户配了官方 key 的 `apiKeyRef`)。若用户未配官方 key,failover 到它会在 `keystore.has` 处失败 → run 转 paused 等人工(§8.5)。
>
> **模型名占位**:预设里的 `gpt-5.5` / `claude-opus-4-8` 是**示例占位**,实际模型名由用户配置/M0 实测确认。预设不写死可能过期的具体版本号(本文件不依赖具体模型名,只依赖 `agentKind` 分流)。

### 9.4 出境横幅与 redact(对账安全 08)

| 触发点 | 行为 | 拥有方 |
|---|---|---|
| 中枢启动 | 扫所有 active provider,若有 `third_party` → 打印横幅:`⚠ codex 走第三方中转 api.mouubox.com,代码与上下文将出境;出境 secret-scan 挡不住短/非标准密钥,官方直连才是唯一可靠手段,切换见面板` | 本文件触发,文案本文件(V20) |
| 面板状态条 | 每 agent 徽标标 egressClass(official 绿 / third_party 黄 / local 蓝)+ 一键切官方按钮 | 面板渲染(10/11),数据本文件 |
| 日志/WS/jsonl | provider 相关字段脱敏:`apiKeyRef` 名可留,**真实 key 永不出现**;`baseUrl` 可留(非密);`providerEnv` 整体 redact | redact 实现归 **08**,**需脱敏字段清单本文件给**(下表) |

**provider 侧需脱敏字段清单(交给 08 redact 管道)**:

```ts
/** 08 的 redact 管道据此清单脱敏 provider 相关数据。键名与 CODEX_KEY_ENV_VAR 等常量保持一致。 */
export const PROVIDER_REDACT_FIELDS = {
  /** 永远移除(含真实 key 的容器):整个 providerEnv 对象 + 两端 key 变量 */
  remove: ['providerEnv', 'env.ANTHROPIC_API_KEY', 'env.SYLUX_PROVIDER_KEY_CODEX'],
  /** 值替换为 '<redacted>'(疑似密钥的环境变量名;与 08 SECRET_SIGNATURES 互补) */
  mask: ['ANTHROPIC_API_KEY', 'SYLUX_PROVIDER_KEY_CODEX', 'OPENAI_API_KEY'],
  /** 可保留(非密,审计需要)。注意 CODEX_HOME 是路径非密,可留 */
  keep: ['baseUrl', 'model', 'wireApi', 'apiKeyRef', 'egressClass', 'codexProviderName', 'id', 'CODEX_HOME'],
} as const;
```

> **对齐协调(§14.2)**:此清单的字段名需与 08 redact 管道最终对齐;`mask` 是「键名命中即替换值」,`remove` 是「整字段删除」。`ANTHROPIC_BASE_URL` 不在 `mask`(base_url 非密,审计需保留 host)。

### 9.5 中转源码出境的额外闸(R8)

R8 要求中转源码出境要 secret scan + `.syluxignore` 白名单 + 知情标注。本文件 provider 层的对应职责:
- provider 配置层**标记** `egressClass:'third_party'`,使上层(worktree **09** / 安全 **08 §7**)知道「本 agent 的 worktree 内容会出境」,据此对**发往该 provider 的 prompt/files** 启用 secret scan + `.syluxignore` 白名单(实现归 **08 §7**,本文件提供 `egressClass` 信号)。
- `official`/`local` provider 可豁免出境 secret scan(代码不离开官方/本机)。
- **V20 出境扫描非泄漏保证(RS-M7)**:出境 secret-scan 的命中能力受限于 08 §2.4 签名集——32 字符的第三方 key、短 webhook secret、`.npmrc` 的 `_authToken=` 等**短/非标准密钥**可能扫不到而随代码出境。因此:① 知情横幅(§9.4)**前置**「扫描挡不住短/非标准密钥,官方直连(P5)才是唯一可靠手段」(不让用户误以为开了 third_party 也安全);② `third_party` 启用时,本文件给信号要求 08 §7 的 `.syluxignore` 默认模板**预置常见凭证文件**(`.env*` / `.npmrc` / `*.pem` / `id_*` / `.aws/` / `.docker/config.json`)并在启动校验用户仓是否覆盖(实现归 08,本文件给「third_party 需预置凭证 ignore」的信号 + 横幅文案)。这与 08 §7.3「官方直连才可靠」口径一致,但 v2 把它**前置到知情横幅**,不埋在文档深处。

## 10. 本地 Fusion provider —— 一个角色配一个 panel(配置形态)

### 10.1 定位(锁定决策 §5,远景)

借鉴 OpenRouter Fusion 的 panel + judge:**决策回合**(出方案 `propose` / 评审 `review` / 批判 `critique`)里,一个**角色**背后可站一个**评审团**(多 provider 并行答)+ 一个**裁判**(judge 综合)。**执行回合**(改文件 `implement`)保持单 agent + worktree 隔离(不并发写)。本文件只定义 **panel 的配置形态**;融合/裁判**算法**归引擎 Fusion 子模块(03),本文件给配置 + 引用 02 的 evidence 形状。

### 10.2 PanelProviderConfig schema

```ts
import { roleSchema, messageKindSchema } from '@sylux/shared'; // 02 权威枚举
import type { MessageKind } from '@sylux/shared';              // FORBIDDEN 常量用到类型

/** panel 成员:一个 provider + 在 panel 内的权重/标签。 */
export const panelMemberSchema = z.object({
  /** 引用某个已注册 ProviderConfig.id(成员复用主配置,不另存 key) */
  providerId: z.string().min(1),
  /** 融合权重(裁判加权用;默认等权) */
  weight: z.number().positive().default(1),
  /** 成员标签(面板展示 / evidence 溯源,如 'gpt-5.5@official') */
  label: z.string().min(1).optional(),
});
export type PanelMember = z.infer<typeof panelMemberSchema>;

/** 裁判配置:综合多成员答案,产出共识/矛盾/盲点(正是 critic 要的 evidence,§10.3)。 */
export const judgeConfigSchema = z.object({
  /** 裁判用哪个 provider(独立于成员;通常用强模型官方直连) */
  providerId: z.string().min(1),
  /** 融合策略 */
  strategy: z.enum([
    'synthesize',   // 综合成一份(默认):给共识 + 矛盾 + 盲点
    'vote',         // 多数投票(适合离散选项)
    'best_of',      // 选最佳单份(裁判打分挑一)
  ]).default('synthesize'),
  /** 是否强制裁判输出结构化分歧报告(喂 critic evidence,§10.3) */
  emitDivergenceEvidence: z.boolean().default(true),
});
export type JudgeConfig = z.infer<typeof judgeConfigSchema>;

/** 一个角色 → 一个 panel 的绑定(决策回合启用)。 */
export const panelProviderConfigSchema = z.object({
  /** panel id(面板展示 / 日志) */
  id: z.string().min(1),
  /** 本 panel 服务哪个角色(02 roleSchema:proposer/critic/...) */
  role: roleSchema,
  /** 仅对这些 kind 启用 panel(决策类;执行类 implement 不并发,§10.4)。V10:补 question(21 §3 决策回合含 question) */
  enabledKinds: z.array(messageKindSchema).default(['propose', 'review', 'critique', 'question']),
  /** 评审团成员(≥2 才有融合意义) */
  members: z.array(panelMemberSchema).min(2),
  /** 裁判 */
  judge: judgeConfigSchema,
  /** 并发上限(同时 spawn 的成员数;省成本/限流,默认 2 防限流爆发,事实 D 成本约束) */
  maxConcurrency: z.number().int().positive().default(2),
  /** 单成员超时(ms);超时成员视为弃权,裁判用到齐的部分 */
  memberTimeoutMs: z.number().int().positive().default(120_000),
  /**
   * V16(RS-M5):单轮 panel 的 token 硬顶(Σ成员 + 裁判)。引擎启动 panel 轮【前】用
   * estimatePanelFanout 做扇出感知前瞻:`当前累积 + 预测扇出 > panelTokenBudget`(或全局 maxTotalTokens)
   * → 削减 maxConcurrency 或不启动该 panel 轮(降级单 agent)。缺省按成员数×基线估(§10.6)。
   */
  panelTokenBudget: z.number().int().positive().optional(),
  /**
   * V16(RS-M5):单成员单 turn token 累计硬上限。adapter 累计 turn.completed.usage(05/06)
   * 超阈即 cancel 该成员(视为弃权),把「轮末才发现超支」窗口从「一整轮 N 倍」压到「单成员一个 turn」。
   * 缺省继承全局单 turn 闸(刹车 04);panel 可单独收紧。
   */
  perMemberTokenCap: z.number().int().positive().optional(),
  /**
   * V17(FEAS-3):panel 成员产物若携带 files(写意图)是否硬拒。默认 true:
   * panel 启用的是决策 kind(propose/review/critique/question),成员只读不写;
   * 带 files 的 propose 属执行语义,不可 panel 化(21 §5.5 曾「静默清空 files」——本契约改为硬拒不静默)。
   */
  rejectMemberFiles: z.boolean().default(true),
}).superRefine((p, ctx) => {
  // panel 不可用于执行类 kind(implement / plan 落 diff 类),守「执行回合单 agent」(§10.4)
  const FORBIDDEN: MessageKind[] = ['implement'];
  for (const k of FORBIDDEN)
    if (p.enabledKinds.includes(k))
      ctx.addIssue({ code: 'custom', message: `panel 不可启用于 ${k}(执行回合必须单 agent + worktree 隔离)` });
  // 成员 providerId 槽内不重复(同一 provider 在一个 panel 里站两次无意义,且权重重复计)
  const ids = p.members.map((m) => m.providerId);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', message: 'panel members.providerId 不应重复' });
  // V16:panelTokenBudget 若设,应 ≥ 成员数 ×（一个保守单成员下限,防设成永远触顶的小值)——此处只校正数,实际下限联调 04
  if (p.panelTokenBudget !== undefined && p.perMemberTokenCap !== undefined &&
      p.panelTokenBudget < p.perMemberTokenCap * p.members.length)
    ctx.addIssue({ code: 'custom', message: 'panelTokenBudget 应 ≥ perMemberTokenCap × 成员数(否则成员还没说完就触顶)' });
});
export type PanelProviderConfig = z.infer<typeof panelProviderConfigSchema>;
```

> **V9 跨配置校验**:`members[].providerId` / `judge.providerId` 是否真实存在,由 **`providerSettingsSchema.superRefine`**(§3.3)在顶层校验(panel schema 单独校验时拿不到 slots 全集)。即:panel schema 保证**形状**(≥2 成员、不含 implement、id 不重复),顶层 settings 保证**引用完整性**(providerId 都能在某 slot 候选里找到)。判 judge 可与某成员同 providerId(裁判复用成员 provider 合法,只是另起一次调用)。

### 10.3 裁判输出 → critic evidence(锁定决策 §5 收口)

锁定决策:裁判的「共识/矛盾/盲点」正好是 critic 要的 evidence 格式。本节给映射(类型引用 02 `EvidenceItem`,不另写):

| 裁判产物 | 映射到 02 `EvidenceItem` | 说明 |
|---|---|---|
| 成员引用某文件区间支撑结论 | `file_ref`(path/lineStart/lineEnd/contentHash) | 裁判须让成员给锚点,空泛结论不计入 |
| 成员复现命令验证 | `command`(cmd/expected/actual/matchMode) | 裁判核验后落 evidence(**强**核验:中枢能复算) |
| 成员引规范/需求 | `spec_quote`(source/quote/locator) | 弱核验(02 §3.2;**单独不足以**解除 evidence 门) |
| **裁判合成的分歧报告** | 多条 evidence 组成的 `critique` 消息 | `emitDivergenceEvidence=true` 时,矛盾点必带 **≥1 条「强」核验通过**(02 v2 C1,§3.2 已收紧),否则被 02 校验打回 |

> **V8 对账 02 v2**:02 §3.2/C1 把 critic/critique/ack 的 evidence 门**收紧为「≥1 条强」**(v1 的「强或中」已废;weak 级——无 quote 的 file_ref、未实跑的 command、spec_quote——单独不解除)。本节随之改:judge 产 critique 时,至少一条 evidence 必须是中枢能**独立复算**的强证据(实跑的 command 比对、带 contentHash 的 file_ref),否则 02 §8 打回 `EVIDENCE_UNVERIFIABLE`。这正是 Fusion 的价值锚点:逼裁判把分歧固化成可复算实证,而非「N 个模型互相附和」。空分歧 = 打回。

### 10.4 执行/决策回合的 provider 形态切换(对账锁定决策 §5)

| 回合类型 | kind | provider 形态 | worktree |
|---|---|---|---|
| 决策回合 | `propose`/`review`/`critique`/`question` | panel(多 provider 并发答 + judge) | 各成员只读,不写文件 |
| 执行回合 | `implement` | **单 agent**(panel 的 judge 选定或 playbook 指定) | 单 worktree 写(**09** 隔离) |

引擎据当前 `kind` 决定走单 provider(`ProviderRegistry.getActive`)还是 panel(`PanelProviderConfig`);panel 的成员各自经 §5/§6 注入(复用各自 `ProviderConfig` 的 key 通路,P2 不破)。**judge→implement 交接**:决策回合 judge 选定方案后,执行回合用**单个** provider 落 diff——选哪个由 playbook 指定(通常该 agent 槽的 active),**不**由 judge 动态切 provider(那会破坏 worktree 隔离与 resume 连续性)。这条交接归引擎 21,本文件只保证 panel 配置不波及 `implement`(§10.2 superRefine 焊死)。

> **V17 成员 files 硬拒契约(FEAS-3)**:panel 启用的是**决策 kind**(propose/review/critique/question),成员**只读不写**(表中「各成员只读」)。但 `propose` 这个 kind 在单 agent 路径下**可携带 `files`**(写意图)——若某成员 panel 化的 `propose` 产物带非空 `files`,21 §5.5 旧行为是**静默 `files:[]` 清空**,会无声丢掉成员的改动意图(FEAS-3 反例:proposer 以为写了文件,实际被清)。v2 契约改为**硬拒不静默**:`rejectMemberFiles:true`(默认)时,panel 成员产物 `files` 非空 → 运行期报 `INJECTION_BLOCKED` 语义(或决策期 `PROVIDER_CONFIG_INVALID`),消息体提示「带 files 的 propose 属执行语义,请走单 agent 执行回合,不可 panel 化」。这把「panel 决策 vs 单 agent 执行」的边界从「静默改写数据」升级为「显式拒绝 + 告知」,proposer 不会误以为改动生效。校验点:引擎收 panel 成员产物时(归 21),据本文件 `rejectMemberFiles` 标志判定;本文件给配置 + 契约语义,21 落实现。

### 10.5 panel 成本账(事实 D,务实约束)

panel = 同一决策回合内 **N 个成员并发** + 1 裁判,token 成本是 `Σ成员 + 裁判`。叠加事实 D(codex resume 累积),**多轮 panel 辩论成本爆炸**。务实约束:
- panel 默认只在**关键决策回合**启用(非每轮);`enabledKinds` 收窄。
- 成员优先用**便宜/官方直连**或 claude(prompt cache,06 CF-5)摊薄;裁判用强模型但**单次**。
- `maxConcurrency` 限并发防限流;成员超时弃权不阻塞裁判。
- panel 是**远景**(锁定决策标注):M0/M1 先单 agent,panel 配置 schema 先占位、引擎后接。

### 10.6 扇出感知前瞻 `estimatePanelFanout`(V16 / RS-M5 + ROC-m6)

红队 RS-M5/ROC-m6:预算只在轮末裁决,前瞻刹车(04 §6.4②)只用「最近两轮实测增量线性外推」——纯**后向**预测。前几轮单 agent 便宜 → 外推「下轮也便宜」→ 第 k 轮突然切 panel 扇出 N 路,后向外推**完全没预见**(它只看历史标量),照启动 → 一轮烧 N×base + judge 才在轮末被发现。修法:panel 轮**启动前**必须做**扇出感知**的前瞻,不能复用单 agent 的标量外推。

```ts
/** panel 扇出成本预测(token)。引擎在启动 panel 轮【前】调用,与全局/panel 预算比对。 */
export function estimatePanelFanout(
  panel: PanelProviderConfig,
  /** 单成员单轮基线(默认事实 D 的 ≈18.7k;codex resume 累积更高,由刹车 04 传入实测曲线) */
  perMemberBaseline: number,
  /** 裁判单次成本(通常强模型,可高于成员) */
  judgeCost: number,
): { predicted: number; memberCount: number; concurrency: number } {
  const memberCount = panel.members.length;
  // 成员全部要答(并发只影响墙钟不影响总 token);裁判 1 次
  const predicted = memberCount * perMemberBaseline + judgeCost;
  return { predicted, memberCount, concurrency: Math.min(panel.maxConcurrency, memberCount) };
}
```

引擎用法(归刹车 04 / 引擎 03,本文件给预测函数 + 决策契约):

| 前瞻判定 | 动作 |
|---|---|
| `当前累积 + predicted ≤ min(panelTokenBudget, 全局 maxTotalTokens)` | 正常启动 panel 轮 |
| 超 `panelTokenBudget` 但全局有余 | 削减:砍 `maxConcurrency` / 减成员数(按 weight 取 top-k)/ 降级单 agent;写 system 说明 |
| 超全局 `maxTotalTokens` | **不启动 panel 轮**,降级单 agent(active)或直接 stop(归 04) |
| 任一成员单 turn 累计 usage > `perMemberTokenCap` | adapter cancel 该成员(弃权),裁判用到齐部分(§10.2) |

> **三层防线(RS-M5 要求逐条吃掉)**:① 扇出感知前瞻(`estimatePanelFanout`,启动前按 N×预测 算,不靠后向外推);② 单成员单 turn token 硬上限(`perMemberTokenCap`,adapter 据 `turn.completed.usage` 累计超阈即 cancel,把超支窗口从「一整轮」压到「单成员一个 turn」);③ 04 §6.5 配额公式对 panel 范式单列(ROC-m6:当前表只有四范式单 agent 估法,panel 的 `(成员数+1判)` 倍率未进公式,归 04/16,本文件给 `estimatePanelFanout` 作为其输入)。三者缺一不可:时机(①前瞻)、粒度(②单 turn 闸)、额度(③公式)正交。

## 11. 统一导出(`@sylux/providers/src/index.ts`)

```ts
// ── schema + 类型(provider.schema.ts)──
export {
  agentKindSchema, wireApiSchema, egressClassSchema,
  providerConfigSchema, providerOverridesSchema,
  agentProviderSlotSchema, providerSettingsSchema,
  providerSwitchReasonSchema,
} from './provider.schema.js';
export type {
  AgentKind, WireApi, EgressClass,
  ProviderConfig, ProviderOverrides,
  AgentProviderSlot, ProviderSettings,
  ProviderSwitchReason, ProviderSwitchEvent,
} from './provider.schema.js';

// ── schema 常量(provider.schema.ts;V7 硬化常量)──
export { SAFE_EXTRA_KEY_RE, EXTRA_CONFIG_DENY } from './provider.schema.js';
export { assertCodexHomeSafe } from './provider.schema.js';   // V15 路径安全闸
export type { CodexHomePolicy } from './provider.schema.js';

// ── panel(panel.schema.ts)──
export { panelMemberSchema, judgeConfigSchema, panelProviderConfigSchema } from './panel.schema.js';
export type { PanelMember, JudgeConfig, PanelProviderConfig } from './panel.schema.js';
export { estimatePanelFanout } from './panel.schema.js';   // V16 扇出感知前瞻

// ── keystore(keystore.ts)──
export { keySourceSchema, keyRefBindingSchema, createKeyStore } from './keystore.js';
export type { KeySource, KeyRefBinding, KeyStore } from './keystore.js';

// ── 注入翻译(inject-codex.ts / inject-claude.ts)──
export { toCodexInjection, CODEX_KEY_ENV_VAR } from './inject-codex.js';
export type { CodexInjection } from './inject-codex.js';
export { toClaudeInjection } from './inject-claude.js';
export type { ClaudeInjection } from './inject-claude.js';
export { mergeProviderOverrides, buildAgentProviderInput } from './inject-codex.js'; // 共享 helper

// ── 注册表 / 健康 / 预设(registry.ts / health.ts / presets.ts)──
export type { ProviderRegistry, HealthProbe } from './registry.js';
export { inferEgressClass, normalizeEgressClass, OFFICIAL_PRESETS, PROVIDER_REDACT_FIELDS } from './presets.js';
```

> 用 `.js` 后缀(NodeNext / `verbatimModuleSyntax`,master §11.4);`type` 导出与值导出分开。其他包(`@sylux/agents` 05/06、`server`、`@sylux/core` Fusion 21)**只从 `@sylux/providers` 导入**,不深引子模块。`inferEgressClass`/`normalizeEgressClass` 落 `presets.ts`(无依赖),被 `provider.schema.ts` 的 superRefine 反向 import(无环,§9.2)。

---

## 12. provider 相关错误码(引用 02 全集,本节列拥有项)

错误码全集在 `@sylux/shared/errors.ts`(02 §12 拥有 `SyluxErrorCode` union;`PROVIDER_CONFIG_INVALID` 已在其中)。本文件**拥有** `PROVIDER_CONFIG_INVALID` 在 provider 维度的语义触发清单:

| 触发场景 | 错误码 | 阶段 |
|---|---|---|
| `apiKeyRef` 无绑定 / 解析为空 | `PROVIDER_CONFIG_INVALID` | 启动预检 / reload(§2.3) |
| `activeId` 不在 candidates | `PROVIDER_CONFIG_INVALID` | schema 校验(§3.3) |
| 同槽候选 agentKind 不一致 / 与 agent 不符 / id 重复 | `PROVIDER_CONFIG_INVALID` | schema 校验(§3.3,V12) |
| `agent` 非 codex/claude | `PROVIDER_CONFIG_INVALID` | schema 校验(§3.3,V12) |
| 切换目标 providerId 非候选 / key 不可解析 | `PROVIDER_CONFIG_INVALID` | `switchTo`(§8.3) |
| argv 现疑似 key(注入产物拼错) | `PROVIDER_CONFIG_INVALID` | spawn 前 `assertArgvNoSecret`(05 §6.4 / 06 §A4,签名集 08 §2.4) |
| `wireApi`/`baseUrl` 等格式非法 | `PROVIDER_CONFIG_INVALID` | zod parse |
| `extraConfig` key 受保护 / 值含控制字符 | `PROVIDER_CONFIG_INVALID` | schema 校验(§3.4,V7) |
| `_codex_home` 非绝对 / 逃逸批准根 / symlink 逃逸 | `PROVIDER_CONFIG_INVALID` | 加载层 / reload 后置(§3.2.2/§8.6,V15) |
| panel `panelTokenBudget` < `perMemberTokenCap`×成员数 | `PROVIDER_CONFIG_INVALID` | schema 校验(§10.2,V16) |
| panel 成员产物携带非空 `files` | `INJECTION_BLOCKED`(运行期)/ `PROVIDER_CONFIG_INVALID`(决策期) | 引擎收成员产物时(§10.4,V17;码归 02/21) |
| panel `enabledKinds` 含 implement / members<2 / members id 重复 | `PROVIDER_CONFIG_INVALID` | schema 校验(§10.2) |
| panel `providerId`(成员/裁判)不存在 | `PROVIDER_CONFIG_INVALID` | 顶层 settings 校验(§3.3,V9) |


> provider 层**不新增**错误码(复用 02 已有 `PROVIDER_CONFIG_INVALID`),避免 union 漂移。failover 全候选不可用导致的 run 终止用刹车/状态机的码(`aborted` 状态,02 §10.2),不是新 provider 码。V17 的 panel 成员带 files 用 `INJECTION_BLOCKED`(02/08 已用码,02 §12 union 待补,见 x-consistency A1),本文件只引用不新造。

---

## 13. 配置示例与测试矩阵

### 13.1 本机现状配置示例(mouubox 中转 + 官方直连兜底)

```jsonc
{
  "keyBindings": [
    { "ref": "MOUUBOX_KEY",   "source": "env", "envVar": "SYLUX_KEY_MOUUBOX" },
    { "ref": "OPENAI_KEY",    "source": "env", "envVar": "SYLUX_KEY_OPENAI" },
    { "ref": "ANTHROPIC_KEY", "source": "env", "envVar": "SYLUX_KEY_ANTHROPIC" }
  ],
  "slots": [
    {
      "agent": "codex",
      "activeId": "mouubox-gpt55",
      "candidates": [
        { "id": "mouubox-gpt55", "agentKind": "codex", "baseUrl": "https://api.mouubox.com",
          "model": "gpt-5.5", "wireApi": "responses", "apiKeyRef": "MOUUBOX_KEY",
          "codexProviderName": "custom", "egressClass": "third_party" },
        { "id": "openai-official", "agentKind": "codex", "model": "gpt-5.5",
          "wireApi": "responses", "apiKeyRef": "OPENAI_KEY",
          "codexProviderName": "openai", "egressClass": "official" }
      ]
    },
    {
      "agent": "claude",
      "activeId": "anthropic-official",
      "candidates": [
        { "id": "anthropic-official", "agentKind": "claude", "model": "claude-opus-4-8",
          "fallbackModel": "claude-sonnet-4-5", "apiKeyRef": "ANTHROPIC_KEY",
          "egressClass": "official" }
      ]
    }
  ],
  "panels": []
}
```

> 注:示例里**没有任何 sk- 真值**(P1),只有 `envVar` 名;真实 key 在 `SYLUX_KEY_*` 环境变量,中枢启动前由脚本设好。codex active 是第三方中转(横幅黄标),官方直连作 failover 兜底;claude 默认官方直连(无中转)。
>
> **egressClass 可省(V5)**:`mouubox-gpt55` 的 `egressClass:'third_party'` 可省略——`normalizeEgressClass` 会据 `api.mouubox.com`(未知 host)推断为 `third_party`;`openai-official`/`anthropic-official` 省 `baseUrl` 时推断为 `official`。显式写出仅为可读性,且只能「收紧」(写 `official` 给 mouubox 会被回落 + 告警)。配置文件层字段为 snake_case(`base_url`/`wire_api`/`api_key_ref`),由加载层(16 §4.2)转 camelCase,此处 jsonc 已是转换后形态。

### 13.2 测试矩阵(`@sylux/providers` 单测,对接 master §12)

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| P1 | 合法 settings | §13.1 配置 | `providerSettingsSchema.safeParse.success===true` |
| P2 | apiKeyRef 无绑定 | provider 引用未声明 ref | superRefine 报错 → `PROVIDER_CONFIG_INVALID` |
| P3 | activeId 非候选 | activeId 不在 candidates | superRefine 报错 |
| P4 | 同槽混 agentKind | codex 槽塞 claude provider | superRefine 报错 |
| P5 | codex 注入无 key | `toCodexInjection(cfg, ks)` 产物 | `cArgs` 不含 sk-;`env[CODEX_KEY_ENV_VAR]` 含 key;有 `env_key` 这条 -c |
| P6 | claude 注入无 key | `toClaudeInjection(cfg, ks)` 产物 | `flags` 不含 sk-、**不含 --settings**(V4);`settingsFragment` 是对象;`env.ANTHROPIC_API_KEY` 含 key;base_url 在 env |
| P7 | key 解析失败 | envVar 未设 | `KeyStore.resolve` 抛 `PROVIDER_CONFIG_INVALID`,detail 无值 |
| P8 | official 推断 | baseUrl=api.anthropic.com | `inferEgressClass==='official'` |
| P9 | local 推断 | baseUrl=http://localhost:8000 | `'local'` |
| P10 | 未知 host | baseUrl=https://x.evil.com | `'third_party'`(保守) |
| P11 | merge overrides | base.model=A, ov.model=B | 结果 model=B,extraConfig 合并 |
| P12 | ov 无 apiKey 字段 | TS 类型层 | `ProviderOverrides` 无 apiKeyRef/apiKey(编译期保证) |
| P13 | 热换非候选 | switchTo 不存在 id | 返回/抛 `PROVIDER_CONFIG_INVALID`,active 不变 |
| P14 | failover 全挂 | 所有候选 probe 失败 | `failover` 返回 null |
| P15 | reload 坏配置 | 非法 settings | 返回 `{ok:false}`,旧配置保留 |
| P16 | panel 启用 implement | enabledKinds 含 implement | superRefine 报错 |
| P17 | panel <2 成员 | members 长度 1 | schema 报错(min(2)) |
| P18 | redact 清单 | providerEnv 经 08 redact | key 不出现;baseUrl/apiKeyRef 名保留 |
| P19 | argvGuard 兜底 | extraConfig 值含 sk- | spawn 前 `assertArgvNoSecret` 抛(05 §6.4) |
| P20 | wireApi claude 忽略 | claude provider 带 wireApi | `toClaudeInjection` 不报错,产物无 wire 相关 |
| P21 | **V5** egressClass 放宽被拒 | mouubox host + egressClass='official' | `normalizeEgressClass` 回落 'third_party' + warning |
| P22 | **V5** egressClass 收紧采纳 | official host + egressClass='third_party' | 采纳 'third_party'(无 warning) |
| P23 | **V7** extraConfig 受保护键 | extraConfig 含 `model_providers.x.env_key` | superRefine 报错 |
| P24 | **V7** extraConfig 控制字符 | extraConfig 值含 `\n` | superRefine 报错 |
| P25 | **V9** panel providerId 不存在 | members[].providerId 无对应候选 | 顶层 superRefine 报错 |
| P26 | **V12** agent 槽非可执行 | agent='human' | superRefine 报错 |
| P27 | **V12** 跨槽 id 重复 | 两槽用同一 provider id | 顶层 superRefine 报错 |
| P28 | **V4** settingsFragment 合并 | provider effort + 06 hooks 片段 | 合并后单个 --settings,两者都在 |
| P29 | **V3** toCodexInjection 签名 | `(cfg, keystore, ov?)` | 类型/运行均通过;传 merged(缺字段)编译期/运行期拒 |
| P30 | **V6** 默认探测不发 CLI | startup probe | 只发 HTTP HEAD;0 个 codex/claude 子进程 spawn |
| P31 | **V11** failover 冷却 | 候选 A 失败后立即再 failover | A 在冷却期被跳过 |
| P32 | **V14** CODEX_HOME 路径 | extraConfig._codex_home 设值 | 进 providerEnv.CODEX_HOME,**不**作为 -c 下发 |
| P33 | **V15** _codex_home 相对路径 | `_codex_home: '../x'` | `assertCodexHomeSafe` 抛 `PROVIDER_CONFIG_INVALID`(非绝对) |
| P34 | **V15** _codex_home 逃逸批准根 | 绝对路径但在 approvedRoot 外 | `assertCodexHomeSafe` 抛(isPathSafe false) |
| P35 | **V15** _codex_home symlink 逃逸 | 链接指向外部目录 | realpath 后判逃逸 → 抛(复用 08 §4.4) |
| P36 | **V15** reload 携恶意 _codex_home | 面板 reload 含逃逸路径 | reload 整体拒,保留旧配置(§8.6 步骤 2b) |
| P37 | **V15** 注入兜底 | 绕加载层直调 toCodexInjection 传非绝对 _codex_home | toCodexInjection 廉价断言抛 |
| P38 | **V16** panelTokenBudget 过小 | budget < perMemberTokenCap×成员数 | superRefine 报错 |
| P39 | **V16** estimatePanelFanout | 3 成员 + judge | predicted=3×base+judge;concurrency=min(maxConc,3) |
| P40 | **V16** 前瞻超全局上限 | 累积+predicted > maxTotalTokens | 不启 panel 轮(降级单 agent) |
| P41 | **V17** panel 成员带 files | propose 成员产物 files 非空 | 硬拒(INJECTION_BLOCKED 语义),**不**静默清空 |
| P42 | **V18** 跨端点切换信号 | failover mouubox→official | ProviderSwitchEvent.from/toBaseUrlHost 不同;发 17 reset 信号 |
| P43 | **V18** 同端点切换不重置 | 同 host 换 model | fromHost===toHost,不触发 AIMD reset |
| P44 | **V19** cli 探测节流 | 60s 内同 provider 连续两次 cli probe | 第二次被节流,复用上次结果 |
| P45 | **V19** cli 探测日预算 | 超 cliProbeDailyBudget | 拒绝 + 提示;http 探测不计入 |
| P46 | **V20** third_party 横幅文案 | active 含 third_party | 横幅含「扫描挡不住短密钥/官方直连唯一可靠」 |

---

## 14. 收尾:本文件权威性声明与开放问题

### 14.1 权威声明

1. **唯一定义**:`ProviderConfig` / `ProviderOverrides` / `AgentProviderSlot` / `ProviderSettings` / `KeyRefBinding` / `KeyStore` / `PanelProviderConfig` / `JudgeConfig` / 注入翻译(`toCodexInjection`/`toClaudeInjection`,V3 签名 `(cfg, keystore, ov?)`)/ `ProviderRegistry` 接口 / `inferEgressClass`+`normalizeEgressClass` / `assertCodexHomeSafe`+`CodexHomePolicy`(V15)/ `estimatePanelFanout`(V16)/ `PROVIDER_REDACT_FIELDS` / `SAFE_EXTRA_KEY_RE`+`EXTRA_CONFIG_DENY`,**有且只有本文件一处定义**,物理落 `@sylux/providers`。
2. **引用而非另写**:05/06(适配层)、**08**(安全)、**09**(worktree)、03/21(引擎/Fusion)、16(配置聚合)涉及上述类型时以 `@sylux/providers` 引用本文件;`Message`/`Evidence`/`AgentId`/`Role`/`MessageKind` 以 `@sylux/shared`(02)引用,本文件不另写。
3. **05/06 对账项(需回填)**:① `toCodexInjection`/`toClaudeInjection` 改 `(cfg, keystore, ov?)` 三参,**adapter 不再自己 merge 后传 merged**(V3);② `createCodexAdapter`/`createClaudeAdapter` 构造期收 `keystore`;③ claude 端 `--settings` 由 06 合并 `settingsFragment`+hooks 后**单次**注入(V4);④ `buildChildEnv` 单对象签名(08 §2.2,05 A1/06 CA1 已对齐);⑤ `ProviderOverrides` 补 `extraConfig`(本文件 §4 权威)。
4. **R8 焊死复核**:key 无字段(P1)、单一解析出口(P2)、注入非密/含密物理分离(P3)、热换重建不改进程(P4)、出境知情+官方直连(P5);新增 V7(extraConfig 键黑名单防 env_key/sandbox 绕过)、V14(CODEX_HOME 走 providerEnv 不污染白名单)、**V15(`_codex_home` 路径安全闸,补 V14 缺的校验,P7)**、**V16(panel 单轮成本有顶,P8)**、**V17(panel 成员 files 硬拒不静默)**。
5. **v3.1 吃掉的 07 红队 findings**:RS-M4→V15、RS-M5→V16、FEAS-3→V17、ROC-m3/m4→V18、ROC-m5→V19、RS-M7→V20。各项落点见 §0.0 变更表。

### 14.2 开放问题(标注待实测/待上层决策/待协调)

- 【待实测】claude `--settings` 是否收文件路径变体(超 32KB 内联降级,§6.3);同端点仅换 model 是否破坏中转 resume 会话态(§8.3)。
- 【待实测】codex `env_key` 模式经 mouubox 中转是否与本机 config.toml 现状(custom provider)兼容——需 M0 验证 `-c model_providers.custom.env_key=...` 注入有效(setup 笔记现状是 config.toml 静态配,本设计改为 `-c` 动态注入)。
- 【待协调】**05/06 需按 §14.1.3 回填**:`toCodexInjection`/`toClaudeInjection` 三参签名、构造期注入 keystore、claude `settingsFragment` 单次合并注入。05 §8.2 v2 现写 `toCodexInjection(merged)`(单参,无 keystore),与本文件 V3 冲突,以本文件为准。
- 【待协调】05 §6.3/§9 与 21 §6/§7 内残留「安全 09」字样指代安全文档,应同步订正为「安全 08」(本文件已自查订正,邻居文档需各自修)。
- 【待协调】`PROVIDER_REDACT_FIELDS` 清单需与 **08** redact 管道字段名最终对齐(§9.4);`mask`(键名命中替换值)与 `remove`(整字段删)两种语义需 08 支持。
- 【待协调】非本机 IP 的自托管端点想标 `local`(规避横幅)会被 `normalizeEgressClass` 当「放宽」回落 third_party(§9.2)。若确需(内网可信端点),需上层提供**显式 host 白名单**(扩 `OFFICIAL_HOSTS`/新增 `TRUSTED_LOCAL_HOSTS`),本文件留口未实现。
- 【待上层决策】panel/Fusion 的融合算法、judge prompt 模板、judge→implement 单 provider 交接归引擎 **21**;本文件只定配置形态,M0/M1 panel 先占位。
- 【待上层决策】failover 全候选不可用时 run 转 `paused`(等人工)还是 `aborted`——本文件给信号(`failover` 返回 null),终态策略归引擎状态机(02 §10.2)/刹车 04。
- 【待上层决策】`failoverErrorThreshold`(默认 2)、`cooldownMs`(默认 60s)、`maxFailoverPerRound` 的最终取值需联调 04 刹车一起定(§8.5),避免与成本预算冲突。
- 【待协调】**V15 `CodexHomePolicy.approvedRoot`** 的具体值由中枢启动配置(16)给定;`isPathSafe`/realpath/symlink 解析实现归 08 §4.4,本文件经 `CodexHomePolicy` 注入。16 需暴露 `approvedRoot`(用户批准的 codex 数据根),08 需导出可被本文件复用的 `isPathSafe`。
- 【待协调】**V16 panel 预算**:`estimatePanelFanout` 是输入,但「panel 范式的配额公式」(`maxTotalTokens ×=(成员数+1判)`)归 04 §6.5 / 16 §6.4(ROC-m6 要求两处补 panel 行);`perMemberTokenCap` 的 adapter 级 cancel 实现归 05/06(据 `turn.completed.usage` 累计)。本文件给配置 + 预测函数,三处需回填。
- 【待协调】**V17 panel 成员 files 硬拒**的运行期校验点在引擎收成员产物处(归 21);21 §5.5 现「静默 `files:[]`」需改为「读 `rejectMemberFiles` 标志 → 非空硬拒 + 报 `INJECTION_BLOCKED`」。本文件给契约 + 配置,21 落实现。
- 【待协调】**V18 跨端点 AIMD 重置**:`ProviderSwitchEvent.from/toBaseUrlHost` 是信号,per-endpoint 并发池 / AIMD reset 钩子实现归 17(ROC-m3/m4 要求 17 §3.4 增 reset、§2.1 池按端点 key)。本文件发 host 信号,17 消费。
- 【待协调】**V19 cli 探测护栏**:`cliProbeThrottleMs`/`cliProbeDailyBudget` 取值需与 19 `sylux doctor --deep` 口径统一(ROC-m5:`--deep` 应需显式 flag + 不进自动 CI)。本文件给探测侧护栏,19 给 doctor 侧。
- 【待协调】**V20 `.syluxignore` 凭证模板**:`third_party` 启用时预置 `.env*`/`.npmrc`/`*.pem` 等默认 ignore 的实现归 08 §7;本文件给「third_party 需预置凭证 ignore」信号 + 横幅文案。出境扫描覆盖不全(短/非标准密钥,RS-M7)是 08 §2.4 签名集的已知残余,本文件横幅已前置「官方直连才可靠」,但扫描增强(键值对启发式、私钥头)归 08。

