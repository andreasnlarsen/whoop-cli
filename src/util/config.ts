import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.prod.whoop.com';

export const whoopHome = (): string => join(homedir(), '.whoop-cli');

export const profilePath = (profile: string): string =>
  join(whoopHome(), 'profiles', `${profile}.json`);

export const experimentsPath = (): string => join(whoopHome(), 'experiments.json');

export const behaviorLogPath = (): string => join(whoopHome(), 'journal-observations.jsonl');

export const tokenRefreshSkewSeconds = 120;
