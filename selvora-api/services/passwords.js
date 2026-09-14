const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(scrypt);
// OWASP's scrypt minimum; serialize derivations to bound memory on small hosts.
const PREFIX = 'scrypt$131072$8$1$';
let active = false;
const waiting = [];
async function derive(password, salt) {
  if (active) {
    if (waiting.length >= 2) throw Object.assign(new Error('Authentication busy'), { status: 503 });
    await new Promise(resolve => waiting.push(resolve));
  }
  active = true;
  try {
    return await scryptAsync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `${PREFIX}${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, hash) {
  const match = typeof hash === 'string' && /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(hash);
  const key = await derive(password, match ? match[1] : '00000000000000000000000000000000');
  return Boolean(match && timingSafeEqual(key, Buffer.from(match[2], 'hex')));
}
module.exports = { hashPassword, verifyPassword };
