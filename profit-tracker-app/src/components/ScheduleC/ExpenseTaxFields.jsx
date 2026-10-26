import { taxCategories } from '../../../../shared/scheduleC.mjs';
const inputClass = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white';
function Field({ label, children }) { return <label className="block space-y-1 text-xs text-gray-400"><span>{label}</span>{children}</label>; }
export function ExpenseTaxFields({ value, onChange, disabled = false }) {
  const set = (key, next) => onChange({ ...value, [key]: next, reviewed: false });
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-purple-500/20 p-3">
    <legend className="px-1 text-sm font-medium text-purple-300">Schedule C business details</legend>
    <p className="text-xs text-gray-400">Save incomplete details now and finish them in the worksheet review queue.</p>
    <Field label="Business use"><select className={inputClass} value={value.business_use} onChange={e => set('business_use', e.target.value)}>
      <option value="unreviewed">Not classified yet</option><option value="business">100% business</option><option value="mixed">Mixed business and personal</option><option value="personal">Personal — excluded</option>
    </select></Field>
    {value.business_use !== 'personal' && <>
      {value.business_use === 'mixed' && <Field label="Business-use percentage"><input className={inputClass} type="number" min="0.01" max="100" step="0.01" value={value.business_percent} onChange={e => set('business_percent', e.target.value)} /></Field>}
      <Field label="Payee / vendor"><input className={inputClass} maxLength={1000} value={value.payee} onChange={e => set('payee', e.target.value)} /></Field>
      <Field label="Business purpose"><input className={inputClass} maxLength={1000} placeholder="e.g. Tape for packing customer orders" value={value.purpose} onChange={e => set('purpose', e.target.value)} /></Field>
      <Field label="Tax category"><select className={inputClass} value={value.tax_category} onChange={e => set('tax_category', e.target.value)}><option value="">Needs classification</option>{taxCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></Field>
      <p className="text-xs text-gray-500">Postage labels are separate from boxes, tape and blank labels. Inventory purchases and equipment need separate tax treatment.</p>
      <Field label="Payment status"><select className={inputClass} value={value.payment_status} onChange={e => onChange({ ...value, payment_status: e.target.value, paid_date: e.target.value === 'paid' ? value.paid_date : '', reviewed: false })}><option value="unknown">Unknown — review later</option><option value="paid">Paid</option><option value="unpaid">Not paid yet</option></select></Field>
      {value.payment_status === 'paid' && <Field label="Payment date"><input type="date" className={inputClass} value={value.paid_date} onChange={e => set('paid_date', e.target.value)} /></Field>}
      <Field label="Payment evidence reference"><input className={inputClass} maxLength={1000} placeholder="e.g. Visa statement Sep 2026, transaction 123" value={value.payment_reference} onChange={e => set('payment_reference', e.target.value)} /></Field>
      <label className="flex items-start gap-2 text-xs text-gray-300"><input type="checkbox" checked={value.reviewed} onChange={e => onChange({ ...value, reviewed: e.target.checked })} /><span>I reviewed the business use, payment evidence, category and deduction timing for the payment year. Supplies included here are eligible for that year.</span></label>
    </>}
  </fieldset>;
}
