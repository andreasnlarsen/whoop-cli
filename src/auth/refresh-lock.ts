import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, open } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';
import { configError } from '../http/errors.js';
import { profileAuthLockPath } from '../util/config.js';
import { ensureDir } from '../util/fs.js';

const localTails = new Map<string, Promise<void>>();
const lockTimeoutSeconds = 30;
const nodeLockHolderScript = 'process.stdin.pipe(process.stdout)';
const windowsLockPathEnv = 'WHOOP_CLI_AUTH_LOCK_PATH';
const windowsLockTimeoutEnv = 'WHOOP_CLI_AUTH_LOCK_TIMEOUT_SECONDS';
const windowsLockHolderScript = `
$lockPath = $env:${windowsLockPathEnv}
$timeoutSeconds = [int]$env:${windowsLockTimeoutEnv}
$deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
$stream = $null

while ($null -eq $stream) {
  try {
    $stream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch [System.IO.IOException] {
    if ([DateTime]::UtcNow -ge $deadline) {
      exit 1
    }
    Start-Sleep -Milliseconds 100
  }
}

try {
  $marker = [Console]::In.ReadLine()
  if ($null -eq $marker) {
    exit 2
  }
  [Console]::Out.WriteLine($marker)
  [Console]::Out.Flush()
  [Console]::In.ReadToEnd() | Out-Null
} finally {
  $stream.Dispose()
}
`;

interface KernelLockCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  missingHelperMessage?: string;
}

/** @internal Exported for platform-command regression tests. */
export const authLockCommandForPlatform = (
  platform: NodeJS.Platform,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): KernelLockCommand => {
  if (platform === 'darwin') {
    return {
      command: '/usr/bin/lockf',
      args: [
        '-t',
        String(lockTimeoutSeconds),
        path,
        process.execPath,
        '-e',
        nodeLockHolderScript,
      ],
    };
  }

  if (platform === 'linux') {
    return {
      command: 'flock',
      args: [
        '-w',
        String(lockTimeoutSeconds),
        path,
        process.execPath,
        '-e',
        nodeLockHolderScript,
      ],
      missingHelperMessage:
        'WHOOP authentication locking on Linux requires the `flock` command from util-linux.',
    };
  }

  if (platform === 'win32') {
    const systemRoot = env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows';
    return {
      command: win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        windowsLockHolderScript,
      ],
      env: {
        ...env,
        [windowsLockPathEnv]: path,
        [windowsLockTimeoutEnv]: String(lockTimeoutSeconds),
      },
      missingHelperMessage:
        'WHOOP authentication locking on Windows requires Windows PowerShell.',
    };
  }

  throw configError(`WHOOP authentication locking is not supported on ${platform}.`);
};

const acquireKernelFileLock = async (profileName: string): Promise<() => Promise<void>> => {
  const path = profileAuthLockPath(profileName);
  await ensureDir(dirname(path));
  if (process.platform !== 'win32') {
    const lockFile = await open(path, 'a', 0o600);
    await lockFile.close();
    await chmod(path, 0o600);
  }

  const helper = authLockCommandForPlatform(process.platform, path);
  const marker = `whoop-auth-lock-${randomUUID()}`;
  const child = spawn(helper.command, helper.args, {
    env: helper.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let acquired = false;
  let acquireTimer: NodeJS.Timeout | undefined;

  await new Promise<void>((resolve, reject) => {
    const finishWithError = (message: string, details?: unknown): void => {
      if (acquired) return;
      if (acquireTimer) clearTimeout(acquireTimer);
      reject(configError(message, details));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!acquired && stdout.includes(marker)) {
        acquired = true;
        if (acquireTimer) clearTimeout(acquireTimer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (err) => {
      const helperMissing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      finishWithError(
        helperMissing && helper.missingHelperMessage
          ? helper.missingHelperMessage
          : 'Unable to start the WHOOP authentication lock helper.',
        { cause: err.message },
      );
    });
    child.stdin.once('error', (err) => {
      finishWithError('Unable to communicate with the WHOOP authentication lock helper.', {
        cause: err.message,
      });
    });
    child.once('close', (code) => {
      finishWithError('Timed out waiting for another WHOOP authentication operation to finish.', {
        profile: profileName,
        lockPath: path,
        timeoutMs: lockTimeoutSeconds * 1000,
        exitCode: code,
        detail: stderr.trim() || undefined,
      });
    });

    acquireTimer = setTimeout(() => {
      finishWithError('Timed out waiting for the WHOOP authentication lock helper.', {
        profile: profileName,
        lockPath: path,
        timeoutMs: (lockTimeoutSeconds + 1) * 1000,
      });
      child.kill();
    }, (lockTimeoutSeconds + 1) * 1000);

    child.stdin.write(`${marker}\n`);
  });

  return async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      child.stdin.end();
    });
  };
};

const withLocalQueue = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = localTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  localTails.set(key, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (localTails.get(key) === tail) {
      localTails.delete(key);
    }
  }
};

export const withProfileAuthLock = async <T>(profileName: string, fn: () => Promise<T>): Promise<T> =>
  withLocalQueue(profileName, async () => {
    const releaseFileLock = await acquireKernelFileLock(profileName);
    try {
      return await fn();
    } finally {
      await releaseFileLock();
    }
  });
