import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './generation.ts';

const commands: Record<string, string[]> = {
  test: ['run', '--locked', 'pytest'],
  build: ['build'],
  package: ['run', '--locked', 'python', 'scripts/check_package.py'],
};
const command = commands[process.argv[2] ?? ''];
if (!command) throw new Error('Expected Python test, build, or package');
execFileSync('uv', command, {
  cwd: join(root, 'python'),
  stdio: 'inherit',
  env: { ...process.env, UV_CACHE_DIR: process.env['UV_CACHE_DIR'] ?? join(root, '.cache/uv') },
});
