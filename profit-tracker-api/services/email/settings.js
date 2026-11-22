// Per-user email automation switches (decision D3), kept with the other
// preferences in User.accounting_preferences under "emailAutomation".
// Everything automatic is logged in Activity with Undo.
const DEFAULTS = {
  linkMatches: true,        // link sure matches and fill blank fields
  createExpenses: false,    // trusted merchants (E4)
  createPurchases: false,   // order emails with no matching purchase (E5)
  updateShipping: true,     // shipped/delivered and tracking on purchases (E5)
  updateSales: true,        // sold/paid from marketplace emails (E5)
  cancellations: true,      // cancelled orders and refunds (E5)
  returnReminders: true,    // return windows as To-Do items (E5)
};

function parse(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) || {} : raw || {}; } catch { return {}; }
}

async function getSettings(prisma, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accounting_preferences: true } });
  return { ...DEFAULTS, ...(parse(user?.accounting_preferences).emailAutomation || {}) };
}

async function saveSettings(prisma, userId, changes) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accounting_preferences: true } });
  const prefs = parse(user?.accounting_preferences);
  const next = { ...DEFAULTS, ...(prefs.emailAutomation || {}) };
  for (const key of Object.keys(DEFAULTS)) if (typeof changes[key] === 'boolean') next[key] = changes[key];
  await prisma.user.update({ where: { id: userId }, data: { accounting_preferences: JSON.stringify({ ...prefs, emailAutomation: next }) } });
  return next;
}

module.exports = { getSettings, saveSettings, DEFAULTS };
