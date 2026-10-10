import { checkResponse, checkChallenge } from './platform-access.js';
import { openSession } from './browser-session.js';
import { validateAudioUrl } from './transcribe.js';

export async function openXiaohongshu() {
  const { context, page, close } = await openSession('xiaohongshu', true);
  try {
    const navigation = await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (navigation) checkResponse(navigation.status(), navigation.headers()['retry-after'], '', 'navigation');
    checkChallenge(page);
    await page.waitForFunction(() => {
      const s = window.__INITIAL_STATE__?.user?.userInfo; const u = s?.value ?? s;
      return Boolean(u);
    }, null, { timeout: 15000 });
    const loggedIn = await page.evaluate(() => {
      const value = window.__INITIAL_STATE__?.user?.userInfo;
      const user = value?.value ?? value;
      return Boolean(user && !user.guest && user.userId);
    });
    if (!loggedIn) checkResponse(0, null, '未登录', 'session_check');
    return { context, page, close };
  } catch (error) { await close(); checkChallenge(page); if (error.platformStop) throw error; throw new Error('小红书登录或网页当前不可用'); }
}
export function validateNoteUrl(value, boardId, noteId) {
  const u = new URL(value, 'https://www.xiaohongshu.com');
  if (u.origin !== 'https://www.xiaohongshu.com' || u.username || u.password || u.pathname !== `/board/${boardId}/${noteId}`) throw new Error('小红书笔记链接异常');
  return u.href;
}
export function resolveXhsMedia(value) {
  const url = new URL(value);
  if (url.protocol === 'http:' && url.hostname.endsWith('.xhscdn.com')) url.protocol = 'https:';
  return validateAudioUrl(url.href, 'xiaohongshu');
}
export function normalizeXhsNotes(notes) {
  const ids = new Set();
  return notes.map(n => {
    const id = n.noteId ?? n.note_id;
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || ids.has(id)) throw new Error('小红书笔记ID重复或异常');
    ids.add(id);
    return { id, type: n.type === 'video' ? 'video' : 'image', title: n.displayTitle ?? n.display_title ?? '', author: n.user?.nickname ?? null, metadataStatus: 'available' };
  });
}
export async function readXhsBoards(page, uid) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sns/web/v1/board/user', { timeout: 15000 }).catch(() => null);
  await page.goto(`https://www.xiaohongshu.com/user/profile/${uid}?tab=fav&subTab=board`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const r = await response;
  if (r) {
    checkResponse(r.status?.(), r.headers?.()['retry-after'], '', 'favorites_api');
    const b = await r.json();
    checkResponse(r.status?.(), null, b.message || b.msg, 'favorites_api');
    if (b.code !== 0 || !Array.isArray(b.data?.boards) || b.data.boards.length !== b.data.board_count) throw new Error('小红书专辑列表不完整');
    return b.data.boards;
  }
  return page.evaluate(() => {
    const b = window.__INITIAL_STATE__?.board?.userBoardList;
    const list = b?.value ?? b;
    if (!Array.isArray(list) || !list.length) throw new Error('小红书专辑不可读取');
    return list;
  });
}
export async function collectXiaohongshu(page, folderName = 'myFav', expectedUid) {
  const uid = await page.evaluate(() => {
    const s = window.__INITIAL_STATE__.user.userInfo; return (s.value ?? s).userId;
  });
  if (expectedUid && uid !== expectedUid) throw new Error('小红书账号已改变');
  const matches = (await readXhsBoards(page, uid)).filter(b => b.name === folderName);
  if (matches.length !== 1) throw new Error('小红书指定专辑不存在或重名');
  const board = matches[0];
  await page.goto(`https://www.xiaohongshu.com/board/${board.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const state = () => page.evaluate(id => {
    const b = window.__INITIAL_STATE__?.board, unwrap = x => x?.value ?? x;
    return { details: unwrap(b?.boardDetails), feed: unwrap(b?.boardFeedsMap)?.[id] };
  }, board.id);
  await page.waitForFunction(id => {
    const b = window.__INITIAL_STATE__?.board, m = b?.boardFeedsMap;
    return (m?.value ?? m)?.[id];
  }, board.id, { timeout: 15000 });
  let current = await state(); const cursors = new Set();
  while (current.feed.hasMore) {
    if (cursors.has(current.feed.cursor)) throw new Error('小红书分页重复');
    cursors.add(current.feed.cursor);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sns/web/v1/board/note', { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const r = await response;
    checkResponse(r.status?.(), r.headers?.()['retry-after'], '', 'favorites_api');
    const data = await r.json();
    checkResponse(r.status?.(), null, data.message || data.msg, 'favorites_api');
    if (data.code !== 0 || !Array.isArray(data.data?.notes)) throw new Error('小红书分页读取失败');
    await page.waitForFunction(({ id, length }) => {
      const m = window.__INITIAL_STATE__.board.boardFeedsMap;
      return (m.value ?? m)[id].notes.length > length;
    }, { id: board.id, length: current.feed.notes.length }, { timeout: 10000 });
    current = await state();
  }
  const items = normalizeXhsNotes(current.feed.notes);
  if (current.details?.id !== board.id || current.details.name !== folderName || items.length !== board.total) throw new Error('小红书专辑计数不完整');
  const sources = await page.locator(`a[href*="/board/${board.id}/"]`).evaluateAll((links, { id, items }) => items.map(item => {
    const link = links.find(a => new URL(a.href).pathname === `/board/${id}/${item.id}`);
    return { id: item.id, url: link?.href };
  }), { id: board.id, items });
  for (const source of sources) validateNoteUrl(source.url, board.id, source.id);
  const final = (await readXhsBoards(page, uid)).find(b => b.id === board.id);
  if (final?.total !== board.total || final?.name !== folderName) throw new Error('小红书专辑同步期间变化');
  return { snapshot: { platform: 'xiaohongshu', uid, syncedAt: new Date().toISOString(), folders: [{ id: board.id, title: folderName, items }] }, sources };
}
export async function readXhsNote(page, url, item) {
  validateNoteUrl(url, item.itemId.split(':')[1], item.id);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(id => {
    const m = window.__INITIAL_STATE__?.note?.noteDetailMap;
    return (m?.value ?? m)?.[id]?.note?.noteId === id;
  }, item.id, { timeout: 15000 });
  return page.evaluate(id => {
    const m = window.__INITIAL_STATE__.note.noteDetailMap;
    const n = (m.value ?? m)[id].note;
    const stream = Object.values(n.video?.media?.stream ?? {}).flat().find(s => s.masterUrl);
    return { description: n.desc ?? '', title: n.title ?? '', type: n.type, mediaUrl: stream?.masterUrl, duration: n.video?.capa?.duration, images: (n.imageList ?? []).map(image => ({ url: image.urlDefault || image.urlPre || image.infoList?.[0]?.url, kind: n.type === 'video' ? 'cover' : 'image' })) };
  }, item.id);
}
