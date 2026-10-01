import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';
import { CHANGELOG, CURRENT_VERSION } from '../../data/changelog';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' }, logout: vi.fn() }),
}));

afterEach(cleanup);

const renderSidebar = () => render(
  <MemoryRouter>
    <Sidebar isOpen setIsOpen={() => {}} isCollapsed={false} setIsCollapsed={() => {}} />
  </MemoryRouter>
);

describe('Sidebar version history', () => {
  it('shows the current version above Data Setup and opens the changelog on click', async () => {
    renderSidebar();

    const versionButton = screen.getByText(`v${CURRENT_VERSION}`);
    expect(versionButton).toBeInTheDocument();

    fireEvent.click(versionButton);

    expect(await screen.findByText("What's New")).toBeInTheDocument();
    // The notes are unique text, unlike "v0.50" which also appears on the
    // still-mounted sidebar button -- asserting on the notes avoids that
    // ambiguity while still proving the matching entry rendered.
    expect(screen.getByText(CHANGELOG[0].notes)).toBeInTheDocument();
  });
});
