## Why
受管云环境可能不允许启动自带浏览器，需要使用环境已有 Chromium 或提供的 CDP 接口。
## What Changes
统一三平台浏览器会话入口，支持 cloakbrowser（默认）、chromium 可执行路径、cdp 连接。CDP 使用已有默认上下文和登录态，仅操作自建页面，结束时断开连接。CLI 与服务读取相同环境配置。
## Capabilities
### New Capabilities
- browser-backends: 三平台可替换浏览器后端。
### Modified Capabilities
无。
## Impact
浏览器启动、登录 CLI、服务会话释放、配置示例和测试文档；收藏与转写算法保持不变。
