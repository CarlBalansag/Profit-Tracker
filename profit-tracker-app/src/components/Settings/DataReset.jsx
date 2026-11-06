import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '../UI/ConfirmDialog';
import { useDataReset } from '../../hooks/useApi';

const CONFIRM_WORD = 'RESET';

// These lists are what the user agrees to, so keep them matched to
// profit-tracker-api/services/dataReset.js.
const TRANSACTION_ITEMS = [
  'All purchases and sales',
  'Your inventory and its stock counts',
  'Refunds, plus notes and attachments on transactions',
  'Purchase receipts',
  'Edit history for purchases and sales',
  'Item matches on cashout deals',
];

const RESET_OPTIONS = {
  transactions: {
    title: 'Reset transactions only',
    summary: 'Clears your purchases, sales and inventory. Your setup and expenses stay.',
    button: 'Reset transactions',
    deletes: TRANSACTION_ITEMS,
    keeps: [
      'Expenses and recurring expenses',
      'Payment methods, vendors, accounts, marketplaces, cashouts and buyers',
      'Goals, calendar events and product notes',
      'Your login, AI assistant keys and preferences',
    ],
  },
  everything: {
    title: 'Reset everything',
    summary: 'Clears all your data, including payment methods, vendors, accounts, marketplaces and cashouts.',
    button: 'Reset everything',
    deletes: [
      ...TRANSACTION_ITEMS,
      'Payment methods',
      'Vendors, marketplaces and cashouts',
      'Accounts and buyers',
      'Connected cashout services and their deal history',
      'Expenses, recurring expenses and expense receipts',
      'Invoices, goals, calendar events and product notes',
      'All edit history, including your AI assistant\'s activity log',
    ],
    keeps: ['Your login, AI assistant keys and preferences'],
  },
};

const ItemList = ({ label, items }) => (
  <div>
    <p className="text-xs font-semibold text-[var(--dp-text-primary)]">{label}</p>
    <ul className="mt-1 list-disc pl-4 space-y-0.5 text-xs text-gray-400">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  </div>
);

export function DataReset() {
  const [scope, setScope] = useState(null);
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);
  const reset = useDataReset();
  const option = RESET_OPTIONS[scope];

  const close = () => {
    setScope(null);
    setTyped('');
    reset.reset();
  };

  const confirm = () => {
    reset.mutate(scope, {
      onSuccess: () => {
        toast.success(scope === 'everything' ? 'All your data has been reset.' : 'Your transactions have been reset.');
        close();
      },
    });
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 space-y-6">
      <div>
        <h2 className="text-sm font-bold text-white mb-2">Reset data</h2>
        <p className="text-xs text-gray-500">Start over by permanently deleting your data. This can't be undone.</p>
      </div>

      <div className="space-y-3">
        {Object.entries(RESET_OPTIONS).map(([id, { title, summary, button }]) => (
          <div key={id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded border border-gray-800 bg-[#16161E]">
            <div>
              <h3 className="text-sm text-gray-300">{title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{summary}</p>
            </div>
            <button
              type="button"
              onClick={() => setScope(id)}
              className="shrink-0 inline-flex items-center justify-center gap-2 px-3 h-8 rounded-lg border border-red-500/40 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={14} /> {button}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600">Data export is coming soon.</p>

      <ConfirmDialog
        open={Boolean(option)}
        title={option ? `${option.title}?` : ''}
        consequence="Do you really want to do this? Your data is deleted permanently and can't be recovered."
        confirmLabel={option?.button}
        cancelLabel="Cancel"
        busy={reset.isPending}
        confirmDisabled={typed !== CONFIRM_WORD}
        initialFocusRef={inputRef}
        onConfirm={confirm}
        onClose={close}
      >
        {option && (
          <div className="mt-3 space-y-3">
            <div className="max-h-[40vh] overflow-y-auto space-y-3">
              <ItemList label="This will be permanently deleted" items={option.deletes} />
              <ItemList label="This will be kept" items={option.keeps} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="data-reset-confirm" className="text-xs text-gray-400">
                Type {CONFIRM_WORD} to confirm
              </label>
              <input
                id="data-reset-confirm"
                ref={inputRef}
                type="text"
                value={typed}
                disabled={reset.isPending}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-gray-600"
              />
            </div>
            {reset.isError && (
              <p role="alert" className="text-xs text-red-400">
                {reset.error.rolledBack
                  ? 'The reset failed and nothing was deleted. Please try again.'
                  : "We couldn't reach the server. Reload the page to check your data before trying again."}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
