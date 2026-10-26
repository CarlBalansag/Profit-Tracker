import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ServerWakeUpScreen from './ServerWakeUpScreen';

describe('ServerWakeUpScreen', () => {
  it('explains the free-hosting cold start and labels progress as estimated', () => {
    render(<ServerWakeUpScreen startedAt={Date.now() - 5_000} attempt={2} />);

    expect(screen.getByText('Waking up the server')).toBeInTheDocument();
    expect(screen.getByText(/free hosting, which sleeps after inactivity/i)).toBeInTheDocument();
    expect(screen.getByText('Estimated startup progress')).toBeInTheDocument();
  });

  it('offers a manual retry only after automatic warm-up attempts fail', () => {
    const onRetry = vi.fn();
    render(<ServerWakeUpScreen startedAt={Date.now()} failed onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
