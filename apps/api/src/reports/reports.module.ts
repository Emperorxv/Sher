import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule, // provides JwtAuthGuard, CurrentUser decorator
    // RedisModule is @Global() — REDIS_CLIENT available without explicit import
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
