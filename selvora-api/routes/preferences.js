const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

function parsePreferences(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStyle(style) {
  return style === 'glassmorphism-brown' ? style : 'neon-dark';
}

router.get('/dashboard-settings/:style', isAuthenticated, async (req, res) => {
  try {
    const style = normalizeStyle(req.params.style);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const preferences = parsePreferences(user?.accounting_preferences);
    res.json({ settings: preferences.dashboardSettings?.[style] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/dashboard-settings/:style', isAuthenticated, async (req, res) => {
  try {
    const style = normalizeStyle(req.params.style);
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings object required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const preferences = parsePreferences(user?.accounting_preferences);
    const nextPreferences = {
      ...preferences,
      dashboardSettings: {
        ...(preferences.dashboardSettings || {}),
        [style]: settings,
      },
    };

    await prisma.user.update({
      where: { id: req.user.id },
      data: { accounting_preferences: JSON.stringify(nextPreferences) },
    });

    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
