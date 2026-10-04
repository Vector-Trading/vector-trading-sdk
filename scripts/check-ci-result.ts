import { checkResults } from './ci-result.ts';
checkResults(JSON.parse(process.env['SDK_CI_NEEDS'] ?? 'null'));
console.log('Every required SDK job succeeded.');
