const { base } = require('./eslint-base');

/** @type {import("eslint").Linter.FlatConfig[]} */
const nodeConfig = [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'warn',
    },
  },
];

module.exports = { nodeConfig };
