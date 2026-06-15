import { normalizeBaseUrl, profilePath, sanitizeProfileName } from '../util/config.js';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import {
  keychainProfileSecretStore,
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

let profileSecretStore: ProfileSecretStore = keychainProfileSecretStore;

export const setProfileSecretStoreForTesting = (store: ProfileSecretStore): void => {
  profileSecretStore = store;
};

export const resetProfileSecretStoreForTesting = (): void => {
  profileSecretStore = keychainProfileSecretStore;
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

export const loadProfileMetadata = async (name: string): Promise<StoredWhoopProfile | null> => {
  const profileName = sanitizeProfileName(name);
  const stored = await readJsonFile<StoredWhoopProfile>(profilePath(profileName));
  if (!stored) {
    return null;
  }

  return {
    ...stored,
    profileName,
    baseUrl: normalizeBaseUrl(stored.baseUrl),
  };
};

export const loadProfile = async (name: string): Promise<WhoopProfile | null> => {
  const profileName = sanitizeProfileName(name);
  const stored = await loadProfileMetadata(profileName);
  if (!stored) {
    return null;
  }

  const clientSecret = (await profileSecretStore.get(profileName, 'clientSecret')) ?? '';
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
  if (profile.clientSecret) {
    await profileSecretStore.set(profileName, 'clientSecret', profile.clientSecret);
  }

  if (profile.tokens?.accessToken) {
    await profileSecretStore.set(profileName, 'accessToken', profile.tokens.accessToken);
    if (profile.tokens.refreshToken) {
      await profileSecretStore.set(profileName, 'refreshToken', profile.tokens.refreshToken);
    } else {
      await profileSecretStore.delete(profileName, 'refreshToken');
    }
  } else {
    await profileSecretStore.delete(profileName, 'accessToken');
    await profileSecretStore.delete(profileName, 'refreshToken');
  }

  await writeJsonFileSecure(profilePath(profileName), profileForStorage(profileName, profile));
};

export const clearProfileTokens = async (name: string): Promise<void> => {
  const profile = await loadProfile(name);
  if (!profile) return;
  delete profile.tokens;
  await saveProfile(name, profile);
};
