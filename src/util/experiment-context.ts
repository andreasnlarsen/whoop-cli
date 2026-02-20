export interface ExperimentContext {
  description?: string;
  why?: string;
  hypothesis?: string;
  successCriteria?: string;
  protocol?: string;
}

export interface ExperimentContextInput {
  description?: unknown;
  why?: unknown;
  hypothesis?: unknown;
  successCriteria?: unknown;
  protocol?: unknown;
}

const normalizeValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeExperimentContext = (
  input: ExperimentContextInput,
): ExperimentContext | undefined => {
  const entries: Array<[keyof ExperimentContext, string | undefined]> = [
    ['description', normalizeValue(input.description)],
    ['why', normalizeValue(input.why)],
    ['hypothesis', normalizeValue(input.hypothesis)],
    ['successCriteria', normalizeValue(input.successCriteria)],
    ['protocol', normalizeValue(input.protocol)],
  ];

  const context = entries.reduce<ExperimentContext>((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});

  return Object.keys(context).length > 0 ? context : undefined;
};

export const mergeExperimentContext = (
  base: ExperimentContext | undefined,
  update: ExperimentContext,
): ExperimentContext => ({
  ...(base ?? {}),
  ...update,
});
