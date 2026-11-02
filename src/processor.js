import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function wav(pcm, rate = 48000, channels = 2) {
  const header = Buffer.alloc(44);
  header.write('RIFF',0); header.writeUInt32LE(36+pcm.length,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(channels,22);
  header.writeUInt32LE(rate,24); header.writeUInt32LE(rate*channels*2,28);
  header.writeUInt16LE(channels*2,32); header.writeUInt16LE(16,34);
  header.write('data',36); header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}

export class AudioProcessor {
  constructor(store, whisper, config) { this.store = store; this.whisper = whisper; this.config = config; this.running = null; this.stopping=false; }
  kick() {
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    for (;;) {
      if(this.stopping)return;
      const row = this.store.get(`SELECT c.*,p.glossary,p.id AS campaign_id FROM chunks c JOIN sessions s ON s.id=c.session
        JOIN campaigns p ON p.id=s.campaign WHERE c.state='pending' ORDER BY c.rowid LIMIT 1`);
      if (!row) return;
      this.store.run("UPDATE chunks SET state='working' WHERE id=?", row.id);
      try {
        const hasSettings=this.store.get("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_settings'");
        const settings=hasSettings ? JSON.parse(this.store.get('SELECT data FROM campaign_settings WHERE campaign=?',row.campaign_id)?.data || '{}'):{};
        const segments = await this.whisper.transcribe(row.path, row.glossary,settings.language);
        // Transaction keeps the source chunk and timestamped transcript consistent on restart.
        this.store.db.exec('BEGIN');
        try {
          for (const s of segments) this.store.addText(row.session, s.speaker || row.speaker, row.offset+s.start, s.text,Math.max(0,(s.end||s.start)-s.start));
          this.store.run("UPDATE chunks SET state='done',path=? WHERE id=?", settings.retainAudio?row.path:null,row.id);
          this.store.db.exec('COMMIT');
        } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
        if (!settings.retainAudio) try { unlinkSync(row.path); } catch {}
      } catch (error) {
        if(this.stopping){this.store.run("UPDATE chunks SET state='pending',error='' WHERE id=?",row.id);return;}
        this.store.run("UPDATE chunks SET state='failed',error=? WHERE id=?", String(error.message).slice(0,1000), row.id);
        console.error(`Transcription failed for session ${row.session}; audio kept for /session retry.`);
      }
    }
  }
  async wait(session) {
    while (this.store.get("SELECT COUNT(*) AS n FROM chunks WHERE session=? AND state IN ('pending','working')", session).n) {if(this.stopping)throw new Error('Audio processing is shutting down. Pending audio is saved.');await this.kick();}
  }
  submit(session, speaker, offset, pcm) {
    if (pcm.length < 48000 * 2 * 2 * 0.25) return;
    if (this.store.pendingCount() >= this.config.maxPendingAudio) throw new Error('Local transcription cannot keep up; recording stopped. Saved audio is retained.');
    const directory = join(this.config.dataDir, 'audio', session);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${randomUUID()}.wav`);
    writeFileSync(path, wav(pcm), { mode: 0o600 });
    this.store.addAudio(session, speaker, offset, path);
    void this.kick();
  }
}

