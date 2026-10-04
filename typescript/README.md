# Vector Trading SDK for JavaScript and TypeScript

This package provides seven account-key REST operations and eight strategy signal
builders, plus explicit webhook delivery. It has no external runtime dependencies.
Node.js 22 and 24 are tested. Account keys belong in server-side integrations.

Omitting `baseUrl` selects `https://www.vector-trading.app/api/rest` for REST and
`https://www.vector-trading.app` for signals. Supply `baseUrl` to use another deployment;
a REST override includes `/api/rest`.

The package is prepared locally; it has not been published to npm. From the repository:

```sh
pnpm build:typescript
pnpm --dir typescript pack --pack-destination ../.cache/packages
npm install /path/to/vector-trading-sdk-0.1.0.tgz
```

Both `import` and `require` use the same named public exports, with `.d.ts` and `.d.cts`
declarations. Only the package root is public; generated implementation paths are internal.

```ts
import {
  RestClient,
  SignalsClient,
  buildOpenSignal,
  buildUpdateSignal,
  SdkError,
} from '@vector-trading/sdk';

const rest = new RestClient({
  accountApiKey: process.env.VECTOR_ACCOUNT_KEY!,
  timeoutMs: 10_000,
});
for await (const page of rest.listBundlesPages({ limit: 50 })) {
  // Consume page.bundles in your application.
}

const signals = new SignalsClient();
const message = buildOpenSignal({
  version: 1,
  marketPrice: 100,
  order: { side: 'buy', stop: 90, takeProfits: [{ price: 110, percent: 100 }] },
});
try {
  await signals.send({ strategyApiKey: process.env.VECTOR_STRATEGY_KEY!, payload: message });
  await signals.send({ strategyApiKey: process.env.VECTOR_OTHER_STRATEGY_KEY!, payload: message });
} catch (error) {
  if (error instanceof SdkError) {
    // Inspect kind, status, code, and requestId without logging private inputs.
  }
  throw error;
}
const clearTargets = buildUpdateSignal({
  version: 1,
  marketPrice: 100,
  order: { side: 'buy', takeProfits: [] },
});
```

## Public operations and inputs

REST methods accept parameter objects: `listBundles`, `searchUsers`, `getCheckout`,
`listBundleUsers`, `listBundleGrants`, `createBundleGrant`, and `revokeBundleGrant`.
For example, `createBundleGrant({ bundleId, createGrantRequest: { userId,
grantType: 'paid_external', sourceId: 'invoice:example', endsAt: '2026-07-19T12:00:00.000Z' } })`.
Dates remain ISO strings. The generated bundle model exposes transport `_id` as `id`.
Exported request/response types describe the methods; arbitrary internal server types
are not required. All list methods also have a `Pages` variant returning an async page
iterator. Empty pages with `nextCursor` continue; repeated cursors fail explicitly.

Unknown own enumerable string keys in REST request objects fail with `validation`
before HTTP delivery, even when their value is `undefined`. For example, use `userId`
for grant filtering; a misspelled `userID` is rejected instead of silently omitting
the filter. The supported body argument is `createGrantRequest`.

Nested transport types are available through root `import type` declarations,
including `CheckoutDetailsDiscount`, `OpenSignalPayloadOrderTakeProfitsInner`,
`OtherGrantRequest`, and `PaidExternalGrantRequest`. Named enumeration types describe
literal values; they do not expose JavaScript enumeration constants. For example,
`const grantType: TradingBundleAccessGrantType = 'gift'` uses an imported type.

Builders are `buildOpenSignal`, `buildUpdateSignal`, `buildCancelSignal`,
`buildCloseSignal`, `buildStartSignal`, `buildPauseSignal`, `buildStopSignal`, and
`buildDeleteSignal`. `buildSignal` accepts an explicit action; `serializeSignal`
validates an already prepared payload and returns its JSON. Builders work offline.
The signal client stores transport settings only. Supply the strategy key for every `send`;
one client can serve multiple strategies, including concurrent calls. The key is carried
in the webhook path and is never added to the signal JSON.

Each builder requires the strategy's positive finite `version` and fixes a decimal
millisecond `timestamp` before delivery; a caller may supply it explicitly.
Sending the same prepared message again does not create another timestamp.
Signals built in the same millisecond are not guaranteed unique.

Optional fields preserve intent: omitted update `takeProfits` preserves targets,
`[]` clears them, and a non-empty list replaces them; `null` is rejected.
The recommended subset rejects unknown input fields, unsupported update `amountPerc`,
management `force`, invalid TP/SL/entry relationships, and non-finite numbers.
UTF-8 request bodies cannot exceed 16 KiB. Optional response additions are tolerated.

## Transport and errors

REST and webhook credentials are configured separately. Clients perform no requests
or polling on construction. HTTPS is required; `allowLocalHttp: true` permits explicit
loopback test URLs only. Redirects are not followed. An optional `fetch` implementation
must honor standard `RequestInit` cancellation and redirect settings.
The default timeout is 10 seconds; `timeoutMs` covers receiving the response body.
Every method accepts a final `{ signal: AbortSignal }` option for cancellation.

Responses, including errors, are read incrementally with a 1 MiB body limit. Exceeding
it fails with `protocol` and leaves the client available for independent calls.
See the [shared transport rules](../docs/contracts.md#rest-errors-and-transport) for
byte counting, request ID precedence, and the memory and delivery guarantees.

No requests are automatically retried. Webhook `204` resolves to `undefined` and means
enqueue acceptance, not a completed trade. A timeout or transport failure may leave
the mutation's outcome unknown. `SdkError.kind` distinguishes `validation`, `http`,
`transport`, `timeout`, `cancelled`, `protocol`, and `pagination`; HTTP errors preserve
status and available code/request ID. Diagnostics are bounded and redact credentials,
sensitive URLs, and submitted string/number/boolean values in messages. Safe public error
codes and request IDs retain their values after credential/URL redaction; raw response bodies and underlying errors are
not exposed as exception causes.

## Development

```sh
pnpm --dir typescript typecheck
pnpm --dir typescript lint
pnpm test:typescript
pnpm build:typescript
pnpm test:typescript:package
```

Tests use an isolated local HTTP server and synthetic credentials. The archive check
installs the package in clean ESM, CommonJS, and TypeScript projects on Node 22/24,
compiles both declaration entry points, and calls the public API against localhost.
See the repository contract and architecture guides for provenance and shared semantics.
