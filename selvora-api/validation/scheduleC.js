const { z } = require('zod');
const { decimal } = require('../services/money');
const day = z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value), 'Enter a valid calendar date');
const text = z.string().trim().max(1000);
const taxDetails = z.object({
  business_use: z.enum(['unreviewed', 'business', 'mixed', 'personal']),
  business_percent: z.union([z.string().regex(/^(?:\d{1,3}(?:\.\d{1,2})?)?$/), z.number().finite()]).refine(value => value === '' || (Number(value) >= 0 && Number(value) <= 100 && decimal(value).decimalPlaces() <= 2), 'Use a percentage from 0 to 100 with at most two decimal places'),
  payee: text, purpose: text,
  tax_category: z.enum(['', 'SUPPLIES', 'POSTAGE', 'FEES', 'ADVERTISING', 'OFFICE', 'PROFESSIONAL', 'SOFTWARE', 'OTHER']),
  payment_status: z.enum(['unknown', 'paid', 'unpaid']),
  paid_date: day, payment_reference: text, reviewed: z.boolean(),
}).strict().superRefine((tax, ctx) => {
  if (tax.payment_status !== 'paid' && tax.paid_date) ctx.addIssue({ code: 'custom', path: ['paid_date'], message: 'A payment date requires paid status' });
  if (tax.reviewed && tax.business_use !== 'personal' && (tax.business_use === 'unreviewed' || !tax.payee || !tax.purpose || !tax.tax_category || tax.payment_status !== 'paid' || !tax.paid_date || !tax.payment_reference || (tax.business_use === 'mixed' && !(Number(tax.business_percent) > 0)))) {
    ctx.addIssue({ code: 'custom', path: ['reviewed'], message: 'Complete business details and payment evidence before marking reviewed' });
  }
});
module.exports = { taxDetails };
