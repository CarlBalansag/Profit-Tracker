import {
  ShoppingCart, DollarSign, Tag, TrendingUp, Percent,
  Scissors, Gauge, BarChart2, Receipt, Warehouse, Zap,
  ShoppingBag, Send, Package, ScanLine, CircleCheck, ListChecks,
  Undo2, AlertTriangle, XCircle, Hourglass, Truck, Shield, Clock
} from 'lucide-react';

// ── Stat Card Registry ────────────────────────────────────────────────────────
// scope: 'all'  → includes all purchases (sold + unsold)
// scope: 'sold' → sold items only
export const STAT_CARD_REGISTRY = {

  // ── ALL PURCHASES ────────────────────────────────────────────────────────────
  totalCost: {
    label: 'Total Cost',
    icon: ShoppingCart,
    color: 'blue',
    scope: 'all',
    formula: ['Item Price × Qty', '+ Tax', '+ Inbound Shipping', 'All purchases in period'],
    getValue: (s) => `$${s.totalCost.toFixed(2)}`,
    getSubtext: (s) => `${s.transactionCount} purchases`,
  },
  totalCashback: {
    label: 'Cashback',
    icon: Tag,
    color: 'pink',
    scope: 'all',
    formula: ['Total Purchase Cost × Card Cashback Rate %', 'Earned at point of purchase'],
    getValue: (s) => `$${s.totalCashback.toFixed(2)}`,
    getSubtext: (s) => `${s.avgCashbackRate.toFixed(2)}% avg rate`,
  },
  totalTax: {
    label: 'Total Tax Paid',
    icon: Receipt,
    color: 'orange',
    scope: 'all',
    formula: ['Sum of sales tax across all purchases'],
    getValue: (s) => `$${(s.totalTax ?? 0).toFixed(2)}`,
    getSubtext: () => 'all purchases',
  },
  inventoryValue: {
    label: 'Inventory Value',
    icon: Warehouse,
    color: 'sky',
    scope: 'all',
    formula: ['Qty On Hand × Unit Cost', 'Current unsold stock at cost'],
    getValue: (s) => `$${(s.inventoryValue ?? 0).toFixed(2)}`,
    getSubtext: () => 'unsold stock at cost',
  },

  // ── SOLD ONLY ────────────────────────────────────────────────────────────────
  totalRevenue: {
    label: 'Sale Revenue',
    icon: DollarSign,
    color: 'green',
    scope: 'sold',
    formula: ['(Sale Price × Qty) − Commission Fee', 'Net revenue after platform fees'],
    getValue: (s) => `$${s.totalRevenue.toFixed(2)}`,
    getSubtext: (s) => `${s.salesCount} items sold`,
  },
  grossProfit: {
    label: 'Gross Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Sale Revenue', '− Sold Cost Basis'],
    getValue: (s) => `$${(s.grossProfit ?? (s.totalRevenue - (s.soldCost ?? 0))).toFixed(2)}`,
    getSubtext: () => 'sold items only',
  },
  profit: {
    label: 'Net Profit',
    icon: TrendingUp,
    color: 'emerald',
    scope: 'sold',
    formula: ['Gross Profit', '+ Sold-Item Cashback'],
    getValue: (s) => `$${s.profit.toFixed(2)}`,
    getSubtext: (s) => s.profit >= 0 ? 'sold items only' : 'sold items loss',
  },
  roi: {
    label: 'Avg ROI',
    icon: Percent,
    color: 'purple',
    scope: 'sold',
    formula: ['(Net Profit ÷ Sold Cost Basis) × 100'],
    getValue: (s) => `${s.roi.toFixed(2)}%`,
    getSubtext: () => 'sold items only',
  },

  netMargin: {
    label: 'Net Margin',
    icon: Gauge,
    color: 'cyan',
    scope: 'sold',
    formula: ['(Net Profit ÷ Sale Revenue) × 100'],
    getValue: (s) => `${s.totalRevenue > 0 ? ((s.profit / s.totalRevenue) * 100).toFixed(2) : '0.00'}%`,
    getSubtext: () => 'sold items only',
  },
  avgSalePrice: {
    label: 'Avg Sale Price',
    icon: BarChart2,
    color: 'violet',
    scope: 'sold',
    formula: ['Total Revenue ÷ Units Sold'],
    getValue: (s) => `$${s.salesCount > 0 ? (s.totalRevenue / s.salesCount).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },
  avgCostPerUnit: {
    label: 'Avg Cost/Unit',
    icon: ShoppingCart,
    color: 'blue',
    scope: 'sold',
    formula: ['Sold Cost Basis ÷ Units Sold'],
    getValue: (s) => `$${s.salesCount > 0 ? ((s.soldCost ?? 0) / s.salesCount).toFixed(2) : '0.00'}`,
    getSubtext: () => 'sold items only',
  },

  inventoryQty: {
    label: 'Inventory Qty',
    icon: Package,
    color: 'sky',
    scope: 'all',
    formula: ['Sum of Qty On Hand across all inventory'],
    getValue: (s) => s.inventoryQty ?? 0,
    getSubtext: () => 'units currently on hand',
  },

  unitsSold: {
    label: 'Units Sold',
    icon: ShoppingBag,
    color: 'green',
    scope: 'sold',
    formula: ['Sum of all quantities sold'],
    getValue: (s) => s.unitsSold ?? 0,
    getSubtext: () => 'total sold items',
  },
};

// ── Pipeline Card Registry ─────────────────────────────────────────────────────
export const PIPELINE_CARD_REGISTRY = {
  'Pre Order':     { label: 'Pre Ordered',      icon: Clock,           color: 'indigo' },
  'On Hand':       { label: 'On Hand',         icon: Package,         color: 'teal' },
  PURCHASED:       { label: 'Purchased',      icon: ShoppingBag,     color: 'blue' },
  SHIPPED_IN:      { label: 'Shipped In',      icon: Send,            color: 'purple' },
  DELIVERED:       { label: 'Delivered',       icon: Package,         color: 'orange' },
  SCANNED_IN:      { label: 'Scanned In',      icon: ScanLine,        color: 'cyan' },
  LISTED:          { label: 'Listed',          icon: ListChecks,      color: 'amber' },
  SOLD:            { label: 'Sold',            icon: DollarSign,      color: 'green' },
  SHIPPED_OUT:     { label: 'Shipped Out',     icon: Truck,           color: 'sky' },
  AUTHENTICATION:  { label: 'Authenticating',  icon: Shield,          color: 'violet' },
  PAID:            { label: 'Paid',            icon: CircleCheck,     color: 'emerald' },
  COMPLETED:       { label: 'Completed',       icon: CircleCheck,     color: 'teal' },
  RETURNED:        { label: 'Returned',        icon: Undo2,           color: 'red' },
  DISPUTED:        { label: 'Disputed',        icon: AlertTriangle,   color: 'rose' },
  CANCELLED:       { label: 'Cancelled',       icon: XCircle,         color: 'gray' },
};

export const CHART_SERIES_REGISTRY = {
  totalCost: {
    label: 'Total Cost',
    icon: ShoppingCart,
    color: '#38bdf8',
    formula: ['Cumulative purchase spend', 'Item cost + tax + inbound shipping'],
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
    formula: ['Sale price x quantity', '- commission fee'],
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
    { id: 'COMPLETED',      visible: true,  order: 11 },
    { id: 'RETURNED',       visible: false, order: 12 },
    { id: 'DISPUTED',       visible: false, order: 13 },
    { id: 'CANCELLED',      visible: false, order: 14 },
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
