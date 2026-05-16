// Root ESLint flat config — used by lint-staged when running from the repo root.
// Per-package configs (apps/api/eslint.config.js, etc.) use `project: true`
// for full type-aware linting; this root config skips type-aware rules so
// lint-staged doesn't need a monorepo-wide tsconfig.
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.expo/**', '**/coverage/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint },
    languageOptions: {
      parser: tsParser,
      // No `project: true` — avoids requiring a root tsconfig.json.
      // Full type-aware rules run via per-package eslint.config.js.
    },
    rules: {
      ...tseslint.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'warn',
    },
  },
];
