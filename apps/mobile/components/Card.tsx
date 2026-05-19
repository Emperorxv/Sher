import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radii } from '../theme';

interface CardProps extends ViewProps {
  children: ReactNode;
  /** Override the background; must be a §7.5 color token value. No gradients. */
  backgroundColor?: string;
  bordered?: boolean;
}

export function Card({
  children,
  backgroundColor = colors.cream,
  bordered = false,
  style,
  ...rest
}: CardProps) {
  return (
    <View {...rest} style={[styles.base, { backgroundColor }, bordered && styles.bordered, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.card,
    padding: 16,
  },
  bordered: {
    borderWidth: 1,
    borderColor: colors.fog,
  },
});
