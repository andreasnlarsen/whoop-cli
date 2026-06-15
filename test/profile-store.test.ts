import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearProfileTokens,
  loadProfile,
  loadProfileMetadata,
  saveProfile,
  setProfileSecretStoreForTesting,
  resetProfileSecretStoreForTesting,
  type TokenSet,
  type WhoopProfile,
} from '../src/store/profile-store.js';
import type { ProfileSecretName, ProfileSecretStore } from '../src/store/keychain-secret-store.js';

class MemoryProfileSecretStore implements ProfileSecretStore {
  readonly values = new Map<string, string>();

  async get(profileName: string, name: ProfileSecretName): Promise<string | undefined> {
    return this.values.get(this.key(profileName, name));
  }

  async set(profileName: string, name: ProfileSecretName, value: string): Promise<void> {
    this.values.set(this.key(profileName, name), value);
  }

  async delete(profileName: string, name: ProfileSecretName): Promise<void> {
    this.values.delete(this.key(profileName, name));
  }

  key(profileName: string, name: ProfileSecretName): string {
    return `${profileName}:${name}`;
  }
}

class ThrowingProfileSecretStore implements ProfileSecretStore {
  async get(): Promise<string | undefined> {
    throw new Error('secret store should not be read');
  }

  async set(): Promise<void> {
    throw new Error('secret store should not be written');
  }

  async delete(): Promise<void> {
    throw new Error('secret store should not be changed');
  }
}

const sampleToken = (): TokenSet => ({
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  tokenType: 'bearer',
  scope: 'offline read:recovery',
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const sampleProfile = (): WhoopProfile => ({
  profileName: 'default',
  clientId: 'client-id-value',
  clientSecret: 'client-secret-value',
  redirectUri: 'http://127.0.0.1:8787/callback',
  baseUrl: 'https://api.prod.whoop.com',
  scopes: ['offline', 'read:recovery'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tokens: sampleToken(),
});

const withTempHome = async (fn: (home: string) => Promise<void>): Promise<void> => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'whoop-cli-profile-store-'));
  process.env.HOME = home;

  try {
    await fn(home);
  } finally {
    resetProfileSecretStoreForTesting();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
  }
};

test('saveProfile writes metadata to disk and secrets to the secret store', async () => {
  await withTempHome(async (home) => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await saveProfile('agent_default', sampleProfile());

    const raw = await readFile(
      join(home, '.whoop-cli', 'profiles', 'agent_default.json'),
      'utf8',
    );
    const stored = JSON.parse(raw) as {
      clientSecret?: string;
      secretStorage?: string;
      tokens?: {
        accessToken?: string;
        refreshToken?: string;
        tokenType?: string;
        hasRefreshToken?: boolean;
      };
    };

    assert.equal(raw.includes('client-secret-value'), false);
    assert.equal(raw.includes('access-token-value'), false);
    assert.equal(raw.includes('refresh-token-value'), false);
    assert.equal(stored.clientSecret, undefined);
    assert.equal(stored.tokens?.accessToken, undefined);
    assert.equal(stored.tokens?.refreshToken, undefined);
    assert.equal(stored.secretStorage, 'macos-keychain');
    assert.equal(stored.tokens?.tokenType, 'bearer');
    assert.equal(stored.tokens?.hasRefreshToken, true);
    assert.equal(await secrets.get('agent_default', 'clientSecret'), 'client-secret-value');
    assert.equal(await secrets.get('agent_default', 'accessToken'), 'access-token-value');
    assert.equal(await secrets.get('agent_default', 'refreshToken'), 'refresh-token-value');
  });
});

test('loadProfile hydrates secrets from the secret store', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);
    const profile = sampleProfile();

    await saveProfile('default', profile);
    const loaded = await loadProfile('default');

    assert.equal(loaded?.clientSecret, 'client-secret-value');
    assert.deepEqual(loaded?.tokens, profile.tokens);
  });
});

test('loadProfileMetadata reads stored profile config without secret store access', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await saveProfile('default', sampleProfile());
    setProfileSecretStoreForTesting(new ThrowingProfileSecretStore());

    const metadata = await loadProfileMetadata('default');

    assert.equal(metadata?.clientId, 'client-id-value');
    assert.equal(metadata?.redirectUri, 'http://127.0.0.1:8787/callback');
    assert.equal(metadata?.baseUrl, 'https://api.prod.whoop.com');
    assert.deepEqual(metadata?.scopes, ['offline', 'read:recovery']);
    assert.equal(metadata?.tokens?.hasRefreshToken, true);
    assert.equal('clientSecret' in (metadata ?? {}), false);
  });
});

test('clearProfileTokens deletes tokens but preserves the client secret', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await saveProfile('default', sampleProfile());
    await clearProfileTokens('default');

    assert.equal(await secrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await secrets.get('default', 'accessToken'), undefined);
    assert.equal(await secrets.get('default', 'refreshToken'), undefined);

    const loaded = await loadProfile('default');
    assert.equal(loaded?.clientSecret, 'client-secret-value');
    assert.equal(loaded?.tokens, undefined);
  });
});
