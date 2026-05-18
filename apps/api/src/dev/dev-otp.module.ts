import { Global, Module } from '@nestjs/common';
import { DevEnvGuard } from './dev-env.guard';
import { DevOtpController } from './dev-otp.controller';
import { DevOtpStore } from './dev-otp.store';

/**
 * Development-only module. Imported by AppModule only when NODE_ENV=development.
 *
 * Marked @Global so DevOtpStore is available for optional injection in AuthModule
 * (TermiiMockClient uses @Optional() @Inject(DevOtpStore) to capture codes without
 * requiring AuthModule to import this module explicitly).
 */
@Global()
@Module({
  controllers: [DevOtpController],
  providers: [DevOtpStore, DevEnvGuard],
  exports: [DevOtpStore],
})
export class DevOtpModule {}
