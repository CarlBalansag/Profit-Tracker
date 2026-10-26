import React, { useEffect, useState } from 'react';
import { Key, Copy, RotateCw, Ban, Plus, ChevronDown, ChevronRight, Eye, Pencil, BookOpen } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { toast } from 'sonner';

// Kept in sync with the tool list in profit-tracker-api/routes/mcp.js and README.md's
// "MCP Server" section -- this is the same set, just in plain-English form for
// someone setting up their assistant rather than a developer reading the code.
const READ_TOOLS = [
  { name: 'list_sales', args: 'start_date?, end_date?, buyer?, payout_status?, limit?', description: 'Look up sales by date range, buyer, or payout status.' },
  { name: 'list_inventory', args: 'status?', description: 'Look up purchases, optionally filtered by status.' },
  { name: 'list_expenses', args: 'start_date?, end_date?, category?', description: 'Look up business expenses by date or category.' },
  { name: 'get_cashflow_summary', args: '', description: "What's owed to you, what you've spent, and what's sitting in inventory." },
  { name: 'get_unpaid_by_buyer', args: '', description: 'Who still owes you money, grouped by marketplace or cashout.' },
  { name: 'list_shipments', args: 'direction?, status?, missing_tracking?', description: "What's still in transit — inbound purchases or outbound sales." },
  { name: 'get_card_net_to_pay', args: 'month?', description: 'What you still owe on each credit card, plus the next due date.' },
  { name: 'list_changes', args: 'limit?, record_id?', description: 'History of edits the assistant has made, so you can review or correct one.' },
];

const WRITE_TOOLS = [
  { name: 'add_purchase', args: 'item, qty, unit_cost, store, card_used, purchase_date, …', description: 'Log a new purchase. The store is created automatically if new.' },
  { name: 'add_sale', args: 'inventory_id, qty, sale_price, sale_date, platform, …', description: 'Log a new sale against an existing purchase.' },
  { name: 'add_expense', args: 'description, amount, date, paid_from_account, …', description: 'Log a business expense.' },
  { name: 'update_purchase', args: 'purchase_id, …', description: 'Edit an existing purchase — quantity, cost, tracking, order number, and more.' },
  { name: 'update_sale', args: 'sale_id, …', description: 'Edit an existing sale — price, fees, tracking, and more.' },
  { name: 'update_shipment', args: 'item_id, tracking_number?, carrier?, status?', description: 'Update the tracking number, carrier, or shipping status on a purchase or sale.' },
  { name: 'mark_sale_paid', args: 'sale_ids[], payout_date, payout_amount, …', description: 'Mark one or more sales as paid from a single deposit.' },
];

function ToolRow({ tool }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="text-xs text-gray-200 font-mono">{tool.name}</code>
        {tool.args && <code className="text-[11px] text-gray-600 font-mono">({tool.args})</code>}
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5">{tool.description}</p>
    </div>
  );
}

function ToolsGuide() {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 flex-shrink-0">
          <BookOpen size={16} />
        </div>
        <div className="flex-1">
          <span className="text-sm font-bold text-white">Guide: what it can do</span>
          <p className="text-[11px] text-gray-500 mt-0.5">How to connect, and every tool your assistant has access to.</p>
        </div>
        {open ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-6 pb-6 pt-1 space-y-6 border-t border-gray-800">
          <div className="space-y-2 pt-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">How to connect</h3>
            <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
              <li>Click <span className="text-gray-300 font-medium">Generate Key</span> above and copy the token — it's shown only once.</li>
              <li>In your AI assistant's MCP settings, add a server pointed at <code className="text-gray-300 font-mono text-[11px]">https://api.profittracker.carltechs.com/mcp</code>, using the token as the bearer auth header.</li>
              <li>Ask it something like <span className="text-gray-400 italic">"What do I still owe on my credit cards?"</span> or <span className="text-gray-400 italic">"Mark my eBay sales from this week as paid."</span></li>
            </ol>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
              <Eye size={12} /> Read — {READ_TOOLS.length} tools
            </h3>
            <div className="divide-y divide-gray-800/60">
              {READ_TOOLS.map((tool) => <ToolRow key={tool.name} tool={tool} />)}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
              <Pencil size={12} /> Write — {WRITE_TOOLS.length} tools
            </h3>
            <p className="text-[11px] text-gray-600">No delete tools exist. Every write is logged — review or revert one with <code className="font-mono">list_changes</code>.</p>
            <div className="divide-y divide-gray-800/60">
              {WRITE_TOOLS.map((tool) => <ToolRow key={tool.name} tool={tool} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-4">
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

      <ToolsGuide />
    </div>
  );
};
