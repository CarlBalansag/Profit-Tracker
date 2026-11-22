// Per-user email automation switches (decision D3), kept with the other
// preferences in User.accounting_preferences under "emailAutomation".
// Everything automatic is logged in Activity with Undo.
const DEFAULTS = {
  linkMatches: true,        // link sure matches and fill blank fields
  createExpenses: false,    // trusted merchants (E4)
  createPurchases: false,   // order emails with no matching purchase (E5)
  updateShipping: true,     // shipped/delivered and tracking on purchases (E5)
  cancellations: false,     // cancel purchases when the store cancels the whole order (E5); off: a To-Do asks
  returnReminders: true,    // return windows as To-Do items (E5)
  cashoutPayouts: true,     // cash-out receipts mark their sales paid (to the cash-out balance)
  homeState: null,          // "CA": Amazon orders shipped to another state count as resale
  personalWords: [],        // words that make an order personal ("Purina")
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
  for (const key of Object.keys(DEFAULTS)) if (typeof DEFAULTS[key] === 'boolean' && typeof changes[key] === 'boolean') next[key] = changes[key];
  if (changes.homeState === null || (typeof changes.homeState === 'string' && /^[A-Za-z]{2}$/.test(changes.homeState))) next.homeState = changes.homeState ? changes.homeState.toUpperCase() : null;
  if (Array.isArray(changes.personalWords)) {
    next.personalWords = [...new Set(changes.personalWords.map((w) => String(w).trim().slice(0, 40)).filter(Boolean))].slice(0, 50);
  }
  await prisma.user.update({ where: { id: userId }, data: { accounting_preferences: JSON.stringify({ ...prefs, emailAutomation: next }) } });
  return next;
}

module.exports = { getSettings, saveSettings, DEFAULTS };
