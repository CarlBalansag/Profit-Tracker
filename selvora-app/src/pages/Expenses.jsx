import React from 'react';
import { 
  Receipt, CalendarClock, Download, Plus, DollarSign, 
  TrendingUp, Clock, Search 
} from 'lucide-react';

const Expenses = () => {
  return (
    <div className="h-full overflow-auto px-4 py-6 sm:px-6 space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">Track recurring fees, memberships, and business costs</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-purple-400 hover:bg-purple-500/10 border border-purple-500/30">
            <Receipt className="w-4 h-4" /> 
            Quick Add
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-amber-300 hover:bg-amber-500/10 border border-amber-400/35">
            <CalendarClock className="w-4 h-4" /> 
            Backfill Calculator
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-cyan-300 hover:bg-cyan-500/10 border border-cyan-400/35">
            <Download className="w-4 h-4" /> 
            Export CSV
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all bg-gradient-to-br from-purple-500/80 to-purple-600/80 border border-purple-500/40">
            <Plus className="w-4 h-4" /> 
            Add Expense
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Monthly Cost</span>
            <DollarSign className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-white">$0.00</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Annual Cost</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">$0.00</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Active Expenses</span>
            <Receipt className="w-4 h-4 text-green-400" />
          </div>
          <p className="text-xl font-bold text-white">0</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Due Next 30 Days</span>
            <Clock className="w-4 h-4 text-gray-500" />
          </div>
          <p className="text-xl font-bold text-white">0</p>
        </div>
      </div>

      {/* Controls & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search expenses..." 
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.02] border border-white/10 focus:outline-none focus:border-purple-500/50" 
          />
        </div>
        <select className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
          <option value="" className="bg-gray-900 text-white">All Categories</option>
          <option value="CREDIT_CARD_FEE" className="bg-gray-900 text-white">Credit Card Fee</option>
          <option value="MEMBERSHIP" className="bg-gray-900 text-white">Membership</option>
          <option value="PLATFORM_FEE" className="bg-gray-900 text-white">Platform Fee</option>
          <option value="SHIPPING" className="bg-gray-900 text-white">Shipping</option>
          <option value="SOFTWARE" className="bg-gray-900 text-white">Software / Tools</option>
          <option value="OTHER" className="bg-gray-900 text-white">Other</option>
        </select>
        <select className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
          <option value="NEXT_DUE" className="bg-gray-900 text-white">Sort: Next Due</option>
          <option value="AMOUNT_DESC" className="bg-gray-900 text-white">Sort: Amount (High-Low)</option>
          <option value="AMOUNT_ASC" className="bg-gray-900 text-white">Sort: Amount (Low-High)</option>
          <option value="NAME" className="bg-gray-900 text-white">Sort: Name</option>
          <option value="CREATED" className="bg-gray-900 text-white">Sort: Newest</option>
        </select>
        <select className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
          <option value="" className="bg-gray-900 text-white">Active &amp; Inactive</option>
          <option value="true" className="bg-gray-900 text-white">Active Only</option>
          <option value="false" className="bg-gray-900 text-white">Inactive Only</option>
        </select>
      </div>

      {/* Tag Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-white bg-white/10">All</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-blue-400 hover:bg-white/5">Credit Card Fee</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-amber-400 hover:bg-white/5">Membership</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-purple-400 hover:bg-white/5">Platform Fee</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-green-400 hover:bg-white/5">Shipping</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-cyan-400 hover:bg-white/5">Software / Tools</button>
        <button className="px-2.5 py-1 rounded-full text-xs border border-white/10 transition-colors text-gray-400 hover:bg-white/5">Other</button>
      </div>

      {/* Visualizations / Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <h3 className="text-sm font-semibold text-white mb-3">Monthly Spend by Category</h3>
          <p className="text-xs text-gray-600">No active recurring expenses yet.</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <h3 className="text-sm font-semibold text-white mb-3">6-Month Expense Forecast</h3>
          <div className="space-y-2.5">
            {['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'].map((month, idx) => (
              <div key={idx}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-300">{month} 2026</span>
                  <span className="text-white">$0.00</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full w-[6%] bg-gradient-to-r from-emerald-500/80 to-emerald-400/80"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Empty State */}
      <div className="rounded-xl p-12 text-center bg-white/[0.02] border border-white/10">
        <Receipt className="w-12 h-12 text-gray-700 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">No expenses found</h3>
        <p className="text-sm text-gray-500 mb-4">Start tracking your business expenses and recurring fees.</p>
        <button className="px-4 py-2 rounded-lg text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors border border-purple-500/30">
          Quick Add Common Expenses
        </button>
      </div>

    </div>
  );
};

export default Expenses;
