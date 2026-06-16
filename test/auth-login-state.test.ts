import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLoginRefreshTokenFallback, resolveClientConfig, resolveLoginState } from '../src/commands/auth.js';
import type { ProfileSecretName, ProfileSecretStore, SecretStorageKind } from '../src/store/profile-secret-store.js';

class MemoryProfileSecretStore implements ProfileSecretStore {
  readonly values = new Map<string, string>();

  constructor(readonly kind: SecretStorageKind) {}

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

class ThrowingProfileSecretStore implements ProfileSecretStore {
  readonly kind = 'macos-keychain';

  async get(): Promise<string | undefined> {
    throw new Error('old backend unavailable');
  }

  async set(): Promise<void> {}

  async delete(): Promise<void> {}
}

const withWhoopClientEnvCleared = async (fn: () => Promise<void>): Promise<void> => {
  const keys = ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REDIRECT_URI'] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test('resolveLoginState requires explicit state when --code is provided', () => {
  assert.throws(
    () => resolveLoginState(undefined, true),
    /--state is required with --code so OAuth state can be verified/,
  );
});

test('resolveLoginState accepts explicit state for --code login', () => {
  assert.equal(resolveLoginState('known-state', true), 'known-state');
});

test('resolveLoginState generates state for interactive login', () => {
  assert.match(resolveLoginState(undefined, false), /^[0-9a-f]{16}$/);
});

test('resolveClientConfig can reuse the old stored client secret during storage migration', async () => {
  await withWhoopClientEnvCleared(async () => {
    const selectedStore = new MemoryProfileSecretStore('onepassword');
    const previousStore = new MemoryProfileSecretStore('macos-keychain');
    await previousStore.set('default', 'clientSecret', 'old-stored-secret');

    const profile = await resolveClientConfig(
      'default',
      'https://api.prod.whoop.com',
      {
        profileName: 'default',
        clientId: 'client-id-value',
        redirectUri: 'https://localhost:1234/callback',
        baseUrl: 'https://api.prod.whoop.com',
        scopes: ['offline'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        secretStorage: 'macos-keychain',
      },
      selectedStore,
      previousStore,
      {
        kind: 'onepassword',
        config: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      },
      {},
      false,
    );

    assert.equal(profile.clientSecret, 'old-stored-secret');
    assert.equal(profile.secretStorage, 'onepassword');
  });
});

test('resolveClientConfig prefers the source backend over stale target secrets during migration', async () => {
  await withWhoopClientEnvCleared(async () => {
    const selectedStore = new MemoryProfileSecretStore('onepassword');
    const previousStore = new MemoryProfileSecretStore('macos-keychain');
    await selectedStore.set('default', 'clientSecret', 'stale-target-secret');
    await previousStore.set('default', 'clientSecret', 'current-source-secret');

    const profile = await resolveClientConfig(
      'default',
      'https://api.prod.whoop.com',
      {
        profileName: 'default',
        clientId: 'client-id-value',
        redirectUri: 'https://localhost:1234/callback',
        baseUrl: 'https://api.prod.whoop.com',
        scopes: ['offline'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        secretStorage: 'macos-keychain',
      },
      selectedStore,
      previousStore,
      {
        kind: 'onepassword',
        config: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      },
      {},
      false,
    );

    assert.equal(profile.clientSecret, 'current-source-secret');
  });
});

test('resolveClientConfig treats old backend lookup failures as best-effort', async () => {
  await withWhoopClientEnvCleared(async () => {
    const selectedStore = new MemoryProfileSecretStore('onepassword');
    await selectedStore.set('default', 'clientSecret', 'stale-target-secret');

    await assert.rejects(
      () => resolveClientConfig(
        'default',
        'https://api.prod.whoop.com',
        {
          profileName: 'default',
          clientId: 'client-id-value',
          redirectUri: 'https://localhost:1234/callback',
          baseUrl: 'https://api.prod.whoop.com',
          scopes: ['offline'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          secretStorage: 'macos-keychain',
        },
        selectedStore,
        new ThrowingProfileSecretStore(),
        {
          kind: 'onepassword',
          config: {
            onePassword: {
              vault: 'Ops',
              item: 'WHOOP default',
            },
          },
        },
        {},
        false,
      ),
      /Missing WHOOP OAuth client config/,
    );
  });
});

test('loadLoginRefreshTokenFallback reuses previous store refresh token during migration', async () => {
  const selectedStore = new MemoryProfileSecretStore('onepassword');
  const previousStore = new MemoryProfileSecretStore('macos-keychain');
  await previousStore.set('default', 'refreshToken', 'old-refresh-token');

  const refreshToken = await loadLoginRefreshTokenFallback(
    'default',
    {
      profileName: 'default',
      clientId: 'client-id-value',
      redirectUri: 'https://localhost:1234/callback',
      baseUrl: 'https://api.prod.whoop.com',
      scopes: ['offline'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secretStorage: 'macos-keychain',
      tokens: {
        tokenType: 'Bearer',
        expiresAt: '2026-01-01T01:00:00.000Z',
        hasRefreshToken: true,
      },
    },
    selectedStore,
    previousStore,
    {
      kind: 'onepassword',
      config: {
        onePassword: {
          vault: 'Ops',
          item: 'WHOOP default',
        },
      },
    },
  );

  assert.equal(refreshToken, 'old-refresh-token');
});

test('loadLoginRefreshTokenFallback prefers source refresh token over stale target during migration', async () => {
  const selectedStore = new MemoryProfileSecretStore('onepassword');
  const previousStore = new MemoryProfileSecretStore('macos-keychain');
  await selectedStore.set('default', 'refreshToken', 'stale-target-refresh');
  await previousStore.set('default', 'refreshToken', 'current-source-refresh');

  const refreshToken = await loadLoginRefreshTokenFallback(
    'default',
    {
      profileName: 'default',
      clientId: 'client-id-value',
      redirectUri: 'https://localhost:1234/callback',
      baseUrl: 'https://api.prod.whoop.com',
      scopes: ['offline'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secretStorage: 'macos-keychain',
      tokens: {
        tokenType: 'Bearer',
        expiresAt: '2026-01-01T01:00:00.000Z',
        hasRefreshToken: true,
      },
    },
    selectedStore,
    previousStore,
    {
      kind: 'onepassword',
      config: {
        onePassword: {
          vault: 'Ops',
          item: 'WHOOP default',
        },
      },
    },
  );

  assert.equal(refreshToken, 'current-source-refresh');
});

test('loadLoginRefreshTokenFallback treats unavailable previous stores as best-effort', async () => {
  const refreshToken = await loadLoginRefreshTokenFallback(
    'default',
    {
      profileName: 'default',
      clientId: 'client-id-value',
      redirectUri: 'https://localhost:1234/callback',
      baseUrl: 'https://api.prod.whoop.com',
      scopes: ['offline'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secretStorage: 'macos-keychain',
      tokens: {
        tokenType: 'Bearer',
        expiresAt: '2026-01-01T01:00:00.000Z',
        hasRefreshToken: true,
      },
    },
    new MemoryProfileSecretStore('onepassword'),
    new ThrowingProfileSecretStore(),
    {
      kind: 'onepassword',
      config: {
        onePassword: {
          vault: 'Ops',
          item: 'WHOOP default',
        },
      },
    },
  );

  assert.equal(refreshToken, undefined);
});

test('loadLoginRefreshTokenFallback preserves same-store read failures', async () => {
  await assert.rejects(
    () => loadLoginRefreshTokenFallback(
      'default',
      {
        profileName: 'default',
        clientId: 'client-id-value',
        redirectUri: 'https://localhost:1234/callback',
        baseUrl: 'https://api.prod.whoop.com',
        scopes: ['offline'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        secretStorage: 'onepassword',
        secretStorageConfig: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
        tokens: {
          tokenType: 'Bearer',
          expiresAt: '2026-01-01T01:00:00.000Z',
          hasRefreshToken: true,
        },
      },
      new ThrowingProfileSecretStore(),
      undefined,
      {
        kind: 'onepassword',
        config: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      },
    ),
    /old backend unavailable/,
  );
});
