/**
 * Jest setupFiles — runs once per worker, before any test file is evaluated.
 * Sets environment variables that module-level code (e.g. JwtModule.register)
 * reads synchronously when modules are first required.
 */
import { generateKeyPairSync } from 'crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env['JWT_PRIVATE_KEY'] = privateKey;
process.env['JWT_PUBLIC_KEY'] = publicKey;
process.env['NODE_ENV'] ??= 'test';
process.env['OTP_MOCK'] ??= 'true';
