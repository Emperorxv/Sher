/**
 * PhotoGallery — renders the room's photo grid.
 *
 * States:
 *   loading   — ActivityIndicator while usePhotos fetches.
 *   locked    — LockedGalleryPlaceholder when meta.locked is true.
 *   empty     — "No photos yet." when unlocked but gallery is empty.
 *   populated — 3-column thumbnail FlatList.
 *
 * No gradients; solid colors only.
 */
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { usePhotos } from '../lib/photos';
import { LockedGalleryPlaceholder } from './LockedGalleryPlaceholder';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';

export type PhotoGalleryProps = {
  roomId: string;
  /** Photo count shown in the locked placeholder (use room.photoCount). */
  photoCount?: number;
  /** Called when user taps the locked placeholder; wires to open PaywallSheet. */
  onUnlockPress?: () => void;
};

const COLUMNS = 3;

export function PhotoGallery({ roomId, photoCount, onUnlockPress }: PhotoGalleryProps) {
  const router = useRouter();
  const { data, isLoading } = usePhotos(roomId);
  if (isLoading) {
    return (
      <View style={styles.loading} testID="gallery-loading">
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (data?.meta.locked) {
    return <LockedGalleryPlaceholder photoCount={photoCount ?? 0} onUnlockPress={onUnlockPress} />;
  }

  if (!data?.data.length) {
    return (
      <View style={styles.empty} testID="gallery-empty">
        <Text style={styles.emptyText}>No photos yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={data.data}
      keyExtractor={(p) => p.id}
      numColumns={COLUMNS}
      scrollEnabled={false}
      testID="gallery-grid"
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/rooms/${roomId}/photo/${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel="View photo"
          testID={`photo-tile-${item.id}`}
        >
          {item.thumbUrl ? (
            <Image
              source={{ uri: item.thumbUrl }}
              style={styles.thumb}
              testID={`photo-thumb-${item.id}`}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPending]} testID={`photo-pending-${item.id}`} />
          )}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    opacity: 0.5,
  },
  thumb: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: radii.button,
    backgroundColor: colors.fog,
  },
  thumbPending: {
    opacity: 0.4,
  },
});
