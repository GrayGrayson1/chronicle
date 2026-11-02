// Builds site/demo.json: a small, entirely fictional campaign used by the player site's demo mode
// (open the site with ?demo). It runs the real archive + publish code against an in-memory database,
// so the demo always matches the format Chronicle actually publishes.
//   node scripts/demo-site.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { buildSiteData } from '../src/publish.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const host = { subject:'host', root:true };

/** Seed the fictional demo campaign into an archive. Also used by local dashboard previews. */
export function seedDemoCampaign(store, archive) {
const campaign = archive.createCampaign(host, 'The Lantern Road');
archive.setSettings(campaign.id, host, { system:'D&D 5e', description:'A sample campaign showing what the player site looks like. Everything here is made up.' });

const day = 86400000, start = Date.UTC(2026, 9, 3, 1, 0, 0);
function session(number, title, recap, lines) {
  const row = store.createSession(campaign.id, title, 'host', 'approved');
  store.run('UPDATE sessions SET started=? WHERE id=?', start + (number-1)*7*day, row.id);
  store.updateSession(row.id, 'approved', recap);
  const chunks = {};
  for (const [key, speaker, offset, text] of lines) chunks[key] = store.addText(row.id, speaker, offset, text);
  return { id:row.id, chunks };
}
const s1 = session(1, 'Rain on the Rivergate road', `## What happened
- The party met on the flooded road to Rivergate and sheltered at the **[[Lantern Inn]]**.
- [[Mara Vale]] traded a hot meal for news of the river crossings.
- [[Orin Ashdown]] bought three healing potions from a passing tinker.

## Decisions
- The party agreed to stay in Rivergate until the bridge reopens.

## Next time
- Ask around about the lights seen at [[The Old Tower]].`, [
  ['road', 'Jon / Orin', 640, 'We should get out of this rain before the road washes out.'],
]);
const s2 = session(2, 'Lights over the old tower', `## What happened
- Strange green lights flickered above [[The Old Tower]] after midnight.
- The [[Copper Finch]] courier offered silver for any letters found inside.
- [[Wren]] found an iron lantern on the tower stairs and left it there when the stairs gave way.

## Loot
- 42 silver coins, shared by the party.

## Unresolved
- Who lit the lights?`, [
  ['lights', 'Sam / Wren', 1210, 'Those lights are green. Lanterns are not green.'],
]);
const s3 = session(3, 'The letter at the inn', `## What happened
- [[Mara Vale]] lent us the [[Brass key]] to the inn's cellar.
- A sealed letter in the cellar points toward [[The Old Tower]].
- We agreed to return the key before sunset.

## Memorable moment
- Orin argued with a very stubborn cellar door for a full minute before noticing it opened outward.

## Reminders for next session
- Return Mara's key before sunset.
- Read the sealed letter somewhere safe.`, [
  ['sunset', 'DM (Mara Vale)', 4354, 'Bring the key back before sunset.'],
  ['door', 'Jon / Orin', 2210, 'It opens outward. Of course it opens outward.'],
  ['letter', 'Sam / Wren', 3120, 'The seal has a little tower pressed into the wax.'],
]);

const save = (data, sources = []) => archive.save(campaign.id, host, { ...data, sources });
const orin = save({ kind:'pc', name:'Orin Ashdown', body:'Dwarf cleric of the forge who keeps the party fed and patched up. Carries the [[Brass key]] for now.', properties:{ species:'Dwarf', class:'Cleric', pronouns:'he/him', role:'Party healer' } }, [{ session:s1.id, chunk:s1.chunks.road }]);
const wren = save({ kind:'pc', name:'Wren', body:'Half-elf rogue with a habit of pocketing interesting things, and an eye for trouble on rooftops.', properties:{ species:'Half-elf', class:'Rogue', pronouns:'she/her', role:'Scout' } }, [{ session:s2.id, chunk:s2.chunks.lights }]);
const inn = save({ kind:'location', name:'Lantern Inn', body:'A crooked, warm inn at the edge of Rivergate. Run by [[Mara Vale]]. Its cellar door opens outward.', properties:{ region:'Rivergate' } }, [{ session:s1.id }, { session:s3.id }]);
const tower = save({ kind:'location', name:'The Old Tower', body:'A ruined watchtower above the river. Green lights were seen at its top after midnight.', properties:{ region:'Rivergate hills', aliases:['abandoned tower'] } }, [{ session:s2.id, chunk:s2.chunks.lights }]);
save({ kind:'location', name:'Rivergate', body:'River town whose only bridge washed out in the storm.', properties:{} }, [{ session:s1.id }]);
const finch = save({ kind:'faction', name:'Copper Finch', body:'Courier guild that pays well for undelivered letters and asks few questions.', properties:{ headquarters:'Rivergate' } }, [{ session:s2.id }]);
const mara = save({ kind:'npc', name:'Mara Vale', body:'Innkeeper of the [[Lantern Inn]]. Lent the party a [[Brass key]] and asked them to look into the cellar.', properties:{ role:'Innkeeper', home:inn.id, likes:['Apple cider'], dislikes:['Wet boots on her floor'], allies:[orin.id], aliases:['The Innkeeper'],
  history:[{ session:s1.id, text:'Traded a hot meal for news of the river crossings.' }, { session:s3.id, text:'Lent us the brass key.' }] } }, [{ session:s1.id }, { session:s3.id, chunk:s3.chunks.sunset }]);
save({ kind:'item', name:'Brass key', body:"Key to the Lantern Inn's cellar. Belongs to [[Mara Vale]].", properties:{ quantity:1, holder:orin.id, owner:mara.id, status:'carried', history:[{ session:s3.id, text:'Mara lent it to the party; Orin is carrying it.' }] } }, [{ session:s3.id, chunk:s3.chunks.sunset }]);
save({ kind:'item', name:'Healing potions', body:'Bought from a passing tinker on the Rivergate road.', properties:{ quantity:3, holder:orin.id, status:'carried', history:[{ session:s1.id, text:'Orin bought three.' }] } }, [{ session:s1.id }]);
save({ kind:'item', name:'Silver coins', body:'Party funds.', properties:{ quantity:42, holder:'Party (shared)', status:'carried', history:[{ session:s2.id, text:'Paid by the Copper Finch courier.' }] } }, [{ session:s2.id }]);
save({ kind:'item', name:'Iron lantern', body:'Found on the tower stairs, left behind when the stairs gave way.', properties:{ quantity:1, location:tower.id, status:'dropped', history:[{ session:s2.id, text:'Wren found it, then dropped it on the stairs.' }] } }, [{ session:s2.id }]);
save({ kind:'item', name:'Sealed letter', body:'Wax seal pressed with a little tower. Unopened.', properties:{ quantity:1, holder:wren.id, status:'carried' } }, [{ session:s3.id, chunk:s3.chunks.letter }]);
save({ kind:'quest', name:'Investigate the old tower', body:'Find out who is lighting green lights above [[The Old Tower]].', properties:{ status:'in_progress', giver:'Rumors in Rivergate', nextAction:'Read the sealed letter, then head up the hill.',
  objectives:[{ text:'See the lights for ourselves', status:'done' }, { text:'Find a safe way up the broken stairs', status:'planned' }, { text:'Learn who wrote the sealed letter', status:'in_progress' }] } }, [{ session:s2.id }, { session:s3.id }]);
save({ kind:'quest', name:"Return Mara's key", body:'We promised [[Mara Vale]] the [[Brass key]] back before sunset.', properties:{ status:'planned', giver:mara.id, successCondition:'The key is back on its hook before sunset.', objectives:[{ text:'Return the brass key to Mara', status:'planned' }] } }, [{ session:s3.id, chunk:s3.chunks.sunset }]);
save({ kind:'quest', name:'Reach Rivergate', body:'Get off the flooded road.', properties:{ status:'done', objectives:[{ text:'Find shelter from the storm', status:'done' }] } }, [{ session:s1.id }]);
save({ kind:'event', name:'Party shelters at the Lantern Inn', body:'The storm drives everyone indoors.', properties:{ chapter:'Rivergate', step:1 } }, [{ session:s1.id }]);
save({ kind:'event', name:'Green lights over the tower', body:'Seen just after midnight from the inn windows.', properties:{ chapter:'Rivergate', step:2 } }, [{ session:s2.id, chunk:s2.chunks.lights }]);
save({ kind:'event', name:'The stairs collapse', body:'Wren drops the iron lantern as the tower stairs give way.', properties:{ chapter:'The Old Tower', step:3 } }, [{ session:s2.id }]);
save({ kind:'event', name:'The sealed letter is found', body:'Hidden in the inn cellar behind a wine rack.', properties:{ chapter:'Rivergate', step:4 } }, [{ session:s3.id, chunk:s3.chunks.letter }]);
save({ kind:'quote', name:'Bring the key back before sunset', body:'Bring the key back before sunset.', properties:{ speaker:mara.id } }, [{ session:s3.id, chunk:s3.chunks.sunset }]);
save({ kind:'quote', name:'It opens outward', body:'It opens outward. Of course it opens outward.', properties:{ speaker:orin.id } }, [{ session:s3.id, chunk:s3.chunks.door }]);
save({ kind:'moment', name:'The sealed letter', body:'Wren notices a tiny tower pressed into the wax seal.', properties:{} }, [{ session:s3.id, chunk:s3.chunks.letter }]);
save({ kind:'moment', name:'The stubborn cellar door', body:'Orin spends a full minute arguing with a door that opens outward.', properties:{} }, [{ session:s3.id, chunk:s3.chunks.door }]);
save({ kind:'award', name:'Keenest eyes', body:'Wren, for spotting that the lights were the wrong color.', properties:{} }, [{ session:s2.id, chunk:s2.chunks.lights }]);
save({ kind:'npc', name:'Hidden villain', body:'GM-only note. This must never appear on the site.', visibility:'private' });

return campaign;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
const store = new Store(':memory:'), archive = new Archive(store);
const campaign = seedDemoCampaign(store, archive);
const data = buildSiteData(archive, campaign.id, { includeTranscripts:true });
if (JSON.stringify(data).includes('Hidden villain')) throw new Error('Private entry leaked into demo data.');
const out = join(root, 'site', 'demo.json');
mkdirSync(dirname(out), { recursive:true });
writeFileSync(out, JSON.stringify({ chronicleSite:1, encrypted:false, demo:true, data }, null, 1)+'\n');
console.log(`Wrote ${out}: ${data.sessions.length} sessions, ${data.records.length} entries.`);
store.close();
}
