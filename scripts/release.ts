import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assertPublishContext,
  channels,
  identity,
  reconcile,
  repository,
  saveOutcome,
  sha256,
  summarize,
  verifyBundle,
  version,
  type Artifact,
  type Manifest,
  type Outcome,
  type Channel,
} from './release-core.ts';
import { github, observe, tagCommit, upload, verifyReleaseAssets } from './release-registry.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'string' },
    bundle: { type: 'string' },
    commit: { type: 'string' },
    'manifest-hash': { type: 'string' },
    'source-run': { type: 'string' },
    channel: { type: 'string' },
    authorize: { type: 'string' },
    preview: { type: 'boolean', default: false },
    bootstrap: { type: 'boolean', default: false },
    outcomes: { type: 'string' },
  },
});
function run(binary: string, args: string[], cwd = root): string {
  try {
    return execFileSync(binary, args, {
      cwd,
      env: { ...process.env, UV_CACHE_DIR: process.env['UV_CACHE_DIR'] ?? join(root, '.cache/uv') },
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Native release command failed: ${binary} ${args[0]}`);
  }
}
const git = (...args: string[]) => run('git', args);
async function output(key: string, value: string): Promise<void> {
  if (process.env['GITHUB_OUTPUT'])
    await appendFile(process.env['GITHUB_OUTPUT'], `${key}=${value}\n`);
  else console.log(`${key}=${value}`);
}
async function aligned(compareInput = true): Promise<string> {
  const selected = JSON.parse(await readFile(join(root, 'release/version.json'), 'utf8')) as {
    version: string;
    pine: string;
  };
  const v = version(selected.version);
  if (selected.pine !== 'Vector_Trading_PE/VectorTrading/1')
    throw new Error('Pine publication mapping is not verified');
  const npm = JSON.parse(await readFile(join(root, 'typescript/package.json'), 'utf8')) as {
    version: string;
  };
  for (const path of ['python/pyproject.toml', 'rust/Cargo.toml']) {
    const text = await readFile(join(root, path), 'utf8');
    if (text.match(/^version = "([^"]+)"$/m)?.[1] !== v) throw new Error('Package versions differ');
  }
  for (const path of ['python/uv.lock', 'rust/Cargo.lock']) {
    const text = await readFile(join(root, path), 'utf8');
    if (text.match(/name = "vector-trading-sdk"\nversion = "([^"]+)"/)?.[1] !== v)
      throw new Error('Locked package version differs');
  }
  if (npm.version !== v || (compareInput && values.version !== undefined && values.version !== v))
    throw new Error('Release version differs');
  return v;
}
async function accepted(commit: string): Promise<void> {
  const main = (await github('commits/main')) as { sha: string };
  const comparison = (await github(`compare/${commit}...${main.sha}`)) as { status: string };
  if (!['identical', 'ahead'].includes(comparison.status))
    throw new Error('Release commit is not accepted into main');
  const runs = (await github(
    `actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&status=success&per_page=100`,
  )) as {
    workflow_runs: { head_sha: string; head_branch: string; conclusion: string; path: string }[];
  };
  if (
    !runs.workflow_runs.some(
      (r) =>
        r.head_sha === commit &&
        r.head_branch === 'main' &&
        r.conclusion === 'success' &&
        r.path === '.github/workflows/ci.yml',
    )
  )
    throw new Error('Release commit has no successful main SDK CI');
}
function trustedDispatch(): void {
  assertPublishContext(process.env);
}
async function loaded(): Promise<{ directory: string; manifest: Manifest; digest: string }> {
  if (
    !values.bundle ||
    !values.version ||
    !values.commit ||
    !values['manifest-hash'] ||
    !/^[a-f\d]{64}$/.test(values['manifest-hash'])
  )
    throw new Error('Exact bundle identity is required');
  const directory = resolve(values.bundle);
  const result = await verifyBundle(
    directory,
    version(values.version),
    values.commit,
    values['manifest-hash'],
  );
  if (result.manifest.preview) throw new Error('Preview artifacts cannot be published');
  if (result.manifest.tree !== git('rev-parse', `${result.manifest.commit}^{tree}`))
    throw new Error('Source tree differs');
  for (const [id, path] of [
    ['provenance', 'contracts/source.json'],
    ['rest-contract', 'contracts/rest.openapi.json'],
    ['signal-contract', 'contracts/signals.schema.json'],
    ['rest-fixtures', 'conformance/rest/cases.json'],
    ['signal-fixtures', 'conformance/signals/cases.json'],
  ]) {
    const source = execFileSync('git', ['show', `${result.manifest.commit}:${path}`], {
      cwd: root,
    });
    if (sha256(source) !== result.manifest.contract.hashes[id!])
      throw new Error('Accepted contract provenance differs');
  }
  // Check existing public bytes before another channel or release note can be changed.
  const prior = (await github(`releases/tags/${result.manifest.tag}`)) as {
    assets: { name: string; browser_download_url: string }[];
  } | null;
  if (prior) await verifyReleaseAssets(prior.assets, result.manifest, result.digest);
  return { directory, ...result };
}
async function prepare(): Promise<void> {
  const v = await aligned();
  const commit = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  if (!values.preview && git('status', '--porcelain'))
    throw new Error('Preparation requires a clean worktree; local preview is explicit');
  const directory = resolve(values.bundle ?? join(root, '.cache/releases', `v${v}`));
  // mkdir without recursive rejects existing frozen output, so a partial release cannot be overwritten.
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  execFileSync('corepack', ['pnpm', 'verify'], { cwd: root, stdio: 'inherit', timeout: 3_600_000 });
  if (!values.preview && (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain')))
    throw new Error('Verified source changed during preparation');
  const artifacts: Artifact[] = [];
  async function add(id: string, source: string, file: string): Promise<void> {
    await copyFile(join(root, source), join(directory, file));
    const bytes = await readFile(join(directory, file));
    artifacts.push({ id, file, sha256: sha256(bytes), bytes: bytes.length });
  }
  for (const [id, source, file] of [
    ['npm', `.cache/packages/vector-trading-sdk-${v}.tgz`, `vector-trading-sdk-${v}.tgz`],
    [
      'wheel',
      `python/dist/vector_trading_sdk-${v}-py3-none-any.whl`,
      `vector_trading_sdk-${v}-py3-none-any.whl`,
    ],
    ['sdist', `python/dist/vector_trading_sdk-${v}.tar.gz`, `vector_trading_sdk-${v}.tar.gz`],
    ['crate', `rust/dist/vector-trading-sdk-${v}.crate`, `vector-trading-sdk-${v}.crate`],
    ['go', `go/dist/vector-trading-sdk-v${v}.zip`, `vector-trading-sdk-v${v}.zip`],
    ['pine-library', 'pinescript/VectorTrading.pine', 'VectorTrading.pine'],
    [
      'pine-example',
      'pinescript/examples/published-open-update.pine',
      'published-open-update.pine',
    ],
    ['license', 'LICENSE', 'LICENSE'],
    ['provenance', 'contracts/source.json', 'contract-source.json'],
    ['rest-contract', 'contracts/rest.openapi.json', 'rest.openapi.json'],
    ['signal-contract', 'contracts/signals.schema.json', 'signals.schema.json'],
    ['rest-fixtures', 'conformance/rest/cases.json', 'rest-cases.json'],
    ['signal-fixtures', 'conformance/signals/cases.json', 'signal-cases.json'],
  ] as const)
    await add(id, source, file);
  const inspected = JSON.parse(
    run(process.env['SDK_PYTHON312'] ?? join(root, 'python/.venv/bin/python'), [
      'scripts/release-inspect.py',
      directory,
      v,
    ]),
  ) as { metadata: unknown; vcs: { git: { sha1: string; dirty?: boolean } } };
  if (inspected.vcs.git.sha1 !== commit || (!values.preview && inspected.vcs.git.dirty))
    throw new Error('Crate source revision differs');
  const metadata = JSON.stringify(inspected.metadata, null, 2) + '\n';
  await writeFile(join(directory, 'crate-metadata.json'), metadata, { flag: 'wx' });
  artifacts.push({
    id: 'crate-metadata',
    file: 'crate-metadata.json',
    sha256: sha256(metadata),
    bytes: Buffer.byteLength(metadata),
  });
  const source = JSON.parse(await readFile(join(root, 'contracts/source.json'), 'utf8')) as {
    contractVersion: string;
  };
  const hashes = Object.fromEntries(
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
  );
  const manifest: Manifest = {
    format: 2,
    repository,
    version: v,
    tag: `v${v}`,
    goTag: `go/v${v}`,
    commit,
    tree,
    preview: values.preview,
    verification: 'pnpm verify',
    contract: { version: source.contractVersion, hashes },
    pine: 'Vector_Trading_PE/VectorTrading/1',
    artifacts,
  };
  identity(manifest, v, commit);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  const verified = await verifyBundle(directory, v, commit);
  await output('version', v);
  await output('commit', commit);
  await output('manifest-sha256', verified.digest);
  console.log(
    `Prepared ${manifest.artifacts.length} frozen artifacts; Pine sources with a pinned TradingView import; no publication.`,
  );
}
async function gate(): Promise<void> {
  trustedDispatch();
  if (!values['source-run'] || !/^[1-9]\d*$/.test(values['source-run']))
    throw new Error('Completed prepare run is required');
  const source = (await github(`actions/runs/${values['source-run']}`)) as {
    head_sha: string;
    head_branch: string;
    event: string;
    conclusion: string;
    path: string;
  };
  if (
    source.path !== '.github/workflows/release.yml' ||
    source.head_branch !== 'main' ||
    source.event !== 'workflow_dispatch' ||
    source.conclusion !== 'success'
  )
    throw new Error('Source must be a successful main prepare run');
  await accepted(source.head_sha);
  const jobs = (await github(`actions/runs/${values['source-run']}/jobs?per_page=100`)) as {
    jobs: { name: string; conclusion: string }[];
  };
  if (!jobs.jobs.some((job) => job.name === 'prepare' && job.conclusion === 'success'))
    throw new Error('Source prepare job is not successful');
  if (!values.bundle) throw new Error('Bundle destination is required');
  run('gh', [
    'run',
    'download',
    values['source-run'],
    '--repo',
    repository,
    '--name',
    'sdk-release',
    '--dir',
    resolve(values.bundle),
  ]);
  values.commit = source.head_sha;
  const { manifest, digest } = await loaded();
  if (manifest.tree !== git('rev-parse', `${source.head_sha}^{tree}`)) {
    // Checkout may be newer main; fetch exactly the accepted source before testing its tree.
    throw new Error('Source tree differs; fetch the accepted prepare commit');
  }
  await output('commit', source.head_sha);
  await output('version', manifest.version);
  await output('manifest-sha256', digest);
}
async function channel(): Promise<void> {
  const { directory, manifest, digest } = await loaded();
  if (!channels.includes(values.channel as Channel) || values.authorize !== manifest.tag)
    throw new Error('Explicit channel and version authorization are required');
  const target = values.channel as Channel;
  if (values.bootstrap && !['npm', 'crates'].includes(target))
    throw new Error('Only npm/crates.io require first-upload bootstrap');
  if (!values.bootstrap) trustedDispatch();
  else if (git('rev-parse', 'HEAD') !== manifest.commit || git('status', '--porcelain'))
    throw new Error('Bootstrap requires the clean accepted source checkout');
  else if (process.env['GITHUB_ACTIONS'])
    throw new Error('First-upload bootstrap is a separate interactive maintainer operation');
  await accepted(manifest.commit);

  const result = await reconcile(
    target,
    digest,
    () => observe(target, manifest),
    () => upload(target, manifest, directory, values.bootstrap),
  );
  const out = resolve(values.outcomes ?? join(root, '.cache/release-outcomes'));
  await mkdir(out, { recursive: true });
  await saveOutcome(join(out, `${target}.json`), result);
  console.log(`${target}: ${result.status}; attempted=${String(result.attempted)}`);
  if (result.status !== 'confirmed') process.exitCode = 1;
}
async function notes(): Promise<void> {
  trustedDispatch();
  const { directory, manifest, digest } = await loaded();
  await accepted(manifest.commit);
  const results: Outcome[] = [];
  // Published receipts describe attempts; fresh registry observations determine the release note.
  for (const target of channels) {
    let status: Outcome['status'] = 'unknown';
    try {
      status = await observe(target, manifest);
    } catch {
      /* Keep unconfirmed outcomes explicit. */
    }
    results.push({ channel: target, manifestSha256: digest, status, attempted: false });
  }
  const conclusion = summarize(results, digest);
  const body = [
    `${conclusion}`,
    `Commit: ${manifest.commit}`,
    `Manifest SHA-256: ${digest}`,
    ...results.map((o) => `- ${o.channel}: ${o.status}`),
    'Pine import: Vector_Trading_PE/VectorTrading/1; VectorTrading.pine and published-open-update.pine are attached.',
    'Registry availability is verified here. Public installed-consumer acceptance is recorded separately in STEP-12.',
  ].join('\n');
  const out = resolve(values.outcomes ?? join(root, '.cache/release-outcomes'));
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify({ manifestSha256: digest, results, conclusion }, null, 2) + '\n',
    { flag: 'wx' },
  );
  if (process.env['GITHUB_STEP_SUMMARY'])
    await appendFile(process.env['GITHUB_STEP_SUMMARY'], body + '\n');
  if ((await tagCommit(manifest.tag)) !== manifest.commit)
    throw new Error('Release tag is not confirmed; summary artifact retains partial status');
  const prior = (await github(`releases/tags/${manifest.tag}`)) as {
    id: number;
    assets: { name: string; browser_download_url: string }[];
  } | null;
  const noteFile = join(out, 'notes.md');
  await writeFile(noteFile, body + '\n');
  if (prior)
    run('gh', ['release', 'edit', manifest.tag, '--repo', repository, '--notes-file', noteFile]);
  else
    run('gh', [
      'release',
      'create',
      manifest.tag,
      '--repo',
      repository,
      '--verify-tag',
      '--title',
      `Vector Trading SDK ${manifest.version}`,
      '--notes-file',
      noteFile,
    ]);
  const release = (await github(`releases/tags/${manifest.tag}`)) as {
    assets: { name: string; browser_download_url: string }[];
  };
  for (const name of ['manifest.json', ...manifest.artifacts.map((a) => a.file)]) {
    const existing = release.assets.find((a) => a.name === name);
    const expected =
      name === 'manifest.json' ? digest : manifest.artifacts.find((a) => a.file === name)!.sha256;
    if (existing) {
      const response = await fetch(existing.browser_download_url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok || sha256(new Uint8Array(await response.arrayBuffer())) !== expected)
        throw new Error('Existing release asset differs');
    } else
      run('gh', ['release', 'upload', manifest.tag, join(directory, name), '--repo', repository]);
  }
  console.log(conclusion);
  if (results.some((o) => o.status !== 'confirmed')) process.exitCode = 1;
}
async function setVersion(): Promise<void> {
  if (!values.version) throw new Error('Version is required');
  const v = version(values.version);
  if (process.env['GITHUB_ACTIONS'])
    throw new Error('Version changes belong in a reviewed source change');
  await aligned(false);
  const paths = [
    'release/version.json',
    'typescript/package.json',
    'python/pyproject.toml',
    'python/uv.lock',
    'rust/Cargo.toml',
    'rust/Cargo.lock',
  ];
  const before = await Promise.all(paths.map((path) => readFile(join(root, path))));
  try {
    const pkgPath = join(root, 'typescript/package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    pkg['version'] = v;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    for (const path of ['python/pyproject.toml', 'rust/Cargo.toml']) {
      const full = join(root, path);
      const text = await readFile(full, 'utf8');
      await writeFile(full, text.replace(/^version = "[^"]+"$/m, `version = "${v}"`));
    }
    await writeFile(
      join(root, 'release/version.json'),
      JSON.stringify({ version: v, pine: 'Vector_Trading_PE/VectorTrading/1' }, null, 2) + '\n',
    );
    run('uv', ['lock'], join(root, 'python'));
    run(
      process.env['SDK_CARGO'] ?? 'cargo',
      ['+1.99.0', 'update', '--package', 'vector-trading-sdk', '--offline'],
      join(root, 'rust'),
    );
    await aligned();
  } catch (error) {
    for (const [index, path] of paths.entries()) await writeFile(join(root, path), before[index]!);
    throw error;
  }
  console.log(
    'Package versions updated; review lockfile changes and run full verification before commit.',
  );
}
try {
  if (positionals[0] === 'prepare') await prepare();
  else if (positionals[0] === 'gate') await gate();
  else if (positionals[0] === 'channel') await channel();
  else if (positionals[0] === 'notes') await notes();
  else if (positionals[0] === 'check-version') console.log(await aligned());
  else if (positionals[0] === 'set-version') await setVersion();
  else if (positionals[0] === 'verify') {
    if (!values.bundle || !values.version || !values.commit)
      throw new Error('Bundle identity is required');
    console.log(
      (
        await verifyBundle(
          resolve(values.bundle),
          values.version,
          values.commit,
          values['manifest-hash'],
        )
      ).digest,
    );
  } else
    throw new Error(
      'Expected prepare, verify, check-version, set-version, gate, channel, or notes',
    );
} catch (error) {
  if (error instanceof Error && !('stdout' in error) && !('stderr' in error))
    console.error(error.message);
  // Do not stringify subprocess errors: they can contain publishing credentials.
  console.error(
    'Release operation failed. Check the documented identity, source/CI, artifact and registry prerequisites; no automatic retry.',
  );
  process.exitCode = 1;
}
