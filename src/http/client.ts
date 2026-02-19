import { authError, httpError, networkError } from './errors.js';
import { ensureFreshToken, refreshProfileToken } from '../auth/token-service.js';
import type { WhoopProfile } from '../store/profile-store.js';

export interface RequestOptions {
  path: string;
  query?: Record<string, string | number | undefined>;
  timeoutMs: number;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  retryOn401?: boolean;
}

export class WhoopApiClient {
  constructor(private profileName: string) {}

  private buildUrl(profile: WhoopProfile, path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path, profile.baseUrl);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  public async requestJson<T>(opts: RequestOptions): Promise<T> {
    const profile = await ensureFreshToken(this.profileName);
    return this.runRequest<T>(profile, opts);
  }

  private async runRequest<T>(profile: WhoopProfile, opts: RequestOptions): Promise<T> {
    const token = profile.tokens?.accessToken;
    if (!token) {
      throw authError('Profile has no access token. Run whoop auth login.');
    }

    const url = this.buildUrl(profile, opts.path, opts.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': opts.body ? 'application/json' : 'application/json',
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // leave as text
      }

      if (res.status === 401 && (opts.retryOn401 ?? true)) {
        const refreshed = await refreshProfileToken(this.profileName);
        return this.runRequest<T>(refreshed, { ...opts, retryOn401: false });
      }

      if (!res.ok) {
        throw httpError(`WHOOP API request failed (${res.status})`, {
          status: res.status,
          path: opts.path,
          response: parsed,
        });
      }

      return parsed as T;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw networkError('WHOOP API request timed out', {
          timeoutMs: opts.timeoutMs,
          path: opts.path,
        });
      }

      if ((err as Error).name === 'WhoopCliError') throw err;

      throw networkError('WHOOP API network request failed', {
        path: opts.path,
        cause: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  public async getCollection<T>(
    path: string,
    opts: {
      limit?: number;
      start?: string;
      end?: string;
      all?: boolean;
      maxPages?: number;
      timeoutMs: number;
    },
  ): Promise<T[]> {
    const records: T[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    const pageLimit = opts.all ? opts.maxPages ?? 200 : 1;

    const normalizeDateBoundary = (value: string | undefined, kind: 'start' | 'end'): string | undefined => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      return kind === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
    };

    do {
      const response = await this.requestJson<{ records?: T[]; next_token?: string }>({
        path,
        timeoutMs: opts.timeoutMs,
        query: {
          limit: opts.limit,
          start: normalizeDateBoundary(opts.start, 'start'),
          end: normalizeDateBoundary(opts.end, 'end'),
          nextToken,
        },
      });

      const current = response.records ?? [];
      records.push(...current);
      nextToken = response.next_token;
      pages += 1;
    } while (nextToken && pages < pageLimit);

    return records;
  }
}
