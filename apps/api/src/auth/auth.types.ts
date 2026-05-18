export interface AccessTokenPayload {
  sub: string; // userId
  phone: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface EmailVerifyTokenPayload {
  sub: string; // userId
  email: string;
  purpose: 'email_verify';
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
}

// Augment Express Request so req.user is typed throughout the app
declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
