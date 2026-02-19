import { usageError } from '../http/errors.js';

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string): boolean => DATE_RX.test(value);

export const assertIsoDate = (value: string, label = 'date'): string => {
  if (!isIsoDate(value)) {
    throw usageError(`${label} must be in YYYY-MM-DD format`, { value });
  }
  return value;
};

export const dateToIso = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const daysAgoIso = (days: number, now = new Date()): string => {
  const ms = now.getTime() - days * 24 * 60 * 60 * 1000;
  return dateToIso(new Date(ms));
};

export interface DateRangeInput {
  start?: string;
  end?: string;
  days?: number;
}

export interface DateRange {
  start?: string;
  end?: string;
}

export const parseDateRange = ({ start, end, days }: DateRangeInput): DateRange => {
  if (start) assertIsoDate(start, 'start');
  if (end) assertIsoDate(end, 'end');

  if (days !== undefined && Number.isNaN(days)) {
    throw usageError('days must be a number');
  }

  if (start || end) {
    return { start, end };
  }

  if (days && days > 0) {
    return {
      start: daysAgoIso(days),
      end: undefined,
    };
  }

  return {};
};

export const parseMaybeNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw usageError('value must be numeric', { value });
  }
  return n;
};
