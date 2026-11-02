// Campaign question answering: evidence retrieval, context packing and a bounded search loop.
//
// Every retrieval runs through Archive with the asking member's current access, so private journals,
// private entries and unapproved sessions never reach the prompt for someone who can't read them.
// The model sees a structured, budgeted evidence list (no blind string slicing), can ask for up to
// MAX_ROUNDS extra searches, and the source list under each answer is built by code from the evidence
// IDs it cited, not written by the model.
import { timestamp } from './store.js';

export const MAX_ROUNDS = 2;
const CONTEXT_BUDGET = 110000;
const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
  'anything something everything thing things tell know remember said say chronicle campaign party session sessions please any ever also still yet one ones got get go went did does done let lets ok okay hey yeah').split(/\s+/));
// Words that mean "give me the big picture" rather than "find this specific thing".
const GENERAL = new Set(['summarize', 'summary', 'recap', 'overview', 'happened', 'story', 'far', 'last', 'previous', 'latest', 'recent', 'next', 'remind', 'reminders', 'catch', 'missed', 'everyone', 'everybody']);
const SYNONYMS = [
  'sword blade longsword shortsword greatsword rapier saber sabre scimitar', 'axe hatchet greataxe', 'bow longbow shortbow crossbow', 'dagger knife dirk',
  'inn tavern pub alehouse', 'coin coins gold silver copper money gp sp cp purse', 'letter note message missive scroll', 'map chart',
  'tower spire keep', 'abandoned ruined derelict deserted', 'king queen ruler monarch', 'guard guards watchman soldier soldiers',
  'give gave given hand handed lend lent gift gifted', 'promise promised swear swore sworn vow vowed oath agree agreed deal',
  'kill killed slay slew slain murder murdered', 'die died dead death', 'steal stole stolen thief', 'buy bought purchase purchased sell sold',
  'leave left drop dropped abandon', 'find found discover discovered', 'meet met', 'say said tell told mention mentioned', 'potion elixir vial tonic',
  'ring band', 'armor armour mail plate', 'leader captain chief boss', 'wizard mage sorcerer warlock', 'priest cleric', 'cellar basement',
  'carry carries carried hold holds held has have', 'owe owed debt',
].map(group => group.split(/\s+/));

export function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}
export function words(text) {
  return (String(text || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) || []).map(t => t.replace(/'s$/, ''));
}
export const tokens = text => words(text).filter(t => t.length > 1 && !STOP.has(t)).map(stem);
const SYNONYM_MAP = new Map();
for (const group of SYNONYMS) { const stems = [...new Set(group.map(stem))]; for (const s of stems) SYNONYM_MAP.set(s, [...new Set([...(SYNONYM_MAP.get(s) || []), ...stems.filter(x => x !== s)])]); }
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseIn = (text, phrase) => phrase.length > 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(phrase.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());
const PRONOUN = /\b(he|she|they|him|her|them|it|that|those|this|there|his|hers|their|theirs)\b/i;

/** Weighted query terms: the question itself, synonyms, aliases of mentioned entities, and (lightly) the previous question. */
export function queryTerms(question, { mentioned = [], previous = [] } = {}) {
  const weights = new Map();
  const add = (term, weight) => { if (term && term.length > 1) weights.set(term, Math.max(weights.get(term) || 0, weight)); };
  const base = tokens(question);
  for (const t of base) { add(t, 1); for (const s of SYNONYM_MAP.get(t) || []) add(s, 0.5); }
  for (const record of mentioned) for (const name of [record.name, ...aliasesOf(record)]) for (const t of tokens(name)) add(t, 0.8);
  // Follow-ups like "and who did he give it to?" borrow the earlier question's terms at low weight.
  const followUp = base.length <= 4 || PRONOUN.test(question);
  if (followUp) for (const q of previous.slice(-2)) for (const t of tokens(q)) add(t, 0.35);
  return { weights, base, followUp, general:base.length === 0 || base.every(t => GENERAL.has(t)) || words(question).some(w => GENERAL.has(w)) && base.length <= 3 };
}
export const aliasesOf = record => (Array.isArray(record.properties?.aliases) ? record.properties.aliases : []).filter(a => typeof a === 'string' && a.trim());

/** Okapi BM25 over a document list. Returns docs with .score (> 0 only), sorted. */
export function bm25(docs, weights, { k1 = 1.2, b = 0.75, boost = () => 0 } = {}) {
  if (!docs.length || !weights.size) return [];
  const df = new Map(); let totalLength = 0;
  for (const doc of docs) { doc.tf ??= countTerms(doc.terms); totalLength += doc.terms.length; for (const term of doc.tf.keys()) if (weights.has(term)) df.set(term, (df.get(term) || 0) + 1); }
  const avg = totalLength / docs.length || 1, n = docs.length;
  const out = [];
  for (const doc of docs) {
    let score = 0;
    for (const [term, weight] of weights) {
      const f = doc.tf.get(term); if (!f) continue;
      const idf = Math.log(1 + (n - df.get(term) + 0.5) / (df.get(term) + 0.5));
      score += weight * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.terms.length / avg));
    }
    score += boost(doc);
    if (score > 0) out.push({ ...doc, score });
  }
  return out.sort((a, b2) => b2.score - a.score);
}
function countTerms(terms) { const m = new Map(); for (const t of terms) m.set(t, (m.get(t) || 0) + 1); return m; }
const propertyText = properties => Object.entries(properties || {}).filter(([key]) => !['firstSession', 'lastSession', 'playerSubject', 'asset'].includes(key))
  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
const trim = (text, max) => { const value = String(text || ''); if (value.length <= max) return value; const cut = value.lastIndexOf(' ', max); return value.slice(0, cut > max * 0.7 ? cut : max) + ' …[trimmed]'; };

/**
 * Gather everything this member may read, once per question.
 * Sessions: approved only (also for admins, so canon answers never rely on unreviewed material).
 */
export function corpus(archive, campaign, actor) {
  const store = archive.store;
  const sessions = archive.sessions(campaign, actor).filter(s => s.state === 'approved').sort((a, b) => a.started - b.started);
  const number = new Map(sessions.map((s, i) => [s.id, i + 1]));
  const records = archive.records(campaign, actor);
  const byId = new Map(records.map(r => [r.id, r]));
  const lines = [];
  for (const session of sessions) {
    const chunks = store.chunks(session.id).filter(c => c.state === 'done' && c.text);
    chunks.forEach((chunk, index) => lines.push({ type:'line', id:chunk.id, session:session.id, index, offset:chunk.offset, speaker:chunk.speaker, text:chunk.text, terms:tokens(`${chunk.speaker} ${chunk.text}`) }));
  }
  const recapDocs = sessions.map(s => ({ type:'recap', id:s.id, session:s.id, text:`${s.title}\n${s.recap}`, terms:tokens(`${s.title} ${s.recap}`) }));
  const recordDocs = records.map(r => ({ type:'record', id:r.id, record:r, names:[r.name, ...aliasesOf(r)], terms:tokens(`${r.name} ${aliasesOf(r).join(' ')} ${r.body} ${propertyText(r.properties)}`) }));
  return { sessions, number, records, byId, lines, recapDocs, recordDocs, linesBySession:groupBy(lines, l => l.session) };
}
function groupBy(list, key) { const m = new Map(); for (const item of list) { const k = key(item); if (!m.has(k)) m.set(k, []); m.get(k).push(item); } return m; }

/** Entities whose name or alias appears in the text. Longest names first so "Mara Vale" wins over "Mara". */
export function mentionedEntities(text, records) {
  const found = [];
  const candidates = records.flatMap(r => [r.name, ...aliasesOf(r)].map(name => ({ r, name }))).sort((a, b) => b.name.length - a.name.length);
  for (const { r, name } of candidates) {
    if (found.includes(r)) continue;
    const firstWord = name.split(/\s+/)[0];
    if (phraseIn(text, name) || (firstWord.length > 3 && /^\p{Lu}/u.test(firstWord) && name.split(/\s+/).length > 1 && phraseIn(text, firstWord))) found.push(r);
  }
  return found;
}

function linkedIds(record, byId) {
  const ids = new Set();
  for (const match of String(record.body || '').matchAll(/\[\[([^\]|]+)/g)) {
    const target = [...byId.values()].find(r => r.name.toLowerCase() === match[1].trim().toLowerCase() || aliasesOf(r).some(a => a.toLowerCase() === match[1].trim().toLowerCase()));
    if (target) ids.add(target.id);
  }
  for (const value of Object.values(record.properties || {})) for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string' && byId.has(v)) ids.add(v);
  ids.delete(record.id);
  return [...ids];
}

/** Rank evidence for one query. Pure function of the corpus. */
export function retrieve(c, question, { previous = [], semantic = [], exclude = { lines:new Set(), records:new Set(), recaps:new Set() } } = {}) {
  const mentioned = mentionedEntities(question, c.records);
  const prevMentioned = queryTerms(question).followUp ? previous.flatMap(q => mentionedEntities(q, c.records)) : [];
  const q = queryTerms(question, { mentioned:[...mentioned, ...prevMentioned], previous });
  const semanticRecords = new Map(), semanticLines = new Map();
  for (const hit of semantic) {
    if (hit.source?.entry) semanticRecords.set(hit.source.entry, Math.max(hit.score || 0, semanticRecords.get(hit.source.entry) || 0));
    if (hit.source?.session !== undefined && hit.source?.time !== undefined) {
      const line = (c.linesBySession.get(hit.source.session) || []).find(l => Math.abs(l.offset - hit.source.time) < 0.01);
      if (line) semanticLines.set(line.id, Math.max(hit.score || 0, semanticLines.get(line.id) || 0));
    }
  }
  const mentionedIds = new Set([...mentioned, ...prevMentioned].map(r => r.id));
  const recordHits = bm25(c.recordDocs, q.weights, { boost:doc => (mentionedIds.has(doc.id) ? 6 : 0) + (doc.names.some(n => phraseIn(question, n)) ? 4 : 0) + 3 * (semanticRecords.get(doc.id) || 0) })
    .filter(d => !exclude.records.has(d.id));
  // Lines that name a mentioned entity (by any alias) count even if the question used a different alias.
  const aliasPhrases = [...mentioned, ...prevMentioned].flatMap(r => [r.name, ...aliasesOf(r)]);
  const lineHits = bm25(c.lines, q.weights, { boost:doc => (aliasPhrases.some(p => phraseIn(doc.text, p)) ? 1.5 : 0) + 3 * (semanticLines.get(doc.id) || 0) })
    .filter(d => !exclude.lines.has(d.id));
  const recapHits = bm25(c.recapDocs, q.weights).filter(d => !exclude.recaps.has(d.id));
  return { q, mentioned, prevMentioned, recordHits, lineHits, recapHits };
}

/** Group top transcript lines into windows with their neighbours, so an answer said on the next line isn't lost. */
export function windows(c, lineHits, { maxHits = 18, radius = 2, maxLines = 12 } = {}) {
  const top = lineHits.slice(0, maxHits), bySession = groupBy(top, l => l.session), out = [];
  for (const [session, hits] of bySession) {
    const all = c.linesBySession.get(session) || [];
    const ranges = hits.map(h => [Math.max(0, h.index - radius), Math.min(all.length - 1, h.index + radius), h.score, h.id]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged.at(-1);
      if (last && r[0] <= last[1] + 1) { last[1] = Math.max(last[1], r[1]); last[2] = Math.max(last[2], r[2]); last[3].push(r[3]); }
      else merged.push([r[0], r[1], r[2], [r[3]]]);
    }
    // Long runs of matches are split so one busy scene can't become a single giant passage.
    for (const [from, to, score, hitIds] of merged) for (let at = from; at <= to; at += maxLines) {
      const lines = all.slice(at, Math.min(to, at + maxLines - 1) + 1);
      const hits = new Set(hitIds.filter(id => lines.some(l => l.id === id)));
      if (hits.size) out.push({ session, score, lines, hitIds:hits });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Build the evidence list and a JSON context that fits the budget. Items are added whole, in priority
 * order; whatever doesn't fit is counted in `notShown` so the model knows evidence exists beyond it.
 */
export function packEvidence(c, ranked, { startIds = { E:0, T:0, R:0 }, budget = CONTEXT_BUDGET, general = false } = {}) {
  const items = [], ids = { ...startIds }, notShown = { entries:0, transcriptPassages:0, matchingLines:0, recaps:0 };
  let used = 0;
  const take = (kind, payload, meta) => {
    const text = JSON.stringify(payload);
    if (used + text.length > budget) { notShown[kind === 'E' ? 'entries' : kind === 'T' ? 'transcriptPassages' : 'recaps']++; return false; }
    ids[kind]++; const id = `${kind}${ids[kind]}`; used += text.length + id.length + 8;
    items.push({ id, kind, payload, ...meta }); return true;
  };
  const sessionLabel = id => { const s = c.sessions.find(x => x.id === id); return s ? { session:id, sessionNumber:c.number.get(id), sessionTitle:s.title, date:new Date(s.started).toISOString().slice(0, 10) } : { session:id }; };
  const record = r => ({ type:r.kind, name:r.name, aliases:aliasesOf(r), body:trim(r.body, 4000), properties:Object.fromEntries(Object.entries(r.properties || {}).filter(([k]) => !['playerSubject', 'asset'].includes(k)).map(([k, v]) => [k, typeof v === 'string' ? trim(v, 1200) : v])),
    seenInSessions:[...new Set((r.sources || []).map(s => s.session).filter(id => c.number.has(id)))].map(id => c.number.get(id)).sort((a, b) => a - b) });
  const addedRecords = new Set();
  const addRecord = (r, why) => { if (addedRecords.has(r.id)) return; if (take('E', { ...record(r), why }, { recordId:r.id, label:`${r.kind.toUpperCase()}: ${r.name}` })) addedRecords.add(r.id); };

  for (const r of [...ranked.mentioned, ...ranked.prevMentioned]) addRecord(r, 'named in the question');
  for (const hit of ranked.recordHits.slice(0, 14)) addRecord(hit.record, 'matches the question');
  for (const w of windows(c, ranked.lineHits)) {
    const meta = sessionLabel(w.session);
    take('T', { ...meta, lines:w.lines.map(l => ({ time:timestamp(l.offset), speaker:l.speaker, text:trim(l.text, 900), ...(w.hitIds.has(l.id) ? { match:true } : {}) })) },
      { session:w.session, lineIds:w.lines.map(l => l.id), at:w.lines.find(l => w.hitIds.has(l.id))?.offset ?? w.lines[0].offset, label:`Session ${pad(meta.sessionNumber)} "${meta.sessionTitle}"` });
  }
  // Linked entities (one hop) after the direct evidence: "follow connections".
  for (const r of [...addedRecords].map(id => c.byId.get(id)).filter(Boolean)) for (const id of linkedIds(r, c.byId).slice(0, 4)) { if (addedRecords.size >= 30) break; addRecord(c.byId.get(id), `linked from ${r.name}`); }
  const recapIds = [...new Set([...ranked.recapHits.slice(0, 4).map(r => r.id), ...items.filter(i => i.kind === 'T').map(i => i.session), ...(general ? c.sessions.slice(-4).map(s => s.id).reverse() : c.sessions.slice(-1).map(s => s.id))])];
  for (const id of recapIds.slice(0, 8)) {
    const s = c.sessions.find(x => x.id === id); if (!s) continue;
    take('R', { ...sessionLabel(id), recap:trim(s.recap, 5000) }, { session:id, label:`Recap of session ${pad(c.number.get(id))} "${s.title}"` });
  }
  // Matching lines beyond what fit are counted so the model knows to search more narrowly instead of assuming absence.
  const shownLines = new Set(items.flatMap(i => i.lineIds || []));
  notShown.matchingLines = ranked.lineHits.filter(l => !shownLines.has(l.id)).length;
  notShown.entries += Math.max(0, ranked.recordHits.length - items.filter(i => i.kind === 'E').length - notShown.entries);
  return { items, ids, notShown, used };
}
const pad = n => String(n ?? '?').padStart(2, '0');

export function parseReply(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(raw.slice(start, end + 1));
      if (value && (value.status === 'search' && Array.isArray(value.queries)) ) return { status:'search', queries:value.queries.map(String).map(s => s.trim()).filter(Boolean).slice(0, 3), reason:String(value.reason || '') };
      if (value && typeof value.answer === 'string') return { status:'answer', answer:value.answer, confidence:['high', 'medium', 'low'].includes(value.confidence) ? value.confidence : null };
    } catch {}
  }
  return { status:'answer', answer:raw, confidence:null };
}

/** Replace the model's citations with checked ones and append a source list built from the evidence. */
export function citeSources(answer, items, c) {
  const known = new Map(items.map(i => [i.id, i]));
  const cited = [], unknown = [];
  const text = String(answer).replace(/\[((?:[ETR]\d+)(?:\s*,\s*[ETR]\d+)*)\]/g, (whole, list) => {
    const ok = list.split(/\s*,\s*/).filter(id => { if (known.has(id)) { if (!cited.includes(id)) cited.push(id); return true; } unknown.push(id); return false; });
    return ok.length ? `[${ok.join(', ')}]` : '';
  });
  const lines = cited.map(id => {
    const item = known.get(id);
    if (item.kind === 'T') return `- [${id}] ${item.label} at ${timestamp(item.at)}`;
    if (item.kind === 'R') return `- [${id}] ${item.label}`;
    return `- [${id}] ${item.label}`;
  });
  const sources = cited.map(id => { const item = known.get(id); return { id, kind:item.kind, label:item.label, session:item.session || null, at:item.at ?? null, entry:item.recordId || null }; });
  const note = unknown.length ? `\n\n_${unknown.length} citation${unknown.length === 1 ? '' : 's'} pointed at evidence that wasn't supplied and ${unknown.length === 1 ? 'was' : 'were'} removed._` : '';
  return { text:text.trim() + (lines.length ? `\n\n**Sources**\n${lines.join('\n')}` : '') + note, sources };
}

const INSTRUCTIONS = (creative, final) => [
  'Answer the campaign question using ONLY the evidence in CONTEXT.evidence (entries E#, transcript passages T#, recaps R#).',
  creative ? 'Creative mode: you may also propose new fiction, but label every invented part as a suggestion, never as campaign canon. No published-adventure knowledge or spoilers.'
    : 'Factual mode: do not invent events, names, loot, quotes or outcomes. If the evidence does not settle it, say what is known and what is uncertain.',
  'Cite evidence inline with its ID in square brackets, e.g. [T3] or [E1, T2], after each claim that relies on it. Use only IDs that appear in CONTEXT.evidence.',
  'Transcript lines are what people said at the table. Player chatter and the DM voicing NPCs can both appear; speaker labels are Discord identities. Later sessions can contradict earlier ones: prefer the most recent session and mention the change.',
  'If a question refers back to an earlier one ("he", "it", "that"), use CONTEXT.earlierQuestions and CONTEXT.discussedEarlier to resolve it.',
  final ? 'This is the final round: answer now with what you have.'
    : 'If the evidence is clearly insufficient and a different search would likely find it (another name, place, item or phrasing), you may instead reply {"status":"search","queries":["…"],"reason":"…"} with up to 3 short queries. Do this at most when it really helps.',
  'Reply with a single JSON object and nothing else: {"status":"answer","answer":"Markdown answer with [IDs]","confidence":"high|medium|low"}. Keep the answer under 400 words. Respect CONTEXT.settings.outputLanguage and tone if set.',
].join('\n');

/**
 * Answer a question. `ai(task, material)` returns the model's text; `semantic(query)` is optional.
 * Returns { answer, sources, rounds, evidence, searched }.
 */
export async function answerQuestion({ archive, ai, campaign, actor, question, creative = false, previousQuestions = [], semantic = null, settings = {}, maxRounds = MAX_ROUNDS }) {
  const c = corpus(archive, campaign, actor);
  const previous = previousQuestions.slice(-3);
  const first = retrieve(c, question, { previous, semantic:semantic ? await semantic(question) : [] });
  const nothing = !first.mentioned.length && !first.prevMentioned.length && !first.recordHits.length && !first.lineHits.length && !first.recapHits.length;
  if (nothing && !first.q.general && !creative) {
    return { answer:"I couldn't find anything about that in the approved sessions and entries you can see. It may not have come up yet, it may be in a session that hasn't been approved, or it may be worded differently. Try a name, place or item.", sources:[], rounds:0, evidence:0, searched:[question] };
  }
  let packed = packEvidence(c, first, { general:first.q.general });
  const evidence = [...packed.items], searched = [question];
  const exclude = { lines:new Set(evidence.flatMap(i => i.lineIds || [])), records:new Set(evidence.map(i => i.recordId).filter(Boolean)), recaps:new Set(evidence.filter(i => i.kind === 'R').map(i => i.session)) };
  // Only entity names the member can still read are carried forward from earlier questions.
  const discussedEarlier = [...new Set(previous.flatMap(q => mentionedEntities(q, c.records)).map(r => r.name))];
  const settingsOut = { outputLanguage:settings.outputLanguage || settings.language || '', tone:settings.tone || '' };
  let reply, rounds = 0;
  for (;;) {
    rounds++;
    const final = rounds > maxRounds;
    const context = { question, earlierQuestions:previous, discussedEarlier, settings:settingsOut, sessionsInArchive:c.sessions.length,
      evidence:evidence.map(i => ({ id:i.id, ...i.payload })), notShown:packed.notShown, searchesSoFar:searched };
    reply = parseReply(await ai(INSTRUCTIONS(creative, final), JSON.stringify(context)));
    if (reply.status !== 'search' || final || !reply.queries.length) break;
    let added = 0;
    const queries = reply.queries.filter(query => !searched.includes(query));
    for (const query of queries) {
      searched.push(query);
      const remaining = CONTEXT_BUDGET + 20000 - evidence.reduce((n, i) => n + JSON.stringify(i.payload).length + 16, 0);
      if (remaining < 3000) break;
      const more = retrieve(c, query, { exclude });
      const extra = packEvidence(c, more, { startIds:packed.ids, budget:Math.floor(remaining / queries.length) });
      packed = { ...packed, ids:extra.ids };
      for (const item of extra.items) {
        evidence.push(item); added++;
        for (const id of item.lineIds || []) exclude.lines.add(id);
        if (item.recordId) exclude.records.add(item.recordId);
        if (item.kind === 'R') exclude.recaps.add(item.session);
      }
    }
    if (!added) { rounds = maxRounds; } // nothing new to show: next round is final
  }
  if (reply.status === 'search') reply = { status:'answer', answer:'I searched the archive but could not find enough to answer that confidently.', confidence:'low' };
  const cited = citeSources(reply.answer, evidence, c);
  const confidence = reply.confidence === 'low' ? '\n\n_Confidence: low. The evidence above is thin, so check it before treating this as canon._' : '';
  return { answer:cited.text + confidence, sources:cited.sources, rounds, evidence:evidence.length, searched };
}
