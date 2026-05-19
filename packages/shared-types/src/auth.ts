/** Phone OTP request payload */
export interface OtpRequestDto {
  phone: string; // E.164 format, e.g. +2348012345678
}

/** OTP verification payload */
export interface OtpVerifyDto {
  phone: string;
  code: string;
}

/** Tokens returned after successful OTP verification */
export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
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
