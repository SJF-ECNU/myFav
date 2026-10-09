## Why
公网多 Agent 接入需要独立凭证、最小工具权限、即时撤销、资源限制和不泄密的审计。
## What Changes
本地 CLI 管理随机 Token 与 read/prepare/write 范围；SQLite 私有凭据和审计。首个注册 Agent 关闭旧共享 Token。HTTP 每 Agent 限流，只读内容仅缓存；服务限制一个准备批次，后台排空后释放。增加通用 OAuth 资源服务器发现与 JWT/JWKS 或标准 introspection 校验，示例使用 Keycloak；授权服务器负责 PKCE、登录和刷新。不增加远程凭据管理接口。
## Capabilities
### New Capabilities
- agent-access: 独立认证、权限、撤销、限流与审计。
### Modified Capabilities
无。
## Impact
HTTP/MCP、缓存读取、启动和管理 CLI、私有 SQLite、测试与部署文档；保持六工具及原平台流程。
