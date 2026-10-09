## Context
单共享 Bearer Token 允许全部工具，get_content 会自动启动浏览器及 Whisper，准备队列可以重复入队。
## Goals / Non-Goals
支持单实例多 Agent 身份、工具范围、撤销/轮换、频率与准备批次限制、元数据审计；加入外部 OAuth 授权服务器；不做多租户数据隔离、HTTPS终止或分布式限流。
## Decisions
read 提供增量、缓存内容和结果；prepare 提供同步并允许内容准备；write 提供状态及结果写回。只读 get_content 必须无副作用。注册表每请求读取，撤销和轮换作用于后续请求，不取消已执行操作。全部 Agent（含已撤销）注册存在时禁用旧共享入口。随机凭证保存在权限600的私有SQLite，交付文件权限600，不输出 Token；不新增 Hash 或证明链机制。审计仅服务生成/白名单元数据，最多保留10000条。每身份固定一分钟计数，内存限流重启归零；准备批次保持占用直到后台队列排空。公网TLS和匿名流量限制由反向代理提供。
## Risks / Trade-offs
数据库和备份包含凭据必须保护；数据库管理员可修改审计，不承诺防篡改。Token 不自动过期；轮换撤销由管理员CLI操作。共享Token仅兼容尚无注册用户的旧实例。长批次可能导致其他 prepare 请求需稍后重试，但只读缓存保持可用。
## Migration Plan
已有 .env 可以启动；使用本地CLI创建所有 Agent 并配置客户端。首个注册自动废弃旧凭证，无需重启；管理通过服务器终端而非MCP。

## OAuth
MCP SDK 提供公开的 Protected Resource Metadata 和授权挑战；信任显式配置的 issuer/resource，通过 JOSE/JWKS 校验 JWT 或使用 HTTPS introspection 校验 opaque token。必须校验 audience、expiry 及身份；本地注册 client_id + subject 的 Agent，权限取令牌 scope 和本地范围交集。授权码、PKCE、动态注册和 refresh 由提供方负责，Keycloak 示例采用预注册客户端。客户端注册支持由提供方决定，不能声称所有平台自动兼容。OAuth Agent 可本地撤销，JWT 的授权服务器撤销通常要等待过期；保留两层边界。
