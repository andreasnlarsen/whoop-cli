const locks = new Map<string, Promise<void>>();

export const withRefreshLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const current = locks.get(key);
  if (current) {
    await current;
  }

  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  locks.set(key, gate);

  try {
    return await fn();
  } finally {
    locks.delete(key);
    resolve();
  }
};
