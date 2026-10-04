export const snapshotFiles = [
  'conformance/rest/cases.json',
  'conformance/signals/cases.json',
  'contracts/rest.openapi.json',
  'contracts/signals.schema.json',
] as const;

export type PublicSnapshot = {
  format: 1;
  contractVersion: string;
  status: 'committed';
  files: Record<string, { sha256: string }>;
};

export function exactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

export function publicSnapshot(value: unknown): PublicSnapshot {
  if (
    !exactKeys(value, ['format', 'contractVersion', 'status', 'files']) ||
    value['format'] !== 1 ||
    typeof value['contractVersion'] !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value['contractVersion']) ||
    !exactKeys(value['files'], snapshotFiles)
  )
    throw new Error('Public snapshot metadata differs');
  if (value['status'] !== 'committed') throw new Error('Snapshot is not an accepted snapshot');
  for (const entry of Object.values(value['files']))
    if (
      !exactKeys(entry, ['sha256']) ||
      typeof entry['sha256'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry['sha256'])
    )
      throw new Error('Public snapshot metadata differs');
  return value as PublicSnapshot;
}
