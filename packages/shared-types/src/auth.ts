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
export type VerifyOtpResponseDto =
  | { isNewUser: false; tokens: AuthTokensDto; user: UserDto }
  | { isNewUser: true; signupTicket: string };

/** Payload to complete sign-up after the age-gate screen (new users only). */
export interface CompleteSignupDto {
  /** Short-lived ticket returned by POST /auth/otp/verify for new users. */
  signupTicket: string;
  email: string;
  /** Birth year only (year-only collection minimises data per privacy-by-design). */
  birthYear: number;
  marketingConsent?: boolean;
  /** Required (and must be true) when birthYear puts the user in the 13–17 range. */
  parentalConsentConfirmed?: boolean;
}

/** Response from POST /auth/complete-signup */
export interface CompleteSignupResponseDto {
  isNewUser: true;
  tokens: AuthTokensDto;
  user: UserDto;
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
  preferredCurrency: string | null; // ISO 4217; null = auto-resolve at Room creation
  createdAt: string; // ISO-8601 UTC
}
