import test from 'node:test';
import assert from 'node:assert/strict';
import { craigSpeaker, craigTracks, parseSpeakerMap } from '../src/craig.js';

test('Craig file names become speaker labels', () => {
  assert.equal(craigSpeaker('1-jace.flac'), 'jace');
  assert.equal(craigSpeaker('craig_abc123/12-Callidus.m4a'), 'Callidus');
  assert.equal(craigSpeaker('3-old_user#1234.ogg'), 'old_user');
  assert.equal(craigSpeaker('notes.flac'), 'notes');
});

test('only non-empty audio tracks are imported, in track order, with --map overrides', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const tracks = craigTracks({
    'rec/10-sam.flac':bytes, 'rec/2-jace.flac':bytes, 'rec/1-callidus.flac':bytes,
    'rec/info.txt':bytes, 'rec/raw.dat':bytes, 'rec/4-empty.flac':new Uint8Array(), '__MACOSX/._1-callidus.flac':bytes, 'rec/':new Uint8Array(),
  }, parseSpeakerMap(['callidus=Brian / Kael', 'JACE=Jace (DM)']));
  assert.deepEqual(tracks.map(t => [t.speaker, t.label]), [['callidus', 'Brian / Kael'], ['jace', 'Jace (DM)'], ['sam', 'sam']]);
});

test('malformed --map values are rejected with a clear message', () => {
  assert.throws(() => parseSpeakerMap(['no-equals']), /--map/);
  assert.throws(() => parseSpeakerMap(['=Label']), /--map/);
});
