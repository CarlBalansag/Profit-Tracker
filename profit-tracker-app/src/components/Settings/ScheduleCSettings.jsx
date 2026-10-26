import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
export function ScheduleCSettings() {
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    apiFetch('/api/preferences/schedule-c').then(requireSuccessfulResponse).then(response => response.json()).then(data => { if (active) setEnabled(data.enabled); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const change = async () => {
    if (busy.current || enabled === null) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await apiFetch('/api/preferences/schedule-c', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) });
      await requireSuccessfulResponse(response);
      const data = await response.json(); setEnabled(data.enabled);
    } catch (error) { setError(error.message); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="space-y-4 rounded-xl border border-white/10 bg-[#12121A] p-6">
    <h2 className="font-semibold text-white">Schedule C preparation</h2>
    <p className="text-sm text-gray-400">Organize business expenses by tax year. This first worksheet supports cash-method paid expenses with user-confirmed tax treatment. Accrual reporting, sales, inventory, depreciation and your complete return are not included.</p>
    <label className="flex items-center gap-3 text-sm text-white"><input type="checkbox" checked={enabled === true} disabled={saving || enabled === null} onChange={change} />Prepare Schedule C reports</label>
    {enabled && <Link className="inline-block text-purple-300 underline" to="/schedule-c">Open expense worksheet</Link>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {enabled === null && !error && <p className="text-sm text-gray-400">Loading preference…</p>}
  </section>;
}
