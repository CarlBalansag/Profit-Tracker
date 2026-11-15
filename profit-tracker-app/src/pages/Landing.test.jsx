import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Landing from './Landing';
import ProtectedRoute from '../components/Auth/ProtectedRoute';

const mocks = vi.hoisted(() => ({ user: null, signup: false, loading: false }));
vi.mock('../services/firebaseAuth', () => ({ get signupEnabled() { return mocks.signup; } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.loading }) }));

afterEach(() => { cleanup(); mocks.user = null; mocks.signup = false; mocks.loading = false; });

// jsdom has no IntersectionObserver; the scroll-in animations need one.
// This one reports every element as on screen right away.
beforeAll(() => {
  globalThis.IntersectionObserver ??= class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }], this); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
});

function mount() {
  return render(<MemoryRouter><Landing /></MemoryRouter>);
}
const demo = () => screen.getByRole('region', { name: 'Profit Tracker demo' });
// The value under a stat tile's label (labels can repeat elsewhere, e.g. in the nav).
const kpi = (label) => within(demo()).getAllByText(label)
  .find((el) => el.nextSibling?.classList?.contains('lp-num')).nextSibling.textContent;

describe('landing page', () => {
  it('leads with the demo and links to sign in', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Your flips, finally in one place/);
    expect(screen.getAllByRole('button', { name: /Try the demo/i }).length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: /^Sign in$/ });
    links.forEach((l) => expect(l).toHaveAttribute('href', '/login'));
    expect(screen.getByRole('heading', { name: /Your whole reselling business/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Up and running/ })).toBeInTheDocument();
  });

  it('the overview switches to the feature a visitor picks', () => {
    mount();
    const sell = screen.getByRole('button', { name: /Know what each sale made/ });
    fireEvent.click(sell);
    expect(sell).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: /Selling/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Be ready at tax time/ }));
    expect(screen.getByRole('region', { name: /Taxes/ })).toBeInTheDocument();
  });

  it('the hero picture of the app is hidden from screen readers and keyboard', () => {
    const { container } = mount();
    const win = container.querySelector('.lp-window');
    expect(win).toHaveAttribute('aria-hidden', 'true');
    expect(win.hasAttribute('inert')).toBe(true);
  });

  it('offers a free account when signup is open', () => {
    mocks.signup = true;
    mount();
    expect(screen.getAllByRole('link', { name: /Create free account/i })[0]).toHaveAttribute('href', '/login');
  });

  it('every demo page opens from the sidebar', () => {
    mount();
    const nav = within(demo()).getByRole('navigation', { name: 'Demo pages' });
    for (const [label, heading] of [['Inventory', 'Inventory'], ['Credit cards', 'Credit cards'], ['Cash flow', 'Cash flow'], ['Analytics', 'Analytics'], ['Calendar', 'Calendar'], ['Log a sale', 'Log a sale'], ['Dashboard', 'Dashboard']]) {
      fireEvent.click(within(nav).getByRole('button', { name: label }));
      expect(within(demo()).getByRole('heading', { level: 3, name: heading })).toBeInTheDocument();
      expect(within(nav).getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
    }
  });

  it('logging a sale updates the dashboard, and a bad price shows an error instead', () => {
    mount();
    const profitBefore = kpi('Net profit');
    const soldBefore = kpi('Revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Sell something' }));

    fireEvent.click(within(demo()).getByRole('button', { name: 'Log sale' }));
    expect(within(demo()).getByRole('alert')).toHaveTextContent(/sale price/);

    fireEvent.change(within(demo()).getByLabelText('Sold for'), { target: { value: '999' } });
    fireEvent.click(within(demo()).getByRole('button', { name: 'Log sale' }));
    expect(within(demo()).getByRole('heading', { level: 3, name: 'Dashboard' })).toBeInTheDocument();
    expect(kpi('Net profit')).not.toBe(profitBefore);
    expect(kpi('Revenue')).not.toBe(soldBefore);
  });

  it('reset puts the demo back', () => {
    mount();
    const before = kpi('Inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Add new stock' }));
    fireEvent.change(within(demo()).getByLabelText('What did you buy?'), { target: { value: 'Test sneaker' } });
    fireEvent.change(within(demo()).getByLabelText('You paid'), { target: { value: '100' } });
    fireEvent.click(within(demo()).getByRole('button', { name: 'Add to inventory' }));
    expect(within(demo()).getByText('Test sneaker')).toBeInTheDocument();
    fireEvent.click(within(demo()).getByRole('button', { name: /Reset demo/ }));
    expect(kpi('Inventory')).toBe(before);
  });

  it('full screen opens as a dialog and Escape closes it', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('dialog', { name: 'Profit Tracker demo' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('signed-out routing', () => {
  function app(path) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="*" element={<ProtectedRoute publicHome={<div>landing page</div>}><div>the app</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('shows the landing page at / and sends other app pages to /login', () => {
    app('/');
    expect(screen.getByText('landing page')).toBeInTheDocument();
    cleanup();
    app('/inventory');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows the landing page at / while the sign-in check is still running', () => {
    mocks.loading = true;
    app('/');
    expect(screen.getByText('landing page')).toBeInTheDocument();
    cleanup();
    app('/inventory');
    expect(screen.queryByText('landing page')).not.toBeInTheDocument();
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
  });

  it('signed-in users still get the app at /', () => {
    mocks.user = { id: 1 };
    app('/');
    expect(screen.getByText('the app')).toBeInTheDocument();
  });
});
