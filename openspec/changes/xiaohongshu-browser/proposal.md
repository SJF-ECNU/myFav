## Why
用户要求接入小红书，需要先在独立专用浏览器登录并验证指定myFav范围。
## What Changes
独立小红书登录/status命令；登录后只读取myFav专辑，接入统一MCP平台路由。正文及视频本地音频转写提前缓存，访问链接仅保存在服务器数据中，不向Agent暴露内容访问参数。
## Capabilities
### New Capabilities
- xiaohongshu-login: 专用网页登录准备。
- xiaohongshu-favorites: 指定专辑同步、正文与视频转写。
### Modified Capabilities
无。
## Impact
独立登录及平台服务、SQLite内部来源表、MCP平台枚举、转写CDN允许域名、测试和文档；保留已有两个平台。
