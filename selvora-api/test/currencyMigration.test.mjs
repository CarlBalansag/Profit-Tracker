import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const fields = createRequire(import.meta.url)('../services/currencyFields.js');
let db, migration;
beforeAll(async () => {
  db = new PGlite();
  migration = await readFile(new URL('../prisma/migrations/20260912090000_additive_currency_decimals/migration.sql', import.meta.url), 'utf8');
}, 30000);
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const [model, config] of Object.entries(fields)) {
    const columns = [...config.money || [], ...config.rate || []].map(field => `"${field}" DOUBLE PRECISION`);
    await db.exec(`CREATE TABLE "${config.table || model}" (id TEXT PRIMARY KEY${model === 'Goal' ? ', metric TEXT' : ''}, ${columns.join(', ')});`);
  }
});
describe('additive decimal migration', () => {
  it('backfills every field with currency/rate precision and retains the original values', async () => {
    for (const [model, config] of Object.entries(fields)) {
      const names = [...config.money || [], ...config.rate || []];
      await db.exec(`INSERT INTO "${config.table || model}" (id${model === 'Goal' ? ', metric' : ''}, ${names.map(field => `"${field}"`).join(',')}) VALUES ('fixture'${model === 'Goal' ? ", 'netProfit'" : ''}, ${names.map(() => '1.234567').join(',')});`);
    }
    await db.exec(migration);
    for (const [model, config] of Object.entries(fields)) {
      const row = (await db.query(`SELECT * FROM "${config.table || model}"`)).rows[0];
      for (const field of config.money || []) { expect(String(row[`${field}_decimal`])).toBe('1.23'); expect(row[field]).toBe(1.234567); }
      for (const field of config.rate || []) expect(String(row[`${field}_decimal`])).toBe('1.234567');
    }
  });
  it('keeps unit goals separate and mirrors old-client create/partial update/clear atomically', async () => {
    await db.exec(migration);
    await db.exec(`INSERT INTO "Goal"(id,metric,target_7d) VALUES ('units','unitsSold',3); INSERT INTO "PaymentMethod"(id,credit_limit,default_cashback_rate) VALUES ('card',100.01,2.123456);`);
    expect((await db.query(`SELECT target_7d_decimal FROM "Goal"`)).rows[0].target_7d_decimal).toBeNull();
    await db.exec(`UPDATE "PaymentMethod" SET default_cashback_rate=3.123456 WHERE id='card';`);
    let row = (await db.query(`SELECT credit_limit_decimal,default_cashback_rate_decimal FROM "PaymentMethod"`)).rows[0];
    expect(String(row.credit_limit_decimal)).toBe('100.01');
    expect(String(row.default_cashback_rate_decimal)).toBe('3.123456');
    await db.exec(`UPDATE "PaymentMethod" SET credit_limit=NULL WHERE id='card';`);
    row = (await db.query(`SELECT credit_limit_decimal FROM "PaymentMethod"`)).rows[0];
    expect(row.credit_limit_decimal).toBeNull();
  });
  it.each(['NaN', 'Infinity', '1e30'])('rolls back unsafe historical %s without replacing Float data', async value => {
    await db.exec(`INSERT INTO "Inventory" (id,unit_purchase_cost) VALUES ('bad','${value}'::double precision);`);
    await expect(db.exec(migration)).rejects.toThrow();
    await db.exec('ROLLBACK;');
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Inventory' AND column_name LIKE '%_decimal'`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT count(*)::integer AS count FROM "Inventory"`)).rows[0].count).toBe(1);
  });
  it('preserves rows and decimal values when a subsequent write fails and supports retry', async () => {
    await db.exec(migration);
    await db.exec(`INSERT INTO "Expense"(id,amount) VALUES ('one',0.29);`);
    await expect(db.exec(`UPDATE "Expense" SET amount='Infinity'::double precision WHERE id='one';`)).rejects.toThrow();
    expect(String((await db.query(`SELECT amount_decimal FROM "Expense"`)).rows[0].amount_decimal)).toBe('0.29');
    await db.exec(`UPDATE "Expense" SET amount=0.30 WHERE id='one';`);
    expect(String((await db.query(`SELECT amount_decimal FROM "Expense"`)).rows[0].amount_decimal)).toBe('0.30');
  });
});
