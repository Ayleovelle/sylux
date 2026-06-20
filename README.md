# sylux

本地多智能体调度中枢。让 **Claude Code** 与 **Codex** 两个 CLI 工具在隔离环境里协同干活——中枢不干活,只调度与裁判;两个 CLI 各自执行,中枢当传话筒 + 裁判。

当前进度:**完全体已跑通** —— 四范式剧本 + 配置层 + 收敛检测 + Web 实时观战面板,全部双端实测。

## 快速开始

```bash
# 红蓝对抗:author 出方案,critic 带证据砸,轮流到收敛/封顶
node src/run.mjs "用 TypeScript 写一个 debounce 函数" --playbook red-blue --a codex --b claude --max 6

# 换范式:主从(lead 拆解+验收 / worker 执行)、对等(navigator/driver)、分工并行(切两块各做再合)
node src/run.mjs "设计 LRU 缓存" --playbook lead-worker --a claude --b codex
node src/run.mjs "实现 throttle" --playbook pair --a claude --b codex
node src/run.mjs "设计限流器" --playbook divide-parallel --a claude --b codex

# 用配置文件(provider/model/超时/停止条件全可配),命令行 flag 可覆盖
node src/run.mjs "任务" --config configs/leadworker-claude-lead.json

# 开 Web 实时观战面板(只绑 127.0.0.1,token 一次性)
node src/run.mjs "任务" --playbook red-blue --panel 7878
# 浏览器开终端打印的带 token URL 即可边跑边看
```

参数:
- 位置参数 = 任务描述
- `--playbook` = 范式 `red-blue` | `lead-worker` | `pair` | `divide-parallel`(默认 red-blue)
- `--a` / `--b` = 两个 agent 指派(`codex` | `claude`,角色与模型解耦,可任意组合)
- `--max` = 最大轮数;`--config <文件>` = 配置基线;`--panel [端口]` = 开观战面板

产物:`runs/<范式>-<时间戳>.jsonl`(每条消息一行,可回放)+ `runs/fixtures-*`(原始 stdout/stderr 存档)。

## 四范式

| 范式 | 编排 | 收敛信号 |
|---|---|---|
| **red-blue** 红蓝对抗 | author 出/改方案,critic 带证据砸,轮流 | critic `STATUS:done` 或证据指纹原地打转 |
| **lead-worker** 主从 | lead 拆任务/验收,worker 执行/返工 | lead 验收 `STATUS:done` |
| **pair** 对等结对 | navigator 指下一步,driver 写实现,轮流 | navigator `STATUS:done` |
| **divide-parallel** 分工 | lead 切两块 → 两 agent 各做 → lead 合并 | 固定 4 轮,lead 合并 `STATUS:done` |

## 配置

JSON 配置(零依赖)。`agents` 注册表给每个 agent 配 `kind`/`provider`(model/base_url/wire_api/reasoning_effort)/`timeoutMs`;再配 `playbook`/`roles`/`stop`(maxRounds/convergence)。示例见 `configs/`。

> **安全红线**:配置文件里**绝不允许出现 key/token/secret**。凭证只走 `CODEX_HOME/auth.json` 与环境变量;config 解析时会主动扫描并拒绝凭证类字段与 `sk-` 形态值。

## 设计要点(已实测固化)

- **clean-room(三层)**:worker 进程去全局人格污染。① codex `--ignore-user-config` 甩 skills/AGENTS.md,再用 `-c` 显式注入 provider(否则丢 base_url 拨默认端点超时);claude `--append-system-prompt` 压人格。② worker 工作目录指向仓库外空 scratch 目录,杜绝 codex 扫仓库导致 input token 爆炸。③ 引擎无状态:每轮起新 session,历史只靠 contextFor 带(避免 thread resume 服务端重放无界增长)。详见 `docs/PROBED-FACTS.md` H.1。
- **spawn**:直调真实 exe + prompt 走 stdin(裸命令名是 shim、`.cmd` 会打散带空格 prompt)。codex 出现 `turn.completed` 即提前结算 + `taskkill /T` 杀进程树(省 ~40s 退出尾巴)。
- **收敛检测**:evidence 指纹差集,连续 N 轮无新强指纹即 `CONVERGENCE_STALL`(与 agent 主动 `done` 的 `CONVERGED` 解耦)。按范式分化:辩论型(red-blue/pair)用指纹 stall,状态机型(lead-worker/divide-parallel)以 done 为主、派活/执行轮冻结计数,不误杀合法空证据轮。
- **状态码**:14 个明确码 + transient 分类,失败不糊成"运行失败"。
- **面板安全**:WS server 只绑 127.0.0.1、token 一次性、校验 Origin、只广播消息白名单字段(绝不外泄 provider/key)、所有 agent 内容前端转义入 DOM。

## 测试与验收

```bash
node src/accept.mjs          # 完全体确定性验收闸(50 测试,零 token 花费)
node src/converge-test.mjs   # 收敛检测 20 测试
node src/server-test.mjs     # 面板协议 12 测试
node src/fault-test.mjs      # 状态码故障注入 18 测试
node src/matrix.mjs --allow-network   # 真 CLI 双端合跑矩阵(花 token)
node src/health.mjs                   # 双端健康探针
```

## 目录

- `src/` — 运行时:`blackboard`/`adapters`/`engine`/`playbooks`/`converge`/`config`/`status`/`run`/`server`(+ `panel.html`/`panel.js`)
- `configs/` — 示例配置
- `m0/` — M0 可行性闸探针(`node m0/run.mjs all --allow-network`)
- `docs/sylux-master-plan.md` — 总体规划(29 章,M0–M5 路线图 + 明细任务)
- `docs/PROBED-FACTS.md` — 本机实测事实地基
- `docs/skeleton/` — 规格级 TypeScript 骨架(可编译,产品化对齐用)

## 已知限制

- pair/divide-parallel 当前无结构化 evidence 模型,收敛纯靠 `done` + 封顶(指纹 stall 仅 red-blue/lead-worker 生效)。
- worktree 物理文件隔离 + 真 unified diff 面板留后续(当前 worker 一律 read-only,纯决策不写文件)。
- 面板为只读观战;暂停/介入控制平面(inject/pause)按规划 §9 留后续。

路线图见 `docs/sylux-master-plan.md` §23。

## 致谢

- [Claude Code](https://github.com/anthropics/claude-code) — Anthropic
- [Codex CLI](https://github.com/openai/codex) — OpenAI
- 仓库模板源自 [DBJD-CR/astrbot_plugin_helloworld](https://github.com/DBJD-CR/astrbot_plugin_helloworld)

## License

[MIT](LICENSE)
