const MODULE='chronicle-local';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(path,method='GET',body) {
  const url=game.settings.get(MODULE,'url'),token=game.settings.get(MODULE,'token');
  if(!url||!token)throw new Error('Configure the Chronicle URL and member key in module settings.');
  const response=await fetch(new URL(path,url),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
async function sync() {
  if(!game.user.isGM)throw new Error('A GM must run the import.');
  const campaign=game.settings.get(MODULE,'campaign');if(!campaign)throw new Error('Set the campaign ID in module settings.');
  const state=await request(`/api/campaigns/${campaign}/state`);
  const records=state.records.filter(r=>r.visibility==='party'&&r.kind!=='journal');
  const sessions=state.sessions.filter(s=>s.state==='approved');
  const agreed=await Dialog.confirm({title:'Import Chronicle archive',content:`<p>Import/update ${records.length} party-visible entries and ${sessions.length} approved recaps? Previously imported Chronicle pages will be updated.</p>`});
  if(!agreed)return;
  let folder=game.folders.find(f=>f.type==='JournalEntry'&&f.name==='Chronicle');if(!folder)folder=await Folder.create({name:'Chronicle',type:'JournalEntry'});
  for(const row of [...records.map(r=>({id:r.id,name:r.name,body:r.body})),...sessions.map(s=>({id:s.id,name:`Session · ${s.title}`,body:s.recap}))]) {
    const previous=game.journal.find(j=>j.getFlag(MODULE,'source')===row.id);
    const data={name:row.name,folder:folder.id,pages:[{name:row.name,type:'text',text:{content:`<article>${escape(row.body).replaceAll('\n','<br>')}</article>`,format:1}}],flags:{[MODULE]:{source:row.id,campaign}}};
    if(previous){await previous.deleteEmbeddedDocuments('JournalEntryPage',previous.pages.map(p=>p.id));await previous.update({name:data.name});await previous.createEmbeddedDocuments('JournalEntryPage',data.pages);}else await JournalEntry.create(data);
  }
  ui.notifications.info('Chronicle archive imported. Review journal ownership before sharing pages with players.');
}
async function ask(question) {
  const campaign=game.settings.get(MODULE,'campaign');const result=await request(`/api/campaigns/${campaign}/ask`,'POST',{question});
  // The configured key may be a GM key. Answers are always whispered to the
  // requesting user; never post potential private journal context publicly.
  await ChatMessage.create({content:`<h3>Chronicle</h3><p>${escape(question)}</p><div>${escape(result.answer).replaceAll('\n','<br>')}</div>`,whisper:[game.user.id]});
}
async function pushJournal(journalId) {
  if(!game.user.isGM)throw new Error('A GM must push journals.');
  const journal=game.journal.get(journalId);if(!journal)throw new Error('Journal not found.');
  const accepted=await Dialog.confirm({title:'Send journal to Chronicle',content:`<p>Create a private Chronicle journal from ${escape(journal.name)}?</p>`});if(!accepted)return;
  const campaign=game.settings.get(MODULE,'campaign');const div=document.createElement('div');div.innerHTML=journal.pages.contents.map(p=>p.text?.content||'').join('\n');
  await request(`/api/campaigns/${campaign}/records`,'POST',{kind:'journal',name:journal.name,body:div.textContent||'',visibility:'private',properties:{folder:'Foundry imports'}});ui.notifications.info('Private journal created in Chronicle.');
}
Hooks.once('init',()=>{
  game.settings.register(MODULE,'url',{name:'Chronicle URL',hint:'Use a local host reachable by this browser. Add the Foundry origin to DASHBOARD_ALLOWED_ORIGINS.',scope:'client',config:true,type:String,default:'http://127.0.0.1:8787'});
  game.settings.register(MODULE,'token',{name:'Chronicle member key',hint:'Private per-client setting. Prefer a dedicated scoped key; never distribute your host key.',scope:'client',config:true,type:String,default:''});
  game.settings.register(MODULE,'campaign',{name:'Campaign ID',scope:'client',config:true,type:String,default:''});
});
Hooks.once('ready',()=>{game.chronicle={sync,ask,pushJournal};});
Hooks.on('chatMessage',(log,message)=>{
  if(message==='/chronicle-sync'){void sync().catch(error=>ui.notifications.error(error.message));return false;}
  if(message.startsWith('/chronicle ')){void ask(message.slice(11)).catch(error=>ui.notifications.error(error.message));return false;}
});
