import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { checkRelease } from './check-release.ts';
import {
  assertPublishContext,
  channels,
  identity,
  reconcile,
  repository,
  sha256,
  summarize,
  verifyBundle,
  version,
  type Manifest,
  type Observation,
} from './release-core.ts';
import {
  encodeCrate,
  inspectCrates,
  inspectNpm,
  inspectPypi,
  request,
  verifyReleaseAssets,
} from './release-registry.ts';

const ids = [
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
function content(id: string): string {
  if (id !== 'provenance') return id;
  return JSON.stringify({
    format: 1,
    status: 'committed',
    contractVersion: '1.0.0',
    files: {
      'conformance/rest/cases.json': { sha256: sha256('rest-fixtures') },
      'conformance/signals/cases.json': { sha256: sha256('signal-fixtures') },
      'contracts/rest.openapi.json': { sha256: sha256('rest-contract') },
      'contracts/signals.schema.json': { sha256: sha256('signal-contract') },
    },
  });
}
function fixture(): Manifest {
  const artifacts = ids.map((id) => ({
    id,
    file: id + '.bin',
    sha256: sha256(content(id)),
    bytes: Buffer.byteLength(content(id)),
  }));
  return {
    format: 2,
    repository,
    version: '0.1.0',
    tag: 'v0.1.0',
    goTag: 'go/v0.1.0',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    preview: false,
    verification: 'pnpm verify',
    contract: {
      version: '1.0.0',
      hashes: Object.fromEntries(
        artifacts
          .filter((a) =>
            [
              'provenance',
              'rest-contract',
              'signal-contract',
              'rest-fixtures',
              'signal-fixtures',
            ].includes(a.id),
          )
          .map((a) => [a.id, a.sha256]),
      ),
    },
    pine: 'Vector_Trading_PE/VectorTrading/1',
    artifacts,
  };
}
it('rejects conflicting existing release assets before further publication', async () => {
  const manifest = fixture();
  const digest = sha256('manifest');
  const assets = [{ name: 'npm.bin', browser_download_url: 'https://example.test/npm' }];
  await verifyReleaseAssets(assets, manifest, digest, async () => new Response('npm'));
  await expect(
    verifyReleaseAssets(assets, manifest, digest, async () => new Response('changed')),
  ).rejects.toThrow('Existing release asset differs');
  await expect(
    verifyReleaseAssets(
      [{ ...assets[0]!, name: 'unknown.bin' }],
      manifest,
      digest,
      async () => new Response('npm'),
    ),
  ).rejects.toThrow('Existing release asset differs');
  await expect(
    verifyReleaseAssets([...assets, ...assets], manifest, digest, async () => new Response('npm')),
  ).rejects.toThrow('Existing release asset differs');
  await expect(
    verifyReleaseAssets(
      [{ name: 'manifest.json', browser_download_url: 'https://example.test/manifest' }],
      manifest,
      digest,
      async () => new Response('other manifest'),
    ),
  ).rejects.toThrow('Existing release asset differs');
});
it('rejects changed artifact/hash/version/commit before publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-release-'));
  try {
    const manifest = fixture();
    for (const a of manifest.artifacts) await writeFile(join(directory, a.file), content(a.id));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    const hash = sha256(await readFile(join(directory, 'manifest.json')));
    await verifyBundle(directory, manifest.version, manifest.commit, hash);
    await expect(verifyBundle(directory, '0.2.0', manifest.commit, hash)).rejects.toThrow();
    await expect(verifyBundle(directory, manifest.version, 'd'.repeat(40), hash)).rejects.toThrow();
    await expect(
      verifyBundle(directory, manifest.version, manifest.commit, '0'.repeat(64)),
    ).rejects.toThrow();
    await writeFile(join(directory, 'npm.bin'), 'different');
    await expect(
      verifyBundle(directory, manifest.version, manifest.commit, hash),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('preserves partial success and skips confirmed channels on resume', async () => {
  const state: Record<string, Observation> = {
    npm: 'missing',
    pypi: 'missing',
    crates: 'missing',
    go: 'missing',
  };
  const attempts: Record<string, number> = { npm: 0, pypi: 0, crates: 0, go: 0 };
  const send = async (c: (typeof channels)[number]) =>
    reconcile(
      c,
      'd'.repeat(64),
      async () => state[c]!,
      async () => {
        attempts[c]!++;
        if (c === 'pypi') throw new Error('upload failed');
        state[c] = 'confirmed';
      },
    );
  const first = await Promise.all(channels.map(send));
  expect(summarize(first, 'd'.repeat(64))).toContain('Partial');
  const second = await Promise.all(channels.map(send));
  expect(second.filter((o) => o.status === 'confirmed').every((o) => !o.attempted)).toBe(true);
  expect(attempts).toEqual({ npm: 1, pypi: 2, crates: 1, go: 1 });
  expect(() => summarize(first, 'e'.repeat(64))).toThrow();
});
it('checks after an ambiguous successful upload and never duplicates it', async () => {
  let state: Observation = 'missing';
  let attempts = 0;
  const send = () =>
    reconcile(
      'npm',
      'a'.repeat(64),
      async () => state,
      async () => {
        attempts++;
        state = 'confirmed';
        throw new Error('connection lost after acceptance');
      },
    );
  expect((await send()).status).toBe('confirmed');
  expect((await send()).attempted).toBe(false);
  expect(attempts).toBe(1);
  for (const blocked of ['unknown', 'conflict'] as const) {
    state = blocked;
    expect((await send()).attempted).toBe(false);
  }
  expect(attempts).toBe(1);
});
it('uses actual local registry metadata, including partial Python file availability', async () => {
  const manifest = fixture();
  let scenario = 'matching';
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (scenario === 'absent') {
      res.writeHead(404).end('{}');
      return;
    }
    if (scenario === 'unavailable') {
      res.writeHead(502).end('{}');
      return;
    }
    if (req.url === '/archive') {
      res.end(scenario === 'conflict' ? 'different' : 'npm');
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    if (req.url?.startsWith('/@vector'))
      res.end(
        JSON.stringify({
          name: '@vector-trading/sdk',
          version: '0.1.0',
          dist: { tarball: `http://127.0.0.1:${address.port}/archive` },
        }),
      );
    else if (req.url?.startsWith('/pypi'))
      res.end(
        JSON.stringify({
          info: { name: 'vector-trading-sdk', version: '0.1.0' },
          urls: (scenario === 'partial' ? ['wheel'] : ['wheel', 'sdist']).map((id) => ({
            filename: id + '.bin',
            digests: { sha256: sha256(scenario === 'conflict' ? 'different' : id) },
          })),
        }),
      );
    else
      res.end(
        JSON.stringify({
          version: {
            num: '0.1.0',
            checksum: sha256(scenario === 'conflict' ? 'different' : 'crate'),
            yanked: false,
          },
        }),
      );
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const status of ['matching', 'absent', 'unavailable', 'conflict']) {
      scenario = status;
      const expected = {
        matching: 'confirmed',
        absent: 'missing',
        unavailable: 'unknown',
        conflict: 'conflict',
      }[status];
      expect(await inspectNpm(manifest, origin)).toBe(expected);
      expect((await inspectPypi(manifest, origin)).status).toBe(expected);
      expect(await inspectCrates(manifest, origin)).toBe(expected);
    }
    scenario = 'partial';
    expect(await inspectPypi(manifest, origin)).toEqual({
      status: 'missing',
      missing: ['sdist.bin'],
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it('sends original crate bytes with the documented little-endian framing', () => {
  const metadata = { name: 'vector-trading-sdk', vers: '0.1.0', deps: [] };
  const bytes = Buffer.from([1, 2, 3, 255]);
  const body = encodeCrate(metadata, bytes);
  const size = body.readUInt32LE(0);
  expect(JSON.parse(body.subarray(4, 4 + size).toString())).toEqual(metadata);
  expect(body.readUInt32LE(4 + size)).toBe(bytes.length);
  expect(body.subarray(8 + size)).toEqual(bytes);
});
it('blocks untrusted publication, prepare credentials, rebuilds, and cancellation of running releases', async () => {
  const workflow = parse(
    await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
  );
  checkRelease(workflow);
  for (const mutate of [
    (copy: typeof workflow) => {
      copy.jobs.npm.if = "github.event_name == 'pull_request'";
    },
    (copy: typeof workflow) => {
      copy.permissions['id-token'] = 'write';
    },
    (copy: typeof workflow) => {
      copy.jobs.prepare.environment = 'release';
    },
    (copy: typeof workflow) => {
      copy.jobs.go.permissions['id-token'] = 'write';
    },
    (copy: typeof workflow) => {
      copy.jobs.crates.steps.push({ run: 'cargo publish' });
    },
    (copy: typeof workflow) => {
      copy.concurrency['cancel-in-progress'] = true;
    },
  ]) {
    const copy = structuredClone(workflow);
    mutate(copy);
    expect(() => checkRelease(copy)).toThrow();
  }
  for (const invalid of ['v0.1.0', '01.1.0', '0.1.0\n', '0.1.0;echo', '2.0.0', '0.1.0-beta'])
    expect(() => version(invalid)).toThrow();
});

it('rejects publication from forks, pull requests, other workflows, and arbitrary refs', () => {
  const trusted = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: repository,
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main`,
  };
  assertPublishContext(trusted);
  for (const [key, value] of [
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REF', 'refs/heads/VT-000/sdk-implementation'],
    ['GITHUB_REPOSITORY', 'other/fork'],
    ['GITHUB_WORKFLOW_REF', `${repository}/.github/workflows/ci.yml@refs/heads/main`],
  ] as const)
    expect(() => assertPublishContext({ ...trusted, [key]: value })).toThrow();
});

it('reconciles a registry connection loss after the server receives the upload', async () => {
  let available = false;
  let posts = 0;
  const manifest = fixture();
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        expect(Buffer.concat(chunks).toString()).toBe('npm');
        posts++;
        available = true;
        req.socket.destroy();
      });
      return;
    }
    if (req.url === '/archive') {
      res.end('npm');
      return;
    }
    if (!available) {
      res.writeHead(404).end('{}');
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: '@vector-trading/sdk',
        version: '0.1.0',
        dist: { tarball: `http://127.0.0.1:${address.port}/archive` },
      }),
    );
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const origin = `http://127.0.0.1:${address.port}`;
  const send = () =>
    reconcile(
      'npm',
      'a'.repeat(64),
      () => inspectNpm(manifest, origin),
      async () => {
        await request(origin + '/upload', { method: 'POST', body: 'npm' });
      },
    );
  try {
    expect((await send()).status).toBe('confirmed');
    expect((await send()).attempted).toBe(false);
    expect(posts).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it('rejects legacy release metadata and extra private provenance', () => {
  const manifest = fixture();
  identity(manifest, manifest.version, manifest.commit);
  for (const changed of [
    { ...manifest, format: 1 },
    { ...manifest, contract: { ...manifest.contract, commit: 'c'.repeat(40) } },
    { ...manifest, internalReceipt: 'private' },
  ])
    expect(() => identity(changed as Manifest, manifest.version, manifest.commit)).toThrow(
      'Release identity differs',
    );
});

it('rejects an internal archive member name even when its content and hashes are valid', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'sdk-archive-policy-'));
  const directory = join(parent, 'bundle');
  const input = join(parent, 'input');
  try {
    await mkdir(directory);
    const member = ['apps', 'internal-demo', 'src', 'transport.ts'].join('/');
    await mkdir(join(input, 'apps/internal-demo/src'), { recursive: true });
    await writeFile(join(input, member), 'harmless content');
    const manifest = fixture();
    for (const a of manifest.artifacts) await writeFile(join(directory, a.file), content(a.id));
    const npm = manifest.artifacts.find((a) => a.id === 'npm')!;
    await rm(join(directory, npm.file));
    npm.file = 'npm.tgz';
    execFileSync('tar', ['-czf', join(directory, npm.file), '-C', input, 'apps']);
    const bytes = await readFile(join(directory, npm.file));
    npm.sha256 = sha256(bytes);
    npm.bytes = bytes.length;
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(verifyBundle(directory, manifest.version, manifest.commit)).rejects.toThrow(
      'Public content policy failed',
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
