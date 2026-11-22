const router = require('express').Router();
const prisma = require('../prisma');
const { expenseWorksheet } = require('../services/scheduleC');
const { withExactList, MAPPINGS } = require('../services/decimalRead');
const { derivedExpenseLines } = require('../services/derivedExpenses');
const { scheduleCBooks, untrackedInventory } = require('../services/scheduleCBooks');
const { profitEvents, forecastInputs } = require('../services/taxForecast');
const { validateBody } = require('../middleware/validate');
const { taxYearSettingBody, createForm1099K, updateForm1099K, mileageTripBody, taxAssetBody, finalizeBody, TAX_YEAR_SETTING_KEYS } = require('../validation/schemas');
const deductionRules = import('../../shared/tax/deductions.mjs');
const { requireOwned } = require('../services/ownership');

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

// Everything the worksheet, the tax estimate and the year-end report are
// built from, for one user and tax year. `forecast: false` skips last year's
// books (the report doesn't need the projection).
async function loadScheduleC(userId, year, { forecast = true } = {}) {
  const [expenseRows, inventories, saleRefunds, settings, forms1099K, platforms, trips, assets, profile, emailLinks] = await Promise.all([
    prisma.expense.findMany({ where: { user_id: userId }, include: { payment_method: { select: { name: true } } } }),
    // Same source the Expenses tab's computed lines use, so the two never disagree.
    prisma.inventory.findMany({
      where: { user_id: userId },
      include: {
        sales: { include: { platform: { select: { id: true, name: true } }, sale_shipping_payment_method: { select: { id: true, name: true, type: true } } } },
        payment_method: { select: { id: true, name: true, type: true, default_cashback_rate: true, default_cashback_rate_decimal: true, category_rates: true } },
        vendor: { select: { name: true } },
      },
    }),
    prisma.refund.findMany({ where: { user_id: userId, sale_id: { not: null } }, include: { sale: true } }),
    prisma.taxYearSetting.findMany({ where: { user_id: userId, year: { lte: year } } }),
    prisma.taxForm1099K.findMany({ where: { user_id: userId, year }, orderBy: { created_at: 'asc' } }),
    // Where 1099-K forms come from: the places the user sells or cashes out.
    prisma.platform.findMany({ where: { user_id: userId, type: { in: ['Marketplace', 'Cashout'] } }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    // Last year's trips too, for last year's profit in the projection.
    prisma.taxMileageTrip.findMany({ where: { user_id: userId, date: { gte: new Date(Date.UTC(year - 1, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } }),
    prisma.taxAsset.findMany({ where: { user_id: userId } }),
    prisma.taxProfile.findFirst({ where: { user_id: userId, year }, select: { wages: true } }),
    // Expenses with a linked order or receipt email count as documented.
    prisma.emailMatch.findMany({ where: { user_id: userId, state: 'linked', record_type: 'expense' }, select: { record_ids: true } }),
  ]);
  const emailLinked = new Set(emailLinks.flatMap((m) => m.record_ids));
  const expenses = expenseRows.map((e) => (emailLinked.has(e.id) ? { ...e, email_linked: true } : e));
  const { MILEAGE_RATES } = await deductionRules;
  const recordsFor = (y) => ({
    trips, assets, mileageRates: MILEAGE_RATES,
    setting: settings.find((row) => row.year === y) || null,
    wages: y === year ? profile?.wages ?? 0 : 0,
  });
  const exactExpenses = withExactList(expenses, MAPPINGS.expense);
  const worksheet = await expenseWorksheet(exactExpenses, year, derivedExpenseLines(inventories), saleRefunds);
  const expensesInYear = exactExpenses.filter((e) => new Date(e.date).getUTCFullYear() === year);
  const untracked = untrackedInventory(settings, year);
  const books = scheduleCBooks({ inventories, year, worksheet, expensesInYear, untracked, forms1099K, platforms, records: recordsFor(year) });
  if (!forecast) return { worksheet, books, trips, assets };
  // Projection inputs: this year's dated profit and last year's pattern.
  const derived = derivedExpenseLines(inventories);
  const priorWorksheet = await expenseWorksheet(exactExpenses, year - 1, derived, saleRefunds);
  const priorEvents = profitEvents({ inventories, year: year - 1, worksheet: priorWorksheet, trips, mileageRates: MILEAGE_RATES });
  const priorBooks = priorEvents.length ? scheduleCBooks({ inventories, year: year - 1, worksheet: priorWorksheet, untracked: untrackedInventory(settings, year - 1), records: recordsFor(year - 1) }) : null;
  books.forecast = forecastInputs({
    year, today: new Date(), events: profitEvents({ inventories, year, worksheet, trips, mileageRates: MILEAGE_RATES }),
    priorEvents, priorNetProfit: priorBooks ? priorBooks.netProfit : null,
  });
  // Equipment and home office are taken once for the year: projections add
  // them back, project the rest, then take them off once.
  books.forecast.yearlyDeductions = books.records.yearly;
  return { worksheet, books, trips, assets };
}

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    if (!validYear(req.query.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const { worksheet, books } = await loadScheduleC(req.user.id, Number(req.query.year));
    // Private receipts go out as short-lived signed links.
    const { withReceiptLink } = require('../services/privateReceipts');
    const rows = worksheet.rows.map((row) => (row.source === 'manual' ? withReceiptLink(row, 'expense') : row));
    res.json({ ...worksheet, rows, books });
  } catch (error) { next(error); }
});

const DECIMAL_SETTINGS = new Set(['untracked_inventory_end', 'vehicle_commuting_miles', 'vehicle_other_miles']);
const publicYearSetting = (row) => {
  const out = { year: row.year };
  for (const key of TAX_YEAR_SETTING_KEYS) {
    const v = row[key];
    out[key] = v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : DECIMAL_SETTINGS.has(key) ? String(v) : v;
  }
  return out;
};

// Save one tax year's settings. Today that is the cost of stock on hand on
// December 31 that isn't entered as purchases; null clears it (the earlier
// year's amount then carries forward).
router.put('/years/:year', isAuthenticated, validateBody(taxYearSettingBody), async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const year = Number(req.params.year);
    const data = {};
    for (const key of TAX_YEAR_SETTING_KEYS) {
      if (req.body[key] === undefined) continue;
      data[key] = key === 'vehicle_in_service' && req.body[key] ? new Date(`${req.body[key]}T12:00:00Z`) : req.body[key];
    }
    const saved = await prisma.taxYearSetting.upsert({
      where: { user_id_year: { user_id: req.user.id, year } },
      create: { user_id: req.user.id, year, ...data },
      update: data,
    });
    res.json(publicYearSetting(saved));
  } catch (error) { next(error); }
});
// Form 1099-K amounts for a tax year, to compare with sales by platform.
const form1099KResponse = (form) => ({
  id: form.id, year: form.year, payer_name: form.payer_name, platform_id: form.platform_id,
  gross_amount: String(form.gross_amount), transaction_count: form.transaction_count,
});
const ownedForm = async (id, userId) => {
  const form = await prisma.taxForm1099K.findFirst({ where: { id, user_id: userId } });
  if (!form) throw Object.assign(new Error('1099-K not found'), { status: 404 });
  return form;
};

router.post('/years/:year/1099-k', isAuthenticated, validateBody(createForm1099K), async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    await requireOwned('platform', req.body.platform_id, req.user.id, 'Platform');
    const form = await prisma.taxForm1099K.create({ data: {
      user_id: req.user.id, year: Number(req.params.year), payer_name: req.body.payer_name,
      platform_id: req.body.platform_id || null, gross_amount: req.body.gross_amount, transaction_count: req.body.transaction_count ?? null,
    } });
    res.status(201).json(form1099KResponse(form));
  } catch (error) { next(error); }
});

router.put('/1099-k/:id', isAuthenticated, validateBody(updateForm1099K), async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    await ownedForm(req.params.id, req.user.id);
    await requireOwned('platform', req.body.platform_id, req.user.id, 'Platform');
    const data = {};
    for (const key of ['payer_name', 'platform_id', 'gross_amount', 'transaction_count']) if (req.body[key] !== undefined) data[key] = req.body[key];
    const result = await prisma.taxForm1099K.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data });
    if (result.count !== 1) return res.status(404).json({ error: '1099-K not found' });
    res.json(form1099KResponse(await ownedForm(req.params.id, req.user.id)));
  } catch (error) { next(error); }
});

router.delete('/1099-k/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const result = await prisma.taxForm1099K.deleteMany({ where: { id: req.params.id, user_id: req.user.id } });
    if (result.count !== 1) return res.status(404).json({ error: '1099-K not found' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// ── Mileage log (line 9) ───────────────────────────────────────────────────
const publicTrip = (t) => ({ id: t.id, date: new Date(t.date).toISOString().slice(0, 10), miles: String(t.miles), destination: t.destination, purpose: t.purpose, parking_tolls: t.parking_tolls === null || t.parking_tolls === undefined ? null : String(t.parking_tolls) });
const tripData = (body) => ({ date: new Date(`${body.date}T12:00:00Z`), miles: body.miles, destination: body.destination, purpose: body.purpose, parking_tolls: body.parking_tolls ?? null });
const tripList = async (userId, year) => {
  const rows = await prisma.taxMileageTrip.findMany({
    where: { user_id: userId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
  });
  return { year, trips: rows.map(publicTrip) };
};
const enabledOr403 = async (req, res) => {
  if (await scheduleCEnabled(req.user.id)) return true;
  res.status(403).json({ error: 'Enable Schedule C in Settings first' });
  return false;
};

router.get('/mileage', isAuthenticated, async (req, res, next) => {
  try {
    if (!validYear(req.query.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await enabledOr403(req, res)) return;
    res.json(await tripList(req.user.id, Number(req.query.year)));
  } catch (error) { next(error); }
});

router.post('/mileage', isAuthenticated, validateBody(mileageTripBody), async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    await prisma.taxMileageTrip.create({ data: { user_id: req.user.id, ...tripData(req.body) } });
    res.status(201).json(await tripList(req.user.id, Number(req.body.date.slice(0, 4))));
  } catch (error) { next(error); }
});

router.put('/mileage/:id', isAuthenticated, validateBody(mileageTripBody), async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    const result = await prisma.taxMileageTrip.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data: tripData(req.body) });
    if (result.count !== 1) return res.status(404).json({ error: 'Trip not found' });
    res.json(await tripList(req.user.id, Number(req.body.date.slice(0, 4))));
  } catch (error) { next(error); }
});

router.delete('/mileage/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    const row = await prisma.taxMileageTrip.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!row) return res.status(404).json({ error: 'Trip not found' });
    await prisma.taxMileageTrip.deleteMany({ where: { id: row.id, user_id: req.user.id } });
    res.json(await tripList(req.user.id, new Date(row.date).getUTCFullYear()));
  } catch (error) { next(error); }
});

// ── Equipment (lines 13 and 22) ─────────────────────────────────────────────
const { assetDeduction } = require('../services/scheduleCRecords');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const publicAsset = (a, year) => ({
  id: a.id, name: a.name, placed_in_service: day(a.placed_in_service), cost: String(a.cost), business_percent: a.business_percent,
  method: a.method, recovery_years: a.recovery_years ?? null, disposed_date: day(a.disposed_date),
  // This year's deduction before the Section 179 income limit.
  this_year: year ? assetDeduction(a, year).amount.toDecimalPlaces(2).toFixed(2) : null,
});
const assetData = (b) => ({
  name: b.name, placed_in_service: new Date(`${b.placed_in_service}T12:00:00Z`), cost: b.cost, business_percent: b.business_percent,
  method: b.method, recovery_years: b.method === 'macrs' ? b.recovery_years : null,
  disposed_date: b.disposed_date ? new Date(`${b.disposed_date}T12:00:00Z`) : null,
});
const assetList = async (userId, year) => {
  const rows = await prisma.taxAsset.findMany({ where: { user_id: userId }, orderBy: [{ placed_in_service: 'desc' }, { created_at: 'desc' }] });
  return { year, assets: rows.map((a) => publicAsset(a, year)) };
};
const listYear = (req) => (validYear(req.query.year) ? Number(req.query.year) : null);

router.get('/assets', isAuthenticated, async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    res.json(await assetList(req.user.id, listYear(req)));
  } catch (error) { next(error); }
});

router.post('/assets', isAuthenticated, validateBody(taxAssetBody), async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    await prisma.taxAsset.create({ data: { user_id: req.user.id, ...assetData(req.body) } });
    res.status(201).json(await assetList(req.user.id, listYear(req)));
  } catch (error) { next(error); }
});

router.put('/assets/:id', isAuthenticated, validateBody(taxAssetBody), async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    const result = await prisma.taxAsset.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data: assetData(req.body) });
    if (result.count !== 1) return res.status(404).json({ error: 'Equipment not found' });
    res.json(await assetList(req.user.id, listYear(req)));
  } catch (error) { next(error); }
});

router.delete('/assets/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    const result = await prisma.taxAsset.deleteMany({ where: { id: req.params.id, user_id: req.user.id } });
    if (result.count !== 1) return res.status(404).json({ error: 'Equipment not found' });
    res.json(await assetList(req.user.id, listYear(req)));
  } catch (error) { next(error); }
});

// ── Year-end report, finalize and revisions ────────────────────────────────
const { buildReport, reportHash, compareReports, rulesInUse, compareRules } = require('../services/scheduleCReport');

const snapshotMeta = (row) => ({
  id: row.id, year: row.year, revision: row.revision, reason: row.reason ?? null,
  created_at: new Date(row.created_at).toISOString(), hash: row.input_hash, rules: row.rules,
  net_profit: row.report?.part1?.find((l) => l.line === '31')?.amount ?? null,
});
const liveReport = async (userId, year) => {
  const { worksheet, books, trips, assets } = await loadScheduleC(userId, year, { forecast: false });
  const payments = await prisma.taxPayment.findMany({ where: { user_id: userId, year }, orderBy: { paid_date: 'asc' } });
  const { MILEAGE_RATES } = await deductionRules;
  const report = buildReport({ year, worksheet, books, trips, assets, payments });
  return { report, hash: reportHash(report), rules: rulesInUse({ year, worksheet, mileageRates: MILEAGE_RATES }) };
};
const latestSnapshot = async (userId, year) => (await prisma.taxReportSnapshot.findMany({ where: { user_id: userId, year }, orderBy: { revision: 'desc' }, take: 1 }))[0] || null;

// The live report, and how it compares with the latest finalized revision.
router.get('/years/:year/report', isAuthenticated, async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await enabledOr403(req, res)) return;
    const year = Number(req.params.year);
    const [live, latest] = await Promise.all([liveReport(req.user.id, year), latestSnapshot(req.user.id, year)]);
    res.json({
      ...live,
      finalized: latest ? snapshotMeta(latest) : null,
      changed: latest ? latest.input_hash !== live.hash : null,
      changes: latest ? compareReports(latest.report, live.report) : [],
      rulesChanged: latest ? compareRules(latest.rules, live.rules) : [],
    });
  } catch (error) { next(error); }
});

router.get('/years/:year/snapshots', isAuthenticated, async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await enabledOr403(req, res)) return;
    const rows = await prisma.taxReportSnapshot.findMany({ where: { user_id: req.user.id, year: Number(req.params.year) }, orderBy: { revision: 'desc' } });
    res.json({ snapshots: rows.map(snapshotMeta) });
  } catch (error) { next(error); }
});

router.get('/snapshots/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await enabledOr403(req, res)) return;
    const row = await prisma.taxReportSnapshot.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json({ ...snapshotMeta(row), report: row.report });
  } catch (error) { next(error); }
});

// Finalize the year (revision 1), or record a revision. Earlier revisions are
// never changed. expected_revision: the latest revision the person saw (0 for
// none), so two tabs can't both finalize over each other.
router.post('/years/:year/finalize', isAuthenticated, validateBody(finalizeBody), async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await enabledOr403(req, res)) return;
    const year = Number(req.params.year);
    const [live, latest] = await Promise.all([liveReport(req.user.id, year), latestSnapshot(req.user.id, year)]);
    const current = latest ? latest.revision : 0;
    if (req.body.expected_revision !== current) return res.status(409).json({ error: 'This year was finalized or revised somewhere else. Reload to see the latest revision.' });
    if (latest && !req.body.reason) return res.status(400).json({ error: 'Say what changed, so the history explains each revision.' });
    if (latest && latest.input_hash === live.hash) return res.status(409).json({ error: `Nothing has changed since revision ${latest.revision}.` });
    let row;
    try {
      row = await prisma.taxReportSnapshot.create({ data: {
        user_id: req.user.id, year, revision: current + 1, reason: req.body.reason || null,
        report: live.report, rules: live.rules, input_hash: live.hash, created_at: new Date(),
      } });
    } catch (error) {
      if (error.code === 'P2002') return res.status(409).json({ error: 'This year was finalized or revised somewhere else. Reload to see the latest revision.' });
      throw error;
    }
    res.status(201).json(snapshotMeta(row));
  } catch (error) { next(error); }
});

module.exports = router;
