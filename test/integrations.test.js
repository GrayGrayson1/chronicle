import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Integrations } from '../src/integrations.js';
import { discordAction } from '../src/discord-service.js';
const root={subject:'host',root:true};

test('local image adapter queues the configured workflow and stores a returned asset without external AI calls',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chronicle-image-')),store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Art');
  const entry=archive.save(campaign.id,root,{kind:'npc',name:'Mira',body:'Innkeeper'}),before=process.env.COMFYUI_CHECKPOINT;process.env.COMFYUI_CHECKPOINT='test-checkpoint.safetensors';
  const requests=[];
  const fetcher=async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).endsWith('/prompt')){const body=JSON.parse(options.body);assert.equal(body.prompt['1'].inputs.ckpt_name,'test-checkpoint.safetensors');return {ok:true,json:async()=>({prompt_id:'test'})};}
    if(String(url).includes('/history/'))return {ok:true,json:async()=>({test:{outputs:{'7':{images:[{filename:'output.png',type:'output'}]}}}})};
    return {ok:true,arrayBuffer:async()=>Buffer.from('test-image-data')};
  };
  try{
    const service=new Integrations(archive,{dataDir:dir},{fetcher});const result=await service.image(campaign.id,root,{entry:entry.id});assert.ok(result.properties.asset);assert.equal(existsSync(join(dir,'assets',result.properties.asset)),true);assert.equal(requests.length,3);assert.ok(requests.every(r=>new URL(r.url).hostname==='127.0.0.1'));
  }finally{if(before===undefined)delete process.env.COMFYUI_CHECKPOINT;else process.env.COMFYUI_CHECKPOINT=before;store.close();rmSync(dir,{recursive:true,force:true});}
});
test('delivery refuses missing confirmation and private material before sending',async()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Delivery'),privateEntry=archive.save(campaign.id,root,{kind:'journal',name:'Secret',body:'Never sent',visibility:'private'}),service=new Integrations(archive,{});
  await assert.rejects(service.deliver(campaign.id,root,{entry:privateEntry.id,mode:'email'}),/Confirm/);
  await assert.rejects(service.deliver(campaign.id,root,{entry:privateEntry.id,mode:'email',confirm:true}),/party-visible/);store.close();
});
test('Discord write interface requires admin, confirmation, campaign channel and suppresses mentions',async()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=store.createCampaign('guild','channel','Game');archive.member(campaign.id,root,'player','player');
  const sent=[];const response={id:'message',content:'Hello',author:{username:'Chronicle'},createdTimestamp:0,url:'https://discord.test',attachments:new Map()};
  const channel={guildId:'guild',isTextBased:()=>true,send:async input=>{sent.push(input);return response;}};
  const service=new Integrations(archive,{}, {discord:{user:{id:'bot'},channels:{fetch:async()=>channel}}});
  await assert.rejects(discordAction(service,campaign.id,{subject:'player',scopes:['read','write']},{action:'send',content:'No',confirm:true}),/administrator/);
  await assert.rejects(discordAction(service,campaign.id,root,{action:'send',content:'No'}),/Confirm/);
  await discordAction(service,campaign.id,root,{action:'send',content:'Hello @everyone',confirm:true});assert.equal(sent.length,1);assert.deepEqual(sent[0].allowedMentions,{parse:[]});store.close();
});
test('automatic notification preferences are opt-in and player emails never receive review-ready alerts',async()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Notifications');archive.member(campaign.id,root,'player','player');archive.member(campaign.id,root,'admin','admin');
  archive.preferences(campaign.id,{subject:'player',scopes:['read','write']},{email:'player@example.test',gems:true,activity:true});archive.preferences(campaign.id,{subject:'admin',scopes:['read','write']},{email:'admin@example.test',gems:true,activity:true});
  const oldHost=process.env.SMTP_HOST,oldFrom=process.env.SMTP_FROM;process.env.SMTP_HOST='smtp.example.test';process.env.SMTP_FROM='chronicle@example.test';const sent=[];
  const service=new Integrations(archive,{}, {mailer:()=>({sendMail:async message=>sent.push(message)})});
  try{await service.notify(campaign.id,'review_ready',{title:'Draft'});assert.deepEqual(sent.map(m=>m.to),['admin@example.test']);sent.length=0;await service.notify(campaign.id,'session_approved',{id:'session',title:'Reviewed',recap:'Public recap'});assert.deepEqual(new Set(sent.map(m=>m.to)),new Set(['player@example.test','admin@example.test']));}
  finally{if(oldHost===undefined)delete process.env.SMTP_HOST;else process.env.SMTP_HOST=oldHost;if(oldFrom===undefined)delete process.env.SMTP_FROM;else process.env.SMTP_FROM=oldFrom;store.close();}
});
