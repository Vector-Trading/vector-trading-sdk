# SDK development

## Current environment

Shared tools are pinned independently of the neighboring application:

| Tool                                 | Version              | Purpose                                                      |
| ------------------------------------ | -------------------- | ------------------------------------------------------------ |
| Node.js                              | `24.21.0`            | Shared tools; `.nvmrc` and `engines.node`                    |
| pnpm                                 | `11.22.0`            | Root package and future TypeScript package; `packageManager` |
| Prettier                             | `3.9.9`              | Markdown, JSON, YAML, JavaScript, and TypeScript             |
| ESLint / `@eslint/js`                | `10.11.0` / `10.0.1` | Handwritten JavaScript and configuration checks              |
| `typescript-eslint`                  | `8.71.0`             | Handwritten TypeScript checks                                |
| TypeScript                           | `6.0.3`              | Strict typechecking of current configurations                |
| `@types/node`                        | `24.19.1`            | Node.js 24 types                                             |
| `globals` / `eslint-config-prettier` | `17.13.0` / `10.1.8` | Node.js globals and formatting compatibility                 |
| Vitest                               | `5.0.3`              | Configuration for future shared-tooling tests                |

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
warnings are errors. `typecheck` checks these configurations and future shared scripts
in `scripts/` using the root `tsconfig.json`. Do not fix generated formatting or lint
issues manually: `**/generated/**` is excluded from these tools. pnpm owns `pnpm-lock.yaml`.
Canonical JSON in `contracts/` and `conformance/` is also excluded from Prettier to
preserve the server export's bytes and SHA-256 hashes.

Vitest runs the shared contract/generation regression tests through `pnpm test`.
Contract and generation commands are described below. Public package `build`,
`verify`, and language commands remain later-step results; current checks do not
prove installable language SDK readiness.

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

The generator requires Java 11 or newer and `unzip`; these are development tools,
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
Neither command imports the server or contacts trading services. Templates and
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

## Native tools for later steps

Python, Go, and Rust are not required for current root checks. The following is the
agreed implementation matrix, not verified support for finished packages:

| Area                  | Environments and tools                                | Configuration and command owner                                        |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| JavaScript/TypeScript | Node.js 22/24, TypeScript, Vitest, `tsup`             | `typescript/`, STEP-04; pnpm workspace package                         |
| Python                | Python 3.12/3.14, `uv`, Hatchling, Ruff, mypy, pytest | `python/`, STEP-05; `pyproject.toml` and `uv.lock`                     |
| Go                    | Go 1.26/1.27, `gofmt`, `go vet`, testing, Staticcheck | `go/`, STEP-06; `go.mod` and native checks                             |
| Rust                  | Cargo, rustfmt, Clippy, built-in tests                | Stable `1.99.0`, MSRV `1.88.0` verified in STEP-03; `rust/` in STEP-07 |
| Pine Script           | TradingView Pine Editor                               | `pinescript/`, STEP-08; actual editor compilation                      |

Install `uv` for Python using the [official guide](https://docs.astral.sh/uv/getting-started/installation/).
Once `python/.python-version` exists, `uv python install` in `python/` installs the
selected Python, and `uv sync --locked` prepares package dependencies. STEP-05 pins
`uv` and verification tools.

Install the required Go version using the [official guide](https://go.dev/doc/install).
The future `go.mod` minimum is 1.26; STEP-06 pins exact compiler and Staticcheck versions.
Do not create a Go module at the root.

Install Rust through [rustup](https://rust-lang.org/tools/install/). STEP-03 verified stable `1.99.0`
and MSRV `1.88.0`; use the selected exact version with `rustfmt` and `clippy`. The future
`rust/rust-toolchain.toml` will select it automatically. Do not substitute unpinned
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
