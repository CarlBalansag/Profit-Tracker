import React, { useState } from 'react';
import { 
  Zap, DollarSign, TrendingUp, TrendingDown, RefreshCcw, Command, LayoutGrid, RotateCcw, Building2, Server, Star, ChevronDown, ChevronRight, Sliders, PlayCircle
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function Forecast() {
  const [activeMode, setActiveMode] = useState('all');
  const [activePeriod, setActivePeriod] = useState('30d');
  const [activeTab, setActiveTab] = useState('overview');

  // Chart data: flat lines for average daily forecast over 30 days
  const chartData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(2025, 3, 15); // Apr 15
    date.setDate(date.getDate() + i);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    return {
      date: dateStr,
      profit: 143.38,
      revenue: 386.55 // (11596.75 / 30)
    };
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Forecast Planner</h1>
          <p className="text-sm text-gray-400 mt-1">Model growth, compounding, and strategy scenarios.</p>
        </div>
        <button className="px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-[10px] font-bold text-blue-400 uppercase tracking-wider">
          Dedicated Workspace
        </button>
      </div>

      {/* Forecast Mode */}
      <div className="bg-[#12121A] border border-gray-800 rounded-xl p-4">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Forecast Mode</h3>
        <div className="flex bg-[#0f0f13] border border-gray-800 rounded-lg p-1">
          <button 
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-colors ${activeMode === 'all' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setActiveMode('all')}
          >
            <LayoutGrid size={16} /> All Deals
          </button>
          <button 
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-colors ${activeMode === 'cashout' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setActiveMode('cashout')}
          >
            <RotateCcw size={16} /> Cashout Only
          </button>
          <button 
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-colors ${activeMode === 'marketplace' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setActiveMode('marketplace')}
          >
            <Building2 size={16} /> Marketplace Only
          </button>
        </div>
      </div>

      {/* Forecast Control Deck */}
      <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6 relative">
        <div className="absolute top-6 right-6">
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-700 bg-gray-800 text-[10px] font-bold text-gray-300 uppercase tracking-wider hover:bg-gray-700 transition">
            <Command size={12} className="text-purple-400" /> Smart Planner
          </button>
        </div>

        <h2 className="text-lg font-bold text-white mb-1">Forecast Control Deck</h2>
        <p className="text-xs text-gray-500 mb-6">Tune assumptions, compare outcomes, and push toward your target.</p>

        {/* 4 Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="border border-green-500/20 bg-green-500/5 rounded-xl p-4 flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-green-500/80 mb-1">Daily Net</div>
              <div className="text-lg font-bold text-green-400">$144.22</div>
            </div>
            <TrendingUp size={14} className="text-green-500" />
          </div>
          <div className="border border-blue-500/20 bg-blue-500/5 rounded-xl p-4 flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-blue-500/80 mb-1">Churn Profit</div>
              <div className="text-lg font-bold text-blue-400">$150.00</div>
            </div>
            <Zap size={14} className="text-blue-500" />
          </div>
          <div className="border border-purple-500/20 bg-purple-500/5 rounded-xl p-4 flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-purple-500/80 mb-1">Resell Profit</div>
              <div className="text-lg font-bold text-purple-400">$13.50</div>
            </div>
            <DollarSign size={14} className="text-purple-500" />
          </div>
          <div className="border border-pink-500/20 bg-pink-500/5 rounded-xl p-4 flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-pink-500/80 mb-1">Cashback</div>
              <div className="text-lg font-bold text-pink-400">$5.72</div>
            </div>
            <Star size={14} className="text-pink-500" />
          </div>
        </div>

        {/* Controls footer */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-t border-gray-800/50 pt-5">
          <div className="w-full md:w-auto">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Period</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setActivePeriod('30d')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activePeriod === '30d' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' : 'text-gray-400 hover:text-white'}`}>30 Days</button>
              <button onClick={() => setActivePeriod('3m')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activePeriod === '3m' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' : 'text-gray-400 hover:text-white'}`}>3 Months</button>
              <button onClick={() => setActivePeriod('6m')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activePeriod === '6m' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' : 'text-gray-400 hover:text-white'}`}>6 Months</button>
              <button onClick={() => setActivePeriod('1y')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activePeriod === '1y' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30' : 'text-gray-400 hover:text-white'}`}>1 Year</button>
            </div>
          </div>
          
          <div className="w-full md:w-auto flex items-end gap-3">
            <div>
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Target</h3>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input type="text" defaultValue="5000" className="w-32 bg-[#0A0A0F] border border-gray-700 rounded-lg pl-7 pr-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors" />
              </div>
            </div>
            <button className="flex items-center gap-2 px-6 py-1.5 rounded-lg bg-purple-600 text-white font-bold text-sm shadow-lg shadow-purple-900/30 hover:bg-purple-500 transition-colors h-[34px]">
              <RefreshCcw size={14} /> Recalculate
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#12121A] border border-gray-800 rounded-xl p-1 gap-1">
        <button onClick={() => setActiveTab('overview')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'overview' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
          <TrendingUp size={16} /> Overview
        </button>
        <button onClick={() => setActiveTab('params')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'params' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
          <Sliders size={16} /> Business Parameters
        </button>
        <button onClick={() => setActiveTab('scenarios')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'scenarios' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
          <Server size={16} /> Scenarios
        </button>
      </div>

      {/* Main Blocks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Projected Profit Block */}
        <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6 pb-8">
          <div className="text-xs text-gray-400 mb-1">Projected Profit</div>
          <div className="text-3xl font-bold text-green-400 mb-1">$4,301.29</div>
          <div className="text-xs text-gray-500">$143.38/day</div>
        </div>
        {/* Projected Revenue Block */}
        <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6 pb-8">
          <div className="text-xs text-gray-400 mb-1">Projected Revenue</div>
          <div className="text-3xl font-bold text-blue-400 mb-1">$11,596.75</div>
          <div className="text-xs text-gray-500">30 days</div>
        </div>
      </div>

      {/* Chart Block */}
      <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-white mb-6">Profit & Revenue Forecast</h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#52525b" 
                tick={{ fill: '#71717a', fontSize: 10 }} 
                tickLine={false} 
                axisLine={false} 
                dy={10} 
                minTickGap={30}
              />
              <YAxis 
                stroke="#52525b" 
                tick={{ fill: '#71717a', fontSize: 10 }} 
                tickLine={false} 
                axisLine={false} 
                dx={10} 
                tickFormatter={(val) => `$${val}`} 
                domain={[0, 400]}
                ticks={[0, 100, 200, 300, 400]}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} 
                iconType="circle"
                formatter={(value) => <span className="text-gray-400">{value}</span>}
              />
              <Area type="stepBefore" dataKey="revenue" name="Projected Revenue" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" isAnimationActive={false} />
              <Area type="stepBefore" dataKey="profit" name="Projected Profit" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monthly Breakdown */}
        <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6">
          <h3 className="text-xs font-bold text-white mb-6">Monthly Breakdown</h3>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">Month 1</span>
            <span className="font-bold text-green-400">$4,301.29</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6">
          <h3 className="text-xs font-bold text-white mb-6">Metrics</h3>
          <div className="space-y-4">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 mb-1">Historical Daily Avg</span>
              <span className="text-sm font-bold text-gray-300">$121.47</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 mb-1">Projected Daily Avg</span>
              <span className="text-sm font-bold text-green-400">$143.38</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 mb-1">Trend</span>
              <span className="text-sm font-medium text-red-500 flex items-center gap-1">
                <TrendingDown size={14} /> Declining
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Getting Started Dropdown Placeholder */}
      <div className="bg-[#12121A] border border-gray-800 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-gray-800/50 transition-colors text-white">
        <TrendingUp size={16} className="text-gray-400" />
        <span className="text-sm font-medium">Getting Started</span>
        <ChevronDown size={16} className="text-gray-500 ml-auto" />
      </div>

    </div>
  );
}

export default Forecast;
