import { createRemoteJWKSet, jwtVerify } from 'jose';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';

function secureUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('OAuth URL 必须为 HTTPS（本机测试除外），不能包含凭据或查询参数');
  return url;
}
async function readJson(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('OAuth 服务当前不可用');
  return response.json();
}
export async function createOAuth(env = process.env) {
  if (!env.MYFAV_OAUTH_ISSUER && !env.MYFAV_OAUTH_RESOURCE) return null;
  try {
    const issuer = secureUrl(env.MYFAV_OAUTH_ISSUER), resource = secureUrl(env.MYFAV_OAUTH_RESOURCE);
    const metadata = await readJson(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (metadata.issuer !== env.MYFAV_OAUTH_ISSUER || !metadata.code_challenge_methods_supported?.includes('S256')) throw Error('OAuth issuer 或 PKCE S256 不匹配');
    for (const key of ['authorization_endpoint', 'token_endpoint']) secureUrl(metadata[key]);
    const introspection = env.MYFAV_OAUTH_INTROSPECTION_URL ? secureUrl(env.MYFAV_OAUTH_INTROSPECTION_URL) : null;
    if (introspection && (!env.MYFAV_OAUTH_CLIENT_ID || !env.MYFAV_OAUTH_CLIENT_SECRET)) throw Error('Introspection 需要服务器凭据');
    const keys = introspection ? null : createRemoteJWKSet(secureUrl(metadata.jwks_uri), { timeoutDuration: 10000 });
    return {
      metadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
      router: mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: resource, scopesSupported: ['myfav:read', 'myfav:prepare', 'myfav:write'], resourceName: 'myFav' }),
      async verify(header) {
        if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 16384) return null;
        const token = header.slice(7);
        try {
          let payload;
          if (introspection) {
            const basic = Buffer.from(`${encodeURIComponent(env.MYFAV_OAUTH_CLIENT_ID)}:${encodeURIComponent(env.MYFAV_OAUTH_CLIENT_SECRET)}`).toString('base64');
            payload = await readJson(introspection, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, token_type_hint: 'access_token' }) });
            if (payload.active !== true || (payload.iss && payload.iss !== env.MYFAV_OAUTH_ISSUER)) return null;
            const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
            if (!audience.includes(resource.href)) return null;
          } else {
            ({ payload } = await jwtVerify(token, keys, { issuer: env.MYFAV_OAUTH_ISSUER, audience: resource.href,
              requiredClaims: ['exp', 'sub'], algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'] }));
          }
          if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000 || typeof payload.sub !== 'string' || !payload.sub) return null;
          if (payload.client_id && payload.azp && payload.client_id !== payload.azp) return null;
          const clientId = payload.client_id || payload.azp;
          if (typeof clientId !== 'string' || !clientId || typeof payload.scope !== 'string') return null;
          return { issuer: env.MYFAV_OAUTH_ISSUER, clientId, subject: payload.sub, scopes: payload.scope.split(/\s+/) };
        } catch { return null; }
      },
    };
  } catch { throw Error('OAuth 配置或授权服务发现失败，请检查 issuer、resource、PKCE S256 及服务可用性'); }
}
