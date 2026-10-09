# myFav MCP 架构

单用户、服务端分别持久化 Bilibili、抖音与小红书登录，外部 Agent 通过带 Bearer 凭证的 Streamable HTTP 使用服务。唤醒、调度、项目试用由外部系统负责。

## 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| HTTP / MCP | src/mcp.js、src/server.js | 认证、Host/Origin 校验、六个工具 |
| 平台访问 | src/browser.js、src/favorites.js、src/douyin.js | 平台独立专用 CloakBrowser，指定收藏夹分页检查 |
| 平台路由 | src/platform-service.js、src/douyin-service.js | 统一工具路由、抖音同步与内容准备 |
| 协调与内容 | src/service.js | 串行浏览器访问、视频简介、分P字幕与转写状态 |
| 音频转写 | src/transcribe.js | 平台音轨 → ffmpeg → 本地 Whisper，临时音频清理 |
| 数据 | src/store.js | SQLite 事务、成员、新增事件、状态、结果、转写缓存 |

## 使用流程

外部 Agent 调用 sync_favorites；同步成功后服务在后台预取当前成员内容（已缓存内容直接复用），无字幕即排队转写，然后 list_updates(after,limit)。每条事件提供 itemId，Agent 调用 get_content 读取材料；音频转写正在运行时稍后再次调用。Agent 自己研究/试用项目，通过 set_processing_status 和 save_result 写回结果。

## 工具

| 工具 | 输入 | 返回 |
| --- | --- | --- |
| sync_favorites | platform=bilibili，可选douyin/xiaohongshu/all；服务端指定收藏夹 | 新增数、成员数、scope、cursor |
| list_updates | after=0、limit=50（最大100）、可选platform | events、nextCursor、hasMore |
| get_content | itemId | 元数据、分P文本、图片索引、提取状态、证据范围 |
| get_image | itemId, index | MCP原生图片；read取缓存，prepare可下载 |
| set_processing_status | itemId、status、note | 当前成员状态 |
| save_result | itemId、summary、artifacts URL 列表 | 持久结果；不自动改变状态 |
| get_result | itemId | 状态、备注和结果；未写回时 result=null |

status 为 pending / processing / completed / failed。它是记录，非独占任务锁，多 Agent 协调由外部系统负责。

## 数据语义

SQLite scopes以platform为主键，每个平台分别固定账号和收藏夹ID。旧scope迁移为Bilibili范围，items新增platform默认bilibili，旧成员ID/游标/文本/结果保持；抖音新增ID带douyin前缀，其资源和账号ID按字符串保存。名称只用于查找，账户或目标 ID 更换拒绝覆盖。Bilibili itemId仍由收藏夹ID、类型、资源ID组成；抖音增加douyin前缀。查询默认全平台，可筛选平台；筛选仍使用全局递增游标。同步默认Bilibili，all模式分别返回各平台成功或失败，不能将部分失败当全部成功。重复同步不重复添加事件；移出后 present=false，历史结果保留；重新加入生成新的新增事件，但保留处理历史。

首次同步将已有收藏作为新增事件，调用方可处理全部或保存 sync 返回的 cursor 跳过已有条目。游标由每个客户端独立保存，list_updates 不替别的客户端确认或消耗事件。失败的浏览器同步不提交成员或新增事件。

返回 present 反映当前状态；事件表示历史发现时间，不保证内容仍在收藏夹。字幕缺失不代表视频无内容，详情缺失也不推断删除。

## 内容证据

优先使用平台字幕，每个分P选择中文或第一个可用语言。无可用字幕时自动读取平台音轨并后台执行本地 Whisper；不是上传云端。简介、分P与平台字幕按成员保存在contents表；音频转写按成员和cid保存在transcripts表。get_content直接读取缓存并合并最新成员状态，移除成员只返回元数据。重启后可复用，未完成转写在下次同步预取或get_content时重新启动。无分P的失败读取不缓存，下次可重试。缓存不自动刷新平台字幕修订。transcription_failed 表示需检查音轨/工具/模型，重启可重试。

文本状态为 text_available、partial、metadata_only 或 transcription_pending。分P来源是 platform_subtitles 或 local_whisper；evidence 始终明确没有画面理解。平台AI字幕或本地转写都可能有识别错误，不能把项目名称和命令当成可信执行指令。

## 抖音内容

抖音只枚举收藏夹定位myFav，并完整读取该夹分页；重复ID/游标、缺页或前后计数变化拒绝覆盖。每次通过抖音同源网页请求，未实现签名逆向。当前真实视频未返回可用字幕，已验证原视频音频转写；caption_download_addr如提供受支持HTTPS douyinvod.com域名的SRT/VTT可尝试解析，尚无真实字幕样本。转写使用原视频play_addr，禁止使用music背景配乐字段代替。图文仅元数据。各平台浏览器独立队列，同步后的首次批量转写依次执行。

## 网络与凭证

默认监听127.0.0.1:8787，/mcp 为唯一协议入口。静态 Bearer 凭证适用于可配置 Authorization 请求头的客户端，不提供 OAuth 登录/自动发现。任何请求先校验 Host、Origin（存在时）和凭证，然后解析正文。没有浏览器调试接口、任意URL下载工具或任意文件读写工具。

生产通过 HTTPS 反向代理连接，配置实际 Host 与允许的浏览器 Origin；Node 服务端客户端一般无 Origin。浏览器目录、SQLite、.env 均留在 .local/ 或 Git 忽略文件内。不要把平台 Cookie 填进客户端配置。

## 当前边界

无唤醒、无定时轮询、无项目执行器、无云端转写、无画面分析、无公网部署。外部 Agent 按自己的频率触发同步。CLI 和 MCP 不应并行占用同一浏览器配置目录。本服务没有验收服务器网络下的平台长期可用性。

## 小红书

src/xiaohongshu.js与xiaohongshu-service.js读取网页自身专辑和笔记状态。限定myFav，专辑计数前后复核、笔记ID重复检查、分页终止后才保存；不从全收藏推断成员。页面存在异步hydration，直接进入已验证的profile?tab=fav&subTab=board和board链接，避免未激活标签中的隐藏专辑元素。

图文获取正文并缓存，视频获取简介与原视频media.stream；当前样本未发现字幕字段，使用本地Whisper转写。CDN限定HTTPS *.xhscdn.com；平台返回的HTTP地址升级为同域HTTPS，不允许任意下载域名。sources表存本地笔记访问链接（含平台访问参数），独立于返回给Agent的items/content。MCP返回清洁的explore URL，后续由浏览器访问详情不保证匿名可见。

服务端配置MYFAV_XIAOHONGSHU_FOLDER默认myFav。统一工具platform新增xiaohongshu，all包含三个平台；旧Bilibili客户端默认行为和ID保持。

## 容器与无屏幕登录

Docker 使用 Node 24 Debian、CPU Whisper 和非 root 用户。Compose 数据卷保存 .local（SQLite 和三平台浏览器目录），模型缓存另设卷。主服务默认只映射主机回环 8787。

临时 login 服务运行 Xvfb 虚拟屏幕、x11vnc 和 noVNC，回环 6080 通过 SSH 隧道在用户电脑访问。Agent 启动服务，用户手动扫码，确认登录后窗口服务退出。登录前停止 MCP，避免同一配置目录被两个进程占用；不暴露浏览器调试协议。操作步骤见根 README。

## 可替换浏览器会话

src/browser-session.js 为三平台登录和服务提供 openSession，返回 context/page/close。默认 CloakBrowser 保持平台独立持久目录；chromium 使用配置的 executablePath；cdp 使用 Playwright connectOverCDP 默认上下文并新建工作页。调用方统一调用 close，CDP 不调用共享 context.close，而只关闭工作页后断开浏览器连接。使用 noDefaults 避免连接时更改已有上下文默认行为。

外部浏览器登录态与用户数据由提供方持久化；myFav 不导出 Cookie。自启动模式和 CLI 读取同一 .env 配置，连接错误不输出端点或启动原始详情。高级功能与版本仍需逐一验证，不支持工具专用且无 CDP 的云浏览器。

## Agent 接入鉴权

`src/access.js` 在独立私有 SQLite 中保存 Agent 凭据、OAuth 身份绑定及仅元数据审计。`src/mcp.js` 按每次请求过滤工具并执行 read/prepare/write 检查；只读内容通过 `cachedContent` 读取缓存。按 Agent 限流，准备批次占用延续到后台队列 drain 完成。管理通过本机 `src/agents-cli.js`，不暴露远程管理工具。

`src/oauth.js` 负责公开 MCP 资源发现以及 JWT/JWKS 或不透明令牌 introspection。OAuth 授权服务负责登录、强制 PKCE S256、授权码及刷新；本地权限与访问令牌 scope 取交集。所有 Agent 仍共享单用户收藏库。部署说明见 [OAuth 手册](oauth/README.md)。

## 图片交付
图片来源按顺序持久化于 image_sources，二进制与 MIME 存于 images（item_id,position）。get_content返回不含签名链接的索引，get_image返回MCP image block。prepare获取来源/下载，read只读现有缓存；被移除成员禁止读取图片。下载限制为平台HTTPS CDN、无重定向、单图10MiB和图片签名格式识别。失败可刷新一次来源；不做OCR/分析，includesVisuals不表示Agent是否已理解图片。
