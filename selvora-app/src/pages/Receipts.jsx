import React from 'react';
import { Download, Upload, Search } from 'lucide-react';

const Receipts = () => {
  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Receipts</h1>
          <p className="text-sm text-gray-400 mt-1">Upload PNG/PDF receipts, auto-compress, and link them to orders.</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/[0.04] transition-colors border border-transparent">
          <Download className="w-4 h-4" /> Export ZIP
        </button>
      </div>

      <div className="h-4"></div>

      {/* Upload Area */}
      <div className="card p-4 space-y-3 bg-white/[0.02] border border-white/10 rounded-xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Transaction *</label>
            <input className="input w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50" placeholder="Search transaction by order #, product, platform" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Order Number *</label>
            <input className="input w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50" placeholder="e.g. 113-6480763-4239401" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Receipt File (PNG or PDF) *</label>
            <input type="file" accept=".png,.pdf,application/pdf,image/png" className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-white/[0.05] file:text-white hover:file:bg-white/10 pt-1 cursor-pointer" />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-white bg-gradient-to-b from-purple-500/80 to-blue-600/80 hover:from-purple-500 hover:to-blue-600 border border-purple-500/50">
            <Upload className="w-4 h-4" /> Upload Receipt
          </button>
        </div>
      </div>

      {/* Receipts Table Area */}
      <div className="card p-4 space-y-3 bg-white/[0.02] border border-white/10 rounded-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input className="input w-full bg-black/20 border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50" placeholder="Search by order number, file name, product..." />
        </div>
        
        <div className="py-12 text-center text-gray-500">
          No receipts found.
        </div>
        
        <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-white/5">
          <span>0 total receipts</span>
          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            <button className="px-2 py-1 rounded text-gray-500 hover:bg-white/5 disabled:opacity-50 disabled:pointer-events-none" disabled>Prev</button>
            <span>Page 1 / 1</span>
            <button className="px-2 py-1 rounded text-gray-500 hover:bg-white/5 disabled:opacity-50 disabled:pointer-events-none" disabled>Next</button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Receipts;
