# OAuth 2.1 接入

myFav 是 OAuth **资源服务器**；账号登录、授权码、PKCE、刷新令牌、客户端注册和授权页面由外部授权服务负责。实现遵循 [MCP 授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)，通过 OIDC discovery 发现支持 PKCE S256 的授权服务。提供 JWT/JWKS 校验，也支持 RFC 7662 不透明令牌 introspection。不能直接使用社交平台的 Cookie 或它们的 access token 连接 MCP。

## 使用已有授权服务

在私有 `.env` 中填写：

```dotenv
MYFAV_OAUTH_ISSUER=https://auth.example.com/realms/myfav
MYFAV_OAUTH_RESOURCE=https://myfav.example.com/mcp
MYFAV_ALLOWED_HOSTS=myfav.example.com
# 仅浏览器 MCP 客户端需要：精确填写来源，不能用通配符
MYFAV_ALLOWED_ORIGINS=https://agent.example.com
```

`issuer` 必须与授权服务 discovery 中的值完全一致，包括末尾斜杠。访问令牌必须包含：有效签名、匹配的 `iss`、目标资源 `aud`、未过期的 `exp`、用户 `sub`、客户端 `client_id` 或 `azp`，以及空格分隔的 `scope`。`aud` 必须包含公开 MCP 的完整资源地址，而不是客户端 ID。

为各 Agent 注册不同 OAuth 客户端，使用明确的回调 URL，开启授权码流程，**强制 PKCE S256**，关闭 implicit 与密码授权。客户端应在授权和令牌请求中发送 `resource=MYFAV_OAUTH_RESOURCE`。授权服务必须将该资源写入访问令牌的 audience。客户端注册方式由授权服务和 Agent 平台决定；本示例采用预注册，不提供匿名动态注册，也不承诺所有平台的注册方式均已验证。

在 myFav 运行环境中将授权用户和客户端绑定到本地 Agent：

```sh
npm run agents -- oauth-add planner myfav-agent YOUR_USER_SUBJECT read,prepare,write
# Docker 部署：
# docker compose exec myfav npm run agents -- oauth-add planner myfav-agent YOUR_USER_SUBJECT read,prepare,write
```

`YOUR_USER_SUBJECT` 是授权服务的用户 ID（令牌 `sub`），不是通常意义上的用户名。OAuth 客户端与用户同时匹配才允许访问；实际权限为本地权限与访问令牌 `myfav:read`、`myfav:prepare`、`myfav:write` 的交集。所有已授权 Agent 访问同一份收藏数据，未实现多用户数据隔离。

Agent 添加公开 MCP URL 并按其平台流程进行 OAuth 登录。未认证请求返回带 `resource_metadata` 的 `WWW-Authenticate`。公开发现端点为：

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`

使用不透明令牌时额外配置 `MYFAV_OAUTH_INTROSPECTION_URL`、`MYFAV_OAUTH_CLIENT_ID`、`MYFAV_OAUTH_CLIENT_SECRET`。这些是资源服务器访问 introspection 的机密客户端凭据，不能交给 Agent。响应必须为 `active=true`，并包含上述 audience、过期时间、用户、客户端和 scope；如果提供 `iss`，也必须匹配。

## 可选 Keycloak 部署示例

[Keycloak 官方文档](https://www.keycloak.org/securing-apps/oidc-layers)说明其授权、刷新和 introspection 端点。`compose.oauth.yaml` 使用独立 PostgreSQL 持久卷及生产启动模式，HTTP 入口只绑定服务器回环，必须通过 HTTPS 反向代理访问。

1. 修改 `keycloak-realm.example.json` 中的资源 audience、客户端 ID 和回调 URL，替换示例域名。每个 Agent 使用自己的客户端配置；只读是默认 scope，准备和写入是可选 scope。
2. 创建被 Git 忽略的 `.env.oauth`，填写以下变量并 `chmod 600 .env.oauth`。数据库和管理员密码分别生成随机值，不与 MCP/API 凭据复用。

```dotenv
MYFAV_OAUTH_PUBLIC_URL=https://auth.example.com
MYFAV_OAUTH_DB_PASSWORD=REPLACE_WITH_RANDOM_PASSWORD
MYFAV_OAUTH_ADMIN_USERNAME=admin
MYFAV_OAUTH_ADMIN_PASSWORD=REPLACE_WITH_ANOTHER_RANDOM_PASSWORD
```

3. HTTPS 反向代理分别将 MCP 域名转发到 `127.0.0.1:8787`，授权域名转发到 `127.0.0.1:8080`。代理须保留原始 Host，覆盖来自外部的 `X-Forwarded-*`，正确发送 `X-Forwarded-Proto: https`。在代理层限制匿名请求频率；不要公开容器原始端口、数据库或登录窗口。限制 Keycloak 管理页面访问来源。
4. 先启动授权服务，完成 HTTPS，再填写 myFav 的 issuer/resource：

```sh
docker compose --env-file .env --env-file .env.oauth -f compose.yaml -f compose.oauth.yaml up -d oauth
# 在 Keycloak 管理界面创建自己的用户，确认客户端及 scope 配置
# 再启动资源服务器、绑定授权用户：
docker compose --env-file .env --env-file .env.oauth -f compose.yaml -f compose.oauth.yaml up -d myfav
docker compose exec myfav npm run agents -- oauth-add planner myfav-agent YOUR_USER_SUBJECT read,prepare,write
```

示例显式添加 [Subject mapper](https://www.keycloak.org/admin-api/protocol-mappers)，确保访问令牌包含 `sub`。Realm 文件只在首次导入时创建 realm；已有配置不会随文件修改自动覆盖，需要在管理界面修改。示例不创建任何普通用户或已授权 Agent。`.env.oauth` 仅用于 Compose 变量替换，不作为 myFav 容器的 env_file，授权服务的管理员及数据库密码不注入 myFav。

## 撤销与验证边界

`agents revoke` 或修改本地权限在下一次请求生效，不取消正在执行的任务。JWT 在授权服务中撤销后，资源服务器的离线校验可能仍接受它到过期；示例采用五分钟访问令牌，并开启刷新令牌轮换。需要即时授权服务撤销检查时使用 introspection；本地绑定撤销不受 JWT 缓存影响。

`node scripts/oauth-smoke.js` 用隔离的真实 Keycloak、临时用户和浏览器验证授权码、PKCE S256、资源调用、刷新和撤销。需要 Docker，测试后删除自己的容器和临时凭据，不使用用户收藏或登录态。公网 DNS/TLS、具体 Agent 平台的客户端注册与回调、长期服务器运行需要在实际部署中验证。
