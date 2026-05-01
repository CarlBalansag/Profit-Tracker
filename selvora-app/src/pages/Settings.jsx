import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  User, Database, Target, FileJson, Mail, Code, Bell, Palette, Shield, ExternalLink, Download, ArrowLeft, DollarSign
} from 'lucide-react';
import { PaymentMethods } from '../components/Settings/PaymentMethods';
import { Vendors } from '../components/Settings/Vendors';
import { Cashouts } from '../components/Settings/Cashouts';
import { Marketplaces } from '../components/Settings/Marketplaces';
import { Accounts } from '../components/Settings/Accounts';

function Settings() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'profile');
  const [activeDataSetupView, setActiveDataSetupView] = useState(location.state?.view || null);

  useEffect(() => {
    if (location.state?.tab) setActiveTab(location.state.tab);
    if (location.state?.view) setActiveDataSetupView(location.state.view);
  }, [location.state]);

  // Goals internal state
  const [goals, setGoals] = useState({
    profit: { active: true, type: 'Weekly', value: '0.00' },
    revenue: { active: true, type: 'Weekly', value: '0.00' },
    cashback: { active: true, type: 'Weekly', value: '0.00' },
    transactions: { active: true, type: 'Weekly', value: '0' }
  });

  const toggleGoalType = (goalKey) => {
    setGoals(prev => ({
      ...prev,
      [goalKey]: { 
        ...prev[goalKey], 
        type: prev[goalKey].type === 'Weekly' ? 'Monthly' : 'Weekly' 
      }
    }));
  };

  const toggleGoalActive = (goalKey) => {
    setGoals(prev => ({
      ...prev,
      [goalKey]: { ...prev[goalKey], active: !prev[goalKey].active }
    }));
  };

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'datasetup', label: 'Data Setup', icon: Database },
    { id: 'goals', label: 'Goals', icon: Target },
    { id: 'data', label: 'Data', icon: FileJson },
    { id: 'emailsetup', label: 'Email Setup', icon: Mail },
    { id: 'apikeys', label: 'API Keys', icon: Code },
    { id: 'notifications', label: 'Notifications', icon: Bell, disabled: true, tag: 'Soon' },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  // When showing a full-page sub-view, render it outside the narrow layout
  // Sub-view rendering for Data Setup sections
  const dataSetupViews = {
    'Payment Methods': <PaymentMethods />,
    'Vendors': <Vendors />,
    'Accounts': <Accounts />,
    'Marketplaces': <Marketplaces />,
    'Cashouts': <Cashouts />,
  };

  if (activeDataSetupView && dataSetupViews[activeDataSetupView]) {
    return (
      <div className="space-y-4 pb-10">
        <button
          onClick={() => setActiveDataSetupView(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} /> Back to Settings
        </button>
        {dataSetupViews[activeDataSetupView]}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your account preferences</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Left Sidebar Navigation */}
        <div className="w-full md:w-56 flex-shrink-0 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => { setActiveTab(item.id); setActiveDataSetupView(null); }}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === item.id 
                  ? 'bg-gray-800 text-white shadow-sm border border-gray-700/50' 
                  : (item.disabled ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/5')
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon size={16} className={activeTab === item.id ? 'text-white' : 'text-gray-500'} />
                {item.label}
              </div>
              {item.tag && (
                <span className="text-[10px] uppercase font-bold text-gray-600">{item.tag}</span>
              )}
            </button>
          ))}
        </div>

        {/* Right Content Area */}
        <div className="flex-1">
          {/* PROFILE TAB */}
          {activeTab === 'profile' && (
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
              <h2 className="text-sm font-bold text-white">Profile</h2>
              
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-purple-500 border-2 border-white/10 flex items-center justify-center font-bold text-white overflow-hidden">
                    {/* Placeholder Avatar Image based on mockup */}
                    <div className="w-full h-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-xs">👶</div>
                 </div>
                 <div>
                    <h3 className="font-bold text-white">CarlBBB</h3>
                    <p className="text-xs text-gray-500">Connected via Discord</p>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Username</label>
                    <input type="text" readOnly defaultValue="CarlBBB" className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Discord User ID</label>
                    <input type="text" readOnly defaultValue="764650086244155413" className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
                 </div>
              </div>
              
              <p className="text-xs text-gray-600 pt-2">Profile information is managed through your Discord account.</p>
            </div>
          )}

          {/* DATA SETUP TAB */}
          {activeTab === 'datasetup' && (
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
              <div>
                <h2 className="text-sm font-bold text-white mb-2">Data Setup</h2>
                <p className="text-xs text-gray-500">These pages were moved from the sidebar to keep navigation cleaner and easier to scan.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {['Payment Methods', 'Vendors', 'Accounts', 'Marketplaces', 'Cashouts'].map((title) => (
                  <button
                    key={title}
                    onClick={() => setActiveDataSetupView(title)}
                    className="flex justify-between items-center p-3 rounded border border-gray-800 bg-[#16161E] hover:bg-gray-800 transition-colors text-sm text-gray-300 text-left"
                  >
                    {title}
                    <ExternalLink size={14} className="text-gray-500" />
                  </button>
                ))}
              </div>
            </div>
          )}


          {/* GOALS TAB */}
          {activeTab === 'goals' && (
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <Target size={16} /> Goal Tracking
                </h2>
                <p className="text-xs text-gray-500">Set profit, revenue, cashback, or volume targets. Active goals appear on your Dashboard.</p>
              </div>

              <div className="space-y-6">
                {/* Profit Goal */}
                <div className="flex items-center gap-6 border-b border-gray-800/50 pb-6">
                  <div className="w-24 text-sm font-bold text-green-400">Profit</div>
                  <div className="flex bg-[#0f0f13] border border-gray-800 rounded p-0.5">
                    <button onClick={() => toggleGoalType('profit')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.profit.type === 'Weekly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Weekly</button>
                    <button onClick={() => toggleGoalType('profit')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.profit.type === 'Monthly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Monthly</button>
                  </div>
                  <div className="relative">
                     <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                     <input type="text" defaultValue={goals.profit.value} className="w-28 bg-[#0A0A0F] border border-gray-800 rounded pl-6 pr-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
                  </div>
                  <button onClick={() => toggleGoalActive('profit')} className={`ml-auto w-5 h-5 rounded border flex items-center justify-center ${goals.profit.active ? 'bg-white border-white' : 'border-gray-600'}`}>
                    {goals.profit.active && <div className="w-2.5 h-2.5 rounded-sm bg-[#12121A]"></div>}
                  </button>
                </div>

                {/* Revenue Goal */}
                <div className="flex items-center gap-6 border-b border-gray-800/50 pb-6">
                  <div className="w-24 text-sm font-bold text-green-400">Revenue</div>
                  <div className="flex bg-[#0f0f13] border border-gray-800 rounded p-0.5">
                    <button onClick={() => toggleGoalType('revenue')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.revenue.type === 'Weekly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Weekly</button>
                    <button onClick={() => toggleGoalType('revenue')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.revenue.type === 'Monthly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Monthly</button>
                  </div>
                  <div className="relative">
                     <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                     <input type="text" defaultValue={goals.revenue.value} className="w-28 bg-[#0A0A0F] border border-gray-800 rounded pl-6 pr-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
                  </div>
                  <button onClick={() => toggleGoalActive('revenue')} className={`ml-auto w-5 h-5 rounded border flex items-center justify-center ${goals.revenue.active ? 'bg-white border-white' : 'border-gray-600'}`}>
                    {goals.revenue.active && <div className="w-2.5 h-2.5 rounded-sm bg-[#12121A]"></div>}
                  </button>
                </div>
                
                {/* Cashback Goal */}
                <div className="flex items-center gap-6 border-b border-gray-800/50 pb-6">
                  <div className="w-24 text-sm font-bold text-pink-400">Cashback</div>
                  <div className="flex bg-[#0f0f13] border border-gray-800 rounded p-0.5">
                    <button onClick={() => toggleGoalType('cashback')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.cashback.type === 'Weekly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Weekly</button>
                    <button onClick={() => toggleGoalType('cashback')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.cashback.type === 'Monthly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Monthly</button>
                  </div>
                  <div className="relative">
                     <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                     <input type="text" defaultValue={goals.cashback.value} className="w-28 bg-[#0A0A0F] border border-gray-800 rounded pl-6 pr-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
                  </div>
                  <button onClick={() => toggleGoalActive('cashback')} className={`ml-auto w-5 h-5 rounded border flex items-center justify-center ${goals.cashback.active ? 'bg-white border-white' : 'border-gray-600'}`}>
                    {goals.cashback.active && <div className="w-2.5 h-2.5 rounded-sm bg-[#12121A]"></div>}
                  </button>
                </div>

                {/* Transactions Goal */}
                <div className="flex items-center gap-6 pb-2">
                  <div className="w-24 text-sm font-bold text-purple-400">Transactions</div>
                  <div className="flex bg-[#0f0f13] border border-gray-800 rounded p-0.5">
                    <button onClick={() => toggleGoalType('transactions')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.transactions.type === 'Weekly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Weekly</button>
                    <button onClick={() => toggleGoalType('transactions')} className={`px-2 py-0.5 text-xs rounded transition-colors ${goals.transactions.type === 'Monthly' ? 'bg-purple-900/40 text-purple-300' : 'text-gray-500'}`}>Monthly</button>
                  </div>
                  <div className="relative">
                     <input type="text" defaultValue={goals.transactions.value} className="w-28 bg-[#0A0A0F] border border-gray-800 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-gray-600" />
                  </div>
                  <button onClick={() => toggleGoalActive('transactions')} className={`ml-auto w-5 h-5 rounded border flex items-center justify-center ${goals.transactions.active ? 'bg-white border-white' : 'border-gray-600'}`}>
                    {goals.transactions.active && <div className="w-2.5 h-2.5 rounded-sm bg-[#12121A]"></div>}
                  </button>
                </div>
                
                <button className="px-4 py-2 mt-4 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600/50">
                  Save Goals
                </button>
              </div>
            </div>
          )}

          {/* DATA TAB */}
          {activeTab === 'data' && (
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <Download size={16} /> Export Data
                </h2>
                <p className="text-xs text-gray-500">Select which data to include in your export file.</p>
                <div className="text-[10px] uppercase text-gray-600 font-bold tracking-wider mt-4">
                   <span className="hover:text-gray-400 cursor-pointer">Select all</span> <span className="mx-1">|</span> <span className="hover:text-gray-400 cursor-pointer">Deselect all</span>
                </div>
              </div>

              <div className="space-y-4">
                 {[
                   { label: 'Stores', desc: 'Your store locations' },
                   { label: 'Accounts', desc: 'Store accounts' },
                   { label: 'Payment Methods', desc: 'Credit cards & payment info' },
                   { label: 'Card-Store Rates', desc: 'Cashback rules per card/store' },
                   { label: 'Goals', desc: 'Weekly/monthly targets and active metrics' },
                   { label: 'Expenses', desc: 'Recurring and one-time business expenses' },
                   { label: 'Tax Rules & Scenarios', desc: 'Tax calculator scenarios and custom deduction rules' },
                   { label: 'Transactions', desc: 'All purchase & sale records' },
                   { label: 'Inventory', desc: 'Current inventory items' },
                   { label: 'Buyers', desc: 'Buyers & selling platforms' }
                 ].map((item) => (
                   <div key={item.label} className="flex gap-3">
                     <button className="mt-1 flex-shrink-0 w-4 h-4 rounded border border-gray-600 bg-transparent flex items-center justify-center">
                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                     </button>
                     <div>
                       <div className="text-sm text-gray-300 font-medium">{item.label}</div>
                       <div className="text-xs text-gray-600">{item.desc}</div>
                     </div>
                   </div>
                 ))}
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-800/50">
                 <button className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors border border-gray-700/50">
                   <Download size={14} /> Export as JSON
                 </button>
                 <button className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors border border-gray-700/50">
                   <Download size={14} /> Export with Receipts (ZIP)
                 </button>
                 <button className="flex items-center gap-2 px-4 py-2 bg-transparent hover:bg-white/5 text-gray-300 text-sm font-medium rounded-lg transition-colors">
                   Transactions CSV
                 </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
