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
  cachedContent(id) {
    const item = this.store.item(id);
    const content = this.store.content(id);
    if (!content || !item.present) return { metadata: item, status: 'metadata_only', parts: [],
      reason: '内容尚未预取或条目已移除；只读请求不会启动浏览器或转写',
      evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
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
