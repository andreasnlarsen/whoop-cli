import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profileForStorage,
  profileWithRuntimeOverrides,
  type WhoopProfile,
} from '../src/store/profile-store.js';

const baseProfile = (): WhoopProfile => ({
  profileName: 'default',
  clientId: 'stored-client',
  clientSecret: 'stored-secret',
  redirectUri: 'https://localhost/callback',
  baseUrl: 'https://api.prod.whoop.com',
  scopes: ['offline'],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
});

test('profileForStorage strips client secret before persisting', () => {
  const stored = profileForStorage('default', baseProfile());

  assert.equal(stored.profileName, 'default');
  assert.equal(stored.clientSecret, '');
  assert.equal(stored.clientId, 'stored-client');
});

test('profileWithRuntimeOverrides restores client secret from environment', () => {
  const hydrated = profileWithRuntimeOverrides(
    {
      ...baseProfile(),
      clientSecret: '',
    },
    {
      WHOOP_CLIENT_SECRET: 'env-secret',
    },
  );

  assert.equal(hydrated.clientSecret, 'env-secret');
});

test('profileWithRuntimeOverrides keeps stored values when env overrides are absent', () => {
  const hydrated = profileWithRuntimeOverrides(baseProfile(), {});

  assert.equal(hydrated.clientId, 'stored-client');
  assert.equal(hydrated.clientSecret, 'stored-secret');
  assert.equal(hydrated.redirectUri, 'https://localhost/callback');
});
