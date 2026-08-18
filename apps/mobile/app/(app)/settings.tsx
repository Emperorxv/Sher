/**
 * Settings screen — account info, sign-out, and two-phase account deletion.
 *
 * Deletion flow:
 *   1. User taps "Delete my account" → Alert confirmation.
 *   2. On confirm → POST /auth/account/deletion-request (sends OTP).
 *   3. User enters 6-digit OTP → DELETE /auth/account → local session cleared.
 *   4. Navigate to welcome screen.
 */
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@sher/api-client';
import { Button } from '../../components';
import { useAuthStore } from '../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

type Step = 'idle' | 'requesting' | 'otp' | 'deleting';

const CODE_LENGTH = 6;

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const requestAccountDeletion = useAuthStore((s) => s.requestAccountDeletion);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const signOut = useAuthStore((s) => s.signOut);

  const [step, setStep] = useState<Step>('idle');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSubmittingRef = useRef(false);
  const codeInputRef = useRef<TextInput>(null);

  function handleDeletePress() {
    Alert.alert(
      'Delete your account?',
      "This is permanent and can't be undone. All your data will be anonymised.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: startDeletionFlow },
      ],
    );
  }

  async function startDeletionFlow() {
    setStep('requesting');
    setError(null);
    try {
      const { challengeId: cid } = await requestAccountDeletion();
      setChallengeId(cid);
      setCode('');
      setStep('otp');
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err) {
      setStep('idle');
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  async function handleCodeSubmit(value: string) {
    if (value.length < CODE_LENGTH) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    setStep('deleting');
    try {
      await deleteAccount(challengeId, value);
      // Store clears tokens + state; navigate to welcome explicitly.
      router.replace('/(auth)/welcome');
    } catch (err) {
      setStep('otp');
      isSubmittingRef.current = false;
      if (err instanceof ApiError && err.status === 401) {
        setError('Wrong code. Double-check and try again.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>

          <Text style={styles.heading}>Settings</Text>

          {/* ── Account info ────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Phone</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {user?.phone ?? '—'}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Email</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {user?.email ?? '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Sign out ─────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Button
              label="Sign out"
              variant="ghost"
              onPress={async () => {
                await signOut();
                router.replace('/(auth)/welcome');
              }}
            />
          </View>

          {/* ── Danger zone ──────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Danger zone</Text>

            {step === 'idle' && (
              <Button label="Delete my account" variant="danger" onPress={handleDeletePress} />
            )}

            {step === 'requesting' && <Button label="Sending code…" variant="danger" disabled />}

            {(step === 'otp' || step === 'deleting') && (
              <View style={styles.otpBlock}>
                <Text style={styles.otpLabel}>Enter the 6-digit code we sent to your phone.</Text>
                <TextInput
                  ref={codeInputRef}
                  style={[styles.codeInput, error ? styles.inputError : null]}
                  value={code}
                  onChangeText={(v) => {
                    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
                    setCode(digits);
                    void handleCodeSubmit(digits);
                  }}
                  placeholder="——————"
                  placeholderTextColor={colors.fog}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  accessibilityLabel="One-time deletion code"
                  editable={step !== 'deleting'}
                />
                <Button
                  label={step === 'deleting' ? 'Deleting…' : 'Confirm deletion'}
                  variant="danger"
                  disabled={step === 'deleting' || code.length < CODE_LENGTH}
                  onPress={() => void handleCodeSubmit(code)}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setStep('idle');
                    setCode('');
                    setError(null);
                    isSubmittingRef.current = false;
                  }}
                />
              </View>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  topRow: {
    paddingTop: spacing.lg,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.primary,
  },
  heading: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
    color: colors.coal,
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  infoKey: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.cream,
    opacity: 0.5,
  },
  infoValue: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.cream,
    flex: 1,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.cream,
    opacity: 0.08,
  },
  otpBlock: {
    gap: spacing.sm,
  },
  otpLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    lineHeight: 20,
  },
  codeInput: {
    fontFamily: fonts.mono,
    fontSize: fontSizes.display2,
    color: colors.coal,
    backgroundColor: colors.cream,
    borderWidth: 2,
    borderColor: colors.fog,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
    letterSpacing: 12,
    marginVertical: spacing.xs,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
});
