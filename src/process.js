import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export function codexCommand(config) {
  const bin=config.codexBin;
  if (bin.endsWith('.js')) return { bin:process.execPath, prefix:[bin] };
  // npm installs a .cmd shim on Windows. Invoke its JS entrypoint through Node
  // instead of enabling a shell to run a shim.
  if (process.platform==='win32' && (bin==='codex' || bin==='codex.cmd')) {
    const roots=[process.env.APPDATA && join(process.env.APPDATA,'npm'),dirname(process.execPath)].filter(Boolean);
    for (const root of roots) {
      const entry=join(root,'node_modules','@openai','codex','bin','codex.js');
      if (existsSync(entry)) return { bin:process.execPath,prefix:[entry] };
    }
  }
  return { bin,prefix:[] };
}

// Arguments are passed directly; Discord input never becomes a shell command.
export function runProcess(bin, args, { input = '', cwd, env = process.env, timeout = 240000, maxOutput = 2000000,signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, signal, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '', settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(result);
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${bin} timed out.`)); }, timeout);
    child.on('error', error => finish(new Error(`Could not run ${bin}: ${error.code || error.message}`)));
    child.stdout.on('data', data => {
      stdout += data.toString();
      if (stdout.length > maxOutput) { child.kill('SIGKILL'); finish(new Error('Process output exceeded limit.')); }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
    child.on('close', code => code === 0 ? finish(null, stdout.trim()) : finish(new Error(`${bin} exited (${code}). ${stderr.slice(-1500)}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function childEnvironment() {
  const env = { ...process.env };
  delete env.DISCORD_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

export class SerialQueue {
  constructor(max = 10) { this.tail = Promise.resolve(); this.count = 0; this.max = max; }
  run(fn) {
    if (this.count >= this.max) return Promise.reject(new Error('The local AI queue is full. Try again shortly.'));
    this.count++;
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {}).finally(() => { this.count--; });
    return task;
  }
}
