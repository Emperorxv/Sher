import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSizes, spacing } from '../theme';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  /** A single emoji or simple text icon. Keep it small and brand-colored. */
  icon?: string;
}

/**
 * Empty state illustration using geometric shapes in brand colors.
 * §7.5: warm, conversational one-line copy. No gradients. No shadows.
 */
export function EmptyState({ title, subtitle, icon = '📷' }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="text">
      {/* Geometric brand decoration — two overlapping solid circles */}
      <View style={styles.decoration}>
        <View style={[styles.circle, { backgroundColor: colors.primary, left: 20 }]} />
        <View style={[styles.circle, { backgroundColor: colors.accent, left: 50 }]} />
      </View>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  decoration: {
    height: 60,
    width: 120,
    marginBottom: spacing.md,
    position: 'relative',
  },
  circle: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    opacity: 0.25,
  },
  icon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading2,
    color: colors.coal,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.ink,
    textAlign: 'center',
  },
});
