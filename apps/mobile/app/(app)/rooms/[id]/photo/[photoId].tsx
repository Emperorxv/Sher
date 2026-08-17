/**
 * Photo detail screen — /rooms/[id]/photo/[photoId]
 *
 * Modal-style full-resolution photo view.
 * No gradients; solid colors only.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { ApiError } from '@sher/api-client';
import { usePhoto } from '../../../../../lib/photos';
import { ReportSheet } from '../../../../../components/ReportSheet';
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
  const [reportOpen, setReportOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // ── Download handler ──────────────────────────────────────────────────────

  async function handleDownload() {
    if (!photo?.downloadUrl) return;

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access in Settings to save photos.');
      return;
    }

    setDownloading(true);
    try {
      const ext = photo.mimeType === 'image/png' ? 'png' : 'jpg';
      const localUri = `${FileSystem.cacheDirectory}sher-${photoId}.${ext}`;
      await FileSystem.downloadAsync(photo.downloadUrl, localUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved', 'Photo saved to your library.');
    } catch {
      Alert.alert('Error', 'Could not save the photo. Try again.');
    } finally {
      setDownloading(false);
    }
  }

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

        <Pressable
          style={styles.overflowButton}
          onPress={() => setReportOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="More options"
          testID="photo-overflow-button"
        >
          <Text style={styles.overflowLabel}>•••</Text>
        </Pressable>
      </View>

      {/* Full-resolution image */}
      <Image
        source={{ uri: photo.originalUrl ?? undefined }}
        style={styles.image}
        resizeMode="contain"
        testID="photo-detail-image"
        accessibilityLabel="Full-resolution photo"
      />

      {/* Download button — only shown once the room is unlocked (downloadUrl non-null) */}
      {photo.downloadUrl && (
        <View style={styles.downloadRow}>
          <Pressable
            style={[styles.downloadButton, downloading && styles.downloadButtonDisabled]}
            onPress={handleDownload}
            disabled={downloading}
            accessibilityRole="button"
            accessibilityLabel="Download photo"
            testID="photo-download-button"
          >
            <Text style={styles.downloadLabel}>{downloading ? 'Saving…' : 'Download'}</Text>
          </Pressable>
        </View>
      )}

      {reportOpen && (
        <ReportSheet
          visible={reportOpen}
          targetType="PHOTO"
          targetId={photoId ?? ''}
          roomId={id ?? ''}
          onDismiss={() => setReportOpen(false)}
        />
      )}
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
  overflowButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 248, 240, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowLabel: {
    fontSize: 14,
    color: colors.cream,
    fontFamily: fonts.label,
    letterSpacing: 2,
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
  downloadRow: {
    padding: spacing.md,
    alignItems: 'center',
  },
  downloadButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minWidth: 160,
  },
  downloadButtonDisabled: {
    opacity: 0.6,
  },
  downloadLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
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
