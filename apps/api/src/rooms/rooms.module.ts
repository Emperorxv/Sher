import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
    // JwtModule without options — reads privateKey/publicKey from env at runtime.
    // The gateway only needs to verify (publicKey), not sign.
    JwtModule.register({}),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, MembershipService, RoomsGateway],
  exports: [RoomsService],
})
export class RoomsModule {}
