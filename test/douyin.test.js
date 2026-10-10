import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { collectDouyin } from '../src/douyin.js';
import { DouyinService, parseCaptions } from '../src/douyin-service.js';
import { validateAudioUrl } from '../src/transcribe.js';
import { PlatformService } from '../src/platform-service.js';
const dy = ids => ({ platform: 'douyin', uid: '99999999999999999', syncedAt: 'now', folders: [{ id: '20', title: 'myFav', items: ids.map(id => ({ id, type: 'video', title: 'test' })) }] });

test('legacy Bilibili database migrates without losing IDs, results, text or cursor; platforms stay isolated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myfav-migration-')), path = join(dir, 'data.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE scope(id INTEGER PRIMARY KEY CHECK(id=1),uid INTEGER,folder_id INTEGER,folder_name TEXT,synced_at TEXT);
    CREATE TABLE items(id TEXT PRIMARY KEY,data TEXT NOT NULL,present INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT NOT NULL DEFAULT '',result TEXT);
    CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,item_id TEXT NOT NULL REFERENCES items(id),created_at TEXT NOT NULL);
    INSERT INTO scope VALUES(1,1,10,'myFav','then');
    INSERT INTO items VALUES('10:2:1','{"id":1,"type":2}',1,'completed','','{"summary":"kept"}');
    INSERT INTO events VALUES(1,'10:2:1','then');`);
  old.close(); let store = new Store(path);
  try {
    store.saveContent('10:2:1', { text: 'kept text' });
    assert.equal(store.apply(dy(['90071992547409933'])).added, 1);
    assert.equal(store.item('10:2:1').present, true);
    assert.equal(store.getResult('10:2:1').result.summary, 'kept');
    assert.equal(store.content('10:2:1').text, 'kept text');
    assert.equal(store.updates(0, 50, 'douyin').events[0].item.id, '90071992547409933');
    assert.equal(store.updates(0, 50, 'bilibili').events.length, 1);
    assert.equal(store.apply(dy([])).count, 0);
    assert.equal(store.item('10:2:1').present, true);
    assert.throws(() => store.apply({ ...dy([]), uid: 'different' }), /账号/);
    store.close(); store = new Store(path);
    assert.equal(store.status().scope.folder_id, '10');
    assert.equal(store.status().cursor, 2);
    assert.equal(store.getResult('10:2:1').status, 'completed');
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('selected Douyin collection completes pagination; duplicate, incomplete and changed pages fail', async () => {
  const makeApi = mode => async (path, params) => {
    if (path.includes('/collects/list/')) return { collects_list: [{ collects_name: 'myFav', collects_id_str: '20', user_id_str: '99', total_number: mode === 'count' ? 3 : 2 }, { collects_name: 'other', collects_id_str: '21' }], has_more: 0 };
    assert.equal(params.collects_id, '20');
    const id = params.cursor === 0 || mode === 'duplicate' ? '90071992547409933' : '90071992547409934';
    return { aweme_list: mode === 'empty' && params.cursor !== 0 ? [] : [{ aweme_id: id, aweme_type: 0, video: { duration: 1000 } }], cursor: 20, has_more: params.cursor === 0 ? 1 : 0 };
  };
  assert.equal((await collectDouyin(makeApi('ok'))).folders[0].items.length, 2);
  for (const mode of ['duplicate', 'empty', 'count']) await assert.rejects(collectDouyin(makeApi(mode)));
  await assert.rejects(collectDouyin(makeApi('ok'), 'missing'));
  await assert.rejects(collectDouyin(makeApi('ok'), 'myFav', 'wrong'));
});

test('Douyin original video audio starts asynchronously, caches, routes and does not use music', async () => {
  const store = new Store(':memory:'); store.apply(dy(['90071992547409933']));
  const id = store.currentItems('douyin')[0].itemId;
  let transcriptions = 0;
  const service = new DouyinService(store, 'myFav', null, async url => {
    assert.equal(url, 'https://test.douyinvod.com/video'); transcriptions++;
    return { language: 'zh', segments: [{ from: 0, to: 1, text: 'prepared' }] };
  });
  service.withBrowser = async fn => fn(async () => ({ aweme_detail: { video: { play_addr: { url_list: ['https://test.douyinvod.com/video'] } }, music: { play_url: { url_list: ['https://test.douyinvod.com/music'] } } } }), {});
  try {
    const router = new PlatformService(store, { douyin: service, bilibili: { sync: async () => { throw new Error('unavailable'); } } });
    assert.equal((await router.content(id)).status, 'transcription_pending');
    await service.transcriptionQueue;
    service.withBrowser = async () => { throw new Error('cached reads must not open browser'); };
    const result = await router.content(id);
    assert.equal(result.parts[0].subtitles[0].text, 'prepared');
    assert.equal(result.evidence.includesVisuals, false);
    assert.equal(transcriptions, 1);
    assert.equal((await router.sync('all')).platforms.every(p => p.status === 'failed'), true);
  } finally { store.close(); }
});

test('caption parsing and platform media domain boundaries', () => {
  assert.deepEqual(parseCaptions('WEBVTT\n\n00:00.100 --> 00:01.200\nhello'), [{ from: 0.1, to: 1.2, text: 'hello' }]);
  assert.throws(() => parseCaptions('not subtitles'));
  assert.equal(validateAudioUrl('https://test.douyinvod.com/video', 'douyin'), 'https://test.douyinvod.com/video');
  for (const url of ['http://test.douyinvod.com/x', 'https://douyinvod.com.evil.test/x', 'https://127.0.0.1/x', 'https://test.bilivideo.com/x']) assert.throws(() => validateAudioUrl(url, 'douyin'));
  assert.throws(() => validateAudioUrl('https://test.douyinvod.com/x'));
});

test('Douyin only accounts for scoped prior members with matching explicit unavailability evidence', async () => {
  const prior=[{id:'2',type:'image',title:'old',platform:'douyin',itemId:'douyin:20:image:2',present:true}];
  const makeApi=mode=>{let lists=0;return async(path,params)=>{
    if(path.includes('/collects/list/'))return {collects_list:[{collects_name:'myFav',collects_id_str:'20',user_id_str:'99',total_number:mode==='changed'&&++lists>1?3:2}],has_more:0};
    if(path.includes('/collects/video/list/'))return {aweme_list:[{aweme_id:'1',aweme_type:0}],has_more:0};
    assert.equal(params.aweme_id,'2');
    if(mode==='denied')throw Object.assign(new Error('denied'),{platformStop:true});
    return {aweme_detail:mode==='available'?{aweme_id:'2'}:null,filter_detail:{aweme_id:mode==='wrongId'?'3':'2',filter_reason:mode==='unknown'?'unknown':'status_deleted'}};
  };};
  const result=await collectDouyin(makeApi('ok'),'myFav','99','20',prior);
  assert.equal(result.folders[0].items.length,2);
  assert.equal(result.folders[0].items[1].metadataStatus,'unavailable');
  assert.equal(result.folders[0].items[1].membershipStatus,'previously_confirmed');
  for(const mode of ['wrongId','unknown','denied','changed','available'])await assert.rejects(collectDouyin(makeApi(mode),'myFav','99','20',prior));
  await assert.rejects(collectDouyin(makeApi('ok'),'myFav','99','20',[]));
  await assert.rejects(collectDouyin(makeApi('ok'),'myFav','99','20',[{...prior[0],itemId:'douyin:21:image:2'}]));
});
