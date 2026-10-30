import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, usePaymentMethods } from '../hooks/useApi';
import { requireSuccessfulResponse } from '../hooks/apiResponse';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Receipt, Download, Plus, DollarSign,
  Search, X, Trash2, Pencil, RefreshCw, Pause, Play, CreditCard, Lock, ExternalLink, Info,
} from 'lucide-react';

// Categories a user can pick for a manual expense. Costs that belong to one
// purchase or sale (tax, inbound shipping, labels, platform fees) are entered
// on that transaction and listed here automatically -- see DERIVED_CATEGORIES.
const CATEGORIES = [
  { value: 'CREDIT_CARD_FEE',   label: 'Credit Card Fee',   color: 'text-blue-400' },
  { value: 'MEMBERSHIP',        label: 'Membership',        color: 'text-amber-400' },
  { value: 'SHIPPING_SUPPLIES', label: 'Shipping Supplies', color: 'text-green-400' },
  { value: 'SOFTWARE',          label: 'Software / Tools',  color: 'text-cyan-400' },
  { value: 'OTHER',             label: 'Other',             color: 'text-gray-400' },
];
// Retired manual categories: still shown on existing rows, no longer offered for new ones.
const LEGACY_CATEGORIES = [
  { value: 'PLATFORM_FEE', label: 'Platform Fee (old)', color: 'text-purple-400' },
  { value: 'SHIPPING',     label: 'Shipping (old)',     color: 'text-green-400' },
];
// Read-only lines computed by GET /api/expenses/derived.
const DERIVED_CATEGORIES = [
  { value: 'PURCHASE_TAX',      label: 'Purchase Tax',     color: 'text-orange-400' },
  { value: 'INBOUND_SHIPPING',  label: 'Inbound Shipping', color: 'text-teal-400' },
  { value: 'PURCHASE_FEE',      label: 'Purchase Fee',     color: 'text-pink-400' },
  { value: 'SHIPPING_LABEL',    label: 'Shipping Label',   color: 'text-lime-400' },
  { value: 'SALE_PLATFORM_FEE', label: 'Platform Fee',     color: 'text-purple-400' },
  { value: 'GIFT_CARD_CREDIT',  label: 'Gift Card Credit', color: 'text-emerald-400' },
];
const CATEGORY_MAP = Object.fromEntries([...CATEGORIES, ...LEGACY_CATEGORIES, ...DERIVED_CATEGORIES].map(c => [c.value, c]));

const SOURCE_LABELS = { manual: 'Manual', purchase: 'From purchase', sale: 'From sale' };
const sumAmounts = rows => rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
// Gift card lines are negative credits; show them as "−$50.00", never "$-50.00".
const formatMoney = value => {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return `${rounded < 0 ? '−' : ''}$${Math.abs(rounded).toFixed(2)}`;
};

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
  notes: '', payment_method_id: '',
};

// ─── Unified Add/Edit Modal ──────────────────────────────────────────────────
function ExpenseModal({ open, onClose, onSaveOneOff, onSaveRecurring, initial, initialIsRecurring, paymentMethods = [] }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const nameRef = useRef(null);
  const modalRef = useModalKeyboard(open, () => { if (!saving) onClose(); }, nameRef);

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
          payment_method_id: initial.payment_method_id || '',
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
          payment_method_id: initial.payment_method_id || '',
        });
      }
    } else {
      setForm({ ...EMPTY_FORM, date: today, start_date: today });
    }
    setError(''); setSaving(false);
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
          payment_method_id: form.payment_method_id || null,
        });
      } else {
        await onSaveOneOff({
          name:     form.name.trim(),
          amount:   parseFloat(form.amount),
          category: form.category || null,
          date:     form.date,
          notes:    form.notes.trim() || null,
          payment_method_id: form.payment_method_id || null,
        });
      }
      onClose();
    } catch (err) { setError(err.message || 'Failed to save.'); setSaving(false); }
  };

  const accent = form.recurring ? 'emerald' : 'purple';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div ref={modalRef} className="relative w-full max-w-md rounded-2xl bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated text-[var(--dp-text-primary)]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[color:var(--dp-border)]">
          <div className="flex items-center gap-2.5">
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-${accent}-500/15 border border-${accent}-500/25`}>
              {form.recurring
                ? <RefreshCw className="w-4 h-4 text-emerald-400" />
                : <Receipt   className="w-4 h-4 text-purple-400" />}
            </div>
            <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">
              {initial
                ? (form.recurring ? 'Edit Recurring' : 'Edit Expense')
                : 'Add Expense'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Expense Name *</label>
            <input
              ref={nameRef} type="text"
              placeholder={form.recurring ? 'e.g. eBay Store Monthly Fee' : 'e.g. Bubble mailers'}
              value={form.name} onChange={e => set('name', e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50`}
            />
            <p className="flex items-start gap-1.5 mt-1.5 text-[11px] text-gray-500">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Tax, shipping, a shipping label, or a platform fee for one purchase or sale? Enter it on that transaction instead. It shows up here automatically.
            </p>
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

          {/* Category + Card */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className={`w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50 appearance-none`}>
                <option value="" className="bg-[#16181d]">Uncategorized</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value} className="bg-[#16181d]">{c.label}</option>)}
                {LEGACY_CATEGORIES.filter(c => c.value === form.category).map(c => <option key={c.value} value={c.value} className="bg-[#16181d]">{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="expense-card" className="block text-xs font-medium text-gray-400 mb-1.5">
                Card <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <select id="expense-card" value={form.payment_method_id} onChange={e => set('payment_method_id', e.target.value)}
                className={`w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-${accent}-500/50 appearance-none`}>
                <option value="" className="bg-[#16181d]">No card / cash</option>
                {paymentMethods.map(pm => <option key={pm.id} value={pm.id} className="bg-[#16181d]">{pm.name}</option>)}
              </select>
            </div>
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
  const navigate = useNavigate();
  const [expenses, setExpenses]       = useState([]);
  const [derived, setDerived]         = useState([]);
  const [derivedFailed, setDerivedFailed] = useState(false);
  const [recurring, setRecurring]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const { data: paymentMethods = [] } = usePaymentMethods();

  const [modalOpen, setModalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [editingIsRec, setEditingIsRec]   = useState(false);

  const [deleteExpId, setDeleteExpId]   = useState(null);
  const [deleteRecId, setDeleteRecId]   = useState(null);
  const deleteExpModalRef = useModalKeyboard(!!deleteExpId, () => setDeleteExpId(null));
  const deleteRecModalRef = useModalKeyboard(!!deleteRecId, () => setDeleteRecId(null));

  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortBy, setSortBy]     = useState('DATE_DESC');

  const fetchAll = async () => {
    try {
      const [expRes, recRes, derRes] = await Promise.all([
        apiFetch(`/api/expenses`,           { credentials: 'include' }),
        apiFetch(`/api/recurring-expenses`, { credentials: 'include' }),
        apiFetch(`/api/expenses/derived`,   { credentials: 'include' }).catch(() => null),
      ]);
      if (expRes.ok) setExpenses(await expRes.json());
      if (recRes.ok) setRecurring(await recRes.json());
      const derivedLines = derRes?.ok ? await derRes.json() : null;
      setDerived(Array.isArray(derivedLines) ? derivedLines : []);
      setDerivedFailed(!Array.isArray(derivedLines));
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
    const url    = editingItem && !editingIsRec ? `/api/expenses/${editingItem.id}` : `/api/expenses`;
    const method = editingItem && !editingIsRec ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await safeErrMsg(res, 'Save failed'));
    await fetchAll();
  };

  const handleSaveRecurring = async (data) => {
    const url    = editingItem && editingIsRec ? `/api/recurring-expenses/${editingItem.id}` : `/api/recurring-expenses`;
    const method = editingItem && editingIsRec ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await safeErrMsg(res, 'Save failed'));
    await fetchAll();
  };

  const handleDeleteExp = async (id) => {
    try {
      const res = await apiFetch(`/api/expenses/${id}`, { method: 'DELETE', credentials: 'include' });
      await requireSuccessfulResponse(res, 'Could not delete expense');
      setExpenses(p => p.filter(e => e.id !== id));
      setDeleteExpId(null);
      toast.success('Expense deleted.');
    } catch (err) {
      toast.error(`Could not delete expense: ${err.message}`);
    }
  };

  const handleToggleActive = async (rec) => {
    try {
      const res = await apiFetch(`/api/recurring-expenses/${rec.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ active: !rec.active }),
      });
      await requireSuccessfulResponse(res, `Could not ${rec.active ? 'pause' : 'resume'} recurring expense`);
      setRecurring(p => p.map(r => r.id === rec.id ? { ...r, active: !r.active } : r));
      toast.success(rec.active ? 'Recurring expense paused.' : 'Recurring expense resumed.');
    } catch (err) {
      toast.error(`Could not update recurring expense: ${err.message}`);
    }
  };

  const handleDeleteRec = async (id) => {
    try {
      const res = await apiFetch(`/api/recurring-expenses/${id}`, { method: 'DELETE', credentials: 'include' });
      await requireSuccessfulResponse(res, 'Could not delete recurring expense');
      setRecurring(p => p.filter(r => r.id !== id));
      setDeleteRecId(null);
      toast.success('Recurring expense deleted.');
    } catch (err) {
      toast.error(`Could not delete recurring expense: ${err.message}`);
    }
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  // Manual rows are editable here; derived rows are read-only views of costs
  // stored on purchases/sales (already rounded to the cent by the API).
  const manualRows = expenses.map(e => ({ ...e, source: 'manual' }));
  const allRows = [...manualRows, ...derived];
  const isThisMonth = e => { const d = new Date(e.date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; };
  const isThisYear  = e => new Date(e.date).getFullYear() === thisYear;
  const totals = {
    all:     { ytd: sumAmounts(allRows.filter(isThisYear)),    month: sumAmounts(allRows.filter(isThisMonth)) },
    manual:  { ytd: sumAmounts(manualRows.filter(isThisYear)), month: sumAmounts(manualRows.filter(isThisMonth)) },
    derived: { ytd: sumAmounts(derived.filter(isThisYear)),    month: sumAmounts(derived.filter(isThisMonth)) },
  };
  const usedCategories = new Set(allRows.map(e => e.category));
  const filterCategories = [
    ...CATEGORIES,
    ...LEGACY_CATEGORIES.filter(c => usedCategories.has(c.value)),
    ...DERIVED_CATEGORIES.filter(c => usedCategories.has(c.value)),
  ];

  const openTransaction = (line) => navigate('/transactions', {
    state: { openTransaction: { inventoryId: line.inventory_id, saleId: line.sale_id || null } },
  });

  const recurringMonthly = recurring.filter(r => r.active).reduce((s, r) => {
    if (r.frequency === 'monthly')  return s + r.amount;
    if (r.frequency === 'biweekly') return s + (r.amount * 26) / 12;
    if (r.frequency === 'weekly')   return s + (r.amount * 52) / 12;
    return s;
  }, 0);

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const filtered = allRows
    .filter(e => {
      if (sourceFilter === 'manual' && e.source !== 'manual') return false;
      if (sourceFilter === 'derived' && e.source === 'manual') return false;
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
      ['Date', 'Name', 'Category', 'Source', 'Amount', 'Notes'],
      ...filtered.map(e => [new Date(e.date).toLocaleDateString(), e.name, CATEGORY_MAP[e.category]?.label || 'Uncategorized', SOURCE_LABELS[e.source], Number(e.amount).toFixed(2), e.notes || '']),
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
          <p className="text-sm text-gray-500 mt-1">Every business cost in one place, including tax, shipping, and fees from your purchases and sales</p>
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
        {[
          { key: 'all',     label: 'Total · Year to Date',    icon: <DollarSign className="w-4 h-4 text-purple-400" /> },
          { key: 'manual',  label: 'Manual Expenses · YTD',   icon: <Pencil className="w-4 h-4 text-blue-400" /> },
          { key: 'derived', label: 'From Transactions · YTD', icon: <Lock className="w-4 h-4 text-amber-400" /> },
        ].map(card => (
          <div key={card.key} data-testid={`expense-total-${card.key}`} className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">{card.label}</span>
              {card.icon}
            </div>
            <p className="text-xl font-bold text-white">{formatMoney(totals[card.key].ytd)}</p>
            <p className="text-[11px] text-gray-500 mt-1">This month: {formatMoney(totals[card.key].month)}</p>
          </div>
        ))}
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Recurring / Mo</span>
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-bold text-white">${recurringMonthly.toFixed(2)}</p>
          <p className="text-[11px] text-gray-500 mt-1">{recurring.filter(r => r.active).length} active</p>
        </div>
      </div>
      <p className="-mt-3 text-[11px] text-gray-500">
        Costs from transactions are already counted in your Dashboard profit, so don&apos;t add them again as manual expenses.
        {derivedFailed && <span className="text-amber-400"> Costs from transactions couldn&apos;t be loaded and are missing from these totals. Refresh to try again.</span>}
      </p>

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
                        {rec.payment_method && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500">
                            <CreditCard className="w-2.5 h-2.5" />{rec.payment_method.name}
                          </span>
                        )}
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
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} aria-label="Source"
            className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
            <option value="" className="bg-gray-900">All Sources</option>
            <option value="manual" className="bg-gray-900">Manual</option>
            <option value="derived" className="bg-gray-900">From Transactions</option>
          </select>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Category"
            className="px-3 py-2 rounded-lg text-sm text-white bg-white/[0.02] border border-white/10 appearance-none focus:outline-none focus:border-purple-500/50 cursor-pointer">
            <option value="" className="bg-gray-900">All Categories</option>
            {filterCategories.map(c => <option key={c.value} value={c.value} className="bg-gray-900">{c.label}</option>)}
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
          {filterCategories.map(c => (
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
            <h3 className="text-lg font-semibold text-white mb-2">{allRows.length === 0 ? 'No expenses yet' : 'No results found'}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {allRows.length === 0 ? 'Start tracking your business expenses and fees.' : 'Try adjusting your search or filters.'}
            </p>
            {allRows.length === 0 && (
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
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Card</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Notes</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                  <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((exp, i) => {
                  const cat        = CATEGORY_MAP[exp.category];
                  const isGenerated = !!exp.recurring_expense_id;
                  const isDerived   = exp.source !== 'manual';
                  return (
                    <tr key={exp.id} data-source={exp.source} className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap">
                        {exp.date ? new Date(exp.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-white">
                        <div className="flex items-center gap-2 flex-wrap">
                          {exp.name}
                          {isDerived ? (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0" title="Edit this cost on its transaction">
                              <Lock className="w-2.5 h-2.5" /> {SOURCE_LABELS[exp.source]}
                            </span>
                          ) : (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                              Manual
                            </span>
                          )}
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
                      <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                        {exp.payment_method
                          ? <span className="inline-flex items-center gap-1"><CreditCard className="w-3 h-3 text-gray-500" />{exp.payment_method.name}</span>
                          : exp.paid_from_payout
                            ? <span className="text-gray-500 italic" title="Taken out of the sale's payout, so no card was charged">From payout</span>
                            : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs max-w-[200px] truncate">
                        {exp.notes || <span className="text-gray-700">—</span>}
                      </td>
                      <td className={`px-4 py-3.5 text-right font-semibold whitespace-nowrap ${Number(exp.amount) < 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatMoney(exp.amount)}</td>
                      <td className="px-4 py-3.5">
                        {isDerived ? (
                          <div className="flex items-center justify-center">
                            <button onClick={() => openTransaction(exp)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-purple-400 hover:bg-purple-500/10 transition-colors whitespace-nowrap">
                              {exp.source === 'sale' ? 'Open sale' : 'Open purchase'} <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
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
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.08] bg-white/[0.015]">
                  <td colSpan={5} className="px-4 py-3 text-xs text-gray-500">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-red-400">{formatMoney(sumAmounts(filtered))}</td>
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
        paymentMethods={paymentMethods}
      />

      {/* Delete one-off confirm */}
      {deleteExpId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteExpId(null)} />
          <div ref={deleteExpModalRef} className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl p-6 text-center">
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
          <div ref={deleteRecModalRef} className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl p-6 text-center">
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
