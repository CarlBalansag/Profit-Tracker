import React, { useState, useEffect } from 'react';
import { Search, X, Check, Copy } from 'lucide-react';
import { PRESET_CARDS, ISSUERS } from '../../data/presetCards';
import { IssuerLogo } from './IssuerLogo';
import clsx from 'clsx';

export const QuickAddModal = ({ isOpen, onClose, onAddCards, existingCardIds = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIssuer, setSelectedIssuer] = useState('All Issuers');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedCards, setSelectedCards] = useState([]);
  const [applyPresetRates, setApplyPresetRates] = useState(true);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIssuer('All Issuers');
      setSelectedCards([]);
      setIsDropdownOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredCards = PRESET_CARDS.filter(card => {
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          card.issuer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesIssuer = selectedIssuer === 'All Issuers' || card.issuer === selectedIssuer;
    // Don't show cards that are already added
    const isNotAlreadyAdded = !existingCardIds.includes(card.id);
    
    return matchesSearch && matchesIssuer && isNotAlreadyAdded;
  });

  const toggleCardSelection = (cardId) => {
    setSelectedCards(prev => 
      prev.includes(cardId) 
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  };

  const handleAddSubmit = () => {
    const cardsToAdd = PRESET_CARDS.filter(c => selectedCards.includes(c.id));
    onAddCards(cardsToAdd, applyPresetRates);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#12121A] border border-gray-800 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white">Quick Add Cards</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Controls */}
        <div className="p-4 space-y-4 border-b border-gray-800/50 relative">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search cards..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-300 focus:outline-none focus:border-gray-600"
              />
            </div>
            
            <div className="relative w-48">
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full flex items-center justify-between bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-2 text-sm text-gray-300 focus:outline-none"
              >
                <span className="truncate">{selectedIssuer}</span>
              </button>
              
              {isDropdownOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-[#12121A] border border-gray-800 rounded-lg shadow-xl z-10 py-1 max-h-60 overflow-y-auto">
                  {ISSUERS.map(issuer => (
                     <button
                       key={issuer}
                       onClick={() => { setSelectedIssuer(issuer); setIsDropdownOpen(false); }}
                       className={clsx(
                         "w-full text-left px-4 py-2 text-sm transition-colors",
                         selectedIssuer === issuer ? "bg-blue-600/20 text-blue-400" : "text-gray-300 hover:bg-white/5 hover:text-white"
                       )}
                     >
                       {issuer}
                     </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className={clsx(
            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
            applyPresetRates ? "bg-blue-900/20 border-blue-800/50" : "bg-[#16161E] border-gray-800"
          )}>
            <div className={clsx(
              "w-5 h-5 rounded flex items-center justify-center border",
              applyPresetRates ? "bg-blue-600 border-blue-600" : "border-gray-600"
            )}>
              {applyPresetRates && <Check size={14} className="text-white" />}
            </div>
            <Copy size={16} className={applyPresetRates ? "text-blue-400" : "text-gray-500"} />
            <div>
               <div className={clsx("text-sm font-medium", applyPresetRates ? "text-blue-100" : "text-gray-300")}>Apply Preset Store Rates</div>
               <div className={clsx("text-xs", applyPresetRates ? "text-blue-300/70" : "text-gray-500")}>Automatically add common store-specific cashback rates for each card</div>
            </div>
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 modal-scrollbar smooth-scroll">
          {filteredCards.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">No cards found matching your search.</div>
          ) : (
            filteredCards.map(card => {
              const isSelected = selectedCards.includes(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCardSelection(card.id)}
                  className={clsx(
                    "w-full flex items-center gap-4 p-3 rounded-xl border text-left transition-all",
                    isSelected 
                      ? "bg-[#1c1c28] border-gray-600 shadow-sm" 
                      : "bg-[#16161E] border-transparent hover:border-gray-800"
                  )}
                >
                  <IssuerLogo issuer={card.issuer} brand={card.brand} className="w-12 h-12" />
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-200 truncate">{card.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                      <span>{card.issuer}</span>
                      <span>·</span>
                      <span className="text-gray-400 font-medium">{card.baseRate}% base</span>
                      {card.annualFee > 0 && (
                        <>
                          <span>·</span>
                          <span>${card.annualFee}/yr</span>
                        </>
                      )}
                      {card.storeRatesCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-blue-400">{card.storeRatesCount} store rates</span>
                        </>
                      )}
                    </div>
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
        <div className="p-4 border-t border-gray-800/50 flex justify-end gap-3 bg-[#12121A]">
           <button 
             onClick={onClose}
             className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors border border-transparent hover:border-gray-800"
           >
             Cancel
           </button>
           <button 
             onClick={handleAddSubmit}
             disabled={selectedCards.length === 0}
             className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white transition-colors border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
           >
             Add Cards {selectedCards.length > 0 && `(${selectedCards.length})`}
           </button>
        </div>

      </div>
    </div>
  );
};
