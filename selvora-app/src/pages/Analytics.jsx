import React, { useState } from 'react';
import { 
  DollarSign, ShoppingCart, TrendingUp, Percent, Gift, 
  CreditCard, Store, Package, BarChart2, Filter, Download, RotateCcw,
  Calendar, LayoutGrid, List, Table, Users
} from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function Analytics() {
  const [activeTab, setActiveTab] = useState('overview');

  // Chart Data Mocks
  const trendData = [
    { name: '2025-02', revenue: 900, profit: 250, cashback: 50 },
    { name: '2025-03', revenue: 3600, profit: 120, cashback: 30 }
  ];

  const expenseData = [
    { name: 'COGS', value: 4014.00, color: '#ef4444' }, // Red
    { name: 'Shipping', value: 53.25, color: '#eab308' } // Yellow
  ];

  const cumulativeData = [
    { name: '2025-02', profit: 280 },
    { name: '2025-03', profit: 340 }
  ];

  const periodPLData = [
    { name: '2025-02', value: 310, fill: '#22c55e' },
    { name: '2025-03', value: 50, fill: '#22c55e' }
  ];

  const MetricCard = ({ icon: Icon, title, value, subtitle, color, titleColor, valueColor, subtitleColor, bgGlow, topRightIcon: TopRightIcon }) => (
    <div className={`relative p-4 rounded-xl border border-gray-800 bg-[#16161E] overflow-hidden group hover:border-gray-700 transition-colors`}>
      {bgGlow && (
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{ background: `radial-gradient(circle at top left, ${color}, transparent 60%)` }}
        />
      )}
      {TopRightIcon && (
        <div className="absolute top-4 right-4">
          <TopRightIcon size={14} style={{ color }} />
        </div>
      )}
      <div className="relative z-10 flex flex-col h-full">
        <div className="w-8 h-8 rounded-md flex items-center justify-center mb-3 bg-white/5 border border-white/5">
          <Icon size={16} style={{ color }} />
        </div>
        <div className={`text-[10px] font-bold tracking-wider mb-1 ${titleColor || 'text-gray-400'}`}>
          {title}
        </div>
        <div className={`text-xl font-bold mb-1 ${valueColor || 'text-white'}`}>
          {value}
        </div>
        <div className={`text-[10px] leading-tight ${subtitleColor || 'text-gray-500'} whitespace-pre-line`}>
          {subtitle}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Analytics & Insights</h1>
          <p className="text-sm text-gray-400 mt-1">Combined overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#6b21a8] text-white text-sm font-medium border border-purple-500/30">
            <LayoutGrid size={14} /> All
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
            <Users size={14} /> Cashout
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
            <Store size={14} /> Marketplace
          </button>
          <div className="w-px h-6 bg-gray-800 mx-1"></div>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
            <Download size={14} /> Export All
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors">
            <RotateCcw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-wrap items-center gap-6 p-4 rounded-xl border border-gray-800 bg-[#16161E]">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Period</label>
          <div className="flex bg-[#0f0f13] border border-gray-800 rounded-lg p-0.5">
            <button className="px-4 py-1.5 text-sm font-medium rounded-md bg-gray-800 text-white shadow-sm border border-gray-700/50">Monthly</button>
            <button className="px-4 py-1.5 text-sm font-medium rounded-md text-gray-400 hover:text-white transition-colors">Quarterly</button>
            <button className="px-4 py-1.5 text-sm font-medium rounded-md text-gray-400 hover:text-white transition-colors">Yearly</button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Date Range</label>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input type="text" value="04/16/2025" readOnly className="w-32 bg-[#0f0f13] border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
              <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
            </div>
            <span className="text-gray-600">-</span>
            <div className="relative">
              <input type="text" value="04/16/2026" readOnly className="w-32 bg-[#0f0f13] border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
              <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 ml-auto">
           <button className="h-[34px] mt-[19px] flex items-center gap-2 px-4 rounded-lg bg-transparent border border-gray-800 text-gray-300 hover:bg-white/5 text-sm font-medium transition-colors">
            <Filter size={14} /> Filters <span className="text-xs text-gray-500 ml-1">⌄</span>
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          icon={DollarSign} title="REVENUE" value="$4,384.00" subtitle="5 sales" 
          color="#3b82f6" valueColor="text-white" titleColor="text-gray-500"
        />
        <MetricCard 
          icon={ShoppingCart} title="COST" value="$4,085.10" subtitle="5 buys (incl. tax & shipping)"
          color="#ec4899" valueColor="text-white" titleColor="text-[#71465d]" subtitleColor="text-[#71465d]"
          bgGlow
        />
        <MetricCard 
          icon={TrendingUp} title="PROFIT (ACCOUNTING)" value="$364.41" subtitle="CB $65.51 + Commission&#10;$370.00 + Margin -$71.10"
          color="#22c55e" titleColor="text-green-500/70" valueColor="text-green-400" subtitleColor="text-green-500/50"
          bgGlow topRightIcon={TrendingUp}
        />
        <MetricCard 
          icon={Percent} title="ROI" value="8.92%" subtitle="Return rate"
          color="#22c55e" titleColor="text-green-500/70" valueColor="text-green-400" subtitleColor="text-green-500/50"
          bgGlow topRightIcon={TrendingUp}
        />
        <MetricCard 
          icon={Gift} title="CASHBACK" value="$65.51" subtitle="Rewards"
          color="#a855f7" titleColor="text-purple-500/70" valueColor="text-purple-400" subtitleColor="text-purple-500/50"
          bgGlow
        />
        <MetricCard 
          icon={CreditCard} title="COMMISSION" value="$370.00" subtitle="Product price gap"
          color="#eab308" titleColor="text-yellow-500/70" valueColor="text-yellow-400" subtitleColor="text-yellow-500/50"
          bgGlow
        />
        <MetricCard 
          icon={Store} title="TOP STORE" value="US Mint Coin" subtitle="$309.15"
          color="#14b8a6" titleColor="text-teal-500/70" valueColor="text-white" subtitleColor="text-teal-500/50"
          bgGlow
        />
        <MetricCard 
          icon={Package} title="INVENTORY" value="0" subtitle="Active items"
          color="#6366f1" titleColor="text-indigo-500/70" valueColor="text-white" subtitleColor="text-indigo-500/50"
          bgGlow
        />
      </div>

      {/* Info Banner */}
      <div className="relative p-4 rounded-xl border border-gray-800 bg-[#16161E] flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Profit Calculation Details</h3>
          <p className="text-sm text-green-400 mb-1">
            <span className="font-semibold">Accounting Profit</span> = Cashback + Commission + Product Margin <span className="text-gray-500">(sales spread after costs/fees/tax/shipping).</span>
          </p>
          <p className="text-sm text-cyan-400 mb-3">
            <span className="font-semibold">Cashback Wallet Profit</span> = Accounting Profit minus YA used <span className="text-gray-500">($0.00).</span>
          </p>
          <p className="text-xs text-gray-500">Current mode: <span className="text-gray-300 font-medium">Accounting</span>. Change this in Settings.</p>
          <p className="text-xs text-gray-500 mt-0.5">Mode adjustment: <span className="text-gray-300 font-medium">$0.00</span> (YA used not applied in Accounting mode).</p>
        </div>
        <button className="text-xs font-medium text-gray-400 hover:text-white px-3 py-1.5 rounded border border-gray-700 hover:bg-white/5 transition-colors">
          Hide
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-gray-800 bg-[#16161E]">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart2 },
          { id: 'breakdowns', label: 'Breakdowns', icon: PieChart },
          { id: 'payments', label: 'Payments', icon: CreditCard },
          { id: 'detail', label: 'Detail Tables', icon: Table },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.id 
                ? 'bg-gray-800 text-white shadow-sm' 
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Charts Area */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trend Chart - Large */}
          <div className="col-span-1 lg:col-span-2 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Revenue & Profit Trend</h3>
                <p className="text-xs text-gray-500 mt-1">Track financial performance over time</p>
              </div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-800/50 px-2 py-1 rounded">Monthly</span>
            </div>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                  <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                    labelStyle={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}
                  />
                  <Legend wrapperStyle={{ bottom: 0, fontSize: '12px' }} iconType="circle" />
                  <Line type="linear" dataKey="revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="linear" dataKey="profit" name="Profit" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="linear" dataKey="cashback" name="Cashback" stroke="#a855f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="col-span-1 p-5 rounded-xl border border-gray-800 bg-[#16161E] flex flex-col">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Expense Breakdown</h3>
            <div className="h-[180px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    stroke="none"
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {expenseData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-auto space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-gray-300">COGS</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-gray-500 text-xs mt-0.5">99%</span>
                  <span className="text-white font-medium">$4,014.00</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                  <span className="text-gray-300">Shipping</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-gray-500 text-xs mt-0.5">1%</span>
                  <span className="text-white font-medium">$53.25</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cumulative Profit */}
          <div className="col-span-1 lg:col-span-2 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Cumulative Profit</h3>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                  <defs>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                  <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="profit" stroke="#a855f7" fillOpacity={1} fill="url(#colorProfit)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Period P&L */}
          <div className="col-span-1 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Period P&L</h3>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={periodPLData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }} barSize={100}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                  <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{fill: '#27272a', opacity: 0.4}}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Analytics;
