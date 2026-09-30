import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  User, Database, FileJson, Bell, Palette, ExternalLink, ArrowLeft
} from 'lucide-react';
import { PaymentMethods } from '../components/Settings/PaymentMethods';
import { Vendors } from '../components/Settings/Vendors';
import { Cashouts } from '../components/Settings/Cashouts';
import { Marketplaces } from '../components/Settings/Marketplaces';
import { Accounts } from '../components/Settings/Accounts';
import { UiPreferences } from '../components/Settings/UiPreferences';
import { ScheduleCSettings } from '../components/Settings/ScheduleCSettings';
import { useAuth } from '../context/AuthContext';
import FirebaseAccount from '../components/Auth/FirebaseAccount';
import { SCHEDULE_C_ENABLED } from '../config/features';

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
    ...(SCHEDULE_C_ENABLED ? [{ id: 'tax', label: 'Schedule C', icon: FileJson }] : []),
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
      {activeTab === 'profile' && <FirebaseAccount />}
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
                    <p className="text-xs text-gray-500">Signed in with Firebase</p>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Username</label>
                    <input type="text" readOnly value={user?.username || ''} className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Account ID</label>
                    <input type="text" readOnly value={user?.id || ''} className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none" />
                 </div>
              </div>

              <p className="text-xs text-gray-600 pt-2">Your records stay associated with this account ID when you change login methods.</p>
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
            <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6">
              <div className="py-16 text-center text-gray-500">
                <FileJson size={28} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-gray-400">Data export is coming soon.</p>
                <p className="text-xs text-gray-600 mt-1">You'll be able to export your stores, transactions, inventory, and more from here.</p>
              </div>
            </div>
          )}

          {/* TAX TAB */}
          {SCHEDULE_C_ENABLED && activeTab === 'tax' && <ScheduleCSettings />}

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
