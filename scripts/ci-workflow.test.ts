import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { checkToolSetup, checkWorkflow } from './check-ci.ts';
import { root } from './generation.ts';

const workflow = parse(await readFile(join(root, '.github/workflows/ci.yml'), 'utf8'));
it('rejects a workflow that bypasses a native language or elevates permissions', () => {
  checkWorkflow(workflow);
  for (const mutate of [
    (copy: typeof workflow) => {
      copy.jobs.rust.if = "github.event_name != 'pull_request'";
    },
    (copy: typeof workflow) => {
      copy.jobs['sdk-ci'].needs.pop();
    },
    (copy: typeof workflow) => {
      copy.jobs['sdk-ci'].if = 'success()';
    },
    (copy: typeof workflow) => {
      copy.permissions['id-token'] = 'write';
    },
    (copy: typeof workflow) => {
      copy.on.pull_request = { paths: ['typescript/**'] };
    },
  ]) {
    const copy = structuredClone(workflow);
    mutate(copy);
    expect(() => checkWorkflow(copy)).toThrow();
  }
});

it('requires a pinned Java patch with a compatible setup-java distribution', async () => {
  const setup = parse(await readFile(join(root, '.github/actions/setup-tools/action.yml'), 'utf8'));
  checkToolSetup(setup);
  for (const mutate of [
    (step: { with: Record<string, unknown> }) => {
      step.with['distribution'] = 'corretto';
    },
    (step: { with: Record<string, unknown> }) => {
      step.with['java-version'] = '11';
    },
  ]) {
    const copy = structuredClone(setup);
    mutate(
      copy.runs.steps.find((step: { uses?: string }) =>
        step.uses?.startsWith('actions/setup-java@'),
      ),
    );
    expect(() => checkToolSetup(copy)).toThrow();
  }
});
