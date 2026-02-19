export const avg = (values: Array<number | undefined>): number | null => {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

export const round = (value: number | null, digits = 1): number | null => {
  if (value === null) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};

export const classifyRecovery = (score?: number): 'green' | 'yellow' | 'red' | 'unknown' => {
  if (typeof score !== 'number') return 'unknown';
  if (score >= 67) return 'green';
  if (score >= 34) return 'yellow';
  return 'red';
};
