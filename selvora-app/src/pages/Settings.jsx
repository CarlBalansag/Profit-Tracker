import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  User, Database, FileJson, Bell, Palette, ExternalLink, Download, ArrowLeft
} from 'lucide-react';
import { PaymentMethods } from '../components/Settings/PaymentMethods';
import { Vendors } from '../components/Settings/Vendors';
import { Cashouts } from '../components/Settings/Cashouts';
import { Marketplaces } from '../components/Settings/Marketplaces';
import { Accounts } from '../components/Settings/Accounts';
import { UiPreferences } from '../components/Settings/UiPreferences';
import { useAuth } from '../context/AuthContext';

function Settings() {
  const location = useLocation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'profile');
  const [activeDataSetupView, setActiveDataSetupView] = useState(location.state?.view || null);

  useEffect(() => {
    if (location.state?.tab) setActiveTab(location.state.tab);
    if (location.state?.view) setActiveDataSetupView(location.state.view);
  }, [location.state]);

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'datasetup', label: 'Data Setup', icon: Database },
    { id: 'data', label: 'Data', icon: FileJson },
    { id: 'notifications', label: 'Notifications', icon: Bell, disabled: true, tag: 'Soon' },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ];

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
                    <div className="w-full h-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-sm font-bold">
                      {(user?.username?.[0] || '?').toUpperCase()}
                    </div>
                 </div>
                 <div>
                    <h3 className="font-bold text-white">{user?.username || 'Unknown'}</h3>
                    <p className="text-xs text-gray-500">Connected via Discord</p>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Username</label>
                    <input type="text" readOnly value={user?.username || ''} className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Discord User ID</label>
                    <input type="text" readOnly value={user?.discord_id || ''} className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
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
                    data-tutorial-id={title === 'Vendors' || title === 'Marketplaces' || title === 'Cashouts' ? 'datasetup-platforms-tab' : title === 'Payment Methods' ? 'datasetup-payment-tab' : undefined}
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

          {/* APPEARANCE TAB */}
          {activeTab === 'appearance' && (
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6">
              <UiPreferences />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
