import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }),
}));
vi.mock('../../hooks/useApi', async (orig) => ({ ...(await orig()), useTodoCount: () => 16 }));

afterEach(() => { cleanup(); localStorage.clear(); });

const renderSidebar = ({ isCollapsed = false } = {}) => render(
  <MemoryRouter initialEntries={['/']}>
    <Sidebar isOpen={false} setIsOpen={() => {}} isCollapsed={isCollapsed} setIsCollapsed={() => {}} />
  </MemoryRouter>
);

describe('Sidebar account menu', () => {
  it('says whether it is open, and closes on Escape (focus back on the button) or a click outside', () => {
    renderSidebar();
    const account = screen.getByRole('button', { expanded: false, name: /tester/ });
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
    expect(account).toHaveFocus();

    fireEvent.click(account);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
  });
});

describe('Sidebar sections', () => {
  it('say whether they are folded and remember it on the next visit', async () => {
    renderSidebar();
    const core = screen.getByRole('button', { name: /^core$/i });
    expect(core).toHaveAttribute('aria-expanded', 'true');
    await act(async () => { fireEvent.click(core); });
    expect(core).toHaveAttribute('aria-expanded', 'false');

    cleanup();
    renderSidebar();
    expect(screen.getByRole('button', { name: /^core$/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Collapsed sidebar', () => {
  it('names each icon, keeps the to-do count, and shows a label on hover', () => {
    const { container } = renderSidebar({ isCollapsed: true });
    const todo = screen.getByRole('link', { name: 'To-Do, 16 to do' });
    expect(todo).toHaveTextContent('16');
    expect(screen.getByRole('link', { name: 'Shipping' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    fireEvent.pointerOver(screen.getByRole('link', { name: 'Shipping' }));
    expect(container.querySelector('[data-sidebar-tooltip]')).toHaveTextContent('Shipping');
    fireEvent.pointerOut(screen.getByRole('link', { name: 'Shipping' }));
    expect(container.querySelector('[data-sidebar-tooltip]')).toBeNull();
  });
});
