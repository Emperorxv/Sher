/**
 * ReportSheet — modal bottom sheet for reporting a photo or member.
 *
 * Flow:
 *   1. Reason picker (5 radio-style rows).
 *   2. Conditional UNDERAGE_CONCERN reassurance copy.
 *   3. Optional details text field (max 500 chars).
 *   4. Submit → success toast or distinct error message.
 *
 * No gradients; solid colors only.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ReportReason, ReportTargetType } from '@sher/shared-types';
import { colors, fonts, fontSizes, radii, spacing } from '../theme';
import { useSubmitReport, mapReportError } from '../lib/reports';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportSheetProps = {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  roomId: string;
  onDismiss: () => void;
};

// ── Reason labels ─────────────────────────────────────────────────────────────

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate content' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'UNDERAGE_CONCERN', label: 'Underage concern' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Other' },
];

const UNDERAGE_COPY =
  'Thank you for looking out for the safety of others. We review these reports within 24 hours.';

const SUCCESS_COPY = 'Thanks, our team will review this.';

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportSheet({
  visible,
  targetType,
  targetId,
  roomId,
  onDismiss,
}: ReportSheetProps) {
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { mutate, isPending } = useSubmitReport();

  function resetAndDismiss() {
    setSelectedReason(null);
    setDetails('');
    setSubmitted(false);
    setErrorMsg(null);
    onDismiss();
  }

  function handleSubmit() {
    if (!selectedReason) return;
    setErrorMsg(null);
    mutate(
      {
        targetType,
        targetId,
        roomId,
        reason: selectedReason,
        details: details.trim() || undefined,
      },
      {
        onSuccess: () => {
          setSubmitted(true);
        },
        onError: (err) => {
          setErrorMsg(mapReportError(err));
        },
      },
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={resetAndDismiss}
      testID="report-sheet-modal"
    >
      <Pressable style={styles.backdrop} onPress={resetAndDismiss} testID="report-sheet-backdrop" />

      <View style={styles.sheet}>
        {submitted ? (
          // ── Success state ────────────────────────────────────────────────────
          <View style={styles.successContainer} testID="report-success">
            <Text style={styles.successText}>{SUCCESS_COPY}</Text>
            <Pressable
              style={styles.doneButton}
              onPress={resetAndDismiss}
              accessibilityRole="button"
              accessibilityLabel="Done"
              testID="report-done-button"
            >
              <Text style={styles.doneButtonLabel}>Done</Text>
            </Pressable>
          </View>
        ) : (
          // ── Form state ───────────────────────────────────────────────────────
          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            testID="report-form"
          >
            <Text style={styles.title}>
              {targetType === 'PHOTO' ? 'Report photo' : 'Report member'}
            </Text>

            {/* Reason picker */}
            <View style={styles.reasonList} testID="report-reason-list">
              {REASONS.map(({ value, label }) => {
                const selected = selectedReason === value;
                return (
                  <Pressable
                    key={value}
                    style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                    onPress={() => setSelectedReason(value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={label}
                    testID={`reason-${value}`}
                  >
                    <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                      {selected && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* UNDERAGE_CONCERN extra copy */}
            {selectedReason === 'UNDERAGE_CONCERN' && (
              <View style={styles.underageBox} testID="underage-concern-copy">
                <Text style={styles.underageText}>{UNDERAGE_COPY}</Text>
              </View>
            )}

            {/* Optional details */}
            <TextInput
              style={styles.detailsInput}
              placeholder="Add details (optional)"
              placeholderTextColor={colors.fog}
              value={details}
              onChangeText={setDetails}
              maxLength={500}
              multiline
              numberOfLines={3}
              accessibilityLabel="Additional details"
              testID="report-details-input"
            />
            <Text style={styles.charCount} testID="report-char-count">
              {details.length}/500
            </Text>

            {/* Error message */}
            {errorMsg && (
              <Text style={styles.errorText} testID="report-error-message">
                {errorMsg}
              </Text>
            )}

            {/* Submit */}
            <Pressable
              style={[
                styles.submitButton,
                (!selectedReason || isPending) && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!selectedReason || isPending}
              accessibilityRole="button"
              accessibilityLabel="Submit report"
              testID="report-submit-button"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.cream} />
              ) : (
                <Text style={styles.submitButtonLabel}>Submit report</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.cancelButton}
              onPress={resetAndDismiss}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              testID="report-cancel-button"
            >
              <Text style={styles.cancelButtonLabel}>Cancel</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 10, 0.6)',
  },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  form: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: fontSizes.heading2,
    color: colors.coal,
    marginBottom: spacing.sm,
  },
  reasonList: {
    gap: spacing.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.fog,
    backgroundColor: colors.cream,
  },
  reasonRowSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 59, 107, 0.06)',
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.fog,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  reasonLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    flex: 1,
  },
  reasonLabelSelected: {
    fontFamily: fonts.label,
    color: colors.primary,
  },
  underageBox: {
    backgroundColor: colors.fog,
    borderRadius: radii.button,
    padding: spacing.md,
  },
  underageText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.ink,
  },
  detailsInput: {
    borderWidth: 1,
    borderColor: colors.fog,
    borderRadius: radii.button,
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  charCount: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.coal,
    opacity: 0.4,
    textAlign: 'right',
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.danger,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
  cancelButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelButtonLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body2,
    color: colors.coal,
    opacity: 0.5,
  },
  successContainer: {
    padding: spacing.lg,
    gap: spacing.lg,
    alignItems: 'center',
  },
  successText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body1,
    color: colors.coal,
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  doneButtonLabel: {
    fontFamily: fonts.label,
    fontSize: fontSizes.body1,
    color: colors.coal,
  },
});
