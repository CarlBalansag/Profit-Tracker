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

  it('starts with the P and the arrow fully clipped so the intro can play', () => {
    const { container } = render(<AnimatedLogo />);
    const pen = container.querySelector('[data-reveal="p"]');
    expect(pen.getAttribute('stroke-dashoffset')).toBe('0');
    expect(pen.getAttribute('stroke-dasharray')).toMatch(/^0(px)? /);
    expect(container.querySelector('#p').getAttribute('mask')).toMatch(/^url\(#/);
    expect(container.querySelector('[data-reveal="arrow"]').style.transform).toContain('scaleX(0)');
  });

  it('gives each logo its own clip paths', () => {
    const { container } = render(<><AnimatedLogo /><AnimatedLogo /></>);
    const ids = [...container.querySelectorAll('clipPath, mask')].map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('renders the finished logo straight away with reduced motion', () => {
    reduced = true;
    const { container } = render(<AnimatedLogo />);
    expect(container.querySelector('#p').getAttribute('mask')).toBeNull();
    expect(container.querySelector('[data-reveal="arrow"]').style.transform || 'none').not.toMatch(/scaleX\(0\)/);
  });
});
