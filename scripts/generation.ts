import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const languages = ['typescript', 'python', 'go', 'rust'] as const;
export interface Schema {
  [key: string]: unknown;
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  oneOf?: Schema[];
  $ref?: string;
  title?: string;
  nullable?: boolean;
  enum?: unknown[];
  format?: string;
}
export interface Operation {
  operationId: string;
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}
export interface Specification {
  [key: string]: unknown;
  components: { schemas: Record<string, Schema> };
  paths: Record<string, Record<string, Operation>>;
}
export const hash = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return value;
}
export const json = (value: unknown): string => JSON.stringify(sorted(value), null, 2) + '\n';

/** Converts only the draft-07 features used by the pinned signal schema. */
function signalToOpenApi(value: unknown, names: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => signalToOpenApi(item, names));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!['$schema', '$id', 'title'].includes(key)) result[key] = signalToOpenApi(child, names);
  }
  if (typeof result['$ref'] === 'string') {
    const name = result['$ref'].replace('#/definitions/', '');
    if (!names[name]) throw new Error('Unsupported signal reference: ' + name);
    result['$ref'] = '#/components/schemas/' + names[name];
  }
  if ('const' in result) {
    result['enum'] = [result['const']];
    delete result['const'];
  }
  for (const bound of ['Minimum', 'Maximum']) {
    const key = 'exclusive' + bound;
    if (typeof result[key] === 'number') {
      result[bound.toLowerCase()] = result[key];
      result[key] = true;
    }
  }
  return result;
}
export function project(
  rest: Specification,
  signals: { definitions: Record<string, Schema>; oneOf: Schema[] },
): Specification {
  const spec = structuredClone(rest);
  const names = Object.fromEntries(
    Object.entries(signals.definitions).map(([key, value]) => {
      if (!value.title) throw new Error('Signal model has no title');
      return [key, value.title];
    }),
  );
  for (const [key, schema] of Object.entries(signals.definitions)) {
    spec.components.schemas[names[key]!] = signalToOpenApi(schema, names) as Schema;
  }
  spec.components.schemas['SignalPayload'] = {
    oneOf: signalToOpenApi(signals.oneOf, names) as Schema[],
    discriminator: {
      propertyName: 'action',
      mapping: Object.fromEntries(
        Object.entries(names).map(([key, name]) => [key, '#/components/schemas/' + name]),
      ),
    },
  };
  const grant = spec.components.schemas['CreateGrantRequest'];
  if (!grant?.oneOf || grant.oneOf.length !== 2 || !grant.properties)
    throw new Error('Unexpected grant union');
  const common = structuredClone(grant);
  delete common.oneOf;
  const refs = grant.oneOf.map((branch, index) => {
    const name = index === 0 ? 'PaidExternalGrantRequest' : 'OtherGrantRequest';
    spec.components.schemas[name] = {
      ...structuredClone(common),
      properties: structuredClone({ ...common.properties, ...branch.properties }),
      required: [...new Set([...(common.required ?? []), ...(branch.required ?? [])])].sort(),
    };
    return { $ref: '#/components/schemas/' + name };
  });
  spec.components.schemas['CreateGrantRequest'] = {
    oneOf: refs,
    discriminator: {
      propertyName: 'grantType',
      mapping: Object.fromEntries(
        (grant.properties['grantType']?.enum ?? []).map((kind) => [
          String(kind),
          '#/components/schemas/' +
            (kind === 'paid_external' ? 'PaidExternalGrantRequest' : 'OtherGrantRequest'),
        ]),
      ),
    },
  };
  function annotate(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(annotate);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const schema = value as Schema;
    if (schema.type === 'number') {
      schema.format = 'double';
      schema['x-vector-finite'] = true;
    }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (!schema.required?.includes(key) && !property.nullable)
        property['x-vector-optional-nonnullable'] = true;
    }
    Object.values(value).forEach(annotate);
  }
  annotate(spec);
  return spec;
}
export async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected generated symlink');
    if (entry.isDirectory())
      result.push(
        ...(await files(join(directory, entry.name))).map((name) => entry.name + '/' + name),
      );
    else result.push(entry.name);
  }
  return result.sort();
}
export async function generatorJar(): Promise<string> {
  const pin = await readJson<{ version: string; sha256: string }>(
    join(root, 'generation/generator.json'),
  );
  const path =
    process.env['OPENAPI_GENERATOR_JAR'] ??
    join(root, '.cache/generation/openapi-generator-cli-' + pin.version + '.jar');
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error('Generator is missing. Run pnpm generation:setup.');
  }
  if (hash(bytes) !== pin.sha256) throw new Error('Generator SHA-256 mismatch');
  return path;
}
export async function generate(destination: string): Promise<void> {
  const jar = await generatorJar();
  const staging = await mkdtemp(join(tmpdir(), 'vector-sdk-generation-'));
  try {
    await mkdir(destination, { recursive: true });
    const specification = project(
      await readJson<Specification>(join(root, 'contracts/rest.openapi.json')),
      await readJson(join(root, 'contracts/signals.schema.json')),
    );
    await writeFile(join(destination, 'public.openapi.json'), json(specification));
    await mkdir(join(destination, 'typescript'), { recursive: true });
    await mkdir(join(destination, 'python'), { recursive: true });
    await writeFile(
      join(destination, 'python/contract.json'),
      json({ schemas: specification.components.schemas, paths: specification.paths }),
    );
    await writeFile(
      join(destination, 'typescript/contract.ts'),
      '// Generated from the accepted snapshot. Do not edit.\nexport const contract = ' +
        json({ schemas: specification.components.schemas, paths: specification.paths }).trim() +
        ' as const;\n',
    );
    const templateDir = join(staging, 'templates');
    const patches = await readJson<
      { template: string; sha256: string; edits: { before: string; after: string }[] }[]
    >(join(root, 'generation/template-patches.json'));
    for (const patch of patches) {
      let template = execFileSync('unzip', ['-p', jar, patch.template], { encoding: 'utf8' });
      if (hash(template) !== patch.sha256)
        throw new Error('Upstream template changed: ' + patch.template);
      for (const edit of patch.edits) {
        if (template.split(edit.before).length !== 2)
          throw new Error('Template patch is not unique: ' + patch.template);
        template = template.replace(edit.before, edit.after);
      }
      const path = join(templateDir, patch.template);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, template);
    }
    for (const language of languages) {
      const config = parseYaml(
        await readFile(join(root, 'generation/' + language + '.yaml'), 'utf8'),
      ) as { generatorName: string };
      const output = join(staging, language);
      execFileSync(
        process.env['JAVA'] ?? 'java',
        [
          '-jar',
          jar,
          'generate',
          '-g',
          config.generatorName,
          '-i',
          join(destination, 'public.openapi.json'),
          '-c',
          join(root, 'generation/' + language + '.yaml'),
          '-t',
          join(templateDir, config.generatorName),
          '-o',
          output,
          '--global-property',
          'apiDocs=false,modelDocs=false,apiTests=false,modelTests=false',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 },
      );
      for (const name of await files(output)) {
        if (!/\.(ts|py|go|rs)$/.test(name)) continue;
        const path = join(destination, language, name);
        await mkdir(dirname(path), { recursive: true });
        let bytes = await readFile(join(output, name));
        if (language === 'python') {
          // Python 3.12 provides these typing primitives; keep backports out of models.
          const source = bytes
            .toString('utf8')
            .replace(/^from typing_extensions import (.+)$/gm, (_line, names: string) => {
              if (
                !names
                  .split(',')
                  .every((name) =>
                    ['Annotated', 'Literal', 'Self', 'NotRequired'].includes(name.trim()),
                  )
              )
                throw new Error('Unsupported Python typing backport: ' + names);
              return 'from typing import ' + names;
            });
          bytes = Buffer.from(source);
        }
        await writeFile(path, bytes);
      }
    }
    const inputs = [
      'contracts/rest.openapi.json',
      'contracts/signals.schema.json',
      'contracts/source.json',
      'conformance/rest/cases.json',
      'conformance/signals/cases.json',
      'generation/generator.json',
      'generation/toolchains.json',
      '.nvmrc',
      'package.json',
      'pnpm-lock.yaml',
      'generation/template-patches.json',
      'scripts/generation.ts',
      ...languages.map((language) => 'generation/' + language + '.yaml'),
    ];
    const inputHashes = Object.fromEntries(
      await Promise.all(inputs.map(async (path) => [path, hash(await readFile(join(root, path)))])),
    );
    const outputHashes = Object.fromEntries(
      await Promise.all(
        (await files(destination)).map(async (path) => [
          path,
          hash(await readFile(join(destination, path))),
        ]),
      ),
    );
    await writeFile(
      join(destination, 'manifest.json'),
      json({ inputs: inputHashes, outputs: outputHashes }),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function compareGenerated(
  current = join(root, 'generation/generated'),
): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-check-generated-'));
  try {
    await generate(temp);
    const expected = await files(temp);
    if (JSON.stringify(expected) !== JSON.stringify(await files(current)))
      throw new Error('Generated file inventory differs. Run pnpm generate.');
    for (const path of expected) {
      if (!(await readFile(join(temp, path))).equals(await readFile(join(current, path))))
        throw new Error('Generated file differs: ' + path + '. Run pnpm generate.');
    }
    console.log('Generated output and all input hashes are reproducible.');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
