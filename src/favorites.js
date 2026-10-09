import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function collectFavorites(api, uid, folderName) {
  const folders = [];
  for (let page = 1; ; page++) {
    const data = await api('/x/v3/fav/folder/created/list', { up_mid: uid, pn: page, ps: 20 });
    if (!Array.isArray(data.list) && data.count !== 0) throw new Error('收藏夹列表格式异常');
    const batch = data.list ?? [];
    if (batch.some(folder => folders.some(previous => previous.id === folder.id))) throw new Error('收藏夹分页重复');
    folders.push(...batch);
    if (folders.length === data.count) break;
    if (!batch.length || folders.length > data.count) throw new Error('收藏夹数量不一致，请重新同步');
  }
  const selected = folderName === undefined ? folders : folders.filter(folder => folder.title === folderName);
  if (folderName !== undefined && selected.length !== 1) throw new Error(selected.length ? '指定收藏夹重名，请使用唯一名称' : '未找到指定收藏夹');
  const result = [];
  for (const folder of selected) {
    const ids = [];
    const seen = new Set();
    if (!Number.isInteger(folder.media_count)) throw new Error('收藏夹计数格式异常');
    for (let page = 1; ids.length < folder.media_count; page++) {
      const batch = await api('/x/v3/fav/resource/ids', { media_id: folder.id, pn: page, platform: 'web' });
      if (!Array.isArray(batch) || !batch.length) throw new Error('收藏成员分页不完整');
      for (const item of batch) {
        const key = `${item.type}:${item.id}`;
        if (!Number.isInteger(item.id) || !Number.isInteger(item.type) || seen.has(key)) throw new Error('收藏分页存在无效或重复条目，请重试');
        seen.add(key);
        ids.push(item);
      }
    }
    if (ids.length !== folder.media_count) throw new Error('收藏成员数与平台数量不一致，请重试');
    const items = [];
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      const details = await api('/x/v3/fav/resource/infos', {
        resources: batch.map(item => `${item.id}:${item.type}`).join(','), platform: 'web',
      });
      if (!Array.isArray(details)) throw new Error('收藏详情格式异常');
      const detailMap = new Map();
      for (const item of details) {
        const key = `${item.type}:${item.id}`;
        if (!batch.some(member => member.id === item.id && member.type === item.type) || detailMap.has(key)) throw new Error('收藏详情返回未知或重复成员');
        detailMap.set(key, item);
      }
      for (const member of batch) {
        const item = detailMap.get(`${member.type}:${member.id}`);
        items.push({ id: member.id, type: member.type,
          bvid: item?.bvid || item?.bv_id || member.bvid || member.bv_id || null,
          metadataStatus: item ? 'available' : 'missing',
          title: item?.title ?? null, description: item?.intro ?? null, author: item?.upper?.name ?? null,
          duration: item?.duration ?? null, favoriteTime: item?.fav_time || null,
          unavailable: item && Number.isInteger(item.attr) ? item.attr !== 0 : null });
      }
    }
    result.push({ id: folder.id, title: folder.title, private: Boolean(folder.attr & 1), items });
  }
  const currentFolders = [];
  for (let page = 1; ; page++) {
    const data = await api('/x/v3/fav/folder/created/list', { up_mid: uid, pn: page, ps: 20 });
    const batch = data.list ?? [];
    currentFolders.push(...batch);
    if (currentFolders.length === data.count) break;
    if (!batch.length || currentFolders.length > data.count) throw new Error('收藏夹复核不完整');
  }
  if (selected.some(folder =>
    !currentFolders.some(current => current.id === folder.id && current.title === folder.title && current.media_count === folder.media_count))) {
    throw new Error('同步期间收藏夹或数量变化，请重试');
  }
  return { syncedAt: new Date().toISOString(), uid, folders: result };
}

export async function syncFavorites(api, uid, destination, folderName) {
  const result = await collectFavorites(api, uid, folderName);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2), { mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return result;
}
