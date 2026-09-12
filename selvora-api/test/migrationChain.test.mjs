import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

describe('fresh database migration chain', () => {
  it('applies every checked-in migration in order and provides the current money/ownership contract', async () => {
    const db = new PGlite();
    try {
      const root = new URL('../prisma/migrations/', import.meta.url);
      const migrations = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      for (const migration of migrations) {
        await db.exec(await readFile(new URL(`${migration}/migration.sql`, root), 'utf8'));
      }
      const result = await db.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'Inventory' AND column_name IN ('unit_purchase_cost', 'unit_purchase_cost_decimal') ORDER BY column_name`);
      expect(result.rows).toEqual([{ column_name: 'unit_purchase_cost', data_type: 'double precision' }, { column_name: 'unit_purchase_cost_decimal', data_type: 'numeric' }]);
      const owner = await db.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Buyer' AND column_name = 'user_id'`);
      expect(owner.rows).toEqual([{ is_nullable: 'NO' }]);
    } finally { await db.close(); }
  }, 30000);
});
