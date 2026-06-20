# sylux 环境实测事实(PROBED FACTS)

> 本文件是 sylux 规划的事实地基。以下全部为 2026-06-20 在本机(Win11 China, Node v22.13.0)对 codex-cli 0.141.0 与 Claude Code 实测得出,非假设。设计与实现必须以此为准,凡与早期【待实测】假设冲突的,以本文件为准。

## A. 进程启动(Windows spawn,核心约束)

实测三连(失败→失败→成功)得出的硬约束:

1. 不能裸 spawn `"codex"`:PATH 里的 `codex`(无扩展名)是 bash shim,`Start-Process "codex"` 报 `%1 is not a valid Win32 application`。
2. 不能经 `.cmd` 传带空格的 prompt:`codex.cmd exec "Reply with ..."` 会被 `.cmd` 的 `%*` 展开打散成多参数,报 `unexpected argument 'with'`。
3. 唯一干净路径:直接 spawn 真实 exe + prompt 走 stdin(参数里用 `-` 占位)。
   - 真实 exe 路径:`G:\npm-global\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`
   - Node `child_process.spawn(EXE, args, {windowsHide:true})` + `child.stdin.write(prompt); child.stdin.end()` 实测 code=0,stdout 为干净 UTF-8。
   - 注意:PowerShell 的 `>` 重定向会把 codex 的 UTF-8 输出转成 UTF-16 LE(乱码),Node 直接捕获 stdout 无此问题。中枢用 Node 捕获,不要用 shell 重定向。
   - 【M0 任务】中枢应实现 exe 路径解析(定位平台包 vendor bin),不要依赖 PATH 上的 shim。

## B. codex exec 事件流(--json)

实测 4 类事件,顺序固定:
```
{"type":"thread.started","thread_id":"019ee3..."}   // 首行,thread_id 在此(不是旧版的 session_meta.payload.id)
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":..,"cached_input_tokens":..,"output_tokens":..,"reasoning_output_tokens":..}}
```
- 【修正红队 R3】session/thread id 来源是 `thread.started.thread_id`,首行即出。Adapter 解析首行即可拿到,不必等整轮结束。
- 最终消息文本在 `item.completed.item.text`;若用 `-o <FILE>` 则单独写一份纯最终消息。

## C. output-schema 经第三方中转(mouubox)强制成形 —— 可行

【证实红队 R4 的乐观面】`codex exec --output-schema <FILE>` 经 Sub2API/mouubox(wire_api=responses, gpt-5.5)实测:`-o` 文件输出为严格合 schema 的 `{"answer":"pong","n":7}`,无多余文本。
- codex 端 schema 是文件路径(`--output-schema schema.json`)。
- 【仍需兜底】单次实测通过不代表复杂嵌套 100% 稳。应用层必须保留 zod safeParse 失败→带错误重发≤N→抛 OUTPUT_SCHEMA_VIOLATION 的兜底(红队 R4 防御面保留)。

## D. resume 的 token 行为 —— 不省 token,累积上涨(决定性)

【证实红队 R2】同一 thread 连续两轮实测:
| 轮次 | input_tokens | cached_input_tokens | 说明 |
|---|---|---|---|
| round1 | 18755 | 1920 | 首轮,含全部系统上下文 |
| round2(resume) | 37645 | 3840 | ≈翻倍 |

结论:
- resume 解决"本地失忆"(进程退出后能接着聊),但走中转每轮按全量历史重新计费,input_tokens 随轮数累积上涨。
- token 成本对轮数是累积/超线性的:N 轮辩论总成本 ≈ base×(1+2+…+N)。8 轮 ≈ 36×base,不是 8×base。
- 【刹车设计硬约束】max_rounds 预算必须按"累积上下文"估算,绝不能按"每轮增量"估。应用层 token 控制(历史裁剪/旧轮压结论/只喂 delta)是省钱的唯一手段,别指望 resume/中转服务端会话态。
- 基线底价:一个最简回合固定吃 ≈18.7k input tokens(codex 系统上下文开销)。

## E. codex exec resume 的参数集(与 exec 不同!)

实测 `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`:
- 接受:`-c key=value`、`-m`、`--json`、`--skip-git-repo-check`、`--last`、`--all`、`--image`、`--enable/--disable`。
- 拒绝:`-s`(sandbox)、`-C`(cd)。报 `unexpected argument '-s'`。
- 非信任目录下 resume 必须带 `--skip-git-repo-check`,否则报 `Not inside a trusted directory`。
- SESSION_ID 与 PROMPT 是位置参数;PROMPT 用 `-` 走 stdin。
- 【适配器约束】resume 的命令行参数必须单独拼装,不能照抄 `codex exec` 的 flag 集。沙箱/工作目录在首轮 exec 时定好,resume 继承。

## F. claude headless flag(实测 --help 存在)

- `-p/--print`:headless。
- `--output-format text|json|stream-json`;`--input-format text|stream-json`(双向流式)。
- `--json-schema <schema>`:结构化输出,收【内联 schema 串】(对比 codex 收文件路径 —— 证实红队 R4 的两端不对称)。
- `--append-system-prompt <prompt>` / `--append-system-prompt-file`:注入角色/协议(codex 无直接等价,靠 prompt 或 AGENTS.md)。
- `--resume` / `--continue` / `--fork-session`:会话续接;`--no-session-persistence`(对应 codex `--ephemeral`)。
- `--model` / `--fallback-model` / `--effort` / `--add-dir` / `--permission-mode` / `--mcp-config` / `--agents <json>`。
- 【M0 任务】claude 端是 `.ps1/.cmd` shim,同样有 Windows spawn 坑;`--json-schema` 内联串在 Windows 命令行有长度上限(约 32KB)与转义风险,复杂 schema 需评估走文件或 stream-json 输入。`--session-id` 预设能力需 M0 实测确认(help 过滤未显式见到,但 --resume 存在)。

## G. 对设计的直接影响(摘要)

- 适配器两端高度不对称:启动方式、schema 传递(文件 vs 内联)、resume 参数集、系统提示注入方式都不同。AgentAdapter 抽象必须容纳这些差异,send() 返回值必带回 thread/session id。
- 刹车与成本模型按"累积 token"建模(D 节),这是真金白银的约束。
- token 计量直接用 `turn.completed.usage`(中转回吐,可靠),不用本地估算器。
- 输出对齐(output-schema/json-schema)两端都可用,但都要应用层 safeParse 兜底。

---

## H. M0 探针真跑结论(2026-06-20)

7 过 / 2 待定(T0.2b 依赖 M1 产物;T0.1 见下)。逐条:
- T0.3 ✅ claude `-p --output-format stream-json` 出 system/assistant/result 事件。
- T0.4 ✅ claude `--session-id <uuid>` 预设被接受(与 codex"id 由它给"不对称,claude 可预设)。
- T0.5 ✅ 直调真 exe 时 SIGKILL 2.5s 内杀穿,无需 taskkill /T。
- T0.6 ✅ claude usage 字段:input_tokens / cache_creation_input_tokens / cache_read_input_tokens / output_tokens / cache_creation / iterations / speed 等(顶层 result.usage)。
- **T0.5b ✅(唯一硬阻断,过)**:codex `-s read-only` 与 `-s workspace-write` 两模式下子进程 curl 外网均未出网(reached=false)。§7.3 L4 断网兜底成立,出网命门没塌,可进 M1。
- T0.1 ⚠️ 两端复杂 schema:codex 端本轮遇 mouubox **502 Bad Gateway(transient 中转故障)**零输出——非 schema 问题(p1 已实测 codex `--output-schema` 干净成形);claude 端无视 `--json-schema`,回大白话且**满嘴全局人格**。

### H.1 关键产品级发现:worker 必须"干净房间"运行(clean-room)
claude 继承全局 CLAUDE.md(苏思澜人格)、codex 继承 config.toml(avatar=custom:sylanne)+ AGENTS.md。后果:① 无视结构化 schema 指令、回人格白话;② 一次 claude 调用 $0.70、cache_creation 74862 token(人格+记忆+联网工具全加载)。
**对策(M1 适配器硬要求):**
- codex 适配器 clean-room **正解**:`--ignore-user-config`(甩掉 skills/AGENTS.md/人格包袱)**+ `-c` 显式逐项注入 provider**(model_provider=custom / model=gpt-5.5 / model_reasoning_effort=medium / model_providers.custom.{name,base_url=https://api.mouubox.com,wire_api=responses,requires_openai_auth=true})+ `-c mcp_servers={}` `-c notify=[]`。auth.json 在 --ignore-user-config 下仍走 CODEX_HOME,key 不丢。实测 input 39761→15842、skills 仪式 0 次、critic 带真证据无泄漏。
  - 反面教训:只去掉 --ignore-user-config 会让 superpowers skills 全回来(每次 exec 先 powershell 读 SKILL.md),调用 75s+ 超时误判"卡住";只加 --ignore-user-config 不注入 provider 又拨默认端点超时。两个 flag 必须配套。
  - codex relay 调用本身快(中转账单实测 /responses 13-27s、首 token 1-2s)。早先"墙钟 129-143s"是测量假象:spawnCapture 傻等进程 close,而 codex.exe 出完 turn.completed 后还赖 ~40s 做退出清理;再叠 transient 重试翻倍 + xhigh。**修法:spawnCapture 收到 `"type":"turn.completed"` 即结算 + taskkill /T 杀逗留进程,codex 墙钟 63s→19s**(接近 claude 7s)。codex 超时 120s 足够(非 240s)。reasoning_effort=medium。
- claude 适配器用 `--append-system-prompt` 强制 worker 角色 + 结构化输出纪律压制人格;评估是否有"不加载用户 memory"的等价手段。
- 两端一律 **safeParse 兜底**:schema 不成形→带错重发≤N→OUTPUT_SCHEMA_VIOLATION(claude 端 `--json-schema` 不强制已坐实,兜底从"保险"升为"主路径")。

### H.2 中转稳定性
mouubox 出现 502 Bad Gateway(codex 侧)。适配器/刹车需把 5xx 当 transient 重试(指数退避),与 OUTPUT_SCHEMA_VIOLATION 区分。

### H.3 闸门裁决
T0.5b(唯一硬阻断)过;T0.1 为 major,codex 端 502 是 transient(可重试)、claude 端走 safeParse+clean-room 退化路径已备 → 判 **有条件通过**,可进 M1(在 M1 适配器落地 clean-room + safeParse)。
