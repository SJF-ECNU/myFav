import { openSession } from './browser-session.js';
import { setTimeout } from 'node:timers/promises';

export async function openBrowser(headless) {
  const { context, page, close } = await openSession('bilibili', headless);
  try {
    await page.goto('https://www.bilibili.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    return { context, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export function browserApi(page) {
  let lastRequest = 0;
  return async (path, params = {}) => {
    await setTimeout(Math.max(0, 1000 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const url = new URL(path, 'https://api.bilibili.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await page.evaluate(async url => {
      const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
      if (!response.ok) return { httpStatus: response.status };
      try { return { body: await response.json() }; }
      catch { return { invalidJson: true }; }
    }, url.href);
    if (response.httpStatus) throw new Error(`Bilibili HTTP ${response.httpStatus}`);
    if (response.invalidJson) throw new Error('Bilibili 返回非 JSON 内容');
    if (response.body.code === -101) throw new Error('登录失效，请运行 npm run login');
    if (response.body.code !== 0) throw new Error(`Bilibili 接口错误 ${response.body.code}`);
    if (!response.body.data) throw new Error('Bilibili 未返回有效数据');
    return response.body.data;
  };
}
