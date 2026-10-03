# Vector Trading SDK

Vector Trading SDK for JavaScript/TypeScript, Python, Go, and Rust, with Pine Script
sources for building trading signals. Licensed under MIT.

The shared development environment and a verified public contract snapshot are ready.
The snapshot covers seven REST operations and eight signal actions; its provenance is
recorded in [contracts/source.json](contracts/source.json), and transport behavior is
described in the [contract guide](docs/contracts.md). The [JavaScript/TypeScript package](typescript/README.md)
provides the complete public API and has verified local archives for Node.js 22/24.
The [Python package](python/README.md) is locally verified on Python 3.12/3.14 with wheel and sdist consumers. The [Go module](go/README.md) is locally verified on Go 1.26/1.27 with a clean local-proxy consumer and no external runtime modules. Rust, Pine sources, and registry releases remain planned. Reproducible four-language generation and native
probe commands are available in the [development guide](docs/development.md#generation-and-native-probes). The scope of work and its verified status are
recorded in the [implementation plan](docs/plans/public-sdk.plan.md).

Use the Node.js version in `.nvmrc` and the pnpm version in `packageManager` in `package.json`:

```sh
source ~/.nvm/nvm.sh
nvm use
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:typescript
pnpm build:typescript
pnpm test:typescript:package
pnpm test:python
pnpm build:python
pnpm test:python:package
pnpm test:go
pnpm build:go
pnpm test:go:package
```

Tool setup and commands are covered in the [development guide](docs/development.md).
Current responsibilities are described in the [architecture](docs/architecture.md).

The SDK sends HTTP requests and build JSON signals. Trading rules, authorization,
and execution belong to the server. REST account API keys are intended for server-side
integrations; webhook strategy API keys are separate credentials.
