// Manual expense categories -- the same list the website's Expenses tab
// offers (profit-tracker-app/src/pages/Expenses.jsx CATEGORIES); keep the two
// in step. Expense.category is a plain string, so older or hand-typed values
// are still stored as given; this list only lets the MCP tools turn a label
// or a loose spelling ("proxies", "Software / Tools") into the stored code.
const MANUAL_EXPENSE_CATEGORIES = [
  { value: 'CREDIT_CARD_FEE', label: 'Credit Card Fee' },
  { value: 'MEMBERSHIP', label: 'Membership' },
  { value: 'SHIPPING_SUPPLIES', label: 'Shipping Supplies' },
  { value: 'SOFTWARE', label: 'Software / Tools' },
  { value: 'PROXY', label: 'Proxies', aliases: ['proxies', 'proxy service', 'proxy services'] },
  { value: 'OTHER', label: 'Other' },
];

const squash = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// A known category's code, or the input trimmed when it is not one of them.
function normalizeExpenseCategory(input) {
  if (input === undefined) return undefined;
  const text = String(input ?? '').trim();
  if (!text) return null;
  const key = squash(text);
  const hit = MANUAL_EXPENSE_CATEGORIES.find((c) => squash(c.value) === key || squash(c.label) === key
    || (c.aliases || []).some((a) => squash(a) === key));
  return hit ? hit.value : text;
}

module.exports = { MANUAL_EXPENSE_CATEGORIES, normalizeExpenseCategory };
