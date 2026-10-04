import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { root } from './generation.ts';

const files: string[] = [];
async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      [
        'node_modules',
        '.cache',
        '.git',
        '.venv',
        'target',
        'dist',
        '__pycache__',
        'generated',
        '_generated',
      ].includes(entry.name)
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (extname(path) === '.md') files.push(path);
  }
}
await collect(root);
function headings(text: string) {
  const used = new Map<string, number>();
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
      const slug = match[1]!
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .replace(/\s/g, '-');
      const count = used.get(slug) ?? 0;
      used.set(slug, count + 1);
      return count ? `${slug}-${count}` : slug;
    }),
  );
}
for (const file of files) {
  const text = (await readFile(file, 'utf8')).replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1]!.replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue;
    const [path, fragment] = link.split('#');
    const target = resolve(
      dirname(file),
      decodeURIComponent(path || relative(dirname(file), file)),
    );
    if (!target.startsWith(root + '/'))
      throw new Error(`Documentation link escapes repository: ${file}`);
    const content = await readFile(target, 'utf8').catch(() => {
      throw new Error(`Missing documentation target: ${relative(root, file)} -> ${link}`);
    });
    if (
      fragment &&
      extname(target) === '.md' &&
      !headings(content).has(decodeURIComponent(fragment))
    )
      throw new Error(`Missing documentation heading: ${relative(root, file)} -> ${link}`);
  }
}
console.log(`Documentation links checked in ${files.length} Markdown files.`);
