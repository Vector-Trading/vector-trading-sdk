import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { checkPublicText } from './check-public-content.ts';
import { checkContracts } from './check-contracts.ts';
import { readJson, root } from './generation.ts';

it('publishes only contract version, acceptance status and public artifact hashes', async () => {
  const manifest = await readJson<Record<string, unknown>>(join(root, 'contracts/source.json'));
  expect(Object.keys(manifest).sort()).toEqual(['contractVersion', 'files', 'format', 'status']);
});

it('rejects additional provenance before accepting an otherwise valid snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-public-metadata-'));
  try {
    await cp(join(root, 'contracts'), join(directory, 'contracts'), { recursive: true });
    await cp(join(root, 'conformance'), join(directory, 'conformance'), { recursive: true });
    const manifest = await readJson<Record<string, unknown>>(
      join(directory, 'contracts/source.json'),
    );
    manifest['internalReceipt'] = { revision: 'a'.repeat(40) };
    await writeFile(join(directory, 'contracts/source.json'), JSON.stringify(manifest));
    await expect(checkContracts(directory)).rejects.toThrow('Public snapshot metadata');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('blocks private paths and credentials without echoing their contents', () => {
  const values = [
    '/' + 'Users' + '/private-person/work/file.ts',
    ['apps', 'private-service', 'src', 'handler.ts'].join('/'),
    'https://github.com/Vector-Trading/' + ['private', 'project'].join('-'),
    'gh' + 'p_' + 'x'.repeat(36),
  ];
  for (const value of values) {
    try {
      checkPublicText(value, 'example.txt');
      throw new Error('not rejected');
    } catch (error) {
      expect(String(error)).toContain('Public content policy failed: example.txt');
      expect(String(error)).not.toContain(value);
    }
  }
  checkPublicText(
    'https://github.com/Vector-Trading/vector-trading-sdk/releases/tag/v0.1.1',
    'README.md',
  );
});
