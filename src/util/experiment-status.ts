import { dateToIso } from './time.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExperimentStatus = 'planned' | 'running' | 'completed';

export interface ExperimentLike {
  startDate: string;
  endDate?: string;
}

export interface ExperimentWindowDetails {
  todayUtc: string;
  totalDays: number | null;
  elapsedDays: number;
  remainingDays: number | null;
  daysUntilStart: number;
}

const startOfDayMs = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();

const endOfDayMs = (iso: string): number => new Date(`${iso}T23:59:59Z`).getTime();

const ceilDaysBetween = (startMs: number, endMs: number): number =>
  Math.max(0, Math.ceil((endMs - startMs) / DAY_MS));

const inclusiveDaysBetweenIso = (fromIso: string, toIso: string): number =>
  Math.floor((startOfDayMs(toIso) - startOfDayMs(fromIso)) / DAY_MS) + 1;

export const deriveExperimentStatus = (
  experiment: ExperimentLike,
  todayIso = dateToIso(new Date()),
): ExperimentStatus => {
  if (experiment.startDate > todayIso) return 'planned';
  if (experiment.endDate && experiment.endDate < todayIso) return 'completed';
  return 'running';
};

export const withDerivedStatus = <T extends ExperimentLike>(
  experiment: T,
  todayIso = dateToIso(new Date()),
): T & { status: ExperimentStatus } => ({
  ...experiment,
  status: deriveExperimentStatus(experiment, todayIso),
});

export const filterExperimentsByStatus = <T extends ExperimentLike>(
  experiments: T[],
  todayIso = dateToIso(new Date()),
  status?: ExperimentStatus,
): T[] => {
  if (!status) return experiments;
  return experiments.filter((exp) => deriveExperimentStatus(exp, todayIso) === status);
};

export const getExperimentWindowDetails = (
  experiment: ExperimentLike,
  todayIso = dateToIso(new Date()),
): ExperimentWindowDetails => {
  const status = deriveExperimentStatus(experiment, todayIso);
  const todayStart = startOfDayMs(todayIso);
  const start = startOfDayMs(experiment.startDate);
  const end = experiment.endDate ? endOfDayMs(experiment.endDate) : null;
  const totalDays = experiment.endDate
    ? inclusiveDaysBetweenIso(experiment.startDate, experiment.endDate)
    : null;
  const daysUntilStart = status === 'planned' ? ceilDaysBetween(todayStart, start) : 0;

  if (status === 'planned') {
    return {
      todayUtc: todayIso,
      totalDays,
      elapsedDays: 0,
      remainingDays: totalDays,
      daysUntilStart,
    };
  }

  if (status === 'completed') {
    return {
      todayUtc: todayIso,
      totalDays,
      elapsedDays: totalDays ?? inclusiveDaysBetweenIso(experiment.startDate, todayIso),
      remainingDays: 0,
      daysUntilStart,
    };
  }

  const elapsedDays = inclusiveDaysBetweenIso(experiment.startDate, todayIso);
  if (!end) {
    return {
      todayUtc: todayIso,
      totalDays,
      elapsedDays,
      remainingDays: null,
      daysUntilStart,
    };
  }

  const remainingDays = Math.max(0, inclusiveDaysBetweenIso(todayIso, experiment.endDate!));
  return {
    todayUtc: todayIso,
    totalDays,
    elapsedDays,
    remainingDays,
    daysUntilStart,
  };
};

