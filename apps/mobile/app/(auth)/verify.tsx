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
import { Button } from '../../components';
import { useAuthStore } from '../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const requestOtp = useAuthStore((s) => s.requestOtp);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleVerify(value: string) {
    if (value.length < CODE_LENGTH) return;
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(phone ?? '', value);
      // On success the auth store sets tokens; navigate to main app.
      router.replace('/(app)/rooms');
    } catch {
      setError('Wrong code. Double-check and try again.');
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!phone) return;
    setError(null);
    try {
      await requestOtp(phone);
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
  inputError: {
    borderColor: colors.danger,
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
