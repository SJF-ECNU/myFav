import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { FavoriteService, transcriptionFailureReason } from '../src/service.js';
import { DouyinService } from '../src/douyin-service.js';
import { XiaohongshuService } from '../src/xiaohongshu-service.js';

for (const [platform, Service, type] of [['bilibili', FavoriteService, 2], ['douyin', DouyinService, 'video'], ['xiaohongshu', XiaohongshuService, 'video']]) {
  for (const stage of ['lookup', 'download']) test(`${platform}: failed ${stage} retries, pending deduplicates and success caches`, async () => {
    const store = new Store(':memory:');
    store.apply({ platform, uid: '1', syncedAt: 'now', folders: [{ id: '10', title: 'myFav', items: [{ id: '1', type, bvid: 'BVtest' }] }] });
    const item = store.currentItems(platform)[0];
    store.saveContent(item.itemId, { metadata: item, parts: [{ cid: 1, status: 'no_subtitles', subtitles: [] }], evidence: {} });
    let lookups = 0, transcriptions = 0;
    const service = new Service(store, 'myFav', null, async () => {
      transcriptions++;
      if (stage === 'download' && transcriptions === 1) throw new Error('本地转写失败：audio_download/execution');
      return { language: 'zh', segments: [{ from: 0, to: 1, text: 'recovered' }] };
    });
    service.withBrowser = async () => {
      if (++lookups === 1 && stage === 'lookup') throw new Error('browser detail timeout');
      return 'https://test.example/audio';
    };
    try {
      await service.content(item.itemId);
      await service.transcriptionQueue;
      assert.equal(service.jobs.get(`${item.itemId}:1`).reason, stage === 'lookup' ? 'browser detail timeout' : '本地转写失败：audio_download/execution');
      await Promise.all([service.content(item.itemId), service.content(item.itemId)]);
      await service.transcriptionQueue;
      const content = await service.content(item.itemId);
      assert.equal(content.parts[0].subtitles[0].text, 'recovered');
      assert.equal(lookups, 2);
      assert.equal(transcriptions, stage === 'lookup' ? 1 : 2);
      assert.equal(service.jobs.size, 0);
    } finally { store.close(); }
  });
}

test('diagnostics preserve errors without signed URLs or credentials', () => {
  assert.equal(transcriptionFailureReason(new Error('fetch failed https://cdn.test/audio?sign=secret token=secret\nstack')), 'fetch failed [媒体地址] token=[已隐藏]');
});
