import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveExperimentStatus,
  filterExperimentsByStatus,
  getExperimentWindowDetails,
} from '../src/util/experiment-status.js';

test('deriveExperimentStatus returns planned when start is in the future', () => {
  const status = deriveExperimentStatus({ startDate: '2026-02-22' }, '2026-02-20');
  assert.equal(status, 'planned');
});

test('deriveExperimentStatus returns running while within active window', () => {
  const status = deriveExperimentStatus(
    { startDate: '2026-02-18', endDate: '2026-02-22' },
    '2026-02-20',
  );
  assert.equal(status, 'running');
});

test('deriveExperimentStatus returns completed when end is before today', () => {
  const status = deriveExperimentStatus(
    { startDate: '2026-02-10', endDate: '2026-02-18' },
    '2026-02-20',
  );
  assert.equal(status, 'completed');
});

test('filterExperimentsByStatus filters to requested status', () => {
  const all = [
    { id: 'a', startDate: '2026-02-22' },
    { id: 'b', startDate: '2026-02-18', endDate: '2026-02-22' },
    { id: 'c', startDate: '2026-02-01', endDate: '2026-02-10' },
  ];
  const filtered = filterExperimentsByStatus(all, '2026-02-20', 'running');
  assert.deepEqual(filtered.map((x) => x.id), ['b']);
});

test('filterExperimentsByStatus returns input when no filter is provided', () => {
  const all = [{ id: 'a', startDate: '2026-02-22' }, { id: 'b', startDate: '2026-02-18' }];
  const filtered = filterExperimentsByStatus(all, '2026-02-20');
  assert.equal(filtered.length, 2);
});

test('getExperimentWindowDetails exposes elapsed and remaining day counts', () => {
  const details = getExperimentWindowDetails(
    { startDate: '2026-02-18', endDate: '2026-02-22' },
    '2026-02-20',
  );
  assert.equal(details.elapsedDays, 3);
  assert.equal(details.remainingDays, 3);
  assert.equal(details.totalDays, 5);
});

