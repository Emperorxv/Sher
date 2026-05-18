import { IsEnum, IsString } from 'class-validator';
import { Platform } from '@prisma/client';

export class RegisterDeviceDto {
  @IsString()
  token!: string;

  @IsEnum(Platform)
  platform!: Platform;
}
