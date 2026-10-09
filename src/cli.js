import { openBrowser, browserApi } from './browser.js';
import { syncFavorites } from './favorites.js';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const command = process.argv[2];
if (!['login', 'status', 'sync'].includes(command)) {
  console.error('用法：npm run login | status | sync');
  process.exit(1);
}

let context;
try {
  const browser = await openBrowser(command !== 'login');
  context = browser.context;
  const api = browserApi(browser.page);
  if (command === 'login') {
    console.log('请在专用浏览器中扫码登录 Bilibili；检测成功后自动关闭并保存。喵～');
    const deadline = Date.now() + 10 * 60 * 1000;
    let loggedIn = false;
    while (Date.now() < deadline) {
      try {
        const user = await api('/x/web-interface/nav');
        if (user.isLogin) { loggedIn = true; break; }
      } catch (error) {
        if (!error.message.startsWith('登录失效')) throw error;
      }
      await setTimeout(3000);
    }
    if (!loggedIn) throw new Error('登录等待超时，请重试');
    console.log('登录成功，正在保存专用浏览器配置。喵～');
  } else {
    const user = await api('/x/web-interface/nav');
    if (!user.isLogin) throw new Error('尚未登录，请运行 npm run login');
    if (command === 'status') console.log('登录有效。喵～');
    else {
      const result = await syncFavorites(api, user.mid, resolve('.local/favorites.json'), process.argv[3] ?? 'myFav');
      const count = result.folders.reduce((sum, folder) => sum + folder.items.length, 0);
      console.log(`同步完成：${result.folders.length} 个收藏夹，${count} 条收藏成员记录，已保存 .local/favorites.json。喵～`);
    }
  }
} catch (error) {
  // Browser errors can include paths and launch options; keep credentials out of output.
  console.error(`执行失败：${error.message.split('\n')[0]}。喵～`);
  process.exitCode = 1;
} finally {
  await context?.close();
}
