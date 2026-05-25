import { DevOtpStore } from '../../dev/dev-otp.store';
import { TermiiMockClient } from './termii-mock.client';

describe('TermiiMockClient', () => {
  it('resolves with success:true and a mock messageId without sending SMS', async () => {
    const client = new TermiiMockClient();
    const result = await client.sendOtp('+2348012345678', '123456');
    expect(result).toEqual({ success: true, messageId: 'mock-msg-id' });
  });

  it('stores the OTP code in DevOtpStore keyed by phone when one is provided', async () => {
    const store = new DevOtpStore();
    const client = new TermiiMockClient(store);
    await client.sendOtp('+2348012345678', '654321');
    expect(store.get('+2348012345678')).toBe('654321');
  });

  it('stores codes independently per phone — second phone does not overwrite first', async () => {
    const store = new DevOtpStore();
    const client = new TermiiMockClient(store);
    await client.sendOtp('+2348012345678', 'code-a');
    await client.sendOtp('+2348099999999', 'code-b');
    expect(store.get('+2348012345678')).toBe('code-a');
    expect(store.get('+2348099999999')).toBe('code-b');
  });

  it('does not throw when DevOtpStore is absent (non-dev env)', async () => {
    const client = new TermiiMockClient(undefined);
    await expect(client.sendOtp('+2348012345678', '123456')).resolves.toEqual({
      success: true,
      messageId: 'mock-msg-id',
    });
  });
});
