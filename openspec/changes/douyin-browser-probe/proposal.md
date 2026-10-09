## Why
用户要求下一步检查抖音接入；需要先验证独立持久网页登录，避免把开源线索当账号读取实测。
## What Changes
加入独立的抖音登录命令，仅保存专用浏览器配置；记录收藏接口线索和统一MCP接入所需改动。账号收藏读取与正式适配在登录后验证。
## Capabilities
### New Capabilities
- douyin-login: 独立网页登录与重启会话检查。
### Modified Capabilities
无。
## Impact
新src/douyin-login.js、package.json脚本和调研文档。不修改Bilibili服务、数据库或登录目录。
