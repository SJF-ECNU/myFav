# Bilibili 收藏读取可行性调研

调研时间：2026-10-09T14:42:09+08:00。范围：公开资料与实现参考；未登录用户账号、未调用其私有收藏接口、未部署服务器。结论：有明确实现路径，值得进入小规模实测，尚未证明长期稳定。

## 已确认的方向

用户确认采用专用持久化浏览器，服务未来部署服务器，客户端凭证访问远程 MCP；优先从 Bilibili 开始。网页登录态与 MCP 访问凭证是两套认证。

## 实现依据

1. [Playwright 持久化上下文](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)：专用 userDataDir 持久化浏览器状态；同一目录不能同时由多个浏览器实例使用。需实测关闭后重开能否保留 Bilibili 登录。
2. [共享 Cookie 的请求客户端](https://playwright.dev/docs/api/class-apirequestcontext)：context.request 与浏览器共享 Cookie。可先网页登录，再通过该客户端读网页接口；这不会模拟完整浏览器网络指纹，若接口拒绝仍需调查具体响应。
3. [登录状态接口社区文档](https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/login/login_info.md)：/x/web-interface/nav 可判断 isLogin 和用户 mid。
4. [收藏内容社区文档](https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/fav/list.md)：/x/v3/fav/resource/list，参数 media_id、pn、ps、order；文档记载每页 1–20 条，返回 has_more、标题、简介、作者、BV 号、收藏时间等；私有收藏需要本人登录。/x/v3/fav/resource/ids 可作为周期性成员核对的候选，不保证当前实测可用。
5. [已有 Bilibili MCP](https://github.com/Zijian-Ni/bilibili-mcp-server)：项目提供 favorite_list 和 favorite_items。它采用 Cookie 配置，证明存在同类工具设计参考，不能证明本项目已运行。当前未完整审计其代码或许可证。
6. [Playwright Docker 文档](https://playwright.dev/docs/docker)：服务器运行有官方工具支持；不证明 Bilibili 接受目标服务器 IP。

Bilibili 接口文档来自社区维护，不是官方 OAuth 收藏授权或稳定性保证。收藏夹发现接口需在真实网页请求中确认，候选 /x/v3/fav/folder/created/list-all。此次没有复核文章、动态、课程或订阅收藏夹的独立链路，首个验证范围仅为本人创建的视频收藏夹。

## 最小方案建议，尚未实施

一个浏览器管理进程独占专用配置目录。用户在该浏览器登录，读取收藏夹与分页内容，将结果保存数据库；MCP 查询已有结果并触发同步。服务器使用持久卷保存浏览器目录与数据库，登录交互入口和 MCP 均受认证保护，不公开浏览器调试端口。远程 MCP 传输与认证细节后续单独核验。

新增收藏按收藏时间扫描，用平台资源 ID 和收藏夹 ID 表达成员关系；相同视频可在多个收藏夹。定期完整核对才能发现取消、移动与文件夹变化。同步失败、权限不足、页数不完整不等于取消收藏，保留旧数据并记录同步状态。频率依据真实响应设定，不假定固定频率安全。

## 实测验收

1. 专用浏览器网页登录，nav 确认当前账号；不输出 Cookie。
2. 读取本人收藏夹，至少核对一个私有收藏夹（账号存在时）。
3. 多页收藏夹完成遍历，与网页数量/条目核对；空夹、失效条目分别处理。
4. 关闭浏览器与服务后，用同一目录重开，再读收藏。
5. 用用户正常收藏行为产生新条目，下一次同步识别新增；重复同步不重复插入。
6. 会话失效时明确请求重新登录，不能把错误返回当成空收藏。
7. 实际服务器网络单独验证登录、重启、收藏读取和远程 MCP 认证。

## 未知与边界

未测登录寿命、服务器地域/IP、频率限制、验证码、现有账号规模、长期无人值守稳定性。收藏元数据不等于视频全文；字幕及视频转写不属于此次已确认能力。不新增刷新 Cookie、指纹伪装或验证码绕过逻辑。

下一步：使用 OpenSpec 规划一个只验证登录持久化与视频收藏分页的最小原型，再实测。
