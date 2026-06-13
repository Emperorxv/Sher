/**
 * Camera test screen — dev-only route at /camera-test.
 *
 * Purpose: Verifies that Vision Camera v5 links correctly after prebuild.
 * Surfaces four unknowns that scaffolding alone cannot confirm:
 *   1. Info.plist permission strings land in the native build
 *   2. Skia native build succeeds (consumed in Phase 6 commit 9)
 *   3. Vision Camera native module links without crash
 *   4. Camera preview renders on a real/simulator device
 *
 * NOT part of the production app — gated by __DEV__ at the entry point.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

export default function CameraTestScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput();
  const [lastPath, setLastPath] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Request permission once on mount.
  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, []);

  if (!hasPermission) {
    return (
      <View style={[styles.container, styles.centred]}>
        <Text style={styles.message}>Camera permission required</Text>
        <Pressable
          style={styles.settingsButton}
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings to grant camera permission"
        >
          <Text style={styles.settingsLabel}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  const handleCapture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await photoOutput.capturePhoto({}, {});
      const path = await photo.saveToTemporaryFileAsync();
      photo.dispose();
      setLastPath(path);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Camera style={StyleSheet.absoluteFill} device="back" isActive outputs={[photoOutput]} />

      {lastPath ? (
        <View style={styles.pathOverlayContainer}>
          <Text style={styles.pathOverlay} numberOfLines={3}>
            {lastPath}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.captureButton, capturing && styles.captureButtonActive]}
        onPress={() => void handleCapture()}
        disabled={capturing}
        accessibilityRole="button"
        accessibilityLabel="Capture photo"
      >
        <Text style={styles.captureLabel}>{capturing ? '…' : '⊙'}</Text>
      </Pressable>
    </View>
  );
}

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
  captureButton: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonActive: {
    opacity: 0.6,
  },
  captureLabel: {
    fontSize: 32,
    color: colors.coal,
  },
  pathOverlayContainer: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(10, 10, 10, 0.75)',
    borderRadius: radii.button,
    padding: spacing.sm,
  },
  pathOverlay: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
  },
});
