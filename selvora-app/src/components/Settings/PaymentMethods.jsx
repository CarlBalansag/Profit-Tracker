import React, { useState, useEffect } from 'react';
import { Crown, Zap, Plus, LogOut, ChevronDown, PenSquare, Trash2 } from 'lucide-react';
import { useInvalidate, apiFetch} from '../../hooks/useApi';
import { QuickAddModal } from './QuickAddModal';
import { CustomCardModal } from './CustomCardModal';
import { IssuerLogo } from './IssuerLogo';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';

export const PaymentMethods = () => {
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [viewMode, setViewMode] = useState('Cards View'); // Cards View | Analytics View
  
  const [savedCards, setSavedCards] = useState([]);
  const [openRatesIds, setOpenRatesIds] = useState(new Set());

  const toggleRates = (uniqueKey) => {
    setOpenRatesIds(prev => {
      const next = new Set(prev);
      if (next.has(uniqueKey)) next.delete(uniqueKey);
      else next.add(uniqueKey);
      return next;
    });
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const fetchCards = async () => {
    try {
      const res = await apiFetch(`/api/payment-methods`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const mapped = data.map(card => ({
            id: card.id,
            name: card.name || 'Unnamed',
            issuer: (card.name || '').split(' ')[0] || 'Unknown',
            type: (card.type || '').toLowerCase().includes('debit') ? 'debit' : 'credit',
            baseRate: card.default_cashback_rate || 0,
            categoryRates: Array.isArray(card.category_rates) ? card.category_rates : [],
            creditLimit: card.credit_limit || 0,
            totalSpend: 0,
            availableSpend: 0,
            statement_close_day: card.statement_close_day ?? null,
            due_day: card.due_day ?? null,
            min_payment_pct: card.min_payment_pct ?? null,
          }));
          setSavedCards(mapped);
        } else {
          console.error('API returned non-array:', data);
        }
      } else {
        console.error('API Error:', res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCards = async (newCards, includeStoreRates) => {
    for (const card of newCards) {
      await apiFetch(`/api/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: card.name,
          type: 'Credit',
          default_cashback_rate: card.baseRate,
          preset_card_id: card.id,
          category_rates: includeStoreRates ? (card.categoryRates || []) : []
        })
      });
    }
    invalidate.paymentMethods();
    setIsQuickAddOpen(false);
  };

  const handleCustomAdd = async (processedCard) => {
    const isEditing = !!editingCard;
    const apiBase = (import.meta.env.VITE_API_DIRECT_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const url = isEditing
      ? `${apiBase}/api/payment-methods/${processedCard.id}`
      : `${apiBase}/api/payment-methods`;

    const method = isEditing ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify({
        name: processedCard.name,
        type: processedCard.type,
        default_cashback_rate: processedCard.baseRate,
        statement_close_day: processedCard.statement_close_day ?? null,
        due_day: processedCard.due_day ?? null,
        credit_limit: processedCard.credit_limit ?? null,
        min_payment_pct: processedCard.min_payment_pct ?? null,
      })
    });

    invalidate.paymentMethods();
    setIsCustomModalOpen(false);
    setEditingCard(null);
  };

  const openEditModal = (card) => {
    setEditingCard(card);
    setIsCustomModalOpen(true);
  };

  const removeCard = async (id) => {
    await apiFetch(`/api/payment-methods/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    invalidate.paymentMethods();
  };

  const totalCreditLimit = savedCards.reduce((sum, c) => sum + (Number(c.creditLimit) || 0), 0);
  const totalTrackedSpend = savedCards.reduce((sum, c) => sum + (Number(c.totalSpend) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Payment Methods</h1>
          <p className="text-sm text-gray-400 mt-1">Credit command center: limits, CLI history, perks, and optimized store rates</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsQuickAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors border border-gray-700"
          >
            <Zap size={14} className="text-yellow-400" /> Quick Add
          </button>
          <button 
            onClick={() => setIsCustomModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors border border-gray-700"
          >
            <Plus size={14} /> Custom
          </button>
        </div>
      </div>

      {/* Intelligence Banner */}
      <div className="bg-[#12121A] border border-gray-800 rounded-xl p-6 flex flex-col md:flex-row gap-6 md:items-center justify-between">
         <div>
            <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-2">Card Intelligence</div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Crown size={20} className="text-yellow-500" /> Build your elite wallet stack</h2>
            <p className="text-sm text-gray-400 mt-1">Track utilization, available spend, and centralize every perk you can exploit.</p>
         </div>
         <div className="flex gap-4">
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30">
               <div className="text-xs text-gray-500 font-medium">Total Credit Limit</div>
               <div className="text-lg font-bold text-white mt-1">${totalCreditLimit.toFixed(2)}</div>
            </div>
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30">
               <div className="text-xs text-gray-500 font-medium">Total Tracked Spend</div>
               <div className="text-lg font-bold text-[#6DDBA9] mt-1">${totalTrackedSpend.toFixed(2)}</div>
            </div>
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30">
               <div className="text-xs text-gray-500 font-medium">Perks · Active</div>
               <div className="text-sm font-bold text-yellow-500 mt-1">0 perks · {savedCards.length} cards</div>
            </div>
         </div>
      </div>

      {/* View Toggles */}
      <div className="flex gap-1 border-b border-gray-800/50 pb-4">
        {['Cards View', 'Analytics View'].map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={clsx(
              "px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2",
              viewMode === mode 
                ? "bg-gray-800 text-white" 
                : "text-gray-500 hover:text-gray-300"
            )}
          >
            <PenSquare size={14} /> {mode}
          </button>
        ))}
      </div>

      {/* Cards Grid */}
      {viewMode === 'Cards View' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {savedCards.map((card, cardIdx) => {
            const rateKey = `rate-${card.id || cardIdx}-${cardIdx}`;
            const isOpen = openRatesIds.has(rateKey);
            return (
            <div key={card.id ?? cardIdx} className="bg-[#12121A] border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors group">
              {/* Card Header */}
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                   <IssuerLogo issuer={card.issuer} brand={card.brand} className="w-10 h-10" />
                   <div>
                      <h3 className="text-sm font-bold text-white leading-tight">{card.name}</h3>
                      <p className="text-xs text-gray-500 capitalize">{card.issuer}{card.type === 'debit' ? ' (Debit)' : ''}</p>
                   </div>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button 
                     onClick={() => openEditModal(card)}
                     className="text-gray-500 hover:text-white"
                   >
                     <PenSquare size={14}/>
                   </button>
                   <button onClick={() => removeCard(card.id)} className="text-red-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                 <div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Default Rate</div>
                    <div className="text-base font-bold text-[#6DDBA9] mt-0.5">{card.baseRate.toFixed(2)}%</div>
                 </div>
                 <div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Credit Limit</div>
                    <div className="text-base font-bold text-white mt-0.5">${(card.creditLimit || 0).toFixed(2)}</div>
                 </div>
                 <div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Available</div>
                    <div className="text-sm font-bold text-[#6DDBA9] mt-0.5">${(card.availableSpend || 0).toFixed(2)}</div>
                 </div>
                 <div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Spend</div>
                    <div className="text-sm font-bold text-white mt-0.5">${(card.totalSpend || 0).toFixed(2)}</div>
                 </div>
              </div>



              {/* Store Rates Toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleRates(rateKey); }}
                className={clsx(
                  'w-full flex items-center justify-between text-xs font-bold transition-colors py-2 mt-2 border-t px-1 rounded-b-lg',
                  isOpen
                    ? 'border-blue-800/40 bg-blue-500/10 text-blue-400'
                    : 'border-gray-800/50 text-gray-400 hover:text-gray-200'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Zap size={12} className={isOpen ? 'text-blue-400' : 'text-blue-500'}/>
                  STORE RATES
                  {card.categoryRates.length > 0 && (
                    <span className={clsx('ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold', isOpen ? 'bg-blue-500/30 text-blue-300' : 'bg-blue-500/20 text-blue-400')}>
                      {card.categoryRates.length}
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={14}
                  className={clsx('transition-transform duration-200', isOpen ? 'rotate-180 text-blue-400' : 'text-gray-600')}
                />
              </button>

              {isOpen && (
                <div className="mt-1 space-y-1">
                  {card.categoryRates.length === 0 ? (
                    <p className="text-xs text-gray-600 py-1">No category rates saved for this card.</p>
                  ) : (
                    (() => {
                      const today = new Date();
                      const active = card.categoryRates.filter(r => !r.expires || new Date(r.expires) >= today);
                      const expired = card.categoryRates.filter(r => r.expires && new Date(r.expires) < today);
                      return (
                        <>
                          {active.map((r, i) => (
                            <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg bg-white/3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-gray-300">{r.store}</span>
                                {r.expires && (
                                  <span className="text-[10px] text-amber-400/80">
                                    · expires {new Date(r.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-bold text-emerald-400">{r.rate}%</span>
                            </div>
                          ))}
                          {expired.length > 0 && (
                            <div className="pt-1">
                              <p className="text-[10px] uppercase font-bold text-gray-600 tracking-wider mb-1">Expired</p>
                              {expired.map((r, i) => (
                                <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg bg-white/2 opacity-50">
                                  <span className="text-xs text-gray-500 line-through">{r.store}</span>
                                  <span className="text-xs font-bold text-gray-600">{r.rate}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              )}

              {/* Signup Bonus Render if exists */}
              {card.signupBonus && (
                <div className="mt-4 pt-3 border-t border-gray-800/50">
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-yellow-500 flex items-center gap-1"><Crown size={10} /> Signup Bonus</span>
                    <span className="text-yellow-500">${card.signupBonus.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mb-2">
                     ${(card.signupBonusSpend || 0).toFixed(2)} / ${(card.signupBonusReq || 0).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
            );
          })}

          <button
             onClick={() => setIsQuickAddOpen(true)}
             className="bg-[#12121A]/50 border-2 border-dashed border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors flex flex-col items-center justify-center text-gray-500 hover:text-gray-300 min-h-75"
          >
             <div className="w-12 h-12 rounded-full border border-gray-700 flex items-center justify-center mb-4 bg-[#1a1a24]">
                <Plus size={24} />
             </div>
             <p className="font-medium text-sm">Add New Card</p>
          </button>
        </div>
      )}

      {viewMode === 'Analytics View' && (
         <div className="py-20 text-center text-gray-600 font-medium">
           Analytics View is under construction.
         </div>
      )}

      {/* Modal */}
      <QuickAddModal 
        isOpen={isQuickAddOpen} 
        onClose={() => setIsQuickAddOpen(false)}
        onAddCards={handleAddCards}
        existingCardIds={savedCards.map(c => c.presetId || null).filter(Boolean)}
      />

      <CustomCardModal
        isOpen={isCustomModalOpen}
        onClose={() => {
          setIsCustomModalOpen(false);
          setEditingCard(null);
        }}
        onAddCard={handleCustomAdd}
        cardToEdit={editingCard}
      />
    </div>
  );
};
