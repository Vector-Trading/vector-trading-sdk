import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { requiredJobs } from './ci-result.ts';
import { root } from './generation.ts';

type Step = {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};
type Job = {
  name: string;
  needs?: string[];
  if?: string;
  'runs-on': string;
  'timeout-minutes': number;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
export function checkWorkflow(workflow: Workflow): void {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.equal(workflow.on['pull_request'], null);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [...requiredJobs, 'sdk-ci'].sort());
  const aggregate = workflow.jobs['sdk-ci']!;
  assert.equal(aggregate.name, 'sdk-ci');
  assert.equal(aggregate.if, 'always()');
  assert.deepEqual([...aggregate.needs!].sort(), [...requiredJobs].sort());
  assert(
    aggregate.steps.some(
      (step) =>
        step.run === 'node scripts/check-ci-result.ts' &&
        step.env?.['SDK_CI_NEEDS'] === '${{ toJSON(needs) }}',
    ),
  );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30);
    if (name !== 'sdk-ci') {
      assert.equal(job.if, undefined);
      assert(job.steps.some((step) => step.run === `corepack pnpm check:area ${name}`));
      assert(
        job.steps.some(
          (step) => step.uses === './.github/actions/setup-tools' && step.with?.['area'] === name,
        ),
      );
    }
    for (const step of job.steps) {
      if (step.uses && !step.uses.startsWith('./'))
        assert(/^[\w.-]+\/[\w.-]+@[a-f\d]{40}$/.test(step.uses));
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with?.['persist-credentials'], false);
      if (step.uses?.startsWith('actions/upload-artifact@')) {
        assert.equal(step.with?.['retention-days'], 3);
        assert.equal(step.with?.['if-no-files-found'], 'error');
        assert(!String(step.with?.['path']).includes('**'));
      }
      assert(!JSON.stringify(step).includes('secrets.'));
    }
  }
}
export function checkToolSetup(action: { runs: { steps: Step[] } }): void {
  for (const step of action.runs.steps) {
    if (step.uses) assert(/^[\w.-]+\/[\w.-]+@[a-f\d]{40}$/.test(step.uses));
    assert(!JSON.stringify(step).includes('secrets.'));
  }
  const java = action.runs.steps.filter((step) => step.uses?.startsWith('actions/setup-java@'));
  assert.equal(java.length, 1);
  assert.match(String(java[0]?.with?.['java-version']), /^\d+\.\d+\.\d+(?:\+\d+)?$/);
  // Corretto's setup-java resolver only accepts majors, so it cannot honor exact pins.
  assert.notEqual(
    java[0]?.with?.['distribution'],
    'corretto',
    'Corretto setup-java does not support exact Java versions',
  );
}

export async function checkCi(): Promise<void> {
  const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  checkWorkflow(parse(workflow) as Workflow);
  const setup = await readFile(join(root, '.github/actions/setup-tools/action.yml'), 'utf8');
  checkToolSetup(parse(setup));
  for (const pin of [
    '22.23.2',
    '24.21.0',
    'corepack@0.36.0',
    '0.12.1',
    '3.12.9',
    '3.14.6',
    '1.26.0',
    '1.27.1',
    '1.99.0',
    '1.88.0',
    'staticcheck@v0.8.1',
  ])
    assert(setup.includes(pin));
  const dependabot = parse(await readFile(join(root, '.github/dependabot.yml'), 'utf8')) as {
    version: number;
    updates: { 'package-ecosystem': string; directory?: string; directories?: string[] }[];
  };
  assert.equal(dependabot.version, 2);
  assert.deepEqual(dependabot.updates.map((update) => update['package-ecosystem']).sort(), [
    'cargo',
    'github-actions',
    'gomod',
  ]);
  for (const update of dependabot.updates) {
    for (const directory of update.directories ?? [update.directory!]) {
      if (update['package-ecosystem'] === 'cargo')
        await readFile(join(root, directory, 'Cargo.toml'));
      if (update['package-ecosystem'] === 'gomod') await readFile(join(root, directory, 'go.mod'));
    }
  }
  const actionlint = process.env['SDK_ACTIONLINT'] ?? join(root, '.cache/go-tools/actionlint');
  const version = execFileSync(actionlint, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(version.split('\n')[0], 'v1.7.12');
  execFileSync(actionlint, ['-shellcheck=', '.github/workflows/ci.yml'], {
    cwd: root,
    stdio: 'inherit',
    timeout: 30_000,
  });
  console.log(
    'CI jobs, aggregate, action pins, permissions, Dependabot targets, and actionlint checked.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkCi();
