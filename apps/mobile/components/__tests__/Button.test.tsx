/**
 * Style assertions for Button variants.
 *
 * Verifies:
 * 1. The `dark` variant renders with navy background (#000a22) and white text.
 * 2. The `ghost-dark` variant renders with transparent background and primary text/border
 *    (for buttons placed on dark card backgrounds, e.g. the Share button on the ink QR card).
 * 3. Pre-existing variants (primary, secondary, danger, ghost) are unaffected —
 *    their background and foreground colors remain unchanged by the addition of
 *    the new variant.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Button } from '../Button';
import { colors } from '../../theme/tokens';

describe('Button — variant styles', () => {
  // ── New variant ─────────────────────────────────────────────────────────────

  describe('dark variant ("Take photo")', () => {
    it('renders with navy (#000a22) background', () => {
      const { getByRole } = render(<Button label="Take photo" variant="dark" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: colors.navy });
    });

    it('renders with white text', () => {
      const { getByText } = render(<Button label="Take photo" variant="dark" />);
      expect(getByText('Take photo')).toHaveStyle({ color: '#FFFFFF' });
    });
  });

  // ── ghost-dark variant ───────────────────────────────────────────────────────

  describe('ghost-dark variant (Share button on ink QR card)', () => {
    it('renders with transparent background', () => {
      const { getByRole } = render(<Button label="Share" variant="ghost-dark" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: 'transparent' });
    });

    it('renders with primary (coral) text', () => {
      const { getByText } = render(<Button label="Share" variant="ghost-dark" />);
      expect(getByText('Share')).toHaveStyle({ color: colors.primary });
    });
  });

  // ── Existing variants — guard against accidental side-effects ───────────────

  describe('primary variant (unchanged)', () => {
    it('still has primary (coral) background', () => {
      const { getByRole } = render(<Button label="foo" variant="primary" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: colors.primary });
    });

    it('still has coal text', () => {
      const { getByText } = render(<Button label="foo" variant="primary" />);
      expect(getByText('foo')).toHaveStyle({ color: colors.coal });
    });
  });

  describe('secondary variant (unchanged)', () => {
    it('still has violet background', () => {
      const { getByRole } = render(<Button label="foo" variant="secondary" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: colors.violet });
    });

    it('still has cream text', () => {
      const { getByText } = render(<Button label="foo" variant="secondary" />);
      expect(getByText('foo')).toHaveStyle({ color: colors.cream });
    });
  });

  describe('danger variant (unchanged)', () => {
    it('still has danger (red) background', () => {
      const { getByRole } = render(<Button label="foo" variant="danger" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: colors.danger });
    });

    it('still has coal text', () => {
      const { getByText } = render(<Button label="foo" variant="secondary" />);
      expect(getByText('foo')).toHaveStyle({ color: colors.cream });
    });
  });

  describe('ghost variant (unchanged)', () => {
    it('still has transparent background', () => {
      const { getByRole } = render(<Button label="foo" variant="ghost" />);
      expect(getByRole('button')).toHaveStyle({ backgroundColor: 'transparent' });
    });

    it('still has coal text', () => {
      const { getByText } = render(<Button label="foo" variant="ghost" />);
      expect(getByText('foo')).toHaveStyle({ color: colors.coal });
    });
  });
});
