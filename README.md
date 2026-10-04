```
 __      __        _              _______            _ _
 \ \    / /       | |            |__   __|          | (_)
  \ \  / /__  ____| |_ ___  _ __    | |_ __ __ _  __| |_ _ __   __ _
   \ \/ / _ \/ ___| __/ _ \| '__|   | | '__/ _` |/ _` | | '_ \ / _` |
    \  /  __/ (__ | || (_) | |      | | | | (_| | (_| | | | | | (_| |
     \/ \___|\___/\___\___/|_|      |_|_|  \__,_|\__,_|_|_| |_|\__, |
                                                               __/  |
                                                              |____/
```

# Vector Trading SDK

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](typescript/README.md)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](python/README.md)
[![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)](go/README.md)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](rust/README.md)
[![Pine Script](https://img.shields.io/badge/Pine_Script-131722?style=for-the-badge&logo=tradingview&logoColor=white)](pinescript/README.md)

Public clients for the [Vector Trading platform](https://www.vector-trading.app),
with account REST APIs, offline signal builders, and explicit webhook delivery.
Use JavaScript/TypeScript, Python, Go, or Rust for integrations, and Pine Script to
build signal JSON for TradingView alerts.

## 🚀 Features

- **Account REST API:** seven operations for bundles, users, checkout details, and access grants.
- **Strategy signals:** eight actions — open, update, cancel, close, start, pause, stop, and delete.
- **Reusable clients:** account keys stay on REST clients; strategy keys are supplied for each send.
- **Pagination:** lazy page traversal preserves filters and opaque cursors.
- **Predictable transport:** configurable HTTP settings, timeouts, cancellation, bounded responses, and safe diagnostics; no automatic retries.
- **Shared contracts:** pinned server specifications, reproducible generation, and cross-language regression fixtures.

The SDK sends HTTP requests and builds JSON. Trading rules, permissions, and execution
belong to the server. See the [shared contract guide](docs/contracts.md) for exact behavior.

> [!NOTE]
> Packages are locally verified; registry releases and TradingView library publication
> remain planned. Use the language guides below for local installation and examples.

## 📦 Choose your language

| Language                | Public entry point                                | Verified environments                     | Installation and full API                 |
| ----------------------- | ------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| JavaScript / TypeScript | `@vector-trading/sdk`                             | Node.js 22 / 24; ESM and CommonJS         | [TypeScript guide](typescript/README.md)  |
| Python                  | `vector_trading`                                  | Python 3.12 / 3.14; wheel and sdist       | [Python guide](python/README.md)          |
| Go                      | `github.com/Vector-Trading/vector-trading-sdk/go` | Go 1.26 / 1.27                            | [Go guide](go/README.md)                  |
| Rust                    | `vector_trading_sdk`                              | Rust 1.88 / 1.99; Tokio execution context | [Rust guide](rust/README.md)              |
| Pine Script             | Embedded signal builders                          | Pine v6; editor/parser evidence           | [Pine Script guide](pinescript/README.md) |

## ⚡ Usage examples

REST clients default to `https://www.vector-trading.app/api/rest`; signal clients
use `https://www.vector-trading.app`. Each language supports a base URL override.
The examples use credentials from private configuration and show a
bundle query followed by a signal send. `version` is the **strategy version**.

> [!IMPORTANT]
> Account API keys are intended for server-side integrations. Strategy keys are
> separate credentials: pass one with every signal request, or configure it in
> TradingView's webhook URL. A webhook `204` confirms enqueue acceptance, not trade
> execution. Sending a signal can affect a strategy; use an explicitly authorized
> environment. See [delivery semantics](docs/contracts.md#webhook-delivery-result).

### Credentials

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

### JavaScript / TypeScript

```ts
import { RestClient, SignalsClient, buildStartSignal } from '@vector-trading/sdk';

const rest = new RestClient({ accountApiKey: process.env.VECTOR_API_KEY! });
const bundles = await rest.listBundles({ limit: 20 });

const signals = new SignalsClient();
const payload = buildStartSignal({ version: 1 });
await signals.send({ strategyApiKey: process.env.VECTOR_BTCUSDT_API_KEY!, payload });
await signals.send({ strategyApiKey: process.env.VECTOR_SOLUSDT_API_KEY!, payload });
```

One signal client can serve multiple strategies. The example uses an ESM environment
with top-level `await`; JavaScript uses the same API without TypeScript annotations.
See the [TypeScript guide](typescript/README.md) for installation, public types,
CommonJS, pagination, custom `fetch`, and cancellation.

### Python

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

Clients are synchronous; context managers close their resources.
See the [Python guide](python/README.md) for installation, typed models, pagination,
HTTPX configuration, and cooperative cancellation.

### Go

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

The application reads credentials from environment variables. Every request takes
`context.Context`; the module uses only the Go standard library.
See the [Go guide](go/README.md) for local installation, public models, page iterators,
and HTTP client options.

### Rust

```rust
use vector_trading_sdk::{
    build_start_signal, ClientOptions, PageOptions, RestClient, SignalOptions, SignalsClient,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let account_key = std::env::var("VECTOR_API_KEY")?;
    let strategy_key = std::env::var("VECTOR_BTCUSDT_API_KEY")?;
    let other_key = std::env::var("VECTOR_SOLUSDT_API_KEY")?;

    let rest = RestClient::new(&account_key, ClientOptions::default())?;
    let _bundles = rest
        .list_bundles(PageOptions {
            limit: Some(20),
            ..Default::default()
        })
        .await?;

    let signals = SignalsClient::new(ClientOptions::default())?;
    let payload = build_start_signal(1.0, SignalOptions::default())?;
    signals.send(&strategy_key, &payload).await?;
    signals.send(&other_key, &payload).await?;
    signals.close();
    rest.close();
    Ok(())
}
```

Requests run asynchronously in a Tokio execution context.
See the [Rust guide](rust/README.md) for dependencies, typed models, pagination,
transport options, and cancellation by dropping request futures.

### Pine Script

Copy the [standalone example](pinescript/examples/confirmed-cross.pine) into a new
personal script in Pine Editor. It embeds the builders, so no published import is
required. Within that script, signal JSON can be prepared offline:

```pine
// In the embedded script; no published import is required.
array<TakeProfit> openingTargets = array.from(TakeProfit.new(close * 1.02, 100))
string opening = openSignal(1, close, "buy", stopPrice = close * 0.98, takeProfits = openingTargets)

// A later update replaces TP and moves SL; it does not open another order.
array<TakeProfit> updatedTargets = array.from(TakeProfit.new(close * 1.03, 100))
string update = updateSignal(1, close, "buy", stopPrice = close * 0.99, takeProfits = updatedTargets)
```

These calls prepare JSON; your alert conditions decide when to send each message.
Omitting `takeProfits` preserves targets; an empty array clears them; a non-empty
array replaces them. TradingView owns alert delivery and the webhook URL configuration.
The standalone example disables signals by default. See the [Pine Script guide](pinescript/README.md)
for alert setup, all eight builders, compilation evidence, and publication requirements.

## 🛠 Development and verification

Prepare the pinned native tools and Python/Cargo environments using the
[development guide](docs/development.md), then run:

```sh
source ~/.nvm/nvm.sh
nvm use
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` checks both supported versions of each language, reproduces generation,
validates captured Pine evidence, and installs package archives in clean consumer projects.
[SDK CI](.github/workflows/ci.yml) runs these checks without publication credentials.
Tests use isolated receivers; Pine editor evidence does not prove live webhook delivery.

## 📚 Documentation

- **Language guides:** [TypeScript](typescript/README.md), [Python](python/README.md), [Go](go/README.md), [Rust](rust/README.md), [Pine Script](pinescript/README.md).
- **Contracts:** [HTTP and signal semantics](docs/contracts.md), [server snapshot provenance](contracts/source.json).
- **Contributing:** [environment and commands](docs/development.md), [architecture and boundaries](docs/architecture.md), [repository instructions](AGENTS.md).
- **Progress:** [implementation plan and verification evidence](docs/plans/public-sdk.plan.md).

## 📝 License

[MIT](LICENSE)
