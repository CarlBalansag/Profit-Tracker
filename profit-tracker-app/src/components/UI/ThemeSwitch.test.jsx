import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSwitch from './ThemeSwitch';

// A controllable stand-in for window.matchMedia('(prefers-color-scheme: dark)').
function mockSystemTheme(initialDark) {
  const listeners = new Set();
  const query = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((type, fn) => { if (type === 'change') listeners.add(fn); }),
    removeEventListener: vi.fn((type, fn) => { if (type === 'change') listeners.delete(fn); }),
  };
  window.matchMedia = vi.fn(() => query);
  return {
    query,
    listeners,
    change(dark) {
      query.matches = dark;
      act(() => {
        listeners.forEach((fn) => fn({ matches: dark, media: query.media }));
      });
    },
  };
}

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    document.documentElement.classList.remove('theme-switching');
    mockSystemTheme(false);
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
    delete window.matchMedia;
  });

  it('starts exactly one theme transition per click', async () => {
    render(<ThemeSwitch />);
    const toggle = screen.getByRole('switch', { name: /toggle light and dark mode/i });

    fireEvent.click(toggle, { clientX: 10, clientY: 10 });

    // A second transition would cancel the first mid-animation (the page blinks)
    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
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

  describe('following the OS theme', () => {
    it('starts dark when the OS is dark and there is no override', () => {
      mockSystemTheme(true);
      render(<ThemeSwitch />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('starts light when the OS is light and there is no override', () => {
      document.documentElement.dataset.theme = 'dark';
      mockSystemTheme(false);
      render(<ThemeSwitch />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('starts light when matchMedia is unavailable', () => {
      delete window.matchMedia;
      render(<ThemeSwitch />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('lets a saved override beat the OS setting', () => {
      mockSystemTheme(true);
      localStorage.setItem('theme-override', 'light');
      render(<ThemeSwitch />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('ignores and removes the old theme key', () => {
      mockSystemTheme(false);
      localStorage.setItem('theme', 'dark');
      render(<ThemeSwitch />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(localStorage.getItem('theme')).toBeNull();
    });

    it('clears the override and applies the new theme when the OS theme changes', () => {
      const system = mockSystemTheme(false);
      localStorage.setItem('theme-override', 'light');
      render(<ThemeSwitch />);

      system.change(true);

      expect(localStorage.getItem('theme-override')).toBeNull();
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      // No ripple for OS-driven changes
      expect(document.startViewTransition).not.toHaveBeenCalled();
    });

    it('stops listening for OS changes on unmount', () => {
      const system = mockSystemTheme(false);
      const { unmount } = render(<ThemeSwitch />);
      expect(system.listeners.size).toBe(1);

      unmount();

      expect(system.listeners.size).toBe(0);
    });

    it('stores an override when clicking to the opposite of the OS theme', () => {
      mockSystemTheme(false);
      render(<ThemeSwitch />);

      fireEvent.click(screen.getByRole('switch'), { clientX: 10, clientY: 10 });

      expect(localStorage.getItem('theme-override')).toBe('dark');
      expect(localStorage.getItem('theme')).toBeNull();
    });

    it('removes the override when clicking back to the OS theme', () => {
      mockSystemTheme(true);
      localStorage.setItem('theme-override', 'light');
      render(<ThemeSwitch />);

      fireEvent.click(screen.getByRole('switch'), { clientX: 10, clientY: 10 });

      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(localStorage.getItem('theme-override')).toBeNull();
    });
  });
});
