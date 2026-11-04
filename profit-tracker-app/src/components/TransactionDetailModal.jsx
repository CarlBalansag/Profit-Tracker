import { formatMoney } from '../utils/money';
import { batchCost, grossBatchCost, effectiveCashbackRate, inventoryCashback, saleEconomics, realizedSummary, isRealizedSale } from '../../../shared/finance.mjs';
import React, { useState, useEffect, useRef } from 'react';
import { X, DollarSign, Package, CreditCard, Tag, ChevronDown, ChevronUp, StickyNote, Undo2, MapPin, Paperclip, Hash, Truck } from 'lucide-react';
import { useInvalidate, apiFetch} from '../hooks/useApi';
import { requireSuccessfulResponse } from '../hooks/apiResponse';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { toast } from 'sonner';
import ReturnWindowBadge from './ReturnWindowBadge';
import { addDays, daysBetween } from '../utils/returnWindow';
import TransactionNotesPanel from './TransactionNotesPanel';
import RefundsPanel from './RefundsPanel';
import { recordStatusLabel } from '../data/statusWorkflow';
import { RECEIPT_ACCEPT, MAX_RECEIPT_BYTES, attachInventoryReceipt, readReceiptFile, validateReceiptFile } from '../hooks/receiptUpload';

const STATUSES = ['Pre Order', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
// Same list as Add Transaction.
const CATEGORIES = ['Electronics', 'Apparel', 'Home', 'Grocery', 'Auto', 'Sports', 'Other'];
const SALE_STATUSES = ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
const EMPTY_LIST = [];

// ─── Reusable field wrapper ────────────────────────────────────────────────────
function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Styled input ──────────────────────────────────────────────────────────────
function Input({ value, onChange, type = 'text', placeholder = '', className = '', readOnly = false, ariaLabel, min, step }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={ariaLabel}
      min={min}
      step={step}
      className={`w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors ${readOnly ? 'opacity-60 cursor-default' : ''} ${className}`}
    />
  );
}

// ─── Dollar input ──────────────────────────────────────────────────────────────
function DollarInput({ value, onChange, placeholder = '0.00', accentClass = 'focus:border-green-500/60', ariaLabel }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dp-text-secondary)] text-sm">$</span>
      <input
        type="number"
        step="0.01"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg pl-7 pr-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none transition-colors ${accentClass}`}
      />
    </div>
  );
}

// ─── Styled select ─────────────────────────────────────────────────────────────
function Sel({ value, onChange, options = [], placeholder }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors appearance-none"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.id ?? o} value={o.id ?? o}>{o.name ?? o}</option>
      ))}
    </select>
  );
}

// ─── Read-only value box ───────────────────────────────────────────────────────
function ReadBox({ value, className = '' }) {
  return (
    <div className={`w-full bg-[var(--dp-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] ${className}`}>
      {value}
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3 pt-1">
      {Icon && <Icon className="w-3.5 h-3.5 text-indigo-400" />}
      <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-400">
        {children}
      </p>
    </div>
  );
}

// ─── Normalise a date from the API (ISO string → YYYY-MM-DD) ─────────────────
function toDateInput(val) {
  if (!val) return '';
  return val.split('T')[0];
}

// ─── Main Modal ────────────────────────────────────────────────────────────────
export default function TransactionDetailModal({ row, onClose, onSaved, platforms = EMPTY_LIST, paymentMethods = EMPTY_LIST, buyers = EMPTY_LIST }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dismiss = () => { if (!savingRef.current) onClose(); };
  const modalRef = useModalKeyboard(true, dismiss);
  // track which sale card is expanded (index)
  const [expandedSale, setExpandedSale] = useState(0);
  // sale ids whose Notes panel is open
  const [openSaleNotes, setOpenSaleNotes] = useState(() => new Set());
  const toggleSaleNotes = (id) => setOpenSaleNotes(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [openSaleRefunds, setOpenSaleRefunds] = useState(() => new Set());
  const toggleSaleRefunds = (id) => setOpenSaleRefunds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const invalidate = useInvalidate();

  // A refund saves immediately, separately from Update. Pull just the totals
  // and stock it changed, so any unsaved edits in this window are kept.
  const refreshRefundTotals = async () => {
    try {
      const res = await apiFetch(`/api/inventory/${row.rawId}`, { credentials: 'include' });
      if (!res.ok) return;
      const d = await res.json();
      const salesById = new Map((d.sales || []).map(s => [s.id, s]));
      setForm(prev => prev && ({
        ...prev,
        qty_on_hand: d.qty_on_hand,
        refunded_amount: Number(d.refunded_amount) || 0,
        refunded_qty: Number(d.refunded_qty) || 0,
        _sales: prev._sales.map(s => {
          const fresh = salesById.get(s.id);
          return fresh ? { ...s, refunded_amount: Number(fresh.refunded_amount) || 0, refunded_qty: Number(fresh.refunded_qty) || 0 } : s;
        }),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  // A receipt saves immediately, like on the Receipts page, so it doesn't wait
  // on Update and can't be lost if the rest of the form fails validation.
  const [receiptBusy, setReceiptBusy] = useState(false);
  const attachReceipt = async (file) => {
    if (!file) return;
    setReceiptBusy(true);
    try {
      validateReceiptFile(file);
      const fileData = await readReceiptFile(file);
      const result = await attachInventoryReceipt(apiFetch, row.rawId, fileData, file.name);
      setForm(prev => prev && ({ ...prev, receipt_url: result?.receiptUrl || result?.receipt_url || prev.receipt_url }));
      toast.success('Receipt attached.');
      invalidate.all();
    } catch (err) {
      toast.error(err.message || 'Could not attach the receipt.');
    } finally {
      setReceiptBusy(false);
    }
  };

  const marketplaces = platforms.filter(p => p.type === 'Marketplace');
  const cashoutPlatforms = platforms.filter(p => p.type === 'Cashout');
  const vendors = platforms.filter(p => p.type === 'Vendor');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await apiFetch(`/api/inventory/${row.rawId}`, { credentials: 'include' });
        if (res.ok) {
          const d = await res.json();
          const defaultCashbackRate = effectiveCashbackRate({
            ...d,
            payment_method: d.payment_method ?? paymentMethods.find(method => String(method.id) === String(d.payment_method_id)),
            vendor: d.vendor ?? platforms.find(platform => String(platform.id) === String(d.vendor_id)),
          });
          const storedCashbackRate = d.cashback_rate ?? defaultCashbackRate;
          const storedCashbackAmount = d.cashback_rate !== null && d.cashback_rate !== undefined
            ? d.cashback_earned ?? 0
            : grossBatchCost(d) * storedCashbackRate / 100;
          setForm({
            product_name:            d.product_name ?? '',
            // Saved name, for note lookups (not live-edited; not sent on save)
            _savedProductName:       d.product_name ?? '',
            status:                  d.status ?? 'PURCHASED',
            vendor_id:               d.vendor_id ?? '',
            purchase_date:           d.purchase_date ? d.purchase_date.split('T')[0] : '',
            return_by_date:          d.return_by_date ? d.return_by_date.split('T')[0] : '',
            return_window_days:      daysBetween(d.purchase_date, d.return_by_date) ?? '',
            qty_on_hand:             d.qty_on_hand,
            category:                d.category ?? '',
            order_number:            d.order_number ?? '',
            tracking_number:         d.tracking_number ?? '',
            receipt_url:             d.receipt_url ?? null,
            unit_purchase_cost:      d.unit_purchase_cost ?? 0,
            qty_purchased:           d.qty_purchased ?? 1,
            sales_tax:               d.sales_tax ?? 0,
            shipping_cost_inbound:   d.shipping_cost_inbound ?? 0,
            fees:                    d.fees ?? 0,
            gift_card_amount:        d.gift_card_amount ?? 0,
            payment_method_id:       d.payment_method_id ?? '',
            cashback_rate:           storedCashbackRate,
            cashback_earned:         storedCashbackAmount,
            include_tax_in_cashback:    true,
            include_shipping_in_cashback: true,
            tax_exempt:              d.tax_exempt ?? false,
            // Refund running totals (read-only here; changed through RefundsPanel).
            refunded_amount:         Number(d.refunded_amount) || 0,
            refunded_qty:            Number(d.refunded_qty) || 0,
            // editable sales array
            _sales: (d.sales || []).map(s => ({
              id:              s.id,
              unit_price:      s.unit_price ?? 0,
              quantity:        s.quantity ?? 1,
              commission_fee:  s.commission_fee ?? 0,
              sale_shipping:   s.sale_shipping ?? 0,
              sale_shipping_payment_method_id: s.sale_shipping_payment_method_id ?? '',
              platform_id:     s.platform_id ?? '',
              buyer_id:        s.buyer_id ?? '',
              status:          s.status ?? 'SOLD',
              // Read-only here (the save projection below deliberately omits
              // it): isRealizedSale reads both status columns, so without it
              // this editor's realized summary would disagree with the
              // Transactions row for the same sale.
              workflow_status: s.workflow_status ?? null,
              sale_date:       toDateInput(s.sale_date),
              payout_date:     toDateInput(s.payout_date),
              taxable:         s.taxable ?? true,
              sale_tax_collected: s.sale_tax_collected ?? 0,
              customer_tax_exempt: s.customer_tax_exempt ?? false,
              exemption_type:  s.exemption_type ?? '',
              refunded_amount: Number(s.refunded_amount) || 0,
              refunded_qty:    Number(s.refunded_qty) || 0,
              // Saved quantity: how many units the server lets a refund return.
              _savedQuantity:  s.quantity ?? 1,
              // for display
              _platformName: s.platform?.name || '',
            })),
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [row.rawId, row.status, paymentMethods, platforms]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const setSale = (i, key, val) => setForm(prev => {
    const sales = [...prev._sales];
    sales[i] = { ...sales[i], [key]: val };
    return { ...prev, _sales: sales };
  });

  // ── Live calculations ────────────────────────────────────────────────────────
  const subtotal    = Number(form?.unit_purchase_cost ?? 0) * Number(form?.qty_purchased ?? 1);
  const taxAmt      = Number(form?.sales_tax ?? 0);
  const shippingAmt = Number(form?.shipping_cost_inbound ?? 0);
  const feesAmt     = Number(form?.fees ?? 0);
  const giftCardAmt = Number(form?.gift_card_amount ?? 0);
  const totalCost = batchCost(form ?? {});
  const cbRate = Math.max(0, Number(form?.cashback_rate) || 0);
  const cbEarned = Math.max(0, Number(form?.cashback_earned) || 0);

  const applyCashbackDefault = (paymentMethodId, vendorId) => {
    const rate = effectiveCashbackRate({
      payment_method: paymentMethods.find(method => String(method.id) === String(paymentMethodId)),
      vendor: platforms.find(platform => String(platform.id) === String(vendorId)),
    });
    setForm(prev => ({
      ...prev,
      payment_method_id: paymentMethodId,
      vendor_id: vendorId,
      cashback_rate: rate,
      cashback_earned: grossBatchCost(prev) * rate / 100,
    }));
  };

  // The window is stored as a date, so days and purchase date both move it. A
  // value that can't give a date (an older one before the purchase date) keeps it.
  const setReturnDays = (days) => setForm(prev => ({
    ...prev,
    return_window_days: days,
    return_by_date: addDays(prev.purchase_date, days),
  }));

  const setPurchaseDate = (date) => setForm(prev => ({
    ...prev,
    purchase_date: date,
    return_by_date: addDays(date, prev.return_window_days) || prev.return_by_date,
  }));

  // A new vendor's usual window fills an empty box, and never replaces a value.
  const fillVendorReturnDays = (vendorId) => {
    const days = platforms.find(platform => String(platform.id) === String(vendorId))?.default_return_days;
    if (days === null || days === undefined) return;
    setForm(prev => (prev.return_window_days === ''
      ? { ...prev, return_window_days: days, return_by_date: addDays(prev.purchase_date, days) }
      : prev));
  };

  const setCashbackRate = (value) => {
    const rate = Math.max(0, Number(value) || 0);
    setForm(prev => ({ ...prev, cashback_rate: value, cashback_earned: grossBatchCost(prev) * rate / 100 }));
  };

  const setCashbackAmount = (value) => {
    const amount = Math.max(0, Number(value) || 0);
    setForm(prev => {
      // The stored cashback is on the full original charge; refunds scale it down later.
      const cost = grossBatchCost(prev);
      return {
        ...prev,
        cashback_earned: value,
        cashback_rate: cost > 0 ? Number((amount / cost * 100).toFixed(6)) : 0,
      };
    });
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const invRes = await apiFetch(`/api/inventory/${row.rawId}/transaction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inventory: {
            product_name:          form.product_name,
            status:                form.status,
            purchase_date:         form.purchase_date,
            return_by_date:        form.return_by_date || null,
            order_number:          form.order_number || null,
            tracking_number:       form.tracking_number || null,
            unit_purchase_cost:    Number(form.unit_purchase_cost),
            qty_purchased:         Number(form.qty_purchased),
            sales_tax:             Number(form.sales_tax),
            shipping_cost_inbound: Number(form.shipping_cost_inbound),
            fees:                  Number(form.fees),
            gift_card_amount:      Number(form.gift_card_amount),
            cashback_rate:         Number(form.cashback_rate),
            cashback_earned:       cbEarned,
            category:              form.category || null,
            vendor_id:             form.vendor_id || null,
            payment_method_id:     form.payment_method_id || null,
            tax_exempt:            form.tax_exempt ?? false,
          },
          sales: form._sales.map(s => ({
            id:                 s.id,
            unit_price:         Number(s.unit_price),
            quantity:           Number(s.quantity),
            commission_fee:     Number(s.commission_fee),
            sale_shipping:      Number(s.sale_shipping),
            sale_shipping_payment_method_id: s.sale_shipping_payment_method_id || null,
            platform_id:        s.platform_id || null,
            buyer_id:           s.buyer_id || null,
            // A handful of sale rows predate the sale-status validation
            // (ideas.md ISSUES #3) and still carry an inventory-only legacy
            // value like PURCHASED, which the backend's SALE_STATUSES enum
            // rejects. Loading one into this editor and saving ANY other
            // field -- platform, cost, quantity -- round-tripped that
            // invalid value and failed the whole save. Omitting it here
            // (JSON.stringify drops undefined keys) leaves the backend's
            // existing writable() semantics to keep the stored status
            // untouched when it isn't actually being changed.
            status:             SALE_STATUSES.includes(s.status) ? s.status : undefined,
            sale_date:          s.sale_date || undefined,
            payout_date:        s.payout_date || null,
            taxable:            s.taxable,
            sale_tax_collected: Number(s.sale_tax_collected),
            customer_tax_exempt: s.customer_tax_exempt ?? false,
            exemption_type:     s.exemption_type || null,
          })),
        }),
      });
      await requireSuccessfulResponse(invRes, 'Transaction update failed. No changes were saved.');

      invalidate.all();
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Transaction update failed. No changes were saved.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={dismiss} />

      {/* Panel */}
      <div
        ref={modalRef}
        className="relative w-full max-w-[640px] max-h-[90vh] sm:max-h-[90vh] h-full sm:h-auto bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] sm:rounded-2xl dp-elevated flex flex-col overflow-hidden text-[var(--dp-text-primary)]"
        style={{ animation: 'fadeInScale 0.2s ease-out' }}
      >
        <style>{`
          @keyframes fadeInScale {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[color:var(--dp-border)] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">Edit Transaction</h2>
            <p className="text-[11px] text-[var(--dp-text-secondary)] mt-0.5">Make changes and click Update to save.</p>
          </div>
          <button
            onClick={dismiss}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--dp-hover-bg)] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        {loading || !form ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm py-16">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              Loading transaction…
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">

            {/* Product Information */}
            <div>
              <SectionHeader icon={Package}>Product Information</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
                <Field label="Product Name *">
                  <Input value={form.product_name} onChange={v => set('product_name', v)} placeholder="Product name" />
                </Field>
                <Field label="Category">
                  <Sel
                    value={form.category}
                    onChange={v => set('category', v)}
                    options={form.category && !CATEGORIES.includes(form.category) ? [form.category, ...CATEGORIES] : CATEGORIES}
                    placeholder="Select category…"
                  />
                </Field>
              </div>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Purchase Details */}
            <div>
              <SectionHeader icon={DollarSign}>Purchase Details</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <Field label="Unit Price">
                  <DollarInput value={form.unit_purchase_cost} onChange={v => set('unit_purchase_cost', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Qty">
                  <Input type="number" value={form.qty_purchased} onChange={v => set('qty_purchased', v)} />
                </Field>
                <Field label="Subtotal">
                  <ReadBox value={`$${formatMoney(subtotal)}`} className="text-gray-400" />
                </Field>
                <Field label="Purchase Date">
                  <Input type="date" value={form.purchase_date} onChange={setPurchaseDate} />
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <Field label="Tax">
                  <DollarInput value={form.sales_tax} onChange={v => set('sales_tax', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Inbound Shipping">
                  <DollarInput value={form.shipping_cost_inbound} onChange={v => set('shipping_cost_inbound', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Fees">
                  <DollarInput value={form.fees} onChange={v => set('fees', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Total Cost">
                  <ReadBox value={`$${formatMoney(totalCost)}`} className="text-white font-semibold" />
                  {form.refunded_amount > 0 && (
                    <p className="mt-1 text-[11px] text-emerald-400">After −${formatMoney(Number(form.refunded_amount))} refunded{form.refunded_qty > 0 ? ` · ${form.refunded_qty} sent back` : ''}</p>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Return window (days, optional)">
                  <Input type="number" min="0" step="1" ariaLabel="Return window (days)" placeholder="e.g. 30" value={form.return_window_days} onChange={setReturnDays} />
                  {form.return_by_date && <p className="mt-1 text-[11px] text-gray-500">Return by {form.return_by_date}</p>}
                  <ReturnWindowBadge item={form} className="mt-1.5" />
                </Field>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit mt-3">
                <input
                  type="checkbox"
                  checked={form.tax_exempt ?? false}
                  onChange={e => set('tax_exempt', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 accent-blue-500"
                />
                <span className="text-sm text-gray-300">Tax Exempt</span>
              </label>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Purchase Location */}
            <div>
              <SectionHeader icon={MapPin}>Purchase Location</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <Field label="Store">
                  <Sel value={form.vendor_id} onChange={v => { applyCashbackDefault(form.payment_method_id, v); fillVendorReturnDays(v); }} options={vendors} placeholder="Select store…" />
                </Field>
                <Field label="Status">
                  <Sel value={form.status} onChange={v => set('status', v)} options={STATUSES.map(s => ({ id: s, name: recordStatusLabel(s) }))} />
                </Field>
                <Field label="Order Number">
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input value={form.order_number} onChange={v => set('order_number', v)} placeholder="e.g. 112-3456789" className="pl-8" ariaLabel="Order Number" />
                  </div>
                </Field>
                <Field label="Tracking Number">
                  <div className="relative">
                    <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input value={form.tracking_number} onChange={v => set('tracking_number', v)} placeholder="e.g. 1Z999AA10123456784" className="pl-8" ariaLabel="Tracking Number" />
                  </div>
                </Field>
              </div>
              <Field label="Receipt">
                <div className="flex flex-wrap items-center gap-3">
                  <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--dp-border)] text-xs text-[var(--dp-text-secondary)] transition-colors ${receiptBusy ? 'opacity-50' : 'cursor-pointer hover:bg-white/[0.03]'}`}>
                    <Paperclip className="w-3.5 h-3.5" />
                    {receiptBusy ? 'Uploading…' : form.receipt_url ? 'Replace receipt' : 'Attach receipt'}
                    <input
                      type="file"
                      accept={RECEIPT_ACCEPT}
                      disabled={receiptBusy}
                      aria-label="Receipt file"
                      className="hidden"
                      onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; attachReceipt(file); }}
                    />
                  </label>
                  {/^https:\/\//i.test(form.receipt_url || '') && (
                    <a href={form.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-[var(--dp-accent)] underline">View receipt</a>
                  )}
                </div>
                <p className="text-[11px] text-gray-600 mt-1.5">JPEG, PNG, WebP, GIF, or PDF up to {MAX_RECEIPT_BYTES / (1024 * 1024)} MB. Saved right away.</p>
              </Field>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Payment / Cashback */}
            <div>
              <SectionHeader icon={CreditCard}>Payment & Cashback</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Payment Method">
                  <Sel
                    value={form.payment_method_id}
                    onChange={v => {
                      applyCashbackDefault(v, form.vendor_id);
                    }}
                    options={paymentMethods}
                    placeholder="Select…"
                  />
                </Field>
                <Field label="Cashback %">
                  <div className="relative">
                    <Input value={form.cashback_rate} onChange={setCashbackRate} type="number" className="pr-8" ariaLabel="Cashback %" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                  </div>
                </Field>
                <Field label="Cashback $">
                  <DollarInput value={form.cashback_earned} onChange={setCashbackAmount} accentClass="focus:border-pink-500/60 text-emerald-400" ariaLabel="Cashback $" />
                  <p className="text-[11px] text-gray-600 mt-1">Payment method default; editable for this transaction</p>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Field label="Gift Card Used">
                  <DollarInput value={form.gift_card_amount} onChange={v => set('gift_card_amount', v)} accentClass="focus:border-blue-500/60" />
                </Field>
              </div>
              <p className="text-xs text-gray-400 mt-3">Changing the payment method or store applies its default rate. You can override either field for this transaction.</p>
            </div>

            {/* ── Sale Details (editable), only once the item has sold ── */}
            {form._sales.length > 0 && (
            <div>
              <SectionHeader icon={Tag}>
                Sale Details{form._sales.length > 1 ? ` (${form._sales.length} sales)` : ''}
              </SectionHeader>

                <div className="space-y-3">
                  {form._sales.map((sale, i) => {
                    const unitPrice = Number(sale.unit_price) || 0;
                    const qty = Number(sale.quantity) || 1;
                    const commission = Number(sale.commission_fee) || 0;
                    const saleShipping = Number(sale.sale_shipping) || 0;
                    const saleTotal = unitPrice * qty;
                    const economics = saleEconomics(form, sale, cbRate);
                    const totalCostForSale = economics.cost;
                    const saleCashback = economics.cashback;
                    const profit = isRealizedSale(sale) ? economics.netProfit : 0;
                    const isOpen = expandedSale === i;

                    return (
                      <div key={sale.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                        {/* Sale card header — always visible, click to expand */}
                        <button
                          type="button"
                          onClick={() => setExpandedSale(isOpen ? null : i)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <DollarSign className="w-3.5 h-3.5 text-green-400 shrink-0" />
                            <span className="text-sm font-semibold text-white">
                              ${formatMoney(unitPrice)} × {qty}
                              {sale.sale_date && (
                                <span className="text-xs text-gray-500 font-normal ml-2">
                                  · {new Date(sale.sale_date + 'T12:00:00').toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {profit >= 0 ? '+' : ''}${formatMoney(profit)}
                            </span>
                            {isOpen
                              ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                              : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                            }
                          </div>
                        </button>

                        {/* Expanded edit fields */}
                        {isOpen && (
                          <div className="border-t border-white/[0.06] px-4 py-4 space-y-3">

                            {/* Row 1: Sale Price, Qty, Commission, Sale Shipping */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <Field label="Sale Price">
                                <DollarInput
                                  value={sale.unit_price}
                                  onChange={v => setSale(i, 'unit_price', v)}
                                  accentClass="focus:border-green-500/60"
                                />
                              </Field>
                              <Field label="Qty Sold">
                                <Input
                                  type="number"
                                  value={sale.quantity}
                                  onChange={v => setSale(i, 'quantity', v)}
                                  className="focus:border-green-500/60"
                                />
                              </Field>
                              <Field label="Commission">
                                <DollarInput
                                  value={sale.commission_fee}
                                  onChange={v => setSale(i, 'commission_fee', v)}
                                  accentClass="focus:border-green-500/60"
                                />
                              </Field>
                              <Field label="Sale Shipping">
                                <DollarInput
                                  value={sale.sale_shipping}
                                  onChange={v => setSale(i, 'sale_shipping', v)}
                                  accentClass="focus:border-green-500/60"
                                />
                              </Field>
                            </div>

                            {/* Row 2: Platform, Status */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="Platform">
                                <Sel
                                  value={sale.platform_id}
                                  onChange={v => setSale(i, 'platform_id', v)}
                                  options={[...marketplaces, ...cashoutPlatforms]}
                                  placeholder="Select platform…"
                                />
                              </Field>
                              <Field label="Sale Status">
                                <Sel
                                  value={sale.status}
                                  onChange={v => setSale(i, 'status', v)}
                                  options={SALE_STATUSES.map(s => ({ id: s, name: recordStatusLabel(s) }))}
                                />
                              </Field>
                            </div>

                            {/* Row 2b: Buyer -- who actually paid, separate from the platform above --
                                and the card the shipping label was bought with, if any */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="Buyer (who paid)">
                                <Sel
                                  value={sale.buyer_id}
                                  onChange={v => setSale(i, 'buyer_id', v)}
                                  options={buyers}
                                  placeholder="Select buyer…"
                                />
                              </Field>
                              <Field label="Label paid with">
                                <Sel
                                  value={sale.sale_shipping_payment_method_id}
                                  onChange={v => setSale(i, 'sale_shipping_payment_method_id', v)}
                                  options={paymentMethods}
                                  placeholder="From payout"
                                />
                              </Field>
                            </div>

                            {/* Row 3: Sale Date, Payout Date */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="Sale Date">
                                <Input
                                  type="date"
                                  value={sale.sale_date}
                                  onChange={v => setSale(i, 'sale_date', v)}
                                  className="focus:border-green-500/60"
                                />
                              </Field>
                              <Field label="Payout Date">
                                <Input
                                  type="date"
                                  value={sale.payout_date}
                                  onChange={v => setSale(i, 'payout_date', v)}
                                  className="focus:border-green-500/60"
                                />
                              </Field>
                            </div>

                            {/* Row 4: Tax Collected + Taxable toggle */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                              <Field label="Sale Tax Collected">
                                <DollarInput
                                  value={sale.sale_tax_collected}
                                  onChange={v => setSale(i, 'sale_tax_collected', v)}
                                  accentClass="focus:border-green-500/60"
                                />
                              </Field>
                              <label className="flex items-center gap-2.5 cursor-pointer select-none pb-2">
                                <input
                                  type="checkbox"
                                  checked={sale.taxable ?? true}
                                  onChange={e => setSale(i, 'taxable', e.target.checked)}
                                  className="w-4 h-4 rounded border-gray-600 accent-green-500"
                                />
                                <span className="text-sm text-gray-300">Taxable Sale</span>
                              </label>
                            </div>

                            {/* Row 5: Exemption type + customer exempt */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                              <Field label="Exemption Type">
                                <Input
                                  value={sale.exemption_type}
                                  onChange={v => setSale(i, 'exemption_type', v)}
                                  placeholder="e.g. Resale, Nonprofit…"
                                  ariaLabel="Exemption Type"
                                  className="focus:border-green-500/60"
                                />
                              </Field>
                              <label className="flex items-center gap-2.5 cursor-pointer select-none pb-2">
                                <input
                                  type="checkbox"
                                  checked={sale.customer_tax_exempt ?? false}
                                  onChange={e => setSale(i, 'customer_tax_exempt', e.target.checked)}
                                  className="w-4 h-4 rounded border-gray-600 accent-green-500"
                                />
                                <span className="text-sm text-gray-300">Customer Tax Exempt</span>
                              </label>
                            </div>

                            {/* Mini profit breakdown */}
                            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] divide-y divide-white/[0.04] text-xs mt-1">
                              <div className="flex justify-between px-3 py-2">
                                <span className="text-gray-500">Revenue</span>
                                <span className="text-green-400">${formatMoney(saleTotal)}</span>
                              </div>
                              <div className="flex justify-between px-3 py-2">
                                <span className="text-gray-500">Cost basis</span>
                                <span className="text-red-400">-${formatMoney(totalCostForSale)}</span>
                              </div>
                              {commission > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Commission</span>
                                  <span className="text-red-400">-${formatMoney(commission)}</span>
                                </div>
                              )}
                              {saleShipping > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Sale shipping</span>
                                  <span className="text-red-400">-${formatMoney(saleShipping)}</span>
                                </div>
                              )}
                              {sale.refunded_amount > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Refunded to buyer{sale.refunded_qty > 0 ? ` (${sale.refunded_qty} returned)` : ''}</span>
                                  <span className="text-red-400">-${formatMoney(Number(sale.refunded_amount))}</span>
                                </div>
                              )}
                              {saleCashback > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Cashback</span>
                                  <span className="text-emerald-400">+${formatMoney(saleCashback)}</span>
                                </div>
                              )}
                              <div className="flex justify-between px-3 py-2 font-semibold">
                                <span className="text-gray-300">Net Profit</span>
                                <span className={profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {profit >= 0 ? '+' : ''}${formatMoney(profit)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Per-sale refunds toggle */}
                        <div className="border-t border-white/[0.06]">
                          <button
                            type="button"
                            onClick={() => toggleSaleRefunds(sale.id)}
                            aria-expanded={openSaleRefunds.has(sale.id)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-[var(--dp-text-secondary)] hover:bg-white/[0.03] transition-colors"
                          >
                            <Undo2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">Refunds</span>
                            {sale.refunded_amount > 0 && <span className="text-emerald-400">−${formatMoney(Number(sale.refunded_amount))}{sale.refunded_qty > 0 ? ` · ${sale.refunded_qty} returned` : ''}</span>}
                            {openSaleRefunds.has(sale.id)
                              ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-gray-500" />
                              : <ChevronDown className="w-3.5 h-3.5 ml-auto text-gray-500" />
                            }
                          </button>
                          {openSaleRefunds.has(sale.id) && (
                            <div className="px-4 pb-4">
                              <RefundsPanel
                                kind="sale"
                                id={sale.id}
                                maxUnits={Math.max(0, Number(sale._savedQuantity) - (sale.refunded_qty || 0))}
                                disabledReason={isRealizedSale(sale) ? '' : "This sale is cancelled, returned or disputed, so it no longer counts toward your totals and its refunds can't be changed."}
                                onChanged={refreshRefundTotals}
                              />
                            </div>
                          )}
                        </div>

                        {/* Per-sale notes toggle */}
                        <div className="border-t border-white/[0.06]">
                          <button
                            type="button"
                            onClick={() => toggleSaleNotes(sale.id)}
                            aria-expanded={openSaleNotes.has(sale.id)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-[var(--dp-text-secondary)] hover:bg-white/[0.03] transition-colors"
                          >
                            <StickyNote className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">Notes</span>
                            {openSaleNotes.has(sale.id)
                              ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-gray-500" />
                              : <ChevronDown className="w-3.5 h-3.5 ml-auto text-gray-500" />
                            }
                          </button>
                          {openSaleNotes.has(sale.id) && (
                            <div className="px-4 pb-4">
                              <TransactionNotesPanel
                                entityType="sale"
                                entityId={sale.id}
                                productName={form._savedProductName}
                                showProductNote={false}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
            </div>
            )}

            {form._sales.length > 0 && <div className="border-t border-white/[0.04]" />}

            {/* ── Summary ── */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Summary</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Cost of Goods</span>
                  <span className="text-white font-medium">${formatMoney(subtotal)}</span>
                </div>
                {taxAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Tax</span>
                    <span className="text-red-400 font-medium">+${formatMoney(taxAmt)}</span>
                  </div>
                )}
                {shippingAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Shipping</span>
                    <span className="text-red-400 font-medium">+${formatMoney(shippingAmt)}</span>
                  </div>
                )}
                {feesAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Fees</span>
                    <span className="text-red-400 font-medium">+${formatMoney(feesAmt)}</span>
                  </div>
                )}
                {giftCardAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Gift Card</span>
                    <span className="text-emerald-400 font-medium">-${formatMoney(giftCardAmt)}</span>
                  </div>
                )}
                {form.refunded_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Refunds from store</span>
                    <span className="text-emerald-400 font-medium">-${formatMoney(Number(form.refunded_amount))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                  <span className="text-gray-200 font-semibold">Total Cost</span>
                  <span className="text-white font-bold">${formatMoney(totalCost)}</span>
                </div>
                {cbEarned > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Cashback ({cbRate}%){form.refunded_amount > 0 ? ', after refunds' : ''}</span>
                    <span className="text-emerald-400 font-semibold">+${formatMoney(inventoryCashback(form, cbRate))}</span>
                  </div>
                )}
                {form._sales.length > 0 && (() => {
                  const realizedSales = form._sales.filter(isRealizedSale);
                  const totalSaleRevenue = realizedSales.reduce((sum, s) => sum + ((Number(s.unit_price) || 0) * (Number(s.quantity) || 0)), 0);
                  const totalCommissions = realizedSales.reduce((sum, s) => sum + (Number(s.commission_fee) || 0), 0);
                  const totalSaleShipping = realizedSales.reduce((sum, s) => sum + (Number(s.sale_shipping) || 0), 0);
                  const totalBuyerRefunds = realizedSales.reduce((sum, s) => sum + (Number(s.refunded_amount) || 0), 0);
                  const summary = realizedSummary(form, realizedSales, cbRate);
                  const netProfit = summary.netProfit;
                  return (
                    <>
                      <div className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                        <span className="text-gray-400">Sale Revenue</span>
                        <span className="text-green-400 font-medium">${formatMoney(totalSaleRevenue)}</span>
                      </div>
                      {totalCommissions > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Commissions</span>
                          <span className="text-red-400 font-medium">-${formatMoney(totalCommissions)}</span>
                        </div>
                      )}
                      {totalSaleShipping > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Sale Shipping</span>
                          <span className="text-red-400 font-medium">-${formatMoney(totalSaleShipping)}</span>
                        </div>
                      )}
                      {totalBuyerRefunds > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Refunds to buyers</span>
                          <span className="text-red-400 font-medium">-${formatMoney(totalBuyerRefunds)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-200 font-semibold">Realized Profit + Cashback</span>
                        <span className={`font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {netProfit >= 0 ? '+' : ''}${formatMoney(netProfit)}
                        </span>
                      </div>
                      {cbEarned > 0 && (
                        <p className="text-[11px] text-gray-600">
                          Includes ${formatMoney(summary.cashback)} sold-unit cashback ({cbRate}%)
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ── Refunds from the store (purchase) ── */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <RefundsPanel
                kind="purchase"
                id={row.rawId}
                maxUnits={Math.max(0, Number(form.qty_on_hand) || 0)}
                onChanged={refreshRefundTotals}
              />
            </div>

            {/* ── Notes (purchase + shared product note) ── */}
            <TransactionNotesPanel
              entityType="purchase"
              entityId={row.rawId}
              productName={form._savedProductName}
            />

          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={dismiss}
            className="px-5 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/[0.05] border border-white/[0.08] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !form}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Update Transaction'}
          </button>
        </div>

      </div>
    </div>
  );
}
