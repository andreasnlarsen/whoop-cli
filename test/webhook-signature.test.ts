import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhoopSignature, verifyWhoopSignature } from '../src/util/webhook-signature.js';

test('verifyWhoopSignature true on exact signature', () => {
  const timestamp = '1771460000000';
  const rawBody = '{"id":"abc","type":"sleep.updated"}';
  const secret = 'super-secret';
  const signature = buildWhoopSignature(timestamp, rawBody, secret);

  const valid = verifyWhoopSignature({
    timestamp,
    rawBody,
    clientSecret: secret,
    signature,
  });

  assert.equal(valid, true);
});

test('verifyWhoopSignature false on wrong signature', () => {
  const valid = verifyWhoopSignature({
    timestamp: '1',
    rawBody: '{}',
    clientSecret: 'x',
    signature: 'bad',
  });
  assert.equal(valid, false);
});
