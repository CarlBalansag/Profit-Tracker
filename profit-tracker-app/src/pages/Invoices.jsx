import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useBillableSales, useBuyers, useInvoiceMutations, useInvoices } from '../hooks/useApi';
import { useMatchMedia } from '../hooks/useMatchMedia';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { formatMoney } from '../utils/money';
import { downloadFile } from '../utils/downloads';
import { buildInvoicePdf, invoiceFileName, invoiceNumberLabel } from '../utils/invoicePdf';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import LoadError from '../components/UI/LoadError';

// Invoices: a bill to one buyer for sales already recorded to that buyer.
// Pick the buyer, tick the sales, set the dates, then download it as a PDF
// (api routes/invoices.js; the PDF is built here by utils/invoicePdf.js).

const PHONE_QUERY = '(max-width: 767px)';

const STATUS_FILTERS = [
  ['all', 'All statuses'],
  ['DRAFT', 'Draft'],
  ['SENT', 'Unpaid'],
  ['OVERDUE', 'Overdue'],
  ['PAID', 'Paid'],
  ['CANCELLED', 'Cancelled'],
];

const STATUS_LOOK = {
  DRAFT: { label: 'Draft', className: 'bg-[var(--dp-hover-bg)] text-[var(--dp-text-secondary)]' },
  SENT: { label: 'Unpaid', className: 'bg-sky-500/15 text-sky-400' },
  OVERDUE: { label: 'Overdue', className: 'bg-amber-500/15 text-amber-400' },
  PAID: { label: 'Paid', className: 'bg-emerald-500/15 text-emerald-400' },
  CANCELLED: { label: 'Cancelled', className: 'bg-rose-500/15 text-rose-400' },
};

const shownStatus = (invoice) => (invoice.overdue ? 'OVERDUE' : invoice.status);
const money = (value) => `$${formatMoney(value)}`;

// A calendar day ("2026-11-24") shown without shifting it through a time zone.
const day = (value) => {
  if (!value) return '—';
  const [year, month, date] = String(value).slice(0, 10).split('-').map(Number);
  const local = new Date(year, month - 1, date);
  return Number.isNaN(local.getTime()) ? '—' : local.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => isoDay(new Date());
const daysFrom = (start, days) => {
  const [year, month, date] = start.split('-').map(Number);
  return isoDay(new Date(year, month - 1, date + days));
};

const FIELD = 'w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors';
const LABEL = 'block text-xs font-medium text-[var(--dp-text-secondary)] mb-1.5';

function StatusPill({ invoice }) {
  const look = STATUS_LOOK[shownStatus(invoice)] || STATUS_LOOK.DRAFT;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium whitespace-nowrap ${look.className}`}>{look.label}</span>;
}

// New invoice, or changes to one. The buyer is fixed once an invoice exists,
// and its sales can only change while it is a draft.
function InvoiceForm({ invoice = null, buyers, onClose }) {
  const editing = Boolean(invoice);
  const salesLocked = editing && invoice.status !== 'DRAFT';
  const { create, update } = useInvoiceMutations();
  const saving = create.isPending || update.isPending;
  const modalRef = useModalKeyboard(true, () => { if (!saving) onClose(); });

  const [buyerId, setBuyerId] = useState(invoice?.buyer_id || '');
  const [picked, setPicked] = useState(() => new Set((invoice?.lines || []).map((line) => line.sale_id).filter(Boolean)));
  const [issueDate, setIssueDate] = useState(invoice?.issue_date || today());
  const [dueDate, setDueDate] = useState(invoice?.due_date || daysFrom(today(), 14));
  const [notes, setNotes] = useState(invoice?.notes || '');
  const [status, setStatus] = useState(invoice?.status || 'DRAFT');
  const [error, setError] = useState('');

  const billable = useBillableSales(salesLocked ? null : buyerId, invoice?.id || null);
  const sales = useMemo(() => billable.data || [], [billable.data]);
  const chosen = sales.filter((sale) => picked.has(sale.sale_id));
  const subtotal = chosen.reduce((sum, sale) => sum + sale.amount, 0);
  const tax = chosen.reduce((sum, sale) => sum + sale.tax, 0);
  const allPicked = sales.length > 0 && chosen.length === sales.length;

  const changeBuyer = (id) => {
    setBuyerId(id);
    setPicked(new Set());
    setError('');
  };
  const toggle = (id) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!editing && !buyerId) return setError('Choose who the invoice is for.');
    if (!salesLocked && chosen.length === 0) return setError('Tick at least one sale to put on the invoice.');
    if (!issueDate || !dueDate) return setError('Set the invoice date and the due date.');
    if (dueDate < issueDate) return setError("The due date can't be before the invoice date.");
    try {
      const shared = { issue_date: issueDate, due_date: dueDate, notes: notes.trim() || null };
      if (editing) {
        await update.mutateAsync({
          id: invoice.id,
          ...shared,
          ...(status !== invoice.status ? { status } : {}),
          ...(salesLocked ? {} : { sale_ids: chosen.map((sale) => sale.sale_id) }),
        });
        toast.success(`Invoice ${invoiceNumberLabel(invoice)} saved`);
      } else {
        const created = await create.mutateAsync({ buyer_id: buyerId, sale_ids: chosen.map((sale) => sale.sale_id), ...shared });
        toast.success(`Invoice ${invoiceNumberLabel(created)} created`);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the invoice.');
    }
    return undefined;
  };

  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 text-left">
      <form
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit invoice ${invoiceNumberLabel(invoice)}` : 'New invoice'}
        onSubmit={submit}
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-sm shadow-xl"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[color:var(--dp-border)]">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">{editing ? `Invoice ${invoiceNumberLabel(invoice)}` : 'New invoice'}</h2>
            <p className="mt-0.5 text-xs text-[var(--dp-text-secondary)]">{editing ? `For ${invoice.buyer_name || 'this buyer'}` : 'Bill a buyer for sales you have already recorded.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="-mr-1.5 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--dp-text-label)] hover:bg-[var(--dp-hover-bg)] hover:text-[var(--dp-text-primary)] disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!editing && (
            <div>
              <label htmlFor="invoice-buyer" className={LABEL}>Buyer</label>
              <select id="invoice-buyer" value={buyerId} onChange={(e) => changeBuyer(e.target.value)} className={FIELD}>
                <option value="">Choose a buyer…</option>
                {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}
              </select>
              {buyers.length === 0 && (
                <p className="mt-1.5 text-xs text-[var(--dp-text-secondary)]">No buyers yet. A buyer is added when you fill in "Buyer (who paid)" on a sale.</p>
              )}
            </div>
          )}

          {salesLocked ? (
            <div>
              <p className={LABEL}>Sales on this invoice</p>
              <ul className="rounded-lg border border-[color:var(--dp-border)] divide-y divide-[color:var(--dp-border)]">
                {invoice.lines.map((line) => (
                  <li key={line.id} className="flex items-baseline gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 break-words text-[var(--dp-text-primary)]">{line.description} <span className="text-[var(--dp-text-label)]">× {line.quantity}</span></span>
                    <span className="tabular-nums text-[var(--dp-text-primary)]">{money(line.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-[var(--dp-text-secondary)]">The sales can only be changed while an invoice is a draft.</p>
            </div>
          ) : buyerId && (
            <fieldset>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <legend className="text-xs font-medium text-[var(--dp-text-secondary)]">Sales to bill</legend>
                {sales.length > 1 && (
                  <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(sales.map((sale) => sale.sale_id)))} className="text-xs font-medium text-[var(--dp-accent)] hover:underline px-1">
                    {allPicked ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              {billable.isLoading ? (
                <p className="rounded-lg border border-[color:var(--dp-border)] p-4 text-center text-xs text-[var(--dp-text-secondary)]">Loading this buyer's sales…</p>
              ) : billable.isError ? (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                  <span className="flex-1">Couldn't load this buyer's sales.</span>
                  <button type="button" onClick={() => billable.refetch()} className="page-btn page-btn-secondary">Try again</button>
                </div>
              ) : sales.length === 0 ? (
                <p className="rounded-lg border border-[color:var(--dp-border)] p-4 text-center text-xs text-[var(--dp-text-secondary)]">
                  No sales to bill for this buyer. Sales show here when their "Buyer (who paid)" is this buyer and they aren't on another invoice.
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto rounded-lg border border-[color:var(--dp-border)] divide-y divide-[color:var(--dp-border)]">
                  {sales.map((sale) => (
                    <li key={sale.sale_id}>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--dp-hover-bg)]">
                        <input type="checkbox" checked={picked.has(sale.sale_id)} onChange={() => toggle(sale.sale_id)} className="h-4 w-4 shrink-0 accent-[var(--dp-accent)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-[var(--dp-text-primary)]">{sale.description}</span>
                          <span className="block text-xs text-[var(--dp-text-label)]">{day(sale.sale_date)} · {sale.quantity} × {money(sale.unit_price)}{sale.tax > 0 ? ` · ${money(sale.tax)} tax` : ''}</span>
                        </span>
                        <span className="tabular-nums font-medium text-[var(--dp-text-primary)]">{money(sale.amount)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="invoice-issue-date" className={LABEL}>Invoice date</label>
              <input id="invoice-issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor="invoice-due-date" className={LABEL}>Due date</label>
              <input id="invoice-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD} />
            </div>
          </div>

          {editing && (
            <div>
              <label htmlFor="invoice-status" className={LABEL}>Status</label>
              <select id="invoice-status" value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD}>
                <option value="DRAFT">Draft</option>
                <option value="SENT">Sent (unpaid)</option>
                <option value="PAID">Paid</option>
                <option value="CANCELLED">Cancelled (frees its sales)</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="invoice-notes" className={LABEL}>Notes on the invoice (optional)</label>
            <textarea id="invoice-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, how to pay, a thank-you…" className={FIELD} />
          </div>

          {!salesLocked && chosen.length > 0 && (
            <dl className="rounded-lg bg-[var(--dp-hover-bg)] px-3 py-2 space-y-1">
              {tax > 0 && (
                <>
                  <div className="flex justify-between text-xs text-[var(--dp-text-secondary)]"><dt>Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
                  <div className="flex justify-between text-xs text-[var(--dp-text-secondary)]"><dt>Sales tax</dt><dd className="tabular-nums">{money(tax)}</dd></div>
                </>
              )}
              <div className="flex justify-between font-semibold text-[var(--dp-text-primary)]">
                <dt>Total for {chosen.length} {chosen.length === 1 ? 'sale' : 'sales'}</dt>
                <dd className="tabular-nums">{money(subtotal + tax)}</dd>
              </div>
            </dl>
          )}

          {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p>}
        </div>

        <div className="flex flex-col-reverse gap-2 px-5 py-4 border-t border-[color:var(--dp-border)] sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="page-btn page-btn-secondary max-md:h-11">Cancel</button>
          <button type="submit" disabled={saving} className="page-btn page-btn-primary max-md:h-11 disabled:opacity-60">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create invoice'}
          </button>
        </div>
      </form>
    </div>,
    host,
  );
}

// The buttons on one invoice: PDF, the next status step, edit, delete.
function InvoiceActions({ invoice, onEdit, onDelete, onStatus, busy, sellerName }) {
  const download = () => {
    try {
      downloadFile(invoiceFileName(invoice), buildInvoicePdf(invoice, { from: sellerName }), 'application/pdf');
    } catch {
      toast.error("Couldn't make the PDF");
    }
  };
  const next = invoice.status === 'DRAFT' ? ['SENT', 'Mark sent'] : invoice.status === 'SENT' ? ['PAID', 'Mark paid'] : null;
  // Sized here rather than with page-btn-icon, whose fixed 32px wins over
  // the taller phone size.
  const action = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--dp-border)] text-xs font-medium text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors disabled:opacity-60 h-8 min-w-8 px-2 max-md:h-11 max-md:min-w-11 max-md:px-3';
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
      {next && (
        <button type="button" disabled={busy} onClick={() => onStatus(invoice, next[0])} className={`${action} px-3`}>{next[1]}</button>
      )}
      <button type="button" onClick={download} aria-label={`Download invoice ${invoiceNumberLabel(invoice)} as PDF`} title="Download PDF" className={action}>
        <Download size={14} /><span className="md:hidden text-xs">PDF</span>
      </button>
      <button type="button" onClick={() => onEdit(invoice)} aria-label={`Edit invoice ${invoiceNumberLabel(invoice)}`} title="Edit" className={action}><Pencil size={14} /></button>
      <button type="button" onClick={() => onDelete(invoice)} aria-label={`Delete invoice ${invoiceNumberLabel(invoice)}`} title="Delete" className={action}><Trash2 size={14} /></button>
    </div>
  );
}

const Invoices = () => {
  const { user } = useAuth() || {};
  const { data: invoices = [], isLoading, isError, refetch, isFetching } = useInvoices();
  const { data: buyers = [] } = useBuyers();
  const { update, remove } = useInvoiceMutations();
  const phone = useMatchMedia(PHONE_QUERY);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(null); // null | 'new' | an invoice
  const [deleting, setDeleting] = useState(null);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (statusFilter !== 'all' && shownStatus(invoice) !== statusFilter) return false;
      if (!query) return true;
      return [invoiceNumberLabel(invoice), String(invoice.number ?? ''), invoice.buyer_name, ...invoice.lines.map((line) => line.description)]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [invoices, search, statusFilter]);

  const sums = useMemo(() => {
    const total = (list) => list.reduce((sum, invoice) => sum + invoice.total, 0);
    return {
      unpaid: total(invoices.filter((invoice) => invoice.status === 'SENT')),
      overdue: total(invoices.filter((invoice) => invoice.overdue)),
      paid: total(invoices.filter((invoice) => invoice.status === 'PAID')),
    };
  }, [invoices]);

  const setStatus = async (invoice, status) => {
    try {
      await update.mutateAsync({ id: invoice.id, status });
      toast.success(`Invoice ${invoiceNumberLabel(invoice)} marked ${status === 'SENT' ? 'sent' : 'paid'}`);
    } catch (err) {
      toast.error(err.message || 'Could not update the invoice.');
    }
  };
  const confirmDelete = async () => {
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(`Invoice ${invoiceNumberLabel(deleting)} deleted`);
      setDeleting(null);
    } catch (err) {
      toast.error(err.message || 'Could not delete the invoice.');
    }
  };

  const actions = (invoice) => (
    <InvoiceActions invoice={invoice} onEdit={setForm} onDelete={setDeleting} onStatus={setStatus} busy={update.isPending} sellerName={user?.username || ''} />
  );

  if (isError) return <LoadError title="Invoices" what="your invoices" onRetry={refetch} retrying={isFetching} />;

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--dp-text-primary)]">Invoices</h1>
          <p className="text-sm text-[var(--dp-text-secondary)] mt-1">Bill a buyer for sales you've recorded, and download the invoice as a PDF.</p>
        </div>
        <button type="button" onClick={() => setForm('new')} className="page-btn page-btn-primary max-md:h-11">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {invoices.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {[['Unpaid', sums.unpaid, 'text-[var(--dp-text-primary)]'], ['Overdue', sums.overdue, sums.overdue > 0 ? 'text-amber-400' : 'text-[var(--dp-text-primary)]'], ['Paid', sums.paid, 'text-emerald-400']].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2.5 min-w-0">
              <dt className="text-[12px] uppercase tracking-wider text-[var(--dp-text-label)]">{label}</dt>
              <dd className={`mt-0.5 text-sm sm:text-base font-semibold tabular-nums truncate ${tone}`}>{money(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dp-text-label)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search invoices by number, buyer or item"
            placeholder="Search by number, buyer or item…"
            className={`${FIELD} pl-10 bg-[var(--dp-card-bg)]`}
          />
        </div>
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${FIELD} sm:w-44 bg-[var(--dp-card-bg)]`}>
          {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-8 text-center text-xs text-[var(--dp-text-secondary)]">Loading invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-[var(--dp-text-label)] mb-3" />
          <p className="text-sm font-semibold text-[var(--dp-text-primary)]">No invoices yet</p>
          <p className="mt-1 text-xs text-[var(--dp-text-secondary)]">Create one from the sales you've recorded to a buyer.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-8 text-center text-xs text-[var(--dp-text-secondary)]">No invoices match your search and filter.</div>
      ) : phone ? (
        <ul className="space-y-2.5">
          {shown.map((invoice) => (
            <li key={invoice.id} className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-3.5 space-y-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{invoiceNumberLabel(invoice)}</span>
                    <StatusPill invoice={invoice} />
                  </div>
                  <p className="mt-0.5 break-words text-sm text-[var(--dp-text-primary)]">{invoice.buyer_name}</p>
                  <p className="text-xs text-[var(--dp-text-label)]">{invoice.lines.length} {invoice.lines.length === 1 ? 'sale' : 'sales'} · Due {day(invoice.due_date)}</p>
                </div>
                <p className="text-base font-bold tabular-nums text-[var(--dp-text-primary)]">{money(invoice.total)}</p>
              </div>
              {actions(invoice)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[12px] tracking-wider">
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-3">Buyer</th>
                <th className="py-3 px-3">Issued</th>
                <th className="py-3 px-3">Due</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Total</th>
                <th className="py-3 pl-3 pr-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--dp-border)]">
              {shown.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-[var(--dp-hover-bg)] transition-colors">
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{invoiceNumberLabel(invoice)}</span>
                    <span className="block text-xs text-[var(--dp-text-label)]">{invoice.lines.length} {invoice.lines.length === 1 ? 'sale' : 'sales'}</span>
                  </td>
                  <td className="py-3 px-3 max-w-[16rem] break-words text-[var(--dp-text-primary)]">{invoice.buyer_name}</td>
                  <td className="py-3 px-3 whitespace-nowrap text-[var(--dp-text-secondary)]">{day(invoice.issue_date)}</td>
                  <td className="py-3 px-3 whitespace-nowrap text-[var(--dp-text-secondary)]">{day(invoice.due_date)}</td>
                  <td className="py-3 px-3"><StatusPill invoice={invoice} /></td>
                  <td className="py-3 px-3 text-right font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(invoice.total)}</td>
                  <td className="py-3 pl-3 pr-4">{actions(invoice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <InvoiceForm invoice={form === 'new' ? null : form} buyers={buyers} onClose={() => setForm(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting ? `Delete invoice ${invoiceNumberLabel(deleting)}?` : ''}
        consequence={deleting ? `Removes this ${money(deleting.total)} invoice to ${deleting.buyer_name || 'this buyer'} for good. Its ${deleting.lines.length === 1 ? 'sale stays' : 'sales stay'} in your records and can go on another invoice.` : ''}
        confirmLabel="Delete invoice"
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
};

export default Invoices;
