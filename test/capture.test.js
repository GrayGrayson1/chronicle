import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Recorder, captureHealth, captureReport, captureSummary, speakerNeedsCheck } from '../src/audio.js';
import { Store } from '../src/store.js';

const SECOND = 48000*2*2;
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// Decoder is injected as a PassThrough so these tests exercise Chronicle's stream handling, not Opus or Discord.
function fixture({ users = ['jon','sam'] } = {}) {
  const submitted = [], failures = [], warnings = [], streams = [];
  const speaking = new EventEmitter(); speaking.users = new Map();
  const members = new Map(users.map(id => [id, { user:{ bot:false }, displayName:id.toUpperCase() }]));
  const recorder = new Recorder({
    channel:{ members }, session:{ id:'abcd1234', title:'Test night', started:Date.now() }, campaign:{ id:'campaign' },
    store:{ label:(campaign, id, fallback) => `${fallback} / hero` }, audio:{ submit:(...args) => submitted.push(args) },
    onFailure:error => failures.push(error.message), onWarning:message => warnings.push(message), onTimeout:() => {}, maxHours:1,
    createDecoder:() => new PassThrough(), retryDelay:5, log:{ warn() {} },
  });
  recorder.connection = { receiver:{ speaking, subscribe:id => { const stream = new PassThrough(); streams.push({ id, stream }); return stream; } } };
  return { recorder, submitted, failures, warnings, streams, speaking };
}

test('one speaker\'s receive error keeps everyone else recording and saves audio decoded before the error', async () => {
  const f = fixture();
  f.recorder.consent('jon'); f.recorder.consent('sam');
  f.recorder.capture('jon'); f.recorder.capture('sam');
  const [jon, sam] = f.streams;
  jon.stream.write(Buffer.alloc(SECOND)); sam.stream.write(Buffer.alloc(SECOND));
  await tick();
  jon.stream.emit('error', new Error('Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)'));
  await tick();
  assert.deepEqual(f.failures, [], 'the session must not stop');
  assert.equal(f.submitted.length, 1, 'Jon\'s audio before the error is kept');
  assert.equal(f.submitted[0][1], 'JON / hero');
  assert.equal(f.recorder.streams.has('sam'), true, 'Sam is still being recorded');
  sam.stream.write(Buffer.alloc(SECOND)); sam.stream.end(); await tick();
  assert.equal(f.submitted.length, 2);
  const report = captureReport(f.recorder.health);
  const jonReport = report.speakers.find(s => s.id === 'jon');
  assert.equal(jonReport.receiveErrors, 1);
  assert.match(jonReport.lastError, /DecryptionFailed/);
  assert.equal(speakerNeedsCheck(jonReport), true);
  assert.equal(speakerNeedsCheck(report.speakers.find(s => s.id === 'sam')), false);
});

test('a speaker who errors while still talking is resubscribed automatically', async () => {
  const f = fixture({ users:['jon'] });
  f.speaking.users.set('jon', {}); f.recorder.consent('jon');
  assert.equal(f.streams.length, 1, 'consent while speaking starts capture');
  f.streams[0].stream.emit('error', new Error('boom'));
  await tick(30);
  assert.equal(f.streams.length, 2, 'a fresh subscription replaces the failed one');
  assert.equal(f.recorder.streams.has('jon'), true);
  f.recorder.stop();
});

test('decoder errors are treated per speaker too', async () => {
  const f = fixture({ users:['jon'] });
  let decoder;
  f.recorder.createDecoder = () => (decoder = new PassThrough());
  f.recorder.consent('jon'); f.recorder.capture('jon');
  decoder.emit('error', new Error('corrupted packet'));
  await tick();
  assert.deepEqual(f.failures, []);
  assert.equal(f.recorder.health.stats.get('jon').decoderErrors, 1);
});

test('speaking turns that deliver no audio are counted as silent turns', async () => {
  const f = fixture({ users:['jon'] });
  f.recorder.consent('jon');
  for (let i = 0; i < 4; i++) { f.recorder.capture('jon'); f.streams.at(-1).stream.end(); await tick(); }
  const stats = captureReport(f.recorder.health).speakers[0];
  assert.equal(stats.turns, 4); assert.equal(stats.silentTurns, 4); assert.equal(stats.decodedSeconds, 0);
  assert.equal(speakerNeedsCheck(stats), true);
});

test('an error storm pauses retries for that speaker and warns the channel once', async () => {
  const f = fixture({ users:['jon'] });
  f.recorder.consent('jon');
  for (let i = 0; i < 14; i++) {
    f.recorder.capture('jon');
    f.streams.at(-1).stream.emit('error', new Error('decrypt'));
    for (const timer of f.recorder.retryTimers.values()) clearTimeout(timer);
    f.recorder.retryTimers.clear();
    await tick();
  }
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0], /JON \/ hero/);
  const before = f.streams.length;
  f.recorder.capture('jon');
  assert.equal(f.streams.length, before, 'no new subscription during the cooldown');
  assert.deepEqual(f.failures, []);
  f.recorder.stop();
});

test('occasional connection errors are tolerated; a burst stops the session with a clear reason', () => {
  const f = fixture();
  f.recorder.connectionProblem(new Error('socket hiccup'));
  assert.deepEqual(f.failures, []);
  for (let i = 0; i < 4; i++) f.recorder.connectionProblem(new Error('socket hiccup'));
  assert.equal(f.failures.length, 1);
  assert.match(f.failures[0], /kept failing/);
});

test('capture stats survive pause/resume because the health object is shared', async () => {
  const health = captureHealth();
  const first = fixture({ users:['jon'] }); first.recorder.health = health;
  first.recorder.consent('jon'); first.recorder.capture('jon');
  first.streams[0].stream.write(Buffer.alloc(SECOND*2)); await tick(); first.recorder.stop();
  const second = fixture({ users:['jon'] }); second.recorder.health = health;
  second.recorder.consent('jon'); second.recorder.capture('jon');
  second.streams[0].stream.write(Buffer.alloc(SECOND)); second.streams[0].stream.end(); await tick();
  const jon = captureReport(health).speakers[0];
  assert.equal(jon.decodedSeconds, 3); assert.equal(jon.clips, 2); assert.equal(jon.turns, 2);
});

test('summary flags problems, notes quiet people, and the report persists in SQLite', () => {
  const health = captureHealth();
  health.stats.set('jon', { label:'Jon / Zafir', decodedSeconds:751, savedSeconds:750, clips:41, turns:60, silentTurns:1, receiveErrors:0, decoderErrors:0, lastError:'', recentErrors:[] });
  health.stats.set('cal', { label:'Callidus', decodedSeconds:0, savedSeconds:0, clips:0, turns:14, silentTurns:14, receiveErrors:3, decoderErrors:0, lastError:'DecryptionFailed', recentErrors:[] });
  health.stats.set('sam', { label:'Sam', decodedSeconds:0, savedSeconds:0, clips:0, turns:0, silentTurns:0, receiveErrors:0, decoderErrors:0, lastError:'', recentErrors:[] });
  const report = captureReport(health), text = captureSummary(report, { id:'abcd1234', title:'Test night' });
  assert.match(text, /✅ Jon \/ Zafir: 12m 31s captured in 41 clips/);
  assert.match(text, /⚠️ Callidus: 0s captured in 0 clips · 14 of 14 speaking turns came through with no audio · 3 receive errors/);
  assert.match(text, /Sam: opted in but was never heard/);
  assert.match(text, /backup recording/);
  const store = new Store(':memory:');
  store.createCampaign('g','c','Camp');
  const campaign = store.campaign('g','c'), session = store.createSession(campaign.id,'Test night','host');
  store.saveCaptureReport(session.id, report);
  assert.equal(store.captureReport(session.id).speakers.length, 3);
  store.deleteSession(campaign.id, session.id);
  assert.equal(store.captureReport(session.id), null, 'reports are deleted with their session');
  store.close();
});
