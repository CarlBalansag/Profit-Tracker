import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useInventory, usePlatforms, usePaymentMethods, useInvalidate, apiFetch} from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search, SlidersHorizontal, Download, Columns,
  List, Tag, Globe, Package, Check, DollarSign, Sidebar,
  Edit2, Trash2, ChevronLeft, ChevronRight, Maximize2, X,
  Zap, Store, Calendar
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import TransactionDetailModal from '../components/TransactionDetailModal';
import ProductNoteButton from '../components/ProductNoteButton';
import { PRESET_CARDS } from '../data/presetCards';

// ─── Inline editable cell input ───────────────────────────────────────────────
function EditInput({ value, onChange, type = 'text', className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#0d0d18] border border-indigo-500/40 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-400 w-full ${className}`}
    />
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
export const STATUS_COLORS = {
  'PRE ORDER':     'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'ON HAND':       'bg-teal-500/10 text-teal-400 border-teal-500/20',
  PURCHASED:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  SHIPPED_IN:      'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SHIPPED_OUT:     'bg-sky-500/10 text-sky-400 border-sky-500/20',
  DELIVERED:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
  SCANNED_IN:      'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  LISTED:          'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SOLD:            'bg-green-500/10 text-green-400 border-green-500/20',
  PAID:            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  COMPLETED:       'bg-teal-500/10 text-teal-400 border-teal-500/20',
  AUTHENTICATION:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
  RETURNED:        'bg-red-500/10 text-red-400 border-red-500/20',
  DISPUTED:        'bg-rose-500/10 text-rose-400 border-rose-500/20',
  CANCELLED:       'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

function StatusBadge({ status }) {
  const cls = STATUS_COLORS[status?.toUpperCase()] || STATUS_COLORS.PURCHASED;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${cls}`}>
      {status}
    </span>
  );
}

// ─── Inline select ───────────────────────────────────────────────────────────
function EditSelect({ value, onChange, options, placeholder = 'Select...' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-[#0d0d18] border border-indigo-500/40 rounded px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-400 w-full"
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.id || o} value={o.id || o}>{o.name || o}</option>
      ))}
    </select>
  );
}

const STATUSES = ['Pre Order', 'On Hand', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];

// ─── Carrier detection ────────────────────────────────────────────────────────
function detectCarrier(trackingNumber) {
  if (!trackingNumber) return null;
  const tn = trackingNumber.trim();
  // Amazon — TBA prefix
  if (/^TBA[0-9]+$/i.test(tn)) return { label: 'Amazon', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
  // UPS — starts with 1Z, 18 chars total
  if (/^1Z[0-9A-Z]{16}$/i.test(tn)) return { label: 'UPS', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  // FedEx — 12, 15, 20, or 22 digits
  if (/^[0-9]{12}$/.test(tn) || /^[0-9]{15}$/.test(tn) || /^[0-9]{20}$/.test(tn) || /^[0-9]{22}$/.test(tn)) return { label: 'FedEx', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
  // USPS — 94/93/92/95 prefix (20-22 digits), or international format (e.g. EA123456789US)
  if (/^(94|93|92|95)[0-9]{18,20}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  if (/^(70|14|23|03)[0-9]{14}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  if (/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  // DHL — JD prefix (eCommerce), or 10-digit number
  if (/^JD[0-9A-Z]+$/i.test(tn)) return { label: 'DHL', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  if (/^[0-9]{10}$/.test(tn)) return { label: 'DHL', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  // ONTRAC — C prefix + 14 digits
  if (/^C[0-9]{14}$/.test(tn)) return { label: 'OnTrac', color: 'bg-green-500/10 text-green-400 border-green-500/20' };
  // Generic fallback — show a neutral chip with a truncated number
  return { label: 'Track', color: 'bg-white/5 text-gray-400 border-white/10' };
}

const ALL_COLUMNS = [
  { key: 'date',     label: 'Date' },
  { key: 'product',  label: 'Product' },
  { key: 'vendor',   label: 'Store' },
  { key: 'platform', label: 'Place Sold' },
  { key: 'qty',      label: 'Qty' },
  { key: 'cost',     label: 'Cost' },
  { key: 'sale',     label: 'Sale' },
  { key: 'commission', label: 'Fees' },
  { key: 'profit',   label: 'Profit' },
  { key: 'cashback', label: 'Cashback' },
  { key: 'payment',  label: 'Payment' },
  { key: 'status',   label: 'Status' },
  { key: 'retail',   label: 'Retail Price' },
  { key: 'tax',      label: 'Tax' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'category', label: 'Category' },
  { key: 'tracking', label: 'Tracking' },
];
const DEFAULT_COLS = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true]));

// ─── Main Component ───────────────────────────────────────────────────────────
const Transactions = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: transactions = [], isLoading, refetch: refetchTransactions } = useInventory();
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const invalidate = useInvalidate();
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const stored = localStorage.getItem('txn_visible_cols');
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_COLS;
  });
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const stored = localStorage.getItem('txn_col_order');
      if (stored) return JSON.parse(stored);
    } catch {}
    return ALL_COLUMNS.map(c => c.key);
  });
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef(null);
  const tableScrollRef = useRef(null);
  const topScrollRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  // Keep the top phantom scroll div width in sync with the actual scroll content
  useLayoutEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setTableScrollWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync scroll position between top scrollbar and table
  const syncFromTop = useRef(false);
  const syncFromTable = useRef(false);
  const handleTopScroll = () => {
    if (syncFromTable.current) return;
    syncFromTop.current = true;
    if (tableScrollRef.current && topScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    syncFromTop.current = false;
  };
  const handleTableScroll = () => {
    if (syncFromTop.current) return;
    syncFromTable.current = true;
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
    syncFromTable.current = false;
  };

  useEffect(() => {
    localStorage.setItem('txn_visible_cols', JSON.stringify(visibleCols));
  }, [visibleCols]);

  useEffect(() => {
    localStorage.setItem('txn_col_order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  const moveColumn = (key, direction) => {
    setColumnOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };
  // Close column picker on outside click
  useEffect(() => {
    if (!colsOpen) return;
    const handler = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colsOpen]);

  // ─── Filter state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(location.state?.status || '');
  const [filterVendorId, setFilterVendorId] = useState('');
  const [filterPlatformId, setFilterPlatformId] = useState('');
  const [filterPaymentId, setFilterPaymentId] = useState('');
  const [filterDateRange, setFilterDateRange] = useState(location.state?.dateFilter || '');
  const [filterTxnType, setFilterTxnType] = useState(''); // '' | 'sale' | 'buy'
  const [dashCardScope] = useState(location.state?.cardScope || '');
  // Unified mode: 'All' | 'Cashout' | 'Marketplace'
  // Dashboard sends platformMode as 'Cashout'.
  const navMode = location.state?.platformMode;
  const [txnMode, setTxnMode] = useState(
    navMode === 'Cashout' ? 'Cashout' : navMode === 'Marketplace' ? 'Marketplace' : 'All'
  );


  // ─── Dashboard filter toast ───────────────────────────────────────────────────
  // Fires once on mount when the page is opened from a dashboard click with
  // pre-applied filters, so the user immediately knows what context they're in.
  useEffect(() => {
    const state = location.state;
    if (!state) return;

    const parts = [];
    const mode = state.platformMode;         // 'Cashout' | 'Marketplace'
    const status = state.status;             // e.g. 'PURCHASED'
    const date = state.dateFilter;           // '7 Days' | '30 Days' | 'YTD' | 'All Time'
    const scope = state.cardScope;           // 'sold' | 'all'

    if (mode)   parts.push(mode === 'Cashout' ? 'Cashout' : 'Marketplace');
    if (status) parts.push(status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' '));
    if (scope === 'sold') parts.push('Sales only');

    const dateLabel = date === '7 Days'  ? 'last 7 days'
                    : date === '30 Days' ? 'last 30 days'
                    : date === 'YTD'     ? 'year to date'
                    : date === 'All Time'? 'all time'
                    : null;

    if (parts.length === 0 && !dateLabel) return; // nothing dashboard-specific, skip toast

    const subject = parts.length > 0 ? parts.join(' · ') : 'All transactions';
    const suffix  = dateLabel ? ` · ${dateLabel}` : '';

    toast.info(`Viewing: ${subject}${suffix}`, {
      id: 'dashboard-filter-toast',
      duration: 10000,
      position: 'top-center',
      closeButton: true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  const removeTxn = async (rawId) => {
    try {
      const res = await apiFetch(`/api/inventory/${rawId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        setConfirmDeleteId(null);
        toast.success('Transaction deleted.');
        await invalidate.inventory();
      } else {
        const err = await res.json();
        console.error('Delete failed:', err);
        toast.error('Delete failed: ' + (err.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Delete error: ' + err.message);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    // Use the raw IDs stored on the row directly instead of reverse-looking up by name
    setEditData({
      product: row.product,
      vendorId: row.vendorId || '',
      platformId: row.platformId || '',
      qty: row.qty,
      cost: row.rawCost,
      sale: row.rawSale,
      status: row.status,
      isSale: row.isSale,
      rawId: row.rawId,
      saleId: row.saleId,
      rawQtyOnHand: row.rawQtyOnHand,
      paymentMethodId: row.paymentMethodId || '',
      tracking_number: row.tracking_number || '',
      commission_fee: row.rawCommission ?? '',
      sale_date: row.rawSaleDate ? new Date(row.rawSaleDate).toISOString().split('T')[0] : '',
      payout_date: row.rawPayoutDate ? new Date(row.rawPayoutDate).toISOString().split('T')[0] : '',
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditData({}); };

  // Helper: parse error response and show an informative toast, logging full detail to console
  const handleSaveError = (label, status, resJson) => {
    const details = resJson?.details;
    const summary = resJson?.error || `HTTP ${status}`;
    if (details?.length) {
      const fieldErrors = details.map(d => `${d.path}: ${d.message}`).join(' · ');
      console.error(`[saveEdit] ${label} failed (${status}):`, resJson);
      toast.error(`${label} failed — ${fieldErrors}`, { duration: 8000 });
    } else {
      console.error(`[saveEdit] ${label} failed (${status}):`, resJson);
      toast.error(`${label} failed: ${summary}`);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      let res;
      if (editData.isSale) {
        const parsedSale = parseFloat(editData.sale);
        const salePayload = {
          quantity: parseInt(editData.qty) || 1,
          status: editData.status,
          platform_id: editData.platformId || null,
          unit_price: !isNaN(parsedSale) ? parsedSale : undefined,
          commission_fee: parseFloat(editData.commission_fee) || 0,
          sale_date: editData.sale_date ? new Date(editData.sale_date).toISOString() : undefined,
          payout_date: editData.payout_date ? new Date(editData.payout_date).toISOString() : undefined,
        };
        // payment method and tracking live on inventory, update them separately
        const invRes = await apiFetch(`/api/inventory/${editData.rawId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            payment_method_id: editData.paymentMethodId || null,
            vendor_id: editData.vendorId || null,
            tracking_number: editData.tracking_number || null,
          })
        });
        if (!invRes.ok) {
          const resJson = await invRes.json().catch(() => ({}));
          handleSaveError('Inventory update', invRes.status, resJson);
          return;
        }
        res = await apiFetch(`/api/sales/${editData.saleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(salePayload)
        });
      } else {
        const newQty = parseInt(editData.qty) || 1;
        const parsedSale = parseFloat(editData.sale);
        const hasSalePrice = !isNaN(parsedSale) && parsedSale > 0;
        // Auto-set status to SOLD if a sale price or platform was provided
        const resolvedStatus = (hasSalePrice || editData.platformId) ? 'SOLD' : editData.status;
        const invPayload = {
          product_name: editData.product,
          unit_purchase_cost: parseFloat(editData.cost) || 0,
          qty_purchased: newQty,
          // if a sale is being created, set qty_on_hand to newQty first so the POST can deduct it
          qty_on_hand: newQty,
          status: resolvedStatus,
          vendor_id: editData.vendorId || null,
          payment_method_id: editData.paymentMethodId || null,
          tracking_number: editData.tracking_number || null,
        };
        res = await apiFetch(`/api/inventory/${editData.rawId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(invPayload)
        });
        if (!res.ok) {
          const resJson = await res.json().catch(() => ({}));
          handleSaveError('Inventory update', res.status, resJson);
          return;
        }
        // If user entered a sale price, create a sale record (POST deducts qty_on_hand)
        if (hasSalePrice) {
          const saleRes = await apiFetch(`/api/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              inventory_id: editData.rawId,
              platform_id: editData.platformId || null,
              quantity: newQty,
              unit_price: parsedSale,
              commission_fee: 0,
              sale_date: new Date().toISOString(),
              status: resolvedStatus || 'SOLD',
            })
          });
          if (!saleRes.ok) {
            const errJson = await saleRes.json().catch(() => ({}));
            handleSaveError('Sale creation', saleRes.status, errJson);
            return;
          }
        }
        await invalidate.inventory();
        toast.success('Transaction saved.');
        setEditingId(null);
        return;
      }
      if (!res.ok) {
        const resJson = await res.json().catch(() => ({}));
        handleSaveError('Sale update', res.status, resJson);
        return;
      }
      await invalidate.inventory();
      toast.success('Transaction saved.');
      setEditingId(null);
    } catch (err) {
      console.error('[saveEdit] unexpected error:', err);
      toast.error('Save error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Build rows
  const rows = [];

  // Returns the effective cashback rate for an inventory item.
  // 1. Parse category_rates (comes as JSON string from inventory API).
  // 2. If no stored rates, fall back to preset card data via preset_card_id.
  // 3. Match vendor name against category rates (case-insensitive substring).
  // 4. If no match, use the card's base rate.
  const getEffectiveCashbackRate = (inv) => {
    const pm = inv.payment_method;
    if (!pm) return 0;

    const vendorName = inv.vendor?.name || '';

    // Parse stored rates — inventory API returns raw JSON string, not parsed array
    let rates = [];
    if (Array.isArray(pm.category_rates)) {
      rates = pm.category_rates;
    } else if (typeof pm.category_rates === 'string' && pm.category_rates) {
      try { rates = JSON.parse(pm.category_rates); } catch { rates = []; }
    }

    // If no stored rates but card has a preset_card_id, pull from PRESET_CARDS
    if (rates.length === 0 && pm.preset_card_id) {
      const preset = PRESET_CARDS.find(c => c.id === pm.preset_card_id);
      if (preset?.categoryRates?.length) rates = preset.categoryRates;
    }

    if (vendorName && rates.length > 0) {
      const today = new Date();
      const name = vendorName.toLowerCase();
      const match = rates.find(cr => {
        if (cr.expires && new Date(cr.expires) < today) return false;
        return name.includes(cr.store.toLowerCase()) || cr.store.toLowerCase().includes(name);
      });
      if (match) return match.rate;
    }

    return pm.default_cashback_rate || 0;
  };

  transactions.forEach(inv => {
    const cost = (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0);
    const unitTax = inv.qty_purchased > 0 ? inv.sales_tax / inv.qty_purchased : 0;
    const unitInboundShipping = inv.qty_purchased > 0 ? inv.shipping_cost_inbound / inv.qty_purchased : 0;
    const unitFees = inv.qty_purchased > 0 ? (inv.fees || 0) / inv.qty_purchased : 0;

    // Always show a purchase row if there is unsold stock on hand, OR if the
    // item has no sales at all (qty_on_hand may be 0 due to a data issue — we
    // never want to silently hide a transaction the user recorded).
    if (inv.qty_on_hand > 0 || !inv.sales?.length) {
      const displayQty = inv.qty_on_hand > 0 ? inv.qty_on_hand : inv.qty_purchased;
      const unsoldCost = (inv.unit_purchase_cost + unitTax + unitInboundShipping + unitFees) * displayQty;
      const effectiveRate = getEffectiveCashbackRate(inv);
      rows.push({
        id: inv.id + '_unsold',
        rawId: inv.id,
        saleId: null,
        isSale: false,
        date: inv.purchase_date ? new Date(inv.purchase_date).toLocaleDateString() : '—',
        rawDate: inv.purchase_date || null,
        product: inv.product_name,
        vendor: inv.vendor?.name || 'Direct',
        vendorId: inv.vendor_id || '',
        platform: '',
        platformId: '',
        qty: displayQty,
        rawQtyOnHand: inv.qty_on_hand,
        rawCost: inv.unit_purchase_cost,
        cost: unsoldCost,
        rawSale: null,
        sale: null,
        profit: null,
        cashback: unsoldCost * (effectiveRate / 100),
        payment: inv.payment_method?.name || '',
        paymentMethodId: inv.payment_method_id || '',
        status: inv.status || 'PURCHASED',
        tax: unitTax * displayQty,
        shipping: unitInboundShipping * displayQty,
        category: inv.category || null,
        tracking_number: inv.tracking_number || null,
      });
    }

    if (inv.sales?.length > 0) {
      inv.sales.forEach(sale => {
        // Proportionally allocate tax, shipping, and fees based on qty sold vs qty purchased
        const allocatedTax = unitTax * sale.quantity;
        const allocatedShipping = unitInboundShipping * sale.quantity;
        const allocatedFees = unitFees * sale.quantity;
        const totalUnitCost = (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees;
        const effectiveRate = getEffectiveCashbackRate(inv);
        const saleCashback = totalUnitCost * (effectiveRate / 100);
        const profit = (sale.unit_price * sale.quantity) - sale.commission_fee - totalUnitCost + saleCashback;
        rows.push({
          id: sale.id,
          rawId: inv.id,
          saleId: sale.id,
          isSale: true,
          date: sale.sale_date ? new Date(sale.sale_date).toLocaleDateString() : '—',
          rawDate: sale.sale_date || null,
          product: inv.product_name,
          vendor: inv.vendor?.name || 'Direct',
          vendorId: inv.vendor_id || '',
          platform: sale.platform?.name || '',
          platformId: sale.platform_id || '',
          qty: sale.quantity,
          rawQtyOnHand: inv.qty_on_hand,
          rawCost: inv.unit_purchase_cost,
          cost: totalUnitCost,
          rawSale: sale.unit_price,
          sale: sale.unit_price * sale.quantity,
          profit,
          cashback: totalUnitCost * (effectiveRate / 100),
          payment: inv.payment_method?.name || '',
          paymentMethodId: inv.payment_method_id || '',
          status: sale.status || 'SOLD',
          tax: allocatedTax,
          shipping: allocatedShipping,
          category: inv.category || null,
          tracking_number: inv.tracking_number || null,
          rawCommission: sale.commission_fee,
          rawSaleDate: sale.sale_date,
          rawPayoutDate: sale.payout_date,
        });
      });
    }
  });

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  // ─── Dashboard date cutoff ───────────────────────────────────────────────────
  const dashDateFrom = (() => {
    if (!filterDateRange || filterDateRange === 'All Time') return null;
    const todayUTC = new Date().toISOString().slice(0, 10);
    if (filterDateRange === '7 Days') {
      const d = new Date(todayUTC + 'T00:00:00.000Z');
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    }
    if (filterDateRange === '30 Days') {
      const d = new Date(todayUTC + 'T00:00:00.000Z');
      d.setUTCDate(d.getUTCDate() - 30);
      return d;
    }
    if (filterDateRange === 'YTD') {
      return new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00.000Z`);
    }
    return null;
  })();

  // ─── Apply filters ───────────────────────────────────────────────────────────
  const filteredRows = rows.filter(row => {
    if (search) {
      const q = search.toLowerCase();
      if (!row.product.toLowerCase().includes(q) && !row.vendor.toLowerCase().includes(q) && !row.platform.toLowerCase().includes(q))
        return false;
    }
    if (filterStatus && row.status?.toUpperCase() !== filterStatus) return false;
    if (filterVendorId && row.vendorId !== filterVendorId) return false;
    if (filterPlatformId && row.platformId !== filterPlatformId) return false;
    if (filterPaymentId && row.paymentMethodId !== filterPaymentId) return false;
    if (dashDateFrom) {
      const rowDate = new Date(row.rawDate || row.date);
      if (rowDate < dashDateFrom) return false;
    }
    if (dashCardScope === 'sold' && !row.isSale) return false;
    if (filterTxnType === 'sale' && !row.isSale) return false;
    if (filterTxnType === 'buy' && row.isSale) return false;
    // Toolbar mode filter (All / Cashout / Marketplace)
    if (txnMode === 'Cashout') {
      if (!row.isSale) return false;
      const platform = platforms.find(p => p.id === row.platformId);
      if (!platform || platform.type !== 'Cashout') return false;
    } else if (txnMode === 'Marketplace') {
      if (!row.isSale) return false;
      const platform = platforms.find(p => p.id === row.platformId);
      if (!platform || platform.type !== 'Marketplace') return false;
    }
    return true;
  });

  // ─── Summary stats derived from filteredRows (respond to all active filters) ────
  const totalCostSum    = filteredRows.reduce((s, r) => s + (r.cost || 0), 0);
  const totalProfitSum  = filteredRows.filter(r => r.isSale).reduce((s, r) => s + (r.profit || 0), 0);
  const listedCount     = filteredRows.filter(r => !r.isSale).reduce((s, r) => s + r.qty, 0);
  const soldCount       = filteredRows.filter(r => r.isSale).reduce((s, r) => s + r.qty, 0);

  // Unique vendor/platform options derived from actual rows
  const vendorOptions = [...new Map(
    rows.filter(r => r.vendorId).map(r => [r.vendorId, { id: r.vendorId, name: r.vendor }])
  ).values()];
  const platformOptions = [...new Map(
    rows.filter(r => r.platformId).map(r => [r.platformId, { id: r.platformId, name: r.platform }])
  ).values()];

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) return <PageLoader variant="table" />;

  return (
    <>
    <div className="container max-w-full mx-auto px-4 py-6 lg:px-8 lg:py-8 h-full overflow-y-auto">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Transactions</h1>
          <p className="text-sm text-gray-400">Track and manage your purchases by mode</p>
        </div>
        {(txnMode !== 'All' || filterDateRange || dashCardScope) && (
          <div className="flex items-center gap-2">
            {txnMode !== 'All' && (
              <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                txnMode === 'Cashout'
                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
              }`}>
                {txnMode === 'Cashout' ? <Zap className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                {txnMode} only
              </span>
            )}
            {filterDateRange && (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
                <Calendar className="w-3 h-3" /> {filterDateRange}
              </span>
            )}
            {dashCardScope === 'sold' && (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-300 text-xs font-medium">
                Sales only
              </span>
            )}
            <button
              onClick={() => navigate('/transactions')}
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400 text-xs hover:text-gray-200 hover:bg-white/10 transition-colors"
              title="Clear all filters"
            >
              <X className="w-3 h-3" /> Clear all
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5 w-max">
          {[['All', List, 'text-purple-400'], ['Cashout', Tag, 'text-yellow-400'], ['Marketplace', Globe, 'text-blue-400']].map(([mode, Icon, iconColor]) => {
            const active = txnMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setTxnMode(mode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'text-white bg-white/[0.08] border border-white/10 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? iconColor : ''}`} />
                {mode}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div ref={colsRef} className="relative">
            <button
              onClick={() => setColsOpen(v => !v)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${colsOpen ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-white/10 bg-white/[0.02] text-gray-300 hover:bg-white/5'}`}
            >
              <Columns className="w-3.5 h-3.5" /> Columns
            </button>
            {colsOpen && (
              <div className="absolute top-full right-0 mt-1.5 z-50 w-52 rounded-xl bg-[#16181d] border border-white/10 shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Toggle Columns</p>
                  <button
                    onClick={() => setVisibleCols(DEFAULT_COLS)}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                  >Reset</button>
                </div>
                <div className="space-y-0.5">
                  {columnOrder.map((colKey, index) => {
                    const col = ALL_COLUMNS.find(c => c.key === colKey);
                    if (!col) return null;
                    return (
                      <div key={col.key} className="flex items-center justify-between px-1.5 py-1 hover:bg-white/5 rounded group">
                        <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={visibleCols[col.key]}
                            onChange={e => setVisibleCols(v => ({ ...v, [col.key]: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-indigo-500 cursor-pointer"
                          />
                          <span className="text-xs text-gray-300 group-hover:text-white transition-colors">{col.label}</span>
                        </label>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => moveColumn(col.key, -1)}
                            disabled={index === 0}
                            className="p-0.5 hover:bg-white/10 rounded text-gray-500 hover:text-indigo-400 transition-colors disabled:opacity-30 disabled:cursor-default"
                            title="Move column left"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => moveColumn(col.key, 1)}
                            disabled={index === columnOrder.length - 1}
                            className="p-0.5 hover:bg-white/10 rounded text-gray-500 hover:text-indigo-400 transition-colors disabled:opacity-30 disabled:cursor-default"
                            title="Move column right"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button 
            onClick={() => toast('Coming Soon')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-gray-300 text-xs font-medium hover:bg-white/5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button 
            onClick={() => toast('Coming Soon')}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/[0.02] text-gray-300 hover:bg-white/5 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        <div className="rounded-xl border border-white/10 bg-[#16181d] p-3 pl-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-2"><Package className="w-3.5 h-3.5" /> Total Items</div>
          <div className="text-xl font-bold text-white">{filteredRows.length}</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 pl-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-amber-500/80 text-xs font-medium mb-2"><Tag className="w-3.5 h-3.5" /> Active Listed</div>
          <div className="text-xl font-bold text-amber-400">{listedCount}</div>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 pl-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-green-500/80 text-xs font-medium mb-2"><Check className="w-3.5 h-3.5" /> Sold / Done</div>
          <div className="text-xl font-bold text-green-400">{soldCount}</div>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 pl-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-red-500/80 text-xs font-medium mb-2"><DollarSign className="w-3.5 h-3.5" /> Total Cost</div>
          <div className="text-xl font-bold text-red-400">${totalCostSum.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 pl-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 text-emerald-500/80 text-xs font-medium mb-2"><DollarSign className="w-3.5 h-3.5" /> Total Profit</div>
          <div className="text-xl font-bold text-emerald-400">${totalProfitSum.toFixed(2)}</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card p-3 mb-6 bg-[#0f1115]">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search + Sale/Buy toggle */}
          <div className="flex items-center gap-2 flex-1">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search products, stores, platforms..."
                className="w-full bg-[#16181d] border border-white/5 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
            {/* Sale / Buy type filter */}
            <div className="flex gap-0.5 p-0.5 rounded-lg bg-[#16181d] border border-white/5 shrink-0">
              {[['', 'All'], ['sale', 'Sale'], ['buy', 'Buy']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setFilterTxnType(val)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    filterTxnType === val
                      ? val === 'sale'
                        ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                        : val === 'buy'
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                        : 'bg-white/[0.08] text-white border border-white/10'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Dropdowns */}
          <div className="flex flex-wrap gap-2 [&>select]:flex-1 [&>select]:min-w-[130px] sm:[&>select]:flex-none sm:[&>select]:min-w-0">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-[#16181d] border border-white/5 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-white/20 appearance-none"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterVendorId}
              onChange={e => setFilterVendorId(e.target.value)}
              className="bg-[#16181d] border border-white/5 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-white/20 appearance-none"
            >
              <option value="">All Vendors</option>
              {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select
              value={filterPlatformId}
              onChange={e => setFilterPlatformId(e.target.value)}
              className="bg-[#16181d] border border-white/5 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-white/20 appearance-none"
            >
              <option value="">All Platforms</option>
              {platformOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={filterPaymentId}
              onChange={e => setFilterPaymentId(e.target.value)}
              className="bg-[#16181d] border border-white/5 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-white/20 appearance-none"
            >
              <option value="">All Payment Methods</option>
              {paymentMethods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* Date Range filter */}
            <select
              value={filterDateRange}
              onChange={e => setFilterDateRange(e.target.value)}
              className={`border rounded-lg px-3 py-2 text-sm focus:outline-none appearance-none transition-colors ${
                filterDateRange
                  ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 focus:border-indigo-400'
                  : 'bg-[#16181d] border-white/5 text-gray-300 focus:border-white/20'
              }`}
            >
              <option value="">All Time</option>
              <option value="7 Days">Last 7 Days</option>
              <option value="30 Days">Last 30 Days</option>
              <option value="YTD">Year to Date</option>
            </select>
            {(search || filterStatus || filterVendorId || filterPlatformId || filterPaymentId || filterDateRange || filterTxnType) && (
              <button
                onClick={() => { setSearch(''); setFilterStatus(''); setFilterVendorId(''); setFilterPlatformId(''); setFilterPaymentId(''); setFilterDateRange(''); setFilterTxnType(''); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk Actions Banner */}
      {selectedIds.length > 0 && (
        <div className="card mb-6 bg-indigo-900/20 border border-indigo-500/30 p-3 flex items-center justify-between">
          <span className="text-sm font-medium text-indigo-300">
            {selectedIds.length} item{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} items?`)) return;
                setSaving(true);
                let errors = 0;
                for (const id of selectedIds) {
                  const row = filteredRows.find(r => r.id === id);
                  if (!row) continue;
                  try {
                    const res = await apiFetch(`/api/inventory/${row.rawId}`, {
                      method: 'DELETE',
                      credentials: 'include'
                    });
                    if (!res.ok) errors++;
                  } catch (e) {
                    errors++;
                  }
                }
                setSaving(false);
                if (errors > 0) toast.error(`Failed to delete ${errors} items.`);
                else toast.success(`Successfully deleted ${selectedIds.length} items.`);
                setSelectedIds([]);
                await invalidate.inventory();
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors border border-red-500/20"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Mobile card list — shown only on small screens */}
      <div className="md:hidden space-y-2 mb-4">
        {filteredRows.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            {isLoading ? 'Loading transactions...' : rows.length === 0 ? 'No transactions recorded yet.' : 'No results match your filters.'}
          </div>
        )}
        {filteredRows.map(row => (
          <div
            key={row.id}
            className="card bg-[#0f1115] p-4 rounded-xl border border-white/[0.06] flex flex-col gap-2"
          >
            {/* Top row: type badge + product + expand */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {row.isSale
                  ? <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-green-500/10 text-green-400 border-green-500/20">SALE</span>
                  : <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-blue-500/10 text-blue-400 border-blue-500/20">BUY</span>
                }
                <p className="text-sm font-semibold text-gray-100 truncate">{row.product}</p>
                <ProductNoteButton productName={row.product} />
              </div>
              <button
                onClick={() => setExpandedRow(row)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Middle row: date · vendor · platform · status */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {row.date && <span>{row.date}</span>}
              {row.vendor && <span>{row.vendor}</span>}
              {row.platform && <span className="text-gray-400">{row.platform}</span>}
              <StatusBadge status={row.status} />
            </div>

            {/* Bottom row: cost → sale → profit */}
            <div className="flex items-center gap-4 pt-1 border-t border-white/[0.04]">
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Cost</p>
                <p className="text-sm font-semibold text-blue-400">${Number.isFinite(row.cost) ? row.cost.toFixed(2) : '0.00'}</p>
              </div>
              {row.sale != null && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Sale</p>
                  <p className="text-sm font-semibold text-green-400">${row.sale.toFixed(2)}</p>
                </div>
              )}
              {Number.isFinite(row.profit) && (
                <div className="ml-auto">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5 text-right">Profit</p>
                  <p className={`text-sm font-bold ${row.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.profit >= 0 ? '+' : ''}${row.profit.toFixed(2)}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => startEdit(row)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 transition-colors"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
              <button
                onClick={() => {
                  if (confirmDeleteId === row.rawId) {
                    removeTxn(row.rawId);
                  } else {
                    setConfirmDeleteId(row.rawId);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  confirmDeleteId === row.rawId
                    ? 'bg-red-600 hover:bg-red-500 text-white border-red-600'
                    : 'bg-white/5 hover:bg-red-500/10 text-gray-500 hover:text-red-400 border-white/10'
                }`}
              >
                <Trash2 className="w-3 h-3" />
                {confirmDeleteId === row.rawId ? 'Confirm' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Top scrollbar mirror — hidden on mobile, shown md+ */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="hidden md:block overflow-x-auto mb-1 table-scrollbar"
        style={{ height: '12px' }}
      >
        <div style={{ width: tableScrollWidth, height: '1px' }} />
      </div>

      {/* Table — hidden on mobile, shown md+ */}
      <div ref={tableScrollRef} onScroll={handleTableScroll} className="hidden md:block card overflow-x-auto bg-[#0f1115] table-scrollbar">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
              <th className="px-4 py-3.5 w-10">
                <input 
                  type="checkbox" 
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-indigo-500" 
                  checked={filteredRows.length > 0 && selectedIds.length === filteredRows.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(filteredRows.map(r => r.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                />
              </th>
              <th className="px-2 py-3.5 w-8"></th>
              <th className="px-2 py-3.5 w-16"></th>
              {columnOrder.map((colKey, index) => {
                if (!visibleCols[colKey]) return null;
                const colDef = ALL_COLUMNS.find(c => c.key === colKey);
                if (!colDef) return null;
                
                const minWidths = {
                  date: 'min-w-[100px]', product: 'min-w-40', vendor: 'min-w-[120px]', platform: 'min-w-[120px]',
                  qty: 'w-16 text-center', cost: 'min-w-[90px]', sale: 'min-w-[90px]', commission: 'min-w-[90px]', profit: 'min-w-[90px]',
                  cashback: 'min-w-[90px]', payment: 'min-w-[160px]', status: 'min-w-[130px]', retail: 'min-w-[100px]',
                  tax: 'min-w-[90px]', shipping: 'min-w-[90px]', category: 'min-w-[110px]', tracking: 'min-w-[120px]'
                };
                
                return (
                  <th key={colKey} className={`px-4 py-3.5 ${minWidths[colKey] || ''}`}>
                    {colDef.label}
                  </th>
                );
              })}
              <th className="px-4 py-3.5 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.02]">
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={3 + Object.values(visibleCols).filter(Boolean).length} className="px-4 py-8 text-center text-gray-500 text-sm">
                  {isLoading ? 'Loading transactions...' : rows.length === 0 ? 'No transactions recorded yet.' : 'No results match your filters.'}
                </td>
              </tr>
            )}
            {filteredRows.map((row) => {
              const isEditing = editingId === row.id;
              return (
                <tr
                  key={row.id}
                  onMouseLeave={() => { if (confirmDeleteId === row.rawId) setConfirmDeleteId(null); }}
                  className={`transition-colors group ${
                    isEditing
                      ? 'bg-indigo-950/20 border-l-2 border-indigo-500/50'
                      : 'hover:bg-white/[0.025] border-l-2 border-transparent'
                  }`}
                >
                  <td className="px-4 py-3.5">
                    <input 
                      type="checkbox" 
                      className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-indigo-500" 
                      checked={selectedIds.includes(row.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(prev => [...prev, row.id]);
                        } else {
                          setSelectedIds(prev => prev.filter(id => id !== row.id));
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-3.5 text-gray-600">
                    <Maximize2
                      className="w-3.5 h-3.5 cursor-pointer hover:text-gray-300 transition-colors"
                      onClick={() => setExpandedRow(row)}
                    />
                  </td>
                  <td className="px-2 py-3.5">
                    {row.isSale
                      ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-green-500/10 text-green-400 border-green-500/20">SALE</span>
                      : <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-blue-500/10 text-blue-400 border-blue-500/20">BUY</span>
                    }
                  </td>

                  {/* Dynamic Columns */}
                  {columnOrder.map(colKey => {
                    if (!visibleCols[colKey]) return null;
                    switch(colKey) {
                      case 'date': return (
                        <td key="date" className="px-4 py-3.5">
                          {isEditing && editData.isSale ? (
                            <input type="date" value={editData.sale_date || ''} onChange={e => setEditData(d => ({ ...d, sale_date: e.target.value }))} className="bg-[#0d0d18] border border-indigo-500/40 rounded px-1.5 py-0.5 text-xs text-white [color-scheme:dark]" title="Sale Date" />
                          ) : (
                            <span className="text-xs text-gray-400 bg-white/[0.04] px-2 py-1 rounded-md whitespace-nowrap">{row.date}</span>
                          )}
                        </td>
                      );
                      case 'product': return (
                        <td key="product" className="px-2 py-3.5 min-w-40">
                          {isEditing ? (
                            <EditInput value={editData.product} onChange={v => setEditData(d => ({ ...d, product: v }))} className="min-w-[180px]" />
                          ) : (
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-semibold text-gray-100 leading-tight">{row.product}</p>
                              <ProductNoteButton productName={row.product} />
                            </div>
                          )}
                        </td>
                      );
                      case 'vendor': return (
                        <td key="vendor" className="px-4 py-3.5 min-w-[120px]">
                          {isEditing ? (
                            <EditSelect
                              value={editData.vendorId}
                              onChange={v => setEditData(d => ({ ...d, vendorId: v }))}
                              options={platforms.filter(p => p.type === 'Vendor')}
                              placeholder="Select vendor..."
                            />
                          ) : (
                            <span className="text-xs text-gray-300">{row.vendor}</span>
                          )}
                        </td>
                      );
                      case 'platform': return (
                        <td key="platform" className="px-4 py-3.5 min-w-[120px]">
                          {isEditing ? (
                            <EditSelect
                              value={editData.platformId}
                              onChange={v => setEditData(d => ({ ...d, platformId: v }))}
                              options={platforms.filter(p => p.type === 'Cashout' || p.type === 'Marketplace')}
                              placeholder="Select platform..."
                            />
                          ) : (
                            <span className="text-xs text-gray-400">{row.platform || '—'}</span>
                          )}
                        </td>
                      );
                      case 'qty': return (
                        <td key="qty" className="px-4 py-3.5 w-16 text-center">
                          {isEditing ? (
                            <EditInput type="number" value={editData.qty} onChange={v => setEditData(d => ({ ...d, qty: v }))} className="w-14 text-center" />
                          ) : (
                            <span className="text-sm font-semibold text-gray-200">{row.qty}</span>
                          )}
                        </td>
                      );
                      case 'cost': return (
                        <td key="cost" className="px-4 py-3.5">
                          {isEditing ? (
                            <div>
                              <EditInput type="number" value={editData.cost} onChange={v => setEditData(d => ({ ...d, cost: v }))} className="w-24" />
                              <p className="text-[10px] text-gray-600 mt-0.5">per unit</p>
                            </div>
                          ) : (
                            <span className="text-sm font-semibold text-blue-400">${Number.isFinite(row.cost) ? row.cost.toFixed(2) : '0.00'}</span>
                          )}
                        </td>
                      );
                      case 'sale': return (
                        <td key="sale" className="px-4 py-3.5">
                          {isEditing && editData.isSale ? (
                            <div>
                              <EditInput type="number" value={editData.sale ?? ''} onChange={v => setEditData(d => ({ ...d, sale: v }))} className="w-24" />
                              <p className="text-[10px] text-gray-600 mt-0.5">per unit</p>
                            </div>
                          ) : (
                            <span className="text-sm font-semibold text-green-400">{row.sale ? `$${row.sale.toFixed(2)}` : <span className="text-gray-600 font-normal">—</span>}</span>
                          )}
                        </td>
                      );
                      case 'commission': return (
                        <td key="commission" className="px-4 py-3.5">
                          {isEditing && editData.isSale ? (
                            <EditInput type="number" value={editData.commission_fee} onChange={v => setEditData(d => ({ ...d, commission_fee: v }))} className="w-20 text-red-300" />
                          ) : (
                            <span className="text-sm font-semibold text-red-400">{row.rawCommission != null ? `-$${row.rawCommission.toFixed(2)}` : <span className="text-gray-600 font-normal">—</span>}</span>
                          )}
                        </td>
                      );
                      case 'profit': return (
                        <td key="profit" className="px-4 py-3.5">
                          {Number.isFinite(row.profit) ? (
                            <span className={`text-sm font-bold ${row.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {row.profit >= 0 ? '+' : ''}${row.profit.toFixed(2)}
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                      );
                      case 'cashback': return (
                        <td key="cashback" className="px-4 py-3.5">
                          <span className="text-xs font-medium text-pink-400">${Number.isFinite(row.cashback) ? row.cashback.toFixed(2) : '0.00'}</span>
                        </td>
                      );
                      case 'payment': return (
                        <td key="payment" className="px-4 py-3.5">
                          {isEditing ? (
                            <EditSelect
                              value={editData.paymentMethodId}
                              onChange={v => setEditData(d => ({ ...d, paymentMethodId: v }))}
                              options={paymentMethods}
                              placeholder="Select card..."
                            />
                          ) : (
                            <span className="text-xs text-gray-300">{row.payment}</span>
                          )}
                        </td>
                      );
                      case 'status': return (
                        <td key="status" className="px-4 py-3.5 min-w-[130px]">
                          {isEditing ? (
                            <EditSelect
                              value={editData.status}
                              onChange={v => setEditData(d => ({ ...d, status: v }))}
                              options={STATUSES.map(s => ({ id: s, name: s }))}
                              placeholder=""
                            />
                          ) : <StatusBadge status={row.status} />}
                        </td>
                      );
                      case 'retail': return (
                        <td key="retail" className="px-4 py-3.5">
                          {row.rawSale != null
                            ? <span className="text-xs font-medium text-gray-300">${row.rawSale.toFixed(2)}</span>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                      );
                      case 'tax': return (
                        <td key="tax" className="px-4 py-3.5">
                          <span className="text-xs font-medium text-amber-400">${(Number.isFinite(row.tax) ? row.tax : 0).toFixed(2)}</span>
                        </td>
                      );
                      case 'shipping': return (
                        <td key="shipping" className="px-4 py-3.5">
                          <span className="text-xs font-medium text-sky-400">${(Number.isFinite(row.shipping) ? row.shipping : 0).toFixed(2)}</span>
                        </td>
                      );
                      case 'category': return (
                        <td key="category" className="px-4 py-3.5">
                          {row.category
                            ? <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 text-gray-400 border border-white/10">{row.category}</span>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                      );
                      case 'tracking': return (
                        <td key="tracking" className="px-4 py-3.5">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editData.tracking_number || ''}
                              onChange={e => setEditData(d => ({ ...d, tracking_number: e.target.value }))}
                              placeholder="Tracking #"
                              className="bg-[#0d0d18] border border-indigo-500/40 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-400 w-28 truncate"
                            />
                          ) : (() => {
                            const carrier = detectCarrier(row.tracking_number);
                            if (!carrier) return <span className="text-gray-600">—</span>;
                            return (
                              <button
                                type="button"
                                title={`Copy: ${row.tracking_number}`}
                                onClick={() => navigator.clipboard.writeText(row.tracking_number)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border cursor-pointer hover:opacity-80 transition-opacity ${carrier.color}`}
                              >
                                {carrier.label}
                              </button>
                            );
                          })()}
                        </td>
                      );
                      default: return null;
                    }
                  })}

                  {/* Actions */}
                  <td className="px-4 py-3.5">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          title="Save changes"
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          title="Cancel"
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(row)}
                          title="Edit row"
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirmDeleteId === row.rawId) {
                              removeTxn(row.rawId);
                            } else {
                              setConfirmDeleteId(row.rawId);
                            }
                          }}
                          title={confirmDeleteId === row.rawId ? 'Click again to confirm delete' : 'Delete'}
                          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-lg transition-colors text-xs font-medium ${
                            confirmDeleteId === row.rawId
                              ? 'bg-red-600 hover:bg-red-500 text-white'
                              : 'hover:bg-red-500/10 text-gray-500 hover:text-red-400'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {confirmDeleteId === row.rawId && <span>Confirm</span>}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 px-2 pb-10">
        <div className="text-xs text-gray-500 font-medium">
          Showing {filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ''} records
        </div>
        <div className="flex items-center gap-3">
          <button className="w-7 h-7 flex items-center justify-center rounded border border-white/5 bg-[#16181d] text-gray-500 hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400 font-medium">Page 1 of 1</span>
          <button className="w-7 h-7 flex items-center justify-center rounded border border-white/5 bg-[#16181d] text-gray-500 hover:bg-white/5 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    {/* Transaction Detail Modal */}
    {expandedRow && (
      <TransactionDetailModal
        row={expandedRow}
        platforms={platforms}
        paymentMethods={paymentMethods}
        onClose={() => setExpandedRow(null)}
        onSaved={refetchTransactions}
      />
    )}
    </>
  );
};

export default Transactions;
