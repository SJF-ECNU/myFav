## Why
等待用户聊天时才提取内容会增加字幕请求和本地转写延迟。
## What Changes
同步成功后后台预取当前收藏中尚未缓存的内容，持久化字幕及分P元数据，缺失字幕立即排入本地转写队列。get_content使用缓存，重启或重复同步恢复未完成任务。外部系统负责同步触发，不增加轮询或唤醒。
## Capabilities
### New Capabilities
- content-prefetch: 同步后提前准备内容。
### Modified Capabilities
无。
## Impact
src/service.js、store.js、server.js及测试与运行文档。
