import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
let migration;
beforeAll(async () => {
  db = new PGlite();
  migration = await readFile(new URL('../prisma/migrations/20260912070000_buyer_invoice_ownership/migration.sql', import.meta.url), 'utf8');
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE "User" (id TEXT PRIMARY KEY);
    CREATE TABLE "Inventory" (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE "Buyer" (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE "Sales" (id TEXT PRIMARY KEY, inventory_id TEXT, buyer_id TEXT);
    CREATE TABLE "Invoice" (id TEXT PRIMARY KEY, buyer_id TEXT,
      CONSTRAINT "Invoice_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES "Buyer"(id));
    INSERT INTO "User" VALUES ('one'), ('two');
    INSERT INTO "Inventory" VALUES ('stock-one','one'), ('stock-two','two');`);
});
describe('ownership migration SQL in isolated PostgreSQL engine', () => {
  it('migrates empty tables and enforces required owners and matching invoice/buyer ownership', async () => {
    await db.exec(migration);
    await expect(db.exec(`INSERT INTO "Buyer"(id,name) VALUES ('missing','Missing');`)).rejects.toThrow();
    await db.exec(`INSERT INTO "Buyer"(id,name,user_id) VALUES ('buyer','Buyer','one');`);
    await expect(db.exec(`INSERT INTO "Invoice"(id,buyer_id,user_id) VALUES ('foreign','buyer','two');`)).rejects.toThrow();
    await db.exec(`INSERT INTO "Invoice"(id,buyer_id,user_id) VALUES ('owned','buyer','one');`);
    expect((await db.query(`SELECT user_id FROM "Invoice"`)).rows).toEqual([{ user_id: 'one' }]);
  });
  it('backfills unambiguous ownership without losing records', async () => {
    await db.exec(`INSERT INTO "Buyer" VALUES ('buyer','Buyer');
      INSERT INTO "Sales" VALUES ('sale','stock-one','buyer');
      INSERT INTO "Invoice" VALUES ('invoice','buyer');`);
    await db.exec(migration);
    expect((await db.query(`SELECT id,user_id FROM "Buyer"`)).rows).toEqual([{ id: 'buyer', user_id: 'one' }]);
    expect((await db.query(`SELECT id,user_id FROM "Invoice"`)).rows).toEqual([{ id: 'invoice', user_id: 'one' }]);
  });
  it.each(['unlinked', 'conflicting'])('rolls back %s ownership rather than guessing', async kind => {
    await db.exec(`INSERT INTO "Buyer" VALUES ('buyer','Buyer'); INSERT INTO "Invoice" VALUES ('invoice','buyer');`);
    if (kind === 'conflicting') await db.exec(`INSERT INTO "Sales" VALUES ('one','stock-one','buyer'),('two','stock-two','buyer');`);
    await expect(db.exec(migration)).rejects.toThrow(/ambiguous or missing/);
    await db.exec('ROLLBACK;');
    expect((await db.query(`SELECT * FROM "Buyer"`)).rows).toEqual([{ id: 'buyer', name: 'Buyer' }]);
    expect((await db.query(`SELECT * FROM "Invoice"`)).rows).toEqual([{ id: 'invoice', buyer_id: 'buyer' }]);
  });
});
