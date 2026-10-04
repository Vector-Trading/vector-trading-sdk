---
name: pine-signals
description: 'Maintain Pine Script sources and examples for Vector Trading JSON signals and manual TradingView library publication. Excludes the web application TradingView Charting Library.'
---

# Pine Script signals

Read `AGENTS.md`, the webhook section of `docs/contracts.md`, and shared signal fixtures if they exist. Also apply `sdk-contracts` when changing shared semantics.

## Code and data

- The Pine component builds JSON for TradingView alerts; it is not an account-key REST client. Users supply the strategy key in the webhook URL, not public source code or the signal body.
- Sources live in `pinescript/`; GitHub stores their history and releases. Prefer the current stable Pine version and verify compatibility in the real Pine Editor.
- Build messages for all eight actions and market/limit/trigger/trigger-limit variants. Send strategy version and a string millisecond timestamp; do not use library version as strategy version.
- The codec must escape strings, emit numbers without localized separators, and reject `na`/invalid prices. Omitted TP, `[]`, and non-empty targets retain distinct meanings; expose `force` only for `open`.
- Separate message construction from alert conditions and frequency. The library must not unexpectedly create extra signals or choose trade timing for the user's script.
- Historical execution and the broker emulator do not prove actual webhook delivery or exchange trades.

## Verification

- Compile the library and consumer example in Pine Editor. Record source version and environment evidence; a regular script checking strings does not replace Pine compilation.
- Compare produced JSON against `conformance/` and the real server parser in a safe environment without exchange effects. Check escaping, numeric precision, string timestamp, and all TP variants.
- Verify real alert behavior against a local/isolated test receiver with explicitly selected signals; do not use a production strategy key for routine checks.

## Publication and consumers

- Official publication and updates use Pine Editor. No public documented publication API has been confirmed; do not make internal endpoints, cookies, or UI automation mandatory CI components.
- A library must be published on TradingView for `import`; libraries are published with source code. Without publication, provide sources and an embedding example, not a fictitious import.
- Imports use `username/Library/version` with an explicitly pinned version. Publishing a new version does not update existing imports or running alerts; changing a running alert's context requires recreating it.
- For authorized publication, record the author, link, Pine version, SDK version, and source commit. Recovery documentation must describe reverting to a previous pinned import and recreating the alert, not automatically reversing a trade.

Official sources for checking current requirements: [Libraries](https://www.tradingview.com/pine-script-docs/concepts/libraries/), [Publishing scripts](https://www.tradingview.com/pine-script-docs/writing/publishing/), [Alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/).
