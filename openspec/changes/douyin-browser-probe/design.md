## Context
现有Bilibili服务固定SQLite账号/文件夹作用域。抖音需要独立浏览器，收藏范围待用户确认。
## Goals / Non-Goals
先打开专用网页登录与保存配置，证明重启登录态存在。不声称收藏同步完成，不逆向签名，不修改六工具和现有数据。
## Decisions
使用已安装CloakBrowser和独立.local/douyin-profile。login用户手动扫码，检查sessionid/sessionid_ss是否存在，不输出值；Cookie存在只是会话保存证据，不能证明账号接口授权。status无窗口检查同样标记。浏览器所有启动失败输出安全摘要，不输出Cookie或请求URL。
## Risks / Trade-offs
平台可能需要验证或拒绝会话；需用户完成验证。收藏、分页、字幕和音轨仍需账号实测。后续多平台实现要替换当前scope单平台约束，并保留已有Bilibili条目ID与历史结果。
