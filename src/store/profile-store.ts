import { normalizeBaseUrl, profilePath } from '../util/config.js';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';

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

export const profileWithRuntimeOverrides = (
  profile: WhoopProfile,
  env: NodeJS.ProcessEnv = process.env,
): WhoopProfile => ({
  ...profile,
  clientId: env.WHOOP_CLIENT_ID ?? profile.clientId,
  clientSecret: env.WHOOP_CLIENT_SECRET ?? profile.clientSecret,
  redirectUri: env.WHOOP_REDIRECT_URI ?? profile.redirectUri,
  baseUrl: normalizeBaseUrl(env.WHOOP_BASE_URL ?? profile.baseUrl),
});

export const profileForStorage = (name: string, profile: WhoopProfile): WhoopProfile => ({
  ...profile,
  profileName: name,
  clientSecret: '',
  baseUrl: normalizeBaseUrl(profile.baseUrl),
  updatedAt: new Date().toISOString(),
});

export const loadProfile = async (name: string): Promise<WhoopProfile | null> => {
  const profile = await readJsonFile<WhoopProfile>(profilePath(name));
  if (!profile) {
    return null;
  }

  return profileWithRuntimeOverrides(profile);
};

export const saveProfile = async (name: string, profile: WhoopProfile): Promise<void> => {
  await writeJsonFileSecure(profilePath(name), profileForStorage(name, profile));
};

export const clearProfileTokens = async (name: string): Promise<void> => {
  const profile = await loadProfile(name);
  if (!profile) return;
  delete profile.tokens;
  await saveProfile(name, profile);
};
