import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localVpsSecretPath } from '../src/util/config.js';
import { createLocalVpsProfileSecretStore } from '../src/store/local-vps-secret-store.js';

const withTempHome = async (fn: (home: string) => Promise<void>): Promise<void> => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'whoop-cli-local-vps-'));
  process.env.HOME = home;

  try {
    await fn(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
  }
};

const mode = (value: number): string => (value & 0o777).toString(8);

test('local-vps preflight requires explicit risk acknowledgement', async () => {
  await withTempHome(async () => {
    const store = createLocalVpsProfileSecretStore({ platform: 'linux' });

    await assert.rejects(
      () => store.preflightWrite?.('default'),
      /without explicit acknowledgement/,
    );
  });
});

test('local-vps store writes secrets to dedicated 0600 files', async () => {
  await withTempHome(async () => {
    const store = createLocalVpsProfileSecretStore({
      platform: 'linux',
      acceptedRisk: true,
    });

    await store.preflightWrite?.('default');
    await store.set('default', 'clientSecret', 'client-secret-value');
    await store.set('default', 'refreshToken', 'refresh-token-value');

    const secretFile = localVpsSecretPath('default');
    const secretDir = join(process.env.HOME ?? '', '.whoop-cli', 'secrets');

    assert.equal(await store.get('default', 'clientSecret'), 'client-secret-value');
    assert.equal(await store.get('default', 'refreshToken'), 'refresh-token-value');
    assert.equal(mode((await stat(secretDir)).mode), '700');
    assert.equal(mode((await stat(secretFile)).mode), '600');

    const raw = await readFile(secretFile, 'utf8');
    assert.match(raw, /client-secret-value/);
    assert.match(raw, /refresh-token-value/);
  });
});

test('local-vps delete removes individual secrets', async () => {
  await withTempHome(async () => {
    const store = createLocalVpsProfileSecretStore({
      platform: 'linux',
      acceptedRisk: true,
    });

    await store.set('default', 'accessToken', 'access-token-value');
    await store.delete('default', 'accessToken');

    assert.equal(await store.get('default', 'accessToken'), undefined);
  });
});

test('local-vps store rejects newline credentials', async () => {
  await withTempHome(async () => {
    const store = createLocalVpsProfileSecretStore({
      platform: 'linux',
      acceptedRisk: true,
    });

    await assert.rejects(
      () => store.set('default', 'clientSecret', 'line-one\nline-two'),
      /cannot contain newline/,
    );
  });
});
