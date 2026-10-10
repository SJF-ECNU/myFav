import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { platformError, guardedBrowser } from '../src/platform-access.js';
import { PlatformService } from '../src/platform-service.js';
import { FavoriteService, extractContent } from '../src/service.js';
import { DouyinService } from '../src/douyin-service.js';
import { XiaohongshuService } from '../src/xiaohongshu-service.js';
import { downloadImage } from '../src/images.js';
const snapshot = (platform = 'bilibili', items = [{ id: '1', type: 2, bvid: 'BV1' }]) => ({ platform, uid: '1', syncedAt: 'now', folders: [{ id: '10', title: 'myFav', items }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('denial persists across restart; cooldown honors Retry-After and manual resume is platform-specific', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-pause-'));
  let store = new Store(join(dir, 'db'));
  try {
    const error = platformError(403);
    store.pausePlatform('douyin', error.message, error.until);
    store.close(); store = new Store(join(dir, 'db'));
    let opened = 0;
    await assert.rejects(guardedBrowser(store, 'douyin', async () => { opened++; }, () => {}), /手动恢复/);
    assert.equal(opened, 0); store.assertPlatform('bilibili');
    const limit = platformError(429, '3600');
    assert.ok(limit.until >= Date.now() + 3599000);
    store.pausePlatform('xiaohongshu', limit.message, limit.until);
    store.resumePlatform('douyin'); store.assertPlatform('douyin');
    assert.throws(() => store.assertPlatform('xiaohongshu'), /冷却/);
    store.db.prepare('UPDATE platform_pauses SET until_ms=0 WHERE platform=?').run('xiaohongshu');
    store.assertPlatform('xiaohongshu');
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('subtitle denial never falls back to audio preparation', async () => {
  const item = { present: true, type: 2, bvid: 'BV1' };
  await assert.rejects(extractContent(async path => {
    if (path === '/x/web-interface/view') return { pages: [{ cid: 1 }] };
    throw platformError(412);
  }, () => assert.fail('subtitle download'), item), /手动恢复/);
});

test('CDN denial pauses images without refetching sources; cached reads stay available', async () => {
  const store = new Store(':memory:'); store.apply(snapshot('xiaohongshu', [{ id: '1', type: 'image' }]));
  const id = store.currentItems('xiaohongshu')[0].itemId;
  store.saveImageSources(id, [{ url: 'https://a.xhscdn.com/image', kind: 'image' }]);
  store.saveImage(id, 1, { mime: 'image/png', data: Buffer.from('cached') });
  let downloads = 0;
  const service = new PlatformService(store, { xiaohongshu: { imageSources() { assert.fail('must not bypass refusal'); } } }, async url => {
    downloads++; return downloadImage(url, 'xiaohongshu', async () => new Response('', { status: 403 }));
  });
  try {
    await assert.rejects(service.image(id, 0, true), /手动恢复/);
    await assert.rejects(service.image(id, 0, true), /手动恢复/);
    assert.equal(downloads, 1);
    assert.equal(Buffer.from((await service.image(id, 1, false)).data).toString(), 'cached');
  } finally { store.close(); }
});

test('removal retains caches for seven days, restores on re-add and then expires without affecting results or other platforms', () => {
  const store = new Store(':memory:'); store.apply(snapshot()); store.apply(snapshot('douyin', [{ id: '1', type: 'video' }]));
  const id = store.currentItems()[0].itemId;
  store.saveContent(id, { parts: [] }); store.saveTranscript(id, 1, { segments: [] });
  store.saveSource(id, 'https://source'); store.saveImageSources(id, [{ url: 'https://image' }]);
  store.saveImage(id, 0, { mime: 'image/png', data: Buffer.from('image') });
  store.saveResult(id, { summary: 'keep analysis' });
  const other = store.currentItems('douyin')[0].itemId; store.saveContent(other, { parts: [] });
  try {
    assert.throws(() => store.apply({ ...snapshot(), uid: '2' }), /账号/);
    assert.ok(store.content(id));
    store.apply(snapshot('bilibili', []));
    assert.ok(store.content(id)); assert.ok(store.transcript(id, 1));
    store.apply(snapshot()); assert.ok(store.content(id)); assert.ok(store.image(id, 0));
    store.apply(snapshot('bilibili', []));
    const removedAt = store.db.prepare('SELECT removed_at FROM items WHERE id=?').get(id).removed_at;
    store.apply(snapshot('bilibili', []));
    assert.equal(store.db.prepare('SELECT removed_at FROM items WHERE id=?').get(id).removed_at, removedAt);
    store.db.prepare('UPDATE items SET removed_at=? WHERE id=?').run(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1, id);
    store.purgeRemoved();
    assert.equal(store.content(id), null); assert.equal(store.transcript(id, 1), null);
    assert.equal(store.source(id), undefined); assert.equal(store.imageSources(id), null); assert.equal(store.image(id, 0), undefined);
    assert.equal(store.getResult(id).result.summary, 'keep analysis'); assert.ok(store.content(other));
    assert.throws(() => store.saveContent(id, {}), /当前收藏/);
    store.apply(snapshot()); assert.equal(store.content(id), null);
  } finally { store.close(); }
});

for (const [platform, Service, type] of [['bilibili', FavoriteService, 2], ['douyin', DouyinService, 'video'], ['xiaohongshu', XiaohongshuService, 'video']]) {
  test(`${platform}: removed queued transcription skips lookup`, async () => {
    const store = new Store(':memory:'); store.apply(snapshot(platform, [{ id: '1', type, bvid: 'BV1' }]));
    const item = store.currentItems(platform)[0], hold = deferred();
    const service = new Service(store, 'myFav', null, () => assert.fail('download'));
    service.withBrowser = () => assert.fail('lookup'); service.transcriptionQueue = hold.promise;
    service.startTranscription(item, 1, `${item.itemId}:1`); store.apply(snapshot(platform, [])); hold.resolve();
    try { await service.transcriptionQueue; assert.equal(store.transcript(item.itemId, 1), null); }
    finally { store.close(); }
  });
  test(`${platform}: late transcription cannot repopulate removed and re-added item`, async () => {
    const store = new Store(':memory:'); store.apply(snapshot(platform, [{ id: '1', type, bvid: 'BV1' }]));
    const item = store.currentItems(platform)[0], entered = deferred(), hold = deferred();
    const service = new Service(store, 'myFav', null, async () => { entered.resolve(); await hold.promise; return { segments: [] }; });
    service.withBrowser = async () => 'https://media';
    service.startTranscription(item, 1, `${item.itemId}:1`); await entered.promise;
    store.apply(snapshot(platform, [])); store.apply(snapshot(platform, [{ id: '1', type, bvid: 'BV1' }])); hold.resolve();
    try { await service.transcriptionQueue; assert.equal(store.transcript(item.itemId, 1), null); }
    finally { store.close(); }
  });
}

test('late image download cannot repopulate a removed and re-added item', async () => {
  const store = new Store(':memory:'); store.apply(snapshot()); const id = store.currentItems()[0].itemId;
  store.saveImageSources(id, [{ url: 'https://i0.hdslb.com/image', kind: 'cover' }]);
  const entered = deferred(), hold = deferred();
  const service = new PlatformService(store, {}, async () => { entered.resolve(); await hold.promise; return { mime: 'image/png', data: Buffer.from('image') }; });
  const work = service.image(id, 0, true); await entered.promise; store.apply(snapshot('bilibili', [])); store.apply(snapshot()); hold.resolve();
  try { await assert.rejects(work, /当前收藏/); assert.equal(store.image(id, 0), undefined); }
  finally { store.close(); }
});

test('queued detail work rechecks membership before invoking its callback', async () => {
  const store = new Store(':memory:'); store.apply(snapshot());
  const service = new FavoriteService(store), item = store.currentItems()[0];
  const entered = deferred(); let callback;
  service.withBrowser = fn => { callback = fn; return entered.promise.then(() => fn()); };
  const work = service.withItemBrowser(item, () => assert.fail('detail lookup'));
  store.apply(snapshot('bilibili', [])); entered.resolve();
  try { await assert.rejects(work, /当前收藏/); assert.ok(callback); }
  finally { store.close(); }
});

test('browser API refusal is persisted and later work never opens browser', async () => {
  const store = new Store(':memory:'); let opens = 0, closes = 0;
  const service = new FavoriteService(store, 'myFav', async () => {
    opens++; return { page: { evaluate: async () => ({ httpStatus: 429, retryAfter: '1800' }) }, close: async () => { closes++; } };
  });
  try {
    await assert.rejects(service.withBrowser(api => api('/x/web-interface/view')), /冷却/);
    await assert.rejects(service.withBrowser(() => assert.fail('work')), /冷却/);
    assert.equal(opens, 1); assert.equal(closes, 1);
    assert.ok(store.platformPause('bilibili').until_ms >= Date.now() + 1799000);
  } finally { store.close(); }
});

test('different signed-in account cannot perform detail work', async () => {
  const store = new Store(':memory:'); store.apply(snapshot());
  const service = new FavoriteService(store, 'myFav', async () => ({ page: { evaluate: async () => ({ body: { code: 0, data: { isLogin: true, mid: 2 } } }) }, close: async () => {} }));
  try {
    await assert.rejects(service.withBrowser(() => assert.fail('detail')), /手动恢复/);
    assert.ok(store.platformPause('bilibili'));
  } finally { store.close(); }
});

test('verification page pauses work even when the browser callback timed out', async () => {
  const store = new Store(':memory:');
  try {
    await assert.rejects(guardedBrowser(store, 'douyin', async () => ({ page: { url: () => 'https://www.douyin.com/verify/' }, close: async () => {} }), async () => { throw new Error('timeout'); }), /手动恢复/);
    assert.ok(store.platformPause('douyin'));
  } finally { store.close(); }
});

test('removed cache survives restart within retention; expired re-add cannot restore it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-retention-')); let store = new Store(join(dir, 'db'));
  try {
    store.apply(snapshot()); const id = store.currentItems()[0].itemId;
    store.saveContent(id, { parts: [] }); store.apply(snapshot('bilibili', [])); store.close();
    store = new Store(join(dir, 'db')); assert.ok(store.content(id));
    store.db.prepare('UPDATE items SET removed_at=? WHERE id=?').run(Date.now() - 8 * 24 * 60 * 60 * 1000, id);
    store.apply(snapshot()); assert.equal(store.content(id), null);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
