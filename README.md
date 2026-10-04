# Vector Trading SDK

Vector Trading SDK for JavaScript/TypeScript, Python, Go, and Rust, with Pine Script
sources for building trading signals. Licensed under MIT.

The shared development environment and a verified public contract snapshot are ready.
The snapshot covers seven REST operations and eight signal actions; its provenance is
recorded in [contracts/source.json](contracts/source.json), and transport behavior is
described in the [contract guide](docs/contracts.md). The [JavaScript/TypeScript package](typescript/README.md)
provides the complete public API and has verified local archives for Node.js 22/24.
The [Python package](python/README.md) is locally verified on Python 3.12/3.14 with wheel and sdist consumers. The [Go module](go/README.md) is locally verified on Go 1.26/1.27 with a clean local-proxy consumer and no external runtime modules. The [Rust crate](rust/README.md) is locally verified on Rust 1.99/1.88 with asynchronous HTTPS and clean source-archive consumers. The [Pine v6 sources](pinescript/README.md) include a source-only example and actual Pine Editor/parser evidence. Registry releases and TradingView publication remain planned. Reproducible four-language generation and native
probe commands are available in the [development guide](docs/development.md#generation-and-native-probes). The scope of work and its verified status are
recorded in the [implementation plan](docs/plans/public-sdk.plan.md).

Use the Node.js version in `.nvmrc` and the pnpm version in `packageManager` in `package.json`:

```sh
source ~/.nvm/nvm.sh
nvm use
pnpm install --frozen-lockfile
pnpm verify
```

Prepare the pinned native tools and locked Python/Cargo environments first; `verify`
fails when a required language is missing. It runs tests on both supported versions,
reproduces generation, checks captured Pine evidence, and installs every package archive
in clean consumer projects. Ordinary [SDK CI](.github/workflows/ci.yml) runs the same checks
without publishing credentials.

Tool setup and commands are covered in the [development guide](docs/development.md).
Current responsibilities are described in the [architecture](docs/architecture.md).

The SDK sends HTTP requests and builds JSON signals. Trading rules, authorization,
and execution belong to the server. REST account API keys are intended for server-side
integrations; webhook strategy API keys are separate credentials.

Create one signal client per transport configuration and provide the strategy key for
each send. REST clients keep their account key. See the package guides and
[delivery contract](docs/contracts.md#webhook-delivery-result) for public signatures.

Clients default to `https://www.vector-trading.app` (REST adds `/api/rest`).
The base URL remains configurable for other deployments; see [the address contract](docs/contracts.md#rest-address-key-and-permissions).
