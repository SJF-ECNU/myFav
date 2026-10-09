# MCP 图片获取
get_content 提供有序图片索引，get_image 返回原生 MCP image block。支持小红书 imageList、抖音 images、三平台视频封面。SQLite 保存来源和二进制缓存；read 只读缓存，prepare 可通过既有串行浏览器刷新图片来源并下载。只接受平台 HTTPS CDN、禁止重定向、限制单图10MiB，仅JPEG/PNG/WebP/GIF。不做OCR或分析。
验证：提取顺序/封面、SSRF与大小/MIME、持久缓存、真实SDK图片及权限，服务器新镜像公网元数据，推送源码。既有部署修改保留。
