import { Command } from 'commander';
import { ask } from '../util/prompt.js';
import { tryOpenBrowser } from '../util/open-browser.js';
import { buildAuthUrl, exchangeAuthCode, generateState, parseAuthInput } from '../auth/oauth.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { loadProfile, saveProfile, clearProfileTokens, type WhoopProfile } from '../store/profile-store.js';
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

const resolveClientConfig = async (
  profileName: string,
  baseUrl: string,
  overrides: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scopes?: string;
  },
): Promise<WhoopProfile> => {
  const existing = await loadProfile(profileName);

  const clientId = overrides.clientId ?? process.env.WHOOP_CLIENT_ID ?? existing?.clientId;
  const clientSecret = overrides.clientSecret ?? process.env.WHOOP_CLIENT_SECRET ?? existing?.clientSecret;
  const redirectUri = overrides.redirectUri ?? process.env.WHOOP_REDIRECT_URI ?? existing?.redirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    throw configError(
      'Missing WHOOP OAuth client config. Provide --client-id --client-secret --redirect-uri (or env vars WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET/WHOOP_REDIRECT_URI).',
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
    tokens: existing?.tokens,
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
    .option('--code <code>', 'authorization code (skip prompt)')
    .option('--state <state>', 'state override')
    .option('--no-open', 'do not attempt to open browser')
    .action(async function loginAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const profile = await resolveClientConfig(globals.profile, globals.baseUrl, {
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          redirectUri: opts.redirectUri,
          scopes: opts.scopes,
        });

        const state = opts.state ?? generateState();
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
        if (opts.open !== false) {
          openAttempted = tryOpenBrowser(authUrl);
        }

        let code = opts.code as string | undefined;
        if (!code) {
          if (!globals.json) {
            console.log('Open this URL and authorize access:');
            console.log(authUrl);
            console.log(openAttempted ? '(attempted browser open)' : '(could not auto-open browser; copy URL manually)');
          }

          const input = await ask('Paste redirect URL (or authorization code): ');
          const parsed = parseAuthInput(input);
          code = parsed.code;
          if (parsed.state && parsed.state !== state) {
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

        profile.tokens = tokenFromOAuth(tokenPayload, profile.tokens?.refreshToken);
        await saveProfile(globals.profile, profile);

        printData(this, {
          profile: globals.profile,
          authenticated: true,
          scopes: profile.scopes,
          expiresAt: profile.tokens.expiresAt,
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
