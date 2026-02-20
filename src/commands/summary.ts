import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchActivities, fetchCycles, fetchRecoveries, fetchSleeps } from '../http/whoop-data.js';
import { isGenericActivity } from '../util/activity.js';
import { classifyRecovery } from '../util/metrics.js';
import { getGlobalOptions, printData, printError } from './context.js';

const recommendLoad = (recoveryScore?: number): { target: string; note: string } => {
  if (typeof recoveryScore !== 'number') {
    return { target: 'unknown', note: 'No recovery score available yet.' };
  }
  if (recoveryScore >= 67) {
    return { target: 'high', note: 'Push day is appropriate if goals require it.' };
  }
  if (recoveryScore >= 34) {
    return { target: 'moderate', note: 'Maintain and avoid aggressive overload.' };
  }
  return { target: 'restorative', note: 'Prioritize recovery, low strain, and sleep quality.' };
};

const fetchDailyCore = async (client: WhoopApiClient, timeoutMs: number) => {
  const [recovery, sleep, cycle, activities] = await Promise.all([
    fetchRecoveries(client, { limit: 1, timeoutMs }),
    fetchSleeps(client, { limit: 1, timeoutMs }),
    fetchCycles(client, { limit: 1, timeoutMs }),
    fetchActivities(client, { limit: 5, timeoutMs }),
  ]);

  return {
    recovery: recovery[0] ?? null,
    sleep: sleep[0] ?? null,
    cycle: cycle[0] ?? null,
    activities,
  };
};

export const registerSummaryCommands = (program: Command): void => {
  program
    .command('summary')
    .description('One-line style WHOOP snapshot')
    .action(async function summaryAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const core = await fetchDailyCore(client, globals.timeoutMs);

        const genericActivityCount = core.activities.filter(isGenericActivity).length;

        const payload = {
          recoveryScore: core.recovery?.score?.recovery_score ?? null,
          hrv: core.recovery?.score?.hrv_rmssd_milli ?? null,
          restingHr: core.recovery?.score?.resting_heart_rate ?? null,
          sleepPerformance: core.sleep?.score?.sleep_performance_percentage ?? null,
          cycleStrain: core.cycle?.score?.strain ?? null,
          recentActivities: core.activities.length,
          recentStructuredActivities: core.activities.length - genericActivityCount,
          recentGenericActivities: genericActivityCount,
        };

        printData(this, payload);
      } catch (err) {
        printError(this, err);
      }
    });

  program
    .command('day-brief')
    .description('Readiness-oriented daily brief for planning your day')
    .action(async function dayBriefAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const core = await fetchDailyCore(client, globals.timeoutMs);

        const recoveryScore = core.recovery?.score?.recovery_score;
        const load = recommendLoad(recoveryScore);

        printData(this, {
          readiness: {
            recoveryScore: recoveryScore ?? null,
            zone: classifyRecovery(recoveryScore),
            recommendation: load,
          },
          sleep: {
            performancePct: core.sleep?.score?.sleep_performance_percentage ?? null,
            consistencyPct: core.sleep?.score?.sleep_consistency_percentage ?? null,
            efficiencyPct: core.sleep?.score?.sleep_efficiency_percentage ?? null,
          },
          recentCycle: {
            strain: core.cycle?.score?.strain ?? null,
            start: core.cycle?.start ?? null,
            end: core.cycle?.end ?? null,
          },
          guidance: [
            recoveryScore !== undefined && recoveryScore < 34
              ? 'Prioritize recovery actions: hydration, lower-intensity training, stable bedtime.'
              : 'Keep sleep consistency high and align strain to readiness zone.',
          ],
        });
      } catch (err) {
        printError(this, err);
      }
    });

  program
    .command('strain-plan')
    .description('Suggest target training load from current recovery')
    .action(async function strainPlanAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const [recovery] = await fetchRecoveries(client, { limit: 1, timeoutMs: globals.timeoutMs });
        const [cycle] = await fetchCycles(client, { limit: 1, timeoutMs: globals.timeoutMs });

        const recoveryScore = recovery?.score?.recovery_score;
        const load = recommendLoad(recoveryScore);
        const suggestedStrainRange =
          load.target === 'high' ? '14-18' : load.target === 'moderate' ? '10-14' : '0-9';

        printData(this, {
          recoveryScore: recoveryScore ?? null,
          yesterdayStrain: cycle?.score?.strain ?? null,
          recommendedLoad: load.target,
          suggestedStrainRange,
          note: load.note,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
