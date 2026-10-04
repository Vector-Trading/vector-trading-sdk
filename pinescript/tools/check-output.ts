import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function checkOutput(
  path = resolve(root, 'pinescript/conformance/editor-output.txt'),
) {
  const receipt = JSON.parse(
    await readFile(resolve(root, 'pinescript/conformance/verification.json'), 'utf8'),
  ) as {
    sources: Record<string, string>;
    compilation: { path: string; result: string }[];
    serverCommit: string;
    pineVersion: number;
  };
  assert.equal(receipt.pineVersion, 6);
  for (const file of [
    'pinescript/VectorTrading.pine',
    'pinescript/examples/confirmed-cross.pine',
    'pinescript/conformance/probe.pine',
    'pinescript/conformance/editor-output.txt',
    'pinescript/conformance/editor-rejections.json',
  ]) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(resolve(root, file)))
        .digest('hex'),
      receipt.sources[file],
      'Stale native Pine evidence: ' + file,
    );
  }
  for (const file of [
    'pinescript/VectorTrading.pine',
    'pinescript/examples/confirmed-cross.pine',
    'pinescript/conformance/probe.pine',
  ])
    assert(
      receipt.compilation.some((entry) => entry.path === file && entry.result === 'passed'),
      'Missing actual compilation receipt: ' + file,
    );
  const provenance = JSON.parse(await readFile(resolve(root, 'contracts/source.json'), 'utf8')) as {
    commit: string;
  };
  assert.equal(receipt.serverCommit, provenance.commit, 'Stale server parser receipt');
  const rejections = JSON.parse(
    await readFile(resolve(root, 'pinescript/conformance/rejections.json'), 'utf8'),
  ) as { case: number; id: string }[];
  const observed = JSON.parse(
    await readFile(resolve(root, 'pinescript/conformance/editor-rejections.json'), 'utf8'),
  ) as { case: number; error: string }[];
  assert.equal(observed.length, rejections.length);
  for (const item of rejections)
    assert(
      observed.some(
        (entry) =>
          entry.case === item.case &&
          entry.error.startsWith('Error on bar 0: ') &&
          !entry.error.includes('REJECTION DID NOT OCCUR'),
      ),
      item.id,
    );
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  const entries = new Map(
    lines.map((line) => {
      const [kind, id, ...json] = line.split('|');
      return [id, { kind, payload: JSON.parse(json.join('|')) as Record<string, unknown> }];
    }),
  );
  assert.equal(
    entries.size,
    22,
    'Expected 17 canonical signals, four signal edge cases and one quoted string',
  );
  const fixtures = JSON.parse(
    await readFile(resolve(root, 'conformance/signals/cases.json'), 'utf8'),
  ) as { id: string; schemaAccepted: boolean; parserAccepted: boolean; payload: unknown }[];
  assert.equal(lines.length, entries.size, 'Duplicate Pine output IDs');
  for (const id of [
    ...fixtures.filter((f) => f.schemaAccepted && f.parserAccepted).map((f) => f.id),
    'precision',
    'tiny-price',
    'tiny-valid-stop',
    'automatic-timestamp',
  ])
    assert.equal(entries.get(id)?.kind, 'VTJSON', id);
  assert.equal(entries.get('unicode')?.kind, 'VTQUOTE');
  const schema = JSON.parse(await readFile(resolve(root, 'contracts/signals.schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false, strictNumbers: true }).compile(schema);
  for (const fixture of fixtures.filter((f) => f.schemaAccepted && f.parserAccepted))
    assert.deepEqual(entries.get(fixture.id)?.payload, fixture.payload, fixture.id);
  for (const [id, entry] of entries) {
    if (entry.kind !== 'VTJSON') continue;
    assert(validate(entry.payload), `${id}: ${JSON.stringify(validate.errors)}`);
    const timestamp = entry.payload['timestamp'] as string;
    assert(/^[0-9]+$/.test(timestamp) && Number.isSafeInteger(Number(timestamp)), id);
    assert(
      Buffer.byteLength(
        lines
          .find((line) => line.startsWith(`VTJSON|${id}|`))!
          .split('|')
          .slice(2)
          .join('|'),
      ) <= 16384,
    );
  }
  assert.equal(entries.get('unicode')?.payload, 'Quote " slash \\ tab\t line\n café 😀');
  assert.deepEqual(entries.get('precision')?.payload, {
    action: 'open',
    version: 1.25,
    timestamp: '0001780000000000',
    hashtag: '',
    marketPrice: 123.12345678901234,
    order: { side: 'buy' },
  });
  assert.equal(entries.get('tiny-price')?.payload['marketPrice'], 1.2345678901234567e-20);
  assert.equal(
    (entries.get('tiny-valid-stop')?.payload['order'] as Record<string, unknown>)['stop'],
    1e-20,
  );
  console.log(
    'Actual Pine output: 21 signals passed the canonical schema and 17 fixtures matched exactly; Unicode/escaping, precision and metadata passed. Server parser verification is separate.',
  );
  return entries;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await checkOutput(process.argv[2]);
