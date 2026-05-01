import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export const CustomCardModal = ({ isOpen, onClose, onAddCard, cardToEdit }) => {
  const initialState = {
    name: '',
    type: 'Credit Card',
    issuer: '',
    last4: '',
    baseRate: '0',
    annualFee: '0',
    signupBonus: '0',
    signupBonusReq: '0',
    signupBonusDueDate: '',
    perks: '',
    dateOpened: '',
    notes: '',
  };

  const [formData, setFormData] = useState(initialState);
  const [errors, setErrors] = useState({});

  // Sync form with cardToEdit when it changes
  useEffect(() => {
    if (cardToEdit && isOpen) {
      setFormData({
        ...initialState,
        ...cardToEdit,
        // Ensure numbers are strings for the inputs
        baseRate: cardToEdit.baseRate?.toString() || '0',
        annualFee: cardToEdit.annualFee?.toString() || '0',
        signupBonus: cardToEdit.signupBonus?.toString() || '0',
        signupBonusReq: cardToEdit.signupBonusReq?.toString() || '0',
      });
    } else if (isOpen) {
      setFormData(initialState);
    }
    setErrors({});
  }, [cardToEdit, isOpen]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Card name is required';
    if (!formData.type.trim()) newErrors.type = 'Card type is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    // Process card for state
    const processedCard = {
      ...formData,
      id: cardToEdit?.id || `custom-${Date.now()}`,
      baseRate: parseFloat(formData.baseRate) || 0,
      annualFee: parseFloat(formData.annualFee) || 0,
      signupBonus: parseFloat(formData.signupBonus) || 0,
      signupBonusReq: parseFloat(formData.signupBonusReq) || 0,
      totalSpend: 0,
      availableSpend: 0,
    };

    onAddCard(processedCard);
    setFormData(initialState);
    onClose();
  };

  const isEditing = !!cardToEdit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#12121A] border border-gray-800 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white">{isEditing ? 'Edit Card' : 'Add Card'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 modal-scrollbar smooth-scroll">
          
          {/* Card Name */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              Card Name <span className="text-red-500">*</span>
            </label>
            <input 
              type="text"
              name="name"
              placeholder="e.g., Chase Freedom Flex"
              value={formData.name}
              onChange={handleChange}
              className={clsx(
                "w-full bg-[#0A0A0F] border rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600",
                errors.name ? "border-red-500/50" : "border-gray-800"
              )}
            />
            {errors.name && <p className="text-[10px] text-red-500 font-medium tracking-tight mt-1">{errors.name}</p>}
          </div>

          {/* Type & Issuer */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Type <span className="text-red-500">*</span>
              </label>
              <select 
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
              >
                <option value="Credit Card">Credit Card</option>
                <option value="Debit Card">Debit Card</option>
                <option value="Business Credit">Business Credit</option>
                <option value="Prepaid">Prepaid</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Issuer</label>
              <input 
                type="text"
                name="issuer"
                placeholder="Chase, Amex..."
                value={formData.issuer}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600"
              />
            </div>
          </div>

          {/* Last 4, Cashback, Annual Fee */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Last 4 Digits</label>
              <input 
                type="text"
                name="last4"
                maxLength="4"
                placeholder="0000"
                value={formData.last4}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider text-no-wrap truncate">Default Cashback %</label>
              <input 
                type="number"
                name="baseRate"
                step="0.01"
                min="0"
                value={formData.baseRate}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Annual Fee</label>
              <input 
                type="number"
                name="annualFee"
                min="0"
                value={formData.annualFee}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
          </div>

          {/* Signup Bonus & Spend Requirement */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Signup Bonus $</label>
              <input 
                type="number"
                name="signupBonus"
                min="0"
                value={formData.signupBonus}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Spend Requirement $</label>
              <input 
                type="number"
                name="signupBonusReq"
                min="0"
                value={formData.signupBonusReq}
                onChange={handleChange}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
          </div>

          {/* Signup Bonus Due Date */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Signup Bonus Due Date</label>
            <input 
              type="date"
              name="signupBonusDueDate"
              value={formData.signupBonusDueDate}
              onChange={handleChange}
              className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors appearance-none"
            />
          </div>

          {/* Perks */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Perks (comma-separated)</label>
            <input 
              type="text"
              name="perks"
              placeholder="Airport lounge, transfer partners, annual credits"
              value={formData.perks}
              onChange={handleChange}
              className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600"
            />
          </div>

          {/* Date Opened */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Date Opened</label>
            <input 
              type="date"
              name="dateOpened"
              value={formData.dateOpened}
              onChange={handleChange}
              className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2 pb-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Notes</label>
            <textarea 
              name="notes"
              rows="3"
              placeholder="Any additional details..."
              value={formData.notes}
              onChange={handleChange}
              className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600 resize-none"
            ></textarea>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800/50 flex justify-end gap-3 bg-[#12121A]">
          <button 
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-lg text-sm font-bold text-gray-400 hover:text-white transition-colors border border-transparent hover:border-gray-800"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-lg text-sm font-bold bg-[#1A1A24] border border-gray-700 hover:border-gray-500 text-white transition-all shadow-lg active:scale-95"
          >
            {isEditing ? 'Save Changes' : 'Create Card'}
          </button>
        </div>

      </div>
    </div>
  );
};
