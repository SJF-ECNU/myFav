## Why
用户已完成抖音登录，myFav收藏夹列表和20/24条第一页实测可读，需要统一接入现有MCP。
## What Changes
按平台保存账号/收藏夹作用域，保留Bilibili现有条目ID；抖音作品ID保持字符串。sync_favorites和list_updates支持platform筛选，其余工具按条目ID路由。仅myFav，同步后预取字幕和本地转写。
## Capabilities
### New Capabilities
- platform-favorites: 统一多平台收藏。
### Modified Capabilities
无。
## Impact
SQLite轻量迁移、抖音浏览器与内容服务、MCP参数及文档测试。
