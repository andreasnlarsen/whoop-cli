import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFreshToken, refreshProfileToken } from '../src/auth/token-service.js';
import { WhoopApiClient } from '../src/http/client.js';
import {
  loadProfile,
  resetProfileSecretStoreForTesting,
  saveProfile,
  setProfileSecretStoreForTesting,
  type WhoopProfile,
} from '../src/store/profile-store.js';
import type { ProfileSecretName, ProfileSecretStore } from '../src/store/profile-secret-store.js';

class MemoryProfileSecretStore implements ProfileSecretStore {
  readonly kind = 'macos-keychain';
  readonly values = new Map<string, string>();

  async preflightWrite(): Promise<void> {}

  async get(profileName: string, name: ProfileSecretName): Promise<string | undefined> {
    return this.values.get(`${profileName}:${name}`);
  }

  async set(profileName: string, name: ProfileSecretName, value: string): Promise<void> {
    this.values.set(`${profileName}:${name}`, value);
  }

  async delete(profileName: string, name: ProfileSecretName): Promise<void> {
    this.values.delete(`${profileName}:${name}`);
  }
}

const profile = (expiresAt: string): WhoopProfile => ({
  profileName: 'default',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://localhost:1234/callback',
  baseUrl: 'https://api.prod.whoop.com',
  scopes: ['offline', 'read:recovery'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secretStorage: 'macos-keychain',
  tokens: {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    tokenType: 'bearer',
    scope: 'offline read:recovery',
    expiresAt,
  },
});

const withAuthTestState = async (fn: () => Promise<void>): Promise<void> => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;
  const home = await mkdtemp(join(tmpdir(), 'whoop-cli-token-service-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  setProfileSecretStoreForTesting(new MemoryProfileSecretStore());

  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    resetProfileSecretStoreForTesting();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await rm(home, { recursive: true, force: true });
  }
};

const tokenResponse = (): Response =>
  new Response(JSON.stringify({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    scope: 'offline read:recovery',
  }), { status: 200, headers: { 'content-type': 'application/json' } });

test('parallel expired-token checks perform one rotating refresh', async () => {
  await withAuthTestState(async () => {
    await saveProfile('default', profile('2020-01-01T00:00:00.000Z'));
    let refreshRequests = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/oauth\/oauth2\/token$/);
      refreshRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return tokenResponse();
    }) as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 4 }, () => ensureFreshToken('default')),
    );

    assert.equal(refreshRequests, 1);
    assert.deepEqual(results.map((item) => item.tokens?.accessToken), [
      'new-access',
      'new-access',
      'new-access',
      'new-access',
    ]);
    assert.equal((await loadProfile('default'))?.tokens?.refreshToken, 'new-refresh');
  });
});

test('parallel 401 retries reuse the first refreshed token', async () => {
  await withAuthTestState(async () => {
    await saveProfile('default', profile('2030-01-01T00:00:00.000Z'));
    let refreshRequests = 0;
    let oldTokenRequests = 0;
    let newTokenRequests = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/oauth/oauth2/token')) {
        refreshRequests += 1;
        return tokenResponse();
      }

      const authorization = new Headers(init?.headers).get('authorization');
      if (authorization === 'Bearer old-access') {
        oldTokenRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }

      assert.equal(authorization, 'Bearer new-access');
      newTokenRequests += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const client = new WhoopApiClient('default');
    const results = await Promise.all([
      client.requestJson<{ ok: boolean }>({ path: '/developer/v2/recovery', timeoutMs: 1000 }),
      client.requestJson<{ ok: boolean }>({ path: '/developer/v2/cycle', timeoutMs: 1000 }),
    ]);

    assert.equal(refreshRequests, 1);
    assert.equal(oldTokenRequests, 2);
    assert.equal(newTokenRequests, 2);
    assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  });
});

test('a stale 401 reuses a newer access-only token without trying to refresh', async () => {
  await withAuthTestState(async () => {
    const newerProfile = profile('2030-01-01T00:00:00.000Z');
    newerProfile.tokens = {
      ...newerProfile.tokens!,
      accessToken: 'newer-access',
      refreshToken: undefined,
    };
    await saveProfile('default', newerProfile);

    let refreshRequests = 0;
    globalThis.fetch = (async () => {
      refreshRequests += 1;
      throw new Error('refresh should not run');
    }) as typeof fetch;

    const result = await refreshProfileToken('default', {
      failedAccessToken: 'stale-access',
    });

    assert.equal(result.tokens?.accessToken, 'newer-access');
    assert.equal(result.tokens?.refreshToken, undefined);
    assert.equal(refreshRequests, 0);
  });
});

test('an expiry waiter reuses a fresh access-only token without trying to refresh', async () => {
  await withAuthTestState(async () => {
    const newerProfile = profile('2030-01-01T00:00:00.000Z');
    newerProfile.tokens = {
      ...newerProfile.tokens!,
      accessToken: 'newer-access',
      refreshToken: undefined,
    };
    await saveProfile('default', newerProfile);

    let refreshRequests = 0;
    globalThis.fetch = (async () => {
      refreshRequests += 1;
      throw new Error('refresh should not run');
    }) as typeof fetch;

    const result = await refreshProfileToken('default', { force: false });

    assert.equal(result.tokens?.accessToken, 'newer-access');
    assert.equal(result.tokens?.refreshToken, undefined);
    assert.equal(refreshRequests, 0);
  });
});
