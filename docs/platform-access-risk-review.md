# myFav 平台采集边界审查（2026-10-10）

## 结论与范围
检查本地 main 7d6a740 的 src、已安装 CloakBrowser 依赖，并以 SSH 检查生产容器的浏览器模式和对应依赖/下载实现。没有登录平台、没有新增抓取，没有修改应用代码、部署或账号权限。未审计 Chromium 二进制、完整生产历史流量或所有平台服务条款。

确认存在隐藏自动化特征与指纹伪装的实现：生产采用 cloakbrowser，依赖删除 --enable-automation 默认参数，并加入随机 --fingerprint 和 Linux 伪装 Windows 的平台参数。这是规避机器人识别的技术风险点；不能仅凭这一点认定已突破某个平台访问控制或构成犯罪。

在检查范围内没有发现验证码破解、签名逆向生成、盗取其他用户 Cookie、账号池/IP池轮换、DRM 解密或篡改付费权限的实现。未发现 MCP 接受任意平台 URL/用户 ID 进行采集的入口。以上是源码检查结论，不是长期流量或法律定性证明。

## 风险与建议

### 1. CloakBrowser 隐藏自动化与伪装指纹：高优先级
证据：src/browser-session.js:10、42；依赖 dist/config.js:378、393 起的 getDefaultStealthArgs；dist/playwright.js 的 buildLaunchOptions。生产对应实现与本地一致。没有显式启用 humanize，也没有应用层住宅代理轮换配置；不要把依赖 README 的所有功能当作本项目已启用功能。
建议：使用项目已有 chromium 模式，指定未经 stealth 修改的标准 Chrome/Chromium；移除依赖后同步 Docker 镜像和文档。遇到平台拒绝不要回切 stealth 来绕过。可能降低现有平台可用性，不能保证功能不受影响。

### 2. 非开放平台网页接口与拒绝信号：高优先级
Bilibili browser.js:22 使用登录态请求站内 API；favorites.js:23、36 使用 resource/ids 和 resource/infos。抖音 douyin.js:16 使用登录态 fetch 网页接口，含 collects/list、collects/video/list、aweme/detail。小红书 xiaohongshu.js 从网页 __INITIAL_STATE__ 和网页自身网络响应读取，并滚动加载。
Bilibili 曾有 resource/list HTTP412 后改用 IDs+infos 的历史，当前代码没有自动遇到412切换路径。替代接口可返回数据不等于得到平台许可，也不足以证明越权；应进一步确定412是访问限制还是接口故障，不能把其他接口当作风控绕行策略。
建议：优先官方授权接口或用户主动导入；若仍保留网页采集，遇到明确访问拒绝、验证码、登录失效应停止该平台采集，记录原因并要求用户正常处理，不更换账号、指纹、IP或接口继续尝试。

### 3. 失败重试没有平台级冷却：高优先级
browser.js 每秒节流，douyin.js 同样每秒节流，但该状态每次创建API会重新开始，并非跨任务平台预算。没有发现平台级429/Retry-After、验证码与403/412分类、持久冷却或失败重试上限。douyinApi 将不同错误合并为当前不可用；字幕错误会退到音轨转写。service.js、douyin-service.js、xiaohongshu-service.js 允许失败任务在下一次 content/sync 重试；platform-service.js:33 对所有图片下载错误都刷新来源并再下载一次。
建议：区分限流（遵守Retry-After、退避）、权限/验证拒绝（停止，等待人工解决）、临时网络故障（有限重试）。平台级冷却应覆盖列表、详情、字幕、媒体与所有Agent；风控拒绝不能触发另一条下载路径。不要10秒轮询平台，10秒只用于本地任务队列。降低请求频率不是法律授权。

### 4. CDN 直连下载及请求头：中高优先级
transcribe.js:20 ffmpeg 使用 Mozilla/5.0 与平台Referer；images.js:12 直接下载平台CDN并设置Referer。签名URL取自当前网页/API，未发现自己生成签名或破解失效签名；过期时重新通过页面获取URL并非自动等于破解签名。但请求头可能帮助通过基于Referer的防盗链判断，需要区分兼容合法请求与绕过明确下载限制。
建议：先明确平台/创作者授权下载范围；不可仅凭CDN URL可访问就认为可下载。受限/删除/付费/验证内容不继续获取，403不重试或伪造其他身份头。优先官方允许下载或用户提供的文件。仅去掉请求头不能让非授权采集自动合规。

### 5. 收藏范围及任务时效：中优先级
现有保护：Store.item 只接受数据库已存在条目；Store.apply 绑定平台UID和folder_id；同步只选指定收藏夹。images读取要求present=true；各平台content在入口检查present。Bilibili/XHS检查登录身份变化，抖音通过收藏夹user_id_str对比历史UID。没有任意ID枚举入口。
缺口：账号核对主要发生在sync，详情/媒体读取没有逐次确认当前登录UID；排队转写持有旧item，任务执行前没有重新读取present；退收藏或换账号后可能继续已排队任务。抖音folder.owner字段不是独立的当前登录身份查询。
建议：平台访问前核对当前登录UID；转写/图片任务开始和落库前重新确认条目仍在当前收藏范围，取消已移除条目任务。重新确认应该复用会话信息，避免为每个小请求增加无谓平台负载。

### 6. 缓存保留与多Agent共享：中优先级
Store.apply仅标present=0，旧正文、图片、来源和结果不会自动删除；updates仍能返回移除条目的历史元数据。get_image已拒绝present=false，cachedContent对移除项不返回正文图片。所有注册Agent按read/prepare/write授权，共享同一收藏Store，没有按用户/收藏夹隔离。这对单人部署可符合设计，但不能直接当作多用户服务。
建议：明确保留期限和删除功能，按用户意图清除移除条目的正文/图片/签名来源；历史事件只留必要元数据。对外多用户部署必须隔离平台账号、浏览器profile、Store与授权主体。只向用户明确授权的Agent提供内容，禁止跨用户共享。

## 建议顺序
1. 正确识别拒绝信号，平台级暂停/退避，并取消范围外排队任务。
2. 标准浏览器替换CloakBrowser，验证正常访问；平台拒绝时停止，而不是加强伪装。
3. 官方接口/主动导入与媒体下载授权、缓存删除、对外多用户隔离。

## 法律证据边界
抖音当前用户协议（2026-02-20生效）限制未经授权的自动化采集/爬虫等行为；个人账号授权不等于平台或创作者授权。最高人民法院发布的相关案例解读强调保护措施、访问权限和软件用途等因素。本报告是技术风险检查，不作违法犯罪定性。
- https://www.douyin.com/agreements/?id=6773906068725565448
- https://www.court.gov.cn/zixun/xiangqing/459621.html

## 2026-10-10 本地后续实现
已在本地实现拒绝/冷却、排队范围复核、移除后保留7天及期内重加恢复，见README与openspec/changes/platform-access-boundaries/。55测试通过，尚未部署。用户明确保留CloakBrowser，本报告的替换建议未采纳；其技术风险描述保留，不作法律定性。
