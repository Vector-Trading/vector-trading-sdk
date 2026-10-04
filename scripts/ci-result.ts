export const requiredJobs = [
  'contracts',
  'typescript',
  'python',
  'go',
  'rust',
  'documentation',
] as const;

export function checkResults(needs: unknown): void {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs))
    throw new Error('Missing job results');
  const jobs = needs as Record<string, { result?: string }>;
  if (Object.keys(jobs).sort().join(',') !== [...requiredJobs].sort().join(','))
    throw new Error('Required CI jobs differ');
  for (const name of requiredJobs) {
    if (jobs[name]?.result !== 'success')
      throw new Error(`Required job ${name}: ${jobs[name]?.result ?? 'missing'}`);
  }
}
