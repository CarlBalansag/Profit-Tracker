import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Login from './Login';

describe('Login', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/login');
  });

  it('explains when a cold server interrupted Discord login', () => {
    window.history.replaceState({}, '', '/login?error=server-waking');
    render(<Login />);
    expect(screen.getByText(/server is waking up/i)).toBeInTheDocument();
  });

  it('shows a safe generic message for other login failures', () => {
    window.history.replaceState({}, '', '/login?error=login-failed');
    render(<Login />);
    expect(screen.getByText(/Discord sign-in could not finish/i)).toBeInTheDocument();
  });

  it('shows Discord rate limiting and prevents another login until the wait expires', () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/login?error=discord-rate-limited&retry_after=2');
    render(<Login />);
    expect(screen.getByText(/Try again in 2 seconds/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').filter(button => /Sign in free|Get started/.test(button.textContent));
    expect(buttons).toHaveLength(3);
    buttons.forEach(button => expect(button).toBeDisabled());
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText(/try Discord sign-in again now/i)).toBeInTheDocument();
    buttons.forEach(button => expect(button).toBeEnabled());
  });

  it.each(['', '-1', 'invalid', 'Infinity'])('handles invalid retry delay %j', value => {
    window.history.replaceState({}, '', `/login?error=discord-rate-limited&retry_after=${value}`);
    render(<Login />);
    expect(screen.getByText(/Try again in 60 seconds/)).toBeInTheDocument();
  });
});
