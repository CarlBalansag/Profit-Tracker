import React, { useEffect, useState } from 'react';
import { Key, Copy, RotateCw, Ban, Plus } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { toast } from 'sonner';

const fmtDate = (value) => (value ? new Date(value).toLocaleString() : '—');

// The raw token is only ever available in the response of create/rotate --
// the server stores only its hash and will never return it again. This
// component is the one place in the app that ever sees it in the clear.
function NewTokenBanner({ token, onDismiss }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Could not copy — select and copy the token manually.');
    }
  };
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-2">
      <p className="text-xs font-bold text-purple-300 uppercase tracking-wide">New API key — copy it now</p>
      <p className="text-[11px] text-gray-500">This is the only time this key is shown. Paste it into your AI assistant's MCP configuration as the bearer token.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 break-all">{token}</code>
        <button onClick={copy} className="p-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 flex-shrink-0">
          <Copy size={14} />
        </button>
      </div>
      <button onClick={onDismiss} className="text-[11px] text-gray-500 hover:text-white">I've saved it — hide this</button>
    </div>
  );
}

export const ApiKeys = () => {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch('/api/api-keys');
      await requireSuccessfulResponse(res, 'Could not load API keys');
      setKeys(await res.json());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    try {
      const res = await apiFetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Claude MCP' }),
      });
      await requireSuccessfulResponse(res, 'Could not create API key');
      const created = await res.json();
      setNewToken(created.token);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const rotate = async (id) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/api-keys/${id}/rotate`, { method: 'POST' });
      await requireSuccessfulResponse(res, 'Could not rotate API key');
      const rotated = await res.json();
      setNewToken(rotated.token);
      await load();
      toast.success('Key rotated — the old one no longer works.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (id) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      await requireSuccessfulResponse(res, 'Could not revoke API key');
      await load();
      toast.success('Key revoked.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Key size={16} /> AI Assistant Access</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-lg">
            Lets your AI finance assistant read and update your data over MCP, without logging in through the browser.
            Give it the key below as a bearer token — never your login password.
          </p>
        </div>
        <button
          onClick={create}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
        >
          <Plus size={14} /> {creating ? 'Generating...' : 'Generate Key'}
        </button>
      </div>

      {newToken && <NewTokenBanner token={newToken} onDismiss={() => setNewToken(null)} />}

      {loading ? (
        <p className="text-xs text-gray-600">Loading...</p>
      ) : keys.length === 0 ? (
        <p className="text-xs text-gray-600">No API keys yet. Generate one to connect an AI assistant.</p>
      ) : (
        <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg overflow-hidden">
          {keys.map((key) => (
            <div key={key.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200 font-medium">{key.name || 'Unnamed key'}</span>
                  {key.revoked_at && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20">Revoked</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-600 font-mono">{key.key_prefix}…</p>
                <p className="text-[11px] text-gray-600">Created {fmtDate(key.created_at)} · Last used {fmtDate(key.last_used_at)}</p>
              </div>
              {!key.revoked_at && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => rotate(key.id)}
                    disabled={busyId === key.id}
                    title="Issue a new key and invalidate this one"
                    className="p-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50"
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    onClick={() => revoke(key.id)}
                    disabled={busyId === key.id}
                    title="Revoke this key"
                    className="p-2 rounded-lg border border-white/10 text-gray-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Ban size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
