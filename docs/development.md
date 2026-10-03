# SDK development

## Current environment

Shared tools are pinned independently of the neighboring application:

| Tool                                 | Version              | Purpose                                             |
| ------------------------------------ | -------------------- | --------------------------------------------------- |
| Node.js                              | `24.21.0`            | Shared tools; `.nvmrc` and `engines.node`           |
| pnpm                                 | `11.22.0`            | Root tools and TypeScript package; `packageManager` |
| Prettier                             | `3.9.9`              | Markdown, JSON, YAML, JavaScript, and TypeScript    |
| ESLint / `@eslint/js`                | `10.11.0` / `10.0.1` | Handwritten JavaScript and configuration checks     |
| `typescript-eslint`                  | `8.71.0`             | Handwritten TypeScript checks                       |
| TypeScript                           | `6.0.3`              | Strict typechecking of current configurations       |
| `@types/node`                        | `24.19.1`            | Node.js 24 types                                    |
| `globals` / `eslint-config-prettier` | `17.13.0` / `10.1.8` | Node.js globals and formatting compatibility        |
| Vitest                               | `5.0.3`              | Shared-tooling and TypeScript tests                 |

Direct dependencies are pinned in `package.json`; the full tree is pinned in
`pnpm-lock.yaml`. TypeScript `6.0.3` is within the range supported by `typescript-eslint`.
The root package has `private: true` and is not intended for publication.

## Setting up Node.js and pnpm

With nvm installed:

```sh
source ~/.nvm/nvm.sh
nvm install
nvm use
```

Install nvm using its [official guide](https://github.com/nvm-sh/nvm#installing-and-updating).
`.nvmrc` pins an exact version; `nvm install` is needed only if that version is absent.
Without nvm, install the same version from the [Node.js archive](https://nodejs.org/dist/v24.21.0/).

If pnpm is already available, check `pnpm --version` in the project root against
`packageManager`. Modern pnpm can select the project's pinned version.
Corepack, when available, runs it without global installation:

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
```

In this form, `corepack pnpm` replaces `pnpm` in every command. If neither pnpm nor
Corepack is available, obtain the required version temporarily through npm:

```sh
npm exec --yes --package=pnpm@11.22.0 -- pnpm --version
npm exec --yes --package=pnpm@11.22.0 -- pnpm install --frozen-lockfile
```

Installation options and compatibility are covered in the [pnpm documentation](https://pnpm.io/installation).
The tools do not install Git hooks. The current environment requires neither `.env`
nor secrets; `.env.example` states this explicitly.

## Working commands

After `source ~/.nvm/nvm.sh && nvm use`, run:

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
```

`format` modifies files supported by Prettier, including instructions and the plan.
The other three commands check files without fixes. Format first, then run checks
and inspect the diff. A normal `--frozen-lockfile` installation does not update
manifest dependencies.

pnpm settings are in `pnpm-workspace.yaml`; `.npmrc` selects the public npm registry.
The dependency store is in the ignored `.cache/pnpm/store` inside the checkout.
The global virtual store is disabled, so local installations and CI use the same
`node_modules` structure. `verifyDepsBeforeRun: error` prevents check commands from
automatically installing dependencies: explicitly install first if `node_modules`
is stale. Incompatible environments and dependencies are rejected;
`minimumReleaseAgeStrict: true` prevents pnpm from automatically writing exceptions
for recently published versions.

`lint` checks maintained JS/TS files, including `eslint.config.mjs` and `vitest.config.ts`;
warnings are errors. `typecheck` checks these configurations and shared scripts
in `scripts/` using the root `tsconfig.json`, then checks the TypeScript package. Do not fix generated formatting or lint
issues manually: `**/generated/**` is excluded from these tools. pnpm owns `pnpm-lock.yaml`.
Canonical JSON in `contracts/` and `conformance/` is also excluded from Prettier to
preserve the server export's bytes and SHA-256 hashes.

Vitest runs the shared contract/generation regression tests through `pnpm test`.
Contract and generation commands are described below. The TypeScript package commands and installed-archive checks are described below.
The combined `verify` command and remaining language packages are later-step results.

## Updating the contract snapshot

The SDK uses the checked-in snapshot for ordinary work; the server checkout is needed
only to verify and export a contract update. Read the server's own instructions and
run its targeted contract tests, formatting, typechecking, and linting first. Accept
the server changes into its `main` before creating a normal export.

From a server checkout at the accepted commit, with its pinned Node.js/pnpm environment:

```sh
pnpm sdk:export:test
pnpm sdk:export --output /tmp/vector-sdk-export-a
pnpm sdk:export --output /tmp/vector-sdk-export-b
diff -r /tmp/vector-sdk-export-a /tmp/vector-sdk-export-b
```

Use two fresh output directories. Normal export requires committed source inputs
and a source HEAD accepted into server `main`. Verify `contracts/source.json` has that
exact commit and `status: committed`; verify its four artifact hashes and source
hashes against the commit. Copy all five exported files into this SDK without
reformatting, update affected consumers and documentation, and run current SDK checks.
`--preview` is for temporary investigation and must not replace the accepted snapshot.
The manifest is a provenance record; automated SDK contract checks verify the snapshot hashes and fixtures; generation
commands use that snapshot without the server checkout.

## Generation and native probes

The generator requires Java 11 or newer, `unzip`, and Go `gofmt`; these are development tools,
not SDK runtime dependencies. Versions and the JAR checksum are pinned in
`generation/generator.json`. Download/setup is explicit:

```sh
pnpm generation:setup
pnpm contracts:check
pnpm generate
pnpm generated:check
pnpm test
```

`generation:setup` downloads the pinned Maven JAR into `.cache/generation/` and
verifies SHA-256 before retaining it. `OPENAPI_GENERATOR_JAR` can select a predownloaded
file with the same checksum. `JAVA` may select a Java executable. `generate` builds
in staging before replacing the internal derived tree; `generated:check` regenerates
in temporary storage and checks every filename, byte, and recorded input hash.
Neither command imports the server or contacts trading services. Go output lives once in `go/internal/generated/`; the manifest records its physical root. Rust output lives once in `rust/generated/`, also mapped by the manifest. Select pinned formatters through `PATH`, `SDK_GOFMT`, or `SDK_RUSTFMT`. Templates and
intermediate-schema decisions are covered in the [architecture](architecture.md#reproducible-generation).

Native probes require Python 3.12 or newer, uv, Go, Rustup/Cargo with toolchains
`1.99.0` and `1.88.0`, and the locked probe dependencies. Their current tested pins
are in `generation/toolchains.json`. Prepare an isolated Python environment:

```sh
uv venv .cache/generation/venv --python 3.12.9
uv pip install --python .cache/generation/venv/bin/python -r generation/probes/python-requirements.txt
```

The Go probe needs the pinned `go1.26.0` toolchain available beforehand, but has no
external module dependencies or `go.sum`. It checks its module graph and runs with
`GOPROXY=off`, `GOSUMDB=off`, and `GOTOOLCHAIN=local`; select the pinned binary through
`PATH` or `SDK_PROBE_GO`. If Go manages toolchains automatically, explicitly prepare
it with `GOTOOLCHAIN=go1.26.0 go env GOROOT`, then select that directory's `bin/go`
through `SDK_PROBE_GO`. Prepare Cargo dependencies with `cargo +1.99.0 fetch --locked`
in `generation/probes/rust/`. The Go module and Cargo manifest/lockfile are test
harness inputs; they are not public SDK packages. Install the two Rust toolchains
through Rustup if absent, using the exact versions above.
The [runtime dependency policy](architecture.md#runtime-dependencies) governs future
package manifests as well as the current generated probes.

```sh
pnpm generation:probe
```

`SDK_PROBE_PYTHON`, `SDK_PROBE_GO`, and `SDK_PROBE_CARGO` can select existing executable
paths. Standard `CARGO_HOME`, `RUSTUP_HOME`, `GOMODCACHE`, and `GOCACHE` may select
isolated caches; `CARGO_TARGET_DIR` selects probe build storage (MSRV adds `-msrv`).
Cargo probes use `--locked --offline`. Native projects live in temporary storage and
are always removed; the Rust HTTP test binds only to localhost and uses a synthetic
credential. No live trading environment or secrets are required.

Python probe formatting uses Ruff `0.13.0`; Go uses `gofmt`; Rust uses rustfmt
`1.99.0`. These tools format the handwritten probe files, never the derived tree.
Run root formatting, typechecking, linting, contract/generation checks, regression
tests, and native probes after changing generation. Full `pnpm verify` remains a
STEP-09 result.

## JavaScript/TypeScript package checks

The `typescript/` workspace package has no external runtime dependencies. `tsup`
`8.5.1` is a development dependency; pnpm explicitly allows esbuild's install script
and pins its resolved version in the lockfile. Root lint includes handwritten package
sources, tests, examples, and configurations; root typecheck also runs package
typechecking. Generated sources remain excluded from formatting/linting and are
checked through reproducible generation and strict compilation.

```sh
pnpm --dir typescript typecheck
pnpm --dir typescript lint
pnpm test:typescript
pnpm build:typescript
pnpm test:typescript:package
```

`pnpm test` still owns shared contract/tooling regression tests. Run both suites.
Package tests bind an isolated loopback HTTP server and use synthetic credentials;
an execution sandbox must permit localhost listeners. No trading environment is used.
Builds create ESM, CommonJS, and both declaration formats under ignored `typescript/dist/`.
`pnpm --dir typescript pack` creates a local archive without publishing.

The archive check packs the existing build into ignored `.cache/packages/`, inspects
the allowlist and dependency metadata, and installs it offline into six temporary
consumer projects: JavaScript ESM, JavaScript CommonJS, and TypeScript on Node 22/24.
TypeScript consumers compile both `.mts` and `.cts` entry points. Every installed
consumer invokes all seven REST methods and eight signals against localhost; runtime
graphs contain only the SDK. Temporary consumer projects and npm caches are removed.
Select existing Node executables with `SDK_NODE22` and `SDK_NODE24`; defaults are
the local nvm `v22.23.2` binary and the current Node 24 executable. Prepare these
versions explicitly before running the check; it does not install Node globally.

## Python package checks

Python `3.12.9` is pinned by `python/.python-version`; Python `3.14.6` is also verified.
The package uses `uv` `0.12.1`, Hatchling `1.32.4`, Ruff `0.16.10`, mypy `2.4.0`, and
pytest `9.1.1`. Exact development versions and transitive dependencies belong to
`python/uv.lock`. Consumer requirements are compatible ranges for HTTPX and Pydantic;
they do not inherit the development lockfile. The [package README](../python/README.md)
owns public methods, model serialization, cancellation, and lifecycle behavior.

From `python/`, with the pinned uv and Python available:

```sh
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run mypy src
uv run pytest
uv build
uv run python scripts/check_package.py
```

Run `uv run ruff format .` and `uv run ruff check . --fix` separately when fixes are
needed. Checks keep `uv.lock` unchanged. The cache directory is relative to the current
working directory (`../.cache/uv` from `python/`); root commands explicitly set the SDK
cache location. Root `pnpm test:python`, `pnpm build:python`, and
`pnpm test:python:package` delegate to these native tools through `scripts/python.ts`.
No Python tests are replaced by JavaScript checks.

For a separate Python 3.14 environment without replacing the pinned default environment:

```sh
cd python
UV_PROJECT_ENVIRONMENT=../.cache/python314 uv sync --locked --python 3.14.6
UV_PROJECT_ENVIRONMENT=../.cache/python314 uv run --locked --python 3.14.6 pytest
```

Generated models are included from the canonical `generation/generated/python` tree;
uv cache keys include its manifest. After regeneration, `uv sync --locked` refreshes
the editable installation. Package archives contain models, metadata, license, and
`py.typed`; the generated asynchronous trial transport is excluded. `uv build` builds
wheel from its sdist as well as producing the source archive. The sdist therefore
builds without the SDK/server checkout. Archives remain in ignored `python/dist/`.

The package checker installs wheel and sdist separately into four clean environments
on Python 3.12/3.14 without editable installations. It invokes all seven REST methods
and eight signals, checks installed metadata/dependency graphs, runs strict public-type
consumers, and imports/checks the examples. Set `SDK_PYTHON312` or `SDK_PYTHON314` to select
existing interpreters; defaults use `uv python find`, with no interpreter installation.
Consumer dependency resolution uses PyPI or the local cache; it does not publish anything.
Tests use localhost and synthetic credentials. Temporary consumer projects are removed.

## Go package checks

`go/go.mod` declares module `github.com/Vector-Trading/vector-trading-sdk/go`, minimum
Go `1.26.0`, no external requirements, and no `go.sum`. Development tools are pinned
in `go/toolchains.json`: Go `1.26.0`, Go `1.27.1`, and Staticcheck `v0.8.1`
(`2026.2.1`, built with Go `1.27.1`). Ordinary checks require pre-existing tools and
use `GOTOOLCHAIN=local`, `GOPROXY=off`, and `GOSUMDB=off`.

Prepare toolchains explicitly if missing, using an existing Go bootstrap executable:

```sh
GOTOOLCHAIN=go1.26.0 go env GOROOT
GOTOOLCHAIN=go1.27.1 go env GOROOT
```

Set `SDK_GO126` and `SDK_GO127` to those roots' `bin/go` executables. Install the
pinned analyzer in an isolated directory, using the selected Go 1.27 executable:

```sh
GOBIN="$PWD/.cache/go-tools" GOTOOLCHAIN=local "$SDK_GO127" install honnef.co/go/tools/cmd/staticcheck@v0.8.1
```

This installation is separate from the library module graph. `SDK_STATICCHECK` may
select the exact existing binary; the default is `.cache/go-tools/staticcheck`.
`SDK_GOFMT` may select the pinned `bin/gofmt` for generation. From the repository root:

```sh
pnpm test:go
pnpm build:go
pnpm test:go:package
```

The root script only delegates to `go run ./tools/check`. Native `test` verifies
`gofmt` without edits, `go mod tidy` without changes, a main-module-only dependency
graph, `go vet ./...`, `go test -race ./...`, and `go build ./...` on both versions,
then pinned Staticcheck. Run `gofmt -w` separately before checking. The same commands
can be run directly from `go/` with the selected compiler; for the analyzer, put the
selected Go 1.27 `bin` on `PATH` and select its `GOROOT`.

Native `build` compiles and creates an ignored deterministic ZIP under `go/dist/`.
Native `package` downloads this ZIP through a temporary local file module proxy into
fresh module caches on both versions. Each clean consumer imports the public module
and examples, invokes all REST operations and signals against localhost, verifies the
two-module dependency graph, and compiles offline. No `replace`, public tags, publication,
server checkout, or live credentials are used. ZIP contents exclude tests, development
tools, and build output; temporary consumers/proxies are removed even after failure.
The examples are callable and perform no import-time network work.

## Rust package

The [Rust library](../rust/README.md) is `vector-trading-sdk` 0.1.0 with minimum
`rust-version = "1.88"`. Install exact Rustup toolchains `1.99.0` and `1.88.0` with
`rustfmt` and `clippy`; the crate toolchain file selects 1.99.0. Fetch its lock once:

```sh
cd rust
cargo fetch --locked
cd ..
pnpm test:rust
pnpm build:rust
pnpm test:rust:package
```

`rust/tools/check.ts` owns the native matrix; root commands delegate to it. `test`
checks no-diff formatting, Clippy with warnings denied, all native tests, compiled
examples, and doctests (including README snippets) on both compilers. `build`
compiles all targets on both versions. The localhost HTTP/HTTPS tests use synthetic
keys and ephemeral certificates. Standard Cargo/Rustup cache and target settings
are supported; `SDK_CARGO` selects an isolated Cargo executable.

`package` runs locked Cargo packaging and publication dry runs on both compilers;
`--allow-dirty` permits a local pre-commit review. Cargo's dry run needs network access
to read registry metadata but never uploads. Other checks and clean consumers run
offline after dependency preparation. Repeated `.crate` builds match byte for byte within each Cargo version; file
payloads match across both versions despite native tar metadata differences; the allowlist includes MIT, README, models/metadata, public wrappers, and examples.
Two temporary consumer projects install extracted source archives with independent
locks, verify dependency/features and the actual archive source path, compile, and
execute all seven REST operations/eight signals against localhost. They never import
working `src`. Consumers and servers are removed/closed even on failure; the retained
artifact is `rust/dist/vector-trading-sdk-0.1.0.crate`.

## Native tools for later steps

Python, Go, and Rust are required for their package checks. The following is the agreed implementation matrix;
TypeScript, Python, Go, and Rust packages are locally verified; Pine remains planned:

| Area                  | Environments and tools                                | Configuration and command owner                    |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| JavaScript/TypeScript | Node.js 22/24, TypeScript, Vitest, `tsup`             | `typescript/`, STEP-04; pnpm workspace package     |
| Python                | Python 3.12/3.14, `uv`, Hatchling, Ruff, mypy, pytest | `python/`, STEP-05; `pyproject.toml` and `uv.lock` |
| Go                    | Go 1.26/1.27, `gofmt`, `go vet`, testing, Staticcheck | `go/`, STEP-06; `go.mod` and native checks         |
| Rust                  | Cargo, rustfmt, Clippy, built-in tests                | `rust/`, STEP-07; stable `1.99.0`, MSRV `1.88.0`   |
| Pine Script           | TradingView Pine Editor                               | `pinescript/`, STEP-08; actual editor compilation  |

Install `uv` for Python using the [official guide](https://docs.astral.sh/uv/getting-started/installation/).
`python/.python-version` selects the default interpreter; if missing locally, an explicit
`uv python install` in `python/` prepares it. `uv sync --locked` prepares package dependencies.
The Python package section above records the pinned uv and verification tools.

Install the required Go version using the [official guide](https://go.dev/doc/install).
The `go/go.mod` minimum is 1.26; `go/toolchains.json` pins exact compiler and Staticcheck versions.
Do not create a Go module at the root.

Install Rust through [rustup](https://rust-lang.org/tools/install/). STEP-03 verified stable `1.99.0`
and MSRV `1.88.0`; use the selected exact version with `rustfmt` and `clippy`. `rust/rust-toolchain.toml` selects stable automatically. Do not substitute unpinned
`stable` for the verified project compiler.

Root language commands will delegate to native tools in the corresponding directory.
Full `pnpm verify` and CI are assembled in STEP-09 after all packages exist.

## Files and local artifacts

`.editorconfig` specifies UTF-8 and LF; `.gitattributes` normalizes text files in Git.
`.gitignore` excludes dependencies, environments, caches, builds, reports, local secrets,
temporary release archives, IDE project/workspace metadata (`*.iml`, `*.ipr`,
`*.iws`, `*.code-workspace`, `.idea/`, `.vscode/`, and Eclipse settings), and editor
backup files. Contracts, shared fixtures, instructions, required
derived code, `.env.example`, and lockfiles are retained in Git.

To check reproducibility, copy sources into a new temporary directory without
`node_modules`, caches, or local `.env`, then perform a `--frozen-lockfile` install and
run the three check commands. Uncommitted files in that checkout prove local acceptance,
not integration into `main`.
