/**
 * Camera screen unit tests — /rooms/[id]/camera
 *
 * Covers:
 *   - Permission denied: renders "Camera permission required" + settings link.
 *   - Device null: renders "Camera unavailable" fallback view.
 *   - Permission granted + device available: renders Camera + capture button.
 *   - Tap capture calls photoOutput.capturePhoto.
 *   - On capture success: calls upload pipeline (getUploadUrl → PUT → commit).
 *   - Optimistic UI: spinner appears during upload, disappears on success.
 *   - On upload error: retry button appears, error string shown in tile.
 *
 * react-native-vision-camera is mocked (no native binary).
 * lib/camera hooks are mocked so this test only covers screen UI behavior.
 */

// ── Hoisted mock vars ─────────────────────────────────────────────────────────

const mockBack = jest.fn();
const mockRequestPermission = jest.fn().mockResolvedValue(true);
const mockCapturePhoto = jest.fn().mockResolvedValue({
  saveToTemporaryFileAsync: jest.fn().mockResolvedValue('/tmp/photo-test.jpg'),
  dispose: jest.fn(),
});
const mockUpload = jest.fn();
const mockDevice = { id: 'back', position: 'back' };

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: mockBack })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-test-1' })),
}));

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
  // Stub Camera as a plain View so RNTL can render it.
  Camera: 'View',
}));

jest.mock('../../../../../lib/camera', () => ({
  useCameraDeviceWithFallback: jest.fn(() => mockDevice),
  useUploadPhoto: jest.fn(() => ({ upload: mockUpload })),
  mapUploadError: jest.fn(() => 'Upload failed. Tap retry.'),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as VisionCamera from 'react-native-vision-camera';
import * as CameraLib from '../../../../../lib/camera';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: CameraScreen } = require('../camera') as {
    default: React.ComponentType;
  };
  return render(<CameraScreen />);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Default: permission granted, device available, upload succeeds.
  (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
    hasPermission: true,
    requestPermission: mockRequestPermission,
    status: 'authorized',
    canRequestPermission: false,
  });
  (CameraLib.useCameraDeviceWithFallback as jest.Mock).mockReturnValue(mockDevice);
  (CameraLib.useUploadPhoto as jest.Mock).mockReturnValue({ upload: mockUpload });
  (CameraLib.mapUploadError as jest.Mock).mockReturnValue('Upload failed. Tap retry.');
  mockUpload.mockResolvedValue({ photoId: 'photo-abc' });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Permission denied ──────────────────────────────────────────────────────────

describe('permission denied', () => {
  beforeEach(() => {
    (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: false,
      requestPermission: mockRequestPermission,
      status: 'denied',
      canRequestPermission: false,
    });
  });

  it('renders "Camera permission required" text', () => {
    const { getByText } = renderScreen();
    expect(getByText('Camera permission required')).toBeTruthy();
  });

  it('"Open Settings" button calls Linking.openSettings', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Open Settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('"Close" button calls router.back()', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Close camera'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not render the capture button', () => {
    const { queryByLabelText } = renderScreen();
    expect(queryByLabelText('Capture photo')).toBeNull();
  });
});

// ── No camera device ───────────────────────────────────────────────────────────

describe('no camera device available', () => {
  beforeEach(() => {
    (CameraLib.useCameraDeviceWithFallback as jest.Mock).mockReturnValue(null);
  });

  it('renders "Camera unavailable" message instead of crashing', () => {
    const { getByText } = renderScreen();
    expect(getByText('Camera unavailable on this device.')).toBeTruthy();
  });

  it('"Close" button calls router.back()', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Close camera'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not render the capture button', () => {
    const { queryByLabelText } = renderScreen();
    expect(queryByLabelText('Capture photo')).toBeNull();
  });
});

// ── Permission granted + device available ──────────────────────────────────────

describe('permission granted and device available', () => {
  it('renders without throwing', () => {
    expect(() => renderScreen()).not.toThrow();
  });

  it('renders the capture button', () => {
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Capture photo')).toBeTruthy();
  });

  it('renders the close button', () => {
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Close camera')).toBeTruthy();
  });

  it('close button calls router.back()', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Close camera'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not show permission-required text', () => {
    const { queryByText } = renderScreen();
    expect(queryByText('Camera permission required')).toBeNull();
  });
});

// ── Capture flow ───────────────────────────────────────────────────────────────

describe('capture flow', () => {
  it('calls photoOutput.capturePhoto when capture button is tapped', async () => {
    const { getByLabelText } = renderScreen();
    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });
    expect(mockCapturePhoto).toHaveBeenCalledTimes(1);
  });

  it('calls upload pipeline (getUploadUrl → PUT → commit) via useUploadPhoto on capture success', async () => {
    const { getByLabelText } = renderScreen();
    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });
    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1);
    });
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/photo-test.jpg',
        mimeType: 'image/jpeg',
      }),
    );
  });
});

// ── Optimistic UI ──────────────────────────────────────────────────────────────

describe('optimistic upload UI', () => {
  it('shows uploads overlay with spinner while upload is in flight', async () => {
    // Keep upload pending so we can observe the intermediate state.
    let resolveUpload!: (v: { photoId: string }) => void;
    mockUpload.mockReturnValue(
      new Promise<{ photoId: string }>((res) => {
        resolveUpload = res;
      }),
    );

    const { getByTestId, getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });

    expect(getByTestId('uploads-overlay')).toBeTruthy();

    // Resolve the upload to clean up.
    await act(async () => {
      resolveUpload({ photoId: 'photo-abc' });
    });
  });

  it('removes the upload tile after success + 2 s timeout', async () => {
    const { queryByTestId, getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalled();
    });

    // Advance past the 2 s auto-clear timer.
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(queryByTestId('uploads-overlay')).toBeNull();
  });
});

// ── Upload error + retry ───────────────────────────────────────────────────────

describe('upload error', () => {
  beforeEach(() => {
    mockUpload.mockRejectedValue(new Error('upload failed'));
    (CameraLib.mapUploadError as jest.Mock).mockReturnValue('Upload failed. Tap retry.');
  });

  it('shows error string in tile when upload fails', async () => {
    const { getByText, getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });

    await waitFor(() => {
      expect(getByText('Upload failed. Tap retry.')).toBeTruthy();
    });
  });

  it('shows "Retry" button in error tile', async () => {
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });

    await waitFor(() => {
      expect(getByLabelText('Retry upload')).toBeTruthy();
    });
  });

  it('retry re-triggers the upload pipeline', async () => {
    // First call fails, second call succeeds.
    mockUpload
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ photoId: 'photo-abc' });

    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Capture photo'));
    });

    await waitFor(() => {
      expect(getByLabelText('Retry upload')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Retry upload'));
    });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(2);
    });
  });
});
