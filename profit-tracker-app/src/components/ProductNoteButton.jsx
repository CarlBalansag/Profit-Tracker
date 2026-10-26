import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProductNote, useProductNoteMutations } from '../hooks/useApi';

/**
 * ProductNoteButton
 *
 * A self-contained note icon + popover tied to a product name (SKU-level note).
 * All inventory rows sharing the same product name share one note.
 *
 * Props:
 *   productName  string  — the product name to look up / save a note for
 */
const ProductNoteButton = ({ productName }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const popoverRef = useRef(null);
  const buttonRef = useRef(null);
  const textareaRef = useRef(null);

  const { data, isLoading } = useProductNote(productName);
  const { upsert, remove } = useProductNoteMutations(productName);

  const existingNote = data?.note ?? null;
  const hasNote = !!existingNote;

  // Sync draft with fetched note when popover opens
  useEffect(() => {
    if (open) {
      setDraft(existingNote ?? '');
      // Focus textarea after a short delay to allow render
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, existingNote]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSave = () => {
    if (!draft.trim()) {
      // If the draft is empty and a note existed, clear it
      if (hasNote) {
        remove.mutate(undefined, {
          onSuccess: () => {
            toast.success('Note cleared');
            setOpen(false);
          },
          onError: () => toast.error('Failed to clear note'),
        });
      } else {
        setOpen(false);
      }
      return;
    }

    upsert.mutate({ note: draft }, {
      onSuccess: () => {
        toast.success('Note saved');
        setOpen(false);
      },
      onError: () => toast.error('Failed to save note'),
    });
  };

  const handleClear = () => {
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success('Note cleared');
        setDraft('');
        setOpen(false);
      },
      onError: () => toast.error('Failed to clear note'),
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
  };

  if (!productName?.trim()) return null;

  return (
    <div className="relative inline-flex items-center">
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`p-1.5 rounded-md transition-colors ${
          hasNote
            ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
            : 'text-gray-600 hover:text-gray-400 hover:bg-white/10'
        }`}
        title={hasNote ? 'View / edit note' : 'Add note'}
      >
        <StickyNote className={`w-3.5 h-3.5 ${hasNote ? 'fill-amber-400/20' : ''}`} />
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 w-72 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-xl dp-elevated p-4 space-y-3 text-[var(--dp-text-primary)]"
          style={{ top: '100%', left: 0, marginTop: 6 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StickyNote className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-[var(--dp-text-primary)] truncate">{productName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Textarea */}
          {isLoading ? (
            <p className="text-xs text-[var(--dp-text-muted)]">Loading...</p>
          ) : (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              maxLength={2000}
              placeholder="Add a note for this product..."
              className="w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors resize-none"
            />
          )}

          {/* Character count */}
          <p className="text-[10px] text-[var(--dp-text-muted)] text-right -mt-1">{draft.length}/2000</p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={upsert.isPending || remove.isPending}
              className="flex-1 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
            {hasNote && (
              <button
                type="button"
                onClick={handleClear}
                disabled={remove.isPending || upsert.isPending}
                className="p-1.5 text-[var(--dp-text-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                title="Clear note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <p className="text-[10px] text-[var(--dp-text-muted)]">Ctrl+Enter to save · Esc to close</p>
        </div>
      )}
    </div>
  );
};

export default ProductNoteButton;
