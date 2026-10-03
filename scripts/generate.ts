import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { generate, root } from './generation.ts';
import { checkContracts } from './check-contracts.ts';
await checkContracts();
const cache = join(root, '.cache/generation');
await mkdir(cache, { recursive: true });
const staging = await mkdtemp(join(cache, 'output-'));
try {
  await generate(staging);
  const output = join(root, 'generation/generated');
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log('Generated four internal source trees.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
