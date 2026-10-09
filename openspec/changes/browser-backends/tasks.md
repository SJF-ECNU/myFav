## 1. 实现
- [x] 1.1 统一会话和关闭逻辑，支持三种模式
- [x] 1.2 CLI、Docker 登录入口及文档配置
## 2. 验证
- [x] 2.1 配置错误、所有权、连接失败和现有测试
- [x] 2.2 真实指定内核/CDP，确认登录态复用及外部浏览器存活

## 验证记录
真实 macOS Google Chrome 指定路径持久 Cookie 重启复用、三平台 CDP 会话 Cookie/localStorage 复用、原有页面及浏览器存活通过。Docker ARM64 指定路径与 CDP 集成也通过（使用镜像内的 Chromium 作为独立外部浏览器）；服务释放走 close 而非共享 context.close。尚未验证用户截图中的云浏览器实际端点及真实平台账号。
