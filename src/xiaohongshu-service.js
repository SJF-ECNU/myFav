import { guardedBrowser, checkResponse, recordFailure } from './platform-access.js';
import { FavoriteService, transcriptionFailureReason } from './service.js';
import { openXiaohongshu, collectXiaohongshu, readXhsNote, resolveXhsMedia } from './xiaohongshu.js';
import { transcribeAudio } from './transcribe.js';

export class XiaohongshuService extends FavoriteService {
  constructor(store, folderName = 'myFav', browser = openXiaohongshu, transcribe = url => transcribeAudio(url, 'xiaohongshu')) {
    super(store, folderName, browser, transcribe);
    this.platform = 'xiaohongshu';
  }
  withBrowser(fn) {
    const work = this.queue.then(async () => {
      return guardedBrowser(this.store, this.platform, () => this.browser(true), async page => {
        const scope = this.store.status('xiaohongshu').scope;
        if (scope) {
          const uid = await page.evaluate(() => {
            const value = window.__INITIAL_STATE__?.user?.userInfo;
            const user = value?.value ?? value;
            return user && !user.guest ? user.userId : null;
          });
          if (String(uid) !== String(scope.uid)) checkResponse(401);
        }
        return fn(page);
      });
    });
    this.queue = work.catch(() => {}); return work;
  }
  imageSources(item) {
    return this.withItemBrowser(item, async page => (await readXhsNote(page, this.store.source(item.itemId), item)).images);
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
    const membership = this.store.membershipCursor(id);
    let content = { metadata: item, sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}`, parts: [], status: 'metadata_only', evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
    if (!item.present) return content;
    content = this.store.content(id) ?? await this.withItemBrowser(item, async page => {
      const note = await readXhsNote(page, this.store.source(id), item);
      content.metadata.description = note.description;
      content.status = 'text_available'; content.evidence.kind = 'metadata_and_body';
      if (item.type === 'video') content.parts = [{ cid: 1, page: 1, title: item.title, subtitles: [], status: 'no_subtitles' }];
      return content;
    });
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    this.store.requirePresent(id, membership);
    this.store.saveContent(id, content);
    if (item.type !== 'video') return content;
    const part = content.parts[0], cached = this.store.transcript(id, 1);
    if (cached) { delete part.reason; part.subtitles = cached.segments; part.source = 'local_whisper'; part.language = cached.language; part.status = 'available'; }
    else {
      const key = `${id}:1`;
      if (!this.jobs.has(key) || this.jobs.get(key).status === 'transcription_failed') this.startTranscription(item, 1, key);
      delete part.reason;
      Object.assign(part, this.jobs.get(key));
    }
    content.status = part.status === 'available' ? 'text_available' : part.status === 'transcription_pending' ? 'transcription_pending' : 'partial';
    content.evidence.includesAudioTranscription = part.source === 'local_whisper';
    content.evidence.kind = part.source === 'local_whisper' ? 'metadata_body_and_audio_text' : 'metadata_and_body';
    return content;
  }
  startTranscription(item, cid, key) {
    const membership = this.store.membershipCursor(item.itemId);
    const job = { status: 'transcription_pending' }; this.jobs.set(key, job);
    this.transcriptionQueue = this.transcriptionQueue.then(async () => {
      this.store.requirePresent(item.itemId, membership); this.store.assertPlatform(this.platform);
      const url = await this.withItemBrowser(item, async page => {
        this.store.requirePresent(item.itemId, membership);
        const note = await readXhsNote(page, this.store.source(item.itemId), item);
        return resolveXhsMedia(note.mediaUrl);
      });
      this.store.requirePresent(item.itemId, membership); this.store.assertPlatform(this.platform);
      const result = await this.transcribe(url);
      this.store.requirePresent(item.itemId, membership);
      this.store.saveTranscript(item.itemId, cid, result); job.status = 'available'; this.jobs.delete(key);
    }).catch(error => {
      recordFailure(this.store, this.platform, error);
      job.status = 'transcription_failed';
      job.reason = transcriptionFailureReason(error);
    });
  }
}
