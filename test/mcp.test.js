import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/mcp.js';
import { extractContent, validateSubtitleUrl } from '../src/service.js';

const snapshot = ids => ({ uid: 1, syncedAt: new Date().toISOString(), folders: [{
  id: 10, title: 'myFav', items: ids.map(id => ({ id, type: 2, bvid: `BV${id}`, title: 'test', metadataStatus: 'available' })),
}] });
test('updates are durable, paginated and deduplicated; result survives restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-store-'));
  const file = join(dir, 'data.sqlite');
  let store = new Store(file);
  try {
    assert.equal(store.apply(snapshot([1, 2])).added, 2);
    assert.equal(store.apply(snapshot([1, 2])).added, 0);
    const first = store.updates(0, 1);
    assert.equal(first.hasMore, true);
    assert.equal(store.updates(first.nextCursor, 1).events.length, 1);
    store.saveResult('10:2:1', { summary: 'test', artifacts: [] });
    store.setStatus('10:2:1', 'completed');
    store.close(); store = new Store(file);
    assert.equal(store.getResult('10:2:1').result.summary, 'test');
    assert.equal(store.getResult('10:2:1').status, 'completed');
    store.apply(snapshot([2]));
    assert.equal(store.item('10:2:1').present, false);
    assert.equal(store.apply(snapshot([1, 2])).added, 1);
    assert.equal(store.getResult('10:2:1').result.summary, 'test');
    const before = store.status();
    assert.throws(() => store.apply({ ...snapshot([1]), uid: 2 }), /账号/);
    assert.deepEqual(store.status(), before);
    assert.throws(() => store.setStatus('unknown', 'completed'), /未知/);
    assert.throws(() => store.setStatus('10:2:1', 'invalid'), /无效/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('content distinguishes partial subtitles, metadata and unsafe subtitle URLs', async () => {
  const item = { present: true, type: 2, bvid: 'BV1' };
  const api = async (path, params) => path.includes('/view') ? { desc: 'test', pages: [{ page: 1, cid: 1 }, { page: 2, cid: 2 }] }
    : { subtitle: { subtitles: params.cid === 1 ? [{ lan: 'zh-CN', subtitle_url: '//i0.hdslb.com/test' }] : [] } };
  const content = await extractContent(api, async () => ({ body: [{ from: 0, to: 1, content: 'test' }] }), item);
  assert.equal(content.status, 'partial');
  assert.equal(content.parts[1].status, 'no_subtitles');
  assert.equal(content.evidence.includesVisuals, false);
  assert.equal((await extractContent(async () => { throw new Error('412'); }, null, item)).status, 'metadata_only');
  for (const url of ['http://i0.hdslb.com/x', 'https://hdslb.com.evil.test/x', 'https://127.0.0.1/x', 'https://user@i0.hdslb.com/x']) assert.throws(() => validateSubtitleUrl(url));
});

test('real SDK HTTP protocol exposes seven tools, rejects auth/host/origin and validates writes', async () => {
  const store = new Store(':memory:');
  const service = { store, sync: async () => store.apply(snapshot([1])), content: async id => ({ metadata: store.item(id), status: 'metadata_only' }) };
  const token = 'test-only-credential-not-production-12345';
  const allowedHosts = ['temporary'];
  const server = createApp(service, { token, allowedHosts }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  allowedHosts[0] = `127.0.0.1:${port}`;
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const client = new Client({ name: 'test', version: '1' });
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.test' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal((await client.listTools()).tools.length, 7);
    assert.equal((await client.callTool({ name: 'sync_favorites', arguments: {} })).structuredContent.added, 1);
    const updates = await client.callTool({ name: 'list_updates', arguments: {} });
    const itemId = updates.structuredContent.events[0].item.itemId;
    assert.equal((await client.callTool({ name: 'get_content', arguments: { itemId } })).structuredContent.status, 'metadata_only');
    await client.callTool({ name: 'set_processing_status', arguments: { itemId, status: 'processing' } });
    await client.callTool({ name: 'save_result', arguments: { itemId, summary: 'tested', artifacts: ['https://example.com/result'] } });
    assert.equal((await client.callTool({ name: 'get_result', arguments: { itemId } })).structuredContent.result.summary, 'tested');
    assert.equal((await client.callTool({ name: 'get_result', arguments: { itemId: 'unknown' } })).isError, true);
    assert.equal((await client.callTool({ name: 'set_processing_status', arguments: { itemId, status: 'wrong' } })).isError, true);
    assert.equal((await client.callTool({ name: 'sync_favorites', arguments: {} })).structuredContent.added, 0);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); store.close(); }
});

test('missing subtitles start one asynchronous transcription and persist reusable text', async () => {
  const { FavoriteService } = await import('../src/service.js');
  const store = new Store(':memory:'); store.apply(snapshot([1]));
  let transcriptions = 0;
  const service = new FavoriteService(store, 'myFav', null, async () => {
    transcriptions++;
    return { language: 'zh', segments: [{ from: 0, to: 1, text: 'transcribed' }] };
  });
  service.withBrowser = async fn => fn(async path => {
    if (path.includes('/view')) return { pages: [{ page: 1, cid: 5 }] };
    if (path.includes('/playurl')) return { dash: { audio: [{ baseUrl: 'https://test.bilivideo.com/audio' }] } };
    return { subtitle: { subtitles: [] } };
  }, {});
  try {
    assert.equal((await service.content('10:2:1')).status, 'transcription_pending');
    await service.transcriptionQueue;
    const content = await service.content('10:2:1');
    assert.equal(content.status, 'text_available');
    assert.equal(content.evidence.includesAudioTranscription, true);
    assert.equal(content.parts[0].source, 'local_whisper');
    assert.equal(transcriptions, 1);
    assert.equal(store.transcript('10:2:1', 5).segments[0].text, 'transcribed');
  } finally { store.close(); }
});

test('sync prepares subtitles and audio in background; cached content survives restart without browser', async () => {
  const { FavoriteService } = await import('../src/service.js');
  const dir = await mkdtemp(join(tmpdir(), 'myfav-prefetch-'));
  const file = join(dir, 'data.sqlite');
  let store = new Store(file);
  let audioRuns = 0, browserRuns = 0;
  let finishAudio, audioStarted;
  const started = new Promise(resolve => { audioStarted = resolve; });
  const audio = new Promise(resolve => { finishAudio = resolve; });
  const service = new FavoriteService(store, 'myFav', null, async () => {
    audioRuns++; audioStarted(); await audio;
    return { language: 'zh', segments: [{ from: 0, to: 1, text: 'prepared audio' }] };
  });
  const api = async (path, params) => {
    if (path.endsWith('/nav')) return { isLogin: true, mid: 1 };
    if (path.includes('/folder/')) return { count: 1, list: [{ id: 10, title: 'myFav', media_count: 2 }] };
    if (path.endsWith('/ids')) return [{ id: 1, type: 2 }, { id: 2, type: 2 }];
    if (path.endsWith('/infos')) return snapshot([1, 2]).folders[0].items;
    if (path.endsWith('/view')) return { desc: 'video description', pages: [{ page: 1, cid: params.bvid === 'BV1' ? 1 : 2 }] };
    if (path.endsWith('/playurl')) return { dash: { audio: [{ baseUrl: 'https://test.bilivideo.com/audio' }] } };
    return { subtitle: { subtitles: params.cid === 1 ? [{ lan: 'zh', subtitle_url: 'https://i0.hdslb.com/subtitle' }] : [] } };
  };
  service.withBrowser = async fn => { browserRuns++; return fn(api, { evaluate: async () => ({ body: [{ from: 0, to: 1, content: 'prepared subtitle' }] }) }); };
  try {
    assert.equal((await service.sync()).added, 2);
    await service.preparationQueue;
    await started;
    assert.equal(audioRuns, 1);
    const before = browserRuns;
    assert.equal((await service.content('10:2:1')).parts[0].source, 'platform_subtitles');
    assert.equal(browserRuns, before);
    assert.equal((await service.content('10:2:2')).status, 'transcription_pending');
    finishAudio(); await service.transcriptionQueue;
    await service.sync(); await service.preparationQueue;
    assert.equal(audioRuns, 1);
    store.close(); store = new Store(file);
    const restarted = new FavoriteService(store, 'myFav', async () => { throw new Error('browser must not open'); });
    store.setStatus('10:2:1', 'completed');
    const subtitle = await restarted.content('10:2:1');
    assert.equal(subtitle.metadata.status, 'completed');
    assert.equal(subtitle.parts[0].subtitles[0].text, 'prepared subtitle');
    assert.equal((await restarted.content('10:2:2')).parts[0].subtitles[0].text, 'prepared audio');
    store.apply(snapshot([2]));
    assert.equal((await restarted.content('10:2:1')).status, 'metadata_only');
  } finally { finishAudio(); await service.transcriptionQueue; store.close(); await rm(dir, { recursive: true, force: true }); }
});
