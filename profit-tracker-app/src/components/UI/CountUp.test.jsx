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

  it('counts from the old value to the new one when it changes', () => {
    const { container, rerender } = render(<CountUp value="100" />);
    finish(lastRun());
    rerender(<CountUp value="200" />);
    const run = lastRun();
    expect(run.from).toBe(100);
    expect(run.to).toBe(200);
    step(run, 150);
    expect(visible(container)).toBe('150');
  });

  it('stops the old count when the value changes mid-way', () => {
    const { rerender } = render(<CountUp value="13.98%" />);
    const first = lastRun();
    step(first, 5);
    rerender(<CountUp value="11.42%" />);
    expect(first.stopped).toBe(true);
    expect(lastRun().from).toBe(5);
  });

  it('leaves text without a number alone', () => {
    const { container } = render(<CountUp value="—" />);
    expect(container).toHaveTextContent('—');
    expect(runs).toHaveLength(0);
  });
});
