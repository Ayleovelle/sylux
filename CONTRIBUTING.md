# 🤝 为 sylux 做出贡献

感谢您有兴趣为 **sylux** 做出贡献！无论是修复 Bug、添加新功能还是改进文档，您的每一次贡献都让这个项目变得更好。

## 📄 提交 Issue

### 🐛 报告 Bug

请通过 [Bug 报告](../../issues/new?template=bug_report.yml) 提交。提交前：

1. 搜索现有 Issue，检查是否已有人报告过。
2. 确保使用的是最新版本。

### ✨ 功能建议

欢迎通过 [功能建议](../../issues/new?template=feature_request.yml) 与我们分享想法。

## 💻 代码贡献

标准流程：

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/my-feature`)
3. 写代码，跑 `node src/accept.mjs` 确认验收通过
4. 提交 PR，填写 PR 模板

### 开发约定

- **零依赖**：不引入 npm 包，纯 Node.js 内置模块
- **安全红线**：配置文件里禁止出现 key/token/secret，凭证只走 auth.json 或环境变量
- **Node >= 22**：使用 ES module (.mjs)，不编译
- **测试**：改动后跑 `node src/accept.mjs`（50 个确定性测试，零 token 花费）

## ❤️ 行为准则

参与贡献即表示您同意遵守本项目的 [行为准则](CODE_OF_CONDUCT.md)。
