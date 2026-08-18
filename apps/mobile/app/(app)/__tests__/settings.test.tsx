/**
 * SettingsScreen unit tests — account deletion flow.
 *
 * Covers:
 *  1. Idle state renders user info and delete button.
 *  2. Tapping "Delete my account" calls Alert.alert with confirmation.
 *  3. Confirming the alert calls requestAccountDeletion and shows OTP input.
 *  4. Entering a 6-digit code calls deleteAccount and navigates to welcome.
 *  5. A wrong-code 401 response shows an error message.
 *  6. Cancel from OTP step returns to idle.
 */

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: mockRouterReplace,
    back: jest.fn(),
  })),
}));

jest.mock('../../../stores/auth', () => ({
  useAuthStore: jest.fn((selector: (s: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  ),
}));

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ApiError } from '@sher/api-client';
import SettingsScreen from '../settings';

// mock* prefix so babel-jest hoists these above imports
const mockRouterReplace = jest.fn();

const mockRequestAccountDeletion = jest.fn();
const mockDeleteAccount = jest.fn();
const mockSignOut = jest.fn();

const mockAuthState = {
  user: { id: 'user-1', phone: '+2348012345678', email: 'host@test.com' },
  requestAccountDeletion: mockRequestAccountDeletion,
  deleteAccount: mockDeleteAccount,
  signOut: mockSignOut,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
});

// Helper: simulate the user pressing the "Delete" button inside Alert.alert
function confirmAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const buttons: Array<{ text: string; onPress?: () => void }> = calls[0][2];
  const deleteBtn = buttons.find((b) => b.text === 'Delete');
  expect(deleteBtn).toBeDefined();
  deleteBtn!.onPress?.();
}

describe('SettingsScreen', () => {
  it('renders user phone and email in idle state', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('+2348012345678')).toBeTruthy();
    expect(getByText('host@test.com')).toBeTruthy();
    expect(getByText('Delete my account')).toBeTruthy();
  });

  it('shows Alert when "Delete my account" is pressed', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete my account'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete your account?',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('calls requestAccountDeletion and shows OTP input after confirming', async () => {
    mockRequestAccountDeletion.mockResolvedValueOnce({ challengeId: 'chal-abc' });

    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete my account'));

    await act(async () => {
      confirmAlert();
    });

    await waitFor(() => {
      expect(mockRequestAccountDeletion).toHaveBeenCalledTimes(1);
      expect(getByLabelText('One-time deletion code')).toBeTruthy();
    });
  });

  it('calls deleteAccount and navigates to welcome on valid code', async () => {
    mockRequestAccountDeletion.mockResolvedValueOnce({ challengeId: 'chal-abc' });
    mockDeleteAccount.mockResolvedValueOnce(undefined);

    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete my account'));

    await act(async () => {
      confirmAlert();
    });

    await waitFor(() => getByLabelText('One-time deletion code'));

    await act(async () => {
      fireEvent.changeText(getByLabelText('One-time deletion code'), '123456');
    });

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledWith('chal-abc', '123456');
      expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/welcome');
    });
  });

  it('shows error message on 401 wrong-code response', async () => {
    mockRequestAccountDeletion.mockResolvedValueOnce({ challengeId: 'chal-abc' });
    mockDeleteAccount.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'Unauthorized'));

    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete my account'));

    await act(async () => {
      confirmAlert();
    });

    await waitFor(() => getByLabelText('One-time deletion code'));

    await act(async () => {
      fireEvent.changeText(getByLabelText('One-time deletion code'), '000000');
    });

    await waitFor(() => {
      expect(getByText('Wrong code. Double-check and try again.')).toBeTruthy();
    });
  });

  it('returns to idle state when Cancel is pressed during OTP step', async () => {
    mockRequestAccountDeletion.mockResolvedValueOnce({ challengeId: 'chal-abc' });

    const { getByText, getByLabelText, queryByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Delete my account'));

    await act(async () => {
      confirmAlert();
    });

    await waitFor(() => getByLabelText('One-time deletion code'));

    fireEvent.press(getByText('Cancel'));

    await waitFor(() => {
      expect(queryByLabelText('One-time deletion code')).toBeNull();
      expect(getByText('Delete my account')).toBeTruthy();
    });
  });
});
