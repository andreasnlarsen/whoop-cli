import { profilePath } from '../util/config.js';
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

export const loadProfile = async (name: string): Promise<WhoopProfile | null> => {
  return readJsonFile<WhoopProfile>(profilePath(name));
};

export const saveProfile = async (name: string, profile: WhoopProfile): Promise<void> => {
  await writeJsonFileSecure(profilePath(name), {
    ...profile,
    profileName: name,
    updatedAt: new Date().toISOString(),
  });
};

export const clearProfileTokens = async (name: string): Promise<void> => {
  const profile = await loadProfile(name);
  if (!profile) return;
  delete profile.tokens;
  await saveProfile(name, profile);
};
