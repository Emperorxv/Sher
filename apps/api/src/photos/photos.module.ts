import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { PhotoQueueService } from './photos-queue.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule, // provides JwtAuthGuard
    // StorageModule is @Global — no explicit import needed
  ],
  controllers: [PhotosController],
  providers: [PhotosService, PhotoQueueService],
  exports: [PhotosService],
})
export class PhotosModule {}
