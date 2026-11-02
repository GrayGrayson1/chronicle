import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Engine } from '../src/engine.js';
import { ToneAnalyzer } from '../src/analysis.js';
const root={subject:'host',root:true};
test('participation radar and cached text-tone analysis use only approved source material',async()=>{
  const store=new Store(':memory:'),archive=new Archive(store),campaign=archive.createCampaign(root,'Analysis');
  const session=store.createSession(campaign.id,'A promise','host','approved');store.addText(session.id,'Player',10,'Should we help the caravan?',4);store.addText(session.id,'GM',20,'Mira smiles and gives you a key.',5);store.addText(session.id,'Player',30,'We will help.',2);
  const draft=store.createSession(campaign.id,'Draft','host','awaiting_review');store.addText(draft.id,'GM',0,'SECRET DRAFT');
  let texts=[];const analyzer=new ToneAnalyzer(archive,{pythonBin:'python'},async(bin,args,opts)=>{texts=JSON.parse(opts.input).texts;return JSON.stringify({model:'fake',scores:texts.map(()=>({positive:0.5,neutral:0.4,negative:0.1}))});});
  await analyzer.run(campaign.id,root);assert.equal(texts.length,3);assert.ok(texts.every(text=>!text.includes('SECRET')));
  const report=new Engine({archive,ai:{}}).analytics(campaign.id,root,[session.id]);assert.equal(report.speakers.length,2);const player=report.speakers.find(s=>s.speaker==='Player');assert.equal(player.speechSeconds,6);assert.equal(player.responses,1);assert.equal(player.sentiment.segments,2);assert.equal(player.sentiment.positive,0.5);assert.ok(Object.values(player.radar).every(value=>value>=0&&value<=1));store.close();
});
