import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSwitch from './ThemeSwitch';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    document.documentElement.classList.remove('theme-switching');
    // jsdom has no View Transitions or Web Animations; stub just enough to run the real path
    document.startViewTransition = vi.fn((update) => {
      update();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    });
    document.documentElement.animate = vi.fn();
  });

  afterEach(() => {
    cleanup();
    delete document.startViewTransition;
    delete document.documentElement.animate;
  });

  it('starts exactly one theme transition per click', async () => {
    render(<ThemeSwitch />);
    const toggle = screen.getByRole('switch', { name: /toggle light and dark mode/i });

    fireEvent.click(toggle, { clientX: 10, clientY: 10 });

    // A second transition would cancel the first mid-animation (the page blinks)
    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('pauses page color transitions only while the theme swaps', async () => {
    let finish;
    document.startViewTransition = vi.fn((update) => {
      update();
      return { ready: Promise.resolve(), finished: new Promise((resolve) => { finish = resolve; }) };
    });
    render(<ThemeSwitch />);

    fireEvent.click(screen.getByRole('switch'), { clientX: 10, clientY: 10 });
    expect(document.documentElement).toHaveClass('theme-switching');

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement).not.toHaveClass('theme-switching');
  });

  it('switches back to light on a second click', () => {
    render(<ThemeSwitch />);
    const toggle = screen.getByRole('switch');

    fireEvent.click(toggle, { clientX: 10, clientY: 10 });
    fireEvent.click(toggle, { clientX: 10, clientY: 10 });

    expect(document.startViewTransition).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
