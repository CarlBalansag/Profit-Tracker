import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

/**
 * Shared modal keyboard lifecycle: Escape-to-close, a Tab focus trap contained
 * within the modal, initial focus on open, and focus restoration on close.
 *
 * `onClose` is called as-is on Escape -- pass a guarded handler (e.g. one that
 * no-ops while a save is in flight) when the modal needs to block dismissal.
 *
 * By default, initial focus goes to the first focusable element in the modal
 * (often a close button). Pass `initialFocusRef` to focus a specific element
 * instead (e.g. a name field) -- do not also set focus yourself from the
 * caller, since a second, independently-timed focus call races this one and
 * leaves keystrokes landing on whatever had focus first.
 *
 * Returns a ref to attach to the modal's outermost focusable container.
 */
export function useModalKeyboard(isOpen, onClose, initialFocusRef) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocused.current = document.activeElement;

    const focusTimer = setTimeout(() => {
      const preferred = initialFocusRef?.current;
      const [first] = getFocusable(containerRef.current);
      (preferred || first || containerRef.current)?.focus();
    }, 0);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      const restore = previouslyFocused.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        restore.focus();
      }
    };
  }, [isOpen, onClose, initialFocusRef]);

  return containerRef;
}
