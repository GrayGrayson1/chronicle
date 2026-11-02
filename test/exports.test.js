import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync,strFromU8 } from 'fflate';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { exportZip,pdfBuffer,markdownHtml } from '../src/exports.js';

test('Obsidian ZIP contains only permitted content, keeps wikilinks, and strips local paths/tokens',async()=>{
  const store=new Store(':memory:'),archive=new Archive(store),actor={subject:'host',root:true},campaign=archive.createCampaign(actor,'The Lantern Road');
  archive.member(campaign.id,actor,'player','player','Jon');
  archive.save(campaign.id,actor,{kind:'npc',name:'Mira',body:'Keeps [[The Copper Finch]].'});
  archive.save(campaign.id,actor,{kind:'journal',name:'GM plans',body:'SUPER_SECRET_PREP',visibility:'private'});
  const session=store.createSession(campaign.id,'A promise','host','approved');store.updateSession(session.id,'approved','A silver key.');store.addText(session.id,'Mira',30,'Take this key.');
  const files=unzipSync(await exportZip(archive,campaign.id,{subject:'player',scopes:['read']},{format:'obsidian'}));
  assert.ok(files['.obsidian/app.json']);assert.ok(files['campaign.json']);
  const all=Object.values(files).map(strFromU8).join('\n');assert.match(all,/\[\[The Copper Finch\]\]/);assert.doesNotMatch(all,/SUPER_SECRET_PREP|dashboard-key|"acl"|"path"/);store.close();
});
test('PDF export produces a real PDF with themed content',async()=>{
  const buffer=await pdfBuffer({title:'A promise kept',body:'## The story\nThe party recovered a lantern.\n\n## Next steps\nReturn to Rivergate.',theme:'verdant'});
  assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(buffer.length>1000);
});
test('HTML export escapes executable markup',()=>{
  const output=markdownHtml('# Session\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(output,/<script>|<img /);assert.match(output,/&lt;script&gt;/);
});
