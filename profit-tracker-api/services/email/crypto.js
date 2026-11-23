// Email passwords and tokens are encrypted with their own key, EMAIL_TOKEN_KEY,
// separate from the cash-out key. Format "v1:<iv>:<ciphertext>:<tag>" (base64),
// so a later key rotation can tell old and new values apart.
const crypto = require('node:crypto');

const VERSION = 'v1';
const IV_LENGTH = 12;

class EmailKeyMissing extends Error {}

function key() {
  const raw = process.env.EMAIL_TOKEN_KEY?.trim();
  if (!raw) throw new EmailKeyMissing('Email connections are not set up on this server yet.');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  throw new EmailKeyMissing('EMAIL_TOKEN_KEY must be 32 bytes (64 hex characters or base64).');
}

const configured = () => { try { key(); return true; } catch { return false; } };

function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('Nothing to encrypt.');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), body.toString('base64'), cipher.getAuthTag().toString('base64')].join(':');
}

function decryptSecret(payload) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported secret format.');
  const iv = Buffer.from(parts[1], 'base64');
  const body = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_LENGTH || tag.length !== 16) throw new Error('Unsupported secret format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, configured, EmailKeyMissing };
