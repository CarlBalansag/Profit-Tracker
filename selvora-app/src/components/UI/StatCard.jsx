import React from 'react';

const StatCard = ({ title, value, subtitle, icon: Icon, color, gradient }) => {
  return (
    <div className="card-hover relative overflow-hidden h-full">
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: gradient || `linear-gradient(to bottom right, ${color}, transparent)`
        }}
      />
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">{title}</p>
          <p className="text-xl font-bold mt-1" style={{ color }}>{value}</p>
          <p className="text-[10px] text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
          <Icon size={20} style={{ color }} />
        </div>
      </div>
    </div>
  );
};

export default StatCard;
