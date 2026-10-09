# 小红书接入验证

2026-10-09，用户要求接入第三个平台。按现有平台约定默认仅myFav收藏夹；尚未验证该夹在网页版可读，不自动扩大为全部收藏。

## 来源与实测

- [xiaohongshu-mcp登录源码](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/xiaohongshu/login.go)：浏览器扫码，页面登录节点及用户状态用于检查。仅作为实现线索，不安装或运行其程序。
- [redbook项目](https://github.com/lucasygu/redbook)：提供本人收藏笔记读取命令，不能据此证明命名收藏夹在网页可用。
- 已创建独立CloakBrowser配置.local/xiaohongshu-profile（权限700）；真实网页explore显示扫码弹窗，等待用户完成登录。采用页面用户guest/ID状态判断，不以匿名Cookie当登录成功。

## 接入步骤与边界

1. npm run xiaohongshu:login 手动扫码；npm run xiaohongshu:status检查网页登录状态。
2. 登录后确认收藏夹列表、myFav、分页及选定夹内条目。网页无该能力时明确报告，不自动采集所有收藏。
3. 验证图文完整正文、视频字幕或原视频音轨，缺字幕复用本地转写。图文视觉内容不冒充正文理解。
4. 依据实际字段实现xiaohongshu平台适配，复用既有scopes/items/events和统一六工具；数据失败不影响Bilibili、抖音，保持旧客户端ID。
5. 真实MCP同步、重复去重、内容预取和重启登录实测后才能声明接通。

当前仅登录准备完成，正式MCP适配未实现。无发布、互动写入、签名逆向或验证码绕过。

## 已完成账号与MCP实测

2026-10-09：网页登录后无窗口重启确认登录，网页版支持myFav专辑，2条（1视频1图文）完整同步。同步added=2，重复added=0。图文正文1003字符，视频简介152字符；样本未发现可用字幕，原视频HTTP CDN地址改用同域HTTPS，本地Whisper转写48段并经MCP读取text_available。19项测试通过，Bilibili 1条及76段字幕、抖音24条及首条78段转写继续可读。上文准备/待验证为历史记录，正式xiaohongshu平台路由已实现。

专辑列表与内页均从网站自身状态读取；直接进入已观察的profile?tab=fav&subTab=board避免页面hydration覆盖标签选择。笔记访问参数留在服务器sources表，不返回Agent或记录在文档中。真实样本2条未触发多页；分页失败检查、笔记重复检查存在，但真实大型专辑分页、平台字幕、长期登录与服务器部署仍待独立验证。
