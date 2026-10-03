# Instructions for Vector Trading SDK

## Communication and project scope

- Write repository documentation, plans, `README.md`, `AGENTS.md`, and skills in English. Use the user's language for conversational replies. Preserve identifiers, commands, and technology names; write brief English code comments explaining non-obvious reasons.
- This repository contains public Vector Trading clients for JavaScript/TypeScript, Python, Go, and Rust, plus Pine Script sources and examples. Java is excluded.
- The SDK sends HTTP requests and builds signal JSON. It does not own trading rules, permissions, queues, exchange execution, or trade recovery.
- REST account API keys and webhook strategy API keys are separate credentials. Account API keys are intended for server-side integrations.

## Current state and navigation

Shared root tooling, the public contract snapshot in `contracts/`, shared fixtures in `conformance/`, and the contract, architecture, and development guides exist. Reproducible generation, internal derived trial sources, shared regression tests, and four-language probe harnesses also exist. Language packages, Pine sources, release tooling, and `docs/releasing.md` are still planned. Check each path before using it; do not assume the entire plan has been implemented.

- `contracts/` — pinned public contracts and provenance.
- `conformance/` — shared JSON requests, responses, and expected outcomes.
- `typescript/`, `python/`, `go/`, `rust/` — language packages, tests, and examples.
- `pinescript/` — signal-building library sources and TradingView examples.
- `generation/` — generator versions, configuration, and required templates.
- `scripts/` — contract validation, generation, and release preparation.
- `docs/contracts.md` — transport semantics and compatibility.
- `docs/architecture.md` — boundaries, generation, and public entry points.
- `docs/development.md` — environment setup and verification commands.
- `docs/releasing.md` — versions, publication, partial success, and recovery.
- `docs/plans/` — tasks, dependencies, statuses, and completion evidence.

Documentation describes the current result; future decisions belong in the plan. Find the relevant heading with `rg`, then read its section. Keep the detailed shared contract with one owner; other documents should link to it.

## Skills before acting

Read the appropriate `.agents/skills/<name>/SKILL.md` before deciding:

| Area                                                                         | Skill           |
| ---------------------------------------------------------------------------- | --------------- |
| Specifications, fixtures, API synchronization, generation, and compatibility | `sdk-contracts` |
| Language clients, package tooling, errors, pagination, and tests             | `sdk-clients`   |
| Versions, packaging, GitHub Actions, GitHub settings, and registries         | `sdk-release`   |
| Pine Script signal JSON, examples, and TradingView publication               | `pine-signals`  |

Combine skills when areas overlap. Use `skill-creator` when available to create skills. Use `plan-steps` and `implement-step` when available to plan and execute steps; this does not authorize executing the entire plan or publishing packages automatically.

## Ownership and compatibility

- The source of truth is the public server routes and parsers in `Vector-Trading/vector-trading`. The SDK keeps a verified snapshot tied to the source commit, not an independent version of server rules.
- Do not import `@vector-trading/types` or internal server packages into the distributed SDK. Internal events, `Date`, branded IDs, and secret fields are not the transport contract.
- Update the snapshot, shared fixtures, generation, all declared language consumers, and documentation atomically when changing a contract. Do not repair shared semantics with a language-specific substitution.
- Do not edit derived code manually. Fix the canonical schema, generator options, or a narrow template, then regenerate reproducibly.
- Check existing package primitives before introducing a dependency or shared helper. Language implementations need not use identical internal classes; observable JSON and HTTP behavior must match.
- Version the SDK package, contract snapshot, REST `/v1`, webhook `/v1`, and signal `version` independently. The signal field denotes the strategy version.

## Side effects and safety

- Webhook `204` means enqueue acceptance, not an executed trade. Do not promise permanent idempotency or guaranteed execution.
- Do not automatically retry mutations or signals by default. Disable implicit HTTP-library retries too. Do not add hidden polling, background loops, or requests during import or client construction.
- Preserve the differences between omission, `null`, an empty array, and a value. Do not turn omitted `takeProfits` into `[]` or present an ignored server field as a supported action.
- Do not put account keys, strategy keys in URLs, `Authorization` headers, or private request bodies in logs, exceptions, examples, snapshots, or CI artifacts.
- Production requests use HTTPS; HTTP is allowed for an explicitly selected local test server. Do not forward secrets across origins on redirects.
- Live trading checks are not ordinary SDK tests. Isolate HTTP with a local server; real mutations require an explicitly selected safe environment and an authorized operation.

## Environment and verification

- Read existing version pins first. Do not automatically inherit tooling settings from the neighboring repository.
- Once `.nvmrc` exists, use `source ~/.nvm/nvm.sh && nvm use` for Node.js/pnpm; pnpm is pinned by `packageManager` in the root `package.json`.
- Node.js supports TypeScript and shared tooling; Python uses `uv`, Go uses Go modules, and Rust uses Cargo. Their versions and lockfiles belong to their respective configurations.
- Format changed files before typechecking and linting. Checks must finish without changing files; run fixes separately and inspect the diff afterward.
- Once commands exist, run the package and affected contract checks in `docs/development.md`. Full `pnpm verify` is required for shared contract or release changes; do not replace a missing, not-yet-created command with a fictitious successful check.
- Test the installed package archive in a clean consumer project. Importing from the working tree does not prove packaging correctness.
- Preserve others' changes. Do not perform destructive cleanup, a blanket reset, or automatic global tool installation.

## Git, plans, and external changes

- The default branch is `main`; new working branches use `VT-000/` unless the user selects another prefix.
- Planning authorizes writing the plan; additional files must remain within the explicitly requested scope. Do not implement applications, GitHub Actions workflows, or configurations merely because they appear in the plan.
- Record locally verified work as `implemented` and work accepted into the integration target as `integrated`. Do not mark a release complete until every declared channel has been verified.
- Publish, create tags/releases, push, or change GitHub settings only when authorized by the current task. Listing a future operation in the plan does not authorize it; do not ask again for authorization already given.
- The repository must become public before the first public release; the user has agreed to this. Make the change after reviewing content and history, at the appropriate execution step.
- GitHub and registries do not share a transaction. After an ambiguous response, verify the external result first; do not overwrite versions or move public tags.
