## Context
三平台已有专用 CloakBrowser 配置、SQLite 和本地 Whisper；仅公开代码及脱敏文档。
## Goals / Non-Goals
支持 Docker Compose 和服务器手动登录。调度与项目执行仍由外部 Agent 负责；不部署实际公网服务器。
## Decisions
采用 Node 24 Debian、CPU Whisper、镜像内浏览器；以 node 用户运行。数据和模型独立卷；临时登录进程运行 Xvfb、x11vnc、noVNC，端口仅绑定主机回环。停止 MCP 后再登录避免浏览器配置冲突。
## Risks / Trade-offs
浏览器和模型运行时镜像较大；登录可能过期，服务器 IP 变化可能需重新扫码。仅当前机器架构经构建验证。第三方许可独立于 myFav MIT。
## Migration Plan
新服务器在容器重新登录，避免跨操作系统复制浏览器配置。保留卷可升级；删除卷会删除登录态与结果。
