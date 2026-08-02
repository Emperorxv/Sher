/**
 * Checkout screen — renders the Paystack (or Flutterwave) hosted checkout
 * inside a full-screen WebView, then polls the unlock status after the user
 * returns.
 *
 * Route: /checkout/[paymentRef]
 * Params:
 *   paymentRef     — sher_<cuid> providerRef from PaymentInitDto
 *   roomId         — needed for polling and post-success navigation
 *   authorizationUrl — Paystack/Flutterwave checkout page URL
 *   purpose        — 'BASE_UNLOCK' | 'MEMBER_UNLOCK' (for copy only)
 *
 * State machine:
 *   webview  → polling  → confirmed (auto-navigate to room dashboard)
 *                        → timeout  (show "Still processing" interstitial)
 *
 * Deep-link path (app backgrounded):
 *   Paystack redirects to sher://checkout/confirm?ref=<paymentRef>.
 *   expo-linking surfaces the URL via useURL(); the screen detects it and
 *   transitions to polling.
 *
 * WebView path (app foregrounded, most common):
 *   onShouldStartLoadWithRequest intercepts the sher:// URL, returns false
 *   (WebView must not navigate to a custom scheme), and triggers polling.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components';
import { pollUnlockStatus } from '../../lib/checkout';
import { colors, fonts, fontSizes, spacing } from '../../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScreenState = 'webview' | 'polling' | 'timeout';

// ── Component ─────────────────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const router = useRouter();
  const { paymentRef, roomId, authorizationUrl, purpose } = useLocalSearchParams<{
    paymentRef: string;
    roomId: string;
    authorizationUrl: string;
    purpose: string;
  }>();

  const [screenState, setScreenState] = useState<ScreenState>('webview');
  const pollingRef = useRef(false);

  // ── Linking (deep-link path) ────────────────────────────────────────────────

  const url = Linking.useURL();

  useEffect(() => {
    if (!url) return;
    const parsed = Linking.parse(url);
    // Match sher://checkout/confirm?ref=<paymentRef>
    if (
      parsed.scheme === 'sher' &&
      parsed.path === 'checkout/confirm' &&
      parsed.queryParams?.ref === paymentRef
    ) {
      void startPolling();
    }
  }, [url]);

  // ── Polling ────────────────────────────────────────────────────────────────

  const startPolling = useCallback(async () => {
    if (pollingRef.current) return; // prevent double-trigger
    pollingRef.current = true;
    setScreenState('polling');

    const unlocked = await pollUnlockStatus(roomId);

    if (unlocked) {
      router.replace({ pathname: '/(app)/rooms/[id]', params: { id: roomId } });
    } else {
      setScreenState('timeout');
    }
  }, [roomId, router]);

  // ── WebView URL interception (foreground / in-app path) ────────────────────

  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (request.url.startsWith('sher://')) {
        void startPolling();
        return false; // stop WebView navigating to custom scheme
      }
      return true;
    },
    [startPolling],
  );

  // ── Cancel (user taps close or hardware back) ─────────────────────────────

  const handleCancel = useCallback(() => {
    void startPolling();
  }, [startPolling]);

  // ── Render states ─────────────────────────────────────────────────────────

  if (screenState === 'polling') {
    return (
      <SafeAreaView style={styles.centred}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Checking payment status"
        />
        <Text style={styles.pollingTitle}>Checking payment…</Text>
        <Text style={styles.pollingSubtitle}>This usually takes a few seconds.</Text>
      </SafeAreaView>
    );
  }

  if (screenState === 'timeout') {
    return (
      <SafeAreaView style={styles.centred}>
        <Text style={styles.timeoutTitle} accessibilityRole="header">
          Still processing
        </Text>
        <Text style={styles.timeoutBody}>
          Your payment is being verified. Check back in a moment — your photos will be available as
          soon as it clears.
        </Text>
        <Button
          label="Check again"
          onPress={() => {
            pollingRef.current = false;
            void startPolling();
          }}
          style={styles.retryBtn}
        />
        <Button
          label="Back to room"
          variant="ghost"
          onPress={() => router.replace({ pathname: '/(app)/rooms/[id]', params: { id: roomId } })}
          style={styles.backBtn}
        />
      </SafeAreaView>
    );
  }

  // screenState === 'webview'
  const purposeLabel =
    purpose === 'ROOM_UNLOCK' ? 'Unlock photos for everyone' : 'Unlock gallery access';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{purposeLabel}</Text>
        <Pressable
          onPress={handleCancel}
          style={styles.closeBtn}
          accessibilityLabel="Close checkout"
          accessibilityRole="button"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* Checkout WebView */}
      <WebView
        source={{ uri: authorizationUrl }}
        style={styles.webView}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        testID="checkout-webview"
        accessibilityLabel="Payment checkout"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.fog,
    backgroundColor: colors.cream,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.body1,
    color: colors.coal,
    flex: 1,
  },
  closeBtn: {
    padding: spacing.sm,
  },
  closeBtnText: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
  webView: {
    flex: 1,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.cream,
    gap: spacing.md,
  },
  pollingTitle: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
    textAlign: 'center',
  },
  pollingSubtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    opacity: 0.7,
    textAlign: 'center',
  },
  timeoutTitle: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
    textAlign: 'center',
  },
  timeoutBody: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    alignSelf: 'stretch',
  },
  backBtn: {
    alignSelf: 'stretch',
  },
});
