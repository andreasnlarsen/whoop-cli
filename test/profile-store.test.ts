import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertProfileSecretStorageSupported,
  clearProfileTokens,
  loadProfile,
  loadProfileClientSecret,
  loadProfileMetadata,
  preflightProfileSecretStorage,
  profileForStorage,
  saveProfile,
  setProfileSecretStoreForTesting,
  setProfileSecretStoresForTesting,
  resetProfileSecretStoreForTesting,
  type TokenSet,
  type WhoopProfile,
} from '../src/store/profile-store.js';
import type { ProfileSecretName, ProfileSecretStore, SecretStorageKind } from '../src/store/profile-secret-store.js';

class MemoryProfileSecretStore implements ProfileSecretStore {
  readonly values = new Map<string, string>();
  readonly preflightedProfiles: string[] = [];

  constructor(readonly kind: SecretStorageKind = 'macos-keychain') {}

  async preflightWrite(profileName: string): Promise<void> {
    this.preflightedProfiles.push(profileName);
  }

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

class UnsupportedProfileSecretStore extends MemoryProfileSecretStore {
  assertSupported(): void {
    throw new Error('secret storage unsupported');
  }
}

class ThrowingProfileSecretStore implements ProfileSecretStore {
  readonly kind = 'macos-keychain';

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

class DeleteThrowingProfileSecretStore extends MemoryProfileSecretStore {
  async delete(): Promise<void> {
    throw new Error('old cleanup failed');
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
  secretStorage: 'macos-keychain',
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

const withPlatform = async (
  platform: NodeJS.Platform,
  fn: () => Promise<void>,
): Promise<void> => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });

  try {
    await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, 'platform', descriptor);
    }
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

test('profileForStorage stores 1Password metadata without secret values', () => {
  const stored = profileForStorage('default', {
    ...sampleProfile(),
    secretStorage: 'onepassword',
    secretStorageConfig: {
      onePassword: {
        vault: 'Ops',
        item: 'WHOOP default',
      },
    },
  });
  const raw = JSON.stringify(stored);

  assert.equal(raw.includes('client-secret-value'), false);
  assert.equal(raw.includes('access-token-value'), false);
  assert.equal(raw.includes('refresh-token-value'), false);
  assert.equal(stored.secretStorage, 'onepassword');
  assert.deepEqual(stored.secretStorageConfig, {
    onePassword: {
      vault: 'Ops',
      item: 'WHOOP default',
    },
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

test('loadProfileClientSecret reads only the stored client secret', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await saveProfile('default', sampleProfile());
    await secrets.delete('default', 'accessToken');
    await secrets.delete('default', 'refreshToken');

    assert.equal(await loadProfileClientSecret('default'), 'client-secret-value');
  });
});

test('loadProfile scrubs legacy JSON secrets and requires a fresh login', async () => {
  await withTempHome(async (home) => {
    setProfileSecretStoreForTesting(new ThrowingProfileSecretStore());

    const profileFile = join(home, '.whoop-cli', 'profiles', 'default.json');
    await mkdir(join(home, '.whoop-cli', 'profiles'), { recursive: true });
    await writeFile(profileFile, JSON.stringify(sampleProfile()), 'utf8');

    await assert.rejects(
      () => loadProfile('default'),
      /Legacy WHOOP profile stored secrets in JSON/,
    );

    const raw = await readFile(profileFile, 'utf8');
    const scrubbed = JSON.parse(raw) as {
      clientId?: string;
      clientSecret?: string;
      secretStorage?: string;
      tokens?: unknown;
    };

    assert.equal(raw.includes('client-secret-value'), false);
    assert.equal(raw.includes('access-token-value'), false);
    assert.equal(raw.includes('refresh-token-value'), false);
    assert.equal(scrubbed.clientId, 'client-id-value');
    assert.equal(scrubbed.clientSecret, undefined);
    assert.equal(scrubbed.secretStorage, 'macos-keychain');
    assert.equal(scrubbed.tokens, undefined);
  });
});

test('loadProfile scrubs legacy JSON secrets before validating stale metadata', async () => {
  await withTempHome(async (home) => {
    setProfileSecretStoreForTesting(new ThrowingProfileSecretStore());

    const profileFile = join(home, '.whoop-cli', 'profiles', 'default.json');
    await mkdir(join(home, '.whoop-cli', 'profiles'), { recursive: true });
    await writeFile(profileFile, JSON.stringify({
      ...sampleProfile(),
      baseUrl: 'https://staging.example.test',
    }), 'utf8');

    await assert.rejects(
      () => loadProfile('default'),
      /Legacy WHOOP profile stored secrets in JSON/,
    );

    const raw = await readFile(profileFile, 'utf8');
    const scrubbed = JSON.parse(raw) as {
      baseUrl?: string;
      clientSecret?: string;
      tokens?: unknown;
    };

    assert.equal(raw.includes('client-secret-value'), false);
    assert.equal(raw.includes('access-token-value'), false);
    assert.equal(raw.includes('refresh-token-value'), false);
    assert.equal(scrubbed.baseUrl, 'https://api.prod.whoop.com');
    assert.equal(scrubbed.clientSecret, undefined);
    assert.equal(scrubbed.tokens, undefined);
  });
});

test('assertProfileSecretStorageSupported delegates to the active secret store', async () => {
  await withTempHome(async () => {
    setProfileSecretStoreForTesting(new UnsupportedProfileSecretStore());

    assert.throws(
      () => assertProfileSecretStorageSupported(),
      /secret storage unsupported/,
    );
  });
});

test('preflightProfileSecretStorage delegates to the active secret store with a sanitized profile name', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await preflightProfileSecretStorage(' default ');

    assert.deepEqual(secrets.preflightedProfiles, ['default']);
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

test('clearProfileTokens deletes deterministic token accounts without profile metadata', async () => {
  await withTempHome(async () => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);

    await secrets.set('default', 'clientSecret', 'client-secret-value');
    await secrets.set('default', 'accessToken', 'access-token-value');
    await secrets.set('default', 'refreshToken', 'refresh-token-value');

    await clearProfileTokens('default');

    assert.equal(await secrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await secrets.get('default', 'accessToken'), undefined);
    assert.equal(await secrets.get('default', 'refreshToken'), undefined);
  });
});

test('saveProfile rolls back new secrets if metadata write fails', async () => {
  await withTempHome(async (home) => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);
    await mkdir(join(home, '.whoop-cli'), { recursive: true });
    await writeFile(join(home, '.whoop-cli', 'profiles'), 'not a directory', 'utf8');

    await assert.rejects(() => saveProfile('default', sampleProfile()));

    assert.equal(await secrets.get('default', 'clientSecret'), undefined);
    assert.equal(await secrets.get('default', 'accessToken'), undefined);
    assert.equal(await secrets.get('default', 'refreshToken'), undefined);
  });
});

test('saveProfile restores previous secrets if metadata write fails', async () => {
  await withTempHome(async (home) => {
    const secrets = new MemoryProfileSecretStore();
    setProfileSecretStoreForTesting(secrets);
    await secrets.set('default', 'clientSecret', 'old-client-secret');
    await secrets.set('default', 'accessToken', 'old-access-token');
    await secrets.set('default', 'refreshToken', 'old-refresh-token');
    await mkdir(join(home, '.whoop-cli'), { recursive: true });
    await writeFile(join(home, '.whoop-cli', 'profiles'), 'not a directory', 'utf8');

    await assert.rejects(() => saveProfile('default', {
      ...sampleProfile(),
      tokens: {
        ...sampleToken(),
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    }));

    assert.equal(await secrets.get('default', 'clientSecret'), 'old-client-secret');
    assert.equal(await secrets.get('default', 'accessToken'), 'old-access-token');
    assert.equal(await secrets.get('default', 'refreshToken'), 'old-refresh-token');
  });
});

test('saveProfile removes secrets from the old backend when secret storage changes', async () => {
  await withTempHome(async () => {
    const keychainSecrets = new MemoryProfileSecretStore('macos-keychain');
    const onePasswordSecrets = new MemoryProfileSecretStore('onepassword');
    setProfileSecretStoresForTesting({
      'macos-keychain': keychainSecrets,
      onepassword: onePasswordSecrets,
    });

    await saveProfile('default', sampleProfile());
    await saveProfile('default', {
      ...sampleProfile(),
      secretStorage: 'onepassword',
      secretStorageConfig: {
        onePassword: {
          vault: 'Ops',
          item: 'WHOOP default',
        },
      },
      tokens: {
        ...sampleToken(),
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    });

    assert.equal(await keychainSecrets.get('default', 'clientSecret'), undefined);
    assert.equal(await keychainSecrets.get('default', 'accessToken'), undefined);
    assert.equal(await keychainSecrets.get('default', 'refreshToken'), undefined);
    assert.equal(await onePasswordSecrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await onePasswordSecrets.get('default', 'accessToken'), 'new-access-token');
    assert.equal(await onePasswordSecrets.get('default', 'refreshToken'), 'new-refresh-token');

    const metadata = await loadProfileMetadata('default');
    assert.equal(metadata?.secretStorage, 'onepassword');
    assert.deepEqual(metadata?.secretStorageConfig, {
      onePassword: {
        vault: 'Ops',
        item: 'WHOOP default',
      },
    });
  });
});

test('saveProfile skips cleanup when 1Password item selectors may alias', async () => {
  await withTempHome(async (home) => {
    const onePasswordSecrets = new MemoryProfileSecretStore('onepassword');
    setProfileSecretStoresForTesting({
      onepassword: onePasswordSecrets,
    });
    await mkdir(join(home, '.whoop-cli', 'profiles'), { recursive: true });
    await writeFile(join(home, '.whoop-cli', 'profiles', 'default.json'), JSON.stringify(
      profileForStorage('default', {
        ...sampleProfile(),
        secretStorage: 'onepassword',
        secretStorageConfig: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      }),
    ), 'utf8');
    await onePasswordSecrets.set('default', 'clientSecret', 'old-client-secret');
    await onePasswordSecrets.set('default', 'accessToken', 'old-access-token');
    await onePasswordSecrets.set('default', 'refreshToken', 'old-refresh-token');

    await saveProfile('default', {
      ...sampleProfile(),
      secretStorage: 'onepassword',
      secretStorageConfig: {
        onePassword: {
          vault: 'Ops',
          item: 'whoop-item-id',
        },
      },
      tokens: {
        ...sampleToken(),
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    });

    assert.equal(await onePasswordSecrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await onePasswordSecrets.get('default', 'accessToken'), 'new-access-token');
    assert.equal(await onePasswordSecrets.get('default', 'refreshToken'), 'new-refresh-token');

    const metadata = await loadProfileMetadata('default');
    assert.deepEqual(metadata?.secretStorageConfig, {
      onePassword: {
        vault: 'Ops',
        item: 'whoop-item-id',
      },
    });
  });
});

test('saveProfile can replace unsupported old backends during Linux setup', async () => {
  await withTempHome(async (home) => {
    const onePasswordSecrets = new MemoryProfileSecretStore('onepassword');
    setProfileSecretStoresForTesting({
      onepassword: onePasswordSecrets,
    });
    await mkdir(join(home, '.whoop-cli', 'profiles'), { recursive: true });
    await writeFile(join(home, '.whoop-cli', 'profiles', 'default.json'), JSON.stringify({
      ...profileForStorage('default', sampleProfile()),
      secretStorage: 'macos-keychain',
    }), 'utf8');

    await withPlatform('linux', async () => {
      await saveProfile('default', {
        ...sampleProfile(),
        secretStorage: 'onepassword',
        secretStorageConfig: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      });
    });

    assert.equal(await onePasswordSecrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await onePasswordSecrets.get('default', 'accessToken'), 'access-token-value');
    assert.equal(await onePasswordSecrets.get('default', 'refreshToken'), 'refresh-token-value');

    const metadata = await loadProfileMetadata('default');
    assert.equal(metadata?.secretStorage, 'onepassword');
  });
});

test('saveProfile commits new metadata before deleting old backend secrets', async () => {
  await withTempHome(async (home) => {
    const oldSecrets = new DeleteThrowingProfileSecretStore('macos-keychain');
    const onePasswordSecrets = new MemoryProfileSecretStore('onepassword');
    setProfileSecretStoresForTesting({
      'macos-keychain': oldSecrets,
      onepassword: onePasswordSecrets,
    });
    await mkdir(join(home, '.whoop-cli', 'profiles'), { recursive: true });
    await writeFile(join(home, '.whoop-cli', 'profiles', 'default.json'), JSON.stringify(
      profileForStorage('default', sampleProfile()),
    ), 'utf8');
    await oldSecrets.set('default', 'clientSecret', 'old-client-secret');
    await oldSecrets.set('default', 'accessToken', 'old-access-token');
    await oldSecrets.set('default', 'refreshToken', 'old-refresh-token');

    await assert.rejects(
      () => saveProfile('default', {
        ...sampleProfile(),
        secretStorage: 'onepassword',
        secretStorageConfig: {
          onePassword: {
            vault: 'Ops',
            item: 'WHOOP default',
          },
        },
      }),
      /old cleanup failed/,
    );

    const metadata = await loadProfileMetadata('default');
    assert.equal(metadata?.secretStorage, 'onepassword');
    assert.equal(await onePasswordSecrets.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await onePasswordSecrets.get('default', 'accessToken'), 'access-token-value');
    assert.equal(await onePasswordSecrets.get('default', 'refreshToken'), 'refresh-token-value');
  });
});
