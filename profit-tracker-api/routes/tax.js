// The user's own tax profile for a year (Schedule C tax estimate). Owner-only:
// every query is scoped to req.user.id, and no admin route reads these.
// The estimate itself runs in the browser (shared/tax), so a profile the user
// chooses not to save is never sent here.
const router = require('express').Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { taxProfileBody } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};
const validYear = (value) => typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 1900;
const YEAR_ERROR = 'Choose a four-digit tax year from 1900 to 9999';
const scheduleCEnabled = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { schedule_c_enabled: true } });
  return Boolean(user?.schedule_c_enabled);
};
const guard = async (req, res) => {
  if (!validYear(req.params.year)) { res.status(400).json({ error: YEAR_ERROR }); return false; }
  if (!await scheduleCEnabled(req.user.id)) { res.status(403).json({ error: 'Enable Schedule C in Settings first' }); return false; }
  return true;
};

const FIELDS = ['state', 'filing_status', 'non_business_income', 'wages', 'other_se_income', 'federal_withholding', 'state_withholding',
  'federal_estimated_paid', 'state_estimated_paid', 'qualifying_children', 'other_dependents', 'age65', 'spouse_age65',
  'adjustments', 'itemized_deductions', 'prior_year_tax', 'prior_year_agi', 'reserve_mode', 'flat_rate', 'buffer_rate'];
// Decimals as strings, the rest as stored.
const publicProfile = (row) => {
  if (!row) return null;
  const out = { year: row.year, updated_at: row.updated_at };
  for (const key of FIELDS) {
    const v = row[key];
    out[key] = v !== null && v !== undefined && typeof v === 'object' && !(v instanceof Date) ? String(v) : (v ?? null);
  }
  return out;
};

router.get('/profile/:year', isAuthenticated, async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const row = await prisma.taxProfile.findFirst({ where: { user_id: req.user.id, year: Number(req.params.year) } });
    res.json({ profile: publicProfile(row) });
  } catch (error) { next(error); }
});

router.put('/profile/:year', isAuthenticated, validateBody(taxProfileBody), async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const year = Number(req.params.year);
    // A full replace: anything left out is cleared, so the saved profile is
    // exactly what the form showed.
    const data = {};
    for (const key of FIELDS) data[key] = req.body[key] ?? null;
    data.age65 = req.body.age65 === true;
    data.spouse_age65 = req.body.spouse_age65 === true;
    data.reserve_mode = req.body.reserve_mode || 'personalized';
    const row = await prisma.taxProfile.upsert({
      where: { user_id_year: { user_id: req.user.id, year } },
      create: { user_id: req.user.id, year, ...data },
      update: data,
    });
    res.json({ profile: publicProfile(row) });
  } catch (error) { next(error); }
});

router.delete('/profile/:year', isAuthenticated, async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const result = await prisma.taxProfile.deleteMany({ where: { user_id: req.user.id, year: Number(req.params.year) } });
    res.json({ deleted: result.count });
  } catch (error) { next(error); }
});

module.exports = router;
