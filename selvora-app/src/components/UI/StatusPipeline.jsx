import React from 'react';
import { statusVisual, displayLabel } from '../../data/statusWorkflow';

/**
 * Filter strip of status tiles, one per status the caller passes in.
 *
 * Reworked in checkpoint 3 from a decorative mock (a hardcoded label/count
 * array, no props, no consumer) into a real data-driven component. The icon-tile
 * grid look is kept deliberately -- only the data source and the selection
 * behaviour are new.
 *
 * Props:
 *   statuses   [{ key, label?, count, icon?, color? }]  -- `key` is the stored
 *              status constant; label/icon/colour default to the shared
 *              statusWorkflow vocabulary so callers normally pass key + count.
 *   activeKey  the currently selected key, or null for "no filter".
 *   onSelect   (key) => void. Called with the tile's key, or with null when the
 *              already-active tile is clicked (i.e. clicking again clears the
 *              filter). Omit it to render a read-only summary.
 */
const StatusPipeline = ({ statuses = [], activeKey = null, onSelect }) => {
  if (statuses.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" role="group" aria-label="Status filters">
      {statuses.map((status) => {
        const visual = statusVisual(status.key);
        const Icon = status.icon || visual.icon;
        const color = status.color || visual.color;
        const label = status.label || displayLabel(status.key);
        const isActive = activeKey === status.key;
        const selectable = typeof onSelect === 'function';

        return (
          <button
            key={status.key}
            type="button"
            disabled={!selectable}
            aria-pressed={selectable ? isActive : undefined}
            onClick={selectable ? () => onSelect(isActive ? null : status.key) : undefined}
            className={[
              'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
              selectable ? 'cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.10]' : 'cursor-default',
              isActive ? 'bg-white/[0.07] border-white/20' : 'bg-white/[0.02] border-white/[0.05]',
            ].join(' ')}
          >
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 shrink-0">
              <Icon size={18} style={{ color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400 truncate">{label}</p>
              <p className="text-lg font-bold" style={{ color }}>{status.count ?? 0}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default StatusPipeline;
