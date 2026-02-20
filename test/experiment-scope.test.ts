import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterExperimentsByProfile,
  LEGACY_EXPERIMENT_PROFILE,
  normalizeExperimentProfile,
} from '../src/util/experiment-scope.js';

test('normalizeExperimentProfile maps unscoped legacy experiments to default profile', () => {
  const normalized = normalizeExperimentProfile({ id: 'x', startDate: '2026-02-20' });
  assert.equal(normalized.profile, LEGACY_EXPERIMENT_PROFILE);
});

test('filterExperimentsByProfile returns active-profile experiments by default', () => {
  const experiments = [
    { id: 'a', profile: 'default' },
    { id: 'b', profile: 'alt' },
    { id: 'c' },
  ];

  const scoped = filterExperimentsByProfile(experiments, 'default', false);
  assert.deepEqual(
    scoped.map((item) => item.id),
    ['a', 'c'],
  );
});

test('filterExperimentsByProfile returns all experiments when allProfiles=true', () => {
  const experiments = [{ id: 'a', profile: 'default' }, { id: 'b', profile: 'alt' }, { id: 'c' }];

  const all = filterExperimentsByProfile(experiments, 'default', true);
  assert.equal(all.length, 3);
});
