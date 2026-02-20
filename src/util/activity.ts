import type { ActivityRecord } from '../models/whoop.js';

export interface ActivityFilterOptions {
  sportIds?: number[];
  sportNames?: string[];
  genericOnly?: boolean;
  labeledOnly?: boolean;
}

const normalize = (value?: string): string => (value ?? '').trim().toLowerCase();

export const isGenericActivity = (record: ActivityRecord): boolean =>
  normalize(record.sport_name) === 'activity' || record.sport_id === -1;

export const applyActivityFilters = (
  records: ActivityRecord[],
  opts: ActivityFilterOptions,
): ActivityRecord[] => {
  const sportIdSet = new Set(opts.sportIds ?? []);
  const sportNameSet = new Set((opts.sportNames ?? []).map((name) => normalize(name)).filter(Boolean));

  return records.filter((record) => {
    if (opts.genericOnly && !isGenericActivity(record)) return false;
    if (opts.labeledOnly && isGenericActivity(record)) return false;

    if (sportIdSet.size > 0 && (record.sport_id === undefined || !sportIdSet.has(record.sport_id))) {
      return false;
    }

    if (sportNameSet.size > 0 && !sportNameSet.has(normalize(record.sport_name))) {
      return false;
    }

    return true;
  });
};

export const summarizeActivityKinds = (
  records: ActivityRecord[],
): { totalFetched: number; genericActivityCount: number; structuredActivityCount: number } => {
  const totalFetched = records.length;
  const genericActivityCount = records.filter(isGenericActivity).length;
  return {
    totalFetched,
    genericActivityCount,
    structuredActivityCount: totalFetched - genericActivityCount,
  };
};
