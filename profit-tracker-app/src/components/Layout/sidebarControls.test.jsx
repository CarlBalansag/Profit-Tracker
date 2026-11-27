import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout }),
}));
vi.mock('../../hooks/useApi', async (orig) => ({
  ...(await orig()),
  useTodoCount: () => 16,
  useNavTodosQuery: () => ({ data: { counts: { total: 16 }, items: [{ type: 'ship', urgency: 'soon' }], waiting_payments: [{ total: 3626.6, overdue_total: 0 }] } }),
}));

afterEach(() => { cleanup(); localStorage.clear(); });

const renderSidebar = ({ isCollapsed = false, path = '/' } = {}) => render(
  <MemoryRouter initialEntries={[path]}>
    <Sidebar isOpen={false} setIsOpen={() => {}} isCollapsed={isCollapsed} setIsCollapsed={() => {}} />
  </MemoryRouter>
);

describe('Sidebar account menu', () => {
  it('says whether it is open, and closes on Escape (focus back on the button) or a click outside', async () => {
    renderSidebar();
    const account = screen.getByRole('button', { expanded: false, name: /tester/ });
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
    await waitFor(() => expect(screen.queryByText('Sign Out')).not.toBeInTheDocument());

    fireEvent.click(account);
    fireEvent.pointerDown(document.body);
    expect(account).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Sign Out', () => {
  it('asks once before signing out, and Cancel keeps you signed in', () => {
    logout.mockClear();
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /tester/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText('Sign out of Profit Tracker?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar as the phone drawer', () => {
  const renderDrawer = (isOpen, setIsOpen = () => {}) => render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar isOpen={isOpen} setIsOpen={setIsOpen} isCollapsed={false} setIsCollapsed={() => {}} />
    </MemoryRouter>
  );

  it('is inert while closed, so its links are out of the Tab order', () => {
    const { container } = renderDrawer(false);
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    cleanup();
    const open = renderDrawer(true);
    expect(open.container.querySelector('aside')).not.toHaveAttribute('inert');
  });

  it('one Escape in the account menu closes only the menu, not the drawer', () => {
    const setIsOpen = vi.fn();
    renderDrawer(true, setIsOpen);
    const account = screen.getByRole('button', { name: /tester/ });
    fireEvent.click(account);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
  });
});

describe('Sidebar sections', () => {
  it('a folded section that holds the current page says so', async () => {
    renderSidebar({ path: '/transactions' });
    const core = screen.getByRole('button', { name: /^stock$/i });
    expect(core).not.toHaveAttribute('aria-current');
    await act(async () => { fireEvent.click(core); });
    expect(core).toHaveAttribute('aria-current', 'true');
    expect(core.querySelector('[data-current-dot]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^money$/i })).not.toHaveAttribute('aria-current');
  });

  it('say whether they are folded and remember it on the next visit', async () => {
    renderSidebar();
    const core = screen.getByRole('button', { name: /^stock$/i });
    expect(core).toHaveAttribute('aria-expanded', 'true');
    await act(async () => { fireEvent.click(core); });
    expect(core).toHaveAttribute('aria-expanded', 'false');

    cleanup();
    renderSidebar();
    expect(screen.getByRole('button', { name: /^stock$/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Collapsed sidebar', () => {
  it('names each icon, keeps the to-do count, and shows a label on hover', () => {
    const { container } = renderSidebar({ isCollapsed: true });
    const todo = screen.getByRole('link', { name: 'To-Do, 16 open' });
    expect(todo).toHaveTextContent('16');
    expect(screen.getByRole('link', { name: /^Shipping/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    fireEvent.pointerOver(screen.getByRole('link', { name: /^Shipping/ }));
    expect(container.querySelector('[data-sidebar-tooltip]')).toHaveTextContent('Shipping');
    fireEvent.pointerOut(screen.getByRole('link', { name: /^Shipping/ }));
    expect(container.querySelector('[data-sidebar-tooltip]')).toBeNull();
  });
});

describe('Collapse on narrow screens', () => {
  it('the phone drawer keeps its labels even when the desktop sidebar is collapsed', () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query === '(max-width: 1023px)', addEventListener() {}, removeEventListener() {} });
    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar isOpen setIsOpen={() => {}} isCollapsed setIsCollapsed={() => {}} />
        </MemoryRouter>
      );
      expect(screen.getByText('Shipping')).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('Sidebar groups', () => {
  it('groups pages by how you work; Books starts open on desktop and remembers a fold', async () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /^today$/i })).toBeNull(); // Today can't be folded away
    for (const name of [/^stock$/i, /^money$/i, /^books$/i]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true');
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^books$/i })); });
    cleanup();
    renderSidebar();
    expect(screen.getByRole('button', { name: /^books$/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Where you are', () => {
  it('marks the account button on Settings and Activity, which live in its menu', () => {
    renderSidebar({ path: '/settings' });
    expect(screen.getByRole('button', { name: /tester/ })).toHaveAttribute('aria-current', 'page');
    cleanup();
    renderSidebar({ path: '/cashflow' });
    expect(screen.getByRole('button', { name: /tester/ })).not.toHaveAttribute('aria-current');
  });

  it('clicking the current page does nothing, but it still gets a collapsed label', () => {
    const { container } = renderSidebar({ path: '/cashflow', isCollapsed: true });
    const here = screen.getByRole('link', { name: /^Cash Flow/ });
    expect(fireEvent.click(here)).toBe(false); // default prevented
    fireEvent.pointerOver(here);
    expect(container.querySelector('[data-sidebar-tooltip]')).toHaveTextContent('Cash Flow');
  });
});

describe('Phone drawer contents', () => {
  it('leaves out what the bottom bar already has', () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query === '(max-width: 1023px)', addEventListener() {}, removeEventListener() {} });
    try {
      render(
        <MemoryRouter initialEntries={['/cashflow']}>
          <Sidebar isOpen setIsOpen={() => {}} isCollapsed={false} setIsCollapsed={() => {}} />
        </MemoryRouter>
      );
      for (const name of ['Dashboard', 'Transactions', 'Inventory']) {
        expect(screen.queryByRole('link', { name })).toBeNull();
      }
      expect(screen.getByRole('link', { name: /^To-Do/ })).toBeInTheDocument();
      // Log a buy / Record sale are on the bottom bar's + on phones.
      expect(screen.queryByRole('link', { name: /Log a buy/ })).toBeNull();
      expect(screen.getByRole('link', { name: /^Shipping/ })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('Round 4 fixes', () => {
  it('going to a page inside folded Books opens it, without saving that as your choice', async () => {
    localStorage.setItem('pt-sidebar-folds', JSON.stringify({ Books: true }));
    renderSidebar({ path: '/cashflow' });
    expect(screen.getByRole('button', { name: /^books$/i })).toHaveAttribute('aria-expanded', 'false');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Expenses' })); });
    expect(screen.getByRole('button', { name: /^books$/i })).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('pt-sidebar-folds'))).toEqual({ Books: true });
  });

  it('Cancel on the sign-out question puts focus back on Sign Out', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /tester/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign Out' })).toHaveFocus());
  });
});

describe('Ledger', () => {
  it('puts the two daily actions on top and a live figure on rows that need you', () => {
    renderSidebar({ path: '/cashflow' });
    expect(screen.getByRole('link', { name: /Log a buy/ })).toHaveAttribute('href', '/add-transaction');
    expect(screen.getByRole('link', { name: /Record sale/ })).toHaveAttribute('href', '/add-sale');
    expect(screen.getByRole('link', { name: 'Shipping, 1 to ship' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cash Flow, $3.6k owed' })).toBeInTheDocument();
    // Rows with nothing to say carry no figure.
    expect(screen.getByRole('link', { name: 'Goals' })).toBeInTheDocument();
  });
});

describe('Ledger in every layout', () => {
  it('the collapsed rail keeps a dot for each figure, and a folded group says what waits inside', async () => {
    const { container } = renderSidebar({ isCollapsed: true });
    // Countable figures get a number (Shipping 1); money gets a dot (Cash Flow).
    expect(container.querySelectorAll('[data-figure-dot]').length).toBe(1);
    expect(screen.getByRole('link', { name: 'Cash Flow, $3.6k owed' })).toBeInTheDocument();
    cleanup();
    renderSidebar();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^money$/i })); });
    expect(screen.getByRole('button', { name: /^money$/i })).toHaveTextContent('· $3.6k owed');
  });
});
