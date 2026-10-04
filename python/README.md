# Vector Trading Python SDK

`vector-trading-sdk` provides typed synchronous clients for seven account-key REST
operations and eight strategy-key signals. Requires Python 3.12+; locally verified on
Python 3.12 and 3.14. This package has not been published to PyPI.

Build a local wheel with `uv build` in this directory, then install it in a consumer:

```sh
uv pip install /path/to/vector_trading_sdk-0.1.0-py3-none-any.whl
```

Import public clients, types, errors, and builders from `vector_trading`.
Internal `_generated` modules are implementation details. Runtime requirements are
`httpx>=0.28.1,<1` and `pydantic>=2.12.5,<3`; development pins in `uv.lock` do not constrain
consumer versions. `typing-extensions` may be resolved transitively by these libraries;
the SDK itself uses Python's built-in typing facilities and does not require `python-dateutil`.

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

```python
import os
from vector_trading import RestClient, SignalsClient, build_start_signal

with RestClient(account_api_key=os.environ["VECTOR_API_KEY"]) as rest:
    bundles = rest.list_bundles(limit=20)

payload = build_start_signal(version=1)
with SignalsClient() as signals:
    signals.send(payload, strategy_api_key=os.environ["VECTOR_BTCUSDT_API_KEY"])
    signals.send(payload, strategy_api_key=os.environ["VECTOR_SOLUSDT_API_KEY"])
```

This queries bundles and starts two strategies through one signal client.
Sending affects the selected strategies; use an explicitly authorized environment.
The examples below also cover order opening, TP/SL updates, and target preservation or clearing.

## Account-key REST

Account keys are for server-side integrations and differ from strategy keys.
The default REST base is `https://www.vector-trading.app/api/rest`; signal clients
default to `https://www.vector-trading.app`. Override `base_url` for another deployment;
the REST override includes `/api/rest`.
Imports and constructors perform no HTTP work.

```python
import os
from vector_trading import RestClient, SdkError

account_key = os.environ["VECTOR_API_KEY"]
with RestClient(account_api_key=account_key) as client:
    try:
        for page in client.list_bundles_pages(limit=50):
            names = [bundle.name for bundle in page.bundles]
    except SdkError as error:
        if error.status == 429:
            # The caller decides whether and when another attempt is appropriate.
            pass
        else:
            raise
```

| Public method         | Parameters                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_bundles`        | optional keyword `limit`, `cursor`                                                                                                                                                                       |
| `search_users`        | required keyword `display_name`; optional `limit`, `cursor`                                                                                                                                              |
| `get_checkout`        | positional `checkout_id`                                                                                                                                                                                 |
| `list_bundle_users`   | positional `bundle_id`; optional `limit`, `cursor`                                                                                                                                                       |
| `list_bundle_grants`  | positional `bundle_id`; optional `user_id`, `grant_type`, `source_id`, `starts_after`, `starts_before`, `ends_after`, `ends_before`, `created_after`, `created_before`, `sort`, `dir`, `limit`, `cursor` |
| `create_bundle_grant` | positional `bundle_id`, request dictionary or `CreateGrantRequest`                                                                                                                                       |
| `revoke_bundle_grant` | positional `bundle_id`, `grant_id`                                                                                                                                                                       |

All methods accept optional keyword `cancel_event: threading.Event`. Responses are
Pydantic models with Python field names (`next_cursor`, `user_id`, and so on). Their
`to_dict()` / `to_json()` codecs use wire names. REST dates are timezone-aware `datetime`
values and serialize as ISO 8601, possibly normalized to an equivalent representation.
For raw request dictionaries and date filters, use ISO 8601 strings.

```python
from vector_trading import CreateGrantRequest

request = CreateGrantRequest.from_dict(
    {
        "userId": user_id,
        "grantType": "paid_external",
        "sourceId": "invoice:123",
        "endsAt": "2026-12-01T00:00:00.000Z",
    }
)
with RestClient(base_url=rest_base_url, account_api_key=account_key) as client:
    result = client.create_bundle_grant(bundle_id, request)
```

`paid_external` requires `sourceId`; a repeated grant may return `409`. Revocation has
the server's documented access consequences. No SDK method promises idempotency.

`list_bundles_pages`, `search_users_pages`, `list_bundle_users_pages`, and
`list_bundle_grants_pages` lazily yield entire pages, preserving filters. An empty
array with `nextCursor` continues traversal; repeated cursors raise `SdkError`.
Stopping iteration stops additional requests; the client context closes its resources.

## Offline signals and strategy-key delivery

Prices are illustrative; supply the current market price when preparing each message.
The following example opens orders and prepares a later TP/SL update.

```python
import os
from vector_trading import (
    OpenSignalPayloadOrder,
    OpenSignalPayloadOrderTakeProfitsInner,
    SignalsClient,
    UpdateSignalPayloadOrder,
    build_open_signal,
    build_update_signal,
)

opening_order = OpenSignalPayloadOrder(side="buy", stop=90)
opening_order.take_profits = [OpenSignalPayloadOrderTakeProfitsInner(price=110, percent=100)]
opening = build_open_signal(version=1, market_price=100, order=opening_order)

updated_order = UpdateSignalPayloadOrder(side="buy", stop=95)
updated_order.take_profits = [OpenSignalPayloadOrderTakeProfitsInner(price=115, percent=100)]
updated_protection = build_update_signal(version=1, market_price=100, order=updated_order)
with SignalsClient() as client:
    client.send(opening, strategy_api_key=os.environ["VECTOR_BTCUSDT_API_KEY"])
    client.send(opening, strategy_api_key=os.environ["VECTOR_SOLUSDT_API_KEY"])
    # Send this separately when your application decides to adjust protection.
    client.send(updated_protection, strategy_api_key=os.environ["VECTOR_BTCUSDT_API_KEY"])

# Offline alternatives: preserve TP while moving SL, or explicitly clear TP.
preserve_targets = build_update_signal(
    version=1, market_price=100, order=UpdateSignalPayloadOrder(side="buy", stop=95)
)
cleared_order = UpdateSignalPayloadOrder(side="buy")
cleared_order.take_profits = []
clear_targets = build_update_signal(version=1, market_price=100, order=cleared_order)
```

`SignalsClient` retains transport configuration, not a strategy credential. Every
`send` requires the keyword `strategy_api_key`, so the same client can deliver to
different strategies, including concurrent calls. Keys remain in the webhook URL;
the JSON body contains only the prepared signal. The former constructor key option
is no longer accepted. Account credentials remain on `RestClient`.

The eight builders are `build_open_signal`, `build_update_signal`, `build_cancel_signal`,
`build_close_signal`, `build_start_signal`, `build_pause_signal`, `build_stop_signal`,
and `build_delete_signal`. Each requires keyword `version`, the strategy version.
Open/update require `market_price` and `order`; an order can be a generated model or a
wire dictionary. Open alone accepts `force`. Cancel/close may include `market_price`.
Every builder accepts optional `timestamp` and `hashtag`; absent timestamps are fixed
as decimal millisecond strings during construction. `build_signal` takes a complete
wire dictionary, supplying only an absent timestamp. `serialize_signal` validates and
serializes a prepared model or dictionary without supplying metadata.

Builders work offline and clone input messages. Sending the same prepared message
preserves its timestamp; distinct builds within one millisecond need not be unique.
The SDK rejects non-finite numbers, unsafe timestamps, invalid TP/SL relationships,
unknown input fields, and bodies larger than 16 KiB of UTF-8. Strategy version is
independent of SDK version. Internal event IDs and keys are not signal fields.

Omitted `takeProfits` preserves current targets; `[]` clears them; a non-empty list
replaces them. `None` is rejected for non-nullable signal fields. Generated models
track unset fields so omission does not become JSON `null`; nullable response fields
such as `avatar` retain explicit `None`.

`send` returns `None` for webhook `204`: the signal was enqueued, not necessarily
executed. Automatic retries, polling, and background requests are absent. A timeout
or lost response leaves the operation's outcome unknown; the SDK does not resend it.

## Transport, lifecycle, and errors

Both clients support `close()` and `with`; closing twice is safe, and a closed client
raises `SdkError` before another request. The default `timeout` is 10 seconds. HTTPX
bounds connection, pool, write, and read phases; the SDK also checks elapsed time while
reading a streaming body. Synchronous cancellation is cooperative: `cancel_event` is
checked before requests, between body chunks, and between pages. A blocked I/O phase
returns at its configured timeout; no extra worker or asynchronous API is created.

Production requests require HTTPS. Explicit `allow_local_http=True` allows only
loopback HTTP for local testing. Redirects are never followed and credentials are
never forwarded. Environment proxy settings are disabled. Optional `transport` accepts
an HTTPX `BaseTransport`; supplied transports must honor HTTPX timeout semantics and
must not introduce retries.

Responses, including errors, have a 1 MiB body limit checked while streaming.
Exceeding it raises `protocol`, closes the response, and leaves the client available
for independent calls. See the [shared transport rules](../docs/contracts.md#rest-errors-and-transport)
for byte counting, request ID precedence, and the memory and delivery guarantees.

`SdkError` exposes `kind`, optional `status`, `code`, and `request_id`, plus a bounded
safe message. Kinds include `validation`, `http`, `transport`, `timeout`, `cancelled`,
`protocol`, `pagination`, and `closed`. HTTP errors handle JSON, non-JSON, empty bodies,
and rate limits. Private body values, credentials, URLs, and raw transport errors stay
out of diagnostics. Pydantic model error messages also hide input values.
HTTPX URL log representations redact private paths and queries;
actual request components remain intact.

## Development

From this directory with pinned `uv` 0.12.1 and Python 3.12.9 available:

```sh
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
uv build
uv run python scripts/check_package.py
```

The repository [development guide](../docs/development.md) describes the Python 3.14
matrix and root commands. Tests use isolated localhost servers and synthetic keys.
The package check installs wheel and sdist separately into clean environments,
exercises every public method, checks the dependency graph, and verifies public types
and examples. The sdist carries derived models and builds without a server or SDK checkout.
