import { useEffect } from 'react';
import { X, Plus, ShoppingBag, DollarSign, Banknote, Calendar, CreditCard } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const TYPE_CONFIG = {
  purchase:   { label: 'Purchase',    color: '#3b82f6', icon: ShoppingBag },
  sale:       { label: 'Sale',        color: '#22c55e', icon: DollarSign },
  payout:     { label: 'Payout',      color: '#10b981', icon: Banknote },
  manual:     { label: 'Event',       color: '#a855f7', icon: Calendar },
  credit_due: { label: 'CC Due',      color: '#ef4444', icon: CreditCard },
};

const COLOR_HEX = {
  purple: '#a855f7',
  blue:   '#3b82f6',
  green:  '#22c55e',
  amber:  '#f59e0b',
  red:    '#ef4444',
};

function getEventColor(event) {
  if (event.color) return COLOR_HEX[event.color] ?? '#a855f7';
  return TYPE_CONFIG[event.type]?.color ?? '#a855f7';
}

// Format YYYY-MM-DD as "July 17, 2026"
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default function CalendarEventPopover({ date, events, onClose, onAddEvent, onEditEvent }) {
  const ref = useModalKeyboard(true, onClose);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, ref]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div
        ref={ref}
        className="relative z-10 w-72 rounded-xl overflow-hidden bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated text-[var(--dp-text-primary)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--dp-border)]">
          <span className="text-xs font-semibold text-[var(--dp-text-primary)]">{formatDate(date)}</span>
          <button onClick={onClose} className="p-1 rounded text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Events list */}
        <div className="max-h-56 overflow-y-auto dp-scrollbar">
          {events.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--dp-text-muted)]">No events on this day.</p>
          ) : (
            <ul className="py-1">
              {events.map(ev => {
                const cfg = TYPE_CONFIG[ev.type] ?? TYPE_CONFIG.manual;
                const Icon = cfg.icon;
                const color = getEventColor(ev);
                const isManual = ev.type === 'manual';

                return (
                  <li key={ev.id}>
                    <button
                      onClick={() => isManual ? onEditEvent(ev) : undefined}
                      className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--dp-hover-bg)] ${isManual ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: `${color}25` }}>
                        <Icon size={11} style={{ color }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--dp-text-primary)] truncate">{ev.title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color }}>{cfg.label}</p>
                      </div>
                      {isManual && (
                        <span className="flex-shrink-0 text-[10px] text-[var(--dp-text-muted)] self-center">Edit</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[color:var(--dp-border)]">
          <button
            onClick={() => onAddEvent(date)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-[var(--dp-accent)] hover:bg-[var(--dp-hover-bg)] rounded-lg transition-colors"
          >
            <Plus size={13} />
            Add event
          </button>
        </div>
      </div>
    </div>
  );
}
