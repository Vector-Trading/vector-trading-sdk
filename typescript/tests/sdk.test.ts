import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RestClient,
  SignalsClient,
  SdkError,
  buildSignal,
  buildOpenSignal,
  buildUpdateSignal,
  buildStartSignal,
  buildDeleteSignal,
  serializeSignal,
  type StrategySignalPayload,
  type CreateGrantRequest,
} from '../src/index.js';

const accountKey = 'vt_test_account_only';
const strategyKey = 'a'.repeat(32);
const bundleId = 'b'.repeat(32);
const userId = 'c'.repeat(32);
const grantId = 'd'.repeat(32);
const signals = JSON.parse(
  readFileSync(new URL('../../conformance/signals/cases.json', import.meta.url), 'utf8'),
) as {
  id: string;
  payload: StrategySignalPayload;
  schemaAccepted: boolean;
  parserAccepted: boolean;
}[];
interface Fixture {
  id: string;
  operationId: string;
  expectedStatus: number;
  request: {
    path: string;
    method: string;
    query: Record<string, string>;
    body?: CreateGrantRequest;
  };
  response: unknown;
}
const restFixtures = JSON.parse(
  readFileSync(new URL('../../conformance/rest/cases.json', import.meta.url), 'utf8'),
) as Fixture[];

interface InputCase {
  id: string;
  operationId: string;
  parameters: Record<string, string>;
  body?: CreateGrantRequest;
  accepted: boolean;
}
const inputCases = JSON.parse(
  readFileSync(new URL('../../conformance/rest/input-validation.json', import.meta.url), 'utf8'),
) as InputCase[];

describe('public SDK contract', () => {
  let server: ReturnType<typeof createServer>;
  let origin: string;
  let requests: { url: string; method: string; authorization: string | undefined; body: string }[];
  let handler: (request: IncomingMessage, response: ServerResponse) => void;
  beforeEach(async () => {
    requests = [];
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"bundles":[],"limit":50}');
    };
    server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push({
          url: request.url!,
          method: request.method!,
          authorization: request.headers.authorization,
          body,
        });
        handler(request, response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    origin = 'http://127.0.0.1:' + address.port;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const rest = (base: string, options = {}) =>
    new RestClient({
      baseUrl: base + '/api/rest',
      accountApiKey: accountKey,
      allowLocalHttp: true,
      ...options,
    });
  const webhook = (base: string, options = {}) =>
    new SignalsClient({
      baseUrl: base,
      allowLocalHttp: true,
      ...options,
    });
  function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    handler = (_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(
        status === 204 ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      );
    };
  }
  async function invoke(fixture: Fixture) {
    const client = rest(origin);
    const ids = fixture.request.path.split('/');
    switch (fixture.operationId) {
      case 'listBundles':
        return client.listBundles();
      case 'searchUsers':
        return client.searchUsers({ displayName: fixture.request.query['displayName']! });
      case 'getCheckout':
        return client.getCheckout({ checkoutId: ids[3]! });
      case 'listBundleUsers':
        return client.listBundleUsers({ bundleId: ids[3]! });
      case 'listBundleGrants':
        return client.listBundleGrants({ bundleId: ids[3]! });
      case 'createBundleGrant':
        return client.createBundleGrant({
          bundleId: ids[3]!,
          createGrantRequest: fixture.request.body!,
        });
      case 'revokeBundleGrant':
        return client.revokeBundleGrant({ bundleId: ids[3]!, grantId: ids[5]! });
      default:
        throw new Error('Unknown fixture operation');
    }
  }
  it.each(inputCases)('shared input: $id', async (fixture) => {
    const response = restFixtures.find(
      (f) => f.operationId === fixture.operationId && f.expectedStatus === 200,
    )!.response;
    respond(200, response);
    const client = rest(origin);
    const invoke = () => {
      switch (fixture.operationId) {
        case 'searchUsers':
          return client.searchUsers({ displayName: fixture.parameters['displayName']! });
        case 'createBundleGrant':
          return client.createBundleGrant({
            bundleId: fixture.parameters['bundleId']!,
            createGrantRequest: fixture.body!,
          });
        case 'listBundleGrants':
          return client.listBundleGrants({
            ...fixture.parameters,
            bundleId: fixture.parameters['bundleId']!,
          });
        default:
          throw new Error('Unknown input operation');
      }
    };
    if (!fixture.accepted) {
      await expect(invoke()).rejects.toMatchObject({ kind: 'validation' });
      expect(requests).toHaveLength(0);
    } else {
      await invoke();
      expect(requests).toHaveLength(1);
      if (fixture.body) expect(JSON.parse(requests[0]!.body)).toEqual(fixture.body);
      const query = new URL(requests[0]!.url, origin).searchParams;
      for (const [key, value] of Object.entries(fixture.parameters))
        if (key !== 'bundleId') expect(query.get(key)).toBe(value);
    }
    // A rejected input must not poison the next independent request.
    respond(200, { bundles: [], limit: 50 });
    await client.listBundles();
    expect(requests).toHaveLength(fixture.accepted ? 2 : 1);
  });
  it('supplementary Unicode survives search pagination', async () => {
    const displayName = '😀'.repeat(30);
    let page = 0;
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          users: [],
          limit: 10,
          query: displayName,
          ...(page++ === 0 ? { nextCursor: userId } : {}),
        }),
      );
    };
    for await (const page of rest(origin).searchUsersPages({ displayName })) {
      expect(page.users).toEqual([]);
    }
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(new URL(request.url, origin).searchParams.get('displayName')).toBe(displayName);
  });
  it('C01: construction/builders are offline and hide credentials', () => {
    const fetch = vi.fn();
    const a = rest(origin, { fetch });
    const b = webhook(origin, { fetch });
    buildStartSignal({ version: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(inspect([a, b])).not.toContain(accountKey);
    expect(inspect([a, b])).not.toContain(strategyKey);
    expect(() => new RestClient({ baseUrl: origin, accountApiKey: accountKey })).toThrow(SdkError);
    expect(
      () =>
        new RestClient({
          baseUrl: 'http://example.com',
          accountApiKey: accountKey,
          allowLocalHttp: true,
        }),
    ).toThrow(SdkError);
    expect(
      () =>
        new RestClient({ baseUrl: 'https://user:secret@example.com', accountApiKey: accountKey }),
    ).toThrow(SdkError);
  });
  it.each(restFixtures)('C02: REST fixture $id', async (fixture) => {
    respond(fixture.expectedStatus, fixture.response);
    if (fixture.expectedStatus !== 200) {
      await expect(async () => invoke(fixture)).rejects.toMatchObject({ kind: 'validation' });
      expect(requests).toHaveLength(0);
      return;
    }
    const result = await invoke(fixture);
    expect(result).toBeDefined();
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const url = new URL(request.url, origin);
    expect(url.pathname).toBe('/api/rest' + fixture.request.path);
    expect(Object.fromEntries(url.searchParams)).toEqual(fixture.request.query);
    expect(request.method).toBe(fixture.request.method);
    expect(request.authorization).toBe('Bearer ' + accountKey);
    if (fixture.request.body) expect(JSON.parse(request.body)).toEqual(fixture.request.body);
    expect(request.url).not.toContain(accountKey);
    expect(request.url).not.toContain(strategyKey);
  });
  it.each(signals)('C03/C04: outgoing signal fixture $id', async (fixture) => {
    const accepted = fixture.schemaAccepted && fixture.parserAccepted;
    if (!accepted) {
      expect(() => serializeSignal(fixture.payload)).toThrow(SdkError);
      return;
    }
    expect(JSON.parse(serializeSignal(fixture.payload))).toEqual(fixture.payload);
    respond(204, undefined);
    await webhook(origin).send({ strategyApiKey: strategyKey, payload: fixture.payload });
    expect(JSON.parse(requests[0]!.body)).toEqual(fixture.payload);
    expect(requests[0]!.url).toBe('/webhooks/signals/v1/' + strategyKey);
    expect(requests[0]!.authorization).toBeUndefined();
  });
  it('C03: sell prices, non-finite values, unsafe timestamps and unknown fields are rejected', () => {
    // @ts-expect-error JavaScript callers can omit the whole argument.
    expect(() => buildSignal()).toThrow(SdkError);
    for (const number of [NaN, Infinity, -Infinity]) {
      expect(() => buildStartSignal({ version: number })).toThrow(SdkError);
      expect(() =>
        buildOpenSignal({ version: 1, marketPrice: number, order: { side: 'buy' } }),
      ).toThrow(SdkError);
      expect(() =>
        buildOpenSignal({
          version: 1,
          marketPrice: 100,
          order: { side: 'buy', takeProfits: [{ price: 110, percent: number }] },
        }),
      ).toThrow(SdkError);
    }
    expect(() => buildStartSignal({ version: 1, timestamp: '9007199254740992' })).toThrow(SdkError);
    expect(() =>
      buildOpenSignal({ version: 1, marketPrice: 100, order: { side: 'sell', stop: 90 } }),
    ).toThrow(SdkError);
    expect(() =>
      buildOpenSignal({ version: 1, marketPrice: 100, order: { side: 'sell', price: 90 } }),
    ).toThrow(SdkError);
    expect(() =>
      buildOpenSignal({ version: 1, marketPrice: 100, order: { side: 'sell', triggerPrice: 110 } }),
    ).toThrow(SdkError);
    expect(() =>
      buildOpenSignal({
        version: 1,
        marketPrice: 100,
        order: { side: 'sell', price: 95, triggerPrice: 99 },
      }),
    ).toThrow(SdkError);
    expect(() =>
      buildOpenSignal({
        version: 1,
        marketPrice: 100,
        order: { side: 'sell', takeProfits: [{ price: 110, percent: 100 }] },
      }),
    ).toThrow(SdkError);
    // @ts-expect-error force is unavailable on management actions
    expect(() => buildStartSignal({ version: 1, force: true })).toThrow(SdkError);
  });
  it('C04/C05: builders clone inputs, preserve TP intent, and fix metadata before delivery', async () => {
    respond(204, undefined);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1720000000000);
    const omitted = buildUpdateSignal({
      version: 1.5,
      marketPrice: 100.12345678912345,
      order: { side: 'buy' },
    });
    const empty = buildUpdateSignal({
      version: 1.5,
      marketPrice: 100,
      order: { side: 'buy', takeProfits: [] },
    });
    expect(omitted.order).not.toHaveProperty('takeProfits');
    expect(empty.order.takeProfits).toEqual([]);
    expect(omitted.timestamp).toBe('1720000000000');
    expect(omitted.version).toBe(1.5);
    clock.mockReturnValue(1720000000001);
    await webhook(origin).send({ strategyApiKey: strategyKey, payload: omitted });
    await webhook(origin).send({ strategyApiKey: strategyKey, payload: omitted });
    expect(requests[0]!.body).toBe(requests[1]!.body);
    expect(buildStartSignal({ version: 1, timestamp: '12' }).timestamp).toBe('12');
    expect(buildDeleteSignal({ version: 1 }).timestamp).toBe('1720000000001');
    expect(buildSignal({ action: 'close', version: 1 }).action).toBe('close');
    expect(JSON.parse(requests[0]!.body).marketPrice).toBe(100.12345678912345);
  });
  it('C06: all traversals continue through empty pages, preserve filters, and terminate', async () => {
    for (const kind of ['bundles', 'users', 'grants', 'search'] as const) {
      requests.length = 0;
      handler = (request, response) => {
        const cursor = new URL(request.url!, origin).searchParams.get('cursor');
        const key = kind === 'search' ? 'users' : kind;
        response.end(
          JSON.stringify({
            [key]: [],
            limit: 17,
            ...(kind === 'search' ? { query: 'Al' } : {}),
            ...(cursor ? {} : { nextCursor: kind === 'users' ? 'scan:' + grantId : grantId }),
          }),
        );
      };
      const client = rest(origin);
      const iterator =
        kind === 'bundles'
          ? client.listBundlesPages({ limit: 17 })
          : kind === 'users'
            ? client.listBundleUsersPages({ bundleId, limit: 17 })
            : kind === 'grants'
              ? client.listBundleGrantsPages({
                  bundleId,
                  limit: 17,
                  sort: 'startsAt',
                  dir: 'asc',
                  sourceId: 'invoice:1',
                  startsAfter: '2026-07-19T12:00:00.000Z',
                })
              : client.searchUsersPages({ displayName: 'Al', limit: 17 });
      let count = 0;
      for await (const page of iterator) {
        expect(page.limit).toBe(17);
        count++;
      }
      expect(count).toBe(2);
      expect(requests).toHaveLength(2);
      for (const request of requests)
        expect(new URL(request.url, origin).searchParams.get('limit')).toBe('17');
      const query = new URL(requests[1]!.url, origin).searchParams;
      if (kind === 'grants') {
        expect(query.get('sourceId')).toBe('invoice:1');
        expect(query.get('startsAfter')).toBe('2026-07-19T12:00:00.000Z');
        expect(query.get('sort')).toBe('startsAt');
        expect(query.get('dir')).toBe('asc');
      }
      if (kind === 'search') expect(query.get('displayName')).toBe('Al');
    }
  });
  it('C06: repeated cursors fail and traversal can be cancelled between pages', async () => {
    respond(200, { bundles: [], limit: 50, nextCursor: grantId });
    const iterator = rest(origin).listBundlesPages();
    await iterator.next();
    await iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({ kind: 'pagination' });
    const controller = new AbortController();
    const cancelled = rest(origin).listBundlesPages({}, { signal: controller.signal });
    await cancelled.next();
    controller.abort();
    await expect(cancelled.next()).rejects.toMatchObject({ kind: 'cancelled' });
  });
  it.each([400, 401, 403, 404, 409, 410, 413, 429, 500, 502, 503])(
    'C07/C08: status %i exposes safe details and never retries',
    async (status) => {
      respond(status, {
        errorCode: 'errors.vector.denied',
        message: 'Denied',
        requestId: 'req-test',
      });
      await expect(
        rest(origin).createBundleGrant({
          bundleId,
          createGrantRequest: { userId, grantType: 'gift' },
        }),
      ).rejects.toMatchObject({
        kind: 'http',
        status,
        code: 'errors.vector.denied',
        message: 'Denied',
        requestId: 'req-test',
      });
      expect(requests).toHaveLength(1);
      requests.length = 0;
      await expect(
        webhook(origin).send({
          strategyApiKey: strategyKey,
          payload: buildStartSignal({ version: 1 }),
        }),
      ).rejects.toMatchObject({
        kind: 'http',
        status,
      });
      expect(requests).toHaveLength(1);
    },
  );
  it('C07: error variants, private data and credentials never leak', async () => {
    respond(500, { errorCode: 'errors.vector.501', message: 'Unavailable', requestId: 'req-123' });
    await expect(
      webhook(origin).send({
        strategyApiKey: strategyKey,
        payload: buildStartSignal({ version: 1 }),
      }),
    ).rejects.toMatchObject({
      status: 500,
      code: 'errors.vector.501',
      requestId: 'req-123',
    });
    for (const body of ['', '<h1>Bad gateway</h1>', { success: false, error: 'Rate limited' }]) {
      respond(429, body);
      await expect(rest(origin).listBundles()).rejects.toMatchObject({ kind: 'http', status: 429 });
    }
    respond(400, {
      message: 'Bearer ' + accountKey + ' https://example.com/webhooks/signals/v1/' + strategyKey,
      metadata: { secret: accountKey },
      requestId: 'req-redaction',
    });
    const error = await rest(origin)
      .listBundles()
      .catch((error) => error as SdkError);
    expect(error).toBeInstanceOf(SdkError);
    expect(inspect(error)).not.toContain(accountKey);
    expect(inspect(error)).not.toContain(strategyKey);
    respond(400, { message: 'private user ' + userId + ' invoice:private', metadata: { userId } });
    const privateError = await rest(origin)
      .createBundleGrant({
        bundleId,
        createGrantRequest: { userId, grantType: 'paid_external', sourceId: 'invoice:private' },
      })
      .catch((error) => error as SdkError);
    expect(inspect(privateError)).not.toContain(userId);
    expect(inspect(privateError)).not.toContain('invoice:private');
    const fetch = vi.fn().mockRejectedValue(new Error('Bearer ' + accountKey + ' ' + strategyKey));
    const transportError = await rest(origin, { fetch })
      .listBundles()
      .catch((error) => error as SdkError);
    expect(transportError).toMatchObject({ kind: 'transport' });
    expect(inspect(transportError)).not.toContain(accountKey);
    expect(inspect(transportError)).not.toContain(strategyKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('C08/C09: acknowledgement, timeouts and cancellation have no automatic retries', async () => {
    respond(204, undefined);
    await expect(
      webhook(origin).send({
        strategyApiKey: strategyKey,
        payload: buildStartSignal({ version: 1 }),
      }),
    ).resolves.toBeUndefined();
    respond(200, {});
    await expect(
      webhook(origin).send({
        strategyApiKey: strategyKey,
        payload: buildStartSignal({ version: 1 }),
      }),
    ).rejects.toMatchObject({
      kind: 'protocol',
    });
    requests.length = 0;
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('{');
    };
    await expect(rest(origin, { timeoutMs: 30 }).listBundles()).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(requests).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    const prior = requests.length;
    await expect(rest(origin).listBundles({}, { signal: controller.signal })).rejects.toMatchObject(
      { kind: 'cancelled' },
    );
    expect(requests).toHaveLength(prior);
    const pending = rest(origin).listBundles(
      {},
      {
        signal: (() => {
          const c = new AbortController();
          setTimeout(() => c.abort(), 20);
          return c.signal;
        })(),
      },
    );
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });
  it('C08: timed-out mutations and lost webhook responses remain single attempts', async () => {
    handler = () => {};
    await expect(
      rest(origin, { timeoutMs: 30 }).createBundleGrant({
        bundleId,
        createGrantRequest: { userId, grantType: 'gift' },
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(requests).toHaveLength(1);
    requests.length = 0;
    await expect(
      webhook(origin, { timeoutMs: 30 }).send({
        strategyApiKey: strategyKey,
        payload: buildStartSignal({ version: 1 }),
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(requests).toHaveLength(1);
  });
  it('C09: redirects never forward credentials to another server', async () => {
    let hits = 0;
    const target = createServer((_request, response) => {
      hits++;
      response.end();
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const addr = target.address();
    if (!addr || typeof addr === 'string') throw new Error('No target address');
    try {
      respond(307, '', { Location: 'http://127.0.0.1:' + addr.port + '/target' });
      await expect(rest(origin).listBundles()).rejects.toMatchObject({ kind: 'http', status: 307 });
      await expect(
        webhook(origin).send({
          strategyApiKey: strategyKey,
          payload: buildStartSignal({ version: 1 }),
        }),
      ).rejects.toMatchObject({
        kind: 'http',
        status: 307,
      });
      expect(hits).toBe(0);
    } finally {
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });
  it('C10: Unicode query encoding and UTF-8 body limits are enforced before sending', async () => {
    respond(200, { users: [], query: 'Ал"\\', limit: 10 });
    await rest(origin).searchUsers({ displayName: 'Ал"\\' });
    expect(new URL(requests[0]!.url, origin).searchParams.get('displayName')).toBe('Ал"\\');
    const before = requests.length;
    await expect(
      webhook(origin).send({
        strategyApiKey: strategyKey,
        payload: { action: 'start', version: 1, timestamp: '0'.repeat(16 * 1024) },
      }),
    ).rejects.toMatchObject({ kind: 'validation', message: 'Signal body exceeds 16 KiB' });
    expect(() => buildStartSignal({ version: 1, timestamp: '0'.repeat(16 * 1024) })).toThrow(
      'Signal body exceeds 16 KiB',
    );
    await expect(
      rest(origin).createBundleGrant({
        bundleId,
        createGrantRequest: {
          userId,
          grantType: 'gift',
          endsAt: '2026-07-19T12:00:00.' + '0'.repeat(17_000) + 'Z',
        },
      }),
    ).rejects.toMatchObject({ kind: 'validation', message: 'Request body exceeds 16 KiB' });
    const huge = buildStartSignal({ version: 1 });
    // @ts-expect-error unknown fields cannot bypass body/shape checks
    huge.extra = 'я'.repeat(9000);
    await expect(
      webhook(origin).send({ strategyApiKey: strategyKey, payload: huge }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(requests).toHaveLength(before);
    await expect(rest(origin).searchUsers({ displayName: 'x'.repeat(31) })).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(() =>
      buildStartSignal({ version: 1, hashtag: 'test', timestamp: null as unknown as string }),
    ).toThrow(SdkError);
  });
  it('C11: optional response additions are tolerated and incompatible responses fail clearly', async () => {
    respond(200, {
      users: [
        { userId, displayName: 'Example', avatar: null },
        { userId, displayName: 'Example' },
      ],
      query: 'Al',
      limit: 10,
    });
    const users = await rest(origin).searchUsers({ displayName: 'Al' });
    expect(users.users[0]!.avatar).toBeNull();
    expect(users.users[1]!.avatar).toBeUndefined();
    respond(200, { bundles: [], limit: 50, future: { added: true } });
    await expect(rest(origin).listBundles()).resolves.toMatchObject({ bundles: [], limit: 50 });
    for (const body of [{ bundles: [], limit: '50' }, { bundles: {} }, null, 'not-json']) {
      respond(200, body);
      await expect(rest(origin).listBundles()).rejects.toMatchObject({ kind: 'protocol' });
    }
  });
});
