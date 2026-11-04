import React, { useState } from 'react';
import { Pin, PinOff, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useProductNote,
  useTransactionNotes,
  useTransactionNoteMutations,
} from '../hooks/useApi';
import ProductNoteButton from './ProductNoteButton';

const MAX_BODY = 2000;

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label,var(--dp-text-secondary))]';
const TEXTAREA = 'w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors resize-y';
const ICON_BTN = 'p-1 rounded-md text-[var(--dp-text-muted)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors disabled:opacity-50';
const SMALL_BTN = 'px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function wasEdited(note) {
  const created = new Date(note.created_at).getTime();
  const updated = new Date(note.updated_at).getTime();
  return Number.isFinite(created) && Number.isFinite(updated) && Math.abs(updated - created) > 60_000;
}

function Spinner() {
  return <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />;
}

function NoteRow({ note, mutations }) {
  const { update, remove } = mutations;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = update.isPending || remove.isPending;

  const togglePin = () => {
    update.mutate({ id: note.id, pinned: !note.pinned }, {
      onSuccess: () => toast.success(note.pinned ? 'Note unpinned' : 'Note pinned'),
      onError: (err) => toast.error(err.message || 'Failed to update note'),
    });
  };

  const saveEdit = () => {
    const body = draft.trim();
    if (!body) return;
    update.mutate({ id: note.id, body }, {
      onSuccess: () => { toast.success('Note saved'); setEditing(false); },
      onError: (err) => toast.error(err.message || 'Failed to save note'),
    });
  };

  const doDelete = () => {
    remove.mutate(note.id, {
      onSuccess: () => toast.success('Note deleted'),
      onError: (err) => { toast.error(err.message || 'Failed to delete note'); setConfirmDelete(false); },
    });
  };

  return (
    <li
      data-testid="transaction-note"
      className={`rounded-lg px-3 py-2 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] ${note.pinned ? 'border-l-2 border-l-[color:var(--dp-accent)]' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); setDraft(note.body); }
                }}
                maxLength={MAX_BODY}
                rows={3}
                aria-label="Edit note"
                className={TEXTAREA}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={busy || !draft.trim()}
                  className={`${SMALL_BTN} bg-[var(--dp-accent)] text-white hover:opacity-90`}
                >
                  {update.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setDraft(note.body); }}
                  disabled={busy}
                  className={`${SMALL_BTN} text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]`}
                >
                  Cancel
                </button>
                <span className="ml-auto text-[11px] text-[var(--dp-text-muted)]">{draft.length}/{MAX_BODY}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--dp-text-primary)] whitespace-pre-wrap break-words">{note.body}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-[var(--dp-text-muted)]">
            {note.author === 'bot' ? (
              <span className="px-1.5 py-px rounded-full text-[11px] font-semibold bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]">Bot</span>
            ) : (
              <span>Carl</span>
            )}
            <span>·</span>
            <span>{formatWhen(note.created_at)}</span>
            {wasEdited(note) && <span>· edited</span>}
          </div>
        </div>

        {!editing && (
          <div className="flex items-center gap-0.5 shrink-0">
            {confirmDelete ? (
              <>
                <span className="text-xs text-[var(--dp-text-secondary)] mr-1">Delete?</span>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={busy}
                  className={`${SMALL_BTN} text-[var(--dp-red-text)] bg-[var(--dp-red-bg)] hover:opacity-90`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className={`${SMALL_BTN} text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]`}
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={togglePin}
                  disabled={busy}
                  aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                  title={note.pinned ? 'Unpin' : 'Pin'}
                  className={`${ICON_BTN} ${note.pinned ? 'text-[var(--dp-accent)]' : ''}`}
                >
                  {note.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setDraft(note.body); setEditing(true); }}
                  disabled={busy}
                  aria-label="Edit note"
                  title="Edit"
                  className={ICON_BTN}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  aria-label="Delete note"
                  title="Delete"
                  className={`${ICON_BTN} hover:text-[var(--dp-red-text)]`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * TransactionNotesPanel
 *
 * Notes for one sale or purchase, plus (optionally) the shared product note.
 *
 * Props:
 *   entityType       'sale' | 'purchase'
 *   entityId         uuid of the sale or inventory row
 *   productName      product name, for the shared product-note block
 *   showProductNote  render the product-note block (default true)
 */
export default function TransactionNotesPanel({ entityType, entityId, productName, showProductNote = true }) {
  const { data: notes = [], isLoading, isError } = useTransactionNotes(entityType, entityId);
  const mutations = useTransactionNoteMutations(entityType, entityId);
  const [draft, setDraft] = useState('');

  const sorted = [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const canAdd = !!draft.trim() && !mutations.add.isPending;

  const addNote = () => {
    if (!canAdd) return;
    mutations.add.mutate({ body: draft.trim() }, {
      onSuccess: () => { toast.success('Note added'); setDraft(''); },
      onError: (err) => toast.error(err.message || 'Failed to add note'),
    });
  };

  return (
    <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-4" aria-label="Notes">
      {showProductNote && (
        <>
          <div data-testid="product-note-block">
            <div className="flex items-center gap-1">
              <span className={LABEL}>Product note</span>
              <ProductNoteButton productName={productName} />
            </div>
            <p className="text-[11px] text-[var(--dp-text-muted)]">
              Shared by every transaction named {productName}
            </p>
            <ProductNoteText productName={productName} />
          </div>
          <div className="border-t border-[color:var(--dp-border)]" />
        </>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className={LABEL}>This transaction&apos;s notes</span>
          <span
            data-testid="note-count"
            className="px-1.5 min-w-[18px] text-center rounded-full text-[11px] font-semibold bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]"
          >
            {notes.length}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--dp-text-muted)] py-2">
            <Spinner /> Loading notes…
          </div>
        ) : isError ? (
          <p className="text-xs text-[var(--dp-red-text)]">Couldn&apos;t load notes.</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-[var(--dp-text-muted)]">No notes on this transaction yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((note) => <NoteRow key={note.id} note={note} mutations={mutations} />)}
          </ul>
        )}

        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
            }}
            maxLength={MAX_BODY}
            rows={2}
            placeholder="Add a note…"
            aria-label="Add a note"
            className={TEXTAREA}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--dp-text-muted)]">{draft.length}/{MAX_BODY} · Ctrl+Enter to add</span>
            <button
              type="button"
              onClick={addNote}
              disabled={!canAdd}
              className={`${SMALL_BTN} bg-[var(--dp-accent)] text-white hover:opacity-90`}
            >
              {mutations.add.isPending ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductNoteText({ productName }) {
  const { data, isLoading } = useProductNote(productName);
  if (isLoading) return <div className="mt-1.5"><Spinner /></div>;
  const text = data?.note;
  return text
    ? <p className="mt-1.5 text-sm text-[var(--dp-text-primary)] whitespace-pre-wrap break-words">{text}</p>
    : <p className="mt-1.5 text-xs text-[var(--dp-text-muted)]">No product note</p>;
}
