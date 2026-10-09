import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createOAuth } from '../src/oauth.js';
import { Access } from '../src/access.js';
import { createApp } from '../src/mcp.js';

async function provider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', use: 'sig', alg: 'RS256' };
  let issuer; const resource = 'https://myfav.example.test/mcp';
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }));
    else if (req.url === '/jwks') res.end(JSON.stringify({ keys: [jwk] }));
    else if (req.url === '/introspect') {
      let body = ''; for await (const part of req) body += part;
      const token = new URLSearchParams(body).get('token');
      res.end(JSON.stringify({ active: token !== 'wrong', aud: token === 'wrong-resource' ? 'https://other.test/mcp' : resource, exp: token === 'expired' ? 1 : Date.now() / 1000 + 60, sub: 'owner', client_id: 'client', scope: 'myfav:read' }));
    } else { res.statusCode = 404; res.end('{}'); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); issuer = `http://127.0.0.1:${server.address().port}`;
  const sign = overrides => new SignJWT({ sub: 'owner', azp: 'client', scope: 'myfav:read', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setIssuer(overrides?.iss || issuer).setAudience(overrides?.aud || resource).setExpirationTime(overrides?.exp || Math.floor(Date.now() / 1000) + 60).sign(privateKey);
  return { server, issuer, resource, sign };
}

test('OAuth discovery, signature, audience, expiration and client/user binding enforce resource access', async () => {
  const p = await provider(); const access = new Access();
  access.add('oauth-reader', ['read', 'write'], { issuer: p.issuer, clientId: 'client', subject: 'owner' });
  const oauth = await createOAuth({ MYFAV_OAUTH_ISSUER: p.issuer, MYFAV_OAUTH_RESOURCE: p.resource });
  const hosts = ['temporary']; let reads = 0;
  const app = createApp({ store: { updates: () => { reads++; return { events: [] }; } } }, { access, oauth, allowedHosts: hosts });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); hosts[0] = `127.0.0.1:${server.address().port}`;
  const url = `http://${hosts[0]}/mcp`;
  const request = async token => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_updates', arguments: {} } }) });
  try {
    const challenge = await fetch(url); assert.equal(challenge.status, 401); assert(challenge.headers.get('www-authenticate').includes('resource_metadata='));
    const metadata = await (await fetch(`http://${hosts[0]}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(metadata.resource, p.resource); assert.deepEqual(metadata.authorization_servers, [p.issuer]);
    const token = await p.sign(); assert.equal((await request(token)).status, 200); assert.equal(reads, 1);
    assert.deepEqual(access.oauthIdentity(await oauth.verify(`Bearer ${token}`)).scopes, ['read']);
    for (const payload of [{ aud: 'https://other.test/mcp' }, { iss: 'https://wrong.test' }, { exp: 1 }, { sub: 'stranger' }, { azp: 'other-client' }]) {
      assert.equal((await request(await p.sign(payload))).status, 401);
    }
    const forged = token.slice(0, -8) + 'abcdefgh'; assert.equal((await request(forged)).status, 401);
    assert.equal(reads, 1);
    access.revoke('oauth-reader'); assert.equal((await request(token)).status, 401);
    assert(!JSON.stringify(access.audits()).includes(token));
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => p.server.close(resolve)); access.close(); }
});

test('OAuth supports standard opaque introspection; configuration never accepts insecure public endpoints', async () => {
  const p = await provider();
  try {
    const oauth = await createOAuth({ MYFAV_OAUTH_ISSUER: p.issuer, MYFAV_OAUTH_RESOURCE: p.resource, MYFAV_OAUTH_INTROSPECTION_URL: `${p.issuer}/introspect`, MYFAV_OAUTH_CLIENT_ID: 'server', MYFAV_OAUTH_CLIENT_SECRET: 'fixture' });
    assert.equal((await oauth.verify('Bearer opaque-fixture')).subject, 'owner');
    for (const invalid of ['wrong', 'wrong-resource', 'expired']) assert.equal(await oauth.verify(`Bearer ${invalid}`), null);
    await assert.rejects(createOAuth({ MYFAV_OAUTH_ISSUER: 'http://public.example', MYFAV_OAUTH_RESOURCE: p.resource }), /OAuth/);
    assert.equal(await createOAuth({}), null);
  } finally { await new Promise(resolve => p.server.close(resolve)); }
});
