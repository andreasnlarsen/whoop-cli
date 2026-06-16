import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { configError } from '../http/errors.js';
import { localVpsSecretPath, sanitizeProfileName } from '../util/config.js';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import type { ProfileSecretName, ProfileSecretStore } from './profile-secret-store.js';

type LocalVpsSecrets = Partial<Record<ProfileSecretName, string>>;

const LOCAL_VPS_WARNING =
  'local-vps secret storage protects against accidental repo/chat/log exposure, not against a compromised VPS or user account.';

const ensureSecretDir = async (profileName: string): Promise<void> => {
  const dir = dirname(localVpsSecretPath(profileName));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
};

const readSecrets = async (profileName: string): Promise<LocalVpsSecrets> =>
  (await readJsonFile<LocalVpsSecrets>(localVpsSecretPath(profileName))) ?? {};

const writeSecrets = async (profileName: string, secrets: LocalVpsSecrets): Promise<void> => {
  await ensureSecretDir(profileName);
  await writeJsonFileSecure(localVpsSecretPath(profileName), secrets);
  await chmod(localVpsSecretPath(profileName), 0o600);
};

export interface LocalVpsProfileSecretStoreOptions {
  acceptedRisk?: boolean;
  platform?: NodeJS.Platform;
}

export const createLocalVpsProfileSecretStore = (
  opts: LocalVpsProfileSecretStoreOptions = {},
): ProfileSecretStore => {
  const platform = opts.platform ?? process.platform;
  const assertSupported = (): void => {
    if (platform !== 'linux') {
      throw configError('local-vps secret storage is only supported for explicit Linux VPS setups.');
    }
  };

  return {
    kind: 'local-vps',
    assertSupported,

    async preflightWrite(profileName) {
      assertSupported();
      if (!opts.acceptedRisk) {
        throw configError(
          `Refusing to use local-vps secret storage without explicit acknowledgement. Re-run with --accept-local-vps-risk. ${LOCAL_VPS_WARNING}`,
        );
      }
      await ensureSecretDir(sanitizeProfileName(profileName));
    },

    async get(profileName, name) {
      assertSupported();
      const secrets = await readSecrets(sanitizeProfileName(profileName));
      return secrets[name];
    },

    async set(profileName, name, value) {
      assertSupported();
      if (value.includes('\n') || value.includes('\r')) {
        throw configError('WHOOP credentials cannot contain newline characters.');
      }
      const safeProfileName = sanitizeProfileName(profileName);
      const secrets = await readSecrets(safeProfileName);
      secrets[name] = value;
      await writeSecrets(safeProfileName, secrets);
    },

    async delete(profileName, name) {
      assertSupported();
      const safeProfileName = sanitizeProfileName(profileName);
      const secrets = await readSecrets(safeProfileName);
      delete secrets[name];
      await writeSecrets(safeProfileName, secrets);
    },
  };
};
