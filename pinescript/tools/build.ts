import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = await readFile(resolve(root, 'pinescript/VectorTrading.pine'), 'utf8');
const digest = createHash('sha256').update(source).digest('hex');
const embedded = source
  .replace(/^library\(.*\)$/m, '// Library declaration removed for source-only embedding.')
  .replace(/^export /gm, '');
const prefix = (name: string) =>
  embedded.replace(
    '// SPDX-License-Identifier: MIT',
    `// SPDX-License-Identifier: MIT\n// Derived embedding; run node pinescript/tools/build.ts --write.\n// Library SHA-256: ${digest}\nindicator("${name}", overlay = true)`,
  );
const body = await readFile(resolve(root, 'pinescript/examples/confirmed-cross.body.pine'), 'utf8');
const fixtures = JSON.parse(
  await readFile(resolve(root, 'conformance/signals/cases.json'), 'utf8'),
) as {
  id: string;
  schemaAccepted: boolean;
  parserAccepted: boolean;
  payload: Record<string, unknown>;
}[];
const literal = (value: unknown) => JSON.stringify(value);
function call(payload: Record<string, unknown>): string {
  const action = payload['action'] as string;
  const fields = Object.entries(payload).filter(([key]) => key !== 'action' && key !== 'order');
  const args = fields.map(
    ([key, value]) =>
      `${key} = ${key === 'force' ? (value ? 'Force.enabled' : 'Force.disabled') : literal(value)}`,
  );
  for (const [key, value] of Object.entries((payload['order'] ?? {}) as Record<string, unknown>)) {
    if (key === 'takeProfits') {
      const targets = value as { price: number; percent: number }[];
      args.push(
        'takeProfits = ' +
          (targets.length
            ? `array.from(${targets.map((t) => `TakeProfit.new(${t.price}, ${t.percent})`).join(', ')})`
            : 'array.new<TakeProfit>()'),
      );
    } else args.push(`${key === 'stop' ? 'stopPrice' : key} = ${literal(value)}`);
  }
  return `${action}Signal(${args.join(', ')})`;
}
const valid = fixtures.filter((f) => f.schemaAccepted && f.parserAccepted);
const invalid = fixtures.filter((f) => f.schemaAccepted && !f.parserAccepted);
const rejections = [
  ...invalid.map((f) => ({ id: f.id, expression: call(f.payload) })),
  { id: 'required-na-price', expression: 'openSignal(1, na, "buy")' },
  { id: 'zero-price', expression: 'openSignal(1, 0, "buy")' },
  { id: 'non-finite-price', expression: 'openSignal(1, 1e308 * 10, "buy")' },
  { id: 'invalid-hashtag', expression: 'startSignal(1, hashtag = "quote\\\"slash\\\\")' },
  { id: 'unsafe-timestamp', expression: 'startSignal(1, timestamp = "9007199254740992")' },
  { id: 'oversized-body', expression: 'startSignal(1, timestamp = str.repeat("0", 16384))' },
  {
    id: 'na-target',
    expression: 'openSignal(1, 100, "buy", takeProfits = array.from(TakeProfit.new(na, 50)))',
  },
  {
    id: 'close-distinct-stop',
    expression: 'openSignal(1, 100, "buy", stopPrice = 100.00000000001)',
  },
];
const probes = valid.map((f) => `    log.info("VTJSON|${f.id}|" + ${call(f.payload)})`).join('\n');
const rejectionBody = rejections
  .map((f, i) => `            ${i + 1} => ${f.expression}`)
  .join('\n');
const probe = `${prefix('Vector Trading SDK conformance')}\n// Select one rejection at a time: the real builder must raise a runtime error.\nint rejection = input.int(0, "Rejection case", minval = 0, maxval = ${rejections.length})\nif barstate.isfirst\n${probes}\n    log.info("VTQUOTE|unicode|" + jsonString("Quote \\\" slash \\\\ tab\\t line\\n café 😀"))\n    log.info("VTJSON|precision|" + openSignal(1.25, 123.12345678901234, "buy", "0001780000000000", "", includeHashtag = true))\n    log.info("VTJSON|tiny-price|" + openSignal(1, 1.2345678901234567e-20, "buy", "1780000000000"))\n    log.info("VTJSON|tiny-valid-stop|" + openSignal(1, 1.2345678901234567e-20, "buy", "1780000000000", stopPrice = 1e-20))\n    log.info("VTJSON|automatic-timestamp|" + startSignal(1))\n    if rejection != 0\n        string rejected = switch rejection\n${rejectionBody}\n            => ""\n        runtime.error("REJECTION DID NOT OCCUR: " + rejected)\nplot(na)\n`;
const outputs: Record<string, string> = {
  'pinescript/examples/confirmed-cross.pine':
    prefix('Vector Trading confirmed cross') + '\n' + body,
  'pinescript/conformance/probe.pine': probe,
  'pinescript/conformance/rejections.json':
    JSON.stringify(
      rejections.map(({ id }, i) => ({ case: i + 1, id })),
      null,
      2,
    ) + '\n',
};
for (const [path, content] of Object.entries(outputs)) {
  if (process.argv.includes('--write')) await writeFile(resolve(root, path), content);
  else if ((await readFile(resolve(root, path), 'utf8')) !== content)
    throw new Error('Stale Pine embedding: ' + path);
}
console.log(
  `Pine embeddings ${process.argv.includes('--write') ? 'written' : 'verified'}; ${valid.length} canonical signals; ${rejections.length} rejection cases. This does not compile Pine.`,
);
