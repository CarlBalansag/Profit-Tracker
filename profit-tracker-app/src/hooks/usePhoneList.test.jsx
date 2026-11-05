import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, render, screen } from '@testing-library/react';
import { usePhoneList } from './usePhoneList';
import ShowMoreButton from '../components/UI/ShowMoreButton';

const items = Array.from({ length: 60 }, (_, i) => i);

const mockScreen = (isPhone) => {
  window.matchMedia = vi.fn(() => ({ matches: isPhone, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
};

afterEach(() => {
  cleanup();
  delete window.matchMedia;
});

describe('usePhoneList', () => {
  it('shows the whole list on larger screens', () => {
    mockScreen(false);
    const { result } = renderHook(() => usePhoneList(items));
    expect(result.current.visible).toHaveLength(60);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('shows a page at a time on phones', () => {
    mockScreen(true);
    const { result } = renderHook(() => usePhoneList(items));
    expect(result.current.visible).toHaveLength(25);
    expect(result.current.hiddenCount).toBe(35);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(50);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(60);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('shows the whole list when the screen size is unknown', () => {
    const { result } = renderHook(() => usePhoneList(items));
    expect(result.current.visible).toHaveLength(60);
  });
});

describe('ShowMoreButton', () => {
  it('says how many are left and hides when none are', () => {
    const { rerender, container } = render(<ShowMoreButton hiddenCount={35} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show 25 more (35 left)' })).toBeTruthy();
    rerender(<ShowMoreButton hiddenCount={5} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show 5 more (5 left)' })).toBeTruthy();
    rerender(<ShowMoreButton hiddenCount={0} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
