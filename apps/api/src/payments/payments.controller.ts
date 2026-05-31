import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ── GET /v1/payments ───────────────────────────────────────────────────────

  @Get()
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.getPaymentHistory(user.id);
  }
}
