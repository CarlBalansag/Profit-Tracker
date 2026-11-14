import '@testing-library/jest-dom/vitest';
import React from 'react';
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

// A new logo element means the intro animation starts again from the top.
describe('Sidebar logo replay', () => {
  it('replays the intro when the sidebar is collapsed or expanded', () => {
    const { container, rerender } = render(tree({ isOpen: false, isCollapsed: false }));
    const first = logo(container);

    rerender(tree({ isOpen: false, isCollapsed: true }));
    const collapsed = logo(container);
    expect(collapsed).not.toBe(first);

    rerender(tree({ isOpen: false, isCollapsed: false }));
    expect(logo(container)).not.toBe(collapsed);
  });

  it('replays the intro when the mobile menu opens or closes', () => {
    const { container, rerender } = render(tree({ isOpen: false, isCollapsed: false }));
    const closed = logo(container);

    rerender(tree({ isOpen: true, isCollapsed: false }));
    const opened = logo(container);
    expect(opened).not.toBe(closed);

    rerender(tree({ isOpen: false, isCollapsed: false }));
    expect(logo(container)).not.toBe(opened);
  });

  it('keeps the same logo when nothing about the sidebar changes', () => {
    const { container, rerender } = render(tree({ isOpen: false, isCollapsed: false }));
    const first = logo(container);
    rerender(tree({ isOpen: false, isCollapsed: false }));
    expect(logo(container)).toBe(first);
  });

  it('replays the glass sidebar logo when the menu opens', () => {
    const { container, rerender } = render(tree({ isOpen: false, uiStyle: 'glassmorphism-brown' }));
    const first = logo(container);
    rerender(tree({ isOpen: true, uiStyle: 'glassmorphism-brown' }));
    expect(logo(container)).not.toBe(first);
  });
});
