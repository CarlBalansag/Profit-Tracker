import React, { useState, useEffect } from 'react';
import { X, Plus, DollarSign, Package, Calendar, CreditCard, Truck, Tag } from 'lucide-react';

const STATUSES = ['Pre Order', 'PURCHASED', 'SHIPPED', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'PAID', 'COMPLETED'];

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

// ─── Status badge for modal ────────────────────────────────────────────────────
function StatusOption({ status, selected, onClick }) {
  const map = {
    'Pre Order': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    PURCHASED:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
    SHIPPED:    'bg-purple-500/10 text-purple-400 border-purple-500/30',
    DELIVERED:  'bg-orange-500/10 text-orange-400 border-orange-500/30',
    SCANNED_IN: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    LISTED:     'bg-amber-500/10 text-amber-400 border-amber-500/30',
    SOLD:       'bg-green-500/10 text-green-400 border-green-500/30',
    PAID:       'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    COMPLETED:  'bg-teal-500/10 text-teal-400 border-teal-500/30',
  };
  const cls = map[status] || map.PURCHASED;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider border transition-all ${
        selected ? cls + ' ring-1 ring-white/20 scale-105' : 'border-transparent text-gray-500 hover:text-gray-300'
      }`}
    >
      {status}
    </button>
  );
}

// ─── Main Modal ────────────────────────────────────────────────────────────────
export default function TransactionDetailModal({ row, onClose, onSaved, platforms = [], paymentMethods = [] }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/inventory/${row.rawId}`, { credentials: 'include' });
        if (res.ok) {
          const d = await res.json();
          setForm({
            product_name:            d.product_name ?? '',
            status:                  row.status ?? d.status ?? 'PURCHASED',
            vendor_id:               d.vendor_id ?? '',
            platform_id:             d.platform_id ?? '',
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
            // sale info from the row for display
            _sales: d.sales || [],
            _vendorName: d.vendor?.name || '',
            _paymentName: d.payment_method?.name || '',
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

  // ── Live calculations ────────────────────────────────────────────────────────
  const subtotal     = Number(form?.unit_purchase_cost ?? 0) * Number(form?.qty_purchased ?? 1);
  const taxAmt       = Number(form?.sales_tax ?? 0);
  const shippingAmt  = Number(form?.shipping_cost_inbound ?? 0);
  const totalCost    = subtotal + taxAmt + shippingAmt;
  const cbBase       = subtotal
    + (form?.include_tax_in_cashback     ? taxAmt     : 0)
    + (form?.include_shipping_in_cashback ? shippingAmt : 0);
  const cbRate       = Number(form?.cashback_rate ?? 0);
  const cbEarned     = cbBase * (cbRate / 100);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const invRes = await fetch(`http://localhost:3000/api/inventory/${row.rawId}`, {
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
        }),
      });
      if (!invRes.ok) return;

      // If this row is a sale, also save the sale's status
      if (row.isSale && row.saleId) {
        await fetch(`http://localhost:3000/api/sales/${row.saleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: form.status }),
        });
      }

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
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[600px] max-h-[90vh] bg-[#15171d] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'fadeInScale 0.2s ease-out' }}
      >
        <style>{`
          @keyframes fadeInScale {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
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
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">

            {/* Product Name + Status */}
            <div className="grid grid-cols-[1fr_170px] gap-3">
              <Field label="Product Name *">
                <Input value={form.product_name} onChange={v => set('product_name', v)} placeholder="Product name" />
              </Field>
              <Field label="Status">
                <Sel value={form.status} onChange={v => set('status', v)} options={STATUSES.map(s => ({ id: s, name: s }))} />
              </Field>
            </div>

            {/* Vendor / Date / Category */}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vendor">
                <Sel value={form.vendor_id} onChange={v => set('vendor_id', v)} options={platforms} placeholder="Select vendor…" />
              </Field>
              <Field label="Date">
                <Input type="date" value={form.purchase_date} onChange={v => set('purchase_date', v)} />
              </Field>
              <Field label="Category">
                <Input value={form.category} onChange={v => set('category', v)} placeholder="e.g. Electronics" />
              </Field>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Purchase Details */}
            <div>
              <SectionHeader icon={Package}>Purchase Details</SectionHeader>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <Field label="Unit Price">
                  <Input type="number" value={form.unit_purchase_cost} onChange={v => set('unit_purchase_cost', v)} />
                </Field>
                <Field label="Qty">
                  <Input type="number" value={form.qty_purchased} onChange={v => set('qty_purchased', v)} />
                </Field>
                <Field label="Total">
                  <ReadBox value={`$${subtotal.toFixed(2)}`} className="text-gray-400" />
                </Field>
                <Field label="Tax">
                  <Input type="number" value={form.sales_tax} onChange={v => set('sales_tax', v)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shipping Cost">
                  <Input type="number" value={form.shipping_cost_inbound} onChange={v => set('shipping_cost_inbound', v)} />
                </Field>
                <Field label="Total Cost">
                  <ReadBox value={`$${totalCost.toFixed(2)}`} className="text-white font-semibold" />
                </Field>
              </div>
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Payment / Cashback */}
            <div>
              <SectionHeader icon={CreditCard}>Payment & Cashback</SectionHeader>
              <div className="grid grid-cols-3 gap-3">
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
                  <p className="text-[10px] text-gray-600 mt-1">Auto-calculated from % & base</p>
                </Field>
              </div>

              {/* Cashback Checkboxes */}
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

            {/* Sale Events */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader icon={Tag}>Sale Events</SectionHeader>
                <button
                  type="button"
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-lg hover:bg-indigo-500/10 transition-colors -mt-1"
                >
                  + Record Sale
                </button>
              </div>
              {form._sales.length > 0 ? (
                <div className="space-y-2">
                  {form._sales.map((sale, i) => {
                    const saleTotal = sale.unit_price * sale.quantity;
                    const allocatedTax = (Number(form.sales_tax) / Number(form.qty_purchased)) * sale.quantity;
                    const allocatedShipping = (Number(form.shipping_cost_inbound) / Number(form.qty_purchased)) * sale.quantity;
                    const totalCostForSale = (Number(form.unit_purchase_cost) * sale.quantity) + allocatedTax + allocatedShipping;
                    const profit = saleTotal - sale.commission_fee - totalCostForSale;
                    return (
                      <div key={sale.id} className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-sm text-white font-medium">${sale.unit_price.toFixed(2)}</span>
                            <span className="text-[10px] text-gray-500">× {sale.quantity}</span>
                          </div>
                          {sale.platform && (
                            <span className="text-[10px] text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded">
                              {sale.platform.name}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {new Date(sale.sale_date).toLocaleDateString()}
                          </span>
                        </div>
                        <span className={`text-sm font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-600">No sales recorded yet. Click "Record Sale" to add one.</p>
              )}
            </div>

            <div className="border-t border-white/[0.04]" />

            {/* Summary */}
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
                  const totalSaleRevenue = form._sales.reduce((sum, s) => sum + (s.unit_price * s.quantity), 0);
                  const totalCommissions = form._sales.reduce((sum, s) => sum + s.commission_fee, 0);
                  const totalProfit = totalSaleRevenue - totalCommissions - totalCost;
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
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-200 font-semibold">Profit</span>
                        <span className={`font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                        </span>
                      </div>
                      {cbEarned > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Profit w/ Cashback</span>
                          <span className={`font-bold ${(totalProfit + cbEarned) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(totalProfit + cbEarned) >= 0 ? '+' : ''}${(totalProfit + cbEarned).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3 shrink-0">
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
