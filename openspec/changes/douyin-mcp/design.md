## Context
CloakBrowser重启登录与抖音收藏夹接口可用。现有scope仅单平台，其他表可复用。
## Goals / Non-Goals
统一六工具与事件游标，平台独立账号范围、失败不影响别的平台，仅指定myFav，内容预取。不实现定时调度/签名逆向/图片视觉分析。
## Decisions
scopes以platform为主键，从旧scope事务迁移Bilibili范围；items新增platform默认bilibili保持已有ID/事件/结果。抖音ID前缀douyin并保留平台字符串。同步默认为bilibili以兼容已有客户端，支持douyin/all；查询默认全平台，按platform可筛选。同一平台浏览器队列串行。只请求网站自身同源收藏夹、夹内作品和详情接口，不读取其他夹作品。完整分页、重复ID/游标与前后收藏数量核对后才事务保存。平台CDN仅HTTPS允许域名，无任意URL读取。字幕字段需要实测；缺失则原视频声音转写，禁止以配乐music作为视频音轨。图文仅元数据。
## Risks / Trade-offs
内部接口及媒体URL可能变化；未完成文本状态显式返回。24条首次同步会串行预取转写，完成时间依赖CPU/长度，不瞬时承诺。all同步按平台返回成功或失败，不把失败平台标为已同步。登录长期有效性需持续验证。
