import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from './membership.service';
import { RoomsController } from './rooms.controller';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    PrismaModule,
    PricingModule,
    AuthModule, // provides JwtAuthGuard, TokenService, JwtService with env keys
  ],
  controllers: [RoomsController],
  providers: [RoomsService, MembershipService, RoomsGateway],
  exports: [RoomsService],
})
export class RoomsModule {}
