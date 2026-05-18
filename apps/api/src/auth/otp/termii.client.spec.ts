import { TermiiClient } from './termii.client';

describe('TermiiClient', () => {
  let client: TermiiClient;

  beforeEach(() => {
    client = new TermiiClient();
    jest.restoreAllMocks();
  });

  describe('sendOtp()', () => {
    it('returns success:true with messageId on 2xx response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message_id: 'msg-123' }),
      } as Response);

      const result = await client.sendOtp('+2348012345678', '123456');
      expect(result).toEqual({ success: true, messageId: 'msg-123' });
    });

    it('returns success:false when response is not ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const result = await client.sendOtp('+2348012345678', '123456');
      expect(result).toEqual({ success: false });
    });

    it('returns success:false when fetch throws a network error', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await client.sendOtp('+2348012345678', '123456');
      expect(result).toEqual({ success: false });
    });
  });
});
