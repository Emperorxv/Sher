const { base } = require('./eslint-base');

/** @type {import("eslint").Linter.FlatConfig[]} */
const nodeConfig = [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'warn',
      // NestJS resolves DI tokens via emitDecoratorMetadata at runtime.
      // `import type` erases the class reference — TypeScript then emits Object instead of
      // the real constructor token and NestJS DI silently fails. `prefer: 'no-type-imports'`
      // makes the auto-fixer convert type-only imports TO value imports rather than the
      // reverse, so the pre-commit hook can never revert a necessary value import.
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'no-type-imports' }],
    },
  },
];

module.exports = { nodeConfig };
