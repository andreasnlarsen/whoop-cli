import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchCycles } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';

export const registerCycleCommands = (program: Command): void => {
  const cycle = program.command('cycle').description('Cycle commands');

  cycle
    .command('latest')
    .description('Fetch latest physiological cycle')
    .action(async function latestAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const records = await fetchCycles(client, {
          limit: 1,
          timeoutMs: globals.timeoutMs,
        });

        printData(this, {
          latest: records[0] ?? null,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  cycle
    .command('list')
    .description('List cycles')
    .option('--start <YYYY-MM-DD>')
    .option('--end <YYYY-MM-DD>')
    .option('--days <n>', 'lookback days if start/end not provided')
    .option('--limit <n>', 'page size', '25')
    .option('--all', 'follow pagination and fetch all pages')
    .action(async function listAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const range = parseDateRange({
          start: opts.start,
          end: opts.end,
          days: parseMaybeNumber(opts.days),
        });

        const records = await fetchCycles(client, {
          ...range,
          limit: parseMaybeNumber(opts.limit),
          all: Boolean(opts.all),
          timeoutMs: globals.timeoutMs,
        });

        printData(this, {
          count: records.length,
          records,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
