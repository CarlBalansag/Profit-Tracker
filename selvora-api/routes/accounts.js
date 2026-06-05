const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { account, updateAccount } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// CREATE: Add a new account
router.post('/', isAuthenticated, validateBody(account), async (req, res, next) => {
  try {
    const { platform_id, name, email, username, status, notes } = req.body;

    if (!platform_id || !name) {
      return res.status(400).json({ error: 'Platform ID and Account Name are required' });
    }

    const account = await prisma.account.create({
      data: {
        user_id: req.user.id,
        platform_id,
        name,
        email:    email    || null,
        username: username || null,
        status:   status   || 'Active',
        notes:    notes    || null,
      }
    });

    res.status(201).json(account);
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// READ: Get all accounts for the authenticated user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { user_id: req.user.id },
      include: { platform: true },
    });
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// UPDATE: Edit an account
router.put('/:id', isAuthenticated, validateBody(updateAccount), async (req, res, next) => {
  try {
    const existing = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { name, email, username, status, notes } = req.body;
    const account = await prisma.account.update({
      where: { id: req.params.id },
      data: {
        name:     name     ?? existing.name,
        email:    email    ?? existing.email,
        username: username ?? existing.username,
        status:   status   ?? existing.status,
        notes:    notes    ?? existing.notes,
      }
    });
    res.json(account);
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE: Remove an account
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.account.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
