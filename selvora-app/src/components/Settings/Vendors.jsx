import React, { useState, useEffect, useCallback } from 'react';
import { 
  Store, Plus, Search, X, Edit2, Trash2, 
  ChevronDown, Check
} from 'lucide-react';

// ─── Quick Add Store Directory ────────────────────────────────────────────────
const QUICK_ADD_STORES = [
  { name: 'Amazon',               type: 'online',    category: 'Retail' },
  { name: 'Walmart',              type: 'retail',    category: 'Retail' },
  { name: 'Target',               type: 'retail',    category: 'Retail' },
  { name: 'Best Buy',             type: 'retail',    category: 'Electronics' },
  { name: 'Costco',               type: 'online',    category: 'Wholesale' },
  { name: "Sam's Club",           type: 'wholesale', category: 'Wholesale' },
  { name: 'GameStop',             type: 'retail',    category: 'Electronics' },
  { name: 'Micro Center',         type: 'retail',    category: 'Electronics' },
  { name: 'B&H Photo',            type: 'online',    category: 'Electronics' },
  { name: 'Newegg',               type: 'online',    category: 'Electronics' },
  { name: 'Pokemon Center',       type: 'online',    category: 'Toys & Collectibles' },
  { name: 'Home Depot',           type: 'retail',    category: 'Home Improvement' },
  { name: "Lowe's",               type: 'retail',    category: 'Home Improvement' },
  { name: 'Menards',              type: 'retail',    category: 'Home Improvement' },
  { name: 'Staples',              type: 'retail',    category: 'Office' },
  { name: 'Office Depot',         type: 'retail',    category: 'Office' },
  { name: 'Dollar General',       type: 'retail',    category: 'Discount' },
  { name: 'Dollar Tree',          type: 'retail',    category: 'Discount' },
  { name: 'Family Dollar',        type: 'retail',    category: 'Discount' },
  { name: 'Big Lots',             type: 'retail',    category: 'Discount' },
  { name: 'Five Below',           type: 'retail',    category: 'Discount' },
  { name: "Kohl's",               type: 'retail',    category: 'Department' },
  { name: 'JCPenney',             type: 'retail',    category: 'Department' },
  { name: "Macy's",               type: 'retail',    category: 'Department' },
  { name: 'Nordstrom',            type: 'retail',    category: 'Department' },
  { name: 'TJ Maxx',              type: 'retail',    category: 'Department' },
  { name: 'Marshalls',            type: 'retail',    category: 'Department' },
  { name: 'Ross',                 type: 'retail',    category: 'Department' },
  { name: 'Ulta Beauty',          type: 'retail',    category: 'Beauty' },
  { name: 'Sephora',              type: 'retail',    category: 'Beauty' },
  { name: 'Bath & Body Works',    type: 'retail',    category: 'Beauty' },
  { name: 'Academy Sports',       type: 'retail',    category: 'Sports' },
  { name: "Dick's Sporting Goods",type: 'retail',    category: 'Sports' },
  { name: 'REI',                  type: 'retail',    category: 'Sports' },
  { name: 'Nike',                 type: 'online',    category: 'Apparel & Shoes' },
  { name: 'SNKRS',                type: 'online',    category: 'Apparel & Shoes' },
  { name: 'Adidas',               type: 'online',    category: 'Apparel & Shoes' },
  { name: 'Foot Locker',          type: 'retail',    category: 'Apparel & Shoes' },
  { name: 'Finish Line',          type: 'retail',    category: 'Apparel & Shoes' },
  { name: 'Champs Sports',        type: 'retail',    category: 'Apparel & Shoes' },
  { name: 'Supreme',              type: 'online',    category: 'Apparel & Shoes' },
  { name: 'StockX',               type: 'online',    category: 'Marketplace' },
  { name: 'GOAT',                 type: 'online',    category: 'Marketplace' },
  { name: 'eBay',                 type: 'online',    category: 'Marketplace' },
  { name: 'Bed Bath & Beyond',    type: 'retail',    category: 'Home' },
  { name: 'IKEA',                 type: 'retail',    category: 'Home' },
  { name: 'Wayfair',              type: 'online',    category: 'Home' },
  { name: 'Ace Hardware',         type: 'retail',    category: 'Home Improvement' },
  { name: 'Harbor Freight',       type: 'retail',    category: 'Home Improvement' },
  { name: 'Tractor Supply',       type: 'retail',    category: 'Farm' },
  { name: 'AutoZone',             type: 'retail',    category: 'Auto' },
  { name: "O'Reilly Auto Parts",  type: 'retail',    category: 'Auto' },
  { name: 'Advance Auto Parts',   type: 'retail',    category: 'Auto' },
];

const ALL_CATEGORIES = ['All Categories', ...new Set(QUICK_ADD_STORES.map(s => s.category))];

const VENDOR_DOMAINS = {
  'Amazon': 'amazon.com',
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

// ─── Vendor logo initials badge ───────────────────────────────────────────────
function VendorBadge({ name }) {
  const [imgLevel, setImgLevel] = useState(0);
  const domain = VENDOR_DOMAINS[name];

  const colors = [
    'from-orange-500 to-red-500',
    'from-blue-500 to-indigo-600',
    'from-green-500 to-emerald-600',
    'from-purple-500 to-violet-600',
    'from-pink-500 to-rose-600',
    'from-yellow-400 to-orange-500',
    'from-cyan-500 to-blue-600',
    'from-teal-500 to-green-600',
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

// ─── Custom Add Vendor Modal ──────────────────────────────────────────────────
function CustomModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', type: 'Vendor', address: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/platforms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      });
      if (res.ok) {
        const vendor = await res.json();
        onSave(vendor);
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
          <h3 className="text-base font-semibold text-white">Add Vendor</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Vendor Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              placeholder="e.g. Amazon, Home Depot..."
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-purple-500/50 transition-colors appearance-none"
            >
              <option value="Vendor">Vendor</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Address</label>
            <input
              type="text"
              placeholder="Optional"
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
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
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Add Modal ──────────────────────────────────────────────────────────
function QuickAddModal({ existingVendors, onClose, onSave }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All Categories');
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);

  const existingNames = new Set(existingVendors.map(v => v.name.toLowerCase()));

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
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/platforms/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vendors: toAdd.map(v => ({ ...v, type: 'Vendor' })) })
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
          <h3 className="text-base font-semibold text-white">Quick Add Vendors</h3>
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
              placeholder="Search vendors..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
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
          Showing {filtered.length} of {QUICK_ADD_STORES.length} vendors ({alreadyAdded} already added)
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
                    ? 'bg-indigo-600/20 border border-indigo-500/30'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <VendorBadge name={store.name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{store.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{store.type} · {store.category}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${
                  isAdded ? 'border-green-500 bg-green-500/20' :
                  isChecked ? 'border-indigo-400 bg-indigo-500' : 'border-gray-600'
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
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Adding...' : `Add Vendor${selectedCount > 1 ? 's' : ''}${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Vendors Component ───────────────────────────────────────────────────
export function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/platforms`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setVendors(data.filter(p => p.type === 'Vendor'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this vendor?')) return;
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/api/platforms/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      setVendors(v => v.filter(x => x.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveNew = (vendor) => {
    setVendors(v => [...v, vendor]);
  };

  const handleBatchSave = (newVendors) => {
    setVendors(v => [...v, ...newVendors]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Vendors</h1>
        <p className="text-sm text-gray-400 mt-1">Manage where you purchase from.</p>
      </div>

      {/* Vendors List */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-gray-300">{vendors.length}</span> vendors — where you purchase from
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Custom
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading vendors...</div>
        ) : vendors.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            No vendors yet. Click <span className="text-indigo-400 font-medium">Quick Add</span> to import from our store directory, or <span className="text-indigo-400 font-medium">Custom</span> to add your own.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {vendors.map(vendor => (
              <div key={vendor.id} className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4 hover:border-white/[0.14] transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <VendorBadge name={vendor.name} />
                    <div>
                      <p className="text-sm font-semibold text-white">{vendor.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{vendor.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 text-gray-500 hover:text-white transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(vendor.id)}
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {vendor.notes && (
                  <p className="text-xs text-gray-500 mt-2 italic">{vendor.notes}</p>
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
          existingVendors={vendors}
          onClose={() => setShowQuickAdd(false)}
          onSave={handleBatchSave}
        />
      )}
    </div>
  );
}

export default Vendors;
