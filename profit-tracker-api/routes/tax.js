// The user's own tax profile for a year (Schedule C tax estimate). Owner-only:
// every query is scoped to req.user.id, and no admin route reads these.
// The estimate itself runs in the browser (shared/tax), so a profile the user
// chooses not to save is never sent here.
const router = require('express').Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { taxProfileBody, taxReserveEntryBody, taxPaymentBody } = require('../validation/schemas');
const { publishCalendarFeed } = require('../services/calendarFeed');

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
// The published calendar feed is rebuilt in the background; a failure there
// must never fail the save.
const refreshCalendar = (userId) => { Promise.resolve().then(() => publishCalendarFeed(userId)).catch(() => {}); };
const guard = async (req, res) => {
  if (!validYear(req.params.year)) { res.status(400).json({ error: YEAR_ERROR }); return false; }
  if (!await scheduleCEnabled(req.user.id)) { res.status(403).json({ error: 'Enable Schedule C in Settings first' }); return false; }
  return true;
};

// federal_estimated_paid / state_estimated_paid are no longer used: payments
// are recorded one by one (TaxPayment).
const FIELDS = ['state', 'filing_status', 'non_business_income', 'wages', 'other_se_income', 'federal_withholding', 'state_withholding',
  'qualifying_children', 'other_dependents', 'age65', 'spouse_age65',
  'adjustments', 'itemized_deductions', 'prior_year_tax', 'prior_year_agi', 'reserve_mode', 'flat_rate', 'buffer_rate',
  'forecast_method', 'profit_target'];
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
    // Tax deadlines in the calendar feed follow the state of residence.
    refreshCalendar(req.user.id);
    res.json({ profile: publicProfile(row) });
  } catch (error) { next(error); }
});

router.delete('/profile/:year', isAuthenticated, async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const result = await prisma.taxProfile.deleteMany({ where: { user_id: req.user.id, year: Number(req.params.year) } });
    refreshCalendar(req.user.id);
    res.json({ deleted: result.count });
  } catch (error) { next(error); }
});

// Tax reserve ledger: money the user set aside for a year's taxes, or took
// back. Their own savings record; it never touches profit or expenses.
const cents = (v) => Math.round(Number(v) * 100);
const publicEntry = (e) => ({ id: e.id, year: e.year, kind: e.kind, amount: String(e.amount), date: new Date(e.date).toISOString().slice(0, 10), note: e.note ?? null });
const ledger = async (client, userId, year) => {
  const entries = await client.taxReserveEntry.findMany({ where: { user_id: userId, year }, orderBy: [{ date: 'desc' }, { created_at: 'desc' }] });
  const set = entries.filter((e) => e.kind === 'set_aside').reduce((s, e) => s + cents(e.amount), 0);
  const released = entries.filter((e) => e.kind === 'released').reduce((s, e) => s + cents(e.amount), 0);
  return { entries: entries.map(publicEntry), setAside: (set / 100).toFixed(2), released: (released / 100).toFixed(2), balance: ((set - released) / 100).toFixed(2) };
};

router.get('/reserves/:year', isAuthenticated, async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    res.json(await ledger(prisma, req.user.id, Number(req.params.year)));
  } catch (error) { next(error); }
});

router.post('/reserves/:year', isAuthenticated, validateBody(taxReserveEntryBody), async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const year = Number(req.params.year);
    const result = await prisma.$transaction(async (tx) => {
      // One writer per user at a time, so two releases can't both pass the
      // balance check.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
      if (req.body.kind === 'released') {
        const { balance } = await ledger(tx, req.user.id, year);
        if (cents(req.body.amount) > cents(balance)) {
          throw Object.assign(new Error(`You can't take back more than the $${balance} set aside for ${year}.`), { status: 400 });
        }
      }
      await tx.taxReserveEntry.create({ data: {
        user_id: req.user.id, year, kind: req.body.kind, amount: req.body.amount,
        date: new Date(`${req.body.date}T12:00:00Z`), note: req.body.note ?? null,
      } });
      return ledger(tx, req.user.id, year);
    });
    res.status(201).json(result);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

router.delete('/reserves/entry/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
      const entry = await tx.taxReserveEntry.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
      if (!entry) throw Object.assign(new Error('Entry not found'), { status: 404 });
      // Removing money set aside can't leave more taken back than put in.
      if (entry.kind === 'set_aside') {
        const { balance } = await ledger(tx, req.user.id, entry.year);
        if (cents(balance) - cents(entry.amount) < 0) {
          throw Object.assign(new Error('Delete the money you took back first; otherwise more would be taken back than was set aside.'), { status: 400 });
        }
      }
      await tx.taxReserveEntry.deleteMany({ where: { id: entry.id, user_id: req.user.id } });
      return ledger(tx, req.user.id, entry.year);
    });
    res.json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 404) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Tax payments: estimated (quarterly), extension or other payments toward a
// tax year, to the IRS or a state. Owner-only, like everything here.
const publicPayment = (p) => ({ id: p.id, year: p.year, jurisdiction: p.jurisdiction, period: p.period, amount: String(p.amount), paid_date: new Date(p.paid_date).toISOString().slice(0, 10), reference: p.reference ?? null });
const paymentList = async (userId, year) => {
  const rows = await prisma.taxPayment.findMany({ where: { user_id: userId, year }, orderBy: [{ paid_date: 'desc' }, { created_at: 'desc' }] });
  return { payments: rows.map(publicPayment) };
};

router.get('/payments/:year', isAuthenticated, async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    res.json(await paymentList(req.user.id, Number(req.params.year)));
  } catch (error) { next(error); }
});

router.post('/payments/:year', isAuthenticated, validateBody(taxPaymentBody), async (req, res, next) => {
  try {
    if (!await guard(req, res)) return;
    const year = Number(req.params.year);
    await prisma.taxPayment.create({ data: {
      user_id: req.user.id, year, jurisdiction: req.body.jurisdiction, period: req.body.period, amount: req.body.amount,
      paid_date: new Date(`${req.body.paid_date}T12:00:00Z`), reference: req.body.reference ?? null,
    } });
    res.status(201).json(await paymentList(req.user.id, year));
  } catch (error) { next(error); }
});

router.delete('/payments/entry/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const row = await prisma.taxPayment.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!row) return res.status(404).json({ error: 'Payment not found' });
    await prisma.taxPayment.deleteMany({ where: { id: row.id, user_id: req.user.id } });
    res.json(await paymentList(req.user.id, row.year));
  } catch (error) { next(error); }
});

module.exports = router;
