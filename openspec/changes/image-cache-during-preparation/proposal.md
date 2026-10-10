# 批次运行期间读取图片缓存

现有 HTTP preparing 锁在 get_image 进入缓存读取前拒绝调用，导致已缓存图片无法交付。
批次运行时调用 image(itemId,index,false)，仅使用现有缓存及成员检查，不触发平台访问；缓存缺失保持失败。锁仍保护准备任务。
