export interface ExperimentProfileLike {
  profile?: string;
}

export const LEGACY_EXPERIMENT_PROFILE = 'default';

export const normalizeExperimentProfile = <T extends ExperimentProfileLike>(
  experiment: T,
): T & { profile: string } => ({
  ...experiment,
  profile: experiment.profile ?? LEGACY_EXPERIMENT_PROFILE,
});

export const filterExperimentsByProfile = <T extends ExperimentProfileLike>(
  experiments: T[],
  profile: string,
  allProfiles = false,
): Array<T & { profile: string }> => {
  const normalized = experiments.map((experiment) => normalizeExperimentProfile(experiment));
  if (allProfiles) return normalized;
  return normalized.filter((experiment) => experiment.profile === profile);
};
