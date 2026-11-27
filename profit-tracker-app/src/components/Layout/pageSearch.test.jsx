import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }),
}));

afterEach(() => { cleanup(); localStorage.clear(); });

const Where = () => <p data-testid="path">{useLocation().pathname}</p>;
const mount = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Sidebar isOpen={false} setIsOpen={() => {}} isCollapsed={false} setIsCollapsed={() => {}} />
    <Where />
  </MemoryRouter>
);

describe('Page search', () => {
  it('opens with Ctrl+K, filters as you type, and Enter goes to the page', () => {
    mount();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Page name' });
    fireEvent.change(input, { target: { value: 'cash' } });
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toMatch(/^Cash Flow/);
    expect(options.some((o) => o.startsWith('Inventory'))).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('path')).toHaveTextContent('/cashflow');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('finds pages by other words, moves with the arrow keys, and says when nothing matches', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Search pages/ }));
    const input = screen.getByRole('combobox', { name: 'Page name' });
    fireEvent.change(input, { target: { value: 'tax' } });
    const found = screen.getAllByRole('option').map((o) => o.textContent);
    expect(found[0]).toMatch(/^Tax Exempt/); // a page named for it comes first
    expect(found.some((t) => t.startsWith('Expenses'))).toBe(true);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/No page called “zzz”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all pages' }));
    expect(screen.getAllByRole('option').length).toBeGreaterThan(15);
  });
});

describe('Page search with live figures', () => {
  it("shows each page's figure and finds pages by it", async () => {
    const { default: PageSearch } = await import('./PageSearch');
    const pages = [
      { label: 'Cash Flow', to: '/cashflow', group: 'Money', words: 'owed' },
      { label: 'Goals', to: '/goals', group: 'Money', words: 'targets' },
    ];
    render(
      <MemoryRouter>
        <PageSearch open onClose={() => {}} pages={pages} figures={{ '/cashflow': { text: '10 late', problem: true } }} />
      </MemoryRouter>
    );
    const input = screen.getByRole('combobox', { name: 'Page name' });
    fireEvent.change(input, { target: { value: 'late' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Cash Flow');
    expect(options[0]).toHaveTextContent('10 late');
  });
});
