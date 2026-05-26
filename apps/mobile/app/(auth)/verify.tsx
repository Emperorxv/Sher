import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@sher/api-client';
import { Button } from '../../components';
import { useAuthStore } from '../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const router = useRouter();
  const { phone, challengeId: paramChallengeId } = useLocalSearchParams<{
    phone: string;
    challengeId: string;
  }>();
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const requestOtp = useAuthStore((s) => s.requestOtp);

  // challengeId can change if the user resends the OTP.
  const [challengeId, setChallengeId] = useState(paramChallengeId ?? '');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Synchronous guard: auto-submit on 6th digit and manual Verify button can
  // both call handleVerify in the same JS tick before loading state updates.
  const isVerifyingRef = useRef(false);

  // Track the previous param value so we can detect when expo-router updates
  // params on this screen instance in-place (instead of pushing a new screen).
  // This happens when a second requestOtp fires while the first navigation is
  // still animating in — the stack deduplicates the push and mutates params on
  // the existing instance.  Without this sync, useState would hold the stale
  // challengeId and verifyOtp would send the wrong one.
  const prevParamChallengeIdRef = useRef(paramChallengeId);
  useEffect(() => {
    if (!paramChallengeId || paramChallengeId === prevParamChallengeIdRef.current) return;
    prevParamChallengeIdRef.current = paramChallengeId;
    setChallengeId(paramChallengeId);
    setCode('');
    setError(null);
    isVerifyingRef.current = false;
  }, [paramChallengeId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleVerify(value: string) {
    if (value.length < CODE_LENGTH) return;
    if (isVerifyingRef.current) return;
    isVerifyingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(challengeId, value, email.trim() || undefined);
      // On success the auth store sets tokens; navigate to main app.
      router.replace('/(app)/rooms');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Wrong code. Double-check and try again.');
      } else if (err instanceof ApiError && err.code === 'EMAIL_REQUIRED') {
        setError('Enter your email address to create your account.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setLoading(false);
      isVerifyingRef.current = false;
    }
  }

  async function handleResend() {
    if (!phone) return;
    setError(null);
    try {
      const result = await requestOtp(phone);
      setChallengeId(result.challengeId);
      setCode('');
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch {
      setError("Couldn't resend. Try again in a moment.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Text style={styles.heading}>Check your texts</Text>
          <Text style={styles.sub}>
            We sent a {CODE_LENGTH}-digit code to {phone ?? 'your number'}.
          </Text>

          <TextInput
            ref={inputRef}
            style={[styles.codeInput, error ? styles.inputError : null]}
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
              setCode(digits);
              handleVerify(digits);
            }}
            placeholder="------"
            placeholderTextColor={colors.fog}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            accessibilityLabel="One-time code"
          />

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.fog}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            returnKeyType="done"
            accessibilityLabel="Email address"
          />
          <Text style={styles.hint}>Required if you're signing up for the first time.</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {resent ? <Text style={styles.sentText}>Code resent!</Text> : null}

          <Button
            label={loading ? 'Verifying…' : 'Verify'}
            variant="primary"
            disabled={loading || code.length < CODE_LENGTH}
            onPress={() => handleVerify(code)}
          />

          <Button label="Resend code" variant="ghost" onPress={handleResend} />
        </View>
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
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display3,
    color: colors.coal,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.ink,
    lineHeight: 24,
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
    marginVertical: spacing.sm,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    backgroundColor: colors.cream,
    borderWidth: 2,
    borderColor: colors.fog,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  inputError: {
    borderColor: colors.danger,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.ink,
    opacity: 0.55,
    marginTop: -spacing.xs,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.danger,
    marginTop: -spacing.xs,
  },
  sentText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.success,
  },
});
