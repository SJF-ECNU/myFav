import { launchPersistentContext } from 'cloakbrowser';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const command = process.argv[2];
if (!['login', 'status'].includes(command)) throw new Error('使用 login 或 status');
const profile = resolve('.local/xiaohongshu-profile');
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(resolve('.local'), 0o700); await chmod(profile, 0o700);
let context;
try {
  context = await launchPersistentContext({ userDataDir: profile, headless: command === 'status' });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const loggedIn = () => page.evaluate(() => {
    const state = window.__INITIAL_STATE__?.user?.userInfo;
    const info = state?.value ?? state;
    return Boolean(info && !info.guest && (info.userId || info.user_id));
  });
  if (command === 'login') {
    console.log('小红书专用浏览器已打开，请手动扫码并完成平台验证；最多等待十分钟。喵～');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (!(await loggedIn()) && Date.now() < deadline) await setTimeout(2000);
  } else {
    await page.waitForFunction(() => Boolean(window.__INITIAL_STATE__?.user), { timeout: 15000 }).catch(() => {});
  }
  console.log(JSON.stringify({ loggedIn: await loggedIn(), favoritesVerified: false }));
} catch {
  console.error('小红书浏览器未能完成检查，请检查网络、窗口或是否已有进程占用配置。喵～');
  process.exitCode = 1;
} finally { await context?.close(); }
