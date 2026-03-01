import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, sanitizeProfileName, whoopHome } from '../src/util/config.js';

test('whoopHome uses WHOOP_HOME when provided', () => {
  assert.equal(
    whoopHome({
      WHOOP_HOME: '/srv/whoop-cli',
    }),
    '/srv/whoop-cli',
  );
});

test('sanitizeProfileName accepts simple profile names', () => {
  assert.equal(sanitizeProfileName('default_1-prod'), 'default_1-prod');
});

test('sanitizeProfileName rejects path-like input', () => {
  assert.throws(() => sanitizeProfileName('../../secrets'));
});

test('normalizeBaseUrl allows WHOOP production URL', () => {
  assert.equal(normalizeBaseUrl('https://api.prod.whoop.com'), 'https://api.prod.whoop.com');
});

test('normalizeBaseUrl rejects non-WHOOP hosts', () => {
  assert.throws(() => normalizeBaseUrl('https://evil.example'));
});
