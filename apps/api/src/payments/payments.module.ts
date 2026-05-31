import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaystackClient } from './providers/paystack.client';
import { FLUTTERWAVE_PROVIDER, PAYSTACK_PROVIDER } from './providers/payment-provider.interface';

@Module({
  imports: [
    PrismaModule,
    PricingModule,
    AuthModule, // provides JwtAuthGuard
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaystackClient,
    { provide: PAYSTACK_PROVIDER, useExisting: PaystackClient },
    // FlutterwaveClient wired in commit 3; null until then — PaymentsService guards the null case.
    { provide: FLUTTERWAVE_PROVIDER, useValue: null },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
