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
