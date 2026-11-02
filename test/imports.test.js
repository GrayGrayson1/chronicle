import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { importCampaign } from '../src/imports.js';
const root={subject:'host',root:true};
test('campaign restore remaps references, keeps private visibility, and imports no access credentials',()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Restored');
  const data={formatVersion:2,sessions:[{id:'old-session',title:'An old promise',started:1000,recap:'A key was promised.',chunks:[{id:'old-chunk',offset:20,text:'Take this key.',speaker:'Mira'}]}],records:[{id:'old-npc',kind:'npc',name:'Mira',body:'An innkeeper',properties:{friend:'old-place'},tags:[],sources:[{session:'old-session',chunk:'old-chunk'}],visibility:'party'},{id:'old-place',kind:'location',name:'Inn',body:'Home of [[Mira]].',properties:{},tags:[],sources:[],visibility:'private'}]};
  const result=importCampaign(archive,campaign.id,root,data);assert.deepEqual(result,{sessions:1,entries:2});
  const mira=archive.records(campaign.id,root,'npc')[0],place=archive.records(campaign.id,root,'location')[0];assert.equal(mira.properties.friend,place.id);assert.notEqual(mira.sources[0].session,'old-session');assert.notEqual(mira.sources[0].chunk,'old-chunk');assert.equal(place.visibility,'private');assert.equal(store.get('SELECT COUNT(*) AS n FROM api_tokens').n,0);store.close();
});
test('a malformed restore rolls back all newly created sessions and entries',()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Restored');
  assert.throws(()=>importCampaign(archive,campaign.id,root,{formatVersion:2,sessions:[{id:'old',title:'Imported'}],records:[{id:'bad',kind:'not-a-kind',name:'Bad'}]}));assert.equal(archive.sessions(campaign.id,root).length,0);assert.equal(archive.records(campaign.id,root).length,0);store.close();
});
