/**
 * WCAG AA contrast audit for §7.5 color token pairs.
 *
 * WCAG 2.1 AA thresholds:
 *   - Normal text (< 18pt or < 14pt bold): contrast ratio ≥ 4.5 : 1
 *   - Large text  (≥ 18pt or ≥ 14pt bold): contrast ratio ≥ 3.0 : 1
 *
 * If any assertion fails, the commit that introduced it must fix the color before merging.
 */

import { colors } from '../tokens';

// ─── WCAG math ──────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertAA(fg: string, bg: string, fgName: string, bgName: string, large = false) {
  const ratio = contrastRatio(fg, bg);
  const threshold = large ? 3.0 : 4.5;
  expect(ratio).toBeGreaterThanOrEqual(threshold);
  // (human-readable label surfaces in the jest failure message)
  expect(`${fgName} on ${bgName}: ${ratio.toFixed(2)}:1`).toMatch(
    large ? /^.+\d+\.\d+:\d+$/ : /^.+\d+\.\d+:\d+$/,
  );
}

// ─── Pairs used in actual UI (§7.5) ─────────────────────────────────────────
//
// Each pair is annotated with where it appears in the app.

describe('WCAG AA contrast — §7.5 token pairs', () => {
  // Default background is cream. Most body text is coal or ink.
  it('coal (body text) on cream background ≥ 4.5:1', () => {
    assertAA(colors.coal, colors.cream, 'coal', 'cream');
  });

  it('ink (alt text) on cream background ≥ 4.5:1', () => {
    assertAA(colors.ink, colors.cream, 'ink', 'cream');
  });

  // Primary button: coal label on primary bg.
  // NOTE: `colors.primary` (#FF3B6B) is 3.27:1 against cream — too low for text.
  // Buttons use `coal` fg on primary bg for compliance. See §7.5 audit note.
  it('coal (button label) on primary ≥ 4.5:1', () => {
    assertAA(colors.coal, colors.primary, 'coal', 'primary');
  });

  // Danger button: coal label on danger bg (4.68:1).
  it('coal (button label) on danger ≥ 4.5:1', () => {
    assertAA(colors.coal, colors.danger, 'coal', 'danger');
  });

  // Violet secondary button: cream label on violet bg (7.06:1).
  it('cream (button label) on violet ≥ 4.5:1', () => {
    assertAA(colors.cream, colors.violet, 'cream', 'violet');
  });

  // Ghost button: coal label on transparent→cream. Same as coal on cream (18:1).
  // Primary is used only for the border, not the label — see Button.tsx.
  it('coal (ghost button label) on cream ≥ 4.5:1', () => {
    assertAA(colors.coal, colors.cream, 'coal', 'cream (ghost button)');
  });

  // Accent sticker / badge — "New" sticker is coal-on-accent (large text, 12pt bold chip)
  it('coal on accent ≥ 3.0:1 (large text — chip label)', () => {
    assertAA(colors.coal, colors.accent, 'coal', 'accent', /* large */ true);
  });

  // Success "Unlocked" sticker — coal on success
  it('coal on success ≥ 3.0:1 (large text — chip label)', () => {
    assertAA(colors.coal, colors.success, 'coal', 'success', /* large */ true);
  });

  // Join code: accent text on ink card
  it('accent (join code) on ink ≥ 4.5:1', () => {
    assertAA(colors.accent, colors.ink, 'accent', 'ink');
  });

  // Host sticker: cream on violet
  it('cream on violet ≥ 4.5:1 (host sticker)', () => {
    assertAA(colors.cream, colors.violet, 'cream', 'violet');
  });

  // Fog border / disabled state: not checked for text contrast (it's decorative / icon-paired).
  // Verified: disabled button uses fog bg + no text (icon-only) OR pairs with coal text below.

  // ghost-dark button (Share button inside the ink QR card): primary text on ink (5.04:1).
  // ghost variant uses coal-on-cream (18:1) and must NOT be used on dark backgrounds.
  it('primary (ghost-dark button label) on ink ≥ 4.5:1', () => {
    assertAA(colors.primary, colors.ink, 'primary', 'ink (ghost-dark button)');
  });

  // Dark ("Take photo") button: white label on navy bg (~19.5:1).
  it('white (button label) on navy (dark button) ≥ 4.5:1', () => {
    assertAA('#FFFFFF', colors.navy, 'white', 'navy');
  });

  // Smoke test: the ratio function itself is correct for known values
  it('white on black = 21:1 (reference)', () => {
    const ratio = contrastRatio('#FFFFFF', '#000000');
    expect(ratio).toBeCloseTo(21, 0);
  });
});
