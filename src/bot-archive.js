import { SlashCommandBuilder,PermissionFlagsBits } from 'discord.js';
import { questStatus } from './engine.js';
import { timestamp } from './store.js';
import { downloadAttachment } from './download.js';

const field=(name,description,required=true)=>option=>option.setName(name).setDescription(description).setRequired(required);
const entryId=field('id','Entry ID from its list');
export const archiveCommands=[
  new SlashCommandBuilder().setName('dashboard').setDescription('Open your campaign dashboard with a personal access key'),
  new SlashCommandBuilder().setName('asklive').setDescription('Ask about transcribed speech in the current recording')
    .addStringOption(field('question','Your question')),
  new SlashCommandBuilder().setName('wiki').setDescription('Campaign characters, locations, items and factions')
    .addSubcommand(s=>s.setName('list').setDescription('Browse campaign entries').addStringOption(o=>o.setName('kind').setDescription('Entry type').addChoices(...['pc','npc','item','location','faction'].map(v=>({name:v,value:v})))) )
    .addSubcommand(s=>s.setName('show').setDescription('Read an entry').addStringOption(entryId))
    .addSubcommand(s=>s.setName('search').setDescription('Search entry text').addStringOption(field('query','Search text')))
    .addSubcommand(s=>s.setName('create').setDescription('Create an entry (campaign admin)').addStringOption(o=>o.setName('kind').setDescription('Type').setRequired(true).addChoices(...['pc','npc','item','location','faction'].map(v=>({name:v,value:v})))).addStringOption(field('name','Entry name')).addStringOption(field('description','Description'))),
  new SlashCommandBuilder().setName('quest').setDescription('Track campaign objectives')
    .addSubcommand(s=>s.setName('list').setDescription('List quests'))
    .addSubcommand(s=>s.setName('show').setDescription('Read a quest').addStringOption(entryId))
    .addSubcommand(s=>s.setName('status').setDescription('Update a quest objective (campaign admin)').addStringOption(entryId).addIntegerOption(o=>o.setName('objective').setDescription('Objective number, starting at 1').setMinValue(1).setRequired(true)).addStringOption(o=>o.setName('status').setDescription('New status').setRequired(true).addChoices(...['planned','in_progress','blocked','failed','done'].map(v=>({name:v,value:v}))))),
  new SlashCommandBuilder().setName('journal').setDescription('Private or shared campaign notes')
    .addSubcommand(s=>s.setName('list').setDescription('List journals you can read'))
    .addSubcommand(s=>s.setName('show').setDescription('Read a journal').addStringOption(entryId))
    .addSubcommand(s=>s.setName('create').setDescription('Create your own journal').addStringOption(field('title','Journal title')).addStringOption(field('text','Journal text')).addBooleanOption(o=>o.setName('party').setDescription('Share with all campaign members (default private)'))),
  new SlashCommandBuilder().setName('review').setDescription('Review extracted campaign facts before approval')
    .addSubcommand(s=>s.setName('list').setDescription('List pending reviews (campaign admin)'))
    .addSubcommand(s=>s.setName('show').setDescription('See a review summary (campaign admin)').addStringOption(entryId))
    .addSubcommand(s=>s.setName('approve').setDescription('Approve reviewed facts; edit in dashboard first').addStringOption(entryId).addIntegerOption(o=>o.setName('version').setDescription('Version shown by /review show').setRequired(true)))
    .addSubcommand(s=>s.setName('reject').setDescription('Reject a review (campaign admin)').addStringOption(entryId)),
  new SlashCommandBuilder().setName('timeline').setDescription('Show reviewed campaign events'),
  new SlashCommandBuilder().setName('gems').setDescription('Show reviewed key moments, hero awards and quotes'),
  new SlashCommandBuilder().setName('handout').setDescription('Generate a session handout (campaign admin)').addStringOption(field('session','Approved session ID')),
  new SlashCommandBuilder().setName('playpost').setDescription('Import a chosen range from this text channel (campaign admin)')
    .addStringOption(field('first','First message ID')).addStringOption(field('last','Last message ID')).addStringOption(field('title','Session title')),
].map(c=>c.setDMPermission(false).toJSON());

export function discordActor(archive,campaign,interaction) {
  const subject=interaction.user.id;
  const admin=interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const existing=archive.store.get('SELECT * FROM members WHERE campaign=? AND subject=?',campaign,subject);
  if (!existing) archive.store.run('INSERT INTO members VALUES(?,?,?,?)',campaign,subject,admin?'admin':'player',interaction.user.username);
  // Losing Manage Server must not silently preserve a permission granted only
  // by automatic enrollment. Explicit campaign owners remain owners.
  return {subject,scopes:['read','write']};
}
export async function handleArchiveCommand(i,{archive,engine,reply,ai,active,dashboard}) {
  if (!archiveCommands.some(c=>c.name===i.commandName)) return false;
  const campaign=archive.store.campaign(i.guildId,i.channelId);
  if(!campaign)throw new Error('Create a campaign in this text channel first with /campaign create.');
  const actor=discordActor(archive,campaign.id,i),kind=i.commandName;
  const list=rows=>rows.map(row=>`\`${row.id}\` **${row.name}** · ${row.kind}`).join('\n')||'No entries yet.';
  if(kind==='dashboard') {
    // The member can create only a key for their own current role. It cannot
    // promote them; every API request checks campaign membership again.
    const issuer={subject:'host',root:true};
    const token=archive.issueToken(issuer,campaign.id,actor.subject,['read','write'],'Discord dashboard',7);
    await reply(i,`Your personal dashboard link (expires in 7 days):\n${dashboard.url}/#token=${token}\nThe host address must be reachable from your computer. Keep this link private.`);return true;
  }
  if(kind==='asklive') {
    const live=active.get(campaign.id);if(live?.campaign.id!==campaign.id)throw new Error('No active recording in this campaign.');
    await i.deferReply({ephemeral:true});
    const chunks=archive.store.chunks(live.session.id).filter(c=>c.text).slice(-160).map(c=>({session:c.session,time:timestamp(c.offset),speaker:c.speaker,text:c.text}));
    if(!chunks.length)throw new Error('No speech has been transcribed yet.');
    await reply(i,await ai.text('Answer this live-session question using only the captured transcript so far. Cite timestamps. Some recent speech may still be processing. Do not invent or use module knowledge.',JSON.stringify({question:i.options.getString('question',true),chunks}).slice(0,130000)));return true;
  }
  if(kind==='wiki') {
    const action=i.options.getSubcommand();
    if(action==='show'){const row=archive.record(campaign.id,actor,i.options.getString('id',true));await reply(i,`**${row.name}**\n${row.body}\n\n${JSON.stringify(row.properties,null,2)}`);}
    if(action==='list')await reply(i,list(archive.records(campaign.id,actor,i.options.getString('kind')).filter(r=>['pc','npc','item','location','faction'].includes(r.kind))));
    if(action==='search'){const q=i.options.getString('query',true).toLowerCase();await reply(i,list(archive.records(campaign.id,actor).filter(r=>(r.name+' '+r.body).toLowerCase().includes(q))));}
    if(action==='create'){const row=archive.save(campaign.id,actor,{kind:i.options.getString('kind',true),name:i.options.getString('name',true),body:i.options.getString('description',true)});await reply(i,`Created **${row.name}** · \`${row.id}\``);}return true;
  }
  if(kind==='quest') {
    const action=i.options.getSubcommand();
    if(action==='list')await reply(i,list(archive.records(campaign.id,actor,'quest')));
    else {const row=archive.record(campaign.id,actor,i.options.getString('id',true));if(row.kind!=='quest')throw new Error('Choose a quest entry.');
      if(action==='show')await reply(i,`**${row.name}** · ${row.properties.status||'planned'}\n${row.body}\n\n${(row.properties.objectives||[]).map((o,j)=>`${j+1}. [${o.status}] ${o.text}`).join('\n')}`);
      else {archive.require(campaign.id,actor,true);const objectives=row.properties.objectives||[],index=i.options.getInteger('objective',true)-1;if(!objectives[index])throw new Error('Objective not found.');objectives[index].status=i.options.getString('status',true);archive.save(campaign.id,actor,{...row,properties:{...row.properties,objectives,status:questStatus(objectives)}},row.id);await reply(i,'Quest objective updated.');}}
    return true;
  }
  if(kind==='journal') {
    const action=i.options.getSubcommand();
    if(action==='list')await reply(i,list(archive.records(campaign.id,actor,'journal')));
    if(action==='show'){const row=archive.record(campaign.id,actor,i.options.getString('id',true));if(row.kind!=='journal')throw new Error('Choose a journal.');await reply(i,`**${row.name}**\n${row.body}`);}
    if(action==='create'){const row=archive.save(campaign.id,actor,{kind:'journal',name:i.options.getString('title',true),body:i.options.getString('text',true),visibility:i.options.getBoolean('party')?'party':'private'});await reply(i,`Journal created (${row.visibility}) · \`${row.id}\``);}return true;
  }
  if(kind==='review') {
    const action=i.options.getSubcommand();
    if(action==='list')await reply(i,engine.reviews(campaign.id,actor).filter(r=>r.state==='pending').map(r=>`\`${r.id}\` · ${r.payload.title} · version ${r.version}`).join('\n')||'No pending reviews.');
    else {const id=i.options.getString('id',true);if(action==='show'){const row=engine.review(campaign.id,actor,id);await reply(i,`**${row.payload.title}** · version **${row.version}**\n${row.payload.facts.length} suggestions; edit or reject individual facts in /dashboard before approval.\n\n${row.payload.recap}`);}if(action==='approve'){const row=engine.approve(campaign.id,actor,id,i.options.getInteger('version',true));await reply(i,`Session **${row.title}** approved and added to the campaign record.`);}if(action==='reject'){engine.rejectReview(campaign.id,actor,id);await reply(i,'Review rejected. Source transcript retained.');}}return true;
  }
  if(kind==='timeline') {await reply(i,archive.records(campaign.id,actor,'event').sort((a,b)=>(a.properties.offset||0)-(b.properties.offset||0)).map(r=>`**${r.name}**\n${r.body}`).join('\n\n')||'No reviewed timeline events yet.');return true;}
  if(kind==='gems') {await reply(i,archive.records(campaign.id,actor).filter(r=>['moment','award','quote'].includes(r.kind)).slice(-20).map(r=>`**${r.name}** · ${r.kind}\n${r.body}`).join('\n\n')||'No reviewed highlights yet.');return true;}
  if(kind==='handout') {const job=engine.job(campaign.id,actor,'handout',()=>engine.artifact(campaign.id,actor,{kind:'handout',session:i.options.getString('session',true)}));await reply(i,`Handout queued: \`${job.id}\`. Open Artifacts in /dashboard when ready.`);return true;}
  if(kind==='playpost') {
    archive.require(campaign.id,actor,true);
    if(process.env.ENABLE_PLAY_BY_POST!=='1')throw new Error('Enable Message Content intent in the Developer Portal and set ENABLE_PLAY_BY_POST=1 on the host, then restart.');
    const first=i.options.getString('first',true),last=i.options.getString('last',true);
    if(!/^\d{16,22}$/.test(first)||!/^\d{16,22}$/.test(last)||BigInt(first)>BigInt(last))throw new Error('Use valid first and last message IDs in chronological order.');
    await i.deferReply({ephemeral:true});const messages=[];let before=(BigInt(last)+1n).toString();
    for(let batch=0;batch<20;batch++){const page=await i.channel.messages.fetch({limit:100,before});if(!page.size)break;let done=false;for(const message of page.values()){if(BigInt(message.id)<BigInt(first)){done=true;continue;}if(!message.author.bot)messages.push(message);}before=page.last().id;if(done)break;}
    if(messages.length>=2000)throw new Error('That range is too large; split it into smaller sessions.');
    if(!messages.length)throw new Error('No readable non-bot messages in that range. Check the Message Content intent.');
    messages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);const session=archive.store.createSession(campaign.id,i.options.getString('title',true),i.user.id,'importing');
    for(const message of messages)if(message.content)archive.store.addText(session.id,message.member?.displayName||message.author.username,(message.createdTimestamp-messages[0].createdTimestamp)/1000,`${message.content}\n[Source: ${message.url}]`);
    const job=engine.job(campaign.id,actor,'review',progress=>engine.generateReview(campaign.id,actor,session.id,progress));await reply(i,`${messages.length} messages imported into \`${session.id}\`. Review generation queued: \`${job.id}\`.`);return true;
  }
  return true;
}
