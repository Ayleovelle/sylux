# 13 · Monorepo 结构与工程规范(目录树 / 包边界 / 编码·提交·分支·lint 规范权威)· v2

> **v2 变更摘要(本轮:逐条吃掉 x-consistency / x-coverage / red-* 针对本节的 findings)**:
> - **C-NUM(全仓编号双轨制,阻断级)** → §0.2 落定**文件名编号为全仓唯一权威**(安全=08、隔离/worktree=09、面板=10、WS/协议=11),并给出 §0.2 号↔盘上文件名映射总表;全文 14 处 `安全 09` 已回填为 `安全 08`,跨文引用一律"角色名 + 文件名号"双锚点。
> - **D15(安全工具包落点未定,三稿 import 路径不一)** → §1.3 据**技术栈 12 §2.4 裁决**回填:**不新增 `@sylux/security` 包**,`SECRET_SIGNATURES`/`redact`/`redactArgv`/`buildChildEnv`/`BASE_ENV_ALLOWLIST`/`firewallPeerMessage` 全部落 `packages/shared/src/security/`,由 `@sylux/shared` 统一 re-export;05 废 `@sylux/agents/proc`、06 废 `@sylux/security`,三稿统一 `from '@sylux/shared'`。规则本体仍归 08 权威,shared 只是物理宿主。
> - **依赖矩阵 agents→providers 硬冲突** → §2.1/§2.2 修:agents 合法依赖 providers(消费 `ProviderConfig`/`KeyStore`/`toCodexInjection`,见 12 §2.3、05、07),v1 矩阵误标 ✖ 已改 ✅,并对齐 12 §2.3 的权威依赖谱。
> - **引擎↔适配器环风险(交叉发现)** → §2.5 新增**注入边界裁决**:`AgentAdapter`/`AgentInput` 接口落 `@sylux/core`(引擎的注入契约),`@sylux/agents` 依赖 core 实现之;据 master §12.2「core 必须 IO 纯净、可注入 FakeAdapter 单测」焊死方向,杜绝 core↔agents 环。03/05 的接口归属需据此对齐(§13 回填项 + openQuestion)。
> - **approvedDataRoot / sylux 数据目录(08 §2.5 + 12 转交 12/13)** → §1.7 新增**仓外运行期数据目录布局**(`~/.sylux/`:auth / 每 agent CODEX_HOME / worktrees / runs / logs),并定 `approvedDataRoot` 默认值,供 08 `isInjectedPathSafe` 与 09 worktree 落地。
> - **SyluxErrorCode 补全(A1/COV-1,非本文主体)** → §5.1 增"错误码全集补全责任在 02"的显式转交 + 已知下游缺码清单指针(不在本文新增码,但点名 02 必补)。
>
> **本文件地位**:sylux 全项目的**工程组织与开发规范权威**。涵盖:pnpm workspaces 目录树、包划分与依赖边界、命名/错误处理/日志/注释规范、TypeScript 配置、lint/format/typecheck、依赖管理与供应链、Conventional Commits + commitlint、分支策略、git hooks、根/包级 scripts、CI 工作流、Windows 换行与编码约束。其他文档涉及"目录放哪/包怎么分/命名怎么写/提交怎么提/分支怎么开/lint 怎么配"时引用本文件,不另列。
>
> **与总体规划 §10/§11 的关系**:`docs/sylux-master-plan.md` §10(技术栈表)、§11(工程规范)是本文件的**摘要镜像**;本文件是 §11 的**完整展开**(补逐文件目录树、包级 package.json/exports、tsconfig project references 矩阵、eslint flat 全配置、commitlint scope 枚举、CI matrix、hooks 脚本)。二者冲突以本文件为准,并回填修正 §11。
>
> **选型不在本文件**:凡"用哪个库/锁哪个版本/装包命令"一律引用**技术栈(12)**;本文件只规定"怎么组织、怎么约束",不重定选型。
>
> **类型契约不在本文件**:凡 `Message`/`Evidence`/`AgentEvent`/`SyluxErrorCode` 等类型,一律引用**黑板协议(02)**(`@sylux/shared/src/blackboard.schema.ts`),本文件只规定其**物理落点与导出纪律**,不另写 zod 定义。
>
> **事实标注约定**:凡 `docs/PROBED-FACTS.md` 已实测的结论直接当事实用,**不再标【待实测】**;仅对本文件新引入、尚未在本机验证的工具行为(如 turbo 缓存、husky on Windows 行为)标【待实测】。

---

## 0. 规范总原则(先讲裁决标准)

工程规范不是"抄大厂模板",而是被四条项目硬约束反向约束。后文每条规则尽量回指这四条:

| # | 原则 | 来源 | 对工程规范的直接影响 |
|---|---|---|---|
| G1 | **Windows-first,换行/编码零意外** | 事实地基 A(PowerShell `>` 转 UTF-16、CRLF) | `.gitattributes` 强制 `eol=lf`、`.editorconfig`、prettier `endOfLine:lf`、contentHash 归一化(02 §9);CI 必含 `windows-latest` |
| G2 | **单向依赖、禁环、类型单一权威** | 02 §0.3 I1 / 总体 §10 | 包依赖图单向(`shared ← core ← {providers,agents} ← server ← web`),`import/no-cycle` 强制;`Message` 等类型只在 `@sylux/shared` 定义 |
| G3 | **凭证零泄漏 / 不吞错** | 红队 R8 / 安全 08 / 总体 §11.3 | 日志 redact、`no-console`、secret-scan pre-commit、自定义 `SyluxError` 带 code、禁空 catch |
| G4 | **本地单机、可锁定、可离线、渐进** | 总体 §10 / §13 里程碑 | 版本精确锁定 + lockfile 入库 + npmmirror;turbo/commitlint/双平台 CI 是 M2+ 才上,M1 不强加重型工具链 |

> 规则与 G1–G4 冲突时,规则让步。

### 0.1 任务简报包名 ↔ 权威包名映射(消歧)

立项简报里用过 `adapters` / `cli` 的说法,与锁定决策(总体 §10.721)的六包命名对齐如下,**实现一律用右列权威包名**:

| 简报别名 | 权威包名 | 说明 |
|---|---|---|
| adapters | `@sylux/agents` | 两个 CLI 子进程适配器(codex/claude),适配层文档 04/05/06 |
| cli | `@sylux/server` 内的 `bin` | commander CLI 入口与中枢进程同包(避免 server↔cli 互依赖);见 §1.6 |
| (无) | `@sylux/shared` | 黑板类型唯一权威(02) |
| (无) | `@sylux/core` | engine 循环 / Blackboard / Playbook(03) |
| (无) | `@sylux/providers` | provider 配置与热换(07) |
| (无) | `@sylux/web` | React 观战面板(10),仅经 WS/REST 通信 |

固定六包:`shared / core / providers / agents / server / web`。不新增包除非跨越一个清晰的依赖边界且被复用 ≥2 次(§2.4 准入)。

### 0.2 文档编号 ↔ 盘上文件名权威映射(吃掉 C-NUM 双轨制)

x-consistency C-NUM / x-coverage COV-6 把"文档编号双轨制"列为全仓阻断级一致性项:`03/04/07/08/09/19/24` 用**文件名编号**(安全=08),`01/02/05/06/18/23` 等用**逻辑编号**(安全=09、面板=08),`11/12/22` 单稿内自相矛盾。两套并存会导致交叉引用指错文档。

**裁决(本文件作为工程组织权威,据 COV-6 建议锚定磁盘文件名)**:**全仓唯一编号 = `docs/drafts/` 盘上文件名前缀**;任何稿引用他稿一律用"角色名 + 文件名号"双锚点(如"安全文档 08""面板文档 10"),不再使用会漂的逻辑号。下表为权威映射,定稿前各稿据此回填正文交叉引用:

| 文件名号 | 文件 | 角色 | 旧逻辑号(作废) |
|---|---|---|---|
| 01 | `01-arch-topology-loop.md` | 架构拓扑与主循环 | 01 |
| 02 | `02-blackboard-types.md` | 黑板协议·类型唯一权威 | 02 |
| 03 | `03-engine-playbook.md` | 引擎与 Playbook | 03 |
| 04 | `04-convergence-brakes.md` | 收敛与三重刹车 | 04 |
| 05 | `05-adapter-codex.md` | codex 适配器 | 05 |
| 06 | `06-adapter-claude.md` | claude 适配器 | 06 |
| 07 | `07-provider-config.md` | provider 配置与热换 | 07 |
| **08** | `08-security-firewall.md` | **密钥安全与内容防火墙** | ~~09~~ |
| **09** | `09-isolation-worktree.md` | **文件隔离 / worktree** | ~~(部分稿亦称 09,语义撞车)~~ |
| **10** | `10-web-ui.md` | **Web 观战面板** | ~~08~~ |
| **11** | `11-ws-protocol.md` | **WS / REST 协议** | ~~08(部分稿)~~ |
| 12 | `12-techstack.md` | 技术栈与选型 | 12 |
| 13 | `13-monorepo-devstd.md` | 本文件:工程规范 | 13 |
| 14–25 | (其余) | 测试/可观测/配置/性能/评测/部署/插件/Fusion/E2E/术语/M0/路线 | 同名 |

> 本文件全文已按此表回填:`安全 08`(原 `安全 09`)、`隔离文档 09`、`面板 10`、`WS 11`。冲突最烈的是"安全 vs 面板"两号对调与"安全 09 撞 隔离 09":一律以本表为准。

---

## 1. 仓库目录树(逐文件,权威)

### 1.1 仓库根布局

```
G:\sylux\
├─ .git/
├─ .husky/                       # git hooks(M2+ 启用,§9)
│  ├─ pre-commit                 # lint-staged + secret-scan
│  ├─ commit-msg                 # commitlint
│  └─ pre-push                   # tsc -b(typecheck 闸)
├─ .github/
│  └─ workflows/
│     └─ ci.yml                  # CI:typecheck/lint/format/test,matrix 含 windows-latest(§10)
├─ .vscode/                      # 可选,统一编辑器体验(入库,§8.4)
│  ├─ settings.json              # formatOnSave + eslint.useFlatConfig
│  └─ extensions.json            # 推荐 eslint/prettier 插件
├─ docs/                         # 设计文档(本文件等)+ PROBED-FACTS.md + sylux-master-plan.md
├─ fixtures/                     # 录制的 codex/claude JSONL 样本 + 假 CLI(总体 §12.2)
│  ├─ codex/                     # codex exec --json 真实 JSONL(文件名注明 0.141.0)
│  ├─ claude/                    # claude -p stream-json 真实事件流
│  ├─ fake-codex.mjs             # 假 CLI:.cmd shim 包 node,真 spawn 全链路
│  └─ README.md                  # 每个 fixture 的录制环境/版本/命令
├─ runs/                         # 运行期黑板 jsonl(<runId>.jsonl,02 §7);.gitignore
├─ logs/                         # pino 输出;.gitignore
├─ packages/
│  ├─ shared/                    # @sylux/shared(依赖图最底层)
│  ├─ core/                      # @sylux/core
│  ├─ providers/                 # @sylux/providers
│  ├─ agents/                    # @sylux/agents(简报"adapters")
│  ├─ server/                    # @sylux/server(中枢进程 + CLI bin)
│  └─ web/                       # @sylux/web(React 面板)
├─ .editorconfig                 # 跨编辑器:lf / utf-8 / 2 空格(§8.1)
├─ .gitattributes                # * text=auto eol=lf(G1,Windows 必备)
├─ .gitignore
├─ .npmrc                        # registry=npmmirror + pnpm 设置(§7.2)
├─ .nvmrc                        # 22(锁 Node 主版本)
├─ .env.example                  # 环境变量样例(真 .env 不入库)
├─ .syluxignore                  # 出境白名单(安全 08;M5,此处占位)
├─ commitlint.config.cjs         # Conventional Commits 规则(§5)
├─ eslint.config.js              # ESLint flat(§8.2)
├─ prettier.config.cjs           # Prettier(§8.3)
├─ lint-staged.config.cjs        # pre-commit 暂存区跑(§9.2)
├─ vitest.config.ts              # 根 vitest(workspace projects 聚合,测试文档另述)
├─ vitest.workspace.ts           # 各包测试项目聚合
├─ turbo.json                    # 任务编排缓存(M2+ 可选,§7.5)
├─ tsconfig.base.json            # 全局编译选项基线(§6.1)
├─ tsconfig.json                 # 根 solution(references 指向各包,§6.2)
├─ package.json                  # 根:private,scripts + devDeps(§4)
├─ pnpm-workspace.yaml           # packages: ['packages/*']
└─ pnpm-lock.yaml                # lockfile,必须入库(§7.1)
```

> `runs/` 与 `logs/` 是运行期产物,入 `.gitignore`;`fixtures/` 是测试资产,**入库**(总体 §12.2 假 CLI 最值钱)。agent 运行期 worktree(隔离文档 09)落在仓外临时目录,不在本树内。

### 1.2 单个包的标准内部布局(以 `@sylux/core` 为模板)

每个 `packages/<pkg>/` 内部统一为下列形状,降低跨包心智负担:

```
packages/core/
├─ package.json                  # name/exports/scripts/deps(§3.1)
├─ tsconfig.json                 # extends ../../tsconfig.base.json + references(§6.2)
├─ tsup.config.ts                # 库构建(web 包用 vite,无此文件)
├─ src/
│  ├─ index.ts                   # 唯一对外入口(barrel re-export,§3.2)
│  ├─ <feature>/                 # 按领域分目录(engine/ blackboard/ playbook/ ...)
│  │  ├─ <feature>.ts
│  │  └─ <feature>.test.ts       # 单测与被测同目录(co-located)
│  └─ internal/                  # 不对外导出的实现细节(exports 不暴露)
├─ dist/                         # tsup 产物;.gitignore
└─ README.md                     # 包职责一句话 + 公共 API 摘要
```

约定:`src/index.ts` 是包的**唯一公共面**;包外只能从 `@sylux/<pkg>`(即 index)导入,**禁止深引** `@sylux/core/src/...`(§3.2、`no-restricted-imports` 强制)。测试文件 `*.test.ts` 与源码同目录(co-located),不单设 `__tests__`。

### 1.3 `@sylux/shared` 内部树(类型契约落点)

物理落点已由黑板协议(02 §1.1)钉死类型部分,安全工具落点由技术栈 12 §2.4 裁决(D15),本文件**回填合并**为下树(类型本体与安全规则本体只引用不另写):

```
packages/shared/src/
├─ index.ts                # 统一 re-export(02 §11 清单 + security/ 子树)
├─ blackboard.schema.ts    # ★ Message/Evidence/Round/BoardState/AgentEvent 唯一权威(02)
├─ validate.ts             # validateMessage(02 §8)
├─ fingerprint.ts          # evidence 指纹 + contentHash 纯字符串部分(02 §9)
├─ jsonl.ts                # 持久化行 encode/decode + 迁移(02 §7;node:fs 部分入 /node 子面 §3.3)
├─ errors.ts               # SyluxErrorCode + SyluxError(02 §12)
└─ security/               # ★ 安全工具物理宿主(规则本体归 08,shared 只托管;D15 / 12 §2.4)
   ├─ secret-signatures.ts # SECRET_SIGNATURES + isStrongSecretLike + isSecretLike(08 §2.4)
   ├─ redact.ts            # redact / redactText / redactArgv + REDACT_PATHS 常量(08 §3)
   ├─ child-env.ts         # buildChildEnv + BASE_ENV_ALLOWLIST + assertInjectedEnvPaths(08 §2.2/§2.5)
   └─ firewall.ts          # firewallPeerMessage 纯函数(08 §4)
```

`@sylux/shared` 只依赖 `zod` + `zod-to-json-schema`(02 §1.1),**不得反向依赖任何 sylux 内部包**(G2)。

> **D15 落点裁决(权威源:技术栈 12 §2.4,本文件据此回填物理目录)**:三稿曾各写一套 import 路径——06 用 `@sylux/security`、05 用 `@sylux/agents/proc`、08 §10 倾向 `@sylux/shared`。R1 单一权威要求一个落点。**裁决:全部落 `@sylux/shared/src/security/`,不新增 `@sylux/security` 包**(六包锁定不破,§0.1);`@sylux/agents/proc` 子路径导出作废(它本就属 §3.2 禁止的深引形态)。05/06/08/11/server 一律 `import { buildChildEnv, redact, redactArgv, SECRET_SIGNATURES, isStrongSecretLike, firewallPeerMessage } from '@sylux/shared'`。**规则/正则/签名集本体仍归安全 08 权威**,shared 只是其零依赖物理宿主(这些工具是纯正则/白名单/字符串处理,落最底层后 core/agents/providers/server 全可单向 import,不制造新包层、不引环)。
> - 选择 `@sylux/shared` 而非新建包的理由:① 这些工具零运行时依赖,与黑板类型同层最自然;② 被 05/06/08/11/server 多处共用,放底层避免任何一侧深引另一侧内部;③ 新建一个只装几个纯函数的包是过度切分(违 §2.4 准入门槛)。
> - **回填动作**:05 删 `@sylux/agents/proc` 写法与内联 `KEY_PATTERNS` 副本、06 把 `@sylux/security` 改 `@sylux/shared`(均已在各自 v3 稿登记)。
> - **node 实现分面**:`redact`/`SECRET_SIGNATURES`/`firewallPeerMessage`/`buildChildEnv` 均为纯字符串/正则/对象处理,**无 node:\* 依赖**,留在 `@sylux/shared`(根)子面,web 亦可安全 import(若面板需本地脱敏预览);仅 `jsonl`/`contentHash` 的 node 实现入 `/node` 子面(§3.3)。

### 1.4 `@sylux/core` / `@sylux/providers` / `@sylux/agents` 内部树(领域目录建议)

> 这些目录的**行为契约**归各自文档(engine 03、provider 07、adapter 04/05/06);本文件只给"按领域分目录"的物理建议,具体文件名以各文档为准。

```
packages/core/src/
├─ index.ts
├─ engine/        # 引擎循环(03):run loop、轮转、终止判定
├─ blackboard/    # Blackboard 接口实现(append/snapshot/persist)
├─ playbook/      # Playbook 接口 + 各范式(red-blue/master-worker/pair/parallel,03)
├─ adapter/       # ★ AgentAdapter / AgentInput 接口(引擎注入契约,§2.5;实现在 agents)
└─ brakes/        # 收敛检测/token 预算/maxRounds(04;指纹复用 shared §9)

packages/providers/src/
├─ index.ts
├─ config/        # provider 配置 schema + 加载/热换(07)
└─ keystore/      # KeyStore.resolve(ref)→providerEnv(07 §2;真实 key 只在此解析)

packages/agents/src/
├─ index.ts
├─ adapter-impl.ts # AgentAdapter 实现(impl 03/05/06;接口在 @sylux/core/adapter,§2.5)
├─ codex/         # codex 适配器(05):exe 路径解析、--json 事件流、output-schema 文件
├─ claude/        # claude 适配器(06):stream-json、--json-schema 内联/文件降级
└─ proc/          # spawn 包装:调 buildChildEnv(@sylux/shared) + argv 预扫(import SECRET_SIGNATURES@shared)
```

> **buildChildEnv / firewall / SECRET_SIGNATURES 不在这两包定义**(D15 / §1.3):它们的**逻辑本体**落 `@sylux/shared/src/security/`,规则权威归安全 08。`providers/keystore/` 只负责把 `apiKeyRef` 解析成 `providerEnv`(真实 key 的唯一解析处,08 S1);`agents/proc/` 是 `buildChildEnv` 的**调用点**(spawn 前组装子进程 env + argv 预扫),不自建实现;内容防火墙的**应用点**(peer 输出喂对面前调 `firewallPeerMessage`)在 `agents`(05/06 渲染前)与引擎渲染相位(03 §2.3),纯函数本体在 shared。这样"哪儿用"与"在哪定义"分离,避免 §3.2 深引。

### 1.5 `@sylux/server` 内部树(中枢进程 + CLI 入口同包)

```
packages/server/src/
├─ index.ts       # 库式导出(供测试/嵌入)
├─ bin/
│  └─ sylux.ts    # commander CLI 入口(#!/usr/bin/env node;package.json bin 指向产物)
├─ ws/            # ws 服务:127.0.0.1 bind + Origin 白名单 + 一次性 token(WS 11 / 安全 08)
├─ rest/          # 只读快照 REST(面板拉取 BoardState 投影)
└─ runtime/       # 进程编排:spawn 两 CLI、生命周期、信号处理
```

> **为何 CLI 与 server 同包**(G2):CLI 入口要直接 `import` 中枢启动逻辑;若拆成独立 `@sylux/cli` 包会与 `@sylux/server` 双向耦合或制造一个只转发的空壳包。合并后 `bin` 字段在 `@sylux/server/package.json` 声明,`pnpm --filter @sylux/server build` 同时产出库与可执行入口。

### 1.6 `@sylux/web` 内部树(前端,vite)

```
packages/web/
├─ package.json
├─ tsconfig.json          # 加 DOM lib + jsx:react-jsx(§6.3)
├─ vite.config.ts         # vite 6;dev proxy 指向 server WS/REST
├─ index.html
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ ws/                 # WS 客户端(订阅 BoardState 增量,协议见 WS 11)
   ├─ store/              # zustand store
   ├─ components/         # 气泡/轮次/diff/控制条(面板 10)
   └─ types/              # 仅从 @sylux/shared 导入黑板类型,不重定义(G2)
```

> `web` 是依赖图末端,**只能 import `@sylux/shared`**(共享类型),与 server 的一切交互走 WS/REST(总体 §10.723),不得 import `core/server/agents/providers`(`no-restricted-imports` 强制,§8.2)。

### 1.7 仓外运行期数据目录(`approvedDataRoot`,吃掉 08 §2.5 / 12 转交项)

安全 08 §2.5 的 `isInjectedPathSafe` 与 09 worktree 都依赖一个"sylux 批准数据根",08 显式把它的默认值转交"12/13 共定"。本文件作为**仓内/仓外物理布局权威**钉死如下(**仓外**,与源码仓 `G:\sylux\` 物理隔离,避免运行期产物污染 git 工作树、避免 secret 落进版本库):

```
%USERPROFILE%\.sylux\           # = approvedDataRoot(Windows;*nix 为 ~/.sylux)
├─ auth\                        # 凭证落盘区(0600/ACL 收紧):codex auth.json、claude 凭证
│  └─ <provider>\               # 每 provider 一份,KeyStore.resolve 从此读(08 S1,不进 argv)
├─ codex-homes\                 # 每 agent 一个 CODEX_HOME(隔离 codex 会话/配置)
│  └─ <agentId>\                # CODEX_HOME 注入值必落此根下(08 §2.5 isInjectedPathSafe 校验锚点)
├─ worktrees\                   # 运行期 git worktree(隔离 09 / 红队 R7);各 agent 各写各的
│  └─ <runId>\<agentId>\
├─ runs\                        # 黑板 jsonl 归档副本(可选;主副本在仓内 runs/,见下注)
└─ logs\                        # 跨 run 的中枢日志归档(pino)
```

规则:
- `approvedDataRoot` 默认 = `path.join(os.homedir(), '.sylux')`;可经 `SYLUX_DATA_ROOT` 环境变量覆盖(§4.1 命名),覆盖值启动时校验为**绝对路径 + 存在 + 可写 + realpath 不含 symlink 逃逸**,失败抛 `CONFIG_INVALID`(码归 02,见 §5.1)。
- 08 §2.5 `isInjectedPathSafe(value)` 的"批准根"即此 `approvedDataRoot`:任何注入子进程 env 的路径值(尤其 `CODEX_HOME`)必须 realpath 后落在 `approvedDataRoot` 之内,否则抛 `PROVIDER_CONFIG_INVALID`(防 RS-M4 `_codex_home` 路径注入)。
- **为何仓外**:① 运行期 worktree/CODEX_HOME 含 agent 改的文件与会话态,放仓内会污染 `git status` 且有误提交 secret 风险;② `.gitignore` 再全也不如物理隔离干净;③ 多 run 并发时 `<runId>` 分目录天然隔离。
- 仓内 `runs/`、`logs/`(§1.1)是**开发期就近产物**(单机调试方便),已入 `.gitignore`;生产/长跑归档落仓外 `~/.sylux/runs|logs`。二者择一启用由 `SYLUX_DATA_ROOT` 是否设定区分,**不双写**(避免 contentHash 锚点指向歧义)。
- 此目录**不是** monorepo 的一部分,不在 §1.1 仓库树内;它是运行期约定,M1 起 server `runtime/` 在启动时 `mkdir -p` 创建并校验权限。

---

## 2. 包依赖图与边界(单向、禁环)

### 2.1 权威依赖方向(G2)

总体 §10.723 钉死单向、禁环;**权威依赖谱以技术栈 12 §2.3 为准**(v1 本节有两处与 12/05/07 冲突,v2 已对齐):providers 只依赖 shared(配置是纯 schema,不碰引擎);agents 依赖 shared + core(注入用的 `AgentAdapter` 接口,§2.5)+ providers(消费 `ProviderConfig`/`KeyStore`/`toCodexInjection`)。

```
              ┌──────────────┐
              │ @sylux/shared│  ← 仅 zod / zod-to-json-schema(最底层,无 sylux 内部依赖)
              │  + security/ │     (类型 02 + 安全工具 D15:secret-sig/redact/child-env/firewall)
              └──┬───────┬───┘
        types+   │       │  types + security
        validate │       │
        ┌────────▼──┐ ┌──▼──────────┐
        │@sylux/core│ │@sylux/providers│  ← 二者都只依赖 shared,互不依赖(同层并列)
        │ (引擎+adapter│ │ (provider 配置 │
        │  接口 §2.5)│ │  + keystore)  │
        └────┬──────┘ └──┬────────────┘
             │ AgentAdapter│ ProviderConfig/KeyStore
             │ 接口        │ toCodexInjection
            ┌▼────────────▼┐
            │ @sylux/agents │  ← shared + core(adapter 接口)+ providers(配置/keystore)
            │ (codex/claude │     实现 AgentAdapter,spawn 子进程
            │  impl)        │
            └──────┬────────┘
              ┌────▼─────────┐
              │ @sylux/server│  ← core + agents(+ 传递 providers/shared);装配层注入 §2.5
              └───────┬──────┘
                      ┊ (WS / REST,运行期网络边界,非编译期依赖)
              ┌───────▼──────┐
              │  @sylux/web  │  ← 仅编译期依赖 shared(类型);运行期经 WS/REST 连 server
              └──────────────┘
```

规则:
- **实线 = 编译期 `dependencies`(workspace:\*)**;**虚线 = 运行期网络边界**(web↔server 无编译期依赖,只共享 shared 类型)。
- **`core` 不依赖 `agents`/`providers`**(master §12.2:引擎必须 IO 纯净、可注入 FakeAdapter 单测;一旦 core→agents,core 的测试图就会拖进 execa/spawn)。`AgentAdapter` 接口因此落 `core`(§2.5),由 `server` 装配期把 `agents` 的具体实现注入引擎。
- **`agents` 依赖 `providers`**(v1 矩阵误标 ✖):agents 的 spawn 要 `ProviderConfig`/`KeyStore.resolve`/`toCodexInjection`(05 §1/§8、07 §2/§5),这是合法同向边(agents 层级高于 providers)。
- **`providers` 不依赖 `core`**(对齐 12 §2.3;v1 误加此边):provider 配置是纯 schema + 加载,不需要引擎类型。
- 禁止任何反向或横向逆层依赖(如 core→server、shared→core、providers→agents)。`eslint-plugin-import` 的 `import/no-cycle` + 自定义 `no-restricted-imports` 分层规则强制(§8.2),CI 失败即红。

### 2.2 依赖矩阵(允许 = ✅,禁止 = ✖)

| 依赖方 ↓ \ 被依赖 → | shared | core | providers | agents | server | web |
|---|---|---|---|---|---|---|
| **shared** | — | ✖ | ✖ | ✖ | ✖ | ✖ |
| **core** | ✅ | — | ✖ | ✖ | ✖ | ✖ |
| **providers** | ✅ | ✖ | — | ✖ | ✖ | ✖ |
| **agents** | ✅ | ✅(仅 adapter 接口) | ✅ | — | ✖ | ✖ |
| **server** | ✅ | ✅ | ✅ | ✅ | — | ✖ |
| **web** | ✅(仅 type) | ✖ | ✖ | ✖ | ✖(运行期 WS/REST) | — |

> 对齐 12 §2.3 权威谱。三处与 v1 的差异:① **agents→providers = ✅**(v1 误标 ✖):agents spawn 需 `ProviderConfig`/`KeyStore`/`toCodexInjection`(05/07)。② **providers→core = ✖**(v1 误标 ✅):配置是纯 schema,不依赖引擎。③ **agents→core = ✅ 但仅限 `AgentAdapter`/`AgentInput` 接口**(§2.5):agents 实现引擎定义的注入契约,不反向拉引擎逻辑。
> web→shared 限**类型导入**(`import type`);不应把 `validateMessage`/`jsonl` 等含 node:crypto/node:fs 的运行期函数打进浏览器包。shared 需对此做 **exports 子路径分面**(§3.3):`@sylux/shared`(同构类型 + 纯校验 + 纯安全工具)与 `@sylux/shared/node`(含 node:* 的 jsonl/contentHash 实现)分开,web 只引前者。

### 2.3 为什么这样分(边界理由)

| 边界 | 理由 |
|---|---|
| shared 独立最底层 | 类型单一权威(02 I1);任何包改类型只改一处,三职同步 |
| core 不碰子进程/网络 | 引擎可纯逻辑单测(FakeAdapter 注入,总体 §12.2),不被 IO 污染 |
| providers / agents 分离 | provider 配置(可热换、纯 schema)与子进程适配(spawn 细节)是两个变更轴;providers 只依赖 shared,agents 依赖 core(注入接口)+ providers(配置/keystore)+ shared,层级 agents > providers |
| AgentAdapter 接口归 core | 引擎注入契约;core 不依赖 agents 实现,可 FakeAdapter 纯测(§2.5,master §12.2) |
| server 聚合 + 持有 IO 边界 | ws/rest/spawn 都在此;CLI 同包(§1.5)避免空壳 |
| web 只连 shared | 前端可独立换框架(总体 §10.710),不被后端实现绑死 |

### 2.4 新增包准入门槛

新增 `@sylux/<x>` 必须同时满足:① 跨越一条**当前没有**的清晰依赖边界;② 被 ≥2 个现有包复用,或体积/编译时长显著(拆分能改善增量编译);③ 在本文件 §2.1 图与 §2.2 矩阵补一行并说明方向。否则归入现有包的子目录。这条挡住"为每个小功能开新包"的碎片化。

> 已据此驳回 `@sylux/security`(D15):安全工具是几个纯函数,零新依赖边界,落 `@sylux/shared/security/` 即可(§1.3)。

### 2.5 引擎↔适配器注入边界(消解 core↔agents 环风险)

**问题(交叉发现,非单稿点名)**:03 §2.2 把 `PromptContext` 落 `@sylux/core`,03 §4.3(line 424)又 `import type { AgentAdapter } from '@sylux/agents'`;而 05 自称 `AgentAdapter` 接口归 agents。若 `AgentAdapter.run(input: AgentInput)` 的入参含 `PromptContext`(core 类型),则 agents 必须 import core,core 又 import agents 取 `AgentAdapter` → **编译期循环引用**(`tsc -b` project references 不允许成环,直接报错)。同时 12 §2.3 的依赖表要求 core 只依赖 shared、agents 依赖 core——与"core import agents"矛盾。

**裁决(本文件作为包边界权威)**:
1. **`AgentAdapter` / `AgentInput` 接口落 `@sylux/core/src/adapter/`**(引擎的注入契约,与 `EngineDeps`/`Blackboard` 同属"引擎依赖什么"的契约面),**不落 agents**。
2. **`@sylux/agents` 依赖 `@sylux/core`** 来 import 这两个接口并实现(`adapter-impl.ts`);core **绝不** import agents。
3. `PromptContext`(03 §2.2)留在 core,与 `AgentAdapter` 同包,接口入参引用无跨包问题。
4. **装配在 server**:`@sylux/server` 同时依赖 core(引擎 + 接口)与 agents(实现),在 `runtime/` 把 `createCodexAdapter`/`createClaudeAdapter` 的实例注入 `runEngine` 的 `EngineDeps.agentAdapter`。core 测试用自带 `FakeAdapter`(实现同一 core 接口),**完全不碰 agents**(master §12.2 的硬要求落地)。

**依据**:master §12.2 把"引擎可纯逻辑单测、FakeAdapter 注入、不被 IO 污染"列为架构硬约束。接口归 core 是唯一同时满足"core 不依赖 agents"+"无环"+"agents 实现引擎契约"的落点(接口归 shared 亦可,但会把"引擎专属注入契约"泄到全局类型层,且 `PromptContext` 也得跟着下沉 shared,扩散更大;归 core 改动最小)。

**回填动作(交定稿)**:03 §4.3 把 `import type { AgentAdapter } from '@sylux/agents'` 改为 `from '@sylux/core'`(或 core 内部直接定义处);05 把 `AgentAdapter`/`AgentInput` 的**接口权威归属**改标"@sylux/core",05 只保留"codex 端实现"。此项跨 03/05/12,列 §13 openQuestion 待定稿三方确认。

---

## 3. package.json 规范与 exports

### 3.1 库包 package.json 模板(以 `@sylux/core` 为例)

```jsonc
{
  "name": "@sylux/core",
  "version": "0.1.0",
  "private": true,                       // 不发布到 npm(本地单机,G4)
  "type": "module",                      // ESM(总体 §10)
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",             // 兼容老解析器的回退
  "types": "./dist/index.d.ts",
  "files": ["dist"],                     // 即便 private,也限定可分发面
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "clean": "rimraf dist .tsbuildinfo"
  },
  "dependencies": {
    "@sylux/shared": "workspace:*"       // 内部包一律 workspace:*(§7.3)
  },
  "devDependencies": {
    "tsup": "<锁定版,见12>",
    "vitest": "<锁定版,见12>"
  }
}
```

规则:
- `private:true` 全部内部包都加(G4,不误发 npm)。
- 内部依赖一律 `workspace:*`;外部依赖**精确版本**(无 `^`/`~`,§7.4)。
- `exports` 用 conditional exports,`types` 在 `import` 之前(NodeNext 解析顺序敏感)。
- 不写 `main` 指向 `src`;一律指 `dist`(消费方用编译产物,源码只在本包内编译)。

### 3.2 barrel 入口(index.ts)纪律

- 每包 `src/index.ts` 是**唯一公共面**,只 re-export 该包对外契约,internal/ 下的实现不出现在此。
- 包外导入只允许 `import { x } from '@sylux/core'`;**禁止** `from '@sylux/core/src/engine/loop.js'`(深引)。由 `no-restricted-imports` 的 pattern `@sylux/*/src/**` 拦截(§8.2)。
- barrel 内**禁止再导出副作用**(纯类型/纯函数 re-export);避免 tree-shaking 失效与循环初始化。
- `@sylux/shared/index.ts` 的 re-export 清单以 02 §11 为准,本文件不复制。

### 3.3 shared 的 exports 子路径分面(同构 vs node-only)

为支撑 web→shared 仅类型/纯校验(§2.2),`@sylux/shared` 拆两个 exports 子面:

```jsonc
{
  "name": "@sylux/shared",
  "exports": {
    ".":      { "types": "./dist/index.d.ts",      "import": "./dist/index.js" },      // 同构:zod schema + 类型 + 纯校验(无 node:*)
    "./node": { "types": "./dist/node/index.d.ts", "import": "./dist/node/index.js" }   // node-only:jsonl(node:fs)、contentHash(node:crypto)
  }
}
```

- `@sylux/shared`(根):`blackboard.schema.ts`、`validate.ts`(纯逻辑,readFileRange 由调用方注入,见 02 §8.1)、`errors.ts`、`fingerprint.ts` 里**不碰 node 的部分**(`fingerprint`/`normalizeContent` 纯字符串)、`security/`(`secret-signatures`/`redact`/`child-env`/`firewall` 全为纯正则/字符串/对象处理,无 node:*,故入根子面,§1.3/D15)。
- `@sylux/shared/node`:`jsonl.ts`(`fs.appendFile`)、`contentHash` 的 `node:crypto` 实现。
- web 只 import `@sylux/shared`;server/core/agents 可 import 两者。`contentHash` 的契约(算法 = 02 §9.1)不变,只是 node 实现入 `/node` 子面。
- ESLint 对 web 包额外限制:`no-restricted-imports` 禁 `@sylux/shared/node`(§8.2)。

> 【待实测】tsup 多入口产 `dist/index.js` + `dist/node/index.js` 的 d.ts 路径与 NodeNext `types` 解析在本机是否一致,M1 落地时验证;若有摩擦,退化为单入口 + 文档约定 web 不引 node 函数。

### 3.4 根 package.json(workspace 聚合)

```jsonc
{
  "name": "sylux",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<锁定版,见12>",   // corepack 据此固定 pnpm 版本(总体 §0.3)
  "engines": { "node": ">=22.13 <23" },      // 与 .nvmrc 一致,锁 Node22
  "scripts": { /* §11 根 scripts */ },
  "devDependencies": { /* 仓库级工具:eslint/prettier/typescript/commitlint/husky/turbo 等,锁版见12 */ }
}
```

`packageManager` 字段让 corepack 在任意机器固定同一 pnpm 版本,消除"各人 pnpm 版本不同导致 lockfile 漂移"。

---

## 4. 命名规范

### 4.1 标识符命名表(总体 §11.3 展开)

| 实体 | 约定 | 示例 | 反例 |
|---|---|---|---|
| 文件/目录 | kebab-case | `red-blue.ts`、`provider-config.ts` | `RedBlue.ts`、`providerConfig.ts` |
| 测试文件 | `<被测>.test.ts`(同目录) | `validate.test.ts` | `validate.spec.ts`、`__tests__/` |
| 类型/接口/类 | PascalCase,**接口不加 `I`** | `AgentAdapter`、`BoardState` | `IAgentAdapter` |
| 变量/函数 | camelCase | `buildChildEnv`、`validateMessage` | `BuildChildEnv` |
| 常量(模块级不可变) | UPPER_SNAKE | `SCHEMA_VERSION`、`MAX_INLINE_SCHEMA_BYTES` | `schemaVersion` |
| zod schema | `xxxSchema`,推导类型去后缀 | `messageSchema` → `type Message` | `MessageZod`、`MessageSchemaType` |
| 枚举字面量(role/kind 等) | 小写字面量联合 | `'critic'`、`'critique'` | `'Critic'`、enum class |
| 包名 | `@sylux/<kebab>` | `@sylux/agents` | `@sylux/Agents` |
| 错误码 | UPPER_SNAKE 字符串联合 | `'EVIDENCE_REQUIRED'`(02 §12) | `EvidenceRequired` |
| 环境变量 | `SYLUX_` 前缀 + UPPER_SNAKE | `SYLUX_WS_PORT`、`SYLUX_LOG_LEVEL`、`SYLUX_DATA_ROOT`(§1.7) | `wsPort` |
| 类型导出 vs 值导出 | `export type` 与 `export` 分开(`consistent-type-imports`) | `export type { Message }` | 混在一个 export |

### 4.2 领域命名一致性(防跨稿漂移)

- `role`/`kind`/`AgentId` 字面量**只认 02 §2 的权威枚举**;简报别名(proposal/patch)只用于沟通,代码一律权威字面量(02 §2.1 映射表)。
- `sessionId` 是适配层统一抽象(02 §6.3):codex 侧映射自 `thread.started.thread_id`,claude 侧映射自其 session id。代码里**统一叫 `sessionId`**,不在 core/server 层散落 `threadId`;`threadId` 只允许出现在 `@sylux/agents/codex/` 内部解析处,出适配器边界即归一为 `sessionId`。
- `runId`/`round`/`runId` 等黑板字段名严格随 02 §5.1,不起别名(如 `sessionRound`/`turn`)。
- provider 配置字段(`base_url`/`wire_api`)在**配置文件层**保留 snake_case(对齐 codex `config.toml` 习惯,07),进入 TS 后转 camelCase(`baseUrl`/`wireApi`),边界转换集中在 providers 的 config 加载处。

### 4.3 文件名 ↔ 导出名对应

- 一个 schema/接口为主的文件,文件名 = 主导出的 kebab 化:`AgentAdapter` 接口 → `@sylux/core/src/adapter/adapter.ts`(接口落 core,§2.5);其实现 → `@sylux/agents/src/adapter-impl.ts`。领域已在目录体现,不重复 `agent-adapter.ts`。
- 一个 playbook 一个文件,文件名 = 范式 kebab:`red-blue.ts`/`master-worker.ts`/`pair.ts`/`parallel.ts`。
- 避免 `index.ts` 承载实现;`index.ts` 只做 re-export(§3.2)。

---

## 5. 错误处理规范(不吞错 + 单一错误体系)

### 5.1 SyluxError 单一体系

- 所有可预期失败用 `SyluxError`(02 §12,继承 `Error` 带 `code: SyluxErrorCode`),**错误码全集只在 `@sylux/shared/errors.ts`**(02 §12 权威);本文件不新增错误码。
- 抛错带结构化 `detail`(不可序列化对象除外),供日志与面板呈现:`throw new SyluxError('OUTPUT_SCHEMA_VIOLATION', '...', { raw, zodIssues })`。
- 跨包/跨进程边界**只传 `code` + 安全 message**;`detail` 落本地日志,不经 WS 直发面板(可能含敏感内容,过 redact 后才发,安全 08)。

> **错误码补全责任转交 02(A1 / COV-1,非本文新增)**:x-consistency A1 / x-coverage COV-1 实证 02 §12 `SyluxErrorCode` union 缺 17+ 个下游已在用的码,各稿零散登记却无人补。本文件**只规定"错误码单一权威在 02、本文不新增"**,但据其单一权威纪律点名 02 必补的已知缺码(供 02 定稿一次性补齐 union,并与 15 的 `Record<SyluxErrorCode, …>` 穷举对齐,否则 15 编译红):`SUBPROCESS_CRASHED` / `SUBPROCESS_TIMEOUT` / `CANCELLED`、`INJECTION_BLOCKED`、`EGRESS_SECRET_BLOCKED`、`EMPTY_ROUND_PLAN`、`ENGINE_FATAL`、`WS_AUTH_FAILED` / `WS_TICKET_DENIED` / `WS_ORIGIN_REJECTED`(+ 其余 WS_*)、`WORKTREE_GIT_FAILED`、`FUSION_*`、`CONFIG_INVALID`(本文件 §1.7 `SYLUX_DATA_ROOT` 校验用)。本文件凡引用错误码(如 §1.7 `CONFIG_INVALID`、§5.4 `PROVIDER_CONFIG_INVALID`)均假定 02 已收录;若 02 定稿时某码改名,以 02 为准回填本文。

### 5.2 不吞错铁律(G3 / 总体 §11.3)

| 场景 | 要求 |
|---|---|
| `catch` 块 | 必须重抛、转 `SyluxError` 重抛、或结构化记录后显式决定吞掉;**禁空 catch `{}`** |
| 吞掉异常的唯一合法情形 | 已知可忽略且**写明原因注释**(如 best-effort 清理 worktree 失败只 warn) |
| Promise | 不允许 floating(`no-floating-promises`);要么 `await`,要么显式 `void`(并注释为何不等) |
| 子进程 JSON | 进引擎前必过 `safeParse`(I2);失败抛 `OUTPUT_SCHEMA_VIOLATION` 且落 raw(02 §8.4) |
| 重试 | schema 违例/evidence 打回按 02 §8.4 的 ≤N 次重发,耗尽抛对应 code,**不静默放过** |

### 5.3 错误传播分层

- `shared`:只**定义**错误码/类与校验返回 `ValidateResult`(02 §8.1,不抛,返回判别联合);由调用方决定抛不抛。
- `core/agents/providers`:抛 `SyluxError`;不在底层 `console.error` 后继续(交上层统一处理)。
- `server`:错误的**唯一汇聚点**——捕获、结构化记日志、转成面板可见的 `system` 消息(02 §5,`from:'orchestrator'`)或 WS error 帧(WS 11)。进程级 `unhandledRejection`/`uncaughtException` 在此挂兜底,记日志后受控退出。
- `web`:展示错误,不静默吞;WS 断线/error 帧要在 UI 体现(面板 10)。

### 5.4 失败路径必须显式建模(红队精神)

关键失败路径(事实地基/红队已点名的)在代码注释顶部写明处理策略,且有对应测试(总体 §12.3):
- 首轮 `session_started` 前进程崩溃 → 不发 session_started → `resumable=false` → 全新会话重来(02 §6.3 失败路径)。
- output-schema 经中转偶发不成形 → safeParse 兜底重发(事实地基 C)。
- worktree 合并冲突 → 硬停 + 回灌 evidence(红队 R7)。
- key 疑似进 argv → 预扫描命中即抛 `PROVIDER_CONFIG_INVALID`(红队 R8 / 安全 08)。

---

## 6. TypeScript 配置(project references 增量编译)

### 6.1 tsconfig.base.json(全局基线,总体 §11.4 展开)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],                       // web 包覆盖加 DOM(§6.3)
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,        // 子进程返回可能缺字段,逼你处理 undefined
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,            // type/值导入分明(配 consistent-type-imports)
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,// Windows 大小写不敏感坑(G1)
    "composite": true,                       // project references 前提
    "incremental": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmitOnError": true,
    "skipLibCheck": true,                    // 只跳第三方 d.ts,自己代码全严
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

> 严格选项(`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`)对"输出对齐"有直接价值:逼代码处理子进程 JSON 里可能缺失/可选的字段,正是 02 §6 边界校验的编译期同盟。

### 6.2 project references 矩阵与根 solution

每包 `tsconfig.json` extends base 并声明对依赖包的 `references`(与 §2.1 依赖图同构),`tsc -b` 据此增量编译:

```jsonc
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

| 包 | references | 说明 |
|---|---|---|
| shared | (无) | 最底层 |
| core | shared | 引擎 + AgentAdapter 接口(§2.5) |
| providers | shared | 纯配置,不 ref core(§2.1) |
| agents | shared, core, providers | core=adapter 接口,providers=配置/keystore |
| server | shared, core, providers, agents | 装配层,注入适配器实现(§2.5) |
| web | shared | 仅类型;web 用 vite 构建,tsc 仅做 `--noEmit` 类型检查 |

```jsonc
// 根 tsconfig.json(solution 文件,自身不编译,只聚合)
{
  "files": [],
  "references": [
    { "path": "packages/shared" }, { "path": "packages/core" },
    { "path": "packages/providers" }, { "path": "packages/agents" },
    { "path": "packages/server" }, { "path": "packages/web" }
  ]
}
```

`pnpm typecheck` = `tsc -b`(根),按 references 拓扑序增量编译,只重编改动过的包及其下游。CI 与 pre-push 都跑它(§9.4、§10)。

### 6.3 web 包 tsconfig 覆盖

```jsonc
// packages/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",     // vite 打包,放宽到 Bundler 解析
    "noEmit": true                     // 产物由 vite 出,tsc 只类型检查
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

> web 用 `Bundler` 解析(vite),其余包用 `NodeNext`(node 直跑产物)。这是唯一的解析差异,集中在 web 一处。

### 6.4 构建产物与工具(选型见 12)

- 库包(shared/core/providers/agents/server):**tsup** 出 ESM + d.ts(`dist/`)。
- web:**vite** build。
- 类型检查:`tsc -b`(全仓增量),与构建解耦——构建可快(tsup esbuild 不做类型检查),类型由 `tsc -b` 把关。
- `dist/`、`*.tsbuildinfo` 入 `.gitignore`;`clean` script 用 rimraf 跨平台删(Windows 无 `rm -rf`)。

---

## 7. 依赖管理与供应链

### 7.1 lockfile 与镜像(G4 / 记忆:npmmirror)

- 包管理器 **pnpm**(corepack 启用,版本由根 `packageManager` 字段锁,总体 §0.3)。
- `pnpm-lock.yaml` **必须入库**;CI 用 `pnpm install --frozen-lockfile`,lockfile 与 package.json 不一致即失败。
- 装包**一律走 npmmirror**(官方 registry 本机 14 分钟仍失败,事实地基/记忆):`.npmrc` 配 `registry=https://registry.npmmirror.com`。

### 7.2 .npmrc(根)

```ini
registry=https://registry.npmmirror.com
# pnpm 行为
auto-install-peers=true
strict-peer-dependencies=false        # 单机开发放宽,CI 另行收紧可选
resolution-mode=highest
# 安全:不自动跑依赖安装脚本(供应链防护,见 §7.6)
# 如需个别包脚本,用 pnpm.onlyBuiltDependencies 白名单(package.json)
```

### 7.3 内部依赖引用

- 内部包一律 `"@sylux/x": "workspace:*"`;pnpm 发布时会替换为实际版本,本项目 private 不发布,`workspace:*` 永久有效。
- 禁止内部包之间用相对路径 `../core/src` 跨包 import(`no-restricted-imports`,§8.2);一律走包名 + exports。

### 7.4 外部依赖版本策略

- **精确锁定**(无 `^`/`~`),具体版本号以**技术栈(12)**为准,本文件不复列版本数字。
- 升级走 PR + lockfile diff 审查;不开 dependabot 自动合(本地单机,G4),手动批量升。
- 依赖归属:运行时依赖入对应包 `dependencies`;构建/测试工具入**根** `devDependencies`(eslint/prettier/typescript/vitest/tsup/turbo/husky/commitlint),避免每包重复声明工具链版本导致漂移。包级 devDeps 只放该包独有的(如 web 的 `@vitejs/plugin-react`)。

### 7.5 turbo(M2+,可选)

```jsonc
// turbo.json(M2+ 才引入,M1 直接 pnpm -r)
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [".tsbuildinfo"] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint":      { "outputs": [] }
  }
}
```

> 【待实测】turbo 远程缓存不用(本地单机),仅用本地缓存;Windows 上 turbo 缓存命中率与 `tsc -b` 增量是否叠加收益,M2 评估。M1 一律 `pnpm -r <task>` 拓扑跑,不引 turbo(G4 渐进)。

### 7.6 供应链安全(G3 / 安全 08 衔接)

- 新增依赖必须:① 来源可信(知名维护)、② 检查疑似 typosquatting(名字相近的恶意包)、③ 评估传递依赖体积与 install 脚本。
- 默认**不执行依赖 install 脚本**(`.npmrc` 不自动跑);确需的包进 `pnpm.onlyBuiltDependencies` 白名单显式放行。
- pre-commit 的 secret-scan(§9.2)防 key 入库;出境 secret scan(`.syluxignore`)是 M5 安全 08 范畴,本文件只在树里占位。

---

## 8. lint / format / 编辑器 / 日志规范

### 8.1 .editorconfig + .gitattributes(G1,Windows 换行)

```ini
# .editorconfig
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2
[*.md]
trim_trailing_whitespace = false   # markdown 行尾双空格有语义
```

```gitattributes
# .gitattributes —— G1 焊死换行,避免 Windows CRLF 进库污染 contentHash(02 §9.1)
* text=auto eol=lf
*.png binary
*.jpg binary
*.ico binary
fixtures/**/*.jsonl text eol=lf    # fixture 字节稳定,跨平台 hash 一致
pnpm-lock.yaml -diff               # lockfile diff 噪声大,折叠
```

> 这条与 02 §9.1 的 `normalizeContent`(CRLF→LF)是同一根因的双保险:库里存 LF + 运行期归一化,确保 evidence `contentHash` 跨平台稳定。

### 8.2 ESLint flat config(总体 §11.5 展开)

`eslint.config.js`(flat,ESM)。核心规则与分层 import 约束:

```js
// 关键规则集(版本/插件锁定见 12)
export default [
  // 1) typescript-eslint recommended-type-checked(需 parserOptions.project)
  // 2) 全局规则
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',  // G3 不吞错
      'no-console': 'error',                               // 用 pino,web 调试除外(见下覆盖)
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',       // 边界用 unknown + safeParse
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/no-cycle': 'error',                          // G2 禁环
      'eqeqeq': ['error', 'always'],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@sylux/*/src/**'], message: '禁止深引包内部,只从包入口导入(§3.2)' },
          { group: ['../../*/src/*'],    message: '跨包禁用相对路径,走包名(§7.3)' },
        ],
      }],
    },
  },
  // 3) web 包覆盖:允许 console(浏览器调试),禁 import 后端包 + shared/node
  {
    files: ['packages/web/**'],
    rules: {
      'no-console': 'warn',
      'no-restricted-imports': ['error', {
        paths: [{ name: '@sylux/shared/node', message: 'web 不得引 node-only 子面(§3.3)' }],
        patterns: [{ group: ['@sylux/core', '@sylux/server', '@sylux/agents', '@sylux/providers'],
                     message: 'web 只经 WS/REST 连 server,编译期只依赖 @sylux/shared(§2.2)' }],
      }],
    },
  },
  // 4) 测试文件放宽(允许 any-ish 断言辅助)
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // 5) fixtures/ 假 CLI 放宽 no-console(它是独立脚本)
  { files: ['fixtures/**'], rules: { 'no-console': 'off' } },
  // 6) eslint-config-prettier 置于末尾:关掉所有格式类规则,交给 prettier
];
```

> `recommended-type-checked` 需要 `parserOptions.project` 指向各包 tsconfig;monorepo 用 `projectService: true`(typescript-eslint v8)自动按文件找最近 tsconfig,省去手列。`no-restricted-imports` 的分层 pattern 是 §2 依赖矩阵的 lint 期执法者。

### 8.3 Prettier(总体 §11.5)

```cjs
// prettier.config.cjs
module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  endOfLine: 'lf',          // G1
  tabWidth: 2,
};
```

ESLint 不管格式(`eslint-config-prettier` 关掉冲突规则);格式由 prettier 单一负责,避免双方打架。

### 8.4 .vscode(入库,统一体验)

```jsonc
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "eslint.useFlatConfig": true,
  "files.eol": "\n",
  "typescript.tsdk": "node_modules/typescript/lib"   // 用仓库锁定的 TS 版本,非编辑器内置
}
```

### 8.5 日志规范(pino,G3)

- 统一用 **pino**(选型 12),**禁 `console.log`**(`no-console`;web 浏览器调试与 fixtures 脚本除外,§8.2)。
- 每条日志结构化,带固定上下文字段:`runId` / `round` / `agent` / `role` / `kind`(对齐黑板消息维度,便于按 run 聚合)。用 child logger 绑定:`logger.child({ runId, round })`。
- 日志级别:`error`(SyluxError 终止类)/`warn`(打回重试、best-effort 失败)/`info`(轮转、状态变更)/`debug`(子进程原始事件、safeParse 失败 raw)。级别由 `SYLUX_LOG_LEVEL` 环境变量控,默认 `info`。
- **redact 强制**(G3 / 安全 08 R8):pino `redact` 配置覆盖 `*.apiKey`、`*.key`、`config.providers.*.key`、`*.token`、`*.authToken`、`req.headers.authorization`,以及 spawn 相关的 `spawnargs`/`argv`(防 key 经 argv 入日志)。redact 路径清单(`REDACT_PATHS`)与脱敏函数 `redact`/`redactArgv` 同落 `@sylux/shared/src/security/redact.ts`(D15 / §1.3),pino 配置与安全 08 各通路应用点**共用这一份常量**,不各自维护。规则本体归安全 08 §3。
- 子进程 stdout 原始 JSONL 入 `debug` 级,且经同一 redact 管道;raw log(safeParse 失败留证)写独立文件,也过 redact。
- 日志落 `logs/`(`.gitignore`);开发期 `pino-pretty` 美化,生产/CI 用 JSON 行。
- 一条日志只记一件事;不拼接长字符串,把可变量放结构化字段(便于检索)。

---

## 9. 注释规范 + Conventional Commits + 分支 + git hooks

### 9.1 注释规范(总体 §11.3)

- 注释写**"为什么"**,不写"是什么"(代码自解释做什么);解释意图、权衡、坑、不变量。
- 复杂算法块顶写**不变量**:收敛检测指纹差集(02 §9.3)、worktree 3-way 合并(06)、buildChildEnv 白名单(安全 08)等,块顶用注释列出"本块维持的不变量",对应 02 §0.3 的 I1–I5 风格。
- 公共 API(各包 index 导出的函数/接口)写 TSDoc:`@param`/`@returns`/`@throws`(标可能抛的 `SyluxErrorCode`)。
- 失败路径注释(§5.4):关键失败分支顶部写明策略 + 关联文档锚点(如 `// 见 02 §6.3 失败路径`)。
- 引用其他文档用稳定锚点(`02 §8.4`、`安全 08 R8`),不贴大段重复内容(防漂移,G2)。
- 禁止注释掉的死代码入库(`git` 即历史);TODO 带责任与上下文:`// TODO(M2): 收敛指纹接 brakes,见 04`。

### 9.2 Conventional Commits + commitlint(M2+)

提交信息遵循 Conventional Commits;commitlint 在 M2+ 经 `commit-msg` hook 强制(M1 手动遵循,G4 渐进)。

格式:`<type>(<scope>): <subject>`,subject 用祈使句、≤72 字符、句尾不加句号。

允许的 `type`:

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 不改行为的重构 |
| `perf` | 性能 |
| `test` | 加/改测试 |
| `docs` | 文档(含 docs/ 设计稿) |
| `build` | 构建/依赖/tsup/vite |
| `ci` | CI 配置 |
| `chore` | 杂项(版本、lockfile、配置) |
| `style` | 纯格式(基本由 prettier 代劳,少用) |
| `revert` | 回滚 |

允许的 `scope`(与包/横切关注对齐,commitlint `scope-enum` 锁定):

```
shared, core, providers, agents, server, web,    // 六包
engine, playbook, brakes, blackboard, adapter,   // core 内子域(adapter=AgentAdapter 接口 §2.5)
adapter-codex, adapter-claude, proc,             // agents 内子域(proc=spawn 包装/argv 预扫)
ws, rest, runtime, cli,                          // server 内子域
provider, keystore,                              // providers 内子域(keystore=apiKeyRef 解析)
schema, security, firewall, build, ci, deps, release, docs, repo  // 横切(security/firewall 落 shared/security/ §1.3)
```

> 子域调整(对齐 §1.3/§1.4/§2.5):`env` 改 `keystore`(buildChildEnv 移出 providers 落 shared,providers 只留 keystore);`firewall` 从 agents 子域移入横切(本体落 shared/security,应用点散在 agents/core);`adapter` 新增(core 拥有的 AgentAdapter 接口)。`security`/`firewall` 标横切因其本体在 shared 但语义跨 agents/server/core。

```cjs
// commitlint.config.cjs
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat','fix','refactor','perf','test','docs','build','ci','chore','style','revert']],
    'scope-enum': [2, 'always', [/* 上表全部 scope */]],
    'scope-empty': [2, 'never'],          // 强制带 scope,定位改动域
    'subject-case': [2, 'never', ['upper-case','pascal-case']],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
```

- 破坏性变更(尤其 02 契约破坏性变更 → `SCHEMA_VERSION+1`,02 §1.2)在 footer 标 `BREAKING CHANGE:` 并说明迁移。
- commit 正文(body)写"为什么改 + 影响面";多包改动列受影响包。
- 单次提交聚焦一件事;跨包大改拆多 commit(同 PR)。

### 9.3 分支策略(总体 §11.5)

- **trunk-based**:`main` 始终可构建可测(`pnpm check` 绿)。
- 功能分支:`feat/<scope>-<short>`(如 `feat/agents-codex-spawn`);修复 `fix/<scope>-<short>`;文档 `docs/<short>`。
- **禁直接 push `main`**,一律走 PR;PR 必须过 CI(typecheck/lint/format/test,含 windows-latest)才可合。
- PR 标题用 Conventional Commits 风格;描述含:改动摘要 / 测试情况 / 关联文档锚点 / 是否破坏契约。
- 合并策略:squash merge(保持 main 线性,一个 PR 一个 commit);合并信息即 Conventional Commit。
- **与运行期 agent worktree 区分**(总体 §11.5 强调):本节是 **sylux 源码仓库**的分支规范;运行期两 CLI 各自的 git worktree(隔离文档 09 / 红队 R7)是另一回事,不适用本节。

### 9.4 git hooks(husky + lint-staged,M2+)

```bash
# .husky/pre-commit
pnpm lint-staged          # 只对暂存文件跑(快)
pnpm secret-scan          # 自定义:扫暂存内容里的 sk-/base64 key/.env 命中(G3/安全09)
```
```bash
# .husky/commit-msg
pnpm commitlint --edit "$1"
```
```bash
# .husky/pre-push
pnpm typecheck            # tsc -b 全仓增量,挡住类型错误进远端
```

```cjs
// lint-staged.config.cjs
module.exports = {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{js,cjs,mjs,json,jsonc,md,yml,yaml}': ['prettier --write'],
};
```

- hooks **不跳过**(G3 / git_safety):`--no-verify` 仅在明确授权下用。
- secret-scan 是本地第一道防线;与运行期 argv 预扫描(安全 08 R8)、出境 scan(M5)是三道不同关卡。
- Windows 上 husky 经 git core.hooksPath 生效;【待实测】PowerShell 环境下 husky v9 钩子脚本(sh)在 Git for Windows 自带 bash 下执行正常性,M2 启用时验证。

---

## 10. CI 工作流(.github/workflows/ci.yml)

CI 是规范的最终执法者:本地可绕(误删 hook),CI 不可绕。M1 起最小 CI(单平台),M2 加 windows matrix(总体 §13)。

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]   # M2 起含 windows(G1,事实地基 A 的 spawn 坑只在 win 暴露)
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.13', cache: 'pnpm' }
      - run: corepack enable                   # 用 packageManager 字段锁定的 pnpm
      - run: pnpm install --frozen-lockfile    # lockfile 不一致即失败(§7.1)
      - run: pnpm typecheck                    # tsc -b
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test                         # vitest run(@e2e 默认跳,总体 §12.1)
      - run: pnpm build                        # 确保产物可构建
```

规则:
- CI 任一步红即阻断合并(分支保护要求 check 通过)。
- `--frozen-lockfile` 防"忘提交 lockfile"或"本地手改 node_modules"。
- e2e(真起中枢真调 codex,`@e2e` 标签)默认跳,单独工作流手动触发(避免 CI 跑真中转烧 token,事实地基 D)。
- windows-latest 是硬要求:Windows spawn 三连坑(事实地基 A)、CRLF、路径分隔符只在 win 跑才暴露。
- registry 在 CI 用 npmmirror(`.npmrc` 入库,CI 自动生效);若 CI 在境外 runner 可能反而慢,M2 评估 CI 专用 `.npmrc` override(本地开发恒用 npmmirror)。

---

## 11. 根 scripts(总体 §11.6 展开)

```jsonc
{
  "scripts": {
    "build":        "pnpm -r build",                          // 拓扑序构建各包
    "dev":          "tsx watch packages/server/src/index.ts", // 中枢热重载
    "dev:web":      "pnpm --filter @sylux/web dev",           // vite dev server
    "typecheck":    "tsc -b",                                 // 全仓增量类型检查
    "lint":         "eslint .",
    "lint:fix":     "eslint . --fix",
    "format":       "prettier --write .",
    "format:check": "prettier --check .",
    "test":         "vitest run",
    "test:watch":   "vitest",
    "test:cov":     "vitest run --coverage",
    "secret-scan":  "node scripts/secret-scan.mjs",           // pre-commit 调(§9.2)
    "commitlint":   "commitlint",
    "clean":        "pnpm -r clean && rimraf .turbo coverage", // 各包 clean + 根产物
    "check":        "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test",
    "prepare":      "husky"                                    // 装 hooks(M2+)
  }
}
```

- `pnpm check` 是合并前本地自检的单一入口(= CI 的本地镜像)。
- `pnpm -r <task>` 按依赖拓扑序在各包跑;M2+ 可换 `turbo run <task>` 拿缓存。
- `dev` 用 tsx watch(零配置 ESM,不用 ts-node)。

---

## 12. 落地顺序与里程碑映射(对接总体 §13)

本规范分阶段落地,不在 M1 一次性堆全套工具链(G4 / 红队"不能先搭一整套再验地基"):

| 阶段 | 本文件哪些条目生效 | 暂缓 |
|---|---|---|
| **M0 可行性闸** | 无脚手架;只 fixtures/ 录制 + 假 CLI(§1.1) | 全部包/配置 |
| **M1 最小可行** | 目录树(§1,含 shared/security/ 子树 §1.3)、依赖图(§2,含注入边界 §2.5)、仓外数据目录(§1.7)、package.json/exports(§3)、命名(§4)、错误处理(§5)、tsconfig+references(§6)、pnpm+npmmirror+lockfile(§7.1–7.4)、eslint/prettier/editorconfig/gitattributes(§8)、注释规范(§9.1)、最小单平台 CI(§10)、根 scripts(§11) | turbo、commitlint、husky hooks、windows matrix、shared/node 子面(可后补) |
| **M2 工程化** | commitlint+husky hooks(§9.2/§9.4)、windows-latest matrix(§10)、turbo(§7.5)、secret-scan hook、shared exports 子面(§3.3) | — |
| **M3+** | scope-enum 随新增 playbook/子域扩充(§9.2);新增包准入门槛(§2.4)按需 | — |

### 12.1 与其他文档的接口(本文件不越界)

| 关注点 | 本文件负责 | 归属文档 |
|---|---|---|
| 包放哪/怎么分/依赖方向 | ✅ | 本文件 |
| 命名/错误处理/日志/注释/提交/分支/lint/CI | ✅ | 本文件 |
| `Message`/`Evidence`/`AgentEvent`/错误码定义 | 只规定落点与导出纪律 | 02 |
| 用哪个库/锁哪个版本 | 只规定"精确锁定 + workspace:* + npmmirror"策略 | 12 |
| 安全工具落哪个包(D15) | ✅ 落 `@sylux/shared/security/`(§1.3,据 12 §2.4) | 本文件 + 12 |
| 文档编号 ↔ 文件名映射(C-NUM) | ✅ 文件名为唯一权威(§0.2) | 本文件 |
| 仓外运行期数据目录 / approvedDataRoot | ✅ `~/.sylux/` 布局(§1.7) | 本文件(08/09 消费) |
| AgentAdapter 接口落哪个包(注入边界) | ✅ 落 `@sylux/core`(§2.5) | 本文件(03/05 对齐) |
| engine/playbook/blackboard 行为 | 只给目录建议 | 03 |
| adapter spawn 细节 | 只给目录建议 | 04/05/06 |
| provider 配置 schema | 只给目录建议 + 字段命名边界 | 07 |
| redact 路径清单/防火墙/env 白名单 | 只规定"日志必 redact、secret-scan 三关卡" | 安全 08 |
| WS 协议/面板组件 | 只给目录建议 + web 依赖边界 | 10/11 |

---

## 13. 收尾:本文件的权威性声明

1. **工程组织唯一权威**:六包划分(`shared/core/providers/agents/server/web`)、依赖方向(§2.1 图 + §2.2 矩阵)、目录树(§1)以本文件为准;任何新增包走 §2.4 准入。
2. **规范唯一权威**:命名(§4)、错误处理(§5)、tsconfig(§6)、依赖管理(§7)、lint/format/日志(§8)、注释/提交/分支/hooks(§9)、CI(§10)、scripts(§11)以本文件为准,是总体 §11 的完整展开;冲突以本文件为准并回填 §11。
3. **不越界**:类型定义引用 02、选型引用 12、各包行为引用 03–11,本文件只规定"怎么组织、怎么约束、怎么提交、怎么验",不重写它们的内容(防漂移,G2)。
4. **回填项(本文件相对总体规划的增强)**:
   - §0.2:全仓文档编号锚定盘上文件名(安全=08、隔离=09、面板=10、WS=11)→ 回填 01/02/05/06/11/12/22/23 等逻辑编号派稿的交叉引用(C-NUM)。
   - §1.3:`@sylux/shared/src/security/` 子树(安全工具落点,D15)→ 据 12 §2.4 裁决;05 删 `@sylux/agents/proc`、06 删 `@sylux/security`,统一 `from '@sylux/shared'`。
   - §1.5:CLI 入口与 `@sylux/server` 同包(消解简报"cli"独立包的歧义)→ 回填总体 §11.1 包清单说明。
   - §1.7:仓外 `~/.sylux/` 数据目录 + `approvedDataRoot` 默认值(吃掉 08 §2.5 / 12 转交)→ 08 `isInjectedPathSafe`、09 worktree 据此锚定。
   - §2.1/§2.2:依赖谱对齐 12 §2.3(agents→providers ✅、providers↛core、agents→core 仅接口)→ 修正 v1 矩阵三处错标。
   - §2.5:`AgentAdapter`/`AgentInput` 接口落 `@sylux/core`(消解 core↔agents 环)→ 03 §4.3 import 改 `from '@sylux/core'`、05 接口归属改标 core。
   - §3.3:`@sylux/shared` 增 `./node` exports 子面(隔离 node-only 实现,服务 web 类型纯净)→ 总体 §10/§11 未提,建议补注。
   - §5.1:点名 02 §12 `SyluxErrorCode` union 必补的下游缺码清单(A1/COV-1)→ 02 定稿一次性补齐并与 15 Record 穷举对齐。
   - §9.2:commitlint `type-enum`/`scope-enum` 全集落定 → 总体 §11.5 仅提"Conventional Commits + commitlint",此处补全枚举。
5. **演进纪律**:新增 playbook/子域时同步扩 §9.2 `scope-enum`;新增依赖按 §7.4/§7.6 锁版 + 供应链检查;破坏 02 契约必随 `SCHEMA_VERSION+1`(02 §1.2)且 commit 标 `BREAKING CHANGE:`。

### 13.1 留给定稿的 openQuestions(本文吃不掉、需多稿/用户共定)

1. **编号回填是全仓动作**(§0.2):本文已自洽锚定文件名号,但 01/02/05/06/11/12/22/23 仍有逻辑号残留(C-NUM 跨全仓)。本文只能裁定"以文件名为准 + 双锚点",**逐稿正文回填需各稿 owner 执行**;且"安全 08↔面板 10"对调属用户可推翻的命名口味,定稿前请用户拍一次板。
2. **AgentAdapter 接口归属**(§2.5):本文据 master §12.2 裁定落 `@sylux/core`,但与 05 现稿"接口归 agents"、03 §4.3 现 import 路径冲突。需 03/05/12 三方在定稿确认接口落 core(本文倾向),否则 core↔agents 环无法消除。这是**编译期硬约束**(tsc -b 成环直接报错),不是口味问题,必须有结论才能开 M1·T1.3/T1.5。
3. **仓内 vs 仓外 runs/logs 双写**(§1.7):本文定"`SYLUX_DATA_ROOT` 是否设定 二选一不双写",但黑板 jsonl 主副本到底落仓内 `runs/`(开发就近)还是仓外 `~/.sylux/runs/`(长跑归档),涉及 02 §7 持久化与 09 worktree 的路径锚点,需与 02/09 对齐一处主路径(contentHash 锚点不能指两地)。
4. **shared/security/ 与 02 同包的导出膨胀**(§1.3):安全工具落 shared 后,`@sylux/shared` 的 index re-export 清单同时承载"黑板类型(02 §11)"与"安全工具(08)"两类。02 §11 的 re-export 清单是否需要为 security/ 留一节、还是 shared 单设 `@sylux/shared/security` 子面(类似 `/node`),需与 02 协商导出面切分(本文倾向不再切子面,直接根面 re-export,避免第三个 exports 入口)。
5. **【待实测】**:tsup 多入口 d.ts 路径(§3.3)、husky on Windows(§9.4)、turbo Windows 缓存(§7.5)三项本机行为,M1/M2 落地时验证,不阻塞设计。










