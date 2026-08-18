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

test('refreshAuthToken reports rejected stored tokens as requiring login', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: 'refresh token rejected',
    }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    await assert.rejects(
      () => refreshAuthToken(
        {
          clientId: 'client_id',
          clientSecret: 'client_secret',
          redirectUri: 'https://localhost:1234/callback',
          baseUrl: 'https://api.prod.whoop.com',
        },
        'rejected_refresh_token',
      ),
      (err: unknown) => {
        assert.equal((err as Error).message, 'WHOOP rejected the stored refresh token. Run whoop auth login again.');
        assert.equal(
          (err as { details?: { reauthRequired?: boolean } }).details?.reauthRequired,
          true,
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshAuthToken does not abort a single-use token exchange', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.signal, undefined);
    return new Response(JSON.stringify({
      access_token: 'new_access',
      refresh_token: 'new_refresh',
      expires_in: 3600,
      token_type: 'bearer',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await refreshAuthToken({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      redirectUri: 'https://localhost:1234/callback',
      baseUrl: 'https://api.prod.whoop.com',
    }, 'refresh_token_value');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
