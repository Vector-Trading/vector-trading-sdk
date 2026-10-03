import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
if (!command || !['test', 'build', 'package'].includes(command))
  throw new Error('Usage: node scripts/rust.ts test|build|package');
execFileSync(process.execPath, ['rust/tools/check.ts', command], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
