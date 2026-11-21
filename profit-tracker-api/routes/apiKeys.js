const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { createApiKey, rotateApiKey, revokeApiKey } = require('../services/apiKeys');
const activityLog = require('../services/activityLog');

// API key actions are log-only Activity entries (a key can't be un-revoked or
// un-issued). The key itself never goes into the log, only its name.
const logKey = (userId, action, record, detail = {}) => activityLog.recordEvent(userId, {
  recordType: 'api_key', recordId: record.id, action, name: record.name || 'API key', detail,
});

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const publicKey = (key) => ({
  id: key.id,
  name: key.name,
  key_prefix: key.key_prefix,
  created_at: key.created_at,
  last_used_at: key.last_used_at,
  revoked_at: key.revoked_at,
  allow_cashout_writes: Boolean(key.allow_cashout_writes),
  ai_guide_version: key.ai_guide_version ?? null,
});

// GET /api/api-keys — never returns key_hash or a raw token, only metadata.
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { user_id: req.user.id },
      orderBy: { created_at: 'desc' },
    });
    res.json(keys.map(publicKey));
  } catch (err) {
    next(err);
  }
});

// POST /api/api-keys — the raw token is returned exactly once, here.
router.post('/', isAuthenticated, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) || null : null;
    const { record, token } = await createApiKey(req.user.id, name);
    await logKey(req.user.id, 'create', record);
    res.json({ ...publicKey(record), token });
  } catch (err) {
    next(err);
  }
});

// POST /api/api-keys/:id/rotate — revokes the old key and issues a new one
// with the same name; the new raw token is returned exactly once.
router.post('/:id/rotate', isAuthenticated, async (req, res, next) => {
  try {
    const { record, token } = await rotateApiKey(req.user.id, req.params.id);
    await logKey(req.user.id, 'rotate', record);
    res.json({ ...publicKey(record), token });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/api-keys/:id -- turn binding cashout writes through MCP (commit,
// change, withdraw, send tracking) on or off for one key. Off by default.
router.patch('/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (typeof req.body?.allow_cashout_writes !== 'boolean') {
      return res.status(400).json({ error: 'allow_cashout_writes must be true or false' });
    }
    const existing = await prisma.apiKey.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!existing) return res.status(404).json({ error: 'API key not found' });
    if (existing.revoked_at) return res.status(409).json({ error: 'This key is revoked.' });
    const record = await prisma.apiKey.update({ where: { id: existing.id }, data: { allow_cashout_writes: req.body.allow_cashout_writes } });
    if (record.allow_cashout_writes !== existing.allow_cashout_writes) {
      await logKey(req.user.id, 'cashout_writes', record, { allowed: record.allow_cashout_writes });
    }
    res.json(publicKey(record));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/api-keys/:id — revokes rather than erasing, so McpWriteLog
// entries referencing this key stay meaningful.
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const revoked = await revokeApiKey(req.user.id, req.params.id);
    await logKey(req.user.id, 'revoke', revoked);
    res.json(publicKey(revoked));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
