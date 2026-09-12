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
    for (const module of ['../prisma', '../services/calendarFeed', '../services/ownership', '../routes/sales']) {
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
  it('rejects foreign and unauthenticated inventory without writes', async () => {
    const foreignOwner = randomUUID();
    await prisma.user.create({ data: { id: foreignOwner, email: `${foreignOwner}@qa.invalid` } });
    const foreign = await prisma.inventory.create({ data: { user_id: foreignOwner, product_name: 'Foreign', purchase_date: new Date(), unit_purchase_cost: 1, qty_purchased: 1, qty_on_hand: 1 } });
    expect((await request('POST', '/api/sales', { inventory_id: foreign.id, quantity: 1, unit_price: 2 })).status).toBe(404);
    expect((await request('POST', '/api/sales', { inventory_id: inventory.id, quantity: 1, unit_price: 2 }, false)).status).toBe(401);
    expect(await prisma.sales.count({ where: { inventory_id: { in: [inventory.id, foreign.id] } } })).toBe(0);
  });
});
