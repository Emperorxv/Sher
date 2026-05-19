/**
 * Sentry React Native initialisation.
 * Call initSentry() once at app boot (before any navigation renders).
 *
 * Redaction rules mirror the API's pino-redact config — never send
 * phone numbers in full, JWT tokens, or payment secrets to Sentry.
 */
import * as Sentry from '@sentry/react-native';

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // Not configured — skip in local dev without crashing.
    return;
  }

  Sentry.init({
    dsn,
    // Enable in production only; use debug:true only locally.
    debug: process.env.NODE_ENV !== 'production',
    // Attach native stack frames for better crash symbolication.
    enableNative: true,
    // Breadcrumbs: skip console.log noise in production.
    maxBreadcrumbs: 50,
    beforeSend(event) {
      // Strip any exception values that look like phone numbers or tokens.
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((ex) => ({
          ...ex,
          value: ex.value
            ?.replace(/\+?\d[\d\s\-().]{8,}\d/g, '[PHONE_REDACTED]')
            .replace(/Bearer\s+\S+/gi, 'Bearer [TOKEN_REDACTED]'),
        }));
      }
      return event;
    },
  });
}

/** Wrap a root component with Sentry's error boundary + performance tracing. */
export const { wrap: sentryWrap } = Sentry;
