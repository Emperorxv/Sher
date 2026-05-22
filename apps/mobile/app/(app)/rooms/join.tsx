/**
 * Join Room screen — enter a 6-char code or scan a QR code via expo-camera.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PricingQuoteDto } from '@sher/shared-types';
import { Button } from '../../../components';
import { ExtraMemberSheet } from '../../../components/ExtraMemberSheet';
import { useJoinRoom } from '../../../lib/rooms';
import { apiClient } from '../../../lib/api';
import { colors, fonts, fontSizes, radii, spacing } from '../../../theme';

type Tab = 'code' | 'scan';

export default function JoinRoomScreen() {
  const router = useRouter();
  const joinRoom = useJoinRoom();
  const [permission, requestPermission] = useCameraPermissions();

  const [tab, setTab] = useState<Tab>('code');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // ExtraMemberSheet state
  const [showExtra, setShowExtra] = useState(false);
  const [extraPricing, setExtraPricing] = useState<PricingQuoteDto | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);

  async function submitCode() {
    setError(null);
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('Enter the 6-character code from the host.');
      return;
    }
    await doJoin({ joinCode: trimmed });
  }

  async function doJoin(dto: { joinCode?: string; qrToken?: string }) {
    try {
      const result = await joinRoom.mutateAsync(dto);
      if (result.willNeedMemberUnlock) {
        // Fetch pricing for this room to show correct amount
        const pricing = await apiClient.rooms.pricing(result.room.id).catch(() => null);
        setExtraPricing(pricing);
        setPendingRoomId(result.room.id);
        setShowExtra(true);
      } else {
        router.replace(`/rooms/${result.room.id}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not join room.';
      if (msg.includes('ALREADY_MEMBER')) {
        Alert.alert("You're already in this room", undefined, [
          { text: 'Go to room', onPress: () => router.replace(`/rooms/${pendingRoomId ?? ''}`) },
        ]);
      } else if (msg.includes('ROOM_NOT_FOUND')) {
        setError('Code not found. Double-check and try again.');
      } else {
        Alert.alert('Could not join', msg);
      }
    }
  }

  async function handleQrScanned(data: string) {
    if (scanning) return;
    setScanning(true);
    // QR token format: roomId.endsAt.hmac
    if (data.split('.').length === 3) {
      await doJoin({ qrToken: data });
    } else {
      Alert.alert('Invalid QR code', 'This does not look like a Sher room QR code.', [
        { text: 'Try again', onPress: () => setScanning(false) },
      ]);
    }
  }

  function handleDismissExtra() {
    setShowExtra(false);
    if (pendingRoomId) {
      router.replace(`/rooms/${pendingRoomId}`);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.heading}>Join a room</Text>

          {/* Tab switcher */}
          <View style={styles.tabs}>
            <Button
              label="Enter code"
              variant={tab === 'code' ? 'primary' : 'ghost'}
              onPress={() => setTab('code')}
              style={styles.tabBtn}
            />
            <Button
              label="Scan QR"
              variant={tab === 'scan' ? 'primary' : 'ghost'}
              onPress={() => setTab('scan')}
              style={styles.tabBtn}
            />
          </View>

          {tab === 'code' ? (
            <View style={styles.codePanel}>
              <Text style={styles.label}>6-character room code</Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={(t) => {
                  setCode(t.toUpperCase());
                  setError(null);
                }}
                placeholder="ABC123"
                placeholderTextColor={colors.fog}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                returnKeyType="join"
                onSubmitEditing={submitCode}
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <Button
                label={joinRoom.isPending ? 'Joining…' : 'Join'}
                onPress={submitCode}
                disabled={joinRoom.isPending}
                style={styles.joinBtn}
              />
            </View>
          ) : (
            <View style={styles.scanPanel}>
              {!permission?.granted ? (
                <View style={styles.permissionBox}>
                  <Text style={styles.permText}>Camera access is needed to scan QR codes.</Text>
                  <Button label="Allow camera" onPress={requestPermission} />
                </View>
              ) : (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => void handleQrScanned(data)}
                >
                  <View style={styles.overlay}>
                    <View style={styles.scanFrame} />
                    <Text style={styles.scanHint}>Point at the host's QR code</Text>
                  </View>
                </CameraView>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <ExtraMemberSheet visible={showExtra} pricing={extraPricing} onDismiss={handleDismissExtra} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display3,
    color: colors.coal,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabBtn: {
    flex: 1,
  },
  codePanel: {
    gap: spacing.md,
  },
  label: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.coal,
  },
  codeInput: {
    backgroundColor: colors.ink,
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: fontSizes.joinCode,
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center',
    letterSpacing: 8,
    borderWidth: 1,
    borderColor: colors.fog,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.danger,
  },
  joinBtn: {
    marginTop: spacing.sm,
  },
  scanPanel: {
    flex: 1,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  permText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    textAlign: 'center',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: colors.primary,
    borderRadius: radii.card,
    backgroundColor: 'transparent',
  },
  scanHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.cream,
    backgroundColor: 'rgba(10,10,10,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.chip,
  },
});
