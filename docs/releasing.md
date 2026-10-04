# Release preparation and access

## Current readiness

The package version is `0.1.1`. npm `@vector-trading/sdk`, PyPI
`vector-trading-sdk`, crates.io `vector-trading-sdk`, and Go module
`github.com/Vector-Trading/vector-trading-sdk/go` are the selected names.
Registry availability and public installed-consumer acceptance are tracked in the
[delivery plan](plans/public-sdk.plan.md) and
[GitHub Releases](https://github.com/Vector-Trading/vector-trading-sdk/releases).
Published tag identities and package bytes must not be silently replaced.

The maintainer confirmed TradingView publication on 2026-10-04 with pinned import
`Vector_Trading_PE/VectorTrading/1`. See the [Pine guide](../pinescript/README.md).
SDK preparation distributes Pine source files; it does not publish or update the
TradingView library. The imported opening/TP/SL example was compiled and executed in the actual Pine
Editor on 2026-10-04 without alert creation or webhook delivery. Its source hash
and verification are recorded in the Pine metadata.

## Repository controls

Use protected `main`, pull requests and the actual `sdk-ci` result for integration.
Ordinary CI has `contents: read` and no publishing credentials. Publishing is manually
authorized through the `release` environment. External Actions are pinned to full
commit SHAs and must be permitted by the repository's verified policy. Keep account
identities, permission receipts, billing data and settings recovery records in the
private maintainer workspace. Public documentation describes required controls,
not administrator accounts or their operational setup history.

## Registry access and exact trust

Verify actual registry ownership independently of GitHub permissions. Credentials,
OTPs, tokens and account configuration must remain outside Git and ordinary CI.
A missing registry version does not prove a reserved name or publication rights.

Trusted publishers bind these public workflow identifiers:

| Field              | Value                |
| ------------------ | -------------------- |
| GitHub owner       | `Vector-Trading`     |
| Repository         | `vector-trading-sdk` |
| Workflow filename  | `release.yml`        |
| GitHub environment | `release`            |

Only publishing jobs receive `id-token: write`. Use the registry's supported first
upload process when trusted publishing requires an existing package. Verify the
created project and exact trust binding, then revoke temporary bootstrap credentials.
Do not upload placeholder packages or reserve a version as part of preparation.

- npm scoped publication uses public access; verify the package's
  [trusted publisher](https://docs.npmjs.com/trusted-publishers/) after creation.
- PyPI can create a project through a
  [pending trusted publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).
  Package author metadata is `Vector Trading PE`; the GitHub owner in the trust
  binding remains `Vector-Trading`.
- crates.io [trusted publishing](https://crates.io/docs/trusted-publishing) and
  first-upload requirements must be checked before an authorized bootstrap.
- Go uses the case-sensitive module path above and `go/v<version>` tags.
  Public consumption must be tested without Git credentials. A future major 2
  requires its separate `/v2` import-path migration.

## Preparation without publication

`release/version.json` owns the shared package version and the pinned TradingView
import mapping. It does not change the REST path, contract version,
strategy signal version, or Go import path. Check alignment with `pnpm release:check`.

For a reviewed version change, run `pnpm release:version --version 0.1.1`. This updates
TypeScript/Python/Rust manifests and the shared version, then lets uv/Cargo update
their lockfiles. uv may read registry resolution metadata without installing packages;
Cargo uses its prepared offline cache. A failed update restores the six original files. Go packaging reads the shared version. Review the complete
diff, update relevant release/install examples, and run full verification before
commit. Do not rewrite generated DTOs or change published versions. Major 2 requires
a separate Go `/v2` import-path migration; this command deliberately rejects it.

With all pinned development tools prepared, run from a clean source checkout:

```sh
pnpm release:prepare --bundle .cache/releases/v0.1.1 --version 0.1.1
```

Preparation runs the complete `pnpm verify`, including clean installed consumers
on all supported runtimes, then freezes the verified archives. It inspects the
embedded package versions and Cargo source revision. The bundle contains fourteen
artifacts: npm, wheel, sdist, crate, Go reference ZIP, crate upload metadata,
Pine library/imported opening-and-update example, license, and the five provenance/contract/fixture files.
Format 2 `manifest.json` records the SDK version, both tag names, source commit/tree,
public contract version/hashes, and every file's SHA-256 and byte count. The manifest
itself has a separately reported SHA-256. The original directory cannot be reused
or overwritten by preparation.

An uncommitted local implementation can use `--preview` and a fresh output directory.
It still runs full verification, but records `preview: true`; publication rejects
that bundle. A preview tied to HEAD does not claim its uncommitted files are accepted
source. Keep these artifacts ignored and do not distribute them as a release.

The `SDK Release` workflow runs preparation on pull requests touching release
infrastructure and on manual `prepare` dispatches. A PR uses its actual checkout
commit and can never authorize publication. Preparation has only `contents: read`,
no publishing environment, no OIDC permission, and no publication secrets. It uploads
`sdk-release` with 30-day retention. A real successful prepare run is required
for STEP-11 acceptance; local success is insufficient.

## Authorized publication and continuation

Integrate the exact source into `main`, confirm its successful ordinary push-triggered
SDK CI, and manually dispatch `SDK Release` in `prepare` mode on `main`. Record that
run ID, commit, version, and manifest SHA-256, and preserve a copy of the complete
bundle. A run from a feature branch or PR remains inspection evidence only.

After separately authorizing the channels, dispatch `publish` with the same version,
that successful main `source-run`, and the reviewed `manifest-hash`. `resume` uses
exactly the same inputs and bundle. The read-only gate confirms the workflow identity,
main ancestry, actual source CI, successful prepare job, complete inventory, source
tree/contract hashes, and manifest/artifact hashes. It does not accept arbitrary
revisions, forks, PR artifacts, preview bundles or a replacement source commit.

npm, PyPI, crates.io and Go have separate jobs behind the `release` environment.
Only the three registry jobs receive `id-token: write`; Go and release-summary jobs
receive the necessary `contents: write`. All other permissions remain read-only.
No additional external Action was introduced: every Action already belongs to the
verified exact-SHA allowlist. Each publication job downloads the original bundle
and verifies it; none builds a new package. Per-version workflow concurrency does
not cancel a release that has started.

Every channel is read before an upload. Matching npm tarball bytes, PyPI filename
hashes, crates.io checksum, and the exact Go tag commits establish availability.
Go proxy metadata is also checked; the reference ZIP is a locally verified archive,
not a promise that GitHub's proxy produces byte-identical ZIP compression. Public
proxy installation and package consumers remain STEP-12 acceptance.

Only a confirmed missing channel may be attempted. `confirmed` channels are skipped;
`conflict` and `unknown` states stop that channel. Each attempt is followed by one
fresh read, including after a timeout. Upload commands disable npm/uv HTTP retries;
crates.io uses one PUT of the frozen `.crate` bytes through the documented
[Cargo registry upload protocol](https://doc.rust-lang.org/cargo/reference/registry-web-api.html#publish).
Its metadata comes from the normalized archive manifest, without rebuilding.
The short-lived crates.io OIDC token is revoked after the attempt. PyPI uses
[pinned uv trusted publishing](https://docs.astral.sh/uv/guides/publish/), with automatic
token cleanup; a partially uploaded wheel/sdist pair resumes only the missing file.

Outcomes are separate JSON records keyed by manifest SHA-256, channel, observed
status and whether an attempt occurred. GitHub retains per-run outcomes for 90 days.
Resume always rereads the registry; it does not treat a local receipt as proof.
An unknown response after a confirmed upload therefore never causes a duplicate
upload. If an original artifact is unavailable or any identity/hash differs, stop
instead of rebuilding from a new `main` state. An expired Actions artifact requires
recovery of the exact saved bytes and a reviewed continuation; do not fabricate
another successful prepare run for an already partially published version.

The summary runs even after a publication failure and rereads every channel. It
records partial outcomes in the job summary and a separate artifact. When the shared
tag is confirmed, the GitHub Release shows those actual statuses and attaches the
immutable manifest, original archives, license, contracts and Pine sources. Existing
assets are checked by hash and never overwritten; public tags are never moved.
A conflicting existing tag/asset blocks the affected action. Availability of every
channel still leaves actual public installed-consumer acceptance outstanding; the
summary does not mark STEP-12 complete.

## Initial npm/crates.io bootstrap

The first real npm/crates.io upload cannot use trust configured on a nonexistent
package. STEP-12 performs only explicitly authorized first uploads using the exact
accepted main prepare bundle. No placeholder package or development archive is used.
PyPI's pending publisher already supports first creation, so it uses the normal
workflow rather than a separate token bootstrap.

For npm, let the maintainer perform the interactive first upload from the clean
accepted checkout with verified organization publishing access:

```sh
npm publish .cache/releases/v0.1.1/vector-trading-sdk-0.1.1.tgz \
  --access public --ignore-scripts --fetch-retries=0 --registry https://registry.npmjs.org
```

Then configure the exact GitHub tuple in the actual package settings. Enable direct
`npm publish` permission for that trusted publisher; current npm defaults grant
staged publication instead. Do not weaken package 2FA to make publishing pass. CLI
login/OTP/token entry is a separate maintainer action; do not expose credentials in
arguments, receipts or logs. The normal workflow will observe and skip the already
matching npm version.

For crates.io, a maintainer supplies a temporary appropriately restricted
`CARGO_REGISTRY_TOKEN` outside Git/logs. Verify the downloaded bundle first, then
run the narrowly explicit bootstrap from its clean accepted source checkout:

```sh
node scripts/release.ts channel --bootstrap --channel crates --authorize v0.1.1 \
  --bundle .cache/releases/v0.1.1 --version 0.1.1 --commit <accepted-sha> \
  --manifest-hash <reviewed-sha256> --outcomes .cache/first-crate-outcome
```

This sends the original `.crate` bytes and checks the actual checksum. It does not
store the token or accept an uncommitted checkout. After verified creation, configure
the exact trusted publisher, verify actual owner access, revoke the bootstrap token,
and remove it from the shell. Normal workflow continuation skips the matching crate.
Do not create broad persistent tokens or invite unrelated owners.

## Partial success and rollback limits

If PyPI succeeds and npm fails, the release is partial. Inspect unknown results and
resume only missing channels with the same manifest and artifacts. Do not delete a
successful version, auto-unpublish, rebuild under the same version, rewrite a tag or
claim registry rollback. Fix a published defect with a new version. Local scenario
tests cover partial success, ambiguous accepted uploads, resume skipping, and
mismatched version/commit/hash rejection.

Pine sources remain attached as reference files. The separately published library
uses `import Vector_Trading_PE/VectorTrading/1 as vt`. New TradingView versions
require their own publication confirmation, source mapping and consumer checks.
Changing an import does not update running alerts; recreate them with reviewed
inputs. Reverting the import cannot reverse an executed trade.

## Settings recovery

Retain the before/after settings receipt privately. An authorized recovery may restore individual
merge, Actions, environment, security, or protection settings from it after checking
current organization policy and active releases. Do not disable protections merely
to make CI pass. Making the repository private again does not restore confidentiality
of code or history that was already public. No rollback, tag movement, or registry
mutation is performed by ordinary verification.

## Public content verification

`pnpm public:check` checks public working files and rejects additional fields in
snapshot metadata. Release bundle verification also scans extracted archive
contents and requires format 2, public-only snapshot fields and matching artifact
hashes. Legacy manifests containing private source provenance cannot be resumed.
Keep internal source verification and release account receipts outside this
repository. These preventive checks supplement manual content and history review;
they do not purge old Git references, releases, logs or external caches.
