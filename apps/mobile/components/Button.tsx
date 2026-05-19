import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, fonts, fontSizes, radii, minTapTarget } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: Variant;
}

// Text color chosen to meet WCAG AA 4.5:1 on each background:
//   primary  (#FF3B6B) → coal  5.74:1 ✓   (cream would only be 3.27:1 — fails)
//   secondary (#7B2CBF) → cream 7.06:1 ✓
//   danger   (#E53935) → coal  4.68:1 ✓   (cream would only be 4.01:1 — fails)
//   ghost    (transparent/cream) → coal 18:1 ✓  border is primary for brand signal
const variantStyles: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.coal },
  secondary: { bg: colors.violet, fg: colors.cream },
  danger: { bg: colors.danger, fg: colors.coal },
  ghost: { bg: 'transparent', fg: colors.coal, border: colors.primary },
};

export function Button({ label, variant = 'primary', disabled, ...rest }: ButtonProps) {
  const vs = variantStyles[variant];
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: vs.bg, borderColor: vs.border ?? 'transparent' },
        vs.border && styles.bordered,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.label, { color: disabled ? colors.fog : vs.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTapTarget,
    borderRadius: radii.button,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bordered: {
    borderWidth: 2,
  },
  label: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    backgroundColor: colors.fog,
  },
});
