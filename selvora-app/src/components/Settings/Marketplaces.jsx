import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, Plus, Search, X, Edit2, Trash2, 
  Check
} from 'lucide-react';

// ─── Quick Add Store Directory ────────────────────────────────────────────────
const QUICK_ADD_STORES = [
  { name: 'Amazon FBA',             type: 'marketplace', category: 'Retail' },
  { name: 'eBay',                   type: 'marketplace', category: 'General' },
  { name: 'Mercari',                type: 'marketplace', category: 'General' },
  { name: 'Poshmark',               type: 'marketplace', category: 'Apparel' },
  { name: 'Facebook Marketplace',   type: 'marketplace', category: 'Local / General' },
  { name: 'OfferUp',                type: 'marketplace', category: 'Local / General' },
  { name: 'Craigslist',             type: 'marketplace', category: 'Local / General' },
  { name: 'Swappa',                 type: 'marketplace', category: 'Electronics' },
  { name: 'StockX',                 type: 'marketplace', category: 'Sneakers & Apparel' },
  { name: 'GOAT',                   type: 'marketplace', category: 'Sneakers & Apparel' },
  { name: 'Depop',                  type: 'marketplace', category: 'Apparel' },
  { name: 'Whatnot',                type: 'marketplace', category: 'Live Auction' },
  { name: 'Walmart Marketplace',    type: 'marketplace', category: 'Retail' },
];

const ALL_CATEGORIES = ['All Categories', ...new Set(QUICK_ADD_STORES.map(s => s.category))];

const MARKETPLACE_DOMAINS = {
  'Amazon FBA': 'amazon.com',
  'eBay': 'ebay.com',
  'Mercari': 'mercari.com',
  'Poshmark': 'poshmark.com',
  'Facebook Marketplace': 'facebook.com',
  'OfferUp': 'offerup.com',
  'Craigslist': 'craigslist.org',
  'Swappa': 'swappa.com',
  'StockX': 'stockx.com',
  'GOAT': 'goat.com',
  'Depop': 'depop.com',
  'Whatnot': 'whatnot.com',
  'Walmart Marketplace': 'walmart.com'
};

// ─── Logo initials badge ───────────────────────────────────────────────
function MarketplaceBadge({ name }) {
  const [imgLevel, setImgLevel] = useState(0);
  const domain = MARKETPLACE_DOMAINS[name];

  const colors = [
    'from-amber-500 to-orange-600',
    'from-red-500 to-rose-600',
    'from-pink-500 to-purple-600',
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
      <div className="w-10 h-10 rounded-xl bg-white overflow-hidden flex items-center justify-center flex-shrink-0 p-1 border border-white/10">
        <img 
          src={src} 
          alt={name}
          title={name}
          onError={handleImgError}
          className="w-full h-full object-contain"
          style={{ borderRadius: '4px' }}
        />
      </div>
    );
  }

  return (
    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors[idx]} flex items-center justify-center font-bold text-white text-sm flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Custom Add Modal ──────────────────────────────────────────────────
function CustomModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', type: 'Marketplace', address: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      });
      if (res.ok) {
        const platform = await res.json();
        onSave(platform);
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
          <h3 className="text-base font-semibold text-white">Add Marketplace</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Marketplace Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              placeholder="e.g. eBay, StockX..."
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-amber-500/50 transition-colors appearance-none"
            >
              <option value="Marketplace">Marketplace</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition-colors resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Add Modal ──────────────────────────────────────────────────────────
function QuickAddModal({ existingPlatforms, onClose, onSave }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All Categories');
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);

  const existingNames = new Set(existingPlatforms.map(v => v.name.toLowerCase()));

  const filtered = QUICK_ADD_STORES.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === 'All Categories' || s.category === category;
    return matchSearch && matchCat;
  });

  const alreadyAdded = QUICK_ADD_STORES.filter(s => existingNames.has(s.name.toLowerCase())).length;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const toggle = (name) => {
    if (existingNames.has(name.toLowerCase())) return;
    setSelected(s => ({ ...s, [name]: !s[name] }));
  };

  const handleAdd = async () => {
    const toAdd = QUICK_ADD_STORES.filter(s => selected[s.name]);
    if (toAdd.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/platforms/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vendors: toAdd.map(v => ({ ...v, type: 'Marketplace' })) })
      });
      if (res.ok) {
        const created = await res.json();
        onSave(created);
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
      <div className="w-full max-w-lg bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-white">Quick Add Marketplaces</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Category Filter */}
        <div className="px-4 pt-4 pb-2 flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search marketplaces..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none appearance-none"
          >
            {ALL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <p className="px-5 text-xs text-gray-500 pb-2">
          Showing {filtered.length} of {QUICK_ADD_STORES.length} marketplaces ({alreadyAdded} already added)
        </p>

        {/* List */}
        <div className="flex-1 overflow-y-auto modal-scrollbar px-4 space-y-1 pb-2">
          {filtered.map(store => {
            const isAdded = existingNames.has(store.name.toLowerCase());
            const isChecked = !!selected[store.name];
            return (
              <button
                key={store.name}
                onClick={() => toggle(store.name)}
                disabled={isAdded}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                  isAdded
                    ? 'opacity-40 cursor-default'
                    : isChecked
                    ? 'bg-amber-500/20 border border-amber-500/30'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <MarketplaceBadge name={store.name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{store.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{store.category}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${
                  isAdded ? 'border-amber-500 bg-amber-500/20' :
                  isChecked ? 'border-amber-400 bg-amber-500' : 'border-gray-600'
                }`}>
                  {(isAdded || isChecked) && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={saving || selectedCount === 0}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Adding...' : `Add Marketplace${selectedCount > 1 ? 's' : ''}${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Marketplaces Component ───────────────────────────────────────────────────
export function Marketplaces() {
  const [platforms, setPlatforms] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3000/api/platforms', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPlatforms(data.filter(p => p.type === 'Marketplace'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this marketplace?')) return;
    try {
      await fetch(`http://localhost:3000/api/platforms/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      setPlatforms(v => v.filter(x => x.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveNew = (platform) => {
    setPlatforms(v => [...v, platform]);
  };

  const handleBatchSave = (newPlatforms) => {
    setPlatforms(v => [...v, ...newPlatforms]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Marketplaces</h1>
        <p className="text-sm text-gray-400 mt-1">Manage where you sell your inventory online (e.g. eBay, StockX).</p>
      </div>

      {/* List */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-gray-300">{platforms.length}</span> marketplaces — where you sell online
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQuickAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-gray-300 text-sm font-medium hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Quick Add
            </button>
            <button
              onClick={() => setShowCustom(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Custom
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading marketplaces...</div>
        ) : platforms.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
            No marketplaces yet. Click <span className="text-amber-500 font-medium">Quick Add</span> to import from our directory.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms.map(platform => (
              <div key={platform.id} className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4 hover:border-white/[0.14] transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <MarketplaceBadge name={platform.name} />
                    <div>
                      <p className="text-sm font-semibold text-white">{platform.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{platform.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 text-gray-500 hover:text-white transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(platform.id)}
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {platform.notes && (
                  <p className="text-xs text-gray-500 mt-2 italic">{platform.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCustom && (
        <CustomModal onClose={() => setShowCustom(false)} onSave={handleSaveNew} />
      )}
      {showQuickAdd && (
        <QuickAddModal
          existingPlatforms={platforms}
          onClose={() => setShowQuickAdd(false)}
          onSave={handleBatchSave}
        />
      )}
    </div>
  );
}

export default Marketplaces;
