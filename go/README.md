# Vector Trading SDK for Go

The Go module provides seven account-key REST operations, paginated traversal, and
construction/delivery of all eight strategy-key signals. It uses only the Go standard
library. The SDK is version `0.1.0`; Go `1.26.0` and `1.27.1` are verified.

The package is prepared locally and has not been published. The intended public import is:

```go
import vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
```

Release `v0.1.0` also requires the subdirectory tag `go/v0.1.0` at the same commit.
A future major version 2 changes the module/import path to
`github.com/Vector-Trading/vector-trading-sdk/go/v2` and uses `go/v2.x.y` tags.
Actual GitHub/public proxy installation is verified at the release step.

## Quick start

| Environment variable     | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `VECTOR_API_KEY`         | Account API key for REST calls.             |
| `VECTOR_BTCUSDT_API_KEY` | Strategy API key for your BTCUSDT strategy. |
| `VECTOR_SOLUSDT_API_KEY` | Strategy API key for your SOLUSDT strategy. |

To obtain a signal API key, copy the webhook URL for the intended strategy in
Vector Trading and take **only its final path segment** — the part after
`/webhooks/signals/v1/`. For example, from
`https://www.vector-trading.app/webhooks/signals/v1/<strategy-api-key>`, use only
`<strategy-api-key>` as `VECTOR_BTCUSDT_API_KEY` or `VECTOR_SOLUSDT_API_KEY`.
It must be 32 lowercase hexadecimal characters. Pass the key, not the full URL,
to the SDK's send method. Obtain each strategy's key from its own webhook URL;
`VECTOR_API_KEY` is the separate account REST credential.

Your application reads these variables; the SDK does not load `.env` files.
The names identify your strategies in application configuration. The strategy's
server configuration determines the traded instrument; the signal contains no symbol.

```go
package integration

import (
	"context"
	"os"

	vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
)

func run(ctx context.Context) error {
	accountKey := os.Getenv("VECTOR_API_KEY")
	btcusdtKey := os.Getenv("VECTOR_BTCUSDT_API_KEY")
	solusdtKey := os.Getenv("VECTOR_SOLUSDT_API_KEY")
	rest, err := vectortrading.NewRestClient(accountKey, vectortrading.ClientOptions{})
	if err != nil {
		return err
	}
	defer rest.Close()
	if _, err := rest.ListBundles(ctx, vectortrading.PageOptions{Limit: vectortrading.Ptr(int32(20))}); err != nil {
		return err
	}

	signals, err := vectortrading.NewSignalsClient(vectortrading.ClientOptions{})
	if err != nil {
		return err
	}
	defer signals.Close()
	payload, err := vectortrading.BuildStartSignal(1, vectortrading.SignalOptions{})
	if err != nil {
		return err
	}
	if err := signals.Send(ctx, btcusdtKey, payload); err != nil {
		return err
	}
	return signals.Send(ctx, solusdtKey, payload)
}
```

This queries bundles and starts two strategies through one signal client.
Sending affects the selected strategies; use an explicitly authorized environment.
The examples below also cover order opening, TP/SL updates, and target preservation or clearing.

## REST integration

Account keys belong to server integrations. The REST base defaults to
`https://www.vector-trading.app/api/rest`; signal clients default to
`https://www.vector-trading.app`. Set `ClientOptions.BaseURL` for another deployment;
an empty value uses production and a REST override includes `/api/rest`. Supply an
account key from your application's secret configuration:

```go
client, err := vectortrading.NewRestClient(accountKey, vectortrading.ClientOptions{
    HTTPClient: &http.Client{},
    Timeout: 10 * time.Second,
})
if err != nil {
    return err
}
defer client.Close()

for page, err := range client.BundlesPages(ctx, vectortrading.PageOptions{
    Limit: vectortrading.Ptr(int32(25)),
}) {
    if err != nil {
        return err
    }
    consume(page.Bundles)
}
```

Every HTTP method takes `context.Context`. A nil context fails validation; a caller's
cancellation/deadline applies through response-body receipt. Construction performs no
requests. Clients support concurrent requests; callers must not mutate inputs or custom
transports concurrently. `Close` prevents new requests and releases idle connections;
cancel active work through its context.

| Method              | Arguments after context     | Response                 |
| ------------------- | --------------------------- | ------------------------ |
| `ListBundles`       | `PageOptions`               | `*BundlesResponse`       |
| `SearchUsers`       | display name, `PageOptions` | `*UsersSearchResponse`   |
| `GetCheckout`       | checkout ID                 | `*CheckoutDetails`       |
| `ListBundleUsers`   | bundle ID, `PageOptions`    | `*BundleUsersResponse`   |
| `ListBundleGrants`  | bundle ID, `GrantsOptions`  | `*BundleGrantsResponse`  |
| `CreateBundleGrant` | bundle ID, grant request    | `*GrantMutationResponse` |
| `RevokeBundleGrant` | bundle ID, grant ID         | `*GrantMutationResponse` |

Grant requests accept public `PaidExternalGrantRequest` / `OtherGrantRequest` models,
a `CreateGrantRequest` union, or a JSON-shaped object. `paid_external` requires `SourceId`;
`EndsAt: nil` omits the end date, while JSON `endsAt: null` is rejected. `time.Time`
serializes as RFC 3339 preserving the instant; dates are not Go's default display strings.
Revocation retains the server's cascading effects.

`BundlesPages`, `UsersPages`, `BundleUsersPages`, and `BundleGrantsPages` yield page/error
pairs through Go iterators. Empty pages with `nextCursor` continue. All filters and the
caller context are preserved; repeated cursors fail explicitly. `PageOptions` has
`Limit` and opaque `Cursor`; a non-nil pointer to an empty cursor is sent as `cursor=`.
Only an absent `nextCursor` ends traversal. `GrantsOptions` additionally has `UserID`, `GrantType`,
`SourceID`, `StartsAfter`, `StartsBefore`, `EndsAfter`, `EndsBefore`, `CreatedAfter`,
`CreatedBefore`, `Sort`, and `Dir`. Optional inputs are pointers; `Ptr` is a convenience.

## Offline signals and delivery

Strategy keys are separate from account keys. Builders perform no network operations:

Prices are illustrative; send the TP/SL update only when your application intends it.

```go
package integration

import (
	"context"
	"os"

	vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
)

func openAndUpdate(ctx context.Context) error {
	signals, err := vectortrading.NewSignalsClient(vectortrading.ClientOptions{})
	if err != nil {
		return err
	}
	defer signals.Close()
	btcusdtKey := os.Getenv("VECTOR_BTCUSDT_API_KEY")
	solusdtKey := os.Getenv("VECTOR_SOLUSDT_API_KEY")
	opening, err := vectortrading.BuildOpenSignal(1, 100,
		vectortrading.OpenSignalPayloadOrder{
			Side: "buy", Stop: vectortrading.Ptr(90.0),
			TakeProfits: []vectortrading.OpenSignalPayloadOrderTakeProfitsInner{{Price: 110, Percent: 100}},
		}, vectortrading.OpenSignalOptions{})
	if err != nil {
		return err
	}
	if err := signals.Send(ctx, btcusdtKey, opening); err != nil {
		return err
	}
	if err := signals.Send(ctx, solusdtKey, opening); err != nil {
		return err
	}
	// Prepare a later TP/SL update with the current market price.
	updated, err := vectortrading.BuildUpdateSignal(1, 100,
		vectortrading.UpdateSignalPayloadOrder{
			Side: "buy", Stop: vectortrading.Ptr(95.0),
			TakeProfits: []vectortrading.OpenSignalPayloadOrderTakeProfitsInner{{Price: 115, Percent: 100}},
		}, vectortrading.SignalOptions{})
	if err != nil {
		return err
	}
	return signals.Send(ctx, btcusdtKey, updated)
}

// Offline alternatives preserve or explicitly clear TP; they do not send requests.
func preserveTargets() (*vectortrading.UpdateSignalPayload, error) {
	return vectortrading.BuildUpdateSignal(1, 100,
		vectortrading.UpdateSignalPayloadOrder{Side: "buy", Stop: vectortrading.Ptr(95.0)},
		vectortrading.SignalOptions{})
}

func clearTargets() (*vectortrading.UpdateSignalPayload, error) {
	return vectortrading.BuildUpdateSignal(1, 100,
		vectortrading.UpdateSignalPayloadOrder{
			Side: "buy", TakeProfits: []vectortrading.OpenSignalPayloadOrderTakeProfitsInner{},
		}, vectortrading.SignalOptions{})
}
```

A nil TP slice omits `takeProfits`; a non-nil empty slice emits `[]` to clear targets;
a populated slice replaces them. Generated codecs preserve this distinction even though
an ordinary slice with `omitempty` would lose the empty array. Raw JSON null is rejected.

`NewSignalsClient` takes transport options, including the optional `BaseURL`.
`Send(ctx, strategyKey, payload)` requires a 32-character lowercase hexadecimal key
for each call, before payload serialization or HTTP. One client supports concurrent
calls with different keys; no strategy key is stored in the client. The key belongs
to the webhook URL path and never to the JSON body or an `Authorization` header.
The REST account key stays in `NewRestClient`. Pine Script builds JSON offline;
TradingView configures the webhook URL with its strategy key separately.

`BuildOpenSignal` and `BuildUpdateSignal` take strategy version, market price, their
respective order model, and options. `BuildCancelSignal` and `BuildCloseSignal` take
version and `ExitSignalOptions` with optional market price. `BuildStartSignal`,
`BuildPauseSignal`, `BuildStopSignal`, and `BuildDeleteSignal` take version and
`SignalOptions`. `OpenSignalOptions` alone exposes `Force` and embeds `SignalOptions`.
Zero strategy versions are rejected; the SDK version is never substituted.

`SignalOptions` permits explicit pointer-valued `Timestamp` and `Hashtag`. Builders
fix a decimal millisecond timestamp when absent; `SerializeSignal` and `Send` validate
prepared metadata without refreshing it. `BuildSignal` supports JSON-shaped input and
clones it into the generated union. Four order variants are inferred from `Price` and
`TriggerPrice`. Validation checks finite values, timestamp safe-integer range, strict
fields, protection/entry-price relationships, TP totals, and the UTF-8 16 KiB body limit.

Successful `Send` means HTTP `204` enqueue acceptance. It does not confirm trade
execution or permanent deduplication. Do not log private models or HTTP requests.

## Transport and errors

The default total timeout is ten seconds. HTTPS is required; HTTP works only for a
loopback host with explicit `AllowHTTPForLocalhost: true`. Redirects are disabled for
all origins, so credentials are not forwarded. No automatic retries or background
polling are added. Native `http.Transport` instances are cloned with fresh HTTP/1 connections
to prevent transparent stale-connection and HTTP/2 stream retries; the supplied client is not mutated.
Custom `RoundTripper` implementations are caller-controlled and must not retry or log
private URLs, headers, or bodies. Responses are closed and bounded to 1 MiB.

Use `errors.As(err, &sdkError)` with `var sdkError *vectortrading.Error`. Fields are
`Kind`, `Message`, `Status`, `Code`, and `RequestID`. Kinds include `validation`, `http`,
`transport`, `timeout`, `cancelled`, `protocol`, `pagination`, and `closed`. Diagnostics
are bounded and redact credentials, private URLs, and supplied body/query values;
raw requests, responses, and underlying causes are not retained. A timeout or lost
response can leave a mutation's outcome unknown; the client makes one attempt.
`RequestID` uses a string `requestId` from the response body, otherwise the
`x-request-id` header, with the same credential and URL redaction for either source.

Response models retain unknown optional fields. Nullable `PublicUser.Avatar` exposes
`IsSet` and `Get` to distinguish omission from explicit null. For common semantics,
see [the contract guide](../docs/contracts.md).

## Verification and examples

[REST](examples/rest/rest.go) and [signal](examples/signals/signals.go) examples export
callable functions without import-time requests. Native commands and tool preparation
are documented in [the development guide](../docs/development.md#go-package-checks).
`toolchains.json` pins development tools; Staticcheck is installed outside this module.
The module has no `require` entries and no `go.sum`.

Tests exercise the shared fixtures and actual localhost HTTP. Clean consumers download
a reproducible module ZIP through a temporary local file proxy, then compile/run offline
on both pinned Go versions. This check uses the real import path and no working-tree
`replace`; it is not public publication. The archive includes public sources, generated
code/metadata, examples, README, and MIT license, excluding tests, tools, and build output.
