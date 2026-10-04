import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { root } from './generation.ts';

// Preparation is explicit. Checks never install missing runtimes or silently skip them.
const languages = ['typescript', 'python', 'go', 'rust'] as const;
function pnpm(command: string) {
  execFileSync('corepack', ['pnpm', command], {
    cwd: root,
    stdio: 'inherit',
    timeout: 1_800_000,
  });
}
function typescriptTests() {
  for (const [version, binary] of [
    [
      '22.23.2',
      process.env['SDK_NODE22'] ?? join(homedir(), '.nvm/versions/node/v22.23.2/bin/node'),
    ],
    ['24.21.0', process.env['SDK_NODE24'] ?? process.execPath],
  ]) {
    if (
      execFileSync(binary!, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim() !==
      `v${version}`
    )
      throw new Error(`Expected Node.js ${version}`);
    execFileSync(binary!, [join(root, 'node_modules/vitest/vitest.mjs'), 'run'], {
      cwd: join(root, 'typescript'),
      stdio: 'inherit',
      timeout: 180_000,
    });
  }
}
function test(language: string) {
  if (language === 'typescript') typescriptTests();
  else pnpm(`test:${language}`);
}
function packageCheck(language: string) {
  pnpm(`build:${language}`);
  pnpm(`test:${language}:package`);
}
const action = process.argv[2];
if (action === 'verify') {
  for (const command of [
    'format:check',
    'lint',
    'typecheck',
    'docs:check',
    'ci:check',
    'release:check',
    'contracts:check',
    'generated:check',
    'generation:probe',
    'test',
    'build',
  ])
    pnpm(command);
} else if (action === 'test') {
  pnpm('test:shared');
  pnpm('test:pine');
  for (const language of languages) test(language);
} else if (action === 'build') {
  for (const language of languages) packageCheck(language);
} else if (action === 'ci') {
  const area = process.argv[3];
  if (area === 'contracts') {
    for (const command of [
      'contracts:check',
      'generated:check',
      'generation:probe',
      'test:shared',
      'test:pine',
    ])
      pnpm(command);
  } else if (area === 'documentation') {
    for (const command of [
      'format:check',
      'lint',
      'typecheck',
      'docs:check',
      'ci:check',
      'release:check',
    ])
      pnpm(command);
  } else if (languages.some((language) => language === area)) {
    test(area!);
    packageCheck(area!);
  } else throw new Error('Unknown CI area');
} else throw new Error('Usage: workspace.ts test|build|verify|ci AREA');
