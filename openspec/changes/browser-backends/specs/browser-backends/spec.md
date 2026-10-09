## ADDED Requirements
### Requirement: Select browser backend
系统 SHALL 根据配置使用默认 CloakBrowser、指定 Chromium 可执行文件或外部 CDP 浏览器，并供三平台登录与同步共用。
#### Scenario: Chromium executable
- **WHEN** 配置 chromium 和有效可执行路径
- **THEN** 在平台专用持久目录启动该浏览器
#### Scenario: Missing configuration
- **WHEN** 后端无效或缺少所需路径/端点
- **THEN** 返回安全错误且不静默回退其他后端
### Requirement: Preserve external browser ownership
CDP 会话 SHALL 复用已有默认上下文并在结束时仅关闭自身工作页和断开连接。
#### Scenario: Shared logged-in browser
- **WHEN** 已登录浏览器完成 myFav 会话
- **THEN** 已有标签页、浏览器进程和登录态仍保留
### Requirement: Safe connection errors
系统 SHALL 不将 CDP 地址、认证参数或原始浏览器启动细节输出到用户错误中。
#### Scenario: CDP connection fails
- **WHEN** 带认证参数的连接被拒绝
- **THEN** 用户只看到不含地址与凭据的安全错误
