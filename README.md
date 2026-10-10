# myFav

把你在 **Bilibili、抖音、小红书** 指定收藏夹里的内容接入 Agent 的 MCP 服务。使用专用 CloakBrowser 保存网页登录态；同步后提前缓存正文、字幕，无字幕时在本地进行音频转写。

## 功能与范围

- 三平台分别配置收藏夹，默认只读取 `myFav`（小红书为同名专辑）。
- SQLite 保存收藏、增量事件、内容、处理状态和 Agent 结果。
- 优先平台字幕；没有字幕时使用 FFmpeg + Whisper CPU 转写。
- 统一六个 MCP 工具，Streamable HTTP + 独立 Agent Token / OAuth 2.1 鉴权。
- Docker 持久化部署，无屏幕服务器通过临时 noVNC 浏览器扫码登录。

Agent 负责定时调用同步、判断内容、执行项目和写回结果。本服务不负责唤醒或执行项目。文本提取不包含图片、视频画面的理解。网站接口和登录态可能变化；首次转写需要时间，不能保证收藏后立即完成。

## Docker 部署

需要 Docker Engine 与 Compose。镜像包含浏览器、CPU 推理和远程登录组件，首次构建与模型下载较大。

```sh
git clone https://github.com/SJF-ECNU/myFav.git
cd myFav
cp .env.example .env
# 生成随机凭证，将输出填入 .env 的 MYFAV_TOKEN
openssl rand -hex 32
chmod 600 .env
docker compose build
```

### 无屏幕服务器扫码登录

Agent 可在服务器执行下面的命令启动登录窗口。服务器用 Xvfb 创建虚拟屏幕，不需要物理显示器；你在自己电脑的浏览器里看到页面并用手机扫码确认。

```sh
# 在服务器执行；避免同时使用同一浏览器配置
docker compose stop myfav
docker compose run --rm --service-ports login login bilibili
# 其他平台分别执行：
# docker compose run --rm --service-ports login login douyin
# docker compose run --rm --service-ports login login xiaohongshu
```

在自己的电脑另开终端建立隧道：

```sh
ssh -N -L 6080:127.0.0.1:6080 user@your-server
```

打开 **[http://127.0.0.1:6080/vnc.html](http://127.0.0.1:6080/vnc.html)**，点击 Connect，完成平台登录。登录命令确认成功后自动退出并关闭窗口服务；需要时按 Ctrl+C 取消。每个平台需各登录一次，窗口最长等待约十分钟。部署在本机时直接打开该地址，无需 SSH。

登录窗口可操作你的浏览器，因此只允许本机/SSH 隧道访问；不要公开 6080 端口。扫码必须由你在手机上确认，Agent 可以启动流程和检查登录状态。

```sh
docker compose up -d myfav
docker compose logs -f myfav
# 检查登录（会启动对应平台浏览器；不要和同步同时运行）
# docker compose stop myfav
# docker compose run --rm myfav npm run status
# docker compose run --rm myfav npm run douyin:status
# docker compose run --rm myfav npm run xiaohongshu:status
```

`data` 卷保存三平台登录配置、SQLite 和缓存文本，`whisper-cache` 卷保存模型。重建容器时保留这些卷；`docker compose down -v` 会删除它们。首次遇到无字幕视频时下载 Whisper 模型，后续复用。跨操作系统部署建议在服务器重新扫码。

### 连接 MCP

地址：`http://127.0.0.1:8787/mcp`，请求头：`Authorization: Bearer <你的 MYFAV_TOKEN>`。客户端需支持 Streamable HTTP 和自定义请求头。

```json
{
  "mcpServers": {
    "myfav": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer <MYFAV_TOKEN>" }
    }
  }
}
```

具体配置字段以所用 Agent 客户端为准。访问远程服务器可再建 `ssh -N -L 8787:127.0.0.1:8787 user@your-server` 隧道。通过 HTTPS 反向代理公开服务时，为实际域名配置 `MYFAV_ALLOWED_HOSTS`；浏览器客户端还需配置准确的 `MYFAV_ALLOWED_ORIGINS`。默认端口仅绑定主机回环。OAuth 2.1 配置与 Keycloak 示例见 [OAuth 接入手册](docs/oauth/README.md)。

### 每个 Agent 独立凭据与权限

推荐为每个 Agent 单独创建凭据，不再共享 `MYFAV_TOKEN`：

```sh
npm run agents -- create reader read
npm run agents -- create worker read,prepare,write
npm run agents -- list
npm run agents -- scopes worker read,prepare
npm run agents -- rotate worker
npm run agents -- revoke reader
npm run agents -- audit 100
# Docker 中使用 docker compose exec myfav npm run agents -- <命令>
```

创建/轮换只输出凭据文件路径：`.local/credentials/<id>.token`，文件权限为 `0600`，不把值写到日志。将该文件的值配置为对应 Agent 的 Bearer Token。注册第一个 Agent 后旧 `MYFAV_TOKEN` 永久停止接受；启用 OAuth 时也停止接受旧共享 Token。API Token 和已绑定的 OAuth Agent 可同时使用。

| 权限 | 工具与行为 |
| --- | --- |
| `read` | `list_updates`、`get_result`、`get_content`；内容只读取缓存，不启动浏览器、预取或转写 |
| `prepare` | `sync_favorites`；同时拥有 `read` 时，`get_content` 可获取和准备内容 |
| `write` | `set_processing_status`、`save_result` |

权限按请求生效；撤销/轮换后下一次请求拒绝旧凭据，已经执行的工作继续完成。准备任务全服务同时只允许一个批次，包括它启动的后台预取与转写；忙时同步返回可重试错误，缓存读取仍可使用。限流按独立 Agent ID 计算，超限 HTTP 429 带 `Retry-After`，计数保存在单进程内存中，重启会重置。

审计仅保留最近 10,000 条时间、Agent 别名、已知方法/工具、结果及 HTTP 状态，不保存请求参数、收藏正文、结果正文或凭据。API 凭据在服务器 SQLite 中以原值保存，数据库文件权限 `0600`；备份和数据卷也需要保持私有。公开部署需要 HTTPS、精确 Host/Origin 配置和代理层匿名请求限流。

### OAuth 2.1

支持 MCP 资源发现、签名/issuer/audience/过期时间校验、工具 scope 和本地客户端＋用户绑定。授权码、强制 PKCE S256、登录和刷新由外部授权服务负责；[通用接入及 Keycloak 部署示例](docs/oauth/README.md)提供具体配置。服务未配置公开域名和授权服务时，不能直接使用 OAuth 登录。

| 工具 | 用途 |
| --- | --- |
| `sync_favorites` | `platform` 为 `bilibili`（默认）、`douyin`、`xiaohongshu` 或 `all`；同步并启动内容预取 |
| `list_updates` | 按 `after` 游标分页获取事件，支持平台筛选；每个 Agent 自行保存消费游标 |
| `get_content` | 根据 `itemId` 读取正文/字幕/转写；pending 时稍后再读 |
| `set_processing_status` | 写回 pending / processing / completed / failed |
| `save_result` | 保存分析摘要与产物 URL |
| `get_result` | 读取处理状态和结果 |

典型流程：`sync_favorites({platform:"all"})` → `list_updates({after:0})` → `get_content({itemId})` → Agent 自行分析或尝试项目 → 写回状态和结果。首次同步已有收藏也产生事件；同步频率由 Agent 的定时任务决定。

## 使用其他 Chromium 浏览器

三平台的登录、状态检查与同步共用后端配置；修改 `.env` 后重启 MCP 服务，Docker 部署还需更新镜像后重建服务容器。默认 `MYFAV_BROWSER=cloakbrowser`；不再要求所有环境启动自带浏览器。

**启动指定内核**：在 `.env` 配置以下变量。路径指向 Chrome、Chromium 或 Edge 可执行文件；浏览器版本仍需实测。仍使用 `.local/<平台>-profile` 专用持久目录，不读取你日常浏览器的配置；切换内核可能需要重新登录。

```dotenv
MYFAV_BROWSER=chromium
MYFAV_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
```

**连接已有浏览器**：云浏览器提供 CDP 地址时配置：

```dotenv
MYFAV_BROWSER=cdp
MYFAV_CDP_URL=http://127.0.0.1:9222
```

服务直接连接已有默认浏览器上下文，复用其中登录态；每次创建自己的工作标签页，结束后关闭工作页并断开连接，保留原有标签页和浏览器。登录命令仍为 `npm run login`、`npm run douyin:login`、`npm run xiaohongshu:login`，你在外部浏览器窗口扫码。CDP 模式的 Docker 登录命令不会启动本地 noVNC；外部浏览器的持久化和显示由其提供方负责。

端点必须从 myFav 运行环境可达：容器内 `127.0.0.1` 指容器自身。CDP 能控制浏览器，应通过可信私网或隧道访问，不直接开放公网；包含访问参数的 URL 属于凭证，保存在被忽略的 `.env`，不要放进 Agent 提示或 Git。没有 CDP、仅提供点击/读页面工具的受管浏览器暂不能直接接入。

使用自带浏览器可切回 `MYFAV_BROWSER=cloakbrowser`。配置缺失或启动失败会报错，不会静默更换浏览器或账号。

## 配置

| 变量 | 默认 / 说明 |
| --- | --- |
| `MYFAV_BROWSER` | `cloakbrowser` / `chromium` / `cdp` |
| `MYFAV_BROWSER_EXECUTABLE_PATH` | chromium 模式的浏览器路径 |
| `MYFAV_CDP_URL` | cdp 模式的外部浏览器端点 |
| `MYFAV_TOKEN` | 兼容旧配置；未注册 Agent 且未启用 OAuth 时使用，至少 32 字符 |
| `MYFAV_RATE_LIMIT_PER_MINUTE` | 每 Agent 每分钟 HTTP 请求上限，默认 `60` |
| `MYFAV_OAUTH_ISSUER` / `MYFAV_OAUTH_RESOURCE` | 授权服务 issuer 与公开 MCP HTTPS 地址；一起配置启用 OAuth |
| `MYFAV_OAUTH_INTROSPECTION_URL` | 可选；不透明令牌的 introspection 地址，留空使用 JWT/JWKS |
| `MYFAV_OAUTH_CLIENT_ID` / `MYFAV_OAUTH_CLIENT_SECRET` | introspection 的服务端机密凭据 |
| `MYFAV_FOLDER` | Bilibili 收藏夹，`myFav` |
| `MYFAV_DOUYIN_FOLDER` | 抖音收藏夹，`myFav` |
| `MYFAV_XIAOHONGSHU_FOLDER` | 小红书专辑，`myFav` |
| `MYFAV_WHISPER_MODEL` | `base`；更大模型需要更多 CPU、内存及缓存空间 |
| `MYFAV_ALLOWED_HOSTS` | 精确允许的 Host（包含端口时须一致） |
| `MYFAV_ALLOWED_ORIGINS` | 逗号分隔的浏览器 Origin；默认不接受带 Origin 的请求 |
| `MYFAV_HOST` / `MYFAV_PORT` | 本地启动默认 `127.0.0.1:8787`；Compose 内部监听 `0.0.0.0:8787` |

登录态、访问参数和收藏正文属于私人数据；`.env`、`.local/` 及私人项目记录不会进入仓库或镜像构建上下文。备份数据卷时同样保护这些内容。外部收藏文本是分析材料，不应视作执行指令。

## 本地开发

需要 Node.js 24+、Python、FFmpeg 和 Whisper：

```sh
npm ci
python3 -m venv .local/venv
.local/venv/bin/pip install -r requirements.txt
# 将 .local/venv/bin 加入 PATH；另行安装 ffmpeg
npm run login
npm run douyin:login
npm run xiaohongshu:login
npm test
npm start
```

复制并填写 `.env.example` 后启动。CloakBrowser 首次运行会下载对应系统的浏览器。架构见 [docs/architecture.md](docs/architecture.md)，平台调研见 [docs/research](docs/research)，变更规划见 [openspec/changes](openspec/changes)。

## 验证

28 项自动测试已通过；鉴权测试验证独立凭据、权限交集、撤销与轮换、限流、准备批次限制、无敏感正文审计，以及 OAuth 的发现和无效令牌拒绝。`scripts/oauth-smoke.js` 已用真实 Keycloak 验证授权码、PKCE S256、刷新轮换及无效授权拒绝；具体 Agent 平台及公网部署需分别验证。

浏览器兼容变更已通过 23 项自动测试，以及真实 Google Chrome 和 Docker 中的指定路径/CDP 集成测试；验证持久 Cookie、共享登录态与原有页面保留。[Linux x86_64 容器 CI 也已通过](https://github.com/SJF-ECNU/myFav/actions/runs/37918351557)。尚未验证具体云浏览器服务的 CDP 接口。

2026-10-09：[Linux x86_64 容器验证通过](https://github.com/SJF-ECNU/myFav/actions/runs/37908134702)，包括无屏幕浏览器、远程登录窗口入口及 CPU 转写。本机 Linux ARM64 容器也已通过 19 项测试、浏览器、noVNC WebSocket 连接、HTTP MCP 和 Whisper base CPU 转写验证。真实服务器扫码和长期使用尚待验证。

`npm test` 覆盖平台隔离、分页、迁移、文本缓存及真实 MCP 协议。GitHub Actions 另外构建镜像，检查无窗口/虚拟屏幕浏览器、临时 noVNC/VNC 入口和公开样例音频 CPU 转写。自动化不使用任何用户登录态，不能代替各平台真实账号或长期服务器运行验证。

## 许可与致谢

myFav 自有代码使用 [MIT License](LICENSE)。感谢 CloakBrowser、MCP SDK、Playwright、OpenAI Whisper、FFmpeg、noVNC 及相关平台研究项目；依赖保留各自许可，完整来源与许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 获取图片

`get_content(itemId)` 返回 `images` 列表（从0开始的 index、kind=image/cover、cached）。调用 `get_image(itemId,index)` 获取 MCP 原生 image 内容块，包含 mimeType 与 base64 图片。支持小红书图文、抖音图集和 Bilibili/抖音/小红书视频封面；不做 OCR 或图片分析。

图片以 SQLite 持久缓存，仍受现有 Agent read 权限保护。read 身份只能获取已经缓存的图片；prepare 身份可提取图片来源、下载并缓存，下载失败会刷新一次来源以处理签名过期。单图最大10MiB，支持 JPEG/PNG/WebP/GIF，禁止任意URL和重定向。首次获取需要平台登录态；旧缓存文本无需清空。get_content 的 includesVisuals 仍表示服务没有进行视觉分析，图片内容由调用方自行理解。ChatGPT 旧连接器可能需要刷新工具列表以发现新增 get_image。

### 平台暂停与退收藏清理

CloakBrowser 保留。明确 HTTP 401/403/412、登录失效或已识别的验证/风控信号会暂停对应平台，重启服务不自动恢复；429 按 Retry-After 冷却，至少15分钟。暂停期间缓存仍可读，平台浏览器和媒体请求被阻止。正常网络故障仍使用现有重试流程。媒体403也会暂停，不能自动把它认定为签名过期继续请求。

确认正常登录、完成平台要求的验证并检查拒绝原因后，在服务工作目录运行：

```sh
npm run platforms -- status douyin
npm run platforms -- resume douyin
```

平台可换为 `bilibili` / `xiaohongshu`。恢复仅清除本地暂停状态，不绕过平台验证；仍被拒绝会再次暂停。工具会返回暂停或冷却原因。

成功同步发现退收藏时，记录移除时间并停止读取/准备，正文、字幕/转写、图片及媒体来源保留7天。期内重新收藏直接恢复完整缓存；重复同步不会延长保留期。启动、成功同步和每小时本地清理会删除过期缓存（持续运行时最长约延后1小时）。旧版本已移除条目从首次升级启动开始计算7天。保留必要条目元数据、历史事件、Agent状态和结果。清理是SQLite逻辑删除，不是磁盘安全擦除，也不会删除外部Agent已保存的副本。同步失败不会清理原数据；超过7天未重新收藏的内容会清理采集缓存，当前收藏仍保留缓存。

队列执行前、平台读取前和缓存落库前核对最近成功同步的收藏范围；利用已有事件游标识别退收藏后重新收藏，拒绝旧任务落库。平台操作按登录UID/已绑定的自有收藏夹复核身份。尚未同步的退收藏不能即时发现；正在运行的ffmpeg不会强杀，结果在范围变化后丢弃。没有新增平台轮询调度。

暂停提示包含触发时间（UTC）、请求阶段、实际 HTTP 状态（本地会话/身份检查为未知）及固定信号分类。`npm run platforms -- status douyin` 的 `recentTriggers` 显示最近触发，手动恢复不删除历史；全平台最多保留300条。旧暂停没有补造历史。诊断不保存 URL、查询参数、响应正文或凭据。
