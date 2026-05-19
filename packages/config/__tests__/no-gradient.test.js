'use strict';

const { RuleTester } = require('eslint');
const { noGradientRule } = require('../eslint-react-native');

describe('sher-brand/no-gradient', () => {
  it('rule is defined with correct meta', () => {
    expect(noGradientRule).toBeDefined();
    expect(noGradientRule.meta.type).toBe('problem');
  });

  // RuleTester integrates with jest's global describe/it when called here.
  // Valid cases must pass; invalid cases must produce exactly the reported errors.
  // A failure here fails CI — the brand rule is machine-enforced, not merely documented.
  const tester = new RuleTester({
    languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
  });

  tester.run('sher-brand/no-gradient', noGradientRule, {
    valid: [
      { code: "import { View, StyleSheet } from 'react-native';" },
      { code: "import { colors } from '../theme/tokens';" },
      { code: 'const color = "#FF3B6B";' },
    ],
    invalid: [
      // Named import from the banned package
      {
        code: "import { LinearGradient } from 'expo-linear-gradient';",
        errors: [{ message: 'Gradients are banned (§7.5). Use solid colors only.' }],
      },
      // Side-effect import of the banned package
      {
        code: "import 'expo-linear-gradient';",
        errors: [{ message: 'Gradients are banned (§7.5). Use solid colors only.' }],
      },
      // Bare LinearGradient identifier reference (e.g. after a require())
      {
        code: 'const Foo = LinearGradient;',
        errors: [{ message: 'Gradients are banned (§7.5). Use solid colors only.' }],
      },
    ],
  });
});
