import { openSession } from './browser-session.js';
import { setTimeout } from 'node:timers/promises';

const command = process.argv[2];
if (!['login', 'status'].includes(command)) throw new Error('使用 login 或 status');
let close;
try {
  const session = await openSession('douyin', command === 'status');
  const { context, page } = session; close = session.close;
  await page.goto('https://www.douyin.com/user/self?showTab=favorite_collection', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const hasSession = async () => (await context.cookies('https://www.douyin.com')).some(cookie => ['sessionid', 'sessionid_ss'].includes(cookie.name) && cookie.value);
  if (command === 'login') {
    console.log('抖音专用浏览器已打开，请手动登录；最多等待十分钟。喵～');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (!(await hasSession()) && Date.now() < deadline) await setTimeout(2000);
  }
  console.log(JSON.stringify({ sessionMarkerPresent: Boolean(await hasSession()), accountAccessVerified: false, favoritesVerified: false }));
} catch {
  console.error('抖音浏览器未能完成检查，请检查窗口、网络或是否已有进程占用专用配置。喵～');
  process.exitCode = 1;
} finally { await close?.(); }
