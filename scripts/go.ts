import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
if (!command || !['test', 'build', 'package'].includes(command))
  throw new Error('Usage: node scripts/go.ts test|build|package');
execFileSync(process.env['SDK_GO126'] ?? 'go', ['run', './tools/check', command], {
  cwd: resolve(root, 'go'),
  env: { ...process.env, GOTOOLCHAIN: 'local', GOPROXY: 'off', GOSUMDB: 'off' },
  stdio: 'inherit',
});
