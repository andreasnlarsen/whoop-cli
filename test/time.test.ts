import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIsoDate, isIsoDate, parseDateRange } from '../src/util/time.js';

test('isIsoDate accepts yyyy-mm-dd', () => {
  assert.equal(isIsoDate('2026-02-19'), true);
  assert.equal(isIsoDate('2026/02/19'), false);
});

test('assertIsoDate throws on invalid', () => {
  assert.throws(() => assertIsoDate('2026/02/19'));
  assert.throws(() => assertIsoDate('2026-02-30'));
});

test('parseDateRange passes explicit bounds', () => {
  const range = parseDateRange({ start: '2026-02-01', end: '2026-02-19' });
  assert.deepEqual(range, { start: '2026-02-01', end: '2026-02-19' });
});

test('parseDateRange with days sets start only', () => {
  const range = parseDateRange({ days: 7 });
  assert.equal(typeof range.start, 'string');
});
