import { useEffect, useRef } from 'react';

/**
 * Listens for chord-style keyboard shortcuts.
 * Shortcut format: { key: 'g d', description, action } where 'g d' means
 * press 'g' then 'd' within `timeout` ms. Single keys work too ('/', '?').
 *
 * Ignores events when focus is in an editable element.
 */
export default function useShortcuts(shortcuts, { timeout = 800 } = {}) {
  const lastKeyRef = useRef(null);
  const lastKeyTimeRef = useRef(0);

  useEffect(() => {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const handler = (e) => {
      if (isEditable(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const now = Date.now();
      const first = e.key.toLowerCase();
      const expected = shortcuts.map((s) => s.key.toLowerCase());

      // Try single-key first
      const single = shortcuts.find((s) => s.key.toLowerCase() === first);
      if (single && !lastKeyRef.current) {
        e.preventDefault();
        single.action();
        lastKeyRef.current = null;
        return;
      }

      // Try chord: g then d
      if (lastKeyRef.current && now - lastKeyTimeRef.current < timeout) {
        const chord = `${lastKeyRef.current} ${first}`;
        const match = shortcuts.find((s) => s.key.toLowerCase() === chord);
        if (match) {
          e.preventDefault();
          match.action();
          lastKeyRef.current = null;
          return;
        }
      }

      // Save as potential first key of a chord
      const isFirstKey = expected.some((k) => k.startsWith(first + ' ') || k === first);
      if (isFirstKey) {
        lastKeyRef.current = first;
        lastKeyTimeRef.current = now;
      } else {
        lastKeyRef.current = null;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, timeout]);
}
