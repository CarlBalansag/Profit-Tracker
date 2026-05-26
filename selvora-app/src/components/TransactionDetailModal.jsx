import React, { useState, useEffect } from 'react';
import { X, DollarSign, Package, CreditCard, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { useInvalidate, apiFetch} from '../hooks/useApi';

const STATUSES = ['Pre Order', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
const SALE_STATUSES = ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];

// ─── Reusable field wrapper ────────────────────────────────────────────────────
function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Styled input ──────────────────────────────────────────────────────────────
function Input({ value, onChange, type = 'text', placeholder = '', className = '', readOnly = false }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`w-full bg-[#0f1014] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/60 transition-colors ${readOnly ? 'opacity-60 cursor-default' : ''} ${className}`}
    />
  );
}

// ─── Dollar input ──────────────────────────────────────────────────────────────
function DollarInput({ value, onChange, placeholder = '0.00', accentClass = 'focus:border-green-500/60' }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
      <input
        type="number"
        step="0.01"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-[#0f1014] border border-white/[0.08] rounded-lg pl-7 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors ${accentClass}`}
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
      className="w-full bg-[#0f1014] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/60 transition-colors appearance-none"
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
    <div className={`w-full bg-white/[0.02] border border-white/[0.05] rounded-lg px-3 py-2 text-sm ${className}`}>
      {value}
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3 pt-1">
      {Icon && <Icon className="w-3.5 h-3.5 text-indigo-400" />}
      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
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
export default function TransactionDetailModal({ row, onClose, onSaved, platforms = [], paymentMethods = [] }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // track which sale card is expanded (index)
  const [expandedSale, setExpandedSale] = useState(0);
  const invalidate = useInvalidate();

  const marketplaces = platforms.filter(p => p.type === 'Marketplace');
  const cashoutPlatforms = platforms.filter(p => p.type === 'Cashout');
  const vendors = platforms.filter(p => p.type === 'Vendor');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await apiFetch(`/api/inventory/${row.rawId}`, { credentials: 'include' });
        if (res.ok) {
          const d = await res.json();
          setForm({
            product_name:            d.product_name ?? '',
            status:                  row.status ?? d.status ?? 'PURCHASED',
            vendor_id:               d.vendor_id ?? '',
            purchase_date:           d.purchase_date ? d.purchase_date.split('T')[0] : '',
            category:                d.category ?? '',
            unit_purchase_cost:      d.unit_purchase_cost ?? 0,
            qty_purchased:           d.qty_purchased ?? 1,
            sales_tax:               d.sales_tax ?? 0,
            shipping_cost_inbound:   d.shipping_cost_inbound ?? 0,
            payment_method_id:       d.payment_method_id ?? '',
            cashback_rate:           d.payment_method?.default_cashback_rate ?? 0,
            cashback_earned:         d.cashback_earned ?? 0,
            include_tax_in_cashback:    true,
            include_shipping_in_cashback: true,
            tax_exempt:              d.tax_exempt ?? false,
            // editable sales array
            _sales: (d.sales || []).map(s => ({
              id:              s.id,
              unit_price:      s.unit_price ?? 0,
              quantity:        s.quantity ?? 1,
              commission_fee:  s.commission_fee ?? 0,
              sale_shipping:   s.sale_shipping ?? 0,
              platform_id:     s.platform_id ?? '',
              status:          s.status ?? 'SOLD',
              sale_date:       toDateInput(s.sale_date),
              payout_date:     toDateInput(s.payout_date),
              taxable:         s.taxable ?? true,
              sale_tax_collected: s.sale_tax_collected ?? 0,
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
  }, [row.rawId, row.status]);

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
  const totalCost   = subtotal + taxAmt + shippingAmt;
  const cbBase      = subtotal
    + (form?.include_tax_in_cashback     ? taxAmt     : 0)
    + (form?.include_shipping_in_cashback ? shippingAmt : 0);
  const cbRate      = Number(form?.cashback_rate ?? 0);
  const cbEarned    = cbBase * (cbRate / 100);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const invRes = await apiFetch(`/api/inventory/${row.rawId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product_name:          form.product_name,
          status:                form.status,
          purchase_date:         form.purchase_date,
          unit_purchase_cost:    Number(form.unit_purchase_cost),
          qty_purchased:         Number(form.qty_purchased),
          sales_tax:             Number(form.sales_tax),
          shipping_cost_inbound: Number(form.shipping_cost_inbound),
          cashback_earned:       cbEarned,
          category:              form.category || null,
          vendor_id:             form.vendor_id || null,
          payment_method_id:     form.payment_method_id || null,
          tax_exempt:            form.tax_exempt ?? false,
        }),
      });
      if (!invRes.ok) return;

      // Save every sale's editable fields
      await Promise.all(form._sales.map(s =>
        apiFetch(`/api/sales/${s.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            unit_price:         Number(s.unit_price),
            quantity:           Number(s.quantity),
            commission_fee:     Number(s.commission_fee),
            sale_shipping:      Number(s.sale_shipping),
            platform_id:        s.platform_id || null,
            status:             s.status,
            sale_date:          s.sale_date || null,
            payout_date:        s.payout_date || null,
            taxable:            s.taxable,
            sale_tax_collected: Number(s.sale_tax_collected),
          }),
        })
      ));

      invalidate.inventory();
      invalidate.sales();
      invalidate.dashboard();
      invalidate.creditCard();
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-[640px] max-h-[90vh] sm:max-h-[90vh] h-full sm:h-auto bg-[#15171d] border border-white/[0.08] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'fadeInScale 0.2s ease-out' }}
      >
        <style>{`
          @keyframes fadeInScale {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Edit Transaction</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Make changes and click Update to save.</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
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

            {/* Product Name + Status */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
              <Field label="Product Name *">
                <Input value={form.product_name} onChange={v => set('product_name', v)} placeholder="Product name" />
              </Field>
              <Field label="Status">
                <Sel value={form.status} onChange={v => set('status', v)} options={STATUSES.map(s => ({ id: s, name: s }))} />
              </Field>
            </div>

            {/* Vendor / Date / Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Store / Vendor">
                <Sel value={form.vendor_id} onChange={v => set('vendor_id', v)} options={vendors} placeholder="Select vendor…" />
              </Field>
              <Field label="Purchase Date">
                <Input type="date" value={form.purchase_date} onChange={v => set('purchase_date', v)} className="[color-scheme:dark]" />
              </Field>
              <Field label="Category">
                <Input value={form.category} onChange={v => set('category', v)} placeholder="e.g. Electronics" />
              </Field>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Purchase Details */}
            <div>
              <SectionHeader icon={Package}>Purchase Details</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <Field label="Unit Price">
                  <DollarInput value={form.unit_purchase_cost} onChange={v => set('unit_purchase_cost', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Qty">
                  <Input type="number" value={form.qty_purchased} onChange={v => set('qty_purchased', v)} />
                </Field>
                <Field label="Subtotal">
                  <ReadBox value={`$${subtotal.toFixed(2)}`} className="text-gray-400" />
                </Field>
                <Field label="Tax">
                  <DollarInput value={form.sales_tax} onChange={v => set('sales_tax', v)} accentClass="focus:border-blue-500/60" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inbound Shipping">
                  <DollarInput value={form.shipping_cost_inbound} onChange={v => set('shipping_cost_inbound', v)} accentClass="focus:border-blue-500/60" />
                </Field>
                <Field label="Total Cost">
                  <ReadBox value={`$${totalCost.toFixed(2)}`} className="text-white font-semibold" />
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

            {/* Payment / Cashback */}
            <div>
              <SectionHeader icon={CreditCard}>Payment & Cashback</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Payment Method">
                  <Sel
                    value={form.payment_method_id}
                    onChange={v => {
                      const pm = paymentMethods.find(p => String(p.id) === String(v));
                      set('payment_method_id', v);
                      if (pm) set('cashback_rate', pm.default_cashback_rate ?? 0);
                    }}
                    options={paymentMethods}
                    placeholder="Select…"
                  />
                </Field>
                <Field label="Cashback %">
                  <Input type="number" value={form.cashback_rate} onChange={v => set('cashback_rate', v)} />
                </Field>
                <Field label="Cashback $">
                  <ReadBox value={`$${cbEarned.toFixed(2)}`} className="text-emerald-400 font-semibold" />
                  <p className="text-[10px] text-gray-600 mt-1">Auto-calculated</p>
                </Field>
              </div>
              <div className="flex gap-6 mt-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.include_tax_in_cashback}
                    onChange={e => set('include_tax_in_cashback', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500"
                  />
                  <span className="text-xs text-gray-400">Include tax in cashback</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.include_shipping_in_cashback}
                    onChange={e => set('include_shipping_in_cashback', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500"
                  />
                  <span className="text-xs text-gray-400">Include shipping in cashback</span>
                </label>
              </div>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* ── Sale Events (editable) ── */}
            <div>
              <SectionHeader icon={Tag}>
                Sale{form._sales.length > 1 ? 's' : ''} ({form._sales.length === 0 ? 'none' : form._sales.length})
              </SectionHeader>

              {form._sales.length === 0 ? (
                <p className="text-xs text-gray-600">No sales recorded for this item yet.</p>
              ) : (
                <div className="space-y-3">
                  {form._sales.map((sale, i) => {
                    const unitPrice = Number(sale.unit_price) || 0;
                    const qty = Number(sale.quantity) || 1;
                    const commission = Number(sale.commission_fee) || 0;
                    const saleShipping = Number(sale.sale_shipping) || 0;
                    const saleTotal = unitPrice * qty;
                    const allocatedTax = (Number(form.sales_tax) / Number(form.qty_purchased)) * qty;
                    const allocatedShipping = (Number(form.shipping_cost_inbound) / Number(form.qty_purchased)) * qty;
                    const totalCostForSale = (Number(form.unit_purchase_cost) * qty) + allocatedTax + allocatedShipping;
                    const saleCashback = totalCostForSale * (cbRate / 100);
                    const profit = saleTotal - commission - saleShipping - totalCostForSale + saleCashback;
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
                              ${unitPrice.toFixed(2)} × {qty}
                              {sale.sale_date && (
                                <span className="text-xs text-gray-500 font-normal ml-2">
                                  · {new Date(sale.sale_date + 'T12:00:00').toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
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
                                  options={SALE_STATUSES.map(s => ({ id: s, name: s }))}
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
                                  className="[color-scheme:dark] focus:border-green-500/60"
                                />
                              </Field>
                              <Field label="Payout Date">
                                <Input
                                  type="date"
                                  value={sale.payout_date}
                                  onChange={v => setSale(i, 'payout_date', v)}
                                  className="[color-scheme:dark] focus:border-green-500/60"
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

                            {/* Mini profit breakdown */}
                            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] divide-y divide-white/[0.04] text-xs mt-1">
                              <div className="flex justify-between px-3 py-2">
                                <span className="text-gray-500">Revenue</span>
                                <span className="text-green-400">${saleTotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between px-3 py-2">
                                <span className="text-gray-500">Cost basis</span>
                                <span className="text-red-400">-${totalCostForSale.toFixed(2)}</span>
                              </div>
                              {commission > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Commission</span>
                                  <span className="text-red-400">-${commission.toFixed(2)}</span>
                                </div>
                              )}
                              {saleShipping > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Sale shipping</span>
                                  <span className="text-red-400">-${saleShipping.toFixed(2)}</span>
                                </div>
                              )}
                              {saleCashback > 0 && (
                                <div className="flex justify-between px-3 py-2">
                                  <span className="text-gray-500">Cashback</span>
                                  <span className="text-emerald-400">+${saleCashback.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex justify-between px-3 py-2 font-semibold">
                                <span className="text-gray-300">Net Profit</span>
                                <span className={profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* ── Summary ── */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">Summary</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Cost of Goods</span>
                  <span className="text-white font-medium">${subtotal.toFixed(2)}</span>
                </div>
                {taxAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Tax</span>
                    <span className="text-red-400 font-medium">+${taxAmt.toFixed(2)}</span>
                  </div>
                )}
                {shippingAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Shipping</span>
                    <span className="text-red-400 font-medium">+${shippingAmt.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                  <span className="text-gray-200 font-semibold">Total Cost</span>
                  <span className="text-white font-bold">${totalCost.toFixed(2)}</span>
                </div>
                {cbEarned > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Cashback ({cbRate}%)</span>
                    <span className="text-emerald-400 font-semibold">+${cbEarned.toFixed(2)}</span>
                  </div>
                )}
                {form._sales.length > 0 && (() => {
                  const totalSaleRevenue = form._sales.reduce((sum, s) => sum + ((Number(s.unit_price) || 0) * (Number(s.quantity) || 1)), 0);
                  const totalCommissions = form._sales.reduce((sum, s) => sum + (Number(s.commission_fee) || 0), 0);
                  const totalSaleShipping = form._sales.reduce((sum, s) => sum + (Number(s.sale_shipping) || 0), 0);
                  const grossProfit = totalSaleRevenue - totalCommissions - totalSaleShipping - totalCost;
                  const netProfit = grossProfit + cbEarned;
                  return (
                    <>
                      <div className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                        <span className="text-gray-400">Sale Revenue</span>
                        <span className="text-green-400 font-medium">${totalSaleRevenue.toFixed(2)}</span>
                      </div>
                      {totalCommissions > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Commissions</span>
                          <span className="text-red-400 font-medium">-${totalCommissions.toFixed(2)}</span>
                        </div>
                      )}
                      {totalSaleShipping > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Sale Shipping</span>
                          <span className="text-red-400 font-medium">-${totalSaleShipping.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-200 font-semibold">Net Profit</span>
                        <span className={`font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                        </span>
                      </div>
                      {cbEarned > 0 && (
                        <p className="text-[10px] text-gray-600">
                          Includes ${cbEarned.toFixed(2)} cashback ({cbRate}%)
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
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
