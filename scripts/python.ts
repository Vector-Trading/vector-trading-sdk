import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './generation.ts';

const commands: Record<string, string[]> = {
  build: ['build'],
  package: ['run', '--locked', 'python', 'scripts/check_package.py'],
};
function run(command: string[], env = process.env) {
  execFileSync('uv', command, {
    cwd: join(root, 'python'),
    stdio: 'inherit',
    timeout: 300_000,
    env: { ...env, UV_CACHE_DIR: process.env['UV_CACHE_DIR'] ?? join(root, '.cache/uv') },
  });
}
if (process.argv[2] === 'test') {
  for (const [version, environment] of [
    ['3.12.9', join(root, 'python/.venv')],
    ['3.14.6', join(root, '.cache/python314')],
  ]) {
    const env = {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: environment!,
      UV_PYTHON_DOWNLOADS: 'never',
    };
    // --no-sync makes a missing prepared environment fail rather than install silently.
    for (const command of [
      ['ruff', 'format', '--check', '.'],
      ['ruff', 'check', '.'],
      ['mypy', 'src'],
      ['pytest'],
    ])
      run(['run', '--locked', '--no-sync', '--python', version!, ...command], env);
  }
} else {
  const command = commands[process.argv[2] ?? ''];
  if (!command) throw new Error('Expected Python test, build, or package');
  run(command);
}
