import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { normalizeXhsNotes, validateNoteUrl, resolveXhsMedia } from '../src/xiaohongshu.js';
import { XiaohongshuService } from '../src/xiaohongshu-service.js';
import { validateAudioUrl } from '../src/transcribe.js';
const board = '111111111111111111111111', image = '222222222222222222222222', video = '333333333333333333333333';

test('Xiaohongshu selected notes keep string IDs and reject duplicate or out-of-scope links', () => {
  assert.equal(normalizeXhsNotes([{ noteId: video, type: 'video', displayTitle: 'title' }])[0].type, 'video');
  assert.equal(normalizeXhsNotes([{ note_id: image, type: 'normal' }])[0].type, 'image');
  assert.throws(() => normalizeXhsNotes([{ noteId: image }, { noteId: image }]));
  assert.throws(() => normalizeXhsNotes([{ noteId: 1 }]));
  assert.equal(validateNoteUrl(`/board/${board}/${video}?xsec_token=test`, board, video), `https://www.xiaohongshu.com/board/${board}/${video}?xsec_token=test`);
  for (const url of [`https://evil.test/board/${board}/${video}`, `/board/${image}/${video}`, `http://www.xiaohongshu.com/board/${board}/${video}`]) assert.throws(() => validateNoteUrl(url, board, video));
  assert.equal(validateAudioUrl('https://sns-video-v2.xhscdn.com/video', 'xiaohongshu'), 'https://sns-video-v2.xhscdn.com/video');
  assert.throws(() => validateAudioUrl('https://xhscdn.com.evil.test/video', 'xiaohongshu'));
  assert.equal(resolveXhsMedia('http://sns-video-v2.xhscdn.com/video'), 'https://sns-video-v2.xhscdn.com/video');
  assert.throws(() => resolveXhsMedia('http://evil.test/video'));
  assert.throws(() => resolveXhsMedia('http://user:pass@sns-video-v2.xhscdn.com/video'));
});

test('Xiaohongshu cached body/audio reads do not leak access links or overwrite other platforms', async () => {
  const store = new Store(':memory:');
  store.apply({ uid: 1, syncedAt: 'now', folders: [{ id: 10, title: 'myFav', items: [{ id: 1, type: 2 }] }] });
  store.apply({ platform: 'xiaohongshu', uid: 'user', syncedAt: 'now', folders: [{ id: board, title: 'myFav', items: [{ id: image, type: 'image' }, { id: video, type: 'video' }] }] });
  const service = new XiaohongshuService(store, 'myFav', async () => { throw new Error('must use cache'); });
  try {
    for (const item of store.currentItems('xiaohongshu')) {
      store.saveSource(item.itemId, `https://www.xiaohongshu.com/board/${board}/${item.id}?xsec_token=test`);
      store.saveContent(item.itemId, { metadata: { ...item, description: 'body' }, sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}`, status: 'text_available', parts: item.type === 'video' ? [{ cid: 1, subtitles: [], status: 'no_subtitles' }] : [], evidence: { kind: 'metadata_and_body', includesVisuals: false, includesAudioTranscription: false } });
      if (item.type === 'video') store.saveTranscript(item.itemId, 1, { language: 'zh', segments: [{ from: 0, to: 1, text: 'audio' }] });
      const result = await service.content(item.itemId);
      assert.equal(result.status, 'text_available');
      assert.equal(result.metadata.description, 'body');
      assert.equal(result.evidence.includesVisuals, false);
      assert.equal(JSON.stringify(result).includes('xsec_token'), false);
      if (item.type === 'video') assert.equal(result.parts[0].source, 'local_whisper');
    }
    assert.equal(store.item('10:2:1').present, true);
    assert.equal(store.updates(0, 10, 'xiaohongshu').events.length, 2);
  } finally { store.close(); }
});
