import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useUiPreferences } from './useUiPreferences';

const Probe = () => {
  useUiPreferences();
  return null;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('glass theme', () => {
  it('always runs on dark colours, whatever the saved light or dark choice', () => {
    localStorage.setItem('ui_preferences', JSON.stringify({ style: 'glassmorphism-brown' }));
    document.documentElement.dataset.theme = 'light';
    render(<Probe />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('leaves the light or dark choice alone in the default theme', () => {
    document.documentElement.dataset.theme = 'light';
    render(<Probe />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps secondary and muted text readable on its background', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const alpha = (name) => Number(css.split(`--glass-text-${name}: rgba(232, 226, 214, `)[1].split(')')[0]);
    // 0.52 is 4.6:1 on the base colour but drops under 4.5:1 on raised cards.
    expect(alpha('secondary')).toBeGreaterThanOrEqual(0.58);
    expect(alpha('muted')).toBeGreaterThanOrEqual(0.58);
  });
});

describe('reduced motion', () => {
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('swaps the page entrance for a fade and drops hover lifts', () => {
    expect(block).toContain('animation-name: fadeIn');
    expect(block).toContain('transform: none');
  });
});
