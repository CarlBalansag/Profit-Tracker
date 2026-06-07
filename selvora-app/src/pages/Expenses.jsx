import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../hooks/useApi';
import {
  Receipt, Download, Plus, DollarSign, TrendingUp,
  Search, X, Trash2, Pencil, RefreshCw, Pause, Play,
} from 'lucide-react';

const CATEGORIES = [
  { value: 'CREDIT_CARD_FEE', label: 'Credit Card Fee',  color: 'text-blue-400' },
  { value: 'MEMBERSHIP',      label: 'Membership',        color: 'text-amber-400' },
  { value: 'PLATFORM_FEE',    label: 'Platform Fee',      color: 'text-purple-400' },
  { value: 'SHIPPING',        label: 'Shipping',          color: 'text-green-400' },
  { value: 'SOFTWARE',        label: 'Software / Tools',  color: 'text-cyan-400' },
  { value: 'OTHER',           label: 'Other',             color: 'text-gray-400' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

const FREQUENCIES = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly',  label: 'Monthly' },
];
const FREQ_MAP = Object.fromEntries(FREQUENCIES.map(f => [f.value, f.label]));

const todayStr = () => new Date().toISOString().split('T')[0];

const EMPTY_FORM = {
  name: '', amount: '', category: '',
  // one-off
  date: '',
  // recurring
  recurring: false, frequency: 'monthly', start_date: '', end_date: '',
  // shared
  notes: '',
};

// ─── Unified Add/Edit Modal ──────────────────────────────────────────────────
function ExpenseModal({ open, onClose, onSaveOneOff, onSaveRecurring, initial, initialIsRecurring }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const today = todayStr();
    if (initial) {
      if (initialIsRecurring) {
        setForm({
          name:       initial.name       || '',
          amount:     initial.amount     != null ? String(initial.amount) : '',
          category:   initial.category   || '',
          date:       today,
          recurring:  true,
          frequency:  initial.frequency  || 'monthly',
          start_date: initial.start_date ? new Date(initial.start_date).toISOString().split('T')[0] : today,
          end_date:   initial.end_date   ? new Date(initial.end_date).toISOString().split('T')[0]   : '',
          notes:      initial.notes      || '',
        });
      } else {
        setForm({
          name:       initial.name     || '',
          amount:     initial.amount   != null ? String(initial.amount) : '',
          category:   initial.category || '',
          date:       initial.date ? new Date(initial.date).toISOString().split('T')[0] : today,
          recurring:  false,
          frequency:  'monthly',
          start_date: today,
          end_date:   '',
          notes:      initial.notes    || '',
        });
      }
    } else {
      setForm({ ...EMPTY_FORM, date: today, start_date: today });
    }
    setError(''); setSaving(false);
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open, initial, initialIsRecurring]);

  if (!open) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError('Enter a valid amount greater than 0.'); return;
    }
    if (form.recurring) {
      if (!form.start_date) { setError('Start date is required.'); return; }
    } else {
      if (!form.date) { setError('Date is required.'); return; }
    }
    setSaving(true); setError('');
    try {
      if (form.recurring) {
        await onSaveRecurring({
          name:       form.name.trim(),
          amount:     parseFloat(form.amount),
          category:   form.category   || null,
          frequency:  form.frequency,
          start_date: form.start_date,
          end_date:   form.end_date   || null,
          notes:      form.notes.trim() || null,
        });
      } else {
        await onSaveOneOff({
          name:     form.name.trim(),
          amount:   parseFloat(form.amount),
          category: form.category || null,
          date:     form.date,
          notes:    form.notes.trim() || null,
        });
      }
      onClose();
    } catch (err) { setError(err.message || 'Failed to save.'); setSaving(false); }
  };

  const accent = form.recurring ? 'emerald' : 'purple';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-${accent}-500/15 border border-${accent}-500/25`}>
              {form.recurring
                ? <RefreshCw className="w-4 h-4 text-emerald-400" />
                : <Receipt   className="w-4 h-4 text-purple-400" />}
            </div>
            <h2 className="text-base font-semibold text-white">
              {initial
                ? (form.recurring ? 'Edit Recurring' : 'Edit Expense')
                : 'Add Expense'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Expense Name *</label>
            <input
              ref={nameRef} type="text"
              placeholder={form.recurring ? 'e.g. eBay Store Monthly Fee' : 'e.g. Shipping Label Purchase'}
              value={form.name} onChange={e => set('name', e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50`}
            />
          </div>

          {/* Amount + Date (one-off) or Amount + Frequency (recurring) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.amount} onChange={e => set('amount', e.target.value)}
                  className={`w-full pl-7 pr-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50`}
                />
              </div>
            </div>
            {form.recurring ? (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Frequency *</label>
                <select value={form.frequency} onChange={e => set('frequency', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-emerald-500/50 appearance-none">
                  {FREQUENCIES.map(f => <option key={f.value} value={f.value} className="bg-[#16181d]">{f.label}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Date *</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-purple-500/50" />
              </div>
            )}
          </div>

          {/* Recurring: start/end dates */}
          {form.recurring && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Start Date *</label>
                <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  End Date <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-emerald-500/50" />
              </div>
            </div>
          )}

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50 appearance-none`}>
              <option value="" className="bg-[#16181d]">Uncategorized</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value} className="bg-[#16181d]">{c.label}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Notes</label>
            <textarea placeholder="Optional description..." value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className={`w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50 resize-none`} />
          </div>

          {/* Recurring toggle — hide when editing an existing entry (type is fixed) */}
          {!initial && (
            <button
              type="button"
              onClick={() => set('recurring', !form.recurring)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border transition-colors ${
                form.recurring
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-white/[0.03] border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Recurring expense</span>
              </div>
              {/* pill toggle */}
              <div className={`relative w-8 h-4 rounded-full transition-colors ${form.recurring ? 'bg-emerald-500' : 'bg-white/20'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${form.recurring ? 'left-[18px]' : 'left-0.5'}`} />
              </div>
            </button>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className={`px-5 py-2 rounded-lg text-sm font-semibold text-white border transition-colors disabled:opacity-50 ${
                form.recurring
                  ? 'bg-emerald-600/80 hover:bg-emerald-600 border-emerald-500/40'
                  : 'bg-purple-600/80 hover:bg-purple-600 border-purple-500/40'
              }`}>
              {saving ? 'Saving…' : initial ? 'Save Changes' : form.recurring ? 'Add Recurring' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
const Expenses = () => {
  const [expenses, setExpenses]       = useState([]);
  const [recurring, setRecurring]     = useState([]);
  const [loading, setLoading]         = useState(true);

  const [modalOpen, setModalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [editingIsRec, setEditingIsRec]   = useState(false);

  const [deleteExpId, setDeleteExpId]   = useState(null);
  const [deleteRecId, setDeleteRecId]   = useState(null);

  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [sortBy, setSortBy]     = useState('DATE_DESC');

  const fetchAll = async () => {
    try {
      const [expRes, recRes] = await Promise.all([
        apiFetch(`/api/expenses`,           { credentials: 'include' }),
        apiFetch(`/api/recurring-expenses`, { credentials: 'include' }),
      ]);
      if (expRes.ok) setExpenses(await expRes.json());
      if (recRes.ok) setRecurring(await recRes.json());
    } catch { /* leave as-is */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const openAdd = () => { setEditingItem(null); setEditingIsRec(false); setModalOpen(true); };
  const openEditExp = (exp) => { setEditingItem(exp); setEditingIsRec(false); setModalOpen(true); };
  const openEditRec = (rec) => { setEditingItem(rec); setEditingIsRec(true);  setModalOpen(true); };

  const safeErrMsg = async (res, fallback) => {
    try { const j = await res.json(); return j.error || j.message || fallback; } catch { return `${fallback} (HTTP ${res.status})`; }
  };

  const handleSaveOneOff = async (data) => {
    const apiBase = (import.meta.env.VITE_API_DIRECT_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const url    = editingItem && !editingIsRec ? `${apiBase}/api/expenses/${editingItem.id}` : `${apiBase}/api/expenses`;
    const method = editingItem && !editingIsRec ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await safeErrMsg(res, 'Save failed'));
    await fetchAll();
  };

  const handleSaveRecurring = async (data) => {
    const apiBase = (import.meta.env.VITE_API_DIRECT_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const url    = editingItem && editingIsRec ? `${apiBase}/api/recurring-expenses/${editingItem.id}` : `${apiBase}/api/recurring-expenses`;
    const method = editingItem && editingIsRec ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await safeErrMsg(res, 'Save failed'));
    await fetchAll();
  };

  const handleDeleteExp = async (id) => {
    await apiFetch(`/api/expenses/${id}`, { method: 'DELETE', credentials: 'include' });
    setExpenses(p => p.filter(e => e.id !== id));
    setDeleteExpId(null);
  };

  const handleToggleActive = async (rec) => {
    await apiFetch(`/api/recurring-expenses/${rec.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ active: !rec.active }),
    });
    setRecurring(p => p.map(r => r.id === rec.id ? { ...r, active: !r.active } : r));
  };

  const handleDeleteRec = async (id) => {
    await apiFetch(`/api/recurring-expenses/${id}`, { method: 'DELETE', credentials: 'include' });
    setRecurring(p => p.filter(r => r.id !== id));
    setDeleteRecId(null);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  const monthlyCost = expenses
    .filter(e => { const d = new Date(e.date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; })
    .reduce((s, e) => s + e.amount, 0);

  const ytdCost = expenses
    .filter(e => new Date(e.date).getFullYear() === thisYear)
    .reduce((s, e) => s + e.amount, 0);

  const recurringMonthly = recurring.filter(r => r.active).reduce((s, r) => {
    if (r.frequency === 'monthly')  return s + r.amount;
    if (r.frequency === 'biweekly') return s + (r.amount * 26) / 12;
    if (r.frequency === 'weekly')   return s + (r.amount * 52) / 12;
    return s;
  }, 0);

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const filtered = expenses
    .filter(e => {
      if (catFilter && e.category !== catFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !(e.notes || '').toLowerCase().includes(q) && !(CATEGORY_MAP[e.category]?.label || '').toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'DATE_DESC')   return new Date(b.date) - new Date(a.date);
      if (sortBy === 'DATE_ASC')    return new Date(a.date) - new Date(b.date);
      if (sortBy === 'AMOUNT_DESC') return b.amount - a.amount;
      if (sortBy === 'AMOUNT_ASC')  return a.amount - b.amount;
      if (sortBy === 'NAME')        return a.name.localeCompare(b.name);
      return 0;
    });

  const exportCSV = () => {
    const rows = [
      ['Date', 'Name', 'Category', 'Amount', 'Notes'],
      ...filtered.map(e => [new Date(e.date).toLocaleDateString(), e.name, CATEGORY_MAP[e.category]?.label || 'Uncategorized', e.amount.toFixed(2), e.notes || '']),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'expenses.csv';
    a.click();
  };

  return (
    <div className="h-full overflow-auto px-4 py-6 sm:px-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">Track fees, memberships, and business costs</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-cyan-300 hover:bg-cyan-500/10 border border-cyan-400/35">
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all bg-gradient-to-br from-purple-500/80 to-purple-600/80 border border-purple-500/40 hover:from-purple-500 hover:to-purple-600">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">This Month</span>
            <DollarSign className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-white">${monthlyCost.toFixed(2)}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Year to Date</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">${ytdCost.toFixed(2)}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Recurring / Mo</span>
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-bold text-white">${recurringMonthly.toFixed(2)}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Total Entries</span>
            <Receipt className="w-4 h-4 text-green-400" />
          </div>
          <p className="text-xl font-bold text-white">{expenses.length}</p>
        </div>
      </div>

      {/* ── Recurring Section ────────────────────────────────────────────────── */}
      {recurring.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Recurring Expenses</h2>
            <span className="text-[10px] text-gray-500 ml-1">{recurring.filter(r => r.active).length} active</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recurring.map(rec => {
              const cat = CATEGORY_MAP[rec.category];
              return (
                <div key={rec.id}
                  className={`rounded-xl border p-4 transition-colors ${rec.active ? 'border-white/10 bg-white/[0.02]' : 'border-white/[0.05] bg-white/[0.01] opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{rec.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {FREQ_MAP[rec.frequency] || rec.frequency}
                        </span>
                        {cat && <span className={`text-[10px] font-medium ${cat.color}`}>{cat.label}</span>}
                        {!rec.active && <span className="text-[10px] text-gray-500 font-medium">Paused</span>}
                      </div>
                    </div>
                    <p className="text-base font-bold text-red-400 whitespace-nowrap">${rec.amount.toFixed(2)}</p>
                  </div>
                  {rec.notes && <p className="text-[11px] text-gray-500 mb-3 line-clamp-1">{rec.notes}</p>}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
                    <p className="text-[10px] text-gray-600">
                      Since {new Date(rec.start_date).toLocaleDateString()}
                      {rec.end_date ? ` → ${new Date(rec.end_date).toLocaleDateString()}` : ''}
                    </p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleToggleActive(rec)} title={rec.active ? 'Pause' : 'Resume'}
                        className={`p-1.5 rounded-lg transition-colors ${rec.active ? 'text-gray-500 hover:text-amber-400 hover:bg-amber-500/10' : 'text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10'}`}>
                        {rec.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => openEditRec(rec)} title="Edit"
                        className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteRecId(rec.id)} title="Delete"
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Expense Log ──────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {recurring.length > 0 && <h2 className="text-sm font-semibold text-white">Expense Log</h2>}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input type="text" placeholder="Search expenses..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.02] border border-white/10 focus:outline-none focus:border-purple-500/50" />
          </div>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
            <option value="" className="bg-gray-900">All Categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value} className="bg-gray-900">{c.label}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
            <option value="DATE_DESC"   className="bg-gray-900">Sort: Newest</option>
            <option value="DATE_ASC"    className="bg-gray-900">Sort: Oldest</option>
            <option value="AMOUNT_DESC" className="bg-gray-900">Sort: Amount (High–Low)</option>
            <option value="AMOUNT_ASC"  className="bg-gray-900">Sort: Amount (Low–High)</option>
            <option value="NAME"        className="bg-gray-900">Sort: Name</option>
          </select>
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setCatFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${catFilter === '' ? 'border-white/20 text-white bg-white/10' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}>
            All
          </button>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCatFilter(catFilter === c.value ? '' : c.value)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${catFilter === c.value ? 'border-white/20 bg-white/10' : 'border-white/10 hover:bg-white/5'} ${c.color}`}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="rounded-xl p-8 text-center bg-white/[0.02] border border-white/10">
            <p className="text-sm text-gray-500">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl p-12 text-center bg-white/[0.02] border border-white/10">
            <Receipt className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">{expenses.length === 0 ? 'No expenses yet' : 'No results found'}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {expenses.length === 0 ? 'Start tracking your business expenses and fees.' : 'Try adjusting your search or filters.'}
            </p>
            {expenses.length === 0 && (
              <button onClick={openAdd}
                className="px-4 py-2 rounded-lg text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors border border-purple-500/30">
                Add your first expense
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Category</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Notes</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                  <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((exp, i) => {
                  const cat        = CATEGORY_MAP[exp.category];
                  const isGenerated = !!exp.recurring_expense_id;
                  return (
                    <tr key={exp.id} className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap">
                        {exp.date ? new Date(exp.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-white">
                        <div className="flex items-center gap-2">
                          {exp.name}
                          {isGenerated && (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
                              <RefreshCw className="w-2.5 h-2.5" /> recurring
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {cat ? <span className={`text-xs font-medium ${cat.color}`}>{cat.label}</span> : <span className="text-xs text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs max-w-[200px] truncate">
                        {exp.notes || <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-red-400">${exp.amount.toFixed(2)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          {!isGenerated && (
                            <button onClick={() => openEditExp(exp)} title="Edit"
                              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => setDeleteExpId(exp.id)} title="Delete"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.08] bg-white/[0.015]">
                  <td colSpan={4} className="px-4 py-3 text-xs text-gray-500">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-red-400">${filtered.reduce((s, e) => s + e.amount, 0).toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Unified Modal ─────────────────────────────────────────────────────── */}
      <ExpenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaveOneOff={handleSaveOneOff}
        onSaveRecurring={handleSaveRecurring}
        initial={editingItem}
        initialIsRecurring={editingIsRec}
      />

      {/* Delete one-off confirm */}
      {deleteExpId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteExpId(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl p-6 text-center">
            <Trash2 className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white mb-1">Delete expense?</h3>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setDeleteExpId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
              <button onClick={() => handleDeleteExp(deleteExpId)} className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-red-600/80 hover:bg-red-600 border border-red-500/40 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete recurring confirm */}
      {deleteRecId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteRecId(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl p-6 text-center">
            <Trash2 className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white mb-1">Delete recurring expense?</h3>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setDeleteRecId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
              <button onClick={() => handleDeleteRec(deleteRecId)} className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-red-600/80 hover:bg-red-600 border border-red-500/40 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Expenses;
