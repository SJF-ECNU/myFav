import { FavoriteService } from './service.js';
import { openXiaohongshu, collectXiaohongshu, readXhsNote, resolveXhsMedia } from './xiaohongshu.js';
import { transcribeAudio } from './transcribe.js';

export class XiaohongshuService extends FavoriteService {
  constructor(store, folderName = 'myFav', browser = openXiaohongshu, transcribe = url => transcribeAudio(url, 'xiaohongshu')) {
    super(store, folderName, browser, transcribe);
  }
  withBrowser(fn) {
    const work = this.queue.then(async () => {
      const { context, page, close = () => context.close() } = await this.browser();
      try { return await fn(page); } finally { await close(); }
    });
    this.queue = work.catch(() => {}); return work;
  }
  async sync() {
    const result = await this.withBrowser(async page => {
      const { snapshot, sources } = await collectXiaohongshu(page, this.folderName, this.store.status('xiaohongshu').scope?.uid);
      const result = this.store.apply(snapshot);
      for (const item of this.store.currentItems('xiaohongshu')) this.store.saveSource(item.itemId, sources.find(s => s.id === item.id).url);
      return result;
    });
    this.preparationQueue = this.preparationQueue.then(async () => {
      for (const item of this.store.currentItems('xiaohongshu')) {
        try { await this.content(item.itemId); } catch { /* Retry on the next sync or request. */ }
      }
    });
    return result;
  }
  async content(id) {
    const item = this.store.item(id);
    let content = { metadata: item, sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}`, parts: [], status: 'metadata_only', evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
    if (!item.present) return content;
    content = this.store.content(id) ?? await this.withBrowser(async page => {
      const note = await readXhsNote(page, this.store.source(id), item);
      content.metadata.description = note.description;
      content.status = 'text_available'; content.evidence.kind = 'metadata_and_body';
      if (item.type === 'video') content.parts = [{ cid: 1, page: 1, title: item.title, subtitles: [], status: 'no_subtitles' }];
      return content;
    });
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    this.store.saveContent(id, content);
    if (item.type !== 'video') return content;
    const part = content.parts[0], cached = this.store.transcript(id, 1);
    if (cached) { delete part.reason; part.subtitles = cached.segments; part.source = 'local_whisper'; part.language = cached.language; part.status = 'available'; }
    else {
      const key = `${id}:1`;
      if (!this.jobs.has(key)) this.startTranscription(item, 1, key);
      delete part.reason;
      Object.assign(part, this.jobs.get(key));
    }
    content.status = part.status === 'available' ? 'text_available' : part.status === 'transcription_pending' ? 'transcription_pending' : 'partial';
    content.evidence.includesAudioTranscription = part.source === 'local_whisper';
    content.evidence.kind = part.source === 'local_whisper' ? 'metadata_body_and_audio_text' : 'metadata_and_body';
    return content;
  }
  startTranscription(item, cid, key) {
    const job = { status: 'transcription_pending' }; this.jobs.set(key, job);
    this.transcriptionQueue = this.transcriptionQueue.then(async () => {
      const url = await this.withBrowser(async page => {
        const note = await readXhsNote(page, this.store.source(item.itemId), item);
        return resolveXhsMedia(note.mediaUrl);
      });
      this.store.saveTranscript(item.itemId, cid, await this.transcribe(url)); job.status = 'available';
    }).catch(error => {
      job.status = 'transcription_failed';
      job.reason = /^本地转写失败：/.test(error.message) ? error.message.split('\n')[0] : '小红书原视频或转写当前不可用';
    });
  }
}
