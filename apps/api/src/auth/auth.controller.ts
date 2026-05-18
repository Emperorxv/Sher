import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Platform } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { EmailVerifyDto } from './dto/email-verify.dto';
import type { LogoutDto } from './dto/logout.dto';
import type { OtpRequestDto } from './dto/otp-request.dto';
import type { OtpVerifyDto } from './dto/otp-verify.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { RegisterDeviceDto } from './dto/register-device.dto';
import type { EmailVerifyService } from './email/email-verify.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './auth.types';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailVerify: EmailVerifyService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: OtpRequestDto): Promise<{ challengeId: string }> {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: EmailVerifyDto): Promise<void> {
    return this.emailVerify.verify(dto.token);
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendEmail(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.emailVerify.resend(user.id);
  }

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  async registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<{ id: string }> {
    const device = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { lastSeenAt: new Date() },
      create: { userId: user.id, token: dto.token, platform: dto.platform as Platform },
    });
    return { id: device.id };
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.prisma.deviceToken.deleteMany({
      where: { id, userId: user.id },
    });
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.deleteAccount(user.id);
  }
}
