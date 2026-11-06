import StatCard from '../components/UI/StatCard';
import { Link } from 'react-router-dom';
import { csvText, downloadFile } from '../utils/downloads';
import { allocatedCost, roundCents } from '../../../shared/finance.mjs';
import React, { useState } from 'react';
import { useInventory } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { Columns3, Plus, Search, Package, AlertTriangle, TrendingUp, DollarSign, Clock, ListChecks, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import ProductNoteButton from '../components/ProductNoteButton';
import ReturnWindowBadge from '../components/ReturnWindowBadge';
import { returnWindowStatus } from '../utils/returnWindow';
import { recordStatusLabel } from '../data/statusWorkflow';
import LoadError from '../components/UI/LoadError';

// The batch whose return window runs out first, so a collapsed group still
// warns about it. Closed windows only count when no batch is still open.
const soonestReturnWindow = (entries) => entries
  .filter(entry => returnWindowStatus(entry))
  .sort((a, b) => {
    const sa = returnWindowStatus(a), sb = returnWindowStatus(b);
    if ((sa.daysLeft < 0) !== (sb.daysLeft < 0)) return sa.daysLeft < 0 ? 1 : -1;
    return sa.daysLeft - sb.daysLeft;
  })[0] || null;

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

// Always two decimals, rounded the way the API rounds, so these match Analytics.
const money = (value) => roundCents(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Inventory = () => {
  const { data: rawInventory = [], isLoading, isLoadingError, refetch } = useInventory();
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const toggleGroup = (name) => setExpandedGroups(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const exportReport = () => {
    downloadFile('inventory-on-hand.csv', csvText(processedInventory.map(item => ({
      Product: item.product_name,
      Category: item.category || '',
      Store: item.vendor?.name || '',
      'Purchase Date': item.purchase_date ? new Date(item.purchase_date).toLocaleDateString() : '',
      Quantity: item.qty_on_hand,
      'Cost per Unit': money(allocatedCost(item, 1)),
      'Total Cost': money(allocatedCost(item, item.qty_on_hand)),
      'Days Held': item.daysInInv,
      Status: recordStatusLabel(item.status),
    }))), 'text/csv');
  };

  const ebayUrl = (productName) =>
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(productName)}&LH_Sold=1&LH_Complete=1&_sop=13`;

  const inventory = rawInventory.filter(item => item.qty_on_hand > 0);

  const today = new Date();
  const processedInventory = inventory.map(item => {
    const isPreOrder = item.status?.toUpperCase().includes('PRE');
    let daysInInv = 0;
    if (!isPreOrder) {
      const startDate = new Date(item.received_date || item.purchase_date);
      daysInInv = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
    }
    return { ...item, daysInInv: daysInInv >= 0 ? daysInInv : 0 };
  });

  // Group by product_name, sorted by most recently purchased first
  const grouped = Object.values(
    processedInventory.reduce((acc, item) => {
      const key = item.product_name;
      if (!acc[key]) {
        acc[key] = { product_name: key, entries: [], totalQty: 0, totalCost: 0, oldestDays: 0 };
      }
      acc[key].entries.push(item);
      acc[key].totalQty += item.qty_on_hand;
      if (item.qty_on_hand > 0) acc[key].oldestDays = Math.max(acc[key].oldestDays, item.daysInInv);
      acc[key].totalCost += allocatedCost(item, item.qty_on_hand);
      return acc;
    }, {})
  ).sort((a, b) =>
    new Date(b.entries[0].purchase_date) - new Date(a.entries[0].purchase_date)
  );

  // Summary card totals stay on the flat list so numbers are always correct
  const totalCapital = processedInventory.reduce((sum, item) => sum + allocatedCost(item, item.qty_on_hand), 0);
  const totalUnits = processedInventory.reduce((sum, item) => sum + item.qty_on_hand, 0);
  const agingUnits = processedInventory.filter(i => i.daysInInv > 30).reduce((sum, item) => sum + item.qty_on_hand, 0);
  // Same rule as the Listed count on Analytics: is_listed is the real flag, and older rows only have the status.
  const activeListings = processedInventory.filter(i => i.is_listed || (!i.receiving_status && i.status === 'LISTED')).reduce((sum, item) => sum + item.qty_on_hand, 0);

  if (isLoading) return <PageLoader variant="table" />;
  if (isLoadingError) return <LoadError title="Inventory On Hand" what="your inventory" onRetry={() => refetch()} />;

  return (
    <div className="h-full overflow-auto px-4 py-6 sm:px-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Inventory On Hand</h1>
          <p className="text-gray-400 text-sm mt-1">Manage unsold assets, track aging stock, and calculate locked capital.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportReport} className="page-btn page-btn-secondary">
            Export Report
          </button>
          <Link to="/add-transaction" className="page-btn page-btn-primary">
            <Plus className="w-4 h-4" /> 
            Add Inventory
          </Link>
        </div>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 animate-in slide-in-from-bottom-4 duration-500 fade-in fill-mode-both">
        <StatCard label="Inventory Total Cost" value={`$${money(totalCapital)}`} icon={DollarSign} iconColor="var(--accent)" />
        <StatCard label="Unsold Units" value={totalUnits} icon={Package} />
        <StatCard label="Aging Stock (30+ Days)" value={`${agingUnits} units`} sub="Needs liquidation planning" icon={AlertTriangle} tone="red" />
        <StatCard label="Active Listings" value={`${activeListings} units`} sub="Currently listed for sale" icon={ListChecks} tone="amber" />
      </div>
      
      {/* Filters Card */}
      <div className="card p-4 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-300 fill-mode-both">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              aria-label="Search by product name or category" placeholder="Search by product name or category..." 
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors" 
            />
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card overflow-x-auto bg-[#0f1115] animate-in slide-in-from-bottom-4 duration-500 fade-in delay-500 fill-mode-both">
        <table className="phone-cards w-full text-left whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.06] text-[11px] uppercase font-semibold text-gray-500 tracking-widest bg-black/20">
              <th className="px-4 py-4 min-w-[250px]">Product Name</th>
              <th className="px-4 py-4 w-24 text-center">Qty</th>
              <th className="px-4 py-4 w-32">Aging</th>
              <th className="px-4 py-4 min-w-[120px]">Total Cost Basis</th>
              <th className="px-4 py-4 w-32">eBay Sold</th>
              <th className="px-4 py-4 min-w-[140px]">Current Status</th>
              <th className="px-4 py-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {grouped.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-4 py-16 text-center">
                  <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No inventory items found.</p>
                  <p className="text-gray-600 text-xs mt-1">Add a transaction to generate inventory.</p>
                </td>
              </tr>
            ) : grouped.map((group) => {
              const isMulti = group.entries.length > 1;
              const isOpen = expandedGroups.has(group.product_name);

              // ── Single-entry group: render exactly like the old flat row ──
              if (!isMulti) {
                const item = group.entries[0];
                const isAging = item.daysInInv > 30;
                const isCritical = item.daysInInv > 90;
                return (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-5">
                      <div className="flex items-center gap-1">
                        <div>
                          <p className="text-sm font-semibold text-gray-200">{item.product_name}</p>
                          <span className="text-[11px] text-gray-400">{item.category || 'Uncategorized'}</span>
                          <div><ReturnWindowBadge item={item} className="mt-1" /></div>
                        </div>
                        <ProductNoteButton productName={item.product_name} />
                      </div>
                    </td>
                    <td data-label="Qty" className="px-4 py-5 text-center">
                      <span className="inline-flex items-center justify-center min-w-8 px-2 py-1 rounded bg-white/5 text-sm font-bold text-white border border-white/10">
                        {item.qty_on_hand}
                      </span>
                    </td>
                    <td data-label="Aging" className="px-4 py-5">
                      <div className="flex items-center gap-1.5">
                        <Clock className={`w-3.5 h-3.5 ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-500'}`} />
                        <span className={`text-xs font-medium ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-400'}`}>
                          {item.daysInInv} days
                        </span>
                      </div>
                    </td>
                    <td data-label="Cost" className="px-4 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-300">${money(allocatedCost(item, item.qty_on_hand))}</span>
                        <span className="text-[11px] text-gray-500">${money(allocatedCost(item, 1))} / unit</span>
                      </div>
                    </td>
                    <td data-label="eBay Sold" className="px-4 py-5">
                      <a href={ebayUrl(item.product_name)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0f] hover:bg-white/5 border border-white/10 hover:border-blue-500/40 rounded-lg transition-colors text-gray-500 hover:text-blue-400">
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-medium">eBay sold prices</span>
                      </a>
                    </td>
                    <td data-label="Status" className="px-4 py-5">
                      <span className={`px-2 py-1 rounded text-[11px] font-bold tracking-wider border uppercase ${STATUS_COLORS[item.status] || STATUS_COLORS.PURCHASED}`}>
                        {recordStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-5 text-right">
                      <Link to="/add-sale" state={{ inventoryId: item.id }} aria-label={`Sell ${item.product_name}`} className="page-btn page-btn-secondary page-btn-sm">
                        Sell
                      </Link>
                    </td>
                  </tr>
                );
              }

              // ── Multi-entry group: header row + expandable child rows ──
              return (
                <React.Fragment key={group.product_name}>
                  {/* Group header row */}
                  <tr
                    className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    onClick={() => toggleGroup(group.product_name)}
                  >
                    <td className="px-4 py-5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} batches for ${group.product_name}`}
                          onClick={(e) => { e.stopPropagation(); toggleGroup(group.product_name); }}
                          className="-m-1 p-1 rounded flex-shrink-0"
                        >
                          {isOpen
                            ? <ChevronDown className="w-4 h-4 text-gray-400" />
                            : <ChevronRight className="w-4 h-4 text-gray-500" />
                          }
                        </button>
                        <div>
                          <p className="text-sm font-semibold text-gray-200">{group.product_name}</p>
                          <span className="text-[11px] text-gray-500">{group.entries.length} purchase entries</span>
                          {soonestReturnWindow(group.entries) && <div><ReturnWindowBadge item={soonestReturnWindow(group.entries)} className="mt-1" /></div>}
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <ProductNoteButton productName={group.product_name} />
                        </div>
                      </div>
                    </td>
                    <td data-label="Qty" className="px-4 py-5 text-center">
                      <span className="inline-flex items-center justify-center min-w-8 px-2 py-1 rounded bg-white/5 text-sm font-bold text-white border border-white/10">
                        {group.totalQty}
                      </span>
                    </td>
                    {/* Aging — the oldest batch, since that is what the Aging Stock card counts */}
                    <td data-label="Aging" className="px-4 py-5">
                      <div className="flex items-center gap-1.5">
                        <Clock className={`w-3.5 h-3.5 ${group.oldestDays > 90 ? 'text-red-400' : group.oldestDays > 30 ? 'text-amber-400' : 'text-gray-500'}`} />
                        <span className={`text-xs font-medium ${group.oldestDays > 90 ? 'text-red-400' : group.oldestDays > 30 ? 'text-amber-400' : 'text-gray-400'}`}>
                          Up to {group.oldestDays} days
                        </span>
                      </div>
                    </td>
                    <td data-label="Cost" className="px-4 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-300">${money(group.totalCost)}</span>
                        <span className="text-[11px] text-gray-500">combined total</span>
                      </div>
                    </td>
                    <td data-label="eBay Sold" className="px-4 py-5">
                      <a href={ebayUrl(group.product_name)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0f] hover:bg-white/5 border border-white/10 hover:border-blue-500/40 rounded-lg transition-colors text-gray-500 hover:text-blue-400">
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-medium">eBay sold prices</span>
                      </a>
                    </td>
                    {/* Status: one badge when every batch matches, otherwise Mixed */}
                    <td data-label="Status" className="px-4 py-5">
                      {new Set(group.entries.map(e => e.status)).size === 1 ? (
                        <span className={`px-2 py-1 rounded text-[11px] font-bold tracking-wider border uppercase ${STATUS_COLORS[group.entries[0].status] || STATUS_COLORS.PURCHASED}`}>
                          {recordStatusLabel(group.entries[0].status)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Mixed</span>
                      )}
                    </td>
                    <td data-phone-hide className="px-4 py-5" />
                  </tr>

                  {/* Child rows */}
                  {isOpen && group.entries.map((item) => {
                    const isAging = item.daysInInv > 30;
                    const isCritical = item.daysInInv > 90;
                    return (
                      <tr key={item.id} className="bg-white/[0.012] hover:bg-white/[0.025] transition-colors group border-l-2 border-white/10">
                        <td className="pl-10 pr-4 py-3.5">
                          <div>
                            <p className="text-sm text-gray-400">{item.product_name}</p>
                            <span className="text-[11px] text-gray-600">{item.category || 'Uncategorized'} · #{item.order_number || item.id.slice(0, 8)}</span>
                            <div><ReturnWindowBadge item={item} className="mt-1" /></div>
                          </div>
                        </td>
                        <td data-label="Qty" className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center justify-center min-w-8 px-2 py-1 rounded bg-white/5 text-sm font-bold text-white/70 border border-white/10">
                            {item.qty_on_hand}
                          </span>
                        </td>
                        <td data-label="Aging" className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Clock className={`w-3.5 h-3.5 ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-600'}`} />
                            <span className={`text-xs font-medium ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-500'}`}>
                              {item.daysInInv} days
                            </span>
                          </div>
                        </td>
                        <td data-label="Cost" className="px-4 py-3.5">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-400">${money(allocatedCost(item, item.qty_on_hand))}</span>
                            <span className="text-[11px] text-gray-600">${money(allocatedCost(item, 1))} / unit</span>
                          </div>
                        </td>
                        {/* eBay column — empty on child rows */}
                        <td className="px-4 py-3.5" />
                        <td data-label="Status" className="px-4 py-3.5">
                          <span className={`px-2 py-1 rounded text-[11px] font-bold tracking-wider border uppercase ${STATUS_COLORS[item.status] || STATUS_COLORS.PURCHASED}`}>
                            {recordStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <Link to="/add-sale" state={{ inventoryId: item.id }} aria-label={`Sell ${item.product_name}`} className="page-btn page-btn-secondary page-btn-sm">
                            Sell
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default Inventory;


