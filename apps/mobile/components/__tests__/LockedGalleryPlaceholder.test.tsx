/**
 * Tests for LockedGalleryPlaceholder.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LockedGalleryPlaceholder } from '../LockedGalleryPlaceholder';

describe('LockedGalleryPlaceholder', () => {
  it('renders correct number of placeholder tiles', () => {
    const { getAllByLabelText } = render(<LockedGalleryPlaceholder photoCount={6} />);
    expect(getAllByLabelText('locked')).toHaveLength(6);
  });

  it('renders zero tiles when photoCount is 0', () => {
    const { queryAllByLabelText } = render(<LockedGalleryPlaceholder photoCount={0} />);
    expect(queryAllByLabelText('locked')).toHaveLength(0);
  });

  it('tap triggers onUnlockPress', () => {
    const onUnlockPress = jest.fn();
    const { getByLabelText } = render(
      <LockedGalleryPlaceholder photoCount={3} onUnlockPress={onUnlockPress} />,
    );
    fireEvent.press(getByLabelText('Unlock gallery'));
    expect(onUnlockPress).toHaveBeenCalledTimes(1);
  });

  it('renders testID tiles for each photo', () => {
    const { getByTestId } = render(<LockedGalleryPlaceholder photoCount={3} />);
    expect(getByTestId('locked-tile-0')).toBeTruthy();
    expect(getByTestId('locked-tile-1')).toBeTruthy();
    expect(getByTestId('locked-tile-2')).toBeTruthy();
  });

  it('shows callout text prompting unlock', () => {
    const { getByText } = render(<LockedGalleryPlaceholder photoCount={1} />);
    expect(getByText('Tap to unlock your photos')).toBeTruthy();
  });
});
