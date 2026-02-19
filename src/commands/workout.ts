import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchWorkouts } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { avg, round } from '../util/metrics.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';

export const registerWorkoutCommands = (program: Command): void => {
  const workout = program.command('workout').description('Workout commands');

  workout
    .command('list')
    .description('List workouts')
    .option('--start <YYYY-MM-DD>')
    .option('--end <YYYY-MM-DD>')
    .option('--days <n>', 'lookback days if start/end not provided', '14')
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

        const records = await fetchWorkouts(client, {
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

  workout
    .command('trend')
    .description('Workout trend summary')
    .option('--days <n>', 'lookback days', '14')
    .option('--limit <n>', 'page size', '25')
    .action(async function trendAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 14;

        const records = await fetchWorkouts(client, {
          ...parseDateRange({ days }),
          limit: parseMaybeNumber(opts.limit),
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const avgStrain = round(avg(records.map((r) => r.score?.strain)), 2);
        const avgHr = round(avg(records.map((r) => r.score?.average_heart_rate)), 1);

        const bySport = records.reduce<Record<string, number>>((acc, r) => {
          const sport = r.sport_name ?? 'unknown';
          acc[sport] = (acc[sport] ?? 0) + 1;
          return acc;
        }, {});

        printData(this, {
          windowDays: days,
          workouts: records.length,
          averages: {
            strain: avgStrain,
            averageHeartRate: avgHr,
          },
          bySport,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
