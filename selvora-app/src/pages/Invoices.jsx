import React from 'react';
import { Plus, Search, FileText } from 'lucide-react';

const Invoices = () => {
  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-sm text-gray-400 mt-1">Invoices are not available yet. Invoice creation and PDF storage are unfinished.</p>
        </div>
        <button disabled title="Invoice creation is not available yet" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 bg-gray-800 cursor-not-allowed">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      <div className="h-4"></div>

      {/* Filter Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 min-w-0 w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input disabled aria-label="Invoice search (unavailable)"
            className="input pl-10 w-full bg-white/[0.02] border border-white/10 rounded-lg py-2 text-sm text-white focus:outline-none focus:border-purple-500/50" 
            placeholder="Search invoices by number, buyer, seller..." 
          />
        </div>
        <select disabled aria-label="Invoice status (unavailable)" className="px-3 py-2 rounded-lg text-sm text-gray-500 bg-white/[0.02] border border-white/10 w-full sm:w-40 cursor-not-allowed">
          <option value="" className="bg-gray-900 text-white">All Statuses</option>
          <option value="DRAFT" className="bg-gray-900 text-white">DRAFT</option>
          <option value="SENT" className="bg-gray-900 text-white">SENT</option>
          <option value="PAID" className="bg-gray-900 text-white">PAID</option>
          <option value="OVERDUE" className="bg-gray-900 text-white">OVERDUE</option>
          <option value="CANCELLED" className="bg-gray-900 text-white">CANCELLED</option>
        </select>
      </div>

      {/* Empty State */}
      <div className="card p-12 text-center bg-white/[0.02] border border-white/10 rounded-xl mt-4">
        <FileText className="w-12 h-12 mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400 text-sm">Invoice management is unavailable.</p>
      </div>

    </div>
  );
};

export default Invoices;
