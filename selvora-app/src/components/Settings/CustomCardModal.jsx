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
    statement_close_day: '',
    due_day: '',
    credit_limit: '',
    min_payment_pct: '',
  };

  const [formData, setFormData] = useState(initialState);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (cardToEdit && isOpen) {
      setFormData({
        ...initialState,
        ...cardToEdit,
        baseRate: cardToEdit.baseRate?.toString() || '0',
        statement_close_day: cardToEdit.statement_close_day?.toString() || '',
        due_day: cardToEdit.due_day?.toString() || '',
        credit_limit: cardToEdit.credit_limit?.toString() || '',
        min_payment_pct: cardToEdit.min_payment_pct?.toString() || '',
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
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Card name is required';
    if (!formData.type.trim()) newErrors.type = 'Card type is required';
    const closeDay = parseInt(formData.statement_close_day);
    const dueDay = parseInt(formData.due_day);
    if (formData.statement_close_day && (isNaN(closeDay) || closeDay < 1 || closeDay > 28))
      newErrors.statement_close_day = 'Must be 1–28';
    if (formData.due_day && (isNaN(dueDay) || dueDay < 1 || dueDay > 28))
      newErrors.due_day = 'Must be 1–28';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const processedCard = {
      ...formData,
      id: cardToEdit?.id || `custom-${Date.now()}`,
      baseRate: parseFloat(formData.baseRate) || 0,
      statement_close_day: formData.statement_close_day ? parseInt(formData.statement_close_day) : null,
      due_day: formData.due_day ? parseInt(formData.due_day) : null,
      credit_limit: formData.credit_limit ? parseFloat(formData.credit_limit) : null,
      min_payment_pct: formData.min_payment_pct ? parseFloat(formData.min_payment_pct) : null,
    };

    onAddCard(processedCard);
    setFormData(initialState);
    onClose();
  };

  const isEditing = !!cardToEdit;

  const inputClass = (field) => clsx(
    "w-full bg-[#0A0A0F] border rounded-lg px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors placeholder:text-gray-600",
    errors[field] ? "border-red-500/50" : "border-gray-800"
  );

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
              className={inputClass('name')}
            />
            {errors.name && <p className="text-[10px] text-red-500 font-medium mt-1">{errors.name}</p>}
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
                className={inputClass('issuer')}
              />
            </div>
          </div>

          {/* Last 4 & Default Cashback */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Last 4 Digits</label>
              <input
                type="text"
                name="last4"
                maxLength="4"
                placeholder="0000"
                value={formData.last4}
                onChange={handleChange}
                className={inputClass('last4')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Default Cashback %</label>
              <input
                type="number"
                name="baseRate"
                step="0.01"
                min="0"
                value={formData.baseRate}
                onChange={handleChange}
                className={inputClass('baseRate')}
              />
            </div>
          </div>

          {/* Billing & Limits */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Billing & Limits</p>
              <p className="text-[11px] text-gray-600 mt-0.5">Optional — used to show payment due dates and utilization on the Credit Card page</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Statement Closes (Day)</label>
                <input
                  type="number"
                  name="statement_close_day"
                  min="1"
                  max="28"
                  placeholder="e.g. 15"
                  value={formData.statement_close_day}
                  onChange={handleChange}
                  className={inputClass('statement_close_day')}
                />
                {errors.statement_close_day && <p className="text-[10px] text-red-500 font-medium mt-1">{errors.statement_close_day}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Payment Due (Day)</label>
                <input
                  type="number"
                  name="due_day"
                  min="1"
                  max="28"
                  placeholder="e.g. 6"
                  value={formData.due_day}
                  onChange={handleChange}
                  className={inputClass('due_day')}
                />
                {errors.due_day && <p className="text-[10px] text-red-500 font-medium mt-1">{errors.due_day}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Credit Limit ($)</label>
                <input
                  type="number"
                  name="credit_limit"
                  min="0"
                  step="100"
                  placeholder="e.g. 5000"
                  value={formData.credit_limit}
                  onChange={handleChange}
                  className={inputClass('credit_limit')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Min Payment (%)</label>
                <input
                  type="number"
                  name="min_payment_pct"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2.0"
                  value={formData.min_payment_pct}
                  onChange={handleChange}
                  className={inputClass('min_payment_pct')}
                />
              </div>
            </div>
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
