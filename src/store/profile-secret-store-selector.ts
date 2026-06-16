import { configError } from '../http/errors.js';
import { createKeychainProfileSecretStore } from './keychain-secret-store.js';
import { createLocalVpsProfileSecretStore } from './local-vps-secret-store.js';
import { createOnePasswordProfileSecretStore } from './onepassword-secret-store.js';
import type {
  OnePasswordSecretStorageConfig,
  ResolvedProfileSecretStore,
  SecretStorageKind,
  SecretStorageSelection,
  StoredSecretStorageConfig,
} from './profile-secret-store.js';

export interface StoredProfileSecretStorageMetadata {
  secretStorage?: SecretStorageKind;
  secretStorageConfig?: StoredSecretStorageConfig;
}

export interface ResolveLoginSecretStoreOptions {
  requested?: SecretStorageSelection;
  existing?: StoredProfileSecretStorageMetadata | null;
  opVault?: string;
  opItem?: string;
  acceptLocalVpsRisk?: boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveStoredSecretStoreOptions {
  platform?: NodeJS.Platform;
}

const LINUX_AUTO_ERROR =
  'Linux auto secret storage requires 1Password configuration. Use --secret-storage onepassword --op-vault <vault> --op-item <item>, or explicitly choose --secret-storage local-vps --accept-local-vps-risk for Telegram-only/simple VPS setup.';

export const parseSecretStorageSelection = (raw: string | undefined): SecretStorageSelection => {
  const value = raw ?? 'auto';
  if (
    value === 'auto'
    || value === 'macos-keychain'
    || value === 'onepassword'
    || value === 'local-vps'
  ) {
    return value;
  }

  throw configError('Unsupported secret storage. Use auto, macos-keychain, onepassword, or local-vps.');
};

const onePasswordConfigFrom = (
  opts: ResolveLoginSecretStoreOptions,
): OnePasswordSecretStorageConfig | undefined => {
  const env = opts.env ?? process.env;
  const vault = opts.opVault
    ?? env.WHOOP_OP_VAULT
    ?? opts.existing?.secretStorageConfig?.onePassword?.vault;
  const item = opts.opItem
    ?? env.WHOOP_OP_ITEM
    ?? opts.existing?.secretStorageConfig?.onePassword?.item;

  return vault && item ? { vault, item } : undefined;
};

const isRecoverableStoredSecretStorageError = (err: unknown): boolean => {
  const candidate = err as { code?: string; message?: string; name?: string };
  if (candidate.name !== 'WhoopCliError' || candidate.code !== 'CONFIG_ERROR') {
    return false;
  }

  return /secret storage .*(only available|only supported|requires)|1Password secret storage requires/i
    .test(candidate.message ?? '');
};

const onePasswordResult = (
  config: OnePasswordSecretStorageConfig | undefined,
): ResolvedProfileSecretStore => {
  if (!config) {
    throw configError('1Password secret storage requires --op-vault and --op-item, or WHOOP_OP_VAULT and WHOOP_OP_ITEM.');
  }

  return {
    store: createOnePasswordProfileSecretStore(config),
    secretStorage: 'onepassword',
    secretStorageConfig: {
      onePassword: config,
    },
  };
};

const keychainResult = (platform: NodeJS.Platform): ResolvedProfileSecretStore => ({
  store: createKeychainProfileSecretStore(undefined, platform),
  secretStorage: 'macos-keychain',
});

const localVpsResult = (
  platform: NodeJS.Platform,
  acceptLocalVpsRisk: boolean | undefined,
  requireAcknowledgement: boolean,
): ResolvedProfileSecretStore => {
  if (platform !== 'linux') {
    throw configError('local-vps secret storage is only supported for explicit Linux VPS setups.');
  }

  if (requireAcknowledgement && !acceptLocalVpsRisk) {
    throw configError(
      'Refusing to use local-vps secret storage without explicit acknowledgement. Re-run with --accept-local-vps-risk. local-vps protects against accidental repo/chat/log exposure, not against a compromised VPS or user account.',
    );
  }

  return {
    store: createLocalVpsProfileSecretStore({ acceptedRisk: acceptLocalVpsRisk, platform }),
    secretStorage: 'local-vps',
  };
};

export const resolveSupportedStoredProfileSecretStore = (
  metadata: StoredProfileSecretStorageMetadata | null | undefined,
  opts: ResolveStoredSecretStoreOptions = {},
): ResolvedProfileSecretStore | null => {
  if (!metadata) return null;

  try {
    const resolved = resolveStoredProfileSecretStore(metadata, opts);
    resolved.store.assertSupported?.();
    return resolved;
  } catch (err) {
    if (isRecoverableStoredSecretStorageError(err)) {
      return null;
    }
    throw err;
  }
};

export const resolveLoginProfileSecretStore = (
  opts: ResolveLoginSecretStoreOptions = {},
): ResolvedProfileSecretStore => {
  const requested = parseSecretStorageSelection(opts.requested);
  const platform = opts.platform ?? process.platform;
  const hasExplicitOnePasswordSelector = opts.opVault !== undefined || opts.opItem !== undefined;

  if (requested === 'auto') {
    if (platform === 'linux' && hasExplicitOnePasswordSelector) {
      return onePasswordResult(onePasswordConfigFrom(opts));
    }

    const existing = resolveSupportedStoredProfileSecretStore(opts.existing, { platform });
    if (existing) {
      return existing;
    }
  }

  if (requested === 'macos-keychain') {
    return keychainResult(platform);
  }

  if (requested === 'onepassword') {
    return onePasswordResult(onePasswordConfigFrom(opts));
  }

  if (requested === 'local-vps') {
    return localVpsResult(platform, opts.acceptLocalVpsRisk, true);
  }

  if (platform === 'darwin') {
    return keychainResult(platform);
  }

  if (platform === 'linux') {
    const onePasswordConfig = onePasswordConfigFrom(opts);
    if (onePasswordConfig) {
      return onePasswordResult(onePasswordConfig);
    }

    throw configError(LINUX_AUTO_ERROR);
  }

  throw configError('auto secret storage is only supported on macOS and Linux.');
};

export const resolveStoredProfileSecretStore = (
  metadata: StoredProfileSecretStorageMetadata,
  opts: ResolveStoredSecretStoreOptions = {},
): ResolvedProfileSecretStore => {
  const platform = opts.platform ?? process.platform;
  const secretStorage = metadata.secretStorage ?? 'macos-keychain';

  if (secretStorage === 'macos-keychain') {
    return keychainResult(platform);
  }

  if (secretStorage === 'onepassword') {
    return onePasswordResult(metadata.secretStorageConfig?.onePassword);
  }

  if (secretStorage === 'local-vps') {
    return localVpsResult(platform, true, false);
  }

  throw configError('Unsupported stored WHOOP secret storage.');
};
