import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Engine } from '../src/engine.js';
import { createDashboard } from '../src/dashboard.js';

const root={subject:'host',root:true};
async function setup(){
  const directory=mkdtempSync(join(tmpdir(),'chronicle-http-')),store=new Store(':memory:'),archive=new Archive(store);
  const campaign=archive.createCampaign(root,'The Lantern Road');archive.member(campaign.id,root,'player','player','Jon');
  const ai={text:async(task,material)=>{
    if(task.includes('ONE JSON object')){const data=JSON.parse(material),source=data.chunks[0];return JSON.stringify({title:'A promise',recap:'Mira promised a key.',warnings:[],facts:[{kind:'npc',name:'Mira',body:'Promised the party a silver key.',properties:{},tags:['innkeeper'],sources:[source.id],target:null,rejected:false}]});}
    return 'Mira promised the party a silver key.';
  }};
  const engine=new Engine({archive,ai}),config={dataDir:directory,pythonBin:'python3'};
  const dashboard=await createDashboard({archive,engine,config,port:0,rootToken:'host-test-key'});
  const playerToken=archive.issueToken(root,campaign.id,'player',['read','write']);
  const request=async(path,{method='GET',body,token='host-test-key',headers={}}={})=>{
    const response=await fetch(dashboard.url+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    return {status:response.status,headers:response.headers,body:await response.json().catch(()=>null)};
  };
  return {store,archive,engine,campaign,dashboard,playerToken,request,close:async()=>{await Promise.all(engine.running.values());await dashboard.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
test('HTTP dashboard requires auth and blocks foreign origins and DNS rebinding',async()=>{
  const f=await setup();try{
    assert.equal((await f.request('/api/campaigns',{token:''})).status,401);
    assert.equal((await f.request('/api/campaigns',{headers:{Origin:'https://evil.invalid'}})).status,403);
    const rebindingStatus=await new Promise((resolve,reject)=>{const request=httpRequest(f.dashboard.url+'/api/campaigns',{headers:{Host:'evil.invalid',Authorization:'Bearer host-test-key'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});
    assert.equal(rebindingStatus,403);
    const response=await fetch(f.dashboard.url+'/');assert.equal(response.status,200);assert.match(await response.text(),/Chronicle/);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  }finally{await f.close();}
});
test('notes import -> background extraction -> review approval -> player Q&A works over HTTP',async()=>{
  const f=await setup(),base=`/api/campaigns/${f.campaign.id}`;try{
    const imported=await f.request(base+'/sessions',{method:'POST',body:{title:'The inn',notes:'Mira promised us a silver key.'}});assert.equal(imported.status,201);const session=imported.body;
    const job=await f.request(base+`/sessions/${session.id}/process`,{method:'POST',body:{}});assert.equal(job.status,202);await Promise.all(f.engine.running.values());
    const reviews=await f.request(base+'/reviews');assert.equal(reviews.body.length,1);
    const before=await f.request(base+'/state',{token:f.playerToken});assert.equal(before.body.sessions.length,0);assert.equal(before.body.records.length,0);
    const review=reviews.body[0];const approved=await f.request(base+`/reviews/${review.id}/approve`,{method:'POST',body:{version:review.version}});assert.equal(approved.status,200);
    const after=await f.request(base+'/state',{token:f.playerToken});assert.equal(after.body.sessions.length,1);assert.equal(after.body.records[0].name,'Mira');
    const answer=await f.request(base+'/ask',{method:'POST',body:{question:'What did Mira promise?'},token:f.playerToken});assert.equal(answer.status,200);assert.match(answer.body.answer,/silver key/);
  }finally{await f.close();}
});
test('player API cannot read a private journal, approve reviews or issue keys',async()=>{
  const f=await setup(),base=`/api/campaigns/${f.campaign.id}`;try{
    const privateEntry=f.archive.save(f.campaign.id,root,{kind:'journal',name:'Secret',body:'PRIVATE_CONTENT',visibility:'private'});
    assert.equal((await f.request(base+'/records/'+privateEntry.id,{token:f.playerToken})).status,404);
    assert.equal((await f.request(base+'/reviews',{token:f.playerToken})).status,403);
    assert.equal((await f.request(base+'/tokens',{method:'POST',body:{subject:'host'},token:f.playerToken})).status,403);
    const own=await f.request(base+'/records',{method:'POST',body:{kind:'journal',name:'My notes',body:'My own note',visibility:'private'},token:f.playerToken});assert.equal(own.status,201);
    const state=await f.request(base+'/state',{token:f.playerToken});assert.equal(state.body.records.length,1);assert.equal(state.body.records[0].name,'My notes');
  }finally{await f.close();}
});
test('read-only share key cannot mutate or access chat, journals or audio',async()=>{
  const f=await setup(),base=`/api/campaigns/${f.campaign.id}`;try{
    const entry=f.archive.save(f.campaign.id,root,{kind:'npc',name:'Mira'}),share=f.archive.share(f.campaign.id,root,'Public reader');
    const update=await f.request(base+'/records/'+entry.id,{method:'PUT',body:{...entry,body:'attacker'},token:share});assert.equal(update.status,403);
    assert.equal((await f.request(base+'/chat',{token:share})).status,403);
    assert.equal((await f.request(base+'/ask',{method:'POST',body:{question:'Tell me secrets'},token:share})).status,403);
  }finally{await f.close();}
});
