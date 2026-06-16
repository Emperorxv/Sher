/**
 * Camera capture screen — /rooms/[id]/camera
 *
 * Modal-style screen reached from the room dashboard.
 * Users can take multiple photos in a single session.
 * Each capture queues an independent upload pipeline; in-flight uploads
 * continue if the screen is dismissed.
 *
 * Error mapping is handled by mapUploadError from lib/camera.
 * No gradients — solid colors only.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import {
  mapUploadError,
  useCameraDeviceWithFallback,
  useUploadPhoto,
} from '../../../../lib/camera';
import { colors, fonts, fontSizes, radii, spacing } from '../../../../theme';

// ── Per-capture upload state ─────────────────────────────────────────────────

interface UploadEntry {
  localId: string;
  filePath: string;
  status: 'uploading' | 'done' | 'error';
  errorMsg?: string;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDeviceWithFallback();
  const photoOutput = usePhotoOutput();
  const { upload } = useUploadPhoto(id ?? '');

  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, []);

  // ── Permission denied ────────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <SafeAreaView style={[styles.container, styles.centred]}>
        <Text style={styles.message}>Camera permission required</Text>
        <Pressable
          style={styles.settingsButton}
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings to grant camera permission"
        >
          <Text style={styles.settingsLabel}>Open Settings</Text>
        </Pressable>
        <Pressable
          style={styles.closeLink}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
        >
          <Text style={styles.closeLinkLabel}>Close</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── No camera device ─────────────────────────────────────────────────────

  if (device == null) {
    return (
      <SafeAreaView style={[styles.container, styles.centred]}>
        <Text style={styles.message}>Camera unavailable on this device.</Text>
        <Pressable
          style={styles.closeLink}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
        >
          <Text style={styles.closeLinkLabel}>Close</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Capture + upload ─────────────────────────────────────────────────────

  async function runUpload(localId: string, filePath: string) {
    try {
      await upload({ filePath, mimeType: 'image/jpeg', takenAt: new Date().toISOString() });
      setUploads((prev) =>
        prev.map((u) => (u.localId === localId ? { ...u, status: 'done' as const } : u)),
      );
      // Auto-clear done entries after 2 s.
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.localId !== localId));
      }, 2000);
    } catch (err: unknown) {
      setUploads((prev) =>
        prev.map((u) =>
          u.localId === localId
            ? { ...u, status: 'error' as const, errorMsg: mapUploadError(err) }
            : u,
        ),
      );
    }
  }

  async function handleCapture() {
    if (capturing) return;
    setCapturing(true);

    let filePath: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photo = await (photoOutput.capturePhoto as any)({});
      filePath = (await photo.saveToTemporaryFileAsync()) as string;
      photo.dispose();
    } catch (err: unknown) {
      setCapturing(false);
      const localId = String(Date.now());
      setUploads((prev) => [
        ...prev,
        { localId, filePath: '', status: 'error', errorMsg: mapUploadError(err) },
      ]);
      return;
    }

    setCapturing(false);
    const localId = String(Date.now());
    setUploads((prev) => [...prev, { localId, filePath, status: 'uploading' }]);
    void runUpload(localId, filePath);
  }

  function handleRetry(entry: UploadEntry) {
    if (!entry.filePath) return;
    setUploads((prev) =>
      prev.map((u) =>
        u.localId === entry.localId
          ? { ...u, status: 'uploading' as const, errorMsg: undefined }
          : u,
      ),
    );
    void runUpload(entry.localId, entry.filePath);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[photoOutput]} />

      {/* Top bar: close button */}
      <SafeAreaView style={styles.topBar}>
        <Pressable
          style={styles.closeButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
        >
          <Text style={styles.closeBtnLabel}>✕</Text>
        </Pressable>
      </SafeAreaView>

      {/* Upload tiles overlay */}
      {uploads.length > 0 && (
        <View style={styles.uploadsOverlay} testID="uploads-overlay">
          {uploads.map((entry) => (
            <View
              key={entry.localId}
              style={styles.uploadTile}
              testID={`upload-tile-${entry.localId}`}
            >
              {entry.status === 'uploading' && (
                <ActivityIndicator
                  size="small"
                  color={colors.cream}
                  testID={`spinner-${entry.localId}`}
                />
              )}
              {entry.status === 'done' && <Text style={styles.uploadDoneText}>✓</Text>}
              {entry.status === 'error' && (
                <>
                  <Text style={styles.uploadErrorText}>{entry.errorMsg}</Text>
                  <Pressable
                    onPress={() => handleRetry(entry)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry upload"
                  >
                    <Text style={styles.retryLabel}>Retry</Text>
                  </Pressable>
                </>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Capture button */}
      <View style={styles.captureBar}>
        <Pressable
          style={[styles.captureButton, capturing && styles.captureButtonActive]}
          onPress={() => void handleCapture()}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel="Capture photo"
        >
          <View style={styles.captureButtonInner} />
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.coal,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.cream,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  settingsButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  settingsLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
  closeLink: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  closeLinkLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.fog,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10, 10, 10, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnLabel: {
    fontSize: 18,
    color: colors.cream,
    fontFamily: fonts.label,
  },
  uploadsOverlay: {
    position: 'absolute',
    bottom: spacing.xxl + 88,
    left: spacing.md,
    right: spacing.md,
    gap: spacing.sm,
  },
  uploadTile: {
    backgroundColor: 'rgba(10, 10, 10, 0.75)',
    borderRadius: radii.button,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  uploadDoneText: {
    color: colors.success,
    fontSize: fontSizes.body1,
    fontFamily: fonts.heading,
  },
  uploadErrorText: {
    color: colors.danger,
    fontSize: fontSizes.body2,
    fontFamily: fonts.body,
    flex: 1,
  },
  retryLabel: {
    color: colors.accent,
    fontSize: fontSizes.body2,
    fontFamily: fonts.label,
  },
  captureBar: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.primary,
  },
  captureButtonActive: {
    opacity: 0.6,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
  },
});
