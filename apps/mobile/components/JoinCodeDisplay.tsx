import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';

interface JoinCodeDisplayProps {
  code: string;
}

/**
 * Renders a 6-character Crockford base32 join code in a prominent monospace block.
 * §7.5: 32pt, monospace, letter-spaced. Solid background only — no gradients.
 */
export function JoinCodeDisplay({ code }: JoinCodeDisplayProps) {
  // Render each character in its own box so letter spacing is uniform across platforms.
  const chars = code.toUpperCase().split('');
  return (
    <View style={styles.row} accessibilityLabel={`Join code: ${code}`}>
      {chars.map((ch, i) => (
        <View key={i} style={styles.charBox}>
          <Text style={styles.char}>{ch}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  charBox: {
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    width: 44,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  char: {
    fontFamily: fonts.mono,
    fontSize: fontSizes.joinCode,
    color: colors.accent,
  },
});
