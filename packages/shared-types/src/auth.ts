/** Phone OTP request payload */
export interface OtpRequestDto {
  phone: string; // E.164 format, e.g. +2348012345678
}

/** Server response after requesting an OTP */
export interface OtpRequestResponseDto {
  challengeId: string;
}

/** OTP verification payload */
export interface OtpVerifyDto {
  /** The challengeId returned by /v1/auth/otp/request — NOT the phone number. */
  challengeId: string;
  code: string;
  email?: string;
  marketingConsent?: boolean;
}

/** Tokens returned after successful OTP verification */
export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/** Server response after verifying an OTP */
export interface VerifyOtpResponseDto {
  tokens: AuthTokensDto;
  user: UserDto;
  isNewUser: boolean;
}

/** Refresh token payload */
export interface RefreshTokenDto {
  refreshToken: string;
}

/** Authenticated user */
export interface UserDto {
  id: string;
  phone: string; // redacted in logs — last 4 digits only
  email: string | null;
  emailVerified: boolean;
  marketingConsent: boolean;
  createdAt: string; // ISO-8601 UTC
}
