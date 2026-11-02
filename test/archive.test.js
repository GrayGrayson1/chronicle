import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Engine,questStatus } from '../src/engine.js';
import { SemanticSearch } from '../src/search.js';

const root={subject:'host',root:true};
function setup(){const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'The Lantern Road');archive.member(campaign.id,root,'player','player','Jon');archive.member(campaign.id,root,'admin','admin','GM');return {store,archive,campaign,player:{subject:'player',scopes:['read','write']},gm:{subject:'admin',scopes:['read','write']}};}
test('private journals are filtered from player records and relationship graph',()=>{
  const {store,archive,campaign,player}=setup();
  archive.save(campaign.id,root,{kind:'journal',name:'GM Secret',body:'Secret villain identity',visibility:'private'});
  archive.save(campaign.id,root,{kind:'npc',name:'Innkeeper',body:'A friendly host.',visibility:'party'});
  assert.deepEqual(archive.records(campaign.id,player).map(r=>r.name),['Innkeeper']);
  assert.equal(archive.graph(campaign.id,player).nodes.length,1);store.close();
});
test('journal ACLs allow view/edit separately and forbid privilege escalation',()=>{
  const {store,archive,campaign,player}=setup();
  const journal=archive.save(campaign.id,root,{kind:'journal',name:'Shared secret',visibility:'selected',body:'A clue',acl:{player:'view'}});
  assert.equal(archive.record(campaign.id,player,journal.id).body,'A clue');
  assert.throws(()=>archive.save(campaign.id,player,{...journal,body:'changed'},journal.id),/cannot edit/);
  const editable=archive.save(campaign.id,root,{...journal,acl:{player:'edit'}},journal.id);
  const saved=archive.save(campaign.id,player,{...editable,body:'Corrected clue'},journal.id);
  assert.equal(saved.body,'Corrected clue');
  assert.throws(()=>archive.save(campaign.id,player,{...saved,visibility:'party'},journal.id),/sharing/);store.close();
});
test('players may edit own characters but cannot change identity ownership or permissions',()=>{
  const {store,archive,campaign,player}=setup();
  const pc=archive.save(campaign.id,root,{kind:'pc',name:'Zafir',body:'A paladin',properties:{playerSubject:'player'}});
  const saved=archive.save(campaign.id,player,{...pc,body:'A paladin of the Noble Genie'},pc.id);
  assert.match(saved.body,/Noble Genie/);
  assert.throws(()=>archive.save(campaign.id,player,{...saved,properties:{playerSubject:'other'}},pc.id),/administrator/);store.close();
});
test('optimistic versions prevent lost edits and revisions can be restored',()=>{
  const {store,archive,campaign}=setup();
  const entry=archive.save(campaign.id,root,{kind:'npc',name:'Mira',body:'Original'});
  archive.save(campaign.id,root,{...entry,body:'New description'},entry.id);
  assert.throws(()=>archive.save(campaign.id,root,{...entry,body:'Stale'},entry.id),/changed/);
  const revisions=archive.history(campaign.id,root,entry.id);const restored=archive.restore(campaign.id,root,revisions[0].id);
  assert.equal(restored.body,'Original');assert.equal(restored.version,3);store.close();
});
test('admins cannot issue an owner key or promote themselves',()=>{
  const {store,archive,campaign,gm}=setup();
  assert.throws(()=>archive.issueToken(gm,campaign.id,'host',['read','write']),/administrator/);
  assert.throws(()=>archive.member(campaign.id,gm,'admin','owner'),/administrator/);
  const token=archive.issueToken(root,campaign.id,'player',['read','write']);const actor=archive.tokenActor(token);
  assert.equal(archive.role(campaign.id,actor),'player');assert.throws(()=>archive.save(campaign.id,actor,{kind:'npc',name:'Forbidden'}),/Only administrators/);store.close();
});
test('share links exclude journals, drafts, private entries and unrelated campaigns',()=>{
  const {store,archive,campaign}=setup();
  archive.save(campaign.id,root,{kind:'journal',name:'Even party journal',visibility:'party'});
  archive.save(campaign.id,root,{kind:'npc',name:'Private NPC',visibility:'private'});
  const npc=archive.save(campaign.id,root,{kind:'npc',name:'Known NPC'});
  const session=store.createSession(campaign.id,'Not approved','host','awaiting_review');
  const token=archive.share(campaign.id,root,'Readers'),actor=archive.shareActor(token);
  assert.deepEqual(archive.records(campaign.id,actor).map(r=>r.id),[npc.id]);assert.equal(archive.sessions(campaign.id,actor).length,0);
  assert.throws(()=>archive.save(campaign.id,actor,{...npc,body:'bad'},npc.id));
  const other=archive.createCampaign(root,'Other');assert.throws(()=>archive.records(other.id,actor),/access denied/);store.close();
});
test('AI review discards unsupported citations and fabricated quotes; approval is atomic and idempotent',async()=>{
  const {store,archive,campaign}=setup();
  const session=store.createSession(campaign.id,'A promise','host','processing');store.addText(session.id,'Mira',30,'I will give you a silver key.');
  const chunk=store.chunks(session.id)[0];
  const ai={text:async()=>JSON.stringify({title:'A promise',recap:'Mira promised a key.',warnings:[],facts:[
    {kind:'npc',name:'Mira',body:'Promised a silver key.',properties:{},tags:[],sources:[chunk.id],target:null,rejected:false},
    {kind:'quote',name:'A real quote',body:'I will give you a silver key.',properties:{},tags:[],sources:[chunk.id],target:null,rejected:false},
    {kind:'quote',name:'A fake quote',body:'I am the hidden villain.',properties:{},tags:[],sources:[chunk.id],target:null,rejected:false},
    {kind:'item',name:'Imaginary sword',body:'A magical blade.',properties:{},tags:[],sources:['unknown'],target:null,rejected:false},
  ]})};
  const engine=new Engine({archive,ai});const result=await engine.generateReview(campaign.id,root,session.id);const review=engine.review(campaign.id,root,result.review);
  assert.equal(review.payload.facts.length,2);assert.equal(archive.records(campaign.id,root).length,0);
  engine.approve(campaign.id,root,review.id,review.version);assert.equal(archive.records(campaign.id,root).length,2);assert.equal(store.session(campaign.id,session.id).state,'approved');
  assert.throws(()=>engine.approve(campaign.id,root,review.id,review.version),/already approved/);store.close();
});
test('review rollback leaves every entry unchanged if any suggestion has an invalid target',()=>{
  const {store,archive,campaign}=setup(),engine=new Engine({archive,ai:{}}),session=store.createSession(campaign.id,'Review','host','awaiting_review');
  const bad=archive.save(campaign.id,root,{kind:'item',name:'Key'});
  const payload={title:'Review',recap:'A recap',warnings:[],facts:[{kind:'npc',name:'First',body:'First fact',properties:{},tags:[],sources:[],target:null,rejected:false},{kind:'npc',name:'Bad merge',body:'Wrong target',properties:{},tags:[],sources:[],target:bad.id,rejected:false}]};
  store.run('INSERT INTO reviews(id,campaign,session,state,payload,created) VALUES(?,?,?,?,?,?)','review',campaign.id,session.id,'pending',JSON.stringify(payload),Date.now());
  assert.throws(()=>engine.approve(campaign.id,root,'review',1),/different entry type/);
  assert.equal(archive.records(campaign.id,root).length,1);assert.equal(engine.review(campaign.id,root,'review').state,'pending');store.close();
});
test('player Q&A never includes private journals or unreviewed source material',async()=>{
  const {store,archive,campaign,player}=setup();
  archive.save(campaign.id,root,{kind:'journal',name:'Secret',body:'SECRET_PRIVATE_JOURNAL',visibility:'private'});
  archive.save(campaign.id,root,{kind:'npc',name:'Mira',body:'Known innkeeper'});
  const session=store.createSession(campaign.id,'Draft','host','awaiting_review');store.addText(session.id,'GM',0,'SECRET_DRAFT');
  const engine=new Engine({archive,ai:{text:async(task,material)=>{assert.match(material,/Known innkeeper/);assert.doesNotMatch(material,/SECRET_PRIVATE|SECRET_DRAFT/);return 'Mira is an innkeeper.';}}});
  assert.match((await engine.ask(campaign.id,player,'Who is Mira?')).answer,/innkeeper/);store.close();
});
test('semantic retrieval filters by current permissions even when a private vector is indexed',async()=>{
  const {store,archive,campaign,player}=setup();
  const privateEntry=archive.save(campaign.id,root,{kind:'journal',name:'Secret',body:'Secret',visibility:'private'});
  const publicEntry=archive.save(campaign.id,root,{kind:'npc',name:'Mira',body:'An innkeeper'});
  for(const entry of [privateEntry,publicEntry])store.run('INSERT INTO vectors VALUES(?,?,?,?,?,?)',entry.id,campaign.id,entry.kind,'hash','fake',JSON.stringify([1,0]));
  const search=new SemanticSearch(archive,{pythonBin:'python'},async()=>JSON.stringify({model:'fake',vectors:[[1,0]]}));
  const rows=await search.query(campaign.id,player,'Mira');assert.equal(rows.length,1);assert.equal(rows[0].source.entry,publicEntry.id);store.close();
});
test('quest status follows objectives and terminal states are unambiguous',()=>{
  assert.equal(questStatus([{status:'done'},{status:'done'}]),'done');assert.equal(questStatus([{status:'planned'},{status:'blocked'}]),'blocked');assert.equal(questStatus([{status:'done'},{status:'planned'}]),'in_progress');assert.equal(questStatus([{status:'failed'}]),'failed');
});
test('entity merging repairs wiki links, preserves revisions and rejects visibility leaks',()=>{
  const {store,archive,campaign}=setup();const a=archive.save(campaign.id,root,{kind:'npc',name:'Mira',body:'Host'}),b=archive.save(campaign.id,root,{kind:'npc',name:'Meera',body:'Misspelling'}),ref=archive.save(campaign.id,root,{kind:'location',name:'Inn',body:'Home of [[Meera]].'});
  archive.merge(campaign.id,root,b.id,a.id);assert.match(archive.record(campaign.id,root,ref.id).body,/\[\[Mira\]\]/);assert.throws(()=>archive.record(campaign.id,root,b.id));assert.ok(archive.history(campaign.id,root,a.id).length);store.close();
});
test('owned character arc proposals require review and append facets without overwriting history',async()=>{
  const {store,archive,campaign,player}=setup();
  const pc=archive.save(campaign.id,root,{kind:'pc',name:'Orin',body:'A paladin',properties:{playerSubject:'player',arcFacets:[{theme:'goals',name:'Original goal',body:'Keep a promise.'}]}});
  const session=store.createSession(campaign.id,'A choice','host','approved');store.updateSession(session.id,'approved','Orin chose to protect the caravan.');
  const engine=new Engine({archive,ai:{text:async()=>JSON.stringify({facets:[{theme:'choices',name:'Stayed with the caravan',body:'Chose to protect the last wagon.',sources:[session.id],rejected:false}]})}});
  const draft=await engine.characterArc(campaign.id,player,pc.id,session.id);assert.equal(draft.visibility,'private');assert.equal(archive.record(campaign.id,player,pc.id).properties.arcFacets.length,1);
  engine.approveArc(campaign.id,player,draft.id,draft.version);assert.equal(archive.record(campaign.id,player,pc.id).properties.arcFacets.length,2);
  assert.throws(()=>engine.approveArc(campaign.id,player,draft.id,draft.version),/changed|approved/);store.close();
});
test('bulk property updates roll back completely on a stale entry version',()=>{
  const {store,archive,campaign}=setup(),a=archive.save(campaign.id,root,{kind:'npc',name:'Mira'}),b=archive.save(campaign.id,root,{kind:'npc',name:'Elias'});
  archive.save(campaign.id,root,{...b,body:'Changed'},b.id);
  assert.throws(()=>archive.bulk(campaign.id,root,[{id:a.id,version:a.version},{id:b.id,version:b.version}],{addTags:['friend']}),/changed/);
  assert.deepEqual(archive.record(campaign.id,root,a.id).tags,[]);store.close();
});
