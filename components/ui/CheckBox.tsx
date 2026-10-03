import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A checkbox in Lucille's own shape (3 Oct 2026): the browser's box has a 2px
 * corner that read as sharp beside every other control here, so this one takes
 * the app's small radius (`rounded-sm`, 0.6 of `--radius`), its border and its
 * primary blue, and draws its tick with a short fade and settle on `--ease-ios`.
 *
 * Still the native `<input type="checkbox">` underneath (appearance removed), so
 * labels, keyboard, forms and screen readers behave exactly as before, and it
 * costs nothing in a list: no Radix, no state of its own.
 */
export function CheckBox({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={cn('relative inline-flex size-5 shrink-0', className)}>
      <input
        type="checkbox"
        {...props}
        className="peer size-5 cursor-pointer appearance-none rounded-sm border-[1.5px] border-muted-foreground/45 bg-card transition-[background-color,border-color,box-shadow] duration-200 ease-ios hover:border-primary/60 checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-5 scale-75 text-primary-foreground opacity-0 transition-[opacity,transform] duration-200 ease-ios peer-checked:scale-100 peer-checked:opacity-100"
      >
        <path d="M5.5 10.5l3 3 6-6.5" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
