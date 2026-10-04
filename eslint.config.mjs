import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/target/**',
    '**/coverage/**',
    '**/.cache/**',
    '**/.tmp/**',
    '**/tmp/**',
    '**/generated/**',
    'release/artifacts/**',
    'release/staging/**',
    'release/outcomes/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
