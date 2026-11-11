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

describe('page width', () => {
  it.each([
    ['AddSale', 'max-w-5xl 3xl:max-w-6xl'],
    ['AddTransaction', 'max-w-7xl'],
    ['Analytics', 'max-w-7xl'],
    ['CashFlow', 'max-w-6xl'],
    ['Goals', 'max-w-[1400px]'],
    ['Guide', 'max-w-3xl'],
    ['Settings', 'max-w-5xl'],
    ['TaxExempt', 'max-w-6xl'],
  ])('%s stays centered in the space beside the sidebar', (page, width) => {
    const source = readFileSync(join(process.cwd(), `src/pages/${page}.jsx`), 'utf8');
    expect(source).toContain(`${width} mx-auto`);
  });
});

describe('light mode colours', () => {
  const palette = readFileSync(join(process.cwd(), 'src/styles/colorPalette.css'), 'utf8').split(':root[data-theme="dark"] {')[0];
  // Follows var(--x) references (the accent comes from the --accent-* preset).
  const resolve = (prop) => {
    const value = palette.match(new RegExp(`${prop}: *([^;]+);`))[1].trim();
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    return ref ? resolve(ref[1]) : value.match(/#[0-9A-Fa-f]{6}/)[0];
  };
  const token = (name) => resolve(`--color-${name}`);
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  it.each(['text-muted', 'accent', 'success-text', 'danger-text', 'warning-text'])('%s stays readable on the page background', (name) => {
    expect(contrast(token(name), token('background'))).toBeGreaterThanOrEqual(4.5);
  });
});
