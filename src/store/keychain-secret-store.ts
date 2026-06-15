import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configError } from '../http/errors.js';
import { sanitizeProfileName } from '../util/config.js';

export type ProfileSecretName = 'clientSecret' | 'accessToken' | 'refreshToken';

export interface ProfileSecretStore {
  assertSupported?: () => void;
  preflightWrite?: (profileName: string) => Promise<void>;
  get(profileName: string, name: ProfileSecretName): Promise<string | undefined>;
  set(profileName: string, name: ProfileSecretName, value: string): Promise<void>;
  delete(profileName: string, name: ProfileSecretName): Promise<void>;
}

export interface KeychainCommandResult {
  stdout: string;
  stderr: string;
}

export type KeychainCommandRunner = (
  args: string[],
  input?: string,
) => Promise<KeychainCommandResult>;

const KEYCHAIN_SERVICE = 'whoop-cli';
const SWIFT_MODULE_CACHE_DIR = join(tmpdir(), 'whoop-cli-swift-module-cache');
const PREFLIGHT_SECRET_VALUE = 'whoop-cli-keychain-preflight';

const SWIFT_KEYCHAIN_HELPER_SOURCE = `
import Foundation
import Security

func writeStderr(_ value: String) {
  FileHandle.standardError.write(Data(value.utf8))
}

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  writeStderr(message + "\\n")
  exit(code)
}

let args = CommandLine.arguments
guard args.count == 4 else {
  fail("usage: keychain-helper <get|set|delete> <service> <account>", 64)
}

let operation = args[1]
let service = args[2]
let account = args[3]

func baseQuery() -> [String: Any] {
  [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
  ]
}

func isMissingStatus(_ status: OSStatus) -> Bool {
  status == errSecItemNotFound
}

switch operation {
case "get":
  var query = baseQuery()
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne

  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  if isMissingStatus(status) {
    exit(44)
  }
  guard status == errSecSuccess, let data = result as? Data else {
    fail("keychain get failed: \\(status)", 1)
  }
  FileHandle.standardOutput.write(data)

case "set":
  let secretData = FileHandle.standardInput.readDataToEndOfFile()
  guard !secretData.isEmpty else {
    fail("keychain set failed: empty secret data", 65)
  }

  let updateStatus = SecItemUpdate(
    baseQuery() as CFDictionary,
    [kSecValueData as String: secretData] as CFDictionary
  )

  if updateStatus == errSecSuccess {
    exit(0)
  }

  if isMissingStatus(updateStatus) {
    var query = baseQuery()
    query[kSecValueData as String] = secretData
    let addStatus = SecItemAdd(query as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      fail("keychain add failed: \\(addStatus)", 1)
    }
    exit(0)
  }

  fail("keychain update failed: \\(updateStatus)", 1)

case "delete":
  let status = SecItemDelete(baseQuery() as CFDictionary)
  if isMissingStatus(status) {
    exit(44)
  }
  guard status == errSecSuccess else {
    fail("keychain delete failed: \\(status)", 1)
  }

default:
  fail("unknown operation: \\(operation)", 64)
}
`;

const secretAccount = (profileName: string, name: ProfileSecretName): string =>
  `${sanitizeProfileName(profileName)}:${name}`;

const preflightAccount = (profileName: string): string =>
  `${sanitizeProfileName(profileName)}:preflight`;

const isMissingItem = (err: unknown): boolean => {
  const candidate = err as { exitCode?: number; stderr?: string };
  return candidate.exitCode === 44 ||
    /could not be found/i.test(candidate.stderr ?? '');
};

const isSwiftUnavailable = (err: unknown): boolean => {
  const candidate = err as { code?: string; message?: string; stderr?: string };
  const text = `${candidate.message ?? ''}\n${candidate.stderr ?? ''}`;
  return candidate.code === 'ENOENT' ||
    /xcrun: error|active developer path|command line developer tools|unable to find utility ['"]?swift/i.test(text);
};

const isKeychainParameterError = (err: unknown): boolean => {
  const candidate = err as { stderr?: string };
  return /keychain (?:get|set|add|update|delete) failed: -50/i.test(candidate.stderr ?? '');
};

const keychainAccessError = (action: 'read' | 'write' | 'delete', err: unknown): Error => {
  if (isSwiftUnavailable(err)) {
    return configError(
      'macOS Keychain access requires Apple Command Line Tools (`/usr/bin/swift`). Run `xcode-select --install`, then retry.',
    );
  }

  if (isKeychainParameterError(err)) {
    return configError(
      `macOS Keychain ${action} was blocked or rejected by the current process. If this is a sandboxed agent session, rerun the command from a normal Terminal or with unsandboxed execution.`,
    );
  }

  return configError(`Unable to ${action} WHOOP credentials ${action === 'write' ? 'to' : 'from'} macOS Keychain.`);
};

export const runKeychainCommand: KeychainCommandRunner = (args, input) =>
  new Promise((resolve, reject) => {
    mkdirSync(SWIFT_MODULE_CACHE_DIR, { recursive: true });
    const child = spawn('/usr/bin/swift', ['-e', SWIFT_KEYCHAIN_HELPER_SOURCE, ...args], {
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: SWIFT_MODULE_CACHE_DIR,
      },
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

      const error = new Error(`keychain command failed with exit code ${code ?? 'unknown'}`) as Error & {
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
  runCommand: KeychainCommandRunner = runKeychainCommand,
  platform: NodeJS.Platform = process.platform,
): ProfileSecretStore => {
  const assertSupported = (): void => {
    if (platform !== 'darwin') {
      throw configError('macOS Keychain secret storage is only available on macOS.');
    }
  };

  return {
    assertSupported,

    async preflightWrite(profileName) {
      assertSupported();
      const account = preflightAccount(profileName);
      try {
        await runCommand(['set', KEYCHAIN_SERVICE, account], PREFLIGHT_SECRET_VALUE);
        await runCommand(['delete', KEYCHAIN_SERVICE, account]);
      } catch (err) {
        throw keychainAccessError('write', err);
      }
    },

    async get(profileName, name) {
      assertSupported();
      try {
        const result = await runCommand([
          'get',
          KEYCHAIN_SERVICE,
          secretAccount(profileName, name),
        ]);
        return result.stdout;
      } catch (err) {
        if (isMissingItem(err)) {
          return undefined;
        }
        throw keychainAccessError('read', err);
      }
    },

    async set(profileName, name, value) {
      assertSupported();
      if (value.includes('\n') || value.includes('\r')) {
        throw configError('WHOOP credentials cannot contain newline characters.');
      }

      try {
        await runCommand(
          [
            'set',
            KEYCHAIN_SERVICE,
            secretAccount(profileName, name),
          ],
          value,
        );
      } catch (err) {
        throw keychainAccessError('write', err);
      }
    },

    async delete(profileName, name) {
      assertSupported();
      try {
        await runCommand([
          'delete',
          KEYCHAIN_SERVICE,
          secretAccount(profileName, name),
        ]);
      } catch (err) {
        if (!isMissingItem(err)) {
          throw keychainAccessError('delete', err);
        }
      }
    },
  };
};

export const keychainProfileSecretStore = createKeychainProfileSecretStore();
