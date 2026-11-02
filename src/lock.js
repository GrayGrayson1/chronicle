import { openSync, closeSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function lockData(directory) {
  mkdirSync(directory,{ recursive:true,mode:0o700 });
  const path=join(directory,'host.lock');
  try {
    const pid=Number(readFileSync(path,'utf8'));
    try { process.kill(pid,0); throw new Error('Another Chronicle process is using this data directory. Stop it first.'); }
    catch (error) { if (error.code!=='ESRCH') throw error; unlinkSync(path); }
  } catch (error) { if (error.code!=='ENOENT') throw error; }
  const fd=openSync(path,'wx',0o600); writeFileSync(fd,String(process.pid)); closeSync(fd);
  const release=()=>{ try { if (readFileSync(path,'utf8')===String(process.pid)) unlinkSync(path); } catch {} };
  process.once('exit',release);
  return release;
}
