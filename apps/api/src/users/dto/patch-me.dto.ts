import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
