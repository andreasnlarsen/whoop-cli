import type { Command } from 'commander';
import { DEFAULT_BASE_URL } from '../util/config.js';
import { fromError, ok, stringifyEnvelope } from '../output/envelope.js';
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
    profile: opts.profile ?? 'default',
    baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
    timeoutMs: Number(opts.timeoutMs ?? '10000'),
  };
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
  const globals = getGlobalOptions(command);
  const normalized = normalizeError(err);

  if (globals.json) {
    console.log(stringifyEnvelope(fromError(normalized), globals.pretty));
  } else {
    console.error(`${normalized.code}: ${normalized.message}`);
    if (normalized.details) {
      console.error(JSON.stringify(normalized.details, null, 2));
    }
  }

  process.exit(normalized.exitCode);
};
