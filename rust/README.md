# Vector Trading SDK for Rust

`vector-trading-sdk` is the asynchronous Rust library for seven account-key REST
operations and eight strategy-key signal actions. Import it as `vector_trading_sdk`.
The locally verified package is `0.1.0`; registry publication remains a release step.

```toml
[dependencies]
vector-trading-sdk = "0.1.0"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "time"] }
```

Rust `1.88` is the minimum supported compiler. Development uses pinned Rust
`1.99.0` and independently checks `1.88.0`. Requests require a Tokio execution
context; offline builders and serialization do not. The SDK's development lockfile
is reproducible, while applications resolve compatible dependencies in their own
`Cargo.lock`. The library uses Rust 2021.

## REST requests

Use the deployment's absolute REST base ending in `/api/rest`. Account keys are
intended for server-side integrations. Construction performs no network work.

```rust,no_run
use vector_trading_sdk::{ClientOptions, PageOptions, RestClient};
# async fn example() -> vector_trading_sdk::Result<()> {
let client = RestClient::new(
    "https://your-deployment.example/api/rest",
    "ACCOUNT_KEY_FROM_PRIVATE_CONFIGURATION",
    ClientOptions::default(),
)?;
let first = client.list_bundles(PageOptions { limit: Some(20), ..Default::default() }).await?;
let mut pages = client.users_pages("Example", PageOptions::default())?;
while let Some(page) = pages.next().await? {
    // Consume public user data without logging credentials or request bodies.
    let _users = page.users;
}
client.close();
# Ok(())
# }
```

All methods return `Result<T, Error>`:

| Method                                       | Result model                    |
| -------------------------------------------- | ------------------------------- |
| `list_bundles(PageOptions)`                  | `models::BundlesResponse`       |
| `search_users(&str, PageOptions)`            | `models::UsersSearchResponse`   |
| `get_checkout(&str)`                         | `models::CheckoutDetails`       |
| `list_bundle_users(&str, PageOptions)`       | `models::BundleUsersResponse`   |
| `list_bundle_grants(&str, GrantOptions)`     | `models::BundleGrantsResponse`  |
| `create_bundle_grant(&str, &impl Serialize)` | `models::GrantMutationResponse` |
| `revoke_bundle_grant(&str, &str)`            | `models::GrantMutationResponse` |

`GrantOptions` exposes user/grant/source filters, six ISO 8601 date bounds, sorting,
direction, and flattened pagination options. Dates stay strings on the wire and are
validated as RFC 3339 instants. `models::PaidExternalGrantRequest` requires `source_id`;
`models::OtherGrantRequest` covers `owner_grant`, `referral_reward`, and `gift`.
Both generated concrete models and `models::CreateGrantRequest` are accepted;
validation enforces exactly one matching variant before sending. Revocation follows
server cascading semantics. An optional nullable response avatar uses
`Option<Option<String>>`: `None` omits it and `Some(None)` preserves explicit null.

`bundles_pages`, `users_pages`, `bundle_users_pages`, and `bundle_grants_pages` return
lazy `Pages<T>`. Call `next().await` until `None`. Empty arrays do not end traversal
when an opaque `nextCursor` exists. Filters stay unchanged; repeated cursors return
`ErrorKind::Pagination`. Dropping a pending page future cancels that request without
advancing the local continuation state. No background pagination runs.

## Prepared signals

The strategy version is required and independent of SDK, REST, and webhook versions.
`SignalOptions::timestamp = None` fixes the current decimal-string millisecond once;
`Some("")` is invalid. Reusing a prepared message preserves its timestamp. Signals
created within one millisecond are not guaranteed unique.

```rust
use vector_trading_sdk::{build_update_signal, serialize_signal, models, SignalOptions};
let mut order = models::UpdateSignalPayloadOrder::new(
    models::update_signal_payload_order::Side::Buy,
);
// None omits takeProfits; Some(vec![]) explicitly clears existing targets.
order.take_profits = Some(vec![]);
let prepared = build_update_signal(2.0, 100.0, order, SignalOptions::default())?;
let bytes = serialize_signal(&prepared)?;
assert!(String::from_utf8(bytes)?.contains("\"takeProfits\":[]"));
# Ok::<(), Box<dyn std::error::Error>>(())
```

`build_open_signal` accepts `OpenSignalOptions` (including the open-only `force`).
`build_update_signal` uses `SignalOptions`; `build_cancel_signal` and
`build_close_signal` use `ExitSignalOptions` for an optional market price.
`build_start_signal`, `build_pause_signal`, `build_stop_signal`, and
`build_delete_signal` use `SignalOptions`. Builders return concrete generated models.
`build_signal(Value)` consumes an object, fills only an absent timestamp, and returns
`models::SignalPayload`. `serialize_signal` validates a prepared object without
changing it. Explicit null, invalid order types, invalid TP/SL relationships, non-finite
numbers, unsafe timestamps, unknown outgoing fields, and bodies over 16 KiB in UTF-8
are rejected before a request. Generated field serializers also reject non-finite floats.

```rust,no_run
use vector_trading_sdk::{build_start_signal, ClientOptions, SignalOptions, SignalsClient};
# async fn example() -> vector_trading_sdk::Result<()> {
let client = SignalsClient::new(
    "https://your-deployment.example",
    "00000000000000000000000000000000", // Replace from private configuration.
    ClientOptions::default(),
)?;
let prepared = build_start_signal(1.0, SignalOptions::default())?;
client.send(&prepared).await?;
client.close();
# Ok(())
# }
```

A webhook `204` confirms enqueue acceptance, not an executed trade. Neither failures
nor timeouts cause automatic retries. There is no permanent deduplication guarantee.

## Deadlines, cancellation, and errors

Each client owns a managed `reqwest::Client`. HTTPS and certificate verification are
on; `root_certificate` optionally adds a trusted private CA. Redirects, proxy discovery,
HTTP/2, idle connection reuse, and reqwest retry policy are disabled. Defaults bound
an entire request (including streamed bodies) to ten seconds; set a nonzero
`ClientOptions::timeout` to change this. HTTP is allowed only for an explicit loopback
receiver with `allow_http_for_localhost = true`.

Dropping a future, `tokio::select!`, or `tokio::time::timeout` cancels local waiting.
After cancelling a mutation, its remote outcome may remain unknown. `close()` prevents
new calls across clones. Drop pending request futures and all client clones to release
resources. Responses are dropped after success, errors, size rejection, or cancellation;
response bodies are capped at 1 MiB. There are no import/construction requests, retry
loops, hidden polling, or SDK background workers.

`Error` provides `kind`, `message`, `status`, `code`, and `request_id`. Diagnostic text
is bounded/redacted; errors retain no raw HTTP causes or request bodies. Client `Debug`
output excludes credentials and URLs. Public error codes and request IDs are preserved
when safe. The SDK does not log requests; application middleware must also avoid
private headers, URL paths, and bodies.

## Development and packaging

From the repository root, `pnpm test:rust`, `pnpm build:rust`, and
`pnpm test:rust:package` delegate to native Cargo checks on both compilers. Prepare
Cargo dependencies first with `cargo fetch --locked`; builds, tests, and archive consumers then run offline. Cargo's publication dry run
reads registry metadata and needs network access, but does not upload a package.
`SDK_CARGO` can select an isolated Rustup Cargo executable. Standard `CARGO_HOME`,
`RUSTUP_HOME`, and `CARGO_TARGET_DIR` settings are respected.

Native checks: `cargo fmt --check`,
`cargo clippy --locked --all-targets --all-features -- -D warnings`,
`cargo test --locked --all-features` (including examples/doctests), and `cargo build --locked`.
The package check runs `cargo package --locked --allow-dirty` and
`cargo publish --dry-run --locked --allow-dirty` on both compilers; `--allow-dirty`
permits local review before commit. It never publishes. Repeated packaging must match byte for byte on each pinned Cargo version. Both
compilers must package identical file payloads; Cargo 1.99 and 1.88 use different
tar timestamps for normalized manifest/lock/VCS metadata. Each is extracted into a temporary source archive, installed by a clean
consumer without importing working-tree sources, and exercises all seven REST
operations/eight signals against localhost. The consumer's own lock and runtime graph
are checked. The final artifact is `dist/vector-trading-sdk-0.1.0.crate`.

Runtime dependencies are `reqwest` (only `rustls` and `query`), `serde`, `serde_json`,
`serde_with` (only `std`, for nullable optional fields), and `time` (only `std`/`parsing`,
for RFC 3339 validation compatible with Rust 1.88). Tokio is direct only for development
examples/tests; applications supply their execution context. Test-only `rcgen` and
`rustls` create an ephemeral trusted HTTPS receiver; no private key is stored.

The crate contains MIT, README, examples, public wrappers, canonical generated models,
and metadata. Tests, fixtures, tools, generated trial transport, and server packages
are excluded. `generated/` has one authoritative source tree managed by the shared
pipeline; never edit it manually. Narrow style lint exceptions apply only to the
upstream generated models. Validation consumes generated metadata; five simple
snapshot patterns are checked with standard character operations and unknown patterns
fail closed. Contract changes must update all consumers atomically.

See [shared contract semantics](../docs/contracts.md),
[development commands](../docs/development.md), and
[the explicit integration example](examples/integration.rs). The integration example
performs mutations: run it only against an explicitly authorized safe environment.
