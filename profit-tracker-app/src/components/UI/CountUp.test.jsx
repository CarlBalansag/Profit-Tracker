import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CountUp from './CountUp';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Drives requestAnimationFrame by hand: each call to tick() runs the queued frame at that time.
function fakeFrames() {
  let queued = null;
  vi.stubGlobal('requestAnimationFrame', (cb) => { queued = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { queued = null; });
  return (time) => act(() => { const cb = queued; queued = null; cb?.(time); });
}
const visible = (container) => container.querySelector('[aria-hidden="true"]').textContent;

describe('CountUp', () => {
  it('counts up from 0 in the same format, then lands on the exact value', () => {
    const tick = fakeFrames();
    const { container } = render(<CountUp value="$2,313.27" />);
    tick(0);
    expect(visible(container)).toBe('$0.00');
    tick(350);
    expect(visible(container)).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
    tick(700);
    expect(visible(container)).toBe('$2,313.27');
    expect(container.querySelector('.sr-only')).toHaveTextContent('$2,313.27');
  });

  it('counts from the old value to the new one when it changes', () => {
    const tick = fakeFrames();
    const { container, rerender } = render(<CountUp value="100" />);
    tick(0); tick(700);
    rerender(<CountUp value="200" />);
    tick(1000);
    expect(visible(container)).toBe('100');
    tick(2000);
    expect(visible(container)).toBe('200');
  });

  it('shows the value as-is with reduced motion, and leaves text without a number alone', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const { container, rerender } = render(<CountUp value="13.98%" />);
    expect(visible(container)).toBe('13.98%');
    rerender(<CountUp value="—" />);
    expect(container).toHaveTextContent('—');
  });
});
