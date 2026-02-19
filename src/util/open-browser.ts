import { spawn } from 'node:child_process';

export const tryOpenBrowser = (url: string): boolean => {
  const cmds: Array<[string, string[]]> = [
    ['xdg-open', [url]],
    ['open', [url]],
    ['cmd', ['/c', 'start', '', url]],
  ];

  for (const [cmd, args] of cmds) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.unref();
      return true;
    } catch {
      // try next
    }
  }

  return false;
};
