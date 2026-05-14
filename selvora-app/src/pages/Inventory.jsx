import React, { useState } from 'react';
import { useInventory } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { Columns3, Plus, Search, Package, AlertTriangle, TrendingUp, DollarSign, Clock, MoreVertical, ExternalLink, ListChecks } from 'lucide-react';

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

const Inventory = () => {
  const { data: rawInventory = [], isLoading } = useInventory();
  const inventory = rawInventory.filter(item => item.qty_on_hand > 0);

  const today = new Date();
  const processedInventory = inventory.map(item => {
    const isPreOrder = item.status?.toUpperCase().includes('PRE');
    let daysInInv = 0;
    if (!isPreOrder) {
      const startDate = new Date(item.received_date || item.purchase_date);
      daysInInv = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
    }
    return {
      ...item,
      daysInInv: daysInInv >= 0 ? daysInInv : 0,
    };
  });

  const totalCapital = processedInventory.reduce((sum, item) => sum + (item.unit_purchase_cost * item.qty_on_hand), 0);
  const totalRetail = 0; // Placeholder until schema supports it
  const totalUnits = processedInventory.reduce((sum, item) => sum + item.qty_on_hand, 0);
  const agingUnits = processedInventory.filter(i => i.daysInInv > 30).reduce((sum, item) => sum + item.qty_on_hand, 0);
  const activeListings = processedInventory.filter(i => i.status === 'LISTED').reduce((sum, item) => sum + item.qty_on_hand, 0);

  if (isLoading) return <PageLoader variant="table" />;

  return (
    <div className="h-full overflow-auto px-4 py-6 sm:px-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Inventory Management</h1>
          <p className="text-gray-400 text-sm mt-1">Manage unsold assets, track aging stock, and calculate locked capital.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white/[0.02] text-gray-300 hover:text-white hover:bg-white/[0.06] border border-white/10">
            Export Report
          </button>
          <button type="button" className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-white bg-gradient-to-b from-emerald-500/80 to-teal-600/80 hover:from-emerald-500 hover:to-teal-600 border border-emerald-500/50 shadow-lg shadow-emerald-500/20">
            <Plus className="w-4 h-4" /> 
            Add Inventory
          </button>
        </div>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in fill-mode-both">
        <div className="rounded-xl bg-white/[0.02] border border-white/10 p-5 relative overflow-hidden group hover:border-white/20 transition-colors">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Inventory Total Cost</p>
              <h3 className="text-2xl font-bold text-white">${totalCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-white/10 p-5 relative overflow-hidden group hover:border-white/20 transition-colors delay-150">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Units On Hand</p>
              <h3 className="text-2xl font-bold text-white">{totalUnits}</h3>
            </div>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Package className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-white/10 p-5 relative overflow-hidden group hover:border-red-500/30 transition-colors delay-200">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Aging Stock (30+ Days)</p>
              <h3 className="text-2xl font-bold text-red-400">{agingUnits} units</h3>
              <p className="text-[11px] text-gray-500 mt-1">Needs liquidation planning</p>
            </div>
            <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-white/10 p-5 relative overflow-hidden group hover:border-white/20 transition-colors delay-300">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Active Listings</p>
              <h3 className="text-2xl font-bold text-amber-400">{activeListings} units</h3>
              <p className="text-[11px] text-gray-500 mt-1">Currently listed for sale</p>
            </div>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <ListChecks className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
      
      {/* Filters Card */}
      <div className="card p-4 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-300 fill-mode-both">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              placeholder="Search by product name or category..." 
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors" 
            />
          </div>
          <div className="flex gap-3">
            <select className="w-40 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none">
              <option value="">All Categories</option>
              <option value="Electronics">Electronics</option>
              <option value="Apparel">Apparel</option>
              <option value="Watches">Watches</option>
            </select>
            <select className="w-40 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none">
              <option value="">Status: All</option>
              <option value="Pre Order">Pre Order</option>
              <option value="PURCHASED">Purchased</option>
              <option value="SHIPPED_IN">Shipped In</option>
              <option value="DELIVERED">Delivered</option>
              <option value="SCANNED_IN">Scanned In</option>
              <option value="LISTED">Listed</option>
              <option value="SOLD">Sold</option>
              <option value="SHIPPED_OUT">Shipped Out</option>
              <option value="AUTHENTICATION">Authentication</option>
              <option value="PAID">Paid</option>
              <option value="COMPLETED">Completed</option>
              <option value="RETURNED">Returned</option>
              <option value="DISPUTED">Disputed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card overflow-x-auto bg-[#0f1115] animate-in slide-in-from-bottom-4 duration-500 fade-in delay-500 fill-mode-both">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] uppercase font-semibold text-gray-500 tracking-widest bg-black/20">
              <th className="px-5 py-4 w-10">
                <input type="checkbox" className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-emerald-500" />
              </th>
              <th className="px-4 py-4 min-w-[250px]">Product Name</th>
              <th className="px-4 py-4 w-24 text-center">Qty</th>
              <th className="px-4 py-4 w-32">Aging</th>
              <th className="px-4 py-4 min-w-[120px]">Total Cost Basis</th>
              <th className="px-4 py-4 w-32">eBay Last Sold</th>
              <th className="px-4 py-4 min-w-[140px]">Current Status</th>
              <th className="px-4 py-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {processedInventory.length === 0 ? (
              <tr>
                <td colSpan="9" className="px-4 py-16 text-center">
                  <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No inventory items found.</p>
                  <p className="text-gray-600 text-xs mt-1">Add a transaction to generate inventory.</p>
                </td>
              </tr>
            ) : processedInventory.map((item) => {
              const isAging = item.daysInInv > 30;
              const isCritical = item.daysInInv > 90;
              
              return (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-5 py-5">
                    <input type="checkbox" className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                  <td className="px-4 py-5">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{item.product_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">{item.category || 'Uncategorized'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-5 text-center">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded bg-white/5 text-sm font-bold text-white border border-white/10">
                      {item.qty_on_hand}
                    </span>
                  </td>
                  <td className="px-4 py-5">
                    <div className="flex items-center gap-1.5">
                      <Clock className={`w-3.5 h-3.5 ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-500'}`} />
                      <span className={`text-xs font-medium ${isCritical ? 'text-red-400' : isAging ? 'text-amber-400' : 'text-gray-400'}`}>
                        {item.daysInInv} days
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-300">${(item.unit_purchase_cost * item.qty_on_hand).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      <span className="text-[10px] text-gray-500">${item.unit_purchase_cost.toFixed(2)} / unit</span>
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <a
                      href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(item.product_name)}&LH_Sold=1&LH_Complete=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0f] hover:bg-white/[0.05] border border-white/10 rounded-lg transition-colors group/btn"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-sm font-semibold text-gray-500">—</span>
                        <span className="text-[10px] text-gray-600 leading-tight">Pending Sync</span>
                      </div>
                      <div className="p-1 rounded bg-blue-500/10 text-blue-400 group-hover/btn:bg-blue-500/20 transition-colors ml-1">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </div>
                    </a>
                  </td>
                  <td className="px-4 py-5">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider border uppercase ${STATUS_COLORS[item.status] || STATUS_COLORS.PURCHASED}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-5 text-right">
                    <button className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default Inventory;


