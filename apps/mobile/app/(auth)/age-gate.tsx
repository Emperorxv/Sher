import { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@sher/api-client';
import { Button } from '../../components';
import { useAuthStore } from '../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

const CURRENT_YEAR = new Date().getFullYear();

export default function AgeGateScreen() {
  const router = useRouter();
  const pendingSignup = useAuthStore((s) => s.pendingSignup);
  const completeSignup = useAuthStore((s) => s.completeSignup);

  const [birthYear, setBirthYear] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: no in-flight signup means the user navigated here directly.
  useEffect(() => {
    if (pendingSignup === null) {
      router.replace('/(auth)/welcome');
    }
  }, [pendingSignup, router]);

  const yearNum = parseInt(birthYear, 10);
  const age = birthYear.length === 4 && !isNaN(yearNum) ? CURRENT_YEAR - yearNum : null;
  const isUnderage = age !== null && age < 13;
  const isMinor = age !== null && age >= 13 && age <= 17;
  const canContinue = age !== null && !isUnderage && (!isMinor || consentChecked) && !loading;

  async function handleContinue() {
    if (!canContinue || age === null) return;
    setError(null);
    setLoading(true);
    try {
      await completeSignup(yearNum, isMinor ? consentChecked : undefined);
      router.replace('/(app)/rooms');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNDERAGE') {
        setError('You need to be 13 or older to use Sher.');
      } else if (err instanceof ApiError && err.code === 'MINOR_CONSENT_REQUIRED') {
        setError('Parental or guardian consent is required to continue.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setLoading(false);
    }
  }

  // Render nothing while the redirect effect fires — avoids a UI flash.
  if (pendingSignup === null) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>How old are you?</Text>
        <Text style={styles.sub}>Enter your birth year to continue.</Text>

        <TextInput
          style={styles.input}
          value={birthYear}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 4);
            setBirthYear(digits);
            setConsentChecked(false);
            setError(null);
          }}
          placeholder="YYYY"
          placeholderTextColor={colors.fog}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Birth year"
        />

        {isUnderage ? (
          <View style={styles.blockBox}>
            <Text style={styles.blockHeading}>Sorry, we can't let you in.</Text>
            <Text style={styles.blockBody}>
              Sher is only available to users aged 13 and older. We hope to see you soon!
            </Text>
          </View>
        ) : null}

        {isMinor ? (
          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setConsentChecked((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consentChecked }}
            accessibilityLabel="I confirm a parent or guardian has given consent"
          >
            <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
              {consentChecked ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentLabel}>
              A parent or guardian has given their consent for me to use Sher.
            </Text>
          </TouchableOpacity>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!isUnderage ? (
          <Button
            label={loading ? 'Creating your account…' : 'Continue'}
            variant="primary"
            disabled={!canContinue}
            onPress={handleContinue}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cream,
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
  },
  blockBox: {
    backgroundColor: colors.fog,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  blockHeading: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
  blockBody: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.ink,
    lineHeight: 20,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.fog,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.cream,
    fontSize: 14,
    fontFamily: fonts.label,
  },
  consentLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.ink,
    lineHeight: 20,
    flex: 1,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.danger,
  },
});
