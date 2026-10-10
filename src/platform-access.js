const stages = new Set(['unknown', 'navigation', 'session_check', 'account_check', 'challenge', 'favorites_api', 'favorites_folders', 'favorites_members', 'detail_api', 'subtitle_download', 'audio_download', 'image_download', 'browser_api']);
export function requestStage(path) {
  if (path === '/aweme/v1/web/collects/list/') return 'favorites_folders';
  if (path === '/aweme/v1/web/collects/video/list/') return 'favorites_members';
  if (/collects|fav|board/.test(path)) return 'favorites_api';
  if (/detail|view|player|feed/.test(path)) return 'detail_api';
  return 'browser_api';
}
export function platformError(status, retryAfter, message = '', stage = 'unknown') {
  const denied = [401, 403, 412].includes(status) || /验证码|验证挑战|访问频繁|风控|登录失效|尚未登录|未登录|登录过期|请先登录|账号已改变|captcha|verification required|access denied/i.test(message);
  if (status !== 429 && !denied) return null;
  const error = new Error(status === 429 ? '平台限流，等待冷却后重试' : '平台拒绝或需要验证，请正常处理后手动恢复');
  error.diagnostic = {
    time: new Date().toISOString(),
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    stage: stages.has(stage) ? stage : 'unknown',
    signal: status === 429 ? 'rate_limit' : /验证码|验证挑战|captcha|verification required/i.test(message) ? 'verification' : /账号已改变/i.test(message) ? 'account_changed' : /登录失效|尚未登录|未登录|登录过期|请先登录/i.test(message) ? 'login_required' : /访问频繁|风控/i.test(message) ? 'risk_control' : denied && [401,403,412].includes(status) ? 'http_denied' : 'access_denied',
  };
  error.message += `（触发时间 ${error.diagnostic.time}；阶段 ${error.diagnostic.stage}；HTTP ${error.diagnostic.httpStatus ?? '未知'}；信号 ${error.diagnostic.signal}）`;
  error.platformStop = true;
  error.until = status === 429 ? Date.now() + Math.max(900000, /^\d+$/.test(retryAfter ?? '') ? Number(retryAfter) * 1000 : (Date.parse(retryAfter) - Date.now()) || 0) : null;
  return error;
}
export function checkResponse(status, retryAfter, message, stage) {
  const error = platformError(status, retryAfter, message, stage);
  if (error) throw error;
}
export function recordFailure(store, platform, error) {
  const stop = error.platformStop ? error : platformError(0, null, error.message);
  if (stop) store.pausePlatform(platform, stop.message, stop.until, stop.diagnostic);
}
export function checkChallenge(page) {
  const urls = [page.url?.() ?? '', ...(page.frames?.() ?? []).map(frame => frame.url())];
  if (urls.some(url => /\/(captcha|verify)(\/|\?|$)/i.test(url))) checkResponse(0, null, 'verification required', 'challenge');
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
          checkResponse(response.status(), response.headers()['retry-after'], '', document ? 'navigation' : requestStage(url.pathname));
          if (api) {
            const body = await response.json();
            checkResponse(response.status(), null, body.message || body.msg || body.status_msg || '', requestStage(url.pathname));
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
