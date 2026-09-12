// Read-only source transaction; migration runs exclusively in disposable PGlite.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const fields = require('../services/currencyFields');
const prisma = new PrismaClient();
const metadata = { Inventory: 'purchase_date', Sales: 'sale_date', Expense: 'date', RecurringExpense: 'start_date', Invoice: 'issue_date' };
async function run() {
  const { PGlite } = await import('@electric-sql/pglite');
  const copied = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const output = {};
    for (const [model, config] of Object.entries(fields)) {
      const table = config.table || model;
      const amountFields = [...config.money || [], ...config.rate || []];
      const count = await tx.$queryRawUnsafe(`SELECT count(*)::integer AS count FROM "${table}"`);
      if (count[0].count > 10000) throw new Error(`${table} exceeds the bounded staging-copy limit.`);
      const owner = model === 'Sales' ? '(SELECT user_id FROM "Inventory" WHERE "Inventory".id=source.inventory_id) AS owner' : model === 'EbayPriceCache' ? "'shared' AS owner" : model === 'Invoice' ? "'invoice' AS owner" : 'user_id AS owner';
      const period = metadata[model] ? `, "${metadata[model]}"::text AS period` : ", 'all' AS period";
      output[model] = await tx.$queryRawUnsafe(`SELECT ${model === 'EbayPriceCache' ? 'product_name' : 'id'} AS id, ${owner}${period}${model === 'Goal' ? ', metric' : ''}, ${amountFields.map(field => `"${field}"::text AS "${field}"`).join(',')} FROM "${table}" AS source`);
    }
    return output;
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  const db = new PGlite();
  try {
    for (const [model, config] of Object.entries(fields)) {
      const names = [...config.money || [], ...config.rate || []];
      const columns = ['id', 'owner', 'period', ...model === 'Goal' ? ['metric'] : [], ...names];
      await db.exec(`CREATE TABLE "${config.table || model}" (${columns.map(key => `"${key}" ${names.includes(key) ? 'DOUBLE PRECISION' : 'TEXT'}`).join(',')});`);
      for (const row of copied[model]) await db.query(`INSERT INTO "${config.table || model}" (${columns.map(key => `"${key}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map(key => row[key]));
    }
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260912090000_additive_currency_decimals/migration.sql'), 'utf8'));
    const report = { date: new Date().toISOString(), sourceReadOnly: true, hostedWrites: false, passed: true, models: {} };
    for (const [model, config] of Object.entries(fields)) {
      const summary = { rows: copied[model].length, comparisons: 0, mismatches: 0, invalidHistoricalValues: 0 };
      for (const kind of ['money', 'rate']) for (const field of config[kind] || []) {
        const eligible = model === 'Goal' ? "metric <> 'unitsSold' AND " : '';
        const result = await db.query(`SELECT count(*)::integer AS comparisons, count(*) FILTER (WHERE "${field}_decimal" IS DISTINCT FROM round("${field}"::text::numeric, ${kind === 'rate' ? 6 : 2}))::integer AS mismatches, count(*) FILTER (WHERE "${field}" < 0 ${kind === 'rate' ? `OR "${field}" > 100` : ''})::integer AS invalid FROM "${config.table || model}" WHERE ${eligible}"${field}" IS NOT NULL`);
        summary.comparisons += result.rows[0].comparisons;
        summary.mismatches += result.rows[0].mismatches;
        summary.invalidHistoricalValues += result.rows[0].invalid;
        const groups = await db.query(`SELECT count(*)::integer AS mismatches FROM (SELECT owner, left(period,7) FROM "${config.table || model}" WHERE ${eligible}"${field}" IS NOT NULL GROUP BY owner,left(period,7) HAVING sum("${field}_decimal") <> sum(round("${field}"::text::numeric, ${kind === 'rate' ? 6 : 2}))) comparison`);
        summary.mismatches += groups.rows[0].mismatches;
      }
      report.models[model] = summary;
      if (summary.mismatches || summary.invalidHistoricalValues) report.passed = false;
    }
    fs.writeFileSync(path.join(__dirname, '../../qa/CURRENCY_STAGING_QA.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } finally { await db.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
