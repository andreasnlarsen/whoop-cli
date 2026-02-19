import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchSleeps } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { avg, round } from '../util/metrics.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';

export const registerSleepCommands = (program: Command): void => {
  const sleep = program.command('sleep').description('Sleep commands');

  sleep
    .command('latest')
    .description('Fetch latest sleep record')
    .action(async function latestAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const records = await fetchSleeps(client, {
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

  sleep
    .command('list')
    .description('List sleep records')
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

        const records = await fetchSleeps(client, {
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

  sleep
    .command('trend')
    .description('Sleep trend summary over a period')
    .option('--days <n>', 'lookback days', '30')
    .option('--limit <n>', 'page size', '25')
    .action(async function trendAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 30;

        const records = await fetchSleeps(client, {
          ...parseDateRange({ days }),
          limit: parseMaybeNumber(opts.limit),
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const performance = round(avg(records.map((r) => r.score?.sleep_performance_percentage)), 1);
        const consistency = round(avg(records.map((r) => r.score?.sleep_consistency_percentage)), 1);
        const efficiency = round(avg(records.map((r) => r.score?.sleep_efficiency_percentage)), 1);

        printData(this, {
          windowDays: days,
          records: records.length,
          averages: {
            sleepPerformancePct: performance,
            sleepConsistencyPct: consistency,
            sleepEfficiencyPct: efficiency,
          },
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
