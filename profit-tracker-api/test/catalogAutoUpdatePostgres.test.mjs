// Catalog auto-update against real Postgres: the migrations, the Decimal sync
// trigger and the response's exact-Decimal fields all have to agree, which
// the in-memory harness can't show.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

let pg, prisma, server, base, user;

const freePort = async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
};

const call = async (method, path = '', body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe('catalog auto-update on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-cards-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('cards_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/cards_qa`;
    // migrate deploy (not db push) so the new migration and the Decimal
    // sync triggers are exactly what production gets.
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'cards-qa@example.test' } });

    // Load the router with this client standing in for ../prisma.
    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    process.env.CARD_CATALOG_SYNC = 'off';
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/payment-methods', require('../routes/paymentMethods.js'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/payment-methods`;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (pg) await pg.stop();
  });

  it('adds from the catalog, then follows a catalog change with correct dollar rates', async () => {
    const added = await call('POST', '', {
      name: 'Gold', type: 'Credit', catalog_card_id: 'us-amex-gold', apply_catalog: true,
      point_value_cents: 1.5, category_rates: [{ store: 'eBay', rate: 2 }],
    });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ reward_type: 'points', points_base_rate: 1, default_cashback_rate: 1.5 });

    const bundled = require('../data/opencard-us.json').cards;
    const changed = bundled.map(c => (c.id === 'us-amex-gold'
      ? { ...c, base_rate: 2, categories: [{ label: 'Restaurants worldwide', rate: 5, cap: null }] }
      : c));
    await prisma.cardCatalog.create({
      data: { id: 'opencard-us', data: JSON.stringify(changed), card_count: changed.length, source_url: 'test', synced_at: new Date() },
    });

    const list = await call('GET');
    const gold = list.body.find(c => c.id === added.body.id);
    // 2x at 1.5 cents = 3% -- read from the trigger-maintained Decimal column.
    expect(gold).toMatchObject({ points_base_rate: 2, point_value_cents: 1.5, default_cashback_rate: 3 });
    expect(gold.category_rates).toContainEqual({ store: 'Dining', rate: 7.5, points: 5, source: 'catalog' });
    expect(gold.category_rates.find(r => r.store === 'eBay')).toMatchObject({ rate: 2 });
    const row = await prisma.paymentMethod.findUnique({ where: { id: added.body.id } });
    expect(String(row.default_cashback_rate_decimal)).toBe('3');
  });
});
