/**
 * Camera-test screen unit tests.
 *
 * Covers:
 *   1. Screen renders without throwing under mocked native modules.
 *   2. Permission-denied state: renders "Camera permission required" text
 *      and an "Open Settings" button calling Linking.openSettings.
 *   3. Permission-granted state: renders Camera component (stubbed as View).
 *
 * react-native-vision-camera is mocked at module level — no native binary
 * is invoked. Tests run in Node (jest-expo preset).
 */

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

const mockRequestPermission = jest.fn().mockResolvedValue(true);
const mockCapturePhoto = jest.fn().mockResolvedValue({
  saveToTemporaryFileAsync: jest.fn().mockResolvedValue('/tmp/photo-test.jpg'),
  dispose: jest.fn(),
});

jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: jest.fn(() => ({
    hasPermission: true,
    requestPermission: mockRequestPermission,
    status: 'authorized',
    canRequestPermission: false,
  })),
  usePhotoOutput: jest.fn(() => ({
    capturePhoto: mockCapturePhoto,
  })),
  // Stub the native Camera view as a plain View so RNTL can render it.
  Camera: 'View',
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as VisionCamera from 'react-native-vision-camera';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: CameraTestScreen } = require('../camera-test') as {
    default: React.ComponentType;
  };
  return render(<CameraTestScreen />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CameraTestScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to granted state before each test.
    (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true,
      requestPermission: mockRequestPermission,
      status: 'authorized',
      canRequestPermission: false,
    });
  });

  it('renders without throwing when permission is granted', () => {
    expect(() => renderScreen()).not.toThrow();
  });

  describe('permission denied', () => {
    beforeEach(() => {
      (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
        hasPermission: false,
        requestPermission: mockRequestPermission,
        status: 'denied',
        canRequestPermission: false,
      });
    });

    it('shows "Camera permission required" text', () => {
      const { getByText } = renderScreen();
      expect(getByText('Camera permission required')).toBeTruthy();
    });

    it('"Open Settings" button calls Linking.openSettings', () => {
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      const { getByText } = renderScreen();
      fireEvent.press(getByText('Open Settings'));
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('calls requestPermission on mount', () => {
      renderScreen();
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('permission granted', () => {
    it('does not show the permission-required text', () => {
      const { queryByText } = renderScreen();
      expect(queryByText('Camera permission required')).toBeNull();
    });

    it('does not call requestPermission when already granted', () => {
      renderScreen();
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });
  });
});
