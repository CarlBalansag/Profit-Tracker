import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// framer-motion's animate, driven by hand: each run records its from/to and
// callbacks so the test can step it.
const runs = [];
vi.mock('framer-motion', () => ({
  animate: (from, to, options) => {
    const run = { from, to, options, stopped: false };
    runs.push(run);
    return { stop: () => { run.stopped = true; } };
  },
}));

const { default: CountUp } = await import('./CountUp');

const step = (run, value) => act(() => run.options.onUpdate(value));
const finish = (run) => act(() => run.options.onComplete());
const visible = (container) => container.querySelector('[aria-hidden="true"]').textContent;
const lastRun = () => runs.filter((r) => !r.stopped).at(-1);

beforeEach(() => { runs.length = 0; });
afterEach(cleanup);

describe('CountUp', () => {
  it('starts at 0 in the same format, counts up, then lands on the exact value', () => {
    const { container } = render(<CountUp value="$2,313.27" />);
    expect(visible(container)).toBe('$0.00');
    const run = lastRun();
    expect(run.from).toBe(0);
    expect(run.to).toBe(2313.27);
    step(run, 1234.5);
    expect(visible(container)).toBe('$1,234.50');
    finish(run);
    expect(visible(container)).toBe('$2,313.27');
    expect(container.querySelector('.sr-only')).toHaveTextContent('$2,313.27');
  });

  it('starts climbing slowly the moment new data is loading', () => {
    const { container, rerender } = render(<CountUp value="$100.00" />);
    finish(lastRun());
    rerender(<CountUp value="$100.00" pending />);
    const drift = lastRun();
    expect(drift.from).toBe(100);
    expect(drift.to).toBeGreaterThan(100);
    expect(drift.options.duration).toBeGreaterThan(5); // slow, and it keeps slowing
    step(drift, 140);
    expect(visible(container)).toBe('$140.00');
  });

  it('with drift off, holds the last number while loading, then counts from it to the new one', () => {
    const { container, rerender } = render(<CountUp value="$100.00" drift={false} />);
    finish(lastRun());
    const before = runs.length;
    rerender(<CountUp value="$100.00" pending drift={false} />);
    expect(runs.length).toBe(before);
    expect(visible(container)).toBe('$100.00');
    rerender(<CountUp value="$60.00" drift={false} />);
    const settle = lastRun();
    expect(settle.from).toBe(100);
    expect(settle.to).toBe(60);
  });

  it('counts back down from where the climb got to when the new value arrives', () => {
    const { container, rerender } = render(<CountUp value="$100.00" />);
    finish(lastRun());
    rerender(<CountUp value="$100.00" pending />);
    const drift = lastRun();
    step(drift, 200);
    rerender(<CountUp value="$80.00" />);
    expect(drift.stopped).toBe(true);
    // No flash of the new value: it carries on from $200 ...
    expect(visible(container)).toBe('$200.00');
    const settle = lastRun();
    expect(settle.from).toBe(200);
    expect(settle.to).toBe(80);
    expect(settle.options.duration).toBeLessThan(drift.options.duration); // faster than the climb
    step(settle, 120);
    expect(visible(container)).toBe('$120.00');
    finish(settle);
    expect(visible(container)).toBe('$80.00');
  });

  it('goes back to the same value if the new data matches the old', () => {
    const { rerender } = render(<CountUp value="33" />);
    finish(lastRun());
    rerender(<CountUp value="33" pending />);
    step(lastRun(), 40);
    rerender(<CountUp value="33" />);
    expect(lastRun()).toMatchObject({ from: 40, to: 33 });
  });

  it('leaves text without a number alone', () => {
    const { container } = render(<CountUp value="—" />);
    expect(container).toHaveTextContent('—');
    expect(runs).toHaveLength(0);
  });
});
