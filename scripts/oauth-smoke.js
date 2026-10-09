import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { launch } from 'cloakbrowser';
import { createOAuth } from '../src/oauth.js';
import { Access } from '../src/access.js';
import { createApp } from '../src/mcp.js';

const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(), 'myfav-oauth-'));
const name = `myfav-oauth-${randomBytes(6).toString('hex')}`, password = randomBytes(24).toString('hex');
const owner = '11111111-1111-4111-8111-111111111111', clientId = 'myfav-fixture';
const resource = 'https://myfav.example.test/mcp', access = new Access();
let stage = 'setup', browser, api, started = false, received;
const callback = createServer((req, res) => {
  const query = new URL(req.url, 'http://localhost').searchParams;
  received?.({ code: query.get('code'), state: query.get('state'), error: query.get('error') });
  res.end('Authorization received by test client.');
}).listen(0, '127.0.0.1');
await once(callback, 'listening');
const redirect = `http://127.0.0.1:${callback.address().port}/callback`;
const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const issuer = `http://127.0.0.1:${port}/realms/myfav-fixture`;
try {
  const realm = JSON.parse(await readFile(new URL('../docs/oauth/keycloak-realm.example.json', import.meta.url), 'utf8'));
  Object.assign(realm, { realm: 'myfav-fixture', sslRequired: 'none', accessTokenLifespan: 60,
    users: [{ id: owner, username: 'owner', enabled: true, firstName: 'Test', lastName: 'Owner', email: 'fixture@example.test', credentials: [{ type: 'password', value: password, temporary: false }] }] });
  Object.assign(realm.clients[0], { clientId, redirectUris: [redirect] });
  realm.clients[0].protocolMappers.find(mapper => mapper.name === 'myfav-audience').config['included.custom.audience'] = resource;
  await writeFile(join(dir, 'realm.json'), JSON.stringify(realm), { mode: 0o644 });
  await exec('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:8080`, '-e', 'JAVA_OPTS_KC_HEAP=-Xms64m -Xmx512m', '-v', `${join(dir, 'realm.json')}:/opt/keycloak/data/import/realm.json:ro`, 'quay.io/keycloak/keycloak:26.8.0', 'start-dev', '--import-realm']); started = true;
  stage = 'provider startup'; let metadata;
  for (let attempt = 0; attempt < 180; attempt++) {
    try { const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) }); if (response.ok) { metadata = await response.json(); break; } } catch {}
    await setTimeout(500);
  }
  if (!metadata) throw Error('Provider unavailable');
  const oauth = await createOAuth({ MYFAV_OAUTH_ISSUER: issuer, MYFAV_OAUTH_RESOURCE: resource });
  access.add('oauth-fixture', ['read', 'write'], { issuer, clientId, subject: owner });
  const hosts = ['temporary']; api = createApp({ store: { updates: () => ({ events: [] }) } }, { oauth, access, allowedHosts: hosts }).listen(0, '127.0.0.1');
  await once(api, 'listening'); hosts[0] = `127.0.0.1:${api.address().port}`;
  const apiUrl = `http://${hosts[0]}/mcp`;
  assert.equal((await fetch(apiUrl)).status, 401);
  assert.equal((await (await fetch(`http://${hosts[0]}/.well-known/oauth-protected-resource/mcp`)).json()).resource, resource);
  stage = 'PKCE authorization';
  const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url'), state = randomBytes(24).toString('hex');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid myfav:read', state, resource, code_challenge: challenge, code_challenge_method: 'S256' });
  const insecure = new URLSearchParams(params); insecure.delete('code_challenge'); insecure.delete('code_challenge_method');
  const rejected = await fetch(`${metadata.authorization_endpoint}?${insecure}`, { redirect: 'manual' });
  assert(rejected.status === 400 || (rejected.status === 302 && new URL(rejected.headers.get('location')).searchParams.has('error')), 'Missing PKCE must be rejected');
  const authorization = new Promise(resolve => { received = resolve; });
  browser = await launch({ headless: true }); const page = await browser.newPage();
  await page.goto(`${metadata.authorization_endpoint}?${params}`);
  await page.locator('#username').fill('owner'); await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  const timeout = new AbortController();
  const result = await Promise.race([authorization, setTimeout(30000, null, { signal: timeout.signal }).then(() => { throw Error('Callback timeout'); })]); timeout.abort();
  assert.equal(result.state, state); assert(result.code && !result.error);
  const exchange = (extra) => fetch(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, resource, ...extra }) });
  const codeParams = { grant_type: 'authorization_code', code: result.code, redirect_uri: redirect };
  const response = await exchange({ ...codeParams, code_verifier: verifier }); assert.equal(response.status, 200);
  const tokens = await response.json(); assert(tokens.access_token && tokens.refresh_token);
  assert.equal((await exchange({ ...codeParams, code_verifier: verifier })).status, 400);
  stage = 'wrong PKCE verifier';
  const nextAuthorization = new Promise(resolve => { received = resolve; });
  await page.goto(`${metadata.authorization_endpoint}?${params}`);
  const nextTimeout = new AbortController();
  const nextCode = await Promise.race([nextAuthorization, setTimeout(30000, null, { signal: nextTimeout.signal }).then(() => { throw Error('Callback timeout'); })]); nextTimeout.abort();
  assert.equal(nextCode.state, state); assert(nextCode.code);
  assert.equal((await exchange({ grant_type: 'authorization_code', code: nextCode.code, redirect_uri: redirect, code_verifier: randomBytes(32).toString('base64url') })).status, 400);
  stage = 'resource and refresh';
  const identity = await oauth.verify(`Bearer ${tokens.access_token}`);
  assert(identity, 'Resource server must validate the provider token'); assert.equal(identity.subject, owner);
  assert.deepEqual(access.oauthIdentity(identity).scopes, ['read']);
  const read = async token => fetch(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_updates', arguments: {} } }) });
  assert.equal((await read(tokens.access_token)).status, 200);
  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }); assert.equal(refreshed.status, 200);
  assert.equal((await read((await refreshed.json()).access_token)).status, 200);
  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status, 400);
  access.revoke('oauth-fixture'); assert.equal((await read(tokens.access_token)).status, 401);
  const implicitParams = new URLSearchParams(params); implicitParams.set('response_type', 'token');
  const implicit = await fetch(`${metadata.authorization_endpoint}?${implicitParams}`, { redirect: 'manual' });
  assert(implicit.status === 400 || (implicit.status === 302 && new URL(implicit.headers.get('location')).hash.includes('error=')));
  const passwordGrant = await exchange({ grant_type: 'password', username: 'owner', password }); assert.equal(passwordGrant.status, 400);
  console.log('OAuth authorization-code/PKCE S256, missing/wrong verifier and disabled grant rejection, code replay rejection, resource scope, refresh and local revocation verified.');
} catch (error) { console.error(`OAuth smoke failed during ${stage} (${error.name}, ${error.stack?.split('\n').find(line => line.includes('oauth-smoke.js:'))?.trim() || 'no source location'}); no credentials printed.`); process.exitCode = 1; }
finally {
  await browser?.close(); if (api) await new Promise(resolve => api.close(resolve));
  await new Promise(resolve => callback.close(resolve)); access.close();
  if (started) await exec('docker', ['stop', '-t', '5', name]).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
