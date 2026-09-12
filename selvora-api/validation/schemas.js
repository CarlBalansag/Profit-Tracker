const { z } = require('zod');
const { optionalCurrency, exactValue } = require('./currency');
const exactOptionalMoney = optionalCurrency();
const exactOptionalRate = optionalCurrency(6);

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

const money = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(0)
);

const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().min(0).optional()
);

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
  rate: exactValue(6),
  expires: optionalDateString,
}).passthrough();

const createInventory = z.object({
  product_name: requiredString('product_name'),
  vendor_id: id,
  payment_method_id: id,
  purchase_date: optionalDateString,
  unit_purchase_cost: exactOptionalMoney.default(0),
  qty_purchased: positiveInt.default(1),
  sales_tax: exactOptionalMoney.default(0),
  shipping_cost_inbound: exactOptionalMoney.default(0),
  fees: exactOptionalMoney.default(0),
  gift_card_amount: exactOptionalMoney.default(0),
  order_number: optionalString,
  tracking_number: optionalString,
  category: optionalString,
  tax_exempt: optionalBoolish,
  sale_shipping: exactOptionalMoney,
  sale_tax_collected: exactOptionalMoney,
  sale_price: exactOptionalMoney,
  payout_date: optionalDateString,
  sale_tab: optionalString,
  cashout_platform_id: id,
  marketplace_platform_id: id,
  commission_fee: exactOptionalMoney,
  sale_date: optionalDateString,
  qty_sold: positiveInt.optional(),
  status: optionalString,
}).passthrough();

// Update schemas must not be derived from create schemas with .partial().
// Defaults in a create schema are still applied by Zod after .partial(), which
// would turn omitted fields into updates that overwrite stored values.
const updateInventory = z.object({
  product_name: requiredString('product_name').optional(),
  vendor_id: id,
  payment_method_id: id,
  purchase_date: optionalDateString,
  unit_purchase_cost: exactOptionalMoney,
  qty_purchased: positiveInt.optional(),
  qty_on_hand: optionalNonNegativeInt,
  cashback_earned: exactOptionalMoney,
  sales_tax: exactOptionalMoney,
  shipping_cost_inbound: exactOptionalMoney,
  fees: exactOptionalMoney,
  gift_card_amount: exactOptionalMoney,
  order_number: optionalString,
  tracking_number: optionalString,
  category: optionalString,
  tax_exempt: optionalBoolish,
  status: optionalString,
}).passthrough();

const createSale = z.object({
  inventory_id: requiredId,
  platform_id: id,
  buyer_id: id,
  quantity: positiveInt.default(1),
  unit_price: exactValue(2),
  commission_fee: exactOptionalMoney.default(0),
  sale_shipping: exactOptionalMoney.default(0),
  sale_date: optionalDateString,
  payout_date: optionalDateString,
  status: optionalString,
  taxable: optionalBoolish,
  sale_tax_collected: exactOptionalMoney.default(0),
  customer_tax_exempt: optionalBoolish,
  exemption_type: optionalString,
}).passthrough();

const updateSale = z.object({
  platform_id: id,
  buyer_id: id,
  quantity: positiveInt.optional(),
  unit_price: exactOptionalMoney,
  commission_fee: exactOptionalMoney,
  sale_shipping: exactOptionalMoney,
  sale_date: optionalDateString,
  payout_date: nullableOptionalDateString,
  status: optionalString,
  taxable: optionalBoolish,
  sale_tax_collected: exactOptionalMoney,
  customer_tax_exempt: optionalBoolish,
  exemption_type: optionalString,
}).passthrough();

const createExpense = z.object({
  name: requiredString('name'),
  amount: exactValue(2),
  category: optionalString,
  date: dateString,
  notes: optionalString,
  receipt_url: optionalString,
}).passthrough();

const updateExpense = createExpense.partial();

const optionalDay = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(28).optional()
);

const paymentMethod = z.object({
  name: requiredString('name'),
  type: requiredString('type'),
  default_cashback_rate: exactOptionalRate.default(0),
  preset_card_id: optionalString,
  category_rates: z.array(categoryRate).optional(),
  statement_close_day: optionalDay,
  due_day: optionalDay,
  credit_limit: exactOptionalMoney.nullable(),
  min_payment_pct: exactOptionalRate.nullable(),
}).passthrough();

const updatePaymentMethod = paymentMethod.omit({ default_cashback_rate: true }).partial().extend({ default_cashback_rate: exactOptionalRate });

const platform = z.object({
  name: requiredString('name'),
  type: optionalString,
  fee_pct: exactOptionalRate.default(0),
  address: optionalString,
  notes: optionalString,
  tax_exempt_place: optionalBoolish,
}).passthrough();

const updatePlatform = z.object({
  name: requiredString('name').optional(),
  type: optionalString,
  fee_pct: exactOptionalRate,
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
  amount: exactValue(2),
  category: optionalString,
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  start_date: dateString,
  end_date: optionalDateString,
  notes: optionalString,
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
  last_sold_price: exactOptionalMoney.nullable(),
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
  exactValue(2).nullable().optional()
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
  updatePaymentMethod,
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
