import { launchPersistentContext } from 'cloakbrowser';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const command = process.argv[2];
if (!['login', 'status'].includes(command)) throw new Error('使用 login 或 status');
const profile = resolve('.local/douyin-profile');
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(resolve('.local'), 0o700);
await chmod(profile, 0o700);
let context;
try {
  context = await launchPersistentContext({ userDataDir: profile, headless: command === 'status' });
  const page = context.pages()[0] || await context.newPage();
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
} finally { await context?.close(); }
