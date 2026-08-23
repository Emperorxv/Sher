/**
 * Room dashboard — shows details, QR code, member list.
 * Host can end the room or remove members.
 * Guests can leave the room.
 * Phase 4: real-time updates via Socket.IO subscription.
 * Phase 5: PaywallSheet + LockedGalleryPlaceholder when room has ended and
 *           the caller has not yet unlocked.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { initConnection, endConnection, fetchProducts } from 'expo-iap';
import QRCode from 'react-native-qrcode-svg';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@sher/shared-types';
import {
  Button,
  JoinCodeDisplay,
  PaywallSheet,
  PhotoGallery,
  ReportSheet,
} from '../../../components';
import { useRoom, useRoomMembers, useEndRoom, useRemoveMember, roomKeys } from '../../../lib/rooms';
import { useUnlockStatus, useInitiateRoomUnlock } from '../../../lib/payments';
import { getPaymentProvider } from '../../../lib/payment-provider';
import { photoKeys, useDeletePhoto } from '../../../lib/photos';
import { connectRoomSocket, disconnectRoomSocket, subscribeToRoom } from '../../../lib/socket';
import { tokenStore } from '../../../lib/token-store';
import { useAuthStore } from '../../../stores/auth';
import { colors, fonts, fontSizes, radii, spacing } from '../../../theme';

// TODO: replace with real App Store / Play Store URLs before launch.
const APP_STORE_URL = 'https://apps.apple.com/app/sher/TODO';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=TODO';

export function buildShareMessage(joinCode: string): string {
  const code = joinCode.toUpperCase();
  return (
    `Join my Sher room! Use code ${code} in the Sher app, or scan the QR code in the room dashboard.\n\n` +
    `Don't have Sher yet? Download it here:\n` +
    `iOS: ${APP_STORE_URL}\n` +
    `Android: ${PLAY_STORE_URL}`
  );
}

function MemberRow({
  member,
  onRemove,
  removeDisabled,
  onReport,
}: {
  member: MemberDto;
  onRemove?: () => void;
  removeDisabled?: boolean;
  onReport?: () => void;
}) {
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
      {onRemove && (
        <Pressable
          onPress={onRemove}
          disabled={removeDisabled}
          style={styles.removeBtn}
          accessibilityLabel={`Remove ${member.displayName ?? member.userId.slice(-8)} from room`}
          accessibilityRole="button"
        >
          <Text style={[styles.removeBtnText, removeDisabled && styles.removeBtnDisabled]}>
            Remove
          </Text>
        </Pressable>
      )}
      {onReport && (
        <Pressable
          onPress={onReport}
          style={styles.removeBtn}
          accessibilityLabel={`Report ${member.displayName ?? member.userId.slice(-8)}`}
          accessibilityRole="button"
          testID={`report-member-${member.userId}`}
        >
          <Text style={styles.reportBtnText}>Report</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function RoomDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const userId = user?.id;

  // ── Data hooks ─────────────────────────────────────────────────────────────

  const { data: room, isLoading } = useRoom(id ?? '');
  const { data: membersPage } = useRoomMembers(id ?? '');
  const { data: unlockStatus } = useUnlockStatus(id ?? '');
  const endRoom = useEndRoom();
  const removeMember = useRemoveMember();
  const initiateRoomUnlock = useInitiateRoomUnlock(id ?? '');
  const deletePhoto = useDeletePhoto(id ?? '');

  // ── Paywall state ──────────────────────────────────────────────────────────

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paymentFailedMsg, setPaymentFailedMsg] = useState<string | null>(null);
  const [iapLocalizedPrice, setIapLocalizedPrice] = useState<string | undefined>(undefined);
  const autoOpened = useRef(false);

  // ── Report member state ────────────────────────────────────────────────────
  // Holds the membershipId of the member being reported, or null when closed.
  const [reportMembershipId, setReportMembershipId] = useState<string | null>(null);

  // ── Computed paywall values (null-safe; evaluated before early return) ─────

  const isHost = room?.hostId === userId;
  const isActive = room?.status === 'ACTIVE';
  // Any active member may capture photos — the paywall only engages after the room ends.
  // unlockState is irrelevant to capture; it gates gallery access in ENDED rooms only.
  const canTakePhoto = isActive;

  // isLocked is false until unlockStatus loads; avoids flash for unlocked users
  const isLocked = unlockStatus?.callerUnlockState === 'LOCKED';
  const showPaywall = room?.status === 'ENDED' && isLocked;

  // Pricing comes from the API's tier calculation — never hardcoded on client
  const paywallPricing = {
    amountMinor: unlockStatus?.amountDue?.amountMinor ?? 0,
    currency: room?.pricingCurrency ?? '',
    amountDisplay: unlockStatus?.amountDue?.amountDisplay ?? '…',
  };

  // ── Auto-open paywall for any LOCKED member when room has ended ───────────

  useEffect(() => {
    if (!autoOpened.current && showPaywall) {
      autoOpened.current = true;
      setPaywallOpen(true);
    }
  }, [showPaywall]);

  // ── Fetch App Store localized price for IAP products (iOS only) ────────────

  useEffect(() => {
    const productId = unlockStatus?.iapProductId;
    if (Platform.OS !== 'ios' || !productId) return;

    let cancelled = false;
    initConnection()
      .then(() => fetchProducts({ skus: [productId] }))
      .then((products) => {
        const product = products?.[0];
        if (!cancelled && product) {
          setIapLocalizedPrice(product.displayPrice);
        }
      })
      .catch(() => undefined) // fall back to pricing.amountDisplay
      .finally(() => {
        void endConnection();
      });

    return () => {
      cancelled = true;
    };
  }, [unlockStatus?.iapProductId]);

  // ── Socket.IO subscription for live updates ────────────────────────────────

  const unsubscribeRef = useRef<(() => void) | null>(null);

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
        'member:left': (data) => {
          void qc.invalidateQueries({ queryKey: roomKeys.members(id) });
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
          if (data.userId === userId) {
            router.replace('/rooms');
          }
        },
        'room:ended': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
        },
        'room:base_unlocked': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(id) });
          void qc.invalidateQueries({ queryKey: roomKeys.members(id) });
          // Invalidate all photo scopes so the gallery drops its locked cache.
          void qc.invalidateQueries({ queryKey: photoKeys.lists(id) });
        },
        'member:unlocked': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(id) });
          void qc.invalidateQueries({ queryKey: roomKeys.members(id) });
          // Same: a member unlock changes who can view the gallery.
          void qc.invalidateQueries({ queryKey: photoKeys.lists(id) });
        },
        'room:retention_extended': () => {
          void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
        },
        'payment:failed': () => {
          setPaymentFailedMsg('Payment failed. Please try again.');
        },
        'photo:new': () => {
          void qc.invalidateQueries({ queryKey: photoKeys.list(id) });
        },
        'photo:deleted': () => {
          void qc.invalidateQueries({ queryKey: photoKeys.list(id) });
        },
      });
    });

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, [id, qc, userId, router]);

  // Disconnect socket when all room screens are unmounted
  useEffect(() => {
    return () => {
      disconnectRoomSocket();
    };
  }, []);

  // ── Payment handlers ───────────────────────────────────────────────────────

  const handlePay = useCallback(
    async (_provider: 'PAYSTACK' | 'FLUTTERWAVE') => {
      // On iOS: AppleIAPProvider shows the native purchase sheet and verifies
      //         with the backend; resolves with webViewTarget: null on success.
      // On Android/web: PaystackProvider calls the unlock API and returns a
      //         webViewTarget with the authorization URL for the checkout WebView.
      const paymentProvider = getPaymentProvider();
      const result = await paymentProvider.initiateUnlock({
        roomId: id!,
        iapProductId: unlockStatus?.iapProductId ?? null,
      });
      if (result.webViewTarget) {
        router.push({
          pathname: '/checkout/[paymentRef]',
          params: {
            paymentRef: result.webViewTarget.providerRef,
            roomId: id!,
            authorizationUrl: result.webViewTarget.authorizationUrl,
            purpose: 'ROOM_UNLOCK',
          },
        });
      } else {
        // Apple IAP: purchase is complete — refresh unlock status and close paywall.
        void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(id!) });
        setPaywallOpen(false);
      }
    },
    [id, router, qc, unlockStatus?.iapProductId],
  );

  // Flutterwave fallback — revealed by PaywallSheet after a PAYSTACK_UNAVAILABLE error.
  // Passing this as onPayFallback means the fallback button only appears on
  // Android/web (where this handler is wired). On iOS the onPayFallback prop is
  // omitted (Stage 3) so the button is suppressed even after a Paystack error.
  const handlePayFallback = useCallback(async () => {
    const result = await initiateRoomUnlock.mutateAsync({ provider: 'FLUTTERWAVE' });
    router.push({
      pathname: '/checkout/[paymentRef]',
      params: {
        paymentRef: result.providerRef,
        roomId: id!,
        authorizationUrl: result.authorizationUrl,
        purpose: 'ROOM_UNLOCK',
      },
    });
  }, [initiateRoomUnlock, id, router]);

  // ── Room actions ───────────────────────────────────────────────────────────

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

  async function handleLeaveRoom() {
    if (!id || !userId) return;
    const myUserId = userId;
    Alert.alert('Leave this room?', "You'll need a new invite to rejoin.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave room',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMember.mutateAsync({ roomId: id, userId: myUserId });
            router.replace('/rooms');
          } catch (err: unknown) {
            Alert.alert('Could not leave room', err instanceof Error ? err.message : 'Try again.');
          }
        },
      },
    ]);
  }

  function handleRemoveMember(member: MemberDto) {
    if (!id) return;
    const name = member.displayName ?? `member ${member.userId.slice(-8)}`;
    Alert.alert(`Remove ${name}?`, "They'll need a new invite to rejoin.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMember.mutateAsync({ roomId: id, userId: member.userId });
          } catch (err: unknown) {
            Alert.alert(
              'Could not remove member',
              err instanceof Error ? err.message : 'Try again.',
            );
          }
        },
      },
    ]);
  }

  // ── Loading guard ──────────────────────────────────────────────────────────

  if (isLoading || !room) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
            <Button
              label="Share"
              variant="ghost"
              style={styles.shareBtn}
              onPress={() => {
                void Share.share({ message: buildShareMessage(room.joinCode) });
              }}
              accessibilityLabel="Share room invite"
            />
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

        {/* Members list — plain View+map; no FlatList inside ScrollView */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Members ({membersPage?.total ?? 0})</Text>
          {(membersPage?.items ?? []).map((item, index, arr) => (
            <React.Fragment key={item.userId}>
              <MemberRow
                member={item}
                onRemove={
                  isHost && isActive && item.role !== 'HOST'
                    ? () => handleRemoveMember(item)
                    : undefined
                }
                removeDisabled={removeMember.isPending}
                onReport={
                  item.userId !== userId ? () => setReportMembershipId(item.userId) : undefined
                }
              />
              {index < arr.length - 1 && <View style={styles.separator} />}
            </React.Fragment>
          ))}
        </View>

        {/* Photo gallery — handles locked / empty / grid states internally */}
        <PhotoGallery
          roomId={id ?? ''}
          photoCount={room.photoCount ?? 0}
          onUnlockPress={() => setPaywallOpen(true)}
          currentUserId={userId}
          onDeletePhoto={(photoId) => deletePhoto.mutate(photoId)}
        />

        {/* Payment failed non-blocking toast */}
        {paymentFailedMsg && (
          <View style={styles.toast} testID="payment-failed-toast">
            <Text style={styles.toastText}>{paymentFailedMsg}</Text>
          </View>
        )}

        {/* Take photo — visible when active and caller is unlocked/exempt */}
        {canTakePhoto && (
          <Button
            label="Take photo"
            variant="dark"
            onPress={() => router.push(`/rooms/${id}/camera`)}
            style={styles.takePhotoBtn}
            accessibilityLabel="Open camera to take a photo"
          />
        )}

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

        {/* Guest leave */}
        {!isHost && isActive && (
          <Button
            label={removeMember.isPending ? 'Leaving…' : 'Leave room'}
            variant="danger"
            onPress={handleLeaveRoom}
            disabled={removeMember.isPending}
            style={styles.leaveBtn}
          />
        )}
      </ScrollView>

      {/* Paywall sheet — Modal overlay */}
      {paywallOpen && (
        <PaywallSheet
          pricing={paywallPricing}
          iapLocalizedPrice={iapLocalizedPrice}
          primaryActionLabel={Platform.OS === 'ios' ? 'Unlock Gallery' : undefined}
          onPay={handlePay}
          // Flutterwave fallback only available on Android/web (not iOS — Apple IAP path).
          onPayFallback={Platform.OS === 'ios' ? undefined : handlePayFallback}
          onDismiss={() => setPaywallOpen(false)}
        />
      )}

      {/* Report member sheet */}
      {reportMembershipId && id && (
        <ReportSheet
          visible={!!reportMembershipId}
          targetType="MEMBER"
          targetId={reportMembershipId}
          roomId={id}
          onDismiss={() => setReportMembershipId(null)}
        />
      )}
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
  shareBtn: {
    alignSelf: 'stretch',
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
  removeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  removeBtnText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
    color: colors.danger,
  },
  removeBtnDisabled: {
    opacity: 0.4,
  },
  reportBtnText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
    color: colors.coal,
    opacity: 0.5,
  },
  separator: {
    height: 1,
    backgroundColor: colors.fog,
  },
  toast: {
    backgroundColor: colors.danger,
    borderRadius: radii.button,
    padding: spacing.sm,
    alignItems: 'center',
  },
  toastText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.cream,
  },
  takePhotoBtn: {
    marginTop: spacing.sm,
  },
  endBtn: {
    marginTop: spacing.sm,
  },
  leaveBtn: {
    marginTop: spacing.sm,
  },
});
