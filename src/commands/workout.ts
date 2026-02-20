import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchWorkouts } from '../http/whoop-data.js';
import type { WorkoutRecord } from '../models/whoop.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { avg, round } from '../util/metrics.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';

const isGenericActivity = (record: WorkoutRecord): boolean =>
  (record.sport_name ?? '').toLowerCase() === 'activity' || record.sport_id === -1;

const genericActivityNote =
  'WHOOP generic "activity" entries are auto-detected and often unlabeled (for example housework/daily movement), not always intentional workouts. Use --exclude-generic-activity for training-only views.';

export const registerWorkoutCommands = (program: Command): void => {
  const workout = program.command('workout').description('Workout commands');

  workout
    .command('list')
    .description('List workout/activity records (WHOOP auto-logged generic "activity" can be non-workout movement)')
    .option('--start <YYYY-MM-DD>')
    .option('--end <YYYY-MM-DD>')
    .option('--days <n>', 'lookback days if start/end not provided', '14')
    .option('--limit <n>', 'page size', '25')
    .option('--all', 'follow pagination and fetch all pages')
    .option(
      '--exclude-generic-activity',
      'exclude generic auto-detected WHOOP "activity" rows (often unlabeled movement like housework)',
    )
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

        const genericActivityCount = records.filter(isGenericActivity).length;
        const filteredRecords = opts.excludeGenericActivity
          ? records.filter((record) => !isGenericActivity(record))
          : records;

        printData(this, {
          count: filteredRecords.length,
          totalFetched: records.length,
          genericActivityCount,
          structuredWorkoutCount: records.length - genericActivityCount,
          note: genericActivityCount > 0 ? genericActivityNote : undefined,
          records: filteredRecords,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  workout
    .command('trend')
    .description('Workout trend summary (WHOOP generic "activity" may include non-workout movement)')
    .option('--days <n>', 'lookback days', '14')
    .option('--limit <n>', 'page size', '25')
    .option(
      '--exclude-generic-activity',
      'exclude generic auto-detected WHOOP "activity" rows (often unlabeled movement like housework)',
    )
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

        const genericActivityCount = records.filter(isGenericActivity).length;
        const analyzedRecords = opts.excludeGenericActivity
          ? records.filter((record) => !isGenericActivity(record))
          : records;

        const avgStrain = round(avg(analyzedRecords.map((r) => r.score?.strain)), 2);
        const avgHr = round(avg(analyzedRecords.map((r) => r.score?.average_heart_rate)), 1);

        const bySport = analyzedRecords.reduce<Record<string, number>>((acc, r) => {
          const sport = r.sport_name ?? 'unknown';
          acc[sport] = (acc[sport] ?? 0) + 1;
          return acc;
        }, {});

        printData(this, {
          windowDays: days,
          workouts: analyzedRecords.length,
          totalFetched: records.length,
          genericActivityCount,
          structuredWorkoutCount: records.length - genericActivityCount,
          note: genericActivityCount > 0 ? genericActivityNote : undefined,
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
