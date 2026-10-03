# SDK architecture

## Current result

The root `vector-trading-sdk-workspace` package is private shared tooling.
It contains formatting, linting, typechecking, and Vitest configuration;
JavaScript/TypeScript, Python, Go, and Rust packages are implemented locally. Shared contract/generation tests and native
probe harnesses exist.
Commands and version pins are covered in the [development guide](development.md).

The SDK contains canonical REST and signal schemas in `contracts/` and server-verified
fixtures in `conformance/`. Their accepted server commit, contract version, and SHA-256
hashes are recorded in [contracts/source.json](../contracts/source.json).
Transport semantics are documented in the [contracts](contracts.md).
Snapshot updates use the server-owned exporter; the exported files retain its exact
serialization and are excluded from Prettier. A temporary export with `commit: null`
does not qualify as an accepted snapshot.

pnpm manages root JavaScript/TypeScript tooling. Only the `typescript` directory is
reserved in `pnpm-workspace.yaml`; Python, Go, and Rust packages will use their native
tools. The `typescript/`, `python/`, `go/`, and `rust/` packages exist; generated trial sources are internal
artifacts in `generation/generated/`.

## Responsibilities

Public semantics originate in the routes and parsers of
`Vector-Trading/vector-trading`. The SDK owns HTTP transport and signal JSON building;
permissions, trading rules, queues, and exchange execution belong to the server.
REST uses an account key, while the webhook uses a strategy key. These credentials
are not interchangeable.

The root package does not depend on internal server packages. Installation and current
checks work without a neighboring server checkout, MongoDB, Redis, or credentials.

## Runtime dependencies

The agreed policy is to keep the smallest dependency set that supports reliable
transport and serialization. A generator's default manifest is not a reason to
ship an unused dependency. Development tools and probe version locks are separate
from dependencies required by SDK consumers.

| Language              | Selected policy                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | No external runtime dependencies; use native `fetch` and generated codecs.                                                                                                                                      |
| Go                    | No external runtime dependencies; use `net/http`, `encoding/json`, `context`, and `time`. Model checks use generated codecs/schema metadata and standard-library facilities.                                    |
| Python                | Keep `httpx` for transport and Pydantic for typed models and validation. Review additional direct dependencies against actual generated imports and supported Python versions.                                  |
| Rust                  | Keep `reqwest`, `serde`, and `serde_json` for HTTP and JSON. Retain auxiliary crates only where the generated implementation uses them; do not implement HTTP/TLS or JSON parsing solely to avoid dependencies. |

The internal Go sources already use only the standard library. The stale
`validator.v2` probe requirement was removed; the probe checks the module graph and
compiles with dependency downloads disabled. There is no placeholder `go.sum`.
Python distributes generated Pydantic models and a synchronous HTTPX adapter. Its only direct
runtime dependencies are `httpx` and Pydantic. Python 3.12 provides the used typing
primitives; generation replaces only known typing-backport imports with standard-library
imports. Generated asynchronous trial transport still uses `python-dateutil` in native
probes but is excluded from public archives. `pydantic-core` and `typing-extensions` remain
transitive consumer requirements owned by Pydantic/HTTPX rather than extra SDK declarations.
Rust uses `reqwest` query encoding and `serde_with` (`std` only) to distinguish an
omitted nullable response field from explicit null. `time` (`std`/`parsing` only)
validates RFC 3339 dates with MSRV 1.88; this avoids a separate handwritten calendar
parser. The public crate does not declare `url`; only the internal trial transport
uses it directly. The unused `serde_repr`
declaration and probe dependency were removed through a pinned template override.
The selected asynchronous `reqwest` transport requires a Tokio execution context;
direct Tokio usage for tests/examples belongs in the appropriate dependency category.

All four language manifests follow this policy. They must follow this policy,
declare compatible consumer requirements, and keep exact development pins in their
own locks. Changes to the policy require an explicit architectural decision and
updated generation/package checks.

## Reproducible generation

OpenAPI Generator `7.25.0` is pinned by version, Maven URL, and SHA-256 in
`generation/generator.json`. Java 11 or newer and `unzip` are generation tools only.
Four configurations in `generation/{typescript,python,go,rust}.yaml` select
`typescript-fetch`, `python` with httpx, `go`, and `rust` with reqwest.

`scripts/generation.ts` derives one intermediate OpenAPI document from the accepted
REST and signal snapshots. It translates the used draft-07 features (`const`,
references, numeric exclusive bounds), distributes shared grant properties into
named `oneOf` variants, and retains all seven REST paths unchanged. It adds action
and grant discriminators for generators; numeric transport models use double
precision, avoiding Go's default `float32`. The original snapshots are unchanged.
Tests compare all 40 signal schema outcomes and grant requiredness with the source.
The generator also emits TypeScript `contract.ts` and Python/Go/Rust `contract.json` metadata
from those same schemas and REST operations. Public runtime validation uses this accepted metadata without
a runtime schema-validation dependency or a separate handwritten contract.

`generation/template-patches.json` holds nine narrow upstream-template overrides.
Each override pins the upstream template's SHA-256 and requires a unique match:

- TypeScript models/runtime preserve `undefined` under strict optional-property
  checking; codecs reject missing required fields, non-nullable `null`, and
  non-finite numbers.
- Python hides private input values in validation-error messages and preserves omitted fields while rejecting explicit `None`/`null` for
  non-nullable fields and non-finite numbers. Field validators also allow valid
  assignment without treating unrelated unset fields as explicit nulls.
- Go prefixes enum constants, selects disjoint unions by their discriminator,
  preserves non-nil empty TP slices through generated `MarshalJSON`, and rejects
  explicit nulls on non-nullable fields. Its internal trial HTTP template also normalizes diagnostic style and rejects the unused broken `*os.File` decode path; the public JSON-only transport does not use it.
- Rust uses untagged unions whose branch enums already carry the wire discriminator;
  the upstream tagged wrapper consumed `action`/`grantType` before the branch could
  read it. Optional non-nullable fields reject explicit nulls, and numeric serializers
  reject non-finite values. `None` omits TP and `Some(vec![])` preserves clearing.
  The library template also drops the unused `serde_repr` declaration.

TypeScript and Python generated sources are checked in under `generation/generated/`, alongside the
intermediate specification and an input/output hash manifest. Go has one authoritative generated tree under `go/internal/generated/` so its subdirectory module is self-contained. The manifest keeps logical `go/*` output names and records physical roots; generation/checks and native probes use that mapping. Rust likewise has one authoritative full generated tree under `rust/generated/`; its crate compiles/packages only the models and metadata, while native probes compile the full trial tree. No mirrored model trees or working-tree import replacements remain. Internal generated directories expose no documented public SDK entry point. Go output is formatted with `gofmt` during generation; Rust uses pinned rustfmt with Rust 2021 style, stable on both accepted compilers. Regeneration and
`generated:check` compare the complete file inventory and bytes; changes to the
snapshot, generator, configurations, templates, Node pins, or root lockfile are
tracked. Handwritten orchestration, tests, and probes are outside this derived tree.
Do not edit derived files; change their source/configuration/template and regenerate.

`generation:probe` creates temporary native projects, compiles their full generated
sources, and runs the same 17 valid signal fixtures and four grant variants in all
languages. It also checks TP omission/empty arrays/nulls, strategy version and string
timestamps, ISO dates, required `sourceId`, non-finite rejection, and a generated
Bearer request against an HTTP double/local server. Rust runs on stable `1.99.0`
and verified MSRV `1.88.0`; Python minimum 3.12 was exercised on `3.12.9`, and Go
on `1.26.0`. Dependencies for these probes are pinned separately from future public
packages; temporary projects are removed even after a failure.

Generated transport models do not implement the server's complete business parser.
Schema-valid but parser-invalid TP/SL and price relationships remain explicitly
recorded in shared fixtures and proven by STEP-02 server tests. Package builders in
STEP-04–07 implement the agreed validation and run their complete C01–C12 suite;
these generation probes do not establish installable SDK readiness. The public Python client uses synchronous HTTPX; its archive checks separately prove installable package readiness.

## JavaScript/TypeScript package

`typescript/src/index.ts` is the only public entry point for `@vector-trading/sdk`.
Handwritten `RestClient` methods call the generated `DefaultApi`; generated codecs
and types are imported from `generation/generated/typescript/` and bundled into
the package. There is one authoritative generated tree, not a separately edited copy.
`contract.ts` provides derived schema/operation metadata for zero-dependency runtime
validation. Cross-field signal checks implement the verified outgoing subset;
they do not replace the server's authorization or trade processing.

`SignalsClient` owns strategy-key delivery separately from account-key REST. Eight
offline builders clone valid messages and fix timestamps before sending. The transport
bounds requests through response-body receipt, does not follow redirects, and never
retries automatically. Public errors expose bounded, redacted details without raw
response objects, private bodies, or underlying exception causes.

`tsup` 8.5.1 builds ESM/CommonJS and matching `.d.ts`/`.d.cts` declarations. The
declaration worker's injected `baseUrl` needs a narrowly scoped TypeScript 6
`ignoreDeprecations` option; ordinary source typechecking remains strict.
The archive allowlist includes only `dist`, MIT license, and the package README.
The public API, parameter objects, page iterators, and examples are described in
the [package README](../typescript/README.md). Local archive checks exercise installed
JavaScript and TypeScript consumers on Node 22/24; there is no registry publication.

## Python package

`python/src/vector_trading/__init__.py` defines public imports. Generated models live once
under `generation/generated/python/vector_trading/_generated/models`; the generator sets
that internal namespace. Handwritten REST methods serialize parameters from generated
operation metadata and decode through generated models. The public transport uses
synchronous `httpx.Client`; the asynchronous generated HTTP trial is not distributed.

Hatchling force-includes canonical models and metadata in wheel/sdist. The sdist carries
them under `src/vector_trading/_generated/models` so a clean build needs no neighboring
checkout. The build hook distinguishes canonical files from files already present in
the sdist to avoid duplicate entries. Standard-library package path extension supports
Hatch editable installs where forced models are installed beside handwritten source;
regular archives contain the complete package. `py.typed` and public model annotations
are verified by clean mypy consumers. A generated internal namespace does not become a
second documented public API.

Clients close resources explicitly and support context managers. Retry count is zero;
redirects and environment proxies are disabled. HTTPX network phases have finite timeouts,
streaming bodies check elapsed time, and synchronous cancellation uses cooperative
`threading.Event` checks. URL objects retain wire components but redact their log
representation, protecting the strategy key without global logger changes.
The [package README](../python/README.md) owns public signatures and lifecycle details.

## Go package

The module `github.com/Vector-Trading/vector-trading-sdk/go` exposes package
`vectortrading`. Public aliases reuse internal generated transport models; handwritten
REST methods use generated operation/schema metadata and standard-library HTTP. Generated
trial HTTP sources remain internal and are not the public transport. Signal builders
validate the shared outgoing subset and round-trip through generated codecs. Nil TP
slices omit the field; non-nil empty slices survive generated `MarshalJSON` as `[]`.

The runtime has no external modules or `go.sum`. Go `1.26.0` / `1.27.1` and Staticcheck
`v0.8.1` are development pins in `go/toolchains.json`; the analysis tool is installed
outside the library graph. Native checks and archive preparation live in `go/tools/check`;
root commands delegate to them. A reproducible ZIP includes the standalone module,
models/metadata, examples, README, and license. Clean consumers download through a
local file proxy under the real module path without `replace`, then compile offline.

Separate account/strategy clients accept explicit `http.Client` configuration and
`context.Context`. Total deadlines cover body receipt. Redirects are disabled; native
transports use fresh HTTP/1 connections to prevent implicit stale-connection and HTTP/2 stream retries. Custom
transports must preserve the no-retry/no-private-logging policy. Error values retain no
raw HTTP cause. Four page iterators preserve filters and cancellation, continue through
empty pages, and reject repeated cursors. See the [package README](../go/README.md) for
public signatures, cleanup, and future major-version/subdirectory-tag rules.

## Rust package

`rust/` distributes `vector-trading-sdk`, imported as `vector_trading_sdk`. Public
wrappers expose seven asynchronous REST operations, four lazy page traversals, eight
offline named signal builders, validated serialization, and a separate strategy-key
sender. Generated model enums preserve wire discriminators; nullable optional fields
preserve omission/null, and `Option<Vec<T>>` preserves explicit empty TP arrays.
Validation consumes generated schema/operation metadata and fails closed for unknown
snapshot patterns. No generated file is edited by hand.

The managed reqwest client uses HTTPS with verified certificates, HTTP/1, no idle
connection reuse, no redirects, and an explicit never-retry policy. Total timeouts
include response bodies; dropping a future cancels local waiting. Errors retain bounded
redacted diagnostics without raw causes. `close` prevents new calls across clones;
drop pending futures and all clones to release resources. Tokio is the caller's
execution context and a direct development-only dependency for examples/tests.

Rust 1.99.0 and MSRV 1.88.0 run formatting, Clippy, fixture/HTTP/HTTPS tests, doctests,
examples, builds, archive verification, and publication dry runs without uploads.
Clean consumers install extracted `.crate` sources and exercise the full public API
against localhost with independent locks and checked runtime dependency/features.
The archive allowlist excludes test data, trial transport, and tooling. See the
[package README](../rust/README.md) and [development commands](development.md#rust-package).

## Planned results

Pine sources and release are defined in the
[plan](plans/public-sdk.plan.md). Their public entry points and package configuration
will be documented after the corresponding steps are accepted.
