import { spawn } from 'node:child_process';

const getOpenCommands = (url: string): Array<[string, string[]]> => {
  if (process.platform === 'darwin') {
    return [
      ['open', [url]],
      ['xdg-open', [url]],
      ['cmd', ['/c', 'start', '', url]],
    ];
  }

  if (process.platform === 'win32') {
    return [
      ['cmd', ['/c', 'start', '', url]],
      ['xdg-open', [url]],
      ['open', [url]],
    ];
  }

  return [
    ['xdg-open', [url]],
    ['open', [url]],
    ['cmd', ['/c', 'start', '', url]],
  ];
};

const tryCommand = (cmd: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      child.once('error', () => finish(false));
      child.once('spawn', () => finish(true));
      child.unref();

      setTimeout(() => finish(true), 200);
    } catch {
      resolve(false);
    }
  });

export const tryOpenBrowser = async (url: string): Promise<boolean> => {
  const cmds = getOpenCommands(url);

  for (const [cmd, args] of cmds) {
    if (await tryCommand(cmd, args)) {
      return true;
    }
  }

  return false;
};
