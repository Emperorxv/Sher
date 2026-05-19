import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components';
import { colors, fonts, fontSizes, spacing } from '../../theme';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Brand mark */}
        <View style={styles.brandMark}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <View style={[styles.dot, { backgroundColor: colors.accent, marginLeft: -16 }]} />
          <View style={[styles.dot, { backgroundColor: colors.success, marginLeft: -16 }]} />
        </View>

        <Text style={styles.wordmark}>Sher</Text>
        <Text style={styles.tagline}>Your moments, together.</Text>

        <View style={styles.description}>
          <Text style={styles.body}>
            Create a Room, share a code, and every photo lands in one place — instantly.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            label="Let's go →"
            variant="primary"
            onPress={() => router.push('/(auth)/phone')}
          />
        </View>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMark: {
    flexDirection: 'row',
    marginBottom: spacing.xl,
  },
  dot: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  wordmark: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display1,
    color: colors.coal,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.primary,
    marginBottom: spacing.xl,
  },
  description: {
    maxWidth: 320,
    marginBottom: spacing.xxl,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 24,
  },
  actions: {
    width: '100%',
  },
});
