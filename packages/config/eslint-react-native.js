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
      // Catch bare `LinearGradient` references outside of import specifiers
      // (e.g. `const G = require('expo-linear-gradient').LinearGradient`).
      // ImportDeclaration already covers import-specifier cases above.
      Identifier(node) {
        if (
          node.name === 'LinearGradient' &&
          node.parent.type !== 'ImportSpecifier' &&
          node.parent.type !== 'ImportDefaultSpecifier' &&
          node.parent.type !== 'ImportNamespaceSpecifier'
        ) {
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
      // React Native has no emitDecoratorMetadata DI issue, so prefer explicit `import type`.
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'sher-brand/no-gradient': 'error',
    },
  },
];

module.exports = { reactNativeConfig, noGradientRule };
