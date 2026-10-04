import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestClient, SignalsClient, buildStartSignal, type Fetch } from '../src/index.js';

const limit = 1_048_576;
const keyA = 'a'.repeat(32);
const keyB = 'b'.repeat(32);
const keyC = 'c'.repeat(32);
const account = 'vt_synthetic_response_tests';
const encoder = new TextEncoder();
const page = { bundles: [], limit: 1 };
const success = () => new Response(JSON.stringify(page), { status: 200 });
const rest = (fetch: Fetch, timeoutMs = 1000) =>
  new RestClient({
    baseUrl: 'https://example.invalid/api/rest',
    accountApiKey: account,
    fetch,
    timeoutMs,
  });

function jsonBytes(size: number, status: number): Uint8Array {
  const base =
    status === 200
      ? JSON.stringify(page)
      : JSON.stringify({ message: 'Unavailable', errorCode: 'E501' });
  return encoder.encode(base + ' '.repeat(size - encoder.encode(base).length));
}

function streamResponse(
  chunks: Uint8Array[],
  status = 200,
  headers = {},
  cleanup = () => Promise.resolve(),
) {
  let pulls = 0;
  const cancel = vi.fn(cleanup);
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[pulls++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { status, headers }), body, cancel, pulls: () => pulls };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded public response consumption', () => {
  it.each([200, 502])('rejects a %i response at one byte beyond 1 MiB', async (status) => {
    const oversized = streamResponse([jsonBytes(limit + 1, status)], status);
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(oversized.response)
      .mockImplementationOnce(async () => success());
    const client = rest(fetch);
    await expect(client.listBundles()).rejects.toMatchObject({ kind: 'protocol' });
    expect(oversized.cancel).toHaveBeenCalledTimes(1);
    expect(oversized.body.locked).toBe(false);
    await expect(client.listBundles()).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: 'missing', value: undefined, expected: 'edge-123' },
    { name: 'null', value: null, expected: 'edge-123' },
    { name: 'number', value: 42, expected: 'edge-123' },
    { name: 'false', value: false, expected: 'edge-123' },
    { name: 'true', value: true, expected: 'edge-123' },
    { name: 'array', value: [], expected: 'edge-123' },
    { name: 'object', value: {}, expected: 'edge-123' },
    { name: 'string', value: 'body-id', expected: 'body-id' },
    { name: 'empty', value: '', expected: undefined },
  ])('selects REST request IDs for $name', async ({ value: requestId, expected }) => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unavailable', errorCode: 'E501', requestId }), {
          status: 502,
          headers: { 'x-request-id': 'edge-123' },
        }),
      )
      .mockImplementationOnce(async () => success());
    const client = rest(fetch);
    await expect(client.listBundles()).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: 'E501',
      requestId: expected,
    });
    await expect(client.listBundles()).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([limit - 1, limit])('accepts %i actual bytes in a successful response', async (size) => {
    const chunks = jsonBytes(size, 200);
    const response = streamResponse([chunks.subarray(0, 17), chunks.subarray(17)], 200, {
      'content-length': '9999999999',
    });
    await expect(rest(async () => response.response).listBundles()).resolves.toMatchObject(page);
    expect(response.cancel).not.toHaveBeenCalled();
    expect(response.body.locked).toBe(false);
  });

  it.each([limit - 1, limit])('keeps HTTP classification at %i error bytes', async (size) => {
    const response = streamResponse([jsonBytes(size, 502)], 502);
    await expect(rest(async () => response.response).listBundles()).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: 'E501',
    });
    expect(response.cancel).not.toHaveBeenCalled();
    expect(response.body.locked).toBe(false);
  });

  it.each([limit - 1, limit, limit + 1])(
    'handles non-JSON error boundaries at %i bytes',
    async (size) => {
      const response = streamResponse([new Uint8Array(size).fill(120)], 502, {
        'x-request-id': 'edge-plain',
      });
      const error = await rest(async () => response.response)
        .listBundles()
        .catch((error: unknown) => error);
      expect(error).toMatchObject(
        size > limit
          ? { kind: 'protocol', status: undefined, code: undefined, requestId: undefined }
          : { kind: 'http', status: 502, code: undefined, requestId: 'edge-plain' },
      );
      expect(response.cancel).toHaveBeenCalledTimes(size > limit ? 1 : 0);
      expect(response.body.locked).toBe(false);
    },
  );

  it.each(['absent', 'understated', 'overstated'])(
    'counts actual bytes despite %s Content-Length',
    async (mode) => {
      const bytes = jsonBytes(limit + 1, 200);
      const headers =
        mode === 'absent' ? {} : { 'content-length': mode === 'understated' ? '1' : '99999999' };
      const response = streamResponse(
        [bytes.subarray(0, limit), bytes.subarray(limit), encoder.encode('must not be read')],
        200,
        headers,
      );
      await expect(rest(async () => response.response).listBundles()).rejects.toMatchObject({
        kind: 'protocol',
      });
      expect(response.pulls()).toBe(2);
      expect(response.cancel).toHaveBeenCalledTimes(1);
      expect(response.body.locked).toBe(false);
    },
  );

  it.each(['rejects', 'throws', 'never settles'])(
    'preserves cap error when stream cleanup %s',
    async (mode) => {
      const response = streamResponse([jsonBytes(limit + 1, 502)], 502, {}, () => {
        if (mode === 'throws') throw new Error('private cleanup cause');
        return mode === 'rejects'
          ? Promise.reject(new Error('private cleanup cause'))
          : new Promise<void>(() => {});
      });
      const fetch = vi
        .fn<Fetch>()
        .mockResolvedValueOnce(response.response)
        .mockImplementationOnce(async () => success());
      const client = rest(fetch);
      const error = await client.listBundles().catch((error: unknown) => error);
      expect(error).toMatchObject({ kind: 'protocol' });
      expect(inspect(error)).not.toContain('private cleanup cause');
      expect(response.body.locked).toBe(false);
      expect(response.cancel).toHaveBeenCalledTimes(1);
      await expect(client.listBundles()).resolves.toMatchObject(page);
    },
  );

  it('preserves cap error even when a custom reader cancellation throws synchronously', async () => {
    const response = streamResponse([jsonBytes(limit + 1, 502)], 502);
    vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel').mockImplementationOnce(() => {
      throw new Error('private reader cause');
    });
    await expect(rest(async () => response.response).listBundles()).rejects.toMatchObject({
      kind: 'protocol',
    });
    expect(response.body.locked).toBe(false);
  });

  it('decodes split UTF-8 and BOM with the same replacement behavior as Response.text', async () => {
    const bytes = encoder.encode('\uFEFF{"bundles":[],"limit":1,"extra":"🙂é"}');
    const response = streamResponse(Array.from(bytes, (byte) => new Uint8Array([byte])));
    await expect(rest(async () => response.response).listBundles()).resolves.toMatchObject(page);
    expect(response.body.locked).toBe(false);
    const malformed = new Uint8Array([
      ...encoder.encode('{"message":"'),
      0xf0,
      0x28,
      0x8c,
      0x28,
      ...encoder.encode('"}'),
    ]);
    const expected = JSON.parse(await new Response(malformed).text()) as { message: string };
    const errorResponse = streamResponse(
      Array.from(malformed, (byte) => new Uint8Array([byte])),
      502,
    );
    await expect(rest(async () => errorResponse.response).listBundles()).rejects.toMatchObject({
      kind: 'http',
      message: expected.message,
    });
  });

  it('enforces bytes rather than decoded UTF-16 length', async () => {
    const bytes = encoder.encode(JSON.stringify({ message: 'é'.repeat(limit / 2) }));
    expect(bytes.byteLength).toBeGreaterThan(limit);
    expect(new TextDecoder().decode(bytes).length).toBeLessThan(limit);
    await expect(
      rest(async () => new Response(bytes, { status: 502 })).listBundles(),
    ).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('handles null response bodies through the existing protocol and HTTP paths', async () => {
    await expect(
      rest(async () => new Response(null, { status: 200 })).listBundles(),
    ).rejects.toMatchObject({ kind: 'protocol' });
    await expect(
      rest(
        async () => new Response(null, { status: 502, headers: { 'x-request-id': 'edge-empty' } }),
      ).listBundles(),
    ).rejects.toMatchObject({ kind: 'http', status: 502, requestId: 'edge-empty' });
    const signals = new SignalsClient({ fetch: async () => new Response(null, { status: 204 }) });
    await expect(
      signals.send({ strategyApiKey: keyA, payload: buildStartSignal({ version: 1 }) }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { surface: 'REST', kind: 'timeout' },
    { surface: 'REST', kind: 'cancelled' },
    { surface: 'signals', kind: 'timeout' },
    { surface: 'signals', kind: 'cancelled' },
  ])(
    'releases a pending $surface reader on $kind without awaiting user cleanup',
    async ({ surface, kind }) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      let started = () => {};
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            started();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      let pendingSignal: AbortSignal | null | undefined;
      const fetch = vi
        .fn<Fetch>()
        .mockImplementationOnce(async (_input, init) => {
          pendingSignal = init?.signal;
          return new Response(body);
        })
        .mockImplementationOnce(async () =>
          surface === 'signals' ? new Response(null, { status: 204 }) : success(),
        );
      const controller = new AbortController();
      let invoke: (signal: AbortSignal | undefined, key?: string) => Promise<unknown>;
      if (surface === 'signals') {
        const client = new SignalsClient({ fetch, timeoutMs: 15 });
        const prepared = buildStartSignal({ version: 1 });
        invoke = (signal, key = keyA) =>
          client.send({ strategyApiKey: key, payload: prepared }, signal ? { signal } : {});
      } else {
        const client = rest(fetch, 15);
        invoke = (signal) => client.listBundles({}, signal ? { signal } : {});
      }
      const failed = invoke(controller.signal);
      const settled = expect(failed).rejects.toMatchObject({ kind });
      await reading;
      expect(body.locked).toBe(true);
      if (kind === 'cancelled') controller.abort();
      await settled;
      expect(pendingSignal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
      if (surface === 'signals') {
        await expect(invoke(undefined, keyC)).resolves.toBeUndefined();
        expect(String(fetch.mock.calls[1]?.[0])).toContain(`/webhooks/signals/v1/${keyC}`);
      } else {
        await expect(invoke(undefined)).resolves.toMatchObject(page);
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('checks an observed cancellation before classifying an oversized chunk', async () => {
    const caller = new AbortController();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(jsonBytes(limit + 1, 200));
          caller.abort();
        },
      },
      { highWaterMark: 0 },
    );
    await expect(
      rest(async () => new Response(body)).listBundles({}, { signal: caller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(body.locked).toBe(false);
  });

  it('keeps timeout precedence when timeout and caller cancellation are both observed', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let started = () => {};
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          started();
        },
      },
      { highWaterMark: 0 },
    );
    const failed = rest(async () => new Response(body), 10).listBundles(
      {},
      { signal: caller.signal },
    );
    const settled = expect(failed).rejects.toMatchObject({ kind: 'timeout' });
    await reading;
    vi.advanceTimersByTime(10);
    caller.abort();
    await settled;
    expect(body.locked).toBe(false);
  });

  it('removes timer and abort listeners after stream completion', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeCaller = vi.spyOn(caller.signal, 'removeEventListener');
    let removeReader: ReturnType<typeof vi.spyOn> | undefined;
    const fetch: Fetch = async (_input, init) => {
      removeReader = vi.spyOn(init!.signal!, 'removeEventListener');
      return success();
    };
    await rest(fetch).listBundles({}, { signal: caller.signal });
    expect(removeCaller).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeReader).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { name: 'missing', value: undefined },
    { name: 'null', value: null },
    { name: 'number', value: 42 },
    { name: 'false', value: false },
    { name: 'true', value: true },
    { name: 'array', value: [] },
    { name: 'object', value: {} },
    { name: 'string', value: 'body-id' },
    { name: 'empty', value: '' },
  ])('selects and sanitizes signal request IDs for $name', async ({ name, value }) => {
    const calls: string[] = [];
    const fetch: Fetch = async (input) => {
      calls.push(String(input));
      if (calls.length > 1) return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify({
          message: 'Unavailable',
          errorCode: 'E501',
          ...(name === 'missing' ? {} : { requestId: value }),
        }),
        { status: 502, headers: { 'x-request-id': `edge${keyA} https://private.invalid/${keyA}` } },
      );
    };
    const client = new SignalsClient({ fetch });
    const error = await client
      .send({ strategyApiKey: keyA, payload: buildStartSignal({ version: 1 }) })
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'http', status: 502, code: 'E501' });
    if (name === 'string') expect(error).toHaveProperty('requestId', 'body-id');
    else if (name === 'empty') expect(error).toHaveProperty('requestId', undefined);
    else expect(error).toHaveProperty('requestId', 'edge[redacted] [redacted]');
    expect(inspect(error)).not.toContain(keyA);
    expect(inspect(error)).not.toContain('private.invalid');
    await client.send({ strategyApiKey: keyB, payload: buildStartSignal({ version: 1 }) });
    expect(calls).toHaveLength(2);
  });

  it.each(['bad first', 'valid first'])(
    'isolates concurrent oversized and valid strategies: %s',
    async (order) => {
      const calls: string[] = [];
      const bad = streamResponse([jsonBytes(limit + 1, 502)], 502);
      let releaseBad: (response: Response) => void = () => {};
      let releaseValid: (response: Response) => void = () => {};
      const fetch: Fetch = (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path.endsWith(keyA))
          return new Promise((resolve) => {
            releaseBad = resolve;
          });
        if (path.endsWith(keyB))
          return new Promise((resolve) => {
            releaseValid = resolve;
          });
        return Promise.resolve(new Response(null, { status: 204 }));
      };
      const client = new SignalsClient({ fetch });
      const prepared = buildStartSignal({ version: 2, timestamp: '1780000000000' });
      const a = client.send({ strategyApiKey: keyA, payload: prepared });
      const badResult = expect(a).rejects.toMatchObject({ kind: 'protocol' });
      const b = client.send({ strategyApiKey: keyB, payload: prepared });
      expect(calls).toHaveLength(2);
      if (order === 'bad first') {
        releaseBad(bad.response);
        await badResult;
        releaseValid(new Response(null, { status: 204 }));
        await b;
      } else {
        releaseValid(new Response(null, { status: 204 }));
        await b;
        releaseBad(bad.response);
        await badResult;
      }
      expect(bad.body.locked).toBe(false);
      await client.send({ strategyApiKey: keyC, payload: prepared });
      expect(calls).toEqual([keyA, keyB, keyC].map((key) => `/webhooks/signals/v1/${key}`));
      expect(prepared.timestamp).toBe('1780000000000');
    },
  );

  it('limits decompressed bytes from the native fetch stream', async () => {
    const bytes = jsonBytes(limit + 1, 200);
    const zipped = gzipSync(bytes);
    expect(zipped.byteLength).toBeLessThan(limit);
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      if (calls === 1)
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Content-Length': zipped.byteLength,
          })
          .end(zipped);
      else
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(page));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test server');
      const client = new RestClient({
        baseUrl: `http://127.0.0.1:${address.port}/api/rest`,
        accountApiKey: account,
        allowLocalHttp: true,
      });
      await expect(client.listBundles()).rejects.toMatchObject({ kind: 'protocol' });
      await expect(client.listBundles()).resolves.toMatchObject(page);
      expect(calls).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
