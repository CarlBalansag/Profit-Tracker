// MCP bearer tokens. Separate from browser session auth (firebaseAuth.js /
// LocalCredential) -- these are long-lived, high-entropy secrets sent on
// every API call, so (unlike a human password) a fast plain SHA-256 hash is
// the right tool: there is no low-entropy input to protect against brute
// force, only the stored hash to protect against a DB leak. Same reasoning
// routes/firebaseAuth.js already applies to session fingerprints.
const { randomBytes, createHash } = require('node:crypto');
const prisma = require('../prisma');

const TOKEN_PREFIX = 'selvora_mcp_';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const generateRawToken = () => TOKEN_PREFIX + randomBytes(32).toString('hex');
// Shown in the Settings UI so a user can tell keys apart without the full
// secret ever being stored or displayed again after creation.
const prefixOf = (token) => token.slice(0, TOKEN_PREFIX.length + 8);

const notFound = () => Object.assign(new Error('API key not found'), { status: 404 });

async function createApiKey(userId, name) {
  const token = generateRawToken();
  const record = await prisma.apiKey.create({
    data: { user_id: userId, name: name || null, key_hash: hashToken(token), key_prefix: prefixOf(token) },
  });
  return { record, token };
}

// Revokes the existing key (if not already revoked) and issues a new one
// with the same name, in one transaction -- a request made with the old
// token can never succeed after this returns, even mid-rotation.
async function rotateApiKey(userId, existingId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.apiKey.findFirst({ where: { id: existingId, user_id: userId } });
    if (!existing) throw notFound();
    if (!existing.revoked_at) {
      await tx.apiKey.update({ where: { id: existing.id }, data: { revoked_at: new Date() } });
    }
    const token = generateRawToken();
    const record = await tx.apiKey.create({
      data: { user_id: userId, name: existing.name, key_hash: hashToken(token), key_prefix: prefixOf(token) },
    });
    return { record, token };
  });
}

async function revokeApiKey(userId, id) {
  const existing = await prisma.apiKey.findFirst({ where: { id, user_id: userId } });
  if (!existing) throw notFound();
  if (existing.revoked_at) return existing;
  return prisma.apiKey.update({ where: { id }, data: { revoked_at: new Date() } });
}

async function verifyApiKey(token) {
  if (!token) return null;
  const key = await prisma.apiKey.findUnique({ where: { key_hash: hashToken(token) }, include: { user: true } });
  if (!key || key.revoked_at) return null;
  return key;
}

module.exports = { createApiKey, rotateApiKey, revokeApiKey, verifyApiKey, hashToken };
