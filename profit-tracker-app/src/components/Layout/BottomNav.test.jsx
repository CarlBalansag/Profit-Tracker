import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import BottomNav from './BottomNav';

const Where = () => <p data-testid="path">{useLocation().pathname}</p>;
const mount = (onMoreClick = vi.fn(), path = '/transactions') => render(
  <MemoryRouter initialEntries={[path]}>
    <BottomNav onMoreClick={onMoreClick} />
    <Where />
  </MemoryRouter>,
);

afterEach(cleanup);

describe('BottomNav', () => {
  it('links the most used pages and marks the current one', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Inventory' }).getAttribute('href')).toBe('/inventory');
    expect(screen.getByRole('link', { name: 'Transactions' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });

  it('opens the full menu from More', () => {
    const onMore = vi.fn();
    mount(onMore);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it('offers both add actions and goes to the one picked', () => {
    mount();
    const add = screen.getByRole('button', { name: 'Quick add' });
    expect(add.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(add);
    expect(add.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Record Sale' }));
    expect(screen.getByTestId('path').textContent).toBe('/add-sale');
    expect(screen.queryByRole('link', { name: 'Add Transaction' })).toBeNull();
  });

  it('closes quick add when tapping outside', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close quick add' }));
    expect(screen.queryByRole('link', { name: 'Add Transaction' })).toBeNull();
  });
});
