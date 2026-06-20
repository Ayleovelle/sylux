# Changelog

## [0.2.0-preview] - 2026-06-21

> 预览版。核心功能已实现并通过本地双端实测，但尚未经过独立环境验证。

### 新增

- 四范式协作剧本：红蓝对抗 / 主从 / 对等结对 / 分工并行，泛型 Playbook 接口一键切换
- 配置层：JSON 配置文件驱动，agents / playbook / roles / stop 全可配，命令行 flag 可覆盖
- 收敛检测：evidence 指纹差集 + 停滞/完成信号解耦，按范式自动分化策略
- Web 实时观战面板：零依赖原生 WebSocket，127.0.0.1 绑定 + 一次性 token 鉴权
- 完整状态码体系：14 个明确码 + transient 分类 + 故障注入测试
- clean-room 三层隔离：人格压制 / 文件隔离 / 无状态上下文

### 已知限制

- 依赖 mouubox 中转（codex 端），中转不稳时该端 transient 失败重试
- worktree 物理文件隔离 + unified diff 面板留后续
- 面板为只读观战，暂停/介入控制平面留后续
