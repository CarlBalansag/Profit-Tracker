import React, { useState } from 'react';
import { Copy, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  AI_GUIDE_UPDATES, AI_GUIDE_VERSION, fullGuideText, updatesSinceText, wordCount,
} from '../../../../shared/aiGuide.mjs';

// Settings > AI Assistant: copy the AI guide into an assistant. Someone new
// copies the whole guide once; someone whose AI already knows an older version
// copies only what changed since, so it doesn't re-read (and spend usage on)
// the whole thing. The last version copied is remembered on this device so the
// "your AI knows" picker starts in the right place next time.
export const LAST_COPIED_KEY = 'profit-tracker:ai-guide-last-copied';

const readLastCopied = () => {
  try {
    const v = window.localStorage.getItem(LAST_COPIED_KEY);
    return AI_GUIDE_UPDATES.some((u) => u.version === v) ? v : null;
  } catch {
    return null;
  }
};
const writeLastCopied = (v) => {
  try { window.localStorage.setItem(LAST_COPIED_KEY, v); } catch { /* private window: just don't remember */ }
};

export default function AiGuideCopy() {
  const [lastCopied, setLastCopied] = useState(readLastCopied);
  // Nothing remembered: start from the oldest version, since copying a few
  // notes the AI already knows is harmless and missing one is not.
  const [since, setSince] = useState(() => readLastCopied() || AI_GUIDE_UPDATES[AI_GUIDE_UPDATES.length - 1].version);
  // Shown when the clipboard is unavailable, so the text can be copied by hand.
  const [manual, setManual] = useState(null);

  const full = fullGuideText();
  const updates = updatesSinceText(since);
  // The filled (primary) button is the likely next step: the full guide until
  // this device has copied something, then the updates while there are any.
  const updatesFirst = Boolean(lastCopied && updates);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      writeLastCopied(AI_GUIDE_VERSION);
      setLastCopied(AI_GUIDE_VERSION);
      setSince(AI_GUIDE_VERSION);
      toast.success(`${what} copied. Paste it into your AI.`);
    } catch {
      setManual(text);
      toast.error("Couldn't copy automatically. Select the text below and copy it.");
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Sparkles size={16} /> Keep your AI up to date</h2>
        <p className="text-xs text-gray-500 mt-1 max-w-lg">
          An AI connected with one of your keys catches up by itself: it calls <code className="font-mono text-[11px] text-gray-300">get_ai_guide</code> and gets only what&apos;s new (each key shows the version it last read).
          For an AI that doesn&apos;t, paste the guide into it, then copy only the updates when we add tools.
          The guide is on version <span className="text-gray-300 font-medium" data-testid="ai-guide-version">{AI_GUIDE_VERSION}</span>
          {lastCopied ? <>; you last copied <span className="text-gray-300 font-medium">{lastCopied}</span> on this device.</> : '.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-800 p-4 space-y-3 flex flex-col">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-200">New to the tools</h3>
            <p className="text-xs text-gray-500 mt-1">The whole guide, for an AI that hasn&apos;t seen it. About {wordCount(full).toLocaleString()} words, pasted once.</p>
          </div>
          <button type="button" onClick={() => copy(full, 'Full guide')} className={`page-btn ${updatesFirst ? 'page-btn-secondary' : 'page-btn-primary'} self-start`}>
            <Copy size={14} /> Copy full guide
          </button>
        </div>

        <div className="rounded-lg border border-gray-800 p-4 space-y-3 flex flex-col">
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-semibold text-gray-200">Already set up</h3>
            <label className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>Your AI knows version</span>
              <select
                value={since}
                onChange={(e) => setSince(e.target.value)}
                aria-label="Version your AI already knows"
                className="px-2 py-1.5 rounded-lg text-sm text-white bg-white/[0.04] border border-white/10 focus:outline-none focus:border-purple-500/50"
              >
                {AI_GUIDE_UPDATES.map((u) => (
                  <option key={u.version} value={u.version} className="bg-[#16181d]">
                    {u.version}{u.version === AI_GUIDE_VERSION ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-gray-500" data-testid="ai-guide-updates-summary">
              {updates
                ? `Only the changes since ${since}. About ${wordCount(updates).toLocaleString()} words.`
                : lastCopied
                  ? 'Your AI is up to date. Nothing to copy.'
                  : `If your AI already has the ${since} guide, it's up to date.`}
            </p>
            <p className="text-[11px] text-gray-600">Not sure, or it knows a version older than {AI_GUIDE_UPDATES[AI_GUIDE_UPDATES.length - 1].version}? Copy the full guide instead.</p>
          </div>
          <button
            type="button"
            onClick={() => (updates ? copy(updates, 'Updates') : toast.info('Your AI is already on the current version.'))}
            className={`page-btn ${updatesFirst ? 'page-btn-primary' : 'page-btn-secondary'} self-start`}
          >
            <RefreshCw size={14} /> Copy updates
          </button>
        </div>
      </div>

      {manual && (
        <textarea
          readOnly
          value={manual}
          rows={8}
          aria-label="Guide text to copy"
          onFocus={(e) => e.target.select()}
          className="w-full px-3 py-2 rounded-lg text-xs font-mono text-gray-200 bg-black/40 border border-white/10"
        />
      )}
    </div>
  );
}
