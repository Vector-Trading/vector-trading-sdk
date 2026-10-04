import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const crate = join(root, 'rust');
const cargo = process.env['SDK_CARGO'] ?? 'cargo';
const action = process.argv[2];
if (!action || !['test', 'build', 'package'].includes(action))
  throw new Error('Usage: check.ts test|build|package');
const versions = ['1.99.0', '1.88.0'];
function run(version: string, args: string[], cwd = crate, env = process.env): string {
  return execFileSync(cargo, [`+${version}`, ...args, '--offline'], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 300_000,
  });
}
for (const version of versions) {
  const actual = execFileSync(cargo, [`+${version}`, '--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (!actual.startsWith(`cargo ${version} `)) throw new Error(`Expected Cargo ${version}`);
  if (action === 'test') {
    // Clippy's arguments follow --, so Cargo's offline flag belongs before it.
    execFileSync(cargo, [`+${version}`, 'fmt', '--check'], {
      cwd: crate,
      stdio: 'inherit',
      timeout: 60_000,
    });
    execFileSync(
      cargo,
      [
        `+${version}`,
        'clippy',
        '--locked',
        '--all-targets',
        '--all-features',
        '--offline',
        '--',
        '-D',
        'warnings',
      ],
      { cwd: crate, stdio: 'inherit', timeout: 300_000 },
    );
    const result = run(version, ['test', '--locked', '--all-features']);
    console.log(
      `Rust ${version}: ${result
        .split('\n')
        .filter((line) => line.startsWith('test result:'))
        .join('; ')}`,
    );
  } else if (action === 'build') {
    run(version, ['build', '--locked', '--all-targets']);
  }
}
if (action === 'package') {
  await packageCheck();
}
async function packageCheck(): Promise<void> {
  await mkdir(join(crate, 'dist'), { recursive: true });
  let sourceHash: string | undefined;
  for (const version of versions) {
    run(version, ['package', '--locked', '--allow-dirty']);
    const target = process.env['CARGO_TARGET_DIR'] ?? join(crate, 'target');
    const archive = join(target, 'package/vector-trading-sdk-0.1.0.crate');
    const firstHash = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    // Cargo's dry run queries registry metadata even with prepared dependencies.
    execFileSync(cargo, [`+${version}`, 'publish', '--dry-run', '--locked', '--allow-dirty'], {
      cwd: crate,
      stdio: 'inherit',
      timeout: 300_000,
    });
    const bytes = await readFile(archive);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (firstHash !== hash) throw new Error('Repeated packaging differs on the same toolchain');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    const allowed =
      /^vector-trading-sdk-0\.1\.0\/(Cargo\.(toml(?:\.orig)?|lock)|LICENSE|README\.md|\.cargo_vcs_info\.json|src\/[^/]+\.rs|generated\/(contract\.json|src\/models\/[^/]+\.rs)|examples\/[^/]+\.rs)$/;
    if (!entries.every((entry) => allowed.test(entry)))
      throw new Error('Unexpected crate archive file');
    for (const required of [
      'Cargo.toml',
      'Cargo.lock',
      'LICENSE',
      'README.md',
      'src/lib.rs',
      'generated/contract.json',
      'examples/integration.rs',
    ]) {
      if (!entries.includes(`vector-trading-sdk-0.1.0/${required}`))
        throw new Error(`Missing ${required}`);
    }
    // Cargo versions use different tar timestamps for normalized manifests;
    // compare every file payload across compilers, and archive bytes within each.
    const digest = createHash('sha256');
    for (const entry of entries.toSorted()) {
      digest
        .update(entry)
        .update('\0')
        .update(execFileSync('tar', ['-xOf', archive, entry]));
    }
    const payloadHash = digest.digest('hex');
    if (sourceHash !== undefined && sourceHash !== payloadHash)
      throw new Error('Archive sources differ between toolchains');
    sourceHash = payloadHash;
    const filename =
      version === versions[0]
        ? 'vector-trading-sdk-0.1.0.crate'
        : `vector-trading-sdk-0.1.0-rust-${version}.crate`;
    await copyFile(archive, join(crate, 'dist', filename));
    await consumer(version, archive);
    console.log(
      `Rust ${version}: clean archive consumer passed; ${entries.length} files; SHA-256 ${hash}`,
    );
  }
}
async function consumer(version: string, archive: string): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-rust-consumer-'));
  const account = 'vt_synthetic_consumer_account';
  const strategy = '7ab97361321c46f2bc7300a04fd6d133';
  const otherStrategy = '8ab97361321c46f2bc7300a04fd6d133';
  const bundle = '2be97361321c46f2bc7300a04fd6d133';
  const user = '3ce97361321c46f2bc7300a04fd6d244';
  const checkout = '6fe97361321c46f2bc7300a04fd6d577';
  interface Fixture {
    operationId: string;
    expectedStatus: number;
    request: { method: string; path: string };
    response: unknown;
  }
  const cases = JSON.parse(
    await readFile(join(root, 'conformance/rest/cases.json'), 'utf8'),
  ) as Fixture[];
  const received: { path: string; body: string }[] = [];
  let failure: Error | undefined;
  const server = createServer(async (request, response) => {
    try {
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.from(chunk as Uint8Array));
      const body = Buffer.concat(buffers).toString();
      const path = new URL(request.url ?? '', 'http://localhost').pathname;
      received.push({ path, body });
      if (path.startsWith('/webhooks/')) {
        if (
          ![strategy, otherStrategy].some((key) => path === `/webhooks/signals/v1/${key}`) ||
          request.headers.authorization !== undefined ||
          request.method !== 'POST'
        )
          throw new Error('Signal credentials/method');
        const signal = JSON.parse(body) as {
          action: string;
          timestamp: string;
          order?: { takeProfits?: unknown[] };
        };
        if (typeof signal.timestamp !== 'string') throw new Error('Timestamp is not a string');
        if (signal.action === 'open' && Object.hasOwn(signal.order ?? {}, 'takeProfits'))
          throw new Error('Open TP omission lost');
        if (signal.action === 'update' && JSON.stringify(signal.order?.takeProfits) !== '[]')
          throw new Error('Update TP clearing lost');
        response.writeHead(204).end();
      } else {
        if (request.headers.authorization !== `Bearer ${account}`)
          throw new Error('REST credentials');
        const fixture = cases.find(
          (c) =>
            c.expectedStatus === 200 &&
            c.request.method === request.method &&
            `/api/rest${c.request.path}` === path,
        );
        if (!fixture) throw new Error('Unknown operation');
        if (fixture.operationId === 'createBundleGrant') {
          const grant = JSON.parse(body) as { sourceId: string; grantType: string };
          if (grant.sourceId !== 'example:invoice-1' || grant.grantType !== 'paid_external')
            throw new Error('Grant body');
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(fixture.response));
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Receiver failed');
      response.writeHead(500).end('{}');
    }
  });
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temp]);
    const sdk = join(temp, 'vector-trading-sdk-0.1.0');
    const project = join(temp, 'consumer');
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(
      join(project, 'Cargo.toml'),
      `[package]\nname="archive-consumer"\nversion="0.0.0"\nedition="2021"\nrust-version="1.88"\n[dependencies]\nvector-trading-sdk={path=${JSON.stringify(sdk)}}\ntokio={version="=1.53.2",features=["macros","rt-multi-thread","time"]}\n`,
    );
    await copyFile(join(sdk, 'examples/integration.rs'), join(project, 'src/main.rs'));
    const metadata = JSON.parse(
      run(version, ['metadata', '--format-version=1', '--no-deps'], project),
    ) as { packages: { name: string; dependencies: { name: string; kind: string | null }[] }[] };
    if (!metadata.packages.some((p) => p.name === 'archive-consumer'))
      throw new Error('Wrong consumer');
    run(version, ['generate-lockfile'], project);
    const fullMetadata = JSON.parse(
      run(version, ['metadata', '--format-version=1', '--locked'], project),
    ) as {
      packages: {
        name: string;
        manifest_path: string;
        license: string;
        dependencies: {
          name: string;
          kind: string | null;
          features: string[];
          uses_default_features: boolean;
        }[];
      }[];
    };
    const installed = fullMetadata.packages.find((p) => p.name === 'vector-trading-sdk');
    if (
      !installed ||
      installed.manifest_path !== join(sdk, 'Cargo.toml') ||
      installed.license !== 'MIT'
    )
      throw new Error('SDK did not install from extracted archive');
    const direct = installed.dependencies
      .filter((d) => d.kind === null)
      .map((d) => d.name)
      .sort();
    if (
      JSON.stringify(direct) !==
      JSON.stringify(['reqwest', 'serde', 'serde_json', 'serde_with', 'time'])
    )
      throw new Error('Unexpected direct runtime dependency');
    const reqwest = installed.dependencies.find((d) => d.name === 'reqwest');
    if (
      !reqwest ||
      reqwest.uses_default_features ||
      JSON.stringify(reqwest.features.toSorted()) !== JSON.stringify(['query', 'rustls'])
    )
      throw new Error('Unexpected reqwest features');
    const graph = run(version, ['tree', '--locked', '--edges=normal', '--prefix=none'], project);
    if (/serde_repr|serde_with_macros|vector-trading\/|http2|system-proxy/.test(graph))
      throw new Error('Unexpected runtime graph');
    run(version, ['build', '--locked'], project);
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Receiver address');
    const env = {
      ...process.env,
      VECTOR_ORIGIN: `http://127.0.0.1:${address.port}`,
      VECTOR_LOCAL_TEST: '1',
      VECTOR_ACCOUNT_KEY: account,
      VECTOR_STRATEGY_KEY: strategy,
      VECTOR_OTHER_STRATEGY_KEY: otherStrategy,
      VECTOR_BUNDLE_ID: bundle,
      VECTOR_USER_ID: user,
      VECTOR_CHECKOUT_ID: checkout,
    };
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(cargo, [`+${version}`, 'run', '--locked', '--offline'], {
        cwd: project,
        env,
        stdio: 'inherit',
        timeout: 120_000,
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolveRun() : reject(new Error('Archive consumer failed')),
      );
    });
    if (failure) throw failure;
    if (
      received.length !== 15 ||
      ![strategy, otherStrategy].every((key) =>
        received.some((r) => r.path === `/webhooks/signals/v1/${key}`),
      ) ||
      new Set(
        received
          .filter((r) => r.path.startsWith('/webhooks/'))
          .map((r) => (JSON.parse(r.body) as { action: string }).action),
      ).size !== 8
    )
      throw new Error('Consumer API coverage');
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
    await rm(temp, { recursive: true, force: true });
  }
}
