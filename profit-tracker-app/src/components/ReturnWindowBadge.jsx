import { Undo2 } from 'lucide-react';
import { returnWindowStatus, toDateOnly } from '../utils/returnWindow';

const TONES = {
  ok:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  closed:  'bg-white/[0.04] text-gray-500 border-white/10',
};

// Days left to return a purchase to the store. Renders nothing when the
// purchase has no return window or no stock left to send back.
export default function ReturnWindowBadge({ item, className = '' }) {
  const status = returnWindowStatus(item);
  if (!status) return null;
  return (
    <span
      title={`Return by ${toDateOnly(item.return_by_date)}`}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONES[status.tone]} ${className}`}
    >
      <Undo2 className="w-2.5 h-2.5" />
      {status.label}
    </span>
  );
}
