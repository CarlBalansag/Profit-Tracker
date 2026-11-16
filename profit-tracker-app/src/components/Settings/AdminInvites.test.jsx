import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AdminInvites from './AdminInvites';

const mockInvites = [
  {
    id: 'invite-aaaa-1111',
    token_hash: 'hash1',
    created_by: 'admin-1',
    expires_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    consumed: false,
    used_by: null,
    created_at: new Date().toISOString(),
    status: 'active',
  },
  {
    id: 'invite-bbbb-2222',
    token_hash: 'hash2',
    created_by: 'admin-1',
    expires_at: new Date(Date.now() - 1000).toISOString(),
    consumed: false,
    used_by: null,
    created_at: new Date().toISOString(),
    status: 'expired',
  },
  {
    id: 'invite-cccc-3333',
    token_hash: 'hash3',
    created_by: 'admin-1',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    consumed: true,
    used_by: 'friend@example.com',
    created_at: new Date().toISOString(),
    status: 'used',
  },
];

describe('AdminInvites component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders and lists existing invites with their status badges', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/api/invites')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockInvites,
        };
      }
      return { ok: false, status: 404 };
    });

    render(<AdminInvites />);

    expect(screen.getByText('Member Invites')).toBeInTheDocument();
    expect(await screen.findByText('Active (Unused)')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(screen.getByText(/Used by: friend@example.com/)).toBeInTheDocument();
  });

  it('creates a new invite when button is clicked and displays copyable link', async () => {
    const newInvite = {
      id: 'invite-new-7777',
      token: 'abcd1234efgh5678ijkl9012',
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      consumed: false,
      created_at: new Date().toISOString(),
      status: 'active',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => newInvite,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    });

    render(<AdminInvites />);

    const createBtn = screen.getAllByRole('button', { name: /create invite link/i })[0];
    fireEvent.click(createBtn);

    expect(await screen.findByText(/New Invite Link Created/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/login\?invite=abcd1234efgh5678ijkl9012/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('deletes an invite when the trash button is clicked', async () => {
    let current = [...mockInvites];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      if (opts?.method === 'DELETE') {
        current = current.filter(i => !url.includes(i.id));
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: true, status: 200, json: async () => current };
    });

    render(<AdminInvites />);

    const items = await screen.findAllByText('ID: invite-a…');
    expect(items[0]).toBeInTheDocument();
    const deleteBtns = screen.getAllByTitle('Delete invite');
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.queryAllByText('ID: invite-a…')).toHaveLength(0);
    });
  });
});
