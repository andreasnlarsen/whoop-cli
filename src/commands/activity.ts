import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchActivities } from '../http/whoop-data.js';
import { avg, round } from '../util/metrics.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';
import { applyActivityFilters, summarizeActivityKinds } from '../util/activity.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { WhoopCliError, usageError } from '../http/errors.js';

const genericActivityNote =
  'WHOOP generic "activity" entries are auto-detected and often unlabeled (for example housework/incidental movement), not always intentional training.';

const parseCsvStrings = (raw?: string): string[] =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const parseCsvNumbers = (raw?: string): number[] => {
  const values = parseCsvStrings(raw);
  const parsed = values.map((value) => Number(value));
  if (parsed.some((value) => !Number.isInteger(value))) {
    throw usageError('sport-id must be a comma-separated list of integers', { value: raw });
  }
  return parsed;
};

const assertFilterMode = (opts: { genericOnly?: boolean; labeledOnly?: boolean }): void => {
  if (opts.genericOnly && opts.labeledOnly) {
    throw usageError('generic-only and labeled-only cannot be used together');
  }
};

export const registerActivityCommands = (program: Command): void => {
  const activity = program
    .command('activity')
    .description('Activity commands (single source of truth: fetch raw WHOOP activities, then filter)');

  activity
    .command('list')
    .description('List WHOOP activities (training + generic auto-detected movement)')
    .option('--start <YYYY-MM-DD>')
    .option('--end <YYYY-MM-DD>')
    .option('--days <n>', 'lookback days if start/end not provided', '14')
    .option('--limit <n>', 'page size', '25')
    .option('--all', 'follow pagination and fetch all pages')
    .option('--sport-id <ids>', 'comma-separated sport_id values to include')
    .option('--sport-name <names>', 'comma-separated sport_name values to include (case-insensitive exact match)')
    .option('--generic-only', 'include only generic auto-detected activity rows')
    .option('--labeled-only', 'exclude generic auto-detected activity rows (training/labeled only)')
    .action(async function listAction(opts) {
      try {
        assertFilterMode(opts);

        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const range = parseDateRange({
          start: opts.start,
          end: opts.end,
          days: parseMaybeNumber(opts.days),
        });

        const records = await fetchActivities(client, {
          ...range,
          limit: parseMaybeNumber(opts.limit),
          all: Boolean(opts.all),
          timeoutMs: globals.timeoutMs,
        });

        const sportIds = parseCsvNumbers(opts.sportId);
        const sportNames = parseCsvStrings(opts.sportName);
        const genericOnly = Boolean(opts.genericOnly);
        const labeledOnly = Boolean(opts.labeledOnly);

        const filteredRecords = applyActivityFilters(records, {
          sportIds,
          sportNames,
          genericOnly,
          labeledOnly,
        });

        const kindSummary = summarizeActivityKinds(records);

        printData(this, {
          count: filteredRecords.length,
          ...kindSummary,
          note: kindSummary.genericActivityCount > 0 ? genericActivityNote : undefined,
          filters: {
            sportIds,
            sportNames,
            genericOnly,
            labeledOnly,
          },
          records: filteredRecords,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  activity
    .command('trend')
    .description('Trend summary over WHOOP activities with optional filters')
    .option('--days <n>', 'lookback days', '14')
    .option('--limit <n>', 'page size', '25')
    .option('--sport-id <ids>', 'comma-separated sport_id values to include')
    .option('--sport-name <names>', 'comma-separated sport_name values to include (case-insensitive exact match)')
    .option('--generic-only', 'include only generic auto-detected activity rows')
    .option('--labeled-only', 'exclude generic auto-detected activity rows (training/labeled only)')
    .action(async function trendAction(opts) {
      try {
        assertFilterMode(opts);

        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 14;

        const records = await fetchActivities(client, {
          ...parseDateRange({ days }),
          limit: parseMaybeNumber(opts.limit),
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const sportIds = parseCsvNumbers(opts.sportId);
        const sportNames = parseCsvStrings(opts.sportName);
        const genericOnly = Boolean(opts.genericOnly);
        const labeledOnly = Boolean(opts.labeledOnly);

        const filteredRecords = applyActivityFilters(records, {
          sportIds,
          sportNames,
          genericOnly,
          labeledOnly,
        });

        const kindSummary = summarizeActivityKinds(records);

        const avgStrain = round(avg(filteredRecords.map((r) => r.score?.strain)), 2);
        const avgHr = round(avg(filteredRecords.map((r) => r.score?.average_heart_rate)), 1);

        const bySport = filteredRecords.reduce<Record<string, number>>((acc, r) => {
          const sport = r.sport_name ?? 'unknown';
          acc[sport] = (acc[sport] ?? 0) + 1;
          return acc;
        }, {});

        printData(this, {
          windowDays: days,
          activities: filteredRecords.length,
          ...kindSummary,
          note: kindSummary.genericActivityCount > 0 ? genericActivityNote : undefined,
          filters: {
            sportIds,
            sportNames,
            genericOnly,
            labeledOnly,
          },
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

  activity
    .command('types')
    .description('List observed activity types (sport_id + sport_name) for dynamic filtering')
    .option('--days <n>', 'lookback days', '30')
    .option('--limit <n>', 'page size', '25')
    .action(async function typesAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 30;

        const records = await fetchActivities(client, {
          ...parseDateRange({ days }),
          limit: parseMaybeNumber(opts.limit),
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const counts = new Map<string, { sportId: number | null; sportName: string; count: number }>();

        for (const record of records) {
          const sportId = typeof record.sport_id === 'number' ? record.sport_id : null;
          const sportName = record.sport_name ?? 'unknown';
          const key = `${sportId ?? 'null'}::${sportName}`;
          const bucket = counts.get(key) ?? { sportId, sportName, count: 0 };
          bucket.count += 1;
          counts.set(key, bucket);
        }

        const types = Array.from(counts.values()).sort((a, b) => b.count - a.count);
        const kindSummary = summarizeActivityKinds(records);

        printData(this, {
          windowDays: days,
          ...kindSummary,
          note: kindSummary.genericActivityCount > 0 ? genericActivityNote : undefined,
          types,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  activity
    .command('map-v1-id')
    .description('Lookup v2 activity UUID from legacy v1 activity ID')
    .requiredOption('--id <activityV1Id>', 'legacy v1 activity id')
    .action(async function mapV1IdAction(opts) {
      const globals = getGlobalOptions(this);
      const id = Number(opts.id);

      try {
        if (Number.isNaN(id) || id <= 0) {
          throw usageError('id must be a positive integer', { value: opts.id });
        }

        const client = new WhoopApiClient(globals.profile);
        const data = await client.requestJson<{ v2_activity_id?: string }>({
          path: `/developer/v1/activity-mapping/${id}`,
          timeoutMs: globals.timeoutMs,
        });

        printData(this, {
          activityV1Id: id,
          activityV2Id: data.v2_activity_id ?? null,
          found: Boolean(data.v2_activity_id),
        });
      } catch (err) {
        if (
          err instanceof WhoopCliError &&
          err.code === 'HTTP_ERROR' &&
          typeof err.details === 'object' &&
          err.details !== null &&
          (err.details as { status?: number }).status === 404
        ) {
          printData(this, {
            activityV1Id: id,
            activityV2Id: null,
            found: false,
          });
          return;
        }

        printError(this, err);
      }
    });
};
