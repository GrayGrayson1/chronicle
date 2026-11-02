import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, guild TEXT NOT NULL, channel TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, glossary TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS speakers (
        campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        user TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(campaign,user));
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        title TEXT NOT NULL, owner TEXT NOT NULL, started INTEGER NOT NULL,
        state TEXT NOT NULL, recap TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL, offset REAL NOT NULL, path TEXT,
        text TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS chunks_session ON chunks(session,offset);
      CREATE INDEX IF NOT EXISTS chunks_state ON chunks(state);
    `);
    if (!this.all('PRAGMA table_info(chunks)').some(column=>column.name==='duration')) this.db.exec('ALTER TABLE chunks ADD COLUMN duration REAL NOT NULL DEFAULT 0');
  }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  campaign(guild, channel) { return this.get('SELECT * FROM campaigns WHERE guild=? AND channel=?', guild, channel); }
  createCampaign(guild, channel, name) {
    const id = randomUUID();
    this.run('INSERT INTO campaigns(id,guild,channel,name) VALUES(?,?,?,?)', id, guild, channel, name);
    return this.campaign(guild, channel);
  }
  createSession(campaign, title, owner, state = 'recording') {
    const id = randomUUID().slice(0, 8);
    this.run('INSERT INTO sessions(id,campaign,title,owner,started,state) VALUES(?,?,?,?,?,?)', id, campaign, title, owner, Date.now(), state);
    return this.get('SELECT * FROM sessions WHERE id=?', id);
  }
  session(campaign, id) { return this.get('SELECT * FROM sessions WHERE campaign=? AND id=?', campaign, id); }
  sessions(campaign) { return this.all('SELECT * FROM sessions WHERE campaign=? ORDER BY started DESC LIMIT 30', campaign); }
  updateSession(id, state, recap = null) {
    this.run('UPDATE sessions SET state=?,recap=COALESCE(?,recap) WHERE id=?', state, recap, id);
  }
  addAudio(session, speaker, offset, path) {
    const id = randomUUID();
    this.run('INSERT INTO chunks(id,session,speaker,offset,path,state) VALUES(?,?,?,?,?,?)', id, session, speaker, offset, path, 'pending');
    return id;
  }
  addText(session, speaker, offset, text, duration=0) {
    const id=randomUUID();
    this.run('INSERT INTO chunks(id,session,speaker,offset,text,state,duration) VALUES(?,?,?,?,?,?,?)', id, session, speaker, offset, text, 'done',duration);
    return id;
  }
  chunks(session) { return this.all('SELECT * FROM chunks WHERE session=? ORDER BY offset,id', session); }
  pendingCount() { return this.get("SELECT COUNT(*) AS n FROM chunks WHERE state IN ('pending','working')").n; }
  recover() {
    this.run("UPDATE chunks SET state='pending' WHERE state='working'");
    this.run("UPDATE sessions SET state='interrupted' WHERE state IN ('recording','paused','processing','importing')");
  }
  label(campaign, user, fallback) {
    return this.get('SELECT name FROM speakers WHERE campaign=? AND user=?', campaign, user)?.name || fallback;
  }
  setLabel(campaign, user, name) {
    this.run('INSERT INTO speakers VALUES(?,?,?) ON CONFLICT(campaign,user) DO UPDATE SET name=excluded.name', campaign, user, name);
  }
  search(campaign, question, limit = 20) {
    const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
    const rows = this.all(`SELECT c.*,s.title FROM chunks c JOIN sessions s ON s.id=c.session
      WHERE s.campaign=? AND c.state='done' AND c.text<>'' ORDER BY s.started DESC,c.offset`, campaign);
    return rows.map((row, order) => ({ ...row, order, score: terms.reduce((sum, term) => sum + (row.text.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .sort((a,b) => b.score-a.score || a.order-b.order).slice(0, limit);
  }
  deleteSession(campaign, id) { return this.run('DELETE FROM sessions WHERE campaign=? AND id=?', campaign, id); }
  close() { this.db.close(); }
}

export function timestamp(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(x => String(x).padStart(2,'0')).join(':');
}
export function transcript(session, chunks) {
  return `# ${session.title}\nSession: ${session.id}\nDate: ${new Date(session.started).toISOString()}\n\n` +
    chunks.filter(c => c.state === 'done').map(c => `[${timestamp(c.offset)}] ${c.speaker}: ${c.text}`).join('\n\n') +
    (chunks.some(c => c.state !== 'done') ? '\n\n[Some audio has not been transcribed. Check session status.]' : '');
}
