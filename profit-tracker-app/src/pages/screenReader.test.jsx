import { createElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import Inventory from './Inventory';
import CashFlow from './CashFlow';
import TaxExempt from './TaxExempt';
import Calendar from './Calendar';
import Shell from '../components/Layout/Shell';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-10-01T12:00:00Z', received_date: null, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'LISTED', category: null,
  tracking_number: null, sales: [], ...over,
});
const inventory = [item({ id: 'a' }), item({ id: 'b' })];
const dashboard = {
  stats: {},
  cashFlowTransactions: [{ id: 's1', type: 'sale', buyer: 'Acme', sale_price: 10, amount: 10, status: 'Pending' }],
};

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  useInvalidate: () => ({}),
  useInventory: () => ({ data: inventory, isLoading: false, refetch: vi.fn() }),
  useSales: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useDashboard: () => ({ data: dashboard, isLoading: false, refetch: vi.fn() }),
  useCalendarEvents: () => ({ data: [] }),
  useCalendarAutoEvents: () => ({ data: [] }),
  useCalendarToken: () => ({ data: null, isLoading: false }),
  useCalendarMutations: () => ({}),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' }, logout: vi.fn() }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('../context/TutorialContext', () => ({ useTutorial: () => ({ start: vi.fn(), active: false, currentStep: null }) }));
vi.mock('../components/Layout/Sidebar', () => ({ default: () => null }));
vi.mock('@fullcalendar/react', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const mount = (page) => render(<MemoryRouter>{createElement(page)}</MemoryRouter>);
const unnamed = (container) => [...container.querySelectorAll('button, select, input:not([type="hidden"])')].filter((el) => {
  if (el.closest('.hidden')) return false;
  return !(el.getAttribute('aria-label') || el.title || el.textContent.trim() || el.labels?.length);
});

afterEach(cleanup);

describe('every control has a name', () => {
  it.each([
    ['Transactions', Transactions],
    ['Inventory', Inventory],
    ['Tax Exempt', TaxExempt],
    ['Calendar', Calendar],
  ])('%s', async (_name, Page) => {
    const { container } = mount(Page);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(unnamed(container)).toEqual([]));
  });
});

describe('rows that open with a click', () => {
  it('opens Transactions details from a real button', () => {
    mount(Transactions);
    const button = screen.getAllByRole('button', { name: 'Open details for Widget' })[0];
    expect(button.tagName).toBe('BUTTON');
  });

  it('expands a grouped Inventory row from its button without toggling twice', () => {
    mount(Inventory);
    const button = screen.getByRole('button', { name: 'Show batches for Widget' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Hide batches for Widget' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('expands a Cash Flow buyer with Enter and with Space', () => {
    mount(CashFlow);
    const row = screen.getAllByRole('button').find(el => el.hasAttribute('aria-expanded'));
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row, { key: ' ' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('reports the Cash Flow cashback switch state', () => {
    mount(CashFlow);
    const toggle = screen.getByRole('switch', { name: 'Include cashback' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});

describe('dialogs', () => {
  const Modal = () => {
    const [showNote, setShowNote] = useState(false);
    const ref = useModalKeyboard(true, () => {});
    return (
      <div ref={ref}>
        <h2>Edit item</h2>
        <div><label>Price</label><input /></div>
        {showNote && <div><label>Note</label><textarea /></div>}
        <button type="button" onClick={() => setShowNote(true)}>Add note</button>
      </div>
    );
  };

  it('are announced and named after their heading', () => {
    render(<Modal />);
    const dialog = screen.getByRole('dialog', { name: 'Edit item' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('keep a role a modal set itself', () => {
    const Alert = () => {
      const ref = useModalKeyboard(true, () => {});
      return <div ref={ref} role="alertdialog" aria-label="Delete?" />;
    };
    render(<Alert />);
    expect(screen.getByRole('alertdialog', { name: 'Delete?' })).toBeTruthy();
  });

  it('connect labels to fields, including ones added later', async () => {
    render(<Modal />);
    expect(screen.getByLabelText('Price').tagName).toBe('INPUT');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA'));
  });

  it('leave a label alone when its group holds several fields', () => {
    const Pair = () => {
      const ref = useModalKeyboard(true, () => {});
      return <div ref={ref}><div><label>Range</label><input /><input /></div></div>;
    };
    render(<Pair />);
    expect(screen.getByText('Range').hasAttribute('for')).toBe(false);
  });
});

describe('skip link', () => {
  it('moves focus to the main content', () => {
    render(<MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(document.activeElement).toBe(within(document.body).getByRole('main'));
  });
});
