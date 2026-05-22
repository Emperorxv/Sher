/**
 * My Rooms screen — lists all rooms the current user is a member of.
 * Phase 4: wires real data via TanStack Query.
 */
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RoomSummaryDto } from '@sher/shared-types';
import { EmptyState } from '../../components';
import { useRoomList } from '../../lib/rooms';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

function RoomCard({ room }: { room: RoomSummaryDto }) {
  const router = useRouter();
  const isEnded = room.status === 'ENDED' || room.status === 'EXPIRED';

  return (
    <Pressable
      onPress={() => router.push(`/rooms/${room.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open room ${room.name}`}
    >
      <View style={styles.cardRow}>
        <Text style={[styles.roomName, isEnded && styles.roomNameEnded]} numberOfLines={1}>
          {room.name}
        </Text>
        <View style={[styles.statusChip, isEnded ? styles.chipEnded : styles.chipActive]}>
          <Text style={[styles.chipText, isEnded ? styles.chipTextEnded : styles.chipTextActive]}>
            {room.status}
          </Text>
        </View>
      </View>
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          {room.memberCount} member{room.memberCount !== 1 ? 's' : ''}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>
          {room.photoCount} photo{room.photoCount !== 1 ? 's' : ''}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{room.callerRole}</Text>
      </View>
    </Pressable>
  );
}

export default function RoomsScreen() {
  const router = useRouter();
  const { data: rooms, isLoading, refetch, isRefetching } = useRoomList();

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Your rooms</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/rooms/join')}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Join a room"
          >
            <Text style={styles.headerBtnText}>Join</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/rooms/create')}
            style={[styles.headerBtn, styles.headerBtnPrimary]}
            accessibilityRole="button"
            accessibilityLabel="Create a room"
          >
            <Text style={[styles.headerBtnText, styles.headerBtnTextPrimary]}>+ Create</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={rooms ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <RoomCard room={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No rooms yet."
            subtitle="Create one or scan a code to join an event."
            icon="📷"
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.fog,
    backgroundColor: colors.cream,
  },
  headerBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  headerBtnText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.coal,
  },
  headerBtnTextPrimary: {
    color: colors.coal,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  roomName: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.body1,
    color: colors.cream,
    flex: 1,
  },
  roomNameEnded: {
    opacity: 0.5,
  },
  statusChip: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipActive: {
    backgroundColor: colors.success,
  },
  chipEnded: {
    backgroundColor: colors.fog,
  },
  chipText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
  },
  chipTextActive: {
    color: colors.coal,
  },
  chipTextEnded: {
    color: colors.coal,
    opacity: 0.7,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metaText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
    opacity: 0.6,
  },
  metaDot: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
    opacity: 0.3,
  },
});
