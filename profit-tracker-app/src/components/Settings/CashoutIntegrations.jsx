import React, { useState } from 'react';
import { KeyRound, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCashoutConnections, useCashoutMutations, useCashoutProviders } from '../../hooks/useApi';

// The one place API keys are entered. Only cashouts with a working integration
// appear here, so every other cashout stays a plain manual entry.
export function CashoutIntegrations() {
  const { data: providers = [], isLoading: providersLoading, error: providersError } = useCashoutProviders();
  const { data: connections = [], isLoading: connectionsLoading, error: connectionsError } = useCashoutConnections();

  if (providersLoading || connectionsLoading) return null;

  if (providersError || connectionsError) {
    return <p className="text-sm text-red-400">Could not load cashout integrations. Reload the page to try again.</p>;
  }

  if (providers.length === 0) return null;

  return (
    <section aria-label="Cashout integrations" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">Integrations</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Connect an API key to see that cashout's live deals on the Cashout page.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {providers.map((provider) => (
          <IntegrationCard
            key={provider.id}
            provider={provider}
            connection={connections.find((c) => c.provider === provider.id) || null}
          />
        ))}
      </div>
    </section>
  );
}

function KeyForm({ label, submitLabel, onSubmit, onCancel }) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('API key is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(apiKey.trim());
      setApiKey('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        type="password"
        aria-label={label}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="Paste your API key"
        autoComplete="off"
        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-white/10 bg-[#0d0d18] text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50"
      />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {saving && <RefreshCw size={12} className="animate-spin" />}
          {saving ? 'Verifying Key…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
            Cancel
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-600">It's checked with the provider, then stored encrypted.</p>
    </form>
  );
}

function IntegrationCard({ provider, connection }) {
  const { addConnection, updateConnection, deleteConnection, testConnection } = useCashoutMutations();
  const [replacing, setReplacing] = useState(false);
  const [testing, setTesting] = useState(false);

  const connect = async (apiKey) => {
    await addConnection.mutateAsync({ provider: provider.id, api_key: apiKey });
    toast.success(`${provider.name} connected.`);
  };

  const replaceKey = async (apiKey) => {
    await updateConnection.mutateAsync({ id: connection.id, api_key: apiKey });
    setReplacing(false);
    toast.success('API key updated.');
  };

  const test = async () => {
    setTesting(true);
    const toastId = toast.loading('Testing connection…');
    try {
      const result = await testConnection.mutateAsync(connection.id);
      if (result.success) toast.success('Connection verified.', { id: toastId });
      else toast.error(`Test failed: ${result.message}`, { id: toastId });
    } catch (err) {
      toast.error(err.message, { id: toastId });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove your ${provider.name} key? Its deals will leave the Cashout page, and its saved payout records will be deleted.`)) return;
    try {
      await deleteConnection.mutateAsync(connection.id);
      toast.success(`${provider.name} removed.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Plug size={15} className="text-green-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-white truncate">{provider.name}</span>
        </div>
        {connection && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
              connection.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {connection.status === 'active' ? 'Active' : 'Attention Needed'}
          </span>
        )}
      </div>

      {!connection ? (
        <KeyForm label={`${provider.name} API key`} submitLabel="Verify & Connect" onSubmit={connect} />
      ) : (
        <>
          <div className="text-xs text-gray-400">
            <div className="flex items-center gap-1.5 font-mono">
              <KeyRound size={12} className="text-gray-500" />
              <span>••••••••{connection.keyLast4}</span>
            </div>
            {connection.lastError && (
              <p className="mt-1.5 text-red-400 break-words">{connection.lastError}</p>
            )}
          </div>

          {replacing ? (
            <KeyForm
              label={`New ${provider.name} API key`}
              submitLabel="Verify & Save"
              onSubmit={replaceKey}
              onCancel={() => setReplacing(false)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={test}
                disabled={testing}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                Test
              </button>
              <button
                type="button"
                onClick={() => setReplacing(true)}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-gray-300 hover:bg-white/5"
              >
                Replace Key
              </button>
              <button
                type="button"
                onClick={remove}
                aria-label={`Remove ${provider.name}`}
                title="Remove"
                className="ml-auto p-1.5 rounded text-rose-400 hover:bg-rose-500/10"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CashoutIntegrations;
