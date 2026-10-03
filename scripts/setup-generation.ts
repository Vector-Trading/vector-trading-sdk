import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, readJson, root } from './generation.ts';
const pin = await readJson<{ version: string; url: string; sha256: string }>(
  join(root, 'generation/generator.json'),
);
const response = await fetch(pin.url, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error('Generator download failed: ' + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
if (hash(bytes) !== pin.sha256) throw new Error('Generator download SHA-256 mismatch');
const directory = join(root, '.cache/generation');
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'openapi-generator-cli-' + pin.version + '.jar'), bytes);
console.log('Verified generator ' + pin.version + ' is ready.');
