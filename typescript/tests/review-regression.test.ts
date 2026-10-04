import { expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { inspect } from 'node:util';
import { RestClient, SignalsClient, buildOpenSignal, type Fetch } from '../src/index.js';
import type { SendSignalRequest } from '../src/index.js';

const key = 'a'.repeat(32);
const origin = 'https://example.com';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

it.each([201, 202])(
  'rejects REST success status %i before decoding a valid body',
  async (status) => {
    let calls = 0;
    const client = new RestClient({
      baseUrl: origin + '/api/rest',
      accountApiKey: 'vt_test_account',
      fetch: async () => {
        calls++;
        return json({ bundles: [], limit: 50 }, calls === 1 ? status : 200);
      },
    });
    await expect(client.listBundles()).rejects.toMatchObject({ kind: 'protocol' });
    await expect(client.listBundles()).resolves.toMatchObject({ bundles: [] });
    expect(calls).toBe(2);
  },
);

it.each([
  '',
  'a'.repeat(31),
  'a'.repeat(33),
  'A'.repeat(32),
  key + '\n',
  '/' + key,
  null,
  undefined,
  123,
  { toString: () => key },
])(
  'rejects an invalid per-request key before HTTP or payload processing (%j)',
  async (strategyApiKey) => {
    let calls = 0;
    const client = new SignalsClient({
      baseUrl: origin,
      fetch: async () => {
        calls++;
        return new Response(null, { status: 204 });
      },
    });
    await expect(
      client.send({ strategyApiKey, payload: null } as unknown as SendSignalRequest),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(calls).toBe(0);
    await client.send({
      strategyApiKey: key,
      payload: { action: 'start', version: 1, timestamp: '123' },
    });
    expect(calls).toBe(1);
  },
);

it.each([undefined, null, [], 'invalid'])(
  'validates the send request object (%j)',
  async (request) => {
    const client = new SignalsClient({
      baseUrl: origin,
      fetch: async () => {
        expect.fail('Unexpected HTTP');
      },
    });
    await expect(client.send(request as unknown as SendSignalRequest)).rejects.toMatchObject({
      kind: 'validation',
    });
  },
);

it.each([
  ['a', 'b'],
  ['b', 'a'],
])('isolates concurrent sends with reply order %s then %s', async (first, second) => {
  const keys = { a: 'a'.repeat(32), b: 'b'.repeat(32), c: 'c'.repeat(32) };
  const received: { path: string; auth: string | undefined; body: unknown }[] = [];
  const pending = new Map<string, ServerResponse>();
  let arrived!: () => void;
  const bothReceived = new Promise<void>((resolve) => {
    arrived = resolve;
  });

  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({
        path: request.url!,
        auth: request.headers.authorization,
        body: JSON.parse(body),
      });
      const sentKey = request.url!.split('/').at(-1)!;
      if (sentKey === keys.c) {
        response.writeHead(204);
        response.end();
        return;
      }
      pending.set(sentKey, response);
      if (pending.size === 2) arrived();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const client = new SignalsClient({
      baseUrl: 'http://127.0.0.1:' + address.port,
      allowLocalHttp: true,
    });
    const payload = { action: 'start' as const, version: 1, timestamp: '123' };
    const send = (strategyApiKey: string) =>
      client.send({ strategyApiKey, payload }).then(
        () => {
          throw new Error('Expected failure');
        },
        (error: unknown) => error,
      );
    const calls = { a: send(keys.a), b: send(keys.b) };
    await bothReceived;
    for (const label of [first, second]) {
      const sentKey = keys[label as 'a' | 'b'];
      const response = pending.get(sentKey)!;
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          message: 'failed ' + sentKey,
          errorCode: 'code_' + sentKey,
          requestId: 'request_' + sentKey,
        }),
      );
      const error = await calls[label as 'a' | 'b'];
      expect(error).toMatchObject({
        kind: 'http',
        code: 'code_[redacted]',
        requestId: 'request_[redacted]',
      });
      expect(inspect(error)).not.toContain(sentKey);
    }
    await client.send({ strategyApiKey: keys.c, payload });
    expect(received.map((request) => request.path).sort()).toEqual(
      Object.values(keys)
        .map((value) => '/webhooks/signals/v1/' + value)
        .sort(),
    );
    expect(received.every((request) => request.auth === undefined)).toBe(true);
    expect(received.map((request) => request.body)).toEqual([payload, payload, payload]);
    expect(payload).toEqual({ action: 'start', version: 1, timestamp: '123' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('keeps a keyless client usable after cancellation and timeout', async () => {
  let calls = 0;
  const client = new SignalsClient({
    baseUrl: origin,
    timeoutMs: 10,
    fetch: async (_url, init) => {
      calls++;
      if (calls === 1)
        await new Promise<void>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          }),
        );
      return new Response(null, { status: 204 });
    },
  });
  const payload = { action: 'start' as const, version: 1, timestamp: '123' };
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.send({ strategyApiKey: key, payload }, { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'cancelled' });
  expect(calls).toBe(0);
  await expect(client.send({ strategyApiKey: key, payload })).rejects.toMatchObject({
    kind: 'timeout',
  });
  await client.send({ strategyApiKey: 'b'.repeat(32), payload });
  expect(calls).toBe(2);
});

it('passes opaque and empty cursors through empty pages unchanged', async () => {
  const token = 'future:v2/+?=&opaque';
  const urls: URL[] = [];
  const client = new RestClient({
    baseUrl: origin + '/api/rest',
    accountApiKey: 'vt_test_account',
    fetch: async (url) => {
      urls.push(new URL(String(url)));
      return json({
        users: [],
        limit: 7,
        ...(urls.length === 1
          ? { nextCursor: token }
          : urls.length === 2
            ? { nextCursor: '' }
            : {}),
      });
    },
  });
  const pages = [];
  for await (const page of client.listBundleUsersPages({ bundleId: 'b'.repeat(32), limit: 7 }))
    pages.push(page);
  expect(pages).toHaveLength(3);
  expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, token, '']);
  expect(urls.every((url) => url.searchParams.get('limit') === '7')).toBe(true);
});

it.each([true, false])(
  'redacts JSON boolean %s and numeric body leaves in messages',
  async (force) => {
    const fetch: Fetch = async (_url, init) => {
      const raw = String(init?.body);
      const body = JSON.parse(raw);
      return json({ message: `version ${body.version} force ${JSON.stringify(body.force)}` }, 400);
    };
    const client = new SignalsClient({ baseUrl: origin, fetch });
    const payload = buildOpenSignal({
      version: 8675309.125,
      marketPrice: 100,
      order: { side: 'buy' },
      force,
      timestamp: '123',
    });
    try {
      await client.send({ strategyApiKey: key, payload: payload });
      expect.fail('Expected an HTTP error');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'http' });
      expect(String(error)).not.toContain(String(force));
      expect(String(error)).not.toContain('8675309.125');
    }
  },
);

it('does not coerce a strategy credential through user code', async () => {
  let coerced = false;
  const client = new SignalsClient({
    baseUrl: origin,
    fetch: async () => {
      expect.fail('Unexpected HTTP');
    },
  });
  const strategyApiKey = {
    toString: () => {
      coerced = true;
      return key;
    },
  };
  await expect(
    client.send({
      strategyApiKey,
      payload: { action: 'start', version: 1, timestamp: '123' },
    } as unknown as SendSignalRequest),
  ).rejects.toMatchObject({ kind: 'validation' });
  expect(coerced).toBe(false);
});

it('reads the strategy key once for validation, URL and diagnostic cleanup', async () => {
  let reads = 0;
  const client = new SignalsClient({
    baseUrl: origin,
    fetch: async (url) => {
      const sentKey = String(url).split('/').at(-1)!;
      expect(sentKey).toBe(key);
      return json({ message: sentKey, errorCode: sentKey, requestId: sentKey }, 400);
    },
  });
  const request = {
    get strategyApiKey() {
      reads++;
      return reads % 2 ? key : 'b'.repeat(32);
    },
    payload: { action: 'start' as const, version: 1, timestamp: '123' },
  };
  await expect(client.send(request)).rejects.toMatchObject({
    kind: 'http',
    message: '[redacted]',
    code: '[redacted]',
    requestId: '[redacted]',
  });
  expect(reads).toBe(1);
});

it('defaults each client to production without construction requests', async () => {
  const requests: string[] = [];
  const fetch: Fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    return url.includes('/webhooks/')
      ? new Response(null, { status: 204 })
      : json({ bundles: [], limit: 50 });
  };
  const rest = new RestClient({ accountApiKey: 'vt_synthetic', fetch });
  const signals = new SignalsClient({ fetch });
  new SignalsClient();
  expect(requests).toEqual([]);
  await rest.listBundles();
  await signals.send({
    strategyApiKey: key,
    payload: buildOpenSignal({ version: 1, marketPrice: 100, order: { side: 'buy' } }),
  });
  expect(requests.map((value) => new URL(value).origin + new URL(value).pathname)).toEqual([
    'https://www.vector-trading.app/api/rest/v1/bundles',
    'https://www.vector-trading.app/webhooks/signals/v1/' + key,
  ]);
});

it.each(['', null, 'http://remote.invalid'])(
  'rejects explicitly invalid baseUrl (%j)',
  (baseUrl) => {
    expect(() => new SignalsClient({ baseUrl: baseUrl as string })).toThrow();
    expect(
      () => new RestClient({ baseUrl: baseUrl as string, accountApiKey: 'vt_synthetic' }),
    ).toThrow();
  },
);
