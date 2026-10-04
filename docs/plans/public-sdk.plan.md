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
| STEP-12 | First verified distribution in every selected channel          | partial    |

## Integration evidence

SDK implementation and release tooling were integrated through
[PR #1](https://github.com/Vector-Trading/vector-trading-sdk/pull/1).
The initial main source verification and preparation passed:
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37217803452),
[release preparation](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37217803938).
The subsequent test-dependency update through
[PR #2](https://github.com/Vector-Trading/vector-trading-sdk/pull/2) passed
[SDK CI](https://github.com/Vector-Trading/vector-trading-sdk/actions/runs/37218675981).
Earlier contract-preparation CI failed before the generated Rust probe contained
its real target. The fix assembles the actual probe before Cargo fetch; full
verification includes locked offline compilation. Remote controlled-failure
verification confirmed that a Rust failure also fails the aggregate `sdk-ci` job.

The verification matrix covers Node.js 22.23.2/24.21.0, Python 3.12.9/3.14.6,
Go 1.26.0/1.27.1, Rust 1.88/1.99, reproducible generation and clean archive consumers.
Pine source checks replay actual editor output; they are not a headless compiler
or proof of live webhook delivery.

## Distribution and remaining acceptance

The initial GitHub Release and Go tags were delivered at SDK version `0.1.0`.
Anonymous public Go consumption passed on both supported Go versions. npm, PyPI
and crates.io packages remain unpublished. Further public delivery is paused
while public content is corrected. Existing downloads and external caches are
outside ordinary repository verification; source corrections do not erase them.
A corrected release must use a new version rather than replace old package bytes.

The maintainer confirmed Pine publication on 2026-10-04:
`import Vector_Trading_PE/VectorTrading/1`. This independent TradingView version
is not the strategy version or package version. The source mapping is in
[pine verification metadata](../../pinescript/conformance/verification.json).
The imported opening/TP/SL consumer compiled and executed in the actual Pine
Editor on 2026-10-04, without creating an alert or delivering a signal. Library
and embedded-consumer compilation evidence remains intact.

Before completing STEP-12:

1. Verify corrected public content, reproducible generation and all installed archives.
2. Obtain the required authorization for published-history and resource cleanup;
   verify remaining old references and external copies separately.
3. Integrate the corrected source and confirm actual remote CI and preparation.
4. Deliver only authorized registry channels with frozen, verified artifacts.
5. Verify anonymous installed consumers for each delivered package; preserve the
   verified Pine import and source mapping.
6. Record per-channel acceptance; keep partial outcomes explicit.

## Content correction in progress

Public snapshot metadata is limited to contract version, acceptance status and
public artifact hashes. Internal implementation metadata and operational receipts
belong in the private maintainer workspace. The source exporter and SDK validators
are implemented locally and verified together. The 0.1.1 preview completed full
verification, reproducible generation, 64 shared regressions and fourteen clean
archive consumers. Publication remains paused pending the separately authorized
history cleanup, integration and remote acceptance.
Commit, push, history rewriting, resource deletion and renewed publication are
separate delivery boundaries. Repository visibility was temporarily restricted
with maintainer authorization on 2026-10-04.
