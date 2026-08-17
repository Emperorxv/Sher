/**
 * PhotoGallery — renders the room's photo grid.
 *
 * States:
 *   loading   — ActivityIndicator while usePhotos fetches.
 *   locked    — LockedGalleryPlaceholder when meta.locked is true.
 *   empty     — "No photos yet." / "You haven't taken any photos yet."
 *   populated — 3-column thumbnail grid (View + .map(), NOT FlatList).
 *
 * Why not FlatList: FlatList nested inside a parent ScrollView renders
 * with zero visible height unless given an explicit height, making all
 * photo tiles invisible even when data is valid.  The plain View grid
 * has no such constraint.
 *
 * The scope toggle (All | Mine) is always rendered above the content area
 * and is disabled (dimmed, taps ignored) while a fetch is in-flight.
 * It is hidden only when the gallery is confirmed locked (paywall state).
 *
 * No gradients; solid colors only.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePhotos } from '../lib/photos';
import { LockedGalleryPlaceholder } from './LockedGalleryPlaceholder';
import { ReportSheet } from './ReportSheet';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';

export type PhotoGalleryProps = {
  roomId: string;
  /** Photo count shown in the locked placeholder (use room.photoCount). */
  photoCount?: number;
  /** Called when user taps the locked placeholder; wires to open PaywallSheet. */
  onUnlockPress?: () => void;
  /** Current user's ID — used to determine photo ownership for the delete affordance. */
  currentUserId?: string;
  /** Called when the current user confirms deletion of one of their own photos. */
  onDeletePhoto?: (photoId: string) => void;
};

const COLUMNS = 3;

/** Splits an array into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

export function PhotoGallery({
  roomId,
  photoCount,
  onUnlockPress,
  currentUserId,
  onDeletePhoto,
}: PhotoGalleryProps) {
  const router = useRouter();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const { data, isLoading } = usePhotos(roomId, scope);
  console.log(
    'PhotoGallery DEBUG:',
    JSON.stringify(
      {
        roomId,
        meta: data?.meta,
        items: data?.data?.map((p) => ({ id: p.id, thumbUrl: p.thumbUrl })),
      },
      null,
      2,
    ),
  );
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);

  // Paywall locked: hide toggle, return placeholder immediately.
  if (data?.meta.locked) {
    return <LockedGalleryPlaceholder photoCount={photoCount ?? 0} onUnlockPress={onUnlockPress} />;
  }

  return (
    <>
      {/* Scope toggle — always visible; disabled while fetch is in-flight. */}
      <View style={[styles.toggleRow, isLoading && styles.toggleDimmed]}>
        <Pressable
          style={[styles.toggleSegment, scope === 'all' && styles.segmentActive]}
          onPress={() => setScope('all')}
          disabled={isLoading}
          testID="scope-toggle-all"
          accessibilityRole="button"
          accessibilityLabel="Show all photos"
          accessibilityState={{ selected: scope === 'all', disabled: isLoading }}
        >
          <Text style={[styles.segmentLabel, scope === 'all' && styles.segmentLabelActive]}>
            All
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleSegment, scope === 'mine' && styles.segmentActive]}
          onPress={() => setScope('mine')}
          disabled={isLoading}
          testID="scope-toggle-mine"
          accessibilityRole="button"
          accessibilityLabel="Show my photos"
          accessibilityState={{ selected: scope === 'mine', disabled: isLoading }}
        >
          <Text style={[styles.segmentLabel, scope === 'mine' && styles.segmentLabelActive]}>
            Mine
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loading} testID="gallery-loading">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !data?.data.length ? (
        <View style={styles.empty} testID="gallery-empty">
          <Text style={styles.emptyText}>
            {scope === 'mine' ? "You haven't taken any photos yet." : 'No photos yet.'}
          </Text>
        </View>
      ) : (
        // Plain View grid — avoids the FlatList zero-height bug when nested in ScrollView.
        <View testID="gallery-grid">
          {chunk(data.data, COLUMNS).map((row, rowIdx) => (
            <View key={rowIdx} style={styles.gridRow}>
              {row.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.thumbWrapper}
                  onPress={() => router.push(`/rooms/${roomId}/photo/${item.id}`)}
                  onLongPress={() => {
                    const isOwn =
                      currentUserId && item.uploaderId === currentUserId && onDeletePhoto;
                    if (isOwn) {
                      Alert.alert('Photo options', '', [
                        {
                          text: 'Delete photo',
                          style: 'destructive',
                          onPress: () => onDeletePhoto(item.id),
                        },
                        { text: 'Report photo', onPress: () => setReportPhotoId(item.id) },
                        { text: 'Cancel', style: 'cancel' },
                      ]);
                    } else {
                      setReportPhotoId(item.id);
                    }
                  }}
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
                    <View
                      style={[styles.thumb, styles.thumbPending]}
                      testID={`photo-pending-${item.id}`}
                    />
                  )}
                </Pressable>
              ))}
              {/* Filler slots so flex-1 items in an incomplete row stay 1/3 wide. */}
              {Array.from({ length: COLUMNS - row.length }).map((_, i) => (
                <View key={`filler-${rowIdx}-${i}`} style={styles.thumbWrapper} />
              ))}
            </View>
          ))}
        </View>
      )}

      {reportPhotoId && (
        <ReportSheet
          visible={!!reportPhotoId}
          targetType="PHOTO"
          targetId={reportPhotoId}
          roomId={roomId}
          onDismiss={() => setReportPhotoId(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.fog,
    borderRadius: radii.button,
    marginBottom: spacing.md,
    padding: 4,
  },
  toggleDimmed: {
    opacity: 0.4,
  },
  toggleSegment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radii.button - 2,
  },
  segmentActive: {
    backgroundColor: colors.coal,
  },
  segmentLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.coal,
    opacity: 0.5,
  },
  segmentLabelActive: {
    color: colors.cream,
    opacity: 1,
  },
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
  gridRow: {
    flexDirection: 'row',
  },
  thumbWrapper: {
    flex: 1,
  },
  thumb: {
    aspectRatio: 1,
    margin: 2,
    borderRadius: radii.button,
    backgroundColor: colors.fog,
  },
  thumbPending: {
    opacity: 0.4,
  },
});
