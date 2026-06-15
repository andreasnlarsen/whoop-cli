import type { Command } from 'commander';
import { DEFAULT_BASE_URL, normalizeBaseUrl, sanitizeProfileName } from '../util/config.js';
import { fail, ok, stringifyEnvelope } from '../output/envelope.js';
import { normalizeError } from '../http/errors.js';

export interface GlobalOptions {
  json: boolean;
  pretty: boolean;
  profile: string;
  baseUrl: string;
  timeoutMs: number;
}

export const getGlobalOptions = (command: Command): GlobalOptions => {
  const opts = command.optsWithGlobals<{
    json?: boolean;
    pretty?: boolean;
    profile?: string;
    baseUrl?: string;
    timeoutMs?: string;
  }>();

  return {
    json: Boolean(opts.json),
    pretty: Boolean(opts.pretty),
    profile: sanitizeProfileName(opts.profile ?? 'default'),
    baseUrl: normalizeBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL),
    timeoutMs: Number(opts.timeoutMs ?? '10000'),
  };
};

const getOutputOptions = (command: Command): Pick<GlobalOptions, 'json' | 'pretty'> => {
  const opts = command.optsWithGlobals<{
    json?: boolean;
    pretty?: boolean;
  }>();
  return {
    json: Boolean(opts.json),
    pretty: Boolean(opts.pretty),
  };
};

const redactDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactDetails(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/(secret|token|authorization|cookie)/i.test(key)) {
          return [key, '[REDACTED]'];
        }

        return [key, redactDetails(item)];
      }),
    );
  }

  return value;
};

export const printData = (command: Command, data: unknown): void => {
  const globals = getGlobalOptions(command);
  if (globals.json) {
    console.log(stringifyEnvelope(ok(data), globals.pretty));
    return;
  }

  if (typeof data === 'string') {
    console.log(data);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
};

export const printError = (command: Command, err: unknown): never => {
  const output = getOutputOptions(command);
  const normalized = normalizeError(err);
  const details = redactDetails(normalized.details);

  if (output.json) {
    console.log(stringifyEnvelope(fail(normalized.code, normalized.message, details), output.pretty));
  } else {
    console.error(`${normalized.code}: ${normalized.message}`);
    if (details) {
      console.error(JSON.stringify(details, null, 2));
    }
  }

  process.exit(normalized.exitCode);
};
