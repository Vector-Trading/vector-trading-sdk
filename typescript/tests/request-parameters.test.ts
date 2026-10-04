import { expect, it } from 'vitest';
import { RestClient } from '../src/index.js';

const id = 'b'.repeat(32);
const userId = 'c'.repeat(32);
const privateName = 'synthetic_private_parameter';
const privateValue = 'synthetic_private_value';
const operations: {
  name: string;
  call: (client: RestClient, extra: Record<string, unknown>) => Promise<unknown>;
  response: Record<string, unknown>;
}[] = [
  {
    name: 'listBundles',
    call: (client: RestClient, extra: Record<string, unknown>) => client.listBundles({ ...extra }),
    response: { bundles: [], limit: 50 },
  },
  {
    name: 'searchUsers',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.searchUsers({ displayName: 'Al', ...extra }),
    response: { users: [], limit: 50, query: 'Al' },
  },
  {
    name: 'getCheckout',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.getCheckout({ checkoutId: id, ...extra }),
    response: { checkoutId: id, bundleId: id, userId, displayName: 'Example' },
  },
  {
    name: 'listBundleUsers',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.listBundleUsers({ bundleId: id, ...extra }),
    response: { users: [], limit: 50 },
  },
  {
    name: 'listBundleGrants',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.listBundleGrants({ bundleId: id, ...extra }),
    response: { grants: [], limit: 50 },
  },
  {
    name: 'createBundleGrant',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.createBundleGrant({
        bundleId: id,
        createGrantRequest: { userId, grantType: 'gift' },
        ...extra,
      }),
    response: { grant: { id, grantType: 'gift' } },
  },
  {
    name: 'revokeBundleGrant',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.revokeBundleGrant({ bundleId: id, grantId: id, ...extra }),
    response: { grant: { id, grantType: 'gift' } },
  },
];

for (const operation of operations) {
  it.each([privateValue, undefined])(
    `${operation.name} rejects unknown parameter keys (%j) before HTTP and remains usable`,
    async (value) => {
      let calls = 0;
      const client = new RestClient({
        accountApiKey: 'vt_synthetic',
        fetch: async () => {
          calls++;
          return new Response(JSON.stringify(operation.response));
        },
      });
      const error = await Promise.resolve()
        .then(() => operation.call(client, { [privateName]: value }))
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ kind: 'validation' });
      expect(String(error)).not.toContain(privateName);
      expect(String(error)).not.toContain(privateValue);
      expect(calls).toBe(0);
      await operation.call(client, {});
      expect(calls).toBe(1);
    },
  );
}

const pages = [
  {
    name: 'listBundlesPages',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.listBundlesPages({ ...extra }),
    response: { bundles: [], limit: 50 },
    filters: {},
  },
  {
    name: 'searchUsersPages',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.searchUsersPages({ displayName: 'Al', ...extra }),
    response: { users: [], limit: 50, query: 'Al' },
    filters: { displayName: 'Al' },
  },
  {
    name: 'listBundleUsersPages',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.listBundleUsersPages({ bundleId: id, ...extra }),
    response: { users: [], limit: 50 },
    filters: {},
  },
  {
    name: 'listBundleGrantsPages',
    call: (client: RestClient, extra: Record<string, unknown>) =>
      client.listBundleGrantsPages({
        bundleId: id,
        userId,
        grantType: 'gift',
        sourceId: 'invoice:example',
        startsAfter: '2026-01-01T00:00:00Z',
        endsBefore: '2027-01-01T00:00:00Z',
        createdAfter: '2025-01-01T00:00:00Z',
        sort: 'createdAt',
        dir: 'asc',
        limit: 2,
        ...extra,
      }),
    response: { grants: [], limit: 2 },
    filters: {
      userId,
      grantType: 'gift',
      sourceId: 'invoice:example',
      startsAfter: '2026-01-01T00:00:00Z',
      endsBefore: '2027-01-01T00:00:00Z',
      createdAfter: '2025-01-01T00:00:00Z',
      sort: 'createdAt',
      dir: 'asc',
      limit: '2',
    },
  },
];

for (const operation of pages) {
  it.each([privateValue, undefined])(
    `${operation.name} rejects unknown keys before loading and preserves filters thereafter (%j)`,
    async (value) => {
      const urls: URL[] = [];
      const client = new RestClient({
        accountApiKey: 'vt_synthetic',
        fetch: async (url) => {
          urls.push(new URL(String(url)));
          return new Response(
            JSON.stringify({
              ...operation.response,
              ...(urls.length === 1 ? { nextCursor: 'opaque+/next' } : {}),
            }),
          );
        },
      });
      await expect(operation.call(client, { [privateName]: value }).next()).rejects.toMatchObject({
        kind: 'validation',
      });
      expect(urls).toHaveLength(0);
      const results = [];
      for await (const page of operation.call(client, {})) results.push(page);
      expect(results).toHaveLength(2);
      expect(urls).toHaveLength(2);
      expect(urls[0]!.searchParams.has('cursor')).toBe(false);
      expect(urls[1]!.searchParams.get('cursor')).toBe('opaque+/next');
      for (const url of urls)
        for (const [key, expected] of Object.entries(operation.filters))
          expect(url.searchParams.get(key)).toBe(expected);
    },
  );
}

it('rejects a widened request with userID instead of silently dropping the filter', async () => {
  let calls = 0;
  const client = new RestClient({
    accountApiKey: 'vt_synthetic',
    fetch: async () => {
      calls++;
      return new Response('{"grants":[],"limit":50}');
    },
  });
  const widened = { bundleId: id, userID: userId };
  await expect(
    Promise.resolve().then(() => client.listBundleGrants(widened)),
  ).rejects.toMatchObject({
    kind: 'validation',
  });
  expect(calls).toBe(0);
});

it('preserves supported omission and ignores symbols and non-enumerable decorations', async () => {
  let calls = 0;
  const client = new RestClient({
    accountApiKey: 'vt_synthetic',
    fetch: async (url) => {
      calls++;
      expect(new URL(String(url)).search).toBe('');
      return new Response('{"bundles":[],"limit":50}');
    },
  });
  const parameters = {};
  Object.defineProperty(parameters, privateName, { value: privateValue });
  Object.assign(parameters, { [Symbol(privateName)]: privateValue });
  await client.listBundles(parameters);
  await operations[0]!.call(client, { limit: undefined, cursor: undefined });
  await client.listBundles();
  expect(calls).toBe(3);
});
