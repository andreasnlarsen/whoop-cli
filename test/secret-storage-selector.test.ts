import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSecretStorageSelection,
  resolveLoginProfileSecretStore,
  resolveStoredProfileSecretStore,
} from '../src/store/profile-secret-store-selector.js';

test('secret storage selection maps macOS auto to Keychain', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'darwin',
  });

  assert.equal(resolved.secretStorage, 'macos-keychain');
  assert.equal(resolved.store.kind, 'macos-keychain');
});

test('secret storage selection preserves stored 1Password backend when login uses auto', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'darwin',
    existing: {
      secretStorage: 'onepassword',
      secretStorageConfig: {
        onePassword: {
          vault: 'Ops',
          item: 'WHOOP default',
        },
      },
    },
    env: {},
  });

  assert.equal(resolved.secretStorage, 'onepassword');
  assert.deepEqual(resolved.secretStorageConfig, {
    onePassword: {
      vault: 'Ops',
      item: 'WHOOP default',
    },
  });
});

test('secret storage selection preserves stored local-vps backend when login uses auto on Linux', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'linux',
    existing: {
      secretStorage: 'local-vps',
    },
    env: {},
  });

  assert.equal(resolved.secretStorage, 'local-vps');
  assert.equal(resolved.store.kind, 'local-vps');
});

test('secret storage selection lets explicit Linux auto 1Password selectors retarget an existing item', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'linux',
    existing: {
      secretStorage: 'onepassword',
      secretStorageConfig: {
        onePassword: {
          vault: 'Old Ops',
          item: 'Old WHOOP',
        },
      },
    },
    opVault: 'New Ops',
    opItem: 'New WHOOP',
    env: {},
  });

  assert.equal(resolved.secretStorage, 'onepassword');
  assert.deepEqual(resolved.secretStorageConfig, {
    onePassword: {
      vault: 'New Ops',
      item: 'New WHOOP',
    },
  });
});

test('secret storage selection lets explicit Linux auto 1Password selectors replace local-vps', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'linux',
    existing: {
      secretStorage: 'local-vps',
    },
    opVault: 'Ops',
    opItem: 'WHOOP default',
    env: {},
  });

  assert.equal(resolved.secretStorage, 'onepassword');
  assert.deepEqual(resolved.secretStorageConfig, {
    onePassword: {
      vault: 'Ops',
      item: 'WHOOP default',
    },
  });
});

test('secret storage selection ignores unsupported stored Keychain backend on Linux auto', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'linux',
    existing: {
      secretStorage: 'macos-keychain',
    },
    opVault: 'Ops',
    opItem: 'WHOOP default',
    env: {},
  });

  assert.equal(resolved.secretStorage, 'onepassword');
});

test('secret storage selection maps Linux auto to 1Password when configured', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'auto',
    platform: 'linux',
    opVault: 'Ops',
    opItem: 'WHOOP default',
  });

  assert.equal(resolved.secretStorage, 'onepassword');
  assert.deepEqual(resolved.secretStorageConfig, {
    onePassword: {
      vault: 'Ops',
      item: 'WHOOP default',
    },
  });
});

test('secret storage selection reads 1Password config from process env by default', () => {
  const originalVault = process.env.WHOOP_OP_VAULT;
  const originalItem = process.env.WHOOP_OP_ITEM;
  process.env.WHOOP_OP_VAULT = 'Env Ops';
  process.env.WHOOP_OP_ITEM = 'Env WHOOP';

  try {
    const resolved = resolveLoginProfileSecretStore({
      requested: 'auto',
      platform: 'linux',
    });

    assert.equal(resolved.secretStorage, 'onepassword');
    assert.deepEqual(resolved.secretStorageConfig, {
      onePassword: {
        vault: 'Env Ops',
        item: 'Env WHOOP',
      },
    });
  } finally {
    if (originalVault === undefined) {
      delete process.env.WHOOP_OP_VAULT;
    } else {
      process.env.WHOOP_OP_VAULT = originalVault;
    }
    if (originalItem === undefined) {
      delete process.env.WHOOP_OP_ITEM;
    } else {
      process.env.WHOOP_OP_ITEM = originalItem;
    }
  }
});

test('secret storage selection rejects Linux auto without 1Password configuration', () => {
  assert.throws(
    () => resolveLoginProfileSecretStore({
      requested: 'auto',
      platform: 'linux',
      env: {},
    }),
    /Linux auto secret storage requires 1Password configuration/,
  );
});

test('secret storage selection requires local-vps acknowledgement', () => {
  assert.throws(
    () => resolveLoginProfileSecretStore({
      requested: 'local-vps',
      platform: 'linux',
    }),
    /without explicit acknowledgement/,
  );
});

test('secret storage selection allows acknowledged local-vps on Linux', () => {
  const resolved = resolveLoginProfileSecretStore({
    requested: 'local-vps',
    platform: 'linux',
    acceptLocalVpsRisk: true,
  });

  assert.equal(resolved.secretStorage, 'local-vps');
  assert.equal(resolved.store.kind, 'local-vps');
});

test('stored onepassword metadata resolves to the onepassword store', () => {
  const resolved = resolveStoredProfileSecretStore({
    secretStorage: 'onepassword',
    secretStorageConfig: {
      onePassword: {
        vault: 'Ops',
        item: 'WHOOP default',
      },
    },
  });

  assert.equal(resolved.secretStorage, 'onepassword');
  assert.equal(resolved.store.kind, 'onepassword');
});

test('parseSecretStorageSelection rejects unsupported values', () => {
  assert.throws(
    () => parseSecretStorageSelection('plaintext-json'),
    /Unsupported secret storage/,
  );
});
