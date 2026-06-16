import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnePasswordProfileSecretStore,
  type OnePasswordCommandRunner,
} from '../src/store/onepassword-secret-store.js';

const missingItemError = (): Error & { exitCode: number; stderr: string } => {
  const err = new Error('missing item') as Error & { exitCode: number; stderr: string };
  err.exitCode = 1;
  err.stderr = 'could not find item';
  return err;
};

const config = {
  vault: 'Ops',
  item: 'WHOOP default',
};

test('onepassword store reads fields from revealed item JSON', async () => {
  const runCommand: OnePasswordCommandRunner = async () => ({
    stdout: JSON.stringify({
      fields: [
        { label: 'clientSecret', value: 'stored-secret' },
      ],
    }),
    stderr: '',
  });
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  assert.equal(await store.get('default', 'clientSecret'), 'stored-secret');
});

test('onepassword store isolates profiles that share an item', async () => {
  let item = {
    title: 'WHOOP default',
    fields: [] as Array<{ id?: string; label?: string; type?: string; value?: string }>,
  };
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    if (args[1] === 'get') {
      return { stdout: JSON.stringify(item), stderr: '' };
    }
    item = JSON.parse(input ?? '{}') as typeof item;
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.set('default', 'accessToken', 'default-token');
  await store.set('agent', 'accessToken', 'agent-token');

  assert.equal(await store.get('default', 'accessToken'), 'default-token');
  assert.equal(await store.get('agent', 'accessToken'), 'agent-token');
  assert.equal(item.fields.filter((field) => field.label === 'accessToken').length, 2);
  assert.deepEqual(
    item.fields.map((field) => field.id).sort(),
    ['whoop-cli.agent.accessToken', 'whoop-cli.default.accessToken'],
  );
});

test('onepassword store migrates legacy unscoped fields only for the default profile', async () => {
  let item = {
    title: 'WHOOP default',
    fields: [
      { label: 'clientSecret', type: 'CONCEALED', value: 'old-secret' },
      { label: 'refreshToken', type: 'CONCEALED', value: 'old-refresh' },
    ] as Array<{ id?: string; label?: string; type?: string; value?: string }>,
  };
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    if (args[1] === 'get') {
      return { stdout: JSON.stringify(item), stderr: '' };
    }
    item = JSON.parse(input ?? '{}') as typeof item;
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.set('default', 'accessToken', 'default-token');

  assert.equal(await store.get('default', 'clientSecret'), 'old-secret');
  assert.equal(await store.get('default', 'refreshToken'), 'old-refresh');
  assert.deepEqual(
    item.fields.map((field) => field.id).sort(),
    [
      'whoop-cli.default.accessToken',
      'whoop-cli.default.clientSecret',
      'whoop-cli.default.refreshToken',
    ],
  );
});

test('onepassword store does not assign legacy unscoped fields to non-default profiles', async () => {
  let item = {
    title: 'WHOOP default',
    fields: [
      { label: 'clientSecret', type: 'CONCEALED', value: 'default-secret' },
      { label: 'accessToken', type: 'CONCEALED', value: 'default-token' },
    ] as Array<{ id?: string; label?: string; type?: string; value?: string }>,
  };
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    if (args[1] === 'get') {
      return { stdout: JSON.stringify(item), stderr: '' };
    }
    item = JSON.parse(input ?? '{}') as typeof item;
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  assert.equal(await store.get('agent', 'clientSecret'), undefined);
  await store.set('agent', 'refreshToken', 'agent-refresh');

  assert.equal(await store.get('default', 'clientSecret'), 'default-secret');
  assert.equal(await store.get('agent', 'refreshToken'), 'agent-refresh');
  assert.deepEqual(
    item.fields.map((field) => field.id ?? field.label).sort(),
    [
      'accessToken',
      'clientSecret',
      'whoop-cli.agent.refreshToken',
    ],
  );
});

test('onepassword store does not treat scoped non-default fields as default legacy fields', async () => {
  let item = {
    title: 'WHOOP default',
    fields: [
      {
        id: 'whoop-cli.agent.accessToken',
        label: 'accessToken',
        type: 'CONCEALED',
        value: 'agent-token',
      },
    ] as Array<{ id?: string; label?: string; type?: string; value?: string }>,
  };
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    if (args[1] === 'get') {
      return { stdout: JSON.stringify(item), stderr: '' };
    }
    item = JSON.parse(input ?? '{}') as typeof item;
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  assert.equal(await store.get('default', 'accessToken'), undefined);
  await store.set('default', 'clientSecret', 'default-secret');
  await store.delete('default', 'accessToken');

  assert.deepEqual(
    item.fields.map((field) => ({ id: field.id, label: field.label, value: field.value })).sort((a, b) =>
      (a.id ?? '').localeCompare(b.id ?? ''),
    ),
    [
      {
        id: 'whoop-cli.agent.accessToken',
        label: 'accessToken',
        value: 'agent-token',
      },
      {
        id: 'whoop-cli.default.clientSecret',
        label: 'clientSecret',
        value: 'default-secret',
      },
    ],
  );
});

test('onepassword store creates missing items with secret values in stdin only', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === 'get') {
      throw missingItemError();
    }
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.set('default', 'refreshToken', 'refresh-token-value');

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    'item',
    'get',
    'WHOOP default',
    '--vault',
    'Ops',
    '--format',
    'json',
    '--reveal',
  ]);
  assert.deepEqual(calls[1].args, [
    'item',
    'create',
    '--vault',
    'Ops',
    '-',
  ]);
  assert.equal(calls.flatMap((call) => call.args).includes('refresh-token-value'), false);
  assert.match(calls[1].input ?? '', /refresh-token-value/);
  assert.match(calls[1].input ?? '', /whoop-cli\.default\.refreshToken/);
});

test('onepassword store edits existing items with secret values in stdin only', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === 'get') {
      return {
        stdout: JSON.stringify({
          title: 'WHOOP default',
          fields: [
            { label: 'accessToken', type: 'CONCEALED', value: 'old-token' },
          ],
        }),
        stderr: '',
      };
    }
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.set('default', 'accessToken', 'new-token');

  assert.deepEqual(calls[1].args, [
    'item',
    'edit',
    'WHOOP default',
    '--vault',
    'Ops',
  ]);
  assert.equal(calls.flatMap((call) => call.args).includes('new-token'), false);
  assert.match(calls[1].input ?? '', /new-token/);
  assert.doesNotMatch(calls[1].input ?? '', /old-token/);
});

test('onepassword preflight creates a missing item before OAuth', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === 'get') {
      throw missingItemError();
    }
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.preflightWrite?.('default');

  assert.deepEqual(calls[1].args, [
    'item',
    'create',
    '--vault',
    'Ops',
    '-',
  ]);
  assert.equal(calls.flatMap((call) => call.args).includes('client-secret-value'), false);
  assert.deepEqual(JSON.parse(calls[1].input ?? '{}'), {
    title: 'WHOOP default',
    category: 'SECURE_NOTE',
    fields: [],
  });
});

test('onepassword preflight dry-runs existing safe items before OAuth', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === 'get') {
      return {
        stdout: JSON.stringify({
          title: 'WHOOP default',
          fields: [
            { label: 'clientSecret', type: 'CONCEALED', value: 'stored-secret' },
          ],
        }),
        stderr: '',
      };
    }
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.preflightWrite?.('default');

  assert.deepEqual(calls[1].args, [
    'item',
    'edit',
    'WHOOP default',
    '--vault',
    'Ops',
    '--dry-run',
    '--title',
    'WHOOP default',
  ]);
  assert.equal(calls[1].input, undefined);
  assert.equal(calls.flatMap((call) => call.args).includes('stored-secret'), false);
});

test('onepassword store allows Secure Note built-in notes field while editing', async () => {
  let item = {
    title: 'WHOOP default',
    category: 'SECURE_NOTE',
    fields: [
      {
        id: 'notesPlain',
        label: 'notesPlain',
        purpose: 'NOTES',
        type: 'STRING',
        value: 'Dedicated WHOOP CLI item.',
      },
    ] as Array<{ id?: string; label?: string; purpose?: string; type?: string; value?: string }>,
  };
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    if (args[1] === 'get') {
      return { stdout: JSON.stringify(item), stderr: '' };
    }
    item = JSON.parse(input ?? '{}') as typeof item;
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await store.set('default', 'accessToken', 'new-token');

  assert.deepEqual(
    item.fields.map((field) => ({ id: field.id, purpose: field.purpose, type: field.type })).sort((a, b) =>
      (a.id ?? '').localeCompare(b.id ?? ''),
    ),
    [
      { id: 'notesPlain', purpose: 'NOTES', type: 'STRING' },
      { id: 'whoop-cli.default.accessToken', purpose: undefined, type: 'CONCEALED' },
    ],
  );
});

test('onepassword store rejects existing items with non-WHOOP fields before editing', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const runCommand: OnePasswordCommandRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === 'get') {
      return {
        stdout: JSON.stringify({
          title: 'Personal login',
          category: 'LOGIN',
          fields: [
            { label: 'username', type: 'STRING', value: 'me@example.test' },
          ],
        }),
        stderr: '',
      };
    }
    return { stdout: '{}', stderr: '' };
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await assert.rejects(
    () => store.set('default', 'accessToken', 'new-token'),
    /dedicated WHOOP CLI item/,
  );

  assert.equal(calls.length, 1);
});

test('onepassword store reports missing op clearly', async () => {
  const runCommand: OnePasswordCommandRunner = async () => {
    const err = new Error('spawn op ENOENT') as Error & { code: string };
    err.code = 'ENOENT';
    throw err;
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await assert.rejects(
    () => store.get('default', 'clientSecret'),
    /requires the `op` CLI/,
  );
});

test('onepassword store surfaces missing vault errors instead of treating them as missing items', async () => {
  const runCommand: OnePasswordCommandRunner = async () => {
    const err = new Error('op failed') as Error & { code?: string; stderr?: string };
    err.stderr = 'could not find vault "Ops"';
    throw err;
  };
  const store = createOnePasswordProfileSecretStore(config, runCommand);

  await assert.rejects(
    () => store.get('default', 'clientSecret'),
    /Unable to read WHOOP credentials with 1Password CLI/,
  );
});
