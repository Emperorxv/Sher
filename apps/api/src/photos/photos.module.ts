import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomsModule } from '../rooms/rooms.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { PhotoQueueService } from './photos-queue.service';
import { PhotoProcessorService } from './jobs/photo-process.processor';

@Module({
  imports: [
    PrismaModule,
    AuthModule, // provides JwtAuthGuard
    RoomsModule, // provides RoomsGateway for photo:new / photo:deleted emits
    // StorageModule is @Global — no explicit import needed
  ],
  controllers: [PhotosController],
  providers: [PhotosService, PhotoQueueService, PhotoProcessorService],
  exports: [PhotosService],
})
export class PhotosModule {}
