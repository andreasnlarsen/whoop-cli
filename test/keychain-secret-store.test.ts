import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeychainProfileSecretStore,
  type SecurityCommandRunner,
} from '../src/store/keychain-secret-store.js';

test('stores secrets through Keychain prompt stdin instead of command arguments', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: SecurityCommandRunner = async (args, input) => {
    calls.push({ args, input });
    return { stdout: '', stderr: '' };
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await store.set('default', 'clientSecret', 'super-secret');

  assert.deepEqual(calls, [
    {
      args: [
        'add-generic-password',
        '-a',
        'default:clientSecret',
        '-s',
        'whoop-cli',
        '-U',
        '-w',
      ],
      input: 'super-secret\nsuper-secret\n',
    },
  ]);
  assert.equal(calls[0].args.includes('super-secret'), false);
  assert.equal(calls[0].args.at(-1), '-w');
});

test('reads a stored secret and trims the security command newline', async () => {
  const runCommand: SecurityCommandRunner = async () => ({
    stdout: 'stored-secret\n',
    stderr: '',
  });
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.doesNotReject(async () => {
    assert.equal(await store.get('default', 'accessToken'), 'stored-secret');
  });
});

test('returns undefined when a Keychain item is missing', async () => {
  const runCommand: SecurityCommandRunner = async () => {
    const err = new Error('missing') as Error & { exitCode: number; stderr: string };
    err.exitCode = 44;
    err.stderr = 'The specified item could not be found in the keychain.';
    throw err;
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  assert.equal(await store.get('default', 'refreshToken'), undefined);
  await assert.doesNotReject(() => store.delete('default', 'refreshToken'));
});

test('rejects Keychain access on non-macOS platforms', async () => {
  const runCommand: SecurityCommandRunner = async () => ({ stdout: '', stderr: '' });
  const store = createKeychainProfileSecretStore(runCommand, 'linux');

  await assert.rejects(
    () => store.get('default', 'clientSecret'),
    /macOS Keychain secret storage is only available on macOS/,
  );
});

test('rejects secrets containing newline characters', async () => {
  const runCommand: SecurityCommandRunner = async () => ({ stdout: '', stderr: '' });
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.rejects(
    () => store.set('default', 'clientSecret', 'line-one\nline-two'),
    /WHOOP credentials cannot contain newline characters/,
  );
});
