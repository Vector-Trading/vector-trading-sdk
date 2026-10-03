import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node22',
  platform: 'node',
  // tsup's declaration worker injects baseUrl for paths under TypeScript 6.
  dts: { resolve: true, compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: false,
  clean: true,
  sourcemap: false,
});
