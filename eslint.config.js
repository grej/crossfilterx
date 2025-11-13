import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'packages/*/dist/**',
      'packages/*/src/wasm/pkg/**',
      'packages/core/src/wasm/kernels/target/**',
      '**/*.d.ts',
    ],
  },
  // JavaScript/MJS files configuration (no TypeScript parser)
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      'import/no-unresolved': 'off', // Turn off for JS files
    },
  },
  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['tsconfig.base.json', 'packages/*/tsconfig.json'],
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.worker,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      // Relax some rules for development
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'warn', // Changed to warn instead of error
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
        },
      ],
      'import/no-unresolved': 'warn', // Warn instead of error for TS files
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['tsconfig.base.json', 'packages/*/tsconfig.json'],
        },
      },
    },
  },
  prettierConfig,
];
