// Mileage log, equipment and home office against real Postgres: the migration
// adds the tables and columns, values save exactly, and the books use them.
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
const send = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe('mileage, equipment and home office on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-mileage-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('mileage_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/mileage_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'mileage-qa@example.test', schedule_c_enabled: true } });

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; req.apiKeyId = null; next(); });
    app.use('/api/inventory', require('../routes/inventory.js'));
    app.use('/api/schedule-c', require('../routes/scheduleC.js'));
    app.use('/api/tax', require('../routes/tax.js'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (pg) await pg.stop();
  });

  it('saves trips, equipment and home office, and the books use them', async () => {
    const trip = await send('POST', '/api/schedule-c/mileage', { date: '2026-08-03', miles: '40.5', destination: 'Post office', purpose: 'Ship orders', parking_tolls: '2.75' });
    expect(trip.status).toBe(201);
    expect(trip.body.trips[0]).toMatchObject({ date: '2026-08-03', miles: '40.5', parking_tolls: '2.75' });
    const asset = await send('POST', '/api/schedule-c/assets?year=2026', { name: 'Shelving', placed_in_service: '2026-04-01', cost: '640.10', business_percent: 100, method: 'macrs', recovery_years: 7 });
    expect(asset.body.assets[0]).toMatchObject({ cost: '640.1', this_year: '91.47' });
    const year = await send('PUT', '/api/schedule-c/years/2026', { home_office_sq_ft: 100, vehicle_in_service: '2023-01-15', vehicle_commuting_miles: '120.5' });
    expect(year.body).toMatchObject({ home_office_sq_ft: 100, vehicle_in_service: '2023-01-15', vehicle_commuting_miles: '120.5', untracked_inventory_end: null });
    const books = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    // 40.5 x 76¢ = 30.78, + 2.75; 640.10 x 14.29% = 91.47.
    expect(books.records.lines.map((l) => l.amount)).toEqual(['33.53', '91.47', '0.00']);
    // No profit, so no home office deduction.
    expect(books.records.homeOffice).toMatchObject({ claimed: true, beforeLimit: '500.00', total: '0.00' });
    const other = await prisma.user.create({ data: { email: 'mileage-other@example.test' } });
    const theirs = await prisma.taxMileageTrip.create({ data: { user_id: other.id, date: new Date(), miles: 1, destination: 'x', purpose: 'y' } });
    expect((await send('DELETE', `/api/schedule-c/mileage/${theirs.id}`)).status).toBe(404);
    expect(await prisma.taxMileageTrip.count()).toBe(2);
  });
});
