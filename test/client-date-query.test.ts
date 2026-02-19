import test from 'node:test';
import assert from 'node:assert/strict';
import { WhoopApiClient } from '../src/http/client.js';

test('getCollection converts date-only boundaries to WHOOP datetime boundaries', async () => {
  const client = new WhoopApiClient('default') as WhoopApiClient & {
    requestJson: (opts: any) => Promise<any>;
  };

  const calls: any[] = [];
  client.requestJson = async (opts: any) => {
    calls.push(opts);
    return { records: [], next_token: undefined };
  };

  await client.getCollection('/developer/v2/recovery', {
    start: '2026-02-12',
    end: '2026-02-19',
    limit: 25,
    timeoutMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].query.start, '2026-02-12T00:00:00.000Z');
  assert.equal(calls[0].query.end, '2026-02-19T23:59:59.999Z');
});

test('getCollection keeps full timestamp boundaries as-is', async () => {
  const client = new WhoopApiClient('default') as WhoopApiClient & {
    requestJson: (opts: any) => Promise<any>;
  };

  const calls: any[] = [];
  client.requestJson = async (opts: any) => {
    calls.push(opts);
    return { records: [], next_token: undefined };
  };

  await client.getCollection('/developer/v2/recovery', {
    start: '2026-02-12T05:30:00.000Z',
    end: '2026-02-19T19:30:00.000Z',
    limit: 25,
    timeoutMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].query.start, '2026-02-12T05:30:00.000Z');
  assert.equal(calls[0].query.end, '2026-02-19T19:30:00.000Z');
});
