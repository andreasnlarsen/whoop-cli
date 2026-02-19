export type ErrorCode =
  | 'USAGE_ERROR'
  | 'CONFIG_ERROR'
  | 'AUTH_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'FEATURE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class WhoopCliError extends Error {
  public readonly code: ErrorCode;
  public readonly exitCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, exitCode: number, details?: unknown) {
    super(message);
    this.name = 'WhoopCliError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export const usageError = (message: string, details?: unknown) =>
  new WhoopCliError('USAGE_ERROR', message, 2, details);

export const configError = (message: string, details?: unknown) =>
  new WhoopCliError('CONFIG_ERROR', message, 2, details);

export const authError = (message: string, details?: unknown) =>
  new WhoopCliError('AUTH_ERROR', message, 3, details);

export const httpError = (message: string, details?: unknown) =>
  new WhoopCliError('HTTP_ERROR', message, 4, details);

export const networkError = (message: string, details?: unknown) =>
  new WhoopCliError('NETWORK_ERROR', message, 4, details);

export const notFoundError = (message: string, details?: unknown) =>
  new WhoopCliError('NOT_FOUND', message, 4, details);

export const featureUnavailableError = (message: string, details?: unknown) =>
  new WhoopCliError('FEATURE_UNAVAILABLE', message, 2, details);

export const normalizeError = (err: unknown): WhoopCliError => {
  if (err instanceof WhoopCliError) return err;
  if (err instanceof Error) {
    return new WhoopCliError('INTERNAL_ERROR', err.message, 1);
  }
  return new WhoopCliError('INTERNAL_ERROR', String(err), 1);
};
