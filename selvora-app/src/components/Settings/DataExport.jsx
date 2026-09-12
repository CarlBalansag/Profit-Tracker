import { useRef, useState } from 'react';
import { exportCategories, exportSnapshot, receiptArchive, transactionExport } from '../../utils/exportData';
import { csvText, downloadFile, downloadJSON } from '../../utils/downloads';

export function DataExport() {
  const [selected, setSelected] = useState(exportCategories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const run = async format => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const snapshot = await exportSnapshot(format === 'csv' ? ['Transactions'] : selected);
      if (format === 'zip') downloadFile('selvora-data.zip', await receiptArchive(snapshot), 'application/zip');
      else if (format === 'csv') downloadFile('selvora-transactions.csv', csvText(transactionExport(snapshot.data.Transactions)), 'text/csv;charset=utf-8');
      else downloadJSON('selvora-data.json', snapshot);
      setNotice('Download prepared.');
    } catch (err) {
      setError(err.message || 'Export failed. Please retry.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-5">
    <h2 className="text-sm font-bold text-white">Export Data</h2>
    <p className="text-xs text-gray-400">Choose stored data to download. Tax scenarios and buyer exports are not available yet.</p>
    <div className="flex gap-3 text-sm">
      <button disabled={busy} onClick={() => setSelected(exportCategories)}>Select all</button>
      <button disabled={busy} onClick={() => setSelected([])}>Deselect all</button>
    </div>
    <div className="space-y-3">
      {[...exportCategories, 'Tax Rules & Scenarios', 'Buyers'].map(category => {
        const available = exportCategories.includes(category);
        return <label key={category} className={`flex items-center gap-3 text-sm ${available ? 'text-gray-300' : 'text-gray-500'}`}>
          <input type="checkbox" checked={selected.includes(category)} disabled={busy || !available} onChange={event => setSelected(current => event.target.checked ? [...current, category] : current.filter(value => value !== category))} />
          {category}{!available && ' — unavailable (unfinished feature)'}
        </label>;
      })}
    </div>
    <div className="flex flex-wrap gap-3 text-sm">
      <button className="btn-secondary" disabled={busy || !selected.length} onClick={() => run('json')}>Export as JSON</button>
      <button className="btn-secondary" disabled={busy || !selected.length} onClick={() => run('zip')}>Export with Receipts (ZIP)</button>
      <button className="btn-secondary" disabled={busy || !selected.includes('Transactions')} onClick={() => run('csv')}>Transactions CSV</button>
    </div>
    {busy && <p role="status">Preparing download…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
