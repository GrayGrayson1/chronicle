import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Store, transcript } from './store.js';
import { Codex, splitText } from './codex.js';
import { Whisper } from './whisper.js';
import { AudioProcessor } from './processor.js';
import { childEnvironment } from './process.js';
import { lockData } from './lock.js';

process.umask(0o077);
lockData(config.dataDir);
const store=new Store(join(config.dataDir,'chronicle.sqlite'));
store.recover();
const name=process.env.LOCAL_CAMPAIGN || 'My campaign';
const channel=`local:${name}`;
const campaign=store.campaign('local',channel) || store.createCampaign('local',channel,name);
if (process.env.CAMPAIGN_GLOSSARY) store.run('UPDATE campaigns SET glossary=? WHERE id=?',process.env.CAMPAIGN_GLOSSARY.slice(0,1000),campaign.id);
const ai=new Codex(config), whisper=new Whisper(config), audio=new AudioProcessor(store,whisper,config);
const [command,...args]=process.argv.slice(2);
const exportDir=join(config.dataDir,'exports'); mkdirSync(exportDir,{ recursive:true });
function findSession(id) {
  const session=store.session(campaign.id,id);
  if (!session) throw new Error('Session not found in this local campaign. Run: npm run local -- list');
  return session;
}
async function finish(session) {
  console.log('Finishing local transcription. Long recordings may take time...');
  store.updateSession(session.id,'processing');
  await audio.wait(session.id);
  const chunks=store.chunks(session.id);
  const path=join(exportDir,`${session.id}-transcript.md`);
  writeFileSync(path,transcript(session,chunks));
  console.log(`Transcript: ${path}`);
  const failed=chunks.filter(c=>c.state==='failed').length;
  if (failed) console.log(`${failed} audio segment(s) failed. Audio retained. Fix setup and use retry.`);
  try {
    console.log('Asking your local Codex CLI for a recap...');
    const recap=await ai.recap(session,chunks);
    store.updateSession(session.id,failed ? 'partial':'ready',recap);
    const recapPath=join(exportDir,`${session.id}-recap.md`);
    writeFileSync(recapPath,recap); console.log(`Recap: ${recapPath}\n\n${recap}`);
  } catch (error) { store.updateSession(session.id,'needs_attention'); throw error; }
}

async function record(title) {
  if (!title) throw new Error('Usage: npm run local -- record "Session title"');
  const session=store.createSession(campaign.id,title,'local');
  const directory=join(config.dataDir,'audio',session.id); mkdirSync(directory,{ recursive:true });
  console.log(`Session ${session.id}: ${title}\nTell everyone you are recording. Capturing microphone AND playback audio.\nThis records your microphone even if you mute yourself in Discord.\nUse headphones and match PLAYBACK_DEVICE to Discord’s output.\nPress ENTER to stop.\n`);
  let problem='', stopping=false;
  const children=[];
  const stopped=[];
  let stop;
  const stopRequested=new Promise(resolveStop=>{ stop=()=>{ if (!stopping) { stopping=true; resolveStop(); } }; });
  const readline=createInterface({ input:process.stdin });
  readline.once('line',stop);
  const onInterrupt=()=>stop(); process.once('SIGINT',onInterrupt);
  const timer=setTimeout(()=>{ console.log('Session time limit reached.'); stop(); },config.maxHours*3600000);
  try {
    for (const source of ['mic','system']) {
      const child=spawn(config.pythonBin,['-u',fileURLToPath(new URL('../scripts/local_record.py',import.meta.url)),
        '--source',source,'--output',directory,'--started',String(session.started/1000)],
        { env:childEnvironment(),shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'] });
      children.push(child);
      stopped.push(new Promise(resolveExit=>{
        child.once('close',code=>{ if (!stopping) { problem=`${source} recorder exited (${code}).`; stop(); } resolveExit(); });
        child.once('error',error=>{ problem=`Could not start ${source} recorder: ${error.message}`; stop(); resolveExit(); });
      }));
      child.stdin.on('error',()=>{});
      child.stderr.on('data',data=>process.stderr.write(data));
      createInterface({ input:child.stdout }).on('line',line=>{
        let event; try { event=JSON.parse(line); } catch { return; }
        if (event.error) { problem=`${source}: ${event.error}`; stop(); }
        if (event.ready) console.log(`${source==='mic'?'Your microphone':'Playback'}: ${event.device}`);
        if (event.path) {
          store.addAudio(session.id,source==='mic' ? (process.env.LOCAL_SPEAKER || 'You') : 'Other participants / system audio',event.offset,event.path);
          void audio.kick();
          if (store.pendingCount()>config.maxPendingAudio) { problem='Transcription backlog reached its limit. Recording stopped; saved audio is retained.'; stop(); }
        }
      });
    }
    await stopRequested;
    children.forEach(c=>c.stdin.end('\n'));
    const killTimer=setTimeout(()=>children.forEach(c=>{
      if (c.exitCode===null) { problem=problem || 'An audio device did not stop promptly; its final buffered audio may be missing.'; c.kill('SIGKILL'); }
    }),8000);
    await Promise.all(stopped); clearTimeout(killTimer);
  } finally {
    clearTimeout(timer); readline.close(); process.removeListener('SIGINT',onInterrupt);
    children.forEach(c=>{ if (c.exitCode===null) c.kill(); });
  }
  if (problem) console.error(problem);
  await finish(session);
  if (problem) store.updateSession(session.id,'partial');
}

try {
  switch (command) {
    case 'record': await record(args.join(' ')); break;
    case 'import':
    case 'notes': {
      if (!args[0]) throw new Error(`Usage: npm run local -- ${command} "path/to/file" "Session title"`);
      const source=resolve(args[0]);
      const session=store.createSession(campaign.id,args.slice(1).join(' ') || 'Imported session','local','importing');
      if (command==='notes') {
        const text=readFileSync(source,'utf8');
        if (!text.trim()) throw new Error('Notes file is empty.');
        splitText(text,2000).forEach((part,index)=>store.addText(session.id,'Imported notes',index/1000,part));
      } else {
        const directory=join(config.dataDir,'audio',session.id); mkdirSync(directory,{ recursive:true });
        const path=join(directory,`upload${extname(source)}`); copyFileSync(source,path);
        store.addAudio(session.id,'Imported recording (speakers unknown)',0,path);
      }
      await finish(session); break;
    }
    case 'list':
      for (const s of store.sessions(campaign.id)) console.log(`${s.id}  ${s.state.padEnd(16)} ${new Date(s.started).toLocaleDateString()}  ${s.title}`);
      break;
    case 'ask': console.log(await ai.ask(store,campaign,args.join(' '))); break;
    case 'retry': {
      const session=findSession(args[0]);
      store.run("UPDATE chunks SET state='pending',error='' WHERE session=? AND state='failed'",session.id);
      await finish(session); break;
    }
    case 'recap': console.log(findSession(args[0]).recap || 'No recap yet. Use retry.'); break;
    case 'transcript': console.log(transcript(findSession(args[0]),store.chunks(args[0]))); break;
    default: console.log(`Chronicle local mode — campaign: ${name}
No Discord bot or API key required.

npm run local -- record "Session 1"                 Record mic + playback
npm run local -- import "session.mp3" "Session 1"   Import existing audio
npm run local -- notes "notes.md" "Session 1"       Import text notes
npm run local -- list                               List sessions
npm run local -- ask "What did the innkeeper say?"  Ask Codex about sessions
npm run local -- recap SESSION_ID                   Read a saved recap
npm run local -- transcript SESSION_ID              Print the transcript
npm run local -- retry SESSION_ID                   Retry transcription/recap

Set LOCAL_CAMPAIGN in .env for a separate campaign archive.
Exports are written to ${exportDir}`);
  }
} catch (error) { console.error(error.message); process.exitCode=1; }
finally { audio.stopping=true;ai.close();whisper.close(); await audio.running?.catch(()=>{}); store.close(); }
