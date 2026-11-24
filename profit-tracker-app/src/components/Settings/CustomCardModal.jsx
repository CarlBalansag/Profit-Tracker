import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { renameForRelink } from '../../utils/cardRewards';

// Stored type values: the Credit Card page and calendar only count 'Credit'.
const TYPE_OPTIONS = [
  { value: 'Credit', label: 'Credit Card' },
  { value: 'Debit', label: 'Debit Card' },
  { value: 'Prepaid', label: 'Prepaid' },
];
// Older cards were saved as "Credit Card", "Business Credit", "Debit Card"...
const normalizeType = (type = '') => {
  const t = String(type).toLowerCase();
  if (t.includes('debit')) return 'Debit';
  if (t.includes('prepaid')) return 'Prepaid';
  return 'Credit';
};

const INITIAL_STATE = {
  name: '',
  type: 'Credit',
  issuer: '',
  last4: '',
  baseRate: '0',
  rewardType: 'cashback',
  pointsBaseRate: '1',
  pointValueCents: '1',
  rewardsLabel: '',
  statement_close_day: '',
  due_day: '',
  credit_limit: '',
  min_payment_pct: '',
  is_personal: false,
};

export const CustomCardModal = ({ isOpen, onClose, onAddCard, cardToEdit, defaultType = null }) => {
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // A catalog card picked in "Card from the list", applied on save.
  const [relinkTo, setRelinkTo] = useState(null);
  const modalRef = useModalKeyboard(isOpen, () => { if (!saving) onClose(); });

  useEffect(() => {
    if (cardToEdit && isOpen) {
      setFormData({
        ...INITIAL_STATE,
        ...cardToEdit,
        type: normalizeType(cardToEdit.rawType ?? cardToEdit.type),
        baseRate: cardToEdit.baseRate?.toString() || '0',
        rewardType: cardToEdit.rewardType === 'points' ? 'points' : 'cashback',
        pointsBaseRate: (cardToEdit.pointsBaseRate ?? 1).toString(),
        pointValueCents: (cardToEdit.pointValueCents ?? 1).toString(),
        rewardsLabel: cardToEdit.rewardsLabel || '',
        statement_close_day: cardToEdit.statement_close_day?.toString() || '',
        due_day: cardToEdit.due_day?.toString() || '',
        credit_limit: (cardToEdit.credit_limit ?? cardToEdit.creditLimit)?.toString() || '',
        min_payment_pct: cardToEdit.min_payment_pct?.toString() || '',
      });
    } else if (isOpen) {
      setFormData({ ...INITIAL_STATE, type: defaultType ? normalizeType(defaultType) : INITIAL_STATE.type });
    }
    setRelinkTo(null);
    setErrors({});
  }, [cardToEdit, isOpen, defaultType]);

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
    if (relinkTo) {
      // Rewards come from the picked card; only a points card's value is ours.
      const cents = Number(formData.pointValueCents);
      if (relinkTo.reward_type === 'points' && (formData.pointValueCents === '' || !Number.isFinite(cents) || cents <= 0 || cents > 100)) {
        newErrors.pointValueCents = 'Enter a value above 0 and up to 100';
      }
    } else if (formData.rewardType === 'points') {
      const pts = Number(formData.pointsBaseRate);
      if (formData.pointsBaseRate === '' || !Number.isFinite(pts) || pts < 0) newErrors.pointsBaseRate = 'Enter points per $1 of 0 or greater';
      const cents = Number(formData.pointValueCents);
      if (formData.pointValueCents === '' || !Number.isFinite(cents) || cents <= 0 || cents > 100) newErrors.pointValueCents = 'Enter a value above 0 and up to 100';
    } else {
      const baseRate = Number(formData.baseRate);
      if (!Number.isFinite(baseRate) || baseRate < 0) newErrors.baseRate = 'Enter a cashback rate of 0 or greater';
    }
    const closeDay = parseInt(formData.statement_close_day);
    const dueDay = parseInt(formData.due_day);
    if (formData.statement_close_day && (isNaN(closeDay) || closeDay < 1 || closeDay > 28))
      newErrors.statement_close_day = 'Must be 1–28';
    if (formData.due_day && (isNaN(dueDay) || dueDay < 1 || dueDay > 28))
      newErrors.due_day = 'Must be 1–28';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const processedCard = {
      ...formData,
      id: cardToEdit?.id || `custom-${Date.now()}`,
      baseRate: parseFloat(formData.baseRate) || 0,
      rewardType: formData.rewardType,
      pointsBaseRate: formData.rewardType === 'points' ? Number(formData.pointsBaseRate) : null,
      pointValueCents: formData.rewardType === 'points' ? Number(formData.pointValueCents) : null,
      rewardsLabel: formData.rewardType === 'points' ? (formData.rewardsLabel.trim() || null) : null,
      statement_close_day: formData.statement_close_day ? parseInt(formData.statement_close_day) : null,
      due_day: formData.due_day ? parseInt(formData.due_day) : null,
      credit_limit: formData.credit_limit ? parseFloat(formData.credit_limit) : null,
      min_payment_pct: formData.min_payment_pct ? parseFloat(formData.min_payment_pct) : null,
      is_personal: Boolean(formData.is_personal),
      relinkTo,
      relinkPointValueCents: relinkTo?.reward_type === 'points' ? Number(formData.pointValueCents) : null,
    };

    setSaving(true);
    try {
      await onAddCard(processedCard);
      setFormData(INITIAL_STATE);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isEditing = !!cardToEdit;

  const inputClass = (field) => clsx(
    "w-full bg-[var(--dp-card-bg)] border rounded-lg px-4 py-3 text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors placeholder:text-[var(--dp-text-muted)]",
    errors[field] ? "border-red-500/50" : "border-[color:var(--dp-border)]"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs">
      <div ref={modalRef} className="bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-xl w-full max-w-xl dp-elevated overflow-hidden flex flex-col max-h-[90vh] text-[var(--dp-text-primary)]">

        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-[color:var(--dp-border)]">
          <h2 className="text-lg font-bold text-[var(--dp-text-primary)]">{isEditing ? 'Edit Card' : 'Add Card'}</h2>
          <button aria-label="Close" onClick={onClose} className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors">
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
            {errors.name && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.name}</p>}
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
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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

          {/* Last 4 */}
          <div className="space-y-2">
            <label htmlFor="card-last4" className="text-xs font-bold text-gray-400 uppercase tracking-wider">Last 4 Digits</label>
            <input
              id="card-last4"
              type="text"
              name="last4"
              maxLength="4"
              placeholder="0000"
              value={formData.last4}
              onChange={handleChange}
              className={inputClass('last4')}
            />
          </div>

          {/* Which catalog card this card follows (editing a credit card only) */}
          {isEditing && formData.type === 'Credit' && (
            <CatalogLinkPicker
              linkedId={cardToEdit.catalogCardId}
              pending={relinkTo}
              onPick={(card, oldCard) => {
                const same = card.id === cardToEdit.catalogCardId;
                setRelinkTo(same ? null : card);
                // Follow the new card's name unless the user named it themselves.
                setFormData(prev => ({ ...prev, name: same ? cardToEdit.name : renameForRelink(prev.name, oldCard?.name, card.name) }));
                setErrors({});
              }}
              onClear={() => { setRelinkTo(null); setFormData(prev => ({ ...prev, name: cardToEdit.name })); }}
            />
          )}

          {relinkTo ? (
            relinkTo.reward_type === 'points' && (
              <div className="space-y-2">
                <label htmlFor="card-point-value" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Point value (¢)</label>
                <input
                  id="card-point-value"
                  type="number" inputMode="decimal"
                  name="pointValueCents"
                  step="0.05"
                  min="0.01"
                  max="100"
                  value={formData.pointValueCents}
                  onChange={handleChange}
                  className={inputClass('pointValueCents')}
                />
                {errors.pointValueCents && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.pointValueCents}</p>}
                <p className="text-[11px] text-gray-600">What one {relinkTo.rewards_label || 'point'} is worth to you.</p>
              </div>
            )
          ) : (
          /* Rewards: cashback % or points per $1 */
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rewards{formData.type !== 'Credit' ? ' (optional)' : ''}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">
                {formData.type === 'Credit'
                  ? 'Does this card pay cash back, or points/miles (like Amex Membership Rewards)?'
                  : "Most debit cards earn nothing. Leave cashback at 0 if yours doesn't."}
              </p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Reward type">
              {[{ id: 'cashback', label: 'Cashback %' }, { id: 'points', label: 'Points / miles' }].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={formData.rewardType === opt.id}
                  onClick={() => { setFormData(prev => ({ ...prev, rewardType: opt.id })); setErrors({}); }}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                    formData.rewardType === opt.id ? 'bg-gray-800 text-white border-gray-600' : 'text-gray-500 hover:text-gray-300 border-transparent'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {formData.rewardType === 'cashback' ? (
              <div className="space-y-2">
                <label htmlFor="card-base-rate" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Default Cashback %</label>
                <input
                  id="card-base-rate"
                  type="number" inputMode="decimal"
                  name="baseRate"
                  step="0.01"
                  min="0"
                  value={formData.baseRate}
                  onChange={handleChange}
                  className={inputClass('baseRate')}
                />
                {errors.baseRate && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.baseRate}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="card-points-rate" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Points per $1</label>
                  <input
                    id="card-points-rate"
                    type="number" inputMode="decimal"
                    name="pointsBaseRate"
                    step="0.25"
                    min="0"
                    value={formData.pointsBaseRate}
                    onChange={handleChange}
                    className={inputClass('pointsBaseRate')}
                  />
                  {errors.pointsBaseRate && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.pointsBaseRate}</p>}
                  {isEditing && cardToEdit.catalogCardId && (
                    <p className="text-[11px] text-amber-300/80">Changing this stops automatic rate updates for this card.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label htmlFor="card-point-value" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Point value (¢)</label>
                  <input
                    id="card-point-value"
                    type="number" inputMode="decimal"
                    name="pointValueCents"
                    step="0.05"
                    min="0.01"
                    max="100"
                    value={formData.pointValueCents}
                    onChange={handleChange}
                    className={inputClass('pointValueCents')}
                  />
                  {errors.pointValueCents && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.pointValueCents}</p>}
                </div>
                <div className="space-y-2" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="card-rewards-label" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Program name</label>
                  <input
                    id="card-rewards-label"
                    type="text"
                    name="rewardsLabel"
                    maxLength="80"
                    placeholder="e.g., Membership Rewards points"
                    value={formData.rewardsLabel}
                    onChange={handleChange}
                    className={inputClass('rewardsLabel')}
                  />
                  <p className="text-[11px] text-gray-600">
                    {(() => {
                      const pts = Number(formData.pointsBaseRate) || 0;
                      const cents = Number(formData.pointValueCents) || 0;
                      return `Counts as ${Math.round(pts * cents * 100) / 100}% back in your totals (${pts}x × ${cents}¢). Store rates on this card are re-priced when you change the point value.`;
                    })()}
                  </p>
                </div>
              </div>
            )}
          </div>
          )}

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
                  type="number" inputMode="decimal"
                  name="statement_close_day"
                  min="1"
                  max="28"
                  placeholder="e.g. 15"
                  value={formData.statement_close_day}
                  onChange={handleChange}
                  className={inputClass('statement_close_day')}
                />
                {errors.statement_close_day && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.statement_close_day}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Payment Due (Day)</label>
                <input
                  type="number" inputMode="decimal"
                  name="due_day"
                  min="1"
                  max="28"
                  placeholder="e.g. 6"
                  value={formData.due_day}
                  onChange={handleChange}
                  className={inputClass('due_day')}
                />
                {errors.due_day && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.due_day}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Credit Limit ($)</label>
                <input
                  type="number" inputMode="decimal"
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
                  type="number" inputMode="decimal"
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

          {/* Personal account flag — drives the "owed to personal account" calculation */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-800 bg-[#0A0A0F] cursor-pointer">
            <input
              type="checkbox"
              name="is_personal"
              checked={!!formData.is_personal}
              onChange={(e) => setFormData(prev => ({ ...prev, is_personal: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-purple-500"
            />
            <span>
              <span className="block text-xs font-bold text-gray-300">This is a personal account/card</span>
              <span className="block text-[11px] text-gray-600 mt-0.5">
                Purchases and expenses paid from here count toward how much the business owes you back.
              </span>
            </span>
          </label>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800/50 flex justify-end gap-3 bg-[#12121A]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg text-sm font-bold text-gray-400 hover:text-white transition-colors border border-transparent hover:border-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg text-sm font-bold bg-[#1A1A24] border border-gray-700 hover:border-gray-500 text-white transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create Card')}
          </button>
        </div>

      </div>
    </div>
  );
};
