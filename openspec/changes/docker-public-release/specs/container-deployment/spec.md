## ADDED Requirements
### Requirement: Persistent container deployment
系统 SHALL 提供非 root Docker 部署并将浏览器登录态、收藏结果及模型缓存保存在持久卷。
#### Scenario: Restart container
- **WHEN** 用户重建或重启容器且保留数据卷
- **THEN** 已保存登录态和收藏结果仍可供服务读取
### Requirement: Private manual login
系统 SHALL 提供临时浏览器登录窗口，默认只通过主机回环访问。
#### Scenario: Login on a remote host
- **WHEN** 用户停止服务并通过 SSH 隧道打开登录窗口
- **THEN** 用户可手动扫码，登录后再启动 MCP
### Requirement: Public release excludes private data
公开仓库及镜像构建上下文 SHALL 排除本机凭证、收藏数据和私人工作记录，并提供项目许可及第三方引用。
#### Scenario: Public checkout
- **WHEN** 其他用户克隆公共仓库
- **THEN** 获取可构建代码及配置示例而不获取原用户登录态或收藏正文
