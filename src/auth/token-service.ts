import { refreshAuthToken, type OAuthClientConfig } from './oauth.js';
import { withRefreshLock } from './refresh-lock.js';
import { loadProfile, saveProfile, type TokenSet, type WhoopProfile } from '../store/profile-store.js';
import { authError, configError } from '../http/errors.js';
import { tokenRefreshSkewSeconds } from '../util/config.js';

const nowEpochSeconds = (): number => Math.floor(Date.now() / 1000);

const expiresAtToEpoch = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

export const isTokenExpired = (token: TokenSet, skewSeconds = tokenRefreshSkewSeconds): boolean => {
  const exp = expiresAtToEpoch(token.expiresAt);
  return exp - nowEpochSeconds() <= skewSeconds;
};

export const tokenFromOAuth = (
  payload: {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope?: string;
  },
  previousRefreshToken?: string,
): TokenSet => {
  const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? previousRefreshToken,
    tokenType: payload.token_type,
    scope: payload.scope,
    expiresAt,
  };
};

export const requireProfile = async (profileName: string): Promise<WhoopProfile> => {
  const profile = await loadProfile(profileName);
  if (!profile) {
    throw configError(`Profile "${profileName}" was not found. Run whoop auth login first.`);
  }

  if (!profile.clientId || !profile.clientSecret || !profile.redirectUri) {
    throw configError(`Profile "${profileName}" is missing OAuth client settings.`);
  }

  return profile;
};

const toOAuthConfig = (profile: WhoopProfile): OAuthClientConfig => ({
  clientId: profile.clientId,
  clientSecret: profile.clientSecret,
  redirectUri: profile.redirectUri,
  baseUrl: profile.baseUrl,
});

export const refreshProfileToken = async (profileName: string): Promise<WhoopProfile> =>
  withRefreshLock(profileName, async () => {
    const profile = await requireProfile(profileName);
    const refreshToken = profile.tokens?.refreshToken;
    if (!refreshToken) {
      throw authError('No refresh token available. Re-run whoop auth login with offline scope.');
    }

    const refreshed = await refreshAuthToken(toOAuthConfig(profile), refreshToken);
    profile.tokens = tokenFromOAuth(refreshed, refreshToken);
    await saveProfile(profileName, profile);
    return profile;
  });

export const ensureFreshToken = async (profileName: string): Promise<WhoopProfile> => {
  const profile = await requireProfile(profileName);
  const token = profile.tokens;
  if (!token?.accessToken) {
    throw authError('No access token found. Run whoop auth login.');
  }

  if (!isTokenExpired(token)) {
    return profile;
  }

  return refreshProfileToken(profileName);
};
