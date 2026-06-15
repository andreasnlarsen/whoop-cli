import { Command } from 'commander';
import { ask, askHidden, canPrompt } from '../util/prompt.js';
import { tryOpenBrowser } from '../util/open-browser.js';
import { buildAuthUrl, exchangeAuthCode, generateState, parseAuthInput } from '../auth/oauth.js';
import { getGlobalOptions, printData, printError } from './context.js';
import {
  loadProfile,
  loadProfileClientSecret,
  loadProfileMetadata,
  saveProfile,
  clearProfileTokens,
  assertProfileSecretStorageSupported,
  preflightProfileSecretStorage,
  type WhoopProfile,
} from '../store/profile-store.js';
import { tokenFromOAuth, refreshProfileToken } from '../auth/token-service.js';
import { configError, usageError } from '../http/errors.js';

const DEFAULT_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:workout',
  'read:sleep',
  'read:profile',
  'read:body_measurement',
  'offline',
];

const splitScopes = (raw?: string): string[] =>
  raw
    ? raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_SCOPES;

export const resolveLoginState = (providedState: string | undefined, hasCodeInput: boolean): string => {
  if (hasCodeInput && !providedState) {
    throw usageError('--state is required with --code so OAuth state can be verified.');
  }

  return providedState ?? generateState();
};

const resolveClientConfig = async (
  profileName: string,
  baseUrl: string,
  overrides: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scopes?: string;
  },
  interactive: boolean,
): Promise<WhoopProfile> => {
  const existing = await loadProfileMetadata(profileName);

  let clientId = overrides.clientId ?? process.env.WHOOP_CLIENT_ID ?? existing?.clientId;
  let clientSecret = overrides.clientSecret ?? process.env.WHOOP_CLIENT_SECRET;
  let redirectUri = overrides.redirectUri ?? process.env.WHOOP_REDIRECT_URI ?? existing?.redirectUri;
  if (!clientSecret && existing) {
    clientSecret = await loadProfileClientSecret(profileName);
  }

  if (interactive && canPrompt()) {
    clientId = clientId || (await ask('WHOOP client ID: ')).trim();
    clientSecret = clientSecret || (await askHidden('WHOOP client secret: ')).trim();
    redirectUri = redirectUri || (await ask('WHOOP redirect URI: ')).trim();
  }

  if (!clientId || !clientSecret || !redirectUri) {
    throw configError(
      'Missing WHOOP OAuth client config. Run whoop auth login in an interactive terminal, or provide --client-id --client-secret --redirect-uri for one-time setup.',
    );
  }

  return {
    profileName,
    clientId,
    clientSecret,
    redirectUri,
    baseUrl,
    scopes: splitScopes(overrides.scopes ?? existing?.scopes?.join(' ')),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Run OAuth login flow and store tokens')
    .option('--client-id <id>')
    .option('--client-secret <secret>')
    .option('--redirect-uri <url>')
    .option('--scopes <scopes>', 'space/comma separated scopes')
    .option('--code <url>', 'full redirect URL (requires --state; skip prompt)')
    .option('--state <state>', 'expected OAuth state; required with --code')
    .option('--no-open', 'do not attempt to open browser')
    .action(async function loginAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        assertProfileSecretStorageSupported();
        await preflightProfileSecretStorage(globals.profile);
        const profile = await resolveClientConfig(globals.profile, globals.baseUrl, {
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          redirectUri: opts.redirectUri,
          scopes: opts.scopes,
        }, !globals.json);

        const state = resolveLoginState(opts.state, Boolean(opts.code));
        const authUrl = buildAuthUrl(
          {
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            redirectUri: profile.redirectUri,
            baseUrl: profile.baseUrl,
          },
          profile.scopes,
          state,
        );

        let openAttempted = false;
        if (!opts.code && opts.open !== false) {
          openAttempted = await tryOpenBrowser(authUrl);
        }

        let code: string | undefined;
        if (opts.code) {
          const parsed = parseAuthInput(String(opts.code));
          code = parsed.code;
          if (parsed.state !== state) {
            throw usageError('OAuth state mismatch. Retry login flow for security.', {
              expected: state,
              received: parsed.state,
            });
          }
        } else {
          if (!globals.json) {
            console.log('Open this URL and authorize access:');
            console.log(authUrl);
            console.log(openAttempted ? '(attempted browser open)' : '(could not auto-open browser; copy URL manually)');
          }

          const input = await ask('Paste redirect URL: ');
          const parsed = parseAuthInput(input);
          code = parsed.code;
          if (parsed.state !== state) {
            throw usageError('OAuth state mismatch. Retry login flow for security.', {
              expected: state,
              received: parsed.state,
            });
          }
        }

        const tokenPayload = await exchangeAuthCode(
          {
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            redirectUri: profile.redirectUri,
            baseUrl: profile.baseUrl,
          },
          code,
        );

        const previousProfile = tokenPayload.refresh_token
          ? undefined
          : await loadProfile(globals.profile);
        profile.tokens = tokenFromOAuth(tokenPayload, previousProfile?.tokens?.refreshToken);
        await saveProfile(globals.profile, profile);

        printData(this, {
          profile: globals.profile,
          authenticated: true,
          scopes: profile.scopes,
          expiresAt: profile.tokens.expiresAt,
          secretStorage: 'macos-keychain',
        });
      } catch (err) {
        printError(this, err);
      }
    });

  auth
    .command('status')
    .description('Show current auth/token status')
    .action(async function statusAction() {
      try {
        const globals = getGlobalOptions(this);
        const profile = await loadProfile(globals.profile);
        if (!profile?.tokens) {
          printData(this, {
            profile: globals.profile,
            authenticated: false,
            configured: Boolean(profile?.clientId && profile.clientSecret && profile.redirectUri),
            secretStorage: 'macos-keychain',
          });
          return;
        }

        const expiresAt = new Date(profile.tokens.expiresAt).getTime();
        const remainingSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

        printData(this, {
          profile: globals.profile,
          authenticated: true,
          baseUrl: profile.baseUrl,
          scopes: profile.scopes,
          tokenType: profile.tokens.tokenType,
          expiresAt: profile.tokens.expiresAt,
          expiresInSeconds: remainingSeconds,
          hasRefreshToken: Boolean(profile.tokens.refreshToken),
          secretStorage: 'macos-keychain',
        });
      } catch (err) {
        printError(this, err);
      }
    });

  auth
    .command('refresh')
    .description('Refresh access token using stored refresh token')
    .action(async function refreshAction() {
      try {
        const globals = getGlobalOptions(this);
        const profile = await refreshProfileToken(globals.profile);
        printData(this, {
          profile: globals.profile,
          refreshed: true,
          expiresAt: profile.tokens?.expiresAt,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  auth
    .command('logout')
    .description('Clear stored tokens for profile')
    .action(async function logoutAction() {
      try {
        const globals = getGlobalOptions(this);
        await clearProfileTokens(globals.profile);
        printData(this, {
          profile: globals.profile,
          loggedOut: true,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
