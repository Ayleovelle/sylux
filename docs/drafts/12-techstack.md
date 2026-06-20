# 12 · 技术栈与依赖选型(权威选型 + 版本锁定 + 镜像)· v2

> **v2 变更摘要(本轮:逐条吃掉 x-consistency / x-coverage / red-feasibility / red-security 点名 12 的 findings)**:五份红队/交叉报告**已存在于仓内**,逐条核对后硬化:
> - **C-NUM / E13 / x-consistency(本稿头部 08、正文 09 自相矛盾)** → 全文统一**锚定磁盘文件名编号**:安全 = `08-security-firewall.md`(=08)、隔离 = `09-isolation-worktree.md`(=09)。删除正文所有"安全 09"误标,改"安全 08"。见 §0.0 编号锚定声明。
> - **D15 / x-consistency(@sylux/security 等安全工具包落点未定,05 用 `@sylux/agents/proc`、06 用 `@sylux/security`、08 建议 `@sylux/shared`,三处 import 路径不统一)** → §2.4 给出**落点裁决**:安全工具(`SECRET_SIGNATURES` / `redact` / `redactArgv` / `buildChildEnv` / `BASE_ENV_ALLOWLIST`)**落 `@sylux/shared`,不新增 `@sylux/security` 包**;05/06 一律 `import ... from '@sylux/shared'`,废弃 `@sylux/agents/proc` 与 `@sylux/security` 两种写法。
> - **E10 / x-consistency(`buildChildEnv(agent)` 单参形态 vs 08 §2.2 权威单对象 `{providerEnv,agentId}`)** → §3.3 调用姿势改为单对象签名,与 08 §2.2 `BuildChildEnvInput` 逐字对齐。
> - **RS-M1 / red-security(流式 redact 按帧无状态,密钥跨帧分片各自不匹配正则)** → §5.3 redact 短板表新增第 4 行(跨帧分片泄漏)+ 对策(过闸前先按对象/整行缓冲再 redact;入口"key 永不进 argv"对 argv 通路免疫,stderr/WS 流式通路由 08/11 拥有缓冲规则)。
> - **FEAS-7 / red-feasibility(M0 闸依赖未建的 `@sylux/shared/dist`)** → §3.5 + §10.2 Q3 对齐 24 §158 已落定的处置:**M0 不建任何包**,schema 体积探针用一次性 `probe-schema-size.mjs`(内联 schema 直接量,脚本即弃),execa 冒烟用 `fixtures/fake-codex.mjs`,二者均不 `require` `@sylux/shared/dist`。
> - **COV-1 / x-coverage(02 §12 SyluxErrorCode union 缺下游已用码)** → §10.1 新增跨引用注:本文件用到的 `SUBPROCESS_SPAWN_FAILED` 等错误码权威落点在 02 §12,union 补全是 02 的回填项,本文件只引用不另定义。
>
> **类型一律引用 02**:凡 `Message`/`Evidence`/`AgentEvent`/`SyluxError`/`SyluxErrorCode` 等类型与错误码,**唯一权威定义在黑板协议(02)** `@sylux/shared/src/blackboard.schema.ts`,本文件只引用、不另写。

> **本文件地位**:sylux 全项目的技术栈与依赖**选型权威**。语言/运行时/包管理/每个关键依赖的候选对比、决策理由、锁定版本、安装命令(走 npmmirror),都在此定稿。其他文档(引擎 03、刹车 04、适配 05/06、provider 07、安全 08、隔离 09、Web 10、WS 11)涉及"用哪个库/哪个版本"时引用本文件,不另列。
>
> **与总体规划 §10/§11 的关系**:`docs/sylux-master-plan.md` §10(技术栈表)、§11(工程规范)是本文件的**摘要镜像**;本文件是其完整展开(补候选对比矩阵、版本锁定理由、Windows spawn 选型的事实裁决、供应链安全、安装与离线)。二者冲突以本文件为准,并回填修正 §10/§11。
>
> **类型契约不在本文件**:凡 `Message`/`Evidence`/`AgentEvent` 等类型,一律引用"黑板协议(02)"(`@sylux/shared/src/blackboard.schema.ts`),本文件不另写。
>
> **事实标注约定**:凡本机已实测(见 `docs/PROBED-FACTS.md`)的结论直接当事实用,**不再标【待实测】**;仅对本文件新引入、尚未实测的库行为标【待实测】。

---

## 0.0 文档编号锚定(吃掉 C-NUM 双轨制)

x-consistency C-NUM/E7/E13 指出全仓存在"文件名编号派 vs 逻辑编号派"双轨制,且本稿 v1 自身头部用 08、正文用 09 指安全文档,自相矛盾。**本文件统一锚定磁盘文件名编号**(与 `docs/drafts/` 实际文件名一致):

| 引用编号 | 磁盘文件名 | 职责 |
|---|---|---|
| 08 | `08-security-firewall.md` | 密钥安全与内容防火墙(`buildChildEnv`/redact/防火墙权威) |
| 09 | `09-isolation-worktree.md` | 文件隔离与 worktree 生命周期 |
| 10 | `10-web-ui.md` | Web 观战面板 |
| 11 | `11-ws-protocol.md` | WS 线协议 |

> 凡本文件出现"安全 08""隔离 09"均指上表;v1 残留的"安全 09"已全量改正为"安全 08"。其余 01–07/13–25 同此口径(锚文件名)。

---

## 0. 选型总原则(先讲清裁决标准)

本项目的依赖选型不是"挑流行库",而是被四条硬约束反向约束(全部来自锁定决策与事实地基):

| # | 原则 | 来源 | 对选型的直接影响 |
|---|---|---|---|
| P1 | **Windows spawn 真实路径优先** | 事实地基 A | 子进程库必须支持"直 spawn 绝对 exe 路径 + prompt 走 stdin",不能依赖 PATH 上的 `.cmd`/裸名 shim |
| P2 | **一份 zod 三职** | 02 §0.1 / 总体 §2 | schema 库必须能同时产 TS 类型 + 运行期 safeParse + JSON Schema(喂 CLI),排除"只校验不出 JSON Schema"的库 |
| P3 | **凭证零泄漏** | 红队 R8 / 安全 08 | 进程库须支持 `env` 完整替换(`extendEnv:false`)、日志库须能 redact 到 `spawnargs` 数组 |
| P4 | **本地单机、可锁定、可离线** | 总体 §10 | 不引重型分布式件(socket.io 降级、turbo 初版);版本**精确锁定**,装包走 npmmirror,lockfile 入库 |

> 选型若与 P1–P4 冲突,选型让步。下面每个候选对比表的"裁决"列都回指这四条。

---

## 1. 语言 + 运行时:TypeScript 5.7 + Node.js 22 LTS(ESM)

### 1.1 候选对比

| 维度 | **TS 5.7 + Node 22 (选)** | Node 20 LTS | Bun 1.x | Deno 2 |
|---|---|---|---|---|
| 本机现状 | `v22.13.0` 已装(事实地基) | 需降级 | 未装 | 未装 |
| 内置 `WebSocket` 客户端 | ✅(Node 22 稳定全局 `WebSocket`,面板/自测可用) | ⚠️ 实验/无 | ✅ | ✅ |
| 内置 `fetch` | ✅ | ✅ | ✅ | ✅ |
| 子进程 spawn 绝对 exe(P1) | ✅ `child_process.spawn` 成熟 | ✅ | ⚠️ Windows spawn/stdio 成熟度不足 | ⚠️ 跑外部 CLI 摩擦 |
| 外部 npm CLI 生态(execa/ws/pino) | ✅ 原生 | ✅ | ⚠️ 兼容层 | ⚠️ `npm:` 前缀摩擦 |
| 顶层 await(编排循环友好) | ✅ ESM | ✅ | ✅ | ✅ |
| 裁决 | **选**:P1 spawn 最成熟 + 本机已装 + 三内置(WebSocket/fetch/test) | 没有升级理由 | 弃:P1 Windows spawn 不达标 | 弃:P4 与外部 CLI 摩擦 |

**结论**:TypeScript 5.7+ 编译,运行时 Node.js 22 LTS(锁定本机 `v22.13.0` 为开发基线),全仓 ESM(`"type":"module"`)。

### 1.2 为什么 Node 22 而非 Bun/Deno(对抗性正面回答)

唱反调的会问"Bun spawn 更快、Deno 更安全,为何不用?"——本项目的命脉是**在 Windows 上稳定 spawn 两个真实 CLI exe 并接管 stdio**(事实地基 A)。Bun 在 Windows 的 `child_process`/stdio 行为成熟度不足,Deno 跑非托管外部二进制需额外权限与 `npm:`/`node:` 兼容层。这俩的优点(启动速度、内置 TS)对一个**长驻、IO 受限于子进程**的编排中枢几乎无收益,而其 Windows spawn 风险正打在项目命门上。故弃。

### 1.3 ESM + NodeNext 的硬约束

- `"type":"module"`,TS `module/moduleResolution:NodeNext`、`verbatimModuleSyntax:true`、`isolatedModules:true`(总体 §11.4)。
- **相对导入必须带 `.js` 后缀**(NodeNext 要求;02 §11 已按此写 re-export)。
- `verbatimModuleSyntax` 强制 `import type` 与值导入分离(配合 ESLint `consistent-type-imports`)。
- 编排主循环用顶层 `await` 串联轮次,无需额外 async 包装。

### 1.4 TypeScript 编译关键项(展开总体 §11.4,给全)

```jsonc
// tsconfig.base.json(compilerOptions 摘要,各包 extends 之)
{
  "target": "ES2023",
  "lib": ["ES2023"],                  // web 包另加 "DOM","DOM.Iterable"
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "strict": true,
  "noUncheckedIndexedAccess": true,   // 子进程返回数组/记录强制判空,正中"输出对齐"
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "composite": true,                  // project references 增量
  "incremental": true,
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true,
  "forceConsistentCasingInFileNames": true,
  "skipLibCheck": true,               // 只跳第三方 .d.ts,自有代码仍全检
  "resolveJsonModule": true
}
```

> `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 是刻意选的"贵但值"严格项:子进程 JSON 里缺字段、数组越界访问会在编译期暴露,直接服务 P2/输出对齐。代价是写代码要多处理 `T | undefined`,这是项目要的纪律,不是负担。

---

## 2. 包管理:pnpm 9(corepack 启用)+ workspaces

### 2.1 候选对比

| 维度 | **pnpm 9 (选)** | npm workspaces | yarn berry |
|---|---|---|---|
| 本机现状 | 未装,但 Node22 自带 corepack 可零安装启用 | 自带 | 未装 |
| monorepo 硬链接 node_modules(省盘/快) | ✅ | ❌ 扁平复制 | ⚠️ PnP 与外部 CLI 摩擦 |
| 严格依赖(禁幽灵依赖) | ✅ 默认 | ❌ | ✅ |
| `workspace:*` 协议 | ✅ | ⚠️ 弱 | ✅ |
| 配 npmmirror(P4) | ✅ `.npmrc registry=` | ✅ | ✅ |
| 与外部二进制 CLI(codex/claude)共存 | ✅ 不接管 | ✅ | ⚠️ PnP 可能干扰 |
| 裁决 | **选**:严格依赖 + 硬链接 + corepack 零额外安装;yarn PnP 与"spawn 外部 CLI"理念冲突 | monorepo 体验弱 | PnP 摩擦 |

**结论**:pnpm 9+,经 corepack 启用(不全局 `npm i -g pnpm`):

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate   # 锁定 minor,避免 CI/本机漂移
pnpm -v                                    # 验证
```

> 用 corepack 固定 pnpm 版本(`packageManager` 字段)而非全局装,保证本机与 CI 同一 pnpm,消除"我这能跑你那不行"。

### 2.2 Monorepo 物理结构(展开总体 §11.1)

```
G:\sylux\
├─ pnpm-workspace.yaml          # packages: ['packages/*']
├─ package.json                 # 根:private:true + packageManager:"pnpm@9.15.0" + 根 devDeps + scripts
├─ tsconfig.base.json           # 共享 compilerOptions(§1.4)
├─ tsconfig.json                # references 指向各 composite 包
├─ .npmrc                       # registry=npmmirror + pnpm 设置(§7.2)
├─ .editorconfig                # 统一缩进/字符集
├─ .gitattributes               # * text=auto eol=lf(Windows 必备,防 CRLF 污染 contentHash,呼应 02 §9.1)
├─ eslint.config.js             # flat config(§5.1)
├─ prettier.config.js
├─ vitest.config.ts
├─ .github/workflows/ci.yml     # 含 windows-latest(M2)
├─ packages/{shared,core,providers,agents,server,web}/
├─ fixtures/                    # 录制的 codex/claude JSONL + fake-codex.mjs(M0 产物)
└─ docs/
```

### 2.3 依赖方向(单向、禁环)与各包依赖

依赖图(总体 §10):`shared ← core ← {providers, agents} ← server ← web`。`import/no-cycle`(ESLint)在 CI 焊死。

| 包 | 运行时依赖(本文件锁定版见 §6) | 职责回指 |
|---|---|---|
| `@sylux/shared` | `zod`、`zod-to-json-schema` | 类型契约 02(唯一权威) |
| `@sylux/core` | `@sylux/shared`、`pino`、`nanoid` | 引擎 03 / 刹车 04 |
| `@sylux/providers` | `@sylux/shared`、`zod` | provider 配置 07 |
| `@sylux/agents` | `@sylux/shared`、`@sylux/providers`、`execa`、`zod` | 适配 05/06 + 安全 08 守卫 |
| `@sylux/server` | `@sylux/core`、`@sylux/agents`、`ws`、`commander`、`pino` | WS 11 / CLI 入口 |
| `@sylux/web` | `react`、`react-dom`、`zustand`、`diff2html`(+ Vite devDeps) | Web 10。**仅经 WS/REST 与 server 通信,只共享 `@sylux/shared` 类型** |

> `@sylux/shared` 是图最底层,**只许依赖 zod 系**,严禁反向依赖任何 sylux 内部包(02 §1.1)。web 不直接 import server 任何运行时代码,只 import `@sylux/shared` 的 `type`。

### 2.4 安全工具包落点裁决(吃掉 D15:三处 import 路径不统一)

x-consistency D15 实证:同一批安全工具在三稿里 import 路径各不相同——06 写 `@sylux/security`、05 写 `@sylux/agents/proc`、08 §10 建议 `@sylux/shared`。R1(单一权威)要求**一个落点、三稿统一**。08 §10 把这个落点裁决显式转交"12/13 共定"。本文件(选型权威)裁决如下,13(物理目录)据此回填:

**裁决:安全工具全部落 `@sylux/shared`,不新增 `@sylux/security` 包;`@sylux/agents/proc` 子路径导出作废。**

| 工具(权威定义在) | v1 各稿散落路径 | **v2 统一落点** |
|---|---|---|
| `SECRET_SIGNATURES`(08 §2.4) | `@sylux/security`(06)/ 内联(05) | `@sylux/shared` |
| `redact` / `redactText` / `redactArgv`(08 §3) | `@sylux/security`(06) | `@sylux/shared` |
| `buildChildEnv` / `BASE_ENV_ALLOWLIST`(08 §2.2) | `@sylux/agents/proc`(05) | `@sylux/shared` |
| `firewallPeerMessage`(08 §4) | `@sylux/security`(06) | `@sylux/shared` |

裁决理由(回指 P2/P3 与依赖图 §2.3):

1. **依赖方向干净**:这些工具(redact 正则、env 白名单、密钥特征签名)零运行时依赖,只需 zod 偶尔校验。落 `@sylux/shared`(图最底层)后,`core`/`agents`/`server` 全可单向 import,**不制造新包层、不引入环**(`import/no-cycle` 焊死,§2.3)。
2. **与 02 同包,天然单一权威**:`SECRET_SIGNATURES`/`buildChildEnv` 要被 05/06/08/11/server 多处共用,放 `@sylux/shared` 与黑板类型同包,杜绝"agents 内部子路径"被深引(13 §1.2 `no-restricted-imports` 禁 `@sylux/<pkg>/src/...` 深引,`@sylux/agents/proc` 正属被禁形态)。
3. **不新增 `@sylux/security` 包**:13 包清单(§2.3)只有 `shared/core/providers/agents/server/web` 六包,无 security 包。新增一个只装几个纯函数的包是过度切分,徒增 `workspace:*` 边界与 build 目标。08 §10 本身也"倾向 `@sylux/shared`"。

物理落点(13 §1.3 `@sylux/shared` 内部树回填):`packages/shared/src/security/`(`secret-signatures.ts` / `redact.ts` / `child-env.ts` / `firewall.ts`),由 `packages/shared/src/index.ts` 统一 re-export。05/06/08 一律 `import { buildChildEnv, redact, SECRET_SIGNATURES, firewallPeerMessage } from '@sylux/shared'`。

> **回填动作(交 13 与 05/06)**:13 §1.3 把 `security/` 子目录补进 `@sylux/shared` 内部树;05 删 `@sylux/agents/proc` 写法与内联 `KEY_PATTERNS`,06 把 `@sylux/security` 改 `@sylux/shared`。本裁决只定"落哪个包",**规则/正则/签名集本体仍归 08 权威**,shared 只是其物理宿主。

---

## 3. 子进程:execa 9 —— 但被事实 A 强约束(本文件最关键选型)

这是全项目最危险的依赖决策。总体 §10 选了 execa 9 但把 Windows `.cmd` 行为标【待实测】(§4.5/Q1)。**事实地基 A 已把它从假设变成事实**,故本节不再标【待实测】,而是给出事实裁决:execa 留用,但**用法被钉死**——绝不依赖它的 PATH/`.cmd` 解析,改为我们自己解析绝对 exe + prompt 走 stdin。

### 3.1 候选对比

| 维度 | **execa 9 (选)** | 原生 `node:child_process` | cross-spawn | tinyexec |
|---|---|---|---|---|
| Promise + 流式 stdout | ✅ | ⚠️ 需自封装 | ⚠️ 仅 spawn 垫片 | ✅ 轻量 |
| `input`(喂 stdin)便捷(P1 必需) | ✅ `{ input }` | ⚠️ 手动 `stdin.write/end` | ❌ | ⚠️ 有限 |
| `env` 完整替换 `extendEnv:false`(P3) | ✅ | ✅(`env` 直传) | ✅ | ⚠️ |
| 超时 + `kill`(含子进程树) | ✅ `timeout`+`forceKillAfterDelay` | ⚠️ 手动 | ❌ | ⚠️ |
| 暴露 `spawnargs`(供安全预扫描 R8) | ✅ | ✅ | ✅ | ⚠️ |
| `shell:false` 直 spawn 绝对路径 | ✅ | ✅ | ✅ | ✅ |
| 维护/类型 | ✅ 一线、内置 d.ts | ✅ 内置 | ✅ 老牌 | 🟡 较新 |
| 裁决 | **选**:stdin/timeout/kill/env 一站齐,且能 `shell:false` 直喂绝对路径 | 可行但要重造 execa 七成功能 | 只解决 spawn,缺流/超时 | 太新,kill/树清理不稳 |

**结论**:`execa@9`。**但**(下面是命门)——

### 3.2 事实 A 把 execa 的"省心用法"全判死刑

事实地基 A 实测三连(失败→失败→成功)直接否决了 execa 的两种常见用法:

| 想当然的用法 | 事实 A 结论 | 本项目处置 |
|---|---|---|
| `execa('codex', ['exec', ...])`(裸名,靠 PATH) | ❌ PATH 上 `codex` 是无扩展名 bash shim → `%1 is not a valid Win32 application` | **禁**。绝不用裸名 |
| `execa('codex.cmd', ['exec', '"带空格 prompt"'])` | ❌ `.cmd` 的 `%*` 把带空格 prompt 展开打散 → `unexpected argument 'with'` | **禁**。prompt 永不进 argv |
| `execa(..., { shell: true })` | ❌ shell 介入更易被 `.cmd`/引号坑,且引入注入面 | **禁**(呼应总体 §4.1) |
| Node `spawn(真实EXE, args)` + `stdin.write(prompt); stdin.end()` | ✅ 实测 `code=0`,stdout 干净 UTF-8 | **唯一干净路径** |

**裁决**:execa 留用,但**只以"`shell:false` + 绝对 exe 路径 + prompt 走 `input`(stdin)+ `windowsHide:true` + `extendEnv:false`"这一种姿势调用**。execa 在这种姿势下等价于"原生 spawn 的人体工学封装",我们享受它的 stdin/timeout/kill/流式收益,而完全绕开它的 PATH/`.cmd` 解析雷区。

> 为什么不干脆退回原生 `child_process`?因为我们要的不是"spawn 一下",而是"喂 stdin + 行式读 stdout JSONL + 硬超时 + 杀整棵子进程树 + 拿到 spawnargs 做安全预扫描"。execa 把这些一次给齐;原生要把这七成功能重写一遍且更易出错。**风险点不在 execa 本身,在于'让任何库去碰 PATH 上的 shim'**——这一点用绝对路径根除,与选哪个 spawn 库无关。

### 3.3 exe 路径解析(M0 任务,事实 A 的工程落地)

中枢启动前必须把两端 CLI 解析成**真实可执行体的绝对路径**,不碰 PATH shim:

```ts
// @sylux/agents/src/resolve-exe.ts(签名;实现 M0 落地)
export interface ResolvedCli {
  /** 直 spawn 的目标:codex 为原生 exe;claude 见 §3.4 可能是 node + 入口 js */
  command: string;
  /** 固定前缀参数(claude 走 node 时为 [entryJs, ...];codex 为 []) */
  baseArgs: string[];
}

/**
 * 解析 codex 真实 exe。事实地基 A 实测路径(本机基线):
 *   G:\npm-global\node_modules\@openai\codex\node_modules\
 *     @openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
 * 算法:从 codex 包根定位平台子包(@openai/codex-${platform}-${arch})vendor bin。
 * 失败(找不到平台包/文件不存在)→ 抛 SUBPROCESS_SPAWN_FAILED(事实地基 A / 02 §12)。
 */
export function resolveCodexExe(opts?: { codexPkgRoot?: string }): ResolvedCli;

/** 解析 claude 端。见 §3.4:Windows 是 .ps1/.cmd shim,优先解析其包裹的 node 入口 js。 */
export function resolveClaudeCli(): ResolvedCli;
```

调用姿势(全项目唯一允许的 spawn 形态,适配层 05/06 共用):

```ts
import { execa } from 'execa';
import { buildChildEnv } from '@sylux/shared';   // ← 安全工具落 shared(§2.4 / D15 裁决)

const { command, baseArgs } = resolveCodexExe();
// providerEnv 由 KeyStore.resolve(ref) 产出(07 §2);agentId 来自 02 agentIdSchema
const child = execa(command, [...baseArgs, 'exec', '--json',
    '--output-schema', schemaFilePath, '-o', outFilePath,
    '-C', worktreeDir, '-s', sandbox,
    '--skip-git-repo-check', ...providerOverrides, '-'],  // 末尾 '-' 占位:prompt 走 stdin
  {
    input: promptText,        // ← prompt 永远走 stdin,绝不进 argv(事实 A 第 2 坑)
    shell: false,             // ← 永不 shell:true
    windowsHide: true,
    env: buildChildEnv({ providerEnv, agentId }), // ← 安全 08 §2.2 单一出口,单对象签名
    extendEnv: false,         // ← P3 凭证隔离:不继承父 env 全量
    timeout: turnTimeoutMs,
    killSignal: 'SIGTERM',
    forceKillAfterDelay: 5000,// 超时后宽限,再 SIGKILL 杀子进程树
    encoding: 'utf8',         // 事实 A:Node 直接捕获即干净 UTF-8,不经 shell 重定向(否则 UTF-16 乱码)
  });
```

> 注意末尾的 `'-'` 占位:codex/claude 约定 `-` 代表"prompt 从 stdin 读"(事实地基 A/E)。`resume` 时参数集不同(事实地基 E:拒 `-s`/`-C`,需 `--skip-git-repo-check`,SESSION_ID/PROMPT 是位置参数),由适配层 05 单独拼装,**不照抄上面 exec 的 flag 集**。

### 3.4 claude 端的 spawn(同样有 shim 坑,但无独立 exe)

事实地基 F:claude 端是 `.ps1/.cmd` shim,**没有 codex 那样的独立平台 exe**——它是一个 node CLI。故 claude 端解析策略与 codex 不对称:

| 策略 | 做法 | 取舍 |
|---|---|---|
| **首选**:解析 node + 入口 js | 定位 claude 包的入口 `cli.js`,`execa(process.execPath, [cliJs, '-p', ...])` | 绕开 `.cmd` 的 `%*` 打散坑,与 codex 同一"直 spawn + stdin"纪律;`process.execPath` 即当前 node 绝对路径 |
| 备选:`.cmd` + 简单 flag + stdin | 仅当入口 js 解析不到时;所有复杂内容(prompt/schema)走 stdin 或临时文件,argv 只留无空格短 flag | `.cmd` 的 `%*` 对**无空格**参数安全;带空格内容一律不进 argv |
| **禁** | `execa('claude', ['-p','"长 prompt"'])` 裸名 + 带空格 argv | 同事实 A 第 1/2 坑 |

claude 端关键 flag(事实地基 F,适配层 06 用):`-p/--print`、`--output-format stream-json`、`--input-format stream-json`(双向流式)、`--json-schema <内联串>`、`--append-system-prompt`、`--resume`/`--continue`/`--fork-session`/`--no-session-persistence`、`--model`/`--fallback-model`。

> **claude `--json-schema` 走文件还是内联?** 事实地基 F + 总体 O4:内联串在 Windows CreateProcess 有 ~32KB 命令行上限与转义风险。本项目对齐 §6.3(02)生成的 schema **优先内联**,但适配层 06 在内联体积逼近上限时**退化为 `--input-format stream-json` 把 schema 随输入帧传**(事实 F 备选)。codex 侧写文件(`--output-schema <FILE>`)无此限。这条不对称由适配层 05/06 吸收,本文件只锁定"两端都用 zod-to-json-schema 产同一份 schema 对象"(02 §6.2)。

### 3.5 Windows spawn 冒烟实测(M0 闸,前置硬门)

事实 A 已把"能不能 spawn"验成事实,但 execa **这个库**在事实 A 姿势下的三项行为仍需在 M0 录一次基线(对应总体 §4.5 / T0.4 / Q1),过了才进 M1:

| 冒烟项 | 验收 | 失败回退 |
|---|---|---|
| (a) execa `shell:false` + 绝对 exe 命中 | `code=0`,stdout 为干净 UTF-8 JSONL,**无需** `shell:true` | 退回原生 `child_process.spawn`(同绝对路径+stdin) |
| (b) `{ input }` 喂含中文/换行的 JSON prompt | 子进程收到字节完整(无截断/无编码错乱) | 改 `child.stdin.write(Buffer.from(s,'utf8'))` 手动喂 |
| (c) `timeout` 触发后 `kill` 杀**整棵**子进程树 | 中转/MCP 子孙进程一并退出,无僵尸 | 加 `tree-kill` 或 `taskkill /T /F`(仅 M0 验证后决定是否引入) |

> M0 用 `fixtures/fake-codex.mjs`(真 `.cmd` shim 包 node,模拟事实 A 的 shim 结构)做 (a)(b)(c),无需真烧 token;真实 codex 仅录一份 `--json` JSONL 存 `fixtures/` 供 execa-mock 用(总体 §12.2)。**(a)(b)(c) 三项任一不过,M1 不启动。**
>
> **M0 不建任何包(吃掉 FEAS-7)**:red-feasibility FEAS-7 指出 M0 闸的 schema 探针 v1 写法 `require('./packages/shared/dist/index.js')` 依赖未建的 `@sylux/shared/dist`,而建 shared 是 M1·T1.2、M0 明禁建包——闸门依赖自己产物,死锁。处置已对齐 **24 §158**:M0 的 execa 冒烟只用 `fixtures/fake-codex.mjs`,schema 体积探针(Q3)用一次性 `probe-schema-size.mjs`(把 `agentMessagePayloadSchema` + `zodToJsonSchema(..., {$refStrategy:'none'})` 抄进临时脚本直接量,脚本即弃不进仓),**两者都不 `require` `@sylux/shared/dist`**。M0 全程零 `pnpm build`。

---

## 4. 校验/Schema:zod 3.23 + zod-to-json-schema(一份三职)

### 4.1 候选对比

| 维度 | **zod 3.23 + zod-to-json-schema (选)** | valibot | ajv(JSON Schema 优先) | io-ts |
|---|---|---|---|---|
| 编译期 `z.infer` 导出 TS 类型(P2①) | ✅ | ✅ | ❌ 需手写类型 | ✅ |
| 运行期 `safeParse`(P2②) | ✅ | ✅ | ✅ | ⚠️ 啰嗦 |
| 反向产 JSON Schema 喂 CLI(P2③) | ✅ `zod-to-json-schema` | ⚠️ 生态弱 | ✅(本就是 JSON Schema) | ⚠️ |
| `discriminatedUnion`(evidence 三锚点 02 §3) | ✅ | ✅ | ⚠️ 手写 | ⚠️ |
| `superRefine` 跨字段(02 §5.2 C1–C8) | ✅ | ⚠️ | ❌ | ⚠️ |
| 生态/02 已按它写 | ✅ 02 全文基于 zod | 🟡 | 🟡 | 🟡 |
| 裁决 | **选**:唯一同时满足三职 + 02 契约已逐行基于它 | 三职但产 JSON Schema 生态不成熟 | 缺编译期类型推导,违 P2① | 人体工学差 |

**结论**:`zod@3.23+`(锁 3.x,见 §6 关于 zod 4 的风险说明)+ `zod-to-json-schema`。02 §6.2 的 `buildAgentOutputJsonSchema()` 用 `$refStrategy:'none'` 摊平,产 draft-07,喂 codex(文件)/claude(内联或流)。

### 4.2 zod 3 vs zod 4 的版本纪律(对抗性提醒)

zod 4 已发布且 API 有破坏性变更,`zod-to-json-schema` 对 zod 4 的适配仍在演进。02 全文(`discriminatedUnion`/`superRefine`/`.default()` 语义)是按 **zod 3** 写的。本项目**锁 zod 3.23.x**,不追 zod 4,直到:(a) `zod-to-json-schema` 或 zod4 内置的 JSON Schema 导出对 `$refStrategy:'none'` 摊平 + discriminatedUnion 行为验稳;(b) 02 契约的 V1–V20 测试矩阵在 zod4 下全绿。升级是 M2+ 的独立任务,带回归测试,不顺手做。

---

## 5. WebSocket:ws 8 + 日志:pino 9(带 redact)

### 5.1 WS 候选对比

| 维度 | **ws 8 (选)** | socket.io | 原生 Node `WebSocket`(server) |
|---|---|---|---|
| 显式 bind 127.0.0.1(安全 08/R8) | ✅ `host:'127.0.0.1'` | ⚠️ 默认更开放 | ❌ Node 只内置 client,无 server |
| 握手期校验 `Origin`(R8 跨源劫持) | ✅ `verifyClient`/`handleUpgrade` 拿 req 头 | ⚠️ 抽象层挡住底层 req | — |
| 一次性 token / 权限分级(R8) | ✅ 自己控握手,易插鉴权 | ⚠️ 需绕其鉴权层 | — |
| 协议简单(本地单机无需降级/重连魔法) | ✅ 裸 WS 够用 | ❌ 自带 polling 降级/房间,过重 | — |
| 裁决 | **选**:能拿到原始 upgrade req 做 Origin+token 校验,正中 R8 | 抽象层挡住底层、附带不需要的降级 | 无 server 端 |

**结论**:`ws@8`。server 端 `new WebSocketServer({ host:'127.0.0.1', port, verifyClient })`,握手中间件校验 `Origin` 白名单 + 一次性 token + 观战/控制权限分级(安全 08 / WS 协议 11 拥有规则,本文件只锁库)。客户端(面板/自测)用 Node 22/浏览器内置 `WebSocket`,不引客户端库。

### 5.2 日志候选对比

| 维度 | **pino 9 (选)** | winston | 原生 console |
|---|---|---|---|
| 结构化 JSON + 低开销 | ✅ | ⚠️ 较重 | ❌ |
| `redact` 路径(凭证脱敏 P3/R8) | ✅ 内置 `redact:{paths,censor}` | ⚠️ 需自写 format | ❌ |
| 子 logger 带 `runId/round/agent/role/kind` | ✅ `logger.child()` | ✅ | ❌ |
| 开发期美化 | ✅ `pino-pretty`(仅 devDep) | ✅ | — |
| 裁决 | **选**:redact 内置 + child binding + 低开销 | 配置重(总体已弃) | 无结构化/无 redact |

**结论**:`pino@9` + `pino-pretty`(仅开发期 devDep,生产输出裸 JSON)。

### 5.3 pino redact 的关键短板与对策(R8 命门,必须写清)

红队 R8 / 安全 08 §3 指出:**pino 的 `redact` 是按对象属性路径脱敏,覆盖不到 execa 的 `spawnargs` 数组,也覆盖不到 CLI stderr 里明文打出的 `Authorization: Bearer`**。故日志脱敏不能只靠 pino redact 一层:

| 泄漏面 | pino redact 能否覆盖 | 对策(本文件锁定,规则归安全 08) |
|---|---|---|
| 结构化对象里 `*.apiKey`/`config.providers.*.key` | ✅ `redact.paths` | pino redact 配路径 |
| execa `error.spawnargs` 数组(含 `-c ...=sk-`) | ❌ 数组成员非固定路径 | **入口拦截**:key 永不进 argv(R8/安全 08);+ 序列化 spawnargs 前过 `redactArgv()` 正则 |
| codex/claude stderr 明文吐 `Bearer xxx` | ❌ pino 看不到 raw stderr | **raw log 落盘前过 `redactText()`**(`sk-`/base64/`Bearer` 正则),再交 pino |
| 密钥跨流式帧分片(RS-M1) | ❌ 单帧正则不匹配半截 `sk-ant-` | **过滤前先按"逻辑单元"缓冲**:stderr 按整行(`\n` 切)缓冲后再 `redactText`,WS/diff_chunk 帧按 `Message` 对象(而非裸 delta)redact;规则与缓冲边界归安全 08 / WS 11 |
| WS 广播 / worktree 拷贝 | ❌ | 同一 `redactText()` 出口,广播前/拷贝前过滤(安全 08) |

```ts
// pino 配置骨架(@sylux/core/src/logger.ts;redact 路径清单与安全 08 / 工程规范 13 §共用一份常量)
const logger = pino({
  level: process.env.SYLUX_LOG_LEVEL ?? 'info',
  redact: {
    // 与 13 §(redact 强制)逐项对齐;清单单一权威由安全 08 持有,core 引用常量
    paths: ['*.apiKey', '*.key', '*.token', '*.authToken',
            'config.providers.*.key', 'config.providers.*.apiKey',
            'req.headers.authorization', 'headers.authorization', 'spawnargs', 'argv'],
    censor: '[REDACTED]',
  },
  // serializers:对 err.spawnargs / raw stderr 文本再过一道正则脱敏(redactText/redactArgv);
  // 流式来源(stderr/WS)在喂 serializer 前已按行/对象缓冲(§5.3 RS-M1 行),避免半截密钥漏过
});
```

> **结论**:pino 选定,但脱敏是**纵深四道**(入口不让 key 进 argv → 流式来源按行/对象缓冲 → raw 文本正则 `redactText` → pino 路径 redact),不是单靠 pino。日志库选型到此为止,正则规则、缓冲边界与白名单归安全文档 08。

---

## 6. 前端与其余工具链(对比从简,锁定为主)

### 6.1 前端:Vite 6 + React 18 + zustand + diff2html

| 维度 | 选择 | 理由 / 对比 |
|---|---|---|
| 构建 | **Vite 6** | 快、HMR、TS 开箱;对比 Next(SSR 对本地观战面板是负担)、CRA(已弃维护) |
| 框架 | **React 18 + TS** | 状态密集观战 UI;引擎经 WS/REST 解耦,框架可换 |
| 状态 | **zustand** | 轻量;对比 Redux(样板多)、jotai(原子模型对"一棵黑板树"无收益) |
| diff 渲染 | **diff2html** | 渲染中枢产的 unified diff;二进制/超阈值 diff 降级纯文本(02 `FilePatch.isBinary` + 面板 10);备选 `react-diff-viewer-continued`,二选一由面板 10 定 |
| WS 客户端 | 浏览器内置 `WebSocket` | 不引客户端库 |

> 面板的 diff **正文由中枢从 worktree `git diff` 生成**(02 §4),前端只渲染,不自行算 diff,故 diff 库只需"渲染 unified diff 字符串"能力,不需要 diff 算法库。

### 6.2 CLI 入口 / ID / 时间

| 维度 | 选择 | 理由 / 对比 |
|---|---|---|
| CLI 框架 | **commander** | `sylux run --playbook ...` 入口;轻量,对比 yargs(重)、oclif(插件体系过重) |
| ID | **nanoid** | `Message.id`/`runId`(02 §5.1);URL 安全、短、快;对比 uuid(更长) |
| 时间 | 原生 `Date.now()` + `node:perf_hooks` | `Message.ts`(中枢盖章,02 §5);**不引** moment/dayjs |

### 6.3 测试 / 构建 / 开发期

| 维度 | 选择 | 理由 / 对比 |
|---|---|---|
| 测试 | **vitest** | 前后端统一、ESM/TS 原生;对比 jest(ESM 配置重)、node:test(断言/mock 生态弱) |
| 子进程 mock | vitest `vi.mock('execa')` + `fixtures/` 录制 JSONL | 三法见总体 §12.2;FakeAdapter 首选 |
| 库构建 | **tsup** | 打 `@sylux/{shared,core,...}` 为 ESM + d.ts;esbuild 底层快 |
| 类型检查 | **`tsc -b`**(project references) | 增量;与 tsup(不做类型检查)分工 |
| 前端构建 | **Vite** | §6.1 |
| 开发期 | **tsx watch** | 零配置 ESM 跑 server;对比 ts-node(ESM 摩擦) |
| 编排(可选) | turbo(M2+) | 初版用 `pnpm -r`,M2 再上(总体 O1) |

---

## 7. 版本锁定与镜像安装(P4 落地)

### 7.1 锁定版本表(运行时依赖)

> 原则:**精确锁定**(lockfile + `package.json` 用精确版或窄 caret),不追大版本。下表为**建议锁定基线**,实装时以 npmmirror 当时可得的最新 patch 为准并写入 `pnpm-lock.yaml`。zod 锁 3.x(§4.2)。

| 包 | 锁定版本(基线) | 所在包 | 备注 |
|---|---|---|---|
| `typescript` | `~5.7.2` | 根 devDep | 编译 |
| `zod` | `~3.23.8` | shared/providers/agents | **锁 3.x,不上 4**(§4.2) |
| `zod-to-json-schema` | `~3.23.x` | shared | 与 zod3 配套 |
| `execa` | `~9.5.x` | agents | §3 姿势钉死 |
| `ws` | `~8.18.x` | server | + `@types/ws` devDep |
| `pino` | `~9.5.x` | core/server | |
| `pino-pretty` | `~13.x` | 根 devDep | **仅开发期** |
| `nanoid` | `~5.0.x` | core | ESM-only,正合本项目 |
| `commander` | `~12.x` | server | |
| `react` / `react-dom` | `~18.3.x` | web | |
| `zustand` | `~5.0.x` | web | |
| `diff2html` | `~3.4.x` | web | 或 `react-diff-viewer-continued` |
| `vite` | `~6.x` | web devDep | + `@vitejs/plugin-react` |
| `vitest` | `~2.x` | 根 devDep | + `@vitest/coverage-v8` |
| `tsup` | `~8.x` | 根 devDep | |
| `tsx` | `~4.x` | 根 devDep | |
| `eslint` + `typescript-eslint` | `~9.x` / `~8.x` | 根 devDep | flat config |
| `prettier` | `~3.x` | 根 devDep | |

> 【待实测】上表 patch 号是基线建议,非本机已验;M0/M1 实装时以 npmmirror 实际可得版本写死 lockfile。大版本(zod3、react18、vite6、execa9、ws8、pino9)是经过选型论证的硬锁,patch 可随 lockfile 浮动。

### 7.2 镜像与 `.npmrc`(本机官方源超慢,记忆已证)

本机直连官方 registry 极慢(记忆:`npm i -g @openai/codex` 14 分钟未完,残二进制损坏)。**所有安装走 npmmirror**:

```ini
# .npmrc(仓库根,入库)
registry=https://registry.npmmirror.com
# pnpm 严格性
auto-install-peers=true
strict-peer-dependencies=false
# 原生二进制/平台包镜像(esbuild 等从这里取,避免官方源超时)
node-linker=isolated
```

安装命令:

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install                      # 读 .npmrc 自动走 npmmirror,生成 pnpm-lock.yaml
# 单独补包亦走镜像(.npmrc 已全局生效,无需每次 --registry)
pnpm --filter @sylux/agents add execa
```

> 与记忆 [[npm-mirror]] 一致:本机任何安装默认走 `https://registry.npmmirror.com`,尤其含原生二进制的包(esbuild/Vite/codex)。`pnpm-lock.yaml` **入库**,保证可复现与离线重装。

### 7.3 供应链安全(呼应安全 08 / R8 末段)

| 关注点 | 措施 |
|---|---|
| 锁版本防投毒 | 精确锁定 + `pnpm-lock.yaml` 入库;CI `pnpm install --frozen-lockfile` |
| typosquatting | 新增依赖人工核对包名(`@openai/codex` 等官方包尤其);可疑名上报 |
| 装包脚本 | 评估 `enable-pre-post-scripts`;对含 postinstall 的包审视 |
| 审计 | M2 引 `pnpm audit`(经镜像)进 CI;高危阻断 |
| 凭证不入依赖层 | provider key 走 env/auth.json,绝不写进 `package.json`/`.npmrc`(R8/安全 08) |

---

## 8. lint / format / git 工具(展开总体 §11.5)

| 工具 | 选择 | 关键配置 |
|---|---|---|
| lint | ESLint flat(`eslint.config.js`)+ `typescript-eslint` recommended-type-checked | 强制规则:`no-floating-promises`、`no-console`(web 调试除外)、`consistent-type-imports`(配 `verbatimModuleSyntax`)、`import/no-cycle`(焊死依赖图 §2.3) |
| format | Prettier | `semi:true / singleQuote:true / trailingComma:all / printWidth:100 / endOfLine:lf` |
| 关格式冲突 | `eslint-config-prettier` | 关掉 ESLint 的格式类规则,交给 Prettier |
| git hooks(M2+) | husky + lint-staged + commitlint | pre-commit(lint-staged + secret-scan)、commit-msg(Conventional Commits)、pre-push(`tsc -b`) |
| 换行 | `.gitattributes: * text=auto eol=lf` | **Windows 必备**:防 CRLF 污染 `contentHash`(02 §9.1 归一化虽兜底,但源码统一 LF 更稳) |

> secret-scan(pre-commit + CI):拦 `sk-`/base64/`Bearer` 模式与 `.env`,呼应 R8/安全 08。`.gitignore` 含 `node_modules/ dist/ *.tsbuildinfo .env .env.* coverage/ logs/ .turbo/` + agent 运行时 worktree 临时目录 + 临时 codex config 路径(总体 §11.5)。

---

## 9. 对抗性自检(交付前红队这一关)

唱反调的针对本选型逐条质疑,正面回应如下:

| # | 质疑 | 回应 |
|---|---|---|
| A1 | "execa 在事实 A 下既然这么多坑,为何不直接用原生 `child_process` 省掉一层?" | 风险点是"碰 PATH shim",不是 execa。用绝对路径根除后,execa 的 stdin/timeout/树 kill/流式/spawnargs 暴露是真金白银的收益,原生要重造且更易错。§3.2 已钉死唯一调用姿势。**但** §3.5 (a) 留了"execa 不达标即退原生"的回退闸,不是无条件信 execa。 |
| A2 | "zod 都出 4 了还锁 3,是不是技术债?" | 02 全契约 + V1–V20 测试基于 zod3;`zod-to-json-schema` 对 zod4 的摊平行为未验稳(§4.2)。盲升会让"一份三职"的 JSON Schema 产物漂移,代价是 CLI 输出对齐崩。锁 3 是有意识的稳态选择,升级列 M2 独立带测任务。 |
| A3 | "pino redact 覆盖不到 spawnargs/stderr,那 pino 选型岂不是没解决脱敏?" | pino 从不被指望单独解决脱敏(§5.3 已明说)。脱敏是纵深四道,pino 只占"结构化路径 redact"一道;入口不让 key 进 argv(R8)+ 流式来源按行/对象缓冲(RS-M1)+ raw 文本正则是另三道。选 pino 是因为它在这四道里的那道做得最好且开销低。 |
| A4 | "claude 端没有独立 exe,你的'绝对路径'纪律对它是不是落空?" | §3.4 已分两策:首选解析 node + 入口 js(`process.execPath` 是绝对路径,等价绕开 shim);备选 `.cmd` 但带空格内容一律走 stdin/临时文件。纪律不落空,只是 claude 端形态不同(事实 G:两端高度不对称)。 |
| A5 | "Vite/esbuild/原生二进制经第三方镜像,会不会被投毒?" | §7.3:lockfile 入库 + `--frozen-lockfile` + 包名核对 + M2 `pnpm audit`。镜像只换 registry 源,完整性靠 lockfile 的 integrity hash 校验(pnpm 默认校验),被替换会 hash 失配报错。 |
| A6 | "Node 22 内置 WebSocket 是 client,server 还得 ws;那为何不干脆全用 ws?" | server 端用 ws 8(§5.1);client(面板浏览器 + 自测)用内置 `WebSocket` 省一个依赖。两者不冲突,各取所长。 |
| A7 | "安全工具不单独切个 `@sylux/security` 包,全塞 `@sylux/shared`,是不是把底层包搞臃肿?" | §2.4 已裁决:这些工具零运行时依赖、要被 05/06/08/11/server 多处共用,落 shared 不引环、不制造空壳包,且与 02 同包天然单一权威。新增 security 包只装几个纯函数是过度切分;13 包清单本就无 security 包。规则本体仍归 08 权威,shared 只是物理宿主。 |
| A8 | "Q3 schema 探针要 `@sylux/shared/dist`,可 M0 又禁建包——闸门依赖自己产物不是死锁?" | 已吃掉(FEAS-7,§3.5 注 + Q3):M0 全程零 `pnpm build`,schema 体积用一次性 `probe-schema-size.mjs` 内联直接量,execa 冒烟用 `fixtures/fake-codex.mjs`,均不 `require` dist。对齐 24 §158。 |

---

## 10. 边界、失败路径与开放问题

### 10.1 失败路径(选型相关)

| 场景 | 表现 | 处置 |
|---|---|---|
| codex 平台 exe 路径解析失败 | `resolveCodexExe` 找不到 vendor bin | 抛 `SUBPROCESS_SPAWN_FAILED`(02 §12),中枢拒启该 agent |
| execa `shell:false` + 绝对路径仍失败(M0 (a) 不过) | spawn code≠0 / 非 Win32 错误 | 退回原生 `child_process.spawn`(§3.5 回退) |
| npmmirror 临时不可达 | `pnpm install` 超时 | lockfile + 本地 store 离线重装;或临时切官方源(慢但可) |
| claude `--json-schema` 内联超 32KB | CreateProcess 命令行超限/转义错 | 退 `--input-format stream-json` 传 schema(§3.4,适配 06) |
| zod 误升 4 导致 JSON Schema 漂移 | CLI 输出 safeParse 失败率升 | lockfile 锁 3.x;CI 跑 02 V1–V20 拦截 |

> **错误码权威(吃掉 COV-1 跨引用)**:本文件引用的 `SUBPROCESS_SPAWN_FAILED`、`PROVIDER_CONFIG_INVALID` 等码,**唯一权威定义在 02 §12 `SyluxErrorCode` union**。x-coverage COV-1 / x-consistency A1 指出 02 §12 union 当前缺 `SUBPROCESS_SPAWN_FAILED` 等 17+ 个下游已用码,union 补全是 **02 的回填项**(本文件不另定义、不内联任何错误码字面量)。在 02 补全前,本文件引用这些码视为"约定将存在",不阻塞本文件定稿;但 02 不补全则 `SyluxError` 与 15 的 `Record` 穷举会编译红——已在此显式登记,催 02。

### 10.2 开放问题(交 GPT 审阅 / M0 实测确认)

- Q1【M0】execa@9 在事实 A 姿势((a)(b)(c) §3.5)下三项是否全过;不过则退原生 spawn。
- Q2【M0】claude 入口 `cli.js` 能否稳定解析(`process.execPath + cliJs`);不能则走 `.cmd` 备选。
- Q3【M0】`buildAgentOutputJsonSchema()` 摊平后体积是否逼近 claude 32KB 内联上限(02 §6.2 待实测项),决定内联 vs stream-json。**探针不依赖建包**:用一次性 `probe-schema-size.mjs` 内联 `agentMessagePayloadSchema` + `zodToJsonSchema(..,{$refStrategy:'none'})` 直接量(FEAS-7 / 24 §158),不 `require` `@sylux/shared/dist`。
- Q4 子进程树 kill 是否需引 `tree-kill`/`taskkill /T /F`,还是 execa `forceKillAfterDelay` 已够(§3.5 (c))。
- Q5 zod4 + 其 JSON Schema 导出何时验稳到可升(§4.2),升级排期。
- Q6 diff 渲染最终选 `diff2html` 还是 `react-diff-viewer-continued`(面板 10 定)。

### 10.3 需回填总体规划的差异

| 处 | 本文件相对总体 §10/§11 的修订 | 性质 |
|---|---|---|
| §3 | 总体 §10 把 execa Windows 行为标【待实测】(§4.5/Q1);本文件依**事实地基 A** 改为"事实裁决 + 唯一调用姿势钉死 + 退原生回退闸",不再标待实测 | 事实落地,非破坏 |
| §3.4 | claude 端解析策略明确为"首选 node+入口 js,备选 .cmd",总体仅笼统提 shim | 细化 |
| §5.3 | 明确 pino redact 覆盖不到 spawnargs/stderr/跨帧分片,脱敏改"纵深四道"表述 | 细化(呼应安全 08) |
| §7.1 | 给出精确锁定版本基线表 + zod 锁 3.x 纪律,总体仅给"3.23+" | 增强 |
| §2.1 | pnpm 经 corepack `prepare @9.15.0` 锁定,总体仅"corepack 启用" | 细化 |
| §2.4 | **新增**安全工具落点裁决(D15):全落 `@sylux/shared`,不新增 `@sylux/security` 包;05/06 回填 import 路径 | 裁决(转交 13 回填目录树) |
| §0.0 | 全文锚定磁盘文件名编号(C-NUM),删 v1"安全 09"误标 | 一致性修复 |

> 以上均为细化/事实落地,非破坏性;建议回填总体 §10/§11 保持一致。类型契约一律仍以 02 为唯一权威,本文件未触碰任何 `Message`/`Evidence` 定义。







