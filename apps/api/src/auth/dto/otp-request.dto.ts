import { IsString, Matches } from 'class-validator';

export class OtpRequestDto {
  /** E.164 phone number, e.g. +2348012345678. Normalized server-side. */
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'phone must be a valid E.164 number' })
  phone!: string;
}
