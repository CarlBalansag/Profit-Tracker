import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AnimatedLogo from './AnimatedLogo';

// Motion reads prefers-reduced-motion once and caches it, so stubbing
// matchMedia per test does nothing. Mock the hook instead.
let reduced = false;
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal()),
  useReducedMotion: () => reduced,
}));

afterEach(() => {
  cleanup();
  reduced = false;
});

describe('AnimatedLogo', () => {
  it('draws the P and the arrow as separate groups', () => {
    const { container } = render(<AnimatedLogo />);
    expect(container.querySelector('#p')).not.toBeNull();
    expect(container.querySelector('#arrow')).not.toBeNull();
  });

  it('is announced as an image by default and hidden when decorative', () => {
    render(<AnimatedLogo />);
    expect(screen.getByRole('img', { name: 'Profit Tracker' })).toBeTruthy();
    cleanup();
    render(<AnimatedLogo label={null} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('animated-logo').getAttribute('aria-hidden')).toBe('true');
  });

  it('starts hidden so the intro can play', () => {
    const { container } = render(<AnimatedLogo />);
    const arrow = container.querySelector('#arrow');
    expect(arrow.getAttribute('opacity')).toBe('0');
    expect(arrow.style.transform).toContain('translateX(-46px)');
  });

  it('renders the finished logo straight away with reduced motion', () => {
    reduced = true;
    const { container } = render(<AnimatedLogo />);
    for (const id of ['#p', '#arrow']) {
      const group = container.querySelector(id);
      expect(group.getAttribute('opacity')).not.toBe('0');
      expect(group.style.transform || 'none').not.toMatch(/translate|scale\(0/);
    }
  });
});
