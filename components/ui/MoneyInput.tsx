'use client';

import { useEffect, useRef, useState } from 'react';

import {
  caretAfterGrouping,
  digitsBeforeCaret,
  groupAmount,
  stripAmount,
} from '@/lib/currency';

/**
 * A box you type money into, grouped the SI way while you type.
 *
 * `5000000000` in a field is unreadable — nobody counts ten digits by eye — and
 * the figure printed a few pixels below it already says US$5 000 000 000. A
 * screen that shows the same number two ways is a screen people re-check.
 *
 * **The caret is counted in DIGITS, not characters.** Inserting a separator to
 * the left of the caret pushes it one place right, so on every third keystroke
 * the cursor would drift and a long figure would come out scrambled. This
 * remembers how many digits sat before the caret and puts it back after the
 * same number of them.
 *
 * **What leaves is always raw.** `onValueChange` and `onCommit` hand back a
 * plain digit string, so every action that already strips separators keeps
 * working untouched.
 *
 * Uncontrolled by design: three of the four places this is used already commit
 * on blur rather than on every keystroke, and a controlled value fighting the
 * caret restoration is exactly the bug this component exists to avoid. Change
 * `resetKey` to put a new value in.
 */
export default function MoneyInput({
  id,
  defaultValue = '',
  placeholder,
  disabled,
  className = '',
  autoFocus,
  resetKey,
  onValueChange,
  onCommit,
}: {
  id?: string;
  /** Raw or grouped — it is normalised on the way in. */
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  /** Change this to re-seed the field, e.g. after a form is cleared. */
  resetKey?: string | number;
  /** Every keystroke, with the separators taken out. */
  onValueChange?: (raw: string) => void;
  /** On blur, with the separators taken out. Only fires when the value changed. */
  onCommit?: (raw: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => groupAmount(defaultValue));
  const committed = useRef(stripAmount(defaultValue));
  // Where the caret has to land once React has painted the regrouped string.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    setText(groupAmount(defaultValue));
    committed.current = stripAmount(defaultValue);
    // Re-seeding is the caller's doing, not the typist's — see `resetKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (pending.current === null) return;
    const el = ref.current;
    const at = pending.current;
    pending.current = null;
    if (!el || document.activeElement !== el) return;
    el.setSelectionRange(at, at);
  });

  return (
    <input
      ref={ref}
      id={id}
      inputMode="decimal"
      autoFocus={autoFocus}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={text}
      onChange={(e) => {
        const el = e.target;
        const digits = digitsBeforeCaret(el.value, el.selectionStart ?? el.value.length);
        const raw = stripAmount(el.value);
        const grouped = groupAmount(raw);
        pending.current = caretAfterGrouping(grouped, digits);
        setText(grouped);
        onValueChange?.(raw);
      }}
      onBlur={() => {
        const raw = stripAmount(text);
        if (raw === committed.current) return;
        committed.current = raw;
        onCommit?.(raw);
      }}
    />
  );
}
