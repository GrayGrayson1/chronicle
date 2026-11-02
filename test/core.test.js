import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, timestamp, transcript } from '../src/store.js';
import { AudioProcessor, wav } from '../src/processor.js';
import { Codex, codexArgs, splitText } from '../src/codex.js';
import { SerialQueue, runProcess } from '../src/process.js';
import { downloadAttachment } from '../src/download.js';

function fixture() {
  const store=new Store(':memory:');
  const a=store.createCampaign('guild-a','channel-a','Campaign A');
  const b=store.createCampaign('guild-b','channel-b','Campaign B');
  const sa=store.createSession(a.id,'Session A','user');
  const sb=store.createSession(b.id,'Secret Session B','user');
  return {store,a,b,sa,sb};
}
test('campaign retrieval and session access never cross boundaries',()=>{
  const {store,a,sa,sb}=fixture();
  store.addText(sa.id,'Jon',12,'The innkeeper gave us a silver key.');
  store.addText(sb.id,'Secret',10,'The innkeeper is secretly a dragon.');
  assert.equal(store.search(a.id,'innkeeper')[0].session,sa.id);
  assert.equal(store.search(a.id,'innkeeper').length,1);
  assert.equal(store.session(a.id,sb.id),undefined);
  store.close();
});
test('restart recovers in-flight audio and marks recordings interrupted',()=>{
  const {store,sa}=fixture();
  const id=store.addAudio(sa.id,'Player',0,'/not/a/real/file.wav');
  store.run("UPDATE chunks SET state='working' WHERE id=?",id);
  store.recover();
  assert.equal(store.chunks(sa.id)[0].state,'pending');
  assert.equal(store.get('SELECT state FROM sessions WHERE id=?',sa.id).state,'interrupted');
  store.close();
});
test('session deletion cascades transcript and audio metadata',()=>{
  const {store,a,sa}=fixture();
  store.addText(sa.id,'Player',0,'Secret notes');
  store.deleteSession(a.id,sa.id);
  assert.equal(store.chunks(sa.id).length,0);
  store.close();
});
test('transcript exports speaker labels and real timestamps, flags incomplete audio',()=>{
  assert.equal(timestamp(3661.9),'01:01:01');
  const {store,sa}=fixture();
  store.addText(sa.id,'Zafir',61,'We accept the quest.');
  store.addAudio(sa.id,'DM',70,'/missing');
  const text=transcript(sa,store.chunks(sa.id));
  assert.match(text,/\[00:01:01\] Zafir: We accept the quest/);
  assert.match(text,/Some audio has not been transcribed/);
  store.close();
});
test('WAV header matches stereo 48k PCM and correct data size',()=>{
  const pcm=Buffer.alloc(192000), output=wav(pcm);
  assert.equal(output.toString('ascii',0,4),'RIFF');
  assert.equal(output.readUInt32LE(24),48000);
  assert.equal(output.readUInt16LE(22),2);
  assert.equal(output.readUInt32LE(40),pcm.length);
  assert.equal(output.readUInt32LE(4),output.length-8);
});
test('successful transcription commits offsets and removes raw audio',async()=>{
  const {store,sa}=fixture();
  const directory=mkdtempSync(join(tmpdir(),'chronicle-test-'));
  const path=join(directory,'sample.wav'); writeFileSync(path,Buffer.alloc(1));
  store.addAudio(sa.id,'Zafir',30,path);
  const processor=new AudioProcessor(store,{transcribe:async()=>[{start:2.5,text:'The door is locked.'}]},{});
  await processor.wait(sa.id);
  const text=store.chunks(sa.id).find(c=>c.text);
  assert.equal(text.offset,32.5); assert.equal(text.speaker,'Zafir');
  assert.equal(existsSync(path),false);
  assert.equal(store.pendingCount(),0);
  store.close(); rmSync(directory,{recursive:true,force:true});
});
test('failed transcription preserves audio for retry and does not fabricate text',async()=>{
  const {store,sa}=fixture();
  const directory=mkdtempSync(join(tmpdir(),'chronicle-test-'));
  const path=join(directory,'sample.wav'); writeFileSync(path,Buffer.alloc(1));
  store.addAudio(sa.id,'DM',0,path);
  const processor=new AudioProcessor(store,{transcribe:async()=>{throw new Error('model missing');}},{});
  await processor.wait(sa.id);
  assert.equal(store.chunks(sa.id)[0].state,'failed');
  assert.equal(store.chunks(sa.id)[0].text,'');
  assert.equal(existsSync(path),true);
  store.close(); rmSync(directory,{recursive:true,force:true});
});
test('serial queue isolates failures, bounds queued tasks and preserves order',async()=>{
  const queue=new SerialQueue(2), result=[];
  let release;
  const first=queue.run(async()=>{await new Promise(r=>release=r); result.push(1); throw new Error('expected');});
  const second=queue.run(async()=>{result.push(2); return 'done';});
  await assert.rejects(queue.run(()=>3),/queue is full/);
  release(); await assert.rejects(first,/expected/); assert.equal(await second,'done');
  assert.deepEqual(result,[1,2]);
});
test('Codex bridge uses stdin and a clean workspace, omits bot token, cleans up',async()=>{
  const before=process.env.DISCORD_TOKEN; process.env.DISCORD_TOKEN='test-secret';
  let cwd;
  const ai=new Codex({codexBin:'codex',codexModel:'',codexTimeout:1000},async(bin,args,opts)=>{
    cwd=opts.cwd;
    assert.equal(bin,'codex'); assert.equal(args.at(-1),'-');
    assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config'));
    assert.equal(opts.env.DISCORD_TOKEN,undefined);
    assert.match(opts.input,/untrusted data/);
    assert.match(opts.input,/\$\(touch secret\)/);
    assert.equal(existsSync(cwd),true);
    return 'Factual recap.';
  });
  try { assert.equal(await ai.text('Summarize','$(touch secret)'),'Factual recap.'); assert.equal(existsSync(cwd),false); }
  finally { if (before===undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN=before; }
});
test('campaign Q&A passes only the selected campaign to Codex',async()=>{
  const {store,a,sa,sb}=fixture();
  store.addText(sa.id,'Player',10,'Our key is silver.');
  store.addText(sb.id,'Secret',10,'SUPER_SECRET_OTHER_CAMPAIGN');
  const ai=new Codex({codexBin:'codex',codexTimeout:1000},async(bin,args,opts)=>{
    assert.match(opts.input,/Our key is silver/); assert.doesNotMatch(opts.input,/SUPER_SECRET_OTHER_CAMPAIGN/);
    return 'Silver [Session '+sa.id+' 00:00:10].';
  });
  assert.match(await ai.ask(store,a,'What key do we have?'),/Silver/); store.close();
});
test('large transcript is split before recapping and citations retained',async()=>{
  const ai=new Codex({codexBin:'codex',codexTimeout:1000},async(bin,args,opts)=>{
    assert.ok(opts.input.length<140000);
    return 'Session 12345678 00:00:10: A factual note.';
  });
  const result=await ai.recap({id:'12345678',title:'Session'},[{state:'done',offset:10,speaker:'DM',text:'The gate opens. '.repeat(4000)}]);
  assert.match(result,/12345678/);
  assert.deepEqual(splitText('abcdef',3),['abc','def']);
});
test('subprocess execution does not evaluate shell expressions',async()=>{
  const payload='$(echo SHOULD_NOT_RUN); `echo bad`';
  const out=await runProcess(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{input:payload});
  assert.equal(out,payload);
});
test('attachment ingestion rejects arbitrary URLs and oversize files before network access',async()=>{
  await assert.rejects(downloadAttachment({name:'a.wav',size:10,url:'https://example.com/file'},100,['.wav']),/Only Discord-hosted/);
  await assert.rejects(downloadAttachment({name:'a.wav',size:1000,url:'https://cdn.discordapp.com/file'},100,['.wav']),/File limit/);
});
test('Codex defaults never enable a shell or unrestricted execution',()=>{
  const args=codexArgs({codexModel:''});
  assert.ok(args.includes('features.shell_tool=false'));
  assert.ok(args.includes('features.codex_hooks=false'));
  assert.equal(args.includes('danger-full-access'),false);
});
test('shutdown preserves in-flight audio as pending rather than converting the queue to failures',async()=>{
  const {store,sa}=fixture();store.addAudio(sa.id,'DM',0,'/saved/audio.wav');let reject;
  const processor=new AudioProcessor(store,{transcribe:()=>new Promise((resolve,rejectJob)=>{reject=rejectJob;})},{});
  const running=processor.kick();await new Promise(resolve=>setImmediate(resolve));processor.stopping=true;reject(new Error('shutdown'));await running;
  assert.equal(store.chunks(sa.id)[0].state,'pending');assert.equal(store.chunks(sa.id)[0].path,'/saved/audio.wav');store.close();
});
