/**
 * Bottom sheet shown to a guest who joined as an "extra" member
 * (joinOrder > baseCapacity). Explains they will need to pay their
 * own member unlock fee when the room ends.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PricingQuoteDto } from '@sher/shared-types';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';
import { Button } from './Button';

interface ExtraMemberSheetProps {
  visible: boolean;
  pricing: PricingQuoteDto | null;
  onDismiss: () => void;
}

export function ExtraMemberSheet({ visible, pricing, onDismiss }: ExtraMemberSheetProps) {
  const amount = pricing?.memberUnlock.display ?? '…';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss" />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>One more thing 👀</Text>
        <Text style={styles.body}>
          This room is full — you joined as an extra member. When the host ends the room and unlocks
          the photos, you&apos;ll pay <Text style={styles.amount}>{amount}</Text> to access your
          copy.
        </Text>
        <Text style={styles.note}>You won't be charged now. Enjoy the event!</Text>

        <Button label="Got it" onPress={onDismiss} style={styles.cta} />
      </View>
    </Modal>
  );
}

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
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading1,
    color: colors.coal,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    lineHeight: 24,
  },
  amount: {
    fontFamily: fonts.label,
    color: colors.primary,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.ink,
    opacity: 0.7,
  },
  cta: {
    marginTop: spacing.sm,
  },
});
