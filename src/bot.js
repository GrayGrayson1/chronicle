import { Client, Events, GatewayIntentBits, PermissionFlagsBits, ChannelType, AttachmentBuilder, MessageFlags } from 'discord.js';
import { mkdirSync, writeFileSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { config, required } from './config.js';
import { Store, transcript } from './store.js';
import { Codex, splitText } from './codex.js';
import { Whisper } from './whisper.js';
import { AudioProcessor, Recorder, captureHealth, captureReport, captureSummary, speakerNeedsCheck } from './audio.js';
import { downloadAttachment } from './download.js';
import { lockData } from './lock.js';
import { Archive } from './archive.js';
import { Engine } from './engine.js';
import { SemanticSearch } from './search.js';
import { Integrations } from './integrations.js';
import { createDashboard } from './dashboard.js';
import { handleArchiveCommand,discordActor } from './bot-archive.js';
import { createPublisher, publishSummary } from './publish.js';
import { commands } from './commands.js';

required('DISCORD_TOKEN','DISCORD_CLIENT_ID');
process.umask(0o077);
lockData(config.dataDir);
mkdirSync(config.dataDir, { recursive:true, mode:0o700 });
const store = new Store(join(config.dataDir,'chronicle.sqlite'));
store.recover();
// Remove audio left behind between a successful DB commit and file removal.
const audioRoot = join(config.dataDir, 'audio');
mkdirSync(audioRoot, { recursive:true });
const trackedAudio = new Set(store.all('SELECT path FROM chunks WHERE path IS NOT NULL').map(row => row.path));
for (const dir of readdirSync(audioRoot, { withFileTypes:true })) {
  if (!dir.isDirectory()) continue;
  for (const file of readdirSync(join(audioRoot,dir.name))) {
    const path = join(audioRoot,dir.name,file);
    if (!trackedAudio.has(path)) try { unlinkSync(path); } catch {}
  }
}
const ai = new Codex(config), whisper = new Whisper(config), audio = new AudioProcessor(store,whisper,config);
const active = new Map(), busy = new Set(),finishing=new Map();
const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,...(process.env.ENABLE_PLAY_BY_POST==='1'?[GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]:[])], allowedMentions:{ parse:[] } });
const companionTokens=JSON.parse(process.env.DISCORD_COMPANION_TOKENS||'[]');
if(!Array.isArray(companionTokens)||companionTokens.some(token=>typeof token!=='string'))throw new Error('DISCORD_COMPANION_TOKENS must be a JSON array of bot tokens.');
const companions=companionTokens.map(()=>new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates],allowedMentions:{parse:[]}}));
const archive=new Archive(store);
const search=process.env.SEMANTIC_SEARCH==='1'?new SemanticSearch(archive,config):null;
const engine=new Engine({archive,ai,audio,search});engine.recover();
const integrations=new Integrations(archive,config,{discord:client});
const publisher=createPublisher({archive,config});
async function announceSite(campaign,result) {
  const info=store.get('SELECT * FROM campaigns WHERE id=?',campaign);
  if (!info || info.guild==='local') return;
  const channel=await client.channels.fetch(info.channel);
  await channel.send({content:publishSummary(result,publisher.options().url),allowedMentions:{parse:[]}});
}
engine.onEvent=(campaign,event,data)=>{
  // Approved sessions refresh the player site when SITE_AUTO_PUBLISH=1.
  if (event==='session_approved') void publisher.auto(campaign).then(result=>result&&announceSite(campaign,result)).catch(error=>console.error(`Campaign site publish failed: ${error.message}`));
  return integrations.notify(campaign,event,data);
};
const dashboard=await createDashboard({archive,engine,config,search,integrations,status:()=>({connected:client.isReady()}),live:()=>[...active.values()].map(l=>({campaign:l.campaign.id,session:l.session.id,title:l.session.title,speakers:l.recorder?.consented.size||0,paused:l.paused}))});
console.log(`Campaign dashboard: ${dashboard.url}/#token=${dashboard.token}\nKeep this host link private.`);
const postCleanup=setInterval(()=>{void integrations.cleanupPosts().catch(()=>{});},60000);postCleanup.unref();
const help = `**Chronicle — your campaign notebook**
An admin runs **/campaign create** in a dedicated text channel. Everyone who can view that channel shares its campaign archive.
Set **/character** to your player/character name. Admin: **/session start**, then each player runs **/consent allow:true** in this text channel. Only opted-in speakers are saved. **/consent allow:false** stops future capture; already saved speech remains.
**/session stop** finishes transcription and prepares a review. Use **/dashboard** or **/review** to approve facts before they enter the campaign record. **/ask** searches saved sessions; **/session list**, **recap**, and **transcript** open the archive.
**/session notes** imports a .txt/.md transcript; **/session upload** imports existing audio. Uploaded mixed audio has no reliable speaker labels.
Speech-to-text runs locally. Codex receives transcript text and uses your Codex account limits. Audio retention is configurable in the dashboard; failed audio is kept for retry. **/wiki**, **/quest**, **/journal**, **/timeline**, **/gems** and **/handout** access campaign tools. No DMs or other-channel message history is read.`;
function admin(i) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error('This command requires Manage Server permission.');
}
function campaignFor(i) {
  const campaign = store.campaign(i.guildId,i.channelId);
  if (!campaign) throw new Error('An admin must run /campaign create in this text channel first.');
  return campaign;
}
function sessionFor(i, campaign) {
  const row = store.session(campaign.id,i.options.getString('id',true));
  if (!row) throw new Error('Session not found in this channel’s campaign. Use /session list.');
  return row;
}
async function reply(i, content) {
  const text = String(content);
  const payload = text.length <= 1900 ? { content:text } : { content:text.slice(0,1600)+'\n\nFull text attached.', files:[new AttachmentBuilder(Buffer.from(text), { name:'chronicle.md' })] };
  if (i.deferred || i.replied) return i.editReply(payload);
  return i.reply({ ...payload, flags:MessageFlags.Ephemeral });
}
async function announce(channel, content) {
  if (content.length > 1900) return channel.send({ content:content.slice(0,1500)+'\n\nFull recap attached.', files:[new AttachmentBuilder(Buffer.from(content),{ name:'recap.md' })] });
  return channel.send({ content });
}
async function finishSession(session, channel, reason = '') {
  if (busy.has(session.id)) return;
  busy.add(session.id);
  try {
    store.updateSession(session.id,'processing');
    await audio.wait(session.id);
    const chunks = store.chunks(session.id);
    const failed = chunks.filter(c => c.state === 'failed').length;
    const result=await engine.generateReview(session.campaign,{subject:'host',root:true},session.id);
    const notice=[reason,failed?`${failed} audio segment(s) failed. Use /session retry after fixing transcription.`:''].filter(Boolean).join('\n');
    await announce(channel,`**${session.title}** · Session \`${session.id}\`\n${notice}\nThe transcript is processed. A campaign administrator can review extracted facts in **/dashboard** or **/review show id:${result.review}** before approval.`);
  } catch (error) {
    store.updateSession(session.id,'needs_attention');
    console.error(`Session ${session.id} needs attention: ${error.message}`);
    await announce(channel,`Session \`${session.id}\` is saved, but processing could not finish. Use **/session status**, fix the local setup, then **/session retry**.`).catch(() => {});
  } finally { busy.delete(session.id); }
}
function queueFinish(session,channel,reason='') {
  const promise=finishSession(session,channel,reason);finishing.set(session.id,promise);
  void promise.finally(()=>finishing.delete(session.id)).catch(()=>{});return promise;
}
function saveCapture(live) {
  const report=captureReport(live.health);
  store.saveCaptureReport(live.session.id,report);
  return report;
}
function stopLive(guild, channel, reason='') {
  const live = active.get(guild);
  if (!live) return;
  active.delete(guild); live.recorder?.stop();
  // Post the per-speaker capture check before transcription finishes, so problems show up right away.
  try { void announce(channel,captureSummary(saveCapture(live),live.session)).catch(()=>{}); }
  catch (error) { console.error(`Capture report failed: ${error.message}`); }
  void queueFinish(live.session,channel,reason);
}

async function registerGuild(guild) {
  try {
    await client.application.commands.set(commands, guild.id);
    console.log(`Registered Chronicle commands in ${guild.name} (${guild.id}).`);
  } catch (error) {
    console.error(`Could not register commands in ${guild.name} (${guild.id}): ${error.message}`);
  }
}

client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand()) return;
  try {
    if (!i.guildId || i.channel?.type !== ChannelType.GuildText) throw new Error('Use Chronicle in a regular text channel in a server where the bot is installed.');
    if (i.commandName === 'help') return reply(i,help);
    if (await handleArchiveCommand(i,{archive,engine,reply,ai,active,dashboard})) return;
    const commandName=['start','end','pause','resume'].includes(i.commandName)?'session':i.commandName;
    if (commandName === 'campaign') {
      const action=i.options.getSubcommand();
      if (action==='create') {
        admin(i);
        if (store.campaign(i.guildId,i.channelId)) throw new Error('This channel already has a campaign.');
        const campaign=store.createCampaign(i.guildId,i.channelId,i.options.getString('name',true));
        store.run('INSERT INTO members VALUES(?,?,?,?)',campaign.id,i.user.id,'owner',i.user.username);
        return reply(i,`Campaign **${campaign.name}** created. Archive access follows this text channel’s permissions. Use /help to get started.`);
      }
      const campaign=campaignFor(i);
      if (action==='glossary') { admin(i); store.run('UPDATE campaigns SET glossary=? WHERE id=?',i.options.getString('text',true),campaign.id); return reply(i,'Glossary saved for future transcription.'); }
      return reply(i,`**${campaign.name}**\nGlossary: ${campaign.glossary || '(none)'}\nSaved sessions: ${store.get('SELECT COUNT(*) AS n FROM sessions WHERE campaign=?',campaign.id).n}`);
    }
    const campaign=campaignFor(i);
    const actor=discordActor(archive,campaign.id,i);
    if (i.commandName==='character') { store.setLabel(campaign.id,i.user.id,i.options.getString('name',true)); return reply(i,'Speaker label saved. It applies to your next speaking turn.'); }
    if (i.commandName==='consent') {
      const live=active.get(campaign.id);
      if (!live?.recorder || live.campaign.id!==campaign.id) throw new Error('There is no active recording for this campaign yet.');
      if (i.member.voice?.channelId!==live.recorder.channel.id) throw new Error('Join the recording’s voice channel first.');
      const allow=i.options.getBoolean('allow',true);
      allow ? live.recorder.consent(i.user.id) : live.recorder.revoke(i.user.id);
      return reply(i,allow ? 'Your voice will now be recorded and transcribed. Transcript text is sent to Codex for recaps and answers.' : 'Your future voice audio is no longer saved. Previously saved speech remains in the session archive.');
    }
    if (i.commandName==='ask') {
      await i.deferReply({ flags:MessageFlags.Ephemeral });
      return reply(i,(await engine.ask(campaign.id,actor,i.options.getString('question',true))).answer);
    }
    if (i.commandName==='publish') {
      admin(i);
      await i.deferReply({ flags:MessageFlags.Ephemeral });
      const result=await publisher.publish(campaign.id);
      return reply(i,publishSummary(result,publisher.options().url));
    }
    if (commandName!=='session') return;
    const action=i.commandName==='start'?'start':i.commandName==='end'?'stop':['pause','resume'].includes(i.commandName)?i.commandName:i.options.getSubcommand();
    if (action==='list') return reply(i,archive.sessions(campaign.id,actor).map(s=>`\`${s.id}\` · ${new Date(s.started).toISOString().slice(0,10)} · **${s.title}** · ${s.state}`).join('\n') || 'No sessions yet.');
    if (action==='status') {
      const live=active.get(campaign.id);
      const sessions=store.sessions(campaign.id).slice(0,5);
      return reply(i,`${live?.campaign.id===campaign.id ? `Recording: **${live.session.title}**, ${(live.recorder?.consented.size||0)} opted-in speaker(s).` : 'No active recording for this campaign.'}\n`+
        sessions.map(s=>{const capture=store.captureReport(s.id),flagged=capture?.speakers.filter(speakerNeedsCheck).map(x=>x.label)||[];
          return `\`${s.id}\` ${s.state}: ${store.chunks(s.id).filter(c=>c.text).length} transcript entries, ${store.get("SELECT COUNT(*) AS n FROM chunks WHERE session=? AND state IN ('pending','working')",s.id).n} queued, ${store.get("SELECT COUNT(*) AS n FROM chunks WHERE session=? AND state='failed'",s.id).n} failed.`+
            (capture?` Capture: ${capture.speakers.length} speaker(s)${flagged.length?`, check ${flagged.join(', ')}`:', looked healthy'}.`:'');}).join('\n'));
    }
    if (action==='start') {
      admin(i);
      if (active.has(campaign.id)) throw new Error('A recording is already active or starting for this campaign.');
      let channel=i.options.getChannel('voice',true);
      if (i.member.voice?.channelId!==channel.id) throw new Error('Join the selected voice channel first.');
      const me=i.guild.members.me;
      for (const target of [i.channel,channel]) {
        const perms=target.permissionsFor(me);
        if (!perms?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages])) throw new Error('The bot needs View Channel and Send Messages in both the campaign text channel and voice-channel chat.');
      }
      if (!channel.permissionsFor(me).has(PermissionFlagsBits.Connect)) throw new Error('The bot needs Connect permission in that voice channel.');
      if (!i.channel.permissionsFor(me).has(PermissionFlagsBits.AttachFiles)) throw new Error('The bot needs Attach Files in this text channel for recaps and transcripts.');
      const recordingClient=[client,...companions].find(candidate=>candidate.guilds.cache.has(i.guildId)&&![...active.values()].some(l=>l.botId===candidate.user.id&&l.campaign.guild===i.guildId&&!l.paused));
      if(!recordingClient)throw new Error('Every installed recording bot is busy. Configure companion bots for simultaneous tables.');
      if([...active.values()].some(l=>l.voiceId===channel.id))throw new Error('This voice channel already has a session.');
      if(recordingClient!==client)channel=await recordingClient.channels.fetch(channel.id);
      if(!channel.permissionsFor(channel.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect]))throw new Error('The selected recording bot needs View Channel and Connect in this voice channel.');
      await i.deferReply({ flags:MessageFlags.Ephemeral });
      const session=store.createSession(campaign.id,i.options.getString('title',true),i.user.id);
      const live={ campaign,session,recorder:null,voiceId:channel.id,botId:recordingClient.user.id,paused:false,output:i.channel,health:captureHealth() };
      active.set(campaign.id,live);
      try {
        await announce(channel,`**Chronicle recording notice**\nSession **${session.title}** is starting. Only speakers who opt in with **/consent allow:true** in <#${i.channelId}> are saved. **/consent allow:false** stops future capture. Audio is transcribed locally; transcript text goes to Codex for summaries. Archive access follows <#${i.channelId}>.`);
        await announce(i.channel,`**${session.title}** · Session \`${session.id}\`\nRecording in <#${channel.id}>. Each participant must use **/consent allow:true** here before their voice is saved. Session starter/admin: **/session stop**.`);
        live.recorder=new Recorder({ channel,session,campaign,store,audio,maxHours:config.maxHours,health:live.health,
          onWarning:message=>void announce(i.channel,message).catch(()=>{}),
          onFailure:error=>{ if (active.get(campaign.id)===live) stopLive(campaign.id,i.channel,error.message); },
          onTimeout:()=>{ if (active.get(campaign.id)===live) stopLive(campaign.id,i.channel,'Session reached its configured time limit.'); } });
        await live.recorder.start();
        return reply(i,`Connected. Session \`${session.id}\` is active. Each speaker, including you, must opt in with /consent allow:true.`);
      } catch (error) { active.delete(campaign.id); live.recorder?.stop(); store.updateSession(session.id,'needs_attention'); throw error; }
    }
    if(action==='pause' || action==='resume') {
      const live=active.get(campaign.id);
      if(!live)throw new Error('No active session in this campaign.');
      if(live.session.owner!==i.user.id)admin(i);
      if(action==='pause') {
        if(live.paused)throw new Error('This session is already paused.');
        live.recorder?.stop();live.recorder=null;live.paused=true;store.updateSession(live.session.id,'paused');
        return reply(i,'Recording paused and voice disconnected. Use /resume to continue this session; everyone will opt in again.');
      }
      if(!live.paused)throw new Error('This session is not paused.');
      if(i.member.voice?.channelId!==live.voiceId)throw new Error('Rejoin this session’s voice channel before resuming.');
      const candidate=[client,...companions].find(bot=>bot.guilds.cache.has(i.guildId)&&![...active.values()].some(l=>l!==live&&!l.paused&&l.botId===bot.user.id&&l.campaign.guild===i.guildId));
      if(!candidate)throw new Error('All recording bots are busy. Resume when a bot becomes available.');
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const channel=await candidate.channels.fetch(live.voiceId);
      await announce(channel,`Chronicle session **${live.session.title}** is resuming. Everyone must opt in again with **/consent allow:true** in <#${i.channelId}>.`);
      live.recorder=new Recorder({channel,session:live.session,campaign,store,audio,maxHours:Math.max(0.01,config.maxHours-(Date.now()-live.session.started)/3600000),health:live.health,onWarning:message=>void announce(live.output,message).catch(()=>{}),onFailure:error=>stopLive(campaign.id,live.output,error.message),onTimeout:()=>stopLive(campaign.id,live.output,'Session time limit reached.')});
      live.paused=false;live.botId=candidate.user.id;
      try {await live.recorder.start();store.updateSession(live.session.id,'recording');}catch(error){live.recorder?.stop();live.recorder=null;live.paused=true;store.updateSession(live.session.id,'paused');throw error;}
      return reply(i,'Session resumed. Everyone must use /consent allow:true again.');
    }
    if (action==='stop') {
      const live=active.get(campaign.id);
      if (!live || live.campaign.id!==campaign.id) throw new Error('No active recording for this campaign.');
      if (live.session.owner!==i.user.id) admin(i);
      stopLive(campaign.id,i.channel);
      return reply(i,'Recording stopped. Transcription will finish locally, then an administrator can review and approve the extracted campaign facts.');
    }
    if (action==='notes' || action==='upload') {
      admin(i);
      if (action==='upload' && !i.options.getBoolean('consent',true)) throw new Error('Everyone in an uploaded recording must agree to processing first.');
      if (busy.size>=8 || store.pendingCount()>=config.maxPendingAudio) throw new Error('The processing queue is full. Try again after existing sessions finish.');
      await i.deferReply({ flags:MessageFlags.Ephemeral });
      const attachment=i.options.getAttachment('file',true);
      const buffer=await downloadAttachment(attachment,action==='notes' ? 1024*1024 : 100*1024*1024,action==='notes' ? ['.txt','.md'] : ['.wav','.mp3','.m4a','.ogg','.flac','.webm','.mp4']);
      const session=store.createSession(campaign.id,i.options.getString('title',true),i.user.id,'importing');
      if (action==='notes') {
        const parts=splitText(new TextDecoder('utf-8',{ fatal:true }).decode(buffer),2000);
        if (!parts.length) { store.deleteSession(campaign.id,session.id); throw new Error('The notes file is empty.'); }
        parts.forEach((text,index)=>store.addText(session.id,'Imported notes',index/1000,text));
      } else {
        const directory=join(audioRoot,session.id); mkdirSync(directory,{ recursive:true });
        const path=join(directory,`upload${extname(attachment.name).toLowerCase()}`); writeFileSync(path,buffer,{ mode:0o600 });
        store.addAudio(session.id,'Uploaded recording (speakers unknown)',0,path); void audio.kick();
      }
      await reply(i,`Session \`${session.id}\` imported. Processing locally; a recap will appear here when ready.`);
      void queueFinish(session,i.channel);
      return;
    }
    const session=sessionFor(i,campaign);
    if (['recap','transcript'].includes(action) && !archive.isAdmin(campaign.id,actor) && session.state!=='approved') throw new Error('This session is awaiting administrator review.');
    if (action==='recap') return reply(i,session.recap || 'No recap yet. Check /session status; an admin can use /session retry.');
    if (action==='transcript') return reply(i,transcript(session,store.chunks(session.id)));
    if (action==='retry') {
      admin(i);
      if(session.state==='approved')throw new Error('This session is already approved. Correct its reference entries in the dashboard to preserve review history.');
      if (busy.has(session.id) || [...active.values()].some(l=>l.session.id===session.id)) throw new Error('This session is still recording or processing.');
      store.run("UPDATE chunks SET state='pending',error='' WHERE session=? AND state='failed'",session.id);
      await reply(i,`Retrying saved session \`${session.id}\`. The recap will appear here.`);
      void queueFinish(session,i.channel); return;
    }
    if (action==='delete') {
      admin(i);
      if (i.options.getString('confirm',true)!=='DELETE') throw new Error('Type DELETE in the confirmation field.');
      if (busy.has(session.id) || [...active.values()].some(l=>l.session.id===session.id) || store.get("SELECT COUNT(*) AS n FROM chunks WHERE session=? AND state IN ('pending','working')",session.id).n) throw new Error('Wait for this session to stop and finish processing before deleting it.');
      store.deleteSession(campaign.id,session.id); rmSync(join(audioRoot,session.id),{ recursive:true,force:true });
      return reply(i,`Session \`${session.id}\` deleted from the bot. Messages and files already posted to Discord remain until you delete them there.`);
    }
  } catch (error) {
    console.error(`Command failed: ${error.message}`);
    // Never return raw subprocess stderr, paths, tokens, or local diagnostics to Discord.
    const message=error.message.includes('exited (') || error.message.includes('Could not run') || error.message.includes('timed out') ? 'The local AI command failed. Check the terminal and run npm run doctor on the host computer.' : error.message;
    await reply(i,message).catch(()=>{});
  }
});

client.on(Events.VoiceStateUpdate,(before,after)=>{
  const live=[...active.values()].find(l=>l.recorder?.channel.id===before.channelId||l.recorder?.channel.id===after.channelId);
  if (!live?.recorder) return;
  if (before.channelId===live.recorder.channel.id && after.channelId!==before.channelId) live.recorder.revoke(after.id);
  if (after.channelId===live.recorder.channel.id && before.channelId!==after.channelId && !after.member.user.bot) {
    void announce(live.recorder.channel,`Recording is active. New arrivals must opt in with **/consent allow:true** in <#${live.campaign.channel}>. Your voice is not saved until you opt in.`).catch(()=>{});
  }
});
client.once(Events.ClientReady,ready=>{
  console.log(`Chronicle connected as ${ready.user.tag}. Use /help in your server.`);
  for (const guild of ready.guilds.cache.values()) void registerGuild(guild);
  void audio.kick();
});
client.on(Events.GuildCreate,guild=>void registerGuild(guild));
client.on(Events.Error,error=>console.error('Discord client error:',error.message));
let shuttingDown=false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown=true;
  for (const live of active.values()) { live.recorder?.stop(); try { saveCapture(live); } catch {} store.updateSession(live.session.id,'interrupted'); }
  active.clear();
  clearInterval(postCleanup);engine.closing=true;await dashboard.close();
  audio.stopping=true;ai.close();whisper.close();
  await client.destroy();
  for(const companion of companions)await companion.destroy();
  console.log('Stopped. Pending audio will resume on next startup.');
  // Avoid closing SQLite while a worker rejection is still being recorded.
  await audio.running?.catch(()=>{});
  await Promise.all(engine.running.values());
  await Promise.allSettled(finishing.values());
  store.close(); process.exit(0);
}
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
await Promise.all([client.login(config.token),...companions.map((bot,index)=>bot.login(companionTokens[index]))]);
