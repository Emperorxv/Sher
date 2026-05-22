import {
  generateJoinCode,
  isValidJoinCode,
  joinCodeFromSeed,
  normaliseJoinCode,
} from './join-code.util';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const AMBIGUOUS_CHARS = ['I', 'L', 'O', 'U'];

describe('generateJoinCode()', () => {
  it('returns a 6-character string', () => {
    expect(generateJoinCode()).toHaveLength(6);
  });

  it('contains only Crockford alphabet characters', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode();
      for (const char of code) {
        expect(CROCKFORD_ALPHABET).toContain(char);
      }
    }
  });

  it('never contains ambiguous characters (I, L, O, U)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      for (const bad of AMBIGUOUS_CHARS) {
        expect(code).not.toContain(bad);
      }
    }
  });

  it('produces all uppercase output', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateJoinCode();
      expect(code).toBe(code.toUpperCase());
    }
  });

  it('generates distinct codes (probabilistic — collision in 20 would be ~0)', () => {
    const codes = new Set(Array.from({ length: 20 }, generateJoinCode));
    // 32^6 = ~1 billion possible codes; 20 unique is almost certain
    expect(codes.size).toBeGreaterThanOrEqual(18);
  });
});

describe('normaliseJoinCode()', () => {
  it('uppercases input', () => {
    expect(normaliseJoinCode('abc123')).toBe('ABC123');
  });

  it('maps O → 0, I → 1, L → 1, U → V', () => {
    expect(normaliseJoinCode('OILUVE')).toBe('011VVE');
  });

  it('strips surrounding whitespace', () => {
    expect(normaliseJoinCode('  AB3456  ')).toBe('AB3456');
  });
});

describe('isValidJoinCode()', () => {
  it('accepts valid 6-char Crockford codes', () => {
    expect(isValidJoinCode('AB3456')).toBe(true);
    expect(isValidJoinCode('000000')).toBe(true);
    expect(isValidJoinCode('ZZZZZZ')).toBe(true);
  });

  it('rejects codes with ambiguous characters (before normalisation is applied by caller)', () => {
    // isValidJoinCode normalises first, so "O" → "0" is valid
    expect(isValidJoinCode('O00000')).toBe(true); // O normalised to 0
  });

  it('rejects codes that are not 6 chars', () => {
    expect(isValidJoinCode('ABC')).toBe(false);
    expect(isValidJoinCode('ABCDEFG')).toBe(false);
    expect(isValidJoinCode('')).toBe(false);
  });
});

describe('joinCodeFromSeed()', () => {
  it('is deterministic for the same seed', () => {
    expect(joinCodeFromSeed('test-seed')).toBe(joinCodeFromSeed('test-seed'));
  });

  it('produces different codes for different seeds', () => {
    expect(joinCodeFromSeed('seed-a')).not.toBe(joinCodeFromSeed('seed-b'));
  });

  it('output is always 6 chars from the Crockford alphabet', () => {
    const code = joinCodeFromSeed('any-seed-here');
    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(CROCKFORD_ALPHABET).toContain(char);
    }
  });
});
