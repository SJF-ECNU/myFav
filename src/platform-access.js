export function platformError(status, retryAfter, message = '') {
  const denied = [401, 403, 412].includes(status) || /验证码|验证挑战|访问频繁|风控|登录失效|尚未登录|未登录|登录过期|请先登录|账号已改变|captcha|verification required|access denied/i.test(message);
  if (status !== 429 && !denied) return null;
  const error = new Error(status === 429 ? '平台限流，等待冷却后重试' : '平台拒绝或需要验证，请正常处理后手动恢复');
  error.platformStop = true;
  error.until = status === 429 ? Date.now() + Math.max(900000, /^\d+$/.test(retryAfter ?? '') ? Number(retryAfter) * 1000 : (Date.parse(retryAfter) - Date.now()) || 0) : null;
  return error;
}
export function checkResponse(status, retryAfter, message) {
  const error = platformError(status, retryAfter, message);
  if (error) throw error;
}
export function recordFailure(store, platform, error) {
  const stop = error.platformStop ? error : platformError(0, null, error.message);
  if (stop) store.pausePlatform(platform, stop.message, stop.until);
}
export function checkChallenge(page) {
  const urls = [page.url?.() ?? '', ...(page.frames?.() ?? []).map(frame => frame.url())];
  if (urls.some(url => /\/(captcha|verify)(\/|\?|$)/i.test(url))) checkResponse(0, null, 'verification required');
}
export async function guardedBrowser(store, platform, browser, fn) {
  store.assertPlatform(platform);
  let session;
  const responses = [];
  try {
    session = await browser();
    const { context, page, close = () => context.close() } = session;
    session.close = close;
    page.on?.('response', response => {
      const url = new URL(response.url());
      const site = platform === 'bilibili' ? 'bilibili.com' : `${platform}.com`;
      if (url.hostname !== site && !url.hostname.endsWith(`.${site}`)) return;
      const document = response.request().resourceType() === 'document';
      const api = /^\/x\/(web-interface\/(nav|view)|player\/|v3\/fav\/)/.test(url.pathname) || /^\/aweme\/v1\/web\/(collects\/|aweme\/detail\/)/.test(url.pathname) || /^\/api\/sns\/web\/v1\/(board\/|feed)/.test(url.pathname);
      if (!document && !api) return;
      responses.push((async () => {
        try {
          checkResponse(response.status(), response.headers()['retry-after']);
          if (api) {
            const body = await response.json();
            checkResponse(0, null, body.message || body.msg || body.status_msg || '');
          }
        } catch (error) { recordFailure(store, platform, error); }
      })());
    });
    const result = await fn(page);
    await Promise.all(responses);
    checkChallenge(page);
    store.assertPlatform(platform);
    return result;
  } catch (error) {
    await Promise.all(responses);
    if (session) {
      try { checkChallenge(session.page); } catch (challenge) { recordFailure(store, platform, challenge); }
    }
    recordFailure(store, platform, error);
    store.assertPlatform(platform);
    throw error;
  } finally { await session?.close(); }
}
