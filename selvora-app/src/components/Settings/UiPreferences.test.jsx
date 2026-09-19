import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UiPreferences } from './UiPreferences';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-ui-style');
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => cleanup());

describe('UiPreferences — Impeccable option', () => {
  it('renders all three selectable style cards, including Impeccable', () => {
    render(<UiPreferences />);
    expect(screen.getByRole('heading', { name: 'Neon Dark' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Glassmorphism Brown' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Impeccable' })).toBeInTheDocument();
  });

  it('selects Impeccable, sets the data-ui-style attribute, and hides the Color Theme picker', () => {
    render(<UiPreferences />);
    fireEvent.click(screen.getByRole('heading', { name: 'Impeccable' }));
    expect(document.documentElement.dataset.uiStyle).toBe('impeccable');
    expect(screen.queryByText('Color Theme')).not.toBeInTheDocument();
    expect(screen.getByText('Selected UI').nextSibling).toHaveTextContent('Impeccable');
  });

  it('does not disturb Neon Dark or Glassmorphism Brown selection', () => {
    render(<UiPreferences />);
    fireEvent.click(screen.getByRole('heading', { name: 'Glassmorphism Brown' }));
    expect(document.documentElement.dataset.uiStyle).toBe('glassmorphism-brown');
    fireEvent.click(screen.getByRole('heading', { name: 'Neon Dark' }));
    expect(document.documentElement.dataset.uiStyle).toBe('neon-dark');
    expect(screen.getByText('Color Theme')).toBeInTheDocument();
  });
});
