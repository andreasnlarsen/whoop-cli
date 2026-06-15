import { spawn } from 'node:child_process';
import { configError } from '../http/errors.js';
import { sanitizeProfileName } from '../util/config.js';

export type ProfileSecretName = 'clientSecret' | 'accessToken' | 'refreshToken';

export interface ProfileSecretStore {
  get(profileName: string, name: ProfileSecretName): Promise<string | undefined>;
  set(profileName: string, name: ProfileSecretName, value: string): Promise<void>;
  delete(profileName: string, name: ProfileSecretName): Promise<void>;
}

export interface SecurityCommandResult {
  stdout: string;
  stderr: string;
}

export type SecurityCommandRunner = (
  args: string[],
  input?: string,
) => Promise<SecurityCommandResult>;

const KEYCHAIN_SERVICE = 'whoop-cli';

const secretAccount = (profileName: string, name: ProfileSecretName): string =>
  `${sanitizeProfileName(profileName)}:${name}`;

const trimOneTrailingNewline = (value: string): string => value.replace(/\r?\n$/, '');

const isMissingItem = (err: unknown): boolean => {
  const candidate = err as { exitCode?: number; stderr?: string };
  return candidate.exitCode === 44 || /could not be found/i.test(candidate.stderr ?? '');
};

export const runSecurityCommand: SecurityCommandRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, {
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

      const error = new Error(`security command failed with exit code ${code ?? 'unknown'}`) as Error & {
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

export const createKeychainProfileSecretStore = (
  runCommand: SecurityCommandRunner = runSecurityCommand,
  platform: NodeJS.Platform = process.platform,
): ProfileSecretStore => {
  const assertSupported = (): void => {
    if (platform !== 'darwin') {
      throw configError('macOS Keychain secret storage is only available on macOS.');
    }
  };

  return {
    async get(profileName, name) {
      assertSupported();
      try {
        const result = await runCommand([
          'find-generic-password',
          '-a',
          secretAccount(profileName, name),
          '-s',
          KEYCHAIN_SERVICE,
          '-w',
        ]);
        return trimOneTrailingNewline(result.stdout);
      } catch (err) {
        if (isMissingItem(err)) {
          return undefined;
        }
        throw configError('Unable to read WHOOP credentials from macOS Keychain.');
      }
    },

    async set(profileName, name, value) {
      assertSupported();
      if (value.includes('\n') || value.includes('\r')) {
        throw configError('WHOOP credentials cannot contain newline characters.');
      }

      await runCommand(
        [
          'add-generic-password',
          '-a',
          secretAccount(profileName, name),
          '-s',
          KEYCHAIN_SERVICE,
          '-U',
          '-w',
        ],
        `${value}\n${value}\n`,
      );
    },

    async delete(profileName, name) {
      assertSupported();
      try {
        await runCommand([
          'delete-generic-password',
          '-a',
          secretAccount(profileName, name),
          '-s',
          KEYCHAIN_SERVICE,
        ]);
      } catch (err) {
        if (!isMissingItem(err)) {
          throw configError('Unable to delete WHOOP credentials from macOS Keychain.');
        }
      }
    },
  };
};

export const keychainProfileSecretStore = createKeychainProfileSecretStore();
