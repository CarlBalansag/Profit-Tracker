import {
  ShoppingCart, DollarSign, Tag, TrendingUp, Percent,
  Gauge, BarChart2, Receipt, Warehouse,
  ShoppingBag, Send, Package, ScanLine, CircleCheck, ListChecks,
  Undo2, AlertTriangle, XCircle, Hourglass, Truck, Shield, Clock
} from 'lucide-react';

// ── Stat Card Registry ────────────────────────────────────────────────────────
// scope: 'all'  → includes all purchases (sold + unsold)
// scope: 'sold' → sold items only
export const STAT_CARD_REGISTRY = {

  // ── ALL PURCHASES ────────────────────────────────────────────────────────────
  totalCost: {
    label: 'Purchase Spend',
    icon: ShoppingCart,
    color: 'blue',
    scope: 'all',
    formula: ['(Item Price × Quantity) + Purchase Tax + Shipping to You + Purchase Fees', '− Gift Cards'],
    description: 'How much you spent to buy inventory during the selected period. It includes item cost, purchase tax, shipping to you, and purchase fees, then subtracts gift cards.',
    getValue: (s) => `$${s.totalCost.toFixed(2)}`,
    getSubtext: (s) => `${s.transactionCount} purchases`,
  },
  totalCashback: {
    label: 'Cashback',
    icon: Tag,
    color: 'pink',
    scope: 'all',
    formula: ['Purchase Amount Eligible for Cashback × Card Cashback Rate %'],
    description: 'Cashback earned from inventory purchases. The All view includes sold and unsold items; a sales-channel view includes only the cashback connected to units you sold.',
    getValue: (s) => `$${s.totalCashback.toFixed(2)}`,
    getSubtext: (s) => `${s.avgCashbackRate.toFixed(2)}% avg rate`,
  },
  totalTax: {
    label: 'Total Tax Paid',
    icon: Receipt,
    color: 'orange',
    scope: 'all',
    formula: ['Purchase Sales Tax Added Together'],
    description: 'Purchase sales tax paid on inventory you bought during the selected period.',
    getValue: (s) => `$${(s.totalTax ?? 0).toFixed(2)}`,
    getSubtext: () => 'all purchases',
  },
  inventoryValue: {
    label: 'Inventory Value',
    icon: Warehouse,
    color: 'sky',
    scope: 'all',
    formula: ['Cost of Each Unsold Unit × Quantity On Hand'],
    description: 'What your current unsold inventory cost you. This is a current snapshot, so the dashboard date filter does not change it.',
    getValue: (s) => `$${(s.inventoryValue ?? 0).toFixed(2)}`,
    getSubtext: () => 'unsold stock at cost',
  },

  // ── SOLD ONLY ────────────────────────────────────────────────────────────────
  totalRevenue: {
    label: 'Sale Revenue',
    icon: DollarSign,
    color: 'green',
    scope: 'sold',
    formula: ['(Sale Price × Quantity) − Marketplace Commission − Shipping to Buyer'],
    description: 'Money received from sales during the selected period, after marketplace commission and shipping to the buyer are subtracted. Cancelled, returned, and disputed sales are not counted.',
    getValue: (s) => `$${s.totalRevenue.toFixed(2)}`,
    getSubtext: (s) => `${s.unitsSold ?? 0} units sold`,
  },
  grossProfit: {
    label: 'Gross Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Sale Revenue', '− Cost of Sold Items'],
    description: 'Sale Revenue minus what the sold items cost you. Cashback is not added yet.',
    getValue: (s) => `$${(s.grossProfit ?? (s.totalRevenue - (s.soldCost ?? 0))).toFixed(2)}`,
    getSubtext: () => 'sold items only',
  },
  profit: {
    label: 'Net Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Gross Profit', '+ Cashback on Sold Items'],
    description: 'Gross Profit plus the cashback earned on the units you sold. Regular business expenses, such as subscriptions, rent, or supplies, are not subtracted here.',
    getValue: (s) => `$${s.profit.toFixed(2)}`,
    getSubtext: (s) => s.profit >= 0 ? 'sold items only' : 'sold items loss',
  },
  roi: {
    label: 'ROI',
    icon: Percent,
    color: 'purple',
    scope: 'sold',
    formula: ['(Net Profit ÷ Cost of Sold Items) × 100'],
    description: 'How much Net Profit you made for each dollar spent on the items you sold. For example, 25% ROI means you made $0.25 for every $1.00 of sold-item cost. It uses your totals, not an average of each sale.',
    getValue: (s) => `${s.roi.toFixed(2)}%`,
    getSubtext: () => 'sold items only',
  },

  netMargin: {
    label: 'Net Margin',
    icon: Gauge,
    color: 'cyan',
    scope: 'sold',
    formula: ['(Net Profit ÷ Sale Revenue) × 100'],
    description: 'The percentage of Sale Revenue left as Net Profit. For example, a 20% margin means you kept $0.20 as profit for every $1.00 of Sale Revenue.',
    getValue: (s) => `${s.totalRevenue > 0 ? ((s.profit / s.totalRevenue) * 100).toFixed(2) : '0.00'}%`,
    getSubtext: () => 'sold items only',
  },
  avgSalePrice: {
    label: 'Avg Sale Price',
    icon: BarChart2,
    color: 'violet',
    scope: 'sold',
    formula: ['Sale Revenue ÷ Units Sold'],
    description: 'The average Sale Revenue kept for each unit sold, after commission and shipping to the buyer are subtracted.',
    getValue: (s) => `$${s.unitsSold > 0 ? (s.totalRevenue / s.unitsSold).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },
  avgCostPerUnit: {
    label: 'Avg Cost/Unit',
    icon: ShoppingCart,
    color: 'blue',
    scope: 'sold',
    formula: ['Cost of Sold Items ÷ Units Sold'],
    description: 'The average amount the sold units cost you. It divides the total cost of sold inventory by the number of units sold.',
    getValue: (s) => `$${s.unitsSold > 0 ? ((s.soldCost ?? 0) / s.unitsSold).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },

  inventoryQty: {
    label: 'Inventory Qty',
    icon: Package,
    color: 'sky',
    scope: 'all',
    formula: ['Unsold Units Currently On Hand Added Together'],
    description: 'How many unsold units you currently have on hand. This is a current snapshot, so the dashboard date filter does not change it.',
    getValue: (s) => s.inventoryQty ?? 0,
    getSubtext: () => 'units currently on hand',
  },

  unitsSold: {
    label: 'Units Sold',
    icon: ShoppingBag,
    color: 'green',
    scope: 'sold',
    formula: ['Units Sold During the Selected Period Added Together'],
    description: 'How many units you sold during the selected period. Cancelled, returned, and disputed sales are not counted.',
    getValue: (s) => s.unitsSold ?? 0,
    getSubtext: () => 'total sold items',
  },
};

// ── Pipeline Card Registry ─────────────────────────────────────────────────────
export const PIPELINE_CARD_REGISTRY = {
  'Pre Order':      { label: 'Pre Ordered',               icon: Clock,         color: 'indigo', description: 'Items ordered before they are available. The vendor has not sent them yet.' },
  PURCHASED:        { label: 'Purchased',                 icon: ShoppingBag,   color: 'blue',   description: 'Items you bought that have not been marked as shipped to you yet.' },
  SHIPPED:          { label: 'Inbound',                   icon: Send,          color: 'purple', description: 'Purchased items currently on the way to you.' },
  'On Hand':        { label: 'On Hand',                   icon: Package,       color: 'teal',   description: 'Unsold items you have received and currently have available.' },
  LISTED:           { label: 'Listed',                    icon: ListChecks,    color: 'amber',  description: 'On-hand items currently listed for sale.' },
  SOLD:             { label: 'Sold — Waiting to Fulfill', icon: DollarSign,    color: 'green',  description: 'Sold items that still need to be shipped or handed over.' },
  IN_TRANSIT_OUT:   { label: 'Outbound / In Progress',    icon: Truck,         color: 'sky',    description: 'Sold items on their way out, including cash-out items waiting for the provider to scan them.' },
  DELIVERED:        { label: 'Delivered / Accepted',      icon: Package,       color: 'orange', description: 'Sold items delivered to an authenticator or cash-out provider, or handed over locally.' },
  SCANNED_IN:       { label: 'Scanned In',                icon: ScanLine,      color: 'cyan',   description: 'Cash-out items the provider has confirmed receiving at its facility.' },
  AUTHENTICATION:   { label: 'Authenticating',            icon: Shield,        color: 'violet', description: 'Sold items currently being checked by a marketplace for authenticity.' },
  PENDING_PAYMENT:  { label: 'Waiting for Payment',       icon: CircleCheck,   color: 'amber',  description: 'The item has been delivered or handed over, but the payment or payout has not arrived yet.' },
  PAID:             { label: 'Paid',                      icon: CircleCheck,   color: 'emerald', description: 'Sales for which you have received the payment or payout.' },
  RETURNED:         { label: 'Returned / Failed',         icon: Undo2,         color: 'red',    description: 'Sales being returned, already returned, or rejected during authentication.' },
  DISPUTED:         { label: 'Disputed',                  icon: AlertTriangle, color: 'rose',   description: 'Sales with a payment or transaction dispute that still needs to be resolved.' },
  CANCELLED:        { label: 'Cancelled',                 icon: XCircle,       color: 'gray',   description: 'Cancelled sales kept in your history. They are not included in sales totals.' },
};

// Saved dashboard preferences used the legacy status names before the workflow
// migration. Mapping them here preserves each user's visibility and order while
// the dashboard adopts the aggregate keys now returned by analytics.
export const PIPELINE_CARD_ID_ALIASES = {
  SHIPPED_IN: 'SHIPPED',
  SHIPPED_OUT: 'IN_TRANSIT_OUT',
};

export const CHART_SERIES_REGISTRY = {
  totalCost: {
    label: 'Purchase Spend',
    icon: ShoppingCart,
    color: '#38bdf8',
    formula: ['Running Total of Purchase Spend'],
    description: 'How much you have spent buying inventory, added up day by day (or month by month) across the selected period.',
  },
  grossProfit: {
    label: 'Gross Profit',
    icon: TrendingUp,
    color: '#a78bfa',
    formula: ['Running Total of Sale Revenue Minus Cost of Sold Items'],
    description: 'Your Gross Profit (Sale Revenue minus what the sold items cost you), added up across the selected period. Cashback is not included yet.',
  },
  netProfit: {
    label: 'Net Profit',
    icon: TrendingUp,
    color: '#10b981',
    formula: ['Running Total of Gross Profit Plus Cashback on Sold Items'],
    description: 'Your Net Profit (Gross Profit plus cashback earned on sold items), added up across the selected period.',
  },
  cashback: {
    label: 'Cashback',
    icon: Tag,
    color: '#ec4899',
    formula: ['Running Total of Cashback Earned on Purchases'],
    description: 'Cashback earned from inventory purchases, added up across the selected period. Earned at the time of purchase, for every item, not just the ones you have sold.',
  },
  totalTax: {
    label: 'Tax',
    icon: Receipt,
    color: '#f97316',
    formula: ['Running Total of Purchase Sales Tax Paid'],
    description: 'Purchase sales tax paid on inventory, added up across the selected period, including items you have not sold yet.',
  },
  totalRevenue: {
    label: 'Sale Revenue',
    icon: DollarSign,
    color: '#22c55e',
    formula: ['Running Total of Sale Revenue'],
    description: 'Money received from sales, added up across the selected period, after marketplace commission and shipping to the buyer are subtracted.',
  },
  soldCost: {
    label: 'Cost of Sold Items',
    icon: ShoppingCart,
    color: '#60a5fa',
    formula: ['Running Total of Cost of Sold Items'],
    description: 'What your sold items cost you, added up across the selected period.',
  },
};

export const DASHBOARD_SECTION_REGISTRY = {
  statCards: { label: 'Summary Cards' },
  pipeline: { label: 'Status Pipeline' },
  goals: { label: 'Goals' },
  trendChart: { label: 'Middle Graph' },
  paymentMethods: { label: 'Payment Methods' },
  recentSales: { label: 'Recent Sales' },
};

export const RECENT_SALES_COLUMN_REGISTRY = {
  product: { label: 'Product', icon: Package },
  platform: { label: 'Place Sold', icon: Send },
  buyer: { label: 'Buyer', icon: Tag },
  cost: { label: 'Cost', icon: ShoppingCart },
  sale: { label: 'Sale', icon: DollarSign },
  status: { label: 'Status', icon: CircleCheck },
  date: { label: 'Date', icon: Hourglass },
};

// ── Default Settings ──────────────────────────────────────────────────────────
export const DEFAULT_DASHBOARD_SETTINGS = {
  defaultDateFilter: '30 Days',
  dashboardSections: [
    { id: 'statCards', visible: true, order: 0 },
    { id: 'pipeline', visible: true, order: 1 },
    { id: 'goals', visible: true, order: 2 },
    { id: 'trendChart', visible: true, order: 3 },
    { id: 'paymentMethods', visible: true, order: 4 },
    { id: 'recentSales', visible: true, order: 5 },
  ],
  statCards: [
    { id: 'totalCost',      visible: true,  order: 0 },
    { id: 'grossProfit',    visible: true,  order: 1 },
    { id: 'profit',         visible: true,  order: 2 },
    { id: 'totalRevenue',   visible: true,  order: 3 },
    { id: 'totalCashback',  visible: true,  order: 4 },
    { id: 'roi',            visible: false, order: 5 },

    { id: 'netMargin',      visible: false, order: 7 },
    { id: 'avgSalePrice',   visible: false, order: 8 },
    { id: 'avgCostPerUnit', visible: false, order: 9 },
    { id: 'totalTax',       visible: false, order: 10 },
    { id: 'inventoryValue', visible: false, order: 11 },

    { id: 'inventoryQty',   visible: false, order: 13 },

    { id: 'unitsSold',      visible: false, order: 15 },
  ],
  pipelineCards: [
    { id: 'Pre Order',       visible: true,  order: 0 },
    { id: 'PURCHASED',       visible: true,  order: 1 },
    { id: 'SHIPPED',         visible: true,  order: 2 },
    { id: 'On Hand',         visible: true,  order: 3 },
    { id: 'LISTED',          visible: true,  order: 4 },
    { id: 'SOLD',            visible: true,  order: 5 },
    { id: 'IN_TRANSIT_OUT',  visible: true,  order: 6 },
    { id: 'DELIVERED',       visible: true,  order: 7 },
    { id: 'SCANNED_IN',      visible: true,  order: 8 },
    { id: 'AUTHENTICATION',  visible: true,  order: 9 },
    { id: 'PENDING_PAYMENT', visible: true,  order: 10 },
    { id: 'PAID',            visible: true,  order: 11 },
    { id: 'RETURNED',        visible: false, order: 12 },
    { id: 'DISPUTED',        visible: false, order: 13 },
    { id: 'CANCELLED',       visible: false, order: 14 },
  ],
  chartSeries: [
    { id: 'totalCost',    visible: true,  order: 0 },
    { id: 'grossProfit',  visible: true,  order: 1 },
    { id: 'netProfit',    visible: true,  order: 2 },
    { id: 'cashback',     visible: true,  order: 3 },
    { id: 'totalTax',     visible: false, order: 4 },
    { id: 'totalRevenue', visible: false, order: 5 },
    { id: 'soldCost',     visible: false, order: 6 },
  ],
  recentSalesColumns: [
    { id: 'product',  visible: true, order: 0 },
    { id: 'platform', visible: true, order: 1 },
    { id: 'buyer',    visible: true, order: 2 },
    { id: 'cost',     visible: true, order: 3 },
    { id: 'sale',     visible: true, order: 4 },
    { id: 'status',   visible: true, order: 5 },
    { id: 'date',     visible: true, order: 6 },
  ],
};
