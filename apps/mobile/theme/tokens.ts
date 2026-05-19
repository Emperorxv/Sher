import { Platform } from 'react-native';

// §7.5 color tokens — source of truth for the mobile app.
// All values are solid; no gradient utilities are exported from this module.
export const colors = {
  primary: '#FF3B6B', // coral pink — primary buttons, brand mark, active states
  accent: '#FFD60A', // sunshine yellow — highlights, badges, "new" indicators
  success: '#00C4B8', // electric teal — success states, paid/unlocked indicators
  violet: '#7B2CBF', // deep purple — secondary actions, host badge
  coal: '#0A0A0A', // near-black — body text, primary content
  cream: '#FFF8F0', // warm off-white — default background
  ink: '#1A1A1A', // cards on cream, alt surfaces
  fog: '#E8E4DE', // borders, dividers, disabled
  danger: '#E53935', // destructive actions, errors
} as const;

export type ColorToken = keyof typeof colors;

// §7.5 typography — Roboto, single family, weight-based hierarchy.
// Font names match @expo-google-fonts/roboto exports.
export const fonts = {
  display: 'Roboto_900Black',
  heading: 'Roboto_700Bold',
  label: 'Roboto_500Medium',
  body: 'Roboto_400Regular',
  caption: 'Roboto_400Regular',
  // Join codes: system monospace, no extra download required.
  mono: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }),
} as const;

// §7.5 type scale (pt)
export const fontSizes = {
  display1: 40,
  display2: 32,
  display3: 26,
  heading1: 22,
  heading2: 18,
  body1: 16,
  body2: 14,
  caption: 12,
  joinCode: 32,
} as const;

// §7.5 border radius
export const radii = {
  card: 16,
  button: 12,
  chip: 999,
} as const;

// Spacing scale (multiples of 4)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// Minimum tap target (§7.5 accessibility)
export const minTapTarget = 44;
