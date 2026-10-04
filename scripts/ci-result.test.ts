import { describe, expect, it } from 'vitest';
import { checkResults, requiredJobs } from './ci-result.ts';

const success = () => Object.fromEntries(requiredJobs.map((name) => [name, { result: 'success' }]));
describe('required CI result', () => {
  it('accepts every successful required job', () =>
    expect(() => checkResults(success())).not.toThrow());
  for (const name of requiredJobs) {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending', undefined]) {
      it(`rejects ${name} ${result}`, () => {
        const results = success();
        results[name] = { result: result! };
        expect(() => checkResults(results)).toThrow();
      });
    }
    it(`rejects missing ${name}`, () => {
      const results = success();
      delete results[name];
      expect(() => checkResults(results)).toThrow();
    });
  }
  it('rejects absent results and an unexpected required job', () => {
    expect(() => checkResults(null)).toThrow();
    expect(() => checkResults({ ...success(), unexpected: { result: 'success' } })).toThrow();
  });
});
