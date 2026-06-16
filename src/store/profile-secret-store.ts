export type ProfileSecretName = 'clientSecret' | 'accessToken' | 'refreshToken';

export type SecretStorageKind = 'macos-keychain' | 'onepassword' | 'local-vps';

export type SecretStorageSelection = SecretStorageKind | 'auto';

export interface OnePasswordSecretStorageConfig {
  vault: string;
  item: string;
}

export interface StoredSecretStorageConfig {
  onePassword?: OnePasswordSecretStorageConfig;
}

export interface ProfileSecretStore {
  kind: SecretStorageKind;
  assertSupported?: () => void;
  preflightWrite?: (profileName: string) => Promise<void>;
  get(profileName: string, name: ProfileSecretName): Promise<string | undefined>;
  set(profileName: string, name: ProfileSecretName, value: string): Promise<void>;
  delete(profileName: string, name: ProfileSecretName): Promise<void>;
}

export interface ResolvedProfileSecretStore {
  store: ProfileSecretStore;
  secretStorage: SecretStorageKind;
  secretStorageConfig?: StoredSecretStorageConfig;
}
