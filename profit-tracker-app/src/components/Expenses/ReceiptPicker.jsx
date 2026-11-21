import { useId, useState } from 'react';
import { RECEIPT_ACCEPT, validateReceiptFile } from '../../hooks/receiptUpload';
import { READABLE_RECEIPT_TYPES, readReceiptOnDevice } from '../../utils/readReceipt';

/**
 * A receipt for an expense: picked here, uploaded privately after the expense
 * saves. For a photo, "Read it on this device" fills in the store, amount and
 * date: text recognition runs in this browser and the image isn't sent
 * anywhere to be read. Nothing runs until it's asked for.
 */
export function ReceiptPicker({ file, onFile, onRead, disabled = false, read = readReceiptOnDevice }) {
  const id = useId();
  const [state, setState] = useState({ busy: false, progress: 0, error: '', result: null });
  const pick = (e) => {
    const chosen = e.target.files?.[0] || null;
    e.target.value = '';
    if (!chosen) return;
    try { validateReceiptFile(chosen); } catch (err) { setState({ busy: false, progress: 0, error: err.message, result: null }); return; }
    setState({ busy: false, progress: 0, error: '', result: null });
    onFile(chosen);
  };
  const runRead = async () => {
    setState({ busy: true, progress: 0, error: '', result: null });
    try {
      const result = await read(file, (progress) => setState((s) => ({ ...s, progress })));
      setState({ busy: false, progress: 100, error: '', result });
      onRead(result);
    } catch (err) {
      setState({ busy: false, progress: 0, error: err.message || 'Could not read the receipt. Enter the details by hand.', result: null });
    }
  };
  const readable = file && READABLE_RECEIPT_TYPES.has(file.type);
  const found = state.result && [state.result.merchant, state.result.total && `$${state.result.total}`, state.result.date].filter(Boolean);

  return <div>
    <label htmlFor={id} className="block text-xs font-medium text-gray-400 mb-1.5">Receipt <span className="text-gray-600">(optional)</span></label>
    {!file ? <input id={id} type="file" accept={RECEIPT_ACCEPT} disabled={disabled} onChange={pick}
      className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-gray-200" />
      : <div className="space-y-2 rounded-lg border border-white/10 p-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-gray-300">{file.name}</span>
          <button type="button" disabled={disabled || state.busy} onClick={() => { onFile(null); setState({ busy: false, progress: 0, error: '', result: null }); }} className="shrink-0 text-gray-400 underline">Remove</button>
        </div>
        {readable && <>
          <button type="button" disabled={disabled || state.busy} onClick={runRead} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-purple-300 disabled:opacity-60">
            {state.busy ? `Reading… ${state.progress}%` : 'Read it on this device'}
          </button>
          <p className="text-[11px] text-gray-500">Fills in the store, amount and date. The image stays in this browser to be read; the free reader (a few MB) downloads once from a public code site.</p>
        </>}
        {found && (found.length
          ? <p role="status" className="text-xs text-emerald-300">Read: {found.join(' · ')}. Check them before saving.</p>
          : <p role="status" className="text-xs text-amber-300">Couldn&apos;t find the details on this receipt. Enter them by hand.</p>)}
        <p className="text-[11px] text-gray-500">Saved privately with the expense: only you can open it, through ProfitTracker.</p>
      </div>}
    {state.error && <p role="alert" className="mt-1 text-xs text-red-400">{state.error}</p>}
  </div>;
}
