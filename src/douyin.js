import { openSession } from './browser-session.js';

export async function openDouyin(headless = true) {
  const { context, page, close } = await openSession('douyin', headless);
  try {
    await page.goto('https://www.douyin.com/user/self?showTab=favorite_collection', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText('收藏夹', { exact: true }).waitFor({ timeout: 30000 });
    return { context, page, close };
  } catch { await close(); throw new Error('抖音登录或网页当前不可用'); }
}
export function douyinApi(page) {
  let previous = 0;
  return async (path, params = {}) => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - previous))));
    previous = Date.now();
    const result = await page.evaluate(async ({ path, params }) => {
      const query = new URLSearchParams({ device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', ...params });
      const response = await fetch(`${path}?${query}`, { credentials: 'include', signal: AbortSignal.timeout(30000) });
      if (!response.ok) return { http: response.status };
      try { return { body: await response.json() }; } catch { return { invalid: true }; }
    }, { path, params });
    if (result.http || result.invalid || result.body?.status_code !== 0) throw new Error('抖音接口当前不可用');
    return result.body;
  };
}
export async function listDouyinFolders(api) {
  const folders = [], cursors = new Set(); let cursor = 0;
  for (;;) {
    if (cursors.has(String(cursor))) throw new Error('抖音收藏夹分页重复');
    cursors.add(String(cursor));
    const data = await api('/aweme/v1/web/collects/list/', { cursor, count: 20 });
    if (!Array.isArray(data.collects_list) || ![0, 1, false, true].includes(data.has_more)) throw new Error('抖音收藏夹格式异常');
    for (const folder of data.collects_list) {
      if (!folder.collects_id_str || folders.some(f => f.collects_id_str === folder.collects_id_str)) throw new Error('抖音收藏夹ID重复或缺失');
      folders.push(folder);
    }
    if (!data.has_more) return folders;
    if (!data.collects_list.length || data.cursor == null) throw new Error('抖音收藏夹分页不完整');
    cursor = data.cursor;
  }
}
export async function collectDouyin(api, folderName = 'myFav', expectedUid) {
  const matches = (await listDouyinFolders(api)).filter(f => f.collects_name === folderName);
  if (matches.length !== 1) throw new Error('抖音指定收藏夹不存在或重名');
  const folder = matches[0], uid = folder.user_id_str;
  if (!uid || (expectedUid && String(expectedUid) !== uid)) throw new Error('抖音登录账号已改变或无法确定');
  if (!Number.isInteger(folder.total_number)) throw new Error('抖音收藏夹计数异常');
  const items = [], ids = new Set(), cursors = new Set(); let cursor = 0;
  for (;;) {
    if (cursors.has(String(cursor))) throw new Error('抖音作品分页重复');
    cursors.add(String(cursor));
    const data = await api('/aweme/v1/web/collects/video/list/', { collects_id: folder.collects_id_str, cursor, count: 20 });
    if (!Array.isArray(data.aweme_list) || ![0, 1, false, true].includes(data.has_more)) throw new Error('抖音作品格式异常');
    for (const video of data.aweme_list) {
      if (typeof video.aweme_id !== 'string' || !/^\d+$/.test(video.aweme_id) || ids.has(video.aweme_id)) throw new Error('抖音作品ID重复或无效');
      ids.add(video.aweme_id);
      items.push({ id: video.aweme_id, type: video.aweme_type === 68 ? 'image' : 'video', title: video.desc ?? '', description: video.desc ?? '', author: video.author?.nickname ?? null, duration: (video.video?.duration ?? 0) / 1000, metadataStatus: 'available' });
    }
    if (!data.has_more) break;
    if (!data.aweme_list.length || data.cursor == null) throw new Error('抖音作品分页不完整');
    cursor = data.cursor;
  }
  const current = (await listDouyinFolders(api)).find(f => f.collects_id_str === folder.collects_id_str);
  if (items.length !== folder.total_number || current?.total_number !== folder.total_number || current?.collects_name !== folderName) throw new Error('抖音收藏计数变化或不完整');
  return { platform: 'douyin', uid, syncedAt: new Date().toISOString(), folders: [{ id: folder.collects_id_str, title: folderName, items }] };
}
