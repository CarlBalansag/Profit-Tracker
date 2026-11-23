const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { dashboardPreferences } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
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

// How much tax math the tax pages show: 'simple' (default) or 'detailed'.
router.get('/tax-math', isAuthenticated, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const value = parsePreferences(user?.accounting_preferences).taxMath;
    res.json({ taxMath: value === 'detailed' ? 'detailed' : 'simple' });
  } catch (error) { next(error); }
});
router.put('/tax-math', isAuthenticated, async (req, res, next) => {
  try {
    const value = req.body?.taxMath;
    if (!['simple', 'detailed'].includes(value) || Object.keys(req.body).length !== 1) return res.status(400).json({ error: 'taxMath must be simple or detailed' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const preferences = { ...parsePreferences(user?.accounting_preferences), taxMath: value };
    await prisma.user.update({ where: { id: req.user.id }, data: { accounting_preferences: JSON.stringify(preferences) } });
    res.json({ taxMath: value });
  } catch (error) { next(error); }
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
    const before = await prisma.user.findUnique({ where: { id: req.user.id }, select: { schedule_c_enabled: true } });
    await prisma.user.update({ where: { id: req.user.id }, data: { schedule_c_enabled: req.body.enabled } });
    // Log-only: turning it back is the same switch. Dashboard layout changes
    // are not logged; they save on every tweak and are display-only.
    if ((before?.schedule_c_enabled === true) !== req.body.enabled) {
      await require('../services/activityLog').recordEvent(req.user.id, {
        recordType: 'setting', action: 'schedule_c', name: 'Schedule C', detail: { enabled: req.body.enabled },
      });
    }
    res.json({ enabled: req.body.enabled });
  } catch (error) { next(error); }
});

module.exports = router;
