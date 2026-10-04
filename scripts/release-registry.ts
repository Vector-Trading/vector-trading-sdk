import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifact,
  repository,
  sha256,
  type Manifest,
  type Observation,
  type Channel,
} from './release-core.ts';

const userAgent =
  'vector-trading-sdk-release (https://github.com/Vector-Trading/vector-trading-sdk)';
export async function request(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
    headers: { 'user-agent': userAgent, ...options.headers },
  });
}
export async function github(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const token = process.env['GH_TOKEN'];
  const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub operation could not be confirmed');
  return response.status === 204 ? {} : await response.json();
}
export async function verifyReleaseAssets(
  assets: { name: string; browser_download_url: string }[],
  manifest: Manifest,
  digest: string,
  download: (url: string) => Promise<Response> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(60_000) }),
): Promise<void> {
  const expected = new Map([
    ['manifest.json', digest],
    ...manifest.artifacts.map((a): [string, string] => [a.file, a.sha256]),
  ]);
  const seen = new Set<string>();
  for (const asset of assets) {
    const hash = expected.get(asset.name);
    if (!hash || seen.has(asset.name)) throw new Error('Existing release asset differs');
    seen.add(asset.name);
    const response = await download(asset.browser_download_url);
    if (!response.ok || sha256(new Uint8Array(await response.arrayBuffer())) !== hash)
      throw new Error('Existing release asset differs');
  }
}
export async function inspectNpm(
  manifest: Manifest,
  endpoint = 'https://registry.npmjs.org',
): Promise<Observation> {
  const response = await request(`${endpoint}/@vector-trading%2fsdk/${manifest.version}`);
  if (response.status === 404) return 'missing';
  if (!response.ok) return 'unknown';
  const data = (await response.json()) as {
    name?: string;
    version?: string;
    dist?: { tarball?: string };
  };
  if (
    data.name !== '@vector-trading/sdk' ||
    data.version !== manifest.version ||
    !data.dist?.tarball
  )
    return 'conflict';
  const url = new URL(data.dist.tarball);
  if (url.origin !== new URL(endpoint).origin) return 'conflict';
  const archive = await request(url.href);
  if (!archive.ok) return 'unknown';
  return sha256(new Uint8Array(await archive.arrayBuffer())) === artifact(manifest, 'npm').sha256
    ? 'confirmed'
    : 'conflict';
}
export async function inspectPypi(
  manifest: Manifest,
  endpoint = 'https://pypi.org',
): Promise<{ status: Observation; missing: string[] }> {
  const wanted = ['wheel', 'sdist'].map((id) => artifact(manifest, id));
  const response = await request(`${endpoint}/pypi/vector-trading-sdk/${manifest.version}/json`);
  if (response.status === 404) return { status: 'missing', missing: wanted.map((a) => a.file) };
  if (!response.ok) return { status: 'unknown', missing: [] };
  const data = (await response.json()) as {
    info?: { name?: string; version?: string };
    urls?: { filename: string; digests?: { sha256?: string } }[];
  };
  if (
    data.info?.name !== 'vector-trading-sdk' ||
    data.info?.version !== manifest.version ||
    !Array.isArray(data.urls)
  )
    return { status: 'conflict', missing: [] };
  if (
    data.urls.some(
      (remote) =>
        !wanted.some((a) => a.file === remote.filename && a.sha256 === remote.digests?.sha256),
    )
  )
    return { status: 'conflict', missing: [] };
  const missing = wanted
    .filter((a) => !data.urls!.some((remote) => remote.filename === a.file))
    .map((a) => a.file);
  return { status: missing.length ? 'missing' : 'confirmed', missing };
}
export async function inspectCrates(
  manifest: Manifest,
  endpoint = 'https://crates.io',
): Promise<Observation> {
  const response = await request(
    `${endpoint}/api/v1/crates/vector-trading-sdk/${manifest.version}`,
  );
  if (response.status === 404) return 'missing';
  if (!response.ok) return 'unknown';
  const data = (await response.json()) as {
    version?: { num?: string; checksum?: string; yanked?: boolean };
  };
  return data.version?.num === manifest.version &&
    data.version.checksum === artifact(manifest, 'crate').sha256 &&
    data.version.yanked === false
    ? 'confirmed'
    : 'conflict';
}
export async function tagCommit(tag: string): Promise<string | null> {
  const ref = (await github(`git/ref/tags/${encodeURIComponent(tag)}`)) as {
    object: { type: string; sha: string };
  } | null;
  if (!ref) return null;
  // Release tooling creates lightweight immutable refs; do not reinterpret another tag.
  if (ref.object.type !== 'commit') throw new Error('Existing tag is not a release commit ref');
  return ref.object.sha;
}
export async function inspectGo(manifest: Manifest): Promise<Observation> {
  const refs = await Promise.all([tagCommit(manifest.tag), tagCommit(manifest.goTag)]);
  if (refs.some((ref) => ref !== null && ref !== manifest.commit)) return 'conflict';
  if (refs.some((ref) => ref === null)) return 'missing';
  const url = `https://proxy.golang.org/github.com/!vector-!trading/vector-trading-sdk/go/@v/v${manifest.version}.info`;
  const response = await request(url);
  if (!response.ok) return 'unknown';
  const info = (await response.json()) as { Version?: string; Origin?: { Hash?: string } };
  // The immutable refs establish source identity; archive/proxy consumers are STEP-12 acceptance.
  return info.Version === `v${manifest.version}` &&
    (!info.Origin?.Hash || info.Origin.Hash === manifest.commit)
    ? 'confirmed'
    : 'conflict';
}
export async function observe(channel: Channel, manifest: Manifest): Promise<Observation> {
  if (channel === 'npm') return inspectNpm(manifest);
  if (channel === 'pypi') return (await inspectPypi(manifest)).status;
  if (channel === 'crates') return inspectCrates(manifest);
  return inspectGo(manifest);
}
export function encodeCrate(metadata: unknown, bytes: Uint8Array): Buffer {
  const json = Buffer.from(JSON.stringify(metadata));
  const first = Buffer.alloc(4);
  first.writeUInt32LE(json.length);
  const second = Buffer.alloc(4);
  second.writeUInt32LE(bytes.length);
  return Buffer.concat([first, json, second, bytes]);
}
async function crateToken(): Promise<string> {
  const address = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const authorization = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!address || !authorization)
    throw new Error('crates.io OIDC is unavailable; use the documented first-upload bootstrap');
  const url = new URL(address);
  url.searchParams.set('audience', 'crates.io');
  const jwtResponse = await request(url.href, {
    headers: { Authorization: `Bearer ${authorization}` },
  });
  if (!jwtResponse.ok) throw new Error('OIDC exchange failed');
  const jwt = (await jwtResponse.json()) as { value?: string };
  if (!jwt.value) throw new Error('OIDC exchange failed');
  const minted = await request('https://crates.io/api/v1/trusted_publishing/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jwt: jwt.value }),
  });
  if (!minted.ok)
    throw new Error('crates.io trust is unavailable; complete the first-upload bootstrap');
  const result = (await minted.json()) as { token?: string };
  if (!result.token) throw new Error('OIDC exchange failed');
  return result.token;
}
export async function upload(
  channel: Channel,
  manifest: Manifest,
  directory: string,
  bootstrap = false,
): Promise<void> {
  const run = (binary: string, args: string[], env = process.env): void => {
    // Never include raw CLI diagnostics, tokens or account configuration in receipts.
    execFileSync(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  };
  if (channel === 'npm') {
    if (!bootstrap && !process.env['ACTIONS_ID_TOKEN_REQUEST_URL'])
      throw new Error('npm OIDC is unavailable');
    run('npm', [
      'publish',
      join(directory, artifact(manifest, 'npm').file),
      '--access',
      'public',
      '--ignore-scripts',
      '--fetch-retries=0',
      '--registry',
      'https://registry.npmjs.org',
    ]);
  } else if (channel === 'pypi') {
    const state = await inspectPypi(manifest);
    if (state.status !== 'missing') throw new Error('PyPI upload is not currently missing');
    for (const file of state.missing) {
      run('uv', ['publish', '--trusted-publishing', 'always', join(directory, file)], {
        ...process.env,
        UV_HTTP_RETRIES: '0',
      });
    }
  } else if (channel === 'crates') {
    const token = bootstrap ? process.env['CARGO_REGISTRY_TOKEN'] : await crateToken();
    if (!token) throw new Error('Restricted first-upload token is required');
    try {
      const bytes = await readFile(join(directory, artifact(manifest, 'crate').file));
      const metadata = JSON.parse(
        await readFile(join(directory, artifact(manifest, 'crate-metadata').file), 'utf8'),
      ) as unknown;
      const response = await request('https://crates.io/api/v1/crates/new', {
        method: 'PUT',
        headers: {
          Authorization: token,
          'content-type': 'application/octet-stream',
          Accept: 'application/json',
        },
        body: new Uint8Array(encodeCrate(metadata, bytes)),
      });
      if (!response.ok) throw new Error('Crate upload could not be confirmed');
      const result = (await response.json()) as { errors?: unknown };
      if (result.errors) throw new Error('Crate upload could not be confirmed');
    } finally {
      if (!bootstrap) {
        // Even if revocation fails, reconciliation still checks the upload outcome.
        const response = await request('https://crates.io/api/v1/trusted_publishing/tokens', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Short-lived token revocation needs inspection');
      }
    }
  } else {
    for (const tag of [manifest.tag, manifest.goTag]) {
      const prior = await tagCommit(tag);
      if (prior !== null && prior !== manifest.commit) throw new Error('Public tag differs');
      if (prior === null)
        await github('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: manifest.commit });
      if ((await tagCommit(tag)) !== manifest.commit)
        throw new Error('Public tag could not be confirmed');
    }
  }
}
