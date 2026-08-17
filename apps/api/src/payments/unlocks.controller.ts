import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { createZodPipe } from '../common/pipes/zod-validation.pipe';
import { InitiateUnlockSchema, InitiateUnlockInput } from './schemas/initiate-unlock.schema';
import { RetentionExtendSchema, RetentionExtendInput } from './schemas/retention-extend.schema';
import { PaymentsService } from './payments.service';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class UnlocksController {
  constructor(private readonly payments: PaymentsService) {}

  // ── POST /v1/rooms/:id/unlock ──────────────────────────────────────────────

  @Post(':id/unlock')
  @HttpCode(HttpStatus.CREATED)
  initiateRoomUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(createZodPipe(InitiateUnlockSchema)) dto: InitiateUnlockInput,
  ) {
    return this.payments.initiateRoomUnlock(id, user.id, dto);
  }

  // ── POST /v1/rooms/:id/unlock/base ─────────────────────────────────────────

  @Post(':id/unlock/base')
  @HttpCode(HttpStatus.CREATED)
  initiateBaseUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(createZodPipe(InitiateUnlockSchema)) dto: InitiateUnlockInput,
  ) {
    return this.payments.initiateBaseUnlock(id, user.id, dto);
  }

  // ── POST /v1/rooms/:id/unlock/member ───────────────────────────────────────

  @Post(':id/unlock/member')
  @HttpCode(HttpStatus.CREATED)
  initiateMemberUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(createZodPipe(InitiateUnlockSchema)) dto: InitiateUnlockInput,
  ) {
    return this.payments.initiateMemberUnlock(id, user.id, dto);
  }

  // ── GET /v1/rooms/:id/unlock/status ────────────────────────────────────────

  @Get(':id/unlock/status')
  getUnlockStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.getUnlockStatus(id, user.id);
  }

  // ── POST /v1/rooms/:id/retention/extend ────────────────────────────────────

  @Post(':id/retention/extend')
  @HttpCode(HttpStatus.CREATED)
  extendRetention(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(createZodPipe(RetentionExtendSchema)) dto: RetentionExtendInput,
  ) {
    return this.payments.initiateRetentionExtension(id, user.id, dto);
  }

  // ── DELETE /v1/rooms/:id/retention/subscription ────────────────────────────
  // Cancels future recurring charges. Authorization: payer-only.
  // The already-paid retentionUntil is NOT shortened.

  @Delete(':id/retention/subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelRetentionSubscription(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.cancelRetentionSubscription(id, user.id);
  }
}
