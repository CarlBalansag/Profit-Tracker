// One-off: the grouping test items (and the original seed item) were created
// with a tracking_number set directly at creation, before the create-path
// auto-advance fix existed. Corrects their status to match what a fresh
// create would now produce, using the real Prisma client against the branch.
const { createRequire } = require('node:module');
const requireApi = createRequire(require('path').join(__dirname, '../selvora-api/package.json'));
requireApi('dotenv').config({ path: require('path').join(__dirname, '../selvora-api/.env') });
const prisma = requireApi('./prisma');

async function run() {
  const result = await prisma.inventory.updateMany({
    where: { tracking_number: '1Z999AA10123456784', status: 'PURCHASED' },
    data: { status: 'SHIPPED_IN' },
  });
  console.log('Updated', result.count, 'inventory item(s) to SHIPPED_IN');
}

run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
