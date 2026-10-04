import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './generation.ts';

const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-ts-consumers-'));
const artifactDir = join(root, '.cache/packages');
await mkdir(artifactDir, { recursive: true });
const packageManifest = JSON.parse(
  await readFile(join(root, 'typescript/package.json'), 'utf8'),
) as { name: string; version: string };
const archive = join(artifactDir, 'vector-trading-sdk-' + packageManifest.version + '.tgz');
const node22 = process.env['SDK_NODE22'] ?? join(homedir(), '.nvm/versions/node/v22.23.2/bin/node');
const node24 = process.env['SDK_NODE24'] ?? process.execPath;
const modules = join(root, 'node_modules'); // Consumers install the archive; no source-path aliases.
function run(command: string, args: string[], cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
const exercise = String.raw`
async function exercise(sdk) {
  assert.deepEqual(Object.keys(sdk).sort(), [
    'RestClient','SignalsClient','SdkError','buildSignal','buildOpenSignal',
    'buildUpdateSignal','buildCancelSignal','buildCloseSignal','buildStartSignal',
    'buildPauseSignal','buildStopSignal','buildDeleteSignal','serializeSignal',
  ].sort());
  const accountApiKey = 'vt_consumer_synthetic';
  const strategyApiKey = 'a'.repeat(32);
  const secondStrategyApiKey = 'e'.repeat(32);
  const id = 'b'.repeat(32);
  const requests = [];
  const server = createServer((req,res) => {
    let body = ''; req.setEncoding('utf8'); req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{
      requests.push({url:req.url,auth:req.headers.authorization,body,method:req.method});
      res.setHeader('Content-Type','application/json');
      if (req.url.includes('/webhooks/')) { res.writeHead(204);res.end();return; }
      if (req.url.includes('/checkout/')) res.end(JSON.stringify({checkoutId:id,bundleId:id,userId:id,displayName:'Example'}));
      else if (req.method==='POST'||req.method==='DELETE') res.end(JSON.stringify({grant:{id,grantType:'gift'}}));
      else if (req.url.includes('/grants')) res.end('{"grants":[],"limit":50}');
      else if (req.url.includes('/bundles/')&&req.url.includes('/users')) res.end('{"users":[],"limit":50}');
      else if (req.url.includes('/v1/users')) res.end('{"users":[],"limit":10,"query":"Al"}');
      else res.end('{"bundles":[],"limit":50}');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  try {
    const rest = new sdk.RestClient({baseUrl:origin+'/api/rest',accountApiKey,allowLocalHttp:true});
    const signals = new sdk.SignalsClient({baseUrl:origin,allowLocalHttp:true});
    assert.equal(requests.length,0);
    await assert.rejects(import('@vector-trading/sdk/dist/index.js'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    await rest.listBundles();await rest.searchUsers({displayName:'Al'});await rest.getCheckout({checkoutId:id});
    await rest.listBundleUsers({bundleId:id});await rest.listBundleGrants({bundleId:id});
    await rest.createBundleGrant({bundleId:id,createGrantRequest:{userId:id,grantType:'gift'}});
    await rest.revokeBundleGrant({bundleId:id,grantId:id});
    const built = [sdk.buildOpenSignal({version:1,marketPrice:100,order:{side:'buy'}}),sdk.buildUpdateSignal({version:1,marketPrice:100,order:{side:'buy',takeProfits:[]}}),sdk.buildCancelSignal({version:1}),sdk.buildCloseSignal({version:1}),sdk.buildStartSignal({version:1}),sdk.buildPauseSignal({version:1}),sdk.buildStopSignal({version:1}),sdk.buildDeleteSignal({version:1})];
    for (const [index, signal] of built.entries()) assert.equal(await signals.send({strategyApiKey: index % 2 ? secondStrategyApiKey : strategyApiKey, payload: signal}),undefined);
    assert.equal(requests.length,15);
    for(const request of requests.slice(0,7))assert.equal(request.auth,'Bearer '+accountApiKey);
    for(const [index, request] of requests.slice(7).entries()) {assert.equal(request.auth,undefined);assert.ok(request.url.endsWith(index % 2 ? secondStrategyApiKey : strategyApiKey));assert.equal(typeof JSON.parse(request.body).timestamp,'string');}
    assert.deepEqual(JSON.parse(requests[8].body).order.takeProfits,[]);
    assert.ok(!requests.some(request=>request.url.includes(accountApiKey)));
    console.log('Installed consumer passed seven REST methods, eight signals, credentials, and TP clearing.');
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
`;
const commonTypes = `
import type {
  CheckoutDetailsDiscount,
  OpenSignalPayloadOrderTakeProfitsInner,
  OtherGrantRequest,
  PaidExternalGrantRequest,
  CheckoutDetailsDiscountTypeEnum,
  OtherGrantRequestGrantTypeEnum,
  PaidExternalGrantRequestGrantTypeEnum,
  OwnedTradingBundleSummaryAccessEnum,
  OwnedTradingBundleSummaryStatusEnum,
  OpenSignalPayloadOrderSideEnum,
  UpdateSignalPayloadOrderSideEnum,
  ListBundleGrantsSortEnum,
  ListBundleGrantsDirEnum,
  OpenSignalPayloadActionEnum,
  UpdateSignalPayloadActionEnum,
  CancelSignalPayloadActionEnum,
  CloseSignalPayloadActionEnum,
  StartSignalPayloadActionEnum,
  PauseSignalPayloadActionEnum,
  StopSignalPayloadActionEnum,
  DeleteSignalPayloadActionEnum,
  TradingBundleAccessGrantType,
} from '@vector-trading/sdk';
const discount: CheckoutDetailsDiscount = {type:'percent',value:10};
const target: OpenSignalPayloadOrderTakeProfitsInner = {percent:20,price:110};
const other: OtherGrantRequest = {userId:'b'.repeat(32),grantType:'gift'};
const paid: PaidExternalGrantRequest = {userId:'b'.repeat(32),grantType:'paid_external',sourceId:'invoice:example'};
const checkoutDiscount: sdk.CheckoutDetails['discount'] = discount;
const targets: sdk.OpenSignalPayloadOrder['takeProfits'] = [target];
const updatedTargets: sdk.UpdateSignalPayloadOrder['takeProfits'] = [target];
const grants: sdk.CreateGrantRequest[] = [other,paid];
const omittedDiscount: CheckoutDetailsDiscount = {};
const emptyTargets: sdk.UpdateSignalPayloadOrder['takeProfits'] = [];
void checkoutDiscount; void targets; void updatedTargets; void grants; void omittedDiscount; void emptyTargets;
const enum0: CheckoutDetailsDiscountTypeEnum = 'percent'; void enum0;
const enum1: OtherGrantRequestGrantTypeEnum = 'gift'; void enum1;
const enum2: PaidExternalGrantRequestGrantTypeEnum = 'paid_external'; void enum2;
const enum3: OwnedTradingBundleSummaryAccessEnum = 'private'; void enum3;
const enum4: OwnedTradingBundleSummaryStatusEnum = 'active'; void enum4;
const enum5: OpenSignalPayloadOrderSideEnum = 'buy'; void enum5;
const enum6: UpdateSignalPayloadOrderSideEnum = 'sell'; void enum6;
const enum7: ListBundleGrantsSortEnum = 'createdAt'; void enum7;
const enum8: ListBundleGrantsDirEnum = 'asc'; void enum8;
const enum9: OpenSignalPayloadActionEnum = 'open'; void enum9;
const enum10: UpdateSignalPayloadActionEnum = 'update'; void enum10;
const enum11: CancelSignalPayloadActionEnum = 'cancel'; void enum11;
const enum12: CloseSignalPayloadActionEnum = 'close'; void enum12;
const enum13: StartSignalPayloadActionEnum = 'start'; void enum13;
const enum14: PauseSignalPayloadActionEnum = 'pause'; void enum14;
const enum15: StopSignalPayloadActionEnum = 'stop'; void enum15;
const enum16: DeleteSignalPayloadActionEnum = 'delete'; void enum16;
const enum17: TradingBundleAccessGrantType = 'gift'; void enum17;
if (false) {
// @ts-expect-error enums remain types only in the installed package
void sdk.CheckoutDetailsDiscountTypeEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.OtherGrantRequestGrantTypeEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.PaidExternalGrantRequestGrantTypeEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.OwnedTradingBundleSummaryAccessEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.OwnedTradingBundleSummaryStatusEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.OpenSignalPayloadOrderSideEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.UpdateSignalPayloadOrderSideEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.ListBundleGrantsSortEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.ListBundleGrantsDirEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.OpenSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.UpdateSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.CancelSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.CloseSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.StartSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.PauseSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.StopSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.DeleteSignalPayloadActionEnum;
// @ts-expect-error enums remain types only in the installed package
void sdk.TradingBundleAccessGrantType;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum0: CheckoutDetailsDiscountTypeEnum = 'unsupported'; void invalidEnum0;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum1: OtherGrantRequestGrantTypeEnum = 'unsupported'; void invalidEnum1;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum2: PaidExternalGrantRequestGrantTypeEnum = 'unsupported'; void invalidEnum2;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum3: OwnedTradingBundleSummaryAccessEnum = 'unsupported'; void invalidEnum3;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum4: OwnedTradingBundleSummaryStatusEnum = 'unsupported'; void invalidEnum4;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum5: OpenSignalPayloadOrderSideEnum = 'unsupported'; void invalidEnum5;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum6: UpdateSignalPayloadOrderSideEnum = 'unsupported'; void invalidEnum6;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum7: ListBundleGrantsSortEnum = 'unsupported'; void invalidEnum7;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum8: ListBundleGrantsDirEnum = 'unsupported'; void invalidEnum8;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum9: OpenSignalPayloadActionEnum = 'unsupported'; void invalidEnum9;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum10: UpdateSignalPayloadActionEnum = 'unsupported'; void invalidEnum10;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum11: CancelSignalPayloadActionEnum = 'unsupported'; void invalidEnum11;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum12: CloseSignalPayloadActionEnum = 'unsupported'; void invalidEnum12;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum13: StartSignalPayloadActionEnum = 'unsupported'; void invalidEnum13;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum14: PauseSignalPayloadActionEnum = 'unsupported'; void invalidEnum14;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum15: StopSignalPayloadActionEnum = 'unsupported'; void invalidEnum15;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum16: DeleteSignalPayloadActionEnum = 'unsupported'; void invalidEnum16;
// @ts-expect-error literal unions must not widen to string or any
const invalidEnum17: TradingBundleAccessGrantType = 'unsupported'; void invalidEnum17;
// @ts-expect-error discount type remains restricted
const invalidDiscount: CheckoutDetailsDiscount = {type:'unsupported'}; void invalidDiscount;
// @ts-expect-error targets require a percent
const invalidTarget: OpenSignalPayloadOrderTakeProfitsInner = {price:110}; void invalidTarget;
// @ts-expect-error paid grants require sourceId
const invalidPaid: PaidExternalGrantRequest = {userId:'b'.repeat(32),grantType:'paid_external'}; void invalidPaid;
// @ts-expect-error other grant arms exclude paid_external
const invalidOther: OtherGrantRequest = {userId:'b'.repeat(32),grantType:'paid_external'}; void invalidOther;
}

const client = new sdk.RestClient({ baseUrl: 'https://example.com/api/rest', accountApiKey: 'vt_synthetic' });
const message: sdk.StrategySignalPayload = sdk.buildUpdateSignal({ version: 1, marketPrice: 100, order: { side: 'buy', takeProfits: [] } });
const signals = new sdk.SignalsClient({baseUrl:'https://example.com'});
new sdk.SignalsClient();
new sdk.RestClient({accountApiKey:'vt_synthetic'});
const request: sdk.SendSignalRequest = {strategyApiKey:'a'.repeat(32), payload:message};
void client; void message; void request;
if (false) {
signals.send(request);
// @ts-expect-error strategy key is mandatory per send
signals.send({payload:message});
// @ts-expect-error strategy key is no longer a constructor option
new sdk.SignalsClient({baseUrl:'https://example.com',strategyApiKey:'a'.repeat(32)});
// @ts-expect-error version is mandatory
sdk.buildStartSignal({});
// @ts-expect-error paid_external requires sourceId
const invalid: sdk.CreateGrantRequest = { userId: 'b'.repeat(32), grantType: 'paid_external' };
void invalid;
}
export { sdk };
`;
try {
  await writeFile(join(temp, 'npmrc'), '');
  await writeFile(join(temp, 'global-npmrc'), '');
  await rm(archive, { force: true });
  run('corepack', ['pnpm', '--dir', 'typescript', 'pack', '--pack-destination', artifactDir]);
  const paths = run('tar', ['-tzf', archive]).trim().split('\n');
  if (
    paths.some(
      (path) =>
        !/^package\/(?:package\.json|LICENSE|README\.md|dist\/(?:index\.js|index\.cjs|index\.d\.ts|index\.d\.cts))$/.test(
          path,
        ),
    )
  )
    throw new Error('Unexpected archive contents');
  for (const required of [
    'LICENSE',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
  ])
    if (!paths.includes('package/' + required)) throw new Error('Missing archive file ' + required);
  const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'])) as {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  if (
    manifest.name !== '@vector-trading/sdk' ||
    manifest.version !== packageManifest.version ||
    Object.keys(manifest.dependencies ?? {}).length ||
    Object.keys(manifest.peerDependencies ?? {}).length
  )
    throw new Error('Invalid runtime dependency graph');
  for (const name of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
    const content = await readFile(join(root, 'typescript/dist', name), 'utf8');
    if (
      content.includes(root) ||
      content.includes('@vector-trading/types') ||
      /(?:from\s*|require\()\s*['"]\.\./.test(content)
    )
      throw new Error('Leaked internal build import');
  }
  for (const [major, node] of [
    [22, node22],
    [24, node24],
  ] as const) {
    if (!run(node, ['--version']).startsWith('v' + major + '.'))
      throw new Error('Wrong Node version');
    const npmCli = join(node, '../../lib/node_modules/npm/bin/npm-cli.js');
    for (const mode of ['esm', 'cjs', 'typescript']) {
      const cwd = join(temp, String(major) + '-' + mode);
      await mkdir(cwd);
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({ name: 'vector-sdk-consumer', private: true, type: 'module' }),
      );
      run(
        node,
        [
          npmCli,
          '--userconfig',
          join(temp, 'npmrc'),
          '--globalconfig',
          join(temp, 'global-npmrc'),
          '--cache',
          join(temp, 'npm-cache'),
          'install',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          archive,
        ],
        cwd,
      );
      const installed = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8')) as {
        packages: Record<string, unknown>;
      };
      if (Object.keys(installed.packages).length !== 2)
        throw new Error('Consumer pulled in runtime dependencies');
      if (mode === 'typescript') {
        await writeFile(
          join(cwd, 'consumer.mts'),
          `import * as sdk from '@vector-trading/sdk';\n${commonTypes}`,
        );
        await writeFile(
          join(cwd, 'consumer.cts'),
          `import sdk = require('@vector-trading/sdk');\n${commonTypes}`,
        );
        await writeFile(
          join(cwd, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              target: 'ES2022',
              lib: ['ES2022', 'DOM', 'DOM.Iterable'],
              strict: true,
              exactOptionalPropertyTypes: true,
              types: [],
              outDir: 'compiled',
            },
            include: ['*.mts', '*.cts'],
          }),
        );
        run(node, [join(modules, 'typescript/bin/tsc'), '--project', 'tsconfig.json'], cwd);
        // Server projects may use Node globals without the DOM library.
        run(
          node,
          [
            join(modules, 'typescript/bin/tsc'),
            '--project',
            'tsconfig.json',
            '--noEmit',
            '--lib',
            'ES2022',
            '--types',
            'node',
            '--typeRoots',
            join(modules, '@types'),
          ],
          cwd,
        );
      }
      const load =
        mode === 'cjs'
          ? `const sdk=require('@vector-trading/sdk');`
          : mode === 'typescript'
            ? `const {sdk}=await import('./compiled/consumer.mjs');`
            : `const sdk=await import('@vector-trading/sdk');`;
      const prelude =
        mode === 'cjs'
          ? `const {createServer}=require('node:http'); const assert=require('node:assert/strict');`
          : `import {createServer} from 'node:http'; import assert from 'node:assert/strict';`;
      // Imports must not perform I/O, even in a clean installed consumer.
      const program =
        prelude +
        `\nconst originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Import performed HTTP');};\n` +
        load +
        `\nglobalThis.fetch=originalFetch;\n` +
        exercise +
        (mode === 'cjs'
          ? `exercise(sdk).catch(error=>{console.error(error);process.exitCode=1;});`
          : `await exercise(sdk);`);
      const name = mode === 'cjs' ? 'consumer.cjs' : 'run.mjs';
      await writeFile(join(cwd, name), program);
      console.log('Node ' + major + ' ' + mode + ': ' + run(node, [name], cwd).trim());
      if (mode === 'typescript') {
        await writeFile(
          join(cwd, 'run.cjs'),
          `const {createServer}=require('node:http');const assert=require('node:assert/strict');const {sdk}=require('./compiled/consumer.cjs');\n` +
            exercise +
            `exercise(sdk).catch(error=>{console.error(error);process.exitCode=1;});`,
        );
        run(node, ['run.cjs'], cwd);
      }
    }
  }
  console.log(
    'Verified archive SHA-256: ' +
      createHash('sha256')
        .update(await readFile(archive))
        .digest('hex'),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
