# 抖音接入调研

2026-10-09。结论：存在网页登录读取本人收藏和指定收藏夹的开源实现线索，尚未用本账号证明收藏接口可用。用户明确只读取名为 myFav 的收藏夹。

## 已观察与来源

- 当前网页版 /user/self?showTab=favorite_collection 存在收藏入口；未登录时提示登录后查看。独立CloakBrowser窗口已启动，当前要求短信验证并提示访问太频繁；验证由用户完成，不自动反复发送验证码。
- [官方SDK概述](https://open.douyin.com/platform/resource/docs/develop/summarize/sdk)描述授权登录的公开资料及深度合作的额外用户数据，但不足以证明普通应用可以获取私人收藏视频。
- [TikTokDownloader收藏实现](https://github.com/JoeanAmier/TikTokDownloader/blob/master/src/interface/collection.py)：POST /aweme/v1/web/aweme/listcollection/，count/cursor，响应aweme_list/has_more。属于网站内部接口线索，不是官方OpenAPI保证。
- [其收藏夹实现](https://github.com/JoeanAmier/TikTokDownloader/blob/master/src/interface/collects.py)：GET /aweme/v1/web/collects/list/，collects_list；GET /aweme/v1/web/collects/video/list/，collects_id/cursor/count，aweme_list。后续只定位myFav，再获取该夹内容，不读取其他夹作品。
- [作品详情实现](https://github.com/JoeanAmier/TikTokDownloader/blob/master/src/interface/detail.py)：/aweme/v1/web/aweme/detail/ 和 aweme_id。视频文本字幕、实际音轨地址及下载权限仍需账号实测。

## 最小实施顺序

1. npm run douyin:login：独立.local/douyin-profile，用户手动扫码及验证。npm run douyin:status只报告会话标记，不等于账号读取权限验证。
2. 登录后由真实网页访问收藏页，读取网页自身收藏夹请求，确认myFav定位、分页终止和字段。不假定Bilibili的计数及ID格式适用抖音；抖音作品ID按字符串保存，避免超出JS安全整数范围。
3. 获取一条myFav内视频详情和字幕/音轨；字幕缺失复用本地ffmpeg+Whisper。图文收藏需独立表达，不能伪装为视频转写；先不扩大范围到收藏音乐/短剧/合集。
4. 再接入统一六工具，添加platform及筛选。现有SQLite scope只有一个账号/夹，itemId无平台前缀；需要定点迁移/路由，保留Bilibili历史与当前客户端ID，不直接混写第二个平台。
5. 验证重启会话、分页失败不覆盖、重复同步不新增、提前内容缓存及真实MCP读取。

## 当前边界

登录脚本与调研已准备，正式抖音适配尚未实现。不能称抖音已接入Agent。不实现逆向签名或绕过验证码，不保存/输出Cookie、短信、私人收藏正文或带签名媒体URL到项目文档。服务器稳定性仍需单独实测。

## 账号与MCP实测更新

2026-10-09：手动登录后无窗口重启会话有效，收藏夹及指定夹内容接口实际可读。myFav完整两页20+4，共24条，MCP首次added=24，重复added=0；仅该夹成员入库。第一条视频无可用字幕，真实原视频声音本地Whisper转写78段，MCP读取text_available。Bilibili原有1条及76段平台字幕缓存仍可用。17项测试通过，包含平台隔离及旧数据库迁移。正式统一MCP路由已实现；上文未实现描述是历史观察。其他条目按后台队列准备，不宣称24条全部已完成；平台字幕解析目前只有模拟样本，真实字幕与长期运行稳定性仍待验证。
