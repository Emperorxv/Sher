/**
 * PaywallSheet — bottom sheet shown when a room ends and payment is required.
 *
 * Owns the payment initiation state machine:
 *   idle → initiating → (success: parent navigates) | failed_paystack | failed_other
 *
 * PAYSTACK_UNAVAILABLE is the only code that reveals the Flutterwave fallback
 * button — the fallback is never automatic (per Phase 5 planning decision).
 * ALREADY_UNLOCKED auto-dismisses after 2 s so the user isn't left confused.
 *
 * Error mapping is load-bearing: each ApiError.code maps to a distinct
 * user-facing string. See ERROR_MESSAGES below.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';
import { Button } from './Button';

// ── Types ────────────────────────────────────────────────────────────────────

type UiState = 'idle' | 'initiating' | 'failed_paystack' | 'failed_other';

export type PaywallSheetProps = {
  pricing: { amountMinor: number; currency: string; amountDisplay: string };
  /** Called with the chosen provider when the user taps a payment button.
   *  Must return a Promise so the sheet can track in-flight state and catch
   *  errors to map them to user-facing messages. */
  onPay: (provider: 'PAYSTACK' | 'FLUTTERWAVE') => Promise<void>;
  onDismiss: () => void;
};

// ── Copy ────────────────────────────────────────────────────────────────────

const COPY = {
  title: 'Unlock photos for everyone',
  subtitle: 'Any member can pay — it opens the gallery for the whole room.',
};

// ── Error mapping ────────────────────────────────────────────────────────────

/**
 * ApiError.code → user-facing string.
 * Exported so tests can assert exact strings without duplicating them.
 * Each code maps to a DISTINCT message — no two collapse into the same text.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  PAYSTACK_UNAVAILABLE: "Couldn't reach Paystack. Try Flutterwave instead.",
  FLUTTERWAVE_UNAVAILABLE: "Couldn't reach Flutterwave. Try again in a moment.",
  ALREADY_UNLOCKED: 'This room is already unlocked.',
  ROOM_STILL_ACTIVE: 'This room is still active. Unlock will be available when it ends.',
  network: 'Connection lost. Check your network and try again.',
  unknown: 'Something went wrong. Please try again.',
};

function resolveError(err: unknown): { nextState: UiState; message: string } {
  const code = (err as { code?: string })?.code;
  if (!code) {
    return { nextState: 'failed_other', message: ERROR_MESSAGES.network! };
  }
  const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown!;
  if (code === 'PAYSTACK_UNAVAILABLE') {
    return { nextState: 'failed_paystack', message };
  }
  return { nextState: 'failed_other', message };
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaywallSheet({ pricing, onPay, onDismiss }: PaywallSheetProps) {
  const [uiState, setUiState] = useState<UiState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isInitiating = uiState === 'initiating';
  const showFlutterwave = uiState === 'failed_paystack';

  const handlePay = async (provider: 'PAYSTACK' | 'FLUTTERWAVE') => {
    setUiState('initiating');
    setErrorMsg(null);
    try {
      await onPay(provider);
      // Success: parent is responsible for navigation (checkout WebView — commit 14).
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'ALREADY_UNLOCKED') {
        setErrorMsg(ERROR_MESSAGES.ALREADY_UNLOCKED!);
        setUiState('failed_other');
        // Auto-dismiss: room is already unlocked, nothing left to do.
        setTimeout(onDismiss, 2000);
        return;
      }
      const { nextState, message } = resolveError(err);
      setUiState(nextState);
      setErrorMsg(message);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss" />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.lockEmoji} accessibilityLabel="lock icon">
          🔒
        </Text>

        <Text style={styles.amount}>{pricing.amountDisplay}</Text>

        <Text style={styles.title}>{COPY.title}</Text>
        <Text style={styles.subtitle}>{COPY.subtitle}</Text>

        {errorMsg !== null ? (
          <Text style={styles.error} accessibilityRole="alert">
            {errorMsg}
          </Text>
        ) : null}

        {isInitiating ? (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Processing payment"
            style={styles.spinner}
          />
        ) : null}

        <Button
          label="Pay with Paystack"
          onPress={() => {
            void handlePay('PAYSTACK');
          }}
          disabled={isInitiating}
          style={styles.primaryBtn}
        />

        {showFlutterwave ? (
          <Button
            label="Try Flutterwave instead"
            variant="ghost"
            onPress={() => {
              void handlePay('FLUTTERWAVE');
            }}
            disabled={isInitiating}
          />
        ) : null}

        <Button
          label="Dismiss"
          variant="ghost"
          onPress={onDismiss}
          disabled={isInitiating}
          style={styles.dismissBtn}
        />
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,10,0.5)',
  },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.fog,
    marginBottom: spacing.sm,
  },
  lockEmoji: {
    fontSize: 32,
    textAlign: 'center',
  },
  amount: {
    fontFamily: fonts.display,
    fontSize: fontSizes.display3,
    color: colors.coal,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 20,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.danger,
    textAlign: 'center',
  },
  spinner: {
    marginVertical: spacing.xs,
  },
  primaryBtn: {
    marginTop: spacing.sm,
  },
  dismissBtn: {
    marginTop: spacing.xs,
  },
});
