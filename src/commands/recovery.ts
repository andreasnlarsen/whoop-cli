import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchRecoveries } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';

export const registerRecoveryCommands = (program: Command): void => {
  const recovery = program.command('recovery').description('Recovery commands');

  recovery
    .command('latest')
    .description('Fetch latest recovery record')
    .action(async function latestAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const records = await fetchRecoveries(client, {
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

  recovery
    .command('list')
    .description('List recovery records')
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

        const records = await fetchRecoveries(client, {
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
