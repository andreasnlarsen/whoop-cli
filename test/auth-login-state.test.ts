import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoginState } from '../src/commands/auth.js';

test('resolveLoginState requires explicit state when --code is provided', () => {
  assert.throws(
    () => resolveLoginState(undefined, true),
    /--state is required with --code so OAuth state can be verified/,
  );
});

test('resolveLoginState accepts explicit state for --code login', () => {
  assert.equal(resolveLoginState('known-state', true), 'known-state');
});

test('resolveLoginState generates state for interactive login', () => {
  assert.match(resolveLoginState(undefined, false), /^[0-9a-f]{16}$/);
});
