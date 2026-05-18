import { TermiiMockClient } from './termii-mock.client';

describe('TermiiMockClient', () => {
  it('resolves with success:true and a mock messageId without sending SMS', async () => {
    const client = new TermiiMockClient();
    const result = await client.sendOtp('+2348012345678', '123456');
    expect(result).toEqual({ success: true, messageId: 'mock-msg-id' });
  });
});
