import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }),
}));

afterEach(cleanup);

const tree = (props) => (
  <MemoryRouter initialEntries={['/']}>
    <Sidebar setIsOpen={() => {}} setIsCollapsed={() => {}} {...props} />
  </MemoryRouter>
);

const logo = (container) => container.querySelector('[data-testid="animated-logo"]');

// A new logo element would start the intro again. It draws once when the app
// loads, so collapsing, expanding or opening the drawer keeps the same logo.
describe('Sidebar logo', () => {
  it('does not replay when the sidebar is collapsed or expanded', () => {
    const { container, rerender } = render(tree({ isOpen: false, isCollapsed: false }));
    const first = logo(container);
    rerender(tree({ isOpen: false, isCollapsed: true }));
    expect(logo(container)).toBe(first);
    rerender(tree({ isOpen: false, isCollapsed: false }));
    expect(logo(container)).toBe(first);
  });

  it('does not replay when the mobile menu opens or closes', () => {
    const { container, rerender } = render(tree({ isOpen: false, isCollapsed: false }));
    const first = logo(container);
    rerender(tree({ isOpen: true, isCollapsed: false }));
    expect(logo(container)).toBe(first);
    rerender(tree({ isOpen: false, isCollapsed: false }));
    expect(logo(container)).toBe(first);
  });

  it('does not replay the glass sidebar logo when the menu opens', () => {
    const { container, rerender } = render(tree({ isOpen: false, uiStyle: 'glassmorphism-brown' }));
    const first = logo(container);
    rerender(tree({ isOpen: true, uiStyle: 'glassmorphism-brown' }));
    expect(logo(container)).toBe(first);
  });
});
