# Public SDK delivery plan

## Scope and status

Provide public Vector Trading REST clients and strategy signal builders for
TypeScript, Python, Go and Rust, plus a Pine v6 library. Java is excluded.
Clients own HTTP transport and JSON construction; service permissions, trading
execution and recovery remain outside the SDK. Shared schemas, fixtures and
reproducible generation define compatibility.

`implemented` means locally verified; `integrated` means accepted into `main`.
Release completion requires verified delivery and installed consumers in every
selected channel. Public documentation retains public evidence only. Detailed
service-source validation, internal work logs and account setup receipts are
maintained privately.

## Steps

| Step    | Result                                                         | Status     |
| ------- | -------------------------------------------------------------- | ---------- |
| STEP-01 | Repository scope, boundaries and development guidance          | integrated |
| STEP-02 | Verified public REST and signal snapshot with shared fixtures  | integrated |
| STEP-03 | Reproducible four-language generation and native probes        | integrated |
| STEP-04 | TypeScript REST and signal clients                             | integrated |
| STEP-05 | Python REST and signal clients                                 | integrated |
| STEP-06 | Go REST and signal clients                                     | integrated |
| STEP-07 | Rust REST and signal clients                                   | integrated |
| STEP-08 | Pine v6 builders, captured editor output and embedded consumer | integrated |
| STEP-09 | Aggregate CI and clean installed-archive verification          | integrated |
| STEP-10 | Contribution guidance and release prerequisites                | integrated |
| STEP-11 | Frozen release preparation, publication gates and recovery     | integrated |
| STEP-12 | First verified distribution in every selected channel          | integrated |

## Integration evidence

SDK implementation and release tooling were integrated through
[PR #1](https://github.com/Vector-Trading/vector-trading-sdk/pull/1).
The initial main source verification and preparation passed:
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37217803452),
[release preparation](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37217803938).
The subsequent test-dependency update through
[PR #2](https://github.com/Vector-Trading/vector-trading-sdk/pull/2) passed
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37218675981).
The SDK source passed
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37225353004).
Earlier contract-preparation CI failed before the generated Rust probe contained
its real target. The fix assembles the actual probe before Cargo fetch; full
verification includes locked offline compilation. Remote controlled-failure
verification confirmed that a Rust failure also fails the aggregate `sdk-ci` job.

The verification matrix covers Node.js 22.23.2/24.21.0, Python 3.12.9/3.14.6,
Go 1.26.0/1.27.1, Rust 1.88/1.99, reproducible generation and clean archive consumers.
Pine source checks replay actual editor output; they are not a headless compiler
or proof of live webhook delivery.

## Distribution acceptance

The shared SDK version is `0.1.1`. The repository is public and
[GitHub Release v0.1.1](https://github.com/Vector-Trading/vector-trading-sdk/releases/tag/v0.1.1)
contains all fourteen frozen artifacts and the manifest. All fifteen public downloads
were verified anonymously against their original hashes after the successful release
continuation. Every registry channel is published and its installed consumers passed:

| Channel   | Delivery and acceptance                                                   |
| --------- | ------------------------------------------------------------------------- |
| PyPI      | Published; wheel/sdist consumers passed on Python 3.12.9 and 3.14.6       |
| Go        | Published; public proxy/checksum consumers passed on Go 1.26/1.27         |
| npm       | Published; ESM/CommonJS/types consumers passed on Node.js 22.23.2/24.21.0 |
| crates.io | Published; public registry consumers passed on Rust 1.88/1.99             |

The original accepted source is `6bb3e966ec225ed43439ff9cb11e976f70d54a87`:
[source CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37226883118),
[frozen preparation](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37226939457).
The manifest SHA-256 is
`7680990f4cab63b15832eedf3fa94a90075568d42feb494208dbbf37eba404a2`.
Both `v0.1.1` and `go/v0.1.1` point to that same source commit.

The first publication gate stopped before uploads because its tooling dependencies
were absent. [PR #3](https://github.com/Vector-Trading/vector-trading-sdk/pull/3)
installs locked tooling before every release entry point. Its regression failed
before the fix; all twelve release tests, full local verification,
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37228956894)
and [preparation](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37228956883)
passed. The accepted tooling fix does not replace the frozen release source.

The [publication run](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37229570609)
records a partial result. PyPI's immediate post-upload read initially reported the
version as missing; a later authoritative read confirmed both original files.
No duplicate upload was made. The maintainer created both immutable tags, and public
Go consumption was then verified. Published versions, artifacts and tag identities
must not be replaced.

The initial npm and crates.io uploads were subsequently confirmed against the
original frozen archives. The public npm catalog became available after processing;
the anonymous consumer check was repeated only after installation by package name
was available. The
[release continuation](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37232078062)
passed its source gate, all four channels and the release summary, reusing the same
source run and manifest. Published artifacts and both tags retained their original
identities.

Public consumers exercise all seven REST methods and eight signal actions against
local receivers, including reuse of one client with different strategy keys. npm
consumers additionally verify ESM/CommonJS entry points and TypeScript declarations;
Python consumers cover wheel and sdist installation. Go uses the public proxy and
checksum database; Rust resolves the public registry package without a local path
override. These checks do not send live trading requests.

The maintainer confirmed Pine publication on 2026-10-04:
`import Vector_Trading_PE/VectorTrading/1`. This independent TradingView version
is not the strategy version or package version. The source mapping is in
[pine verification metadata](../../pinescript/conformance/verification.json).
The imported opening/TP/SL consumer compiled and executed in the actual Pine
Editor on 2026-10-04, without creating an alert or delivering a signal. Library
and embedded-consumer compilation evidence remains intact.

The release description now includes confirmed availability, installation commands
and detailed guides for every language. Exact trusted-publisher bindings use
`Vector-Trading/vector-trading-sdk`, `release.yml` and the `release` environment.
Temporary npm authentication and the crates.io bootstrap credential have been
revoked. All declared distribution and consumer acceptance criteria are complete.

## Release candidate acceptance

Public snapshot metadata contains the contract version, acceptance status and
public artifact hashes. Detailed service-source verification remains in the private
maintainer workspace. The source exporter and SDK validators are implemented,
locally verified together and integrated into `main`.

The 0.1.1 preview completed full verification, reproducible generation, 64 shared
regressions and fourteen clean archive consumers. Preview artifacts are inspection
evidence. The final bundle was subsequently prepared from the accepted source in
run `37226939457`. Every remaining 0.1.1 publication must use that preserved bundle
and its recorded manifest hash, with verified public consumption in every selected
channel.
