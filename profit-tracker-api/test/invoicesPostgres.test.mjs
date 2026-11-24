// Invoices against a real (throwaway) Postgres with every migration applied:
// building an invoice from a buyer's sales, totals to the cent, numbering,
// one invoice per sale, ownership, status changes, edits and deletes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const ME = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const MISSING = '00000000-0000-4000-8000-00000000dead';
let pg;
let db;
let server;
let baseUrl;
let currentUser = ME;
let buyer;
let otherBuyer;
let secondBuyer;
let sales;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

async function addSale(userId, buyerId, name, { quantity = 1, unitPrice = 100, tax = 0, date = '2026-11-01', ...extra } = {}) {
  const purchase = await db.inventory.create({
    data: { user_id: userId, product_name: name, purchase_date: new Date('2026-10-01T12:00:00Z'), unit_purchase_cost: 50, qty_purchased: quantity, qty_on_hand: 0, receiving_status: 'ON_HAND' },
  });
  return db.sales.create({
    data: { inventory_id: purchase.id, buyer_id: buyerId, quantity, unit_price: unitPrice, sale_tax_collected: tax, sale_date: new Date(`${date}T12:00:00Z`), status: 'SOLD', ...extra },
  });
}

const draft = (saleIds, extra = {}) => ({ buyer_id: buyer.id, sale_ids: saleIds, issue_date: '2026-11-10', due_date: '2026-11-24', ...extra });

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-invoices-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('invoices_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/invoices_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = currentUser ? { id: currentUser } : null; next(); });
  app.use('/api/invoices', require('../routes/invoices'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 180000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  currentUser = ME;
  await db.$executeRaw`TRUNCATE "User" CASCADE`;
  await db.user.create({ data: { id: ME, username: 'invoice-qa', email: 'invoice-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'invoice-qa-2', email: 'invoice-qa-2@example.invalid' } });
  buyer = await db.buyer.create({ data: { user_id: ME, name: 'Wholesale Co' } });
  secondBuyer = await db.buyer.create({ data: { user_id: ME, name: 'Second Buyer' } });
  otherBuyer = await db.buyer.create({ data: { user_id: OTHER, name: 'Not Mine' } });
  sales = {
    console: await addSale(ME, buyer.id, 'PS5 Pro', { quantity: 3, unitPrice: 33.33, tax: 8.25, date: '2026-11-03' }),
    tablet: await addSale(ME, buyer.id, 'iPad Air', { quantity: 1, unitPrice: 640, date: '2026-11-05' }),
    cancelled: await addSale(ME, buyer.id, 'Cancelled Thing', { cancelled_at: new Date() }),
    voided: await addSale(ME, buyer.id, 'Voided Thing', { voided_at: new Date() }),
    second: await addSale(ME, secondBuyer.id, 'For Second Buyer'),
    foreign: await addSale(OTHER, otherBuyer.id, 'Other user sale'),
  };
});

describe('billable sales', () => {
  it('lists the buyer\'s standing sales, newest first, and leaves out cancelled, voided and other buyers\'', async () => {
    const res = await request('GET', `/api/invoices/billable?buyer_id=${buyer.id}`);
    expect(res.status).toBe(200);
    expect(res.body.map((sale) => sale.description)).toEqual(['iPad Air', 'PS5 Pro']);
    expect(res.body[1]).toMatchObject({ sale_id: sales.console.id, quantity: 3, unit_price: 33.33, amount: 99.99, tax: 8.25, sale_date: '2026-11-03' });
  });

  it('refuses another user\'s buyer and a malformed id', async () => {
    expect((await request('GET', `/api/invoices/billable?buyer_id=${otherBuyer.id}`)).status).toBe(404);
    expect((await request('GET', '/api/invoices/billable?buyer_id=nope')).status).toBe(404);
    expect((await request('GET', '/api/invoices/billable')).status).toBe(404);
  });
});

describe('creating an invoice', () => {
  it('copies the sales as lines, totals them to the cent with tax, and numbers invoices 1, 2, …', async () => {
    const res = await request('POST', '/api/invoices', draft([sales.console.id, sales.tablet.id], { notes: ' Net 14 ' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: 1, status: 'DRAFT', overdue: false, buyer_id: buyer.id, buyer_name: 'Wholesale Co',
      issue_date: '2026-11-10', due_date: '2026-11-24', notes: 'Net 14',
      subtotal: 739.99, tax: 8.25, total: 748.24,
    });
    expect(res.body.lines.map((line) => [line.description, line.quantity, line.unit_price, line.amount])).toEqual([
      ['PS5 Pro', 3, 33.33, 99.99],
      ['iPad Air', 1, 640, 640],
    ]);
    const row = await db.invoice.findUnique({ where: { id: res.body.id } });
    expect(Number(row.total_amount_decimal)).toBe(748.24);
    expect(row.total_amount).toBe(748.24);
    expect(Number(row.tax_amount)).toBe(8.25);

    // Both sales are now taken; a third invoice for another buyer gets number 2.
    expect((await request('GET', `/api/invoices/billable?buyer_id=${buyer.id}`)).body).toEqual([]);
    const next = await request('POST', '/api/invoices', { ...draft([sales.second.id]), buyer_id: secondBuyer.id });
    expect(next.body.number).toBe(2);
  });

  it('keeps the invoice as issued when the sale changes or is deleted later', async () => {
    const created = (await request('POST', '/api/invoices', draft([sales.tablet.id]))).body;
    await db.sales.update({ where: { id: sales.tablet.id }, data: { unit_price: 1, unit_price_decimal: 1 } });
    expect((await request('GET', `/api/invoices/${created.id}`)).body.total).toBe(640);
    await db.sales.delete({ where: { id: sales.tablet.id } });
    const after = (await request('GET', `/api/invoices/${created.id}`)).body;
    expect(after.total).toBe(640);
    expect(after.lines[0]).toMatchObject({ description: 'iPad Air', sale_id: null });
  });

  it('refuses a sale that is already invoiced, cancelled, voided, to another buyer, or not the user\'s', async () => {
    expect((await request('POST', '/api/invoices', draft([sales.console.id]))).status).toBe(201);
    const refused = await Promise.all([
      request('POST', '/api/invoices', draft([sales.console.id])),
      request('POST', '/api/invoices', draft([sales.cancelled.id])),
      request('POST', '/api/invoices', draft([sales.voided.id])),
      request('POST', '/api/invoices', draft([sales.second.id])),
      request('POST', '/api/invoices', draft([sales.foreign.id])),
      request('POST', '/api/invoices', draft([MISSING])),
      request('POST', '/api/invoices', { ...draft([sales.tablet.id]), buyer_id: otherBuyer.id }),
    ]);
    expect(refused.map((res) => res.status)).toEqual([409, 400, 400, 400, 404, 404, 404]);
    // Nothing half-made: still the one invoice, and the tablet is still free.
    expect(await db.invoice.count()).toBe(1);
    expect(await db.invoiceLine.count()).toBe(1);
    expect((await request('GET', `/api/invoices/billable?buyer_id=${buyer.id}`)).body.map((sale) => sale.description)).toEqual(['iPad Air']);
  });

  it('rejects bad input: no sales, bad dates, due before issue, unknown fields', async () => {
    const bad = await Promise.all([
      request('POST', '/api/invoices', draft([])),
      request('POST', '/api/invoices', draft([sales.tablet.id], { issue_date: '2026-02-30' })),
      request('POST', '/api/invoices', draft([sales.tablet.id], { due_date: '2026-11-01' })),
      request('POST', '/api/invoices', draft([sales.tablet.id], { total: 5 })),
      request('POST', '/api/invoices', { ...draft([sales.tablet.id]), buyer_id: 'nope' }),
      request('POST', '/api/invoices', {}),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await db.invoice.count()).toBe(0);
  });

  it('gives two invoices saved at the same moment different numbers', async () => {
    const [a, b] = await Promise.all([
      request('POST', '/api/invoices', draft([sales.console.id])),
      request('POST', '/api/invoices', draft([sales.tablet.id])),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.number, b.body.number].sort()).toEqual([1, 2]);
  });

  it('lets only one of two invoices claim the same sale at the same moment', async () => {
    const results = await Promise.all([
      request('POST', '/api/invoices', draft([sales.tablet.id])),
      request('POST', '/api/invoices', draft([sales.tablet.id])),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await db.invoiceLine.count({ where: { sale_id: sales.tablet.id } })).toBe(1);
    expect(await db.invoice.count()).toBe(1);
  });
});

describe('reading invoices', () => {
  it('lists only the signed-in user\'s invoices and hides another user\'s by id', async () => {
    const mine = (await request('POST', '/api/invoices', draft([sales.tablet.id]))).body;
    currentUser = OTHER;
    expect((await request('GET', '/api/invoices')).body).toEqual([]);
    expect((await request('GET', `/api/invoices/${mine.id}`)).status).toBe(404);
    expect((await request('PUT', `/api/invoices/${mine.id}`, { status: 'PAID' })).status).toBe(404);
    expect((await request('DELETE', `/api/invoices/${mine.id}`)).status).toBe(404);
    currentUser = ME;
    expect((await request('GET', '/api/invoices')).body.map((invoice) => invoice.id)).toEqual([mine.id]);
    currentUser = null;
    expect((await request('GET', '/api/invoices')).status).toBe(401);
  });

  it('marks a sent invoice past its due date overdue, not a draft or paid one', async () => {
    const created = (await request('POST', '/api/invoices', draft([sales.tablet.id], { issue_date: '2026-01-01', due_date: '2026-01-15' }))).body;
    expect(created.overdue).toBe(false);
    expect((await request('PUT', `/api/invoices/${created.id}`, { status: 'SENT' })).body.overdue).toBe(true);
    expect((await request('PUT', `/api/invoices/${created.id}`, { status: 'PAID' })).body.overdue).toBe(false);
  });
});

describe('changing an invoice', () => {
  it('edits dates and notes without touching the lines, and omitting a field leaves it alone', async () => {
    const created = (await request('POST', '/api/invoices', draft([sales.console.id], { notes: 'Keep me' }))).body;
    const edited = await request('PUT', `/api/invoices/${created.id}`, { due_date: '2026-12-01' });
    expect(edited.body).toMatchObject({ issue_date: '2026-11-10', due_date: '2026-12-01', notes: 'Keep me', total: 108.24 });
    expect((await request('PUT', `/api/invoices/${created.id}`, { notes: '' })).body.notes).toBeNull();
    expect((await request('PUT', `/api/invoices/${created.id}`, { due_date: '2026-11-01' })).status).toBe(400);
    expect((await request('PUT', `/api/invoices/${created.id}`, {})).status).toBe(400);
    expect((await request('PUT', `/api/invoices/${created.id}`, { status: 'LOST' })).status).toBe(400);
  });

  it('swaps a draft\'s sales and retotals; a sent invoice\'s sales are locked', async () => {
    const created = (await request('POST', '/api/invoices', draft([sales.console.id]))).body;
    // While editing a draft its own sales are still offered.
    const offered = await request('GET', `/api/invoices/billable?buyer_id=${buyer.id}&invoice_id=${created.id}`);
    expect(offered.body.map((sale) => sale.description)).toEqual(['iPad Air', 'PS5 Pro']);
    const swapped = await request('PUT', `/api/invoices/${created.id}`, { sale_ids: [sales.tablet.id] });
    expect(swapped.body).toMatchObject({ total: 640, tax: 0 });
    expect(swapped.body.lines).toHaveLength(1);
    expect(await db.invoiceLine.count()).toBe(1);

    await request('PUT', `/api/invoices/${created.id}`, { status: 'SENT' });
    expect((await request('PUT', `/api/invoices/${created.id}`, { sale_ids: [sales.console.id] })).status).toBe(409);
    expect((await request('GET', `/api/invoices/${created.id}`)).body.total).toBe(640);
  });

  it('frees the sales when cancelled, and only reopens if they are still free', async () => {
    const first = (await request('POST', '/api/invoices', draft([sales.tablet.id]))).body;
    await request('PUT', `/api/invoices/${first.id}`, { status: 'CANCELLED' });
    const second = await request('POST', '/api/invoices', draft([sales.tablet.id]));
    expect(second.status).toBe(201);
    expect((await request('PUT', `/api/invoices/${first.id}`, { status: 'DRAFT' })).status).toBe(409);
    await request('DELETE', `/api/invoices/${second.body.id}`);
    expect((await request('PUT', `/api/invoices/${first.id}`, { status: 'DRAFT' })).body.status).toBe('DRAFT');
  });

  it('deletes an invoice with its lines, leaves the sales alone, and never reuses a live number', async () => {
    const first = (await request('POST', '/api/invoices', draft([sales.console.id]))).body;
    const second = (await request('POST', '/api/invoices', draft([sales.tablet.id]))).body;
    expect((await request('DELETE', `/api/invoices/${first.id}`)).body).toEqual({ deleted: true });
    expect(await db.invoiceLine.count()).toBe(1);
    expect(await db.sales.count({ where: { id: sales.console.id } })).toBe(1);
    expect((await request('DELETE', `/api/invoices/${first.id}`)).status).toBe(404);
    const third = (await request('POST', '/api/invoices', draft([sales.console.id]))).body;
    expect(third.number).toBe(second.number + 1);
  });

  it('does not mark the sales paid when the invoice is marked paid', async () => {
    const created = (await request('POST', '/api/invoices', draft([sales.tablet.id]))).body;
    await request('PUT', `/api/invoices/${created.id}`, { status: 'PAID' });
    const sale = await db.sales.findUnique({ where: { id: sales.tablet.id } });
    expect(sale.paid_at).toBeNull();
    expect(sale.status).toBe('SOLD');
  });
});
