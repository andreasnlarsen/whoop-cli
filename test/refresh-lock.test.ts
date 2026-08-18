import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  authLockCommandForPlatform,
  withProfileAuthLock,
} from '../src/auth/refresh-lock.js';

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const withTempHome = async (fn: (home: string) => Promise<void>): Promise<void> => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = await mkdtemp(join(tmpdir(), 'whoop-cli-refresh-lock-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  try {
    await fn(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await rm(home, { recursive: true, force: true });
  }
};

const waitForFileText = async (path: string, expected: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const content = await readFile(path, 'utf8').catch(() => '');
    if (content.includes(expected)) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${expected}`);
};

const runLockWorker = (
  home: string,
  eventsPath: string,
  id: string,
  holdMs: number,
  startPath?: string,
  onSpawn?: (child: ChildProcess) => void,
): Promise<void> => {
  const lockModuleUrl = pathToFileURL(join(process.cwd(), 'src', 'auth', 'refresh-lock.ts')).href;
  const script = `
    import { appendFile, readFile } from 'node:fs/promises';
    import { withProfileAuthLock } from ${JSON.stringify(lockModuleUrl)};
    ${startPath ? `while (!(await readFile(${JSON.stringify(startPath)}).catch(() => null))) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }` : ''}
    await withProfileAuthLock('default', async () => {
      await appendFile(${JSON.stringify(eventsPath)}, ${JSON.stringify(`start-${id}\n`)}, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
      await appendFile(${JSON.stringify(eventsPath)}, ${JSON.stringify(`end-${id}\n`)}, 'utf8');
    });
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onSpawn?.(child);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lock worker ${id} failed (${code}): ${stderr}`));
      }
    });
  });
};

test('withProfileAuthLock serializes every in-process waiter', async () => {
  await withTempHome(async () => {
    let active = 0;
    let maxConcurrent = 0;
    let runs = 0;

    await Promise.all(
      Array.from({ length: 4 }, () =>
        withProfileAuthLock('default', async () => {
          runs += 1;
          active += 1;
          maxConcurrent = Math.max(maxConcurrent, active);
          await delay(20);
          active -= 1;
        })),
    );

    assert.equal(runs, 4);
    assert.equal(maxConcurrent, 1);
  });
});

test('auth lock commands use native process-owned locks on every supported platform', () => {
  const path = 'C:\\Users\\andreas\\.whoop-cli\\locks\\default.auth.lock';
  const windows = authLockCommandForPlatform('win32', path, {
    SystemRoot: 'C:\\Windows',
  });
  const macos = authLockCommandForPlatform('darwin', '/tmp/whoop.auth.lock');
  const linux = authLockCommandForPlatform('linux', '/tmp/whoop.auth.lock');

  assert.equal(
    windows.command,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.deepEqual(windows.args.slice(0, 4), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
  ]);
  assert.match(windows.args[4] ?? '', /FileShare\]::None/);
  assert.match(windows.args[4] ?? '', /ReadToEnd/);
  assert.equal(windows.env?.WHOOP_CLI_AUTH_LOCK_PATH, path);
  assert.equal(windows.env?.WHOOP_CLI_AUTH_LOCK_TIMEOUT_SECONDS, '30');

  assert.equal(macos.command, '/usr/bin/lockf');
  assert.deepEqual(macos.args.slice(0, 3), ['-t', '30', '/tmp/whoop.auth.lock']);
  assert.equal(macos.args[3], process.execPath);
  assert.equal(linux.command, 'flock');
  assert.deepEqual(linux.args.slice(0, 3), ['-w', '30', '/tmp/whoop.auth.lock']);
  assert.equal(linux.args[3], process.execPath);
});

test('withProfileAuthLock serializes separate CLI processes', async () => {
  await withTempHome(async (home) => {
    const eventsPath = join(home, 'events.log');
    const first = runLockWorker(home, eventsPath, 'first', 150);
    await waitForFileText(eventsPath, 'start-first');
    const second = runLockWorker(home, eventsPath, 'second', 0);

    await Promise.all([first, second]);

    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n');
    assert.deepEqual(events, ['start-first', 'end-first', 'start-second', 'end-second']);
  });
});

test('withProfileAuthLock ignores abandoned lock files and serializes cleanup contenders', async () => {
  await withTempHome(async (home) => {
    const lockDir = join(home, '.whoop-cli', 'locks');
    const eventsPath = join(home, 'events.log');
    const startPath = join(home, 'start');
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'default.auth.lock'), JSON.stringify({
      pid: 2_147_483_647,
      nonce: 'stale',
      createdAt: new Date().toISOString(),
    }), 'utf8');
    await writeFile(join(lockDir, 'default.auth.lock.recovery'), JSON.stringify({
      pid: 2_147_483_647,
      nonce: 'stale-recovery',
      createdAt: new Date().toISOString(),
    }), 'utf8');

    const workers = Array.from({ length: 8 }, (_, index) =>
      runLockWorker(home, eventsPath, String(index), 15, startPath));
    await delay(150);
    await writeFile(startPath, 'go', 'utf8');
    await Promise.all(workers);

    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n');
    let active = 0;
    let maxConcurrent = 0;
    for (const event of events) {
      active += event.startsWith('start-') ? 1 : -1;
      maxConcurrent = Math.max(maxConcurrent, active);
    }

    assert.equal(events.length, 16);
    assert.equal(active, 0);
    assert.equal(maxConcurrent, 1);
  });
});

test('withProfileAuthLock releases the kernel lock after an owning process exits', async () => {
  await withTempHome(async (home) => {
    const eventsPath = join(home, 'events.log');
    let owner: ChildProcess | undefined;
    const interrupted = runLockWorker(
      home,
      eventsPath,
      'interrupted',
      10_000,
      undefined,
      (child) => {
        owner = child;
      },
    ).then(
      () => undefined,
      () => undefined,
    );
    await waitForFileText(eventsPath, 'start-interrupted');
    owner?.kill('SIGKILL');
    await interrupted;

    await runLockWorker(home, eventsPath, 'recovered', 0);

    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n');
    assert.deepEqual(events, [
      'start-interrupted',
      'start-recovered',
      'end-recovered',
    ]);
  });
});
