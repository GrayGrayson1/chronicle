import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { answerQuestion, corpus, retrieve, packEvidence, parseReply, citeSources, stem, tokens } from '../src/ask.js';

const host = { subject:'host', root:true };
// A small campaign with 14 approved sessions, so the "old promise" sits well outside the newest recaps.
function campaign() {
  const store = new Store(':memory:'), archive = new Archive(store);
  const c = archive.createCampaign(host, 'The Lantern Road');
  archive.member(c.id, host, 'p1', 'player', 'Sam');
  archive.member(c.id, host, 'p2', 'player', 'Ana');
  const start = Date.UTC(2026, 0, 1);
  const sessions = [];
  const add = (title, recap, lines, state = 'approved') => {
    const s = store.createSession(c.id, title, 'host', state);
    store.run('UPDATE sessions SET started=? WHERE id=?', start + sessions.length * 7 * 86400000, s.id);
    store.updateSession(s.id, state, recap);
    const ids = lines.map(([speaker, offset, text]) => store.addText(s.id, speaker, offset, text));
    sessions.push({ ...s, ids }); return { ...s, ids };
  };
  const s1 = add('Rain on the road', 'The party reached Rivergate.', [['DM', 10, 'You arrive at the inn soaked to the bone.']]);
  const s2 = add('The innkeeper\'s favour', 'A deal was struck at the inn.', [
    ['DM (innkeeper)', 100, 'The innkeeper wipes the counter and slides a brass key across.'],
    ['DM (innkeeper)', 104, 'Bring it back before sunset, or I want twenty silver.'],
    ['Jon / Orin', 110, 'Deal. We swear we will return it by sunset.'],
    ['Sam / Wren', 120, 'Can we get more of that stew?'],
  ]);
  add('The blade of Varn', 'They found an old weapon.', [['DM', 30, 'Under the altar lies the blade of Varn, cold and humming.'], ['Sam / Wren', 40, 'I wrap it in my cloak and carry it.']]);
  for (let i = 0; i < 9; i++) add(`Filler night ${i + 1}`, `Travel and shopping, part ${i + 1}.`, [['DM', 5, `The road goes on, day ${i + 1}.`], ['Jon / Orin', 9, 'I check the horses.']]);
  const s13 = add('Who has the key', 'The key changed hands.', [['Jon / Orin', 300, 'Here, Wren, you hold the brass key now.'], ['Sam / Wren', 305, 'Got it. It goes in my boot.']]);
  const s14 = add('Returned', 'The brass key went back to Mara at last.', [['Sam / Wren', 50, 'I put the brass key back on Mara\'s hook.']]);
  add('Unreviewed night', 'UNAPPROVED_SECRET', [['DM', 1, 'UNAPPROVED_LINE about the brass key']], 'awaiting_review');
  const mara = archive.save(c.id, host, { kind:'npc', name:'Mara Vale', body:'Keeps the [[Lantern Inn]]. Lent the party a [[Brass key]].', properties:{ aliases:['The Innkeeper'], role:'Innkeeper' }, sources:[{ session:s2.id, chunk:s2.ids[0] }] });
  archive.save(c.id, host, { kind:'location', name:'Lantern Inn', body:'Crooked inn at the edge of Rivergate.' });
  archive.save(c.id, host, { kind:'item', name:'Brass key', body:'Opens the inn cellar.', properties:{ owner:mara.id, holder:'Wren' } });
  archive.save(c.id, host, { kind:'journal', name:'Ana private', body:'The secret tunnel starts behind the stew pot.', visibility:'private' }, null);
  // Ana's own private journal
  store.run("UPDATE records SET author='p2' WHERE name='Ana private'");
  return { store, archive, c, s2, s13, s14 };
}
function fakeAI(replies) {
  const calls = [];
  const ai = async (task, material) => { calls.push({ task, context:JSON.parse(material) }); const next = replies.shift(); return typeof next === 'function' ? next(calls.at(-1)) : next; };
  return { ai, calls };
}
const evidenceText = call => JSON.stringify(call.context.evidence);

test('stemming and tokens line up word forms', () => {
  assert.equal(stem('promised'), stem('promise'));
  assert.equal(stem('blades'), stem('blade'));
  assert.deepEqual(tokens('What did we promise Mara?'), ['promis', 'mara']);
});

test('an old promise outside the recent sessions is found, with the neighbouring lines that hold the answer', async () => {
  const f = campaign(), { ai, calls } = fakeAI([JSON.stringify({ status:'answer', answer:'You swore to return the key by sunset [T1].', confidence:'high' })]);
  const result = await answerQuestion({ archive:f.archive, ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'What did we promise Mara?' });
  const text = evidenceText(calls[0]);
  assert.match(text, /We swear we will return it by sunset/);
  assert.match(text, /Bring it back before sunset/, 'the line before the match is included as context');
  assert.match(result.answer, /\*\*Sources\*\*\n- \[T1\] Session 02 "The innkeeper's favour" at 00:01:4\d/);
  assert.equal(result.sources[0].session, f.s2.id);
});

test('synonyms bridge different words for the same thing', () => {
  const f = campaign(), c = corpus(f.archive, f.c.id, { subject:'p1' });
  const ranked = retrieve(c, 'Who is carrying the sword?');
  assert.match(ranked.lineHits[0].text, /blade of Varn|carry it/);
});

test('aliases connect "Mara" in the question with "the innkeeper" in the transcript', () => {
  const f = campaign(), c = corpus(f.archive, f.c.id, { subject:'p1' });
  const ranked = retrieve(c, 'What did Mara say about sunset?');
  assert.equal(ranked.mentioned[0].name, 'Mara Vale');
  const packed = packEvidence(c, ranked);
  assert.equal(packed.items[0].payload.name, 'Mara Vale');
  assert.ok(packed.items.some(i => i.kind === 'T' && JSON.stringify(i.payload).includes('innkeeper')));
});

test('follow-up questions borrow the earlier question, but not earlier answers', async () => {
  const f = campaign(), { ai, calls } = fakeAI([JSON.stringify({ status:'answer', answer:'Orin gave it to Wren [T1].' })]);
  await answerQuestion({ archive:f.archive, ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'And who did he give it to?', previousQuestions:['Who had the brass key?'] });
  const ctx = calls[0].context;
  assert.deepEqual(ctx.earlierQuestions, ['Who had the brass key?']);
  assert.ok(ctx.discussedEarlier.includes('Brass key'));
  assert.match(evidenceText(calls[0]), /you hold the brass key now/);
  assert.equal(ctx.answer, undefined);
});

test('a fact that changed later shows both sessions, labelled in order', () => {
  const f = campaign(), c = corpus(f.archive, f.c.id, { subject:'p1' });
  const packed = packEvidence(c, retrieve(c, 'Where is the brass key now?'));
  const numbers = packed.items.filter(i => i.kind === 'T').map(i => i.payload.sessionNumber);
  assert.ok(numbers.includes(13) && numbers.includes(14), `expected sessions 13 and 14, got ${numbers}`);
});

test('an absent fact gets an honest answer without calling the AI', async () => {
  const f = campaign(), { ai, calls } = fakeAI([]);
  const result = await answerQuestion({ archive:f.archive, ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'What did the dragon say about the volcano?' });
  assert.equal(calls.length, 0);
  assert.match(result.answer, /couldn't find anything/);
});

test('players never get private journals or unapproved sessions as evidence; the author does get their own journal', async () => {
  const f = campaign();
  const player = fakeAI([JSON.stringify({ status:'answer', answer:'Not known.' })]);
  const r1 = await answerQuestion({ archive:f.archive, ai:player.ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'Where does the secret tunnel start? brass key' });
  const all = JSON.stringify(player.calls);
  assert.doesNotMatch(all, /behind the stew pot|UNAPPROVED_SECRET|UNAPPROVED_LINE/);
  assert.ok(r1);
  const author = fakeAI([JSON.stringify({ status:'answer', answer:'Behind the stew pot [E1].' })]);
  await answerQuestion({ archive:f.archive, ai:author.ai, campaign:f.c.id, actor:{ subject:'p2' }, question:'Where does the secret tunnel start?' });
  assert.match(JSON.stringify(author.calls), /behind the stew pot/);
  const admin = fakeAI([JSON.stringify({ status:'answer', answer:'ok' })]);
  await answerQuestion({ archive:f.archive, ai:admin.ai, campaign:f.c.id, actor:host, question:'brass key' });
  assert.doesNotMatch(JSON.stringify(admin.calls), /UNAPPROVED_LINE/, 'even admins get only approved sessions as canon');
});

test('the model can ask for more searches, at most twice, and new evidence keeps new IDs', async () => {
  // A fourth reply is never requested: after two searches the third call is the forced final round.
  const f = campaign();
  const ask = q => JSON.stringify({ status:'search', queries:[q], reason:'need more' });
  const { ai, calls } = fakeAI([ask('blade of Varn'), ask('altar'), JSON.stringify({ status:'answer', answer:'Found under the altar [T99].' })]);
  const result = await answerQuestion({ archive:f.archive, ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'What did we promise Mara?' });
  assert.equal(calls.length, 3, 'two extra searches, then a forced final answer');
  assert.match(calls[2].task, /final round/);
  assert.deepEqual(result.searched, ['What did we promise Mara?', 'blade of Varn', 'altar']);
  const ids = calls[2].context.evidence.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs never repeat');
  assert.match(evidenceText(calls[1]), /blade of Varn/);
  assert.equal(result.sources.length, 0, 'unknown citation T99 is dropped');
  assert.match(result.answer, /removed/);
});

test('context stays valid JSON under the budget and reports what was left out', () => {
  const f = campaign();
  const s = f.store.createSession(f.c.id, 'Long night', 'host', 'approved');
  for (let i = 0; i < 400; i++) f.store.addText(s.id, 'DM', i * 20, `The brass key glints again and again ${'x'.repeat(600)} ${i}`);
  const c = corpus(f.archive, f.c.id, { subject:'p1' });
  const packed = packEvidence(c, retrieve(c, 'brass key'), { budget:20000 });
  const json = JSON.stringify(packed.items.map(i => i.payload));
  assert.ok(json.length <= 21000, `context too large: ${json.length}`);
  assert.doesNotThrow(() => JSON.parse(json));
  assert.ok(packed.notShown.matchingLines > 300, `matchingLines ${packed.notShown.matchingLines}`);
  assert.ok(packed.items.filter(i => i.kind === 'T').every(i => i.payload.lines.length <= 12), 'passages are capped');
});

test('replies are parsed defensively and citations are checked', () => {
  assert.deepEqual(parseReply('```json\n{"status":"search","queries":["a","b","c","d"]}\n```').queries, ['a', 'b', 'c']);
  assert.equal(parseReply('Plain text answer').answer, 'Plain text answer');
  const items = [{ id:'T1', kind:'T', label:'Session 02 "X"', at:104, session:'s' }, { id:'E1', kind:'E', label:'NPC: Mara Vale', recordId:'r' }];
  const out = citeSources('A [T1]. B [E1, T7]. C [R4].', items, null);
  assert.match(out.text, /A \[T1\]\. B \[E1\]\. C \./);
  assert.match(out.text, /- \[T1\] Session 02 "X" at 00:01:44\n- \[E1\] NPC: Mara Vale/);
  assert.match(out.text, /2 citations pointed at evidence that wasn't supplied/);
});

test('a model that keeps asking to search on the final round gets a plain fallback, not a loop', async () => {
  const f = campaign();
  const ask = JSON.stringify({ status:'search', queries:['more'] });
  const { ai, calls } = fakeAI([ask, JSON.stringify({ status:'search', queries:['other'] }), ask]);
  const result = await answerQuestion({ archive:f.archive, ai, campaign:f.c.id, actor:{ subject:'p1' }, question:'brass key' });
  assert.equal(calls.length, 3);
  assert.match(result.answer, /could not find enough/);
});
