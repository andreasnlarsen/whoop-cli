import { spawn } from 'node:child_process';
import { configError } from '../http/errors.js';
import { sanitizeProfileName } from '../util/config.js';
import type {
  OnePasswordSecretStorageConfig,
  ProfileSecretName,
  ProfileSecretStore,
} from './profile-secret-store.js';

export interface OnePasswordCommandResult {
  stdout: string;
  stderr: string;
}

export type OnePasswordCommandRunner = (
  args: string[],
  input?: string,
) => Promise<OnePasswordCommandResult>;

interface OnePasswordField {
  id?: string;
  label?: string;
  purpose?: string;
  type?: string;
  value?: string;
}

interface OnePasswordItem {
  title?: string;
  category?: string;
  fields?: OnePasswordField[];
}

const PROFILE_SECRET_NAMES: ProfileSecretName[] = ['clientSecret', 'accessToken', 'refreshToken'];
const FIELD_ID_PREFIX = 'whoop-cli.';
const LEGACY_PROFILE_NAME = 'default';

export const runOnePasswordCommand: OnePasswordCommandRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn('op', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`op command failed with exit code ${code ?? 'unknown'}`) as Error & {
        exitCode?: number | null;
        stderr?: string;
      };
      error.exitCode = code;
      error.stderr = stderr;
      reject(error);
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });

const isOpUnavailable = (err: unknown): boolean => {
  const candidate = err as { code?: string; message?: string };
  return candidate.code === 'ENOENT' || /spawn op ENOENT/i.test(candidate.message ?? '');
};

const isMissingItem = (err: unknown): boolean => {
  const candidate = err as { stderr?: string; message?: string };
  const text = `${candidate.message ?? ''}\n${candidate.stderr ?? ''}`;
  return /\bisn't an item\b/i.test(text)
    || /\b(could not find|couldn't find|could not be found|not found|does not exist|doesn't exist)\b.*\bitem\b/i.test(text)
    || /\bitem\b.*\b(could not be found|not found|does not exist|doesn't exist)\b/i.test(text);
};

const onePasswordError = (action: 'read' | 'write' | 'delete', err: unknown): Error => {
  if (isOpUnavailable(err)) {
    return configError('1Password secret storage requires the `op` CLI to be installed on PATH.');
  }

  const candidate = err as { stderr?: string; message?: string };
  const detail = (candidate.stderr ?? candidate.message ?? '').trim();
  return configError(
    `Unable to ${action} WHOOP credentials with 1Password CLI. Verify OP_SERVICE_ACCOUNT_TOKEN or desktop-app auth, vault, and item configuration.`,
    detail ? { detail } : undefined,
  );
};

const assertConfig = (config: OnePasswordSecretStorageConfig): void => {
  if (!config.vault || !config.item) {
    throw configError('1Password secret storage requires both --op-vault and --op-item.');
  }
};

const getItemArgs = (config: OnePasswordSecretStorageConfig): string[] => [
  'item',
  'get',
  config.item,
  '--vault',
  config.vault,
  '--format',
  'json',
  '--reveal',
];

const editItemArgs = (config: OnePasswordSecretStorageConfig): string[] => [
  'item',
  'edit',
  config.item,
  '--vault',
  config.vault,
];

const dryRunEditItemArgs = (config: OnePasswordSecretStorageConfig, title: string): string[] => [
  'item',
  'edit',
  config.item,
  '--vault',
  config.vault,
  '--dry-run',
  '--title',
  title,
];

const createItemArgs = (config: OnePasswordSecretStorageConfig): string[] => [
  'item',
  'create',
  '--vault',
  config.vault,
  '-',
];

const profileFieldId = (profileName: string, name: ProfileSecretName): string =>
  `${FIELD_ID_PREFIX}${sanitizeProfileName(profileName)}.${name}`;

const isProfileScopedField = (field: OnePasswordField): boolean =>
  typeof field.id === 'string' && field.id.startsWith(FIELD_ID_PREFIX);

const isProfileScopedSecretField = (field: OnePasswordField): boolean => {
  if (typeof field.id !== 'string' || !field.id.startsWith(FIELD_ID_PREFIX)) {
    return false;
  }

  const suffix = field.id.slice(FIELD_ID_PREFIX.length);
  const separatorIndex = suffix.lastIndexOf('.');
  if (separatorIndex <= 0) {
    return false;
  }

  const profileName = suffix.slice(0, separatorIndex);
  const secretName = suffix.slice(separatorIndex + 1);
  try {
    sanitizeProfileName(profileName);
  } catch {
    return false;
  }

  return PROFILE_SECRET_NAMES.includes(secretName as ProfileSecretName);
};

const matchesLegacyField = (field: OnePasswordField, name: ProfileSecretName): boolean =>
  !isProfileScopedField(field) && (field.label === name || field.id === name);

const isLegacySecretField = (field: OnePasswordField): boolean =>
  PROFILE_SECRET_NAMES.some((name) => matchesLegacyField(field, name));

const isConcealedField = (field: OnePasswordField): boolean =>
  !field.type || field.type === 'CONCEALED';

const isBuiltInNotesField = (field: OnePasswordField): boolean =>
  field.id === 'notesPlain' && field.purpose === 'NOTES';

const isSafeWhoopField = (field: OnePasswordField): boolean =>
  isBuiltInNotesField(field)
  || ((isLegacySecretField(field) || isProfileScopedSecretField(field)) && isConcealedField(field));

const assertSafeToRewriteItem = (item: OnePasswordItem): void => {
  if (item.category && item.category !== 'SECURE_NOTE') {
    throw configError('Refusing to edit an existing 1Password item that is not a Secure Note. Use a dedicated WHOOP CLI item.');
  }

  const unsupported = (item.fields ?? []).find((field) => !isSafeWhoopField(field));

  if (unsupported) {
    throw configError(
      'Refusing to edit an existing 1Password item that contains non-WHOOP fields. Use a dedicated WHOOP CLI item.',
    );
  }
};

const findField = (
  item: OnePasswordItem,
  profileName: string,
  name: ProfileSecretName,
): OnePasswordField | undefined => {
  const fields = item.fields ?? [];
  const fieldId = profileFieldId(profileName, name);
  const scoped = fields.find((field) => field.id === fieldId);
  if (scoped) {
    return scoped;
  }

  if (profileName === LEGACY_PROFILE_NAME) {
    return fields.find((field) => matchesLegacyField(field, name));
  }

  return undefined;
};

const migrateLegacyFields = (
  item: OnePasswordItem,
  profileName: string,
): OnePasswordItem => {
  if (profileName !== LEGACY_PROFILE_NAME) {
    return item;
  }

  const scopedLegacyNames = new Set<ProfileSecretName>(
    PROFILE_SECRET_NAMES.filter((name) =>
      (item.fields ?? []).some((field) => field.id === profileFieldId(LEGACY_PROFILE_NAME, name))),
  );
  const fields = (item.fields ?? []).map((field) => {
    const secretName = PROFILE_SECRET_NAMES.find((name) => matchesLegacyField(field, name));
    if (!secretName || scopedLegacyNames.has(secretName)) {
      return field;
    }

    return {
      ...field,
      id: profileFieldId(LEGACY_PROFILE_NAME, secretName),
      label: field.label ?? secretName,
      type: 'CONCEALED',
    };
  });

  return {
    ...item,
    fields,
  };
};

const parseItem = (raw: string): OnePasswordItem => {
  try {
    const item = JSON.parse(raw) as OnePasswordItem;
    return {
      ...item,
      fields: Array.isArray(item.fields) ? item.fields : [],
    };
  } catch {
    throw configError('1Password CLI returned invalid item JSON.');
  }
};

const itemWithField = (
  item: OnePasswordItem,
  profileName: string,
  name: ProfileSecretName,
  value: string,
): OnePasswordItem => {
  const normalized = migrateLegacyFields(item, profileName);
  const fields = [...(normalized.fields ?? [])];
  const fieldId = profileFieldId(profileName, name);
  const index = fields.findIndex((field) => field.id === fieldId);
  if (index >= 0) {
    fields[index] = {
      ...fields[index],
      label: fields[index].label ?? name,
      type: 'CONCEALED',
      value,
    };
  } else {
    fields.push({
      id: fieldId,
      label: name,
      type: 'CONCEALED',
      value,
    });
  }

  return {
    ...normalized,
    fields,
  };
};

const itemWithoutField = (
  item: OnePasswordItem,
  profileName: string,
  name: ProfileSecretName,
): OnePasswordItem => {
  const normalized = migrateLegacyFields(item, profileName);
  const fieldId = profileFieldId(profileName, name);
  return {
    ...normalized,
    fields: (normalized.fields ?? []).filter((field) =>
      field.id !== fieldId
      && !(profileName === LEGACY_PROFILE_NAME && matchesLegacyField(field, name))),
  };
};

const newItemWithField = (
  config: OnePasswordSecretStorageConfig,
  profileName: string,
  name: ProfileSecretName,
  value: string,
): OnePasswordItem =>
  itemWithField({
    title: config.item,
    category: 'SECURE_NOTE',
    fields: [],
  }, profileName, name, value);

const newEmptyItem = (config: OnePasswordSecretStorageConfig): OnePasswordItem => ({
  title: config.item,
  category: 'SECURE_NOTE',
  fields: [],
});

export const createOnePasswordProfileSecretStore = (
  config: OnePasswordSecretStorageConfig,
  runCommand: OnePasswordCommandRunner = runOnePasswordCommand,
): ProfileSecretStore => {
  const assertSupported = (): void => {
    assertConfig(config);
  };

  const readItem = async (): Promise<OnePasswordItem | null> => {
    try {
      const result = await runCommand(getItemArgs(config));
      return parseItem(result.stdout);
    } catch (err) {
      if (isMissingItem(err)) {
        return null;
      }
      throw onePasswordError('read', err);
    }
  };

  const writeItem = async (item: OnePasswordItem, exists: boolean): Promise<void> => {
    const input = JSON.stringify(item);
    const args = exists ? editItemArgs(config) : createItemArgs(config);
    try {
      await runCommand(args, input);
    } catch (err) {
      throw onePasswordError('write', err);
    }
  };

  const preflightExistingItem = async (item: OnePasswordItem): Promise<void> => {
    assertSafeToRewriteItem(item);
    try {
      await runCommand(dryRunEditItemArgs(config, item.title ?? config.item));
    } catch (err) {
      throw onePasswordError('write', err);
    }
  };

  return {
    kind: 'onepassword',
    assertSupported,

    async preflightWrite() {
      assertSupported();
      const item = await readItem();
      if (item) {
        await preflightExistingItem(item);
      } else {
        await writeItem(newEmptyItem(config), false);
      }
    },

    async get(profileName, name) {
      assertSupported();
      const safeProfileName = sanitizeProfileName(profileName);
      const item = await readItem();
      const field = item ? findField(item, safeProfileName, name) : undefined;
      return field?.value || undefined;
    },

    async set(profileName, name, value) {
      assertSupported();
      const safeProfileName = sanitizeProfileName(profileName);
      if (value.includes('\n') || value.includes('\r')) {
        throw configError('WHOOP credentials cannot contain newline characters.');
      }
      const item = await readItem();
      if (item) {
        assertSafeToRewriteItem(item);
      }
      const next = item
        ? itemWithField(item, safeProfileName, name, value)
        : newItemWithField(config, safeProfileName, name, value);
      await writeItem(next, Boolean(item));
    },

    async delete(profileName, name) {
      assertSupported();
      const safeProfileName = sanitizeProfileName(profileName);
      const item = await readItem();
      if (!item) return;
      assertSafeToRewriteItem(item);
      await writeItem(itemWithoutField(item, safeProfileName, name), true);
    },
  };
};
