/**
 * Photo detail screen — /rooms/[id]/photo/[photoId]
 *
 * Modal-style full-resolution photo view.
 * No gradients; solid colors only.
 */
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@sher/api-client';
import { usePhoto } from '../../../../../lib/photos';
import { colors, fonts, fontSizes, radii, spacing } from '../../../../../theme';

// ── Error mapping ─────────────────────────────────────────────────────────────

function mapPhotoError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'PHOTO_NOT_FOUND':
        return "We couldn't find this photo.";
      case 'ROOM_LOCKED':
        return 'This room is locked. Unlock to view photos.';
      case 'GALLERY_LOCKED':
        return 'Unlock the gallery to view this photo.';
    }
  }
  if (err instanceof TypeError) {
    return 'Connection lost. Check your network.';
  }
  return "Couldn't load photo. Try again.";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PhotoDetailScreen() {
  const { id, photoId } = useLocalSearchParams<{ id: string; photoId: string }>();
  const router = useRouter();
  const { data: photo, isLoading, error } = usePhoto(id ?? '', photoId ?? '');

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} testID="photo-detail-loading">
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error || !photo) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} testID="photo-detail-error">
        <Text style={styles.errorText}>{mapPhotoError(error)}</Text>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to room"
        >
          <Text style={styles.backButtonLabel}>Back to room</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────

  const dateLabel = formatDate(photo.takenAt);

  return (
    <SafeAreaView style={styles.safe} testID="photo-detail-screen">
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.closeButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          <Text style={styles.closeLabel}>✕</Text>
        </Pressable>

        <View style={styles.meta}>
          {photo.filter && (
            <Text style={styles.metaText} testID="photo-filter">
              {photo.filter}
            </Text>
          )}
          {dateLabel && (
            <Text style={styles.metaText} testID="photo-taken-at">
              {dateLabel}
            </Text>
          )}
        </View>
      </View>

      {/* Full-resolution image */}
      <Image
        source={{ uri: photo.originalUrl ?? undefined }}
        style={styles.image}
        resizeMode="contain"
        testID="photo-detail-image"
        accessibilityLabel="Full-resolution photo"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.coal,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 248, 240, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    fontSize: 18,
    color: colors.cream,
    fontFamily: fonts.label,
  },
  meta: {
    flex: 1,
    gap: spacing.xs,
  },
  metaText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.fog,
  },
  image: {
    flex: 1,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.cream,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButtonLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
});
