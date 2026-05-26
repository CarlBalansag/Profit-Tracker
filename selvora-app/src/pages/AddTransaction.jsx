import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Package, ShoppingCart, Truck, CreditCard, DollarSign, Plus,
  Paperclip, X, Hash, MapPin, ChevronDown, CheckCircle2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePaymentMethods, usePlatforms, useInvalidate, apiFetch} from '../hooks/useApi';

// ── Stable module-level components (MUST be outside the component to avoid focus loss) ──
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
    {children}
  </div>
);

const inputCls = (accent = 'purple') =>
  `w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-${accent}-500/50 transition-colors`;

const AddTransaction = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const prevCashbackKeyRef = useRef(null);

  const DRAFT_KEY = 'add_transaction_draft';
  const DRAFT_TTL = 30 * 60 * 1000;

  const defaultForm = {
    product_name: '',
    category: '',
    unit_purchase_cost: '',
    qty_purchased: 1,
    purchase_date: new Date().toISOString().split('T')[0],
    sales_tax: '',
    shipping_cost_inbound: '',
    fees: '',
    tax_exempt: false,
    vendor_id: '',
    payment_method_id: '',
    status: 'PURCHASED',
    order_number: '',
    tracking_number: '',
    sale_price: '',
    payout_date: '',
    sale_shipping: '',
    sale_fees: '',
    taxable: true,
    sale_tax_collected: '',
    customer_tax_exempt: false,
    exemption_type: '',
    gift_card_amount: '',
    cashback_include_tax: true,
    cashback_include_shipping: true,
    sale_tab: 'cashout',
    cashout_platform_id: '',
    marketplace_platform_id: '',
    commission_fee: '',
    sale_date: '',
    qty_sold: 1,
  };

  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < DRAFT_TTL) return { form: data };
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* ignore */ }
    return null;
  };

  const saved = loadDraft();
  const [formData, setFormData] = useState(saved?.form ?? defaultForm);
  const [itemSold, setItemSold] = useState(false);
  const [showCashbackProfit, setShowCashbackProfit] = useState(false);

  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: platforms = [] } = usePlatforms();
  const invalidate = useInvalidate();
  const [attachedFiles, setAttachedFiles] = useState([]);

  // Auto-save draft to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: formData, ts: Date.now() }));
    } catch { /* ignore */ }
  }, [formData]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleQtyChange = (delta) => {
    setFormData(prev => ({
      ...prev,
      qty_purchased: Math.max(1, parseInt(prev.qty_purchased || 0) + delta)
    }));
  };

  const handleQtyInput = (e) => {
    const val = e.target.value;
    if (val === '' || /^\d+$/.test(val)) {
      setFormData(prev => ({ ...prev, qty_purchased: val === '' ? '' : parseInt(val) }));
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setAttachedFiles(prev => [...prev, ...files]);
  };

  const removeFile = (idx) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const submitPromise = apiFetch(`/api/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(formData)
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res;
    });

    toast.promise(submitPromise, {
      loading: 'Saving transaction...',
      success: () => {
        localStorage.removeItem(DRAFT_KEY);
        invalidate.inventory();
        invalidate.dashboard();
        setTimeout(() => navigate('/transactions'), 800);
        return 'Transaction added successfully!';
      },
      error: (err) => `Failed: ${err.message}`,
    });
  };

  const subtotal = (parseFloat(formData.unit_purchase_cost) || 0) * (parseInt(formData.qty_purchased) || 0);
  const totalCost = subtotal
    + (parseFloat(formData.sales_tax) || 0)
    + (parseFloat(formData.shipping_cost_inbound) || 0)
    + (parseFloat(formData.fees) || 0);

  // Cashback calculation — auto-applies category rate when vendor matches
  const selectedCard = paymentMethods.find(pm => pm.id === formData.payment_method_id);
  const selectedVendor = platforms.find(p => p.id === formData.vendor_id);

  const getCategoryRate = (card, vendorName) => {
    if (!card || !vendorName) return null;
    // category_rates may be a parsed array (payment-methods API) or a raw JSON
    // string (inventory API). Handle both.
    let rates = card.category_rates;
    if (typeof rates === 'string') {
      try { rates = JSON.parse(rates); } catch { rates = []; }
    }
    if (!Array.isArray(rates) || rates.length === 0) return null;
    const today = new Date();
    const name = vendorName.toLowerCase();
    const match = rates.find(cr => {
      if (cr.expires && new Date(cr.expires) < today) return false;
      return name.includes(cr.store.toLowerCase()) || cr.store.toLowerCase().includes(name);
    });
    return match || null;
  };

  const categoryRateMatch = getCategoryRate(selectedCard, selectedVendor?.name);
  const cashbackRate = categoryRateMatch ? categoryRateMatch.rate : (selectedCard?.default_cashback_rate || 0);

  const giftCardAmount = parseFloat(formData.gift_card_amount) || 0;
  const cashbackBase = Math.max(0,
    subtotal
    + (formData.cashback_include_tax ? (parseFloat(formData.sales_tax) || 0) : 0)
    + (formData.cashback_include_shipping ? (parseFloat(formData.shipping_cost_inbound) || 0) : 0)
    - giftCardAmount
  );
  const cashbackAmount = cashbackBase * (cashbackRate / 100);

  // ── Cashback rate change toast ──────────────────────────────────────────────
  useEffect(() => {
    if (!formData.payment_method_id || !formData.vendor_id) {
      prevCashbackKeyRef.current = null;
      return;
    }

    const key = `${formData.payment_method_id}:${formData.vendor_id}`;
    if (prevCashbackKeyRef.current === key) return; // already toasted this combo
    prevCashbackKeyRef.current = key;

    const card = paymentMethods.find(pm => pm.id === formData.payment_method_id);
    const vendor = platforms.find(p => p.id === formData.vendor_id);
    if (!card || !vendor) return;

    let rates = card.category_rates;
    if (typeof rates === 'string') { try { rates = JSON.parse(rates); } catch { rates = []; } }
    const today = new Date();
    const name = vendor.name.toLowerCase();
    const match = Array.isArray(rates)
      ? rates.find(cr => {
          if (cr.expires && new Date(cr.expires) < today) return false;
          return name.includes(cr.store.toLowerCase()) || cr.store.toLowerCase().includes(name);
        })
      : null;

    if (match) {
      const base = card.default_cashback_rate || 0;
      const boosted = match.rate > base;
      toast.info(
        `${card.name} earns ${match.rate}% at ${vendor.name}${
          boosted ? ` — boosted from ${base}% base` : ''
        }`,
        {
          duration: 5000,
          id: 'cashback-rate-change',
          description: match.expires
            ? `Category rate · expires ${new Date(match.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : 'Category rate applied automatically',
        }
      );
    } else if (card.default_cashback_rate > 0) {
      toast.info(
        `${card.name} earns ${card.default_cashback_rate}% base cashback at ${vendor.name}`,
        { duration: 3500, id: 'cashback-rate-change', description: 'No elevated category rate for this store' }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.payment_method_id, formData.vendor_id]);

  // dollarInput is a render helper (not a component) — safe inside the component
  const dollarInput = (name, placeholder = '0.00', accent = 'blue') => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
      <input
        type="number" step="0.01" name={name}
        value={formData[name]} onChange={handleChange}
        className={`${inputCls(accent)} pl-7`}
        placeholder={placeholder}
      />
    </div>
  );


  return (
    <div className="container max-w-5xl mx-auto px-4 py-6 lg:px-8 lg:py-10">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Add Transaction</h1>
          <p className="text-gray-400 text-sm mt-1">Record a new purchase — fill in the details below</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">

            {/* ── Product Information ────────────────────────────────── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-400">Product Information</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Product Name *">
                    <input
                      name="product_name" value={formData.product_name} onChange={handleChange}
                      className={inputCls('purple')}
                      placeholder="e.g. Apple AirPods Pro 2nd Gen"
                      autoComplete="off"
                      required
                    />
                  </Field>
                </div>
                <Field label="Category">
                  <select name="category" value={formData.category} onChange={handleChange} className={`${inputCls('purple')} appearance-none`}>
                    <option value="">Select category...</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Apparel">Apparel</option>
                    <option value="Home">Home</option>
                    <option value="Grocery">Grocery</option>
                    <option value="Auto">Auto</option>
                    <option value="Sports">Sports</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Purchase Details ───────────────────────────────────── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">Purchase Details</h3>
              </div>

              {/* Row 1: Unit Price, Qty, Total, Date */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Unit Price *">
                  {dollarInput('unit_purchase_cost', '0.00', 'blue')}
                </Field>

                <Field label="Quantity">
                  <div className="flex bg-white/[0.02] border border-white/10 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleQtyChange(-1)}
                      className="px-3 py-1.5 text-gray-400 hover:text-white transition-colors border-r border-white/10 flex-shrink-0"
                    >-</button>
                    <input
                      type="number"
                      value={formData.qty_purchased}
                      onChange={handleQtyInput}
                      min="1"
                      className="w-full bg-transparent px-2 py-1.5 text-sm text-white text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleQtyChange(1)}
                      className="px-3 py-1.5 text-gray-400 hover:text-white transition-colors border-l border-white/10 flex-shrink-0"
                    >+</button>
                  </div>
                </Field>

                <Field label="Total Price">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number" readOnly value={subtotal.toFixed(2)}
                      className="w-full bg-white/[0.02] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-500 focus:outline-none"
                    />
                  </div>
                </Field>

                <Field label="Date">
                  <input
                    type="date" name="purchase_date" value={formData.purchase_date} onChange={handleChange}
                    className={`${inputCls('blue')} [color-scheme:dark]`}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Tax">{dollarInput('sales_tax', '0.00', 'blue')}</Field>
                <Field label="Shipping Cost">{dollarInput('shipping_cost_inbound', '0.00', 'blue')}</Field>
                <Field label="Fees">{dollarInput('fees', '0.00', 'blue')}</Field>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={formData.tax_exempt}
                  onChange={e => setFormData(p => ({ ...p, tax_exempt: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-600 accent-blue-500"
                />
                <span className="text-sm text-gray-300">Tax Exempt</span>
              </label>
            </div>

            {/* ── Purchase Location ──────────────────────────────────── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Purchase Location</h3>
              </div>

              {/* Row 1: Store, Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Store">
                  <select
                    name="vendor_id" value={formData.vendor_id} onChange={handleChange}
                    className={`${inputCls('amber')} appearance-none`}
                  >
                    <option value="">Select store...</option>
                    {platforms.filter(p => p.type === 'Vendor').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>

                <Field label="Status">
                  <select
                    name="status" value={formData.status} onChange={handleChange}
                    className={`${inputCls('amber')} appearance-none`}
                  >
                    <option value="Pre Order">Pre Order</option>
                    <option value="PURCHASED">Purchased</option>
                    <option value="SHIPPED_IN">Shipped In</option>
                    <option value="DELIVERED">Delivered</option>
                    <option value="SCANNED_IN">Scanned In</option>
                    <option value="LISTED">Listed</option>
                    <option value="SOLD">Sold</option>
                    <option value="SHIPPED_OUT">Shipped Out</option>
                    <option value="AUTHENTICATION">Authentication</option>
                    <option value="PAID">Paid</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="RETURNED">Returned</option>
                    <option value="DISPUTED">Disputed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </Field>
              </div>

              {/* Row 2: Order Number, Tracking Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Order Number">
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text" name="order_number" value={formData.order_number} onChange={handleChange}
                      className={`${inputCls('amber')} pl-8`}
                      placeholder="e.g. 112-3456789"
                    />
                  </div>
                </Field>

                <Field label="Tracking Number">
                  <div className="relative">
                    <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text" name="tracking_number" value={formData.tracking_number} onChange={handleChange}
                      className={`${inputCls('amber')} pl-8`}
                      placeholder="e.g. 1Z999AA10123456784"
                    />
                  </div>
                </Field>
              </div>

              {/* Attach Receipt */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Attach Receipts <span className="text-gray-600">(optional)</span>
                </label>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10 border-dashed cursor-pointer hover:border-amber-500/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500">
                    {attachedFiles.length === 0
                      ? 'Click to choose files...'
                      : `${attachedFiles.length} file${attachedFiles.length > 1 ? 's' : ''} selected`}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {/* File chips */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {attachedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300"
                      >
                        <Paperclip className="w-3 h-3 text-gray-500" />
                        <span className="max-w-[120px] truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-gray-600 hover:text-red-400 transition-colors ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-gray-600 mt-1.5">
                  Uses the same receipts upload endpoint and links by transaction/order.
                </p>
              </div>
            </div>

            {/* ── Payment & Cashback ─────────────────────────────────── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-pink-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-pink-400">Payment & Cashback</h3>
              </div>

              {/* Row 1: Payment Method, Cashback Rate, Cashback Amount */}
              <div className="grid grid-cols-3 gap-4">
                <Field label="Payment Method">
                  <select
                    name="payment_method_id" value={formData.payment_method_id} onChange={handleChange}
                    className={`${inputCls('pink')} appearance-none`}
                  >
                    <option value="">Select card...</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Cashback Rate %">
                  <div className="relative">
                    <input
                      type="number" readOnly
                      value={cashbackRate}
                      className={`w-full bg-white/[0.02] border rounded-lg px-3 pr-8 py-2 text-sm focus:outline-none ${categoryRateMatch ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-gray-400'}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                  </div>
                  {categoryRateMatch && (
                    <p className="text-[10px] text-emerald-500/80 mt-1">
                      {categoryRateMatch.store} rate
                      {categoryRateMatch.expires ? ` · expires ${new Date(categoryRateMatch.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    </p>
                  )}
                </Field>

                <Field label={<span>Cashback Amount <span className="text-gray-600 normal-case font-normal">(auto)</span></span>}>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number" readOnly
                      value={cashbackAmount.toFixed(2)}
                      className="w-full bg-white/[0.02] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-sm text-emerald-400 focus:outline-none"
                    />
                  </div>
                </Field>
              </div>

              {/* Row 2: Gift Card */}
              <Field label="Gift Card Used">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number" step="0.01"
                    name="gift_card_amount" value={formData.gift_card_amount} onChange={handleChange}
                    className={`${inputCls('pink')} pl-7`}
                    placeholder="0.00"
                  />
                </div>
              </Field>

              {/* Cashback toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.cashback_include_tax}
                    onChange={e => setFormData(p => ({ ...p, cashback_include_tax: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded border-gray-600 accent-pink-500"
                  />
                  <span className="text-xs text-gray-400">Include tax in cashback</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.cashback_include_shipping}
                    onChange={e => setFormData(p => ({ ...p, cashback_include_shipping: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded border-gray-600 accent-pink-500"
                  />
                  <span className="text-xs text-gray-400">Include shipping in cashback</span>
                </label>
              </div>
            </div>

            {/* ── "Has item been sold?" toggle ──────────────────── */}
            <button
              type="button"
              onClick={() => setItemSold(v => !v)}
              className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border transition-all ${
                itemSold
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className={`w-4 h-4 ${itemSold ? 'text-green-400' : 'text-gray-600'}`} />
                <div className="text-left">
                  <p className={`text-sm font-semibold ${itemSold ? 'text-green-400' : 'text-gray-300'}`}>
                    Has this item been sold?
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {itemSold ? 'Sale details are shown below.' : 'Toggle on to enter sale information.'}
                  </p>
                </div>
              </div>
              <div className={`w-10 h-5 rounded-full flex items-center transition-colors px-0.5 ${
                itemSold ? 'bg-green-500 justify-end' : 'bg-white/10 justify-start'
              }`}>
                <div className="w-4 h-4 rounded-full bg-white shadow" />
              </div>
            </button>

            {/* ── Sale Details (revealed when itemSold) ───────── */}
            {itemSold && (
            <div className="card p-5 space-y-4 border-green-500/20">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-green-400">
                  Sale Details
                </h3>
              </div>
              <p className="text-[11px] text-gray-500">
                Fill these in if you already have sale info. You can always update later from the Transactions page.
              </p>

              {/* Chrome-style Tab Strip */}
              <div className="flex border-b border-white/[0.07]">
                {[{ id: 'cashout', label: 'Cashout' }, { id: 'marketplace', label: 'Marketplace' }].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFormData(p => ({ ...p, sale_tab: tab.id }))}
                    className={`px-5 py-2 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                      formData.sale_tab === tab.id
                        ? 'border-green-400 text-green-400'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="space-y-4 pt-1">
                {/* Platform dropdown */}
                <Field label={formData.sale_tab === 'cashout' ? 'Cashout Platform' : 'Marketplace'}>
                  <select
                    value={formData.sale_tab === 'cashout' ? formData.cashout_platform_id : formData.marketplace_platform_id}
                    onChange={e => {
                      const key = formData.sale_tab === 'cashout' ? 'cashout_platform_id' : 'marketplace_platform_id';
                      setFormData(p => ({ ...p, [key]: e.target.value }));
                    }}
                    className={`${inputCls('green')} appearance-none`}
                  >
                    <option value="">
                      {formData.sale_tab === 'cashout' ? 'Select cashout platform...' : 'Select marketplace...'}
                    </option>
                    {platforms
                      .filter(p => formData.sale_tab === 'cashout'
                        ? p.type === 'Cashout'
                        : p.type === 'Marketplace'
                      )
                      .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                    }
                  </select>
                </Field>

                {/* Sale Price, Qty Sold — row 1 */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sale Price (per unit)">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" step="0.01" name="sale_price"
                        value={formData.sale_price} onChange={handleChange}
                        className={`${inputCls('green')} pl-7`}
                        placeholder="0.00"
                      />
                    </div>
                  </Field>

                  <Field label="Quantity Sold">
                    <div className="flex bg-white/[0.02] border border-white/10 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setFormData(p => ({ ...p, qty_sold: Math.max(1, (parseInt(p.qty_sold) || 1) - 1) }))}
                        className="px-3 py-1.5 text-gray-400 hover:text-white transition-colors border-r border-white/10 flex-shrink-0"
                      >-</button>
                      <input
                        type="number"
                        value={formData.qty_sold}
                        min="1"
                        onChange={e => setFormData(p => ({ ...p, qty_sold: e.target.value === '' ? '' : parseInt(e.target.value) || 1 }))}
                        className="w-full bg-transparent px-2 py-1.5 text-sm text-white text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => setFormData(p => ({ ...p, qty_sold: (parseInt(p.qty_sold) || 1) + 1 }))}
                        className="px-3 py-1.5 text-gray-400 hover:text-white transition-colors border-l border-white/10 flex-shrink-0"
                      >+</button>
                    </div>
                  </Field>
                </div>

                {/* Sale Shipping, Sale Fees — row 2 */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sale Shipping">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" step="0.01" name="sale_shipping"
                        value={formData.sale_shipping} onChange={handleChange}
                        className={`${inputCls('green')} pl-7`}
                        placeholder="0.00"
                      />
                    </div>
                  </Field>
                  <Field label="Sale Fees">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" step="0.01" name="sale_fees"
                        value={formData.sale_fees} onChange={handleChange}
                        className={`${inputCls('green')} pl-7`}
                        placeholder="0.00"
                      />
                    </div>
                  </Field>
                </div>

                {/* Sale Date, Payout Date — row 3 */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sale Date">
                    <input
                      type="date" name="sale_date"
                      value={formData.sale_date} onChange={handleChange}
                      className={`${inputCls('green')} [color-scheme:dark]`}
                    />
                  </Field>

                  <Field label="Payout Date">
                    <input
                      type="date" name="payout_date"
                      value={formData.payout_date} onChange={handleChange}
                      className={`${inputCls('green')} [color-scheme:dark]`}
                    />
                  </Field>
                </div>

                {/* Tax Info */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sale Tax Collected">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" step="0.01" name="sale_tax_collected"
                        value={formData.sale_tax_collected} onChange={handleChange}
                        className={`${inputCls('green')} pl-7`}
                        placeholder="0.00"
                      />
                    </div>
                  </Field>
                  <Field label="Exemption Type">
                    <input
                      type="text" name="exemption_type"
                      value={formData.exemption_type} onChange={handleChange}
                      className={inputCls('green')}
                      placeholder="e.g. Resale, Nonprofit..."
                      disabled={!formData.customer_tax_exempt}
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.taxable}
                      onChange={e => setFormData(p => ({ ...p, taxable: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-600 accent-green-500"
                    />
                    <span className="text-sm text-gray-300">Taxable Sale</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.customer_tax_exempt}
                      onChange={e => setFormData(p => ({ ...p, customer_tax_exempt: e.target.checked, exemption_type: e.target.checked ? p.exemption_type : '' }))}
                      className="w-4 h-4 rounded border-gray-600 accent-green-500"
                    />
                    <span className="text-sm text-gray-300">Customer Tax Exempt</span>
                  </label>
                </div>

                {/* Per-unit note + mini summary */}
                {(() => {
                  const sp = parseFloat(formData.sale_price) || 0;
                  const qs = parseInt(formData.qty_sold) || 1;
                  const purchaseTotal = subtotal;
                  const saleTotal = sp * qs;
                  return (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" defaultChecked className="w-3.5 h-3.5 rounded border-gray-600 accent-green-500" />
                        <span className="text-xs text-gray-400">
                          Sale price is{' '}
                          <span className="text-green-400 font-medium">per unit</span>
                          {sp > 0 && qs > 0 && (
                            <span className="text-gray-600"> (${sp.toFixed(2)} × {qs} = ${saleTotal.toFixed(2)})</span>
                          )}
                        </span>
                      </label>

                      {(sp > 0 || purchaseTotal > 0) && (
                        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.04] text-xs overflow-hidden">
                          <div className="flex justify-between px-4 py-2.5">
                            <span className="text-gray-400">Purchase total</span>
                            <span className="text-gray-200">${purchaseTotal.toFixed(2)}</span>
                          </div>
                          {sp > 0 && (
                            <div className="flex justify-between px-4 py-2.5">
                              <span className="text-gray-400">Sale total ({qs} × ${sp.toFixed(2)})</span>
                              <span className="text-green-400">${saleTotal.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            )}


          </div>

          {/* ── Right Summary Sidebar ──────────────────────────────── */}
          <div className="lg:col-span-1 space-y-5">
            <div className="lg:sticky lg:top-6 space-y-5">
              <div className="rounded-2xl p-5 space-y-3 bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-purple-400" />
                  Transaction Summary
                </h3>

                {(() => {
                  const tax        = parseFloat(formData.sales_tax) || 0;
                  const shipping   = parseFloat(formData.shipping_cost_inbound) || 0;
                  const fees       = parseFloat(formData.fees) || 0;
                  const giftCard   = parseFloat(formData.gift_card_amount) || 0;
                  const salePrice  = parseFloat(formData.sale_price) || 0;
                  const qtySold    = parseInt(formData.qty_sold) || 1;
                  const totalSale  = salePrice * qtySold;
                  const unitCost   = parseFloat(formData.unit_purchase_cost) || 0;
                  const qtyPurchased = parseInt(formData.qty_purchased) || 1;
                  const allocatedTax = (tax / qtyPurchased) * qtySold;
                  const allocatedShipping = (shipping / qtyPurchased) * qtySold;
                  const allocatedGiftCard = (giftCard / qtyPurchased) * qtySold;
                  const totalUnitCost = (unitCost * qtySold) + allocatedTax + allocatedShipping - allocatedGiftCard;
                  const saleShipping = parseFloat(formData.sale_shipping) || 0;
                  const saleFees = parseFloat(formData.sale_fees) || 0;
                  const profit = totalSale - totalUnitCost - saleShipping - saleFees;

                  const Row = ({ label, value, color = 'text-gray-200' }) => (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">{label}</span>
                      <span className={color}>{value}</span>
                    </div>
                  );

                  return (
                    <div className="space-y-2 text-sm">
                      <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
                      {tax      > 0 && <Row label="Tax"      value={`$${tax.toFixed(2)}`} />}
                      {shipping > 0 && <Row label="Shipping" value={`$${shipping.toFixed(2)}`} />}
                      {fees     > 0 && <Row label="Fees"     value={`$${fees.toFixed(2)}`} />}
                      {giftCard > 0 && (
                        <Row label="Gift Card" value={`-$${giftCard.toFixed(2)}`} color="text-blue-400" />
                      )}

                      <div className="border-t border-white/[0.06] pt-2">
                        <Row label="Net Cost" value={`$${Math.max(0, totalCost - giftCard).toFixed(2)}`} color="text-white font-semibold" />
                      </div>

                      {cashbackAmount > 0 && (
                        <Row label="Cashback earned" value={`+$${cashbackAmount.toFixed(2)}`} color="text-emerald-400" />
                      )}

                      {itemSold && salePrice > 0 && (
                        <>
                          <div className="border-t border-white/[0.06] pt-2 space-y-2">
                            <Row label="Sale Revenue" value={`$${totalSale.toFixed(2)}`} color="text-green-400" />
                          </div>

                          <div className="border-t border-white/[0.06] pt-2 space-y-2">
                            {saleShipping > 0 && (
                              <Row label="Sale shipping" value={`-$${saleShipping.toFixed(2)}`} color="text-red-400" />
                            )}
                            {saleFees > 0 && (
                              <Row label="Sale fees" value={`-$${saleFees.toFixed(2)}`} color="text-red-400" />
                            )}

                            {/* Profit / Profit+Cashback toggle — only shown when cashback exists */}
                            {cashbackAmount > 0 && (
                              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[10px] font-semibold">
                                <button
                                  type="button"
                                  onClick={() => setShowCashbackProfit(false)}
                                  className={`flex-1 py-1 rounded-md transition-colors ${!showCashbackProfit ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                  Profit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowCashbackProfit(true)}
                                  className={`flex-1 py-1 rounded-md transition-colors ${showCashbackProfit ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                  + Cashback
                                </button>
                              </div>
                            )}

                            <div className="flex justify-between items-center">
                              <span className="font-medium text-gray-200">
                                {showCashbackProfit && cashbackAmount > 0 ? 'Est. Profit + Cashback' : 'Est. Profit'}
                              </span>
                              <span className={`font-bold text-base ${(showCashbackProfit ? profit + cashbackAmount : profit) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {(showCashbackProfit ? profit + cashbackAmount : profit) >= 0 ? '+' : ''}${(showCashbackProfit ? profit + cashbackAmount : profit).toFixed(2)}
                              </span>
                            </div>

                            {showCashbackProfit && cashbackAmount > 0 && (
                              <p className="text-[10px] text-gray-600">
                                Includes ${cashbackAmount.toFixed(2)} cashback ({cashbackRate}% on ${cashbackBase.toFixed(2)})
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>


              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
              >
                <Plus className="w-4 h-4" />
                Add Transaction
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default AddTransaction;
