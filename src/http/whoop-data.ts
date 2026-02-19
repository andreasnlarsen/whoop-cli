import { WhoopApiClient } from './client.js';
import type { CycleRecord, RecoveryRecord, SleepRecord, WorkoutRecord } from '../models/whoop.js';

export const fetchRecoveries = async (
  client: WhoopApiClient,
  opts: { start?: string; end?: string; limit?: number; all?: boolean; timeoutMs: number },
): Promise<RecoveryRecord[]> =>
  client.getCollection<RecoveryRecord>('/developer/v2/recovery', {
    start: opts.start,
    end: opts.end,
    limit: opts.limit,
    all: opts.all,
    timeoutMs: opts.timeoutMs,
  });

export const fetchSleeps = async (
  client: WhoopApiClient,
  opts: { start?: string; end?: string; limit?: number; all?: boolean; timeoutMs: number },
): Promise<SleepRecord[]> =>
  client.getCollection<SleepRecord>('/developer/v2/activity/sleep', {
    start: opts.start,
    end: opts.end,
    limit: opts.limit,
    all: opts.all,
    timeoutMs: opts.timeoutMs,
  });

export const fetchCycles = async (
  client: WhoopApiClient,
  opts: { start?: string; end?: string; limit?: number; all?: boolean; timeoutMs: number },
): Promise<CycleRecord[]> =>
  client.getCollection<CycleRecord>('/developer/v2/cycle', {
    start: opts.start,
    end: opts.end,
    limit: opts.limit,
    all: opts.all,
    timeoutMs: opts.timeoutMs,
  });

export const fetchWorkouts = async (
  client: WhoopApiClient,
  opts: { start?: string; end?: string; limit?: number; all?: boolean; timeoutMs: number },
): Promise<WorkoutRecord[]> =>
  client.getCollection<WorkoutRecord>('/developer/v2/activity/workout', {
    start: opts.start,
    end: opts.end,
    limit: opts.limit,
    all: opts.all,
    timeoutMs: opts.timeoutMs,
  });
