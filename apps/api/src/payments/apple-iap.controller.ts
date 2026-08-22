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
   * Called by the iOS client after react-native-iap / expo-iap returns a
   * successful Non-Consumable purchase (Tier1 / Tier2 / Tier3). Verifies the
   * receipt with Apple and unlocks the room via the shared success path.
   */
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyRoomUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createZodPipe(AppleVerifyRoomUnlockSchema)) dto: AppleVerifyRoomUnlockInput,
  ) {
    return this.appleIap.verifyRoomUnlock(
      user.id,
      dto.roomId,
      dto.productId,
      dto.receiptData,
      dto.transactionId,
    );
  }

  /**
   * POST /v1/payments/apple/verify-storage
   *
   * Called by the iOS client after a successful ExtendStorage Auto-Renewable
   * Subscription purchase. Verifies the receipt and extends photo retention.
   */
  @Post('verify-storage')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyStorageExtension(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createZodPipe(AppleVerifyStorageSchema)) dto: AppleVerifyStorageInput,
  ) {
    return this.appleIap.verifyStorageExtension(
      user.id,
      dto.roomId,
      dto.receiptData,
      dto.transactionId,
    );
  }
}
