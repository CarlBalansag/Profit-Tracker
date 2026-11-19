import StatCard from '../components/UI/StatCard';
import { formatMoney } from '../utils/money';
import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../hooks/useApi';
import { useCacheArrivals, useOptionalQueryClient } from '../hooks/usePageCache';

// The same cache entries Inventory, Shipping and Statuses fill (useInventory,
// useSales), so this page can show at once when they're already loaded.
const INVENTORY_KEY = ['inventory'];
const SALES_KEY = ['sales'];
const exemptOnly = (inventory) => inventory.filter(i => i.tax_exempt === true);
import { Search, Package, DollarSign, Info } from 'lucide-react';
import { PageLoader } from '../components/PageLoader';
import LoadError from '../components/UI/LoadError';

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        aria-label={text}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="text-gray-600 hover:text-gray-400 transition-colors ml-1 flex-shrink-0"
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 bg-[#1a1a2e] border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-gray-300 leading-relaxed shadow-xl z-50 pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1a1a2e]" />
        </div>
      )}
    </span>
  );
}

const STATUS_COLORS = {
  'Pre Order':    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'On Hand':      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  PURCHASED:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  SHIPPED_IN:     'bg-purple-500/10 text-purple-400 border-purple-500/20',
  DELIVERED:      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  SCANNED_IN:     'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  LISTED:         'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SOLD:           'bg-green-500/10 text-green-400 border-green-500/20',
  SHIPPED_OUT:    'bg-sky-500/10 text-sky-400 border-sky-500/20',
  AUTHENTICATION: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  PAID:           'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  COMPLETED:      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  RETURNED:       'bg-red-500/10 text-red-400 border-red-500/20',
  DISPUTED:       'bg-rose-500/10 text-rose-400 border-rose-500/20',
  CANCELLED:      'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const QUARTERS = [
  { value: 'all', label: 'All Quarters' },
  { value: '1',   label: 'Q1 (Jan–Mar)' },
  { value: '2',   label: 'Q2 (Apr–Jun)' },
  { value: '3',   label: 'Q3 (Jul–Sep)' },
  { value: '4',   label: 'Q4 (Oct–Dec)' },
];

// A purchase's total: units at cost plus its sales tax and inbound shipping.
// Shared by the phone cards, the table rows and the Total Spend footer.
const purchaseTotal = (item) => (item.unit_purchase_cost * item.qty_purchased) + (item.sales_tax || 0) + (item.shipping_cost_inbound || 0);

const YesNo = ({ yes, tone }) => (
  <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider border ${yes ? tone : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
    {yes ? 'Yes' : 'No'}
  </span>
);

const TaxExempt = () => {
  // Start from cached inventory and sales when both are there; fetchData
  // below still refreshes them on every visit.
  const queryClient = useOptionalQueryClient();
  const [cached] = useState(() => {
    const inventory = queryClient?.getQueryData(INVENTORY_KEY);
    const salesData = queryClient?.getQueryData(SALES_KEY);
    return Array.isArray(inventory) && Array.isArray(salesData) ? { inventory, salesData } : null;
  });
  const [items, setItems] = useState(() => (cached ? exemptOnly(cached.inventory) : []));
  const [sales, setSales] = useState(cached?.salesData ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [loadFailed, setLoadFailed] = useState(false);
  const hasLoaded = useRef(Boolean(cached));

  // A hover prefetch that lands before this page's own first load shows at once.
  useCacheArrivals(queryClient, [INVENTORY_KEY, SALES_KEY], ([inventory, salesData]) => {
    if (hasLoaded.current || !Array.isArray(inventory) || !Array.isArray(salesData)) return;
    hasLoaded.current = true;
    setItems(exemptOnly(inventory));
    setSales(salesData);
    setLoadFailed(false);
    setIsLoading(false);
  });
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('purchases');
  const [filterYear, setFilterYear] = useState('all');
  const [filterQuarter, setFilterQuarter] = useState('all');

  const fetchData = async () => {
    try {
      const [invRes, salesRes] = await Promise.all([
        apiFetch(`/api/inventory`, { credentials: 'include' }),
        apiFetch(`/api/sales`, { credentials: 'include' }),
      ]);
      if (invRes.ok) {
        const data = await invRes.json();
        setItems(exemptOnly(data));
      }
      if (salesRes.ok) {
        const salesData = await salesRes.json();
        setSales(salesData);
      }
      if (invRes.ok && salesRes.ok) hasLoaded.current = true;
      // A refresh that fails keeps the cached copy that's already on screen.
      setLoadFailed(!hasLoaded.current && (!invRes.ok || !salesRes.ok));
    } catch (err) {
      console.error(err);
      setLoadFailed(!hasLoaded.current);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const retryLoad = () => { setIsLoading(true); fetchData(); };

  const q = search.toLowerCase();

  // Derive available years from purchase dates + sale dates
  const allYears = [...new Set([
    ...items.map(i => new Date(i.purchase_date).getFullYear()),
    ...sales.map(s => new Date(s.sale_date).getFullYear()),
  ])].sort((a, b) => b - a);

  // Helper: does a date pass the year/quarter filter?
  const inPeriod = (dateStr) => {
    const d = new Date(dateStr);
    const yr = d.getFullYear();
    const q = Math.ceil((d.getMonth() + 1) / 3);
    if (filterYear !== 'all' && yr !== parseInt(filterYear)) return false;
    if (filterQuarter !== 'all' && q !== parseInt(filterQuarter)) return false;
    return true;
  };

  const filteredPurchases = items.filter(i =>
    inPeriod(i.purchase_date) && (
      i.product_name.toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.vendor?.name || '').toLowerCase().includes(q)
    )
  );

  // Sales are relevant when either the purchase or the customer sale is exempt.
  const taxRelatedSales = sales
    .filter(s => s.inventory?.tax_exempt || !s.taxable || s.customer_tax_exempt)
    .map(s => ({ ...s, _inv: s.inventory }));
  const filteredSales = taxRelatedSales.filter(s =>
    inPeriod(s.sale_date) && (
      s._inv.product_name.toLowerCase().includes(q) ||
      (s._inv.category || '').toLowerCase().includes(q) ||
      (s._inv.vendor?.name || '').toLowerCase().includes(q) ||
      (s.platform?.name || '').toLowerCase().includes(q)
    )
  );

  // Stats use period-filtered data too
  const periodSales = taxRelatedSales.filter(s => inPeriod(s.sale_date));
  const periodAllSales = sales.filter(s => inPeriod(s.sale_date));
  const periodItems = items.filter(i => inPeriod(i.purchase_date));

  // Stats scoped to the selected period
  const nonTaxableSales = periodSales.filter(s => !s.taxable);
  const exemptSalesPct = periodAllSales.length > 0 ? ((nonTaxableSales.length / periodAllSales.length) * 100) : 0;
  const useTaxDue = periodItems.reduce((sum, i) => sum + (i.sales_tax || 0), 0);
  const exemptCOGS = periodSales.reduce((sum, s) => sum + (s._inv.unit_purchase_cost * s.quantity), 0);
  const exemptInventorySpend = periodItems.reduce((sum, i) => sum + (i.unit_purchase_cost * i.qty_purchased) + (i.sales_tax || 0) + (i.shipping_cost_inbound || 0), 0);
  const exemptRevenue = periodSales.reduce((sum, s) => sum + (s.unit_price * s.quantity), 0);
  // Shown as its own line below (ideas.md #4: the $12.90 commission+shipping
  // deduction was silently folded into Exempt Profit with no visible total).
  const exemptFeesAndShipping = periodSales.reduce((sum, s) => sum + (s.commission_fee || 0) + (s.sale_shipping || 0), 0);
  const exemptProfit = exemptRevenue - exemptCOGS - exemptFeesAndShipping;

  const tabs = [
    { id: 'purchases', label: 'Purchases', icon: Package, count: filteredPurchases.length },
    { id: 'sales',     label: 'Sales',     icon: DollarSign, count: filteredSales.length },
  ];

  if (loadFailed) return <LoadError title="Tax Exempt" what="your tax-exempt records" onRetry={retryLoad} retrying={isLoading} />;
  if (isLoading) return <PageLoader variant="taxexempt" />;

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="h-full overflow-auto">
    <div className="w-full max-w-6xl mx-auto space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tax Exempt</h1>
          <p className="text-gray-400 text-sm mt-1">Transactions marked as tax exempt</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by year"
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
          >
            <option value="all">All Years</option>
            {allYears.map(yr => (
              <option key={yr} value={yr}>{yr}</option>
            ))}
          </select>
          <select
            aria-label="Filter by quarter"
            value={filterQuarter}
            onChange={e => setFilterQuarter(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
          >
            {QUARTERS.map(q => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Top row — 4 primary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
        <StatCard
          label="Tax-Exempt Sales"
          info={<InfoTooltip text="Total revenue from sales marked as non-taxable (taxable = No)." />}
          value={`$${formatMoney(exemptRevenue)}`}
          tone="green"
          sub="Non-taxable sales"
        />
        <StatCard
          label="Exempt Sales %"
          info={<InfoTooltip text="Percentage of your total sale transactions that are non-taxable." />}
          value={`${exemptSalesPct.toFixed(1)}%`}
          tone="accent"
          sub="of total transactions"
        />
        <StatCard
          label="Use Tax Due"
          info={<InfoTooltip text="Sales tax you paid when purchasing exempt inventory. This may be reportable or recoverable depending on your state." />}
          value={`$${formatMoney(useTaxDue)}`}
          tone="amber"
          sub="From exempt purchases"
        />
        <StatCard
          label="Exempt Transactions"
          info={<InfoTooltip text="Total number of individual sale records where the sale was marked non-taxable." />}
          value={nonTaxableSales.length}
          sub="Non-taxable sale records"
        />
      </div>

      {/* Second row — 5 smaller inventory/P&L metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 -mt-2">
        <StatCard
          label="Exempt Inv. Purchased"
          info={<InfoTooltip text="Total amount spent buying tax-exempt inventory (unit cost × qty + tax + inbound shipping)." />}
          value={`$${formatMoney(exemptInventorySpend)}`}
        />
        <StatCard
          label="Exempt COGS"
          info={<InfoTooltip text="Cost of goods sold — unit purchase cost × quantity sold for exempt inventory items." />}
          value={`$${formatMoney(exemptCOGS)}`}
        />
        <StatCard
          label="Exempt Revenue"
          info={<InfoTooltip text="Total sale revenue generated from tax-exempt inventory items." />}
          value={`$${formatMoney(exemptRevenue)}`}
          tone="green"
        />
        <StatCard
          label="Fees &amp; Shipping"
          info={<InfoTooltip text="Platform commission fees plus outbound sale shipping, deducted from revenue to reach Exempt Profit." />}
          value={`−$${formatMoney(exemptFeesAndShipping)}`}
          tone="amber"
        />
        <StatCard
          label="Exempt Profit"
          info={<InfoTooltip text="Revenue minus COGS minus platform fees and shipping for all exempt inventory sales." />}
          value={`$${formatMoney(exemptProfit)}`}
          tone={exemptProfit >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Chrome-style tabs + Search row */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5 w-max overflow-x-auto max-w-full">
          {tabs.map(({ id, label, icon, count }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'text-white bg-white/[0.08] border border-white/10 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
                }`}
              >
                {React.createElement(icon, { className: `w-4 h-4 ${active ? 'text-blue-400' : ''}` })}
                {label}
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-gray-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search" placeholder="Search..."
            className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 text-sm">Loading...</div>
        ) : tab === 'purchases' ? (
          filteredPurchases.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No tax exempt purchases found</p>
              <p className="text-gray-600 text-xs mt-1">Mark items as tax exempt when adding or editing a transaction</p>
            </div>
          ) : (
            <>
            {/* Phones: one card per purchase, every column visible without scrolling sideways. */}
            <ul className="md:hidden divide-y divide-white/[0.04]">
              {filteredPurchases.map(item => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-white font-medium leading-snug">{item.product_name}</p>
                    <p className="shrink-0 text-right text-white font-semibold tabular-nums">${formatMoney(purchaseTotal(item))}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(item.purchase_date).toLocaleDateString()} · {item.vendor?.name || '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400 tabular-nums">
                    {item.qty_purchased} × ${formatMoney(item.unit_purchase_cost)}
                  </p>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
                <span className="text-xs font-semibold text-gray-400">Total Spend</span>
                <span className="font-bold text-white tabular-nums">${formatMoney(filteredPurchases.reduce((sum, i) => sum + purchaseTotal(i), 0))}</span>
              </li>
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-right">Quantity</th>
                    <th className="px-4 py-3 text-right">Unit Cost</th>
                    <th className="px-4 py-3 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredPurchases.map(item => {
                    const totalCost = purchaseTotal(item);
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{item.product_name}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {new Date(item.purchase_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{item.vendor?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{item.qty_purchased}</td>
                        <td className="px-4 py-3 text-right text-gray-200">${formatMoney(item.unit_purchase_cost)}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">${formatMoney(totalCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/[0.08] bg-white/[0.02]">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-400 text-right">Total Spend</td>
                    <td className="px-4 py-3 text-right font-bold text-white">
                      ${formatMoney(filteredPurchases.reduce((sum, i) => sum + purchaseTotal(i), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )
        ) : (
          filteredSales.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No sales from tax exempt items</p>
              <p className="text-gray-600 text-xs mt-1">Sales linked to tax exempt inventory will appear here</p>
            </div>
          ) : (
            <>
            <ul className="md:hidden divide-y divide-white/[0.04]">
              {filteredSales.map(sale => (
                <li key={sale.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-white font-medium leading-snug">{sale._inv.product_name}</p>
                    <p className="shrink-0 text-right text-green-400 font-semibold tabular-nums">${formatMoney(sale.unit_price * sale.quantity)}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(sale.sale_date).toLocaleDateString()} · {sale.platform?.name || '—'}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2"><dt className="text-gray-500">Taxable</dt><dd><YesNo yes={sale.taxable} tone="bg-amber-500/10 text-amber-400 border-amber-500/20" /></dd></div>
                    <div className="flex items-center justify-between gap-2"><dt className="text-gray-500">Tax collected</dt><dd className="text-blue-400 tabular-nums">{sale.sale_tax_collected > 0 ? `$${formatMoney(Number(sale.sale_tax_collected))}` : '—'}</dd></div>
                    <div className="flex items-center justify-between gap-2"><dt className="text-gray-500">Customer exempt</dt><dd><YesNo yes={sale.customer_tax_exempt} tone="bg-green-500/10 text-green-400 border-green-500/20" /></dd></div>
                    <div className="flex items-center justify-between gap-2"><dt className="text-gray-500">Exemption</dt><dd className="text-gray-300 text-right">{sale.exemption_type || '—'}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Date Sold</th>
                    <th className="px-4 py-3 text-left">Place Sold</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-center">Taxable</th>
                    <th className="px-4 py-3 text-right">Tax Collected</th>
                    <th className="px-4 py-3 text-center">Customer Exempt</th>
                    <th className="px-4 py-3 text-left">Exemption Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredSales.map(sale => {
                    const saleTotal = sale.unit_price * sale.quantity;
                    return (
                      <tr key={sale.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{sale._inv.product_name}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {new Date(sale.sale_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{sale.platform?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-green-400 font-medium">${formatMoney(saleTotal)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider border ${sale.taxable ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {sale.taxable ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-blue-400">
                          {sale.sale_tax_collected > 0 ? `$${formatMoney(Number(sale.sale_tax_collected))}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider border ${sale.customer_tax_exempt ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {sale.customer_tax_exempt ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{sale.exemption_type || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )
        )}
      </div>
    </div>
    </div>
  );
};

export default TaxExempt;
