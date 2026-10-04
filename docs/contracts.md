# Public SDK contract

## Status and provenance

The canonical owner is the `Vector-Trading/vector-trading` server: routes in
`apps/web/hono/routes/rest-api/`, the parser in `packages/types/src/signal.ts`, and the
handler in `apps/webhook/src/lambda.ts`. The snapshot was exported from accepted server
`main` commit `e51366b859926abd5bdc222a5249e99f8080f0f8`, with contract version `1.0.0`.
Status and evidence are recorded in the [plan](plans/public-sdk.plan.md#--step-02--the-server-owner-exports-the-public-contract-with-runtime-behavior-verified).

The snapshot consists of [REST OpenAPI](../contracts/rest.openapi.json),
[signal JSON Schema](../contracts/signals.schema.json),
[provenance](../contracts/source.json), [19 REST fixtures](../conformance/rest/cases.json),
and [40 signal fixtures](../conformance/signals/cases.json).
The provenance file ties the snapshot to the exact commit and SHA-256 hashes of 187
source inputs and four exported artifacts. Two normal exports matched byte for byte;
every source hash was checked against committed content. Preserve exported bytes when
updating the snapshot; instructions are in the [development guide](development.md#updating-the-contract-snapshot).
Temporary `--preview` export contains `commit: null` and
`status: working-tree-preview`; it is not an accepted SDK snapshot.
Snapshot version, package version, REST `/v1`, webhook `/v1`, and strategy version are independent.

## REST: address, key, and permissions

REST is served under `/api/rest/v1`. The relative OpenAPI `servers.url: /api/rest`
is resolved by the SDK to `https://www.vector-trading.app/api/rest` by default.
Signal clients default to `https://www.vector-trading.app`. Client construction
performs no network work. Override the base URL to select another deployment; a REST
override includes `/api/rest`, while a signal override supplies the origin or path prefix.
TypeScript uses optional `baseUrl`, Python optional `base_url`, Go `ClientOptions.BaseURL`
(empty uses production), and Rust `ClientOptions.base_url` (`None` uses production).
Explicit invalid URLs still fail local validation; HTTP remains restricted to explicitly
allowed loopback test receivers.
The account key is sent as `Authorization: Bearer vt_<id>_<secret>` and is intended for
server-side integration. It does not replace the webhook strategy key.

| `operationId`       | Method and path relative to `/api/rest`          | Key permission |
| ------------------- | ------------------------------------------------ | -------------- |
| `listBundles`       | `GET /v1/bundles`                                | `bundles:read` |
| `searchUsers`       | `GET /v1/users`                                  | `users:read`   |
| `getCheckout`       | `GET /v1/checkout/{checkoutId}`                  | `grants:read`  |
| `listBundleUsers`   | `GET /v1/bundles/{bundleId}/users`               | `grants:read`  |
| `listBundleGrants`  | `GET /v1/bundles/{bundleId}/grants`              | `grants:read`  |
| `createBundleGrant` | `POST /v1/bundles/{bundleId}/grants`             | `grants:write` |
| `revokeBundleGrant` | `DELETE /v1/bundles/{bundleId}/grants/{grantId}` | `grants:write` |

Key permissions are checked independently of domain permissions. Reading checkout,
users, or grants and revoking a grant require exact bundle ownership, even for roles
with expanded permissions. Creating `owner_grant` uses the existing
`hasPermission(..., "bundles", "update", { bundleDto })`: the owner or a role with that
expanded permission can create access. Creating `paid_external`, `referral_reward`,
or `gift` requires exact ownership and a sellable bundle. This is verified server
behavior; STEP-02 does not change permissions.

## REST: pagination and access changes

Lists return a `bundles`, `users`, or `grants` array, the effective `limit`, and an
optional `nextCursor`. Cursors are opaque: pass them unchanged, preserving filters
and sorting. Even an empty page may have a continuation. Traversal ends when
`nextCursor` is absent. The contract includes neither a total count nor `hasMore`.

Access creation accepts a strict object with `userId`, `grantType`, and optional
`endsAt` and `sourceId`. User and resource IDs are 32 lowercase hexadecimal characters.
`paid_external` requires `sourceId`; reusing it for the same bundle/user pair and grant
type returns `409`, rather than guaranteed idempotency. `endsAt` is an ISO 8601 date
string. Omission means permanent access; `null` is rejected. `days`, `startsAt`, and
`trial` are not accepted in the request. Revocation triggers server-side subscription
consequences; the SDK sends one HTTP request.

## REST: input validation

TypeScript REST request objects reject unknown own enumerable string keys before
HTTP delivery, including keys whose value is `undefined`. Known optional parameters
retain their omission rules. A misspelled filter therefore fails locally rather than
sending a less restrictive request; the generated grant body argument remains supported.

Schema string length limits count Unicode code points, not UTF-16 code units or
visual graphemes. The user search parameter therefore accepts 2–30 code points,
including supplementary characters, without SDK Unicode normalization.

REST date strings use the pinned server's strict spelling: a four-digit Gregorian
year, valid `YYYY-MM-DD`, uppercase `T`, `HH:mm:ss` with hours 00–23 and minutes/seconds
00–59, an optional dot followed by fractional digits, and uppercase `Z` or an offset
`±HH:mm` with hours 00–23 and minutes 00–59. Lowercase separators, leap seconds,
comma fractions, missing seconds, and calendar normalization are rejected locally.
Native date types retain their existing representable ranges and serialization;
Python `datetime`, for example, cannot represent year `0000`. Raw input strings are
forwarded unchanged after validation.

The [SDK input regressions](../conformance/rest/input-validation.json) supplement the
unaltered server-exported snapshot. Their expected outcomes were checked against the
actual body/query schemas at the accepted commit above, including all six grant date
filters. Every language consumes these examples. Go exposes those filters as
`time.Time`, so malformed raw filter strings are exercised through the same internal
request-validation path; public raw grant bodies and valid typed filters remain covered.

Required JSON bodies are checked after public model serialization. An empty Python
`CreateGrantRequest()` remains constructible but is rejected before HTTP delivery.
Python generated leaf and union validation exceptions hide submitted input values in
ordinary exception rendering. A local validation error does not prevent a subsequent
independent request on the same client.

## REST: errors and transport

Application errors normally contain `errorCode`, `message`, optional string-valued
`metadata`, and optional `requestId`. Rate-limit error `429` has a separate shape:
`{ "success": false, "error": "..." }`. A proxy or network failure may produce an empty
or non-JSON body; clients must not assume one schema covers every error. A string
`requestId` in the body has priority over the `x-request-id` response header. An absent
or non-string body value falls back to the header. An empty string is still a body
value and does not select the header. Selected identifiers undergo credential and URL
redaction; existing language-specific empty-string representations are retained.
Error messages redact submitted string, numeric, and boolean JSON values. Public codes
and request IDs are retained after credential and URL redaction; applications must not
log private inputs or raw transport data.

SDK transports enforce a numerical response-body limit of 1 MiB (1,048,576 bytes),
including error responses. TypeScript and Python count actual bytes after their
standard HTTP decoding, including supported decompression, without relying on
`Content-Length`. A body exactly at the limit is permitted; a larger body fails with
`protocol` before JSON parsing or diagnostic extraction. This is an SDK resource
policy, not a restriction in the pinned server response schema. Go and Rust retain
their existing decoding policies; Rust does not enable HTTP decompression features.

The limit bounds accumulated SDK body data, not total process memory or a chunk
already allocated by the HTTP library or an injected transport. Receiving a large
response, timing out, or cancelling stops that request's local processing without
closing the client or retrying delivery. A sent mutation or signal can still have an
unknown server outcome; subsequent independent calls remain available.

Invalid or revoked keys and CIDR mismatches return `401`; insufficient account, key,
or owner permissions return `403`. JSON bodies are limited to 16 KiB of UTF-8:
unsupported content types return `415`, oversized bodies return `413`, and invalid
JSON or schema violations return `400`. Secrets, `Authorization` headers, strategy
keys in URLs, and private bodies must stay out of logs, exceptions, and shared fixtures.

Production transport uses HTTPS; HTTP is allowed for an explicitly selected local
test server. Redirects across origins must not forward secrets. Mutations are not
automatically retried, including implicit HTTP-library retries. Client construction
and package imports do not send requests.

## Signals: recommended outgoing payload

External `StrategySignalPayload` is separate from the internal event: the server adds
`id` and `apiKey`. The eight actions are `open`, `update`, `cancel`, `close`, `start`,
`pause`, `stop`, and `delete`. Every outgoing payload contains a positive finite numeric
strategy `version` and a decimal millisecond string `timestamp` convertible to a safe
integer. Strategy version need not be an integer; SDK version is not substituted into
this field. Optional `hashtag` follows the server's canonical regular expression.

`open` and `update` require a positive finite `marketPrice` and an `order` object with
`side: buy | sell`. `price` selects a limit order; `triggerPrice` selects a trigger
order. Both select a trigger-limit order; neither selects a market order. `stop` and
`takeProfits` define protection. `amountPerc` is allowed only on `open`, must be positive,
and must not exceed 100. Optional boolean `force` is available only on `open`.
`cancel` and `close` may include `marketPrice`; management actions omit order parameters
and price.

JSON Schema validates shape, required fields, and simple numeric bounds. The real
parser additionally validates price relationships and total percentages:

- Base price is selected in order: `price`, `triggerPrice`, `marketPrice`.
- Without `triggerPrice`, a buy limit price must not exceed market price and a sell
  limit price must not be below it. A buy trigger price must not be below market
  price and a sell trigger price must not exceed it. When both prices are present,
  a buy limit price must not exceed its trigger price and a sell limit price must
  not be below it.
- SL and TP must be on the correct side of base price for `buy` or `sell`.
- `takeProfits` contains at most ten targets with positive finite prices and
  percentages; the total must not exceed 100 with a tolerance of `1e-8`.
- On `update`, omitted `takeProfits` preserves targets, `[]` clears them, and a
  non-empty array replaces them. `null` is rejected.

The server parser accepts a wider input set: it ignores unknown fields, substitutes
the current time for omitted or non-string `timestamp`, and retains `force` only on
`open`. `amountPerc` on `update` does not imply supported size adjustment. Shared
fixtures record schema and parser acceptance separately; the SDK builds the strict
recommended subset and preserves omission, `null`, and empty-array distinctions.

Pine consumers use the same subset. Their `na` target array omits `takeProfits`, an
empty array clears, and populated arrays replace; typed parameters cannot emit
JSON `null`. Pine string and float limitations, explicit empty metadata, and
actual native compilation/parser evidence are documented in the
[Pine guide](../pinescript/README.md). The library builds JSON without selecting
alert conditions, sending it, or changing the shared transport semantics.

## Webhook: delivery result

`POST /webhooks/signals/v1/{strategyApiKey}` accepts a strategy key and a body of up
to 16 KiB of UTF-8; query parameters are forbidden. The outer handler validates the
32-character lowercase hexadecimal key shape. Strategy existence, key revocation,
and strategy state are checked later in the server pipeline. Invalid paths return
`404`, the shared webhook key returns `410`, invalid bodies return `400`, oversized
bodies return `413`, and other HTTP methods return `405`. Queue failures may return
`500`; webhook error shapes differ from REST.

All four HTTP SDKs require the strategy key on each signal send. A signal client stores
transport settings, not a strategy credential; sequential and concurrent sends may use
different keys. The key is validated locally before serialization, appears only in the
webhook path, and is never inserted into the JSON payload or an `Authorization` header.
Account REST clients keep their separate account key. Pine builds JSON offline; TradingView
receives the strategy key through the separately configured webhook URL.

An empty `204` response means the signal was enqueued. It does not confirm a trade or
guarantee permanent idempotency. The SDK does not automatically resend signals after
errors or lost responses and does not start hidden state polling.
