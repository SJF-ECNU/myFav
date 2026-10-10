import test from 'node:test';
import assert from 'node:assert/strict';
import { openSession } from '../src/browser-session.js';

test('browser configuration fails explicitly without leaking endpoints', async () => {
  for (const env of [{ MYFAV_BROWSER: 'unknown' }, { MYFAV_BROWSER: 'chromium' },
    { MYFAV_BROWSER: 'cdp' }, { MYFAV_BROWSER: 'cdp', MYFAV_CDP_URL: 'file:///private' }]) {
    await assert.rejects(openSession('bilibili', true, { env }));
  }
  await assert.rejects(openSession('bilibili', true, {
    env: { MYFAV_BROWSER: 'cdp', MYFAV_CDP_URL: 'https://browser.invalid/?token=secret' },
    engine: { connectOverCDP: async () => { throw new Error('token=secret'); } },
  }), error => error.message.includes('CDP') && !error.message.includes('secret'));
});

test('CDP cleanup owns only its work page, disconnects once and preserves shared context', async () => {
  let pageClosed = 0, disconnected = 0;
  const page = { isClosed: () => false, close: async () => { pageClosed++; } };
  const context = { newPage: async () => page, close: async () => assert.fail('shared context closed') };
  const engine = { connectOverCDP: async (_url, options) => {
    assert.equal(options.noDefaults, true);
    return { contexts: () => [context], close: async () => { disconnected++; } };
  } };
  const session = await openSession('douyin', false, { env: { MYFAV_BROWSER: 'cdp', MYFAV_CDP_URL: 'http://localhost:9222' }, engine });
  assert.equal(session.context, context);
  await session.close(); await session.close();
  assert.equal(pageClosed, 1); assert.equal(disconnected, 1);
});

test('failed CDP page creation disconnects without closing external context', async () => {
  let disconnected = 0;
  const engine = { connectOverCDP: async () => ({
    contexts: () => [{ newPage: async () => { throw Error('private'); }, close: () => assert.fail() }],
    close: async () => { disconnected++; },
  }) };
  await assert.rejects(openSession('xiaohongshu', true, { env: { MYFAV_BROWSER: 'cdp', MYFAV_CDP_URL: 'http://localhost:9222' }, engine }), /CDP/);
  assert.equal(disconnected, 1);
});

test('all platform services release sessions through their owned close function', async () => {
  const { FavoriteService } = await import('../src/service.js');
  const { DouyinService } = await import('../src/douyin-service.js');
  const { XiaohongshuService } = await import('../src/xiaohongshu-service.js');
  for (const Service of [FavoriteService, DouyinService, XiaohongshuService]) {
    let released = 0;
    const service = new Service({ assertPlatform() {}, platformPause() {}, status() { return {}; } }, 'myFav', async () => ({
      context: { close: () => assert.fail('external context closed') }, page: {},
      close: async () => { released++; },
    }));
    assert.equal(await service.withBrowser(async () => 'ok'), 'ok');
    await assert.rejects(service.withBrowser(async () => { throw Error('fixture'); }), /fixture/);
    assert.equal(released, 2);
  }
});
