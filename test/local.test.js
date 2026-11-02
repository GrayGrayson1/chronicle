import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProcess } from '../src/process.js';

test('local notes -> Codex bridge -> persisted recap -> campaign question works without Discord credentials',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chronicle-cli-test-'));
  const fake=join(dir,'fake-codex.js');
  const notes=join(dir,'notes.md');
  writeFileSync(fake,`let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>{ if (!input.includes('silver key')) process.exit(2); console.log('The innkeeper gave the party a silver key.'); });`);
  writeFileSync(notes,'The innkeeper gave us a silver key.');
  const env={...process.env,DATA_DIR:join(dir,'data'),CODEX_BIN:fake,LOCAL_CAMPAIGN:'Test Campaign',DISCORD_TOKEN:'',DISCORD_CLIENT_ID:'',DISCORD_GUILD_ID:''};
  const entry=resolve('src/local.js');
  try {
    const output=await runProcess(process.execPath,[entry,'notes',notes,'Session One'],{env});
    assert.match(output,/silver key/);
    const list=await runProcess(process.execPath,[entry,'list'],{env});
    assert.match(list,/ready\s+.*Session One/);
    const id=list.split(/\s/)[0];
    assert.equal(existsSync(join(dir,'data','exports',`${id}-transcript.md`)),true);
    assert.match(readFileSync(join(dir,'data','exports',`${id}-recap.md`),'utf8'),/silver key/);
    const answer=await runProcess(process.execPath,[entry,'ask','What key did we get?'],{env});
    assert.match(answer,/silver key/);
    const other=await runProcess(process.execPath,[entry,'list'],{env:{...env,LOCAL_CAMPAIGN:'Other Campaign'}});
    assert.equal(other,'');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
