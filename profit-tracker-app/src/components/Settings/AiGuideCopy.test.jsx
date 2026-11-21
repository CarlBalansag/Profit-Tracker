import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiGuideCopy, { LAST_COPIED_KEY } from './AiGuideCopy';
import {
  AI_GUIDE_BODY, AI_GUIDE_UPDATES, AI_GUIDE_VERSION, fullGuideText, updatesAfter, updatesSinceText, wordCount,
} from '../../../../shared/aiGuide.mjs';

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const SAMPLE = [
  { version: '1.48', date: '2026-12-03', notes: ['Third change.'] },
  { version: '1.47', date: '2026-12-01', notes: ['Second change, part one.', 'Second change, part two.'] },
  { version: '1.45', date: '2026-11-20', notes: ['First change.'] },
];

describe('AI guide text', () => {
  it('the full guide carries the current version and the whole body', () => {
    const text = fullGuideText();
    expect(text.startsWith(`PROFIT TRACKER AI GUIDE -- version ${AI_GUIDE_VERSION}`)).toBe(true);
    expect(text).toContain(AI_GUIDE_BODY);
    expect(AI_GUIDE_VERSION).toBe(AI_GUIDE_UPDATES[0].version);
  });

  it('updates since a version are only the newer notes, oldest first', () => {
    expect(updatesAfter('1.45', SAMPLE).map((u) => u.version)).toEqual(['1.47', '1.48']);
    const text = updatesSinceText('1.45', SAMPLE);
    expect(text).toContain('updates from version 1.45 to 1.48');
    expect(text).not.toContain('First change.');
    expect(text.indexOf('Second change, part one.')).toBeLessThan(text.indexOf('Third change.'));
    expect(text).toContain('- Second change, part two.');
    expect(updatesSinceText('1.47', SAMPLE)).toContain('Third change.');
    expect(updatesSinceText('1.47', SAMPLE)).not.toContain('Second change');
  });

  it('nothing to copy when the AI is already current, and versions compare as numbers', () => {
    expect(updatesSinceText('1.48', SAMPLE)).toBeNull();
    expect(updatesAfter('1.5', [{ version: '1.50', date: 'x', notes: [] }])).toEqual([]);
    expect(updatesAfter('1.49', [{ version: '1.50', date: 'x', notes: [] }])).toHaveLength(1);
  });

  it('updates are much shorter than the full guide', () => {
    expect(wordCount(updatesSinceText('1.47', SAMPLE))).toBeLessThan(wordCount(fullGuideText()) / 10);
  });
});

describe('Keep your AI up to date (Settings > AI Assistant)', () => {
  let writeText;
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(cleanup);

  it('copies the full guide, then remembers the version and shows the AI as up to date', async () => {
    render(<AiGuideCopy />);
    expect(screen.getByTestId('ai-guide-version')).toHaveTextContent(AI_GUIDE_VERSION);
    fireEvent.click(screen.getByRole('button', { name: /Copy full guide/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(fullGuideText()));
    expect(window.localStorage.getItem(LAST_COPIED_KEY)).toBe(AI_GUIDE_VERSION);
    expect(mocks.toast.success).toHaveBeenCalled();
    expect(screen.getByTestId('ai-guide-updates-summary')).toHaveTextContent('Your AI is up to date');
    expect(screen.getByText(/you last copied/)).toBeInTheDocument();
  });

  it('leads with the full guide until this device has copied something', () => {
    render(<AiGuideCopy />);
    expect(screen.getByRole('button', { name: /Copy full guide/ })).toHaveClass('page-btn-primary');
    expect(screen.getByRole('button', { name: /Copy updates/ })).toHaveClass('page-btn-secondary');
    expect(screen.getByTestId('ai-guide-updates-summary')).toHaveTextContent(`If your AI already has the ${AI_GUIDE_VERSION} guide`);
  });

  it('"Copy updates" on the current version copies nothing and says so', async () => {
    window.localStorage.setItem(LAST_COPIED_KEY, AI_GUIDE_VERSION);
    render(<AiGuideCopy />);
    expect(screen.getByRole('combobox', { name: /Version your AI already knows/ })).toHaveValue(AI_GUIDE_VERSION);
    fireEvent.click(screen.getByRole('button', { name: /Copy updates/ }));
    expect(writeText).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalled();
  });

  it('ignores a remembered version that is no longer in the list', () => {
    window.localStorage.setItem(LAST_COPIED_KEY, '0.01');
    render(<AiGuideCopy />);
    expect(screen.queryByText(/you last copied/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Version your AI already knows/ }).value).toBe(AI_GUIDE_UPDATES.at(-1).version);
  });

  it('shows the text to copy by hand when the clipboard is blocked, and remembers nothing', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<AiGuideCopy />);
    fireEvent.click(screen.getByRole('button', { name: /Copy full guide/ }));
    const box = await screen.findByRole('textbox', { name: 'Guide text to copy' });
    expect(box.value).toBe(fullGuideText());
    expect(mocks.toast.error).toHaveBeenCalled();
    expect(window.localStorage.getItem(LAST_COPIED_KEY)).toBeNull();
  });

  it('still works when storage is unavailable', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<AiGuideCopy />);
    fireEvent.click(screen.getByRole('button', { name: /Copy full guide/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(mocks.toast.success).toHaveBeenCalled();
    get.mockRestore();
    set.mockRestore();
  });
});
