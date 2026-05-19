import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, fonts, fontSizes, radii, minTapTarget } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: Variant;
}

const variantStyles: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.cream },
  secondary: { bg: colors.violet, fg: colors.cream },
  danger: { bg: colors.danger, fg: colors.cream },
  ghost: { bg: 'transparent', fg: colors.primary, border: colors.primary },
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
