---
name: sdk-release
description: 'Prepare and release Vector Trading SDK packages, GitHub Actions, and repository settings: versions, registries, trusted publishing, and partial-release recovery.'
---

# SDK releases

Read `AGENTS.md`; check for `docs/releasing.md`, GitHub Actions workflows, and release documentation, then read existing materials. Do not treat missing target files as ready. First establish whether preparation, settings changes, or actual publication is authorized: a release plan does not authorize external actions. When continuing a partial release, do not reconfigure infrastructure that is already sufficient.

## Preparation and GitHub

- A release consists of fixed commits, a version, a contract snapshot, and verified artifacts for four packages. Ordinary builds and pull requests do not publish packages.
- The root Node package is private and is never published. Language registries are npm, PyPI, and crates.io; Go is distributed as a public GitHub module.
- Review content, history and actual archives before changing visibility. Run `pnpm public:check`; credential scanning alone does not detect private implementation metadata. Keep internal source inventories, personal paths and account configuration in the private maintainer workspace. Do not hide real secrets merely with `.gitignore`; stop publication and agree on specific recovery. Automatic history rewriting is not part of an ordinary release.
- Check GitHub settings through its API and preserve organizational restrictions. Workflow permissions must be minimal; untrusted pull request code must not receive publication secrets. Do not use `pull_request_target` to execute external PR code.
- Pin Actions dependencies by commit SHA and the generator by version and digest/checksum. OIDC trusted publishing must bind the exact owner, repository, workflow, and environment; grant `id-token: write` only to the publishing job.
- Create and verify actual CI checks before requiring them in `main` protection. Do not require nonexistent checks or invent a mandatory reviewer; use confirmed owners.
- Use organization registry accounts and verified names and permissions. Check current first-publication requirements; if OIDC requires an existing package, perform only an authorized initial creation with minimal temporary permissions and document the result.

## Versions and execution

1. Check the version in every package manifest against the target release and contract provenance. `v0.x.y` is the shared tag; a Go subdirectory also requires `go/v0.x.y` at the same commit. Go major 2 changes the module path.
2. Build and verify every artifact before the first publication. Install them in clean consumer projects; prepare release notes with hashes and provenance. Do not rebuild from another commit after partial success.
3. Execute only authorized channels and record each confirmation. Tags are also public effects; do not create them as part of routine verification.
4. After each channel, verify version availability and consumption through the actual registry/proxy. Successful CLI completion alone does not prove external state.
5. Report partial success explicitly. After a timeout, read registry state first; retry only missing publications with the same artifact when registry rules allow it. If the result remains ambiguous, the original artifact is unavailable, or its hash differs, stop the affected publication and record missing evidence. Do not poll indefinitely or replace the original commit with a new `main` state.
6. Fix published code with a new version. Do not reuse names/versions, move published tags, or promise a shared registry rollback.

## Pine and completion

- Include Pine sources and examples in GitHub Releases as backup storage. TradingView importable-library publication is a separate manual Pine Editor process; use `pine-signals`.
- Record the Pine publication version and its commit mapping only after confirmation. Do not put a nonexistent import path in the README.
- Update the guide and release notes, including skipped channels, external limitations, and safe continuation. Do not claim overall release success until every required channel is accepted and verified.
