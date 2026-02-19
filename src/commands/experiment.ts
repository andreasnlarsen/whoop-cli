import { Command } from 'commander';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import { experimentsPath } from '../util/config.js';
import { assertIsoDate, daysAgoIso } from '../util/time.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { usageError } from '../http/errors.js';
import { WhoopApiClient } from '../http/client.js';
import { fetchRecoveries } from '../http/whoop-data.js';
import { avg, round } from '../util/metrics.js';

interface Experiment {
  id: string;
  name: string;
  behavior: string;
  startDate: string;
  endDate?: string;
  createdAt: string;
}

interface ExperimentStore {
  experiments: Experiment[];
}

const loadStore = async (): Promise<ExperimentStore> => {
  const store = await readJsonFile<ExperimentStore>(experimentsPath());
  return store ?? { experiments: [] };
};

const saveStore = async (store: ExperimentStore): Promise<void> => {
  await writeJsonFileSecure(experimentsPath(), store);
};

const makeId = (): string => Math.random().toString(36).slice(2, 10);

export const registerExperimentCommands = (program: Command): void => {
  const experiment = program.command('experiment').description('Behavior experiment tracking');

  experiment
    .command('start')
    .description('Start a behavior experiment')
    .requiredOption('--name <name>')
    .requiredOption('--behavior <behavior>')
    .option('--start-date <YYYY-MM-DD>', 'default: today UTC')
    .option('--end-date <YYYY-MM-DD>')
    .action(async function startAction(opts) {
      try {
        const startDate = opts.startDate ? assertIsoDate(opts.startDate, 'start-date') : daysAgoIso(0);
        const endDate = opts.endDate ? assertIsoDate(opts.endDate, 'end-date') : undefined;

        const store = await loadStore();
        const item: Experiment = {
          id: makeId(),
          name: String(opts.name),
          behavior: String(opts.behavior),
          startDate,
          endDate,
          createdAt: new Date().toISOString(),
        };

        store.experiments.unshift(item);
        await saveStore(store);
        printData(this, item);
      } catch (err) {
        printError(this, err);
      }
    });

  experiment
    .command('list')
    .description('List saved experiments')
    .action(async function listAction() {
      try {
        const store = await loadStore();
        printData(this, { count: store.experiments.length, experiments: store.experiments });
      } catch (err) {
        printError(this, err);
      }
    });

  experiment
    .command('report')
    .description('Generate baseline-vs-experiment recovery report')
    .requiredOption('--id <experimentId>')
    .option('--baseline-days <n>', 'default 14', '14')
    .action(async function reportAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const baselineDays = Number(opts.baselineDays ?? 14);
        if (Number.isNaN(baselineDays) || baselineDays <= 0) {
          throw usageError('baseline-days must be > 0');
        }

        const store = await loadStore();
        const exp = store.experiments.find((x) => x.id === opts.id);
        if (!exp) {
          throw usageError('Experiment not found', { id: opts.id });
        }

        const client = new WhoopApiClient(globals.profile);
        const recoveries = await fetchRecoveries(client, {
          limit: 25,
          all: true,
          timeoutMs: globals.timeoutMs,
        });

        const byDate = recoveries
          .map((r) => ({ date: r.created_at?.slice(0, 10), score: r.score?.recovery_score }))
          .filter((r): r is { date: string; score: number } => Boolean(r.date) && typeof r.score === 'number');

        const expStart = new Date(`${exp.startDate}T00:00:00Z`).getTime();
        const expEnd = exp.endDate ? new Date(`${exp.endDate}T23:59:59Z`).getTime() : Date.now();

        const baselineStart = expStart - baselineDays * 24 * 60 * 60 * 1000;
        const baselineEnd = expStart - 1;

        const baselineScores = byDate
          .filter((r) => {
            const t = new Date(`${r.date}T12:00:00Z`).getTime();
            return t >= baselineStart && t <= baselineEnd;
          })
          .map((r) => r.score);

        const experimentScores = byDate
          .filter((r) => {
            const t = new Date(`${r.date}T12:00:00Z`).getTime();
            return t >= expStart && t <= expEnd;
          })
          .map((r) => r.score);

        const baselineAvg = avg(baselineScores);
        const experimentAvg = avg(experimentScores);
        const delta = baselineAvg !== null && experimentAvg !== null ? experimentAvg - baselineAvg : null;

        printData(this, {
          experiment: exp,
          baselineDays,
          baseline: {
            samples: baselineScores.length,
            recoveryAvg: round(baselineAvg, 1),
          },
          period: {
            samples: experimentScores.length,
            recoveryAvg: round(experimentAvg, 1),
          },
          deltaRecovery: round(delta, 1),
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
