import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerifyService } from './email/email-verify.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RoomRoleGuard } from './guards/room-role.guard';
import { TermiiClient } from './otp/termii.client';
import { TermiiMockClient } from './otp/termii-mock.client';
import { OtpService } from './otp/otp.service';
import { RefreshTokenService } from './token/refresh-token.service';
import { TokenService } from './token/token.service';

function readPemKey(envVar: string): string {
  // Support both literal \n escape sequences (single-line .env values)
  // and actual newlines (multi-line .env values or runtime injection)
  return (process.env[envVar] ?? '').replace(/\\n/g, '\n');
}

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      privateKey: readPemKey('JWT_PRIVATE_KEY'),
      publicKey: readPemKey('JWT_PUBLIC_KEY'),
      signOptions: { algorithm: 'RS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TermiiClient,
    TermiiMockClient,
    TokenService,
    RefreshTokenService,
    EmailVerifyService,
    JwtAuthGuard,
    RolesGuard,
    RoomRoleGuard,
  ],
  exports: [TokenService, JwtAuthGuard, RolesGuard, RoomRoleGuard, EmailVerifyService, JwtModule],
})
export class AuthModule {}
