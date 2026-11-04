import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Package } from 'lucide-react';
import StatCard from '../components/UI/StatCard';
import Sidebar from '../components/Layout/Sidebar';
import Inventory from './Inventory';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-10-01T12:00:00Z', received_date: null, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'LISTED', category: null,
  tracking_number: null, sales: [], ...over,
});
const inventory = [
  item({ id: 'a', status: 'LISTED' }),
  item({ id: 'b', status: 'PURCHASED' }),
  item({ id: 'c', product_name: 'Gadget', status: 'LISTED' }),
  item({ id: 'd', product_name: 'Gadget', status: 'LISTED' }),
];

vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: inventory, isLoading: false, refetch: vi.fn() }),
  useInvalidate: () => ({}),
  apiFetch: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));

afterEach(cleanup);

describe('StatCard', () => {
  it('keeps the label, value and note together', () => {
    render(<StatCard label="Units" value={12} sub="on hand" icon={Package} tone="green" />);
    const card = screen.getByText('Units').parentElement;
    expect(within(card).getByText('12').className).toContain('text-green-400');
    expect(within(card).getByText('on hand')).toBeTruthy();
  });

  it('leaves the note out when there is none', () => {
    const { container } = render(<StatCard label="Units" value={0} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByText('0')).toBeTruthy();
  });
});

describe('Sidebar', () => {
  const mount = () => render(
    <MemoryRouter><Sidebar isOpen setIsOpen={() => {}} isCollapsed={false} setIsCollapsed={() => {}} /></MemoryRouter>,
  );

  it('links to Invoices', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('href')).toBe('/invoices');
  });

  it('leaves the main heading to the page', () => {
    mount();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('Inventory grouped status', () => {
  it('names the status when every batch matches and says Mixed when they differ', () => {
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    const statusOf = (name) => within(screen.getByText(name).closest('tr')).getAllByRole('cell').at(-2).textContent;
    expect(statusOf('Widget')).toBe('Mixed');
    expect(statusOf('Gadget')).toMatch(/listed/i);
  });
});

describe('theme colour rules', () => {
  it('only reads resting colours, so a hover colour never paints a control at rest', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).not.toMatch(/\[class\*="(bg|border|text)-(purple|indigo|blue|red|green|amber)"\]/);
  });
});
