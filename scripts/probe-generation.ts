import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, languages, readJson, compareGenerated, generatedPath } from './generation.ts';
import { checkContracts } from './check-contracts.ts';

await checkContracts();
await compareGenerated();
const tools = await readJson<{ rust: string; rustMSRV: string; go: string }>(
  join(root, 'generation/toolchains.json'),
);
const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-native-probes-'));
const python = process.env['SDK_PROBE_PYTHON'] ?? join(root, '.cache/generation/venv/bin/python');
const cargo = process.env['SDK_PROBE_CARGO'] ?? 'cargo';
const go = process.env['SDK_PROBE_GO'] ?? 'go';
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  try {
    const output = execFileSync(command, args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
    }).trim();
    if (output) console.log(output);
    return output;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stderr' in error)
      console.error(String(error.stderr));
    throw error;
  }
}
try {
  for (const language of languages)
    await cp(generatedPath(language), join(temp, language), {
      recursive: true,
    });
  await cp(join(root, 'generation/probes/typescript.mts'), join(temp, 'typescript/probe.mts'));
  await writeFile(join(temp, 'typescript/package.json'), '{"type":"module"}\n');
  run(
    join(root, 'node_modules/.bin/tsc'),
    [
      '--ignoreConfig',
      '--target',
      'ES2024',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'ES2024,DOM,DOM.Iterable',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--skipLibCheck',
      '--outDir',
      join(temp, 'typescript/dist'),
      'index.ts',
      'probe.mts',
      '--types',
      'node',
      '--typeRoots',
      join(root, 'node_modules/@types'),
    ],
    join(temp, 'typescript'),
  );
  run(process.execPath, [join(temp, 'typescript/dist/probe.mjs'), root], root);
  run(python, ['-c', 'import sys; assert sys.version_info >= (3,12)'], root);
  run(python, ['-m', 'compileall', '-q', join(temp, 'python/vector_trading/_generated')], root);
  run(python, [join(root, 'generation/probes/python.py'), root], root, {
    PYTHONPATH: join(temp, 'python'),
  });
  await cp(join(root, 'generation/probes/go_test.go'), join(temp, 'go/probe_test.go'));
  await cp(join(root, 'generation/probes/go.mod'), join(temp, 'go/go.mod'));
  const goEnv = {
    SDK_PROBE_ROOT: root,
    GOTOOLCHAIN: 'local',
    GOMODCACHE: process.env['GOMODCACHE'] ?? join(root, '.cache/generation/go-mod-cache'),
    GOCACHE: process.env['GOCACHE'] ?? join(root, '.cache/generation/go-build-cache'),
    GOPROXY: 'off',
    GOSUMDB: 'off',
  };
  if (run(go, ['env', 'GOVERSION'], join(temp, 'go'), goEnv) !== 'go' + tools.go)
    throw new Error('Select Go ' + tools.go + ' through PATH or SDK_PROBE_GO before probing.');
  const externalModules = run(
    go,
    ['list', '-mod=readonly', '-m', '-f', '{{if not .Main}}{{.Path}}{{end}}', 'all'],
    join(temp, 'go'),
    goEnv,
  );
  if (externalModules) throw new Error('Go must have no external modules: ' + externalModules);
  run(go, ['test', '-mod=readonly', '-v', '.'], join(temp, 'go'), goEnv);
  console.log('Go compiled and passed fixtures with no external modules and GOPROXY=off.');
  await mkdir(join(temp, 'rust/src/bin'), { recursive: true });
  await cp(join(root, 'generation/probes/rust.rs'), join(temp, 'rust/src/bin/probe.rs'));
  for (const name of ['Cargo.toml', 'Cargo.lock'])
    await cp(join(root, 'generation/probes/rust', name), join(temp, 'rust', name));
  const target = process.env['CARGO_TARGET_DIR'] ?? join(root, '.cache/generation/rust-target');
  for (const version of [tools.rust, tools.rustMSRV]) {
    run(
      cargo,
      ['+' + version, 'run', '--locked', '--offline', '--bin', 'probe', '--', root],
      join(temp, 'rust'),
      { CARGO_TARGET_DIR: version === tools.rust ? target : target + '-msrv' },
    );
  }
  console.log(
    'Four native compilations and stable/MSRV Rust probes passed. Temporary projects will be removed.',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
