import { randomBytes } from 'node:crypto';
import { authError, networkError, usageError, WhoopCliError } from '../http/errors.js';

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export const generateState = (): string => randomBytes(16).toString('hex').slice(0, 16);

export const buildAuthUrl = (
  config: OAuthClientConfig,
  scopes: string[],
  state: string,
): string => {
  const url = new URL('/oauth/oauth2/auth', config.baseUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
};

const tokenEndpoint = (baseUrl: string): string => new URL('/oauth/oauth2/token', baseUrl).toString();

const exchange = async (
  config: OAuthClientConfig,
  payload: Record<string, string>,
): Promise<OAuthTokenResponse> => {
  const body = new URLSearchParams(payload);

  let res: Response;
  let raw: string;
  try {
    // Authorization codes and refresh tokens are single-use credentials. The
    // server can consume one after the POST is sent but before the response is
    // received. Aborting here could discard the only usable token response.
    res = await fetch(tokenEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    raw = await res.text();
  } catch (err) {
    throw networkError('Failed to reach WHOOP token endpoint', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // keep raw
  }

  if (!res.ok) {
    throw authError('WHOOP token exchange failed', {
      status: res.status,
      response: parsed,
    });
  }

  const token = parsed as Partial<OAuthTokenResponse>;
  if (!token.access_token || !token.expires_in || !token.token_type) {
    throw authError('WHOOP token response missing required fields', { response: parsed });
  }

  return token as OAuthTokenResponse;
};

export const exchangeAuthCode = async (
  config: OAuthClientConfig,
  code: string,
): Promise<OAuthTokenResponse> => {
  if (!code) throw usageError('Authorization code is required');
  return exchange(config, {
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
};

export const refreshAuthToken = async (
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<OAuthTokenResponse> => {
  if (!refreshToken) throw usageError('Refresh token is required');

  // WHOOP docs (OAuth refresh flow) require scope=offline in refresh requests.
  // Using token-issued scope strings here can produce malformed refresh requests.
  try {
    return await exchange(config, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'offline',
    });
  } catch (err) {
    if (err instanceof WhoopCliError && err.code === 'AUTH_ERROR') {
      const details = err.details as {
        status?: number;
        response?: { error?: string; error_description?: string };
      } | undefined;
      const providerCode = details?.response?.error;
      if (providerCode === 'invalid_grant' || providerCode === 'invalid_request') {
        throw authError('WHOOP rejected the stored refresh token. Run whoop auth login again.', {
          ...details,
          reauthRequired: true,
        });
      }
    }

    throw err;
  }
};

export interface ParsedAuthInput {
  code: string;
  state: string;
}

export const parseAuthInput = (input: string): ParsedAuthInput => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw usageError('Empty authorization input');
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw usageError('Paste the full redirect URL so OAuth state can be verified.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw usageError('Invalid redirect URL.');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) {
    throw usageError('Redirect URL did not contain code parameter');
  }

  if (!state) {
    throw usageError('Redirect URL did not contain state parameter');
  }

  return { code, state };
};
