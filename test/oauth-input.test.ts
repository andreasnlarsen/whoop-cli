import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthInput } from '../src/auth/oauth.js';

test('parseAuthInput accepts full redirect URLs with code and state', () => {
  assert.deepEqual(
    parseAuthInput('http://127.0.0.1:8787/callback?code=auth-code&state=oauth-state'),
    {
      code: 'auth-code',
      state: 'oauth-state',
    },
  );
});

test('parseAuthInput rejects code-only input so state can be verified', () => {
  assert.throws(
    () => parseAuthInput('auth-code-only'),
    /Paste the full redirect URL so OAuth state can be verified/,
  );
});

test('parseAuthInput requires a state parameter', () => {
  assert.throws(
    () => parseAuthInput('http://127.0.0.1:8787/callback?code=auth-code'),
    /Redirect URL did not contain state parameter/,
  );
});

test('parseAuthInput reports malformed redirect URLs as usage errors', () => {
  assert.throws(() => parseAuthInput('https://%'), /Invalid redirect URL/);
});
