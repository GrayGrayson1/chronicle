import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProperties } from '../src/merge.js';

test('later sessions append to item history instead of erasing it', () => {
  const session1 = mergeProperties({}, { quantity:1, holder:'Mara', history:['Mara lent the brass key to the party'] }, { session:'s1' });
  const session2 = mergeProperties(session1, { holder:'Orin', status:'carried', history:['Orin took the key into the cellar'] }, { session:'s2' });
  assert.equal(session2.holder, 'Orin', 'current holder updates');
  assert.equal(session2.quantity, 1, 'unchanged fields stay');
  assert.deepEqual(session2.history, [
    { session:'s1', text:'Mara lent the brass key to the party' },
    { session:'s2', text:'Orin took the key into the cellar' },
  ]);
});

test('quest progress logs keep earlier entries and skip exact duplicates', () => {
  const before = { status:'in_progress', progressLog:[{ session:'s1', text:'Found the letter' }] };
  const after = mergeProperties(before, { status:'done', progressLog:[{ session:'s1', text:'Found the letter' }, 'Returned the key'] }, { session:'s3' });
  assert.equal(after.status, 'done');
  assert.deepEqual(after.progressLog, [{ session:'s1', text:'Found the letter' }, { session:'s3', text:'Returned the key' }]);
});

test('aliases are unioned, and non-log fields still take the newer value', () => {
  const merged = mergeProperties({ aliases:['The Innkeeper'], likes:'cider' }, { aliases:['Mara', 'The Innkeeper', ''], likes:'apple cider' });
  assert.deepEqual(merged.aliases, ['The Innkeeper', 'Mara']);
  assert.equal(merged.likes, 'apple cider');
});

test('logs are capped so a long campaign cannot exceed the record size limit', () => {
  let props = {};
  for (let i = 0; i < 130; i++) props = mergeProperties(props, { history:[`event ${i}`] }, { session:`s${i}` });
  assert.equal(props.history.length, 100);
  assert.equal(props.history[0].text, 'event 30');
});
