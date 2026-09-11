import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Login from './Login';

describe('Login', () => {
  afterEach(() => window.history.replaceState({}, '', '/login'));

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
});
