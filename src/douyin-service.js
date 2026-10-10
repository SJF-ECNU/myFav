import { guardedBrowser, checkResponse, recordFailure } from './platform-access.js';
import { FavoriteService, transcriptionFailureReason } from './service.js';
import { openDouyin, douyinApi, collectDouyin, listDouyinFolders } from './douyin.js';
import { transcribeAudio, validateAudioUrl } from './transcribe.js';

export function parseCaptions(text) {
  const segments = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n'), index = lines.findIndex(line => line.includes(' --> '));
    if (index < 0) continue;
    const time = value => {
      const parts = value.trim().split(/\s/)[0].replace(',', '.').split(':').map(Number);
      if (parts.length < 2 || parts.length > 3 || parts.some(p => !Number.isFinite(p))) throw new Error('抖音字幕格式异常');
      return parts.reduce((total, part) => total * 60 + part, 0);
    };
    const [from, to] = lines[index].split(' --> ').map(time);
    segments.push({ from, to, text: lines.slice(index + 1).join('\n') });
  }
  if (!segments.length) throw new Error('抖音字幕不可解析');
  return segments;
}
export class DouyinService extends FavoriteService {
  constructor(store, folderName = 'myFav', browser = openDouyin, transcribe = url => transcribeAudio(url, 'douyin')) {
    super(store, folderName, browser, transcribe);
    this.platform = 'douyin';
  }
  withBrowser(fn) {
    const work = this.queue.then(async () => {
      return guardedBrowser(this.store, this.platform, () => this.browser(true), async page => {
        const api = this.guardedApi(douyinApi(page));
        const scope = this.store.status('douyin').scope;
        if (scope) {
          const folder = (await listDouyinFolders(api)).find(folder => folder.collects_id_str === scope.folder_id);
          if (!folder || String(folder.user_id_str) !== String(scope.uid)) checkResponse(401);
        }
        return fn(api, page);
      });
    });
    this.queue = work.catch(() => {}); return work;
  }
  imageSources(item) {
    return this.withItemBrowser(item, async api => {
      const detail = (await api('/aweme/v1/web/aweme/detail/', { aweme_id: item.id })).aweme_detail;
      if (!detail) throw new Error('抖音作品详情不可用');
      return item.type === 'image'
        ? (detail.images ?? []).map(image => ({ url: image.url_list?.[0], kind: 'image' }))
        : detail.video?.cover?.url_list?.[0] ? [{ url: detail.video.cover.url_list[0], kind: 'cover' }] : [];
    });
  }
  async sync() {
    const result = await this.withBrowser(async api => this.store.apply(await collectDouyin(api, this.folderName, this.store.status('douyin').scope?.uid)));
    this.preparationQueue = this.preparationQueue.then(async () => {
      for (const item of this.store.currentItems('douyin')) {
        try { await this.content(item.itemId); } catch { /* Retry on the next sync or request. */ }
      }
    });
    return result;
  }
  async content(id) {
    const item = this.store.item(id);
    const membership = this.store.membershipCursor(id);
    let content = { metadata: item, sourceUrl: `https://www.douyin.com/${item.type === 'image' ? 'note' : 'video'}/${item.id}`, status: 'metadata_only', parts: [], evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
    if (!item.present || item.type !== 'video') return content;
    content = this.store.content(id) ?? await this.withItemBrowser(item, async (api, page) => {
      const video = (await api('/aweme/v1/web/aweme/detail/', { aweme_id: item.id })).aweme_detail;
      if (!video?.video) throw new Error('抖音视频详情不可用');
      content.metadata.description = video.desc ?? item.description;
      const part = { page: 1, cid: 1, title: item.title, status: 'no_subtitles', subtitles: [] };
      const subtitle = video.video.caption_download_addr?.url_list?.[0];
      if (subtitle) {
        try {
          const url = validateAudioUrl(subtitle, 'douyin');
          const text = await page.evaluate(async url => {
            const r = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
            if (!r.ok) return { httpStatus: r.status, retryAfter: r.headers.get('retry-after') }; return r.text();
          }, url);
          checkResponse(text.httpStatus, text.retryAfter);
          part.subtitles = parseCaptions(text); part.status = 'available'; part.source = 'platform_subtitles';
        } catch (error) { if (error.platformStop) throw error; part.status = 'unavailable'; }
      }
      content.parts = [part]; return content;
    });
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    this.store.requirePresent(id, membership);
    this.store.saveContent(id, content);
    const part = content.parts[0], cached = this.store.transcript(id, 1);
    if (part.status !== 'available') {
      if (cached) {
        delete part.reason; part.subtitles = cached.segments; part.language = cached.language; part.source = 'local_whisper'; part.status = 'available'; }
      else {
        const key = `${id}:1`;
        delete part.reason;
        if (!this.jobs.has(key) || this.jobs.get(key).status === 'transcription_failed') this.startTranscription(item, 1, key);
        Object.assign(part, this.jobs.get(key));
      }
    }
    content.status = part.status === 'available' ? 'text_available' : part.status === 'transcription_pending' ? 'transcription_pending' : 'metadata_only';
    content.evidence.includesAudioTranscription = part.source === 'local_whisper';
    content.evidence.kind = part.status === 'available' ? part.source === 'local_whisper' ? 'metadata_and_audio_text' : 'metadata_and_subtitles' : 'metadata';
    return content;
  }
  startTranscription(item, cid, key) {
    const membership = this.store.membershipCursor(item.itemId);
    const job = { status: 'transcription_pending' }; this.jobs.set(key, job);
    this.transcriptionQueue = this.transcriptionQueue.then(async () => {
      this.store.requirePresent(item.itemId, membership); this.store.assertPlatform(this.platform);
      const url = await this.withItemBrowser(item, async api => {
        this.store.requirePresent(item.itemId, membership);
        const video = (await api('/aweme/v1/web/aweme/detail/', { aweme_id: item.id })).aweme_detail;
        const url = video?.video?.play_addr?.url_list?.find(url => {
          try { validateAudioUrl(url, 'douyin'); return true; } catch { return false; }
        });
        if (!url) throw new Error('抖音无可读取的原视频音轨');
        return url;
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
