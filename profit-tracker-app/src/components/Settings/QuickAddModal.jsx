import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Check, Copy } from 'lucide-react';
import { IssuerLogo } from './IssuerLogo';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { loadCardCatalog, catalogEarnSummary, formatEarnRate, DEFAULT_POINT_VALUE_CENTS } from '../../utils/cardRewards';
import clsx from 'clsx';

const ALL_ISSUERS = 'All Issuers';
const REWARD_FILTERS = [
  { id: 'all', label: 'All rewards' },
  { id: 'points', label: 'Points & miles' },
  { id: 'cashback', label: 'Cashback' },
];

const RewardBadge = ({ type }) => (
  <span className={clsx(
    'px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide border',
    type === 'points'
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
      : type === 'cashback'
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
        : 'bg-white/5 text-gray-400 border-gray-700'
  )}>
    {type === 'points' ? 'Points' : type === 'cashback' ? 'Cashback' : 'No rewards'}
  </span>
);

// Picker for the OpenCard DB catalog (Settings -> Payment Methods -> Quick Add).
export const QuickAddModal = ({ isOpen, onClose, onAddCards, existingCardIds = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIssuer, setSelectedIssuer] = useState(ALL_ISSUERS);
  const [rewardFilter, setRewardFilter] = useState('all');
  const [selectedCards, setSelectedCards] = useState([]);
  const [applyPresetRates, setApplyPresetRates] = useState(true);
  const [pointValue, setPointValue] = useState(String(DEFAULT_POINT_VALUE_CENTS));
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const modalRef = useModalKeyboard(isOpen, () => { if (!saving) onClose(); });

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedIssuer(ALL_ISSUERS);
    setRewardFilter('all');
    setSelectedCards([]);
    setPointValue(String(DEFAULT_POINT_VALUE_CENTS));
    setLoadError('');
    let cancelled = false;
    loadCardCatalog()
      .then(data => { if (!cancelled) setCatalog(data); })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Could not load the card list'); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const cards = useMemo(() => catalog?.cards || [], [catalog]);
  const issuers = useMemo(() => [ALL_ISSUERS, ...[...new Set(cards.map(c => c.issuer))].sort()], [cards]);

  if (!isOpen) return null;

  const query = searchQuery.trim().toLowerCase();
  const filteredCards = cards.filter(card => {
    const matchesSearch = !query || card.name.toLowerCase().includes(query) || card.issuer.toLowerCase().includes(query);
    const matchesIssuer = selectedIssuer === ALL_ISSUERS || card.issuer === selectedIssuer;
    const matchesReward = rewardFilter === 'all' || card.reward_type === rewardFilter;
    return matchesSearch && matchesIssuer && matchesReward && !existingCardIds.includes(card.id);
  });

  const selectedHasPoints = cards.some(c => selectedCards.includes(c.id) && c.reward_type === 'points');
  const pointValueNumber = Number(pointValue);
  const pointValueValid = Number.isFinite(pointValueNumber) && pointValueNumber > 0 && pointValueNumber <= 100;

  const toggleCardSelection = (cardId) => {
    setSelectedCards(prev => (prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]));
  };

  const handleAddSubmit = async () => {
    if (selectedHasPoints && !pointValueValid) return;
    const cardsToAdd = cards.filter(c => selectedCards.includes(c.id));
    setSaving(true);
    try {
      await onAddCards(cardsToAdd, { includeStoreRates: applyPresetRates, pointValueCents: pointValueNumber });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const verified = catalog?.last_verified
    ? new Date(`${catalog.last_verified}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs">
      <div ref={modalRef} className="bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-xl w-full max-w-2xl dp-elevated overflow-hidden flex flex-col max-h-[85vh] text-[var(--dp-text-primary)]">

        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-[color:var(--dp-border)]">
          <h2 className="text-lg font-bold text-[var(--dp-text-primary)]">Quick Add Cards</h2>
          <button aria-label="Close" onClick={onClose} className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Controls */}
        <div className="p-4 space-y-3 border-b border-[color:var(--dp-border)] relative">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dp-text-muted)]" />
              <input
                type="text"
                placeholder="Search cards..."
                aria-label="Search cards"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg pl-9 pr-4 py-2 text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--dp-accent)]"
              />
            </div>
            <select
              aria-label="Issuer"
              value={selectedIssuer}
              onChange={(e) => setSelectedIssuer(e.target.value)}
              className="sm:w-48 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] focus:outline-none"
            >
              {issuers.map(issuer => <option key={issuer} value={issuer}>{issuer}</option>)}
            </select>
          </div>

          <div className="flex gap-1" role="group" aria-label="Reward type">
            {REWARD_FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                aria-pressed={rewardFilter === f.id}
                onClick={() => setRewardFilter(f.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  rewardFilter === f.id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className={clsx(
            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
            applyPresetRates ? "bg-blue-900/20 border-blue-800/50" : "bg-[#16161E] border-gray-800"
          )}>
            <input
              type="checkbox"
              className="sr-only"
              checked={applyPresetRates}
              onChange={(e) => setApplyPresetRates(e.target.checked)}
            />
            <div className={clsx(
              "w-5 h-5 rounded flex items-center justify-center border flex-shrink-0",
              applyPresetRates ? "bg-blue-600 border-blue-600" : "border-gray-600"
            )}>
              {applyPresetRates && <Check size={14} className="text-white" />}
            </div>
            <Copy size={16} className={clsx('flex-shrink-0', applyPresetRates ? "text-blue-400" : "text-gray-500")} />
            <div>
               <div className="text-sm font-medium text-gray-100">Apply store rates</div>
               <div className="text-xs text-gray-400">Turn each card's bonus categories (dining, supermarkets, Amazon…) into store rates you can edit later</div>
            </div>
          </label>

          {selectedHasPoints && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <label htmlFor="quick-add-point-value" className="text-sm text-amber-100">Each point is worth</label>
              <div className="flex items-center gap-1">
                <input
                  id="quick-add-point-value"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.05"
                  value={pointValue}
                  onChange={(e) => setPointValue(e.target.value)}
                  className={clsx(
                    'w-20 bg-[var(--dp-card-bg)] border rounded-lg px-2 py-1 text-sm text-[var(--dp-text-primary)] focus:outline-none',
                    pointValueValid ? 'border-[color:var(--dp-border)]' : 'border-red-500/60'
                  )}
                />
                <span className="text-sm text-amber-100">¢</span>
              </div>
              <span className="text-xs text-amber-200/60 basis-full">Used to turn points into dollars in your totals. 1¢ is a safe default; you can change it per card later.</span>
              {!pointValueValid && <span className="text-xs text-red-400 basis-full">Enter a value above 0 and up to 100¢.</span>}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 modal-scrollbar smooth-scroll">
          {loadError ? (
            <div className="text-center py-10 text-sm text-red-400">{loadError}. Close and try again, or add the card with Custom.</div>
          ) : !catalog ? (
            <div className="text-center py-10 text-gray-500 text-sm">Loading cards…</div>
          ) : filteredCards.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">No cards found matching your search.</div>
          ) : (
            filteredCards.map(card => {
              const isSelected = selectedCards.includes(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCardSelection(card.id)}
                  aria-pressed={isSelected}
                  className={clsx(
                    "w-full flex items-center gap-4 p-3 rounded-xl border text-left transition-all",
                    isSelected
                      ? "bg-[#1c1c28] border-gray-600 shadow-sm"
                      : "bg-[#16161E] border-transparent hover:border-gray-800"
                  )}
                >
                  <IssuerLogo issuer={card.issuer} className="w-12 h-12 flex-shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <h3 className="font-bold text-gray-200 min-w-0 break-words">{card.name}</h3>
                      <RewardBadge type={card.reward_type} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500 mt-1">
                      <span>{card.issuer}</span>
                      <span>·</span>
                      <span className="text-gray-400 font-medium">
                        {card.reward_type === 'none' ? 'No rewards' : `${formatEarnRate(card.base_rate, card.reward_type)} base`}
                      </span>
                      {card.annual_fee > 0 && (<><span>·</span><span>${card.annual_fee}/yr</span></>)}
                      {card.rewards_label && card.reward_type === 'points' && (<><span>·</span><span className="truncate">{card.rewards_label}</span></>)}
                    </div>
                    {card.categories?.length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1 truncate">{catalogEarnSummary(card)}</p>
                    )}
                  </div>

                  <div className={clsx(
                    "w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors",
                    isSelected ? "bg-blue-600 border-blue-600" : "border-gray-600"
                  )}>
                     {isSelected && <Check size={12} className="text-white" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#12121A]">
          <p className="text-[11px] text-gray-500">
            Card data from{' '}
            <a href="https://github.com/thedavidweng/opencard-db" target="_blank" rel="noreferrer" className="underline hover:text-gray-300">OpenCard DB</a>
            {' '}(CC BY 4.0){verified ? ` · checked through ${verified}` : ''}. Always confirm rates with your issuer.
          </p>
          <div className="flex justify-end gap-3 shrink-0">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors border border-transparent hover:border-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddSubmit}
              disabled={selectedCards.length === 0 || saving || (selectedHasPoints && !pointValueValid)}
              className="px-5 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-gray-800 hover:bg-gray-700 text-white transition-colors border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Adding...' : `Add Cards ${selectedCards.length > 0 ? `(${selectedCards.length})` : ''}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
