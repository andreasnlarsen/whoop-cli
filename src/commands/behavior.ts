import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { WhoopApiClient } from '../http/client.js';
import { fetchRecoveries } from '../http/whoop-data.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { behaviorLogPath } from '../util/config.js';
import { avg, round } from '../util/metrics.js';
import { featureUnavailableError, usageError } from '../http/errors.js';

interface BehaviorLogRow {
  date: string;
  behaviors: Record<string, boolean>;
}

const readBehaviorLog = async (path: string): Promise<BehaviorLogRow[]> => {
  const content = await readFile(path, 'utf8');
  const rows: BehaviorLogRow[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as BehaviorLogRow);
  }
  return rows;
};

export const registerBehaviorCommands = (program: Command): void => {
  const behavior = program.command('behavior').description('Behavior impact and experiments');

  behavior
    .command('impacts')
    .description('Estimate behavior impacts from local behavior log + WHOOP recoveries')
    .option('--file <path>', 'behavior log jsonl path', behaviorLogPath())
    .option('--days <n>', 'lookback days', '30')
    .action(async function impactsAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const file = opts.file as string;
        const days = Number(opts.days ?? 30);
        if (Number.isNaN(days) || days <= 0) throw usageError('days must be > 0');

        const rows = await readBehaviorLog(file).catch(() => {
          throw featureUnavailableError(
            'Behavior impacts require a local behavior log JSONL file. WHOOP public API does not currently expose Journal behavior impacts directly.',
            { file },
          );
        });

        const client = new WhoopApiClient(globals.profile);
        const recoveries = await fetchRecoveries(client, {
          ...{ start: undefined, end: undefined },
          limit: 25,
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const recoveryByDate = new Map<string, number>();
        for (const r of recoveries) {
          const created = r.created_at?.slice(0, 10);
          const score = r.score?.recovery_score;
          if (created && typeof score === 'number') {
            recoveryByDate.set(created, score);
          }
        }

        const behaviorScores = new Map<string, { yes: number[]; no: number[] }>();

        for (const row of rows) {
          const score = recoveryByDate.get(row.date);
          if (typeof score !== 'number') continue;
          for (const [behaviorName, active] of Object.entries(row.behaviors)) {
            const bucket = behaviorScores.get(behaviorName) ?? { yes: [], no: [] };
            (active ? bucket.yes : bucket.no).push(score);
            behaviorScores.set(behaviorName, bucket);
          }
        }

        const impacts = Array.from(behaviorScores.entries())
          .map(([behaviorName, bucket]) => {
            const yesAvg = avg(bucket.yes);
            const noAvg = avg(bucket.no);
            const delta = yesAvg !== null && noAvg !== null ? yesAvg - noAvg : null;
            return {
              behavior: behaviorName,
              yesCount: bucket.yes.length,
              noCount: bucket.no.length,
              yesRecoveryAvg: round(yesAvg, 1),
              noRecoveryAvg: round(noAvg, 1),
              deltaRecovery: round(delta, 1),
            };
          })
          .sort((a, b) => (b.deltaRecovery ?? -999) - (a.deltaRecovery ?? -999));

        printData(this, {
          source: file,
          records: rows.length,
          impacts,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
