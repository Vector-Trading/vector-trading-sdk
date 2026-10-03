import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { hash, readJson, root, type Schema, type Specification } from './generation.ts';

export function openApiToJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApiToJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, openApiToJsonSchema(child)]),
  );
  if (typeof result['$ref'] === 'string')
    result['$ref'] = result['$ref'].replace('#/components/schemas/', '#/$defs/');
  for (const bound of ['Minimum', 'Maximum']) {
    const key = 'exclusive' + bound;
    if (result[key] === true) {
      result[key] = result[bound.toLowerCase()];
      delete result[bound.toLowerCase()];
    } else if (result[key] === false) delete result[key];
  }
  if (result['nullable'] === true) {
    delete result['nullable'];
    return { anyOf: [result, { type: 'null' }] };
  }
  return result;
}
export async function checkContracts(directory = root): Promise<void> {
  const manifest = await readJson<{
    commit: string;
    status: string;
    contractVersion: string;
    repository: string;
    files: Record<string, { sha256: string }>;
    sourceHashes: Record<string, string>;
  }>(join(directory, 'contracts/source.json'));
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.status !== 'committed')
    throw new Error('Snapshot has no accepted source commit');
  if (
    manifest.repository !== 'https://github.com/Vector-Trading/vector-trading' ||
    !/^\d+\.\d+\.\d+$/.test(manifest.contractVersion)
  )
    throw new Error('Invalid snapshot owner or contract version');
  const expectedFiles = [
    'conformance/rest/cases.json',
    'conformance/signals/cases.json',
    'contracts/rest.openapi.json',
    'contracts/signals.schema.json',
  ].sort();
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expectedFiles))
    throw new Error('Snapshot file inventory differs');
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (hash(await readFile(join(directory, path))) !== entry.sha256)
      throw new Error('Snapshot hash differs: ' + path);
  }
  if (
    !Object.keys(manifest.sourceHashes).length ||
    Object.entries(manifest.sourceHashes).some(
      ([path, digest]) =>
        path.startsWith('/') || path.includes('..') || !/^[a-f0-9]{64}$/.test(digest),
    )
  )
    throw new Error('Invalid source provenance');
  const rest = await readJson<Specification>(join(directory, 'contracts/rest.openapi.json'));
  const operations = Object.values(rest.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const ids = operations.map((operation) => operation.operationId).sort();
  if (
    JSON.stringify(ids) !==
    JSON.stringify([
      'createBundleGrant',
      'getCheckout',
      'listBundleGrants',
      'listBundleUsers',
      'listBundles',
      'revokeBundleGrant',
      'searchUsers',
    ])
  )
    throw new Error('REST operation coverage differs');
  const ajv = new Ajv({ strict: false, allErrors: true, strictNumbers: true });
  addFormats.default(ajv);
  const validateSignal = ajv.compile(
    await readJson<Schema>(join(directory, 'contracts/signals.schema.json')),
  );
  const signals = await readJson<
    { id: string; payload: unknown; schemaAccepted: boolean; parserAccepted: boolean }[]
  >(join(directory, 'conformance/signals/cases.json'));
  if (new Set(signals.map((fixture) => fixture.id)).size !== signals.length)
    throw new Error('Duplicate signal fixtures');
  for (const fixture of signals) {
    if (validateSignal(fixture.payload) !== fixture.schemaAccepted)
      throw new Error('Signal schema disagrees with fixture: ' + fixture.id);
  }
  const cases = await readJson<
    {
      id: string;
      operationId: string;
      expectedStatus: number;
      request: { body?: unknown };
      response?: unknown;
    }[]
  >(join(directory, 'conformance/rest/cases.json'));
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length)
    throw new Error('Duplicate REST fixtures');
  const schemaFor = (schema: Schema) => ({
    ...(openApiToJsonSchema(schema) as Schema),
    $defs: openApiToJsonSchema(rest.components.schemas),
  });
  for (const fixture of cases) {
    const operation = operations.find((item) => item.operationId === fixture.operationId);
    if (!operation) throw new Error('Unknown fixture operation: ' + fixture.id);
    const requestSchema = operation.requestBody?.content['application/json']?.schema;
    if (
      requestSchema &&
      fixture.expectedStatus < 300 &&
      !ajv.compile(schemaFor(requestSchema))(fixture.request.body)
    )
      throw new Error('Invalid accepted REST body: ' + fixture.id);
    const responseSchema =
      operation.responses[String(fixture.expectedStatus)]?.content?.['application/json']?.schema;
    if (
      responseSchema &&
      fixture.response &&
      !ajv.compile(schemaFor(responseSchema))(fixture.response)
    )
      throw new Error('Invalid REST response: ' + fixture.id);
  }
  console.log(
    'Accepted snapshot hashes, 7 REST operations and ' +
      (cases.length + signals.length) +
      ' fixtures verified.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkContracts();
