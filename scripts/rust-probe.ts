import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generatedPath, readJson, root } from './generation.ts';

// Fetch and execution must see the same real library and binary targets.
export async function prepareRustProbe(directory: string): Promise<void> {
  await cp(generatedPath('rust'), directory, { recursive: true });
  await mkdir(join(directory, 'src/bin'), { recursive: true });
  await cp(join(root, 'generation/probes/rust.rs'), join(directory, 'src/bin/probe.rs'));
  for (const name of ['Cargo.toml', 'Cargo.lock'])
    await cp(join(root, 'generation/probes/rust', name), join(directory, name));
}

export async function withRustProbe<T>(use: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sdk-rust-probe-'));
  try {
    await prepareRustProbe(directory);
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function fetchRustProbe(offline = false): Promise<void> {
  const tools = await readJson<{ rust: string }>(join(root, 'generation/toolchains.json'));
  await withRustProbe(async (directory) => {
    execFileSync(
      process.env['SDK_PROBE_CARGO'] ?? 'cargo',
      ['+' + tools.rust, 'fetch', '--locked', ...(offline ? ['--offline'] : [])],
      { cwd: directory, stdio: 'inherit', timeout: 120_000 },
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await fetchRustProbe(process.argv.includes('--offline'));
