const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// CREATE: Add a new account
router.post('/', async (req, res) => {
  try {
    const { platform_id, name, email, username, status, notes } = req.body;
    
    if (!platform_id || !name) {
      return res.status(400).send('Platform ID and Account Name are required');
    }

    const account = await prisma.account.create({
      data: {
        platform_id,
        name,
        email,
        username,
        status,
        notes
      }
    });

    res.status(201).json(account);
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).send('Internal Server Error');
  }
});

// READ: Get all accounts (mostly for debugging, normally you'd fetch via platform)
router.get('/', async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        platform: true
      }
    });
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).send('Internal Server Error');
  }
});

// UPDATE: Edit an account
router.put('/:id', async (req, res) => {
  try {
    const account = await prisma.account.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json(account);
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).send('Internal Server Error');
  }
});

// DELETE: Remove an account
router.delete('/:id', async (req, res) => {
  try {
    await prisma.account.delete({
      where: { id: req.params.id }
    });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
