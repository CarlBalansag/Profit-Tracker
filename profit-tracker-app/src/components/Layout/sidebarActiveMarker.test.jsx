import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }),
}));

afterEach(() => { cleanup(); localStorage.clear(); });

const renderSidebar = ({ path = '/transactions', uiStyle, isCollapsed = false } = {}) => render(
  <MemoryRouter initialEntries={[path]}>
    <Sidebar isOpen setIsOpen={() => {}} isCollapsed={isCollapsed} setIsCollapsed={() => {}} uiStyle={uiStyle} />
  </MemoryRouter>
);

const markers = (container) => container.querySelectorAll('[data-nav-marker]');
const marker = (container) => markers(container)[0];
const linkTo = (container, href) => container.querySelector(`a[href="${href}"]`);
const shown = (el) => el.style.opacity === '1';

describe('Sidebar active marker', () => {
  it('has exactly one marker, on the active link, and moves it on navigation', async () => {
    const { container } = renderSidebar({ path: '/transactions' });

    expect(markers(container)).toHaveLength(1);
    expect(marker(container)).toHaveAttribute('data-active-href', '/transactions');
    expect(shown(marker(container))).toBe(true);

    await act(async () => { fireEvent.click(linkTo(container, '/inventory')); });

    expect(markers(container)).toHaveLength(1);
    expect(marker(container)).toHaveAttribute('data-active-href', '/inventory');
  });

  it('glides on a route change, but not on first show', async () => {
    const { container } = renderSidebar({ path: '/transactions' });
    expect(marker(container).style.transition).not.toContain('top');

    await act(async () => { fireEvent.click(linkTo(container, '/inventory')); });
    expect(marker(container).style.transition).toContain('top');
  });

  it('keeps the active item marked when the sidebar is collapsed', () => {
    const { container } = renderSidebar({ path: '/analytics', isCollapsed: true });

    expect(markers(container)).toHaveLength(1);
    expect(marker(container)).toHaveAttribute('data-active-href', '/analytics');
  });

  it('hides the marker while the active item sits in a folded section', async () => {
    const { container } = renderSidebar({ path: '/transactions' });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^stock$/i })); });
    expect(shown(marker(container))).toBe(false);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^stock$/i })); });
    expect(shown(marker(container))).toBe(true);
    expect(marker(container)).toHaveAttribute('data-active-href', '/transactions');
  });

  it('has one marker in the glass style and moves it on navigation', async () => {
    const { container } = renderSidebar({ path: '/', uiStyle: 'glassmorphism-brown' });

    expect(markers(container)).toHaveLength(1);
    expect(marker(container)).toHaveAttribute('data-active-href', '/');

    await act(async () => { fireEvent.click(linkTo(container, '/analytics')); });

    expect(markers(container)).toHaveLength(1);
    expect(marker(container)).toHaveAttribute('data-active-href', '/analytics');
  });

  it('shows no marker on a page with no nav item', () => {
    const { container } = renderSidebar({ path: '/settings' });
    expect(markers(container).length).toBeLessThanOrEqual(1);
    if (markers(container).length) expect(shown(marker(container))).toBe(false);
  });
});
