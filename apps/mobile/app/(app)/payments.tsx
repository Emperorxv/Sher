/**
 * Payment history screen — lists all payments the authenticated user has made.
 * Phase 5: read-only view; no actions beyond pull-to-refresh.
 */
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PaymentHistoryItemDto, PaymentPurpose, PaymentStatus } from '@sher/shared-types';
import { EmptyState } from '../../components';
import { usePaymentHistory } from '../../lib/payments';
import { colors, fonts, fontSizes, radii, spacing } from '../../theme';

// ── Label maps ─────────────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  BASE_UNLOCK: 'Base unlock',
  MEMBER_UNLOCK: 'Member unlock',
  RETENTION_EXTENSION: 'Retention extension',
};

const STATUS_LABELS: Record<PaymentStatus, string> = {
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  PENDING: 'Pending',
  REFUNDED: 'Refunded',
};

const STATUS_BG: Record<PaymentStatus, string> = {
  SUCCESS: colors.success,
  FAILED: colors.danger,
  PENDING: colors.accent,
  REFUNDED: colors.fog,
};

const STATUS_TEXT: Record<PaymentStatus, string> = {
  SUCCESS: colors.coal,
  FAILED: colors.cream,
  PENDING: colors.coal,
  REFUNDED: colors.coal,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(item: PaymentHistoryItemDto): string {
  const raw = item.status === 'SUCCESS' ? item.paidAt : item.createdAt;
  return new Date(raw ?? item.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function providerLabel(provider: string): string {
  return provider === 'PAYSTACK' ? 'Paystack' : 'Flutterwave';
}

// ── Payment card ───────────────────────────────────────────────────────────────

function PaymentCard({ item }: { item: PaymentHistoryItemDto }) {
  return (
    <View style={styles.card} testID={`payment-item-${item.id}`}>
      <View style={styles.cardRow}>
        <Text style={styles.amount}>{item.amountDisplay}</Text>
        <View style={[styles.statusChip, { backgroundColor: STATUS_BG[item.status] }]}>
          <Text style={[styles.statusText, { color: STATUS_TEXT[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.purpose}>{PURPOSE_LABELS[item.purpose]}</Text>
      {item.roomName ? <Text style={styles.roomName}>{item.roomName}</Text> : null}
      <Text style={styles.meta}>
        {providerLabel(item.provider)} · {formatDate(item)}
      </Text>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function PaymentsScreen() {
  const { data, isLoading, refetch, isRefetching } = usePaymentHistory();

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
        <Text style={styles.title}>Payments</Text>
      </View>
      <FlatList
        testID="payments-list"
        data={data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <PaymentCard item={item} />}
        refreshControl={
          <RefreshControl
            testID="payments-refresh"
            refreshing={isRefetching ?? false}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No payments yet."
            subtitle="Payments you make to unlock rooms will appear here."
            icon="💳"
          />
        }
      />
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
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
    gap: spacing.xs,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.body1,
    color: colors.cream,
  },
  statusChip: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.caption,
  },
  purpose: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.cream,
    opacity: 0.8,
  },
  roomName: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
    opacity: 0.6,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.cream,
    opacity: 0.5,
  },
});
