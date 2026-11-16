import React, { useEffect, useState } from 'react';
import { UserPlus, Copy, Plus, Trash2, Check, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { toast } from 'sonner';

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

function NewInviteBanner({ invite, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}/login?invite=${invite.token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Invite link copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically — select and copy the link manually.');
    }
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
          <CheckCircle2 size={14} /> New Invite Link Created (Valid for 3 days)
        </p>
        <span className="text-[11px] text-gray-500">Single use only</span>
      </div>
      <p className="text-xs text-gray-400">
        Send this link to the person you want to invite. Once they register and verify their email, the link will expire automatically.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={inviteUrl}
          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono select-all focus:outline-none"
          onClick={(e) => e.target.select()}
        />
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors flex-shrink-0"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy Link'}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[11px] text-gray-500 hover:text-white transition-colors"
      >
        Done with this link — hide
      </button>
    </div>
  );
}

export const AdminInvites = () => {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [latestInvite, setLatestInvite] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/invites');
      await requireSuccessfulResponse(res, 'Could not load invites');
      setInvites(await res.json());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createInvite = async () => {
    setCreating(true);
    try {
      const res = await apiFetch('/api/invites', { method: 'POST' });
      await requireSuccessfulResponse(res, 'Could not create invite');
      const data = await res.json();
      setLatestInvite(data);
      setInvites((prev) => [data, ...prev]);
      toast.success('Invite link generated!');
    } catch (err) {
      toast.error(err.message || 'Failed to create invite.');
    } finally {
      setCreating(false);
    }
  };

  const deleteInvite = async (id) => {
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/invites/${id}`, { method: 'DELETE' });
      await requireSuccessfulResponse(res, 'Could not delete invite');
      setInvites((prev) => prev.filter((i) => i.id !== id));
      if (latestInvite?.id === id) setLatestInvite(null);
      toast.success('Invite revoked.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <UserPlus className="text-purple-400" size={18} />
              <h2 className="text-sm font-bold text-white">Member Invites</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Profit Tracker is private. Generate single-use 3-day invite links to let trusted resellers sign up.
            </p>
          </div>
          <button
            type="button"
            onClick={createInvite}
            disabled={creating}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent,#8B5CF6)] hover:opacity-90 transition-opacity text-white text-xs font-semibold disabled:opacity-50 flex-shrink-0"
          >
            <Plus size={14} />
            {creating ? 'Generating…' : 'Create Invite Link'}
          </button>
        </div>

        {latestInvite && (
          <NewInviteBanner
            invite={latestInvite}
            onDismiss={() => setLatestInvite(null)}
          />
        )}

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">
            Invite History
          </h3>

          {loading ? (
            <p className="text-xs text-gray-500 py-4">Loading invites…</p>
          ) : invites.length === 0 ? (
            <p className="text-xs text-gray-500 py-4">No invites generated yet.</p>
          ) : (
            <div className="divide-y divide-gray-800/60 border border-gray-800 rounded-lg overflow-hidden bg-[#0A0A0F]">
              {invites.map((inv) => {
                const isConsumed = inv.consumed || inv.status === 'used';
                const isExpired = !isConsumed && (inv.status === 'expired' || new Date(inv.expires_at) <= new Date());
                const isActive = !isConsumed && !isExpired;

                return (
                  <div
                    key={inv.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.01] transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {isActive && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Clock size={11} /> Active (Unused)
                          </span>
                        )}
                        {isConsumed && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
                            <CheckCircle2 size={11} /> Claimed
                          </span>
                        )}
                        {isExpired && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle size={11} /> Expired
                          </span>
                        )}
                        <span className="text-xs text-gray-400 font-mono">
                          ID: {inv.id.slice(0, 8)}…
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 space-x-3">
                        <span>Created: {fmtDate(inv.created_at)}</span>
                        <span>•</span>
                        <span>
                          {isConsumed
                            ? `Used by: ${inv.used_by || 'Unknown user'}`
                            : `Expires: ${fmtDate(inv.expires_at)}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => deleteInvite(inv.id)}
                        disabled={deletingId === inv.id}
                        className="p-1.5 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                        title="Delete invite"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminInvites;
