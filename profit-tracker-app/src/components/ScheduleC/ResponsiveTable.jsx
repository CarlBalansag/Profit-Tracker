import { useMatchMedia } from '../../hooks/useMatchMedia';

const PHONE_QUERY = '(max-width: 639px)';

/**
 * A table on wider screens and one card per row on phones (AGENTS.md: no
 * squeezed or sideways-scrolling tables on a phone). Only one layout is
 * rendered at a time.
 *
 * columns: [{ label, cell: (row) => node, align: 'left' | 'right' }]. The
 * first column is the card's title on phones. strong(row): emphasise a row
 * (totals).
 */
export function ResponsiveTable({ columns, rows, rowKey, caption, strong = () => false, className = '' }) {
  const phone = useMatchMedia(PHONE_QUERY);
  const [first, ...rest] = columns;
  if (phone) {
    // A flat divided list: one block per row, its values labelled underneath.
    return <div className={className}>
      {caption && <p className="pb-1 text-sm font-medium text-[var(--dp-text-primary)]">{caption}</p>}
      <ul className="divide-y divide-[color:var(--dp-border)]">{rows.map((row, i) => <li key={rowKey(row, i)} className={`py-3 text-sm ${strong(row) ? 'font-semibold text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)]'}`}>
        <div className="break-words text-[var(--dp-text-primary)]">{first.cell(row)}</div>
        <dl className={`mt-1.5 grid gap-x-4 gap-y-1.5 ${rest.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {rest.map((c) => <div key={c.label} className="min-w-0"><dt className="text-xs font-normal text-[var(--dp-text-muted)]">{c.label}</dt><dd className="tabular-nums">{c.cell(row)}</dd></div>)}
        </dl>
      </li>)}</ul>
    </div>;
  }
  // As wide as its content (not the whole panel), so short values in a row
  // stay close enough to read across.
  return <div className={`max-w-full overflow-x-auto ${className}`}><table className="w-auto min-w-[20rem] text-sm">
    {caption && <caption className="pb-1 text-left font-medium text-[var(--dp-text-primary)]">{caption}</caption>}
    <thead><tr className="text-left text-xs text-[var(--dp-text-muted)]">{columns.map((c, i) => <th key={c.label || i} scope="col" className={`pb-1.5 font-normal ${i ? 'pl-8' : 'pr-2'} ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={rowKey(row, i)} className={`border-t border-[color:var(--dp-border)] ${strong(row) ? 'font-semibold text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)]'}`}>
      {columns.map((c, j) => <td key={c.label || j} className={`py-2 align-top ${j ? 'pl-8' : 'pr-2'} ${c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>{c.cell(row)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
