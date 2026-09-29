import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

let pg, client, migration;

beforeAll(async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'profittracker-buyer-ownership-qa-'));
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: true, onLog: () => {}, onError: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('buyer_ownership_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/buyer_ownership_qa`;
  client = new Client({ connectionString: url }); await client.connect();
  migration = await readFile(new URL('../prisma/migrations/20260929010000_buyer_invoice_ownership/migration.sql', import.meta.url), 'utf8');
}, 60000);
afterAll(async () => { if (client) await client.end(); if (pg) await pg.stop(); });
beforeEach(async () => {
  // Recreate the pre-migration table shapes from scratch each test, then apply
  // the actual reviewed migration SQL — mirrors main's own migration test
  // pattern (firebaseAuth.test.mjs), scoped to just the tables this migration touches.
  await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE "User" (id TEXT PRIMARY KEY);
    CREATE TABLE "Inventory" (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE "Buyer" (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE "Sales" (id TEXT PRIMARY KEY, inventory_id TEXT, buyer_id TEXT);
    CREATE TABLE "Invoice" (id TEXT PRIMARY KEY, buyer_id TEXT,
      CONSTRAINT "Invoice_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES "Buyer"(id));
    INSERT INTO "User" VALUES ('one'), ('two');
    INSERT INTO "Inventory" VALUES ('stock-one','one'), ('stock-two','two');`);
});
describe('buyer/invoice ownership migration SQL in isolated PostgreSQL engine', () => {
  it('migrates empty tables and enforces required owners and matching invoice/buyer ownership', async () => {
    await client.query(migration);
    await expect(client.query(`INSERT INTO "Buyer"(id,name) VALUES ('missing','Missing');`)).rejects.toThrow();
    await client.query(`INSERT INTO "Buyer"(id,name,user_id) VALUES ('buyer','Buyer','one');`);
    await expect(client.query(`INSERT INTO "Invoice"(id,buyer_id,user_id) VALUES ('foreign','buyer','two');`)).rejects.toThrow();
    await client.query(`INSERT INTO "Invoice"(id,buyer_id,user_id) VALUES ('owned','buyer','one');`);
    expect((await client.query(`SELECT user_id FROM "Invoice"`)).rows).toEqual([{ user_id: 'one' }]);
  });
  it('backfills unambiguous ownership without losing records', async () => {
    await client.query(`INSERT INTO "Buyer" VALUES ('buyer','Buyer');
      INSERT INTO "Sales" VALUES ('sale','stock-one','buyer');
      INSERT INTO "Invoice" VALUES ('invoice','buyer');`);
    await client.query(migration);
    expect((await client.query(`SELECT id,user_id FROM "Buyer"`)).rows).toEqual([{ id: 'buyer', user_id: 'one' }]);
    expect((await client.query(`SELECT id,user_id FROM "Invoice"`)).rows).toEqual([{ id: 'invoice', user_id: 'one' }]);
  });
  it.each(['unlinked', 'conflicting'])('rolls back %s ownership rather than guessing', async kind => {
    await client.query(`INSERT INTO "Buyer" VALUES ('buyer','Buyer'); INSERT INTO "Invoice" VALUES ('invoice','buyer');`);
    if (kind === 'conflicting') await client.query(`INSERT INTO "Sales" VALUES ('one','stock-one','buyer'),('two','stock-two','buyer');`);
    await expect(client.query(migration)).rejects.toThrow(/ambiguous or missing/);
    await client.query('ROLLBACK');
    expect((await client.query(`SELECT * FROM "Buyer"`)).rows).toEqual([{ id: 'buyer', name: 'Buyer' }]);
    expect((await client.query(`SELECT * FROM "Invoice"`)).rows).toEqual([{ id: 'invoice', buyer_id: 'buyer' }]);
  });
});
