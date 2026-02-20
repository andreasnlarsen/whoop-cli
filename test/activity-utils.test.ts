import test from 'node:test';
import assert from 'node:assert/strict';
import { applyActivityFilters, isGenericActivity, summarizeActivityKinds } from '../src/util/activity.js';
import type { ActivityRecord } from '../src/models/whoop.js';

const sample: ActivityRecord[] = [
  { id: 'a', sport_id: -1, sport_name: 'activity' },
  { id: 'b', sport_id: 63, sport_name: 'walking' },
  { id: 'c', sport_id: 44, sport_name: 'running' },
];

test('isGenericActivity identifies generic rows by sport_id or sport_name', () => {
  assert.equal(isGenericActivity({ id: 'x', sport_id: -1, sport_name: 'something' }), true);
  assert.equal(isGenericActivity({ id: 'y', sport_name: 'activity' }), true);
  assert.equal(isGenericActivity({ id: 'z', sport_id: 63, sport_name: 'walking' }), false);
});

test('applyActivityFilters supports labeled-only and sport filters', () => {
  const labeled = applyActivityFilters(sample, { labeledOnly: true });
  assert.deepEqual(
    labeled.map((row) => row.id),
    ['b', 'c'],
  );

  const sportIdFiltered = applyActivityFilters(sample, { sportIds: [63] });
  assert.deepEqual(
    sportIdFiltered.map((row) => row.id),
    ['b'],
  );

  const sportNameFiltered = applyActivityFilters(sample, { sportNames: ['RUNNING'] });
  assert.deepEqual(
    sportNameFiltered.map((row) => row.id),
    ['c'],
  );
});

test('summarizeActivityKinds returns total/generic/structured counts', () => {
  assert.deepEqual(summarizeActivityKinds(sample), {
    totalFetched: 3,
    genericActivityCount: 1,
    structuredActivityCount: 2,
  });
});
