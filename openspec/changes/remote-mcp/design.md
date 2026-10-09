## Context
CloakBrowser 指定收藏夹已实测成功。成员 IDs+infos 可用，resource/list 返回412。唤醒由外部系统负责。
## Goals / Non-Goals
Goals: 六个 MCP 工具；持久事件游标；同步不重复产生新增；结果重启可查；认证拒绝未授权访问；元数据与字幕证据明确。
Non-Goals: 唤醒、后台执行项目、模型、完整视觉理解、多用户 OAuth。
## Decisions
单用户静态 Bearer 凭证，适配支持自定义 Authorization 头的客户端；不冒充 OAuth 服务。默认监听127.0.0.1，服务器通过 HTTPS 反向代理；拒绝不在配置中的 Host/Origin。SQLite 事务与唯一主键表达账号+收藏夹+资源成员；新增事件自增游标，消费者各自保存，不全局消耗。首次成功同步将已有收藏报告为新增，客户端可选择直接记住当前游标跳过历史。移除只更新 present=false，重新收藏生成新事件但保留结果。同步失败不改旧数据；账号/收藏夹更换报错。状态由外部 Agent 写回，不宣称具有独占执行权。
浏览器同步/状态/字幕请求使用同一串行队列，按需启动关闭。字幕只访问平台返回的 HTTPS hdslb.com 域名；不提供任意 URL 下载或服务器文件路径读取。字幕请求失败返回 partial 证据，不将标题当完整视频内容。
## Risks / Trade-offs
轮询由调用方触发，不是真实时推送；普通测试不能证明服务器网络长期可用。暂无 OAuth 自动发现；静态凭证只适用于支持请求头的客户端。字幕未覆盖画面，Agent 要尊重返回的内容范围。CLI 和 MCP 不能同时占用同一浏览器目录。

## 无字幕转写扩展
用户明确要求无字幕时音频转写。使用本地 ffmpeg + Whisper base（可设置模型），音频临时目录在任务完成或失败后删除；转写文本持久化到SQLite。长任务异步返回 transcription_pending，后续 get_content 读取结果，不实现唤醒。转写失败明确返回 transcription_failed，重启可重试。默认无云API和音频上传。
