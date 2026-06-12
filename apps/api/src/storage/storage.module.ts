import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * @Global so StorageService is available to any module without explicit
 * imports — mirrors the pattern used for PrismaModule and RedisModule.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
