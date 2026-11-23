export const taxCategories = [
  { id: 'SUPPLIES', label: 'Supplies / shipping supplies', line2025: '22' },
  { id: 'POSTAGE', label: 'Postage / shipping labels', line2025: '27b', detail: 'Postage and shipping' },
  { id: 'FEES', label: 'Selling commissions and fees', line2025: '10' },
  { id: 'ADVERTISING', label: 'Advertising', line2025: '8' },
  { id: 'OFFICE', label: 'Office expense', line2025: '18' },
  { id: 'PROFESSIONAL', label: 'Legal and professional services', line2025: '17' },
  { id: 'SOFTWARE', label: 'Software subscriptions', line2025: '27b', detail: 'Software subscriptions' },
  { id: 'OTHER', label: 'Other business expense', line2025: '27b', detail: 'Other business expenses' },
];
export const emptyTaxDetails = () => ({ business_use: 'unreviewed', business_percent: '100', payee: '', purpose: '', tax_category: '', payment_status: 'unknown', paid_date: '', payment_reference: '', reviewed: false });
export function taxReviewIssues(tax = {}) {
  const issues = [];
  if (!['business', 'mixed'].includes(tax.business_use)) issues.push('Confirm business use');
  const percent = Number(tax.business_percent);
  if (tax.business_use === 'mixed' && (tax.business_percent === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100)) issues.push('Enter business-use percentage');
  if (!tax.payee?.trim()) issues.push('Enter payee');
  if (!tax.purpose?.trim()) issues.push('Describe business purpose');
  if (!taxCategories.some(category => category.id === tax.tax_category)) issues.push('Choose tax category');
  if (tax.payment_status !== 'paid') issues.push('Confirm payment');
  if (!tax.paid_date) issues.push('Enter payment date');
  if (!tax.payment_reference?.trim()) issues.push('Enter payment evidence reference');
  return issues;
}

// ── Suggestions for the review queue ────────────────────────────────────────
// Rule-based, never applied on their own: the review form offers them and the
// user confirms. They only fill fields that are still blank.
const CODE_TO_TAX = {
  SHIPPING_SUPPLIES: ['SUPPLIES', 'its expense category is Shipping Supplies'],
  SOFTWARE: ['SOFTWARE', 'its expense category is Software / Tools'],
  PROXY: ['SOFTWARE', 'proxies are an online service used to run the business'],
  MEMBERSHIP: ['OTHER', 'memberships and dues go under other expenses'],
  CREDIT_CARD_FEE: ['OTHER', 'card and bank fees go under other expenses'],
  PLATFORM_FEE: ['FEES', 'its expense category is Platform Fee'],
  SHIPPING: ['POSTAGE', 'its expense category is Shipping'],
};
// Whole words in the expense name; checked when the category doesn't decide.
const KEYWORDS = [
  ['POSTAGE', ['label', 'labels', 'postage', 'usps', 'ups', 'fedex', 'dhl', 'pirate ship', 'pirateship', 'shippo', 'stamps.com', 'shipstation']],
  ['SUPPLIES', ['tape', 'box', 'boxes', 'mailer', 'mailers', 'poly', 'bubble', 'packing', 'packaging', 'uline']],
  ['FEES', ['commission', 'final value fee', 'seller fee', 'selling fee', 'listing fee']],
  ['ADVERTISING', ['ad', 'ads', 'advertising', 'promoted', 'promotion', 'marketing']],
  ['OFFICE', ['printer', 'ink', 'toner', 'paper', 'office', 'staples']],
  ['PROFESSIONAL', ['cpa', 'accountant', 'accounting', 'bookkeeper', 'attorney', 'lawyer', 'legal', 'tax prep']],
  ['SOFTWARE', ['software', 'subscription', 'saas', 'adobe', 'canva', 'quickbooks', 'notion', 'vendoo', 'list perfectly']],
];
const PURPOSE = {
  SUPPLIES: 'Packing and shipping supplies for orders',
  POSTAGE: 'Postage to ship orders to buyers',
  FEES: 'Selling fees on a marketplace',
  ADVERTISING: 'Advertising listings and the business',
  OFFICE: 'Office supplies used for the business',
  PROFESSIONAL: 'Professional services for the business',
  SOFTWARE: 'Software and online services used to run the business',
  OTHER: 'Business expense',
};
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}($|[^a-z0-9])`).test(text);

/** The tax category an expense most likely belongs to, and why (or null). */
export function suggestTaxCategory(expense = {}) {
  const fromCode = CODE_TO_TAX[expense.category];
  if (fromCode) return { tax_category: fromCode[0], reason: `Suggested because ${fromCode[1]}.` };
  const name = String(expense.name || '').toLowerCase();
  for (const [category, words] of KEYWORDS) {
    const word = words.find((w) => hasWord(name, w));
    if (word) return { tax_category: category, reason: `Suggested because the name mentions "${word}".` };
  }
  return null;
}

/**
 * Suggested review details for an expense: only fields still blank in its
 * tax_details. paymentMethodName: the card or account it was paid with.
 */
export function suggestTaxDetails(expense = {}, { paymentMethodName = null } = {}) {
  const current = { ...emptyTaxDetails(), ...(expense.tax_details || {}) };
  const out = {};
  const category = suggestTaxCategory(expense);
  if (!current.tax_category && category) out.tax_category = category.tax_category;
  const cat = out.tax_category || current.tax_category;
  if (current.business_use === 'unreviewed') out.business_use = 'business';
  if (!current.payee?.trim() && expense.name) out.payee = String(expense.name).slice(0, 200);
  if (!current.purpose?.trim() && cat) out.purpose = PURPOSE[cat];
  // Recorded against a card or account: it was paid, on the expense's date.
  if (paymentMethodName) {
    const day = expense.date ? new Date(expense.date).toISOString().slice(0, 10) : '';
    if (current.payment_status === 'unknown') out.payment_status = 'paid';
    if (!current.paid_date && day) out.paid_date = day;
    if (!current.payment_reference?.trim()) out.payment_reference = `Paid with ${paymentMethodName}${day ? ` on ${day}` : ''}`;
  }
  return Object.keys(out).length ? { fields: out, reason: category?.reason || null } : null;
}
