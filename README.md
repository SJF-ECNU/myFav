# myFav

把你在 **Bilibili、抖音、小红书** 指定收藏夹里的内容接入 Agent 的 MCP 服务。使用专用 CloakBrowser 保存网页登录态；同步后提前缓存正文、字幕，无字幕时在本地进行音频转写。

## 功能与范围

- 三平台分别配置收藏夹，默认只读取 `myFav`（小红书为同名专辑）。
- SQLite 保存收藏、增量事件、内容、处理状态和 Agent 结果。
- 优先平台字幕；没有字幕时使用 FFmpeg + Whisper CPU 转写。
- 统一六个 MCP 工具，Streamable HTTP + Bearer Token 认证。
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

打开 **http://127.0.0.1:6080/vnc.html**，点击 Connect，完成平台登录。登录命令确认成功后自动退出并关闭窗口服务；需要时按 Ctrl+C 取消。每个平台需各登录一次，窗口最长等待约十分钟。部署在本机时直接打开该地址，无需 SSH。

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

具体配置字段以所用 Agent 客户端为准。访问远程服务器可再建 `ssh -N -L 8787:127.0.0.1:8787 user@your-server` 隧道。通过 HTTPS 反向代理公开服务时，为实际域名配置 `MYFAV_ALLOWED_HOSTS`；浏览器客户端还需配置准确的 `MYFAV_ALLOWED_ORIGINS`。默认端口仅绑定主机回环，不提供 OAuth 自动发现。

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

三平台的登录、状态检查与同步共用后端配置。默认 `MYFAV_BROWSER=cloakbrowser`；不再要求所有环境启动自带浏览器。

**启动指定内核**：在 `.env` 配置以下变量。路径指向 Chrome、Chromium 或 Edge 可执行文件；浏览器版本仍需实测。仍使用 `.local/<平台>-profile` 专用持久目录，不读取你日常浏览器的配置。

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
| `MYFAV_TOKEN` | 必填，至少 32 字符随机值 |
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

浏览器兼容变更已通过 23 项自动测试，以及真实 Google Chrome 和 Docker 中的指定路径/CDP 集成测试；验证持久 Cookie、共享登录态与原有页面保留。尚未验证具体云浏览器服务的 CDP 接口。

2026-10-09：[Linux x86_64 容器验证通过](https://github.com/SJF-ECNU/myFav/actions/runs/37908134702)，包括无屏幕浏览器、远程登录窗口入口及 CPU 转写。本机 Linux ARM64 容器也已通过 19 项测试、浏览器、noVNC WebSocket 连接、HTTP MCP 和 Whisper base CPU 转写验证。真实服务器扫码和长期使用尚待验证。

`npm test` 覆盖平台隔离、分页、迁移、文本缓存及真实 MCP 协议。GitHub Actions 另外构建镜像，检查无窗口/虚拟屏幕浏览器、临时 noVNC/VNC 入口和公开样例音频 CPU 转写。自动化不使用任何用户登录态，不能代替各平台真实账号或长期服务器运行验证。

## 许可与致谢

myFav 自有代码使用 [MIT License](LICENSE)。感谢 CloakBrowser、MCP SDK、Playwright、OpenAI Whisper、FFmpeg、noVNC 及相关平台研究项目；依赖保留各自许可，完整来源与许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
