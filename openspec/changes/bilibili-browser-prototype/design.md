## Context
空应用仓库，无 CodeGraph 索引。用户选定 CloakBrowser；本轮先实现浏览器读取原型。

## Goals / Non-Goals
Goals: 用户扫码登录；重启复用；读取本人创建的视频收藏夹并完整分页；错误不覆盖已有结果。
Non-Goals: 远程 MCP、后台监测、字幕转写、多平台和服务器发布。

## Decisions
使用 Node.js ESM 和原生测试。专用 .local/bilibili-profile 由单进程使用，浏览器自身处理目录锁。页面 fetch 发送请求以沿用浏览器网络环境。同步先在内存完成，随后临时文件加 rename 保存结果；错误保持旧文件。不输出认证 Cookie 或完整平台错误报文。配置目录限制本机用户权限。

## Risks / Trade-offs
浏览器下载可能失败；无授权密钥时用项目提供的默认免费版本。网站接口为非官方读取接口，登录寿命、服务器 IP 接受度需要实测。同步期间收藏可变化；计数/重复异常应报错并重试，而不是宣称完整。无私有收藏的账号不能验证私有读取。

## 实测修正
resource/list 在正常网页及原型中均 HTTP 412。resource/ids 的 pn 翻页实测每页 1000 个成员，resource/infos 可批量读取；20 个成员可能仅返回19条详情。改用成员 ID 完整分页核对 folder.media_count，分批补详情；缺详情保留 ID 并标记 metadataStatus=missing，不能猜测删除。调用之间间隔1秒，避免连续高频请求。结束再次核对收藏夹计数。认证和未知错误仍失败且保留旧结果。
