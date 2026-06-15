import { DEFAULT_BASE_URL, normalizeBaseUrl, profilePath, sanitizeProfileName } from '../util/config.js';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import { configError } from '../http/errors.js';
import {
  keychainProfileSecretStore,
  type ProfileSecretName,
  type ProfileSecretStore,
} from './keychain-secret-store.js';

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
  secretStorage: 'macos-keychain';
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

let profileSecretStore: ProfileSecretStore = keychainProfileSecretStore;

export const setProfileSecretStoreForTesting = (store: ProfileSecretStore): void => {
  profileSecretStore = store;
};

export const resetProfileSecretStoreForTesting = (): void => {
  profileSecretStore = keychainProfileSecretStore;
};

export const assertProfileSecretStorageSupported = (): void => {
  profileSecretStore.assertSupported?.();
};

export const preflightProfileSecretStorage = async (name: string): Promise<void> => {
  const profileName = sanitizeProfileName(name);
  await profileSecretStore.preflightWrite?.(profileName);
};

const storedTokenMetadata = (tokens: TokenSet | undefined): StoredTokenMetadata | undefined =>
  tokens
    ? {
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        expiresAt: tokens.expiresAt,
        hasRefreshToken: Boolean(tokens.refreshToken),
      }
    : undefined;

const deleteProfileTokenSecrets = async (profileName: string): Promise<void> => {
  await profileSecretStore.delete(profileName, 'accessToken');
  await profileSecretStore.delete(profileName, 'refreshToken');
};

const loadProfileTokenSecrets = async (profileName: string): Promise<{
  accessToken: string | undefined;
  refreshToken: string | undefined;
}> => ({
  accessToken: await profileSecretStore.get(profileName, 'accessToken'),
  refreshToken: await profileSecretStore.get(profileName, 'refreshToken'),
});

const restoreProfileSecret = async (
  profileName: string,
  name: ProfileSecretName,
  value: string | undefined,
): Promise<void> => {
  if (value) {
    await profileSecretStore.set(profileName, name, value);
  } else {
    await profileSecretStore.delete(profileName, name);
  }
};

const restoreProfileTokenSecrets = async (
  profileName: string,
  tokens: {
    accessToken: string | undefined;
    refreshToken: string | undefined;
  },
): Promise<void> => {
  if (tokens.accessToken) {
    await profileSecretStore.set(profileName, 'accessToken', tokens.accessToken);
  } else {
    await profileSecretStore.delete(profileName, 'accessToken');
  }

  if (tokens.refreshToken) {
    await profileSecretStore.set(profileName, 'refreshToken', tokens.refreshToken);
  } else {
    await profileSecretStore.delete(profileName, 'refreshToken');
  }
};

export const profileForStorage = (name: string, profile: WhoopProfile): StoredWhoopProfile => ({
  profileName: sanitizeProfileName(name),
  clientId: profile.clientId,
  redirectUri: profile.redirectUri,
  baseUrl: normalizeBaseUrl(profile.baseUrl),
  scopes: profile.scopes,
  createdAt: profile.createdAt,
  updatedAt: new Date().toISOString(),
  secretStorage: 'macos-keychain',
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
    secretStorage: 'macos-keychain',
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
    'Legacy WHOOP profile stored secrets in JSON. The file was scrubbed for safety; run whoop auth login again to store credentials in macOS Keychain.',
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
  return (await profileSecretStore.get(profileName, 'clientSecret')) ?? undefined;
};

export const loadProfile = async (name: string): Promise<WhoopProfile | null> => {
  const profileName = sanitizeProfileName(name);
  const stored = await loadProfileMetadata(profileName);
  if (!stored) {
    return null;
  }

  const clientSecret = (await loadProfileClientSecret(profileName)) ?? '';
  const accessToken = stored.tokens
    ? await profileSecretStore.get(profileName, 'accessToken')
    : undefined;
  const refreshToken = stored.tokens?.hasRefreshToken
    ? await profileSecretStore.get(profileName, 'refreshToken')
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
  const previousClientSecret = profile.clientSecret
    ? await loadProfileClientSecret(profileName)
    : undefined;
  const previousTokens = profile.tokens?.accessToken
    ? await loadProfileTokenSecrets(profileName)
    : undefined;
  let wroteClientSecret = false;
  let wroteTokenSecrets = false;
  try {
    if (profile.clientSecret) {
      await profileSecretStore.set(profileName, 'clientSecret', profile.clientSecret);
      wroteClientSecret = true;
    }

    if (profile.tokens?.accessToken) {
      await profileSecretStore.set(profileName, 'accessToken', profile.tokens.accessToken);
      wroteTokenSecrets = true;
      if (profile.tokens.refreshToken) {
        await profileSecretStore.set(profileName, 'refreshToken', profile.tokens.refreshToken);
      } else {
        await profileSecretStore.delete(profileName, 'refreshToken');
      }
    } else {
      await deleteProfileTokenSecrets(profileName);
    }

    await writeJsonFileSecure(profilePath(profileName), profileForStorage(profileName, profile));
  } catch (err) {
    const restorations: Array<Promise<void>> = [];
    if (wroteClientSecret) {
      restorations.push(restoreProfileSecret(profileName, 'clientSecret', previousClientSecret));
    }
    if (wroteTokenSecrets) {
      restorations.push(
        restoreProfileTokenSecrets(profileName, previousTokens ?? {
          accessToken: undefined,
          refreshToken: undefined,
        }),
      );
    }
    if (restorations.length) {
      await Promise.allSettled(restorations);
    }
    throw err;
  }
};

export const clearProfileTokens = async (name: string): Promise<void> => {
  const profileName = sanitizeProfileName(name);
  await deleteProfileTokenSecrets(profileName);

  const stored = await loadProfileMetadata(profileName);
  if (!stored) return;

  await writeJsonFileSecure(profilePath(profileName), {
    ...stored,
    tokens: undefined,
    updatedAt: new Date().toISOString(),
  });
};
