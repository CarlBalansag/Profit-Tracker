import { useEffect, useRef } from 'react';
import { X, Plus, ShoppingBag, DollarSign, Banknote, Calendar, CreditCard } from 'lucide-react';

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
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        className="relative z-10 w-72 rounded-xl overflow-hidden"
        style={{
          background: '#1e2028',
          border: '1px solid rgba(255,255,255,0.16)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs font-semibold text-gray-200">{formatDate(date)}</span>
          <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Events list */}
        <div className="max-h-56 overflow-y-auto">
          {events.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">No events on this day.</p>
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
                      className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left transition-colors ${isManual ? 'cursor-pointer' : 'cursor-default'}`}
                      style={isManual ? undefined : undefined}
                      onMouseEnter={e => { if (isManual) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: `${color}25` }}>
                        <Icon size={11} style={{ color }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-100 truncate">{ev.title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color }}>{cfg.label}</p>
                      </div>
                      {isManual && (
                        <span className="flex-shrink-0 text-[10px] text-gray-500 self-center">Edit</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => onAddEvent(date)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-[var(--accent)] rounded-lg transition-colors"
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
          >
            <Plus size={13} />
            Add event
          </button>
        </div>
      </div>
    </div>
  );
}
