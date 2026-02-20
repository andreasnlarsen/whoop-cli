import { Command } from 'commander';
import { readJsonFile, writeJsonFileSecure } from '../util/fs.js';
import { experimentsPath } from '../util/config.js';
import { assertIsoDate, dateToIso, daysAgoIso } from '../util/time.js';
import { getGlobalOptions, printData, printError } from './context.js';
import { usageError } from '../http/errors.js';
import { WhoopApiClient } from '../http/client.js';
import { fetchRecoveries } from '../http/whoop-data.js';
import { avg, round } from '../util/metrics.js';
import {
  filterExperimentsByStatus,
  getExperimentWindowDetails,
  type ExperimentStatus,
  withDerivedStatus,
} from '../util/experiment-status.js';

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
const STATUS_VALUES: ExperimentStatus[] = ['planned', 'running', 'completed'];
const DAY_MS = 24 * 60 * 60 * 1000;

const assertStatus = (value: string | undefined): ExperimentStatus | undefined => {
  if (!value) return undefined;
  if (STATUS_VALUES.includes(value as ExperimentStatus)) {
    return value as ExperimentStatus;
  }
  throw usageError('status must be one of planned|running|completed', { value });
};

const assertWindow = (startDate: string, endDate?: string): void => {
  if (endDate && endDate < startDate) {
    throw usageError('end-date must be on or after start-date', { startDate, endDate });
  }
};

const createExperiment = async (input: {
  name: string;
  behavior: string;
  startDate: string;
  endDate?: string;
}): Promise<Experiment> => {
  const store = await loadStore();
  const item: Experiment = {
    id: makeId(),
    name: input.name,
    behavior: input.behavior,
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: new Date().toISOString(),
  };

  store.experiments.unshift(item);
  await saveStore(store);
  return item;
};

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
        assertWindow(startDate, endDate);
        const experimentsFile = experimentsPath();
        const item = await createExperiment({
          name: String(opts.name),
          behavior: String(opts.behavior),
          startDate,
          endDate,
        });
        const todayIso = dateToIso(new Date());

        printData(this, { ...withDerivedStatus(item, todayIso), experimentsFile });
      } catch (err) {
        printError(this, err);
      }
    });

  experiment
    .command('plan')
    .description('Create a planned behavior experiment')
    .requiredOption('--name <name>')
    .requiredOption('--behavior <behavior>')
    .requiredOption('--start-date <YYYY-MM-DD>')
    .option('--end-date <YYYY-MM-DD>')
    .action(async function planAction(opts) {
      try {
        const startDate = assertIsoDate(opts.startDate, 'start-date');
        const endDate = opts.endDate ? assertIsoDate(opts.endDate, 'end-date') : undefined;
        assertWindow(startDate, endDate);
        const experimentsFile = experimentsPath();
        const item = await createExperiment({
          name: String(opts.name),
          behavior: String(opts.behavior),
          startDate,
          endDate,
        });
        const todayIso = dateToIso(new Date());

        printData(this, { ...withDerivedStatus(item, todayIso), experimentsFile });
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
        const todayIso = dateToIso(new Date());
        const experiments = store.experiments.map((item) => withDerivedStatus(item, todayIso));
        printData(this, {
          count: experiments.length,
          asOfDate: todayIso,
          experimentsFile: experimentsPath(),
          experiments,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  experiment
    .command('status')
    .description('Summarize planned, running, and completed experiments')
    .option('--status <status>', 'Filter by derived status: planned|running|completed')
    .option('--id <experimentId>', 'Show detailed status for one experiment')
    .action(async function statusAction(opts) {
      try {
        const store = await loadStore();
        const todayIso = dateToIso(new Date());
        const statusFilter = assertStatus(opts.status);
        const experiments = store.experiments.map((item) => withDerivedStatus(item, todayIso));

        if (opts.id) {
          const found = experiments.find((item) => item.id === opts.id);
          if (!found) {
            throw usageError('Experiment not found', { id: opts.id });
          }
          if (statusFilter && found.status !== statusFilter) {
            throw usageError('Experiment does not match status filter', {
              id: opts.id,
              status: found.status,
              expectedStatus: statusFilter,
            });
          }

          printData(this, {
            experimentsFile: experimentsPath(),
            asOfDate: todayIso,
            experiment: found,
            window: getExperimentWindowDetails(found, todayIso),
          });
          return;
        }

        const filtered = filterExperimentsByStatus(experiments, todayIso, statusFilter);
        const counts = experiments.reduce(
          (acc, item) => {
            acc[item.status] += 1;
            return acc;
          },
          { planned: 0, running: 0, completed: 0 },
        );

        printData(this, {
          experimentsFile: experimentsPath(),
          asOfDate: todayIso,
          count: filtered.length,
          counts: { ...counts, total: experiments.length },
          filters: { status: statusFilter ?? null },
          experiments: filtered,
        });
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
        const todayIso = dateToIso(new Date());

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
        const periodEndIso = exp.endDate ?? todayIso;
        const expEnd = new Date(`${periodEndIso}T23:59:59Z`).getTime();

        const baselineStart = expStart - baselineDays * 24 * 60 * 60 * 1000;
        const baselineEnd = expStart - 1;
        const baselineStartIso = dateToIso(new Date(baselineStart));
        const baselineEndIso = dateToIso(new Date(expStart - DAY_MS));

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
          experimentsFile: experimentsPath(),
          asOfDate: todayIso,
          experiment: withDerivedStatus(exp, todayIso),
          baselineDays,
          baselineWindow: {
            startDate: baselineStartIso,
            endDate: baselineEndIso,
            windowType: 'days-before-start-inclusive',
          },
          baseline: {
            samples: baselineScores.length,
            recoveryAvg: round(baselineAvg, 1),
          },
          periodWindow: {
            startDate: exp.startDate,
            endDate: periodEndIso,
            windowType: exp.endDate ? 'experiment-window-inclusive' : 'start-through-today-inclusive',
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
