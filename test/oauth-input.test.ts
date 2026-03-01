import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthInput } from '../src/auth/oauth.js';

test('parseAuthInput accepts a full redirect URL with code and state', () => {
  const parsed = parseAuthInput('https://localhost/callback?code=abc123&state=expected');

  assert.equal(parsed.code, 'abc123');
  assert.equal(parsed.state, 'expected');
});

test('parseAuthInput rejects code-only input so state must be checked', () => {
  assert.throws(() => parseAuthInput('abc123'));
});

test('parseAuthInput rejects redirect URLs without state', () => {
  assert.throws(() => parseAuthInput('https://localhost/callback?code=abc123'));
});
