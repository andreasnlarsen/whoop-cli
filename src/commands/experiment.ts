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
import { filterExperimentsByProfile, normalizeExperimentProfile } from '../util/experiment-scope.js';
import {
  mergeExperimentContext,
  normalizeExperimentContext,
  type ExperimentContext,
} from '../util/experiment-context.js';

interface Experiment {
  id: string;
  name: string;
  behavior: string;
  startDate: string;
  endDate?: string;
  createdAt: string;
  profile?: string;
  context?: ExperimentContext;
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

const sourceMeta = (): { sourceOfTruth: string; experimentsFile: string } => {
  const sourceOfTruth = experimentsPath();
  return {
    sourceOfTruth,
    experimentsFile: sourceOfTruth,
  };
};

const addContextOptions = (command: Command): Command =>
  command
    .option('--description <text>', 'short plain-language description')
    .option('--why <text>', 'why this experiment matters')
    .option('--hypothesis <text>', 'expected outcome/hypothesis')
    .option('--success-criteria <text>', 'what counts as success')
    .option('--protocol <text>', 'execution protocol/constraints');

const extractContextFromOptions = (opts: Record<string, unknown>): ExperimentContext | undefined =>
  normalizeExperimentContext({
    description: opts.description,
    why: opts.why,
    hypothesis: opts.hypothesis,
    successCriteria: opts.successCriteria,
    protocol: opts.protocol,
  });

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
  profile: string;
  context?: ExperimentContext;
}): Promise<Experiment> => {
  const store = await loadStore();
  const item: Experiment = {
    id: makeId(),
    name: input.name,
    behavior: input.behavior,
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: new Date().toISOString(),
    profile: input.profile,
    context: input.context,
  };

  store.experiments.unshift(item);
  await saveStore(store);
  return item;
};

const getScopedExperiments = (
  experiments: Experiment[],
  profile: string,
  allProfiles: boolean,
): Array<Experiment & { profile: string }> => filterExperimentsByProfile(experiments, profile, allProfiles);

const findByIdInScope = (
  store: ExperimentStore,
  profile: string,
  allProfiles: boolean,
  id: string,
): {
  found: (Experiment & { profile: string }) | undefined;
  foundOnDifferentProfile: (Experiment & { profile: string }) | undefined;
} => {
  const scoped = getScopedExperiments(store.experiments, profile, allProfiles);
  const found = scoped.find((item) => item.id === id);
  if (found) return { found, foundOnDifferentProfile: undefined };

  const all = getScopedExperiments(store.experiments, profile, true);
  return {
    found: undefined,
    foundOnDifferentProfile: all.find((item) => item.id === id),
  };
};

const assertFoundExperiment = (
  id: string,
  activeProfile: string,
  includeAllProfiles: boolean,
  found: (Experiment & { profile: string }) | undefined,
  foundOnDifferentProfile: (Experiment & { profile: string }) | undefined,
): Experiment & { profile: string } => {
  if (found) return found;

  if (foundOnDifferentProfile && !includeAllProfiles) {
    throw usageError('Experiment exists on a different profile', {
      id,
      activeProfile,
      experimentProfile: foundOnDifferentProfile.profile,
      hint: 'Use --all-profiles to query across profiles, or run with --profile matching the experiment.',
    });
  }

  throw usageError('Experiment not found', { id });
};

export const registerExperimentCommands = (program: Command): void => {
  const experiment = program.command('experiment').description('Behavior experiment tracking');

  addContextOptions(
    experiment
      .command('start')
      .description('Start a behavior experiment')
      .requiredOption('--name <name>')
      .requiredOption('--behavior <behavior>')
      .option('--start-date <YYYY-MM-DD>', 'default: today UTC')
      .option('--end-date <YYYY-MM-DD>'),
  ).action(async function startAction(opts) {
    try {
      const globals = getGlobalOptions(this);
      const startDate = opts.startDate ? assertIsoDate(opts.startDate, 'start-date') : daysAgoIso(0);
      const endDate = opts.endDate ? assertIsoDate(opts.endDate, 'end-date') : undefined;
      const context = extractContextFromOptions(opts);
      assertWindow(startDate, endDate);

      const item = await createExperiment({
        name: String(opts.name),
        behavior: String(opts.behavior),
        startDate,
        endDate,
        profile: globals.profile,
        context,
      });
      const todayIso = dateToIso(new Date());

      printData(this, {
        ...withDerivedStatus(item as Experiment & { profile: string }, todayIso),
        ...sourceMeta(),
      });
    } catch (err) {
      printError(this, err);
    }
  });

  addContextOptions(
    experiment
      .command('plan')
      .description('Create a planned behavior experiment')
      .requiredOption('--name <name>')
      .requiredOption('--behavior <behavior>')
      .requiredOption('--start-date <YYYY-MM-DD>')
      .option('--end-date <YYYY-MM-DD>'),
  ).action(async function planAction(opts) {
    try {
      const globals = getGlobalOptions(this);
      const startDate = assertIsoDate(opts.startDate, 'start-date');
      const endDate = opts.endDate ? assertIsoDate(opts.endDate, 'end-date') : undefined;
      const context = extractContextFromOptions(opts);
      assertWindow(startDate, endDate);

      const item = await createExperiment({
        name: String(opts.name),
        behavior: String(opts.behavior),
        startDate,
        endDate,
        profile: globals.profile,
        context,
      });
      const todayIso = dateToIso(new Date());

      printData(this, {
        ...withDerivedStatus(item as Experiment & { profile: string }, todayIso),
        ...sourceMeta(),
      });
    } catch (err) {
      printError(this, err);
    }
  });

  addContextOptions(
    experiment
      .command('context')
      .description('Attach or update context fields for an existing experiment')
      .requiredOption('--id <experimentId>')
      .option('--all-profiles', 'include experiments from all profiles'),
  ).action(async function contextAction(opts) {
    try {
      const globals = getGlobalOptions(this);
      const includeAllProfiles = Boolean(opts.allProfiles);
      const contextUpdate = extractContextFromOptions(opts);

      if (!contextUpdate) {
        throw usageError(
          'Provide at least one context field: --description, --why, --hypothesis, --success-criteria, --protocol',
        );
      }

      const store = await loadStore();
      const { found, foundOnDifferentProfile } = findByIdInScope(
        store,
        globals.profile,
        includeAllProfiles,
        String(opts.id),
      );
      const existing = assertFoundExperiment(
        String(opts.id),
        globals.profile,
        includeAllProfiles,
        found,
        foundOnDifferentProfile,
      );

      let updated: (Experiment & { profile: string }) | null = null;

      store.experiments = store.experiments.map((raw) => {
        const normalized = normalizeExperimentProfile(raw);
        if (normalized.id !== existing.id) return raw;
        if (!includeAllProfiles && normalized.profile !== globals.profile) return raw;

        const next: Experiment & { profile: string } = {
          ...normalized,
          context: mergeExperimentContext(normalized.context, contextUpdate),
        };
        updated = next;
        return next;
      });

      if (!updated) {
        throw usageError('Experiment update failed unexpectedly', { id: opts.id });
      }

      await saveStore(store);
      const todayIso = dateToIso(new Date());

      printData(this, {
        asOfDate: todayIso,
        scope: {
          profile: globals.profile,
          allProfiles: includeAllProfiles,
        },
        ...sourceMeta(),
        experiment: withDerivedStatus(updated, todayIso),
      });
    } catch (err) {
      printError(this, err);
    }
  });

  experiment
    .command('list')
    .description('List saved experiments for active profile by default')
    .option('--all-profiles', 'include experiments from all profiles')
    .action(async function listAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const includeAllProfiles = Boolean(opts.allProfiles);
        const store = await loadStore();
        const todayIso = dateToIso(new Date());

        const scoped = getScopedExperiments(store.experiments, globals.profile, includeAllProfiles);
        const experiments = scoped.map((item) => withDerivedStatus(item, todayIso));

        printData(this, {
          count: experiments.length,
          asOfDate: todayIso,
          scope: {
            profile: globals.profile,
            allProfiles: includeAllProfiles,
          },
          ...sourceMeta(),
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
    .option('--all-profiles', 'include experiments from all profiles')
    .action(async function statusAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const includeAllProfiles = Boolean(opts.allProfiles);
        const store = await loadStore();
        const todayIso = dateToIso(new Date());
        const statusFilter = assertStatus(opts.status);
        const scoped = getScopedExperiments(store.experiments, globals.profile, includeAllProfiles);
        const experiments = scoped.map((item) => withDerivedStatus(item, todayIso));

        if (opts.id) {
          const { found, foundOnDifferentProfile } = findByIdInScope(
            store,
            globals.profile,
            includeAllProfiles,
            String(opts.id),
          );
          const resolved = assertFoundExperiment(
            String(opts.id),
            globals.profile,
            includeAllProfiles,
            found,
            foundOnDifferentProfile,
          );

          const foundWithStatus = withDerivedStatus(resolved, todayIso);

          if (statusFilter && foundWithStatus.status !== statusFilter) {
            throw usageError('Experiment does not match status filter', {
              id: opts.id,
              status: foundWithStatus.status,
              expectedStatus: statusFilter,
            });
          }

          printData(this, {
            asOfDate: todayIso,
            scope: {
              profile: globals.profile,
              allProfiles: includeAllProfiles,
            },
            ...sourceMeta(),
            experiment: foundWithStatus,
            window: getExperimentWindowDetails(foundWithStatus, todayIso),
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
          asOfDate: todayIso,
          count: filtered.length,
          counts: { ...counts, total: experiments.length },
          filters: { status: statusFilter ?? null },
          scope: {
            profile: globals.profile,
            allProfiles: includeAllProfiles,
          },
          ...sourceMeta(),
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
    .option('--all-profiles', 'include experiments from all profiles')
    .action(async function reportAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const includeAllProfiles = Boolean(opts.allProfiles);
        const baselineDays = Number(opts.baselineDays ?? 14);
        if (Number.isNaN(baselineDays) || baselineDays <= 0) {
          throw usageError('baseline-days must be > 0');
        }

        const store = await loadStore();
        const { found, foundOnDifferentProfile } = findByIdInScope(
          store,
          globals.profile,
          includeAllProfiles,
          String(opts.id),
        );

        const exp = assertFoundExperiment(
          String(opts.id),
          globals.profile,
          includeAllProfiles,
          found,
          foundOnDifferentProfile,
        );

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

        const baselineStart = expStart - baselineDays * DAY_MS;
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
          asOfDate: todayIso,
          scope: {
            profile: globals.profile,
            allProfiles: includeAllProfiles,
          },
          ...sourceMeta(),
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
