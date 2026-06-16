import { homedir } from 'node:os';
import { join } from 'node:path';
import { configError } from '../http/errors.js';

export const DEFAULT_BASE_URL = 'https://api.prod.whoop.com';
const ALLOWED_WHOOP_HOST = 'api.prod.whoop.com';

export const sanitizeProfileName = (profile: string): string => {
  const trimmed = profile.trim();
  if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw configError('Profile names may only contain letters, numbers, dashes, and underscores.');
  }

  return trimmed;
};

export const normalizeBaseUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw configError('Invalid WHOOP base URL.');
  }

  if (url.protocol !== 'https:') {
    throw configError('WHOOP base URL must use HTTPS.');
  }

  if (url.hostname !== ALLOWED_WHOOP_HOST || url.port) {
    throw configError(`WHOOP base URL must be https://${ALLOWED_WHOOP_HOST}.`);
  }

  return `https://${ALLOWED_WHOOP_HOST}`;
};

export const whoopHome = (): string => join(homedir(), '.whoop-cli');

export const profilePath = (profile: string): string =>
  join(whoopHome(), 'profiles', `${sanitizeProfileName(profile)}.json`);

export const localVpsSecretPath = (profile: string): string =>
  join(whoopHome(), 'secrets', `${sanitizeProfileName(profile)}.json`);

export const experimentsPath = (): string => join(whoopHome(), 'experiments.json');

export const behaviorLogPath = (): string => join(whoopHome(), 'journal-observations.jsonl');

export const tokenRefreshSkewSeconds = 120;
