import { FavoriteService } from './service.js';
import { openDouyin, douyinApi, collectDouyin } from './douyin.js';
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
  }
  withBrowser(fn) {
    const work = this.queue.then(async () => {
      const { context, page, close = () => context.close() } = await this.browser(true);
      try { return await fn(douyinApi(page), page); } finally { await close(); }
    });
    this.queue = work.catch(() => {}); return work;
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
    let content = { metadata: item, sourceUrl: `https://www.douyin.com/${item.type === 'image' ? 'note' : 'video'}/${item.id}`, status: 'metadata_only', parts: [], evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false } };
    if (!item.present || item.type !== 'video') return content;
    content = this.store.content(id) ?? await this.withBrowser(async (api, page) => {
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
            if (!r.ok) throw new Error(); return r.text();
          }, url);
          part.subtitles = parseCaptions(text); part.status = 'available'; part.source = 'platform_subtitles';
        } catch { part.status = 'unavailable'; }
      }
      content.parts = [part]; return content;
    });
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    this.store.saveContent(id, content);
    const part = content.parts[0], cached = this.store.transcript(id, 1);
    if (part.status !== 'available') {
      if (cached) { part.subtitles = cached.segments; part.language = cached.language; part.source = 'local_whisper'; part.status = 'available'; }
      else {
        const key = `${id}:1`;
        if (!this.jobs.has(key)) this.startTranscription(item, 1, key);
        Object.assign(part, this.jobs.get(key));
      }
    }
    content.status = part.status === 'available' ? 'text_available' : part.status === 'transcription_pending' ? 'transcription_pending' : 'metadata_only';
    content.evidence.includesAudioTranscription = part.source === 'local_whisper';
    content.evidence.kind = part.status === 'available' ? part.source === 'local_whisper' ? 'metadata_and_audio_text' : 'metadata_and_subtitles' : 'metadata';
    return content;
  }
  startTranscription(item, cid, key) {
    const job = { status: 'transcription_pending' }; this.jobs.set(key, job);
    this.transcriptionQueue = this.transcriptionQueue.then(async () => {
      const url = await this.withBrowser(async api => {
        const video = (await api('/aweme/v1/web/aweme/detail/', { aweme_id: item.id })).aweme_detail;
        const url = video?.video?.play_addr?.url_list?.find(url => {
          try { validateAudioUrl(url, 'douyin'); return true; } catch { return false; }
        });
        if (!url) throw new Error('抖音无可读取的原视频音轨');
        return url;
      });
      this.store.saveTranscript(item.itemId, cid, await this.transcribe(url)); job.status = 'available';
    }).catch(error => {
      job.status = 'transcription_failed';
      job.reason = /^本地转写失败：/.test(error.message) ? error.message.split('\n')[0] : '抖音视频音轨或转写当前不可用';
    });
  }
}
