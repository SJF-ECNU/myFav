# 避免收藏入口重复点击竞态

URL showTab=favorite_collection 已选择收藏标签。服务器Agent报告资料成功后立即重复点击会使原生请求不发出；本次无点击对照中标签 aria-selected=true 且 listcollection 先于本人资料成功。
移除重复点击，仍等待本人资料及原生收藏响应成功，不使用固定sleep、签名重放或拒绝重试。
