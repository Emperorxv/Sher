import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSizes, radii } from '../theme';

type StickerVariant = 'host' | 'you' | 'unlocked' | 'locked' | 'new';

const stickerMap: Record<StickerVariant, { bg: string; fg: string; label: string }> = {
  host: { bg: colors.violet, fg: colors.cream, label: 'Host' },
  you: { bg: colors.primary, fg: colors.cream, label: 'You' },
  unlocked: { bg: colors.success, fg: colors.coal, label: 'Unlocked' },
  locked: { bg: colors.fog, fg: colors.coal, label: 'Locked' },
  new: { bg: colors.accent, fg: colors.coal, label: 'New' },
};

interface StickerProps {
  variant: StickerVariant;
  /** Custom rotation in degrees, −4 to 4. Defaults to slight rotation per §7.5. */
  rotation?: number;
  /** Override label text. */
  label?: string;
}

export function Sticker({ variant, rotation = -2, label }: StickerProps) {
  const s = stickerMap[variant];
  return (
    <View
      style={[styles.chip, { backgroundColor: s.bg, transform: [{ rotate: `${rotation}deg` }] }]}
    >
      <Text style={[styles.text, { color: s.fg }]}>{label ?? s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.chip,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
  },
});
