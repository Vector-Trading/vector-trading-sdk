# Release preparation and access

## Current readiness

SDK packages are locally verified and remain unpublished. The user authorized the first
PyPI publication on 2026-10-04; that approval is retained for the verified release after
its prerequisites pass. It does not itself establish release readiness or authorize
publication in the other registries. STEP-10 prepares repository
and registry access; STEP-11 owns the release workflow and recovery tooling; STEP-12
owns the first actual upload and public tags. There is currently no release workflow
or `release/version.json`. Do not infer permission to publish from this guide.

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
is deferred until their actual first uploads; the bootstrap identities are confirmed. A saved entry is not evidence of a working workflow. STEP-11
must implement and verify that exact file before use.
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

## Release boundaries and partial success

Before a separately authorized release, complete STEP-11's prepare run and recovery
checks, integrate the exact commit into `main`, verify green CI, align every package
version, and build all artifacts once with hashes and contract provenance. Reuse the
same verified artifacts for all channels and any continuation. Pine source/library and
embedded example belong in the GitHub Release; TradingView importable publication is
separate and must use actual editor evidence. Source-only distribution is explicit.

After an ambiguous upload, inspect registry state before retrying. Record each
confirmed channel independently; resume only missing channels. If PyPI succeeds and
npm fails, the release is partial. Do not claim overall success, delete a successful
version, rebuild from another commit, move public tags, or overwrite published versions.
Fix released defects with a new version.

## Settings recovery

Retain the before/after settings receipt. An authorized recovery may restore individual
merge, Actions, environment, security, or protection settings from it after checking
current organization policy and active releases. Do not disable protections merely
to make CI pass. Making the repository private again does not restore confidentiality
of code or history that was already public. No rollback, tag movement, or registry
mutation is performed by ordinary verification.
