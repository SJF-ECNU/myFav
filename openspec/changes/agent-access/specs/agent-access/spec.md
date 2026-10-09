## ADDED Requirements
### Requirement: Independent agent credentials
系统 SHALL 为每 Agent 提供随机独立凭据、本地撤销与轮换，注册管理凭据存在时禁用旧共享凭据。
#### Scenario: Revoke a credential
- **WHEN** 管理员撤销 Agent
- **THEN** 后续请求认证失败而其他 Agent 仍可使用
#### Scenario: Managed migration
- **WHEN** 创建第一个 Agent
- **THEN** 原 MYFAV_TOKEN 不再提供全权限访问
### Requirement: Tool scopes
系统 SHALL 在服务端执行 read/prepare/write 授权；只读内容 SHALL 不打开浏览器或创建转写任务。
#### Scenario: Read-only agent
- **WHEN** 只读 Agent 请求未准备的内容或尝试同步/写回
- **THEN** 内容返回未准备的缓存状态，同步/写回被拒绝
### Requirement: Bounded workload
系统 SHALL 限制每身份请求频率并在准备批次排空前拒绝重复准备入队。
#### Scenario: Ongoing transcription
- **WHEN** 准备批次尚未排空而 Agent 请求另一批次
- **THEN** 返回忙碌结果，缓存读取仍可用
### Requirement: Safe audit
系统 SHALL 保存身份、受控方法/工具名和结果，不保存凭据、请求参数、内容正文或响应正文。
#### Scenario: Malicious input
- **WHEN** 请求在工具名、参数或认证头中携带秘密
- **THEN** 审计不包含这些原始值

### Requirement: Generic OAuth resource server
系统 SHALL 提供 MCP 授权发现并验证可信授权服务器的访问令牌，检查目标资源、过期、客户端和用户；权限取令牌与本地注册的交集。
#### Scenario: Wrong audience or expired token
- **WHEN** 客户端提交其他资源或过期令牌
- **THEN** 请求认证失败且不执行工具
#### Scenario: Discovery and authorization
- **WHEN** OAuth 客户端访问未认证的 MCP
- **THEN** 401 挑战包含公开资源元数据地址，客户端可发现外部授权服务并进行授权码/PKCE 流程

### Requirement: OAuth 2.1 client flow
部署示例 SHALL 使用授权码与强制 PKCE S256，禁用 implicit 和密码授权，并支持刷新访问令牌。
#### Scenario: Authorization without PKCE
- **WHEN** 示例客户端未发送 code challenge
- **THEN** 授权服务拒绝授权，不能获得可用授权码
#### Scenario: Refresh access
- **WHEN** 已绑定客户端使用有效刷新令牌
- **THEN** 获取的新访问令牌可以使用权限范围内工具，撤销本地绑定后不再可用
