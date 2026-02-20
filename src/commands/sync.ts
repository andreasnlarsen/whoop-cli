import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { WhoopApiClient } from '../http/client.js';
import { fetchActivities, fetchCycles, fetchRecoveries, fetchSleeps } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { parseDateRange } from '../util/time.js';
import { usageError } from '../http/errors.js';

const jsonl = (records: Array<{ type: string; payload: unknown }>): string =>
  records.map((r) => JSON.stringify(r)).join('\n') + '\n';

export const registerSyncCommands = (program: Command): void => {
  const sync = program.command('sync').description('Data export helpers');

  sync
    .command('pull')
    .description('Pull WHOOP data and export as JSONL')
    .requiredOption('--start <YYYY-MM-DD>')
    .requiredOption('--end <YYYY-MM-DD>')
    .requiredOption('--out <path>')
    .option('--limit <n>', 'page size', '25')
    .action(async function pullAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const start = opts.start as string;
        const end = opts.end as string;
        const out = opts.out as string;

        const range = parseDateRange({ start, end });
        if (!range.start || !range.end) {
          throw usageError('start and end are required for sync pull');
        }

        const client = new WhoopApiClient(globals.profile);
        const limit = Number(opts.limit ?? 25);

        const [recoveries, sleeps, cycles, activities] = await Promise.all([
          fetchRecoveries(client, { ...range, all: true, limit, timeoutMs: globals.timeoutMs }),
          fetchSleeps(client, { ...range, all: true, limit, timeoutMs: globals.timeoutMs }),
          fetchCycles(client, { ...range, all: true, limit, timeoutMs: globals.timeoutMs }),
          fetchActivities(client, { ...range, all: true, limit, timeoutMs: globals.timeoutMs }),
        ]);

        const rows: Array<{ type: string; payload: unknown }> = [];
        recoveries.forEach((r) => rows.push({ type: 'recovery', payload: r }));
        sleeps.forEach((r) => rows.push({ type: 'sleep', payload: r }));
        cycles.forEach((r) => rows.push({ type: 'cycle', payload: r }));
        activities.forEach((r) => rows.push({ type: 'activity', payload: r }));

        await writeFile(out, jsonl(rows), 'utf8');

        printData(this, {
          out,
          range,
          counts: {
            recoveries: recoveries.length,
            sleeps: sleeps.length,
            cycles: cycles.length,
            activities: activities.length,
            totalRows: rows.length,
          },
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
