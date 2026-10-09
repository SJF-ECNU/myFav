import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS scope (id INTEGER PRIMARY KEY CHECK(id=1), uid INTEGER, folder_id INTEGER, folder_name TEXT, synced_at TEXT);
      CREATE TABLE IF NOT EXISTS scopes (platform TEXT PRIMARY KEY, uid TEXT NOT NULL, folder_id TEXT NOT NULL, folder_name TEXT NOT NULL, synced_at TEXT);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL, present INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '', result TEXT);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL REFERENCES items(id), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (item_id TEXT PRIMARY KEY REFERENCES items(id), url TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contents (item_id TEXT PRIMARY KEY REFERENCES items(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcripts (item_id TEXT NOT NULL REFERENCES items(id), cid INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(item_id,cid));
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
    if (!this.db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'platform')) {
      this.db.exec("ALTER TABLE items ADD COLUMN platform TEXT NOT NULL DEFAULT 'bilibili'");
    }
    this.db.exec("INSERT OR IGNORE INTO scopes SELECT 'bilibili',uid,folder_id,folder_name,synced_at FROM scope");
    this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  status(platform = 'bilibili') {
    const scope = this.db.prepare('SELECT * FROM scopes WHERE platform=?').get(platform) ?? null;
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE present=1 AND platform=?').get(platform).count;
    const cursor = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM events').get().cursor;
    return { scope, count, cursor };
  }
  apply(snapshot) {
    if (snapshot.folders.length !== 1) throw new Error('只能同步一个指定收藏夹');
    const folder = snapshot.folders[0];
    const platform = snapshot.platform ?? 'bilibili';
    const prior = this.status(platform).scope;
    if (prior && (String(prior.uid) !== String(snapshot.uid) || String(prior.folder_id) !== String(folder.id))) throw new Error('账号或收藏夹已改变，请使用独立数据目录');
    let added = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = new Set(this.db.prepare('SELECT id FROM items WHERE present=1 AND platform=?').all(platform).map(row => row.id));
      this.db.prepare('UPDATE items SET present=0 WHERE platform=?').run(platform);
      for (const item of folder.items) {
        const id = `${platform === 'bilibili' ? '' : `${platform}:`}${folder.id}:${item.type}:${item.id}`;
        this.db.prepare(`INSERT INTO items(id,data,present,platform) VALUES(?,?,1,?)
          ON CONFLICT(id) DO UPDATE SET data=excluded.data,present=1`).run(id, JSON.stringify(item), platform);
        if (!previous.has(id)) {
          this.db.prepare('INSERT INTO events(item_id,created_at) VALUES(?,?)').run(id, snapshot.syncedAt);
          added++;
        }
      }
      this.db.prepare(`INSERT INTO scopes VALUES(?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET
        folder_name=excluded.folder_name,synced_at=excluded.synced_at`).run(platform, String(snapshot.uid), String(folder.id), folder.title, snapshot.syncedAt);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { added, ...this.status(platform) };
  }
  item(id) {
    const row = this.db.prepare('SELECT * FROM items WHERE id=?').get(id);
    if (!row) throw new Error('未知收藏条目');
    return { id, ...JSON.parse(row.data), itemId: id, platform: row.platform, present: Boolean(row.present), status: row.status, note: row.note };
  }
  updates(after = 0, limit = 50, platform) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('无效游标或分页大小');
    const rows = this.db.prepare('SELECT events.* FROM events JOIN items ON items.id=events.item_id WHERE seq>? AND (? IS NULL OR items.platform=?) ORDER BY seq LIMIT ?').all(after, platform ?? null, platform ?? null, limit + 1);
    const events = rows.slice(0, limit).map(row => ({ cursor: row.seq, discoveredAt: row.created_at, item: this.item(row.item_id) }));
    return { events, nextCursor: events.at(-1)?.cursor ?? after, hasMore: rows.length > limit };
  }
  setStatus(id, status, note = '') {
    this.item(id);
    if (!['pending', 'processing', 'completed', 'failed'].includes(status)) throw new Error('无效处理状态');
    this.db.prepare('UPDATE items SET status=?,note=? WHERE id=?').run(status, note, id);
    return this.item(id);
  }
  saveResult(id, result) {
    this.item(id);
    this.db.prepare('UPDATE items SET result=? WHERE id=?').run(JSON.stringify({ ...result, savedAt: new Date().toISOString() }), id);
    return this.getResult(id);
  }
  getResult(id) {
    const item = this.item(id);
    const row = this.db.prepare('SELECT result FROM items WHERE id=?').get(id);
    return { itemId: id, status: item.status, note: item.note, result: row.result ? JSON.parse(row.result) : null };
  }
  currentItems(platform = 'bilibili') {
    return this.db.prepare('SELECT id FROM items WHERE present=1 AND platform=?').all(platform).map(row => this.item(row.id));
  }
  content(id) {
    const row = this.db.prepare('SELECT data FROM contents WHERE item_id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  saveContent(id, content) {
    this.item(id);
    this.db.prepare('INSERT INTO contents VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(content));
  }
  source(id) { return this.db.prepare('SELECT url FROM sources WHERE item_id=?').get(id)?.url; }
  saveSource(id, url) {
    this.item(id);
    this.db.prepare('INSERT INTO sources VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET url=excluded.url').run(id, url);
  }
  transcript(id, cid) {
    const row = this.db.prepare('SELECT data FROM transcripts WHERE item_id=? AND cid=?').get(id, cid);
    return row ? JSON.parse(row.data) : null;
  }
  saveTranscript(id, cid, data) {
    this.item(id);
    this.db.prepare('INSERT INTO transcripts VALUES(?,?,?) ON CONFLICT(item_id,cid) DO UPDATE SET data=excluded.data').run(id, cid, JSON.stringify(data));
  }
}
