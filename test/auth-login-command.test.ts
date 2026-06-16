import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const withFakeOp = async (
  fn: (env: NodeJS.ProcessEnv, opLog: string) => Promise<void>,
): Promise<void> => {
  const tmp = await mkdtemp(join(tmpdir(), 'whoop-cli-auth-login-'));
  const binDir = join(tmp, 'bin');
  const home = join(tmp, 'home');
  const opLog = join(tmp, 'op.log');
  await mkdir(binDir, { recursive: true });
  await mkdir(home, { recursive: true });
  const opPath = join(binDir, 'op');
  await writeFile(opPath, '#!/bin/sh\necho "$@" >> "$OP_LOG"\nexit 1\n', 'utf8');
  await chmod(opPath, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    OP_LOG: opLog,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };
  delete env.WHOOP_CLIENT_ID;
  delete env.WHOOP_CLIENT_SECRET;
  delete env.WHOOP_REDIRECT_URI;
  delete env.WHOOP_OP_VAULT;
  delete env.WHOOP_OP_ITEM;

  try {
    await fn(env, opLog);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

const runAuthLogin = async (
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | undefined; stdout: string; stderr: string }> => {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', 'auth', 'login', '--json', ...args],
      {
        cwd: process.cwd(),
        env,
      },
    );
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    const failed = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failed.code,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
};

test('auth login validates missing OAuth config before 1Password preflight', async () => {
  await withFakeOp(async (env, opLog) => {
    const result = await runAuthLogin([
      '--secret-storage',
      'onepassword',
      '--op-vault',
      'Ops',
      '--op-item',
      'WHOOP default',
    ], env);

    assert.equal(result.code, 2);
    assert.match(result.stdout, /Missing WHOOP OAuth client config/);
    assert.equal(result.stderr, '');
    assert.equal(existsSync(opLog), false);
  });
});

test('auth login validates --code state before 1Password preflight', async () => {
  await withFakeOp(async (env, opLog) => {
    const result = await runAuthLogin([
      '--secret-storage',
      'onepassword',
      '--op-vault',
      'Ops',
      '--op-item',
      'WHOOP default',
      '--client-id',
      'client-id-value',
      '--client-secret',
      'client-secret-value',
      '--redirect-uri',
      'https://localhost:1234/callback',
      '--code',
      'https://localhost:1234/callback?code=abc&state=state',
    ], env);

    assert.equal(result.code, 2);
    assert.match(result.stdout, /--state is required with --code/);
    assert.equal(result.stderr, '');
    assert.equal(existsSync(opLog), false);
  });
});
