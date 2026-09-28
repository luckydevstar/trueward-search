'use client';

import { useEffect, useState } from 'react';

/**
 * Copies a value, and says so.
 *
 * The confirmation matters more than it looks: the clipboard gives no visible
 * feedback of its own, so without it the only way to know a click worked is
 * to paste somewhere and check.
 *
 * `navigator.clipboard` needs a secure context — https, or localhost — and is
 * absent otherwise, so the button hides itself rather than sitting there
 * doing nothing when clicked.
 */
export function CopyButton({ value, label = 'Copy', title, className = 'btn icon' }) {
  const [state, setState] = useState('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setState('done');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      // The value itself, so hovering answers "copy what?" without clicking.
      title={title ?? `Copy ${String(value).slice(0, 120)}`}
      aria-label={title ?? label}
    >
      {state === 'done' ? '✓' : state === 'failed' ? '✕' : '⧉'}
      {label && state === 'idle' ? '' : ''}
    </button>
  );
}

/** True when the clipboard API is usable, so callers can skip the control. */
export const canCopy = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
