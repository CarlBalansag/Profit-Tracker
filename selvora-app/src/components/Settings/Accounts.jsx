import React, { useState, useEffect, useCallback } from 'react';
import { 
  User, Database, Plus, Search, X, Edit2, Trash2, 
  ArrowLeft, Check, Store
} from 'lucide-react';

// Using Google Favicons for robust logo fetching mirroring Vendors tab
const VENDOR_DOMAINS = {
  'Amazon': 'amazon.com',
  'Amazon FBA': 'amazon.com',
  'Walmart': 'walmart.com',
  'Target': 'target.com',
  'Best Buy': 'bestbuy.com',
  'Costco': 'costco.com',
  "Sam's Club": 'samsclub.com',
  'GameStop': 'gamestop.com',
  'Micro Center': 'microcenter.com',
  'B&H Photo': 'bhphotovideo.com',
  'Newegg': 'newegg.com',
  'Pokemon Center': 'pokemoncenter.com',
  'Home Depot': 'homedepot.com',
  "Lowe's": 'lowes.com',
  'Menards': 'menards.com',
  'Staples': 'staples.com',
  'Office Depot': 'officedepot.com',
  'Dollar General': 'dollargeneral.com',
  'Dollar Tree': 'dollartree.com',
  'Family Dollar': 'familydollar.com',
  'Big Lots': 'biglots.com',
  'Five Below': 'fivebelow.com',
  "Kohl's": 'kohls.com',
  'JCPenney': 'jcpenney.com',
  "Macy's": 'macys.com',
  'Nordstrom': 'nordstrom.com',
  'TJ Maxx': 'tjmaxx.tjx.com',
  'Marshalls': 'marshalls.com',
  'Ross': 'rossstores.com',
  'Ulta Beauty': 'ulta.com',
  'Sephora': 'sephora.com',
  'Bath & Body Works': 'bathandbodyworks.com',
  'Academy Sports': 'academy.com',
  "Dick's Sporting Goods": 'dickssportinggoods.com',
  'REI': 'rei.com',
  'Nike': 'nike.com',
  'SNKRS': 'nike.com',
  'Adidas': 'adidas.com',
  'Foot Locker': 'footlocker.com',
  'Finish Line': 'finishline.com',
  'Champs Sports': 'champssports.com',
  'Supreme': 'supremenewyork.com',
  'StockX': 'stockx.com',
  'GOAT': 'goat.com',
  'eBay': 'ebay.com',
  'Bed Bath & Beyond': 'bedbathandbeyond.com',
  'IKEA': 'ikea.com',
  'Wayfair': 'wayfair.com',
  'Ace Hardware': 'acehardware.com',
  'Harbor Freight': 'harborfreight.com',
  'Tractor Supply': 'tractorsupply.com',
  'AutoZone': 'autozone.com',
  "O'Reilly Auto Parts": 'oreillyauto.com',
  'Advance Auto Parts': 'advanceautoparts.com'
};

function VendorBadge({ name, small = false }) {
  const [imgLevel, setImgLevel] = useState(0);
  const domain = VENDOR_DOMAINS[name];
  const sizeClass = small ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl';

  const colors = [
    'from-blue-500 to-indigo-600',
    'from-indigo-500 to-purple-600',
    'from-cyan-500 to-blue-600',
  ];
  const idx = name.charCodeAt(0) % colors.length;

  const handleImgError = () => {
    setImgLevel(prev => prev + 1);
  };

  const getImgSrc = () => {
    if (imgLevel === 0) return `https://logo.clearbit.com/${domain}?size=80`;
    if (imgLevel === 1) return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    return null;
  };

  const src = domain ? getImgSrc() : null;

  if (src && imgLevel < 2) {
    return (
      <div className={`${sizeClass} bg-white overflow-hidden flex items-center justify-center flex-shrink-0 p-1 border border-white/10`}>
        <img 
          src={src} 
          alt={name}
          title={name}
          onError={handleImgError}
          className="w-full h-full object-contain"
          style={{ borderRadius: '2px' }}
        />
      </div>
    );
  }

  return (
    <div className={`${sizeClass} bg-gradient-to-br ${colors[idx]} flex items-center justify-center font-bold text-white ${small ? 'text-xs' : 'text-sm'} flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Add Account Modal ────────────────────────────────────────────────────────
function AddAccountModal({ vendor, platformList, onClose, onSave }) {
  const [form, setForm] = useState({ 
    platform_id: vendor?.id || '', 
    name: '', 
    email: '', 
    username: '', 
    status: 'Active', 
    notes: '' 
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.platform_id) return;
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      });
      if (res.ok) {
        const account = await res.json();
        onSave(account);
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-white">Add Account</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Vendor *</label>
            <select
              value={form.platform_id}
              onChange={e => setForm(f => ({ ...f, platform_id: e.target.value }))}
              disabled={!!vendor}
              className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50 transition-colors appearance-none disabled:opacity-50"
            >
              <option value="">Select vendor</option>
              {platformList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Account Name *</label>
            <input
              type="text"
              placeholder="e.g. Main Account, Business..."
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                placeholder="login@email.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
              <input
                type="text"
                placeholder="Platform username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50 transition-colors appearance-none"
            >
              <option value="Active">Active</option>
              <option value="Review">In Review</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-white/10 bg-transparent text-sm font-semibold text-gray-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim() || !form.platform_id}
            className="px-5 py-2.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Accounts Component ───────────────────────────────────────────────────
export function Accounts() {
  const [platforms, setPlatforms] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/platforms`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPlatforms(data.filter(p => p.type === 'Vendor'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const handleAccountCreated = (newAccount) => {
    // Inject the new account into the platforms state natively
    setPlatforms(prev => prev.map(p => {
      if (p.id === newAccount.platform_id) {
        return { ...p, accounts: [...(p.accounts || []), newAccount] };
      }
      return p;
    }));
  };

  const handleAccountDeleted = async (accountId, platformId) => {
    if (!window.confirm("Remove this account permanently?")) return;
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/api/accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      setPlatforms(prev => prev.map(p => {
        if (p.id === platformId) {
          return { ...p, accounts: p.accounts.filter(a => a.id !== accountId) };
        }
        return p;
      }));
    } catch (err) {
      console.error(err);
    }
  }

  // View: Accounts list inside a selected vendor
  if (selectedVendor) {
    const activeVendor = platforms.find(p => p.id === selectedVendor.id) || selectedVendor;
    const vendorAccounts = activeVendor.accounts || [];

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSelectedVendor(null)}
              className="p-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3">
              <VendorBadge name={activeVendor.name} small />
              <div>
                <h1 className="text-xl font-bold text-white">{activeVendor.name} Accounts</h1>
                <p className="text-xs text-gray-500">{vendorAccounts.length} login profiles stored</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-[0_0_15px_rgba(79,70,229,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" /> Add Account
          </button>
        </div>

        {vendorAccounts.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm border border-dashed border-white/10 rounded-xl bg-white/[0.01]">
            <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
            No accounts mapped to {activeVendor.name} yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {vendorAccounts.map(acc => (
              <div key={acc.id} className="rounded-xl border border-white/10 bg-[#12121A] p-5 shadow-sm relative group overflow-hidden">
                <button 
                  onClick={() => handleAccountDeleted(acc.id, activeVendor.id)}
                  className="absolute top-4 right-4 p-1.5 rounded-md hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{acc.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${acc.status === 'Active' ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                      <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">{acc.status}</span>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5 text-sm">
                  <div>
                    <p className="text-gray-500 text-[10px] uppercase font-semibold tracking-wider">Email</p>
                    <p className="text-gray-300 mt-0.5 truncate">{acc.email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-[10px] uppercase font-semibold tracking-wider">Username</p>
                    <p className="text-gray-300 mt-0.5 truncate">{acc.username || '—'}</p>
                  </div>
                </div>
                {acc.notes && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <p className="text-gray-500 text-[10px] uppercase font-semibold tracking-wider">Notes</p>
                    <p className="text-gray-400 mt-0.5 text-xs line-clamp-2">{acc.notes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showAddModal && (
          <AddAccountModal 
            vendor={activeVendor} 
            platformList={platforms} 
            onClose={() => setShowAddModal(false)} 
            onSave={handleAccountCreated} 
          />
        )}
      </div>
    );
  }

  // Main View: Grid of Platforms
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Accounts</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your login profiles and multiple accounts linked to specific stores.</p>
      </div>

      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-300">{platforms.length}</span> platforms — where you purchase from
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500 text-sm">Loading platforms...</div>
      ) : platforms.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm border border-dashed border-white/10 rounded-xl bg-white/[0.01]">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
          No platforms yet. Add a vendor or marketplace first to manage its accounts.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {platforms.map(platform => {
            const accCount = platform.accounts ? platform.accounts.length : 0;
            return (
              <div 
                key={platform.id} 
                onClick={() => setSelectedVendor(platform)}
                className="rounded-xl border border-white/[0.08] bg-[#12121A] hover:bg-[#16161E] hover:border-white/[0.15] hover:shadow-lg transition-all cursor-pointer group flex flex-col h-full"
              >
                <div className="p-4 flex-1">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <VendorBadge name={platform.name} />
                      <div>
                        <p className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">{platform.name}</p>
                        <p className="text-[11px] text-gray-500 capitalize font-medium">{platform.type}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-2.5 border-t border-white/[0.06] bg-white/[0.01] flex items-center gap-2 rounded-b-xl">
                  <User className={`w-3.5 h-3.5 ${accCount > 0 ? 'text-indigo-400' : 'text-gray-500'}`} />
                  <span className={`text-xs font-medium ${accCount > 0 ? 'text-gray-300' : 'text-gray-500'}`}>
                    {accCount} account{accCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Accounts;
