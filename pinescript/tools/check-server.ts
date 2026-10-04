import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkOutput } from './check-output.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = process.argv[2];
if (!server)
  throw new Error(
    'Pass an explicitly selected server checkout with installed packages/types dependencies',
  );
await checkOutput();
const provenance = JSON.parse(await readFile(join(root, 'contracts/source.json'), 'utf8')) as {
  commit: string;
  sourceHashes: Record<string, string>;
};
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'vector-sdk-pine-parser-'));
try {
  const archive = await run(
    'git',
    ['-C', resolve(server), 'archive', provenance.commit, 'packages/types'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
  );
  await writeFile(join(directory, 'source.tar'), archive.stdout);
  await run('tar', ['-xf', join(directory, 'source.tar'), '-C', directory]);
  const parser = await readFile(join(directory, 'packages/types/src/signal.ts'));
  if (
    createHash('sha256').update(parser).digest('hex') !==
    provenance.sourceHashes['packages/types/src/signal.ts']
  )
    throw new Error('Accepted parser provenance differs');
  await symlink(
    join(resolve(server), 'packages/types/node_modules'),
    join(directory, 'packages/types/node_modules'),
    'dir',
  );
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(
    join(directory, 'vitest.config.ts'),
    `import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['verify.spec.ts'],environment:'node'}});`,
  );
  await writeFile(
    join(directory, 'verify.spec.ts'),
    await readFile(join(root, 'pinescript/tools/server-parser.spec.txt'), 'utf8'),
  );
  const result = await run(
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--root',
      directory,
      '--config',
      join(directory, 'vitest.config.ts'),
    ],
    { env: { ...process.env, SDK_PINE_ROOT: root }, maxBuffer: 4 * 1024 * 1024 },
  );
  console.log(result.stdout);
  console.log(
    `Real server parser verified at ${provenance.commit}; no HTTP receiver, queue or exchange was invoked.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
