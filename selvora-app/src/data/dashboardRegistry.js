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
    formula: ['(Item Price × Qty) + Tax + Inbound Shipping + Fees', '− Gift Cards', 'All purchases in period'],
    description: 'Purchase Spend is the amount invested in inventory during the selected period, after gift cards and including purchase tax, inbound shipping, and fees.',
    getValue: (s) => `$${s.totalCost.toFixed(2)}`,
    getSubtext: (s) => `${s.transactionCount} purchases`,
  },
  totalCashback: {
    label: 'Cashback',
    icon: Tag,
    color: 'pink',
    scope: 'all',
    formula: ['Total Purchase Cost × Card Cashback Rate %', 'Earned at point of purchase'],
    description: 'Cashback is earned from purchases. In the All view it includes sold and unsold inventory; sales-channel views include only cashback allocated to sold units.',
    getValue: (s) => `$${s.totalCashback.toFixed(2)}`,
    getSubtext: (s) => `${s.avgCashbackRate.toFixed(2)}% avg rate`,
  },
  totalTax: {
    label: 'Total Tax Paid',
    icon: Receipt,
    color: 'orange',
    scope: 'all',
    formula: ['Sum of sales tax across all purchases'],
    description: 'Total Tax Paid is the purchase sales tax recorded for inventory bought during the selected period.',
    getValue: (s) => `$${(s.totalTax ?? 0).toFixed(2)}`,
    getSubtext: () => 'all purchases',
  },
  inventoryValue: {
    label: 'Inventory Value',
    icon: Warehouse,
    color: 'sky',
    scope: 'all',
    formula: ['Qty On Hand × Unit Cost', 'Current unsold stock at cost'],
    description: 'Inventory Value is the cost basis of all unsold units currently on hand, regardless of the dashboard date filter.',
    getValue: (s) => `$${(s.inventoryValue ?? 0).toFixed(2)}`,
    getSubtext: () => 'unsold stock at cost',
  },

  // ── SOLD ONLY ────────────────────────────────────────────────────────────────
  totalRevenue: {
    label: 'Sale Revenue',
    icon: DollarSign,
    color: 'green',
    scope: 'sold',
    formula: ['(Sale Price × Qty) − Commission Fee − Outbound Shipping', 'Realized sales only'],
    description: 'Sale Revenue is money from realized sales after commission fees and outbound shipping.',
    getValue: (s) => `$${s.totalRevenue.toFixed(2)}`,
    getSubtext: (s) => `${s.unitsSold ?? 0} units sold`,
  },
  grossProfit: {
    label: 'Gross Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Sale Revenue', '− Sold Cost Basis'],
    description: 'Gross Profit is realized sale revenue minus the cost basis of sold units, before cashback.',
    getValue: (s) => `$${(s.grossProfit ?? (s.totalRevenue - (s.soldCost ?? 0))).toFixed(2)}`,
    getSubtext: () => 'sold items only',
  },
  profit: {
    label: 'Net Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Gross Profit', '+ Sold-Item Cashback'],
    description: 'Net Profit is realized merchandise profit plus cashback allocated to sold units. It does not deduct separate operating expenses.',
    getValue: (s) => `$${s.profit.toFixed(2)}`,
    getSubtext: (s) => s.profit >= 0 ? 'sold items only' : 'sold items loss',
  },
  roi: {
    label: 'ROI',
    icon: Percent,
    color: 'purple',
    scope: 'sold',
    formula: ['(Net Profit ÷ Sold Cost Basis) × 100'],
    description: 'ROI compares total realized net profit with the total cost basis of sold units; it is not an average of individual sale percentages.',
    getValue: (s) => `${s.roi.toFixed(2)}%`,
    getSubtext: () => 'sold items only',
  },

  netMargin: {
    label: 'Net Margin',
    icon: Gauge,
    color: 'cyan',
    scope: 'sold',
    formula: ['(Net Profit ÷ Sale Revenue) × 100'],
    description: 'Net Margin is the percentage of realized sale revenue that remains as net profit, including sold-item cashback.',
    getValue: (s) => `${s.totalRevenue > 0 ? ((s.profit / s.totalRevenue) * 100).toFixed(2) : '0.00'}%`,
    getSubtext: () => 'sold items only',
  },
  avgSalePrice: {
    label: 'Avg Sale Price',
    icon: BarChart2,
    color: 'violet',
    scope: 'sold',
    formula: ['Total Revenue ÷ Units Sold'],
    description: 'Avg Sale Price is the average realized revenue received per unit sold, after commission and outbound shipping.',
    getValue: (s) => `$${s.unitsSold > 0 ? (s.totalRevenue / s.unitsSold).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },
  avgCostPerUnit: {
    label: 'Avg Cost/Unit',
    icon: ShoppingCart,
    color: 'blue',
    scope: 'sold',
    formula: ['Sold Cost Basis ÷ Units Sold'],
    description: 'Avg Cost/Unit is the average purchase cost basis allocated to each unit sold.',
    getValue: (s) => `$${s.unitsSold > 0 ? ((s.soldCost ?? 0) / s.unitsSold).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },

  inventoryQty: {
    label: 'Inventory Qty',
    icon: Package,
    color: 'sky',
    scope: 'all',
    formula: ['Sum of Qty On Hand across all inventory'],
    description: 'Inventory Qty is the total number of unsold units currently on hand, regardless of the dashboard date filter.',
    getValue: (s) => s.inventoryQty ?? 0,
    getSubtext: () => 'units currently on hand',
  },

  unitsSold: {
    label: 'Units Sold',
    icon: ShoppingBag,
    color: 'green',
    scope: 'sold',
    formula: ['Sum of all quantities sold'],
    description: 'Units Sold is the quantity sold during the selected period, excluding cancelled, returned, and disputed sales.',
    getValue: (s) => s.unitsSold ?? 0,
    getSubtext: () => 'total sold items',
  },
};

// ── Pipeline Card Registry ─────────────────────────────────────────────────────
export const PIPELINE_CARD_REGISTRY = {
  'Pre Order':     { label: 'Pre Ordered',    icon: Clock,         color: 'indigo', description: 'Units ordered before the vendor has released or fulfilled them.' },
  'On Hand':       { label: 'On Hand',        icon: Package,       color: 'teal',   description: 'Unsold units that have been received and are physically available.' },
  PURCHASED:       { label: 'Purchased',      icon: ShoppingBag,   color: 'blue',   description: 'Units ordered from a vendor but not yet tracked as an inbound shipment.' },
  SHIPPED_IN:      { label: 'Shipped In',     icon: Send,          color: 'purple', description: 'Units currently traveling inbound from the vendor.' },
  DELIVERED:       { label: 'Delivered',      icon: Package,       color: 'orange', description: 'Inbound units delivered to the destination but not yet moved to the next stage.' },
  SCANNED_IN:      { label: 'Scanned In',     icon: ScanLine,      color: 'cyan',   description: 'Units scanned into inventory or acknowledged by a supported cash-out workflow.' },
  LISTED:          { label: 'Listed',         icon: ListChecks,    color: 'amber',  description: 'Unsold units currently listed for sale.' },
  SOLD:            { label: 'Sold',           icon: DollarSign,    color: 'green',  description: 'Sold units waiting for the next fulfillment step.' },
  SHIPPED_OUT:     { label: 'Shipped Out',    icon: Truck,         color: 'sky',    description: 'Sold units traveling to a buyer, marketplace, authenticator, or cash-out provider.' },
  AUTHENTICATION:  { label: 'Authenticating', icon: Shield,        color: 'violet', description: 'Units undergoing marketplace authentication.' },
  PAID:            { label: 'Paid',           icon: CircleCheck,   color: 'emerald', description: 'Sales for which payment or payout has been received.' },
  RETURNED:        { label: 'Returned',       icon: Undo2,         color: 'red',    description: 'Units returned by a buyer or selling platform.' },
  DISPUTED:        { label: 'Disputed',       icon: AlertTriangle, color: 'rose',   description: 'Sales with an active payment or transaction dispute.' },
  CANCELLED:       { label: 'Cancelled',      icon: XCircle,       color: 'gray',   description: 'Sales that were cancelled and remain available for historical tracking.' },
};

export const CHART_SERIES_REGISTRY = {
  totalCost: {
    label: 'Purchase Spend',
    icon: ShoppingCart,
    color: '#38bdf8',
    formula: ['Cumulative purchase spend', 'Item cost + tax + inbound shipping + fees − gift cards'],
  },
  grossProfit: {
    label: 'Gross Profit',
    icon: TrendingUp,
    color: '#a78bfa',
    formula: ['Sale revenue', '- sold cost basis'],
  },
  netProfit: {
    label: 'Net Profit',
    icon: TrendingUp,
    color: '#10b981',
    formula: ['Gross profit', '+ cashback earned'],
  },
  cashback: {
    label: 'Cashback',
    icon: Tag,
    color: '#ec4899',
    formula: ['All purchase cost × card cashback rate', 'Earned at point of purchase (all items)'],
  },
  totalTax: {
    label: 'Tax',
    icon: Receipt,
    color: '#f97316',
    formula: ['Cumulative sales tax paid', 'All purchases (sold + unsold)'],
  },
  totalRevenue: {
    label: 'Sale Revenue',
    icon: DollarSign,
    color: '#22c55e',
    formula: ['Sale price x quantity', '− commission fee − outbound shipping'],
  },
  soldCost: {
    label: 'Sold Cost Basis',
    icon: ShoppingCart,
    color: '#60a5fa',
    formula: ['Cost basis for sold items only', 'Item cost + allocated tax + allocated shipping'],
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
    { id: 'On Hand',         visible: true,  order: 1 },
    { id: 'PURCHASED',      visible: true,  order: 2 },
    { id: 'SHIPPED_IN',     visible: true,  order: 3 },
    { id: 'DELIVERED',      visible: true,  order: 4 },
    { id: 'SCANNED_IN',     visible: true,  order: 5 },
    { id: 'LISTED',         visible: true,  order: 6 },
    { id: 'SOLD',           visible: true,  order: 7 },
    { id: 'SHIPPED_OUT',    visible: true,  order: 8 },
    { id: 'AUTHENTICATION', visible: true,  order: 9 },
    { id: 'PAID',           visible: true,  order: 10 },
    { id: 'RETURNED',       visible: false, order: 11 },
    { id: 'DISPUTED',       visible: false, order: 12 },
    { id: 'CANCELLED',      visible: false, order: 13 },
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
