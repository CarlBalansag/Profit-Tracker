// Tax deadlines for the calendar: last year's, this year's and next year's,
// for users with Schedule C turned on. A year's state deadlines follow the
// state on that year's saved tax profile. Dates and titles only (no amounts):
// the published calendar feed is reachable by a link.
const prisma = require('../prisma');

const taxModule = import('../../shared/tax/index.mjs');

async function userTaxDeadlines(userId, client = prisma) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { schedule_c_enabled: true } });
  if (!user?.schedule_c_enabled) return [];
  const { taxDeadlines } = await taxModule;
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const profiles = await client.taxProfile.findMany({ where: { user_id: userId, year: { in: years } }, select: { year: true, state: true } });
  const stateFor = (y) => profiles.find((p) => p.year === y)?.state || null;
  return years.flatMap((year) => taxDeadlines({ year, state: stateFor(year) }));
}

module.exports = { userTaxDeadlines };
