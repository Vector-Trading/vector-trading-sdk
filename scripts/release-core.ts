import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const repository = 'Vector-Trading/vector-trading-sdk';
export const channels = ['npm', 'pypi', 'crates', 'go'] as const;
export type Channel = (typeof channels)[number];
export type Observation = 'confirmed' | 'missing' | 'unknown' | 'conflict';
export type Artifact = { id: string; file: string; sha256: string; bytes: number };
export interface Manifest {
  format: 1;
  repository: typeof repository;
  version: string;
  tag: string;
  goTag: string;
  commit: string;
  tree: string;
  preview: boolean;
  verification: 'pnpm verify';
  contract: { commit: string; version: string; hashes: Record<string, string> };
  pine: 'source-only';
  artifacts: Artifact[];
}
export interface Outcome {
  channel: Channel;
  manifestSha256: string;
  status: Observation;
  attempted: boolean;
}
export const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export function version(value: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error('Expected an unprefixed stable semantic version');
  // Major 2 needs the separate Go import-path migration agreed in the plan.
  if (Number(value.split('.')[0]) > 1) throw new Error('Go major-version migration is required');
  return value;
}
export function assertPublishContext(env: Record<string, string | undefined>): void {
  if (
    env['GITHUB_EVENT_NAME'] !== 'workflow_dispatch' ||
    env['GITHUB_REF'] !== 'refs/heads/main' ||
    env['GITHUB_REPOSITORY'] !== repository ||
    env['GITHUB_WORKFLOW_REF'] !== `${repository}/.github/workflows/release.yml@refs/heads/main`
  )
    throw new Error('Publication requires the main release workflow');
}
export function identity(
  manifest: Manifest,
  expectedVersion: string,
  expectedCommit: string,
): void {
  version(manifest.version);
  if (
    manifest.format !== 1 ||
    manifest.repository !== repository ||
    manifest.version !== expectedVersion ||
    manifest.commit !== expectedCommit ||
    !/^[a-f\d]{40}$/.test(manifest.commit) ||
    !/^[a-f\d]{40}$/.test(manifest.tree) ||
    manifest.tag !== `v${manifest.version}` ||
    manifest.goTag !== `go/v${manifest.version}` ||
    typeof manifest.preview !== 'boolean' ||
    manifest.verification !== 'pnpm verify' ||
    manifest.pine !== 'source-only' ||
    !/^[a-f\d]{40}$/.test(manifest.contract.commit) ||
    !/^\d+\.\d+\.\d+$/.test(manifest.contract.version)
  )
    throw new Error('Release identity differs');
  const expectedIds = [
    'npm',
    'wheel',
    'sdist',
    'crate',
    'crate-metadata',
    'go',
    'pine-library',
    'pine-example',
    'license',
    'provenance',
    'rest-contract',
    'signal-contract',
    'rest-fixtures',
    'signal-fixtures',
  ];
  if (
    JSON.stringify(manifest.artifacts.map((a) => a.id).sort()) !==
    JSON.stringify(expectedIds.sort())
  )
    throw new Error('Release inventory differs');
  const names = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(artifact.file) ||
      names.has(artifact.file) ||
      !/^[a-f\d]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0
    )
      throw new Error('Invalid release artifact');
    names.add(artifact.file);
  }
  const contractIds = [
    'provenance',
    'rest-contract',
    'signal-contract',
    'rest-fixtures',
    'signal-fixtures',
  ];
  if (
    JSON.stringify(Object.keys(manifest.contract.hashes).sort()) !==
    JSON.stringify(contractIds.sort())
  )
    throw new Error('Contract inventory differs');
  for (const id of contractIds) {
    if (manifest.contract.hashes[id] !== manifest.artifacts.find((a) => a.id === id)?.sha256)
      throw new Error('Contract hashes differ');
  }
}
export function artifact(manifest: Manifest, id: string): Artifact {
  const result = manifest.artifacts.find((a) => a.id === id);
  if (!result) throw new Error('Missing release artifact');
  return result;
}
export async function verifyBundle(
  directory: string,
  expectedVersion: string,
  expectedCommit: string,
  expectedHash?: string,
): Promise<{ manifest: Manifest; digest: string }> {
  const manifestPath = join(directory, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink())
    throw new Error('Manifest must be a regular file');
  const bytes = await readFile(manifestPath);
  const digest = sha256(bytes);
  if (expectedHash !== undefined && digest !== expectedHash)
    throw new Error('Manifest hash differs');
  const manifest = JSON.parse(bytes.toString()) as Manifest;
  identity(manifest, expectedVersion, expectedCommit);
  const expected = ['manifest.json', ...manifest.artifacts.map((a) => a.file)].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected))
    throw new Error('Bundle inventory differs');
  for (const item of manifest.artifacts) {
    const path = join(directory, item.file);
    if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
      throw new Error('Artifact must be a regular file');
    const content = await readFile(path);
    if (content.length !== item.bytes || sha256(content) !== item.sha256)
      throw new Error('Artifact hash differs');
  }
  return { manifest, digest };
}
// An upload attempt is followed by one authoritative read, including after a timeout.
// No outcome receipt is trusted instead of reading the actual registry on resume.
export async function reconcile(
  channel: Channel,
  manifestSha256: string,
  observe: () => Promise<Observation>,
  upload: () => Promise<void>,
): Promise<Outcome> {
  const read = async (): Promise<Observation> => {
    try {
      return await observe();
    } catch {
      return 'unknown';
    }
  };
  const before = await read();
  if (before !== 'missing') return { channel, manifestSha256, status: before, attempted: false };
  try {
    await upload();
  } catch {
    /* Resolve an ambiguous response before any retry. */
  }
  return { channel, manifestSha256, status: await read(), attempted: true };
}
export function summarize(outcomes: Outcome[], digest: string): string {
  if (
    outcomes.some((o) => o.manifestSha256 !== digest) ||
    new Set(outcomes.map((o) => o.channel)).size !== outcomes.length
  )
    throw new Error('Outcome identity differs');
  return channels.every((c) => outcomes.some((o) => o.channel === c && o.status === 'confirmed'))
    ? 'All channels available; public consumer acceptance remains required.'
    : 'Partial release; unconfirmed channels require inspection before continuation.';
}
export async function saveOutcome(path: string, outcome: Outcome): Promise<void> {
  await writeFile(path, JSON.stringify(outcome, null, 2) + '\n', { flag: 'wx' });
}
