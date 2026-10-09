export class PlatformService {
  constructor(store, services) { this.store = store; this.services = services; }
  sync(platform = 'bilibili') {
    if (platform !== 'all') return this.services[platform].sync();
    return Promise.all(Object.entries(this.services).map(async ([platform, service]) => {
      try { return { platform, status: 'synced', ...await service.sync() }; }
      catch { return { platform, status: 'failed', reason: '登录或平台当前不可用，保留旧同步数据' }; }
    })).then(platforms => ({ platforms, cursor: this.store.status().cursor }));
  }
  content(id) { return this.services[this.store.item(id).platform].content(id); }
  async drain() {
    for (const service of Object.values(this.services)) {
      await service.preparationQueue; await service.transcriptionQueue; await service.queue;
    }
  }
}
