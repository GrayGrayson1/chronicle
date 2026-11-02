import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { childEnvironment, SerialQueue } from './process.js';

export class Whisper {
  constructor(config) { this.config = config; this.queue = new SerialQueue(2000); this.child = null; this.pending = new Map(); this.stopping = false; }
  launch() {
    if (this.child) return;
    const child = spawn(this.config.pythonBin, ['-u', fileURLToPath(new URL('../scripts/whisper_worker.py', import.meta.url))], {
      env: childEnvironment(), shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
    this.child = child;
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-3000); });
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      let result; try { result = JSON.parse(line); } catch { return; }
      if (!result.id) return;
      const waiter = this.pending.get(result.id);
      if (waiter) { this.pending.delete(result.id); clearTimeout(waiter.timer); result.error ? waiter.reject(new Error(result.error)) : waiter.resolve(result.segments); }
    });
    const fail = error => {
      if (this.child !== child) return;
      this.child = null;
      for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
      this.pending.clear();
    };
    child.on('error', error => fail(new Error(`Cannot start local Whisper: ${error.code || error.message}`)));
    child.on('close', code => fail(new Error(`Whisper stopped (${code}). ${stderr.slice(-800)}`)));
  }
  transcribe(path, glossary = '', language = null) {
    return this.queue.run(() => new Promise((resolve, reject) => {
      if (this.stopping) return reject(new Error('Whisper is shutting down.'));
      this.launch();
      const id = randomUUID();
      const timer = setTimeout(() => { this.child?.kill('SIGKILL'); reject(new Error('Local transcription timed out.')); }, 30 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, path, glossary,language }) + '\n');
    }));
  }
  close() { this.stopping = true; this.child?.kill(); }
}
