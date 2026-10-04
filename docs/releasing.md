# Release preparation and access

## Current readiness

SDK packages are locally verified and remain unpublished. The user authorized the first
PyPI publication on 2026-10-04; that approval is retained for the verified release after
its prerequisites pass. It does not itself establish release readiness or authorize
publication in the other registries. STEP-10 prepares repository
and registry access; STEP-11 owns the release workflow and recovery tooling; STEP-12
owns the first actual upload and public tags. The local release workflow, `release/version.json`, immutable artifact preparation,
and reconciliation scripts now exist; their real GitHub prepare-run acceptance is still
pending delivery. They have not published packages. Do not infer permission to publish
from this guide.

The intended first version is `0.1.0`. npm `@vector-trading/sdk`, PyPI
`vector-trading-sdk`, crates.io `vector-trading-sdk`, and the case-sensitive Go module
`github.com/Vector-Trading/vector-trading-sdk/go` are the agreed names. A public registry
404 is an availability observation, not proof of reserved names or publication rights.
Name conflicts require a decision before changing metadata or imports.

## Repository controls

Repository administrators `Askadias` and `Belugan2013` were verified through the GitHub
API. `Askadias` is the existing release owner and local CODEOWNERS entry. The public
repository uses squash merge, automatic deletion of merged branches, and protected
`main`: pull requests, the actual `sdk-ci` check, zero required approvals, no ordinary
force pushes or deletion. Recovery bypass through pull requests is limited to confirmed repository administrators;
normal contribution uses pull requests. No organization role or paid plan is changed.

The configured `release` environment gates manually authorized publication, with only
`main` branch and `v*` tag deployments and the existing release owner as reviewer. Self-review remains
allowed for solo maintenance; no second reviewer is invented. Ordinary CI keeps
`contents: read`, cannot approve PR reviews, and receives no publishing credentials.
External Actions must be on the verified allowlist and pinned to full commit SHAs.
Actual before/after settings and feature limitations are recorded in the plan's
[STEP-10 evidence](plans/public-sdk.plan.md).

Private vulnerability reporting, Dependabot vulnerability alerts, secret scanning, and
secret push protection are enabled. Automated security-fix PRs remain disabled as before.
Environment administrators can bypass deployment approval for recovery; the verified
administrators are the same two accounts above. The organization-level Actions policy
could not be read with the current token; it was not changed. The repository allowlist
contains the seven existing CI Actions at their exact SHAs. STEP-11 must review and add
any publication Action before using it; no release Action is implicitly allowed.

The contribution/security files and templates are local until separately delivered and
integrated into `main`. Repository settings already apply independently of that delivery.

## Registry access and exact trust

The publication identity must be verified in each registry independently of GitHub
administrator access. Use organization-controlled permissions. Keep passwords, OTPs,
API tokens, and account configuration outside Git and CI logs; do not put publishing
credentials on ordinary PR jobs. Paid registry organization features are a separate decision.

The planned trusted publisher tuple is:

| Field              | Exact value                     |
| ------------------ | ------------------------------- |
| GitHub owner       | `Vector-Trading`                |
| Repository         | `vector-trading-sdk`            |
| Workflow filename  | `release.yml`                   |
| Workflow path      | `.github/workflows/release.yml` |
| GitHub environment | `release`                       |

This exact binding is now saved as a PyPI pending publisher; npm/crates.io trust configuration
is deferred until their actual first uploads; the bootstrap identities are confirmed. A saved entry is not evidence of a working workflow. The local STEP-11 workflow uses that exact filename; its remote preparation and
main integration must pass before use.
Only the relevant publication jobs may receive `id-token: write`.

### npm

On 2026-10-04, the user completed creation of npm organization `vector-trading`.
The live Members settings confirm `askadias` as its sole member with the `owner`
role and 2FA enabled. Billing confirms the `Free` plan, `Unlimited Public Packages`,
`$0`, and no monthly bill. npm created its default `developers` team, which receives
read/write access to new packages in the scope. Packages settings show zero packages.
These settings establish organization control for the intended `@vector-trading/sdk`;
the package itself has not been created. No additional member was invited by the agent.
Browser login alone does not authenticate the npm CLI.
[Trusted publishing](https://docs.npmjs.com/trusted-publishers/) is configured in the
actual package settings and requires the matching workflow file. If the initial
package cannot be configured before upload, STEP-12 must separately authorize the
first verified upload using the registry's supported interactive authentication.
Then confirm the exact trusted publisher and remove any temporary publication credentials.
Do not upload a dummy package or reserve a version during preparation. Public scoped
publication explicitly uses public access. A saved npm trust entry does not itself
verify the OIDC exchange; verify it during the authorized release.

### PyPI

Confirm the publishing account and organization/project permissions. PyPI supports a
[pending trusted publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)
for `vector-trading-sdk` with the exact tuple above. A pending publisher does not reserve
the project name and creates the project only when an authorized upload succeeds.
The account must be authenticated and satisfy PyPI's verification/2FA requirements.
Do not claim configuration or ownership merely from an absent package search result.

On 2026-10-04, browser login as `Askadias` was confirmed; the account lists no projects
or organizations. The user approved treating this as a standalone library and authorized
publication. A pending publisher was saved under that account and verified after reload:
ID `c92ff80e-2836-429e-b3a8-8980aa640651`, project `vector-trading-sdk`, with the exact
GitHub tuple above. A future first upload through this account-level publisher assigns
project ownership to `Askadias`; no PyPI organization was created or joined.

The user-supplied name `Vector Trading PE` is the Python package's author metadata.
The trusted publisher's GitHub Owner remains `Vector-Trading`, the actual repository
owner, as required by [PyPI's binding rules](https://docs.pypi.org/trusted-publishers/adding-a-publisher/).
A display name cannot replace that identity. No package has been uploaded and the
OIDC exchange has not been tested: the release workflow, immutable accepted commit,
and STEP-11/STEP-12 checks are still prerequisites. Do not request the same publication
approval again when the authorized PyPI release is ready.

### crates.io

On 2026-10-04, the live crates.io account was verified as GitHub-linked `Askadias`.
Its email is verified, and the public profile lists zero owned crates. The email
address itself is not stored in repository evidence. The public API returns 404 for
`vector-trading-sdk`; this does not reserve the name or prove crate ownership.

The intended first-upload account is `Askadias`. The current
[trusted-publishing requirements](https://crates.io/docs/trusted-publishing) require an
already published crate and a crate owner, so no pending trust can be saved yet.
Record the first verified upload as a separately authorized STEP-12 bootstrap using
an appropriately restricted temporary API token. After confirmed creation, verify
actual owner rights, bind the exact workflow/environment above, and revoke the
bootstrap credential. A browser login is not Cargo authentication or a tested upload.

No token was created or inspected during preparation; no crate/team owner was added,
and no organization OAuth policy was changed. Do not create broad persistent tokens,
invite unrelated owners, or infer a GitHub team's registry rights from repository
administration. The account's verified email satisfies the documented
[first-publish email requirement](https://doc.rust-lang.org/cargo/reference/publishing.html).

### Go

The source module path is case-sensitive and remains
`github.com/Vector-Trading/vector-trading-sdk/go`. Version `0.1.0` needs both the shared
`v0.1.0` tag and `go/v0.1.0` at the same accepted release commit. No tag exists merely
because a local module ZIP passes. STEP-12 checks actual public proxy installation
without Git credentials. A future major version requires the `/v2` path and corresponding
subdirectory tags; it does not reuse the v1 import path.

## Preparation without publication

`release/version.json` owns the shared package version and the current Pine
`source-only` declaration. It does not change the REST path, contract version,
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
pnpm release:prepare --bundle .cache/releases/v0.1.0 --version 0.1.0
```

Preparation runs the complete `pnpm verify`, including clean installed consumers
on all supported runtimes, then freezes the verified archives. It inspects the
embedded package versions and Cargo source revision. The bundle contains fourteen
artifacts: npm, wheel, sdist, crate, Go reference ZIP, crate upload metadata,
Pine library/example, license, and the five provenance/contract/fixture files.
`manifest.json` records the SDK version, both tag names, source commit/tree,
contract commit/version, and every file's SHA-256 and byte count. The manifest
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
accepted checkout with its verified `askadias` organization access:

```sh
npm publish .cache/releases/v0.1.0/vector-trading-sdk-0.1.0.tgz \
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
node scripts/release.ts channel --bootstrap --channel crates --authorize v0.1.0 \
  --bundle .cache/releases/v0.1.0 --version 0.1.0 --commit <accepted-sha> \
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

Pine stays `source-only`: the GitHub Release includes `VectorTrading.pine` and the
embedded example. TradingView importable publication is a separate authorized manual
Pine Editor operation. Add an actual author/library/version mapping only after its
publication is confirmed; no nonexistent import is advertised.

## Settings recovery

Retain the before/after settings receipt. An authorized recovery may restore individual
merge, Actions, environment, security, or protection settings from it after checking
current organization policy and active releases. Do not disable protections merely
to make CI pass. Making the repository private again does not restore confidentiality
of code or history that was already public. No rollback, tag movement, or registry
mutation is performed by ordinary verification.
