import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SignalPayloadFromJSON,
  SignalPayloadToJSON,
  CreateGrantRequestFromJSON,
  CreateGrantRequestToJSON,
  Configuration,
  DefaultApi,
  BundlesResponseFromJSON,
} from './index.js';
const root = process.argv[2]!;
const fixtures = JSON.parse(readFileSync(root + '/conformance/signals/cases.json', 'utf8')) as {
  id: string;
  payload: unknown;
  schemaAccepted: boolean;
  parserAccepted: boolean;
}[];
let count = 0;
for (const f of fixtures.filter((f) => f.schemaAccepted && f.parserAccepted)) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(SignalPayloadToJSON(SignalPayloadFromJSON(f.payload)))),
    f.payload,
    f.id,
  );
  count++;
}
for (const kind of ['owner_grant', 'referral_reward', 'gift', 'paid_external']) {
  const payload = {
    userId: 'a'.repeat(32),
    grantType: kind,
    ...(kind === 'paid_external' ? { sourceId: 'invoice:1' } : {}),
    endsAt: '2026-07-19T12:00:00.000Z',
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(CreateGrantRequestToJSON(CreateGrantRequestFromJSON(payload)))),
    payload,
  );
}
const update = {
  action: 'update',
  version: 1.5,
  timestamp: '1720000000000',
  marketPrice: 123456789.123456,
  order: { side: 'buy' },
};
assert.throws(() =>
  SignalPayloadFromJSON({ ...update, order: { side: 'buy', takeProfits: null } }),
);
assert.throws(() => SignalPayloadFromJSON({ ...update, version: NaN }));
assert.throws(() =>
  CreateGrantRequestFromJSON({ userId: 'a'.repeat(32), grantType: 'paid_external' }),
);
assert.equal(BundlesResponseFromJSON({ bundles: [], limit: 50, futureField: true }).limit, 50);
let requests = 0;
const api = new DefaultApi(
  new Configuration({
    basePath: 'http://127.0.0.1:9999/api/rest',
    accessToken: 'synthetic-token',
    fetchApi: async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:9999/api/rest/v1/bundles?limit=17');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token');
      requests++;
      return new Response('{"bundles":[],"limit":17}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  }),
);
await api.listBundles({ limit: 17 });
assert.equal(requests, 1);
console.log(
  'TypeScript: ' +
    count +
    ' signal fixtures, four grant variants, dates, null/non-finite rejection and Bearer request passed.',
);
