import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const scopes = ['read', 'prepare', 'write'];
export const toolScopes = { sync_favorites: 'prepare', list_updates: 'read', get_content: 'read', set_processing_status: 'write', save_result: 'write', get_result: 'read' };
export function parseScopes(values) {
  const result = [...new Set(typeof values === 'string' ? values.split(',') : values)];
  if (!result.length || result.some(value => !scopes.includes(value))) throw Error('权限必须为 read、prepare、write');
  return result;
}
export function matchesToken(header, token) {
  if (!token || token.length < 32) return false;
  const actual = Buffer.from(header || ''), expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export class Access {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, token TEXT UNIQUE, scopes TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
      issuer TEXT, client_id TEXT, subject TEXT, created TEXT NOT NULL,
      UNIQUE(issuer,client_id,subject));
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL,
      agent TEXT, method TEXT NOT NULL, tool TEXT, outcome TEXT NOT NULL, status INTEGER NOT NULL);`);
  }
  close() { this.db.close(); }
  hasAgents() { return this.db.prepare('SELECT COUNT(*) AS n FROM agents').get().n > 0; }
  add(id, values, oauth) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) throw Error('Agent ID 无效');
    const permissions = parseScopes(values), token = oauth ? null : randomBytes(32).toString('hex');
    if (oauth && ![oauth.issuer, oauth.clientId, oauth.subject].every(v => typeof v === 'string' && v.length)) throw Error('OAuth 身份配置缺失');
    this.db.prepare('INSERT INTO agents(id,token,scopes,issuer,client_id,subject,created) VALUES(?,?,?,?,?,?,?)')
      .run(id, token, JSON.stringify(permissions), oauth?.issuer ?? null, oauth?.clientId ?? null, oauth?.subject ?? null, new Date().toISOString());
    return token;
  }
  list() { return this.db.prepare('SELECT id,scopes,revoked,created,CASE WHEN token IS NULL THEN \'oauth\' ELSE \'api_token\' END AS kind FROM agents').all().map(row => ({ ...row, scopes: JSON.parse(row.scopes) })); }
  revoke(id) { if (!this.db.prepare('UPDATE agents SET revoked=1 WHERE id=?').run(id).changes) throw Error('未知 Agent'); }
  setScopes(id, values) { if (!this.db.prepare('UPDATE agents SET scopes=? WHERE id=?').run(JSON.stringify(parseScopes(values)), id).changes) throw Error('未知 Agent'); }
  rotate(id) {
    const token = randomBytes(32).toString('hex');
    if (!this.db.prepare('UPDATE agents SET token=?,revoked=0 WHERE id=? AND token IS NOT NULL').run(token, id).changes) throw Error('未知 Agent 或 OAuth 身份不能轮换 API Token');
    return token;
  }
  authenticate(header, legacy) {
    if (!this.hasAgents()) return matchesToken(header, legacy) ? { id: 'legacy', scopes: [...scopes] } : null;
    for (const row of this.db.prepare('SELECT id,token,scopes FROM agents WHERE revoked=0 AND token IS NOT NULL').all()) {
      if (matchesToken(header, row.token)) return { id: row.id, scopes: JSON.parse(row.scopes) };
    }
    return null;
  }
  oauthIdentity(identity) {
    const row = this.db.prepare('SELECT id,scopes FROM agents WHERE revoked=0 AND issuer=? AND client_id=? AND subject=?')
      .get(identity.issuer, identity.clientId, identity.subject);
    if (!row) return null;
    return { id: row.id, scopes: JSON.parse(row.scopes).filter(scope => identity.scopes.includes(`myfav:${scope}`)) };
  }
  audit({ agent = null, method = 'unknown', tool = null, outcome, status }) {
    const methods = ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'];
    const results = ['ok', 'error', 'denied', 'invalid', 'limited', 'busy'];
    this.db.prepare('INSERT INTO audit(time,agent,method,tool,outcome,status) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), agent,
      methods.includes(method) ? method : 'unknown', typeof tool === 'string' && Object.hasOwn(toolScopes, tool) ? tool : null,
      results.includes(outcome) ? outcome : 'error', status);
    this.db.exec('DELETE FROM audit WHERE seq <= (SELECT COALESCE(MAX(seq),0)-10000 FROM audit)');
  }
  audits(limit = 100) { return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(Math.min(1000, Math.max(1, Number(limit) || 100))); }
}

export class RateLimit {
  constructor(limit = 60, now = Date.now) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw Error('请求频率配置无效');
    this.limit = limit; this.now = now; this.windows = new Map();
  }
  take(id) {
    const now = this.now();
    for (const [key, value] of this.windows) if (now - value.start >= 60000) this.windows.delete(key);
    let window = this.windows.get(id);
    if (!window) { window = { start: now, count: 0 }; this.windows.set(id, window); }
    window.count++;
    return window.count <= this.limit ? 0 : Math.max(1, Math.ceil((60000 - (now - window.start)) / 1000));
  }
}
