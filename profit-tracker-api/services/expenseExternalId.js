// Expense.external_id: a bank, card or Copilot transaction id stored on an
// expense so the same statement line can't be imported twice. The database
// enforces it (@@unique([user_id, external_id])); these helpers give the web
// route and the MCP tools the same rules and the same friendly error.
const MAX_LENGTH = 200;

const requestError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// undefined stays undefined ("not given"); blank becomes null ("clear it").
function normalizeExternalId(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > MAX_LENGTH) throw requestError(400, `external_id must be at most ${MAX_LENGTH} characters`);
  return text;
}

// The user's expense already holding this id, other than `exceptId`.
async function findExpenseByExternalId(client, userId, externalId, exceptId = null) {
  if (!externalId) return null;
  const found = await client.expense.findFirst({ where: { user_id: userId, external_id: externalId } });
  return found && found.id !== exceptId ? found : null;
}

const duplicateError = (existing) => requestError(409, `An expense with this external_id is already recorded (${existing.id}).`, { existingId: existing.id });

// A unique-index race the pre-check could not see (two imports at once).
const isExternalIdConflict = (err) => err?.code === 'P2002'
  && [].concat(err.meta?.target || []).some((t) => String(t).includes('external_id'));

module.exports = { normalizeExternalId, findExpenseByExternalId, duplicateError, isExternalIdConflict };
