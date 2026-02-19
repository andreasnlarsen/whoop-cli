import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { fetchRecoveries, fetchSleeps } from '../http/whoop-data.js';
import { avg, round } from '../util/metrics.js';
import { parseDateRange, parseMaybeNumber } from '../util/time.js';
import { getGlobalOptions, printData, printError } from './context.js';

export const registerHealthCommands = (program: Command): void => {
  const health = program.command('health').description('Health flags and trend views');

  health
    .command('flags')
    .description('Detect likely recovery stress flags from recent baseline deltas')
    .option('--days <n>', 'lookback days', '14')
    .action(async function flagsAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 14;

        const [recoveries, sleeps] = await Promise.all([
          fetchRecoveries(client, {
            ...parseDateRange({ days }),
            limit: 25,
            all: true,
            timeoutMs: globals.timeoutMs,
          }),
          fetchSleeps(client, {
            ...parseDateRange({ days }),
            limit: 25,
            all: true,
            timeoutMs: globals.timeoutMs,
          }),
        ]);

        const latestRecovery = recoveries[0];
        const baseline = recoveries.slice(1);

        const baselineHrv = avg(baseline.map((r) => r.score?.hrv_rmssd_milli));
        const baselineRhr = avg(baseline.map((r) => r.score?.resting_heart_rate));
        const baselineRecovery = avg(baseline.map((r) => r.score?.recovery_score));

        const flags: Array<{ code: string; message: string; severity: 'low' | 'med' | 'high' }> = [];

        if (latestRecovery?.score?.recovery_score !== undefined && latestRecovery.score.recovery_score < 34) {
          flags.push({
            code: 'LOW_RECOVERY',
            message: 'Recovery score is in red zone (<34).',
            severity: 'high',
          });
        }

        if (
          baselineHrv &&
          latestRecovery?.score?.hrv_rmssd_milli !== undefined &&
          latestRecovery.score.hrv_rmssd_milli < baselineHrv * 0.8
        ) {
          flags.push({
            code: 'HRV_DROP',
            message: 'HRV is >20% below trailing baseline.',
            severity: 'med',
          });
        }

        if (
          baselineRhr !== null &&
          baselineRhr !== undefined &&
          latestRecovery?.score?.resting_heart_rate !== undefined &&
          latestRecovery.score.resting_heart_rate > baselineRhr + 5
        ) {
          flags.push({
            code: 'RHR_ELEVATION',
            message: 'Resting heart rate is elevated >5 bpm over baseline.',
            severity: 'med',
          });
        }

        const latestSleep = sleeps[0];
        if (
          latestSleep?.score?.sleep_performance_percentage !== undefined &&
          latestSleep.score.sleep_performance_percentage < 70
        ) {
          flags.push({
            code: 'LOW_SLEEP_PERFORMANCE',
            message: 'Sleep performance is below 70%.',
            severity: 'med',
          });
        }

        printData(this, {
          windowDays: days,
          latest: {
            recoveryScore: latestRecovery?.score?.recovery_score ?? null,
            hrv: latestRecovery?.score?.hrv_rmssd_milli ?? null,
            rhr: latestRecovery?.score?.resting_heart_rate ?? null,
            sleepPerformance: latestSleep?.score?.sleep_performance_percentage ?? null,
          },
          baseline: {
            recoveryScoreAvg: round(baselineRecovery, 1),
            hrvAvg: round(baselineHrv, 2),
            rhrAvg: round(baselineRhr, 1),
          },
          flags,
        });
      } catch (err) {
        printError(this, err);
      }
    });

  health
    .command('trend')
    .description('Trend summary for recovery and sleep metrics')
    .option('--days <n>', 'lookback days', '30')
    .action(async function trendAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);
        const days = parseMaybeNumber(opts.days) ?? 30;
        const range = parseDateRange({ days });

        const [recoveries, sleeps] = await Promise.all([
          fetchRecoveries(client, {
            ...range,
            limit: 25,
            all: true,
            timeoutMs: globals.timeoutMs,
          }),
          fetchSleeps(client, {
            ...range,
            limit: 25,
            all: true,
            timeoutMs: globals.timeoutMs,
          }),
        ]);

        printData(this, {
          windowDays: days,
          recovery: {
            records: recoveries.length,
            recoveryScoreAvg: round(avg(recoveries.map((r) => r.score?.recovery_score)), 1),
            hrvAvg: round(avg(recoveries.map((r) => r.score?.hrv_rmssd_milli)), 2),
            rhrAvg: round(avg(recoveries.map((r) => r.score?.resting_heart_rate)), 1),
          },
          sleep: {
            records: sleeps.length,
            sleepPerformanceAvg: round(avg(sleeps.map((s) => s.score?.sleep_performance_percentage)), 1),
            sleepConsistencyAvg: round(avg(sleeps.map((s) => s.score?.sleep_consistency_percentage)), 1),
            sleepEfficiencyAvg: round(avg(sleeps.map((s) => s.score?.sleep_efficiency_percentage)), 1),
          },
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
