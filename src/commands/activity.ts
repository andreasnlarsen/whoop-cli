import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { WhoopCliError, usageError } from '../http/errors.js';

export const registerActivityCommands = (program: Command): void => {
  const activity = program.command('activity').description('Activity migration and lookup helpers');

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
