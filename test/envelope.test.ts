import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail, stringifyEnvelope } from '../src/output/envelope.js';

test('ok envelope shape', () => {
  const env = ok({ a: 1 });
  assert.deepEqual(env, { data: { a: 1 }, error: null });
});

test('fail envelope shape', () => {
  const env = fail('X', 'bad', { why: true });
  assert.equal(env.data, null);
  assert.equal(env.error?.code, 'X');
  assert.equal(env.error?.message, 'bad');
  assert.deepEqual(env.error?.details, { why: true });
});

test('stringifyEnvelope compact', () => {
  const txt = stringifyEnvelope(ok({ x: 2 }));
  assert.equal(txt, '{"data":{"x":2},"error":null}');
});
