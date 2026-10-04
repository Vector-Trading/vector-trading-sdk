import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './generation.ts';
import { publicSnapshot } from './public-snapshot.ts';

export function checkPublicText(content: string, file: string): void {
  const rules: [string, RegExp][] = [
    ['personal filesystem path', /(?:\/Users\/|\/home\/)[a-zA-Z0-9_.-]+\//],
    ['internal implementation path', /\b(?:apps|packages)\/(?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|mjs)\b/],
    [
      'unapproved organization repository',
      /github\.com\/Vector-Trading\/(?!vector-trading-sdk(?:[\s/"'#?\).,:]|$))[\w.-]+/,
    ],
    [
      'private credential',
      /(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|pypi-[a-zA-Z0-9_-]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
    ],
  ];
  for (const [category, pattern] of rules)
    if (pattern.test(content))
      throw new Error(`Public content policy failed: ${file} (${category})`);
}

export async function checkPublicContent(directory = root): Promise<void> {
  const files = new Set(
    execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: directory,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  );
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(directory, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!bytes.includes(0)) checkPublicText(bytes.toString('utf8'), file);
  }
  publicSnapshot(JSON.parse(await readFile(join(directory, 'contracts/source.json'), 'utf8')));
  console.log(
    'Public files and snapshot metadata checked; private verification receipts are excluded.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await checkPublicContent();
