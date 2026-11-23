// One layout at a time: a table on wider screens, cards on phones.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveTable } from './ResponsiveTable';

const phone = (matches) => vi.stubGlobal('matchMedia', (query) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = {
  rows: [{ name: 'Gross receipts', a: '$1.00', b: '$2.00' }, { name: 'Net profit', a: '$3.00', b: '$4.00' }],
  rowKey: (r) => r.name, strong: (r) => r.name === 'Net profit',
  columns: [{ label: 'Line', cell: (r) => r.name }, { label: '2025', align: 'right', cell: (r) => r.a }, { label: '2026', align: 'right', cell: (r) => r.b }],
};

describe('ResponsiveTable', () => {
  it('is a table on wider screens', () => {
    phone(false);
    render(<ResponsiveTable {...props} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Line', '2025', '2026']);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('is one card per row on phones, with each value labelled', () => {
    phone(true);
    render(<ResponsiveTable {...props} />);
    expect(screen.queryByRole('table')).toBeNull();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]).getByText('Net profit')).toBeInTheDocument();
    expect(within(cards[1]).getByText('2026').nextSibling).toHaveTextContent('$4.00');
    expect(cards[1]).toHaveClass('font-semibold');
  });
});
