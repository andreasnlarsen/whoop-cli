import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, sanitizeProfileName } from '../src/util/config.js';

test('sanitizeProfileName allows simple profile names only', () => {
  assert.equal(sanitizeProfileName(' default_1-2 '), 'default_1-2');
  assert.throws(() => sanitizeProfileName('../default'), /Profile names may only contain/);
  assert.throws(() => sanitizeProfileName(''), /Profile names may only contain/);
});

test('normalizeBaseUrl pins the WHOOP production API host', () => {
  assert.equal(
    normalizeBaseUrl('https://api.prod.whoop.com/v1?ignored=true'),
    'https://api.prod.whoop.com',
  );
  assert.throws(() => normalizeBaseUrl('http://api.prod.whoop.com'), /must use HTTPS/);
  assert.throws(
    () => normalizeBaseUrl('https://api.prod.whoop.com:444'),
    /must be https:\/\/api\.prod\.whoop\.com/,
  );
  assert.throws(
    () => normalizeBaseUrl('https://example.com'),
    /must be https:\/\/api\.prod\.whoop\.com/,
  );
});
