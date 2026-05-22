/**
 * Create Room screen — host fills in name + end date, submits for free.
 * No upfront charge; the paywall fires after the Room ends.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../../components';
import { useCreateRoom } from '../../../lib/rooms';
import { colors, fonts, fontSizes, radii, spacing } from '../../../theme';

/** Returns a Date 4 hours from now rounded to the nearest minute. */
function defaultEndsAt(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export default function CreateRoomScreen() {
  const router = useRouter();
  const createRoom = useCreateRoom();

  const [name, setName] = useState('');
  const [endsAt, setEndsAt] = useState(defaultEndsAt());
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 1) {
      setError('Give your room a name.');
      return;
    }
    if (trimmedName.length > 60) {
      setError('Name must be 60 characters or less.');
      return;
    }

    const ends = new Date(endsAt);
    if (isNaN(ends.getTime()) || ends <= new Date()) {
      setError('End time must be in the future.');
      return;
    }

    try {
      const result = await createRoom.mutateAsync({ name: trimmedName, endsAt });
      router.replace(`/rooms/${result.room.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Could not create room', msg);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>New room</Text>
          <Text style={styles.sub}>Free to create — you only pay when you unlock the photos.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Room name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Tunde's Birthday"
              placeholderTextColor={colors.fog}
              maxLength={60}
              returnKeyType="next"
              autoFocus
            />
            <Text style={styles.charCount}>{name.length}/60</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Ends at (ISO 8601)</Text>
            <TextInput
              style={styles.input}
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="2026-12-31T23:59:00.000Z"
              placeholderTextColor={colors.fog}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>Event end time in UTC. Photos are locked until then.</Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            label={createRoom.isPending ? 'Creating…' : 'Create room — free'}
            onPress={handleCreate}
            disabled={createRoom.isPending}
            style={styles.cta}
          />
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
  flex: {
    flex: 1,
  },
  scroll: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display3,
    color: colors.coal,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    opacity: 0.7,
    lineHeight: 22,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.coal,
  },
  input: {
    backgroundColor: colors.ink,
    color: colors.cream,
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.fog,
  },
  charCount: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.coal,
    opacity: 0.4,
    alignSelf: 'flex-end',
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.coal,
    opacity: 0.5,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.danger,
  },
  cta: {
    marginTop: spacing.sm,
  },
});
