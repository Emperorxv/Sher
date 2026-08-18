import { IsNotEmpty, IsString, Length } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  challengeId!: string;

  /** 6-digit OTP code from the deletion-request step. */
  @IsString()
  @Length(6, 6)
  code!: string;
}
