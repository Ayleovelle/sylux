# 19 · 部署运维与合规(本地分发 / 运行 / 密钥存储 / 出境合规 / 灾备恢复 / 版本漂移)[v2]

> **v2 硬化记录**:吃掉红队/交叉审查针对本节的 findings——ROC-M1(usage 改为条件 critical,配预算即拒启 + 04 高估兜底 + 连续缺失转 paused + 15 usage_missing_streak,§6.3.1/A8)、ROC-M4(`--deep` 烧钱护栏从建议升硬约束:不进 CI/二次确认/日预算计数/验 key 节流,§6.4.1/A9)、ROC-m1(§5.3 resume 预算判定纳入 resume 首轮重计费尖峰)、ROC-m2(§5.4 fsync 加成本入账维度 + 截断丢行成本提示)、E12(`ContextBundle`→`PromptContext`)。编号已用磁盘文件名派(安全 08 / 隔离 09),与 03/04/07/08/09/24 一致(E13 无需改)。
>
> **本文件地位**:sylux 的**部署运维与合规权威设计**。负责五件事:① 本地分发与运行(Windows 优先:Node 版本钉死、两端 CLI 真实二进制定位、启动前置体检 preflight、引导脚本);② 配置与密钥的**安全存储与下发**(env / `auth.json` / OS keychain、文件权限、`.env` 纪律、密钥下发脚本);③ 数据出境与合规(第三方中转源码出境的 secret scan + `.syluxignore` + 知情标注 + 官方直连选项,遵守 R8);④ 灾备与会话恢复(jsonl 重放、崩溃恢复、resume 续接、worktree orphan 回收);⑤ 升级与 codex/claude 版本漂移应对(能力探针、schema 漂移、版本锁定与告警)。
>
> **类型一律引用 02**:`Message` / `JsonlRecord` / `BoardState` / `AgentEvent` / `SyluxError` / `SyluxErrorCode` 等全部 zod 类型与错误码,**唯一权威定义在黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`。本文件**只引用、不另写任何 zod**。需要 jsonl 行格式见 02 §7,需要 `BoardState` 投影见 02 §10。
>
> **与兄弟文档的边界(只引用,不重写实现)**:
> - 密钥**引用模型** `apiKeyRef` / `KeyStore` / `KeyRefBinding` / `KeySource` 归 **provider 07** §2;本文件拥有其**物理存储与下发的运维规则**(env 怎么设、`auth.json` 权限、keychain 下发脚本),按 07 的接口形状消费。
> - `buildChildEnv` env 白名单 / `SECRET_SIGNATURES` / `redact` / `guardEgress` / `.syluxignore` 的**规则与正则**归 **安全 08**;本文件拥有它们在**部署/出境**场景的**调用点与运维流程**,不重定义正则。
> - 配置加载管线 `loadSyluxConfig` / `SyluxConfig` 顶层 schema 归 **配置 16**;本文件拥有**配置文件物理落点、查找顺序、密钥下发与配置的协同**,不重画 schema。
> - jsonl 行结构 / `decodeJsonlLine` / 截断恢复 / `BoardState` 投影归 **02 §7**;本文件拥有**崩溃恢复编排、resume 续接决策树、灾备 runbook**,消费 02 的回放原语。
> - 选型 / 版本锁定 / npmmirror / corepack 归 **技术栈 12**;目录树 / 包边界 / CI 归 **monorepo 13**;本文件拥有**面向运行(而非开发)的分发与升级流程**,引用其锁定结论。
> - 日志 / 指标 / trace / 错误码语义表归 **可观测 15**;本文件拥有**部署相关错误码的新增与回填**,语义补进 15 §6。
> - 事实地基(spawn A / 事件流 B / output-schema C / resume 成本 D / resume 参数 E / claude flag F)以 `docs/PROBED-FACTS.md`(2026-06-20 本机实测)为准,已覆盖项不再标【待实测】。
>
> **事实标注约定**:凡基于假设而非本机实测的结论,显式标【待实测】。
---

## 0. 设计目标与运维不变量

### 0.1 一句话定位

sylux 是**本地单机 orchestrator**(总体 §0 / 12 P4):不是云服务、不发 npm、不进容器编排。「部署」= 在一台开发者机器(Windows 优先)上把中枢 + 两端 CLI + 配置 + 密钥摆放到位、体检通过、能起一次 run;「运维」= 让它崩了能恢复、密钥不泄、源码出境可控、CLI 升级了不悄悄坏掉。所有设计被这条定位约束:**重运维件一律不引**(无 k8s / 无外部 DB / 无消息队列),状态的唯一权威是磁盘上的 jsonl(02 §7)。

### 0.2 本文件负责 / 不负责

| 负责(给规则 + 脚本骨架 + runbook + 失败路径) | 不负责(只引用) |
|---|---|
| Node 运行时版本钉死 + preflight 体检(§2) | execa/pnpm/zod 选型与开发期版本锁(12) |
| 两端 CLI 真实二进制定位的**运维校验**(§2.3) | `resolveCodexExe`/`resolveClaudeCli` 实现(12 §3.3 / 05 §4) |
| 密钥的**物理存储 / 文件权限 / 下发脚本**(§3) | `apiKeyRef`/`KeyStore` 引用模型(07 §2) |
| 出境合规**运维流程**:扫描时机 / `.syluxignore` 维护 / 知情横幅 / 官方直连切换(§4) | `guardEgress`/`SECRET_SIGNATURES`/`redact` 正则(08) |
| 灾备:崩溃恢复编排 / resume 决策树 / jsonl 重放 runbook / orphan 回收(§5) | jsonl 行 schema / 投影算法(02 §7/§10);worktree 清理实现(09 §8) |
| 升级:能力探针 / schema 漂移检测 / 版本锁与告警 / 升级 runbook(§6) | 事件流字段(02 §6;事实地基 B/C) |
| 部署 / 合规 / 恢复相关错误码(§7,回填 02 §12 + 15 §6) | 错误码 union 本体(02 §12);观测语义表(15 §6) |

### 0.3 运维不变量(实现必须保持,违反即运维缺陷)

- **D1 起前体检,fail-fast**:任何 run 启动前必过 `preflight()`(§2.4):Node 版本、两端 CLI 可定位且版本在锁定窗、配置可加载、active key 可解析、repoRoot 是 git 仓、git 版本满足 merge-tree(09 §5.3)。任一不过 → 抛对应 `SyluxError`,**不 spawn 任何子进程、不建 worktree**(承接 16 K2、09)。0 副作用启动失败。
- **D2 密钥窄通路落地**:密钥的物理存储只允许三处——进程 env(启动脚本设)、codex `~/.codex/auth.json`、OS keychain(经下发脚本注入 env)。**绝不**写进 sylux 配置文件、jsonl、日志、仓库(承接 07 P1/P2、08 S1)。`.env` 文件若用,权限收紧 + 入 `.gitignore` + 出境黑名单(§3.4)。
- **D3 状态唯一权威是 jsonl**:run 的可恢复状态**只**来自 `runs/<runId>.jsonl`(02 §7);`BoardState` 是其投影,**不独立落盘**(02 §10.3)。灾备 = 重放 jsonl,不依赖任何外部存储或内存快照(承接 15 O6)。
- **D4 出境前必扫描**:任何发往 `egressClass:'third_party'` provider 的内容(prompt 拼入的 worktree 片段、evidence 区间)出境前必过 `guardEgress`(08 §7.2):`.syluxignore` 路径过滤 + 敏感路径 + secret scan。命中即该片段不出境 + 告警(承接 08 S8、R8)。
- **D5 升级不静默坏**:codex/claude 版本变更 → 启动期能力探针(§6.2)比对锁定基线;关键能力(事件流字段 B、output-schema C、resume 参数 E)漂移 → 告警 + 拒启或降级,**绝不**带着失配的假设裸跑。
- **D6 恢复幂等**:崩溃后重入 `create`/`recover` 必须幂等(承接 09 §3.3 W1 路径稳定、WT20 崩溃重入);重复执行不产生重复 worktree / 重复 base tag / 重复 jsonl 头。
- **D7 恢复不伪造已发生**:重放 jsonl 重建状态时,**绝不**补造未落盘的事件;读到截断残行即丢弃该行(02 §7.3),以最后完整行为权威态。恢复后是否 resume agent 由 §5.3 决策树决定(承接 02 I5:无 sessionId 不可 resume)。
- **D8 不吞运维错**:preflight / 恢复 / 出境扫描的失败一律抛带 `SyluxErrorCode` 的 `SyluxError`,经 `redact` 后落日志 + 计数(承接 15 O4、08 S9);**绝不** catch 后静默继续。
- **D9 知情可逆**:任何把源码/上下文发往第三方中转的部署,启动横幅 + 面板常驻提示 `<base_url>`,且提供一键切官方直连(承接 07 P5、08 S8)。知情是合规底线,不替代技术防护。

---

## 1. 物理落点与依赖

### 1.1 包归属

部署运维代码主要落 `@sylux/server`(组合根,持 IO 边界,13 §1.5):preflight、引导、恢复编排、出境守门调用点都在中枢进程侧。少量纯函数(版本比对、能力探针结果判定)可下沉 `@sylux/core`。**不新增包**(13 §2.4 准入门槛:无新依赖边界)。

```
packages/server/src/
├─ deploy/
│  ├─ preflight.ts        # ★ preflight():起前体检全集(§2.4),fail-fast
│  ├─ resolve-runtime.ts  # Node 版本校验 + 两端 CLI 定位的运维包装(§2.2/§2.3)
│  ├─ capability-probe.ts # ★ CLI 能力探针:比对锁定基线(§6.2),schema 漂移检测
│  └─ banner.ts           # 启动横幅:版本 / provider egressClass 知情提示(§2.5/D9)
├─ recover/
│  ├─ recover-run.ts      # ★ 崩溃恢复编排:扫 runs/ → 重放 → resume 决策(§5.2/§5.3)
│  ├─ replay.ts           # jsonl 重放 → BoardState 投影(消费 02 §7.3,不另写)
│  └─ orphan-gc.ts        # worktree orphan 回收触发(调 09 §8.4,不重写)
├─ egress/
│  └─ syluxignore.ts      # .syluxignore 加载 + guardEgress 调用点编排(规则属 08 §7)
└─ scripts/               # 引导 / 密钥下发脚本(随仓分发,§2.6/§3.3)
   ├─ bootstrap.ps1       # Windows 引导:corepack/install/build/preflight
   ├─ set-keys.ps1        # 密钥下发到当前会话 env(从 keychain 读,§3.3)
   └─ doctor.ps1          # 一键体检(= preflight 的 CLI 包装,§2.4)
```

> 依赖方向遵守 13 §2.1:`server` 可依赖 `core`/`agents`/`providers`/`shared`。`deploy`/`recover`/`egress` 在 server 层,消费下层接口(`resolveCodexExe` 05、`KeyStore` 07、`guardEgress` 08、jsonl 原语 02、worktree `cleanup` 09),不反向被依赖。

### 1.2 运行期目录布局(部署视角)

```
G:\sylux\                          # 仓库根(= 安装根;本地单机不分 install prefix)
├─ packages/                       # 编译产物 dist/ 在各包内(13 §1.2)
├─ sylux.config.yaml               # 配置(16 §1.2;只含 apiKeyRef 引用名,无真值)
├─ .env                            # 可选:密钥(D2;入 .gitignore + .syluxignore,§3.4)
├─ .syluxignore                    # 出境白/黑名单(08 §7.2;§4.3 维护)
├─ runs/                           # ★ 灾备权威源:<runId>.jsonl(02 §7);.gitignore
│  └─ <runId>.jsonl
├─ logs/                           # pino 输出(15);.gitignore
└─ <repoRoot>/.sylux/worktrees/    # agent worktree(09 §2.2;在用户目标仓内,非本仓)
   └─ <runId>/{integration,codex,claude}/
      └─ ../orphans.json           # orphan 回收登记(09 §8.4)
```

> **关键运维分界**:`runs/`(jsonl,灾备权威,D3)与 worktree(在 `<repoRoot>/.sylux/`,运行期文件)**物理分离**——杀进程 / 删 worktree 不影响 jsonl 可重放;反之清 `runs/` 不影响目标仓。备份只需备 `runs/` + `sylux.config.yaml`(密钥不备,从 keychain 重新下发)。

---

## 2. 本地分发与运行(Windows 优先)

### 2.1 分发形态:源码 + lockfile,不打二进制

sylux 不产出单文件 exe / 不发 npm(D1 定位、13 §3.1 `private:true`)。分发 = **clone 仓库 + 锁定环境引导**。理由:① 两端 CLI(codex/claude)本就是外部独立安装的二进制(记忆 codex-cli-setup),sylux 只 spawn 它们,自身无需打包它们;② lockfile 入库(13 §7.1)+ npmmirror(12 §7.2)已保证可复现安装;③ 单机开发者机器,源码可见反而利于排障与改配置。

| 分发物 | 内容 | 备注 |
|---|---|---|
| 仓库 | `packages/*` 源码 + `pnpm-lock.yaml` + 配置样例 | 13 §1.1 |
| 不含 | codex/claude 二进制、node_modules、密钥、`runs/` | 外部装 / 引导生成 / 不分发 |
| 引导产物 | node_modules(pnpm install)、各包 dist(tsup/vite build) | `bootstrap.ps1`(§2.6) |

### 2.2 Node 运行时版本钉死(事实地基:本机 v22.13.0)

Node 版本是**第一道运维闸**。事实地基与 12 §1.1 锁 Node 22 LTS(本机 `v22.13.0` 为基线);13 §3.4 `engines.node: ">=22.13 <23"` + `.nvmrc=22`。运行期 preflight 再校验一次(开发期 corepack/CI 已校验,但用户机器可能换 node):

```ts
// @sylux/server/src/deploy/resolve-runtime.ts
/** 锁定窗口:与 13 §3.4 engines 一致。低于 minor 拒启(内置 WebSocket/fetch 依赖 22),
 *  跨大版本(23+)告警但允许(未验,降级为 warn 不拒)。 */
export const NODE_RANGE = { min: [22, 13, 0] as const, maxMajorExclusive: 23 };

export function checkNodeRuntime(actual = process.versions.node): RuntimeCheck {
  const [maj, min, pat] = actual.split('.').map(Number);
  if (maj < 22 || (maj === 22 && (min < 13))) {
    return { ok: false, code: 'NODE_RUNTIME_UNSUPPORTED',
      message: `Node ${actual} < 22.13;sylux 依赖 Node22 内置 WebSocket/fetch 与成熟 Windows spawn(12 §1.1)` };
  }
  if (maj >= 23) {
    return { ok: true, warn: `Node ${actual} 未在锁定窗(22.x)内验证,建议用 22 LTS` };
  }
  return { ok: true };
}
```

> **为何不放宽到 Node 20**:12 §1.1 已论证——Node 22 的稳定全局 `WebSocket`(面板/自测)、`fetch`、以及成熟的 Windows `child_process` 是项目命门(事实地基 A)。降级 Node 20 需重测 spawn 三连(事实 A)与内置 WebSocket,不值。锁窗内 patch 可浮动。

### 2.3 两端 CLI 真实二进制定位(运维校验,事实地基 A)

二进制定位的**算法**归 12 §3.3 / 05 §4(`resolveCodexExe`/`resolveClaudeCli`);本节是其**运维包装**:preflight 期把「能不能定位 + 定位到的版本对不对」变成体检项,而非等首次 spawn 才炸。

```ts
// @sylux/server/src/deploy/resolve-runtime.ts
export interface CliResolution {
  agent: 'codex' | 'claude';
  command: string;        // 直 spawn 目标(codex=真 exe;claude=node+入口 js,12 §3.4)
  baseArgs: string[];
  version: string;        // --version 探得(§6.2 探针复用)
  source: 'platform-pkg' | 'node-entry' | 'cmd-fallback';
}

/** 运维包装:定位 + 版本探测,任一失败给可诊断错误(区分「配置/安装问题」vs「运行时崩溃」)。 */
export async function resolveAndProbeCli(agent: 'codex' | 'claude'): Promise<CliResolution>;
```

定位失败的**运维诊断**(对接事实 A 三连坑,05 §6.2 / 15 §6.2 区分):

| 失败现象 | 根因 | 诊断指向 | 错误码 |
|---|---|---|---|
| 找不到平台包 vendor bin(codex) | codex 未装 / 装坏(记忆:残二进制 42MB) | 重装走 npmmirror(记忆 npm-mirror) | `SUBPROCESS_SPAWN_FAILED`(05) |
| `%1 is not a valid Win32 application` | 误 spawn 了 PATH 上裸名 shim(事实 A.1) | M0 路径解析 bug,非运行时 | `SUBPROCESS_SPAWN_FAILED` |
| claude 入口 `cli.js` 解析不到 | claude 安装结构变(版本漂移) | 走 `.cmd` 备选(12 §3.4)或重测 | `CLI_VERSION_DRIFT`(§6) |
| `--version` 不在锁定窗 | CLI 自升级(§6.1 漂移) | 能力探针(§6.2) | `CLI_VERSION_DRIFT` |

> preflight 阶段对两端各跑一次 `resolveAndProbeCli`,**只定位 + 探版本,不烧 token**(`--version` 不走中转)。真正 spawn 跑任务在 run 启动后。这样「装没装好」在体检就暴露,不拖到第一轮辩论才失败。

### 2.4 preflight() —— 起前体检全集(D1)

`preflight` 是 run 启动的**单一闸门**:所有外部前提一次性查清,fail-fast。它是 `doctor.ps1` 的核心,也被 `sylux run` 在启动时内联调用。

```ts
// @sylux/server/src/deploy/preflight.ts
export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];   // 每项含 name/ok/level/message/remedy
  blocking: PreflightCheck[]; // ok=false 且 level=block 的子集
}
export interface PreflightCheck {
  name: string;
  ok: boolean;
  level: 'block' | 'warn';    // block=拒启;warn=可启但提示
  message: string;
  remedy?: string;            // 可操作的修复建议(面板/CLI 直接展示)
  errCode?: SyluxErrorCode;
}

/** 起前体检。任一 block 项失败 → 调用方抛对应 SyluxError,不 spawn(D1)。
 *  纯读 + 轻探测(--version / KeyStore.has / fs.stat),不烧 token、不写盘。 */
export async function preflight(cfg: SyluxConfig, derived: DerivedConfigs): Promise<PreflightResult>;
```

体检项清单(按 fail-fast 顺序,block 项任一挂即整体不 ok):

| # | 检查 | level | 失败错误码 | remedy |
|---|---|---|---|---|
| P0 | Node 版本在锁定窗(§2.2) | block(<22.13)/ warn(≥23) | `NODE_RUNTIME_UNSUPPORTED` | 装 Node 22 LTS / 用 nvm 切 22 |
| P1 | codex 二进制可定位 + 版本探得(§2.3) | block | `SUBPROCESS_SPAWN_FAILED` | 重装 codex(走 npmmirror) |
| P2 | claude CLI 可定位 + 版本探得 | block | `SUBPROCESS_SPAWN_FAILED` | 检查 claude 安装 |
| P3 | 两端版本在锁定基线窗(§6.1) | warn(漂移)/ block(关键能力失配) | `CLI_VERSION_DRIFT` | 跑能力探针 / 锁回基线版 |
| P4 | 配置可 `loadSyluxConfig`(16) | block | `CONFIG_*`(16 §13) | 修配置(报具体 issue) |
| P5 | active provider 的 key 可 `KeyStore.has`(07 §2.3) | block | `PROVIDER_CONFIG_INVALID` | 下发密钥(`set-keys.ps1`,§3.3);detail 只给 ref 名 |
| P6 | repoRoot 存在且是 git 仓(16 X1) | block | `CONFIG_REPO_INVALID` | 指向有效 git 仓 |
| P7 | git 版本 ≥ 2.38(merge-tree,09 §5.3) | warn(退化方案可用) | — | 升 git 或用临时 worktree 合并 |
| P8 | `<repoRoot>/.sylux/` 在目标仓 .gitignore(09 §2.2) | warn | — | 加 `.sylux/` 到 .gitignore |
| P9 | 第三方中转 provider 存在 → 知情确认(D9) | warn(横幅必出) | — | 知悉出境 / 切官方直连(§4.4) |
| P10 | 有未恢复的崩溃 run(`runs/` 扫描,§5.2) | warn | — | 提示可 `recover`(§5) |
| P11 | 磁盘可写(`runs/`/`logs/`/worktree 根) + 余量 | block(不可写)/ warn(余量低) | `RUN_RECOVERY_FAILED`(写 jsonl 失败前置) | 检查权限 / 清理空间 |

> **P5 的运维要点**:`KeyStore.has(ref)` 只返回 boolean(07 §2.3),**绝不**解析出值、绝不回显(08 T9 / D2);失败 remedy 只提示「ref `<MOUUBOX_KEY>` 未解析,请确认 env 变量 `SYLUX_KEY_MOUUBOX` 已设」,不打印任何疑似值。候选(非 active)provider 不强制 P5 通过(failover 时再校验,07 §8.5)。

### 2.5 启动横幅(知情 + 版本快照,D9)

中枢启动(preflight 通过后)打印一段横幅,既是知情合规(D9 / 08 S8),也是排障时的「环境快照」(出问题先看横幅对不对)。横幅经 `redact`(08 §3)——理论上无 secret,但 base_url 可能含敏感子域,统一过一道。

```
┌─ sylux orchestrator ────────────────────────────────────────────┐
│ node v22.13.0   git 2.43.0   pnpm 9.15.0                          │
│ codex 0.141.0 (platform-pkg)   claude <ver> (node-entry)         │
│ playbook: red-blue   run: run_8af3   worktree: <repoRoot>/.sylux  │
│ ⚠ codex 经第三方中转 https://api.mouubox.com —— 代码与上下文会发往  │
│   该端点。切官方直连见面板 / docs §4.4。claude: 官方直连。          │
│ runs/ 灾备目录: G:\sylux\runs   日志: G:\sylux\logs                │
└──────────────────────────────────────────────────────────────────┘
```

- `egressClass:'third_party'` 的每个 active provider **逐条**打 ⚠ 行(D9 / P9);全官方直连则打一行「✓ 全部官方直连,无第三方出境」。
- 横幅同内容经 WS 推一帧给面板常驻提示(08 §5.4 redact 后);面板状态条常驻 egress 提示 + 「切官方直连」入口(07 §9.3)。
- 横幅是 `LogEvent.RUN_STARTED`(15 §2.4)的人类可读伴随输出,机读仍走结构化日志。

### 2.6 引导脚本 `bootstrap.ps1`(Windows 优先)

一键把裸 clone 变成可跑环境。PowerShell(本机主 shell);失败即停、不静默。

```powershell
# scripts/bootstrap.ps1 —— 裸 clone → 可跑(Windows 优先)
$ErrorActionPreference = 'Stop'
# 1) Node 版本闸(对齐 §2.2;低于窗口直接停)
$node = (node --version)  # vXX.YY.ZZ
if (-not ($node -match '^v22\.(1[3-9]|[2-9]\d)')) {
  throw "Node $node 不在锁定窗 (>=22.13 <23);请装 Node 22 LTS"
}
# 2) corepack 固定 pnpm(12 §2.1;不全局装 pnpm)
corepack enable
corepack prepare pnpm@9.15.0 --activate
# 3) 安装(走 npmmirror,.npmrc 已配,记忆 npm-mirror;--frozen-lockfile 防漂移)
pnpm install --frozen-lockfile
# 4) 构建各包(tsup + vite,13 §6.4)
pnpm build
# 5) 体检(= doctor.ps1 核心,§2.4;不烧 token)
node packages/server/dist/bin/sylux.js doctor
Write-Host "bootstrap done. 下一步:set-keys.ps1 下发密钥(§3.3),再 sylux run --config sylux.config.yaml"
```

> **跨平台说明**:Windows 优先(本机)。非 Windows(CI ubuntu,13 §10)走等价 `bootstrap.sh`(同步骤,bash);二者只是 shell 差异,逻辑一致。引导**不**碰密钥(§3 单独负责),也**不**自动起 run(体检通过即止,把「跑不跑、跑哪个 config」交给用户)。

### 2.7 `sylux` CLI 入口与运行命令(commander,13 §1.5)

CLI 入口在 `@sylux/server` 的 `bin/sylux.ts`(13 §1.5;commander,12 §6.2)。部署相关子命令:

| 命令 | 作用 | 内部 |
|---|---|---|
| `sylux doctor` | 跑 `preflight` 全集并人类可读打印(§2.4) | `preflight()` + 渲染 checks |
| `sylux run --config <p>` | 起一次 run(先内联 preflight,block 失败即退) | `loadSyluxConfig`(16)→`preflight`→引擎 |
| `sylux recover [--run <id>\|--last\|--all]` | 崩溃恢复(§5) | `recoverRun`(§5.2) |
| `sylux gc` | orphan worktree 回收 + `runs/` 保留策略清理(§5.5) | 09 §8.4 + §5.5 |
| `sylux egress-check [--against <dir>]` | 干跑出境扫描(不起 run,§4.5) | `guardEgress` 批量(08 §7.2) |

> 退出码约定(便于脚本/CI 判定):`0` 成功;`2` preflight block 失败(可修);`3` 配置非法(`CONFIG_*`);`4` 恢复失败(`RUN_RECOVERY_FAILED`);`1` 其他未分类。退出码与 `SyluxErrorCode` 的映射集中在 `bin/sylux.ts`,不散落。

---

## 3. 配置与密钥的安全存储(D2,承接 07 §2 / 08 §2)

### 3.1 两层分离:配置(可入库)vs 密钥(永不入库)

承接 07 P1 与 16 K1:**配置文件只有 `apiKeyRef` 引用名,密钥真值在别处**。本节定义「别处」的物理存储与下发运维。

| 资产 | 存哪 | 入库? | 出境? | 权限 |
|---|---|---|---|---|
| `sylux.config.yaml` | 仓库根 / 用户指定 | 可(只含引用名) | 配置本身不出境 | 普通 |
| 密钥真值 | env / `~/.codex/auth.json` / OS keychain | **绝不** | **绝不**(D2/D4) | 收紧(§3.4) |
| `KeyRefBinding`(ref→source 映射,07 §2.2) | 在 `sylux.config.yaml` 的 `providers.key_bindings`(16 §4) | 可(只有变量名,非值) | 不出境 | 普通 |
| `.env`(可选,密钥载体) | 仓库根(若用) | **绝不**(.gitignore) | **绝不**(.syluxignore) | 600 等价(§3.4) |

> 红线(D2 / 07 P1 / 08 S1):grep 真实密钥值在 `sylux.config.yaml` / `runs/*.jsonl` / `logs/` / git 历史中应**零命中**。配置层校验期对疑似把 secret 写进配置值的情况(命中 08 `SECRET_SIGNATURES`)直接 `PROVIDER_CONFIG_INVALID` 炸(16 CF8),detail 不回显值。

### 3.2 三种密钥来源的运维取舍(承接 07 §2.1)

`KeyStore`(07 §2)支持 `env` / `auth_json` / `none`;本节给**部署期怎么选、怎么落地**:

| 来源 | 适用场景 | 运维落地 | 风险/权衡 |
|---|---|---|---|
| **env**(`EnvKeyStore`) | 默认推荐;中转 key、官方 key | 启动脚本 `set-keys.ps1`(§3.3)从 keychain 读真值 → 设进**当前会话** env → 启动中枢 | env 在进程表/子进程可见(但 `buildChildEnv` 白名单只下发给需要的子进程,08 §2.2);会话结束即清 |
| **auth_json**(`AuthJsonKeyStore`) | 复用 codex 已有 `~/.codex/auth.json`(记忆:codex 走 mouubox) | 不额外下发,`KeyStore` 直读该文件字段(07 §2.2) | 依赖 codex 既有凭证;文件权限须收紧(§3.4) |
| **none** | 官方直连且走 OS keychain / 本地模型 | 无需下发 | 仅适用无 key 的 provider |

> **首选 env + keychain 下发**(§3.3):密钥**静态**存 OS keychain(加密),**运行期**才解到会话 env,中枢退出即随会话消失。比「明文 `.env` 常驻磁盘」更安全;比「每次手敲 key」更省事。`.env` 仅作降级备选(§3.4 收紧)。

### 3.3 密钥下发脚本 `set-keys.ps1`(keychain → 会话 env)

密钥真值静态存 Windows Credential Manager(或等价 keychain),运行前下发到当前 PowerShell 会话 env;中枢由该会话启动,经 `buildChildEnv`(08 §2.2)白名单下发给子进程。

```powershell
# scripts/set-keys.ps1 —— 从 Windows 凭据管理器读密钥 → 设进当前会话 env
# 前置(一次性,手动):用 cmdkey / CredentialManager 模块把 key 存进凭据库,target 名约定 sylux:<ref>
$ErrorActionPreference = 'Stop'
# 约定:KeyRefBinding.envVar 即目标 env 变量名(16 §4.2;如 SYLUX_KEY_MOUUBOX)
$bindings = @(
  @{ ref='MOUUBOX_KEY';    envVar='SYLUX_KEY_MOUUBOX' },
  @{ ref='ANTHROPIC_KEY';  envVar='SYLUX_KEY_ANTHROPIC' }
)
foreach ($b in $bindings) {
  $secret = Get-StoredCredential -Target "sylux:$($b.ref)"   # CredentialManager 模块;真值只在内存
  if (-not $secret) { throw "凭据库缺 sylux:$($b.ref);请先存入(见 docs §3.3 前置)" }
  # 设进当前会话 env(不写盘、不进 argv、不 echo;子 shell 不继承到磁盘)
  Set-Item -Path "Env:$($b.envVar)" -Value $secret.GetNetworkCredential().Password
}
Write-Host "已下发 $($bindings.Count) 个密钥到当前会话 env(进程退出即清)。现在可 sylux run。"
```

下发运维红线(D2 / 08 S1):
- 脚本**绝不 echo 密钥值**、绝不写临时文件、绝不进 PowerShell history(敏感赋值用 `Set-Item Env:` 不留命令行参数痕迹;避免把值作为可见 argv 传任何命令)。
- 密钥只活在**当前会话 env**;关窗即清。CI / 无人值守场景由更上层 secret 注入(超出本地单机范围,记 openQuestion)。
- `set-keys.ps1` 与中枢**同一会话**:`set-keys.ps1; sylux run ...` 串在一个 shell。新开窗口需重新下发(刻意:避免密钥跨会话常驻)。

### 3.4 `.env` 降级路径与文件权限收紧

若用户坚持用 `.env`(非首选),运维强制:

```ini
# .env (若使用;非首选,keychain 下发更安全)
SYLUX_KEY_MOUUBOX=...        # 真值;此文件必须 .gitignore + .syluxignore + 权限收紧
SYLUX_KEY_ANTHROPIC=...
```

- **入 `.gitignore`**(13 §7:`.env .env.*`)+ **入 `.syluxignore`**(出境黑名单,§4.3 / 08 `SENSITIVE_PATH` 本就含 `.env`)+ **入 `SENSITIVE_PATH`**(08 §4.4 永不出境、agent 不可触碰)。三重焊死。
- **权限收紧**:Windows 用 `icacls` 去掉非属主访问;POSIX 等价 `chmod 600`。`doctor`(§2.4)可加一项 warn:`.env` 若组/其他可读 → 提示收紧。

```powershell
# .env 权限收紧(Windows;仅当前用户可读写)
icacls .env /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
```

- 加载 `.env` 到 env 的时机与 `set-keys.ps1` 互斥:二选一,不叠加(避免两套来源混乱)。preflight P5 不关心来源,只验 `KeyStore.has`。

### 3.5 配置文件的安全存储与热加载(承接 16 §11.5)

- `sylux.config.yaml` 可入库(只含引用名,K1)。但**含 `repoRoot` 绝对路径 / labels**等环境信息,跨机器复用需调整——建议入库一份 `sylux.config.example.yaml`,真实配置按机器改(类似 `.env.example`,13 §1.1)。
- 热加载(面板保存配置)走 `loadSyluxConfig` 单一出口(16 K3 / §11.5):失败安全(坏配置保留旧值);改 `repoRoot`/`server.port` 等需重启项 → 告警「需重启生效」,不静默。
- 配置回读接口(REST)对 provider 段过 `redactObject`(08 §3.3 / 01 §1.2「不回传 key」)——即便配置只有引用名,也防 `authJsonField` 路径等元信息意外暴露。

---

## 4. 数据出境与合规(D4/D9,承接 08 §7 / R8)

### 4.1 威胁与三道手续(承接 08 T4)

第三方中转(`egressClass:'third_party'`,如 mouubox,记忆 codex-cli-setup)能看到一切发出的 prompt 与代码——这是项目的本质合规风险(08 T4)。**技术上无法让中转方看不到放行后的内容**,只能:① 知情(D9);② 出境前过滤不该出的(D4);③ 提供官方直连彻底绕开(§4.4)。本节是这三道手续的**运维落地**;规则/正则归 08 §7,本节给**时机、维护、流程**。

| 手续 | 防什么 | 本节落地 | 规则归属 |
|---|---|---|---|
| 知情横幅 + 面板常驻 | 用户不知道源码在外发 | §2.5 横幅 + 面板提示(D9) | 08 S8 |
| 出境前 `guardEgress` | `.env`/密钥/敏感文件被发往中转 | §4.2 调用点 + §4.3 `.syluxignore` 维护 | 08 §7.2 |
| 官方直连切换 | 想彻底不外泄 | §4.4 一键切换 + failover | 07 §9.3 |

### 4.2 出境扫描的调用点(D4,何时扫)

`guardEgress(content, sourcePath, ig)`(08 §7.2)的**调用时机**——凡内容**即将拼进发往 third_party provider 的 prompt**,出境前一刻扫:

> **命名对齐(承接 03 §0.4 Q7)**:引擎组装的上下文权威类型名是 `PromptContext`(03/02/09/16/20–23 统一);`ContextBundle` 是已废弃旧别名,本文件不再用。

```
引擎 PromptContext 组装 prompt(03)
  ├─ 拼入 worktree 文件片段 / evidence file_ref 读出的区间
  │     ▼ 每个来自 worktree 的片段,出境前过 guardEgress(08 §7.2)
  │        ├─ 命中 .syluxignore / SENSITIVE_PATH / SECRET_SIGNATURES
  │        │     → 该片段替换为占位符 ‹egress-blocked:reason› + 记 system 告警(EGRESS_SECRET_BLOCKED)
  │        └─ 干净 → 放行拼入
  ▼ 仅对 egressClass==='third_party' 的目标 agent 执行扫描
官方直连(egressClass==='official')→ 跳过 guardEgress(发往官方等同正常 API 调用)
```

- **只对 third_party 扫**:官方直连(official)不扫(发往 OpenAI/Anthropic 官方与直接用其 API 同风险面,不额外阻断;否则正常代码协作没法做)。这是 `egressClass` 字段(07 P5)的运维用途。
- **扫的是「来自 worktree 的内容」**:agent 自己生成的 `body` 不扫(它是模型输出,不是用户源码);但 agent `body` 若**复述**了它读到的 key,由 §3 redact 在落盘/广播侧兜(08 §3),与出境扫描分工(出境扫输入侧的源码,redact 抹输出侧的复述)。
- 扫描失败处置:命中 → 该片段不出境(占位替代),run **不**中止(EGRESS_SECRET_BLOCKED 是 warn 级,15 §6 风格)——少喂一个文件不该让整 run 崩,但要 system 告警 + 面板高亮让用户知道「有内容被挡」。

### 4.3 `.syluxignore` 的维护(运维职责)

`.syluxignore`(gitignore 语法,08 §7.2)是用户维护的**出境黑名单**:声明「这些文件/目录绝不发往中转」。

```gitignore
# .syluxignore —— 出境黑名单(gitignore 语法);绝不发往第三方中转
# 密钥/凭证(与 SENSITIVE_PATH 08 §4.4 叠加,双保险)
.env
.env.*
**/auth.json
**/*.pem
**/*.key
.ssh/
.aws/
# 生产/敏感配置
infra/prod/
secrets/
config/production.*
# 大型/无关产物(省 token 也防误发)
node_modules/
dist/
*.lock
```

维护运维:
- 随仓提供 `.syluxignore.example`(13 §1.1 占位已留 `.syluxignore`);用户按项目敏感面定制。
- `sylux egress-check`(§2.7)干跑:对目标仓采样,报「哪些文件会被挡 / 哪些会出境」,让用户在起 run 前审一遍出境面,而非跑起来才发现。
- `.syluxignore` 本身**不出境**(它列了敏感路径,等于地图);也入 `SENSITIVE_PATH`(08 §4.4 已含)。
- 与 `.gitignore` 的关系:**不复用**。`.gitignore` 管「不入库」,`.syluxignore` 管「不出境」——交集大(`.env`/`node_modules`)但语义不同(入库的源码恰恰是要协作的,但其中 `secrets/` 不该外发)。两份独立维护。

### 4.4 官方直连切换(S8 兜底,承接 07 §9.3)

知情 + 扫描只降风险,**彻底不外泄只能官方直连**。运维提供两种切换:

| 切换方式 | 触发 | 机制 |
|---|---|---|
| **配置预置 failover** | 中转挂 / 主动切 | provider `candidates` 里第二项是官方直连(16 §12.1 示例:codex 中转 active + openai-official failover);热换走 07 §8(轮边界重建 adapter) |
| **面板一键切** | 用户合规决策 | 面板「切官方直连」入口 → 改 active provider → 下一轮生效(07 §9.3) |

- 官方直连需官方 base_url + 官方 key ref(`egressClass:'official'`,16 §12.1)。切换后 `guardEgress` 自动跳过(§4.2)、横幅 ⚠ 行消失(§2.5)。
- failover 的 key 在 preflight P5 时**非 active 不强制可解析**(07 §8.5);但真要切过去时,目标 key 必须已下发(§3.3),否则 07 §8.5 转 paused。运维提示:配了官方 failover 就把官方 key 也存进 keychain,切换才即时可用。

### 4.5 出境合规审计与 runbook

- **审计痕迹**:每次 `EGRESS_SECRET_BLOCKED` 命中写 `system` 消息(redact 后,08 §3)落 jsonl(02 §7)——事后可查「这个 run 期间有哪些内容被挡过出境」,合规留痕。
- **secret-scan 兜底网**(13 §8 / 15 §5):CI / pre-commit 对 `runs/`、`logs/`、出境内容抽样扫 `sk-`/base64/`Bearer`,命中即 fail——这是「`guardEgress`/redact 忘接」的最后一道网。
- **出境合规 runbook**(起 run 前):

```
1. sylux egress-check --against <repoRoot>   # 审出境面:看哪些文件会发往中转
2. 检查横幅 ⚠ 行:确认哪些 agent 走第三方、base_url 是否预期
3. 敏感项目 → 编辑 .syluxignore 补黑名单,或直接切官方直连(§4.4)
4. 起 run 后关注面板 EGRESS_SECRET_BLOCKED 告警:有命中说明 .syluxignore 漏标,补
```

---

## 5. 灾备与会话恢复(D3/D6/D7,承接 02 §7 / 09 §8)

### 5.1 灾备模型:jsonl 是唯一权威,一切皆投影

承接 D3 / 02 §10.3 / 15 O6:run 的可恢复状态**只**来自 `runs/<runId>.jsonl`(append-only 事件日志,02 §7)。`BoardState`、面板视图、metrics 成本曲线全是它的投影,**不独立落盘**。这把灾备简化成一件事:**能把 jsonl 重放成 `BoardState` 就能恢复**。

崩溃面分三类,恢复策略不同:

| 崩溃面 | 现象 | jsonl 状态 | 恢复 |
|---|---|---|---|
| **中枢进程崩**(OOM / 未捕获异常 / 断电) | 中枢退出,子进程可能成孤儿 | 完整或末行截断 | §5.2 重放 + §5.3 resume 决策 |
| **子进程崩**(CLI 退出 / 中转挂) | 单 agent 失败,中枢仍活 | 完整(中枢继续写) | 运行期处理(05 失败路径 / 07 failover),非灾备范畴 |
| **磁盘/写失败** | jsonl 写不进 | 可能半行 | §5.4 写完整性 + P11 体检 |

> 本节只管**中枢进程崩**的灾备(子进程崩是运行期 adapter/provider 职责,05/07)。中枢崩 = 整个编排停摆,必须能从 jsonl 接着跑或干净收尾。

### 5.2 崩溃恢复编排 `recoverRun`(D6 幂等)

```ts
// @sylux/server/src/recover/recover-run.ts
export interface RecoverResult {
  runId: string;
  recovered: BoardState;          // 重放投影(02 §7.3)
  lastIntactRound: number;        // 最后一个完整 round_closed
  truncatedTailDropped: boolean;  // 是否丢了末尾残行(D7)
  resumePlan: ResumePlan;         // §5.3 每 agent 续接决策
  action: 'resumed' | 'finalized' | 'manual';
}

/** 崩溃恢复主编排。幂等(D6):重复跑同一 runId 不产生副作用叠加。
 *  纯重放 + 决策,不补造未落盘事件(D7)。 */
export async function recoverRun(runId: string, deps: RecoverDeps): Promise<RecoverResult>;
```

恢复流程(对接 02 §7.3 截断恢复 + 09 §3.3 worktree 重入):

```
1. 定位 runs/<runId>.jsonl(--last 取 mtime 最新;--all 批量;扫描见 §5.5)
2. 逐行 decodeJsonlLine(02 §7.2):
     ├─ 首行非 run_started → 文件损坏,RUN_RECOVERY_FAILED(不猜)
     ├─ 中间行 decode 失败 → 该行损坏,记录但继续(尽量多恢复)【见 §5.4 取舍】
     └─ 末行 decode 失败 → 写到一半崩,丢弃残行,truncatedTailDropped=true(D7/02 §7.3)
3. 投影重建 BoardState(02 §7.3:run_started 建壳 → message 归桶 → round_closed 填 rounds
     → agent_session 填 sessionId/resumable → status_changed 末态)
4. 若末态已是终态(done/stalled/aborted/limit,02 §10.2)→ action='finalized',
     只做 worktree 清理(09 §8),无需 resume
5. 否则(running/paused 中途崩)→ 算 resumePlan(§5.3)→ worktree 幂等重入(09 §3.3 create)
     → action='resumed' 或 'manual'(需人工)
```

- **幂等(D6)**:worktree `create` 幂等(09 §3.3 WT20);base tag `tag -f` 幂等;jsonl 是 append-only 不重写。重复 `recoverRun` 收敛到同一状态。
- **不补造(D7)**:重放只读已落盘行;中途崩在「某轮发了一半」→ 该轮未 `round_closed`,投影里是未闭合轮,resume 从该轮重新发起(不假装那半轮完成了)。

### 5.3 resume 续接决策树(承接 02 I5 / 事实地基 D/E)

崩溃后每个 agent 是否 resume,取决于**是否有可信 sessionId**(02 I5:无 sessionId 不可 resume)+ **resume 是否划算**(事实地基 D:resume 不省 token,累积上涨)。

```
对每个执行体 agent(codex/claude):
  ├─ jsonl 有 agent_session 记录(sessionId 已落盘,02 §7.1)?
  │    ├─ 否 → resumable=false → 全新会话重来(stateless),不 resume
  │    │        (02 §6.3 失败路径:session_started 前崩 → 永远 false)
  │    └─ 是 → sessionId 可信,技术上可 resume
  │         ├─ 续接策略 continuity==='resume'(03 §2.1 / 16 §5)?
  │         │    ├─ 是 → 评估成本(事实地基 D:resume 按累积历史重新计费)
  │         │    │        ├─ 崩溃前累积 + resume首轮预测增量 仍在预算内 → resume 续接
  │         │    │        │   (★ 预测增量 = predictNextRoundInputTokens(04 §6.2,resume regime
  │         │    │        │     超线性外推);不能只看裸累积——见下方 ROC-m1 修正)
  │         │    │        └─ 崩溃前累积 + 预测增量 ≥ 预算 → 告警,转 fresh(精简上下文重建,
  │         │    │            事实 D 下可能更省)或人工(action='manual')
  │         │    └─ 否(stateless)→ 不 resume,新会话从 jsonl 重建的上下文继续
  │         └─ codex resume 必须用 resume 参数集(事实地基 E:拒 -s/-C,需 --skip-git-repo-check,
  │              SESSION_ID/PROMPT 位置参数;沙箱/cwd 继承首轮)——适配器 05 拼装
  ▼
  resumePlan: Record<agentId, { mode: 'resume'|'fresh'|'manual'; sessionId?: string }>
```

> **关键运维事实(事实地基 D/E)**:resume **只解决「本地失忆」**(进程退出后能接着聊),**不省 token**(走中转每轮按全量历史重新计费,input_tokens 累积上涨)。所以崩溃恢复时 resume 不是「免费续上」——它会把累积成本接着算。预算将尽时,新开 stateless 会话(只喂 jsonl 重建的精简上下文)可能更省。决策树把这个权衡显式化,而非无脑 resume。
>
> **ROC-m1 修正(预算判定必须含 resume 首轮尖峰)**:resume 的**第一轮**会把崩溃前全部历史重灌、按全量重新计费(事实 D:round1=18755→round2=37645,超线性)。若只用「崩溃前已落盘累积」判「在不在预算内」,会出现「决策树判可 resume,实际 resume 一两轮就触 B3 顶超付」。例:崩在第 6 轮累积 600k、预算顶 808k(裸看有余量),但 resume 首轮重灌 6 轮历史 input ≈ `base×7 ≈ 131k`,一轮把累积推到 731k,再一轮即破顶。**故判定式必须是 `崩溃前累积 + predictNextRoundInputTokens(resume regime) ≥ 预算 → 不 resume`**(04 §6.2 提供该预测;resume regime 走超线性外推,非 stateless 线性)。该尖峰算进去后若超预算,转 fresh(精简上下文重建,事实 D 下通常更省)或人工。这把「resume 重计费尖峰」从隐性超付变成显式决策输入。

### 5.4 jsonl 写完整性与截断恢复(承接 02 §7.3)

- **append-only 单行原子性**:`encodeJsonlLine`(02 §7.2)产出 `JSON.stringify(...) + '\n'`,`fs.appendFile` 单行追加。崩在两行之间 → 前面全完整;崩在一行中间 → 末行残缺。
- **末行残行**:`recoverRun` 步骤 2 读到末行 decode 失败即丢弃(D7 / 02 §7.3),前面完整行即权威。损失至多「最后一条未写完的消息」,不影响已闭合轮。
- **中间行损坏(罕见,如磁盘坏块)**:取舍——**保守恢复到第一个损坏行之前**,而非跳过损坏行继续(跳过会让投影出现「空洞」,round 归桶错位)。第一个中间损坏行之后的全丢,`RUN_RECOVERY_FAILED` 降级为「部分恢复 + 告警」,让用户决定是否接受。这是 D7「不伪造」的延伸:宁可少恢复,不拼凑可疑状态。
- **写失败前置**:P11 体检验 `runs/` 可写 + 余量;运行期写 jsonl 失败(磁盘满)→ 立即抛 `RUN_RECOVERY_FAILED` 前置错误(写不进 = 失去权威源,等于盲跑),受控停 run 而非继续(D8 不吞错)。
- **fsync 取舍**【待实测】:默认 `appendFile` 不强制 fsync(性能);断电可能丢 OS 缓冲里的最后几行。本地单机可接受(损失末几条对话,重放仍得完整轮)。若需更强持久性,可在 `round_closed`(轮边界)处 fsync,平衡性能与「最多丢一轮内未刷盘的消息」。M1 实测 fsync 开销后定。
- **fsync 的成本维度(ROC-m2,诚实标注)**:断电丢的末几行可能含 `round_closed.usage` / turn usage——这些 token 是**真花出去的钱**(中转已计费),但丢行后 sylux 的累积 usage 投影(15 O6 从 jsonl 重建)会少算它们。后果不只是「丢对话」,而是「丢了花掉没记的钱」:恢复后 B3 预算判定基于**偏低的累积**,账面比实际花费低,追账失真且更隐蔽(钱花了不知道)。故 `round_closed` 边界 fsync 不仅保「最多丢一轮对话」,更保「成本入账最多差一轮」。**运维要求**:恢复后若 `truncatedTailDropped=true`(§5.2),面板/日志显式提示「末轮成本可能未入账,实际花费略高于账面,B3 预算余量按偏宽估计」——对齐 D8 不吞错,把已知残余风险的成本面摊开,而非只回应「worktree 改动不丢」(§9.1 A3 旧回应只覆盖了对话面)。

### 5.5 `runs/` 扫描、保留策略与 `sylux gc`

```ts
// 扫描 runs/ 找可恢复 run(preflight P10 / sylux recover --all 用)
export interface RunSummary {
  runId: string; playbookId: string; status: RunStatus;  // 从 jsonl 首行 + 末 status_changed
  lastTs: number; intactRounds: number; recoverable: boolean;
}
export function scanRuns(runsDir: string): RunSummary[];
```

- **扫描**:只读每个 `<runId>.jsonl` 的首行(`run_started`)+ 反向找末个 `status_changed`,**不全量重放**(快;全量重放只在真 recover 时做)。`recoverable = 末态非终态`。
- **保留策略**(`sylux gc`):
  - 终态(done/stalled/aborted/limit)的 jsonl 默认保留 N 天(可配),供审计/回放;超期归档或删。
  - 未终态但已无对应 worktree(已被清/orphan)的「僵尸 run」→ gc 标记,提示用户 recover 或丢弃。
  - worktree orphan 回收(09 §8.4):`sylux gc` 触发 `orphan-gc`(Win 文件锁导致删除失败的 worktree,下次重试 `git worktree remove --force` + `prune`),不重写 09 实现,只编排调用。
- **备份**(D3):备份 = 拷 `runs/` + `sylux.config.yaml`(密钥不备,从 keychain 重下发,§3.3)。恢复到新机:还原 `runs/` → `set-keys.ps1` → `sylux recover --all`。worktree **不**备份(运行期产物,recover 时按 jsonl 重建,09 §3.3 幂等)。

### 5.6 灾备 runbook(中枢崩了怎么办)

```
1. 看 logs/ 末几行:确认崩因(OOM / 未捕获异常 / 被杀)。fatal 级日志是中枢落地前最后一条(15 §2.5)
2. sylux recover --last        # 或 --run <id> / --all
     ├─ action=finalized → run 本已收尾,仅清 worktree,无需续跑
     ├─ action=resumed   → 已按 resumePlan 续接,run 回到 running(看面板)
     └─ action=manual    → 预算近尽/sessionId 缺失,按提示决定 resume 还是 fresh
3. 若 RUN_RECOVERY_FAILED(jsonl 损坏)→ 看 truncatedTailDropped / 部分恢复提示;
     最坏:该 run 不可续,worktree 仍在(diff 可人工捞改动),起新 run
4. 子进程孤儿(中枢崩但 codex/claude 还活)→ sylux gc 会 kill 残留 + 回收 worktree(09 §8.4)
5. 恢复后跑一次 sylux doctor 确认环境仍健康(§2.4)
```

---

## 6. 升级与 codex/claude 版本漂移应对(D5)

### 6.1 为什么版本漂移是头等运维风险

sylux 的全部 spawn / 事件流 / schema 假设都建立在**实测的 CLI 行为**上(事实地基 A–F,codex-cli 0.141.0)。但 codex/claude 是**外部独立升级**的二进制——用户某天 `npm update` 或它们自动升级,行为可能漂移:

| 漂移面 | 事实地基依据 | 漂移后果 | 探测手段 |
|---|---|---|---|
| 事件流字段名 | B:`thread.started.thread_id`(非旧版 `session_meta.payload.id`) | 抓不到 sessionId → 永远不可 resume | §6.2 探针对录制基线 |
| output-schema 成形 | C:`--output-schema <FILE>` 经中转能强制成形 | schema 不被遵守 → safeParse 失败率飙升 | §6.2 探针 + 运行期 retry 率 |
| resume 参数集 | E:resume 拒 `-s`/`-C`,需 `--skip-git-repo-check` | resume 命令拼错 → 续接失败 | §6.2 `resume --help` diff |
| claude flag | F:`--json-schema` 内联 / `--append-system-prompt` 等 | flag 改名/移除 → 注入/schema 路径断 | §6.2 `--help` diff |
| token usage 字段 | D:`turn.completed.usage` | 字段变 → 成本计量缺源;**配了预算时成本硬刹车失明**(§6.3.1 条件 critical,15 A2) | §6.2 探针解析录制流 |

> 这正是任务简报点名的「升级与 codex/claude 版本漂移应对」。核心原则(D5):**版本变了不静默坏**——启动期探测,关键能力失配则告警 + 拒启/降级,绝不带着失配假设裸跑烧 token。

### 6.2 能力探针 `capabilityProbe`(启动期,不烧 token)

探针在 preflight P3 跑(§2.4):比对当前 CLI 行为与**锁定基线**(录制的 fixtures,13 §1.1 `fixtures/`)。

```ts
// @sylux/server/src/deploy/capability-probe.ts
export interface CliBaseline {
  agent: 'codex' | 'claude';
  versionRange: string;             // 验证过的版本窗(如 'codex 0.141.x')
  /** 关键能力断言:探针逐项验证。失配按 severity 处置。 */
  capabilities: CapabilityAssertion[];
}
export interface CapabilityAssertion {
  id: string;                       // 如 'event.thread_started.thread_id'
  severity: 'critical' | 'degradable';
  probe: (ctx: ProbeCtx) => Promise<boolean>;
}

export interface ProbeResult {
  agent: 'codex' | 'claude';
  version: string;
  inRange: boolean;                 // 版本在 baseline.versionRange 内?
  failed: { id: string; severity: 'critical' | 'degradable' }[];
  verdict: 'pass' | 'drift-warn' | 'drift-block';
}

/** 启动期探针。不真烧 token:用 --help/--version 文本 diff + 对录制 fixtures 重放解析。 */
export async function capabilityProbe(agent: 'codex' | 'claude', baseline: CliBaseline): Promise<ProbeResult>;
```

探针手段(分级,都**不烧真 token**):

| 手段 | 验什么 | 成本 |
|---|---|---|
| `--version` | 版本号是否在锁定窗 | 0(本地) |
| `--help` / `resume --help` 文本 | flag 集是否变(F/E:`--json-schema`/`--append-system-prompt`/resume 拒 `-s`) | 0(本地) |
| 对 `fixtures/` 录制 JSONL 重放解析 | 事件流字段(B:`thread.started.thread_id`、`turn.completed.usage`)解析器是否仍命中 | 0(读录制) |
| 【可选,M0/手动】真跑一次最简 prompt | output-schema 实际成形(C) | 烧 ~18.7k token(事实 D 底价)——**绝不进自动 preflight/CI**(硬约束,§6.4),仅显式 `sylux doctor --deep` + 二次确认 + 进程级日预算计数 |

判定与处置(D5):

| verdict | 条件 | 处置 |
|---|---|---|
| `pass` | 版本在窗 + 全能力命中 | 正常启动 |
| `drift-warn` | 版本超窗但能力仍命中,或仅 `degradable` 失配(如未配预算时 usage 字段变 → 成本曲线瘸腿但能跑) | 启动 + 横幅告警「CLI 版本漂移,部分能力降级,建议锁回基线」;`CLI_VERSION_DRIFT`(warn) |
| `drift-block` | 任一 `critical` 能力失配(事件流抓不到 sessionId / resume 参数断 / schema 不成形),**或条件 critical 命中**(配了预算却 usage 字段失配,§6.3.1) | **拒启**(P3 block);提示锁回基线版或更新 fixtures + 重测;预算模式 usage 失配额外提示「拒绝在预算模式下裸跑」;`CLI_VERSION_DRIFT`(block) |

### 6.3 关键能力断言清单(critical vs degradable)

| 能力 id | severity | 失配后果 | 事实依据 |
|---|---|---|---|
| `event.thread_started.thread_id` | critical | 拿不到 sessionId,resume 全断(02 I5) | B |
| `flag.exec.output_schema_file` | critical | schema 无法强制(codex 文件路径) | C |
| `flag.resume.rejects_sandbox` | critical | resume 拼 `-s` 报错,续接全失败 | E |
| `flag.resume.needs_skip_git_check` | critical | 非信任目录 resume 报错 | E |
| `event.turn_completed.usage` | **条件 critical**(配了 `maxCostUsd`/`maxTotalTokens` 时)/ degradable(未配预算时) | 配预算:成本硬刹车失明 → 拒启;未配:仅成本曲线展示瘸腿(标 usage_missing,15 M2),能跑 | D |
| `claude.flag.json_schema_inline` | degradable | 退 stream-json 传 schema(12 §3.4 备选) | F |
| `claude.flag.append_system_prompt` | degradable | 角色注入退化为 prompt 内拼(无独立系统提示) | F |

> critical = 项目命门,失配则核心循环(身份/续接/对齐)崩,必须拒启。degradable = 有降级路径,失配则告警 + 走备选,不拒启。这个分级是 D5 的可操作化:不是「版本一变就拒」,而是「关键能力断了才拒,可降级的降级跑」。

### 6.3.1 `usage` 的条件 critical:成本刹车依赖它(ROC-M1)

`event.turn_completed.usage`(事实地基 D:`turn.completed.usage` 是 token 计量唯一来源)不能简单划 degradable——因为它**直接喂 04 的真金白银硬刹车**(`maxCostUsd`/`maxTotalTokens`),而不只是「成本曲线展示」。失配后果按**用户是否依赖它做硬刹车**分叉:

| 配置状态 | usage 字段失配处置 | 理由 |
|---|---|---|
| 启用了 `maxCostUsd` 或 `maxTotalTokens`(16 §6)——即用预算做硬刹车 | **critical → drift-block 拒启**;提示「成本刹车依赖 usage,当前 CLI 版本 usage 字段失配,拒绝在预算模式下裸跑」 | usage 失配 = 成本刹车失明,严重度等同「刹车失灵」,不该与 `--append-system-prompt` 退化同列 degradable |
| 未配任何 token/费用预算(纯靠 maxRounds/墙钟兜底) | degradable → drift-warn 可启;标 `usage_missing`(15 M2) | 此时 usage 只用于成本曲线展示,失配仅观测降级,不影响安全网 |

为什么必须条件化(反例):假设某次 codex/claude 升级把 `turn.completed.usage` 改名/改结构(§6.1 明列此漂移面),若仍按 degradable 放行——此后每轮真实 usage 拿不到,04 BudgetPolicy 只能用 `BASELINE_INPUT_PER_ROUND(18.7k)×轮数` 地板兜底(04 §6.4 H-USAGE)。但 18.7k 是 codex **最简回合**底价(事实 D);真实一轮(长 prompt + reasoning 模型 + resume 累积)可能 5–10×。于是 ① `maxTotalTokens` 按地板永远远低于真实,**B3 token 顶永不触发**;② `maxCostUsd` 由 `usageToUsd(flooredUsage)` 算,地板 input + output 当 0(reasoning 模型 output 占比恰恰高)→ 估费严重偏低,**用户设的 $12 上限挡不住真实 $40+**。整条「宁可早刹不可漏刹」的兜底,在 output/reasoning 维度其实是「漏刹」。

**配套的运行期防护(跨 04/15 协调,本文件提要求)**:

1. **04 §6.4 费用兜底改为高估而非置零**(回填 04):usage 缺失时 `maxCostUsd` 判定不能让 output=0,改 `output ≈ input×0.3`(含 reasoning 的保守估)算费,宁可高估早刹;且 `maxTotalTokens` 地板从 `18.7k×轮数` 抬到含 resume regime 的保守上界(对齐 ROC-m1 的 `predictNextRoundInputTokens`),不拿最简底价当真实。
2. **连续缺失即转 paused**(不带失明刹车裸烧):usage **连续 N 轮缺失**(默认 N=2)→ 抛 `TOKEN_BUDGET_EXCEEDED` 或直接转 `paused`(15 M2),不允许带着失明的成本刹车无限跑。
3. **15 增 `usage_missing_streak` 指标 + 告警**(回填 15):连续缺失即面板红字「成本计量已失效,预算刹车不可信」;单轮偶发缺失只 warn 不升级。

> 这条把「能力分级」与「用户是否依赖该能力做安全决策」绑定——同一个字段,纯展示用途时可降级,喂硬刹车时是命门。preflight P3(§2.4)读 `SyluxConfig.stop` 判断是否启用了预算,据此决定 usage 断言走 critical 还是 degradable 分支。

### 6.4 版本锁定与升级 runbook

- **锁定基线**:`fixtures/` 录制注明 CLI 版本(13 §1.1:文件名带 `0.141.0`);`CliBaseline.versionRange` 与之对齐。基线是探针的「真值」。
- **codex/claude 升级不是 sylux 的自动行为**:sylux 只 spawn 它们,不 `npm update` 它们(D5 / 12)。用户主动升级后,sylux 探针在下次启动发现漂移。
- **升级 runbook**(用户升了 codex/claude 之后):

```
1. sylux doctor             # P3 探针自动比对基线
     ├─ pass      → 直接用
     ├─ drift-warn → 看告警:degradable 失配可接受则继续;否则锁回基线版
     └─ drift-block → critical 失配,不可用当前版本:
2. 选择:
     (a) 锁回基线版:npm i -g @openai/codex@0.141.0 --registry npmmirror(记忆 npm-mirror)
     (b) 适配新版:录新 fixtures(真跑录 JSONL,13 §12.2)→ 更新 baseline + 解析器 →
                  跑 02 V1–V20 + 05/06 适配层测试 → 全绿才更新 versionRange
3. sylux doctor --deep      # (可选)真烧一次最简 prompt 验 output-schema 成形(C);见下方 §6.4.1 成本护栏
4. 适配新版属带测试的独立任务(类比 12 §4.2 zod 升级纪律),不顺手做
```

#### 6.4.1 `--deep` 探针的烧钱护栏(ROC-M4,硬约束)

`sylux doctor --deep` 真跑一次最简 prompt 验 output-schema 成形(C),固定吃 ≈18.7k token/agent(事实 D)。这是个会花真钱的探测点,**必须有护栏防误触/防 CI 滥用**(对齐总体烧钱纪律,类比 07 §8.5 V6「cli 探测仅手动触发」):

| 护栏 | 规则 | 理由 |
|---|---|---|
| **默认不 deep** | `sylux doctor` 默认只跑本地探针(--help/--version/重放 fixtures,0 token);`--deep` 须显式传 | preflight/CI 默认零烧钱(§2.4「不烧 token」是体检硬性质) |
| **绝不进自动 preflight/CI**(硬约束,非建议) | `sylux run` 内联 preflight **永不**触发 deep;CI 流水线**禁**调 `--deep`(13 CI 不烧 token);违反即 review 拦 | 否则每次 push/每次 run 烧 18.7k×agent 数,B3 之外的隐性烧钱口 |
| **二次确认 + 成本横幅** | `--deep` 启动打印「本次将消耗 ≈18.7k token × <agent 数> ≈ <估算>,继续?(--yes 跳过)」 | 防手滑;UI 端同款二次确认(对接面板「验 key」按钮文案,07 §8.5) |
| **进程级日预算计数** | `--deep` 与面板「验 key」共享一个进程级**日 token 预算计数器**(默认上限可配),超额拒绝 + 提示「今日探测预算已用尽」 | 防脚本循环误烧(连点 10 次 = 187k);把「手动也要防滥用」补上 07 V6 缺的那半 |
| **面板「验 key」节流** | 同 provider 60s 内只允许一次 cli 探测(07 §8.5 有文案无节流,本文件补节流要求) | 防连点叠加烧钱 |

> 原则:**任何固定烧 ≈18.7k 的探测点都不得自动化、不得无护栏手动触发**。`--deep` 是「升级后人工验一次」的工具,不是「每次启动跑一遍」的体检项——§2.4 preflight P3 用的是本地零烧钱探针(重放 fixtures),deep 只在用户显式要求且确认成本后才真烧。

- **sylux 自身升级**(拉新仓库代码):走 `bootstrap.ps1`(§2.6)重装 + 重建 + `doctor`;`pnpm-lock.yaml` 入库保证依赖可复现(13 §7.1)。配置 schema 演进有 `CONFIG_SCHEMA_VERSION`(16 §1.3)+ 迁移分支;黑板契约演进有 `SCHEMA_VERSION`(02 §1.2)+ jsonl 迁移(02 §7.4)——旧 `runs/` 在新版本下经迁移仍可重放(灾备连续性,D3)。
- **Node 升级**:Node 升大版本(23+)→ §2.2 探针 warn,需重测 spawn(事实 A)+ 内置 WebSocket;不在锁窗内不自动信任。

### 6.5 漂移与灾备的交叉(升级后旧 run 还能 recover 吗)

升级后恢复旧 run 的兼容性矩阵:

| 升级了什么 | 旧 `runs/` 可重放? | 旧 sessionId 可 resume? |
|---|---|---|
| sylux 代码(配置/契约 schema +1) | ✅ 经迁移分支(02 §7.4 / 16 §1.3) | ✅ sessionId 是外部 id,迁移不动它 |
| codex/claude(版本漂移) | ✅ jsonl 是中枢写的,与 CLI 版本无关(D3) | ⚠ 取决于 CLI 是否仍认旧 sessionId——【待实测】跨版本 thread/session 兼容性;不兼容则降级 fresh(§5.3) |
| Node | ✅ jsonl 纯数据 | ✅ 不涉及 |

> 灾备的稳健性正源于 **jsonl 与 CLI 解耦**(D3):jsonl 是中枢按 02 契约写的纯事件流,不含 CLI 版本相关的二进制态。CLI 升级最多让 **resume 续接**失效(降级为 fresh 新会话从 jsonl 上下文继续,§5.3),但**重放重建 BoardState** 永远可行。这是「状态唯一权威是 jsonl」对版本漂移的天然防护。

---

## 7. 部署/恢复相关错误码(新增 + 回填,语义补 15 §6)

> **定义权威在 02 §12**(`SyluxErrorCode` union + `SyluxError` 类,落 `@sylux/shared/errors.ts`)。本节列本文件**需新增回填**的码 + 复用的现有码,**不在此另定义 union**(焊死 R1)。新增码均为 union 加成员(向后兼容,非破坏性,02 §1.2);语义同步补进 15 §6 表 + `ERROR_LEVEL`/`errEvtFor`(15 §6.7)。

### 7.1 本文件需新增的错误码(回填 02 §12 + 15 §6)

| 错误码 | 触发(本文件) | 终态? | level | 处置 |
|---|---|---|---|---|
| `NODE_RUNTIME_UNSUPPORTED`【新增】 | preflight P0:Node < 22.13(§2.2) | 是(run 起不来) | error | 拒启,remedy 提示装 Node 22;detail 含实测版本(非 secret) |
| `CLI_VERSION_DRIFT`【新增】 | preflight P3:CLI 版本超窗 / 能力探针失配(§6.2) | 是(critical 失配)/ 否(degradable warn) | error(block)/ warn(drift) | critical 拒启;degradable 告警降级跑 |
| `RUN_RECOVERY_FAILED`【新增】 | jsonl 损坏不可重放 / 首行非 run_started / `runs/` 不可写(§5.2/§5.4) | 是(该 run 不可续) | error | 部分恢复 + 告警;worktree 仍在供人工捞 |

```ts
// 需回填 02 §12 SyluxErrorCode union(向后兼容新增成员,§1.2 同 02 演进纪律):
//   | 'NODE_RUNTIME_UNSUPPORTED'  // 部署:Node 版本不在锁定窗(§2.2)
//   | 'CLI_VERSION_DRIFT'         // 部署:codex/claude 版本漂移,能力探针失配(§6.2)
//   | 'RUN_RECOVERY_FAILED'       // 灾备:jsonl 损坏/不可写,run 不可重放(§5)
// 同步补 15 §6.1 总览表 + §6.7 ERROR_LEVEL(三者均给 level)+ errEvtFor(可复用既有 evt 或新增)。
```

### 7.2 本文件复用的现有码(只引用,不新增)

| 错误码 | 本文件触发点 | 来源 |
|---|---|---|
| `SUBPROCESS_SPAWN_FAILED` | preflight P1/P2:CLI 不可定位(§2.3) | 02 §12 / 05 |
| `PROVIDER_CONFIG_INVALID` | preflight P5:active key 不可解析;§3 密钥配置非法 | 02 §12 / 07 / 08 |
| `CONFIG_*`(NOT_FOUND/PARSE/SCHEMA/REPO/...) | preflight P4/P6:配置加载失败(§2.4) | 16 §13(已待回填 02) |
| `EGRESS_SECRET_BLOCKED` | §4.2 出境扫描命中 | 08 §8(已待回填 02) |
| `WORKTREE_GIT_FAILED` | §5 恢复期 git 操作失败 | 09 §12(已待回填 02) |
| `TOKEN_BUDGET_EXCEEDED` | §6.3.1:配了预算却 usage 连续 N 轮缺失,转 paused/拒续(不带失明刹车裸烧) | 04 §6 / 02 §12 |

> 本文件**不**新造与上述语义重叠的码。例如 CLI 定位失败复用 `SUBPROCESS_SPAWN_FAILED`(而非新增 `CLI_NOT_FOUND`),因为它和首次 spawn 失败是同一根因面(事实 A),15 §6.2 已能区分「配置问题 vs 运行时崩溃」。新增的三个码是现有体系确实缺失的维度(运行时版本 / CLI 漂移 / 重放失败)。

### 7.3 错误 detail 脱敏(承接 08 §3.4 / D8)

部署/恢复错误的 `detail` 常带环境信息(路径、版本、env 变量名),序列化前必过 `redactObject`(08 §3):
- `NODE_RUNTIME_UNSUPPORTED`:detail 给版本号(非 secret,可留)。
- `PROVIDER_CONFIG_INVALID`(P5):detail **只给 ref 名 / envVar 名**,绝不含解析值(D2 / 08 T9 / 07 §2.3)。
- `RUN_RECOVERY_FAILED`:detail 给 runId / 损坏行号 / 损坏类型,**不**回显损坏行原文(可能含 redact 漏网的内容)。
- `CLI_VERSION_DRIFT`:detail 给 agent / 实测版本 / 失配能力 id 列表(均非 secret)。

---

## 8. 测试矩阵(交付验收锚点,对接总体 §12 / 02 §13 风格)

| # | 用例 | 输入 / 动作 | 期望 |
|---|---|---|---|
| **preflight / 运行时** | | | |
| DP1 | Node 版本闸 | `process.versions.node='20.x'` | P0 block,`NODE_RUNTIME_UNSUPPORTED`,remedy 含「装 Node 22」 |
| DP2 | Node 跨大版本 | `'23.x'` | P0 warn(可启),横幅提示未验证 |
| DP3 | codex 不可定位 | 平台包 vendor bin 缺 | P1 block,`SUBPROCESS_SPAWN_FAILED`,remedy 重装 |
| DP4 | preflight fail-fast | 任一 block 项失败 | 不 spawn 子进程、不建 worktree(D1);返回 blocking 列表 |
| DP5 | P5 key 不回显 | active key env 未设 | block,`PROVIDER_CONFIG_INVALID`,detail 仅 ref/envVar 名,无值(D2) |
| DP6 | repoRoot 非 git | 普通目录 | P6 block,`CONFIG_REPO_INVALID` |
| DP7 | git < 2.38 | 旧 git | P7 warn(退化方案,09 §5.3),不 block |
| DP8 | 横幅 egress 知情 | third_party provider | 横幅打 ⚠ base_url 行(D9);全官方则打 ✓ 行 |
| **密钥存储** | | | |
| DP9 | 配置无 key 值 | grep sylux.config.yaml | 零命中 sk-(D2/K1) |
| DP10 | set-keys 不留痕 | 跑 set-keys.ps1 | env 已设;history/argv 无密钥值;不写临时文件 |
| DP11 | .env 入双名单 | 检查 .gitignore/.syluxignore | .env 命中两者 + SENSITIVE_PATH(§3.4) |
| **出境合规** | | | |
| DP12 | 出境扫 third_party | guardEgress 内容含 sk- | `EGRESS_SECRET_BLOCKED`,片段不出境,run 不停(§4.2) |
| DP13 | 官方直连跳扫 | egressClass=official | guardEgress 跳过(§4.2) |
| DP14 | .syluxignore 拦 | 出境路径在黑名单 | 拦截,占位替代 + system 告警 |
| DP15 | egress-check 干跑 | `sylux egress-check` | 报会出境/被挡文件清单,不起 run(§2.7) |
| **灾备恢复** | | | |
| DP16 | 重放重建 | 完整 jsonl | BoardState 投影正确(messages/rounds/agents/status,02 §7.3) |
| DP17 | 末行截断 | 末行残缺 | 丢残行,truncatedTailDropped=true,前行不受影响(D7/02 §7.3) |
| DP18 | 首行损坏 | 首行非 run_started | `RUN_RECOVERY_FAILED`,不猜(D7) |
| DP19 | 中间行损坏 | 中段坏块 | 恢复到损坏前 + 告警,不跳过续拼(§5.4) |
| DP20 | recover 幂等 | 同 runId 连跑两次 recover | 收敛同一状态,无重复 worktree/tag(D6) |
| DP21 | 终态免 resume | 末态=done | action=finalized,仅清 worktree |
| DP22 | 无 sessionId 不 resume | jsonl 无 agent_session | resumePlan mode=fresh(02 I5/§5.3) |
| DP23 | 预算近尽转人工 | resume + 累积近 budget | action=manual(§5.3,事实 D) |
| DP24 | 孤儿子进程回收 | 中枢崩,CLI 仍活 | `sylux gc` kill + 回收 worktree(09 §8.4) |
| **版本漂移** | | | |
| DP25 | 事件流字段失配 | fixtures 改 thread_id 字段名 | critical 失配,`CLI_VERSION_DRIFT` block(§6.3) |
| DP26 | usage 失配 + 未配预算 | 录制流缺 usage,cfg 无 maxCostUsd/maxTotalTokens | degradable,drift-warn 可启(§6.3.1) |
| DP26b | usage 失配 + 配了预算 | 录制流缺 usage,cfg 设 maxCostUsd | **条件 critical → drift-block 拒启**,提示「拒绝在预算模式下裸跑」(§6.3.1/ROC-M1) |
| DP26c | usage 连续缺失转 paused | 运行期 usage 连续 N 轮缺失 | 转 paused / `TOKEN_BUDGET_EXCEEDED`,`usage_missing_streak` 告警(§6.3.1) |
| DP27 | resume flag 漂移 | resume --help 不拒 -s | critical 失配,block |
| DP28 | 探针不烧 token | capabilityProbe | 仅 --help/--version + 重放 fixtures,无真调用 |
| DP29 | 升级后重放旧 run | sylux 契约 +1 后旧 jsonl | 经迁移分支可重放(§6.5/02 §7.4) |
| DP30 | 升级后 sessionId | CLI 升级后旧 sessionId | resume 失败则降级 fresh,重放仍成功(§6.5/D3) |
| DP31 | `--deep` 不自动化 | `sylux run` / `sylux doctor`(无 --deep) | 不触发真 prompt 烧 token;deep 仅显式 `--deep` 触发(§6.4.1/ROC-M4) |
| DP32 | `--deep` 日预算护栏 | 同进程连续多次 `--deep` 超日预算 | 超额拒绝 + 提示「今日探测预算已用尽」(§6.4.1) |
| DP33 | resume 含首轮尖峰判定 | 崩溃前累积有余量但 +resume首轮预测超预算 | 转 fresh/manual,不裸按累积判可 resume(§5.3/ROC-m1) |
| DP34 | 截断丢行成本提示 | truncatedTailDropped=true | 面板/日志提示「末轮成本可能未入账」(§5.4/ROC-m2) |

> **验收硬锚点**:DP4(fail-fast 0 副作用)、DP5/DP9/DP10/DP11(密钥不泄,D2)、DP12/DP14(出境拦截,D4)、DP16/DP17/DP20(灾备重放+幂等,D3/D6/D7)、DP25/DP27(critical 漂移拒启,D5)。这几条不过,部署运维层不算交付。

---

## 9. 红队自检(对抗性审查,交付前自己先挑刺)

| # | 质疑 | 回应 |
|---|---|---|
| A1 | 「preflight 查一堆,但用户机器环境千变万化,体检过了 run 起来照样可能崩,体检意义何在?」 | preflight 不保证「一定不崩」,只保证「**已知的外部前提**不缺」——Node 版本、CLI 可定位、key 可解析、repoRoot 是 git 仓。这些是**确定性可查**的失败面(占运维事故大头),提前 fail-fast 比「跑到第七轮才发现 key 没设」省 token、省时间。运行期才暴露的(中转半路挂)由 05/07 失败路径接,不归 preflight。体检是「把可提前发现的提前发现」,不是「证明不崩」。 |
| A2 | 「密钥下发到会话 env,但 env 对所有子进程可见,`buildChildEnv` 白名单真挡得住吗?中枢自己的 env 不就全漏给 codex 了?」 | 正中 08 S2:`buildChildEnv` 是 default-deny **白名单**(08 §2.2),只下发 `BASE_ENV_ALLOWLIST` + 该 agent 的 `providerEnv`,`extendEnv:false`——中枢会话里的 `SYLUX_KEY_*` **不在白名单**,不会漏给子进程;子进程只拿到它自己 provider 的那一个 key。会话 env 可见性的风险面是「同会话其他进程」,本地单机已沦陷才有威胁(08 §5.5 残余,OS 账户隔离负责),超本项目威胁模型。 |
| A3 | 「灾备说 jsonl 是唯一权威,但 worktree 里 agent 改的文件不在 jsonl 里,崩了那些改动不就丢了?」 | 不丢。jsonl 记的是**对话与 evidence 锚点**(消息/round/usage/status);agent 的文件改动在 **worktree**(git 分支,09)。崩溃后 worktree 还在(§5.6 step3:diff 可人工捞),`recoverRun` 重建对话状态 + worktree 幂等重入(09 §3.3),改动通过 git 分支保留。两者分工:jsonl 管「编排状态」,git worktree 管「文件改动」,各自持久化。备份 §5.5 也说明 worktree 不备份是因为它由 git 管理(本身可恢复),不是因为不重要。 |
| A4 | 「resume 决策树太复杂,而且事实 D 说 resume 不省 token,那为什么还 resume?直接全 fresh 不更简单更省?」 | fresh 也不免费:fresh 要把 jsonl 重建的上下文重新喂一遍,同样烧 input token(可能比 resume 还多,因为要把历史压进 prompt)。resume 的价值是「CLI 端还记得上下文,少喂历史」;fresh 的价值是「丢掉冗长历史,只喂精简结论」。哪个省取决于历史长度与压缩比——这正是决策树要权衡的(§5.3),不是无脑选一边。简化成「全 fresh」会在长历史 run 上更贵。 |
| A5 | 「能力探针靠录制的 fixtures 当基线,但 fixtures 是某一次录的,中转那次刚好正常,探针对着一个可能本就不全的基线比,有意义吗?」 | 部分成立。fixtures 是「已验证可用」的快照(13 §12.2,M0 真录),不是「理论完备」。探针验的是「当前 CLI 行为 vs 上次验证可用时的行为」是否漂移——这对「升级导致的回归」有效(DP25/DP27),对「基线本身有 bug」无效(那是 M0 录制质量问题,不归探针)。残余风险:基线录得不全则探针有盲区。缓解:critical 断言清单(§6.3)聚焦项目命门字段(thread_id/usage/resume flag),这些 M0 已实测(事实 B/D/E),基线可信度高。`--deep`(§6.4)真跑补强 output-schema(C)这类录制难覆盖的。 |
| A6 | 「`sylux gc` 删 `runs/` 旧 jsonl,但那是灾备权威源(D3),删了不就没法回放了?和 D3 矛盾。」 | 不矛盾。gc 只删**终态**(done/stalled/aborted/limit)且超保留期的 run(§5.5)——它们已收尾,回放价值是审计而非恢复,超期归档/删是正常生命周期管理。**未终态(可恢复)的 run 永不被 gc 删**(§5.5:僵尸 run 只标记提示,不自动删)。D3「jsonl 是权威」针对的是「活着/可恢复的 run」,不是「已结束 N 天的历史」。保留期可配,要永久审计就设大。 |
| A7 | 「Windows 优先,脚本全是 .ps1,但 PowerShell 执行策略默认可能禁脚本,用户跑 bootstrap.ps1 直接被 ExecutionPolicy 挡,第一步就崩。」 | 真实运维坑。对策:文档/README 明确首次需 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`(或 `powershell -ExecutionPolicy Bypass -File bootstrap.ps1` 单次绕过);`bootstrap.ps1` 顶部注释写明。这是 Windows 部署的已知前置,记入 openQuestion(是否提供 .cmd 包装绕过 ExecutionPolicy)。不影响设计,属文档/引导完善项。 |
| A8 | 「`usage` 字段失配你标 degradable 还能跑,但成本硬刹车全靠 usage——CLI 一升级改字段,$12 上限就成摆设,这不是观测降级是刹车失灵。」 | 正中 ROC-M1,已改:usage 不再无条件 degradable,而是**条件 critical**(§6.3.1)——配了 `maxCostUsd`/`maxTotalTokens` 时 usage 失配视为 critical 直接拒启(「拒绝在预算模式下裸跑」),未配预算才退 degradable(纯展示)。配套:04 费用兜底改高估(output≈input×0.3 含 reasoning,不置 0)、连续 N 轮缺失转 paused、15 加 `usage_missing_streak` 红字告警。严重度与「用户是否依赖它做安全决策」绑定,不再与 `--append-system-prompt` 退化同列。 |
| A9 | 「`--deep` 烧 18.7k 你说『不进自动 preflight』,但那只是建议,CI 把它塞进每次 push 谁拦?面板验 key 连点 10 次谁拦?」 | ROC-M4,已从建议升为硬约束(§6.4.1):`sylux doctor` 默认不 deep、`sylux run`/CI **永不**触发 deep(review 拦)、`--deep` 须显式 + 二次确认 + 成本横幅、进程级日 token 预算计数(超额拒绝)、面板验 key 同 provider 60s 节流。把 07 V6 缺的「手动也要防滥用」补齐。 |

### 9.1 残余风险(诚实标注)

- **同机进程可见 env / 连 127 WS**:本地单机威胁模型下,同机恶意进程已超出防护范围(08 §5.5),靠 OS 账户隔离。
- **中转方可见放行后内容**:`guardEgress` + `.syluxignore` 只挡「不该出的」,放行的源码中转方仍可见(08 T4 本质)——唯一根治是官方直连(§4.4)。
- **fsync 未强制**:断电可能丢末几条未刷盘消息(§5.4),本地单机可接受;强持久性需 round 边界 fsync,M1 实测开销后定。丢行不止丢对话,还丢「花了没记的钱」(末轮 usage 未入账 → 恢复后账面低于真实花费),恢复后 `truncatedTailDropped` 时显式提示「末轮成本可能未入账」(§5.4 ROC-m2)。
- **CLI 跨版本 sessionId 兼容性**【待实测】:升级后旧 sessionId 能否 resume 未验(§6.5),不兼容则降级 fresh(不影响重放)。

---

## 10. 收尾:本文件权威性声明与开放问题

### 10.1 权威声明

1. **本文件拥有(权威,他文引用)**:`preflight` 体检全集与 fail-fast 闸(§2.4)、Node 版本锁定窗 `NODE_RANGE`(§2.2)、引导/密钥下发/体检脚本骨架(§2.6/§3.3/§2.7)、密钥物理存储与下发运维规则(§3)、出境扫描调用点与 `.syluxignore` 维护流程(§4)、崩溃恢复编排 `recoverRun` 与 resume 决策树(§5.2/§5.3)、`runs/` 保留与 gc 策略(§5.5)、能力探针 `capabilityProbe` 与漂移分级(§6.2/§6.3)、升级 runbook(§6.4)。落 `@sylux/server/src/{deploy,recover,egress}` + `scripts/`。
2. **引用而非另写**:`apiKeyRef`/`KeyStore`→07;`buildChildEnv`/`SECRET_SIGNATURES`/`guardEgress`/`redact`/`.syluxignore` 规则→08;`SyluxConfig`/`loadSyluxConfig`→16;jsonl 行/投影→02 §7/§10;worktree `create`/`cleanup`/orphan→09;`resolveCodexExe`/`resolveClaudeCli`→12 §3.3/05;选型版本锁→12;日志/指标/错误码语义→15。本文件不重定义任何上述类型/规则。
3. **回填项(本文件相对他文,均向后兼容新增)**:
   - **02 §12**:新增三个错误码 `NODE_RUNTIME_UNSUPPORTED` / `CLI_VERSION_DRIFT` / `RUN_RECOVERY_FAILED`(§7.1;union 加成员,非破坏性)。
   - **15 §6**:为上述三码补语义表 + `ERROR_LEVEL`(§6.7 Record 穷举,漏补则 TS 编译报错)+ `errEvtFor`;另新增 `usage_missing_streak` 指标 + 连续缺失告警「成本计量已失效,预算刹车不可信」(§6.3.1 ROC-M1)。
   - **04 §6.4**:usage 缺失时费用兜底改高估(`output≈input×0.3` 含 reasoning,不置 0)、`maxTotalTokens` 地板抬到含 resume regime 的保守上界;usage 连续 N 轮缺失转 paused/抛 `TOKEN_BUDGET_EXCEEDED`(§6.3.1)。§5.3 resume 预算判定引用 `predictNextRoundInputTokens`(04 §6.2)算 resume 首轮尖峰(§5.3 ROC-m1)。
   - **13 §1.1**:`scripts/`(bootstrap/set-keys/doctor)随仓分发,确认目录树补该项;`.syluxignore.example` 与既有 `.syluxignore` 占位对齐。
   - **16**:preflight 与 `loadSyluxConfig` 的调用顺序(先 load 后 preflight P4 复用其结果),确认 server 启动序列对齐。
4. **遵守 R8(部署侧)**:密钥永不入配置/jsonl/日志/仓库(D2)、出境前 secret scan + `.syluxignore`(D4)、知情 + 官方直连(D9),与 08 焊死一致。
5. **演进纪律**:CLI 升级适配是带测试的独立任务(§6.4,类比 12 §4.2);新增 preflight 体检项 / 探针断言时同步补 §8 测试矩阵;配置/契约 schema 演进随 16 `CONFIG_SCHEMA_VERSION` / 02 `SCHEMA_VERSION`,旧 `runs/` 经迁移仍可重放。

### 10.2 openQuestions(交付即需用户/M0 实测裁决)

- **【待实测,M0】CLI 跨版本 sessionId 兼容性**(§6.5):codex/claude 升级后,旧 `runs/` 里落的 sessionId 能否被新版 resume?不兼容则恢复降级为 fresh(不影响重放,但 resume 续接失效)。影响灾备「升级后恢复」体验。
- **【待实测,M1】fsync 策略**(§5.4):`appendFile` 默认不 fsync,断电丢末几行;是否在 round 边界 fsync,平衡性能与持久性。需压测开销。
- **【待裁决】无人值守 / CI 场景密钥注入**(§3.3):`set-keys.ps1` 是交互会话模型;CI 或无人值守跑 sylux(若有需求)的密钥注入走什么(CI secret / 临时 token)?当前按「本地单机交互」设计,超出范围。
- **【待裁决】PowerShell ExecutionPolicy 前置**(§9 A7):是否提供 `.cmd` 包装绕 ExecutionPolicy,还是文档说明手动放行即可。
- **【待裁决】`runs/` 保留期默认值与归档形态**(§5.5):默认保留几天?超期删还是压缩归档?是否需要面板里看历史 run 列表(影响 gc 与 scanRuns 的暴露面)。
- **【待实测,M0】`--deep` 探针的 token 成本**(§6.4):真跑一次最简 prompt 验 output-schema 成形(C)固定吃 ≈18.7k(事实 D),升级后手动跑可接受;确认不混入自动 preflight(避免每次启动烧 token)。
- **【待协调】探针 fixtures 与 13 §12.2 录制资产的对齐**:`CliBaseline` 的 fixtures 来源、版本标注、更新流程需与 13 fixtures 管理统一,避免两套基线。

