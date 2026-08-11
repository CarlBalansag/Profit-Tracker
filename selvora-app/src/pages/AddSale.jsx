import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Package, DollarSign, Search, Check, Store, Globe, Calendar, CreditCard, StickyNote
} from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useInventory, usePlatforms, useInvalidate, apiFetch, useProductNote, useProductNoteMutations } from '../hooks/useApi';

const AddSale = () => {
  const navigate = useNavigate();
  const { data: rawInventory = [], isLoading: inventoryLoading } = useInventory();
  const { data: platforms = [], isLoading: platformsLoading } = usePlatforms();
  const invalidate = useInvalidate();
  const isLoading = inventoryLoading || platformsLoading;
  // Only items with stock available
  const inventory = rawInventory.filter(i => i.qty_on_hand > 0);

  const [selectedItem, setSelectedItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saleTab, setSaleTab] = useState('cashout');

  const [formData, setFormData] = useState({
    platform_id: '',
    quantity: 1,
    unit_price: '',
    commission_fee: '',
    sale_shipping: '',
    sale_date: new Date().toISOString().split('T')[0],
    payout_date: '',
    taxable: true,
    sale_tax_collected: '',
    customer_tax_exempt: false,
    exemption_type: '',
    note: '',
  });

  const noteAutoFilledRef = useRef(false);

  // Note hooks — keyed to the selected item's product name
  const { data: noteData } = useProductNote(selectedItem?.product_name);
  const { upsert: upsertNote, remove: removeNote } = useProductNoteMutations(selectedItem?.product_name);

  // Auto-populate note field when a selected item has an existing note
  useEffect(() => {
    if (!selectedItem) {
      noteAutoFilledRef.current = false;
      return;
    }
    if (noteData?.note && !noteAutoFilledRef.current) {
      setFormData(prev => ({ ...prev, note: noteData.note }));
      noteAutoFilledRef.current = true;
    }
    if (!noteData?.note) {
      noteAutoFilledRef.current = false;
    }
  }, [noteData, selectedItem]);


  // Update selected item resets form quantity defaults and note auto-fill
  const handleSelect = (item) => {
    setSelectedItem(item);
    noteAutoFilledRef.current = false;
    setFormData(prev => ({ ...prev, quantity: 1, unit_price: '', note: '' }));
  };

  const filteredInventory = inventory.filter(item => 
    item.product_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const updateFormData = (updates) => {
    setFormData(prev => {
      const next = { ...prev, ...updates };
      if ('platform_id' in updates || 'unit_price' in updates || 'quantity' in updates) {
        if (!('commission_fee' in updates)) {
           const plat = platforms.find(p => p.id === next.platform_id);
           if (plat && plat.fee_pct > 0) {
             const price = parseFloat(next.unit_price) || 0;
             const qty = parseInt(next.quantity) || 1;
             const fee = (price * qty) * (plat.fee_pct / 100);
             next.commission_fee = fee > 0 ? fee.toFixed(2) : '';
           } else if ('platform_id' in updates) {
             next.commission_fee = '';
           }
        }
      }
      return next;
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    updateFormData({ [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedItem) return;

    const payload = {
      ...formData,
      inventory_id: selectedItem.id,
    };

    const submitPromise = apiFetch(`/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res;
    });

    toast.promise(submitPromise, {
      loading: 'Recording sale...',
      success: () => {
        invalidate.inventory();
        invalidate.dashboard();
        // Save or clear the product note independently (fire-and-forget)
        const noteText = formData.note?.trim();
        if (noteText) {
          upsertNote.mutate({ note: noteText });
        } else if (noteData?.note) {
          removeNote.mutate();
        }
        setTimeout(() => navigate('/transactions'), 800);
        return `Sale recorded for ${selectedItem.product_name}!`;
      },
      error: (err) => `Failed: ${err.message}`,
    });
  };

  return (
    <div className="container max-w-5xl 3xl:max-w-6xl mx-auto px-4 py-6 lg:px-8 lg:py-10 h-[calc(100vh-80px)] overflow-y-auto">
      
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Record a Sale</h1>
        <p className="text-gray-400 text-sm mt-1">Select an item from your current inventory to record its sale data and calculate profit.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Inventory List */}
        <div className="lg:col-span-1 space-y-4 flex flex-col h-full">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              placeholder="Search in-stock inventory..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#12121A] border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors shadow-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pb-8 scrollbar-thin">
            {isLoading ? (
              // Skeleton cards while inventory loads
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="w-full p-4 rounded-xl border border-white/10 bg-[#12121A] animate-pulse">
                  <div className="h-3.5 bg-white/10 rounded w-3/4 mb-3" />
                  <div className="flex gap-4 mb-3">
                    <div className="h-3 bg-white/6 rounded w-16" />
                    <div className="h-3 bg-white/6 rounded w-20" />
                  </div>
                  <div className="pt-3 border-t border-white/5 flex gap-2">
                    <div className="h-3 bg-white/6 rounded w-8" />
                    <div className="h-3 bg-white/6 rounded w-28" />
                  </div>
                </div>
              ))
            ) : (
              <>
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={clsx(
                      "w-full text-left p-4 rounded-xl border transition-all relative overflow-hidden group",
                      selectedItem?.id === item.id
                        ? "bg-purple-500/10 border-purple-500/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]"
                        : "bg-[#12121A] border-white/10 hover:border-white/20 hover:bg-[#16161E]"
                    )}
                  >
                    {selectedItem?.id === item.id && (
                      <div className="absolute top-3 right-3 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div className="flex justify-between items-start mb-2 pr-6">
                      <h3 className="text-sm font-semibold text-white max-w-[90%] truncate">{item.product_name}</h3>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-gray-400 font-medium">Stock: <span className="text-gray-200">{item.qty_on_hand}</span></div>
                      <div className="text-gray-400 font-medium">Cost: <span className="text-blue-400">${item.unit_purchase_cost.toFixed(2)}</span></div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                      <Store className="w-3.5 h-3.5 text-gray-500" />
                      <span className="text-xs text-gray-500">{item.vendor?.name || 'Unknown'} • {new Date(item.purchase_date).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
                {filteredInventory.length === 0 && (
                  <div className="p-8 text-center text-gray-500 text-sm border border-dashed border-white/10 rounded-xl">
                    No inventory matches your search.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Sale Entry Form */}
        <div className="lg:col-span-2">
          {selectedItem ? (
            <form onSubmit={handleSubmit} className="space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-300">
              
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 flex items-center gap-4 shadow-sm">
                <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                  <Package className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Currently Selling</h2>
                  <p className="text-lg font-bold text-white mt-0.5">{selectedItem.product_name}</p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#12121A] p-6 space-y-6 shadow-sm">
                
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Sale Destination</h3>
                  </div>

                  {/* Chrome-style Tab Strip */}
                  <div className="flex border-b border-white/[0.07]">
                    {[{ id: 'cashout', label: 'Cashout' }, { id: 'marketplace', label: 'Marketplace' }].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setSaleTab(tab.id);
                          updateFormData({ platform_id: '' }); // reset platform selection
                        }}
                        className={`px-5 py-2 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                          saleTab === tab.id
                            ? 'border-amber-400 text-amber-400'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="pt-2">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      {saleTab === 'cashout' ? 'Cashout Platform *' : 'Marketplace *'}
                    </label>
                    <select
                      name="platform_id"
                      value={formData.platform_id}
                      onChange={handleChange}
                      className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 appearance-none"
                      required
                    >
                      <option value="">{saleTab === 'cashout' ? 'Select cashout platform...' : 'Select marketplace...'}</option>
                      {platforms
                        .filter(p => saleTab === 'cashout'
                          ? p.type === 'Cashout'
                          : p.type === 'Marketplace'
                        )
                        .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                      }
                    </select>
                  </div>
                </div>

                <hr className="border-white/5" />

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-green-400">Revenue & Fees</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Units Selling *</label>
                      <div className="flex bg-[#0A0A0F] border border-white/10 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateFormData({ quantity: Math.max(1, (parseInt(formData.quantity) || 1) - 1) })}
                          className="px-3 py-2 text-gray-400 hover:text-white transition-colors border-r border-white/10 flex-shrink-0"
                        >-</button>
                        <input
                          type="number"
                          value={formData.quantity}
                          min="1"
                          max={selectedItem.qty_on_hand}
                          onChange={e => updateFormData({ quantity: e.target.value === '' ? '' : Math.min(selectedItem.qty_on_hand, parseInt(e.target.value) || 1) })}
                          className="w-full bg-transparent px-2 py-2 text-sm text-white text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() => updateFormData({ quantity: Math.min(selectedItem.qty_on_hand, (parseInt(formData.quantity) || 1) + 1) })}
                          className="px-3 py-2 text-gray-400 hover:text-white transition-colors border-l border-white/10 flex-shrink-0"
                        >+</button>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">Found {selectedItem.qty_on_hand} in stock</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Sale Price (per unit) *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input name="unit_price" type="number" step="0.01" value={formData.unit_price} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50" placeholder="0.00" required />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Platform Fees / Commission</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input name="commission_fee" type="number" step="0.01" value={formData.commission_fee} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50" placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Sale Shipping</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input name="sale_shipping" type="number" step="0.01" value={formData.sale_shipping} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50" placeholder="0.00" />
                      </div>
                    </div>
                  </div>

                  {/* Per-unit note + mini summary */}
                  {(() => {
                    const sp = parseFloat(formData.unit_price) || 0;
                    const qs = parseInt(formData.quantity) || 1;
                    const qtyPurchased = selectedItem.qty_purchased || 1;
                    const unitTax = (selectedItem.sales_tax || 0) / qtyPurchased;
                    const unitShipping = (selectedItem.shipping_cost_inbound || 0) / qtyPurchased;
                    const unitGiftCard = (selectedItem.gift_card_amount || 0) / qtyPurchased;
                    const unitCost = selectedItem.unit_purchase_cost + unitTax + unitShipping - unitGiftCard;
                    const purchaseCost = unitCost * qs;
                    const saleTotal = sp * qs;
                    const commission = parseFloat(formData.commission_fee) || 0;
                    const saleShipping = parseFloat(formData.sale_shipping) || 0;
                    const profit = saleTotal - purchaseCost - commission - saleShipping;
                    return (
                      <>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" defaultChecked className="w-3.5 h-3.5 rounded border-gray-600 accent-green-500" readOnly />
                          <span className="text-xs text-gray-400">
                            Sale price is{' '}
                            <span className="text-green-400 font-medium">per unit</span>
                            {sp > 0 && qs > 0 && (
                              <span className="text-gray-600"> (${sp.toFixed(2)} × {qs} = ${saleTotal.toFixed(2)})</span>
                            )}
                          </span>
                        </label>

                        {(sp > 0 || purchaseCost > 0) && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.04] text-xs overflow-hidden">
                            <div className="flex justify-between px-4 py-2.5">
                              <span className="text-gray-400">Cost basis ({qs} × ${unitCost.toFixed(2)}/unit)</span>
                              <span className="text-gray-200">${purchaseCost.toFixed(2)}</span>
                            </div>
                            {commission > 0 && (
                              <div className="flex justify-between px-4 py-2.5">
                                <span className="text-gray-400">Commission fee</span>
                                <span className="text-red-400">-${commission.toFixed(2)}</span>
                              </div>
                            )}
                            {saleShipping > 0 && (
                              <div className="flex justify-between px-4 py-2.5">
                                <span className="text-gray-400">Sale shipping</span>
                                <span className="text-red-400">-${saleShipping.toFixed(2)}</span>
                              </div>
                            )}
                            {sp > 0 && (
                              <div className="flex justify-between px-4 py-2.5">
                                <span className="text-gray-400">Sale total ({qs} × ${sp.toFixed(2)})</span>
                                <span className="text-green-400">${saleTotal.toFixed(2)}</span>
                              </div>
                            )}
                            {sp > 0 && (
                              <div className="flex justify-between px-4 py-2.5 font-semibold">
                                <span className="text-gray-300">Est. Profit</span>
                                <span className={profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <hr className="border-white/5" />

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">Timeline</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Sale Date</label>
                      <input name="sale_date" type="date" value={formData.sale_date} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 [color-scheme:dark]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Expected Payout Date</label>
                      <input name="payout_date" type="date" value={formData.payout_date} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 [color-scheme:dark]" />
                    </div>
                  </div>
                </div>

                <hr className="border-white/5" />

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">Tax Info</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Sale Tax Collected</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input name="sale_tax_collected" type="number" step="0.01" value={formData.sale_tax_collected} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50" placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Exemption Type</label>
                      <input name="exemption_type" type="text" value={formData.exemption_type} onChange={handleChange} className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50" placeholder="e.g. Resale, Nonprofit..." disabled={!formData.customer_tax_exempt} />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input type="checkbox" checked={formData.taxable} onChange={e => setFormData(p => ({ ...p, taxable: e.target.checked }))} className="w-4 h-4 rounded border-gray-600 accent-blue-500" />
                      <span className="text-sm text-gray-300">Taxable Sale</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input type="checkbox" checked={formData.customer_tax_exempt} onChange={e => setFormData(p => ({ ...p, customer_tax_exempt: e.target.checked, exemption_type: e.target.checked ? p.exemption_type : '' }))} className="w-4 h-4 rounded border-gray-600 accent-blue-500" />
                      <span className="text-sm text-gray-300">Customer Tax Exempt</span>
                    </label>
                  </div>
                </div>

              <hr className="border-white/5" />

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-gray-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Product Note</h3>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Note <span className="text-gray-600 normal-case font-normal">(shared across all items with this product name)</span>
                  </label>
                  <textarea
                    name="note"
                    value={formData.note}
                    onChange={(e) => {
                      noteAutoFilledRef.current = true;
                      handleChange(e);
                    }}
                    rows={3}
                    maxLength={2000}
                    placeholder="e.g. 'Check eBay comps before listing', 'Bought during outlet drop'..."
                    className="w-full bg-[#0A0A0F] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500/50 transition-colors resize-none"
                  />
                  <p className="text-[10px] text-gray-600 mt-1 text-right">{(formData.note || '').length}/2000</p>
                </div>
              </div>

              </div>

              <div className="flex items-center justify-between px-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setSelectedItem(null)}
                  className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-6 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium text-sm transition-colors shadow-[0_0_15px_rgba(22,163,74,0.3)] shadow-green-500/20"
                >
                  Confirm Sale
                </button>
              </div>

            </form>
          ) : (
            <div className="h-full min-h-[400px] border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center p-8 bg-[#12121A]/50">
               <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                 <Package className="w-6 h-6 text-gray-600" />
               </div>
               <h3 className="text-lg font-medium text-gray-300">No Item Selected</h3>
               <p className="text-gray-500 text-sm mt-2 text-center max-w-sm">Select an item from your available inventory on the left to securely link a new sale record to it.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};

export default AddSale;
