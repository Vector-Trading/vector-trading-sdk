import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readJson, root } from './generation.ts';
import { fetchRustProbe, withRustProbe } from './rust-probe.ts';

it('prepares real Rust probe targets for locked Cargo metadata and offline fetch', async () => {
  const { rust } = await readJson<{ rust: string }>(join(root, 'generation/toolchains.json'));
  let prepared = '';
  await withRustProbe(async (directory) => {
    prepared = directory;
    const metadata = JSON.parse(
      execFileSync(
        process.env['SDK_PROBE_CARGO'] ?? 'cargo',
        ['+' + rust, 'metadata', '--locked', '--offline', '--no-deps', '--format-version', '1'],
        { cwd: directory, encoding: 'utf8', timeout: 30_000 },
      ),
    );
    expect(
      metadata.packages[0].targets.map((target: { name: string }) => target.name).sort(),
    ).toEqual(['probe', 'vector_generated']);
  });
  await expect(access(prepared)).rejects.toThrow();
  await fetchRustProbe(true);
}, 120_000);

it('cleans prepared probe sources after a failed operation', async () => {
  let prepared = '';
  await expect(
    withRustProbe(async (directory) => {
      prepared = directory;
      throw new Error('controlled failure');
    }),
  ).rejects.toThrow('controlled failure');
  await expect(access(prepared)).rejects.toThrow();
});
