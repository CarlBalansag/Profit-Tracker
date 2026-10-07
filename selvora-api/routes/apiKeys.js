const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { createApiKey, rotateApiKey, revokeApiKey } = require('../services/apiKeys');

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
    res.json({ ...publicKey(record), token });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/api-keys/:id — revokes rather than erasing, so McpWriteLog
// entries referencing this key stay meaningful.
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const revoked = await revokeApiKey(req.user.id, req.params.id);
    res.json(publicKey(revoked));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
