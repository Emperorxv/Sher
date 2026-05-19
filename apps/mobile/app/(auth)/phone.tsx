import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components';
import { useAuthStore } from '../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

export default function PhoneScreen() {
  const router = useRouter();
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Enter your phone number to continue.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await requestOtp(trimmed);
      router.push({ pathname: '/(auth)/verify', params: { phone: trimmed } });
    } catch {
      setError("Couldn't send the code. Check your number and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Text style={styles.heading}>What's your number?</Text>
          <Text style={styles.sub}>We'll text you a one-time code. No password needed — ever.</Text>

          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            value={phone}
            onChangeText={setPhone}
            placeholder="+234 800 000 0000"
            placeholderTextColor={colors.fog}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            accessibilityLabel="Phone number"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            label={loading ? 'Sending…' : 'Send code'}
            variant="primary"
            disabled={loading}
            onPress={handleSubmit}
          />
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
});
