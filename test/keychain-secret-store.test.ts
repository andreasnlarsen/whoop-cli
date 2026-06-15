import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeychainProfileSecretStore,
  type KeychainCommandRunner,
} from '../src/store/keychain-secret-store.js';

test('stores secrets through the Swift Keychain helper without secret arguments', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: KeychainCommandRunner = async (args, input) => {
    calls.push({ args, input });
    return { stdout: '', stderr: '' };
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await store.set('default', 'clientSecret', 'super-secret');

  assert.deepEqual(calls, [
    {
      args: [
        'set',
        'whoop-cli',
        'default:clientSecret',
      ],
      input: 'super-secret',
    },
  ]);
  assert.equal(calls[0].args.includes('super-secret'), false);
  assert.equal(calls[0].args.includes('-w'), false);
  assert.equal(calls[0].args.includes('-X'), false);
});

test('preflightWrite proves Keychain write access with a disposable item', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: KeychainCommandRunner = async (args, input) => {
    calls.push({ args, input });
    return { stdout: '', stderr: '' };
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await store.preflightWrite?.('default');

  assert.deepEqual(calls, [
    {
      args: [
        'set',
        'whoop-cli',
        'default:preflight',
      ],
      input: 'whoop-cli-keychain-preflight',
    },
    {
      args: [
        'delete',
        'whoop-cli',
        'default:preflight',
      ],
      input: undefined,
    },
  ]);
});

test('reads a stored secret from the Swift Keychain helper', async () => {
  const runCommand: KeychainCommandRunner = async () => ({
    stdout: 'stored-secret',
    stderr: '',
  });
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.doesNotReject(async () => {
    assert.equal(await store.get('default', 'accessToken'), 'stored-secret');
  });
});

test('returns undefined when a Keychain item is missing', async () => {
  const runCommand: KeychainCommandRunner = async () => {
    const err = new Error('missing') as Error & { exitCode: number; stderr: string };
    err.exitCode = 44;
    err.stderr = 'The specified item could not be found in the keychain.';
    throw err;
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  assert.equal(await store.get('default', 'refreshToken'), undefined);
  await assert.doesNotReject(() => store.delete('default', 'refreshToken'));
});

test('reports macOS parameter errors as Keychain access failures', async () => {
  const runCommand: KeychainCommandRunner = async () => {
    const err = new Error('parameter error') as Error & { exitCode: number; stderr: string };
    err.exitCode = 1;
    err.stderr = 'keychain get failed: -50';
    throw err;
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.rejects(
    () => store.get('default', 'refreshToken'),
    /Keychain read was blocked or rejected/,
  );
  await assert.rejects(
    () => store.delete('default', 'refreshToken'),
    /Keychain delete was blocked or rejected/,
  );
});

test('reports missing Apple Command Line Tools clearly', async () => {
  const runCommand: KeychainCommandRunner = async () => {
    const err = new Error('xcrun: error: invalid active developer path') as Error & {
      exitCode: number;
      stderr: string;
    };
    err.exitCode = 1;
    err.stderr = 'xcrun: error: invalid active developer path, missing xcrun';
    throw err;
  };
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.rejects(
    () => store.set('default', 'clientSecret', 'super-secret'),
    /requires Apple Command Line Tools/,
  );
});

test('rejects Keychain access on non-macOS platforms', async () => {
  const runCommand: KeychainCommandRunner = async () => ({ stdout: '', stderr: '' });
  const store = createKeychainProfileSecretStore(runCommand, 'linux');

  await assert.rejects(
    () => store.get('default', 'clientSecret'),
    /macOS Keychain secret storage is only available on macOS/,
  );
});

test('rejects secrets containing newline characters', async () => {
  const runCommand: KeychainCommandRunner = async () => ({ stdout: '', stderr: '' });
  const store = createKeychainProfileSecretStore(runCommand, 'darwin');

  await assert.rejects(
    () => store.set('default', 'clientSecret', 'line-one\nline-two'),
    /WHOOP credentials cannot contain newline characters/,
  );
});
