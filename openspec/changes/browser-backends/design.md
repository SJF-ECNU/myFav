## Context
现有平台直接启动 CloakBrowser 并关闭 context，连接外部浏览器后必须区分所有权。
## Goals / Non-Goals
支持显式 executablePath 和 CDP URL，保留自带浏览器默认行为；不承诺所有 Chromium 版本兼容，不实现工具专用云浏览器的数据导入。
## Decisions
共享 openSession 返回 context、page、close。自启动使用每平台持久目录；CDP 复用默认上下文，创建私有工作页并保留用户页面，close 关闭工作页后断开。连接和启动错误不输出端点及原始认证信息。CDP 登录使用外部浏览器窗口而非 noVNC。
## Risks / Trade-offs
CDP 功能与浏览器版本需实测；外部浏览器持久化由提供方负责。CDP 是浏览器控制接口，应只在可信私网或隧道中访问。
## Migration Plan
默认配置不变；将 MYFAV_BROWSER 设置为 chromium 或 cdp 后运行现有登录与同步命令。
