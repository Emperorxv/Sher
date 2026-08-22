import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomsModule } from '../rooms/rooms.module';
import { PaymentsController } from './payments.controller';
import { UnlocksController } from './unlocks.controller';
import { WebhooksController } from './webhooks.controller';
import { AppleIapController } from './apple-iap.controller';
import { PaymentsService } from './payments.service';
import { AppleIapService } from './apple-iap.service';
import { PaystackClient } from './providers/paystack.client';
import { FlutterwaveClient } from './providers/flutterwave.client';
import { AppleIapClient } from './providers/apple-iap.client';
import { FLUTTERWAVE_PROVIDER, PAYSTACK_PROVIDER } from './providers/payment-provider.interface';
import { PaymentReconcileProcessor } from './jobs/payment-reconcile.processor';
import { RetentionRenewProcessor } from './jobs/retention-renew.processor';

@Module({
  imports: [
    PrismaModule,
    PricingModule,
    AuthModule, // provides JwtAuthGuard
    RoomsModule, // provides RoomsGateway for payment event emits
  ],
  controllers: [PaymentsController, UnlocksController, WebhooksController, AppleIapController],
  providers: [
    PaymentsService,
    AppleIapService,
    AppleIapClient,
    PaystackClient,
    { provide: PAYSTACK_PROVIDER, useExisting: PaystackClient },
    FlutterwaveClient,
    { provide: FLUTTERWAVE_PROVIDER, useExisting: FlutterwaveClient },
    PaymentReconcileProcessor,
    RetentionRenewProcessor,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
