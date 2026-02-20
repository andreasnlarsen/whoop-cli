import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeExperimentContext, normalizeExperimentContext } from '../src/util/experiment-context.js';

test('normalizeExperimentContext trims values and drops empty fields', () => {
  const context = normalizeExperimentContext({
    description: '  Sleep consistency test  ',
    why: '  ',
    hypothesis: 'fewer late nights improves recovery',
  });

  assert.deepEqual(context, {
    description: 'Sleep consistency test',
    hypothesis: 'fewer late nights improves recovery',
  });
});

test('normalizeExperimentContext returns undefined when all values are empty', () => {
  const context = normalizeExperimentContext({ description: '  ', protocol: undefined });
  assert.equal(context, undefined);
});

test('mergeExperimentContext overlays updated fields on existing context', () => {
  const merged = mergeExperimentContext(
    {
      description: 'Phase 1',
      why: 'Fix sleep consistency',
      protocol: 'Phone off 22:30',
    },
    {
      hypothesis: 'Consistency improves recovery',
      protocol: 'Phone off 22:30, PC off 20:00',
    },
  );

  assert.deepEqual(merged, {
    description: 'Phase 1',
    why: 'Fix sleep consistency',
    hypothesis: 'Consistency improves recovery',
    protocol: 'Phone off 22:30, PC off 20:00',
  });
});
