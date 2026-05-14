import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Plus, Search, X, Edit2, Trash2,
  Check
} from 'lucide-react';
import { useInvalidate, apiFetch} from '../../hooks/useApi';

// ─── Quick Add Store Directory ────────────────────────────────────────────────
const QUICK_ADD_STORES = [
  { name: 'POINTS4DAYS',            type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'MaxOutDeals',            type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'powerbuynetwork',        type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'EarnFromBuying',         type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'ubuywepay',              type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'BigDealPoints',          type: 'cashout', category: 'Wholesale / Cashout' },
  { name: 'CardKangaroo',           type: 'cashout', category: 'Gift Cards' },
  { name: 'CardCash',               type: 'cashout', category: 'Gift Cards' },
  { name: 'CardPool',               type: 'cashout', category: 'Gift Cards' },
  { name: 'Raise',                  type: 'cashout', category: 'Gift Cards' },
  { name: 'ClipKard',               type: 'cashout', category: 'Gift Cards' },
  { name: 'GiftDeals',              type: 'cashout', category: 'Gift Cards' },
  { name: 'BuySellVouchers',        type: 'cashout', category: 'Gift Cards' },
];

const ALL_CATEGORIES = ['All Categories', ...new Set(QUICK_ADD_STORES.map(s => s.category))];

const CASHOUT_DOMAINS = {
  'POINTS4DAYS': 'points4days.com',
  'MaxOutDeals': 'maxoutdeals.com',
  'powerbuynetwork': 'powerbuynetwork.com',
  'EarnFromBuying': 'earnfrombuying.com',
  'ubuywepay': 'ubuywepay.com',
  'BigDealPoints': 'bigdealpoints.com',
  'CardKangaroo': 'cardkangaroo.com',
  'CardCash': 'cardcash.com',
  'CardPool': 'cardpool.com',
  'Raise': 'raise.com',
  'ClipKard': 'clipkard.com',
  'GiftDeals': 'giftdeals.com',
  'BuySellVouchers': 'buysellvouchers.com'
};

// ─── Logo initials badge ───────────────────────────────────────────────
function CashoutBadge({ name }) {
  const [imgLevel, setImgLevel] = useState(0);
  const domain = CASHOUT_DOMAINS[name];

  const colors = [
    'from-emerald-500 to-green-600',
    'from-blue-500 to-cyan-600',
    'from-purple-500 to-indigo-600',
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
  const [form, setForm] = useState({ name: '', type: 'Cashout', address: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/platforms`, {
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
          <h3 className="text-base font-semibold text-white">Add Cashout Group</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Group Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              placeholder="e.g. POINTS4DAYS..."
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-green-500/50 transition-colors appearance-none"
            >
              <option value="Cashout">Cashout</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors resize-none"
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
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ platform, onClose, onSave }) {
  const [form, setForm] = useState({
    name: platform.name,
    tax_exempt_place: platform.tax_exempt_place || false,
  });
  const [saving, setSaving] = useState(false);

  const taxExemptChanged = form.tax_exempt_place !== (platform.tax_exempt_place || false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/platforms/${platform.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name,
          type: platform.type,
          fee_pct: platform.fee_pct,
          address: platform.address,
          notes: platform.notes,
          tax_exempt_place: form.tax_exempt_place,
        })
      });
      if (res.ok) {
        const updated = await res.json();
        onSave(updated);
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
          <h3 className="text-base font-semibold text-white">Edit Cashout Group</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Group Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-2">Tax Exempt Place</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, tax_exempt_place: !f.tax_exempt_place }))}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-all text-left ${
                form.tax_exempt_place
                  ? 'bg-white/[0.02] border-green-500/50'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
              }`}
            >
              <div className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${form.tax_exempt_place ? 'bg-green-500' : 'bg-gray-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.tax_exempt_place ? 'left-4' : 'left-0.5'}`} />
              </div>
              <div>
                <p className={`text-sm font-medium ${form.tax_exempt_place ? 'text-green-300' : 'text-gray-300'}`}>
                  {form.tax_exempt_place ? 'Tax Exempt Place' : 'Not Tax Exempt'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {form.tax_exempt_place
                    ? 'Sales to this group will auto-fill as non-taxable and customer exempt'
                    : 'Toggle on if sales to this cashout are tax exempt'}
                </p>
              </div>
            </button>
          </div>
          {taxExemptChanged && (
            <div className={`px-3 py-2.5 rounded-lg border text-xs ${
              form.tax_exempt_place
                ? 'bg-green-500/5 border-green-500/20 text-green-400'
                : 'bg-amber-500/5 border-amber-500/20 text-amber-400'
            }`}>
              {form.tax_exempt_place
                ? 'All existing sales to this cashout will be updated: taxable off, customer exempt on, exemption type set to Resale.'
                : 'All existing sales to this cashout will be reset: taxable on, customer exempt off, exemption type cleared.'}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
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
      const res = await apiFetch(`/api/platforms/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vendors: toAdd.map(v => ({ ...v, type: 'Cashout' })) })
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
          <h3 className="text-base font-semibold text-white">Quick Add Cashout Groups</h3>
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
              placeholder="Search cashout groups..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#0d0d18] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50"
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
          Showing {filtered.length} of {QUICK_ADD_STORES.length} groups ({alreadyAdded} already added)
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
                    ? 'bg-green-600/20 border border-green-500/30'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <CashoutBadge name={store.name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{store.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{store.category}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${
                  isAdded ? 'border-green-500 bg-green-500/20' :
                  isChecked ? 'border-green-400 bg-green-500' : 'border-gray-600'
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
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Adding...' : `Add Group${selectedCount > 1 ? 's' : ''}${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Cashouts Component ───────────────────────────────────────────────────
export function Cashouts() {
  const [platforms, setPlatforms] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editPlatform, setEditPlatform] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const invalidate = useInvalidate();

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/platforms`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPlatforms(data.filter(p => p.type === 'Cashout'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this cashout group?')) return;
    try {
      await apiFetch(`/api/platforms/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      setPlatforms(v => v.filter(x => x.id !== id));
      invalidate.platforms();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveNew = (platform) => {
    setPlatforms(v => [...v, platform]);
    invalidate.platforms();
  };

  const handleSaveEdit = (updated) => {
    setPlatforms(v => v.map(p => p.id === updated.id ? updated : p));
    invalidate.platforms();
  };

  const handleBatchSave = (newPlatforms) => {
    setPlatforms(v => [...v, ...newPlatforms]);
    invalidate.platforms();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Cashouts</h1>
        <p className="text-sm text-gray-400 mt-1">Manage wholesale buyers and cashout groups.</p>
      </div>

      {/* List */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-gray-300">{platforms.length}</span> groups — who you wholesale to
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Custom
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading cashout groups...</div>
        ) : platforms.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
            No cashout groups yet. Click <span className="text-green-400 font-medium">Quick Add</span> to import from our directory.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms.map(platform => (
              <div key={platform.id} className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4 hover:border-white/[0.14] transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <CashoutBadge name={platform.name} />
                    <div>
                      <p className="text-sm font-semibold text-white">{platform.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{platform.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditPlatform(platform)}
                      className="p-1 text-gray-500 hover:text-white transition-colors"
                    >
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
                {platform.tax_exempt_place && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border bg-green-500/10 text-green-400 border-green-500/20">
                    Tax Exempt
                  </span>
                )}
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
      {editPlatform && (
        <EditModal
          platform={editPlatform}
          onClose={() => setEditPlatform(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

export default Cashouts;
