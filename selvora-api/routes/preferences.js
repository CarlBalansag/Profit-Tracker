const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { dashboardPreferences } = require('../validation/schemas');

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

router.get('/dashboard-settings/:style', isAuthenticated, async (req, res, next) => {
  try {
    const style = normalizeStyle(req.params.style);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const preferences = parsePreferences(user?.accounting_preferences);
    res.json({ settings: preferences.dashboardSettings?.[style] || null });
  } catch (err) {
    next(err);
  }
});

router.put('/dashboard-settings/:style', isAuthenticated, validateBody(dashboardPreferences), async (req, res, next) => {
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
    next(err);
  }
});

router.get('/schedule-c', isAuthenticated, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { schedule_c_enabled: true } });
    res.json({ enabled: user?.schedule_c_enabled === true });
  } catch (error) { next(error); }
});
router.put('/schedule-c', isAuthenticated, async (req, res, next) => {
  try {
    if (!req.body || Array.isArray(req.body) || typeof req.body.enabled !== 'boolean' || Object.keys(req.body).some(key => key !== 'enabled')) return res.status(400).json({ error: 'enabled must be a boolean' });
    await prisma.user.update({ where: { id: req.user.id }, data: { schedule_c_enabled: req.body.enabled } });
    res.json({ enabled: req.body.enabled });
  } catch (error) { next(error); }
});

module.exports = router;
