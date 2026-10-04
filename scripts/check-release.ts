import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { root } from './generation.ts';

type Job = {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps: { uses?: string; with?: Record<string, unknown>; run?: string }[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { 'cancel-in-progress': boolean; group: string };
  jobs: Record<string, Job>;
};
export function checkRelease(workflow: Workflow): void {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert(workflow.concurrency.group.includes('inputs.version'));
  assert.deepEqual(
    Object.keys(workflow.jobs).sort(),
    ['prepare', 'gate', 'npm', 'pypi', 'crates', 'go', 'summary'].sort(),
  );
  const prepare = workflow.jobs['prepare']!;
  assert.equal(prepare.environment, undefined);
  assert.equal(prepare.permissions, undefined);
  assert(prepare.if?.includes("inputs.mode == 'prepare'"));
  assert(
    prepare.steps.some(
      (s) => s.uses === './.github/actions/setup-tools' && s.with?.['area'] === 'release',
    ),
  );
  assert(prepare.steps.some((s) => s.run?.includes('scripts/release.ts')));
  const gate = workflow.jobs['gate']!;
  assert.deepEqual(gate.permissions, { contents: 'read', actions: 'read' });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== 'prepare') {
      assert(job.if?.includes("github.event_name == 'workflow_dispatch'"));
      assert(job.if?.includes("github.ref == 'refs/heads/main'"));
      const install = job.steps.findIndex((step) =>
        step.run?.includes('corepack pnpm install --frozen-lockfile --ignore-scripts'),
      );
      const entry = job.steps.findIndex((step) => step.run?.includes('scripts/release.ts'));
      assert(install >= 0 && install < entry, 'Release tools must be installed before execution');
      assert(job.steps[install]!.run?.includes('npm install --global corepack@0.36.0'));
      if (name !== 'gate') {
        assert.equal(job.environment, 'release');
        assert(
          name === 'summary'
            ? Array.isArray(job.needs) && job.needs.includes('gate')
            : job.needs === 'gate',
        );
      }
    }
    if (['npm', 'pypi', 'crates'].includes(name))
      assert.deepEqual(job.permissions, { contents: 'read', actions: 'read', 'id-token': 'write' });
    else assert.equal(job.permissions?.['id-token'], undefined);
    if (['go', 'summary'].includes(name))
      assert.deepEqual(job.permissions, { contents: 'write', actions: 'read' });
    for (const step of job.steps) {
      assert(!JSON.stringify(step).includes('secrets.'));
      if (step.uses && !step.uses.startsWith('./'))
        assert(/^[\w.-]+\/[\w.-]+@[a-f\d]{40}$/.test(step.uses));
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with?.['persist-credentials'], false);
      if (['npm', 'pypi', 'crates', 'go', 'summary'].includes(name) && step.run)
        assert(
          !/\b(?:pnpm (?:build|verify)|cargo (?:build|package|publish)|uv build)\b/.test(step.run),
        );
    }
  }
  assert(workflow.jobs['summary']!.if?.startsWith('always()'));
}
export async function checkReleaseFiles(): Promise<void> {
  checkRelease(
    parse(await readFile(join(root, '.github/workflows/release.yml'), 'utf8')) as Workflow,
  );
  const setup = parse(
    await readFile(join(root, '.github/actions/setup-tools/action.yml'), 'utf8'),
  ) as { runs: { steps: { if?: string }[] } };
  for (const step of setup.runs.steps)
    if (step.if) assert(step.if.includes("inputs.area == 'release'"));
  const actionlint = process.env['SDK_ACTIONLINT'] ?? join(root, '.cache/go-tools/actionlint');
  execFileSync(actionlint, ['-shellcheck=', '.github/workflows/release.yml'], {
    cwd: root,
    stdio: 'inherit',
    timeout: 30_000,
  });
  console.log('Release permissions, source gates, artifact reuse, and actionlint checked.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await checkReleaseFiles();
