---
name: sdk-contracts
description: 'Change public Vector Trading REST/webhook contracts, shared fixtures, generation, and synchronization with the server.'
---

# SDK contracts and generation

Read the root `AGENTS.md`, the relevant section of `docs/contracts.md`, and `contracts/source.json` if they exist. Do not treat missing target files as ready; use the approved plan for preparation.

## Source and boundaries

- Record the server commit and read the actual routes, parsers, and contract tests. A specification without runtime verification does not prove compatibility.
- REST owner: `apps/web/hono/routes/rest-api/` in the main repository. Webhook owners: `packages/types/src/signal.ts`, `apps/webhook/src/lambda.ts`, and `packages/types/src/trading/trading-strategy-processing-queue.ts`.
- Change the server only within the authorized scope and under its own instructions. Do not export the entire dirty working tree as an accepted source.
- The SDK stores transport types, not internal events: the server adds `id` and `apiKey`. Signal `version` is the strategy version; API format and SDK version are independent.
- Document a recommended strict outgoing webhook subset compatible with the server. Do not claim JSON Schema expresses every numeric or cross-field constraint or matches the entire permissive server parser.

## Changes

1. Identify affected operations, fields, compatibility, and all language consumers.
2. Check input/output schemas, omission, `null`, dates, numeric bounds, `oneOf`, errors, and permissions. Pin stable REST `operationId` values; base URL configuration must work outside a browser.
3. Check all eight webhook actions, required positive strategy version, string millisecond timestamp, omitted `takeProfits` versus `[]`, `force` only on `open`, and order-type inference from `price`/`triggerPrice`.
4. Store shared JSON fixtures and expected outcomes in `conformance/`. Do not include real keys or private records.
5. Update the snapshot with its source commit and hashes. Change canonical schemas/settings and generate code; do not edit derived code manually.
6. Verify all affected consumers, including Pine when signals change, and document compatibility with the relevant owner.

## Verification

- New fixtures must pass the real server parser or route in an isolated test; an HTTP double does not replace proof of the source contract.
- Every language must reproduce the shared JSON. Specifically verify omitted fields, preserved empty arrays, REST dates, and `CreateGrantRequest` variants.
- Generation with a pinned tool version and snapshot must repeat without a diff. Changing generators is a separate explicit dependency and derived-code change.
- Compatibility checks must detect removed operations and changes in requiredness, format, or semantics; a new optional response field need not break a client.
- An empty REST page with `nextCursor` must continue traversal. Not every response follows one error schema, especially `429` and non-JSON infrastructure responses.

Use `sdk-clients` for HTTP wrappers and `sdk-release` for snapshot release or GitHub Actions workflow changes.
