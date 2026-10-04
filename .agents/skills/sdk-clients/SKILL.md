---
name: sdk-clients
description: 'Develop and verify Vector Trading clients for TypeScript, Python, Go, and Rust: HTTP, serialization, errors, pagination, tooling, and packaging.'
---

# Language clients

Read `AGENTS.md`, the package configuration, and the relevant section of `docs/development.md` if it exists. Use `docs/contracts.md` and `conformance/` for shared semantics; apply `sdk-contracts` when changing them.

## Placement and public API

- Each package owns language-specific HTTP adapters and convenient methods; the server owns authorization, trading rules, and execution.
- Separate the account-key REST client from strategy-key signal delivery. Message construction must also be available independently of delivery, including offline use.
- Generated models and HTTP calls remain derived; keep handwritten wrappers separately. Do not expose internal import paths unless they are intentional API.
- Use idiomatic language facilities for asynchronous work, cancellation, and resource cleanup. Do not support a second transport mode merely for language symmetry without a real use case.
- Distribute TypeScript as JavaScript with declarations and verified `import`/`require`. Python includes types; Go provides a module from `go/`; Rust provides a library crate from `rust/`.

## HTTP and failures

- Client construction and imports do not perform network operations. Use the documented production base URL by default and preserve explicit deployment overrides, bounded timeout, and cancellation; clients do not store keys in browsers or forward them across origins on redirects.
- Do not add automatic retries by default, including HTTP-library retries. A timed-out mutation may have an unknown outcome; do not report it as a confirmed server rejection.
- Webhook `204` means accepted delivery, not an executed trade. Do not invent a server signal ID: successful response bodies are empty.
- Normalize errors into a language-specific type with HTTP status, code/message when available, and `requestId`; handle `429`, empty/non-JSON bodies, and transport failures. Bound diagnostics and redact secrets, including strategy keys in URLs.
- Pagination ends when `nextCursor` is absent, not when an array is empty; preserve query filters and support cancellation. A repeated cursor must produce an understandable error instead of infinite traversal.
- Do not serialize omitted fields as `null` or omit an explicitly empty TP array. Numbers must be finite; verify REST dates on actual outbound requests.

## Verification

- Use native tests and a local HTTP server/interceptor. Verify actual serialization and headers of public methods; do not replace the serializers being tested.
- Run shared `conformance/` fixtures, negative requests, empty-page pagination, cancellation, timeouts, secret redaction, and absence of retries.
- Install the built archive in a separate consumer project and call public methods. Check the license, type declarations, allowed imports, and absence of test secrets or extra artifacts.
- Update examples, supported environments, and real verification commands with the public API. Also use `sdk-release` for packaging or version changes.
