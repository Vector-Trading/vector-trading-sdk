# Public Vector Trading SDKs with one contract and verifiable releases

## Plan Metadata

- Status: `in-progress`
- Created: `2026-10-03`
- Last updated: `2026-10-03`
- Based on revision: SDK `3c83ba25ac0a1e642d0327e23b07b320590e43c6`; server `be43459ba348d5dd852269f51a0897fb54668238`, matching local `origin/main` at verification time.
- Plan root: `/Users/vlad.prychodko/Work/askadias/git/vector-trading-sdk`.
- Planning context: the first and only SDK working tree, branch `main`, `origin=https://github.com/Vector-Trading/vector-trading-sdk.git`.
- Workspace state: STEP-01 is integrated into SDK `main` and `origin/main` at commit `3cd3f75e146de2001826f710a4c9f750a8f9b4de`, with its integration receipt in `d2204e25b76b223b2fcbecd4f6ffccb7a6eccf48`. STEP-02 and STEP-03 are integrated into local SDK `main` at `61fc73b860d4b77c15c7192e1d54bd48dfb2fe89`: the accepted server snapshot, English documentation, reproducible generation, four-language probes, and runtime dependency policy are committed and verified. The server source remains local `main` commit `e51366b859926abd5bdc222a5249e99f8080f0f8`. The latest SDK delivery has not been pushed to `origin/main`; language packages remain pending.
- Integration target: the SDK repository's `main` after verified delivery; for canonical export, a separately accepted main-repository commit; for release, confirmed npm, PyPI, crates.io, and public Go tags/proxy.
- Target branch: `main` in both repositories. Check the current revision before execution; merging server branches does not complete SDK steps.
- Source root: `/Users/vlad.prychodko/Work/askadias/git/vector-trading`; planning base `be43459ba348d5dd852269f51a0897fb54668238`. STEP-02 completion found the prepared changes already bundled with unrelated work in `b094181d0147da0d785bd2d6d92df806f23bbdcc` on `VT-000/demo-entry-review-fixes`. With separate user authorization, only the 19 STEP-02 files/owned documentation hunks were accepted into existing local `main` as `e51366b859926abd5bdc222a5249e99f8080f0f8`. The unrelated branch and its commit were preserved; no server push occurred. A parallel home-demo documentation edit appeared after acceptance and was preserved in the server working tree on `main`; switching back would overlap that edit. The snapshot source is the accepted commit, and all hashed inputs were checked against its committed bytes.
- Plan file: `docs/plans/public-sdk.plan.md`.

## Goal, scope, and current state

Users receive an installable SDK for JavaScript/TypeScript, Python, Go, and Rust: seven existing account-key REST operations plus construction and delivery of all eight strategy-key webhook actions. Pine Script receives versioned JSON-building library sources and examples; importable TradingView publication remains a separate manual process. The first release has equivalent functional coverage across all four languages.

Java is excluded by user decision. Public trading REST commands, WebSocket, exchange clients, SDK API-key creation, database migrations, and changes to trading execution are out of scope. The SDK does not replace CCXT or create a custom cross-language code-conversion system.

### Verified facts and sources

Server paths below are relative to `Source root`; SDK paths are relative to `Plan root`. Check them against selected commits before implementation. Plan updates verified that the listed REST, webhook, signal-parser, and bundle-access implementation files did not change between the previous base `fc9042a75cbfa88e9ec4ebb53d519870d4318f1e` and current server `main`. Changes to `docs/architecture.md` and `docs/autotrading.md` concern UI and exchange protection; line numbers below refer to the initial investigation, so locate relevant sections by heading. STEP-02 server checks have run; their results are recorded in the step evidence.

| Fact                                                                                                                                                                                                                                                        | Source                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST has 7 operations under `/api/rest/v1`: `GET /bundles`, `GET /users`, `GET /checkout/{checkoutId}`, `GET /bundles/{bundleId}/users`, `GET /bundles/{bundleId}/grants`, `POST /bundles/{bundleId}/grants`, `DELETE /bundles/{bundleId}/grants/{grantId}` | `apps/web/hono/routes/rest-api/rest-api.router.ts:55`                                                                                                               |
| OpenAPI 3.0.3 is available at `/api/rest/openapi.json`; it is maintained manually and separately from Zod. The initial base lacked `operationId`; the accepted snapshot contains seven stable IDs. `servers` contains relative `/api/rest`                  | `apps/web/hono/routes/rest-api/openapi/document.ts`, `openapi/info.ts`, `openapi/paths.ts`, `schemas/*.schema.ts`                                                   |
| REST uses `Authorization: Bearer vt_…`, scopes `bundles:read`, `users:read`, `grants:read/write`; checkout requires `grants:read`. Keys are intended for server-side integration                                                                            | `packages/types/src/client/api-key.ts`, `controllers/*.controller.ts`, `middleware/api-key-auth.middleware.ts`, `docs/architecture.md:404`                          |
| All lists support `limit`/`cursor`/optional `nextCursor`; an empty page may have a continuation                                                                                                                                                             | `openapi/paths.ts:6`, `openapi/schemas.ts`, `schemas/grants.schema.ts`                                                                                              |
| `paid_external` requires `sourceId`; omitted `endsAt` means permanent access; repeated sources may return `409`; revocation has cascading domain effects                                                                                                    | `openapi/schemas.ts:139`, `openapi/paths.ts:316`, `packages/services/src/trading-bundle/trading-bundle-access.service.ts`                                           |
| `429` uses `{success:false,error:…}`, unlike `ErrorResponse`; current IP and key limits are 240 requests/minute                                                                                                                                             | `apps/web/hono/middleware/rate-limiter.middleware.ts:222`, `openapi/schemas.ts:201`                                                                                 |
| `POST /webhooks/signals/v1/{strategyApiKey}` accepts up to 16 KiB of JSON; actions are `open/update/cancel/close/start/pause/stop/delete`; shared keys return `410`                                                                                         | `apps/webhook/src/lambda.ts`, `docs/autotrading.md:74`                                                                                                              |
| `version` is required and denotes strategy version; timestamp is recognized only as a decimal string, otherwise `Date.now()` is used; `force` is retained only on `open`; the server adds `id` and `apiKey`                                                 | `packages/types/src/signal.ts:280`, `packages/services/src/trading-strategy.service.ts:1148`                                                                        |
| `update.takeProfits`: omission preserves, `[]` clears, non-empty arrays replace; order type is inferred from price/trigger fields                                                                                                                           | `packages/types/src/signal.ts`, `docs/autotrading.md:95`                                                                                                            |
| `204` means enqueue acceptance; IDs depend on the key and original payload; completed jobs are removed, so there is no permanent exactly-once guarantee                                                                                                     | `apps/webhook/src/lambda.ts:188`, `packages/types/src/signal.ts:50`, `packages/types/src/trading/trading-strategy-processing-queue.ts:8`                            |
| The SDK GitHub repository is private, `main` is unprotected, environments are absent; all Actions are allowed without required SHA pinning; default workflow permissions are already `read`, and workflow PR approval is forbidden                          | GitHub API reads of `repos/Vector-Trading/vector-trading-sdk`, `actions/permissions`, `actions/permissions/workflow`, `branches/main`, `environments` on 2026-10-03 |
| The current private-repository rulesets API returned `403`, requiring a paid plan or public visibility                                                                                                                                                      | Read of `repos/Vector-Trading/vector-trading-sdk/rulesets`; this limits verification and does not prove the absence of all possible organization rules              |
| At initial inspection, the SDK contained only the initial commit, README, and MIT license                                                                                                                                                                   | `git worktree list --porcelain`, `git status`, `git log`, `gh api .../contents`                                                                                     |

### Already prepared; do not recreate

Root `AGENTS.md` and `.agents/skills/{sdk-contracts,sdk-clients,sdk-release,pine-signals}/SKILL.md` were created for future work. They explicitly distinguish target paths from existing paths. Do not copy React/FSD, database, or background-trading rules into the SDK.

## Decisions and shared requirements

### Agreed decisions

1. One separate repository with four language packages; Java is excluded.
2. The repository becomes public before the first public release, after content and history review. The user confirmed this during planning. Visibility is not changed now.
3. Ordinary builds and pull requests verify the result; public release runs separately for a release version. All packages are released from one commit.
4. GitHub stores Pine sources and history. No official TradingView publication API has been confirmed; Pine Editor publication is manual. UI automation and internal endpoints are excluded from CI.
5. Tool settings, checks, GitHub configuration, and registries are included in this plan. Planning itself does not authorize implementation or release; an execution request authorizes only selected steps.
6. Repository documentation, plans, README, agent instructions, and skills are written in English. Conversational replies follow the user's language.

### Selected technical approach

The API server owns public semantics; the SDK owns a verified snapshot and derived clients. Canonical export and its evidence are created in the main repository; the SDK receives an archive/files from a specific accepted commit. Generation and ordinary SDK checks work without a neighboring checkout, MongoDB, Redis, or production secrets.

Target directories: `contracts/`, `conformance/`, `generation/`, `scripts/`, `typescript/`, `python/`, `go/`, `rust/`, `pinescript/`. The snapshot includes `contracts/source.json` with repository, commit, contract version, schemas, and SHA-256. Shared SDK version lives in `release/version.json`; package manifests are checked for agreement. These files describe different entities.

OpenAPI Generator `7.25.0` is the verified mechanism for REST and derived signal models; STEP-03 tested four configurations, narrow template overrides, and native codecs before full language packages. Signal JSON Schema describes the safe outgoing subset; complex cross-field checks are proven with fixtures through the server parser. If model generation requires OpenAPI, derive the intermediate document from the same schema rather than creating another manually maintained truth. Commit derived code in clearly marked subdirectories and verify regeneration. Keep handwritten HTTP wrappers, codecs, and convenience methods separately.

The approved runtime dependency policy is owned by [docs/architecture.md](../architecture.md#runtime-dependencies): TypeScript and Go have no external runtime dependencies; Python keeps `httpx` and Pydantic; Rust keeps `reqwest`, `serde`, and `serde_json`. Auxiliary dependencies require actual usage and a compatibility reason. STEP-04–07 must verify the installed package dependency graph; exact probe/development locks do not constrain consumer lockfiles. Java and the generator are development-only tools.

Target channel names: npm `@vector-trading/sdk`, PyPI `vector-trading-sdk` imported as `vector_trading`, crates.io `vector-trading-sdk` imported as `vector_trading_sdk`, and Go `github.com/Vector-Trading/vector-trading-sdk/go`. Use these names locally without claiming they are registered or published. STEP-10 verifies availability and permissions before external setup and release. A conflict requires a user decision and atomic updates to metadata, imports, examples, and documentation; do not silently select another public name.

| Area           | Selected tools and boundaries                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared tooling | Node.js `24.21.0` and pnpm `11.22.0` as the initial compatible base; root `private:true`, pnpm workspace only for TypeScript and shared JS tooling; Prettier for Markdown/JSON/YAML/TypeScript, ESLint for handwritten JS/TS, Vitest for shared tooling; no Turborepo or custom cross-language build framework               |
| TypeScript     | Strict TypeScript, native `fetch`, Vitest, ESLint/Prettier, `tsup` builds with ESM/CJS and `.d.ts`; verify Node.js 22 and 24. The primary REST use case is server-side; browser key storage is unsupported                                                                                                                   |
| Python         | Python minimum 3.12, `uv`, `pyproject.toml`, Hatchling, synchronous `httpx` client and Pydantic models, Ruff lint/format, mypy, pytest; initial Python 3.12/3.14 matrix; include types and `py.typed`                                                                                                                        |
| Go             | Go modules, `net/http`, `context`, standard testing/httptest, `gofmt`, `go vet`, Staticcheck; initial Go 1.26/1.27, minimum 1.26 in `go.mod`; no external runtime dependencies                                                                                                                                               |
| Rust           | Cargo library crate, `serde`/`serde_json`, asynchronous `reqwest` API requiring a Tokio execution context; direct Tokio usage for tests/examples, rustfmt, Clippy, built-in tests, and a local HTTP receiver; stable compiler `1.99.0` and minimum `rust-version` `1.88` verified by STEP-03 generation compatibility checks |
| Contracts      | OpenAPI/JSON Schema validation, named-operation linting, shared fixtures, generation reproducibility; pin tool versions in lock/config files, without `latest` in CI                                                                                                                                                         |
| Pine           | Pine Script v6, manual Pine Editor compilation, shared JSON fixtures; CI must not present ordinary string checks as Pine compilation                                                                                                                                                                                         |
| CI             | GitHub Actions, external Actions pinned by SHA, read-only PR checks, separate publication jobs with exact OIDC trust, one required aggregate check                                                                                                                                                                           |

Pin versions within selected tool families when creating configuration, after checking availability and compatibility. This is ordinary work for the relevant step, not permission to replace the selected architecture. Specify Go toolchain and Rust MSRV independently of SDK version.

Documentation owners: `docs/contracts.md`, `docs/architecture.md`, `docs/development.md`, `docs/releasing.md`. README shows installation, a few examples, and links. `.env.example` contains only placeholders; tests default to localhost without real tokens. Update current server documentation only when its documented public contract changes.

### Shared invariants and verification matrix

Each language package runs applicable `C01–C12`; STEP-02 owns server-semantics proof `C13`. Shared fixtures describe observable input/output, not internal class structure.

| ID  | Observable result                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Import and client construction perform no network/background work; REST keys never enter webhooks or vice versa                                                                                                                                                                                                                                       |
| C02 | All 7 REST operations serialize paths, parameters, bodies, and Authorization headers; dates use ISO 8601, `paid_external` preserves `sourceId`; deletion does not promise narrower semantics than the server                                                                                                                                          |
| C03 | All 8 signals and 4 entry-order types are server-compatible; strategy `version` is required; users need not supply internal `id/apiKey`; invalid TP/SL and non-finite numbers are rejected                                                                                                                                                            |
| C04 | Omitted `takeProfits`, `[]`, non-empty TP, `null`, and invalid types remain distinct; the SDK does not clear targets because a field was omitted                                                                                                                                                                                                      |
| C05 | Message construction produces a decimal string timestamp; repeating one delivery preserves the original message instead of creating a new timestamp. Distinct signals within one millisecond are not guaranteed unique; users may set timestamps explicitly. `force` is available only on `open`; SDK version is not substituted for strategy version |
| C06 | Traversal continues through empty pages with `nextCursor`, ends when it is absent, and preserves filters and cancellation; repeated cursors produce explicit errors                                                                                                                                                                                   |
| C07 | Handle JSON/non-JSON/empty errors, applicable `400/401/403/404/409/410/413/429/5xx`, and `requestId`; keys and sensitive URLs stay out of exceptions/logs/snapshots                                                                                                                                                                                   |
| C08 | Webhook `204` means enqueue acceptance. Timeouts, lost responses, `429`, and `5xx` do not trigger hidden mutation retries; clients do not promise permanent deduplication                                                                                                                                                                             |
| C09 | Timeouts and cancellation bound HTTP operations and close resources; cross-origin redirects do not forward secrets; test HTTP requires explicit local-environment configuration                                                                                                                                                                       |
| C10 | JSON handles Unicode and escaping; message body limits are checked in UTF-8 bytes before sending; optional inputs preserve intent; numbers are not rounded to arbitrary precision                                                                                                                                                                     |
| C11 | Additional optional response fields do not break parsing; incompatible responses produce understandable errors. Snapshots and generated results are reproducible and independent of absolute local paths and build time                                                                                                                               |
| C12 | Built archives install in clean projects; public imports and examples work; license and types are included; secrets/test artifacts/server dependencies are excluded                                                                                                                                                                                   |
| C13 | Canonical server tests prove key/owner/CIDR/revocation permissions, grant variants and `409`, cascading revocation, signal parsing, and webhook acceptance/rejection. A client double is not this proof                                                                                                                                               |

Automatic HTTP retries are disabled by default for every method. A new retry policy requires a specific safe contract; it cannot be inferred from HTTP verbs or `sourceId`. No new persistent server background processes or database schemas are introduced.

### Release and recovery

The first release is `0.1.0`, with immutable shared tag `v0.1.0`; the Go subdirectory also requires `go/v0.1.0` at the same commit. Go major 2 requires `/v2` in the module path. The root Node package is not published.

Run all checks and builds first, then prepare release notes with the commit, versions, contract hashes, artifact hashes, and channel outcomes. Pass artifacts between jobs; do not rebuild from another commit. Verify already-published versions after ambiguous responses; continuation publishes only missing channels. An npm failure after successful PyPI publication is partial success, not overall success or a reason to delete published packages. Fix published code with a new version; do not move public tags.

Pine `.pine` sources and examples are required in GitHub Releases. Publishing an importable TradingView library is optional for the first SDK release because the original request includes Pine backup storage. If manually published, release notes tie the author, library, and numeric version to the SDK commit; otherwise explicitly label `source-only` and provide an embedding example without a fictitious `import`. Running alerts are not updated automatically.

### Implementation readiness and later acceptance conditions

The plan is ready for execution: SDK scope, semantic sources, selected mechanism, change boundaries, ordering, and checks are defined. STEP-01 has no dependencies and is integrated into SDK `main`/`origin/main`; its evidence is below. The first export from an accepted server commit, four-language `oneOf`/optional-field probes, and registry checks are STEP-02, STEP-03, and STEP-10 results, not prerequisites for starting STEP-01. Updating the plan does not prove these checks ran. Overall status is `in-progress` once implementation starts.

Record specific required-check failures, generator incompatibilities requiring architecture changes, public-name conflicts, or unavailable external access in the affected step with the outstanding decision. Dependent steps cannot bypass that boundary. Preserve all acceptance criteria; `ready` means ready to execute the agreed plan, not ready to publish packages.

STEP-02 tests confirmed a discrepancy: the REST section in server `docs/architecture.md` promises strict owner checks for access operations, while `getOwnedBundleForGrantCreation` uses `getMutableBundle`/shared `hasPermission` for `owner_grant`. Actual behavior was preserved: the owner and a foreign expanded role with `bundles:update` may create `owner_grant`; a foreign ordinary role receives `403`, and other creatable grant types require exact ownership. Server documentation was corrected in the accepted STEP-02 commit. Do not silently change permissions or runtime behavior for the SDK. A later requested permission change requires a separate decision; without it, the SDK must not promise stricter permissions than the server.

Missing credentials, registry ownership, and GitHub plan capabilities must not be replaced with fictitious checks. These are external-step execution conditions, not reasons to stop available preparation. Paid services, history rewriting, and production trading tests are not authorized by this plan.

## Dependencies and execution

| Step    | Depends on | Parallelism and reason                                                              |
| ------- | ---------- | ----------------------------------------------------------------------------------- |
| STEP-01 | none       | Shared root and tooling; one owner                                                  |
| STEP-02 | STEP-01    | Separate repository/contract source; must not overlap others' changes               |
| STEP-03 | STEP-02    | Shared schema and generation; one owner                                             |
| STEP-04 | STEP-03    | TypeScript package; may run alongside STEP-05–08 once the shared contract is pinned |
| STEP-05 | STEP-03    | Python package; own configuration and lockfile                                      |
| STEP-06 | STEP-03    | Go package; own module and pinned compiler                                          |
| STEP-07 | STEP-03    | Rust package; own library crate and lockfile                                        |
| STEP-08 | STEP-03    | Pine sources; manual verification separate from language builds                     |
| STEP-09 | STEP-04–08 | Shared CI matrix and consumer checks; one owner                                     |
| STEP-10 | STEP-09    | GitHub/registry settings and public visibility; external actions are sequential     |
| STEP-11 | STEP-10    | Verified release workflow in non-publishing mode                                    |
| STEP-12 | STEP-11    | Actual shared release and external acceptance                                       |

Acceptance order: STEP-01 → STEP-02 → STEP-03 → STEP-04–08 → STEP-09 → STEP-10 → STEP-11 → STEP-12. Parallel implementers modify only their directories; shared `package.json`, `generation/`, `conformance/`, documentation, and the plan have one assigned integration owner. Execute sequentially when delegation is not authorized.

### Running from the SDK project

Open `/Users/vlad.prychodko/Work/askadias/git/vector-trading-sdk` and begin with `$implement-step docs/plans/public-sdk.plan.md STEP-01`. From another working directory, pass the absolute path: `$implement-step /Users/vlad.prychodko/Work/askadias/git/vector-trading-sdk/docs/plans/public-sdk.plan.md STEP-01`. Read the plan and instructions from the SDK; conversation history is not required. Prepared files already exist and need neither recreation nor a preliminary commit for local implementation.

STEP-01 runs entirely in the SDK. STEP-02 has two explicit scopes: canonical export and checks in the server, then the SDK snapshot. Locate the neighboring repository through `Source root`; read its `AGENTS.md` and domain skills before editing. Obtain the snapshot from an exact accepted commit, not arbitrary working-tree state. Separate server delivery is not a prerequisite for starting STEP-01. Once the snapshot exists, SDK generation, ordinary builds, and checks are autonomous; explicitly compare against the server parser for contract updates and Pine verification.

Run later steps with `$implement-step docs/plans/public-sdk.plan.md STEP-XX`. Without an ID, select the next unfinished step, not the whole plan. Read shared requirements, the complete selected step, dependency evidence, and final verification. Check current working trees, recorded commits, instructions, and others' changes; do not create a separate summary. Work in the selected checkout; creating a branch or isolated working tree and Git delivery require execution-task authorization. If isolation is unavailable, preserve others' files and limit changes to selected-step owners.

Each step includes every required change, consumer check, documentation update, and evidence. Statuses: `pending` — unverified; `implemented` — locally verified; `integrated` and `[x]` — accepted into its integration target; `blocked` — a named external boundary. Do not mark an uncommitted checkout as accepted into `main`. Git delivery and external operations require authorization in the execution task. Do not reconfirm the already accepted decision to make the repository public unless circumstances change.

## Steps

### [x] STEP-01 — Shared SDK tooling can be prepared and verified reproducibly

- Implementation status: `integrated`
- Purpose: shared tooling and instructions work from a clean checkout without the neighboring application.
- Depends on: none.
- Owners and skills: SDK root, `sdk-clients`, `sdk-release`; shared development standards.
- Confirmed paths: `README.md`, `LICENSE`, `AGENTS.md`, `.agents/skills/`.
- Expected paths: `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.env.example`, `docs/development.md`, `docs/architecture.md`.

#### Changes and consumers

1. Create a private root shared-tooling package with pinned Node/pnpm and dependencies; configure LF/UTF-8, formatting, and maintained JS/TS script checks. Do not install Git hooks or global tools unnecessarily.
2. `.gitignore` excludes `node_modules`, `.venv`, `__pycache__`, caches, `dist/build`, `target`, coverage reports, local `.env`, keys, and temporary release artifacts. Do not ignore `contracts`, `conformance`, skills, required derived code, lockfiles, or `.env.example`.
3. Document Node/pnpm/uv/Go/Rust installation, target command owners, and the tool matrix. Python/Go/Rust settings belong to their own steps; add root commands with actual implementations, without successful stubs.
4. Add working `pnpm format`, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` for existing shared files. Root README directs users to development status and the plan without promising available packages.

#### Acceptance and checks

- `source ~/.nvm/nvm.sh && nvm use`, `pnpm install --frozen-lockfile`, then `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` work from a clean SDK checkout.
- `git check-ignore` confirms temporary artifacts are ignored and contracts/lockfiles are retained; installation does not modify tracked configuration. Do not add tests merely to match `.gitignore` text.
- Documentation does not present not-yet-working commands as completed; real tooling files contain no secrets or references to internal server packages.

#### Completion Evidence

- Revision / implementation context / integration evidence: local acceptance on `2026-10-03` in the canonical SDK checkout, branch `main`, HEAD `3c83ba25ac0a1e642d0327e23b07b320590e43c6`. No commit or push occurred during initial local acceptance; the user subsequently authorized SDK commit/push separately. Snapshot of 23 source files excluding the plan: SHA-256 `b7608d3fdfad75700065f3daf58aed1058f782f02e14e35ee3c5303ffe276abe` of a sorted compact JSON map from relative path to content SHA-256. The server was neither changed nor required for checks.
- Integration evidence: commit `3cd3f75e146de2001826f710a4c9f750a8f9b4de` contains verified STEP-01 work and current STEP-02 documentation; `git push origin main` succeeded, and `git ls-remote --heads origin main` confirmed the same SHA. Before commit, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `git diff --check`, and index-content review passed again. Delivery excludes the server repository and package publication.
- Changed artifacts / verification: created `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `docs/development.md`, `docs/architecture.md`; updated `README.md` and this plan. At STEP-01, Prettier changed only YAML `description` quoting in four `.agents/skills/*/SKILL.md` files; instruction content was preserved, and `AGENTS.md`/`LICENSE` were unchanged.
- Tests and checks: Node.js `24.21.0`, pnpm `11.22.0`; `pnpm format`, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` passed in the SDK. In clean `/private/tmp/vector-sdk-step01-sc6_40oh/source`, without `node_modules`, cache, or the neighboring application, `source ~/.nvm/nvm.sh && nvm use`, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` passed. pnpm was downloaded through Corepack into temporary storage and invoked with its pinned executable; no global installation occurred. Hashes of all 24 source files matched before and after installation/checks.
- Additional checks: `git check-ignore --no-index` confirmed 24 excluded paths and 14 retained paths, including contracts, fixtures, skills, derived code, lockfiles, and `.env.example`. All 24 files passed UTF-8, LF, and trailing-newline checks; `git check-attr` confirmed LF, current local documentation links resolved, and `git diff --check` passed. Configuration contains no secrets, internal server dependencies, or successful language-check stubs.
- Deviations / openings: also created `tsconfig.json`, required for real `typecheck`. pnpm 11 settings reside in `pnpm-workspace.yaml`; the local store and disabled global virtual store give CI and ordinary installations the same structure. Checks do not install dependencies implicitly (`verifyDepsBeforeRun: error`). Dependency versions stay within agreed families; ESLint `10.11.0` requires no release-age exception. Tests, builds, `pnpm verify`, language configuration, and external integration remain later-step results.
- Blocker: none; STEP-01 local acceptance and delivery to `main`/`origin/main` are confirmed.

### [x] STEP-02 — The server owner exports the public contract with runtime behavior verified

- Implementation status: `integrated`
- Purpose: avoid a second source of truth and incorrect SDK documentation.
- Depends on: STEP-01.
- Owners and skills: main server repository and its `server-boundaries`, `trust-boundaries`, `autotrading-flow`, `refactoring-boundaries`, `development-standards`; SDK `sdk-contracts`.
- Confirmed paths: server `rest-api/openapi/*`, `rest-api/schemas/*`, `rest-api/controllers/*`, `packages/types/src/signal.ts` and tests, `apps/webhook/src/lambda.ts`, `packages/services/src/trading-bundle/trading-bundle-access.service.ts` and tests.
- Expected paths: named export in main-repository `scripts/`, canonical outgoing signal schema with the public owner; SDK `contracts/{rest.openapi.json,signals.schema.json,source.json}`, `conformance/{rest,signals}/`, `docs/contracts.md`.

#### Changes and consumers

1. Use server `main` from metadata as the accepted base; if updated, first compare affected public files and update evidence. Exclude local `PnLAmount.tsx` and unrelated changes. Follow server instructions in the selected checkout or a separately authorized isolated checkout. Add stable `operationId`, complete actual errors, key permissions, and pagination without changing API paths or runtime semantics. Relative server addresses are allowed with required working client base URL configuration.
2. Define external signal payload separately from internal events at the signal owner. Preserve current behavior; create a safe outgoing-subset schema and fixtures, including eight actions and TP patch semantics. Do not expand the public webhook with generator-driven fields.
3. Verify C13 through real server rules and correct documentation discrepancies with evidence. Prove owner/expanded-role `owner_grant` scenarios; permission changes require a separate decision and are not part of declarative export.
4. Create deterministic specification/fixture export without importing server packages into the distributed SDK. Record an accepted server commit and hashes in the snapshot; do not present dirty working-tree artifacts as an accepted commit.
5. Update affected server documentation and SDK `docs/contracts.md`; migrations, database changes, and deployment changes are excluded. Public server document routes and sitemap remain unchanged.

#### Acceptance and checks

- Two exports produce identical bytes/hashes; all 7 REST operations and 8 signals are present; `source.json` points to an actually accepted commit.
- Targeted server schema/route/signal tests and applicable C13 pass; invalid JSON, oversized bodies, revoked keys, and invalid key/CIDR/owner permissions never become successful SDK fixtures.
- After formatting, run server `pnpm typecheck` and `pnpm lint` under its `AGENTS.md`; inspect the diff after lint. Accept work separately into the server target, then into the SDK as a snapshot.

#### Completion Evidence

- Revision / implementation context: SDK canonical checkout on `main`, HEAD `d2204e25b76b223b2fcbecd4f6ffccb7a6eccf48`. The user separately authorized finishing STEP-02 and accepting a server-only commit into `main`. Server commit `e51366b859926abd5bdc222a5249e99f8080f0f8` (`[VT-000] Export verified public SDK contracts`) has parent `be43459ba348d5dd852269f51a0897fb54668238` and exactly 19 STEP-02 files/owned hunks. No branches or additional checkouts were created; no server push was performed.
- Integration evidence: server work is accepted into local server `main` at `e51366b859926abd5bdc222a5249e99f8080f0f8`. SDK commit `61fc73b860d4b77c15c7192e1d54bd48dfb2fe89` is accepted into local SDK `main` and contains the verified five-file snapshot (`status: committed`, `contractVersion: 1.0.0`) and current English documentation. STEP-02 is `integrated` into its local targets. Push to either repository was not part of this delivery; no remote integration is claimed.
- Changed artifacts (server): `apps/web/hono/routes/rest-api/openapi/{paths.ts,schemas.ts,conformance.spec.ts}`, `rest-api/{conformance.json,rest-api.router.spec.ts}`, `apps/webhook/src/lambda.conformance.spec.ts`, `packages/types/src/{index.ts,signal-payload.ts,signal.schema.ts,signal.conformance.json,signal.conformance.spec.ts}`, `account-api-key.service`/`trading-bundle-access.service` tests, `scripts/export-public-sdk.{mjs,spec.mjs}`, root `package.json`/`pnpm-lock.yaml`, and domain `docs/architecture.md`/`docs/autotrading.md`. Added already transitively pinned `ajv@6.15.0` as a direct validation tool; lockfile changes are only three root-dependency lines.
- Changed artifacts (SDK): `contracts/{rest.openapi.json,signals.schema.json,source.json}`, `conformance/{rest,signals}/cases.json`, `docs/contracts.md`, `docs/architecture.md`, `docs/development.md`, `README.md`, current-state navigation in `AGENTS.md`, this plan, and `.prettierignore` exclusions preserving canonical JSON bytes. Existing English translations of documentation/skills and the unrelated local IDE file were preserved.
- Proven behavior: seven unique REST `operationId` values, key permissions, alternate `429` errors, strict access-creation input, and opaque pagination; outgoing `StrategySignalPayload` and eight-action JSON Schema. The 19 canonical REST fixtures run through real Zod schemas and routes, including exact error bodies; 40 signal fixtures run through the real parser and webhook handler. Separately proven: owner/expanded-role `owner_grant` permissions, foreign expanded-role rejection for other grant types, CIDR, key revocation, `409`, cascading revocation, JSON/size errors, and enqueue acceptance. Server routes, parsers, permissions, and trading execution were unchanged.
- Tests and checks (server): repeated on the isolated 19-file change set in existing `main` before commit: Prettier check passed on all 18 formatter-owned files; 389 tests passed in 11 targeted suites (`packages/types` 105; REST router/OpenAPI/body/request validation 98; webhook 54; account API key service/DAO and bundle access service 132). `pnpm sdk:export:test` passed 3 tests; root `pnpm typecheck` passed all seven tasks and root `pnpm lint` passed all six tasks. Post-lint diff exactly matched the reviewed STEP-02 patch, with all 187 source hashes unchanged. Earlier preparation checks, including rejection of uncommitted canonical export, also passed.
- Export verification: two normal exports from the accepted server commit into fresh temporary directories produced identical five-file output. Every artifact hash was verified; all 187 input hashes matched `git show` content at the accepted commit. The four exported artifacts matched the previously tested preview byte for byte. All five files were copied into the SDK without reformatting and compared with the accepted export. REST OpenAPI SHA-256: `ec1223b066cbfd97fefc57b23eced19eeef14a40642b64b7417f1215c369feea`; signals: `05d628e553082bbc524e70890c4b6a58ba842fceb278d5299d35d74d30b8a78d`.
- Tests and checks (SDK): after documentation formatting, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` pass. Snapshot JSON, source/fixture inventory, hashes, provenance, local documentation links, English text, and `git diff --check` were verified. `pnpm verify` does not exist yet (STEP-09), and is not claimed successful. Language packages, Pine consumers, and generation are absent; server tests do not substitute for their acceptance.
- Deviations / preservation: the prepared server changes had been included in a parallel demo commit. Only SDK paths and owned documentation hunks were transferred into server `main`; its unrelated branch/commit remained intact. A new unrelated home-demo documentation edit appeared after the server commit and was preserved on `main`, so the original branch was not restored across overlapping changes. Migrations, deployment, public document routes, and sitemap were untouched. SDK documents and skills remain English.
- Blocker / exact remainder: none for STEP-02 implementation or local integration. Remote delivery is separate from the user-authorized local commit. No package publication was performed.

### [x] STEP-03 — Four-language generation is reproducible and preserves transport semantics

- Implementation status: `integrated`
- Purpose: verify the riskiest mechanism before implementing full packages.
- Depends on: STEP-02.
- Owners and skills: shared generation pipeline, `sdk-contracts`, `sdk-clients`.
- Confirmed paths: STEP-01/02 results.
- Expected paths: `generation/{typescript,python,go,rust}.yaml`, OpenAPI Generator pin, necessary narrow templates, `scripts/{generate,check-generated,check-contracts}.*`, shared-tooling tests, `docs/architecture.md`.

#### Changes and consumers

1. Pin generator version and execution method with checksum/digest. If using a Java-based CLI, Java is only a local/CI tooling dependency; do not add a Java SDK. Do not require a separate generation server.
2. Generate and compile trial clients for all four languages in temporary storage. Check `CreateGrantRequest.oneOf`, dates, Bearer authentication, signal unions, and optional-field models against actual fixtures.
3. Prove omitted TP versus empty arrays in Go/Rust, Python optional/`None`, TypeScript `undefined`, and string timestamp behavior. Fix shared generation issues in schema/config/template instead of creating four unrelated handwritten rule copies.
4. Select and pin verified Rust MSRV/toolchain and each language's generation requirements; document derived versus handwritten files. Add working `pnpm contracts:check`, `pnpm generate`, and `pnpm generated:check`.
5. If the selected generator cannot preserve required semantics after narrow configuration, record evidence and compare a small alternative generator/handwritten transport models; approve architecture replacement before STEP-04–08. Do not expand into a custom transpiler.

#### Acceptance and checks

- C03–C05 and C11 pass on trial models; C02 is verified for `oneOf` and dates. Four compilations provide real evidence, not just successful generation CLI output.
- Regeneration leaves files unchanged; schema/configuration changes are detected by `generated:check`; checks run without the source server checkout or live services.
- Probes do not remain as public packages or duplicate entry points; remove temporary artifacts. Record the generation decision in `docs/architecture.md`.

#### Completion Evidence

- Revision / implementation context: canonical SDK checkout on `main`, HEAD `d2204e25b76b223b2fcbecd4f6ffccb7a6eccf48`. STEP-02 prerequisite was reverified from the five-file snapshot at accepted server commit `e51366b859926abd5bdc222a5249e99f8080f0f8`, contract version `1.0.0`; all artifact hashes remain unchanged. Server checkout, routes, and schemas were not modified during STEP-03. No branches, commits, pushes, or public packages were created.
- Integration evidence: SDK commit `61fc73b860d4b77c15c7192e1d54bd48dfb2fe89` is accepted into local `main`; STEP-03 is `integrated` into that target. All 16 committed input hashes and 154 committed output hashes were reverified through `git show`; the manifest plus outputs contain 155 derived files. Manifest SHA-256: `cc056bd3001a42ef10f1191fc05f20139711702fd7900707f24abd99ce0d25f0`. Latest four-language native probes, five shared regression tests, reproducible generation, formatting, typechecking, and linting passed before this delivery. Push to `origin/main` remains outside the current commit-only request. STEP-04–08 prerequisites are satisfied.
- Changed artifacts: `generation/generator.json`, four language YAML configurations, `generation/template-patches.json`, `generation/toolchains.json`, internal `generation/generated/` sources/specification/manifest, handwritten native probe sources and pinned Go/Python/Rust dependency inputs under `generation/probes/`; `scripts/{generation,generate,check-generated,check-contracts,setup-generation,probe-generation}.ts`, `scripts/contracts.test.ts`, root scripts/dependencies/lockfile, `tsconfig.json`, current-state navigation in `AGENTS.md`, README, architecture/development guides, and this plan. Separately requested IDE exclusions were added to `.gitignore`; the local `.iml` file was preserved and is now ignored. Existing English translations and other earlier work were retained.
- Runtime dependency follow-up (2026-10-03): the approved policy is documented in `docs/architecture.md#runtime-dependencies` and reflected in STEP-04–07 requirements. Go generated imports already used only the standard library; removed the stale `validator.v2` probe requirement and `go.sum`. The probe now rejects external modules and requires the pinned Go binary with `GOTOOLCHAIN=local`, `GOPROXY=off`, and `GOSUMDB=off`. Removed the unused Rust `serde_repr` declaration through an eighth pinned template override and removed only that crate from the probe lock, preserving every other locked package version. Regeneration and all 16 input/154 output hashes were verified; the canonical snapshot remains unchanged. Five shared tests passed, and the updated full native probe passed on TypeScript, Python 3.12.9, Go 1.26.0, Rust 1.99.0, and Rust MSRV 1.88.0. Rust localhost HTTP checks ran with the required sandbox permission; no live services or credentials were used. Public package steps remain pending; no commit or push was performed.
- Generator decision: retained OpenAPI Generator `7.25.0`, Java CLI executed under Corretto `11.0.24`. Maven's published SHA-1 matched the downloaded JAR; SHA-256 `41ce4f6b07f196676439d710759fa1ced7a08066d06ff1bf314681470289efae` is pinned and checked before each generation. Download is an explicit `generation:setup`; no global generator installation or separate server is needed. `unzip` extracts only the eight pinned upstream templates that receive narrow, unique-match overrides.
- Verified corrections: the initial generator dropped shared grant fields from `oneOf` branches; the shared derived schema now distributes them into named variants without changing the canonical snapshot. Default Go number models used `float32`, and enum constants collided; double-precision mapping and enum prefixes fixed this. Go unions use disjoint action/grant discriminators. Strict TypeScript optional-property errors were fixed in model/runtime templates. Python omission/explicit `None` handling and finite values were corrected without breaking valid assignment. Rust's tagged wrapper consumed the wire discriminator before branch deserialization; an untagged-template override preserves the branch enums and fields. Non-nullable optional Rust fields reject explicit nulls, and numeric serializers reject non-finite values. No alternative generator or architecture replacement was necessary.
- Native acceptance: the final `pnpm generation:probe` passed with Node.js `24.21.0`/TypeScript `6.0.3`, Python `3.12.9`, Go `1.26.0`, Rust stable `1.99.0`, and independently installed/tested MSRV `1.88.0`. All four full generated source trees compiled; Rust compiled and ran at both versions. Each codec round-tripped the same 17 schema-and-parser-valid signal fixtures, covering all eight actions/four order types and TP patch cases, and all four creatable grant variants. Probes checked ISO dates, required external `sourceId`, positive strategy-version fixtures, preserved string timestamps, omitted versus empty TP, explicit null/None rejection, non-finite rejection, and an actual generated Bearer request. TS/Python/Go used HTTP doubles; Rust used a localhost server with a synthetic token. Python also tested omission, empty TP construction, explicit `None`, and valid field assignment. Rust numeric equality treats `1` and `1.0` as the same JSON number while retaining double precision; no arbitrary rounding was added.
- Shared checks: `pnpm contracts:check` verifies accepted-source metadata, artifact hashes, seven REST operations, 19 REST fixtures, and all 40 signal schema outcomes. Five regression tests passed: signal projection preserves every fixture outcome; grant union retains common fields/requiredness/null/strict-object behavior; altered artifact bytes and preview provenance fail; changed configuration provenance fails even with unchanged model bytes; stale derived code fails without modifying the canonical tree. `pnpm generated:check` reproduced every filename and byte; formatting, root `pnpm typecheck`, `pnpm lint`, local documentation links, snapshot/input/output hashes, English documentation, IDE exclusions, and `git diff --check` passed. Native probe sources were formatted with Prettier, Ruff `0.13.0`, Go `gofmt`, and rustfmt `1.99.0`. `pnpm verify` remains absent until STEP-09 and is not reported successful.
- Boundaries / deviations: generated trial trees contain internal source only, with no public package manifests or SDK entry point. The probe harness creates and removes temporary native projects; preliminary trial projects were also removed. Generation/checks use the pinned SDK snapshot and need neither the neighboring checkout nor live services. Schema-valid but parser-invalid price/TP/SL cases retain their separate recorded outcomes; complete business validation and C01–C12 package acceptance remain the agreed STEP-04–07 builder responsibility, with STEP-02 C13 proof unchanged. Public Python remains planned as synchronous httpx; the internal generated HTTP probe is not an additional public transport mode. Documentation and skills remain English. Native tools were prepared only in isolated temporary caches, with no persistent PATH/profile changes.
- Commit review: 197 SDK files were committed, including all intended snapshot/generation/tooling files and earlier English translations. Caches, environments, archives, and IDE files were excluded. Staged whitespace checks passed for handwritten files; the pinned raw generated tree retains upstream trailing whitespace and blank lines at EOF, with exact committed-byte reproduction verified instead of manual edits.
- Blocker / exact remainder: none for STEP-03 local implementation or integration. Remote Git delivery, public language packages, Pine consumers, CI, and release remain separate work. STEP-04–08 are ready to execute against the committed local result.

### [ ] STEP-04 — The JavaScript/TypeScript package installs and covers the entire public API

- Implementation status: `pending`
- Purpose: one npm package for JavaScript and TypeScript with safe server-side key use.
- Depends on: STEP-03.
- Owners and skills: `typescript/`, `sdk-clients`, `sdk-contracts`, packaging `sdk-release`.
- Confirmed paths: shared contract, fixtures, and STEP-03 generation settings.
- Expected paths: `typescript/{package.json,tsconfig.json,tsup.config.ts,src/,tests/,examples/,README.md}`, root workspace/lockfile, and package commands.

#### Changes and consumers

1. Create one package with verified ESM/CJS exports, `.d.ts`, a `files` allowlist, MIT license, and repository metadata. Separate generated code from handwritten `RestClient`, `SignalsClient`, and builders; pin exact idiomatic naming through examples.
2. Implement 7 REST methods, optional cancellable page traversal, 8 signal builders, and delivery of prepared messages. Clients receive server address, credentials, timeout, and configurable `fetch`; never substitute strategy keys for account keys.
3. Implement normalized safe errors, timeout/AbortSignal handling, and correct absence of automatic retries. Public signal construction works offline; metadata is fixed before sending.
4. Configure strict typechecking, ESLint/Prettier, Vitest, and real local-server HTTP exchange tests. Add `pnpm test:typescript` and `pnpm build:typescript`; the shared owner incorporates them into root lint/typecheck without overlapping parallel changes.
5. Examples show server-side REST, signals, TP updates, and errors; npm usage is independent of the neighboring server repository.

#### Acceptance and checks

- C01–C12 pass; working public examples compile. `pnpm --dir typescript typecheck`, `lint`, `test`, and `build` finish after formatting.
- `pnpm --dir typescript pack` creates an archive; clean JavaScript CJS, JavaScript ESM, and TypeScript consumers install it and call local-server methods on Node 22/24.
- Archive inspection confirms types, license, and absence of internal server imports; root README does not yet claim actual npm publication.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including archive and consumer imports; deviations and openings: none.
- Blocker: none.

### [ ] STEP-05 — The typed Python package installs and preserves the shared contract

- Implementation status: `pending`
- Purpose: idiomatic Python integration with equivalent coverage and transport semantics.
- Depends on: STEP-03.
- Owners and skills: `python/`, `sdk-clients`, `sdk-contracts`, `sdk-release`.
- Confirmed paths: shared contract and STEP-03 generation pipeline.
- Expected paths: `python/{pyproject.toml,uv.lock,.python-version,src/vector_trading/,tests/,examples/,README.md}`, `py.typed`, and package root commands.

#### Changes and consumers

1. Create a Hatchling package; pin development dependencies and uv/Ruff/mypy/pytest settings without constraining runtime dependencies to the consumer's lockfile. Follow the runtime dependency policy: keep `httpx` and Pydantic, and review generator-specific direct dependencies (`python-dateutil`, `typing-extensions`) against actual usage and Python 3.12+ facilities. The synchronous `httpx.Client` has explicit lifecycle/context-manager support; no additional async wrappers in the first release.
2. Implement public REST/signal APIs and shared fixtures; preserve unset versus `None`, empty TP lists, ISO dates, and string timestamps. Do not dump omitted model fields as `null`.
3. Implement errors, bounded timeouts, traversal stopping, and HTTP-resource cleanup; retries are disabled. Retain auxiliary dependencies only when the verified generated implementation needs them; do not confuse direct requirements with dependencies pulled in transitively by `httpx` or Pydantic.
4. Add types, `py.typed`, examples, and wheel/sdist contents; root `pnpm test:python`/`build:python` delegate to native tools rather than replacing them with JS tests.

#### Acceptance and checks

- In `python/`: `uv sync --locked`, `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy src`, `uv run pytest`, `uv build`.
- C01–C12 and examples are verified on Python 3.12/3.14; wheel and sdist are installed separately in clean environments without editable installs; `vector_trading` imports and actual local-server HTTP exchange work.
- Wheel includes license and types; dependencies resolve for clean consumers; ordinary checks do not change `uv.lock`. Inspect installed metadata and the dependency graph against the approved policy; justify each auxiliary direct requirement.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including wheel/sdist; deviations and openings: none.
- Blocker: none.

### [ ] STEP-06 — The Go subdirectory module imports and preserves signal intent

- Implementation status: `pending`
- Purpose: Go consumers import an ordinary module and receive a cancellable HTTP API.
- Depends on: STEP-03.
- Owners and skills: `go/`, `sdk-clients`, `sdk-contracts`, `sdk-release`.
- Confirmed paths: shared contract and STEP-03 generation pipeline.
- Expected paths: `go/{go.mod,*.go,*_test.go,examples/,README.md}`, Staticcheck pin, and package root commands.

#### Changes and consumers

1. Create library module `github.com/Vector-Trading/vector-trading-sdk/go`, minimum Go 1.26, explicit `http.Client`, and `context.Context` methods. The complete runtime remains standard-library based, including model validation; do not add third-party validators or HTTP libraries.
2. Implement the complete REST/signal API; optional TP must distinguish omission from empty arrays. Do not rely on ordinary slice `omitempty` without C04 proof. Do not introduce server semantics to accommodate Go zero values.
3. Add errors, timeout/cancellation, HTTP response-body cleanup, and safe redirects; pagination preserves cancellation context and filters. Pin Staticcheck and add gofmt/vet/standard tests and examples.
4. Document subdirectory tags and the future `/v2` change; root `pnpm test:go`/`build:go` use native checks. Do not create a placeholder `go.sum`; this library has no external runtime dependencies. Keep any third-party development tools outside the consumer module dependency graph.

#### Acceptance and checks

- In `go/`: `gofmt` with no-diff verification, `go vet ./...`, pinned `staticcheck ./...`, `go test -race ./...`, `go build ./...`; C01–C12 on Go 1.26/1.27.
- A clean consumer module compiles the public example through a temporary local module proxy/archive with the same module path; a working-tree `replace` is not the only packaging check. STEP-12 confirms actual GitHub/proxy imports.
- `go mod tidy` leaves no diff; `go list -m all` reports only the main module, and package/tests compile with module downloads disabled after toolchain preparation. Go arrays serialize as omitted fields/`[]`/non-empty arrays exactly according to fixtures.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including module archive; deviations and openings: none.
- Blocker: none.

### [ ] STEP-07 — The Rust library installs as a crate and supports the entire API

- Implementation status: `pending`
- Purpose: Rust consumers receive a typed asynchronous API without serialization differences.
- Depends on: STEP-03.
- Owners and skills: `rust/`, `sdk-clients`, `sdk-contracts`, `sdk-release`.
- Confirmed paths: shared contract and generation pipeline, STEP-03 Rust MSRV/toolchain.
- Expected paths: `rust/{Cargo.toml,Cargo.lock,rust-toolchain.toml,src/,tests/,examples/,README.md}`, and package root commands.

#### Changes and consumers

1. Create a library crate with pinned stable compiler, `rust-version`, crate metadata, and MIT license. Follow the runtime dependency policy: keep `serde`, `serde_json`, and asynchronous `reqwest`; retain auxiliary crates only where actually needed. The transport requires a Tokio execution context; direct Tokio/local HTTP-test dependencies serve tests and examples in their appropriate categories.
2. Implement REST/signal APIs, errors, bounded/cancellable async waiting, and a managed HTTP client. `Option` serialization preserves omission, `Some(vec![])`, and non-empty arrays; `None` is not emitted as `null`.
3. Check serde tagged unions and `oneOf` against actual JSON; enum/response compatibility must not depend on accidental generator shape. Add doctests, examples, fmt/Clippy, and root `pnpm test:rust`/`build:rust`.
4. Check features and `Cargo.lock` for reproducible development; consumers resolve dependencies through their own manifest/lock rather than requiring the library checkout's lockfile. Review `cargo tree` and enabled features; remove unused direct crates and unnecessary features without replacing maintained HTTP/TLS or JSON implementations.

#### Acceptance and checks

- In `rust/`: `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo test --locked --all-features`, `cargo build --locked`, `cargo package --locked`.
- C01–C12, examples, and doctests pass on the selected MSRV and pinned stable compiler. A clean consumer installs/builds the `.crate` archive through a local registry or source archive without importing working `src`; `cargo publish --dry-run --locked` does not publish.
- MIT and source metadata are included; archives exclude secret fixtures and server dependencies; actual HTTP request bytes prove TP omission/emptiness behavior.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including `.crate`; deviations and openings: none.
- Blocker: none.

### [ ] STEP-08 — Pine sources build compatible JSON and are verified in TradingView

- Implementation status: `pending`
- Purpose: back up Pine code and provide convenient TradingView signal integration.
- Depends on: STEP-03.
- Owners and skills: `pinescript/`, `pine-signals`, `sdk-contracts`.
- Confirmed paths: STEP-02/03 signal contract and fixtures.
- Expected paths: `pinescript/VectorTrading.pine`, `pinescript/examples/`, `pinescript/README.md`, `docs/contracts.md`, and owner-maintained compilation/compatibility evidence.

#### Changes and consumers

1. Create a Pine v6 library for JSON construction for all eight actions; alert conditions/frequency remain in user examples. Do not include account or strategy keys in public sources/payloads.
2. Implement safe escaping and numeric representation, string timestamp, strategy version, omitted/clear/replace TP, rejection of `na` and invalid TP/SL; `force` only on `open`.
3. Provide an unpublished local/embedded example usable as source-only without a nonexistent import. A real import with a numeric Pine version may be added after separately authorized publication.
4. Document manual compilation/publication, webhook URL and alert configuration, import updates, and recreation of running alerts. CI checks files/fixtures but does not promise official headless compilation.

#### Acceptance and checks

- Library and example actually compile in Pine Editor; evidence includes date, source commit, Pine version, and result. Without Editor access, mark that specific check incomplete instead of substituting regex/JavaScript codecs.
- JSON produced by Pine itself for C03–C05/C10 passes canonical schema and the real server parser without trading effects. Prices retain required precision and string fields are escaped.
- Examples create no hidden extra signals; README distinguishes source archives from published libraries. TradingView publication is not required to accept this step.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including actual Pine Editor verification; deviations and openings: none.
- Blocker: none; Editor access is required at verification time.

### [ ] STEP-09 — CI verifies the entire SDK and package installation without secrets

- Implementation status: `pending`
- Purpose: consistent clean-environment acceptance suitable for protecting `main`.
- Depends on: STEP-04–08.
- Owners and skills: shared CI and conformance, `sdk-release`, `sdk-contracts`, `sdk-clients`, Pine checks `pine-signals`.
- Confirmed paths: implemented language configurations and commands.
- Expected paths: `.github/workflows/ci.yml`, `.github/dependabot.yml`, shared `conformance/` tests, `scripts/check-*`, `docs/development.md`, and final root commands.

#### Changes and consumers

1. Add real CI jobs for contracts/generation, every language, package consumers, and documentation; pin toolchains, dependency locks, and Actions SHAs. Use native tools directly; JS does not imitate compilation of other languages.
2. Fork PRs run without publishing secrets or `id-token:write`; cancel obsolete CI runs for the same PR, isolate local HTTP tests, and restore environment variables/timers/servers in cleanup. Add finite timeouts and bounded artifact retention.
3. Create stable aggregate check `sdk-ci` that verifies all required jobs and cannot succeed through a skipped/failed matrix. Shared contract changes verify all four languages and Pine fixtures; do not use path filters that bypass the required matrix.
4. Add Dependabot for npm/pip/cargo/GitHub Actions and supported Go updates according to current capabilities; document maintenance for unsupported sources rather than leaving knowingly invalid configuration. Do not add automatic dependency-update merges.
5. Complete root `pnpm test`, `pnpm build`, `pnpm verify`: format-check → lint/typecheck → contracts/generation → native tests → build/packaging verification. Missing languages fail rather than silently skip. README and development documentation show real commands.

#### Acceptance and checks

- `pnpm verify` passes from a clean SDK checkout without the neighboring checkout/services/credentials; a GitHub Actions run has green `sdk-ci` and every expected child job.
- A controlled language failure or generation mismatch fails the aggregate check; fork PRs cannot publish; tests finish without open HTTP servers or hidden retries.
- Clean consumers verify npm/wheel/sdist/module/crate artifacts. Pine compilation evidence matches the pinned source; automated execution of that check is not claimed.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including CI URL and intentional failing-run verification; deviations and openings: none.
- Blocker: none.

### [ ] STEP-10 — GitHub and distribution permissions are ready for the public SDK

- Implementation status: `pending`
- Purpose: the first release has real channels, a protected main branch, and confirmed ownership.
- Depends on: STEP-09.
- Owners and skills: GitHub/registry settings and documentation, `sdk-release`.
- Confirmed paths/resources: GitHub `Vector-Trading/vector-trading-sdk`, current settings in the facts section, green `sdk-ci`.
- Expected paths: `.github/{pull_request_template.md,ISSUE_TEMPLATE/,CODEOWNERS}`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/releasing.md`; remote repository/settings, `release` environment, registry ownership/trust.

#### Changes and consumers

1. Review content and history before opening the repository; export sources contain only public DTOs/fixtures. Save previous settings and perform the agreed change to public visibility. Complete available read-only checks before external mutations.
2. Configure description/topics/homepage only against existing documentation; keep wiki disabled. Select squash merge and branch deletion after merging; do not change organization roles or paid plans. Configure `main` protection once `sdk-ci` exists: PRs, passing checks, no force pushes/deletion, bypass only for confirmed recovery maintainers. Reviews must not make solo work impossible: initially 0 required approvals; CODEOWNERS includes an actually verified owner.
3. Preserve default read-only Actions permissions and the ban on workflow PR approval; restrict Actions to actually used publisher/setup tools and SHA pinning where available. Do not weaken organization policy for workflows.
4. Create `release` environment, restrict permitted refs, and select an existing release owner; do not invent a required second reviewer. Use authorized manual publishing and available environment protections. Enable available free security/dependency alerts; paid features require a separate decision.
5. Verify/pin npm/PyPI/crates.io names, Vector Trading permissions, and the case-sensitive Go module path; prepare OIDC trust for the exact workflow/environment. If initial package creation cannot happen beforehand, document STEP-12 bootstrapping without bypassing rules. An absent search result does not prove ownership.
6. Add concise contribution/security/PR/issue instructions, supported environments, and security-reporting channels. Do not publish fictitious contacts or send unsolicited user/team invitations.

#### Acceptance and checks

- GitHub API confirms public visibility, actual merge/settings/permissions/environment, and ruleset availability after visibility changes; a new PR passes required `sdk-ci`; ordinary force pushes and main-branch deletion are confirmed blocked.
- Registry names/permissions and trust settings are confirmed through actual configuration without exposing tokens. Name conflicts/missing permissions stop only the affected external work and record a concrete decision.
- Before/after settings, exact identifiers, and feature limitations are recorded. Restoring settings does not restore confidentiality of already-public code.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending; record remote before/after state and account ownership separately.
- Changed artifacts / verification: pending; deviations and openings: none.
- Blocker: not established yet; confirm registry ownership and names before external changes.

### [ ] STEP-11 — Release builds verified artifacts and recovers from partial success

- Implementation status: `pending`
- Purpose: publication behaves predictably before the first immutable external release.
- Depends on: STEP-10.
- Owners and skills: shared release pipeline, `sdk-release`, `sdk-contracts`.
- Confirmed paths: STEP-10 GitHub/registries, STEP-09 full CI.
- Expected paths: `.github/workflows/release.yml`, `release/version.json`, preparation/version/manifest verification scripts, release-scenario tests, `docs/releasing.md`.

#### Changes and consumers

1. Create `workflow_dispatch` with verified version/tag and prepare/publish/resume modes. Publish only an authorized immutable `main` commit with successful CI, aligned package versions, and verified contract provenance. Ordinary builds/PRs publish nothing.
2. Preparation builds and verifies all packages before publication, recording versions, contract hashes, artifact hashes, and Pine sources; the same release reuses artifacts without rebuilding from another state.
3. Separate npm/PyPI/crates.io publishing jobs and Go ref creation/verification; use minimal OIDC permissions and specific trusted Actions. Explicitly isolate registry-required first-publication bootstrapping without leaving a persistent broadly privileged token.
4. Store verifiable channel outcomes separately from the original immutable artifact manifest. Read registry state after timeouts; retry only missing channels. Block concurrent releases of the same version; do not cancel started publication as an obsolete PR run.
5. Shared GitHub Releases show actual statuses and do not claim full success before complete acceptance. Pine `source-only` includes source and example; manually published libraries have actual author/library/version mappings.
6. Document bootstrapping, release, resume, version updates, registry checks, rollback limits, and local-setting recovery. Do not include auto-unpublish or tag rewriting.

#### Acceptance and checks

- Dry runs create artifacts/manifests and verify clean consumers without creating remote tags/releases, publishing, or receiving publication secrets.
- Local registry doubles prove: one successful channel plus another failure yields partial success; an unknown response after confirmed upload does not duplicate publication; resume skips confirmed channels; mismatched hash/version/commit is rejected.
- A real GitHub Actions prepare run succeeds and is tied to a specific commit. Only relevant publishing jobs have OIDC permissions; external PRs/arbitrary Git revisions cannot reach publication.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending.
- Changed artifacts / verification: pending, including prepare run and failure scenarios; deviations and openings: none.
- Blocker: none after STEP-10 confirmation.

### [ ] STEP-12 — The first shared release installs from actual public channels

- Implementation status: `pending`
- Purpose: users can import the SDK with each language's ordinary tools.
- Depends on: STEP-11.
- Owners and skills: shared release and acceptance, `sdk-release`, language consumers `sdk-clients`; separately executed Pine publication uses `pine-signals`.
- Confirmed paths/resources: prepared release workflow, confirmed registry accounts, artifacts, contract provenance, and CI.
- Expected resources: `v0.1.0` and `go/v0.1.0` at one commit, GitHub Release, npm/PyPI/crates.io versions, public Go module; final README/guides and release confirmations.

#### Changes and consumers

1. In a task authorizing actual release, pin the final accepted commit, verify full CI and absence of private artifacts. Create immutable refs and publish `0.1.0` through selected channels. If needed, perform only documented authorized bootstrapping, then confirm OIDC and remove temporary credentials.
2. Verify every external channel and version/commit/manifest. Preserve evidence after partial success; safely resume only missing publications without silently changing artifacts or version.
3. Install from actual npm/PyPI/crates.io/Go proxy into clean consumer projects; use public methods to check localhost REST/webhook fixtures. This authorizes external SDK delivery, not production trading.
4. Publish final documentation and GitHub Release with confirmed installation instructions, coverage, and supported environments. Pine `.pine`/example are required; importable TradingView publication, if available, is recorded separately without hiding its absence.
5. Record URLs, versions, hashes, channel outcomes, and acceptance in evidence/receipts; complete the plan only after overall verification. Fix published-code failures with a new version, not an overwrite of `0.1.0`.

#### Acceptance and checks

- Actual `npm install`, `pip install`, `go get ...@v0.1.0`, and Cargo dependency `0.1.0` work for clean consumers without Git credentials/internal registries/source-server checkouts.
- JS `import`/`require`, TypeScript declarations, Python typing/imports, Go module checksum, and Rust builds pass; versions and coverage match the published manifest.
- Every required channel has confirmed external acceptance. A failed channel leaves the overall release partial and STEP-12 incomplete; Pine source-only is allowed within the agreed scope.

#### Completion Evidence

- Revision / implementation context / integration evidence: pending, including remote refs/registry URLs.
- Changed artifacts / verification: pending; deviations and openings: none.
- Blocker: none; publication occurs only within an authorized execution task.

## Requirements coverage

| Requirement                                                                                          | Acceptance owner                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Root instructions and domain skills                                                                  | Prepared during planning; currency verified in STEP-01 and final verification |
| `.gitignore`, file normalization, shared formatter/linter, version pins                              | STEP-01                                                                       |
| Canonical REST/webhook source and fixtures, all signal variants                                      | STEP-02/03                                                                    |
| JS/TS, Python, Go, Rust, native tests/linters/formatters/packaging                                   | STEP-04/05/06/07 respectively                                                 |
| Pine backup storage and JSON builders, real compilation, manual publication as a separate capability | STEP-08/12                                                                    |
| CI, installation checks, dependency updates, required check                                          | STEP-09                                                                       |
| Public GitHub, `main` protection, permissions, CODEOWNERS, contribution/security, registries         | STEP-10                                                                       |
| Versions, trusted publishing, partial release and resume, verifiable release                         | STEP-11/12                                                                    |
| Current-state documentation and complete acceptance                                                  | Each step owner, then Final Verification                                      |

## Final Verification

1. All STEP-01–12 are accepted into their targets with specific commits and evidence. The source server commit is accepted separately; SDK `main` contains the correct snapshot; an uncommitted checkout is not an integration target.
2. Tool installation and `pnpm verify` reproduce from a clean public checkout. All four packages pass C01–C12; C13 is confirmed at the actual server. Generation and ordinary tests require neither a neighboring checkout nor production secrets.
3. Each language's public API has 7 REST operations and 8 signal construction/delivery functions; no handwritten changes to derived code, stale exports, Java SDK, stubs, or hidden polling/retry behavior.
4. Verify GitHub settings, namespace permissions, version/tag mapping, and actual registry installation. Selected successful installations do not substitute for all four channels.
5. Pine source, example, and actual compilation evidence match the release commit. `source-only` is explicit; published libraries have a real pinned import and alert-recreation procedure.
6. README, contracts/architecture/development/releasing docs, instructions, and skills describe actual completed state and commands. No nonexistent registry links, contacts, or advertised trade-execution guarantees. Server sitemap remains unchanged: this task creates no new/renamed public document routes.
7. Verify partial-release and safe-continuation behavior; published versions/tags have not moved. Do not claim shared rollback or confidentiality of an already-public repository.
8. Before the final response, compare requirements against all artifacts, checks, and statuses; fix available defects, record specific unavailable checks, and retain the plan. `completed` requires full integration/registry acceptance.

## External primary sources

- [OpenAPI Generator: TypeScript Fetch](https://openapi-generator.tech/docs/generators/typescript-fetch/), [Python](https://openapi-generator.tech/docs/generators/python/), [Go](https://openapi-generator.tech/docs/generators/go/), [Rust](https://openapi-generator.tech/docs/generators/rust/) — verified candidates, not proof of specific generated output.
- [uv projects](https://docs.astral.sh/uv/concepts/projects/), [Ruff](https://docs.astral.sh/ruff/tutorial/) — Python toolchain.
- [Go 1.27](https://go.dev/doc/go1.27), [Go module versions/tags](https://go.dev/ref/mod#mapping-versions-to-commits).
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [PyPI Trusted Publishing](https://docs.pypi.org/trusted-publishers/using-a-publisher/), [crates.io Trusted Publishing](https://blog.rust-lang.org/2025/07/11/crates-io-development-update-2025-07/).
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [workflow security](https://docs.github.com/en/actions/reference/security/secure-use), [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- [TradingView libraries](https://www.tradingview.com/pine-script-docs/concepts/libraries/), [publishing](https://www.tradingview.com/pine-script-docs/writing/publishing/), [alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/).

Check current registry/tool requirements before external setup and release; do not replace unknown facts with assumptions about free features, permissions, or existing APIs.
