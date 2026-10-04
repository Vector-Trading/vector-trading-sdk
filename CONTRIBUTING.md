# Contributing to Vector Trading SDK

Use issues for reproducible bugs and scoped feature requests. Report vulnerabilities
privately through [the security policy](SECURITY.md). Never include real API keys,
private webhook URLs, account data, or production request bodies in issues or PRs.

## Scope and language

This repository owns TypeScript, Python, Go, and Rust clients and Pine Script signal
builders. The server owns permissions, trading rules, and execution. Keep public
repository documentation and comments in English. Read [AGENTS.md](AGENTS.md) and the
[architecture guide](docs/architecture.md) before changing shared behavior.

## Setup and verification

Prepare the pinned Node.js, pnpm, Python/uv, Go, Rust, and generator tools using the
[development guide](docs/development.md). Supported runtime versions and package-specific
commands are listed there and in the [language guides](README.md#-choose-your-language).
Ordinary tests use local receivers and synthetic credentials; no trading account is needed.

```sh
source ~/.nvm/nvm.sh
nvm use
pnpm install --frozen-lockfile
pnpm exec prettier --write <changed-files>
pnpm verify
```

Replace `<changed-files>` with the files you changed; use the native formatter for
Python, Go, and Rust sources. Run relevant native tests while developing. Shared
contract or release changes require the complete `pnpm verify`, including reproducible
generation and installed archives in clean consumers. Verification commands must not
modify source files.

## Pull requests

Create a branch from `main`; repository-maintained branches use `VT-000/`. Describe the
problem, resulting behavior, compatibility impact, and checks actually run. Keep changes
bounded and preserve unrelated work. `main` requires a PR and the passing `sdk-ci` check;
there are initially no mandatory approvals, so a single maintainer can contribute.
Maintainers use squash merge and delete merged working branches.

Generated models are derived artifacts: update the canonical projection or a narrow
template, then regenerate. Follow the [contract guide](docs/contracts.md) when changing
transport semantics; update fixtures, all affected clients, and documentation together.
Preserve omitted fields, explicit `null`, and empty arrays. Do not introduce implicit
retries, background requests, new runtime dependencies, or production trading tests.

## Releases

Registry uploads, public tags, and TradingView publication are separate maintainer
operations. A successful ordinary PR/build does not publish. Read the
[release preparation guide](docs/releasing.md) for the current readiness, ownership,
and publication boundaries; do not upload packages as part of a contribution.
