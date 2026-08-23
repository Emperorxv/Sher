import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { createZodPipe } from '../common/pipes/zod-validation.pipe';
import {
  AppleVerifyRoomUnlockSchema,
  AppleVerifyRoomUnlockInput,
  AppleVerifyStorageSchema,
  AppleVerifyStorageInput,
} from './schemas/apple-iap-verify.schema';
import { AppleIapService } from './apple-iap.service';

@Controller('payments/apple')
@UseGuards(JwtAuthGuard)
export class AppleIapController {
  constructor(private readonly appleIap: AppleIapService) {}

  /**
   * POST /v1/payments/apple/verify
   *
   * Called by the iOS client after expo-iap returns a successful Non-Consumable
   * purchase (Tier1/Tier2/Tier3). The server fetches the transaction directly
   * from Apple's App Store Server API using the transactionId — no receipt data
   * is needed from the client (Path A verification).
   */
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyRoomUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createZodPipe(AppleVerifyRoomUnlockSchema)) dto: AppleVerifyRoomUnlockInput,
  ) {
    return this.appleIap.verifyRoomUnlock(user.id, dto.roomId, dto.productId, dto.transactionId);
  }

  /**
   * POST /v1/payments/apple/verify-storage
   *
   * Called by the iOS client after a successful ExtendStorage Auto-Renewable
   * Subscription purchase. The server fetches and verifies the transaction
   * directly from Apple's App Store Server API using the transactionId.
   */
  @Post('verify-storage')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyStorageExtension(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createZodPipe(AppleVerifyStorageSchema)) dto: AppleVerifyStorageInput,
  ) {
    return this.appleIap.verifyStorageExtension(user.id, dto.roomId, dto.transactionId);
  }
}
