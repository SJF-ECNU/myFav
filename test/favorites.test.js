import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFavorites, syncFavorites } from '../src/favorites.js';

const item = id => ({ id, type: 2, attr: 0, bvid: `BV${id}`, title: 'test' });
function fixture(pages, count, details = pages.flat()) {
  return async (path, params) => {
    if (path.includes('/folder/')) return { count: 1, list: [{ id: 123, title: 'test', media_count: count, attr: 1 }] };
    if (path.endsWith('/ids')) return pages[params.pn - 1] ?? [];
    return details.filter(item => params.resources.split(',').includes(`${item.id}:${item.type}`));
  };
}
test('member pagination retains missing details and private folder membership', async () => {
  const result = await collectFavorites(fixture([[item(1)], [item(2)]], 2, [item(1)]), 10);
  assert.deepEqual(result.folders[0].items.map(item => item.id), [1, 2]);
  assert.equal(result.folders[0].private, true);
  assert.equal(result.folders[0].items[1].metadataStatus, 'missing');
  assert.equal(result.folders[0].items[1].unavailable, null);
});
test('duplicate member pages fail', async () => {
  await assert.rejects(collectFavorites(fixture([[item(1)], [item(1)]], 2), 10), /重复/);
});
test('incomplete pages and authentication errors leave previous result unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-'));
  const file = join(dir, 'favorites.json');
  try {
    await writeFile(file, 'previous');
    for (const api of [fixture([[item(1)]], 2), async () => { throw new Error('登录失效'); }]) {
      await assert.rejects(syncFavorites(api, 10, file));
      assert.equal(await readFile(file, 'utf8'), 'previous');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('folder count changing during sync fails', async () => {
  const api = fixture([[item(1)]], 1);
  let calls = 0;
  await assert.rejects(collectFavorites(async (path, params) => {
    const result = await api(path, params);
    if (path.includes('/folder/') && ++calls === 2) result.list[0].media_count = 2;
    return result;
  }, 10), /变化/);
});
test('details from outside the requested membership fail', async () => {
  const api = fixture([[item(1)]], 1);
  await assert.rejects(collectFavorites((path, params) => path.endsWith('/infos') ? [item(2)] : api(path, params), 10), /未知/);
});
test('empty account is valid', async () => {
  assert.deepEqual((await collectFavorites(async () => ({ count: 0, list: null }), 10)).folders, []);
});

test('named folder reads only selected resources', async () => {
  const calls = [];
  const api = async (path, params) => {
    calls.push({ path, params });
    if (path.includes('/folder/')) return { count: 2, list: [
      { id: 1, title: 'other', media_count: 10 },
      { id: 2, title: 'myFav', media_count: 1 },
    ] };
    if (path.endsWith('/ids')) return [item(100)];
    return [item(100)];
  };
  const result = await collectFavorites(api, 10, 'myFav');
  assert.deepEqual(result.folders.map(folder => folder.id), [2]);
  assert.ok(calls.filter(call => call.path.endsWith('/ids')).every(call => call.params.media_id === 2));
});

test('missing or ambiguous folder fails before reading any contents', async () => {
  for (const list of [[{ id: 1, title: 'other' }], [{ id: 1, title: 'myFav' }, { id: 2, title: 'myFav' }]]) {
    const calls = [];
    await assert.rejects(collectFavorites(async path => {
      calls.push(path);
      return { count: list.length, list };
    }, 10, 'myFav'), /未找到|重名/);
    assert.ok(calls.every(path => path.includes('/folder/')));
  }
});
