import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { UnlocksController } from './unlocks.controller';
import { WebhooksController } from './webhooks.controller';
import { PaymentsService } from './payments.service';
import { PaystackClient } from './providers/paystack.client';
import { FlutterwaveClient } from './providers/flutterwave.client';
import { FLUTTERWAVE_PROVIDER, PAYSTACK_PROVIDER } from './providers/payment-provider.interface';

@Module({
  imports: [
    PrismaModule,
    PricingModule,
    AuthModule, // provides JwtAuthGuard
  ],
  controllers: [PaymentsController, UnlocksController, WebhooksController],
  providers: [
    PaymentsService,
    PaystackClient,
    { provide: PAYSTACK_PROVIDER, useExisting: PaystackClient },
    FlutterwaveClient,
    { provide: FLUTTERWAVE_PROVIDER, useExisting: FlutterwaveClient },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
