import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Never fall back to the application's configured database. CI supplies a
// disposable loopback database explicitly; absent configuration means skipped.
const databaseUrl = process.env.QA_DATABASE_URL;
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/selvora_qa') {
    throw new Error('QA_DATABASE_URL must use a local disposable selvora_qa database');
  }
}
const require = createRequire(import.meta.url);
let prisma; let server; let baseUrl; let owner; let inventory;
const originalEnvironment = { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL };
const originalModules = new Map();
const request = async (method, route, body, authenticated = true) => {
  const response = await fetch(`${baseUrl}${route}`, { method,
    headers: { 'Content-Type': 'application/json', 'X-QA-Authenticated': String(authenticated) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};

describe.skipIf(!databaseUrl)('native PostgreSQL API integration', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.DIRECT_URL = databaseUrl;
    for (const module of ['../prisma', '../services/calendarFeed', '../services/ownership', '../services/transactionEdit', '../routes/sales', '../routes/inventory', '../routes/recurringExpenses', '../routes/expenses', '../routes/preferences', '../routes/scheduleC']) {
      const modulePath = require.resolve(module);
      originalModules.set(modulePath, require.cache[modulePath]);
      delete require.cache[modulePath];
    }
    prisma = require('../prisma');
    // Publishing is outside database QA and must not contact Cloudinary.
    require.cache[require.resolve('../services/calendarFeed')] = { exports: { publishCalendarFeed: async () => null } };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: owner }; req.isAuthenticated = () => req.headers['x-qa-authenticated'] !== 'false'; next(); });
    app.use('/api/sales', require('../routes/sales'));
    app.use('/api/inventory', require('../routes/inventory'));
    app.use('/api/recurring-expenses', require('../routes/recurringExpenses'));
    app.use('/api/expenses', require('../routes/expenses'));
    app.use('/api/preferences', require('../routes/preferences'));
    app.use('/api/schedule-c', require('../routes/scheduleC'));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  beforeEach(async () => {
    owner = randomUUID();
    await prisma.user.create({ data: { id: owner, email: `${owner}@qa.invalid` } });
    inventory = await prisma.inventory.create({ data: { user_id: owner, product_name: 'Native QA fixture', purchase_date: new Date(), unit_purchase_cost: 0.29, qty_purchased: 1, qty_on_hand: 1 } });
  });
  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    for (const [modulePath, original] of originalModules) {
      if (original) require.cache[modulePath] = original;
      else delete require.cache[modulePath];
    }
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('permits exactly one of two concurrent stock claims and conserves quantity', async () => {
    const payload = { inventory_id: inventory.id, quantity: 1, unit_price: '0.50' };
    const results = await Promise.all([request('POST', '/api/sales', payload), request('POST', '/api/sales', payload)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    const stored = await prisma.inventory.findUnique({ where: { id: inventory.id }, include: { sales: true } });
    expect(stored.qty_on_hand).toBe(0);
    expect(stored.sales).toHaveLength(1);
    expect(stored.qty_on_hand + stored.sales.reduce((n, s) => n + s.quantity, 0)).toBe(stored.qty_purchased);
    expect(stored.unit_purchase_cost_decimal.toFixed(2)).toBe('0.29');
    expect(stored.sales[0].unit_price_decimal.toFixed(2)).toBe('0.50');
  });
  it('rolls back a conditional stock claim when the following database write fails', async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.inventory.updateMany({ where: { id: inventory.id, qty_on_hand: { gte: 1 } }, data: { qty_on_hand: { decrement: 1 } } });
      await tx.sales.create({ data: { inventory_id: 'missing-record', quantity: 1, unit_price: 1, sale_date: new Date() } });
    })).rejects.toThrow();
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).qty_on_hand).toBe(1);
    expect(await prisma.sales.count({ where: { inventory_id: inventory.id } })).toBe(0);
    expect((await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 1 })).status).toBe(200);
  });
  it('rejects a conflicting quantity edit against the same stale sale version', async () => {
    await prisma.inventory.update({ where: { id: inventory.id }, data: { qty_purchased: 5, qty_on_hand: 3 } });
    const sale = await prisma.sales.create({ data: { inventory_id: inventory.id, quantity: 2, unit_price: 1, sale_date: new Date() } });
    const originalRead = prisma.sales.findUnique;
    let reads = 0; let release;
    const bothRead = new Promise(resolve => { release = resolve; });
    prisma.sales.findUnique = async args => {
      const result = await originalRead.call(prisma.sales, args);
      if (args.include?.inventory) { if (++reads === 2) release(); await bothRead; }
      return result;
    };
    let responses;
    try { responses = await Promise.all([request('PUT', `/api/sales/${sale.id}`, { quantity: 3 }), request('PUT', `/api/sales/${sale.id}`, { quantity: 3 })]); }
    finally { prisma.sales.findUnique = originalRead; }
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const stored = await prisma.inventory.findUnique({ where: { id: inventory.id }, include: { sales: true } });
    expect(stored.qty_on_hand).toBe(2);
    expect(stored.sales[0].quantity).toBe(3);
  });
  it('rejects foreign and unauthenticated inventory without writes', async () => {
    const foreignOwner = randomUUID();
    await prisma.user.create({ data: { id: foreignOwner, email: `${foreignOwner}@qa.invalid` } });
    const foreign = await prisma.inventory.create({ data: { user_id: foreignOwner, product_name: 'Foreign', purchase_date: new Date(), unit_purchase_cost: 1, qty_purchased: 1, qty_on_hand: 1 } });
    expect((await request('POST', '/api/sales', { inventory_id: foreign.id, quantity: 1, unit_price: 2 })).status).toBe(404);
    expect((await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 2 }, false)).status).toBe(401);
    expect(await prisma.sales.count({ where: { inventory_id: { in: [inventory.id, foreign.id] } } })).toBe(0);
  });
  it('preserves a sale committed after a purchase-quantity edit read and supports a fresh retry', async () => {
    const originalRead = prisma.inventory.findUnique;
    let readDone; let resume;
    const read = new Promise(resolve => { readDone = resolve; });
    const paused = new Promise(resolve => { resume = resolve; });
    prisma.inventory.findUnique = async args => {
      const result = await originalRead.call(prisma.inventory, args);
      if (args.include?.sales?.select) { readDone(); await paused; }
      return result;
    };
    try {
      const pending = request('PUT', `/api/inventory/${inventory.id}`, { qty_purchased: 2 });
      await read;
      expect((await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 1 })).status).toBe(200);
      resume();
      expect((await pending).status).toBe(409);
    } finally { resume(); prisma.inventory.findUnique = originalRead; }
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).qty_on_hand).toBe(0);
    expect((await request('PUT', `/api/inventory/${inventory.id}`, { qty_purchased: 2 })).status).toBe(200);
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).qty_on_hand).toBe(1);
  });
  it('rolls back an expanded edit when a later sale violates the database contract', async () => {
    const created = await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 1 });
    expect(created.status).toBe(200);
    const body = { inventory: { unit_purchase_cost: '0.50' }, sales: [{ id: created.body.id, status: null }] };
    expect((await request('PUT', `/api/inventory/${inventory.id}/transaction`, body)).status).toBe(500);
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).unit_purchase_cost_decimal.toFixed(2)).toBe('0.29');
    body.sales[0].status = 'PAID';
    expect((await request('PUT', `/api/inventory/${inventory.id}/transaction`, body)).status).toBe(200);
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).unit_purchase_cost_decimal.toFixed(2)).toBe('0.50');
  });
  it('generates month-end occurrences once under concurrent requests and preserves them on pause/resume', async () => {
    const recurring = await prisma.recurringExpense.create({ data: { user_id: owner, name: 'Native month-end fixture', amount: 0.29, frequency: 'monthly', start_date: new Date('2026-01-31T12:00:00Z'), end_date: new Date('2026-04-30T12:00:00Z'), active: true } });
    const responses = await Promise.all([request('GET', '/api/recurring-expenses'), request('GET', '/api/recurring-expenses')]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const entries = await prisma.expense.findMany({ where: { recurring_expense_id: recurring.id }, orderBy: { date: 'asc' } });
    expect(entries.map(e => e.date.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(entries.map(e => e.amount_decimal.toFixed(2))).toEqual(['0.29', '0.29', '0.29', '0.29']);
    expect((await request('PUT', `/api/recurring-expenses/${recurring.id}`, { active: false })).status).toBe(200);
    expect((await request('PUT', `/api/recurring-expenses/${recurring.id}`, { active: true })).status).toBe(200);
    expect(await prisma.expense.count({ where: { recurring_expense_id: recurring.id } })).toBe(4);
  });
  it('restores stock once when concurrent requests delete the same sale', async () => {
    const created = await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 1 });
    const results = await Promise.all([request('DELETE', `/api/sales/${created.body.id}`), request('DELETE', `/api/sales/${created.body.id}`)]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect([404, 409]).toContain(results.find(r => r.status !== 200).status);
    expect((await prisma.inventory.findUnique({ where: { id: inventory.id } })).qty_on_hand).toBe(1);
    expect(await prisma.sales.count({ where: { inventory_id: inventory.id } })).toBe(0);
  });
  it('persists expense tax JSON and user opt-in, isolates owners and keeps precise worksheet adjustments separate', async () => {
    expect((await request('GET', '/api/schedule-c?year=2026')).status).toBe(403);
    expect((await request('PUT', '/api/preferences/schedule-c', { enabled: true })).status).toBe(200);
    const tax = { business_use: 'mixed', business_percent: '80', payee: 'Native fixture packing store', purpose: 'Pack customer orders', tax_category: 'SUPPLIES', payment_status: 'paid', paid_date: '2026-01-01', payment_reference: 'Fixture statement, item 1', reviewed: true };
    const created = await request('POST', '/api/expenses', { name: 'Native packing fixture', amount: '25.00', date: '2025-12-30', tax_details: tax });
    expect(created.status).toBe(200);
    const stored = await prisma.expense.findUnique({ where: { id: created.body.id } });
    expect(stored.tax_details).toEqual(tax); expect(stored.amount_decimal.toFixed(2)).toBe('25.00');
    const foreignOwner = await prisma.user.create({ data: { email: `${randomUUID()}@qa.invalid` } });
    const foreign = await prisma.expense.create({ data: { user_id: foreignOwner.id, name: 'Private native expense', amount: 999, date: new Date(), tax_details: tax } });
    const worksheet = await request('GET', '/api/schedule-c?year=2026');
    expect(worksheet.body.total).toBe('20.00'); expect(worksheet.body.rows).toHaveLength(1);
    expect((await request('PUT', `/api/expenses/${foreign.id}`, { tax_details: tax })).status).toBe(404);
    expect((await request('PUT', `/api/expenses/${created.body.id}`, { notes: 'Keep tax details' })).status).toBe(200);
    expect((await prisma.expense.findUnique({ where: { id: created.body.id } })).tax_details).toEqual(tax);
    await request('PUT', `/api/expenses/${created.body.id}`, { amount: '30.00' });
    expect((await request('PUT', `/api/expenses/${created.body.id}`, { tax_details: tax, expected_tax_version: 0 })).status).toBe(409);
    expect((await request('GET', '/api/schedule-c?year=2026')).body.total).toBe('0.00');
    await request('PUT', '/api/preferences/schedule-c', { enabled: false });
    expect((await prisma.expense.findUnique({ where: { id: created.body.id } })).amount_decimal.toFixed(2)).toBe('30.00');
  });
  it('rejects a simultaneous expense edit or review against the same stale version', async () => {
    const created = await request('POST', '/api/expenses', { name: 'Native review race', amount: '25.00', date: '2026-01-01' });
    const tax = { business_use: 'business', business_percent: '100', payee: 'QA', purpose: 'Business packing', tax_category: 'SUPPLIES', payment_status: 'paid', paid_date: '2026-01-01', payment_reference: 'Fixture payment 1', reviewed: true };
    const originalRead = prisma.expense.findUnique;
    let reads = 0, release;
    const bothRead = new Promise(resolve => { release = resolve; });
    prisma.expense.findUnique = async args => {
      const value = await originalRead.call(prisma.expense, args);
      if (args.where.id === created.body.id && reads < 2) { if (++reads === 2) release(); await bothRead; }
      return value;
    };
    let results;
    try { results = await Promise.all([request('PUT', `/api/expenses/${created.body.id}`, { amount: '30.00' }), request('PUT', `/api/expenses/${created.body.id}`, { tax_details: tax, expected_tax_version: 0 })]); }
    finally { prisma.expense.findUnique = originalRead; }
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const stored = await prisma.expense.findUnique({ where: { id: created.body.id } });
    expect(stored.tax_version).toBe(1);
    if (stored.tax_details?.reviewed) expect(stored.amount_decimal.toFixed(2)).toBe('25.00');
    else expect(stored.amount_decimal.toFixed(2)).toBe('30.00');
  });
});
