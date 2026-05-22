/**
 * Room dashboard — shows details, QR code, member list.
 * Host can end the room from here.
 * Phase 4: real-time updates via Socket.IO subscription.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@sher/shared-types';
import { Button, JoinCodeDisplay } from '../../../components';
import { useRoom, useRoomMembers, useEndRoom, roomKeys } from '../../../lib/rooms';
import { connectRoomSocket, disconnectRoomSocket, subscribeToRoom } from '../../../lib/socket';
import { tokenStore } from '../../../lib/token-store';
import { useAuthStore } from '../../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../../theme';

function MemberRow({ member }: { member: MemberDto }) {
  const roleColor: Record<string, string> = {
    HOST: colors.violet,
    COHOST: colors.accent,
    GUEST: colors.fog,
  };
  const bg = roleColor[member.role] ?? colors.fog;
  const unlockIcon =
    member.unlockState === 'UNLOCKED' ? '🔓' : member.unlockState === 'EXEMPT' ? '✨' : '🔒';

  return (
    <View style={styles.memberRow}>
      <Text style={styles.memberName}>{member.displayName ?? member.userId.slice(-8)}</Text>
      <View style={[styles.roleBadge, { backgroundColor: bg }]}>
        <Text style={styles.roleText}>{member.role}</Text>
      </View>
      <Text style={styles.unlockIcon}>{unlockIcon}</Text>
    </View>
  );
}

export default function RoomDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const { data: room, isLoading } = useRoom(id ?? '');
  const { data: membersPage } = useRoomMembers(id ?? '');
  const endRoom = useEndRoom();

  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Socket.IO subscription for live member updates
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    tokenStore.getAccess().then((token) => {
      if (cancelled || !token) return;
      connectRoomSocket(token);
      unsubscribeRef.current = subscribeToRoom(id, {
        'member:joined': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.members(id) });
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
        },
        'member:left': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.members(id) });
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
        },
        'room:ended': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
        },
      });
    });

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, [id, qc]);

  // Disconnect socket when all room screens are unmounted
  useEffect(() => {
    return () => {
      disconnectRoomSocket();
    };
  }, []);

  async function handleEndRoom() {
    if (!id) return;
    Alert.alert(
      'End this room?',
      "Photos will be locked until you pay the base unlock fee. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End room',
          style: 'destructive',
          onPress: async () => {
            try {
              await endRoom.mutateAsync(id);
              router.replace('/rooms');
            } catch (err: unknown) {
              Alert.alert('Could not end room', err instanceof Error ? err.message : 'Try again.');
            }
          },
        },
      ],
    );
  }

  if (isLoading || !room) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const isHost = room.hostId === user?.id;
  const isActive = room.status === 'ACTIVE';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Room header */}
        <View style={styles.header}>
          <Text style={styles.roomName}>{room.name}</Text>
          <View style={[styles.statusChip, isActive ? styles.chipActive : styles.chipEnded]}>
            <Text style={styles.chipText}>{room.status}</Text>
          </View>
        </View>

        {/* QR code + join code */}
        {isActive && (
          <View style={styles.qrCard}>
            <Text style={styles.sectionLabel}>Share this code to invite</Text>
            <View style={styles.qrBox}>
              <QRCode
                value={room.joinCode}
                size={180}
                color={colors.coal}
                backgroundColor={colors.cream}
              />
            </View>
            <JoinCodeDisplay code={room.joinCode} />
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{room.memberCount}</Text>
            <Text style={styles.statLabel}>members</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{room.photoCount}</Text>
            <Text style={styles.statLabel}>photos</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{room.pricingCurrency}</Text>
            <Text style={styles.statLabel}>currency</Text>
          </View>
        </View>

        {/* Members list */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Members ({membersPage?.total ?? 0})</Text>
          <FlatList
            data={membersPage?.items ?? []}
            keyExtractor={(m) => m.userId}
            renderItem={({ item }) => <MemberRow member={item} />}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>

        {/* Host actions */}
        {isHost && isActive && (
          <Button
            label={endRoom.isPending ? 'Ending…' : 'End room'}
            variant="danger"
            onPress={handleEndRoom}
            disabled={endRoom.isPending}
            style={styles.endBtn}
          />
        )}
      </ScrollView>
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
  scroll: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  roomName: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display3,
    color: colors.coal,
    flex: 1,
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
    color: colors.coal,
  },
  qrCard: {
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  qrBox: {
    padding: spacing.md,
    backgroundColor: colors.cream,
    borderRadius: radii.button,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statNum: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.cream,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
    opacity: 0.6,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body2,
    color: colors.coal,
    opacity: 0.6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  memberName: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    flex: 1,
  },
  roleBadge: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
    color: colors.coal,
  },
  unlockIcon: {
    fontSize: 16,
  },
  separator: {
    height: 1,
    backgroundColor: colors.fog,
  },
  endBtn: {
    marginTop: spacing.sm,
  },
});
