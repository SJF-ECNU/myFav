import { downloadImage, validateImageUrl } from './images.js';
export class PlatformService {
  constructor(store, services, download = downloadImage) { this.store = store; this.services = services; this.download = download; }
  sync(platform = 'bilibili') {
    if (platform !== 'all') return this.services[platform].sync();
    return Promise.all(Object.entries(this.services).map(async ([platform, service]) => {
      try { return { platform, status: 'synced', ...await service.sync() }; }
      catch { return { platform, status: 'failed', reason: '登录或平台当前不可用，保留旧同步数据' }; }
    })).then(platforms => ({ platforms, cursor: this.store.status().cursor }));
  }
  async imageList(id, prepare = false) {
    const item = this.store.item(id);
    if (!item.present) throw new Error('条目不在当前收藏夹');
    let sources = this.store.imageSources(id);
    if (!sources && prepare) {
      sources = await this.services[item.platform].imageSources(item);
      sources = sources.map(source => ({ ...source, url: validateImageUrl(source.url, item.platform) }));
      this.store.saveImageSources(id, sources);
    }
    return (sources ?? []).map((source, index) => ({ index, kind: source.kind, cached: Boolean(this.store.image(id, index)) }));
  }
  async image(id, index, prepare = false) {
    const item = this.store.item(id);
    if (!item.present) throw new Error('条目不在当前收藏夹');
    const cached = this.store.image(id, index);
    if (cached) return cached;
    if (!prepare) throw new Error('图片尚未缓存，需要prepare权限获取');
    await this.imageList(id, true);
    let source = this.store.imageSources(id)?.[index];
    if (!source) throw new Error('图片索引不存在');
    let image;
    try { image = await this.download(source.url, item.platform); }
    catch {
      const sources = (await this.services[item.platform].imageSources(item)).map(s => ({ ...s, url: validateImageUrl(s.url, item.platform) }));
      this.store.saveImageSources(id, sources);
      source = sources[index];
      if (!source) throw new Error('图片索引不存在');
      image = await this.download(source.url, item.platform);
    }
    this.store.saveImage(id, index, image);
    return image;
  }
  async content(id) {
    const content = await this.services[this.store.item(id).platform].content(id);
    try { content.images = await this.imageList(id, true); }
    catch { content.images = []; content.imageStatus = 'unavailable'; }
    return content;
  }
  cachedContent(id) {
    const item = this.store.item(id);
    const content = this.store.content(id);
    const images = (this.store.imageSources(id) ?? []).map((source, index) => ({ index, kind: source.kind, cached: Boolean(this.store.image(id, index)) }));
    if (!content || !item.present) return { metadata: item, status: 'metadata_only', parts: [], images: item.present ? images : [],
      reason: '内容尚未预取或条目已移除；只读请求不会启动浏览器或转写',
      evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
    content.images = images;
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    for (const part of content.parts) {
      const transcript = this.store.transcript(id, part.cid);
      if (transcript) {
        delete part.reason;
        Object.assign(part, { subtitles: transcript.segments, language: transcript.language, source: 'local_whisper', status: 'available' });
      }
    }
    const available = content.parts.filter(part => part.status === 'available').length;
    const audio = content.parts.some(part => part.source === 'local_whisper');
    if (content.parts.length) content.status = available === content.parts.length ? 'text_available' : available ? 'partial' : 'metadata_only';
    content.evidence.includesAudioTranscription = audio;
    if (audio) content.evidence.kind = item.platform === 'xiaohongshu' ? 'metadata_body_and_audio_text' : 'metadata_and_audio_text';
    return content;
  }
  async drain() {
    for (const service of Object.values(this.services)) {
      await service.preparationQueue; await service.transcriptionQueue; await service.queue;
    }
  }
}
