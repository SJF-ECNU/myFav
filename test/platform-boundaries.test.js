import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { platformError, guardedBrowser, recordFailure, checkResponse, requestStage } from '../src/platform-access.js';
import { PlatformService } from '../src/platform-service.js';
import { FavoriteService, extractContent } from '../src/service.js';
import { openDouyin } from '../src/douyin.js';
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


test('pause diagnostics survive recovery and restart without response secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-diagnostics-'));
  let store = new Store(join(dir, 'db'));
  try {
    const error = platformError(403, null, 'access denied https://cdn.invalid/?sign=secret Cookie=session-password', 'image_download');
    recordFailure(store, 'douyin', error);
    recordFailure(store, 'douyin', error);
    const row = store.pauseHistory('douyin')[0];
    assert.equal(row.httpStatus, 403); assert.equal(row.stage, 'image_download');
    assert.ok(Number.isFinite(Date.parse(row.time)));
    assert.equal(store.pauseHistory('douyin').length, 1);
    assert.match(store.platformPause('douyin').reason, /HTTP 403/);
    assert.throws(() => store.assertPlatform('douyin'), /image_download/);
    assert.doesNotMatch(JSON.stringify({row, pause:store.platformPause('douyin')}), /secret|password|https:|Cookie|sign=/);
    store.resumePlatform('douyin'); store.close(); store = new Store(join(dir, 'db'));
    assert.equal(store.platformPause('douyin'), null);
    assert.deepEqual(store.pauseHistory('douyin')[0], row);
    assert.throws(() => checkResponse(0, null, '账号已改变', 'account_check'), error => {
      assert.equal(error.diagnostic.httpStatus, null); assert.equal(error.diagnostic.signal, 'account_changed'); return true;
    });
    const badStage = platformError(401, null, '', 'https://private.invalid/?token=secret');
    assert.equal(badStage.diagnostic.stage, 'unknown'); assert.doesNotMatch(badStage.message, /secret/);
  } finally { store.close(); await rm(dir, { recursive:true, force:true }); }
});

test('pause history stays bounded and HTTP 200 API refusals retain actual status', () => {
  const store = new Store(':memory:');
  try {
    for (let i=0;i<305;i++) {
      store.resumePlatform('douyin');
      const error = platformError(200, null, '请先登录 token=secret', 'favorites_api');
      error.diagnostic.time = new Date(i*1000).toISOString();
      recordFailure(store, 'douyin', error);
    }
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM platform_pause_events').get().n,300);
    assert.equal(store.pauseHistory('douyin')[0].httpStatus,200);
    assert.equal(store.pauseHistory('douyin')[0].signal,'login_required');
    assert.doesNotMatch(JSON.stringify(store.pauseHistory('douyin')), /secret/);
  } finally {store.close();}
});


test('Douyin sync skips only redundant folder lookup and keeps bound owner validation', async () => {
  const store = new Store(':memory:');
  store.apply(snapshot('douyin', [{id:'1',type:'image'}]));
  const svc = new DouyinService(store);
  let verification, folders=0;
  svc.withBrowser = async (fn, verifyScope=true) => {
    verification=verifyScope;
    return fn(async path => {
      if(path==='/aweme/v1/web/collects/list/') {folders++;return {collects_list:[{collects_id_str:'10',collects_name:'myFav',user_id_str:'1',total_number:1}],has_more:0};}
      return {aweme_list:[{aweme_id:'1',aweme_type:68}],has_more:0};
    });
  };
  await svc.sync(); await svc.preparationQueue;
  assert.equal(verification,false); assert.equal(folders,2);
  svc.withBrowser = async fn => fn(async () => ({collects_list:[{collects_id_str:'10',collects_name:'myFav',user_id_str:'other',total_number:1}],has_more:0}));
  await assert.rejects(svc.sync(), /账号已改变/);
  assert.equal(store.currentItems('douyin').length,1);
  svc.withBrowser = async fn => fn(async () => ({collects_list:[{collects_id_str:'other',collects_name:'myFav',user_id_str:'1',total_number:1}],has_more:0}));
  await assert.rejects(svc.sync(), /account_check/);
  assert.equal(requestStage('/aweme/v1/web/collects/list/'),'favorites_folders');
  assert.equal(requestStage('/aweme/v1/web/collects/video/list/'),'favorites_members');
  store.close();
});


test('Douyin visible tab is not ready until native favorites succeeds', async () => {
  const ready=deferred();let closed=0,returned=false;
  const page={waitForResponse:()=>ready.promise,goto:async()=>null,getByText:()=>({waitFor:async()=>{},click:async()=>{}})};
  const browser=async()=>({page,context:{cookies:async()=>[{name:'sessionid',value:'test-only'}]},close:async()=>{closed++;}});
  const opening=openDouyin(true,browser).then(value=>{returned=true;return value;});
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(returned,false);
  ready.resolve({status:()=>200,headers:()=>({}),json:async()=>({status_code:0})});
  const session=await opening;assert.equal(returned,true);assert.equal(closed,0);await session.close();
});

test('Douyin native readiness refusal closes session and retains HTTP diagnostic', async () => {
  let closed=0;
  const page={waitForResponse:async()=>({status:()=>403,headers:()=>({})}),goto:async()=>null,getByText:()=>({waitFor:async()=>{},click:async()=>{}})};
  const browser=async()=>({page,context:{cookies:async()=>[{name:'sessionid',value:'test-only'}]},close:async()=>{closed++;}});
  await assert.rejects(openDouyin(true,browser),error=>error.diagnostic.httpStatus===403&&error.diagnostic.stage==='page_initialization');
  assert.equal(closed,1);
});

test('Douyin readiness timeout closes session without a fake HTTP refusal', async () => {
  let closed=0;
  const page={waitForResponse:async()=>{throw new Error('timeout');},goto:async()=>null,getByText:()=>({waitFor:async()=>{},click:async()=>{}})};
  const browser=async()=>({page,context:{cookies:async()=>[{name:'sessionid',value:'test-only'}]},close:async()=>{closed++;}});
  await assert.rejects(openDouyin(true,browser),error=>!error.platformStop);
  assert.equal(closed,1);
});


test('Douyin readiness accepts both observed native favorites routes only on platform host', async () => {
  const selectors=[];
  const response={status:()=>200,headers:()=>({}),json:async()=>({status_code:0})};
  const page={waitForResponse:async selector=>{selectors.push(selector);return response;},goto:async()=>null,getByText:()=>({waitFor:async()=>{},click:async()=>{}})};
  const session=await openDouyin(true,async()=>({page,context:{cookies:async()=>[{name:'sessionid',value:'test-only'}]},close:async()=>{}}));
  const native=selectors[0];
  assert.equal(native({url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/listcollection/'}),true);
  assert.equal(native({url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/favorite/'}),true);
  assert.equal(native({url:()=> 'https://other.invalid/aweme/v1/web/aweme/favorite/'}),false);
  assert.equal(native({url:()=> 'https://www.douyin.com/aweme/v1/web/notice/count/'}),false);
  await session.close();
});

test('Douyin navigation selects favorites without clicking before hydration', async () => {
  const native=deferred(),profile=deferred();let returned=false,closed=0;
  const page={
    waitForResponse:predicate=>predicate({url:()=> 'https://www.douyin.com/aweme/v1/web/user/profile/self/'})?profile.promise:native.promise,
    goto:async url=>{assert.equal(new URL(url).searchParams.get('showTab'),'favorite_collection');return null;},
    getByText:()=>({waitFor:async()=>{},click:async()=>{assert.fail('already-selected favorites must not be clicked');}}),
  };
  const opening=openDouyin(true,async()=>({page,context:{cookies:async()=>[{name:'sessionid',value:'test-only'}]},close:async()=>{closed++;}})).then(session=>{returned=true;return session;});
  native.resolve({status:()=>200,headers:()=>({}),json:async()=>({status_code:0})});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false);
  profile.resolve({status:()=>200,headers:()=>({}),json:async()=>({status_code:0})});
  const session=await opening;assert.equal(returned,true);await session.close();assert.equal(closed,1);
});
