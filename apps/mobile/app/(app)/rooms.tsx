import { SafeAreaView, StyleSheet } from 'react-native';
import { EmptyState } from '../../components';
import { colors } from '../../theme';

/**
 * My Rooms screen — shown after sign-in.
 * Phase 3: empty state only. Room list is wired in Phase 4.
 */
export default function RoomsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <EmptyState
        title="No rooms yet."
        subtitle="Create one or scan a code to join an event."
        icon="📷"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
