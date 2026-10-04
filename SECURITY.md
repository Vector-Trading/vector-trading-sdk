# Security policy

## Supported code

There are no public registry releases yet. Security fixes currently target the SDK
implementation branch; the first planned release is `0.1.0`. After release, support
covers the latest published SDK version. Use the language guides to check actual
publication and supported runtime status.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository:
[Report a vulnerability](https://github.com/Vector-Trading/vector-trading-sdk/security/advisories/new).
Reports reach repository security maintainers without creating a public issue.
Do not post exploit details or private data in public issues or pull requests.

Include the affected language/version or source commit, a minimal reproduction using
synthetic credentials, the impact, and any suggested mitigation. Remove live account
keys, strategy keys, webhook URLs, private request bodies, and trading/account data.
The maintainers will assess the report and coordinate any disclosure and fix; no
response-time guarantee is advertised.

For ordinary bugs without a security impact, use the bug issue template. This policy
covers SDK serialization, validation, transports, packaging, and release configuration.
Trading permissions and execution are server responsibilities; clearly identify the
component involved so maintainers can route the report.
