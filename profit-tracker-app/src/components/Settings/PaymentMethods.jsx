import { formatMoney } from '../../utils/money';
import React, { useState, useEffect } from 'react';
import { Crown, Zap, Plus, LogOut, ChevronDown, PenSquare, Trash2 } from 'lucide-react';
import { useInvalidate, apiFetch} from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { toast } from 'sonner';
import { QuickAddModal } from './QuickAddModal';
import { CustomCardModal } from './CustomCardModal';
import { IssuerLogo } from './IssuerLogo';
import { CardReworkNotice } from './CardReworkNotice';
import clsx from 'clsx';
import {
  loadCardCatalog, rewardFieldsFromCatalog, reworkSwitchBody, cardsNeedingRework,
  formatEarnRate, pointsUnit, cleanCardName, resellingPerks,
} from '../../utils/cardRewards';

import { useAuth } from '../../context/AuthContext';

export const PaymentMethods = () => {
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  // Type pre-selected when Custom is opened from the Debit section's add tile.
  const [newCardType, setNewCardType] = useState(null);
  
  const [savedCards, setSavedCards] = useState([]);
  // Raw API rows, for the rework notice (it needs the stored fields as-is).
  const [savedMethods, setSavedMethods] = useState([]);
  const [catalogCards, setCatalogCards] = useState([]);
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
    // The catalog powers the rework notice and each card's perks; the page
    // still works without it.
    let cancelled = false;
    loadCardCatalog()
      .then(data => { if (!cancelled && Array.isArray(data?.cards)) setCatalogCards(data.cards); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fetchCards = async () => {
    try {
      const res = await apiFetch(`/api/payment-methods`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const mapped = data.map(card => {
            const creditLimit = card.credit_limit ?? null;
            const totalSpend = card.total_spend || 0;
            return {
              id: card.id,
              name: card.name || 'Unnamed',
              issuer: (card.name || '').split(' ')[0] || 'Unknown',
              type: /debit|prepaid/i.test(card.type || '') ? 'debit' : 'credit',
              rawType: card.type || '',
              baseRate: card.default_cashback_rate || 0,
              rewardType: card.reward_type === 'points' ? 'points' : 'cashback',
              pointsBaseRate: card.points_base_rate ?? null,
              pointValueCents: card.point_value_cents ?? null,
              rewardsLabel: card.rewards_label || null,
              catalogCardId: card.catalog_card_id || null,
              catalogSyncedAt: card.catalog_synced_at || null,
              presetId: card.preset_card_id || null,
              // Needed by the Edit form; without it, saving an edit cleared the card's last 4.
              last4: card.last4 || '',
              categoryRates: Array.isArray(card.category_rates) ? card.category_rates : [],
              creditLimit,
              totalSpend,
              // null (not 0) when no limit is configured, so the UI can show
              // "No limit" instead of a misleading "$0.00 available".
              availableSpend: creditLimit != null ? Math.max(0, creditLimit - totalSpend) : null,
              statement_close_day: card.statement_close_day ?? null,
              due_day: card.due_day ?? null,
              min_payment_pct: card.min_payment_pct ?? null,
              is_personal: card.is_personal ?? false,
            };
          });
          setSavedCards(mapped);
          setSavedMethods(data);
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

  // Cards picked from the OpenCard DB catalog in Quick Add.
  const handleAddCards = async (newCards, { includeStoreRates = true, pointValueCents } = {}) => {
    const results = await Promise.allSettled(newCards.map(card =>
      apiFetch(`/api/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanCardName(card.name),
          type: 'Credit',
          ...rewardFieldsFromCatalog(card, { includeStoreRates, pointValueCents }),
        })
      }).then(res => requireSuccessfulResponse(res, `Could not add ${card.name}`))
    ));

    invalidate.paymentMethods();
    fetchCards();

    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      toast.error(`Added ${results.length - failedCount} of ${results.length} card(s); ${failedCount} failed to add.`);
      throw new Error('Some cards failed to add');
    }
    toast.success(`${results.length} card${results.length > 1 ? 's' : ''} added.`);
  };

  const handleCustomAdd = async (processedCard) => {
    const isEditing = !!editingCard;
    const url = isEditing
      ? `/api/payment-methods/${processedCard.id}`
      : `/api/payment-methods`;

    const method = isEditing ? 'PUT' : 'POST';

    // Re-linked to a different card from the list: the server takes the new
    // card's rewards; the user's own store rates and point value carry over.
    const relinkFields = isEditing && processedCard.relinkTo
      ? rewardFieldsFromCatalog(processedCard.relinkTo, {
        pointValueCents: processedCard.relinkPointValueCents ?? undefined,
        userRates: (editingCard.categoryRates || []).filter(r => r.source !== 'catalog'),
      })
      : null;

    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relinkFields ? {
          name: processedCard.name,
          type: processedCard.type,
          ...relinkFields,
          last4: processedCard.last4 || null,
          statement_close_day: processedCard.statement_close_day ?? null,
          due_day: processedCard.due_day ?? null,
          credit_limit: processedCard.credit_limit ?? null,
          min_payment_pct: processedCard.min_payment_pct ?? null,
          is_personal: processedCard.is_personal ?? false,
        } : {
          name: processedCard.name,
          type: processedCard.type,
          default_cashback_rate: processedCard.baseRate,
          reward_type: processedCard.rewardType === 'points' ? 'points' : 'cashback',
          ...(processedCard.rewardType === 'points' ? {
            points_base_rate: processedCard.pointsBaseRate,
            point_value_cents: processedCard.pointValueCents,
            rewards_label: processedCard.rewardsLabel,
          } : {}),
          last4: processedCard.last4 || null,
          statement_close_day: processedCard.statement_close_day ?? null,
          due_day: processedCard.due_day ?? null,
          credit_limit: processedCard.credit_limit ?? null,
          min_payment_pct: processedCard.min_payment_pct ?? null,
          is_personal: processedCard.is_personal ?? false,
        })
      });
      await requireSuccessfulResponse(res, isEditing ? 'Could not update card' : 'Could not add card');
      invalidate.paymentMethods();
      fetchCards();
      toast.success(isEditing ? 'Card updated.' : 'Card added.');
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const openEditModal = (card) => {
    setEditingCard(card);
    setIsCustomModalOpen(true);
  };

  const removeCard = async (id) => {
    try {
      const res = await apiFetch(`/api/payment-methods/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      await requireSuccessfulResponse(res, 'Could not remove payment method');
      invalidate.paymentMethods();
      fetchCards();
      toast.success('Payment method removed.');
    } catch (err) {
      toast.error(`Could not remove payment method: ${err.message}`);
    }
  };

  // Rework notice answers. Errors keep the card in the notice so it can be retried.
  const handleReworkSwitch = async (method, catalogCard) => {
    try {
      const res = await apiFetch(`/api/payment-methods/${method.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reworkSwitchBody(method, catalogCard)),
      });
      await requireSuccessfulResponse(res, `Could not update ${method.name}`);
      invalidate.paymentMethods();
      await fetchCards();
      toast.success(`${method.name} updated.`);
    } catch (err) {
      toast.error(err.message);
    }
  };
  const handleReworkKeep = async (method) => {
    try {
      const res = await apiFetch(`/api/payment-methods/${method.id}/rework-prompt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'kept' }),
      });
      await requireSuccessfulResponse(res, `Could not save your choice for ${method.name}`);
      await fetchCards();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const reworkItems = cardsNeedingRework(savedMethods, catalogCards);
  const catalogById = new Map(catalogCards.map(c => [c.id, c]));
  // Only perks that matter for reselling (purchase protection, shipping credits...).
  const perksFor = (card) => resellingPerks(catalogById.get(card.catalogCardId)?.benefits || []);
  const totalPerks = savedCards.reduce((sum, c) => sum + perksFor(c).length, 0);

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
            <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider mb-2">Card Intelligence</div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Crown size={20} className="text-yellow-500" /> Build your elite wallet stack</h2>
            <p className="text-sm text-gray-400 mt-1">Track utilization, available spend, and centralize every perk you can exploit.</p>
         </div>
         <div className="flex gap-4 overflow-x-auto">
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30 flex-shrink-0">
               <div className="text-xs text-gray-500 font-medium">Total Credit Limit</div>
               <div className="text-lg font-bold text-white mt-1">${formatMoney(totalCreditLimit)}</div>
            </div>
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30 flex-shrink-0">
               <div className="text-xs text-gray-500 font-medium">Total Tracked Spend</div>
               <div className="text-lg font-bold text-[#6DDBA9] mt-1">${formatMoney(totalTrackedSpend)}</div>
            </div>
            <div className="bg-[#0A0A0F] border border-gray-800 rounded-lg p-3 min-w-30 flex-shrink-0">
               <div className="text-xs text-gray-500 font-medium">Perks · Active</div>
               <div className="text-sm font-bold text-yellow-500 mt-1">{totalPerks} perks · {savedCards.length} cards</div>
            </div>
         </div>
      </div>

      <CardReworkNotice items={reworkItems} onSwitch={handleReworkSwitch} onKeep={handleReworkKeep} />

      {/* Cards, split into credit and debit/prepaid */}
      {[
        {
          id: 'credit', title: 'Credit cards', addLabel: 'Add credit card',
          cards: savedCards.filter(c => c.type !== 'debit'),
          onAdd: () => setIsQuickAddOpen(true),
        },
        {
          id: 'debit', title: 'Debit & prepaid', addLabel: 'Add debit card',
          cards: savedCards.filter(c => c.type === 'debit'),
          onAdd: () => { setNewCardType('Debit'); setIsCustomModalOpen(true); },
        },
      ].map(section => (
      <section key={section.id} aria-labelledby={`pm-section-${section.id}`} className="space-y-3">
        <h2 id={`pm-section-${section.id}`} className="flex items-center gap-2 text-sm font-bold text-gray-300 border-b border-gray-800/50 pb-2">
          {section.title}
          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-white/5 text-gray-400">{section.cards.length}</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {section.cards.map((card, cardIdx) => {
            const rateKey = `rate-${card.id || cardIdx}-${cardIdx}`;
            const isOpen = openRatesIds.has(rateKey);
            return (
            <div key={card.id ?? cardIdx} className="bg-[#12121A] border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors group">
              {/* Card Header */}
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                   <IssuerLogo issuer={card.issuer} brand={card.brand} className="w-10 h-10" />
                   <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white leading-tight">{card.name}</h3>
                        {card.is_personal && (
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide bg-purple-500/10 text-purple-400 border border-purple-500/20">Personal</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 capitalize">{card.issuer}{card.type === 'debit' ? ' (Debit)' : ''}</p>
                      {card.catalogSyncedAt && (
                        <p className="text-[11px] text-gray-600" title="Rates follow the card data automatically. Rates you change yourself are kept.">
                          Rates kept current · last updated {new Date(card.catalogSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                   </div>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button aria-label="Edit card" 
                     onClick={() => openEditModal(card)}
                     className="text-gray-500 hover:text-white"
                   >
                     <PenSquare size={14}/>
                   </button>
                   <button aria-label="Delete card" onClick={() => removeCard(card.id)} className="text-red-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                 <div>
                    <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">{card.rewardType === 'points' ? 'Earns' : 'Default Rate'}</div>
                    {card.rewardType === 'points' ? (
                      <>
                        <div className="text-base font-bold text-amber-300 mt-0.5">{formatEarnRate(card.pointsBaseRate ?? 0, 'points')} {pointsUnit(card.rewardsLabel)}</div>
                        <div className="text-[11px] text-gray-500" title={card.rewardsLabel || undefined}>at {card.pointValueCents ?? 1}¢ each ≈ {Number(card.baseRate).toFixed(2)}%</div>
                      </>
                    ) : (
                      <div className="text-base font-bold text-[#6DDBA9] mt-0.5">{Number(card.baseRate).toFixed(2)}%</div>
                    )}
                 </div>
                 <div>
                    <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Credit Limit</div>
                    <div className="text-base font-bold text-white mt-0.5">{card.creditLimit != null ? `$${formatMoney(card.creditLimit)}` : 'No limit set'}</div>
                 </div>
                 <div>
                    <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Available</div>
                    <div className="text-sm font-bold text-[#6DDBA9] mt-0.5">{card.availableSpend != null ? `$${formatMoney(card.availableSpend)}` : '—'}</div>
                 </div>
                 <div>
                    <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Total Spend</div>
                    <div className="text-sm font-bold text-white mt-0.5">${formatMoney((card.totalSpend || 0))}</div>
                 </div>
              </div>



              {/* Store Rates Toggle */}
              <button aria-label="Show or hide rates"
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
                    <span className={clsx('ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold', isOpen ? 'bg-blue-500/30 text-blue-300' : 'bg-blue-500/20 text-blue-400')}>
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
                                  <span className="text-[11px] text-amber-400/80">
                                    · expires {new Date(r.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-bold text-emerald-400">{card.rewardType === 'points' && r.points != null ? `${formatEarnRate(r.points, 'points')} · ≈${r.rate}%` : `${r.rate}%`}</span>
                            </div>
                          ))}
                          {expired.length > 0 && (
                            <div className="pt-1">
                              <p className="text-[11px] uppercase font-bold text-gray-600 tracking-wider mb-1">Expired</p>
                              {expired.map((r, i) => (
                                <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg bg-white/2 opacity-50">
                                  <span className="text-xs text-gray-500 line-through">{r.store}</span>
                                  <span className="text-xs font-bold text-gray-600">{card.rewardType === 'points' && r.points != null ? formatEarnRate(r.points, 'points') : `${r.rate}%`}</span>
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

              {/* Perks from the card catalog */}
              {perksFor(card).length > 0 && (
                <details className="mt-2 border-t border-gray-800/50 pt-2 group/perks">
                  <summary className="cursor-pointer text-xs font-bold text-gray-400 hover:text-gray-200 flex items-center gap-1.5 list-none">
                    <Crown size={12} className="text-yellow-500" /> PERKS
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-yellow-500/15 text-yellow-400">{perksFor(card).length}</span>
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {perksFor(card).map((perk, i) => (
                      <li key={i} className="px-2 py-1 rounded-lg bg-white/3">
                        <p className="text-xs text-gray-200">{perk.title}</p>
                        {perk.description && <p className="text-[11px] text-gray-500 mt-0.5">{perk.description}</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Signup Bonus Render if exists */}
              {card.signupBonus && (
                <div className="mt-4 pt-3 border-t border-gray-800/50">
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-yellow-500 flex items-center gap-1"><Crown size={10} /> Signup Bonus</span>
                    <span className="text-yellow-500">${formatMoney(card.signupBonus)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mb-2">
                     ${formatMoney((card.signupBonusSpend || 0))} / ${formatMoney((card.signupBonusReq || 0))}
                  </div>
                </div>
              )}
            </div>
            );
          })}

          <button
             onClick={section.onAdd}
             className={clsx(
               "bg-[#12121A]/50 border-2 border-dashed border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors flex flex-col items-center justify-center text-gray-500 hover:text-gray-300",
               section.cards.length ? "min-h-75" : "min-h-32"
             )}
          >
             <div className="w-12 h-12 rounded-full border border-gray-700 flex items-center justify-center mb-4 bg-[#1a1a24]">
                <Plus size={24} />
             </div>
             <p className="font-medium text-sm">{section.addLabel}</p>
          </button>
        </div>
      </section>
      ))}

      {/* Modal */}
      <QuickAddModal 
        isOpen={isQuickAddOpen} 
        onClose={() => setIsQuickAddOpen(false)}
        onAddCards={handleAddCards}
        existingCardIds={savedCards.map(c => c.catalogCardId).filter(Boolean)}
      />

      <CustomCardModal
        isOpen={isCustomModalOpen}
        onClose={() => {
          setIsCustomModalOpen(false);
          setEditingCard(null);
          setNewCardType(null);
        }}
        onAddCard={handleCustomAdd}
        cardToEdit={editingCard}
        defaultType={newCardType}
      />
    </div>
  );
};
