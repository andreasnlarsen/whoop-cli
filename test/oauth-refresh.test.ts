import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshAuthToken } from '../src/auth/oauth.js';

test('refreshAuthToken sends WHOOP-documented refresh payload (offline scope)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = '';

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'offline',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await refreshAuthToken(
      {
        clientId: 'client_id',
        clientSecret: 'client_secret',
        redirectUri: 'https://localhost:1234/callback',
        baseUrl: 'https://api.prod.whoop.com',
      },
      'refresh_token_value',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const params = new URLSearchParams(capturedBody);
  assert.equal(params.get('grant_type'), 'refresh_token');
  assert.equal(params.get('refresh_token'), 'refresh_token_value');
  assert.equal(params.get('client_id'), 'client_id');
  assert.equal(params.get('client_secret'), 'client_secret');
  assert.equal(params.get('scope'), 'offline');
});
