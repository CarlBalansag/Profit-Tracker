import React, { useState } from 'react';
import { DollarSign, ArrowRight, Bell, ChevronRight, ChevronDown } from 'lucide-react';

function CashFlow() {
  const [includeCashback, setIncludeCashback] = useState(false);
  const [expandedBuyer, setExpandedBuyer] = useState(null);

  const toggleBuyer = (buyerId) => {
    setExpandedBuyer(expandedBuyer === buyerId ? null : buyerId);
  };

  const buyers = [
    {
      id: 'electronics',
      name: 'ElectronicsBuyer',
      itemsCount: 2,
      aging: '36d',
      spent: 3542.25,
      comingBack: 3489.00,
      progress: [
        { color: '#eab308', percent: 20 }, // yellow
        { color: '#22c55e', percent: 80 }  // green
      ]
    },
    {
      id: 'rsc',
      name: 'RSC',
      itemsCount: 1,
      aging: '49d',
      spent: 542.85,
      comingBack: 525.00,
      progress: [
        { color: '#6366f1', percent: 100 } // purple/blue
      ]
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Cash Flow</h1>
        <p className="text-sm text-gray-400 mt-1">See where your money is and what's coming back</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Spending Out Card */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: '#1a2235' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#60a5fa] uppercase tracking-wider mb-2">Spending Out</h3>
            <div className="text-xl font-bold text-blue-400 mb-1">$4,085.10</div>
            <p className="text-[10px] text-blue-400/60">3 items in pipeline</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center bg-blue-500/10">
            <DollarSign size={14} className="text-blue-400" />
          </div>
        </div>

        {/* Coming Back Card */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: '#102d24' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#4ade80] uppercase tracking-wider mb-2">Coming Back</h3>
            <div className="text-xl font-bold text-green-400 mb-1">$4,014.00</div>
            <p className="text-[10px] text-green-400/60">net after buyer fees</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-green-500/30 flex items-center justify-center bg-green-500/10">
            <ArrowRight size={14} className="text-green-400" />
          </div>
        </div>

        {/* Total Owed To You Card */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: '#261935' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#c084fc] uppercase tracking-wider mb-2">Total Owed To You</h3>
            <div className="text-xl font-bold text-purple-400 mb-1">$4,014.00</div>
            <p className="text-[10px] text-purple-400/60">from buyer payouts</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center bg-purple-500/10">
             <DollarSign size={14} className="text-purple-400" />
          </div>
        </div>
      </div>

      {/* Progress Section */}
      <div className="space-y-4 pt-4">
        <div className="flex justify-end items-center gap-3">
          <span className="text-xs text-gray-500">Include cashback</span>
          <button 
            onClick={() => setIncludeCashback(!includeCashback)}
            className={`w-9 h-5 rounded-full relative transition-colors ${includeCashback ? 'bg-green-500' : 'bg-gray-700'}`}
          >
            <div className={`absolute top-0.5 bottom-0.5 left-0.5 bg-gray-300 w-4 rounded-full transition-transform ${includeCashback ? 'translate-x-4 bg-white' : ''}`} />
          </button>
        </div>

        <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-6">Where Your Money Is</h3>
          
          {/* Progress Bar */}
          <div className="h-4 w-full rounded-full bg-gray-800 overflow-hidden flex mb-6">
            <div className="h-full bg-yellow-500" style={{ width: '13%' }}></div>
            <div className="h-full bg-green-500" style={{ width: '87%' }}></div>
          </div>

          {/* Progress Details */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-3">
              <div className="text-[10px] font-bold text-yellow-500/80 uppercase tracking-wider mb-1">In Transit</div>
              <div className="text-sm font-bold text-yellow-500 mb-0.5">$516.25</div>
              <div className="text-[10px] text-yellow-500/60">1 item - 13%</div>
            </div>
            
            <div className="rounded border border-green-500/30 bg-green-500/5 p-3">
              <div className="text-[10px] font-bold text-green-500/80 uppercase tracking-wider mb-1">Sold</div>
              <div className="text-sm font-bold text-green-500 mb-0.5">$3,568.65</div>
              <div className="text-[10px] text-green-500/60">2 items - 87%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Accordion List */}
      <div className="space-y-4">
         <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">By Buyer</h3>
         
         <div className="border border-gray-800 bg-[#12121A] rounded-xl overflow-hidden divide-y divide-gray-800">
            {buyers.map((buyer) => (
              <div key={buyer.id} className="group">
                <div 
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => toggleBuyer(buyer.id)}
                >
                  <div className="flex items-center gap-4">
                    {expandedBuyer === buyer.id ? 
                      <ChevronDown size={16} className="text-gray-500" /> : 
                      <ChevronRight size={16} className="text-gray-500" />
                    }
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-white text-sm">{buyer.name}</span>
                        <span className="text-xs text-gray-500">{buyer.itemsCount} {buyer.itemsCount === 1 ? 'item' : 'items'}</span>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                          <Bell size={10} />
                          {buyer.aging}
                        </div>
                      </div>
                      
                      {/* Mini Progress Bar */}
                      <div className="flex h-1 w-24 rounded-full overflow-hidden mt-2 bg-gray-800">
                        {buyer.progress.map((seg, i) => (
                           <div key={i} className="h-full" style={{ width: `${seg.percent}%`, backgroundColor: seg.color }}></div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-12 text-right">
                    <div>
                       <div className="text-[10px] text-gray-500 mb-1">Spent</div>
                       <div className="text-sm font-bold text-blue-400">${buyer.spent.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                       <div className="text-[10px] text-gray-500 mb-1">Coming Back</div>
                       <div className="text-sm font-bold text-green-400">${buyer.comingBack.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>
                
                {/* Accordion Content (Placeholder for future functionality) */}
                {expandedBuyer === buyer.id && (
                  <div className="px-14 py-4 bg-black/20 text-xs text-gray-400 border-t border-gray-800/50">
                    Additional details for {buyer.name} goes here.
                  </div>
                )}
              </div>
            ))}
         </div>
      </div>
    </div>
  );
}

export default CashFlow;
