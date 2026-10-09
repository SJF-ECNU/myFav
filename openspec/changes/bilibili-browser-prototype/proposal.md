## Why
验证用户指定的 CloakBrowser 持久化登录能否读取本人 Bilibili 视频收藏，后续接入 MCP。

## What Changes
增加 Node.js 命令行 login、status、sync；专用浏览器目录与完整同步结果不入 Git。

## Capabilities
### New Capabilities
- `bilibili-favorites`: 持久化网页登录、登录状态检查及本人视频收藏分页读取。
### Modified Capabilities
无。

## Impact
新增 cloakbrowser、playwright-core 依赖及本地运行目录。仅调用 Bilibili 读取接口；不修改平台收藏。

用户后续限定：支持按名称指定收藏夹，当前默认仅同步 myFav；不读取其他收藏夹内容。
