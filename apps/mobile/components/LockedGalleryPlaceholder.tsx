/**
 * LockedGalleryPlaceholder — tile grid shown when the gallery is locked.
 *
 * Renders `photoCount` faded placeholder tiles so the screen has the visual
 * mass of the real gallery. Tapping anywhere triggers onUnlockPress (which
 * the parent wires to open PaywallSheet).
 *
 * No gradients; all solid colors from §7.5 tokens.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';

export type LockedGalleryPlaceholderProps = {
  photoCount: number;
  onUnlockPress?: () => void;
};

const TILE_SIZE = 100;

export function LockedGalleryPlaceholder({
  photoCount,
  onUnlockPress,
}: LockedGalleryPlaceholderProps) {
  const tiles = Array.from({ length: photoCount });

  return (
    <Pressable
      style={styles.container}
      onPress={onUnlockPress}
      accessibilityRole="button"
      accessibilityLabel="Unlock gallery"
      disabled={!onUnlockPress}
    >
      <View style={styles.grid}>
        {tiles.map((_, i) => (
          <View key={i} style={styles.tile} testID={`locked-tile-${i}`}>
            <Text style={styles.lockIcon} accessibilityLabel="locked">
              🔒
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.callout}>
        <Text style={styles.calloutText}>Tap to unlock your photos</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    backgroundColor: colors.fog,
    borderRadius: radii.card,
    opacity: 0.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockIcon: {
    fontSize: fontSizes.heading1,
  },
  callout: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  calloutText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
});
