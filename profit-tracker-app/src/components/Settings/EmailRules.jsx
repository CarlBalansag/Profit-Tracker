import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { taxCategories } from '../../../../shared/scheduleC.mjs';
import { useEmailAutomation, useEmailOrderMutations, useEmailRuleMutations, useEmailRules } from '../../hooks/useApi';

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';
const INPUT = 'w-full rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--accent)]';
const LABEL = 'block text-xs text-gray-400 mb-1';
const taxLabel = (id) => taxCategories.find((c) => c.id === id)?.label || null;

function RuleForm({ stores, initial, onDone }) {
  const { save } = useEmailRuleMutations();
  const [form, setForm] = useState({
    source: initial?.merchant ? 'store' : 'store', merchant: initial?.merchant || stores[0]?.key || '', domain: '',
    label: initial?.label || '', action: 'create_expense', category: initial?.category || '', tax_category: initial?.tax_category || '',
  });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = {
      ...(form.source === 'domain' ? { domain: form.domain } : { merchant: form.merchant }),
      ...(form.label ? { label: form.label } : {}),
      action: form.action, category: form.category, tax_category: form.tax_category,
      ...(initial?.payment_method_id ? { payment_method_id: initial.payment_method_id } : {}),
    };
    try { await save.mutateAsync(body); toast.success('Saved'); onDone(); } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Trusted store">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rule-source" className={LABEL}>Emails from</label>
          <select id="rule-source" value={form.source} onChange={set('source')} className={INPUT}>
            <option value="store">A store on the list</option>
            <option value="domain">Another sender (like a subscription)</option>
          </select>
        </div>
        {form.source === 'store' ? (
          <div>
            <label htmlFor="rule-store" className={LABEL}>Store</label>
            <select id="rule-store" value={form.merchant} onChange={set('merchant')} className={INPUT}>
              {stores.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="rule-domain" className={LABEL}>Sender domain</label>
            <input id="rule-domain" placeholder="anthropic.com" autoCapitalize="none" spellCheck="false" value={form.domain} onChange={set('domain')} className={INPUT} />
          </div>
        )}
        <div>
          <label htmlFor="rule-action" className={LABEL}>What to do with its receipts</label>
          <select id="rule-action" value={form.action} onChange={set('action')} className={INPUT}>
            <option value="create_expense">Add them as expenses</option>
            <option value="ignore">Ignore them (not business)</option>
          </select>
        </div>
        <div>
          <label htmlFor="rule-label" className={LABEL}>Name on the expense</label>
          <input id="rule-label" value={form.label} onChange={set('label')} placeholder="Store name" className={INPUT} />
        </div>
        {form.action === 'create_expense' && (
          <>
            <div>
              <label htmlFor="rule-category" className={LABEL}>Expense category</label>
              <input id="rule-category" value={form.category} onChange={set('category')} placeholder="Shipping, Software..." className={INPUT} />
            </div>
            <div>
              <label htmlFor="rule-tax" className={LABEL}>Schedule C category</label>
              <select id="rule-tax" value={form.tax_category} onChange={set('tax_category')} className={INPUT}>
                <option value="">Decide on each one</option>
                {taxCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className="page-btn page-btn-primary">Save</button>
        <button type="button" onClick={onDone} className="page-btn page-btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

export function EmailRules() {
  const { data } = useEmailRules();
  const { data: automation } = useEmailAutomation();
  const { automation: saveAutomation } = useEmailOrderMutations();
  const { remove } = useEmailRuleMutations();
  const [editing, setEditing] = useState(null);
  if (!data) return null;
  const { rules, suggestions, stores } = data;

  return (
    <section aria-labelledby="email-rules" className={PANEL}>
      <div>
        <h2 id="email-rules" className="text-sm font-bold text-white">Trusted stores</h2>
        <p className="mt-1 max-w-prose text-xs text-gray-500">Tell us once what a store&apos;s receipts are for, and they become expenses on their own. Add subscriptions and tools by their sender.</p>
      </div>
      <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-200">
        <input type="checkbox" checked={automation?.createExpenses ?? false} onChange={(e) => saveAutomation.mutate({ createExpenses: e.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
        Add receipts from trusted stores as expenses automatically
      </label>

      {rules.length > 0 && (
        <ul className="divide-y divide-white/[0.06]">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-gray-100">{r.label}{r.domain && <span className="text-xs text-gray-500"> · {r.domain}</span>}</p>
                <p className="text-xs text-gray-500">{r.action === 'ignore' ? 'Ignored' : ['Added as expenses', r.category, taxLabel(r.tax_category)].filter(Boolean).join(' · ')}</p>
              </div>
              <button type="button" aria-label={`Remove ${r.label}`} onClick={() => remove.mutate(r.id)} className="page-btn page-btn-secondary !h-9 !px-2"><Trash2 size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && !editing && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400">Suggested from what you already do</p>
          <ul className="divide-y divide-white/[0.06]">
            {suggestions.slice(0, 5).map((s) => (
              <li key={s.merchant} className="flex items-center justify-between gap-3 py-2">
                <p className="min-w-0 text-sm text-gray-200">{s.label} <span className="text-xs text-gray-500">· {s.receipts} {s.receipts === 1 ? 'receipt' : 'receipts'} in email{s.past_expenses ? ` · ${s.past_expenses} past ${s.past_expenses === 1 ? 'expense' : 'expenses'}` : ''}</span></p>
                <button type="button" onClick={() => setEditing(s)} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">Set up</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing
        ? <RuleForm stores={stores} initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} className="page-btn page-btn-secondary"><Plus size={14} aria-hidden="true" /> Add a trusted store</button>}
    </section>
  );
}
