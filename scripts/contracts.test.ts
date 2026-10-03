import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { checkContracts, openApiToJsonSchema } from './check-contracts.ts';
import {
  compareGenerated,
  generatedPath,
  project,
  readJson,
  root,
  type Schema,
  type Specification,
} from './generation.ts';

describe('canonical contract and generation boundaries', () => {
  it('preserves all signal fixture acceptance through the OpenAPI projection', async () => {
    const rest = await readJson<Specification>(join(root, 'contracts/rest.openapi.json'));
    const signals = await readJson<{ definitions: Record<string, Schema>; oneOf: Schema[] }>(
      join(root, 'contracts/signals.schema.json'),
    );
    const spec = project(rest, signals);
    const ajv = new Ajv({ strict: false, strictNumbers: true });
    addFormats.default(ajv);
    const validate = ajv.compile({
      ...(openApiToJsonSchema(spec.components.schemas['SignalPayload']) as Schema),
      $defs: openApiToJsonSchema(spec.components.schemas),
    });
    const fixtures = await readJson<{ id: string; payload: unknown; schemaAccepted: boolean }[]>(
      join(root, 'conformance/signals/cases.json'),
    );
    for (const fixture of fixtures)
      expect(validate(fixture.payload), fixture.id).toBe(fixture.schemaAccepted);
    expect(spec.paths).toEqual(rest.paths);
  });
  it('keeps grant requiredness, shared fields, null and strict-object behavior', async () => {
    const rest = await readJson<Specification>(join(root, 'contracts/rest.openapi.json'));
    const spec = project(rest, await readJson(join(root, 'contracts/signals.schema.json')));
    const ajv = new Ajv({ strict: false });
    addFormats.default(ajv);
    const validate = ajv.compile({
      ...(openApiToJsonSchema(spec.components.schemas['CreateGrantRequest']) as Schema),
      $defs: openApiToJsonSchema(spec.components.schemas),
    });
    const base = { userId: 'a'.repeat(32), grantType: 'paid_external' };
    expect(validate(base)).toBe(false);
    expect(validate({ ...base, sourceId: 'invoice:1', endsAt: '2026-07-19T12:00:00.000Z' })).toBe(
      true,
    );
    expect(validate({ ...base, sourceId: 'invoice:1', endsAt: null })).toBe(false);
    expect(validate({ ...base, sourceId: 'invoice:1', ignored: true })).toBe(false);
    for (const kind of ['owner_grant', 'referral_reward', 'gift'])
      expect(validate({ ...base, grantType: kind })).toBe(true);
    expect(
      spec.components.schemas['PaidExternalGrantRequest']?.properties?.['sourceId']?.[
        'x-vector-optional-nonnullable'
      ],
    ).toBeUndefined();
  });
  it('rejects altered artifact bytes and preview provenance', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-contract-test-'));
    try {
      await cp(join(root, 'contracts'), join(temp, 'contracts'), { recursive: true });
      await cp(join(root, 'conformance'), join(temp, 'conformance'), { recursive: true });
      await checkContracts(temp);
      const manifest = await readJson<{ status: string }>(join(temp, 'contracts/source.json'));
      manifest.status = 'working-tree-preview';
      await writeFile(join(temp, 'contracts/source.json'), JSON.stringify(manifest));
      await expect(checkContracts(temp)).rejects.toThrow('accepted source commit');
      await cp(join(root, 'contracts/source.json'), join(temp, 'contracts/source.json'));
      await writeFile(join(temp, 'contracts/signals.schema.json'), '{}');
      await expect(checkContracts(temp)).rejects.toThrow('hash differs');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
  it('detects changed configuration provenance even when derived code bytes are unchanged', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-config-test-'));
    try {
      await cp(join(root, 'generation/generated'), temp, { recursive: true });
      await cp(generatedPath('go'), join(temp, 'go'), { recursive: true });
      const path = join(temp, 'manifest.json');
      const manifest = await readJson<{ inputs: Record<string, string> }>(path);
      manifest.inputs['generation/go.yaml'] = '0'.repeat(64);
      await writeFile(path, JSON.stringify(manifest));
      await expect(compareGenerated(temp)).rejects.toThrow('manifest.json');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 30_000);
  it('detects stale relocated Go models through the manifest root mapping', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-go-derived-test-'));
    try {
      await cp(join(root, 'generation/generated'), temp, { recursive: true });
      await cp(generatedPath('go'), join(temp, 'go'), { recursive: true });
      const path = join(temp, 'go/model_update_signal_payload_order.go');
      await writeFile(path, (await readFile(path, 'utf8')) + '\n// stale\n');
      await expect(compareGenerated(temp)).rejects.toThrow(
        'go/model_update_signal_payload_order.go',
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 30_000);
  it('detects stale derived code without modifying the canonical tree', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'vector-sdk-derived-test-'));
    try {
      await cp(join(root, 'generation/generated'), temp, { recursive: true });
      await cp(generatedPath('go'), join(temp, 'go'), { recursive: true });
      const path = join(temp, 'typescript/models/UpdateSignalPayload.ts');
      await writeFile(path, (await readFile(path, 'utf8')) + '\n// stale\n');
      await expect(compareGenerated(temp)).rejects.toThrow('Generated file differs');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 30_000);
});
