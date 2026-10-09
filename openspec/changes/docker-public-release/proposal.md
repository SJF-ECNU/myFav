## Why
用户要求可部署的 Docker 镜像和 GitHub 公开项目，包含 README、MIT 许可及第三方引用。
## What Changes
提供非 root 容器、持久数据和模型卷、临时 noVNC 手动登录入口；重写公开文档，保留依赖许可并排除本机数据与私人工作记录。
## Capabilities
### New Capabilities
- container-deployment: 可构建、登录与启动的持久化容器部署。
### Modified Capabilities
无。
## Impact
部署配置、脚本、许可和文档；不改变平台同步或 MCP 工具行为。
