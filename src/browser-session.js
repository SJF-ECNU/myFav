import { launchPersistentContext } from 'cloakbrowser';
import { chromium } from 'playwright-core';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function openSession(platform, headless = true, {
  env = process.env, engine = chromium, launchCloak = launchPersistentContext,
} = {}) {
  if (!['bilibili', 'douyin', 'xiaohongshu'].includes(platform)) throw new Error('浏览器平台无效');
  const mode = env.MYFAV_BROWSER || 'cloakbrowser';
  if (!['cloakbrowser', 'chromium', 'cdp'].includes(mode)) throw new Error('MYFAV_BROWSER 必须为 cloakbrowser、chromium 或 cdp');
  if (mode === 'chromium' && !env.MYFAV_BROWSER_EXECUTABLE_PATH) throw new Error('chromium 模式需要 MYFAV_BROWSER_EXECUTABLE_PATH');
  if (mode === 'cdp') {
    try {
      const url = new URL(env.MYFAV_CDP_URL);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error();
    } catch { throw new Error('cdp 模式需要有效的 MYFAV_CDP_URL'); }
    let browser, page;
    try {
      browser = await engine.connectOverCDP(env.MYFAV_CDP_URL, { timeout: 30000, noDefaults: true });
      const context = browser.contexts()[0];
      if (!context) throw new Error('missing context');
      page = await context.newPage();
      let closed = false;
      return { context, page, close: async () => {
        if (closed) return;
        closed = true;
        try { if (!page.isClosed()) await page.close(); }
        finally { await browser.close(); }
      } };
    } catch {
      try { await browser?.close(); } catch {}
      throw new Error('CDP 连接失败，请检查端点、浏览器状态及访问权限');
    }
  }
  const profile = resolve(`.local/${platform}-profile`);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(resolve('.local'), 0o700);
  await chmod(profile, 0o700);
  let context;
  try {
    context = mode === 'cloakbrowser'
      ? await launchCloak({ userDataDir: profile, headless })
      : await engine.launchPersistentContext(profile, { executablePath: env.MYFAV_BROWSER_EXECUTABLE_PATH, headless });
    const page = context.pages()[0] || await context.newPage();
    return { context, page, close: () => context.close() };
  } catch {
    try { await context?.close(); } catch {}
    throw new Error('浏览器启动失败，请检查所选内核、运行环境及专用配置占用情况');
  }
}
