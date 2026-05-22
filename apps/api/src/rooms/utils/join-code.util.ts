import { createHash, randomInt } from 'crypto';

/**
 * Crockford base32 alphabet — 32 characters, excludes ambiguous I, L, O, U.
 * https://www.crockford.com/base32.html
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;

/**
 * Generates a random 6-character Crockford base32 join code.
 * Returns uppercase; all characters are unambiguous (no I, L, O, U).
 */
export function generateJoinCode(): string {
  let code = '';
  // Use crypto.randomInt for unbiased selection within the alphabet.
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalises a user-entered join code: uppercase + strip ambiguous look-alikes
 * so that "0" / "O" and "1" / "I" / "L" map to the canonical Crockford chars.
 */
export function normaliseJoinCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/O/g, '0') // letter O → digit 0
    .replace(/I/g, '1') // letter I → digit 1
    .replace(/L/g, '1') // letter L → digit 1
    .replace(/U/g, 'V') // letter U → V (Crockford substitution)
    .trim();
}

/**
 * Returns true if every character is in the Crockford alphabet after normalisation.
 */
export function isValidJoinCode(code: string): boolean {
  const normalised = normaliseJoinCode(code);
  if (normalised.length !== CODE_LENGTH) return false;
  return normalised.split('').every((c) => CROCKFORD_ALPHABET.includes(c));
}

/** Deterministic — used to stress-test distribution in tests only. */
export function joinCodeFromSeed(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CROCKFORD_ALPHABET[(hash[i] ?? 0) % CROCKFORD_ALPHABET.length];
  }
  return code;
}
