import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CompleteSignupDto {
  @IsString()
  signupTicket!: string;

  @IsEmail()
  email!: string;

  /**
   * Year of birth (year only — privacy-by-design, no full date collected).
   * Must be ≥ 1900 and ≤ the current year.
   * Age is computed server-side as (currentYear − birthYear).
   */
  @IsInt()
  @Min(1900)
  birthYear!: number;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  /**
   * Required (and must be true) when the computed age is 13–17.
   * Ignored for ages 18+; always stored as false for those users.
   */
  @IsOptional()
  @IsBoolean()
  parentalConsentConfirmed?: boolean;
}
