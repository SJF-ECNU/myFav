import { openBrowser, browserApi } from './browser.js';
import { collectFavorites } from './favorites.js';
import { transcribeAudio, validateAudioUrl } from './transcribe.js';

export function validateSubtitleUrl(value) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) || url.port || url.username || url.password) {
    throw new Error('平台返回了不支持的字幕地址');
  }
  return url.href;
}

export async function extractContent(api, readSubtitle, item) {
  const content = { metadata: item, sourceUrl: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : null,
    evidence: { kind: 'metadata', includesVisuals: false, includesAudioTranscription: false }, parts: [] };
  if (!item.present || item.type !== 2 || !item.bvid) return { ...content, status: 'metadata_only', reason: '不在当前收藏夹或不是可读取的视频' };
  try {
    const video = await api('/x/web-interface/view', { bvid: item.bvid });
    content.metadata = { ...item, description: video.desc ?? item.description };
    for (const part of video.pages ?? []) {
      const result = { page: part.page, title: part.part, cid: part.cid, subtitles: [] };
      try {
        const player = await api('/x/player/v2', { bvid: item.bvid, cid: part.cid });
        const subtitles = player.subtitle?.subtitles ?? [];
        const preferred = subtitles.find(sub => /^zh|^ai-zh/.test(sub.lan)) ?? subtitles[0];
        if (preferred) {
          const data = await readSubtitle(validateSubtitleUrl(preferred.subtitle_url));
          if (!Array.isArray(data.body) || data.body.some(line => typeof line.content !== 'string' || !Number.isFinite(line.from) || !Number.isFinite(line.to))) throw new Error('字幕格式异常');
          result.subtitles = data.body.map(line => ({ from: line.from, to: line.to, text: line.content }));
          result.language = preferred.lan;
          result.status = 'available';
          result.source = 'platform_subtitles';
        } else result.status = 'no_subtitles';
      } catch { result.status = 'unavailable'; }
      content.parts.push(result);
    }
    const available = content.parts.filter(part => part.status === 'available').length;
    content.status = available && available === content.parts.length ? 'subtitles_available' : available ? 'partial' : 'metadata_only';
    content.evidence.kind = available ? 'metadata_and_subtitles' : 'metadata';
    return content;
  } catch {
    return { ...content, status: 'metadata_only', reason: '视频详情接口当前不可读取，可重试；未进行音频或画面分析' };
  }
}

export class FavoriteService {
  constructor(store, folderName = 'myFav', browser = openBrowser, transcribe = transcribeAudio) {
    this.store = store; this.folderName = folderName; this.browser = browser; this.queue = Promise.resolve();
    this.transcribe = transcribe; this.jobs = new Map(); this.transcriptionQueue = Promise.resolve(); this.preparationQueue = Promise.resolve();
  }
  withBrowser(fn) {
    const job = this.queue.then(async () => {
      const { context, page } = await this.browser(true);
      try { return await fn(browserApi(page), page); }
      finally { await context.close(); }
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async sync() {
    const result = await this.withBrowser(async api => {
      const user = await api('/x/web-interface/nav');
      if (!user.isLogin) throw new Error('尚未登录，请运行 npm run login');
      if (this.store.status().scope && String(this.store.status().scope.uid) !== String(user.mid)) throw new Error('登录账号已改变');
      const snapshot = await collectFavorites(api, user.mid, this.folderName);
      return this.store.apply(snapshot);
    });
    this.preparationQueue = this.preparationQueue.then(async () => {
      for (const item of this.store.currentItems()) {
        try { await this.content(item.itemId); }
        catch { /* A failed item can retry on the next sync or content request. */ }
      }
    });
    return result;
  }
  async content(id) {
    const item = this.store.item(id);
    if (!item.present || item.type !== 2 || !item.bvid) return extractContent(null, null, item);
    const content = this.store.content(id) ?? await this.withBrowser((api, page) => extractContent(api, url => page.evaluate(async url => {
      const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('字幕请求失败');
      return response.json();
    }, url), item));
    content.metadata = { ...content.metadata, ...item, description: content.metadata.description };
    if (content.parts.length) this.store.saveContent(id, content);
    for (const part of content.parts) {
      if (part.status === 'available') continue;
      const cached = this.store.transcript(id, part.cid);
      if (cached) {
        part.subtitles = cached.segments; part.language = cached.language;
        part.source = 'local_whisper'; part.status = 'available';
      } else {
        const key = `${id}:${part.cid}`;
        if (!this.jobs.has(key)) this.startTranscription(item, part.cid, key);
        part.status = this.jobs.get(key).status;
        if (this.jobs.get(key).reason) part.reason = this.jobs.get(key).reason;
      }
    }
    const available = content.parts.filter(part => part.status === 'available').length;
    const pending = content.parts.some(part => part.status === 'transcription_pending');
    const hasTranscription = content.parts.some(part => part.source === 'local_whisper');
    content.status = pending ? 'transcription_pending' : available && available === content.parts.length ? 'text_available' : available ? 'partial' : 'metadata_only';
    content.evidence.includesAudioTranscription = hasTranscription;
    content.evidence.kind = hasTranscription ? 'metadata_and_audio_text' : available ? 'metadata_and_subtitles' : 'metadata';
    return content;
  }
  startTranscription(item, cid, key) {
    const job = { status: 'transcription_pending' }; this.jobs.set(key, job);
    const work = this.transcriptionQueue.then(async () => {
      const audioUrl = await this.withBrowser(async api => {
        const media = await api('/x/player/playurl', { bvid: item.bvid, cid, fnval: 16, fnver: 0, fourk: 0 });
        const audio = media.dash?.audio?.[0];
        if (!audio) throw new Error('没有可读取的音轨');
        return validateAudioUrl(audio.baseUrl || audio.base_url);
      });
      const result = await this.transcribe(audioUrl);
      this.store.saveTranscript(item.itemId, cid, result);
      job.status = 'available';
    });
    this.transcriptionQueue = work.catch(error => {
      job.status = 'transcription_failed';
      job.reason = /^(本地转写失败|Bilibili HTTP|Bilibili 接口错误|没有可读取的音轨|不支持的音频地址)/.test(error.message) ? error.message.split('\n')[0] : '音轨或转写当前不可用';
    });
  }
}
