const { verifyApiKey } = require('../services/apiKeys');
const prisma = require('../prisma');

// Auth for the /mcp endpoint only. Separate from firebaseAuth.guard's session
// cookie -- an MCP client sends a bearer token with every request instead.
async function apiKeyAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match ? match[1].trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const key = await verifyApiKey(token);
  if (!key) return res.status(401).json({ error: 'Invalid or revoked API key' });

  req.user = key.user;
  req.apiKeyId = key.id;
  // Best-effort freshness marker for the Settings UI ("last used X ago") --
  // must never block or fail the actual MCP request.
  prisma.apiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } }).catch(() => {});
  next();
}

module.exports = { apiKeyAuth };
