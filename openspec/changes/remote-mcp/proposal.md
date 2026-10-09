## Why
让外部 Agent 用凭证连接 myFav，获取新收藏及内容并写回试用结果。用户明确无需唤醒或执行器。
## What Changes
增加带认证的 Streamable HTTP MCP、SQLite 事件游标/状态/结果及字幕读取。默认仅 myFav；命名收藏夹作为服务端配置，不允许调用方悄悄扩范围。
## Capabilities
### New Capabilities
- `favorite-mcp`: 新收藏查询、内容读取、状态与结果写回。
### Modified Capabilities
无。
## Impact
新增 MCP SDK、Express、Zod，Node.js 24 内置 SQLite。现有 CLI 保留。未部署公网。
