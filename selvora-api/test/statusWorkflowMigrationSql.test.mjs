import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

// Runs the reviewed migration SQL in a throwaway PostgreSQL engine, the same
// pattern main already uses for migration review (firebaseAuth.test.mjs,
// buyerInvoiceOwnershipMigration.test.mjs), scoped to the tables this
// migration touches. This is what makes the hand-authored migration
// DB-verified rather than only eyeballed.
let pg, client, migration;

beforeAll(async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'profittracker-status-workflow-qa-'));
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: true, onLog: () => {}, onError: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('status_workflow_qa');
  client = new Client({ connectionString: `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/status_workflow_qa` });
  await client.connect();
  migration = await readFile(new URL('../prisma/migrations/20261001010000_add_status_workflow_columns/migration.sql', import.meta.url), 'utf8');
}, 60000);
afterAll(async () => { if (client) await client.end(); if (pg) await pg.stop(); });

beforeEach(async () => {
  // Pre-migration shapes, including the currency mirror columns and the
  // sync trigger added by 20260930000000_additive_currency_decimals, so this
  // proves the new columns coexist with it.
  await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE "Platform" (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
    CREATE TABLE "Inventory" (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_name TEXT NOT NULL,
      received_date TIMESTAMP(3), qty_purchased INTEGER NOT NULL, qty_on_hand INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PURCHASED', tracking_number TEXT,
      unit_purchase_cost DOUBLE PRECISION NOT NULL, unit_purchase_cost_decimal NUMERIC(19,2));
    CREATE TABLE "Sales" (id TEXT PRIMARY KEY, inventory_id TEXT NOT NULL REFERENCES "Inventory"(id),
      quantity INTEGER NOT NULL, sale_date TIMESTAMP(3) NOT NULL, payout_date TIMESTAMP(3),
      status TEXT NOT NULL DEFAULT 'SOLD', unit_price DOUBLE PRECISION NOT NULL, unit_price_decimal NUMERIC(19,2));
    CREATE FUNCTION "sync_Sales_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW."unit_price_decimal" := CASE WHEN NEW."unit_price" IS NOT NULL THEN round(NEW."unit_price"::text::numeric, 2) ELSE NULL END;
      RETURN NEW; END $$;
    CREATE TRIGGER "sync_Sales_currency" BEFORE INSERT OR UPDATE ON "Sales" FOR EACH ROW EXECUTE FUNCTION "sync_Sales_currency"();
    INSERT INTO "Platform" VALUES ('plat','QA Marketplace','Marketplace');
    INSERT INTO "Inventory" (id,user_id,product_name,qty_purchased,qty_on_hand,status,unit_purchase_cost)
      VALUES ('inv','one','QA Sneaker',5,3,'LISTED',100);
    INSERT INTO "Sales" (id,inventory_id,quantity,sale_date,status,unit_price)
      VALUES ('sale','inv',2,'2026-09-03T12:00:00Z','SOLD',150);`);
});

const columns = async (table) => (await client.query(
  `SELECT column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale
     FROM information_schema.columns WHERE table_name = $1`, [table])).rows
  .reduce((all, row) => Object.assign(all, { [row.column_name]: row }), {});

describe('status-workflow migration SQL in an isolated PostgreSQL engine', () => {
  it('adds every new column as nullable or defaulted without dropping or renaming anything', async () => {
    await client.query(migration);

    const inventory = await columns('Inventory');
    expect(inventory.receiving_status).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(inventory.is_listed).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
    for (const name of ['received_at', 'cancelled_at']) {
      expect(inventory[name], name).toMatchObject({ data_type: 'timestamp without time zone', is_nullable: 'YES' });
    }
    expect(inventory.correction_note).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    // Legacy columns survive untouched.
    expect(inventory.status).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(inventory.received_date).toBeDefined();

    const sales = await columns('Sales');
    for (const name of ['workflow_type', 'workflow_status', 'paid_reference']) {
      expect(sales[name], name).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    }
    for (const name of ['delivered_at', 'paid_at', 'cancelled_at', 'voided_at', 'return_requested_at', 'returned_at', 'disputed_at']) {
      expect(sales[name], name).toMatchObject({ data_type: 'timestamp without time zone', is_nullable: 'YES' });
    }
    expect(sales.paid_amount).toMatchObject({ data_type: 'numeric', is_nullable: 'YES', numeric_precision: 19, numeric_scale: 2 });
    // paid_at is a new column, not a rename of the existing reminder field.
    expect(sales.payout_date).toBeDefined();
    expect(sales.status).toMatchObject({ is_nullable: 'NO' });

    expect((await columns('Platform')).workflow_preset).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect((await columns('Platform')).type).toMatchObject({ is_nullable: 'NO' });
  });

  it('leaves existing rows readable, with new statuses NULL and is_listed false', async () => {
    await client.query(migration);
    expect((await client.query(`SELECT status, receiving_status, is_listed, received_at, qty_on_hand FROM "Inventory"`)).rows)
      .toEqual([{ status: 'LISTED', receiving_status: null, is_listed: false, received_at: null, qty_on_hand: 3 }]);
    expect((await client.query(`SELECT status, workflow_type, workflow_status, paid_at, paid_amount FROM "Sales"`)).rows)
      .toEqual([{ status: 'SOLD', workflow_type: null, workflow_status: null, paid_at: null, paid_amount: null }]);
    expect((await client.query(`SELECT workflow_preset, type FROM "Platform"`)).rows)
      .toEqual([{ workflow_preset: null, type: 'Marketplace' }]);
  });

  it('accepts a backfill and keeps the existing currency sync trigger working', async () => {
    await client.query(migration);
    await client.query(`UPDATE "Inventory" SET receiving_status='ON_HAND', is_listed=true, received_at='2026-09-02T00:00:00Z' WHERE id='inv';`);
    await client.query(`UPDATE "Sales" SET workflow_type='STANDARD_MARKETPLACE', workflow_status='PAID',
      paid_at='2026-09-30T00:00:00Z', paid_amount=288.005, paid_reference='PP-991', unit_price=150.004 WHERE id='sale';`);
    expect((await client.query(`SELECT receiving_status, is_listed FROM "Inventory"`)).rows)
      .toEqual([{ receiving_status: 'ON_HAND', is_listed: true }]);
    const [sale] = (await client.query(`SELECT workflow_status, paid_amount, paid_reference, unit_price_decimal FROM "Sales"`)).rows;
    // paid_amount is exact-decimal from the start: NUMERIC(19,2) rounds on store.
    expect(sale).toMatchObject({ workflow_status: 'PAID', paid_amount: '288.01', paid_reference: 'PP-991' });
    // The pre-existing trigger still mirrors the legacy Float column.
    expect(sale.unit_price_decimal).toBe('150.00');
  });

  it('is a single transaction: nothing is added when any statement in it fails', async () => {
    await client.query(`ALTER TABLE "Platform" ADD COLUMN "workflow_preset" TEXT;`);
    await expect(client.query(migration)).rejects.toThrow(/workflow_preset/);
    await client.query('ROLLBACK');
    expect((await columns('Inventory')).receiving_status).toBeUndefined();
    expect((await columns('Sales')).workflow_status).toBeUndefined();
  });
});
