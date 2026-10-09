import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Access, RateLimit } from '../src/access.js';
import { Store } from '../src/store.js';
import { PlatformService } from '../src/platform-service.js';
import { createApp } from '../src/mcp.js';

export async function connect(url, token) {
  const client = new Client({ name: 'access-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
function fixture() {
  const store = new Store(':memory:');
  store.apply({ uid: 1, syncedAt: new Date().toISOString(), folders: [{ id: 10, title: 'myFav', items: [{ id: 1, type: 2, bvid: 'BV1', title: 'PRIVATE FAVORITE TITLE' }] }] });
  let preparations = 0;
  const service = new PlatformService(store, { bilibili: { content: async () => { preparations++; throw Error('must not prepare'); } } });
  service.sync = async () => { preparations++; return { added: 0 }; };
  return { store, service, count: () => preparations };
}
async function listen(service, options) {
  const hosts = ['temporary'];
  const server = createApp(service, { ...options, allowedHosts: hosts }).listen(0, '127.0.0.1');
  await once(server, 'listening'); hosts[0] = `127.0.0.1:${server.address().port}`;
  return { server, url: new URL(`http://${hosts[0]}/mcp`) };
}

test('credential revocation, rotation and scope changes apply across connections; shared fallback stays disabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-access-')), file = join(dir, 'access.sqlite');
  const admin = new Access(file), worker = new Access(file), old = 'shared-test-credential-long-enough-123456';
  try {
    assert.equal(worker.authenticate(`Bearer ${old}`, old).id, 'legacy');
    const token = admin.add('reader', ['read']);
    assert.equal(worker.authenticate(`Bearer ${old}`, old), null);
    assert.deepEqual(worker.authenticate(`Bearer ${token}`).scopes, ['read']);
    admin.setScopes('reader', ['read', 'write']);
    assert.deepEqual(worker.authenticate(`Bearer ${token}`).scopes, ['read', 'write']);
    const replacement = admin.rotate('reader');
    assert.equal(worker.authenticate(`Bearer ${token}`), null);
    assert.equal(worker.authenticate(`Bearer ${replacement}`).id, 'reader');
    admin.revoke('reader');
    assert.equal(worker.authenticate(`Bearer ${replacement}`), null);
    assert.equal(worker.authenticate(`Bearer ${old}`, old), null);
    assert(!JSON.stringify(admin.list()).includes(replacement));
    assert.throws(() => admin.add('../invalid', ['read']));
    assert.throws(() => admin.add('bad', ['admin']));
  } finally { admin.close(); worker.close(); await rm(dir, { recursive: true, force: true }); }
});

test('real SDK enforces scopes, reads cached transcripts without preparation, revokes immediately and never audits secrets', async () => {
  const access = new Access(), { store, service, count } = fixture();
  const read = access.add('reader', ['read']), write = access.add('writer', ['write']);
  const { server, url } = await listen(service, { access, allowedOrigins: ['https://agent.example.test'] });
  let reader, writer;
  try {
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://agent.example.test' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://agent.example.test');
    assert.equal((await fetch(url, { headers: { Origin: 'https://other.example.test', Authorization: `Bearer ${read}` } })).status, 403);
    reader = await connect(url, read); writer = await connect(url, write);
    assert.deepEqual((await reader.listTools()).tools.map(t => t.name), ['list_updates', 'get_content', 'get_result']);
    assert.equal((await reader.callTool({ name: 'get_content', arguments: { itemId: '10:2:1' } })).structuredContent.status, 'metadata_only');
    store.saveContent('10:2:1', { metadata: {}, parts: [{ cid: 1, status: 'no_subtitles' }], evidence: { includesVisuals: false } });
    store.saveTranscript('10:2:1', 1, { language: 'zh', segments: [{ text: 'PRIVATE TRANSCRIPT', from: 0, to: 1 }] });
    assert.equal((await reader.callTool({ name: 'get_content', arguments: { itemId: '10:2:1' } })).structuredContent.parts[0].subtitles[0].text, 'PRIVATE TRANSCRIPT');
    assert.equal(count(), 0);
    await assert.rejects(reader.callTool({ name: 'sync_favorites', arguments: {} }));
    await assert.rejects(reader.callTool({ name: 'save_result', arguments: { itemId: '10:2:1', summary: 'PRIVATE SUMMARY' } }));
    await writer.callTool({ name: 'save_result', arguments: { itemId: '10:2:1', summary: 'PRIVATE SUMMARY' } });
    await assert.rejects(writer.callTool({ name: 'get_result', arguments: { itemId: '10:2:1' } }));
    await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${read}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'SECRET TOOL NAME', arguments: { private: 'PRIVATE ARGS' } } }) });
    await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${read}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: { toString: null }, arguments: {} } }) });
    assert.equal((await reader.listTools()).tools.length, 3);
    access.revoke('reader');
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${read}` } })).status, 401);
    await writer.callTool({ name: 'set_processing_status', arguments: { itemId: '10:2:1', status: 'completed' } });
    const audit = JSON.stringify(access.audits());
    for (const secret of [read, write, 'SECRET TOOL NAME', 'PRIVATE ARGS', 'PRIVATE FAVORITE TITLE', 'PRIVATE TRANSCRIPT', 'PRIVATE SUMMARY']) assert(!audit.includes(secret));
    assert(access.audits().some(row => row.agent === 'writer' && row.tool === 'save_result' && row.outcome === 'ok'));
    assert(access.audits().some(row => row.outcome === 'denied'));
  } finally { await reader?.close(); await writer?.close(); await new Promise(resolve => server.close(resolve)); store.close(); access.close(); }
});

test('per-agent HTTP rate limits stay isolated and expire; repeated preparation batches cannot queue', async () => {
  let now = 0; const limiter = new RateLimit(1, () => now);
  assert.equal(limiter.take('one'), 0); assert.equal(limiter.take('one'), 60);
  assert.equal(limiter.take('two'), 0); now = 60000; assert.equal(limiter.take('one'), 0);
  const access = new Access(), { store, service, count } = fixture();
  const prepare = access.add('worker', ['read', 'prepare']);
  let release; const pending = new Promise(resolve => { release = resolve; });
  service.drain = () => pending;
  const { server, url } = await listen(service, { access }); let client;
  try {
    client = await connect(url, prepare);
    assert.equal((await client.callTool({ name: 'sync_favorites', arguments: {} })).isError, undefined);
    assert.equal((await client.callTool({ name: 'sync_favorites', arguments: {} })).isError, true);
    assert.equal((await client.callTool({ name: 'get_content', arguments: { itemId: '10:2:1' } })).structuredContent.status, 'metadata_only');
    assert.equal(count(), 1);
    release(); await new Promise(resolve => setImmediate(resolve));
    await client.callTool({ name: 'sync_favorites', arguments: {} }); assert.equal(count(), 2);
  } finally { release(); await client?.close(); await new Promise(resolve => server.close(resolve)); store.close(); access.close(); }
  const limited = new Access(), one = limited.add('one', ['read']), two = limited.add('two', ['read']);
  const { store: s, service: svc } = fixture(); const started = await listen(svc, { access: limited, rateLimit: 1 });
  try {
    assert.equal((await fetch(started.url, { headers: { Authorization: `Bearer ${one}` } })).status, 405);
    const denied = await fetch(started.url, { headers: { Authorization: `Bearer ${one}` } });
    assert.equal(denied.status, 429); assert(denied.headers.get('retry-after'));
    assert.equal((await fetch(started.url, { headers: { Authorization: `Bearer ${two}` } })).status, 405);
  } finally { await new Promise(resolve => started.server.close(resolve)); limited.close(); s.close(); }
});
