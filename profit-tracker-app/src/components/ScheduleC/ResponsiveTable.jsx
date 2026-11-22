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
    return <div className={className}>
      {caption && <p className="pb-1 text-sm font-medium text-white">{caption}</p>}
      <ul className="space-y-2">{rows.map((row, i) => <li key={rowKey(row, i)} className={`rounded-lg border border-white/10 p-3 text-sm ${strong(row) ? 'font-semibold text-white' : 'text-gray-300'}`}>
        <div className="break-words">{first.cell(row)}</div>
        <dl className={`mt-2 grid gap-x-3 gap-y-2 ${rest.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {rest.map((c) => <div key={c.label} className="min-w-0"><dt className="text-xs font-normal text-gray-500">{c.label}</dt><dd className="break-words tabular-nums">{c.cell(row)}</dd></div>)}
        </dl>
      </li>)}</ul>
    </div>;
  }
  return <div className={className}><table className="w-full text-sm">
    {caption && <caption className="pb-1 text-left font-medium text-white">{caption}</caption>}
    <thead><tr className="text-left text-xs text-gray-500">{columns.map((c, i) => <th key={c.label || i} scope="col" className={`pb-1.5 font-normal ${i ? 'pl-3' : 'pr-2'} ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={rowKey(row, i)} className={`border-t ${strong(row) ? 'border-white/10 font-semibold text-white' : 'border-white/5 text-gray-300'}`}>
      {columns.map((c, j) => <td key={c.label || j} className={`py-2 align-top ${j ? 'pl-3' : 'pr-2'} ${c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>{c.cell(row)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
