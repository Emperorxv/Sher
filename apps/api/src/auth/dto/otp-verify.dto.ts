import { IsBoolean, IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class OtpVerifyDto {
  @IsString()
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  /**
   * Required for new users (first-ever OTP verify).
   * Optional for returning users who already have an email on file.
   */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Defaults to false when omitted. */
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
