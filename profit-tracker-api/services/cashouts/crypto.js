const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

function getEncryptionKey() {
  const rawKey = process.env.CASHOUT_KEY_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('CASHOUT_KEY_ENCRYPTION_KEY is required but not configured.');
  }

  // Support 64-char hex string (32 bytes) or raw 32-byte string
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  const buf = Buffer.from(rawKey, 'utf8');
  if (buf.length === 32) {
    return buf;
  }

  throw new Error('CASHOUT_KEY_ENCRYPTION_KEY must be exactly 32 bytes (or 64 hex characters).');
}

/**
 * Encrypt a plain text API key using AES-256-GCM.
 * Output format: "iv:authTag:ciphertext" (all hex-encoded)
 */
function encryptKey(plainText) {
  if (typeof plainText !== 'string' || !plainText.trim()) {
    throw new Error('A valid API key string is required for encryption.');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plainText.trim(), 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

/**
 * Decrypt an AES-256-GCM encrypted key string.
 */
function decryptKey(encryptedPayload) {
  if (typeof encryptedPayload !== 'string' || !encryptedPayload.includes(':')) {
    throw new Error('Invalid encrypted key payload format.');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted key payload structure.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted key segments.');
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH || authTag.length !== 16) {
    throw new Error('Invalid IV or auth tag length.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    throw new Error('Failed to decrypt cashout API key: corrupted payload or bad encryption key.');
  }
}

/**
 * Extract last 4 characters for safe display.
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '****';
  const trimmed = key.trim();
  return trimmed.slice(-4);
}

module.exports = {
  encryptKey,
  decryptKey,
  maskKey,
};
