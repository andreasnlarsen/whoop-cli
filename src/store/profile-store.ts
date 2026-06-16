import { DEFAULT_BASE_URL, normalizeBaseUrl, profilePath, sanitizeProfileName } from '../util/config.js';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import { configError } from '../http/errors.js';
import {
  keychainProfileSecretStore,
} from './keychain-secret-store.js';
import {
  resolveStoredProfileSecretStore,
  resolveSupportedStoredProfileSecretStore,
} from './profile-secret-store-selector.js';
import type {
  ProfileSecretName,
  ProfileSecretStore,
  SecretStorageKind,
  StoredSecretStorageConfig,
} from './profile-secret-store.js';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: string; // ISO
}

export interface WhoopProfile {
  profileName: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  secretStorage: SecretStorageKind;
  secretStorageConfig?: StoredSecretStorageConfig;
  tokens?: TokenSet;
}

export interface StoredTokenMetadata {
  tokenType: string;
  scope?: string;
  expiresAt: string;
  hasRefreshToken: boolean;
}

export interface StoredWhoopProfile {
  profileName: string;
  clientId: string;
  redirectUri: string;
  baseUrl: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  secretStorage: SecretStorageKind;
  secretStorageConfig?: StoredSecretStorageConfig;
  tokens?: StoredTokenMetadata;
}

interface MaybeLegacyStoredTokenMetadata extends Partial<StoredTokenMetadata> {
  accessToken?: string;
  refreshToken?: string;
}

interface MaybeLegacyStoredWhoopProfile extends Omit<Partial<StoredWhoopProfile>, 'tokens'> {
  clientSecret?: string;
  tokens?: MaybeLegacyStoredTokenMetadata;
}

let profileSecretStoreForTesting: ProfileSecretStore | null = null;
let profileSecretStoresForTesting: Partial<Record<SecretStorageKind, ProfileSecretStore>> | null = null;

export const setProfileSecretStoreForTesting = (store: ProfileSecretStore): void => {
  profileSecretStoreForTesting = store;
  profileSecretStoresForTesting = null;
};

export const setProfileSecretStoresForTesting = (
  stores: Partial<Record<SecretStorageKind, ProfileSecretStore>>,
): void => {
  profileSecretStoresForTesting = stores;
  profileSecretStoreForTesting = null;
};

export const resetProfileSecretStoreForTesting = (): void => {
  profileSecretStoreForTesting = null;
  profileSecretStoresForTesting = null;
};

export const assertProfileSecretStorageSupported = (): void => {
  (profileSecretStoreForTesting ?? keychainProfileSecretStore).assertSupported?.();
};

export const preflightProfileSecretStorage = async (
  name: string,
  store: ProfileSecretStore = profileSecretStoreForTesting ?? keychainProfileSecretStore,
): Promise<void> => {
  const profileName = sanitizeProfileName(name);
  await store.preflightWrite?.(profileName);
};

const storeForStoredProfile = (stored: StoredWhoopProfile): ProfileSecretStore =>
  profileSecretStoresForTesting?.[stored.secretStorage]
  ?? profileSecretStoreForTesting
  ?? resolveStoredProfileSecretStore(stored).store;

const storeForProfile = (profile: WhoopProfile): ProfileSecretStore =>
  profileSecretStoresForTesting?.[profile.secretStorage]
  ?? profileSecretStoreForTesting
  ?? resolveStoredProfileSecretStore({
    secretStorage: profile.secretStorage,
    secretStorageConfig: profile.secretStorageConfig,
  }).store;

const storeForPreviousProfileCleanup = (stored: StoredWhoopProfile): ProfileSecretStore | null => {
  const testingStore = profileSecretStoresForTesting?.[stored.secretStorage] ?? profileSecretStoreForTesting;
  if (testingStore) {
    return testingStore;
  }

  return resolveSupportedStoredProfileSecretStore(stored)?.store ?? null;
};

const defaultStoreForMissingMetadata = (): ProfileSecretStore | null =>
  profileSecretStoreForTesting
  ?? (process.platform === 'darwin' ? keychainProfileSecretStore : null);

const storedTokenMetadata = (tokens: TokenSet | undefined): StoredTokenMetadata | undefined =>
  tokens
    ? {
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        expiresAt: tokens.expiresAt,
        hasRefreshToken: Boolean(tokens.refreshToken),
      }
    : undefined;

const deleteProfileTokenSecrets = async (
  store: ProfileSecretStore,
  profileName: string,
): Promise<void> => {
  await store.delete(profileName, 'accessToken');
  await store.delete(profileName, 'refreshToken');
};

const deleteProfileSecrets = async (
  store: ProfileSecretStore,
  profileName: string,
): Promise<void> => {
  await store.delete(profileName, 'clientSecret');
  await deleteProfileTokenSecrets(store, profileName);
};

const loadProfileTokenSecrets = async (store: ProfileSecretStore, profileName: string): Promise<{
  accessToken: string | undefined;
  refreshToken: string | undefined;
}> => ({
  accessToken: await store.get(profileName, 'accessToken'),
  refreshToken: await store.get(profileName, 'refreshToken'),
});

const loadProfileSecrets = async (store: ProfileSecretStore, profileName: string): Promise<{
  clientSecret: string | undefined;
  accessToken: string | undefined;
  refreshToken: string | undefined;
}> => ({
  clientSecret: await store.get(profileName, 'clientSecret'),
  ...(await loadProfileTokenSecrets(store, profileName)),
});

const restoreProfileSecret = async (
  store: ProfileSecretStore,
  profileName: string,
  name: ProfileSecretName,
  value: string | undefined,
): Promise<void> => {
  if (value) {
    await store.set(profileName, name, value);
  } else {
    await store.delete(profileName, name);
  }
};

const restoreProfileTokenSecrets = async (
  store: ProfileSecretStore,
  profileName: string,
  tokens: {
    accessToken: string | undefined;
    refreshToken: string | undefined;
  },
): Promise<void> => {
  if (tokens.accessToken) {
    await store.set(profileName, 'accessToken', tokens.accessToken);
  } else {
    await store.delete(profileName, 'accessToken');
  }

  if (tokens.refreshToken) {
    await store.set(profileName, 'refreshToken', tokens.refreshToken);
  } else {
    await store.delete(profileName, 'refreshToken');
  }
};

const sameOnePasswordConfig = (
  a: StoredSecretStorageConfig | undefined,
  b: StoredSecretStorageConfig | undefined,
): boolean =>
  a?.onePassword?.vault === b?.onePassword?.vault
  && a?.onePassword?.item === b?.onePassword?.item;

const sameSecretStorageTarget = (
  stored: StoredWhoopProfile | null,
  profile: WhoopProfile,
): boolean =>
  Boolean(stored)
  && stored?.secretStorage === profile.secretStorage
  && sameOnePasswordConfig(stored.secretStorageConfig, profile.secretStorageConfig);

const shouldSkipPreviousStoreCleanup = (
  stored: StoredWhoopProfile | null,
  profile: WhoopProfile,
): boolean =>
  // Different `op` selectors can point at the same 1Password item. Without a
  // resolved item ID, deleting the old selector can delete newly written fields.
  Boolean(stored)
  && stored?.secretStorage === 'onepassword'
  && profile.secretStorage === 'onepassword';

export const profileForStorage = (name: string, profile: WhoopProfile): StoredWhoopProfile => ({
  profileName: sanitizeProfileName(name),
  clientId: profile.clientId,
  redirectUri: profile.redirectUri,
  baseUrl: normalizeBaseUrl(profile.baseUrl),
  scopes: profile.scopes,
  createdAt: profile.createdAt,
  updatedAt: new Date().toISOString(),
  secretStorage: profile.secretStorage,
  secretStorageConfig: profile.secretStorageConfig,
  tokens: storedTokenMetadata(profile.tokens),
});

const hasSecretValue = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0;

const hasLegacyJsonSecrets = (stored: MaybeLegacyStoredWhoopProfile): boolean =>
  hasSecretValue(stored.clientSecret)
  || hasSecretValue(stored.tokens?.accessToken)
  || hasSecretValue(stored.tokens?.refreshToken);

const normalizedStoredTokenMetadata = (
  tokens: MaybeLegacyStoredTokenMetadata | undefined,
): StoredTokenMetadata | undefined => {
  if (!tokens?.tokenType || !tokens.expiresAt || typeof tokens.hasRefreshToken !== 'boolean') {
    return undefined;
  }

  return {
    tokenType: tokens.tokenType,
    scope: tokens.scope,
    expiresAt: tokens.expiresAt,
    hasRefreshToken: tokens.hasRefreshToken,
  };
};

const normalizeSecretStorage = (value: unknown): SecretStorageKind => {
  if (value === undefined) {
    return 'macos-keychain';
  }

  if (value === 'macos-keychain' || value === 'onepassword' || value === 'local-vps') {
    return value;
  }

  throw configError('WHOOP profile references unsupported secret storage. Run whoop auth login again.', {
    secretStorage: value,
  });
};

const normalizeSecretStorageConfig = (
  value: unknown,
): StoredSecretStorageConfig | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as StoredSecretStorageConfig;
  if (
    candidate.onePassword
    && typeof candidate.onePassword.vault === 'string'
    && typeof candidate.onePassword.item === 'string'
  ) {
    return {
      onePassword: {
        vault: candidate.onePassword.vault,
        item: candidate.onePassword.item,
      },
    };
  }

  return undefined;
};

const normalizeStoredProfile = (
  profileName: string,
  stored: MaybeLegacyStoredWhoopProfile,
): StoredWhoopProfile => {
  if (
    !stored.clientId
    || !stored.redirectUri
    || !stored.baseUrl
    || !Array.isArray(stored.scopes)
    || !stored.createdAt
    || !stored.updatedAt
  ) {
    throw configError('WHOOP profile metadata is incomplete. Run whoop auth login again.', {
      profile: profileName,
    });
  }

  return {
    profileName,
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    baseUrl: normalizeBaseUrl(stored.baseUrl),
    scopes: stored.scopes,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    secretStorage: normalizeSecretStorage(stored.secretStorage),
    secretStorageConfig: normalizeSecretStorageConfig(stored.secretStorageConfig),
    tokens: normalizedStoredTokenMetadata(stored.tokens),
  };
};

const scrubLegacyJsonSecrets = async (
  profileName: string,
  stored: MaybeLegacyStoredWhoopProfile,
): Promise<never> => {
  const now = new Date().toISOString();
  await writeJsonFileSecure(profilePath(profileName), {
    profileName,
    clientId: typeof stored.clientId === 'string' ? stored.clientId : '',
    redirectUri: typeof stored.redirectUri === 'string' ? stored.redirectUri : '',
    baseUrl: DEFAULT_BASE_URL,
    scopes: Array.isArray(stored.scopes)
      ? stored.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : now,
    updatedAt: now,
    secretStorage: 'macos-keychain',
  });

  throw configError(
    'Legacy WHOOP profile stored secrets in JSON. The file was scrubbed for safety; run whoop auth login again with your desired secret storage.',
    {
      profile: profileName,
      profilePath: profilePath(profileName),
      secretStorage: 'macos-keychain',
    },
  );
};

export const loadProfileMetadata = async (name: string): Promise<StoredWhoopProfile | null> => {
  const profileName = sanitizeProfileName(name);
  const stored = await readJsonFile<MaybeLegacyStoredWhoopProfile>(profilePath(profileName));
  if (!stored) {
    return null;
  }

  if (hasLegacyJsonSecrets(stored)) {
    return scrubLegacyJsonSecrets(profileName, stored);
  }

  return normalizeStoredProfile(profileName, stored);
};

export const loadProfileClientSecret = async (name: string): Promise<string | undefined> => {
  const profileName = sanitizeProfileName(name);
  const stored = await loadProfileMetadata(profileName);
  if (!stored) {
    return undefined;
  }

  const store = storeForStoredProfile(stored);
  return (await store.get(profileName, 'clientSecret')) ?? undefined;
};

export const loadProfile = async (name: string): Promise<WhoopProfile | null> => {
  const profileName = sanitizeProfileName(name);
  const stored = await loadProfileMetadata(profileName);
  if (!stored) {
    return null;
  }

  const store = storeForStoredProfile(stored);
  const clientSecret = (await store.get(profileName, 'clientSecret')) ?? '';
  const accessToken = stored.tokens
    ? await store.get(profileName, 'accessToken')
    : undefined;
  const refreshToken = stored.tokens?.hasRefreshToken
    ? await store.get(profileName, 'refreshToken')
    : undefined;

  return {
    profileName,
    clientId: stored.clientId,
    clientSecret,
    redirectUri: stored.redirectUri,
    baseUrl: normalizeBaseUrl(stored.baseUrl),
    scopes: stored.scopes,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    secretStorage: stored.secretStorage,
    secretStorageConfig: stored.secretStorageConfig,
    tokens: stored.tokens && accessToken
      ? {
          accessToken,
          refreshToken,
          tokenType: stored.tokens.tokenType,
          scope: stored.tokens.scope,
          expiresAt: stored.tokens.expiresAt,
        }
      : undefined,
  };
};

export const saveProfile = async (name: string, profile: WhoopProfile): Promise<void> => {
  const profileName = sanitizeProfileName(name);
  const store = storeForProfile(profile);
  const previousStored = await loadProfileMetadata(profileName);
  const previousStore = sameSecretStorageTarget(previousStored, profile) || shouldSkipPreviousStoreCleanup(previousStored, profile)
    ? null
    : previousStored
      ? storeForPreviousProfileCleanup(previousStored)
      : null;
  const previousTargetSecrets = await loadProfileSecrets(store, profileName);
  let wroteClientSecret = false;
  let wroteTokenSecrets = false;
  try {
    if (profile.clientSecret) {
      await store.set(profileName, 'clientSecret', profile.clientSecret);
      wroteClientSecret = true;
    }

    if (profile.tokens?.accessToken) {
      await store.set(profileName, 'accessToken', profile.tokens.accessToken);
      wroteTokenSecrets = true;
      if (profile.tokens.refreshToken) {
        await store.set(profileName, 'refreshToken', profile.tokens.refreshToken);
      } else {
        await store.delete(profileName, 'refreshToken');
      }
    } else {
      await deleteProfileTokenSecrets(store, profileName);
      wroteTokenSecrets = true;
    }

    await writeJsonFileSecure(profilePath(profileName), profileForStorage(profileName, profile));
  } catch (err) {
    const restorations: Array<Promise<void>> = [];
    if (wroteClientSecret) {
      restorations.push(restoreProfileSecret(store, profileName, 'clientSecret', previousTargetSecrets.clientSecret));
    }
    if (wroteTokenSecrets) {
      restorations.push(restoreProfileTokenSecrets(store, profileName, previousTargetSecrets));
    }
    if (restorations.length) {
      await Promise.allSettled(restorations);
    }
    throw err;
  }

  if (previousStore) {
    await deleteProfileSecrets(previousStore, profileName);
  }
};

export const clearProfileTokens = async (name: string): Promise<void> => {
  const profileName = sanitizeProfileName(name);
  const stored = await loadProfileMetadata(profileName);
  const store = stored
    ? storeForStoredProfile(stored)
    : defaultStoreForMissingMetadata();
  if (!store) return;

  await deleteProfileTokenSecrets(store, profileName);

  if (!stored) return;

  await writeJsonFileSecure(profilePath(profileName), {
    ...stored,
    tokens: undefined,
    updatedAt: new Date().toISOString(),
  });
};
