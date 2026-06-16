import { Command } from 'commander';
import { ask, askHidden, canPrompt } from '../util/prompt.js';
import { tryOpenBrowser } from '../util/open-browser.js';
import { buildAuthUrl, exchangeAuthCode, generateState, parseAuthInput } from '../auth/oauth.js';
import { getGlobalOptions, printData, printError } from './context.js';
import {
  loadProfile,
  loadProfileMetadata,
  saveProfile,
  clearProfileTokens,
  preflightProfileSecretStorage,
  type WhoopProfile,
} from '../store/profile-store.js';
import {
  resolveLoginProfileSecretStore,
  resolveSupportedStoredProfileSecretStore,
} from '../store/profile-secret-store-selector.js';
import { tokenFromOAuth, refreshProfileToken } from '../auth/token-service.js';
import { configError, usageError } from '../http/errors.js';
import type { ProfileSecretStore, SecretStorageSelection, StoredSecretStorageConfig } from '../store/profile-secret-store.js';

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

const sameOnePasswordConfig = (
  a: StoredSecretStorageConfig | undefined,
  b: StoredSecretStorageConfig | undefined,
): boolean =>
  a?.onePassword?.vault === b?.onePassword?.vault
  && a?.onePassword?.item === b?.onePassword?.item;

const sameSecretStorageTarget = (
  existing: Awaited<ReturnType<typeof loadProfileMetadata>>,
  secretStorage: {
    kind: WhoopProfile['secretStorage'];
    config?: StoredSecretStorageConfig;
  },
): boolean =>
  Boolean(existing)
  && existing?.secretStorage === secretStorage.kind
  && sameOnePasswordConfig(existing.secretStorageConfig, secretStorage.config);

const readProfileSecretBestEffort = async (
  store: ProfileSecretStore,
  profileName: string,
  name: 'clientSecret' | 'refreshToken',
): Promise<string | undefined> => {
  try {
    return await store.get(profileName, name);
  } catch {
    return undefined;
  }
};

export const resolveClientConfig = async (
  profileName: string,
  baseUrl: string,
  existing: Awaited<ReturnType<typeof loadProfileMetadata>>,
  secretStore: ProfileSecretStore,
  previousSecretStore: ProfileSecretStore | undefined,
  secretStorage: {
    kind: WhoopProfile['secretStorage'];
    config?: StoredSecretStorageConfig;
  },
  overrides: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    scopes?: string;
  },
  interactive: boolean,
): Promise<WhoopProfile> => {
  let clientId = overrides.clientId ?? process.env.WHOOP_CLIENT_ID ?? existing?.clientId;
  let clientSecret = overrides.clientSecret ?? process.env.WHOOP_CLIENT_SECRET;
  let redirectUri = overrides.redirectUri ?? process.env.WHOOP_REDIRECT_URI ?? existing?.redirectUri;
  const isExistingTarget = sameSecretStorageTarget(existing, secretStorage);
  if (!clientSecret && existing) {
    clientSecret = isExistingTarget
      ? await secretStore.get(profileName, 'clientSecret')
      : previousSecretStore
        ? await readProfileSecretBestEffort(previousSecretStore, profileName, 'clientSecret')
        : undefined;
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
    secretStorage: secretStorage.kind,
    secretStorageConfig: secretStorage.config,
  };
};

export const loadLoginRefreshTokenFallback = async (
  profileName: string,
  existing: Awaited<ReturnType<typeof loadProfileMetadata>>,
  selectedSecretStore: ProfileSecretStore,
  previousSecretStore: ProfileSecretStore | undefined,
  selectedSecretStorage: {
    kind: WhoopProfile['secretStorage'];
    config?: StoredSecretStorageConfig;
  },
): Promise<string | undefined> => {
  if (!existing?.tokens?.hasRefreshToken) {
    return undefined;
  }

  if (sameSecretStorageTarget(existing, selectedSecretStorage)) {
    return selectedSecretStore.get(profileName, 'refreshToken');
  }

  return previousSecretStore
    ? readProfileSecretBestEffort(previousSecretStore, profileName, 'refreshToken')
    : undefined;
};

const LOCAL_VPS_RISK_PROMPT =
  'local-vps stores WHOOP secrets in a local 0600 file. It protects against accidental repo/chat/log exposure, not against VPS compromise. Type local-vps to continue: ';

const resolveLocalVpsRiskAcceptance = async (
  requested: SecretStorageSelection,
  accepted: boolean,
  interactive: boolean,
): Promise<boolean> => {
  if (accepted || requested !== 'local-vps' || !interactive || !canPrompt()) {
    return accepted;
  }

  const answer = (await ask(LOCAL_VPS_RISK_PROMPT)).trim();
  return answer === 'local-vps';
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
    .option('--secret-storage <mode>', 'secret storage: auto, macos-keychain, onepassword, or local-vps', 'auto')
    .option('--op-vault <vault>', '1Password vault for WHOOP secrets')
    .option('--op-item <item>', '1Password item for WHOOP secrets')
    .option('--accept-local-vps-risk', 'acknowledge local-vps storage risk for Linux VPS setups', false)
    .option('--code <url>', 'full redirect URL (requires --state; skip prompt)')
    .option('--state <state>', 'expected OAuth state; required with --code')
    .option('--no-open', 'do not attempt to open browser')
    .action(async function loginAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const existing = await loadProfileMetadata(globals.profile);
        const requestedStorage = opts.secretStorage as SecretStorageSelection;
        const acceptLocalVpsRisk = await resolveLocalVpsRiskAcceptance(
          requestedStorage,
          Boolean(opts.acceptLocalVpsRisk),
          !globals.json,
        );
        const secretStore = resolveLoginProfileSecretStore({
          requested: requestedStorage,
          existing,
          opVault: opts.opVault,
          opItem: opts.opItem,
          acceptLocalVpsRisk,
          env: process.env,
        });
        secretStore.store.assertSupported?.();
        const previousSecretStore = resolveSupportedStoredProfileSecretStore(existing)?.store ?? undefined;
        const profile = await resolveClientConfig(globals.profile, globals.baseUrl, existing, secretStore.store, previousSecretStore, {
          kind: secretStore.secretStorage,
          config: secretStore.secretStorageConfig,
        }, {
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          redirectUri: opts.redirectUri,
          scopes: opts.scopes,
        }, !globals.json);

        const state = resolveLoginState(opts.state, Boolean(opts.code));
        let code: string;
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
          await preflightProfileSecretStorage(globals.profile, secretStore.store);
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
          const openAttempted = opts.open !== false
            ? await tryOpenBrowser(authUrl)
            : false;

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

        if (opts.code) {
          await preflightProfileSecretStorage(globals.profile, secretStore.store);
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

        const previousRefreshToken = tokenPayload.refresh_token
          ? undefined
          : await loadLoginRefreshTokenFallback(globals.profile, existing, secretStore.store, previousSecretStore, {
            kind: secretStore.secretStorage,
            config: secretStore.secretStorageConfig,
          });
        profile.tokens = tokenFromOAuth(tokenPayload, previousRefreshToken);
        await saveProfile(globals.profile, profile);

        printData(this, {
          profile: globals.profile,
          authenticated: true,
          scopes: profile.scopes,
          expiresAt: profile.tokens.expiresAt,
          secretStorage: profile.secretStorage,
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
            secretStorage: profile?.secretStorage ?? null,
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
          secretStorage: profile.secretStorage,
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
          secretStorage: profile.secretStorage,
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
        const metadata = await loadProfileMetadata(globals.profile);
        await clearProfileTokens(globals.profile);
        printData(this, {
          profile: globals.profile,
          loggedOut: true,
          secretStorage: metadata?.secretStorage ?? null,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
