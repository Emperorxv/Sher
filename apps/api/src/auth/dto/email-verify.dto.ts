import { IsString } from 'class-validator';

export class EmailVerifyDto {
  @IsString()
  token!: string;
}
