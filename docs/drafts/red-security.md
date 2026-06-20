# 红队·安全 红队报告 (red-security) [run-tag:v3.1]

> 攻击面:密钥泄漏(日志/WS/worktree/argv -c)、提示注入 RCE、worktree 合并数据丢失、Web 攻击面、沙箱滥用、中转供应链与数据出境、刹车失效烧钱边角。
> 方法:逐条砸 01~25 草稿 + x-consistency/x-coverage + PROBED-FACTS。每条 finding 带具体 evidence/反例 + severity(blocker/major/minor)。
> 立场:对抗性。已写好的防御不复述,只挑能被绕过/漏掉/自相矛盾的点。
> 基准:08 安全权威、07 provider、09 worktree、11 WS、PROBED-FACTS。

severity 口径:
- blocker = 能导致密钥泄漏 / RCE / 数据丢失 / 烧钱失控的真实可达路径,或安全断言悬空到无法验收。
- major = 防御有实质缺口但被其他层兜底,或设计自相矛盾导致实现者大概率写错。
- minor = 收敛性/纵深加固/文档级安全隐患。

---

## 0. 总体判定(verdict)

见文末「§0 总体判定 — 回填」(findings 落定后写在报告末尾,避免前置占位与实际结论漂移)。一句话:架构无需推翻,但 blocker×2(沙箱出网未实测 / 面板 XSS 威胁面缺失)必须开工前解,major×7 开工前回填。

## 1. BLOCKER

### RS-B1 注入防御的 L4 垫底(沙箱出网)未实测,整条 exfil/RCE 防线悬空
- severity: blocker
- 证据:08 §6.2 自标【待实测 M0】「codex/claude `workspace-write` 是否仍允许子进程出网」;08 §4.9 T13 自认防火墙管不到「agent 用自己的网络工具直接 `curl` 外发(不经黑板)」,把这一面整个推给 §6 沙箱;08 §1.2 红队自检明写「真正的硬点是 S6 沙箱 + worktree 隔离让被注入内容降格为数据」。x-coverage COV-G4 也把它列 blocker。
- 攻击:被 prompt 注入的 agent 不需要把注入文本喂给对面(那条被 §4 防火墙拦)。它直接用自己的 `bash`/`curl`/`fetch` 工具读 `~/.codex/auth.json` 或 worktree 内 secret 并 POST 到 evil.com。这条通路**不经黑板**,§4 防火墙、§7 `guardEgress`、§3 redact 全部看不到。唯一能拦的是沙箱断网——而它是否真断网没人验过。
- 反例:08 §4.5 自己承认关键词扫描可被语义诱导绕过,§4.6 边界标记只是「让对面把内容当数据」。这两层全是"降低成功率",真正"即使中招也跑不掉"的论断 100% 押在沙箱断网上。若 `workspace-write` 允许出网(codex 沙箱默认策略未知),则:① 关键词没扫到 → claude 信了注入 → 直接 curl 外发 = 完整 exfil;② 整个 08 "把 RCE 降级为自己 worktree 里瞎改" 的结论失效。
- 要求:M0 必须实测两端沙箱在 `workspace-write`/`read-only` 下的实际出网行为(发真实 HTTP 看能否出去),并把结论写进事实地基。若允许出网,必须追加网络层封禁(OS 防火墙规则 / 子进程 env 清空代理 + 显式 deny,或换用真正断网的沙箱),否则整个安全设计的垫底不成立。这不是"已知残余风险"可以接受的级别——它是头号防线的地基。

### RS-B2 面板 XSS:agent 可控内容未经任何 HTML 消毒就渲染进 control 权限页面
- severity: blocker
- 证据:10 §9 diff 用 `diff2html`/`react-diff-viewer-continued` 渲染;10 全文 grep 无 `sanitize`/`CSP`/`escape`/`dangerouslySetInnerHTML` 任何命中;08 威胁模型 §1.1 只把浏览器当**发起方**威胁(CSWSH、越权控制帧),从未把浏览器当 server→client 内容的**受害者**;08 redact(§3.2)只替换 secret 特征,**不做** HTML 转义。11 §3.1 `message.body` / `sDeltaSchema.text` / `sToolCallSchema.argsDigest` / 09 §4.4 diff 正文全是 agent 原始输出,redact 后直送前端。
- 攻击:agent(被注入或自身产出)在 `body`/evidence `quote`/文件名/diff 里塞 `<img src=x onerror="fetch('/runs/X/ws-ticket',{method:'POST'}).then(...)">` 或 markdown `[x](javascript:...)`。若面板用 markdown 渲染或 diff 库未转义,脚本在面板源(127.0.0.1 同源)执行。面板持 `control` scope → 脚本可代发 `pause`/`abort`/`inject`,甚至调同源 RestApi 抢 control ticket。注入从"喂对面"换道成"喂观战人类的浏览器"——而浏览器是这套里唯一持控制权的实体。
- 反例:08 §4 内容防火墙明确只保护"喂对面 agent"通路(§4.9 T13 自认作用域只在黑板消息→对面 prompt)。**没有任何一层**负责"agent 内容 → 浏览器 DOM"的消毒。redact 把 `sk-` 抹了,但 `<script>` 原样放行。
- 要求:① 面板对所有 agent 来源文本(body/quote/argsDigest/文件路径/diff)默认按纯文本渲染或经 DOMPurify 白名单消毒,markdown 渲染必须禁 raw HTML + 禁 `javascript:`/`data:` 协议链接;② 注入 strict CSP(`script-src 'self'`,禁 inline,禁 eval);③ diff 库确认对 `+`/`-` 行内容做 HTML 转义(diff2html 默认转义,但 evidence quote / 文件名等旁路需各自验)。这条必须进 08 威胁模型(新增 T16:server→client 内容 XSS)与 10 安全章节,当前两份都缺。

## 2. MAJOR

### RS-M1 流式 redact 按帧无状态,密钥跨 delta/diff_chunk 分片即泄漏给观战者
- severity: major
- 证据:08 §3.2 `redact` 是对单个字符串跑无状态正则;11 §8.2 `WsHub.broadcast` 对**单帧** payload 过 `redactObject`;11 §3.1 `sDeltaSchema` 是逐 token 增量(`delta` 高频帧),11 §3.2 `sDiffChunkSchema` 是大 diff 分块。
- 攻击/反例:子进程把 `sk-ant-api03-XXXX` 流式吐成两个 delta 帧 `"...key is sk-ant-ap"` + `"i03-XXXX..."`。每帧单独过 redact 都不匹配 `\bsk-ant-[A-Za-z0-9_-]{16,}\b`(被帧边界截断),两帧都原样广播给所有 spectator → 前端按 `(from,round)` 拼接后明文密钥重现在气泡里。最终落地的 `message`(整条)会被 redact,但**实时 delta 流已经泄了**。diff_chunk 同理:secret 横跨两个 `seqInRef` 分块即漏。
- 要求:流式通路要么(a)对 delta/diff_chunk 做**跨帧滑动窗口**redact(保留上一帧尾部 N 字符与本帧拼接后再扫,扫过的安全前缀才发);要么(b)delta/tool_call 默认**不广播给 spectate**(10 §13 openQuestion 10 已在犹豫这点,这里给出安全侧硬结论:在流式 redact 落地前,原始流默认仅 control 可见且仍有残漏风险)。08 §3.3 "新增出境通路必接 redact" 在流式场景下"接了也漏",需显式补流式 redact 规则。

### RS-M2 WS 一次性 token 的签发端(REST /ws-ticket)鉴权未定义,Origin+token 对本机非浏览器进程形同虚设
- severity: major
- 证据:11 §5.2、10 §4.1 都是 `POST /runs/:id/ws-ticket` 经"同源 127 的 RestApi"签发 token;08 §5.5 的安全论证原文:「真正挡本机越权的是一次性 token…token 经同源 127 的 RestApi 签发,非浏览器拿不到合法 token」。但全仓**没有任何地方**定义这个 REST 端点本身的鉴权——它就挂在 127.0.0.1 上。
- 反例:08 §5.5 的论证是循环的。同机恶意脚本(`curl http://127.0.0.1:<port>/runs/<id>/ws-ticket -X POST`)**就是非浏览器**,它照样能打这个端点拿到 `control` token,然后伪造 `Origin` 连 WS(08 §5.5 自己承认非浏览器可任意伪造 Origin)。于是 Origin 防的是浏览器跨站、token 防的是重放,但**两者都挡不住"本机脚本先 POST 拿票再连"**。整套 WS 鉴权对本机非浏览器攻击者退化为"能不能访问 127.0.0.1"。08 把这推给 T5"同机恶意进程超出威胁模型",但 §5.5 又用 token 当本机越权的主防线——自相矛盾。
- 要求:ws-ticket 端点必须有真实准入门,至少其一:① 启动时生成一个进程级 secret,写进只有面板能读的本地文件(`0600` 权限),REST 调用须带它(类似 Jupyter token);② 或 control-scope ticket 签发须人工在中枢终端/面板内确认。否则"127 + Origin + 一次性 token"是三层都能被一条本机 curl 链穿透的纸防线,应在 08 §5.5 诚实写明"本机任意进程可取得 control",而不是反过来用 token 论证本机安全。

### RS-M3 argvGuard 密钥特征覆盖不全且 05 内联副本更弱,S3 兜底闸对非 OpenAI 格式密钥有洞
- severity: major
- 证据:05 §6.4 内联 `KEY_PATTERNS = [/sk-.../, /长base64/, /(api_key|secret|token)=.../]`;08 §2.4 `SECRET_SIGNATURES` 含 `aws_akid`(AKIA)、`github_pat`(ghp_)、`jwt`(eyJ)、`bearer` 等,且 08 §2.4 明写"05 当前内联了一份 `KEY_PATTERNS`,按 R1 应改为 `import { SECRET_SIGNATURES }`"。x-consistency D15 也记了 import 路径未统一。
- 反例:① 即便用 08 的全集,`generic_b64` 要 40+ 连续字符、`hex_secret` 要 40+ hex——很多中转/自建的短 token(如 `mb_xxxx`、32 字符 key)**两条都不命中**,08 §2.4 残余里自己承认。② 05 的内联副本连 AKIA/ghp_/JWT/Bearer 都没有,比 08 还弱;若上游把一个 GitHub PAT 或 JWT 误拼进 `--settings`/`-c`,05 的 argvGuard **放行**,key 进 argv → 落 ps 列表 / 崩溃栈 / 日志。S3"argv 永不含 secret"的兜底在这些格式上失效。
- 要求:① 05/06 立即改为 `import { SECRET_SIGNATURES }`(焊死 R1,消除更弱副本);② `SECRET_SIGNATURES` 补主流格式并支持"每接入一个新 provider 把其 key 前缀注册进签名集"(08 §2.4 已留口,需在 provider 接入流程强制);③ 文档别把 argvGuard 宣传成"密钥进 argv 的兜底"——它只对已知格式有效,真正的防线是 S1(key 走 ref 根本不进 argv),argvGuard 是"尽力而为的二道闸",08/05 措辞应降级。

### RS-M4 `_codex_home` 配置键把任意路径注入子进程 CODEX_HOME,绕过 env 白名单设计意图且无路径校验
- severity: major
- 证据:07 §5.2 `toCodexInjection` 读 `cfg.extraConfig['_codex_home']` 写进 `providerEnv.CODEX_HOME`;07 §3.2.1 `SAFE_EXTRA_KEY_RE = /^[a-z0-9_]+.../ ` **允许**下划线开头,`EXTRA_CONFIG_DENY` 只拦 `codex_home`(无下划线),故 `_codex_home` 畅通;07 §5.2 明说这是"绕过 08 `BASE_ENV_ALLOWLIST`、每 provider 注入 CODEX_HOME"的有意设计。08 §2.2 env 自检只对 base 白名单做 secret-like 判定,且对 `_codex_home` 这种路径值放行(路径不匹配 `isSecretLike`)。
- 反例:`CODEX_HOME` 决定 codex 读哪个 `~/.codex/auth.json`(凭证目录)。`_codex_home` 的值**没有过 `isPathSafe`**、没有任何路径白名单。能写 provider 配置的人(本地配置文件,或经面板 reload——07 §8.6 reload 只跑 zod `safeParse`,schema 不校验路径)即可把某 provider 的 CODEX_HOME 指向任意目录:① 指向攻击者预置的 auth.json → codex 用攻击者凭证(或把请求发去攻击者端点);② 指向敏感目录诱导 codex 写入/读取。这是一条"配置 → 子进程 env 路径"的注入面,07 V14 把它当成"精确隔离"的优点,却没给它配安全校验。
- 要求:`_codex_home` 的值必须过路径校验(必须是绝对路径 + 落在用户批准的 sylux 数据目录下 + realpath 不逃逸 + 非 symlink-to-外部),并在 07 §8.6 reload 的 superRefine 里加这条校验(zod parse 之外);panel reload 写 provider 配置应视为半可信输入,不能让 `_codex_home` 随配置任意落地。

### RS-M5 预算只在轮末裁决,单轮(尤其 Fusion panel N 路扇出)可整轮超支;无单 turn token 上限
- severity: major
- 证据:04 §0.4(03 H1)删除了前置刹车 `checkBefore`,改"每轮末单次 `update→shouldStop`";04 §6.4 ① 确定性触发是 `totalTokens >= maxTotalTokens`,发生在**轮末** `StopContext` 构建后;前瞻刹车(②)用"最近两轮实测增量线性外推"——纯**后向**预测。07 §10/§10.5 panel 一个决策回合并发 N 个成员 + 1 裁判,成本 `Σ成员+裁判`;05 适配器只有 `hardTimeoutCeilingMs`(墙钟)无 token 上限。
- 反例:① 预算检查在轮末,意味着**任何一轮都能先把钱花完再被发现超支**。普通单 agent 轮超支幅度 ≈1 轮 base(18.7k),尚可接受;但 Fusion panel 轮一次扇出 N provider,单轮成本 = N×base + judge,一轮就能把预算冲过头 N 倍,轮末才停。② 前瞻是后向外推:前几轮单 agent 便宜→外推出"下轮也便宜"→第 k 轮突然切 panel 扇出,前瞻完全没预见(它只看历史两轮),照样启动→爆。③ 没有任何"单 turn / 单 panel 成员"级的 token 天花板,只有墙钟超时(turn 挂死才触发),一个在 `--max-turns` 内疯狂调用工具但不超时的 agent 能在一个 turn 内烧很多而无 token 闸。
- 要求:① panel 启动前必须按"成员数 × 预测单成员成本"做**扇出感知的前瞻**(不能只用历史两轮的标量外推),"当前累积 + N×预测 > 上限"则不启动该 panel 轮或削减并发;② 增加单 turn / 单成员的 token 硬上限(adapter 累计 `turn.completed.usage` 超阈即 cancel),把"轮末才停"的超支窗口从"一整轮"压到"一个 turn";③ 04 §6.5 配额公式对 panel 范式要单列(当前表只有四范式单 agent 估法,panel 的 N 倍未进公式)。

### RS-M6 命令型 evidence 复跑默认白名单含 node/npx,等于放行执行 worktree 内任意 JS,安全完全压在未实测沙箱上
- severity: major
- 证据:08 §4.8 `CommandEvidenceGuard.allowProgram` 示例集 `{ 'node','npx','pnpm','vitest','tsc','git','cat','rg','ls' }`;08 §4.8 残余自认"`node`/`npx`/`pnpm` 这类可执行任意代码的程序…最稳妥是剔出复跑白名单"——但**给出的默认集没剔**;09 §7.3 复跑器 `sandbox:'read-only'` + `network:'off'`,而 read-only 沙箱出网强度本身就是 RS-B1 的【待实测】。08 openQuestion 把白名单精确成员"留给 04/M0 共定"。
- 反例:critic 提交 `evidence.cmd = "node verify.js"`,`verify.js` 是 agent 在自己 worktree 写的攻击脚本。`SHELL_METACHARS` 不含空格/字母,`node verify.js` 过闸(`node` 在白名单、无元字符);复跑器 spawn `node verify.js` → 执行任意 JS。唯一拦它的是 read-only + network:off 沙箱——而这两者强度未验(RS-B1)。x-coverage §6 也点了"node/npx 是否剔出留 M0,default-deny 列表为空时形同虚设"。
- 要求:① 默认 `allowProgram` **必须剔除** node/npx/pnpm/任何可 `-e`/执行脚本文件的程序,只留纯读取类(`cat`/`rg`/`ls`/`git diff --stat`/`git log`);计算类断言改用 02 §8.3 偏好的 `file+contentHash` 锚点;② 若确需跑测试类命令,必须在 RS-B1 的沙箱出网结论确认"真断网 + 真只读"之后才放开,且白名单成员逐个评审;③ 08 不应把含 node 的集合作为"示例默认"——实现者大概率照抄。

### RS-M7 出境 secret-scan 漏短/非标准密钥,源码经第三方中转外泄(T4 残余的具体洞)
- severity: major
- 证据:08 §7.2 `guardEgress` + `sanitizeOutboundBody` 都复用 `SECRET_SIGNATURES`;08 §7.2 出境分两级——有 sourcePath 的文件片段命中即阻断,拼装正文走 `redact` 脱敏。两者的命中能力都受限于 §2.4 签名集。
- 反例:同 RS-M3——`generic_b64` 需 40+、`hex_secret` 需 40+ hex。源码里一个 32 字符的第三方 API key、一个短 webhook secret、`.npmrc` 里的 `_authToken=`(若没被 `.syluxignore` 标且文件没匹配 `SENSITIVE_PATH`)在发往 mouubox 等 `third_party` 中转时,guardEgress 扫不到、redact 也抹不掉 → 明文连同代码出境给中转方。08 §1.2 T4 把"中转能看到放行后的代码"列残余,但这里的洞是"本该被当 secret 拦下的短 key 因签名集覆盖不全而被当普通代码放行"。
- 要求:① 出境 secret-scan 应叠加更激进的启发式(键值对模式 `\w*(key|token|secret|passwd)\w*\s*[:=]\s*\S{8,}`、私钥头 `-----BEGIN`)而非只靠固定前缀;② 对 `third_party` 出境,`.syluxignore` 默认模板应预置常见凭证文件(`.env*`/`.npmrc`/`*.pem`/`id_*`/`.aws/`/`.docker/config.json`)并在中枢启动时校验用户仓是否覆盖;③ 文档明确"出境扫描不是密钥防泄漏的保证,官方直连(P5)才是唯一可靠手段",与 08 §7.3 口径一致但要前置到知情横幅。

## 3. MINOR

### RS-m1 git symlink/mode-120000 blob 可让合并落地路径校验失效(worktree 数据/越界）
- severity: minor
- 证据:09 §5.5 `assertTreePathsSafe` 对 `git ls-tree -r --name-only <mergedTree>` 的**路径名**逐个过 `isPathSafe`;08 §4.4 `isPathSafe` 末尾对**不存在的新增文件**回退用 `resolve` 结果判定(realpath 抛即跳过 link 解析),自认有 TOCTOU 残余。
- 反例:agent 在自己 worktree `git add` 一个 mode `120000`(symlink)条目,内容(blob)是 `../../../../etc/passwd` 或 `..\..\auth.json`。`ls-tree --name-only` 给的是**链接文件自身的仓内路径**(合法、落 integration 内),`isPathSafe` 对这个名字判定通过;但该路径校验**没看 blob 内容/文件模式**——合并把这个 symlink 写进 integration worktree 后,后续任何读该路径的操作(diff 正文生成、readFileRange、面板展示)会**跟随链接**读到 worktree 外。09 W10 的二次校验校的是"路径名归属",没校"这个条目是不是指向外部的链接"。
- 要求:`assertTreePathsSafe` 对 `ls-tree` 输出要带 mode(`git ls-tree -r` 不加 `--name-only` 即含 mode),遇到 `120000`(symlink)/`160000`(gitlink/submodule)条目时,解析其 blob 内容做目标归属校验或直接拒绝合并(merge 阶段引入新 symlink 应视为高危,硬停回灌)。同样地 diffSince 的 `add -A` 也会把 agent 新建的 symlink 纳入,需同一把闸。

### RS-m2 diff_ready.files[].path / 文件名渲染是 RS-B2 的独立 XSS 旁路,redact 不覆盖
- severity: minor(归属 RS-B2,但旁路独立列出防漏修)
- 证据:11 §3.1 `sDiffReadySchema.files[].path` 是字符串直送前端;09 §4.4 路径过的是 `isPathSafe`(防穿越),**不防** HTML。文件名完全可以是 `<img src=x onerror=...>.ts`(Windows 禁 `<>` 但 `isPathSafe` 的 `/[<>"|?*]/` 拦截只在 worktree 路径校验侧;经 git rename 检测/agent 自填 files 进 `diff_ready` 的路径串若未走同一把闸则漏)。
- 反例:即便修了 RS-B2 的 body/diff 正文消毒,文件名、`argsDigest`、evidence `locator`/`source` 这些"短字符串字段"常被实现者当"安全的元数据"直接插进 DOM。它们同样是 agent 可控。
- 要求:RS-B2 的消毒必须覆盖**所有** agent 可控字符串字段(path/source/locator/label/argsDigest/reason),不只 body 和 diff 正文。前端统一走"agent 来源 = 不可信文本"的渲染策略,而非逐字段豁免。

### RS-m3 redact 占位符与 §3.2 级联替换的边角:`generic_b64` 可能吃掉已替换占位符的尾随上下文
- severity: minor
- 证据:08 §3.2 redact 顺序遍历 `SECRET_SIGNATURES`,强特征先替换成 `‹redacted:name:len›`,注释称占位符用 U+2039/203A 与 base64/hex 字符集不相交故不会被二次命中。
- 反例:占位符里的 `redacted` 是字母、`:len` 是数字——`‹redacted:openai_sk:24›` 内部的 `redacted` + 数字片段本身不足 40 字符不触发 generic_b64,论断基本成立;但若**原文相邻**有一段长 base64 紧挨强特征 key(`sk-xxx<40+ b64>`),强特征替换后留下的 `‹...›<40+ b64>` 里那段 b64 仍会被 generic_b64 正确命中替换——这条其实是对的。真正的边角是:**`m.length` 把原始密钥长度泄进占位符**(`‹redacted:anthropic:51›`)。长度对暴力破解几无价值但确实是元数据泄露,审计/WS 里出现精确长度。
- 要求:可接受现状(长度泄露危害极低),但若要严格,占位符去掉 `:len` 或量化成区间(`:long`)。仅作记录,不阻断。

### RS-m4 pause 不可中断在飞 turn,token 预算同样无法中途刹停烧钱(与 RS-M5 同源的成本边角)
- severity: minor
- 证据:10 §6.1 + 01 §2.3:`pause` 在相位边界(P0/P8)生效,P4 正在跑则"等本次发言结束";仅 `abort`(经 signal)能穿透 P4。04 预算裁决也在轮末。
- 反例:一个 turn 内 agent 在 `--max-turns` 上限内疯狂工具循环(每次 resume 中转累积计费,事实 D),人类在面板看到 token 飙升想"暂停省钱"——pause 不生效(要等本轮发言完),只能 abort(整个 run 终结,丢进度)。即"想踩刹车但只有油门松开(等本轮)和熄火(abort)两档,没有点刹"。
- 要求:对成本敏感场景,考虑让 control 帧支持"软上限即时下调"或"本 turn 到达 X token 即 cancel 本 turn 但保 run"(介于 pause 与 abort 之间);或至少面板明确告知"pause 不会立即止血,要立即止血只能 abort"。属体验+成本边角,非安全失效。

### RS-m5 inject 的 WS 层先快筛、引擎相位边界才真校验,人工注入文本有一段"已入队未过防火墙"窗口
- severity: minor
- 证据:11 §8.3 `handleControlFrame` 把 `inject` 直接 `controlQueue.push({kind:'inject',from:'human',payload})`,注释"真正的 validateMessage/firewallPeerMessage 在引擎消费 inject 时执行";11 §4.2 也说 server 侧"先快筛"。
- 反例:语义上没有真漏洞(引擎消费时会过 08 §4 防火墙 + 02 §8 校验,失败回 system),但 `controlQueue` 里短暂存在**未过防火墙的 human payload**。若有任何旁路在引擎消费前读 controlQueue 并广播/落盘(例如审计提前记录控制帧),注入文本会在过闸前外溢。当前设计没有这种旁路,故仅为纵深提示。
- 要求:确保 controlQueue 内未过闸的 inject payload 在被引擎校验前**不进任何**广播/jsonl/日志通路;若审计要记"收到 inject 控制帧",只记元数据(cid/from/ts)不记 payload 正文,正文等过闸成 Message 后再随 message 帧落盘(已 redact)。

---

## 0. 总体判定(verdict)— 回填

整体安全设计的**框架**是扎实的:R8 八条(env 白名单 / key 引用模型 / 内容防火墙 / 沙箱封顶 / redact 单一出口 / WS 鉴权分级 / 出境扫描 / 官方直连)都有专章落地,08 自身的对抗性自审质量高(T11–T15 自己就挖出不少)。但有两类**地基性问题**使它达不到"可验收开工":

1. **头号防线悬空(RS-B1)**:整套对"提示注入→RCE/exfil"的防御,最终垫底全押在"沙箱断网 + worktree 隔离让中招也跑不掉"上,而沙箱出网强度**从未实测**。关键词扫描、边界标记两层都自认可被绕过,只是"降低成功率"。地基没验,上层再精巧也是浮的。这是 M0 开工前必须有结论的 blocker。
2. **威胁模型缺一整面(RS-B2)**:08 把浏览器只当"发起攻击的不可信方"(CSWSH/越权),完全没考虑"agent 恶意内容 → 持 control 权限的浏览器 DOM"这条 XSS 通路。10 面板侧也无任何消毒/CSP。内容防火墙保护了对面 agent,却没保护唯一握有控制权的人类浏览器。

外加 7 条 major:流式 redact 跨帧漏(RS-M1)、WS ticket 签发端鉴权循环论证(RS-M2)、argvGuard 覆盖不全且 05 副本更弱(RS-M3)、`_codex_home` 路径注入无校验(RS-M4)、预算轮末才停 + panel 扇出无前瞻(RS-M5)、命令复跑默认白名单含 node(RS-M6)、出境扫描漏短/非标准 key(RS-M7)。这些多数有"其他层兜底但兜底也有洞"的性质,需逐条回填。

**verdict: 需修复后才可开工(blocker×2 必须先解,major×7 开工前回填)**。blocker 集中在"实测验证 + 威胁模型补面",不是推翻架构;major 集中在"防御覆盖不全 / 自相矛盾的安全论证 / 成本闸时机"。架构决策(进程模型 / 黑板 / worktree / provider 可换 / Fusion)无需推翻。

注:本报告基于通读 08/09/07/11 全文 + 01/04/05/06/10 的安全相关段落 + x-consistency/x-coverage + PROBED-FACTS。未深读 03/12-25 全文,若其中有与本findings 冲突的已存在缓解,以那些文档为准复核(尤其 RS-M5 的 panel 成本若 21 Fusion 正文已有扇出前瞻、RS-B2 若 10 正文某处有未被 grep 命中的消毒)。但 grep 与抽读未发现这些缓解存在。
