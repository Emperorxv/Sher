import { Injectable, Logger } from '@nestjs/common';

export interface SmsResult {
  success: boolean;
  messageId?: string;
}

@Injectable()
export class TermiiClient {
  private readonly logger = new Logger(TermiiClient.name);

  async sendOtp(phone: string, code: string): Promise<SmsResult> {
    const apiKey = process.env['TERMII_API_KEY'];
    const senderId = process.env['TERMII_SENDER_ID'] ?? 'Sher';

    const body = {
      api_key: apiKey,
      to: phone,
      from: senderId,
      sms: `Your Sher verification code is ${code}. Valid for 10 minutes. Do not share it.`,
      type: 'plain',
      channel: 'dnd',
    };

    try {
      const response = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        this.logger.error(
          { status: response.status, phone: phone.slice(0, -4) + '****' },
          'Termii send failed',
        );
        return { success: false };
      }

      const data = (await response.json()) as { message_id?: string };
      return { success: true, messageId: data.message_id };
    } catch (err) {
      this.logger.error({ err }, 'Termii request threw');
      return { success: false };
    }
  }
}
