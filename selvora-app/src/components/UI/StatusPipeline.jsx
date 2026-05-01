import React from 'react';
import { 
  ShoppingBag, Target, Package, ScanLine, CircleCheck, ListChecks, DollarSign 
} from 'lucide-react';

const statuses = [
  { label: 'Purchased', count: 0, icon: ShoppingBag, color: '#60a5fa' },
  { label: 'Shipped', count: 0, icon: Target, color: '#facc15' },
  { label: 'Delivered', count: 0, icon: Package, color: '#f97316' },
  { label: 'Scanned In', count: 0, icon: ScanLine, color: '#fbbf24' },
  { label: 'Paid', count: 0, icon: CircleCheck, color: '#22c55e' },
  { label: 'Listed', count: 0, icon: ListChecks, color: '#7c3aed' },
  { label: 'Sold', count: 1, icon: DollarSign, color: '#22c55e' },
  { label: 'Completed', count: 0, icon: CircleCheck, color: '#10b981' },
];

const StatusPipeline = () => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {statuses.map((s, idx) => (
        <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.10] transition-all">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5">
            <s.icon size={18} style={{ color: s.color }} />
          </div>
          <div>
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.count}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatusPipeline;
