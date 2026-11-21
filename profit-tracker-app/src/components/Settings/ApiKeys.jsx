import React, { useEffect, useState } from 'react';
import { Key, Copy, RotateCw, Ban, Plus, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { toast } from 'sonner';
import AiGuideCopy from './AiGuideCopy';
import { AI_GUIDE_BODY, AI_GUIDE_VERSION } from '../../../../shared/aiGuide.mjs';

// Renders the AI guide's plain text (shared/aiGuide.mjs) -- the exact text an
// AI gets from get_ai_guide or the copy buttons -- so the page and the AI can
// never describe the tools differently. ALL-CAPS lines are section headings,
// "- " lines are bullets, "1." lines are steps.
function GuideText({ text }) {
  const blocks = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (/^[A-Z][A-Z0-9 ,'()-]+$/.test(line.trim())) blocks.push({ type: 'h', text: line.trim() });
    else if (/^- /.test(line)) blocks.push({ type: 'li', text: line.slice(2) });
    else if (/^\d+\. /.test(line)) blocks.push({ type: 'li', text: line.replace(/^\d+\. /, ''), step: line.match(/^\d+/)[0] });
    else blocks.push({ type: 'p', text: line });
  }
  // "- tool_name: what it does" shows the tool name in code style.
  const withTool = (t) => {
    const m = /^([a-z_]+(?:, [a-z_]+)*): (.*)$/.exec(t);
    return m ? <><code className="font-mono text-gray-200">{m[1]}</code>: {m[2]}</> : t;
  };
  return (
    <div className="space-y-1.5 text-xs text-gray-400 leading-relaxed break-words">
      {blocks.map((b, i) => {
        if (b.type === 'h') return <h4 key={i} className="pt-3 text-[11px] font-bold text-gray-300 uppercase tracking-wide">{b.text.toLowerCase()}</h4>;
        if (b.type === 'li') return <p key={i} className="pl-4 -indent-3">{b.step ? `${b.step}. ` : '• '}{withTool(b.text)}</p>;
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}

function ToolsGuide() {
  const [open, setOpen] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 sm:px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 flex-shrink-0">
          <BookOpen size={16} />
        </div>
        <div className="flex-1">
          <span className="text-sm font-bold text-white">Guide: what it can do</span>
          <p className="text-[11px] text-gray-500 mt-0.5">How to connect, and the same guide your AI reads.</p>
        </div>
        {open ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-6 pt-1 space-y-5 border-t border-gray-800">
          <div className="space-y-2 pt-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">How to connect</h3>
            <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
              <li>Click <span className="text-gray-300 font-medium">Generate Key</span> above and copy the token — it's shown only once.</li>
              <li>In your AI assistant's MCP settings, add a server pointed at <code className="text-gray-300 font-mono text-[11px] break-all">https://api.profittracker.carltechs.com/mcp</code>, using the token as the bearer auth header.</li>
              <li>Ask it to call <code className="text-gray-300 font-mono text-[11px]">get_ai_guide</code> first, then something like <span className="text-gray-400 italic">"What do I still owe on my credit cards?"</span></li>
            </ol>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowGuide(v => !v)}
              aria-expanded={showGuide}
              className="page-btn page-btn-secondary"
            >
              {showGuide ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {showGuide ? 'Hide the guide' : `Show the guide (version ${AI_GUIDE_VERSION})`}
            </button>
            {showGuide && <GuideText text={AI_GUIDE_BODY} />}
          </div>
        </div>
      )}
    </div>
  );
}

const fmtDate = (value) => (value ? new Date(value).toLocaleString() : '—');

// Which AI guide version the AI using this key last pulled with get_ai_guide.
function guideStatus(version) {
  if (!version) return { text: 'AI guide: not pulled yet', tone: 'text-gray-600' };
  if (Number.parseFloat(version) >= Number.parseFloat(AI_GUIDE_VERSION)) return { text: `AI guide: up to date (${version})`, tone: 'text-emerald-400' };
  return { text: `AI guide: read ${version}, now ${AI_GUIDE_VERSION} — it catches up next time it calls get_ai_guide`, tone: 'text-amber-400' };
}

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
        <button aria-label="Copy" onClick={copy} className="p-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 flex-shrink-0">
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

  // Binding cashout writes through MCP (commit, change, withdraw, send
  // tracking) are off for every key until turned on here.
  const setCashoutWrites = async (id, allow) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/api-keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_cashout_writes: allow }),
      });
      await requireSuccessfulResponse(res, 'Could not change this key');
      await load();
      toast.success(allow ? 'This key can now make cashout commitments and send tracking.' : 'Cashout writes turned off for this key.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Next get_ai_guide call from this key returns the whole guide again.
  const resetGuide = async (id) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/api-keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_ai_guide: true }),
      });
      await requireSuccessfulResponse(res, 'Could not change this key');
      await load();
      toast.success('Its AI gets the whole guide the next time it calls get_ai_guide.');
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
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
        {/* Phones: the button sits under the description instead of squeezing beside it. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
            className="flex shrink-0 items-center gap-1.5 self-start px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
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
                {/* min-w-0 lets this column shrink on a phone so the rotate and
                    revoke buttons beside it stay inside the row. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200 font-medium">{key.name || 'Unnamed key'}</span>
                    {key.revoked_at && (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20">Revoked</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-600 font-mono">{key.key_prefix}…</p>
                  <p className="text-[11px] text-gray-600">Created {fmtDate(key.created_at)} · Last used {fmtDate(key.last_used_at)}</p>
                  {!key.revoked_at && (() => {
                    const status = guideStatus(key.ai_guide_version);
                    return (
                      <div className="flex flex-wrap items-center gap-x-2">
                        <p className={`text-[11px] ${status.tone}`} data-testid="key-guide-status">{status.text}</p>
                        {key.ai_guide_version && (
                          <button
                            type="button"
                            onClick={() => resetGuide(key.id)}
                            disabled={busyId === key.id}
                            className="text-left text-[11px] text-gray-400 underline underline-offset-2 hover:text-white disabled:opacity-50"
                          >
                            Send the full guide again
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {!key.revoked_at && (
                    <label className="mt-2 flex items-start gap-2 text-[11px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(key.allow_cashout_writes)}
                        disabled={busyId === key.id}
                        onChange={(e) => setCashoutWrites(key.id, e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Allow cashout writes
                        <span className="block text-gray-600">Lets this key commit to cashout deals, change or withdraw commitments, and send tracking. These are binding with the cashout.</span>
                      </span>
                    </label>
                  )}
                </div>
                {!key.revoked_at && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => rotate(key.id)}
                      disabled={busyId === key.id}
                      title="Issue a new key and invalidate this one"
                      aria-label="Rotate key"
                      className="p-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50"
                    >
                      <RotateCw size={14} />
                    </button>
                    <button
                      onClick={() => revoke(key.id)}
                      disabled={busyId === key.id}
                      title="Revoke this key"
                      aria-label="Revoke key"
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

      <AiGuideCopy />

      <ToolsGuide />
    </div>
  );
};
