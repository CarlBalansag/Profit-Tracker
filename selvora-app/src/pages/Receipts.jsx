import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../hooks/useApi';
import { Search, Paperclip, Eye, Trash2, FileText, Package, Receipt, X, Upload } from 'lucide-react';
import { toast } from 'sonner';

// ── Helpers ─────────────────────────────────────────────────────────────────────
function isPdfUrl(url) {
  if (!url) return false;
  // Legacy base64 PDF
  if (url.startsWith('data:application/pdf')) return true;
  // Cloudinary PDF (resource_type raw or image with .pdf extension)
  if (url.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

function isImageUrl(url) {
  if (!url) return false;
  return !isPdfUrl(url);
}

// ── Preview Modal ──────────────────────────────────────────────────────────────
function PreviewModal({ dataUrl, onClose }) {
  const isPdf = isPdfUrl(dataUrl);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-w-3xl w-full max-h-[90vh] rounded-xl overflow-hidden bg-[#16181d] border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-medium text-white">Receipt Preview</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto max-h-[80vh] p-2 flex items-center justify-center bg-black/30">
          {isPdf ? (
            <iframe src={dataUrl} title="Receipt PDF" className="w-full h-[75vh] rounded border border-white/10" />
          ) : (
            <img src={dataUrl} alt="Receipt" className="max-w-full max-h-[75vh] object-contain rounded" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Type badge ─────────────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  if (type === 'inventory') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
        <Package className="w-2.5 h-2.5" /> Inventory
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Receipt className="w-2.5 h-2.5" /> Expense
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const Receipts = () => {
  const [tab, setTab]               = useState('without');
  const [withReceipts, setWith]     = useState([]);
  const [withoutReceipts, setWithout] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [attachingId, setAttachingId] = useState(null); // item id with open attach form
  const [detachConfirmId, setDetachConfirmId] = useState(null);
  const [uploading, setUploading]   = useState(false);
  const fileInputRefs = useRef({});

  const fetchAll = async () => {
    try {
      const res = await apiFetch(`/api/receipts`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWith(data.withReceipts || []);
        setWithout(data.withoutReceipts || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleFileChange = async (item, file) => {
    if (!file) return;
    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`File too large. Max ${maxMb}MB.`);
      return;
    }

    setUploading(true);
    try {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await apiFetch(`/api/receipts/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ itemType: item.itemType, itemId: item.id, fileData, fileName: file.name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      toast.success('Receipt attached.');
      setAttachingId(null);
      await fetchAll();
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDetach = async (item) => {
    try {
      const res = await apiFetch(`/api/receipts/detach`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ itemType: item.itemType, itemId: item.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Receipt removed.');
      setDetachConfirmId(null);
      await fetchAll();
    } catch (err) {
      toast.error('Failed to remove receipt: ' + err.message);
    }
  };

  const q = search.toLowerCase();
  const filteredWith    = withReceipts.filter(i => i.name.toLowerCase().includes(q));
  const filteredWithout = withoutReceipts.filter(i => i.name.toLowerCase().includes(q));
  const current = tab === 'with' ? filteredWith : filteredWithout;

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Receipts</h1>
          <p className="text-sm text-gray-400 mt-1">Attach receipts to your inventory purchases and expenses.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
            {withReceipts.length} with receipt
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
            {withoutReceipts.length} missing
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5 w-max">
        {[
          { key: 'without', label: 'Without Receipt', count: withoutReceipts.length },
          { key: 'with',    label: 'With Receipt',    count: withReceipts.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setAttachingId(null); setDetachConfirmId(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === key
                ? 'text-white bg-white/8 border border-white/10 shadow-sm'
                : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
            }`}
          >
            {label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
              tab === key ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-500'
            }`}>{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="w-full bg-[#16181d] border border-white/5 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {/* Table */}
      <div className="card overflow-x-auto bg-[#0f1115] rounded-xl border border-white/6">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/6 text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
              <th className="px-4 py-3.5 min-w-50">Item</th>
              <th className="px-4 py-3.5">Type</th>
              <th className="px-4 py-3.5">Date</th>
              <th className="px-4 py-3.5">Amount</th>
              {tab === 'with' && <th className="px-4 py-3.5">Receipt</th>}
              <th className="px-4 py-3.5 text-right">{tab === 'with' ? 'Actions' : 'Attach'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/3">
            {loading && (
              <tr><td colSpan={tab === 'with' ? 6 : 5} className="px-4 py-10 text-center text-gray-500 text-sm">Loading…</td></tr>
            )}
            {!loading && current.length === 0 && (
              <tr><td colSpan={tab === 'with' ? 6 : 5} className="px-4 py-10 text-center text-gray-500 text-sm">
                {search ? 'No results match your search.' : tab === 'with' ? 'No receipts attached yet.' : 'All items have receipts attached!'}
              </td></tr>
            )}
            {!loading && current.map(item => (
              <React.Fragment key={item.id}>
                <tr className="group hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3.5">
                    <p className="text-sm font-medium text-gray-100 leading-tight truncate max-w-65">{item.name}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <TypeBadge type={item.itemType} />
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-gray-400 bg-white/4 px-2 py-1 rounded-md">
                      {new Date(item.date).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-sm font-semibold text-blue-400">${(item.amount || 0).toFixed(2)}</span>
                  </td>

                  {/* Receipt thumbnail — only in "with" tab */}
                  {tab === 'with' && (
                    <td className="px-4 py-3.5">
                      {isImageUrl(item.receipt_url) ? (
                        <img
                          src={item.receipt_url}
                          alt="receipt thumbnail"
                          className="w-10 h-10 object-cover rounded border border-white/10 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setPreviewUrl(item.receipt_url)}
                        />
                      ) : (
                        <button
                          onClick={() => setPreviewUrl(item.receipt_url)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs transition-colors border border-white/10"
                        >
                          <FileText className="w-3.5 h-3.5" /> PDF
                        </button>
                      )}
                    </td>
                  )}

                  {/* Actions */}
                  <td className="px-4 py-3.5 text-right">
                    {tab === 'with' ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setPreviewUrl(item.receipt_url)}
                          className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white text-xs transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                        {detachConfirmId === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDetach(item)}
                              className="px-2.5 h-7 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                            >Confirm</button>
                            <button
                              onClick={() => setDetachConfirmId(null)}
                              className="px-2 h-7 rounded-lg hover:bg-white/10 text-gray-400 text-xs transition-colors"
                            >Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDetachConfirmId(item.id)}
                            className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 text-xs transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setAttachingId(attachingId === item.id ? null : item.id)}
                        className={`flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium transition-colors border ${
                          attachingId === item.id
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                            : 'bg-white/3 border-white/10 text-gray-400 hover:text-white hover:bg-white/6'
                        }`}
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        {attachingId === item.id ? 'Cancel' : 'Attach'}
                      </button>
                    )}
                  </td>
                </tr>

                {/* Inline attach form row */}
                {tab === 'without' && attachingId === item.id && (
                  <tr className="bg-indigo-950/20">
                    <td colSpan={5} className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Upload className="w-4 h-4 text-indigo-400 shrink-0" />
                        <label className="flex items-center gap-3 cursor-pointer flex-1">
                          <input
                            ref={el => fileInputRefs.current[item.id] = el}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                            className="hidden"
                            onChange={e => handleFileChange(item, e.target.files[0])}
                            disabled={uploading}
                          />
                          <span
                            onClick={() => fileInputRefs.current[item.id]?.click()}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer"
                          >
                            {uploading ? 'Uploading…' : 'Choose File'}
                          </span>
                          <span className="text-xs text-gray-500">PNG, JPG, or PDF · Max 5MB</span>
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {/* Footer count */}
        {!loading && (
          <div className="px-4 py-2.5 border-t border-white/4 text-xs text-gray-600">
            {current.length} item{current.length !== 1 ? 's' : ''}
            {search && ` matching "${search}"`}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewUrl && <PreviewModal dataUrl={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
};

export default Receipts;
