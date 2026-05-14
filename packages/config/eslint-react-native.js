const { base } = require('./eslint-base');

/** Enforces the no-gradient brand rule from §7.5 */
const noGradientRule = {
  meta: { type: 'problem', docs: { description: 'Disallow gradient utilities (brand rule §7.5)' } },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'expo-linear-gradient') {
          context.report({ node, message: 'Gradients are banned (§7.5). Use solid colors only.' });
        }
      },
      Identifier(node) {
        if (node.name === 'LinearGradient') {
          context.report({ node, message: 'Gradients are banned (§7.5). Use solid colors only.' });
        }
      },
    };
  },
};

/** @type {import("eslint").Linter.FlatConfig[]} */
const reactNativeConfig = [
  ...base,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'sher-brand': { rules: { 'no-gradient': noGradientRule } },
    },
    rules: {
      'sher-brand/no-gradient': 'error',
    },
  },
];

module.exports = { reactNativeConfig };
