const { z } = require('zod');
const { taxDetails } = require('./scheduleC');
const { decimal, parseAmount } = require('../services/money');

const emptyToUndefined = (value) => (value === '' ? undefined : value);
const emptyToNull = (value) => (value === '' ? null : value);

const requiredString = (field) =>
  z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`).max(500);

const optionalString = z.preprocess(
  emptyToNull,
  z.string().trim().max(1000).nullable().optional()
);

const id = z.preprocess(emptyToNull, z.string().trim().uuid().nullable().optional());
const requiredId = z.string().trim().uuid();

// An Inventory record legitimately holds any status in its full lifecycle
// (confirmed by Inventory.jsx's own status-badge map and existing tests --
// e.g. a purchase can be directly marked COMPLETED or CANCELLED with no
// sale). A Sale record's status is a narrower post-sale-only subset. Both
// previously used an unrestricted string, which let a sale row end up with
// an inventory-only status like PURCHASED (ideas.md ISSUES #3) via the
// Transactions inline editor's shared dropdown offering every status to
// every row. Only Sales needs the narrower enum -- Inventory keeps the full
// union so no currently-valid inventory status is rejected.
const INVENTORY_STATUSES = ['Pre Order', 'On Hand', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
const SALE_STATUSES = ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
const inventoryStatus = z.preprocess(emptyToUndefined, z.enum(INVENTORY_STATUSES).optional());
const saleStatus = z.preprocess(emptyToUndefined, z.enum(SALE_STATUSES).optional());

const money = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(0)
);

const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(0).optional()
);

// Exact-decimal money validator backed by services/money.js. By default
// rejects malformed, negative, non-finite and over-precision input instead
// of silently coercing it -- for fields a person types in directly, where
// extra precision is a mistake worth surfacing.
//
// `round: true` instead rounds to `scale` decimal places rather than
// rejecting them, for fields the server/client computes rather than a
// person enters directly (e.g. cashback_earned = cost * rate / 100), where
// float noise past the 2nd decimal is expected and not a user error.
function decimalAmount({ scale = 2, optional = false, defaultValue, round = false } = {}) {
  const schema = z.preprocess(emptyToUndefined, z.any()).transform((val, ctx) => {
    if (val === undefined) {
      // Only reached when the raw field was present but empty (e.g. '') --
      // a fully absent key is intercepted by .optional()/.default() below
      // before this transform ever runs. Matches the original
      // optionalMoney/optionalMoney.default(0) behavior for that case,
      // which left it undefined and relied on the route's own `|| 0`.
      if (optional || defaultValue !== undefined) return undefined;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is required.' });
      return z.NEVER;
    }
    try {
      if (round) {
        const result = decimal(val);
        if (result.isNegative()) throw new Error('Amount cannot be negative.');
        return result.toDecimalPlaces(scale).toNumber();
      }
      return parseAmount(val, scale).toNumber();
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err.message });
      return z.NEVER;
    }
  });
  // A real fully-absent key must be intercepted here (by .default() or
  // .optional()) rather than inside the transform above -- Zod never invokes
  // a field's schema at all when the raw value is undefined and the schema
  // is ZodOptional/ZodDefault, so defaultValue handling inside the transform
  // is unreachable for that case and must live here instead.
  if (defaultValue !== undefined) return schema.default(defaultValue);
  return optional ? schema.optional() : schema;
}

const positiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1)
);

const optionalNonNegativeInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(0).optional()
);

const boolish = z.union([z.boolean(), z.enum(['true', 'false'])]);
const optionalBoolish = boolish.optional();

const dateString = z.string().trim().min(1).refine(
  (value) => !Number.isNaN(new Date(value).getTime()),
  'Invalid date'
);

const calendarDate = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }, 'date must be a real calendar date');

const optionalDateString = z.preprocess(
  emptyToUndefined,
  dateString.optional()
);

const nullableOptionalDateString = z.preprocess(
  emptyToNull,
  dateString.nullable().optional()
);

const categoryRate = z.object({
  store: requiredString('store'),
  rate: z.coerce.number().finite().min(0),
  expires: optionalDateString,
}).passthrough();

const createInventory = z.object({
  product_name: requiredString('product_name'),
  vendor_id: id,
  payment_method_id: id,
  purchase_date: optionalDateString,
  unit_purchase_cost: decimalAmount({ defaultValue: 0 }),
  qty_purchased: positiveInt.default(1),
  sales_tax: decimalAmount({ defaultValue: 0 }),
  shipping_cost_inbound: decimalAmount({ defaultValue: 0 }),
  fees: decimalAmount({ defaultValue: 0 }),
  gift_card_amount: decimalAmount({ defaultValue: 0 }),
  cashback_rate: decimalAmount({ scale: 6, optional: true }),
  cashback_earned: decimalAmount({ optional: true, round: true }),
  order_number: optionalString,
  tracking_number: optionalString,
  category: optionalString,
  tax_exempt: optionalBoolish,
  sale_price: decimalAmount({ optional: true }),
  payout_date: optionalDateString,
  sale_tab: optionalString,
  cashout_platform_id: id,
  marketplace_platform_id: id,
  commission_fee: decimalAmount({ defaultValue: 0 }),
  sale_shipping: decimalAmount({ defaultValue: 0 }),
  sale_tax_collected: decimalAmount({ defaultValue: 0 }),
  sale_date: optionalDateString,
  qty_sold: positiveInt.optional(),
  status: inventoryStatus,
}).passthrough();

// Update schemas must not be derived from create schemas with .partial().
// Defaults in a create schema are still applied by Zod after .partial(), which
// would turn omitted fields into updates that overwrite stored values.
const updateInventory = z.object({
  product_name: requiredString('product_name').optional(),
  vendor_id: id,
  payment_method_id: id,
  purchase_date: optionalDateString,
  unit_purchase_cost: decimalAmount({ optional: true }),
  qty_purchased: positiveInt.optional(),
  qty_on_hand: optionalNonNegativeInt,
  cashback_earned: decimalAmount({ optional: true, round: true }),
  sales_tax: decimalAmount({ optional: true }),
  shipping_cost_inbound: decimalAmount({ optional: true }),
  fees: decimalAmount({ optional: true }),
  gift_card_amount: decimalAmount({ optional: true }),
  cashback_rate: decimalAmount({ scale: 6, optional: true }),
  order_number: optionalString,
  tracking_number: optionalString,
  category: optionalString,
  tax_exempt: optionalBoolish,
  status: inventoryStatus,
}).passthrough();

const createSale = z.object({
  inventory_id: requiredId,
  platform_id: id,
  buyer_id: id,
  quantity: positiveInt.default(1),
  unit_price: decimalAmount(),
  commission_fee: decimalAmount({ defaultValue: 0 }),
  sale_shipping: decimalAmount({ defaultValue: 0 }),
  sale_date: optionalDateString,
  payout_date: optionalDateString,
  status: saleStatus,
  taxable: optionalBoolish,
  sale_tax_collected: decimalAmount({ defaultValue: 0 }),
  customer_tax_exempt: optionalBoolish,
  exemption_type: optionalString,
  tracking_number: optionalString,
}).passthrough();

const updateSale = z.object({
  platform_id: id,
  buyer_id: id,
  quantity: positiveInt.optional(),
  unit_price: decimalAmount({ optional: true }),
  commission_fee: decimalAmount({ optional: true }),
  sale_shipping: decimalAmount({ optional: true }),
  sale_date: optionalDateString,
  payout_date: nullableOptionalDateString,
  status: saleStatus,
  taxable: optionalBoolish,
  sale_tax_collected: decimalAmount({ optional: true }),
  customer_tax_exempt: optionalBoolish,
  exemption_type: optionalString,
  tracking_number: optionalString,
}).passthrough();

const createExpense = z.object({
  name: requiredString('name'),
  amount: decimalAmount(),
  category: optionalString,
  date: dateString,
  notes: optionalString,
  receipt_url: optionalString,
  payment_method_id: id,
  tax_details: taxDetails.optional(),
}).passthrough();

const updateExpense = createExpense.partial().extend({ expected_tax_version: z.number().int().min(0).optional() });

const optionalDay = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(28).optional()
);

const paymentMethod = z.object({
  name: requiredString('name'),
  type: requiredString('type'),
  default_cashback_rate: decimalAmount({ scale: 6, defaultValue: 0 }),
  preset_card_id: optionalString,
  category_rates: z.array(categoryRate).optional(),
  statement_close_day: optionalDay.nullable(),
  due_day: optionalDay.nullable(),
  credit_limit: decimalAmount({ optional: true }).nullable(),
  min_payment_pct: decimalAmount({ scale: 6, optional: true }).nullable(),
}).passthrough();

const platform = z.object({
  name: requiredString('name'),
  type: optionalString,
  fee_pct: decimalAmount({ scale: 6, defaultValue: 0 }),
  address: optionalString,
  notes: optionalString,
  tax_exempt_place: optionalBoolish,
}).passthrough();

const updatePlatform = z.object({
  name: requiredString('name').optional(),
  type: optionalString,
  fee_pct: decimalAmount({ scale: 6, optional: true }),
  address: optionalString,
  notes: optionalString,
  tax_exempt_place: optionalBoolish,
}).passthrough();

const platformBatch = z.object({
  vendors: z.array(z.object({
    id: z.string().trim().uuid().optional(),
    name: requiredString('name'),
    type: optionalString,
    category: optionalString,
  }).passthrough()).min(1),
});

const account = z.object({
  platform_id: requiredId,
  name: requiredString('name'),
  email: optionalString,
  username: optionalString,
  status: optionalString,
  notes: optionalString,
}).passthrough();

const updateAccount = account.omit({ platform_id: true }).partial();

const recurringExpense = z.object({
  name: requiredString('name'),
  amount: decimalAmount(),
  category: optionalString,
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  start_date: dateString,
  end_date: optionalDateString,
  notes: optionalString,
  payment_method_id: id,
}).passthrough();

const updateRecurringExpense = recurringExpense.partial().extend({
  active: z.boolean().optional(),
});

const attachReceipt = z.object({
  itemType: z.enum(['inventory', 'expense']),
  itemId: requiredId,
  fileData: z.string().min(1),
  fileName: optionalString,
});

const detachReceipt = attachReceipt.pick({ itemType: true, itemId: true });

const ebayPriceQuery = z.object({
  q: requiredString('q').max(200),
});

const ebayPrice = z.object({
  product_name: requiredString('product_name').max(200),
  last_sold_price: optionalMoney.nullable(),
});

const dashboardPreferences = z.object({
  settings: z.record(z.string(), z.unknown()),
});

const analyticsDashboardQuery = z.object({
  mode: z.enum(['All', 'Cashout', 'Marketplace']).optional(),
  date: z.enum(['All Time', '7 Days', '30 Days', 'YTD']).optional(),
});

const productNote = z.object({
  product_name: requiredString('product_name'),
  note: z.string().trim().max(2000),
});

const calendarEventFields = {
  title: requiredString('title').max(200),
  date: calendarDate,
  end_date: z.preprocess(emptyToNull, calendarDate.nullable().optional()),
  color: z.enum(['purple', 'blue', 'green', 'amber', 'red']).nullable().optional(),
  notes: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
};

const validateCalendarDateRange = (event, context) => {
  if (event.date && event.end_date && event.end_date < event.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['end_date'], message: 'end_date cannot be before date' });
  }
};

const calendarEvent = z.object(calendarEventFields).superRefine(validateCalendarDateRange);

const updateCalendarEvent = z.object({
  title: calendarEventFields.title.optional(),
  date: calendarDate.optional(),
  end_date: z.preprocess(emptyToNull, calendarDate.nullable().optional()),
  color: calendarEventFields.color,
  notes: calendarEventFields.notes,
}).superRefine(validateCalendarDateRange);

const goalTarget = z.preprocess(
  emptyToNull,
  z.coerce.number().finite().min(0).nullable().optional()
);
const goalActive = z.union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');
const goalMetric = z.enum(['netProfit', 'totalRevenue', 'unitsSold']);
const goal = z.object({
  metric: goalMetric,
  target_7d: goalTarget,
  target_30d: goalTarget,
  target_ytd: goalTarget,
  active: goalActive.optional(),
});
const updateGoal = z.object({
  metric: goalMetric.optional(),
  target_7d: goalTarget,
  target_30d: goalTarget,
  target_ytd: goalTarget,
  active: goalActive.optional(),
});

module.exports = {
  createInventory,
  updateInventory,
  createSale,
  updateSale,
  createExpense,
  updateExpense,
  paymentMethod,
  platform,
  updatePlatform,
  platformBatch,
  account,
  updateAccount,
  recurringExpense,
  updateRecurringExpense,
  attachReceipt,
  detachReceipt,
  ebayPriceQuery,
  ebayPrice,
  dashboardPreferences,
  analyticsDashboardQuery,
  productNote,
  calendarEvent,
  updateCalendarEvent,
  goal,
  updateGoal,
};
