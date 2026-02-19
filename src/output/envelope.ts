import { normalizeError } from '../http/errors.js';

export interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

export interface Envelope<T> {
  data: T | null;
  error: ErrorEnvelope | null;
}

export const ok = <T>(data: T): Envelope<T> => ({ data, error: null });

export const fail = (code: string, message: string, details?: unknown): Envelope<never> => ({
  data: null,
  error: {
    code,
    message,
    details,
  },
});

export const fromError = (err: unknown): Envelope<never> => {
  const e = normalizeError(err);
  return fail(e.code, e.message, e.details);
};

export const stringifyEnvelope = (envelope: Envelope<unknown>, pretty = false): string =>
  JSON.stringify(envelope, null, pretty ? 2 : 0);
